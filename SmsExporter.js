/**
 * SmsExporter.js
 * Exports the current Pocket Platformer project as a Sega Master System ROM.
 *
 * Resource blob format (appended to base ROM at 32KB boundary):
 *
 *   Offset  Size  Description
 *   ------  ----  -----------
 *   0       4     Signature: "PPLT"
 *   4       1     level_count
 *   5       1     num_tiles (BG tiles, not counting blank tile 0)
 *   6       10*2  physics_config (10 x int16, fixed-point 8.8)
 *   +1             max_jump_frames (uint8)
 *   +1             has_double_jump (uint8)
 *   +1             has_wall_jump   (uint8)
 *   ...     16    palette (16 x uint8 SMS colour)
 *   ...     N*32  tileset (N x 8x8 tile in 4bpp planar)
 *   ...           sprite sheet tiles (for objects+player, same 4bpp format)
 *   ...           levels[] each:
 *                   1  map_w
 *                   1  map_h
 *                   1  obj_count
 *                   1  reserved
 *                   map_w*map_h  columnar tile indices
 *                   obj_count*3  objects: x, y, type
 *
 * Tile VRAM layout (fixed v1.1):
 *   Tile 0        = blank
 *   Tiles 1..N    = BG tiles (from tileData)
 *   Tiles 256..   = sprite tiles (objects + player animations)
 *
 * Object type IDs (must match pocket_platformer.c):
 *   1 = START_FLAG
 *   2 = FINISH_FLAG
 *   3 = SPIKE
 *   4 = TRAMPOLINE
 *   5 = COIN (collectible)
 */

const SmsExporter = (() => {

  // ─── Constants ──────────────────────────────────────────────────────────────
  const FP_ONE = 256;          // 8.8 fixed point scale
  const MAX_PALETTE_COLORS = 16;
  const TILE_PX = 8;
  const BYTES_PER_TILE = 32;   // 8 rows × 4 bitplanes

  const OBJ_TYPE = {
    startFlag:          1,
    finishFlag:         2,
    spike:              3,
    trampoline:         4,
    collectible:        5,
    redBlock:           7,
    blueBlock:          8,
    redBlueSwitch:      9,
  };

  // Map pocket-platformer ObjectTypes strings → our IDs
  const OBJECT_TYPE_MAP = {
    'startFlag':          OBJ_TYPE.startFlag,
    'finishFlag':         OBJ_TYPE.finishFlag,
    'spike':              OBJ_TYPE.spike,
    'trampoline':         OBJ_TYPE.trampoline,
    'collectible':        OBJ_TYPE.collectible,
    'redBlock':           OBJ_TYPE.redBlock,
    'blueBlock':          OBJ_TYPE.blueBlock,
    'finishFlagLocked':   12,  /* finishFlag with collectiblesNeeded */
    'redBlueSwitch':      OBJ_TYPE.redBlueSwitch,
    'redblueblockswitch': OBJ_TYPE.redBlueSwitch,
    'violetBlock':        10,
    'pinkBlock':          11,
  };

  // ─── Fixed-point helpers ─────────────────────────────────────────────────────
  const toFP = v => Math.round(v * FP_ONE);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clampByte = v => clamp(Math.round(v), 0, 255);

  // ─── SMS colour conversion ───────────────────────────────────────────────────
  // SMS palette: 6-bit colour — 2 bits per channel (0-3), packed as bbggrr
  function rgbHexToSms(hex) {
    if (!hex || hex === 'transp') return 0;
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const r2 = (r >> 6) & 3;
    const g2 = (g >> 6) & 3;
    const b2 = (b >> 6) & 3;
    return r2 | (g2 << 2) | (b2 << 4);
  }

  function smsColourDistance(a, b) {
    // Expand both back to 0-255 range for comparison
    const er = ((a & 3) * 85) - (((b & 3)) * 85);
    const eg = (((a >> 2) & 3) * 85) - (((b >> 2) & 3) * 85);
    const eb = (((a >> 4) & 3) * 85) - (((b >> 4) & 3) * 85);
    return er*er + eg*eg + eb*eb;
  }

  function nearestPaletteIndex(smsColour, palette) {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const d = smsColourDistance(smsColour, palette[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  // ─── Palette builder ─────────────────────────────────────────────────────────
  // Collects all unique SMS colours from all sprite pixel arrays used in the
  // project, then quantises to 16 colours (palette[0] is always transparent/black).
  function buildPalette(allPixelRows) {
    // Count frequency of each SMS colour
    const freq = new Map();
    for (const row of allPixelRows) {
      for (const hex of row) {
        if (!hex || hex === 'transp') continue;
        const sms = rgbHexToSms(hex);
        freq.set(sms, (freq.get(sms) || 0) + 1);
      }
    }

    // Sort by frequency descending, take top 15 (slot 0 = transparent black)
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const palette = [0]; // index 0 = transparent
    for (const [colour] of sorted) {
      if (palette.length >= MAX_PALETTE_COLORS) break;
      if (!palette.includes(colour)) palette.push(colour);
    }
    // Pad to 16
    while (palette.length < MAX_PALETTE_COLORS) palette.push(0);
    return palette;
  }

  // ─── Tile → 4bpp bitplane encoder ────────────────────────────────────────────
  // sprite: 8 rows of 8 hex-colour strings
  // palette: 16-entry SMS palette array
  // Returns Uint8Array of 32 bytes
  function encodeTile4bpp(sprite, palette) {
    const out = new Uint8Array(BYTES_PER_TILE);
    for (let row = 0; row < 8; row++) {
      let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
      for (let col = 0; col < 8; col++) {
        const hex = sprite[row][col];
        let palIdx = 0;
        if (hex && hex !== 'transp') {
          const sms = rgbHexToSms(hex);
          palIdx = nearestPaletteIndex(sms, palette);
        }
        const bit = 7 - col;
        if (palIdx & 1) p0 |= (1 << bit);
        if (palIdx & 2) p1 |= (1 << bit);
        if (palIdx & 4) p2 |= (1 << bit);
        if (palIdx & 8) p3 |= (1 << bit);
      }
      out[row * 4 + 0] = p0;
      out[row * 4 + 1] = p1;
      out[row * 4 + 2] = p2;
      out[row * 4 + 3] = p3;
    }
    return out;
  }

  // ─── Sprite sheet builder ─────────────────────────────────────────────────────
  // 10 sprites × 1 tile each (8×8, SPRITEMODE_NORMAL). Loaded at VRAM 256.
  //   Tile 256=start flag, 257=finish flag, 258=spike, 259=trampoline, 260=coin
  //   Tile 261=player idle, 262=player walk0, 263=player walk1, 264=player jump
  //   Tile 265=finish flag closed (locked, needs all coins)
  function buildSpriteSheet(sprites, palette) {
    const tiles = [];

    function encodeSprite8(spriteObj, frameIdx) {
      const anim = spriteObj.animation || spriteObj;
      const frame = Array.isArray(anim) ? (anim[frameIdx] || anim[0]) : anim;
      const rows = (frame.sprite || frame).slice(0, 8);
      tiles.push(encodeTile4bpp(rows, palette));
    }

    const blank8 = Array(8).fill(null).map(() => Array(8).fill('transp'));
    const encodeBlank = () => tiles.push(encodeTile4bpp(blank8, palette));

    const get = name => sprites[name] || null;
    const startFlag  = get('START_FLAG_SPRITE');
    const finishFlag = get('FINISH_FLAG_SPRITE');
    const spikeS     = get('SPIKE_SPRITE');
    const trampS     = get('TRAMPOLINE_SRPITE') || get('TRAMPOLINE_SPRITE');
    const coinS      = get('COLLECTIBLE');
    const pIdle      = get('PLAYER_IDLE_SPRITE');
    const pWalk      = get('PLAYER_WALK_SPRITE');
    const pJump      = get('PLAYER_JUMP_SPRITE');

    const flagClosed = get('FINISH_FLAG_CLOSED_SPRITE');

    startFlag  ? encodeSprite8(startFlag,  0) : encodeBlank();
    finishFlag ? encodeSprite8(finishFlag, 0) : encodeBlank();
    spikeS     ? encodeSprite8(spikeS,     0) : encodeBlank();
    trampS     ? encodeSprite8(trampS,     0) : encodeBlank();
    coinS      ? encodeSprite8(coinS,      0) : encodeBlank();
    pIdle      ? encodeSprite8(pIdle,      0) : encodeBlank();
    pWalk      ? encodeSprite8(pWalk,      0) : encodeBlank();
    pWalk      ? encodeSprite8(pWalk,      1) : encodeBlank();
    pJump      ? encodeSprite8(pJump,      0) : encodeBlank();
    flagClosed ? encodeSprite8(flagClosed, 0) : encodeBlank(); /* tile 265 */

    const out = new Uint8Array(tiles.length * BYTES_PER_TILE);
    let offset = 0;
    for (const t of tiles) { out.set(t, offset); offset += BYTES_PER_TILE; }
    return out;
  }

  // ─── BG tileset builder ───────────────────────────────────────────────────────
  // Returns { encoded: Uint8Array, tileCount: N }
  // Tiles are de-duplicated. Returns mapping: original tile index → VRAM tile index.
  function buildBgTileset(levels, sprites, palette) {
    // Build a lookup from tile .name value → sprite object.
    // SpritePixelArrays uses .name (e.g. 17) as the tileData value, but the
    // JavaScript property key may differ (e.g. TILE_13 has .name = 17).
    // We must look up by .name, not by property key.
    const tileNameMap = new Map();
    for (const key of Object.keys(sprites)) {
      const s = sprites[key];
      if (s && s.descriptiveName && typeof s.name === 'number') {
        tileNameMap.set(s.name, s);
      }
    }

    // Collect all unique tileData values used across all levels
    const tileCache = new Map(); // key: tileData value → encoded Uint8Array
    const tileOrder = [];        // ordered unique tile indices (excl. 0)

    for (const level of levels) {
      for (const row of level.tileData) {
        for (const tileIdx of row) {
          if (tileIdx === 0) continue;
          // 900=treadmill-right, 901=treadmill-left: handled via sentinels -202/-203
          if (tileIdx === 900 || tileIdx === 901) continue;
          if (!tileCache.has(tileIdx)) {
            tileCache.set(tileIdx, null); // placeholder
            tileOrder.push(tileIdx);
          }
        }
      }
      // Connected disappearing blocks have tileData overwritten to 11 at runtime.
      // If the level has any, ensure tileData value 10 gets a VRAM slot anyway.
      if (level.levelObjects) {
        const hasConnected = level.levelObjects.some(o => o.type === 'connectedDisappearingBlock');
        if (hasConnected && !tileCache.has(10)) {
          tileCache.set(10, null);
          tileOrder.push(10);
        }
      }
    }

    // Special tile values that don't follow the TILE_N naming convention
    const specialTilePixels = new Map();
    if (sprites['DISAPPEARING_BLOCK_SPRITE'])
      specialTilePixels.set(11, sprites['DISAPPEARING_BLOCK_SPRITE'].animation[0].sprite);
    if (sprites['CONNECTED_DISAPPEARING_BLOCK_SPRITE'])
      specialTilePixels.set(10, sprites['CONNECTED_DISAPPEARING_BLOCK_SPRITE'].animation[0].sprite);
    // Red/blue blocks: tileData 12 = active block, 13 = switch.
    // We add four special tile encodings keyed with negative sentinels to avoid
    // colliding with the numeric tileData values used by the map scan.
    // The actual map encoding uses levelObjects to place the right tile.
    if (sprites['RED_BLOCK'])
      specialTilePixels.set(-2, sprites['RED_BLOCK'].animation[0].sprite);   // red solid
    if (sprites['RED_BLOCK'] && sprites['RED_BLOCK'].animation[1])
      specialTilePixels.set(-3, sprites['RED_BLOCK'].animation[1].sprite);   // red ghost
    if (sprites['BLUE_BLOCK'])
      specialTilePixels.set(-4, sprites['BLUE_BLOCK'].animation[0].sprite);  // blue solid
    if (sprites['BLUE_BLOCK'] && sprites['BLUE_BLOCK'].animation[1])
      specialTilePixels.set(-5, sprites['BLUE_BLOCK'].animation[1].sprite);  // blue ghost
    if (sprites['VIOLET_BLOCK']) {
      specialTilePixels.set(-8, sprites['VIOLET_BLOCK'].animation[0].sprite);  // violet solid
      if (sprites['VIOLET_BLOCK'].animation[1])
        specialTilePixels.set(-9, sprites['VIOLET_BLOCK'].animation[1].sprite);  // violet ghost
    }
    if (sprites['PINK_BLOCK']) {
      specialTilePixels.set(-10, sprites['PINK_BLOCK'].animation[0].sprite);  // pink solid
      if (sprites['PINK_BLOCK'].animation[1])
        specialTilePixels.set(-11, sprites['PINK_BLOCK'].animation[1].sprite);  // pink ghost
    }
    // Deko sprites: sentinels -100 to -117 for deko index 0..17
    const dekoKeys = ['DEKO_SPRITE','DEKO_SPRITE2','DEKO_SPRITE3','DEKO_SPRITE4',
      'DEKO_SPRITE5','DEKO_SPRITE6','DEKO_SPRITE7','DEKO_SPRITE8','DEKO_SPRITE9',
      'DEKO_SPRITE10','DEKO_SPRITE11','DEKO_SPRITE12','DEKO_SPRITE13','DEKO_SPRITE14',
      'DEKO_SPRITE15','DEKO_SPRITE16','DEKO_SPRITE17','DEKO_SPRITE18'];
    dekoKeys.forEach((key, i) => {
      if (sprites[key]) specialTilePixels.set(-100 - i, sprites[key].animation[0].sprite);
    });

    if (sprites['RED_BLUE_BLOCK_SWITCH']) {
      specialTilePixels.set(-6, sprites['RED_BLUE_BLOCK_SWITCH'].animation[0].sprite); // switch red frame
      if (sprites['RED_BLUE_BLOCK_SWITCH'].animation[1])
        specialTilePixels.set(-7, sprites['RED_BLUE_BLOCK_SWITCH'].animation[1].sprite); // switch blue frame
    }
    // Foreground tile sprite (sentinel -200)
    if (sprites['FOREGROUND_TILE'])
      specialTilePixels.set(-200, sprites['FOREGROUND_TILE'].animation[0].sprite);
    // Treadmill sprites: animation[0] = right, animation[1] = left (sentinel -202, -203)
    if (sprites['TREADMILL']) {
      specialTilePixels.set(-202, sprites['TREADMILL'].animation[0].sprite);
      if (sprites['TREADMILL'].animation[1])
        specialTilePixels.set(-203, sprites['TREADMILL'].animation[1].sprite);
    }
    // Disappearing foreground tile sprite (sentinel -201)
    if (sprites['DISAPPEARING_FOREGROUND_TILE'])
      specialTilePixels.set(-201, sprites['DISAPPEARING_FOREGROUND_TILE'].animation[0].sprite);

    // Encode each unique tile.

    // Add red/blue block tiles if any level uses them (levelObjects contain redBlock/blueBlock/redBlueSwitch)
    const hasRedBlue = levels.some(l => l.levelObjects && l.levelObjects.some(
        o => ['redBlock','blueBlock','redBlueSwitch','redblueblockswitch','violetBlock','pinkBlock'].includes(o.type)));
    // Add used deko sentinels (unconditional — deko has nothing to do with red/blue)
    for (let di = 0; di < 18; di++) {
      const dk = -100 - di;
      const usedInLevel = levels.some(l => l.deko && l.deko.some(d => d.index === di));
      if (usedInLevel && !tileCache.has(dk) && specialTilePixels.has(dk)) {
        tileCache.set(dk, null);
        tileOrder.push(dk);
      }
    }

    if (hasRedBlue) {
      [-2, -3, -4, -5, -6, -7, -8, -9, -10, -11].forEach(k => {
        if (!tileCache.has(k) && specialTilePixels.has(k)) {
          tileCache.set(k, null);
          tileOrder.push(k);
        }
      });
    }

    // Add treadmill tiles (900=right, 901=left stored in tileData) if any level uses them
    const hasTreadmillRight = levels.some(l => l.tileData &&
      l.tileData.some(row => row.some(v => v === 900)));
    if (hasTreadmillRight && !tileCache.has(-202) && specialTilePixels.has(-202)) {
      tileCache.set(-202, null);
      tileOrder.push(-202);
    }
    const hasTreadmillLeft = levels.some(l => l.tileData &&
      l.tileData.some(row => row.some(v => v === 901)));
    if (hasTreadmillLeft && !tileCache.has(-203) && specialTilePixels.has(-203)) {
      tileCache.set(-203, null);
      tileOrder.push(-203);
    }

    // Add foreground tile sprite if any level uses foregroundTile objects
    const hasFgTile = levels.some(l => l.levelObjects &&
      l.levelObjects.some(o => o.type === 'foregroundTile'));
    if (hasFgTile && !tileCache.has(-200) && specialTilePixels.has(-200)) {
      tileCache.set(-200, null);
      tileOrder.push(-200);
    }
    // Add disappearing foreground tile sprite if any level uses it
    const hasFgDisp = levels.some(l => l.levelObjects &&
      l.levelObjects.some(o => o.type === 'disappearingForegroundTile'));
    if (hasFgDisp && !tileCache.has(-201) && specialTilePixels.has(-201)) {
      tileCache.set(-201, null);
      tileOrder.push(-201);
    }

    // Add TILE_edge as an extra tile (sentinel key -1).

    // Add TILE_edge as an extra tile (sentinel key -1).
    // pocket-platformer renders TILE_edge for any tile with value 1 or 2
    // that sits on the outermost row/column of a level. We do the same in the SMS export.
    const edgeSpriteObj = sprites['TILE_edge'];
    const edgePixels = edgeSpriteObj
      ? edgeSpriteObj.animation[0].sprite
      : Array(8).fill(null).map(() => Array(8).fill('524f52'));
    tileCache.set(-1, encodeTile4bpp(edgePixels, palette));
    tileOrder.push(-1);

        // specialTilePixels takes priority — these are tiles whose tileData value
    // doesn't match their SpritePixelArrays property key (e.g. value 10 =
    // connected disappearing block, but TILE_10 is "Right bottom").
    for (const tileIdx of tileOrder) {
      if (specialTilePixels.has(tileIdx)) {
        tileCache.set(tileIdx, encodeTile4bpp(specialTilePixels.get(tileIdx), palette));
      } else {
        const spriteObj = tileNameMap.get(tileIdx);
        if (spriteObj) {
          const frame = spriteObj.animation[0];
          tileCache.set(tileIdx, encodeTile4bpp(frame.sprite, palette));
        } else {
          // Solid colour fallback for unknown tile values
          const fallback = Array(8).fill(null).map(() => Array(8).fill('888888'));
          tileCache.set(tileIdx, encodeTile4bpp(fallback, palette));
        }
      }
    }

    const tileCount = tileOrder.length;
    const encoded = new Uint8Array(tileCount * BYTES_PER_TILE);
    const indexMap = new Map();
    let vramIdx = 1;
    let offset = 0;
    for (const tileIdx of tileOrder) {
      encoded.set(tileCache.get(tileIdx), offset);
      indexMap.set(tileIdx, vramIdx);
      offset += BYTES_PER_TILE;
      vramIdx++;
    }
    const edgeVramIdx = indexMap.get(-1);

    return { encoded, tileCount, indexMap, edgeVramIdx };
  }

  // ─── Level serialiser ─────────────────────────────────────────────────────────
  // Returns Uint8Array for one level in columnar format
  function encodeLevel(level, indexMap, edgeVramIdx) {
    const tileData = level.tileData;
    const mapH = tileData.length;
    const mapW = tileData[0].length;

    // Replicate pocket-platformer's edge-tile logic: tiles with value 1 or 2
    // on the outermost row/column are drawn as TILE_edge in the editor.
    const isEdgePos = (x, y) =>
      x === 0 || y === 0 || x === mapW - 1 || y === mapH - 1;

    // Deko: purely decorative tiles stored in level.deko[] as {x, y, index}
    // They override the BG tile at their position in the nametable.
    const dekoPos = new Map(); // key: "x,y" → deko sentinel key
    if (level.deko) {
      for (const d of level.deko) {
        const dk = -100 - (d.index || 0);
        if (indexMap.has(dk)) dekoPos.set(`${d.x},${d.y}`, dk);
      }
    }

    // Connected disappearing blocks: resetObject() overwrites their tileData value
    // from 10 → 11 at runtime. Recover identity from levelObjects.
    const connectedPos = new Set();
    // Red/blue blocks: tileData=12 for active, 0 for inactive. Both use same value.
    // Recover per-tile identity from levelObjects.
    const redBlockPos   = new Set();
    const blueBlockPos  = new Set();
    const switchPos     = new Set();
    const violetPos     = new Set();
    const pinkPos       = new Set();
    const fgPos         = new Set();  // foreground tiles (priority bit)
    const fgDispPos     = new Set();  // disappearing foreground tiles (priority bit)
    if (level.levelObjects) {
      for (const obj of level.levelObjects) {
        if (obj.type === 'connectedDisappearingBlock') connectedPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'redBlock')       redBlockPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'blueBlock')      blueBlockPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'violetBlock')    violetPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'pinkBlock')      pinkPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'redBlueSwitch' || obj.type === 'redblueblockswitch')  switchPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'foregroundTile') fgPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'disappearingForegroundTile') fgDispPos.add(`${obj.x},${obj.y}`);
      }
    }

    // Collect valid objects
    const objects = [];
    if (level.levelObjects) {
      for (const obj of level.levelObjects) {
        let typeId = OBJECT_TYPE_MAP[obj.type];
        if (typeId === undefined) continue;
        // FinishFlag with collectiblesNeeded → locked type 12
        if (obj.type === 'finishFlag' && obj.extraAttributes?.collectiblesNeeded) typeId = 12;
        objects.push({
          x: clampByte(obj.x),
          y: clampByte(obj.y),
          type: typeId,
        });
      }
    }

    // Limit to 255 objects per level
    const objCount = Math.min(objects.length, 255);
    const mapBytes = mapW * mapH;
    const total = 4 + mapBytes + objCount * 3;
    const buf = new Uint8Array(total);
    let off = 0;

    // Header
    buf[off++] = clampByte(mapW);
    buf[off++] = clampByte(mapH);
    buf[off++] = clampByte(objCount);
    buf[off++] = 0; // reserved

    // Columnar tile data: [x][y]
    for (let x = 0; x < mapW; x++) {
      for (let y = 0; y < mapH; y++) {
        const tileVal = tileData[y][x];
        // Deko overrides everything at its position (purely visual)
        if (dekoPos.has(`${x},${y}`)) {
          // Deko tiles are drawn as BG tiles (always passable)
          buf[off++] = clampByte(indexMap.get(dekoPos.get(`${x},${y}`)) || 0);
        } else if (fgDispPos.has(`${x},${y}`)) {
          // Disappearing foreground tile: fg_disp sprite with priority flag (bit 7)
          const fgDispVramIdx = indexMap.has(-201) ? clampByte(indexMap.get(-201)) : 0;
          buf[off++] = fgDispVramIdx ? (fgDispVramIdx | 0x80) : 0x80;
        } else if (fgPos.has(`${x},${y}`)) {
          // Foreground tile: always show the FOREGROUND_TILE sprite with priority flag (bit 7)
          // The underlying tile is ignored visually; collision skips priority tiles in C.
          const fgVramIdx = indexMap.has(-200) ? clampByte(indexMap.get(-200)) : 0;
          buf[off++] = fgVramIdx ? (fgVramIdx | 0x80) : 0x80;
        } else if (redBlockPos.has(`${x},${y}`)) {
          buf[off++] = clampByte(indexMap.get(-2) || 0);
        } else if (blueBlockPos.has(`${x},${y}`)) {
          buf[off++] = clampByte(indexMap.get(-5) || 0);
        } else if (violetPos.has(`${x},${y}`)) {
          // Violet starts PASSABLE → ghost tile
          buf[off++] = clampByte(indexMap.get(-9) || 0);
        } else if (pinkPos.has(`${x},${y}`)) {
          // Pink starts SOLID
          buf[off++] = clampByte(indexMap.get(-10) || 0);
        } else if (switchPos.has(`${x},${y}`)) {
          buf[off++] = clampByte(indexMap.get(-6) || 0);
        } else if (tileVal === 0) {
          buf[off++] = 0;
        } else if ((tileVal === 1 || tileVal === 2) && isEdgePos(x, y)) {
          buf[off++] = clampByte(edgeVramIdx || 0);
        } else if (tileVal === 11 && connectedPos.has(`${x},${y}`)) {
          buf[off++] = clampByte(indexMap.get(10) || indexMap.get(tileVal) || 0);
        } else if (tileVal === 900) {
          // Treadmill right
          buf[off++] = clampByte(indexMap.get(-202) || 0);
        } else if (tileVal === 901) {
          // Treadmill left
          buf[off++] = clampByte(indexMap.get(-203) || 0);
        } else {
          buf[off++] = clampByte(indexMap.get(tileVal) || 0);
        }
      }
    }

    // Objects
    for (let i = 0; i < objCount; i++) {
      buf[off++] = objects[i].x;
      buf[off++] = objects[i].y;
      buf[off++] = objects[i].type;
    }

    return buf;
  }

  // ─── Physics config encoder ───────────────────────────────────────────────────
  // Returns 17-byte buffer matching physics_config in C (int16 fixed-point)
  // Layout: 6×int16 + uint8 + int16 + uint8 + uint8 = 17 bytes
  function encodePhysics(playerObj) {
    const buf = new Uint8Array(17);
    const view = new DataView(buf.buffer);
    let off = 0;

    function writeInt16(v) {
      view.setInt16(off, clamp(Math.round(v), -32768, 32767), true);
      off += 2;
    }
    function writeUint8(v) {
      view.setUint8(off, clampByte(v));
      off += 1;
    }

    // Scale factor: JS tileSize=24px, SMS tileSize=8px → all velocities ÷ 3
    // Gravity in the C engine is also scaled accordingly (FP(0.5/3)).
    // Dimensionless values (friction) are unchanged.
    const PHYS_SCALE = 8 / 24;
    const s = (v, def) => (v || def) * PHYS_SCALE;
    writeInt16(toFP(s(playerObj.maxSpeed,          3.2)));
    writeInt16(toFP(s(playerObj.groundAcceleration, 0.8)));
    writeInt16(toFP(playerObj.groundFriction    || 0.65));  // dimensionless
    writeInt16(toFP(s(playerObj.air_acceleration,  0.8)));
    writeInt16(toFP(playerObj.air_friction      || 0.75));  // dimensionless
    // Jump speed per-frame factor (ramp formula: vy = -(maxJumpFrames-frame)*jumpSpeed)
    // Store raw jumpSpeed so C can compute each frame's velocity correctly.
    writeInt16(toFP(s(playerObj.jumpSpeed, 0.44)));
    writeUint8(playerObj.maxJumpFrames          || 18);
    // maxFallSpeed: scale then cap to 7px/frame (tunneling prevention)
    writeInt16(toFP(Math.min(s(playerObj.maxFallSpeed, 16), 7)));
    writeUint8(playerObj.doubleJumpChecked      ? 1 : 0);
    writeUint8(playerObj.wallJumpChecked        ? 1 : 0);

    return buf;
  }

  // ─── Resource blob builder ────────────────────────────────────────────────────
  function buildResourceBlob(gameData) {
    const { levels, playerObject, sprites } = gameData;

    if (!levels || levels.length === 0) throw new Error('No levels found');

    // 1. Collect all pixel rows for palette building
    const allRows = [];
    function collectRows(spriteObj) {
      if (!spriteObj || !spriteObj.animation) return;
      for (const frame of spriteObj.animation) {
        if (frame.sprite) for (const row of frame.sprite) allRows.push(row);
      }
    }
    for (const key of Object.keys(sprites)) collectRows(sprites[key]);

    // 2. Build palette
    const palette = buildPalette(allRows);

    // 3. Build BG tileset
    const { encoded: bgTiles, tileCount, indexMap, edgeVramIdx } = buildBgTileset(levels, sprites, palette);

    // 4. Build sprite sheet
    const spriteSheet = buildSpriteSheet(sprites, palette);

    // 5. Encode each level
    const encodedLevels = levels.map(l => encodeLevel(l, indexMap, edgeVramIdx));

    // 6. Encode physics
    const physicsBytes = encodePhysics(playerObject || {});

    // 7. Build header
    const header = new Uint8Array(40);
    header[0] = 0x50; // 'P'
    header[1] = 0x50; // 'P'
    header[2] = 0x4C; // 'L'
    header[3] = 0x54; // 'T'
    header[4] = Math.min(levels.length, 255);
    header[5] = Math.min(tileCount, 255);
    // one_way_vram_idx: VRAM index of tile value 5 (one-way block), or 0 if absent
    header[6] = indexMap.has(5) ? Math.min(indexMap.get(5), 255) : 0;
    // disp_vram_idx: VRAM index of tile value 11 (disappearing block), or 0 if absent
    header[7] = indexMap.has(11) ? Math.min(indexMap.get(11), 255) : 0;
    // conn_vram_idx: VRAM index of tile value 10 (connected disappearing block), or 0 if absent
    header[8] = indexMap.has(10) ? Math.min(indexMap.get(10), 255) : 0;
    // red/blue block VRAM indices (0 if not present in this level)
    header[9]  = indexMap.has(-2) ? Math.min(indexMap.get(-2), 255) : 0; // red solid
    header[10] = indexMap.has(-3) ? Math.min(indexMap.get(-3), 255) : 0; // red ghost
    header[11] = indexMap.has(-4) ? Math.min(indexMap.get(-4), 255) : 0; // blue solid
    header[12] = indexMap.has(-5) ? Math.min(indexMap.get(-5), 255) : 0; // blue ghost
    header[13] = indexMap.has(-6) ? Math.min(indexMap.get(-6), 255) : 0; // switch red frame
    header[14] = indexMap.has(-7)  ? Math.min(indexMap.get(-7),  255) : 0; // switch blue frame
    header[15] = indexMap.has(-8)  ? Math.min(indexMap.get(-8),  255) : 0; // violet solid
    header[16] = indexMap.has(-9)  ? Math.min(indexMap.get(-9),  255) : 0; // violet ghost
    header[17] = indexMap.has(-10) ? Math.min(indexMap.get(-10), 255) : 0; // pink solid
    header[18] = indexMap.has(-11) ? Math.min(indexMap.get(-11), 255) : 0; // pink ghost
    // deko_vram_idx[18]: VRAM tile index for each deko sprite (0=not used)
    for (let di = 0; di < 18; di++) {
      const dk = -100 - di;
      header[19 + di] = indexMap.has(dk) ? Math.min(indexMap.get(dk), 255) : 0;
    }
    // fg_disp_vram_idx: disappearing foreground tile (0=not used)
    header[37] = indexMap.has(-201) ? Math.min(indexMap.get(-201), 255) : 0;
    // fg_disp is byte 37; treadmill bytes 38, 39
    header[38] = indexMap.has(-202) ? Math.min(indexMap.get(-202), 255) : 0; // treadmill right
    header[39] = indexMap.has(-203) ? Math.min(indexMap.get(-203), 255) : 0; // treadmill left

    // 8. Assemble everything
    const parts = [header, physicsBytes, new Uint8Array(palette), bgTiles, spriteSheet, ...encodedLevels];
    let totalSize = 0;
    for (const p of parts) totalSize += p.length;

    const blob = new Uint8Array(totalSize);
    let offset = 0;
    for (const p of parts) {
      blob.set(p, offset);
      offset += p.length;
    }

    return blob;
  }

  // ─── Base64 → Uint8Array ──────────────────────────────────────────────────────
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ─── ROM assembler ────────────────────────────────────────────────────────────
  // Appends resource blob after the 32KB base ROM.
  function assembleRom(baseRomBytes, resourceBlob) {
    const rom = new Uint8Array(baseRomBytes.length + resourceBlob.length);
    rom.set(baseRomBytes, 0);
    rom.set(resourceBlob, baseRomBytes.length);
    return rom;
  }

  // ─── Download helper ──────────────────────────────────────────────────────────
  function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ─── Public API ───────────────────────────────────────────────────────────────
  function exportSmsRom() {
    try {
      // Gather game data from pocket-platformer globals
      const gameData = {
        levels: WorldDataHandler.levels,
        playerObject: (() => {
          // Build playerObject from global `player` instance
          const p = {};
          ['maxSpeed', 'groundAcceleration', 'air_acceleration', 'groundFriction',
           'air_friction', 'jumpSpeed', 'maxJumpFrames', 'maxFallSpeed'].forEach(k => {
            p[k] = player[k];
          });
          ['jumpChecked', 'doubleJumpChecked', 'wallJumpChecked', 'dashChecked'].forEach(k => {
            p[k] = player[k];
          });
          return p;
        })(),
        sprites: (() => {
          // Build sprites map from SpritePixelArrays
          const out = {};
          Object.keys(SpritePixelArrays).forEach(key => {
            if (SpritePixelArrays[key] && SpritePixelArrays[key].descriptiveName) {
              out[key] = SpritePixelArrays[key];
            }
          });
          return out;
        })(),
      };

      // Filter out pocket-platformer's default empty wrapper levels.
      // The editor initialises with [empty, userLevel, empty]. A level is considered
      // "empty" if all its solid tiles use only value 1 (border tile) with no objects.
      // We keep a level if it has any interior tile (value != 1) OR any level objects.
      const isEmptyBorderLevel = (lvl) => {
        if (!lvl || !lvl.tileData) return true;
        if (lvl.levelObjects && lvl.levelObjects.length > 0) return false;
        for (const row of lvl.tileData)
          for (const v of row)
            if (v !== 0 && v !== 1) return false;
        return true;
      };

      const filteredLevels = gameData.levels.filter(lvl => !isEmptyBorderLevel(lvl));
      if (filteredLevels.length === 0) {
        throw new Error('No non-empty levels found. Please design at least one level before exporting.');
      }
      gameData.levels = filteredLevels;

      console.log(`[SmsExporter] Exporting ${filteredLevels.length} level(s)`);
      // Debug: check connected disappearing block handling
      {
        const hasCDB = filteredLevels.some(l => l.levelObjects?.some(o => o.type === 'connectedDisappearingBlock'));
        const cdbSprite = !!sprites['CONNECTED_DISAPPEARING_BLOCK_SPRITE'];
        console.log(`[SmsExporter] connectedDisappearingBlock in levels: ${hasCDB}, sprite found: ${cdbSprite}`);
        if (hasCDB) {
          filteredLevels.forEach((l,i) => {
            const cdbObjs = l.levelObjects?.filter(o => o.type === 'connectedDisappearingBlock') || [];
            if (cdbObjs.length) console.log(`[SmsExporter] Level ${i}: ${cdbObjs.length} connected disappearing blocks, e.g. tile(${cdbObjs[0].x},${cdbObjs[0].y})`);
          });
        }
      }
      const resourceBlob = buildResourceBlob(gameData);
      console.log(`[SmsExporter] conn_vram_idx=${resourceBlob[8]}, disp_vram_idx=${resourceBlob[7]}, num_tiles=${resourceBlob[5]}`);
      const baseRomBytes = b64ToBytes(SmsExporter.BASE_ROM_B64);
      const finalRom = assembleRom(baseRomBytes, resourceBlob);

      const gameName = (WorldDataHandler.gamesName || 'game')
        .replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
      downloadBytes(finalRom, `${gameName}.sms`);

      console.log(`[SmsExporter] ROM generated: ${finalRom.length} bytes ` +
        `(base: ${baseRomBytes.length}, resource: ${resourceBlob.length})`);
    } catch (err) {
      alert('SMS Export failed: ' + err.message);
      console.error('[SmsExporter]', err);
    }
  }

  return { exportSmsRom, buildResourceBlob, rgbHexToSms, encodeTile4bpp };
})();


// Pre-compiled SMS base ROM (pocket_platformer.sms)
// Built with SDCC + devkitSMS. Contains engine code only; game data is appended at runtime.
// To rebuild: cd sms-engine && make && make update-js
SmsExporter.BASE_ROM_B64 =
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDGE4h" +
  "AMB+BgBwEQHAAWkD7bAynsLNGlLNbkz7zSlGdhj9ZGV2a2l0U01TAAAAw1dO7aPto+2j7aPto+2j7aPt" +
  "o+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPt" +
  "o+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPt" +
  "o+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPt" +
  "o+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPt" +
  "o8kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgYGBgYABgAbGxsAAAAAAA2Nn82" +
  "fzY2AAw/aD4LfhgAYGYMGDBmBgA4bGw4bWY7ABgYGAAAAAAADBgwMDAYDAAwGAwMDBgwAAAYfjx+GAAA" +
  "ABgYfhgYAAAAAAAAABgYMAAAAH4AAAAAAAAAAAAYGAAABgwYMGAAADxmbn52ZjwAGDgYGBgYfgA8ZgYM" +
  "GDB+ADxmBhwGZjwADBw8bH4MDAB+YHwGBmY8ABwwYHxmZjwAfgYMGDAwMAA8ZmY8ZmY8ADxmZj4GDDgA" +
  "AAAYGAAYGAAAABgYABgYMAwYMGAwGAwAAAB+AH4AAAAwGAwGDBgwADxmDBgYABgAPGZuam5gPAA8ZmZ+" +
  "ZmZmAHxmZnxmZnwAPGZgYGBmPAB4bGZmZmx4AH5gYHxgYH4AfmBgfGBgYAA8ZmBuZmY8AGZmZn5mZmYA" +
  "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" +
  "3XPu3XfvB5/dd/Ddd/EhMMBee7coG91u+N1m+SMjViN+3XL63Xf7B5/dd/zdd/0YHt1u+N1m+cUBBgAJ" +
  "wX4jZt13+nzdd/sHn913/N13/d1++t138t1++913891+/N139N1+/d139Xu3KB7dXvjdVvkhBAAZXiNW" +
  "3XP6et13+wef3Xf83Xf9GBvdXvjdVvkhCAAZXiN+3XP63Xf7B5/dd/zdd/3FESjAIQoAOesBBADtsMHd" +
  "y/5Wysge3X723Zby3Xf63X733Z7z3Xf73X743Z703Xf83X753Z713Xf9xREowCEOADkBBADtsMGv3Zbu" +
  "3Xf2PgDdnu/dd/c+AN2e8N13+J/dlvHdd/ndfvrdlvbdfvvdnvfdfvzdnvjdfv3dnvnirx7ugPLAHsUR" +
  "KMAhCgA5AQQA7bDBITfANgHDux/dy/5eKGjdfvbdhvLdd/rdfvfdjvPdd/vdfvjdjvTdd/zdfvndjvXd" +
  "d/3FESjAIQ4AOQEEAO2wwd1+7t2W+t1+792e+91+8N2e/N1+8d2e/eIdH+6A8i4fxREowCECADkBBADt" +
  "sMEhN8A2AMO7H8XdbvzdZv3l3W763Wb75d1e9t1W991u+N1m+c0jUfHxwT4IyyzLHcsayxs9IPXdc/rd" +
  "cvvddfzddP3FESjAIQ4AOQEEAO2wwe1bKMAqKsA+gN2++j7/3Z77Pv/dnvw+/92e/eKeH+6A8rsfe9aA" +
  "et4Afd4AfBc/H96AMAkhAAAiKMAiKsDtWyDAKiLAPgjLLMsdyxrLGz0g9XvG/9137nrO/913733O/913" +
  "8HzO/9138XvGB9139nrOAN13933OAN13+HzOAN13+d1+8QfmAd138t3L8kYgVd1+7t13+t1+7913+91+" +
  "8N13/N1+8d13/d1+8rcoIN1+7sYH3Xf63X7vzgDdd/vdfvDOAN13/N1+8c4A3Xf9PgPdy/0u3cv8Ht3L" +
  "+x7dy/oePSDtGA7dNvr/r913+913/N13/d1++t13891e9t1W993L+X4oDN1+9sYHX91+984AV8s6yxvL" +
  "OssbyzrLG91z9O1bJMAqJsA+CMssyx3LGssbPSD13XP13XL23XX33XT43V713Vb23X71xgfdd/ndfvbO" +
  "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" +
  "K91+8t13++1LIMDtWyLAPgjLKssbyxjLGT0g9d1x991w+N1z+d1y+st6KBh5xgfdd/d4zgDdd/h7zgDd" +
  "d/l6zgDdd/rdTvfdRvjLOMsZyzjLGcs4yxndbvt5zfgL3Xf23X773Xf37UsgwO1bIsA+CMsqyxvLGMsZ" +
  "PSD13XH43XD53XP63XL7y3ooGHnGB913+HjOAN13+XvOAN13+nrOAN13+91O+N1G+cs4yxnLOMsZyzjL" +
  "GQzdbvd5zfgLT/0qFMD9RgbdfvaQKAd5kCgDrxgCPgG3KEftSyTAKibA3XH4eMYI3Xf5fc4A3Xf6fM4A" +
  "3Xf73Vby3W7z3Wb0HgAGA8si7WoQ+nvdlvh63Z75fd2e+nzdnvviwyvugPpXMN1+8t1e891u9N1m9QYD" +
  "h8sT7WoQ+cb4T3vO/0d9zv9ffM7/3XH93XD+3XP/3Tb8ACEAACIswCIuwCEwwDYBITHANgAhMsA2ACEz" +
  "wDYAITjANgDDVzDdbv7dZv/l3W783Wb95d1e9N1W9d1u9t1m982ADrcgI+1bIMAqIsB6xgRXMAEj3U7+" +
  "3Ub/xd1O/N1G/cXNgA63ylcw3W7w3Wbx3V7y3Vbz3cvzfigY3X7wxgdv3X7xzgBn3X7yzgBf3X7zzgBX" +
  "BgPLKssbyxzLHRD2fcYB3XfjfM4A3Xfke84A3Xfles4A3XfmOvvBt8ITMCoUwBENABl+t8oTMO1LIMDt" +
  "WyLAPgjLKssbyxjLGT0g9d1x/N1w/d1z/t1y/8t6KBh5xgfdd/x4zgDdd/17zgDdd/56zgDdd//dbvzd" +
  "Zv3LPMsdyzzLHcs8yx1lecYG3Xf0eM4A3Xf1e84A3Xf2es4A3Xf33X703Xf83X713Xf93X723Xf+3X73" +
  "3Xf/3cv3figYecYN3Xf8eM4A3Xf9e84A3Xf+es4A3Xf/3U783Ub9yzjLGcs4yxnLOMsZ3X7jPUfFaHzN" +
  "+AvB3Xf/aHnN+AtP/SoUwP3l0SENABle3X7/kygR/UYO3X7/kCgIebsoBJDCEzA6+sHWAT4AFzL6wc32" +
  "NioUwN11/t10/zr6wbcoDd1O/t1G/yENAAlOGAvdbv7dZv8RDgAZTkF5tygFSAYAGAMBAAAeACH5wXuW" +
  "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" +
  "Z9353eHJAAMAAAAAAAQgCAgBAQwAeLEoCBFqwyEOUu2wyQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABHZW5lcmF0" +
  "ZWQgYnkgcG9ja2V0LXBsYXRmb3JtZXItdG8tc21zIHdlYiBleHBvcnRlci4AUG9ja2V0IFBsYXRmb3Jt" +
  "ZXIgU01TIEVuZ2luZQBwb2NrZXQtcGxhdGZvcm1lci1zbXMAU0RTQwEDAQElIMp/rX95f1RNUiBTRUdB" +
  "//82p5mZAEw=";
