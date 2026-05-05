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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDhE4h" +
  "AMB+BgBwEQHAAWkD7bAynsLNhVLN2kz7zZVGdhj9ZGV2a2l0U01TAAAAw8NO7aPto+2j7aPto+2j7aPt" +
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
  "AAnBfiNm3Xf6fN13+wef3Xf83Xf93X763Xfy3X773Xfz3X783Xf03X793Xf1e7coHt1e+N1W+SEEABle" +
  "I1bdc/p63Xf7B5/dd/zdd/0YG91e+N1W+SEIABleI37dc/rdd/sHn913/N13/cURKMAhCgA56wEEAO2w" +
  "wd3L/lbKjh7dfvbdlvLdd/rdfvfdnvPdd/vdfvjdnvTdd/zdfvndnvXdd/3FESjAIQ4AOQEEAO2wwa/d" +
  "lu7dd/Y+AN2e79139z4A3Z7w3Xf4n92W8d13+d1++t2W9t1++92e991+/N2e+N1+/d2e+eJ1Hu6A8oYe" +
  "xREowCEKADkBBADtsMEhN8A2AcOBH93L/l4oaN1+9t2G8t13+t1+992O8913+91++N2O9N13/N1++d2O" +
  "9d13/cURKMAhDgA5AQQA7bDB3X7u3Zb63X7v3Z773X7w3Z783X7x3Z794uMe7oDy9B7FESjAIQIAOQEE" +
  "AO2wwSE3wDYAw4Efxd1u/N1m/eXdbvrdZvvl3V723Vb33W743Wb5zY9R8fHBPgjLLMsdyxrLGz0g9d1z" +
  "+t1y+911/N10/cURKMAhDgA5AQQA7bDB7VsowCoqwD6A3b76Pv/dnvs+/92e/D7/3Z794mQf7oDygR97" +
  "1oB63gB93gB8Fz8f3oAwCSEAACIowCIqwO1bIMAqIsA+CMssyx3LGssbPSD1e8b/3Xfues7/3Xfvfc7/" +
  "3XfwfM7/3Xfxe8YH3Xf2es4A3Xf3fc4A3Xf4fM4A3Xf53X7xB+YB3Xfy3cvyRiBV3X7u3Xf63X7v3Xf7" +
  "3X7w3Xf83X7x3Xf93X7ytygg3X7uxgfdd/rdfu/OAN13+91+8M4A3Xf83X7xzgDdd/0+A93L/S7dy/we" +
  "3cv7Ht3L+h49IO0YDt02+v+v3Xf73Xf83Xf93X763Xfz3V723Vb33cv5figM3X72xgdf3X73zgBXyzrL" +
  "G8s6yxvLOssb3XP07VskwComwD4IyyzLHcsayxs9IPXdc/XdcvbddffddPjdXvXdVvbdfvXGB913+d1+" +
  "9s4A3Xf63X73zgDdd/vdfvjOAN13/N3L+H4oBt1e+d1W+ss6yxvLOssbyzrLG91z/d1e+d1W+t3L/H4o" +
  "DN1+9cYOX91+9s4AV8s6yxvLOssbyzrLG91z/N3L8kbCiSHF3W793X7zzfgLwbcoPSoUwBEGABl+tygW" +
  "xd1u/d1+8834C8EqFMARBgAZXpMoHMXdbv3dfvPNHTbBtyAOxd1u/d1+882AM8G3KE7F3W783X7zzfgL" +
  "wbcoPSoUwBEGABl+tygWxd1u/N1+8834C8EqFMARBgAZXpMoHMXdbvzdfvPNHTbBtyAOxd1u/N1+882A" +
  "M8G3KAOvGAI+Ad13+8Xdbv3dfvTN+AvBtyg9KhTAEQYAGX63KBbF3W793X70zfgLwSoUwBEGABlekygc" +
  "xd1u/d1+9M0dNsG3IA7F3W793X70zYAzwbcoTsXdbvzdfvTN+AvBtyg9KhTAEQYAGX63KBbF3W783X70" +
  "zfgLwSoUwBEGABlekygcxd1u/N1+9M0dNsG3IA7F3W783X70zYAzwbcoA68YAj4B3Xf6y2HKCCMhMMBO" +
  "ebcoJiEywDYBITPANgAhNsA2ACExwDYAITDANgA6VsG3yggjzdIzwwgjKhbA3XX83XT9ERAAGX63KF55" +
  "tyBa3X77tyAG3X76tyhOITLANgAhM8A2ASE2wDYAITHANgAhOMA2AN1++7coCt02/AHdNv0AGAjdNvz/" +
  "3Tb9AN1+/N13/SE0wN1+/XchNcA2ADpWwbcoPM3SMxg33W783Wb9EQ8AGX7dd/23KCY6OMDdd/23IB0h" +
  "MsA2ASEzwDYAITbANgAhOMA2ATpWwbcoA83SMyEywE7dfv7mEN13+t02+wB5t8ohJBE8wCEIADnrAQQA" +
  "7bCv3b723Z73PgDdnvg+AN2e+eJAI+6AB+YB3Xf93X773bb6IAfdfv23yv4j3X79tyAqKhbA3XX83XT9" +
  "EQoAGX7dd/wjft13/d1+/N139t1+/d139wef3Xf43Xf53U723Ub3/eXj3W744+PdZvnj/eE6NsA83Xf9" +
  "ITbA3X79dyoWwBEMABluJgDdXv0WAL/tUut6B+1i/eXFzY9R8fGvk08+AJpHPgCdX5+UV+1DLMDtUy7A" +
  "KhbAEQwAGd1+/ZY4OCEywDYAITHANgEhAAAiPMAiPsAYI91++d22+N2299229iAVITLANgAqFsARDAAZ" +
  "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" +
  "+N13591++d136N1++t136d1++9136t1++MYI3Xfr3X75zgDdd+zdfvrOAN137d1++84A3XfuecYG3Xfv" +
  "eM4A3Xfwe84A3Xfxes4A3Xfy3Tb/ACH4wd1+/5bSuy/V3V7/FgBrYikZ0f0hWMHFTUT9CcH9fgDdd/uv" +
  "3Xf83Xf93Xf+9d1++913891+/N139N1+/d139d1+/t139vE+A93L8ybdy/QW3cv1Ft3L9hY9IO395eEj" +
  "ft13+6/dd/zdd/3dd/713X773Xf33X783Xf43X793Xf53X7+3Xf68T4D3cv3Jt3L+Bbdy/kW3cv6Fj0g" +
  "7f1+ArcoBTr6wRgIOvrB1gE+ABe3yrUv3X7z3Zbv3X703Z7w3X713Z7x3X723Z7y4hUv7oDytS/dfvPG" +
  "CN13+91+9M4A3Xf83X71zgDdd/3dfvbOAN13/nndlvt43Z78e92e/Xrdnv7iTS/ugPK1L91+992W691+" +
  "+N2e7N1++d2e7d1++t2e7uJtL+6A8rUv3X73xgjdd/vdfvjOAN13/N1++c4A3Xf93X76zgDdd/7dfufd" +
  "lvvdfujdnvzdfundnv3dfurdnv7irS/ugPK1LyHFwDYB3TT/w0IuIfvBNgHdfuPdd/3dfuTdd/7dfuXd" +
  "d//dNvwABgPdy/0m3cv+Ft3L/xYQ8iEAACIswCIuwCEywDYAITPANgAqFsARDAAZfjI2wBEkwCEZADkB" +
  "BADtsN353eHJ3eXdIQAA3Tkh4v85+e1bIMAqIsAGCMssyx3LGssbEPYzM9XddeTddOXtWyTAKibABgjL" +
  "LMsdyxrLGxD23XPm3XLn3XXo3XTpKnDCIyN+/oAwCd13/t02/wAYCN02/oDdNv8A3U7+If//NgLdfubG" +
  "CN136t1+584A3Xfr3X7ozgDdd+zdfunOAN137d1+4sYG3Xfu3X7jzgDdd+/dfuTOAN138N1+5c4A3Xfx" +
  "HgB7kdJ7M9UWAGtiKRnRfVQhdMKGI0d6jlfdcPLdcvNoYm6vZ1cGAymPyxIQ+t119N109d139t1y991u" +
  "8t1m8yNur2dXBgMpj8sSEPrddfjddPndd/rdcvvdfvjdd/zdfvndd/3dfvrdd/7dfvvdd//dfvTdlu7d" +
  "fvXdnu/dfvbdnvDdfvfdnvHiTjHugPJ3M91+9MYIR91+9c4AV91+9s4Ab91+984AZ91+4pDdfuOa3X7k" +
  "nd1+5ZzifjHugPJ3M91+/N2W6t1+/d2e691+/t2e7N1+/92e7eKeMe6A8ncz3X78xghH3X79zgBX3X7+" +
  "zgBv3X7/zgBn3X7mkN1+55rdfuid3X7pnOLOMe6A8ncz3W7y3WbzIyN+/gIoFP4DKCv+BCgv/gXKazPW" +
  "DCgLw3czIcTANgHDdzPF1c3CFdHBt8J3MyHEwDYBw3czIcXANgHDdzMhLMBGI1YjI34rbst/wncz3X74" +
  "xgTdd/zdfvnOAN13/d1++s4A3Xf+3X77zgDdd/8hJMBGI1YjI34rbmfdcPTdcvXddfbddPcGCN3L9y7d" +
  "y/Ye3cv1Ht3L9B4Q7t1+9MYI3Xf43X71zgDdd/ndfvbOAN13+t1+984A3Xf73X78xgJH3X79zgBX3X7+" +
  "zgBv3X7/zgBneN2W+Hrdnvl93Z76fN2e++K+Mu6A+nczKhbAxQEKAAnBRiN+3XD43Xf5B5/dd/rdd/vd" +
  "bvjdZvndRvrdVvs+AinLEMsSPSD4xdX9IQAA/eX9IQ8A/eXraM2FUPHx1f3h0cH95d1+4P3h3Yb43Xf8" +
  "/eXdfuH94d2O+d13/X3djvrdd/583Y773Xf/1cURPMAhHgA5AQQA7bDB0SEywDYBITbANgAhMcA2ACEw" +
  "wDYAITjANgA6VsG3KBXF1c3SM9HBGAwhRMAWABl+tyACNgEcw8Iw3fnd4cnd5d0hAADdOfXdd//ddf4O" +
  "ACFWwXmWMDQRxsAGAGlgKQkZ6xpH3X7/kCAea2Ij3X7+liAVExMatygKOlfB1gE+ABcYCTpXwRgEDBjF" +
  "r9353eHJ3eXdIQAA3Tkh6/85+TpXwdYBPgAXMlfB3Tb/ACFWwd1+/5bSGDbdTv8GAGlgKQnddf3ddP4+" +
  "xt2G/d13+z7A3Y7+3Xf83W773Wb8ft13/d1++913+d1+/N13+t1u+d1m+iN+3Xf+3W773Wb8IyNOebco" +
  "BTpXwRgIOlfB1gE+ABfdd/oqFMDddfvddPx5tygh3X76tygN3U773Ub8IQ8ACUYYC91O+91G/CEQAAlG" +
  "eBge3X76tygN3U773Ub8IREACX4YC91u+91m/BESABl+tygEBgAYAq9HX1Ddbv4mACkpKSkp3X795h9P" +
  "BgAJKXz2eGfP69/dfvq3yhI27VsgwCoiwAYIyyzLHcsayxsQ9jMz1d117d107u1bJMAqJsAGCMssyx3L" +
  "GssbEPbdc+/dcvDddfHddPLdbv2vZ08GAymPyxEQ+t1189109N139d1x9t1u/q9nTwYDKY/LERD63XX3" +
  "3XT43Xf53XH63X7rxgZP3X7szgBH3X7tzgBf3X7uzgBX3X7zkd1+9JjdfvWb3X72muJqNe6A8hI23X7z" +
  "xgjdd/vdfvTOAN13/N1+9c4A3Xf93X72zgDdd/7dfuvdlvvdfuzdnvzdfu3dnv3dfu7dnv7iqjXugPIS" +
  "Nt1+78YIT91+8M4AR91+8c4AX91+8s4AV91+95HdfviY3X75m91++pri2jXugPISNt1+98YIT91++M4A" +
  "R91++c4AX91++s4AV91+75HdfvCY3X7xm91+8priCjbugPISNiHFwDYB3TT/w+4z3fnd4cnd5d0hAADd" +
  "OfXdd//ddf4OACH4wXmWMDQRWMEGAGlgKQkZ6xpH3X7/kCAea2Ij3X7+liAVExMatygKOvrB1gE+ABcY" +
  "CTr6wRgEDBjFr9353eHJ7VsUwLcoEn23KAchCQAZfhgXIQoAGX4YEH23KAchCwAZfhgFIQwAGX63KAQW" +
  "AF/JEQAAyd3l3SEAAN059d02/wAh+MHdfv+WMFHdTv8GAGlgKQnrIVjBGesaT2tiI37dd/4TExpHtygF" +
  "OvrBGAg6+sHWAT4AF2/FeM1vNsHdbv4mACkpKSkpeeYfBgBPCSl89nhnz+vf3TT/GKbd+d3hyTr7wbfI" +
  "7UsswCouwK+5mD4AnT4AnOIpN+6A8CH7wTYAyd3l3SEAAN05Iev/OfntWyDAKiLABgjLLMsdyxrLGxD2" +
  "3XP13XL23XX33XT4KiTA7VsmwAYIyyrLG8scyx0Q9t1O9d1G9v3l491u9+Pj3Wb44/3h3cv4figk3X71" +
  "xgdP3X72zgBH3X73zgD95d136f3h3X74zgD95d136v3hyzjLGcs4yxnLOMsZ3XH93X71xgXdd/ndfvbO" +
  "AN13+t1+984A3Xf73X74zgDdd/zdTvndRvr95ePdbvvj491m/OP94d3L/H4oJN1++cYHT91++s4AR91+" +
  "+84A/eXdd+n94d1+/M4A/eXdd+r94cs4yxnLOMsZyzjLGd1x/tX94U1Ey3ooHH3GB098zgBHe84A/eXd" +
  "d+n94XrOAP3l3Xfq/eHLOMsZyzjLGcs4yxndcf/FAQgACcEwARPV/eFNRMt6KBoBBwAJTUR7zgD95d13" +
  "6f3hes4A/eXdd+r94cs4yxnLOMsZyzjLGd1+/d13791x8N1+/t138d1x8t1+/d13891+/9139N02/wDd" +
  "bv8mAClNRCEEADkJft13+iN+3Xf7b91++s34C913/CoUwN11/d10/gEHAAlOebcoEd1+/JEgC91u+91+" +
  "+s1iDBhA3U793Ub+IQgACU55tygR3X78kSAL3W773X76zbMMGCDdTv3dRv4hJQAJfrcoEk/L+d1+/JEg" +
  "Cd1u+91++s2qDd00/91+/9YD2rc4/SoUwP1+Jd13/7fKTjsRIMAhEQA56wEEAO2w3X783Xfr3X793Xfs" +
  "3X7+3Xft3X7/3XfuBgjdy+4u3cvtHt3L7B7dy+seEO4hEQA56yEAADkBBADtsN3L7n4oIN1+68YH3Xf8" +
  "3X7szgDdd/3dfu3OAN13/t1+7s4A3Xf/3U783Ub93XH+3XD/3cv/Pt3L/h7dy/8+3cv+Ht3L/z7dy/4e" +
  "3X7+3Xf13X7rxgXdd/jdfuzOAN13+d1+7c4A3Xf63X7uzgDdd/shEQA56yENADkBBADtsN3L+34oIN1+" +
  "68YM3Xf83X7szgDdd/3dfu3OAN13/t1+7s4A3Xf/3X783Xf+3X793Xf/3cv/Pt3L/h7dy/8+3cv+Ht3L" +
  "/z7dy/4e3X7+3Xf2ESTAIREAOesBBADtsN1+/N13991+/d13+N1+/t13+d1+/913+gYI3cv6Lt3L+R7d" +
  "y/ge3cv3HhDuIQAAOeshDAA5AQQA7bDdfvfGB913+91++M4A3Xf83X75zgDdd/3dfvrOAN13/t3L+n4o" +
  "DiEAADnrIRAAOQEEAO2wwcXLOMsZyzjLGcs4yxndcf/dTvvdRvzdy/5+KAzdfvfGDk/dfvjOAEfLOMsZ" +
  "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" +
  "sMHRxdXNfybRwdXFIQoAOesBBADtsMHR3X773bb63bb53bb4IDfdfvQhbMOG3Xf83X71I47dd/3dfvYj" +
  "jt13/t1+9yOO3Xf/3bb+3bb93bb8KAqvEhMSExITEhgtIWzD3X74lt13/N1++SOe3Xf93X76I57dd/7d" +
  "fvsjnt13/8UhDAA5AQQA7bDBxc3VKM0VMM0PN81TO82PQM2aQM2RT81aFs1IF80oUM3CT8E6xcC3KAvF" +
  "3X7yzQFEwcNURDrEwLfKVEQePMXVzQtO0cEdIPbdXvIWABPdbvMmAHuVepzizUXugPLYRd1+8jxfBxgC" +
  "HgDdc/LF3X7yza9AwcNURM0LTiFAAc0sTSEAQOURAABlzUpPzV1PzXFPLj8+Ac3FTSEAAeUqasPlEWAB" +
  "IQACzcxOIUABzYVPIUABzRdNIQh6zyFbRs0XUCGGes8hbUbNF1AhiHvPIYRGzRdQzQtOzRhOe+YwKPXN" +
  "C07NGE575jAg9clQT0NLRVQgUExBVEZPUk1FUgBmb3IgU2VnYSBNYXN0ZXIgU3lzdGVtAFByZXNzIDEg" +
  "dG8gc3RhcnQALgDNYk0uAM14TS4AzVhNzehFzdoKtyj3zQALzQtOIUABzSxNIQBA5REAAGXNSk/NoBQh" +
  "QAHNF03NK0QY0nBvY2tldC1wbGF0Zm9ybWVyLXNtcwBQb2NrZXQgUGxhdGZvcm1lciBTTVMgRW5naW5l" +
  "AEdlbmVyYXRlZCBieSBwb2NrZXQtcGxhdGZvcm1lci10by1zbXMgd2ViIGV4cG9ydGVyLgA6dsK3yD6f" +
  "038+v9N/OovCtyAEPt/TfzqMwrcgBD7/038hdsI2AMk6dsK3wDqEwvaQ0386hcL2sNN/OovCtyAXOojC" +
  "5g/2wNN/OonC5j/TfzqGwvbQ0386jMK3IBA6isLmD/bg0386h8L28NN/IXbCNgHJzTlHIX7CNgHRwcXV" +
  "7UN3wu1DecLtQ3vCIX3CNgAhgcI2ACF/wjafIXbCNgHJIX7CNgDJweHlxeXNrEfxIX7CNgDJ/SF2wv1u" +
  "AMk+n9N/Pr/Tfz7f038+/9N/yd3l3SEAAN059f0hgML9fgDdd/6v3Xf//U4AOnbCtyhYOoTC5g9fFgDh" +
  "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" +
  "MAEZEPpNRN1e/N1mBcUuAFUGCCkwARkQ+sHr3XMF3XIGa2IJ691zBd1yBnuRepg+ABfddwfdXvzdZgQu" +
  "AFUGCCkwARkQ+uvdc/zdcv3dNgQA3X783YYEX91+/d2OBVfdfv7djgZv3X7/3Y4HZ9353eHJAAMAAAAA" +
  "BCAICAEBCwB4sSgIEWrDIXpS7bDJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//+ly5mZAEw=";
