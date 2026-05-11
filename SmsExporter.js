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
    encodeBlank(); /* spike is now a BG tile; keep slot 258 blank */
    trampS     ? encodeSprite8(trampS,     0) : encodeBlank();
    coinS      ? encodeSprite8(coinS,      0) : encodeBlank();
    pIdle      ? encodeSprite8(pIdle,      0) : encodeBlank();
    pWalk      ? encodeSprite8(pWalk,      0) : encodeBlank();
    pWalk      ? encodeSprite8(pWalk,      1) : encodeBlank();
    pJump      ? encodeSprite8(pJump,      0) : encodeBlank();
    flagClosed ? encodeSprite8(flagClosed, 0) : encodeBlank(); /* tile 265 */
    // NPC sprite = tile 266 (VRAM_SPR_NPC in C)
    const npcS = get('NPC_SPRITE');
    npcS ? encodeSprite8(npcS, 0) : encodeBlank();

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
        if (hasConnected && !tileCache.has(-205)) {
          tileCache.set(-205, null);
          tileOrder.push(-205);
        }
      }
    }

    // Special tile values that don't follow the TILE_N naming convention
    const specialTilePixels = new Map();
    if (sprites['DISAPPEARING_BLOCK_SPRITE'])
      specialTilePixels.set(11, sprites['DISAPPEARING_BLOCK_SPRITE'].animation[0].sprite);
    if (sprites['CONNECTED_DISAPPEARING_BLOCK_SPRITE'])
      specialTilePixels.set(-205, sprites['CONNECTED_DISAPPEARING_BLOCK_SPRITE'].animation[0].sprite);
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
    // Spike sprite as BG tile (sentinel -204)
    if (sprites['SPIKE_SPRITE'])
      specialTilePixels.set(-204, sprites['SPIKE_SPRITE'].animation[0].sprite);
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

    // Add spike BG tile if any level has spike objects
    const hasSpike = levels.some(l => l.levelObjects &&
      l.levelObjects.some(o => o.type === 'spike'));
    if (hasSpike && !tileCache.has(-204) && specialTilePixels.has(-204)) {
      tileCache.set(-204, null);
      tileOrder.push(-204);
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
    const spikePos      = new Set();  // spike positions (BG tile)
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
        if (obj.type === 'spike') spikePos.add(`${obj.x},${obj.y}`);
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
        } else if (spikePos.has(`${x},${y}`)) {
          // Spike as BG tile — must be checked before tileVal===0 since spikes sit on empty tiles
          buf[off++] = clampByte(indexMap.get(-204) || 0);
        } else if (tileVal === 0) {
          buf[off++] = 0;
        } else if ((tileVal === 1 || tileVal === 2) && isEdgePos(x, y)) {
          buf[off++] = clampByte(edgeVramIdx || 0);
        } else if (tileVal === 11 && connectedPos.has(`${x},${y}`)) {
          buf[off++] = clampByte(indexMap.get(-205) || indexMap.get(tileVal) || 0);
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
    const header = new Uint8Array(39);
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
    // conn_vram_idx: VRAM index of connected disappearing block sprite (sentinel -205)
    header[8] = indexMap.has(-205) ? Math.min(indexMap.get(-205), 255) : 0;
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
    header[38] = indexMap.has(-204) ? Math.min(indexMap.get(-204), 255) : 0; // spike_vram_idx

    // 8. Build NPC string table
    // Format per level: npc_count (1), then per NPC: play_auto (1), line_count (1), [len+chars]...
    function buildNpcTable(levels) {
      const bytes = [];
      for (const level of levels) {
        const npcs = (level.levelObjects || []).filter(o => o.type === 'npc');
        bytes.push(Math.min(npcs.length, 255));
        for (const npc of npcs) {
          const playAuto = npc.extraAttributes && npc.extraAttributes.playAutomatically ? 1 : 0;
          bytes.push(playAuto);
          const dialogue = (npc.extraAttributes && Array.isArray(npc.extraAttributes.dialogue))
            ? npc.extraAttributes.dialogue
            : (npc.dialogue && Array.isArray(npc.dialogue) ? npc.dialogue : ['']);
          const lines = dialogue.filter(l => typeof l === 'string');
          bytes.push(Math.min(lines.length, 32));
          for (const line of lines.slice(0, 32)) {
            // Clamp to 28 chars, encode as ASCII (replace non-ASCII with space)
            const s = String(line).replace(/[^\x20-\x7E]/g, ' ').substring(0, 28);
            bytes.push(s.length);
            for (let ci = 0; ci < s.length; ci++) bytes.push(s.charCodeAt(ci));
          }
        }
      }
      return new Uint8Array(bytes);
    }
    const npcTable = buildNpcTable(levels);

    // 9. Assemble everything
    const parts = [header, physicsBytes, new Uint8Array(palette), bgTiles, spriteSheet, ...encodedLevels, npcTable];
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDtlEh" +
  "AMB+BgBwEQHAAU0I7bAygsfNblXNDFD7zcdJdhj9ZGV2a2l0U01TAAAAw/VR7aPto+2j7aPto+2j7aPt" +
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
  "fhgYGBgYfgA+DAwMDGw4AGZseHB4bGYAYGBgYGBgfgBjd39ra2NjAGZmdn5uZmYAPGZmZmZmPAB8ZmZ8" +
  "YGBgADxmZmZqbDYAfGZmfGxmZgA8ZmA8BmY8AH4YGBgYGBgAZmZmZmZmPABmZmZmZjwYAGNja2t/d2MA" +
  "ZmY8GDxmZgBmZmY8GBgYAH4GDBgwYH4AfGBgYGBgfAAAYDAYDAYAAD4GBgYGBj4APGYAAAAAAAAAAAAA" +
  "AAAA/zAYAAAAAAAAAAA8Bj5mPgBgYHxmZmZ8AAAAPGZgZjwABgY+ZmZmPgAAADxmfmA8ABwwMHwwMDAA" +
  "AAA+ZmY+BjxgYHxmZmZmABgAOBgYGDwAGAA4GBgYGHBgYGZseGxmADgYGBgYGDwAAAA2f2trYwAAAHxm" +
  "ZmZmAAAAPGZmZjwAAAB8ZmZ8YGAAAD5mZj4GBwAAbHZgYGAAAAA+YDwGfAAwMHwwMDAcAAAAZmZmZj4A" +
  "AABmZmY8GAAAAGNra382AAAAZjwYPGYAAABmZmY+BjwAAH4MGDB+AAwYGHAYGAwAGBgYGBgYGAAwGBgO" +
  "GBgwADFrRgAAAAAA///////////d5d0hAADdOfVNRO1TBMDdfggyBsDdfgYyAMB71sB6Fz8f3oA+ABfd" +
  "d/56B+YB3Xf/OgDAtyhy3cv/RiBY3X7+tyhS7UMCwN1+BDIBwDoBwLcoQjoDwMt/ICI6A8DugNaBMBkq" +
  "AsBVHgDdbggmAHu1X3q0V8UqBMDNyVLBIQLAfsYIdzACIzTdfgjGAt13CCEBwDUYuCEEwH7GEHcwAiM0" +
  "/SEAwP01ABiI3fnd4eHx8TPp3eXdIQAA3Tn1IgfANgEqB8AjcyNyKgfAIyMj3X4EdyPdfgV3KgfAAQ8A" +
  "CTYBKgfAARAACd1eBnMqB8ABEQAJ3X4IdyoHwAESAAndfgaHh4d3KgfAARMACd1WCHqHh4eHdyoHwAEU" +
  "AAk2ACoHwAEVAAk2AioHwAEWAAndfgp3KgfAARcACd1+C3cqB8ABGAAJNgDtSwfAIRkACU1EeofFZy4A" +
  "VQYIKTABGRD6wV17Au1LB8AhGgAJ6yEZAAlm1d1eCy4AVQYIKTABGRD60X0SKgfAARsACTYAKgfAARwA" +
  "Ca93I3cqB8ABHgAJr3cjd+1LB8AhJgAJ6yESAAl+xvwS7UsHwCEnAAnrIRMACX7G/BLtSwfAISQACcXr" +
  "/eH9fhLdd/7dNv8AISYACU4GAN1+/pFP3X7/mEfLKMsZeRLtSwfAISUACcXr/eH9fhPdd/7dNv8AIScA" +
  "CU4GAN1+/pFP3X7/mEfLKMsZeRIqB8ABIAAJNgAqB8ABIQAJNgAjNgHd+d3h4fHx8fHp3eXdIQAA3Tn9" +
  "Ifb//Tn9+d11/t10/055t8rnCd1u/t1m/yIJwN11+t10+91++sYc3Xf83X77zgDdd/3dbvzdZv1eI36z" +
  "yl4J3U763Ub7IR4ACX4jMg3AfjIOwCENwLYgD91u/N1m/X4jMg3AfjIOwCoNwCILwCoNwCMjIg3AKgvA" +
  "ftaAIBDdbvzdZv1+I2ZvIg3AIgvA3U763Ub7IRsACX4yD8DdTvrdRvsDCt13/AMK3Xf9CzoPwCoLwF71" +
  "ewefV/EPMAchAAC/7VLr3X78g1/dfv2KV3sCA3oC7UsJwAMDAwrdd/gDCt13+Qs6D8BfKgvAI37dd/oH" +
  "n913+8tLKBCv3Zb63Xf8n92W+913/RgM3X763Xf83X773Xf93X783Yb4X91+/d2O+Vd7AgN6AjoPwMtX" +
  "yk4JKg3AIgvAKg3AIyMiDcAqC8B+7UsJwNaAIBBZUCEcABl+I2ZvIg3AIgvAWVAhGwAZfjIPwAMzM2lg" +
  "5X7dd/gjft13+ToPwE8qC8B+3Xf6B5/dd/vLQSgQr92W+t13/J/dlvvdd/0YDN1++t13/N1++913/d1+" +
  "+N2G/E/dfvndjv1H4eVxI3DtSwnAAwMDCt13+AMK3Xf5CzoPwF8qC8Ajft13+gef3Xf7y0soEK/dlvrd" +
  "d/yf3Zb73Xf9GAzdfvrdd/zdfvvdd/3dfvzdhvhf3X793Y75V3sCA3oCKgnAAR4ACToNwHcjOg7Ad91+" +
  "/sYNT91+/84AR2lgXiNWerMoYd1+/sYB3Xf83X7/zgDdd/3dbvzdZv1+I2ZvGevdbvzdZv1zI3JpYCNG" +
  "3W783Wb9XiNWy3goHN1O/t1G/yESAAluJgAZy3woGd1u/t1m/zYAGA967oDWgTgI3W7+3Wb/NgAqCcAB" +
  "IQAJTiNGK3ixKAQLcSNw3fnd4cnd5d0hAADdOfX19d11/t10/055t8rBCt1u/t1m/yIQwO1LEMDF/eH9" +
  "XhbF/eH9fhiDMhLAxf3h/X4PtyAMWVAhGgAZfiESwIZ3WVAhEQAZft13+t02+wBZUCEQABl+3Xf83Tb9" +
  "AGlgIyMjXiNWaWAjTiNGOhLA9TPdbvrdZvvl3W783Wb95WlgzQAF7UsQwCEUAAl+tygEPXcYOiEYAAnr" +
  "GjITwGlgxQEZAAnBfiETwIZ3IRoACU46E8CROAUhE8A2ADoTwBLtSxDAIRQACeshFQAJfhLd+d3hyXy1" +
  "yOXNPVHhKxj1zcNSzVpTw/RSIf//NgI6AIDWUCAVOgGA1lAgDjoCgNZMIAc6A4DWVCgCr8k+Ackh//82" +
  "AiEAgCIUwC4nIhbALjgiGMAuSCIawDoFgG8mACkpKSkpAUiACSIcwCocwBFgARkiHsDJ3eXdIQAA3Tkh" +
  "9v85+d13/ioewN11/N10/SH//zYC3Tb/AN1+/92W/tLtC91u/N1m/U4GAN1u/N1m/SNeFgBpYM0oUyEE" +
  "ABnj3X783Xf63X793Xf73W763Wb7IyN+3Xf73Xf63Tb7AE8GAGlgKQnddfjddPndfvbdhvjdd/rdfvfd" +
  "jvndd/vdfvrdd/jdfvvdd/ndfvzdd/rdfv3dd/vdfvrdhvjdd/zdfvvdjvndd/3dNP/DWQvdXvzdVv3d" +
  "+d3hyU9FKlTHXnmTMAYjXniTOAKvyWkmAFTFzShTwWgmABnrKlbHGX7J3eXdIQAA3Tn13Xf/3XX+DgBZ" +
  "FgDrKSkR5MYZXVQjI363KBMaR91+/5AgC2tiI91+/pYoCxgADHnWEDjVEQAA3fnd4cnd5d0hAADdOfXd" +
  "d//ddf7dfv/NHgx6syAzb10WAOspKes+5INPPsaKR1lQExMatyAV3X7/AmlgI91+/nc+ARIDAwOvAhgG" +
  "LH3WEDjO3fnd4cnd5d0hAADdOfU73Xf/3XX+3X7/zR4MS3qxIHrdbv7dfv/NYgzdbv7dfv/NHgxLaXpn" +
  "sSgFIyMjNgEO/x7/ebcgA7MoOXm3KAR7tyAx3X7/gd13/d1+/oNHxdVo3X79zfgL0cH9KhTA9f1WCPGS" +
  "IA6yKAvF1Wjdfv3NswzRwRw+AZPiOQ3ugPLwDAw+AZHiRQ3ugPLuDN353eHJzR4MS3pHsygKAwMK1ig4" +
  "Az4Bya/J3eXdIQAA3Tn13Xf/3XX+DgAGAGlgKQk+JIVfPseMV2tiIyN+tygTGkfdfv+QIAtrYiPdfv6W" +
  "KAsYAAx51hA40REAAN353eHJ3eXdIQAA3Tn1O0/ddf/F3W7/ec1iDcF6syBpxd1u/3nNOw7BHgAhMw4W" +
  "ABl+QYDdd/0hNw4WABl+3Ub/gN13/sXV3W7+3X79zfgL0cH9KhTA9f1GJfEEBSgky/iQIB/F1d1u/t1+" +
  "/c1iDevRwXy1IA3F1d1u/t1+/c2qDdHBHHvWBDii3fnd4ckB/wAAAAAB/93l3SEAAN059d13/911/t1+" +
  "/81iDXqzICdPBgBpYCkJESTHGV1UExMatyAO3X7/dyPdfv53PgESGAYMedYQONrd+d3hyd3l3SEAAN05" +
  "/SHo//05/fkGCMssyx3LGssbEPbdc+zdcu3dde7ddO8hAAA56yEEADkBBADtsN1+BN138N1+Bd138d1+" +
  "Bt138t1+B9138wYI3cvzLt3L8h7dy/Ee3cvwHhDuIQ8AOeshCAA5AQQA7bDdfusH5gHdd/u3IAjdfvoH" +
  "5gEoBT4Bw7ERIRQAOeshDwA5AQQA7bC3KCDdfvfGB913/N1++M4A3Xf93X75zgDdd/7dfvrOAN13/91u" +
  "/N1m/cs8yx3LPMsdyzzLHcHF3X77tygM3X7oxgdP3X7pzgBHyzjLGcs4yxnLOMsZec34C9139LcgBK/D" +
  "sRHdy/R+KASvw7ER7UsUwMX94f1eBnu3KArdfvSTIASvw7ERHgAhEwAJFgAZVnq3KArdfvSSIASvw7ER" +
  "HHvWEjjk3X7vB+YB3Xf13X7sxgfdd/bdfu3OAN13991+7s4A3Xf43X7vzgDdd/ndfvMH5gHdd/rdfvDG" +
  "B913+91+8c4A3Xf83X7yzgDdd/3dfvPOAN13/jo6xrcoXyEAADnrIQQAOQEEAO2w3X71tygOIQAAOesh" +
  "DgA5AQQA7bDBxcs4yxnLOMsZyzjLGd1x/91O8N1G8d1++rcoBt1O+91G/Ms4yxnLOMsZyzjLGWndfv/N" +
  "vjO3KASvw7EROtzGtyhN3U7s3Ubt3X71tygG3U723Ub3yzjLGcs4yxnLOMsZ3XH/3U7w3Ubx3X76tygG" +
  "3U773Ub8yzjLGcs4yxnLOMsZad1+/81bNrcoBK/DsRHdTuzdRu3dXu7dVu/dfvW3KAzdTvbdRvfdXvjd" +
  "VvnLOMsZyzjLGcs4yxndcf8hDgA56yEIADkBBADtsN1++rcoDiEOADnrIRMAOQEEAO2w3X723Xf93X73" +
  "3Xf+3cv+Pt3L/R7dy/4+3cv9Ht3L/j7dy/0e3X793Xf8KhTA3XX93XT+EQcAGX7dd/63KBTdfvTdlv4g" +
  "DN1u/N1+/81NDbcgKCoUwN11/d10/hEIABl+3Xf+tygX3X703Zb+IA/dbvzdfv/NTQ23KAOvGCEqFMDd" +
  "df7ddP8RJgAZft13/7coC91+9N2W/yADrxgCPgHd+d3h4cHB6d3l3SEAAN05/SHo//05/fkGCMssyx3L" +
  "GssbEPbdc+zdcu3dde7ddO8hAAA56yEEADkBBADtsN1+BN138N1+Bd138d1+Bt138t1+B9138wYI3cvz" +
  "Lt3L8h7dy/Ee3cvwHhDuIQ8AOeshCAA5AQQA7bDdfusH5gHdd/u3IAjdfvoH5gEoBT4Bw9YUIRQAOesh" +
  "DwA5AQQA7bC3KCDdfvfGB913/N1++M4A3Xf93X75zgDdd/7dfvrOAN13/91u/N1m/cs8yx3LPMsdyzzL" +
  "HcHF3X77tygM3X7oxgdP3X7pzgBHyzjLGcs4yxnLOMsZec34C9139LcgBK/D1hTdy/R+KASvw9YUDgAq" +
  "FMAREwAZWRYAGUZ4tygK3X70kCAEr8PWFAx51hI44N1+7wfmAd139d1+7MYH3Xf23X7tzgDdd/fdfu7O" +
  "AN13+N1+784A3Xf53X7zB+YB3Xf63X7wxgfdd/vdfvHOAN13/N1+8s4A3Xf93X7zzgDdd/46Osa3KF8h" +
  "AAA56yEEADkBBADtsN1+9bcoDiEAADnrIQ4AOQEEAO2wwcXLOMsZyzjLGcs4yxndcf/dTvDdRvHdfvq3" +
  "KAbdTvvdRvzLOMsZyzjLGcs4yxlp3X7/zb4ztygEr8PWFDrcxrcoTd1O7N1G7d1+9bcoBt1O9t1G98s4" +
  "yxnLOMsZyzjLGd1x/91O8N1G8d1++rcoBt1O+91G/Ms4yxnLOMsZyzjLGWndfv/NWza3KASvw9YU3U7s" +
  "3Ubt3V7u3Vbv3X71tygM3U723Ub33V743Vb5yzjLGcs4yxnLOMsZ3XH/IQ4AOeshCAA5AQQA7bDdfvq3" +
  "KA4hDgA56yETADkBBADtsN1+9t13/d1+9913/t3L/j7dy/0e3cv+Pt3L/R7dy/4+3cv9Ht1+/d13/CoU" +
  "wN11/d10/hEHABl+3Xf+tygU3X703Zb+IAzdbvzdfv/NTQ23ICgqFMDddf3ddP4RCAAZft13/rcoF91+" +
  "9N2W/iAP3W783X7/zU0NtygDrxghKhTA3XX+3XT/ESYAGX7dd/+3KAvdfvTdlv8gA68YAj4B3fnd4eHB" +
  "wekh//82AioYwM0RUa9vzQRRDgEqGMAGAAluxXnNBFHBDHnWEDjtKhTAEQUAGW4mACkpKSkp7VsawOUh" +
  "IADNW1PtWxzAIUAB5SEAIM1bUz4B9TOv9TMqTsjlEWABIQACzf5RIUABw7dSIf//NgIOAGkmACkpKSkp" +
  "KXz2eGfFz8EGACpUxyNeeZMwDMVpeM34C8FfFgAYAxEAAGsmAMt7KAnLvSYAy+TfGAx7tygD6xgDEQAA" +
  "698EeNYgOMYMedYYOK7J3eXdIQAA3Tk7R00h//82AmgmACl89nhnxc/B3Tb/ACpUxyNG3X7/kDALxd1u" +
  "/3nN+AvBGAGvX2smAMt7KAnLvSYAy+TfGAx7tygD6xgDEQAA69/dNP/dfv/WGDjCM93hyd3l3SEAAN05" +
  "9TsqVMcjI37+gDADTxgDAYAA3XH9BgBYe92W/TAy1RYAa2IpGdF9VCFYx4bdd/4jeo7dd//dbv7dZv8j" +
  "I37WBSALIUPAFgAZfrcgAQQcGMh43fnd4clP1gIoD3n+BCgc/gUoHNYMKAYYGhEBAcnNABa3KAQRCQHJ" +
  "EQEByREDAckRBAHJEQEByd3l3SEAAN059Tsh//82Ag4AKlTHIyNGeZDSiRcGAGlgKQlFVHghWMeGI196" +
  "jlfdc/7dcv8TExrdd/09yoUX3X791gPKhRfdfv3WDcqFF91+/dYFIAshQ8AGAAl+t8KFF91+/dYHyoUX" +
  "3X791gjKhRfdfv3WCcqFF91+/dYKKHbdfv3WCyhv3W7+3Wb/biYAKSkp7Vs/wL/tUuvdbv7dZv8jbiYA" +
  "KSkpe9b4ehc/H95/OEOvuz4BmuJMF+6A+oUXy3wgMj7AvT4AnOJeF+6A+oUX3XP/3Tb+AOXF3X79zV4W" +
  "weF7BgDdtv5feN22/1cmAMXNyVLBDMOhFt353eHJKlTHIyN+/oAwA08YAwGAAAYAeJHQWBYAa2IpGev9" +
  "KljH/Rn95dETExrWDSBQ/W4AJgApKSntWz/Av+1S/eXr4SNuJgApKSl71vh6Fz8f3n84K6+7PgGa4uoX" +
  "7oD6CxjLfCAaPsC9PgCc4vwX7oD6CxhTr/YKXyYAxc3JUsEEGJLd5d0hAADdOSHz/zn57UsgwCoiwGVo" +
  "7Us/wL/tQt11/N10/REkwCEAADnrAQQA7bDdfvTdd/jdfvXdd/ndfvzW+N1+/Rc/H95/2g0Zr92+/D4B" +
  "3Z794mgY7oDybhjDDRk6MMC3IArdNv4I3Tb/ARgs7UsowCoqwHy1sLEoFzo5wMtPKAUBBwEYAwEGAd1x" +
  "/t1w/xgI3Tb+Bd02/wHdfvzdd/rdNvsA3X763Xf83Tb9AN1+/N13+902+gDdfv7dd//dd/7dNv8A3X7+" +
  "3Xf83Tb9AN1++t22/N13/t1++922/d13/91++N13/d13/N02/QDdXv7dVv/dbvzdZv3NyVLd+d3hyd3l" +
  "3SEAAN05Iff/OfkqHsDddf3ddP7dNv8AKhTAEQQAGU7dfv3dd/fdfv7dd/jdfv+RMHjdbv3dZv5OBgDd" +
  "bv3dZv4jXhYAaWDNKFMhBAAZ3XX53XT63W793Wb+IyN+3Xf+3Xf93Tb+AE8GAGlgKQnddfvddPzdfvvd" +
  "hvndd/3dfvzdjvrdd/7dfv3dd/rdfv7dd/vdfvrdhvfdd/3dfvvdjvjdd/7dNP/DLBnR1d353eHJ3eXd" +
  "IQAA3Tn9Ifb//Tn9+d13/N11+80SGd02/QBLQgMa3Xf/3X793Zb8ME1ZUN1+/9139t02/gDdfv7dlvYw" +
  "NBMa3Xf3E902/wDdfv/dlvcwHRrdd/gT3XP53XL63X753Yb4X91++s4AV900/xjb3TT+GMTdNP0YpFlQ" +
  "3X7/3Xf4DgAT3XP+3XL/ed2W+DA9ed2W+zA33V7+3Vb/Gt13+RPdNv8A3X7/3Zb5MB0a3Xf6E91z/d1y" +
  "/t1+/d2G+l/dfv7OAFfdNP8Y2wwYtt1e/t1W/xpPEz4gkTACDiAhyMBxBgB4kTBuGt13+BM+HN2W+DAE" +
  "3Tb4HNVYFgBrYikZKRkpKRnR3XX53XT6Psndhvndd/0+wN2O+t13/t02/wDdfv/dlvgwFd1+/d2G/2/d" +
  "fv7OAGcaE3fdNP8Y491++cbJb91++s7AZ33dhvhvMAEkNgAEGI7d+d3hyQEAAB4SFiBpYCkD1RFpxBnR" +
  "r3cjdxUg7xx71hc458nd5d0hAADdOfU7If//NgIOEmkmACkpKSkpKXz2eGfFz8HdNv8AKj/AyzzLHcs8" +
  "yx3LPMsdfd2G/0fFaXjN+AvB3Xf93Tb+AMt/KAzdbv3LvSYAy+TfGAu3KATh5RgDIQAA3900/91+/9Yg" +
  "OLkMedYXOJ/d+d3hyQYSeNYX0GgmACkpKSkpKXz2eGfPDgAhAADfDHnWIDj2BBjfTz4CMv//ec3FGSHG" +
  "wDYBIcfANgAhqcU2/y4/PgHN91DNtRvD/hsOAHnGEyYAbykpKSkpKXz2eGfFz8EGACEAAN8EeNYgOPYM" +
  "edYDONseACHHwHuGVyHIwHqWMClLBgAhEwAJKSkpKSkjIyl89nhnz0oGAGlgKQkpCSkpCQHJwAnVzUlT" +
  "0Rx71gI4xDrHwAYATwMDOsjAXxYAeZN4muJ6HO6A8occIUR9zyGRHMNJUyFEfc8hnhzDSVMxOiBuZXh0" +
  "IHBhZ2UAMTogY2xvc2UAIcbANgDNPhv9If///TYAAioYwMMRUToxwLfIKizA7VsuwH3GKk98zgBHMAET" +
  "7UMswO1TLsCvuT4HmD4Amz4AmuLsHO6A8CEAByIswGUiLsDJ3eXdIQAA3Tn9Ie7//Tn9+d11/t10/0tC" +
  "KhbA3XX43XT5XiN+3XPu3XfvB5/dd/Ddd/EhMMBee7coG91u+N1m+SMjViN+3XL63Xf7B5/dd/zdd/0Y" +
  "Ht1u+N1m+cUBBgAJwX4jZt13+nzdd/sHn913/N13/d1++t138t1++913891+/N139N1+/d139Xu3KB7d" +
  "XvjdVvkhBAAZXiNW3XP6et13+wef3Xf83Xf9GBvdXvjdVvkhCAAZXiN+3XP63Xf7B5/dd/zdd/3FESjA" +
  "IQoAOesBBADtsMHdy/5Wylwe3X723Zby3Xf63X733Z7z3Xf73X743Z703Xf83X753Z713Xf9xREowCEO" +
  "ADkBBADtsMGv3Zbu3Xf2PgDdnu/dd/c+AN2e8N13+J/dlvHdd/ndfvrdlvbdfvvdnvfdfvzdnvjdfv3d" +
  "nvniQx7ugPJUHsURKMAhCgA5AQQA7bDBITfANgHDTx/dy/5eKGjdfvbdhvLdd/rdfvfdjvPdd/vdfvjd" +
  "jvTdd/zdfvndjvXdd/3FESjAIQ4AOQEEAO2wwd1+7t2W+t1+792e+91+8N2e/N1+8d2e/eKxHu6A8sIe" +
  "xREowCECADkBBADtsMEhN8A2AMNPH8XdbvzdZv3l3W763Wb75d1e9t1W991u+N1m+c18VPHxwT4IyyzL" +
  "Hcsayxs9IPXdc/rdcvvddfzddP3FESjAIQ4AOQEEAO2wwe1bKMAqKsA+gN2++j7/3Z77Pv/dnvw+/92e" +
  "/eIyH+6A8k8fe9aAet4Afd4AfBc/H96AMAkhAAAiKMAiKsDtWyDAKiLAPgjLLMsdyxrLGz0g9XvG/913" +
  "7nrO/913733O/9138HzO/9138XvGB9139nrOAN13933OAN13+HzOAN13+d1+8QfmAd138t3L8kYgVd1+" +
  "7t13+t1+7913+91+8N13/N1+8d13/d1+8rcoIN1+7sYH3Xf63X7vzgDdd/vdfvDOAN13/N1+8c4A3Xf9" +
  "PgPdy/0u3cv8Ht3L+x7dy/oePSDtGA7dNvr/r913+913/N13/d1++t13891e9t1W993L+X4oDN1+9sYH" +
  "X91+984AV8s6yxvLOssbyzrLG91z9O1bJMAqJsA+CMssyx3LGssbPSD13XP13XL23XX33XT43V713Vb2" +
  "3X71xgfdd/ndfvbOAN13+t1+984A3Xf73X74zgDdd/zdy/h+KAbdXvndVvrLOssbyzrLG8s6yxvdc/3d" +
  "XvndVvrdy/x+KAzdfvXGDl/dfvbOAFfLOssbyzrLG8s6yxvdc/zdy/JGwlchxd1u/d1+8834C8G3KD0q" +
  "FMARBgAZfrcoFsXdbv3dfvPN+AvBKhTAEQYAGV6TKBzF3W793X7zzVs2wbcgDsXdbv3dfvPNvjPBtyhO" +
  "xd1u/N1+8834C8G3KD0qFMARBgAZfrcoFsXdbvzdfvPN+AvBKhTAEQYAGV6TKBzF3W783X7zzVs2wbcg" +
  "DsXdbvzdfvPNvjPBtygDrxgCPgHdd/vF3W793X70zfgLwbcoPSoUwBEGABl+tygWxd1u/d1+9M34C8Eq" +
  "FMARBgAZXpMoHMXdbv3dfvTNWzbBtyAOxd1u/d1+9M2+M8G3KE7F3W783X70zfgLwbcoPSoUwBEGABl+" +
  "tygWxd1u/N1+9M34C8EqFMARBgAZXpMoHMXdbvzdfvTNWzbBtyAOxd1u/N1+9M2+M8G3KAOvGAI+Ad13" +
  "+sthytYiITDATnm3KCYhMsA2ASEzwDYAITbANgAhMcA2ACEwwDYAOjrGt8rWIs0QNMPWIioWwN11/N10" +
  "/REQABl+tyheebcgWt1++7cgBt1++rcoTiEywDYAITPANgEhNsA2ACExwDYAITjANgDdfvu3KArdNvwB" +
  "3Tb9ABgI3Tb8/902/QDdfvzdd/0hNMDdfv13ITXANgA6Osa3KDzNEDQYN91u/N1m/REPABl+3Xf9tygm" +
  "OjjA3Xf9tyAdITLANgEhM8A2ACE2wDYAITjANgE6Osa3KAPNEDQhMsBO3X7+5hDdd/rdNvsAebfK7yMR" +
  "O8AhCAA56wEEAO2wr92+9t2e9z4A3Z74PgDdnvniDiPugAfmAd13/d1++922+iAH3X79t8rMI91+/bcg" +
  "KioWwN11/N10/REKABl+3Xf8I37dd/3dfvzdd/bdfv3dd/cHn913+N13+d1O9t1G9/3l491u+OPj3Wb5" +
  "4/3hOjbAPN13/SE2wN1+/XcqFsARDAAZbiYA3V79FgC/7VLregftYv3lxc18VPHxr5NPPgCaRz4AnV+f" +
  "lFftQyzA7VMuwCoWwBEMABndfv2WODghMsA2ACExwDYBIQAAIjvAIj3AGCPdfvndtvjdtvfdtvYgFSEy" +
  "wDYAKhbAEQwAGX4yNsAhMcA2ATozwLfK8CXdfvvdtvrK2yU6NsA8MjbA7UsWwFlQIQwAGW4mAF8WAL/t" +
  "Ut11+Hzdd/kHn913+t13+yEKAAlOI35HB+1i5cXdXvjdVvndbvrdZvvNfFTx8a+TTz4Amkc+AJ1fn5RX" +
  "7UMswO1TLsAhNcBOKhbA3XX83XT9EQwAGW4mAF1Uy3woAusTyyrLG3vG/F96zv9XBgB5k3ia4o8k7oDy" +
  "wSXdTvzdRv0hCgAJTiNGeAftYuXF3V743Vb53W763Wb7zXxU8fFNRDo0wN13/dXFESjAIQgAOesBBADt" +
  "sMHR3XP23XL33XH43XD5BgTdy/ku3cv4Ht3L9x7dy/YeEO7dfv09IF3dfvLdhvbdd/rdfvPdjvfdd/vd" +
  "fvTdjvjdd/zdfvXdjvndd/0RKMAhDAA5AQQA7bAqFsBOI0Z4B59fV3ndlvp43Z77e92e/Hrdnv3iRSXu" +
  "gPK6Je1DKMDtUyrAGGjdfvLdlvbdd/rdfvPdnvfdd/vdfvTdnvjdd/zdfvXdnvndd/0RKMAhDAA5AQQA" +
  "7bAqFsBOI0Z4B59fV6+RTz4AmEchAADtUuvdfvqR3X77mN1+/Jvdfv2a4q8l7oDyuiXtQyjA7VMqwDo1" +
  "wDwyNcA6NsAqFsARDAAZTpE4ISEzwDYAITHANgEYFSEzwDYAKhbAEQwAGX4yNsAhMcA2AToywLcgUjoz" +
  "wLcgTO1LLMAqLsDLfChB5cURwAAhAADNfFTx8U1EPgjLKMsZyxrLGz0g9e1TLMDtQy7APoC7Pv+aPv+Z" +
  "Pv+Y4jwm7oDySCYhAAAiLMAiLsDd+d3hyd3l3SEAAN05IfT/OfkRIMAhAAA56wEEAO2wESjAIQgAOesB" +
  "BADtsN1+9N2G/N13+N1+9d2O/d13+d1+9t2O/t13+t1+992O/913+yEAADnrIQQAOQEEAO2w3X703Xf4" +
  "3X713Xf53X723Xf63X733Xf7Bgjdy/su3cv6Ht3L+R7dy/geEO6v3b783Z79PgDdnv4+AN2e/+LoJu6A" +
  "8ukn3X703Xf83X71xgbdd/3dfvbOAN13/t1+984A3Xf/7UskwComwHjGAUcwASPlxd1e/N1W/d1u/t1m" +
  "/82ADrcgI+1LJMAqJsB4xgZHMAEj5cXdXvzdVv3dbv7dZv/NgA63ypIo3X74xgbdd/zdfvnOAN13/d1+" +
  "+s4A3Xf+3X77zgDdd/8hBAA56yEIADkBBADtsN3L/34oIN1+/MYH3Xf43X79zgDdd/ndfv7OAN13+t1+" +
  "/84A3Xf73W743Wb53V763Vb7BgPLKssbyxzLHRD2BgMpyxPLEhD5Afn/CU1Ee87/X3rO/91x9d1w9t1z" +
  "99029AAhAAAiKMAiKsDDkijdy/9+ypIo7UskwComwHjGAUcwASPlxd1e9N1W9d1u9t1m982ADrcgIu1L" +
  "JMAqJsB4xgZHMAEj5cXdXvTdVvXdbvbdZvfNgA63KF7dTvjdRvndbvrdZvvdy/t+KBjdfvjGB0/dfvnO" +
  "AEfdfvrOAG/dfvvOAGdZUAYDyyzLHcsayxsQ9hwgBBQgASNlalMeAAYDyyLtahD6MzPV3XX23XT3IQAA" +
  "IijAIirAESDAIQAAOQEEAO2w3fnd4cnd5d0hAADdOSHj/zn57UskwO1bJsDVxREswCENADnrAQQA7bDB" +
  "0XndhuxPeN2O7Ud73Y7uX3rdju/dcfzdcP3dc/7dd//dfvzdd/jdfv3dd/ndfv7dd/rdfv/dd/sGCN3L" +
  "+y7dy/oe3cv5Ht3L+B4Q7iENADnrIRUAOQEEAO2w7UsgwCoiwN1x9HjGAd139X3OAN139nzOAN13993L" +
  "737ClivdTvzdfv3GCEfdfv7OAP3l3Xfh/eHdfv/OAP3l3Xfi/eHF/eX95cXdXvTdVvXdbvbdZvfNuRH9" +
  "4cG3IBjtWyDAKiLAesYEVzABI/3lxc25EbfK0i/dfvDGCN139N1+8c4A3Xf13X7yzgDdd/bdfvPOAN13" +
  "9yEVADnrIREAOQEEAO2w3cv3figg3X70xgfdd/jdfvXOAN13+d1+9s4A3Xf63X73zgDdd/vdfvjdd/Ld" +
  "fvndd/Pdfvrdd/Tdfvvdd/UGA93L9S7dy/Qe3cvzHt3L8h4Q7v0qFMD9fga3ykEr3X7y3Xf77UsgwO1b" +
  "IsA+CMsqyxvLGMsZPSD13XH33XD43XP53XL6y3ooGHnGB91393jOAN13+HvOAN13+XrOAN13+t1O991G" +
  "+Ms4yxnLOMsZyzjLGd1u+3nN+Avdd/bdfvvdd/ftSyDA7VsiwD4IyyrLG8sYyxk9IPXdcfjdcPndc/rd" +
  "cvvLeigYecYH3Xf4eM4A3Xf5e84A3Xf6es4A3Xf73U743Ub5yzjLGcs4yxnLOMsZDN1u93nN+AtP/SoU" +
  "wP1GBt1+9pAoB3mQKAOvGAI+AbcoR+1LJMAqJsDdcfh4xgjdd/l9zgDdd/p8zgDdd/vdVvLdbvPdZvQe" +
  "AAYDyyLtahD6e92W+Hrdnvl93Z76fN2e++I+K+6A+tIv3X7y3V7z3W703Wb1BgOHyxPtahD5xvhPe87/" +
  "R33O/198zv/dcf3dcP7dc//dNvwAIQAAIizAIi7AITDANgEhMcA2ACEywDYAITPANgAhOMA2AMPSL91u" +
  "/t1m/+XdbvzdZv3l3V703Vb13W723Wb3zYAOtyAj7VsgwCoiwHrGBFcwASPdTv7dRv/F3U783Ub9xc2A" +
  "DrfK0i/dbvDdZvHdXvLdVvPdy/N+KBjdfvDGB2/dfvHOAGfdfvLOAF/dfvPOAFcGA8sqyxvLHMsdEPZ9" +
  "xgHdd+N8zgDdd+R7zgDdd+V6zgDdd+Y638a3wo4vKhTAEQ0AGX63yo4v7UsgwO1bIsA+CMsqyxvLGMsZ" +
  "PSD13XH83XD93XP+3XL/y3ooGHnGB913/HjOAN13/XvOAN13/nrOAN13/91u/N1m/cs8yx3LPMsdyzzL" +
  "HWV5xgbdd/R4zgDdd/V7zgDdd/Z6zgDdd/fdfvTdd/zdfvXdd/3dfvbdd/7dfvfdd//dy/d+KBh5xg3d" +
  "d/x4zgDdd/17zgDdd/56zgDdd//dTvzdRv3LOMsZyzjLGcs4yxndfuM9R8VofM34C8Hdd/9oec34C0/9" +
  "KhTA/eXRIQ0AGV7dfv+TKBH9Rg7dfv+QKAh5uygEkMKOLzrextYBPgAXMt7GzeE2KhTA3XX+3XT/Ot7G" +
  "tygN3U7+3Ub/IQ0ACU4YC91u/t1m/xEOABlOQXm3KAVIBgAYAwEAAB4AId3Ge5YwOmsmACn9IczGxU1E" +
  "/QnB/eXhI24mACkpKSkpfVT9bgD1feYfb/EmAIVveozLJY/2eGfFz8FpYN8cGL/tSyDA7VsiwD4IyyrL" +
  "G8sYyxk9IPXdfvjdd+fdfvndd+jdfvrdd+ndfvvdd+rdfvjGCN13691++c4A3Xfs3X76zgDdd+3dfvvO" +
  "AN137nnGBt1373jOAN138HvOAN138XrOAN138t02/wAh3Mbdfv+W0okv1d1e/xYAa2IpGdH9ITzGxU1E" +
  "/QnB/X4A3Xf7r913/N13/d13/vXdfvvdd/Pdfvzdd/Tdfv3dd/Xdfv7dd/bxPgPdy/Mm3cv0Ft3L9Rbd" +
  "y/YWPSDt/eXhI37dd/uv3Xf83Xf93Xf+9d1++913991+/N13+N1+/d13+d1+/t13+vE+A93L9ybdy/gW" +
  "3cv5Ft3L+hY9IO39fgK3KAU63sYYCDrextYBPgAXt8qDL91+892W791+9N2e8N1+9d2e8d1+9t2e8uLj" +
  "Lu6A8oMv3X7zxgjdd/vdfvTOAN13/N1+9c4A3Xf93X72zgDdd/553Zb7eN2e/Hvdnv163Z7+4hsv7oDy" +
  "gy/dfvfdluvdfvjdnuzdfvndnu3dfvrdnu7iOy/ugPKDL91+98YI3Xf73X74zgDdd/zdfvnOAN13/d1+" +
  "+s4A3Xf+3X7n3Zb73X7o3Z783X7p3Z793X7q3Z7+4nsv7oDygy8hxMA2Ad00/8MQLiHfxjYB3X7j3Xf9" +
  "3X7k3Xf+3X7l3Xf/3Tb8AAYD3cv9Jt3L/hbdy/8WEPIhAAAiLMAiLsAhMsA2ACEzwDYAKhbAEQwAGX4y" +
  "NsARJMAhGQA5AQQA7bDd+d3hyd3l3SEAAN05IeD/OfntWyDAKiLABgjLLMsdyxrLGxD2MzPV3XXi3XTj" +
  "7VskwComwAYIyyzLHcsayxsQ9t1z5N1y5d115t105ypUxyMjfv6AOAI+gN136CH//zYC3X7kxgjdd+nd" +
  "fuXOAN136t1+5s4A3Xfr3X7nzgDdd+zdfuDGBt137d1+4c4A3Xfu3X7izgDdd+/dfuPOAN138N02/wDd" +
  "fv/dlujSuTPdTv8GAGlgKQnddfvddPzdfvshWMeG3Xf93X78I47dd/7dfv3dd/Hdfv7dd/LdbvHdZvJ+" +
  "3Xf+3Xf7r913/N13/d13/t1++913891+/N139N1+/d139d1+/t139gYD3cvzJt3L9Bbdy/UW3cv2FhDu" +
  "3X7x3Xf93X7y3Xf+3W793Wb+I37dd/7dd/uv3Xf83Xf93Xf+3X773Xf33X783Xf43X793Xf53X7+3Xf6" +
  "BgPdy/cm3cv4Ft3L+Rbdy/oWEO4hGwA56yEXADkBBADtsN1+892W7d1+9N2e7t1+9d2e791+9t2e8OJ3" +
  "Me6A8rMz3X7zxghP3X70zgBH3X71zgBf3X72zgBX3X7gkd1+4ZjdfuKb3X7jmuKnMe6A8rMz3X773Zbp" +
  "3X783Z7q3X793Z7r3X7+3Z7s4scx7oDyszPdfvvGCE/dfvzOAEfdfv3OAF/dfv7OAFfdfuSR3X7lmN1+" +
  "5pvdfuea4vcx7oDyszPdTvHdRvIDAwr+AigZ/gPKszP+BChn/gXKojP+DCgP1g0oGsOzMyHDwDYBw7Mz" +
  "zQAWt8KzMyHDwDYBw7MzOsbAt8KzM902/QDdNv4A3X7+3Zb/MB3dTv4GAGlgKQnrKljHGSMjftYNIAPd" +
  "NP3dNP4Y291u/TrFwM3YG8OzM+1LLMAqLsDLfMKzM91+98YET91++M4AR91++c4AX91++s4AV9XFESTA" +
  "IR8AOesBBADtsMHR3X773Xf33X783Xf43X793Xf53X7+3Xf6Pgjdy/ou3cv5Ht3L+B7dy/cePSDt3X73" +
  "xgjdd/vdfvjOAN13/N1++c4A3Xf93X76zgDdd/55xgJPeM4ARzABE3ndlvt43Z78e92e/Xrdnv7iGTPu" +
  "gPqzMyoWwBEKABlOI37dcfvdd/wHn913/d13/iE7wN1e+91W/N1O/d1G/j4CyyPLEssRyxA9IPXlIQAA" +
  "5SEPAOVpYM1yU/HxTUThe92G+1963Y78V3ndjv1PeN2O/kdzI3IjcSNwITLANgEhNsA2ACExwDYAITDA" +
  "NgAhOMA2ADo6xrcoFs0QNBgRPkPdhv9vPsDOAGd+tyACNgHdNP/DgzDd+d3hyd3l3SEAAN059d13/911" +
  "/g4AITrGeZYwNBGqxQYAaWApCRnrGkfdfv+QIB5rYiPdfv6WIBUTExq3KAo6O8bWAT4AFxgJOjvGGAQM" +
  "GMWv3fnd4cnd5d0hAADdOSHr/zn5OjvG1gE+ABcyO8bdNv8AITrG3X7/ltJWNt1O/wYAaWApCd11/d10" +
  "/j6q3Yb93Xf7PsXdjv7dd/zdbvvdZvx+3Xf93X773Xf53X783Xf63W753Wb6I37dd/7dbvvdZvwjI055" +
  "tygFOjvGGAg6O8bWAT4AF913+ioUwN11+910/Hm3KCHdfvq3KA3dTvvdRvwhDwAJRhgL3U773Ub8IRAA" +
  "CUZ4GB7dfvq3KA3dTvvdRvwhEQAJfhgL3W773Wb8ERIAGX63KAQGABgCr0dfUN1u/iYAKSkpKSndfv3m" +
  "H08GAAkpfPZ4Z8/r391++rfKUDbtWyDAKiLABgjLLMsdyxrLGxD2MzPV3XXt3XTu7VskwComwAYIyyzL" +
  "HcsayxsQ9t1z791y8N118d108t1u/a9nTwYDKY/LERD63XXz3XT03Xf13XH23W7+r2dPBgMpj8sREPrd" +
  "dffddPjdd/ndcfrdfuvGBk/dfuzOAEfdfu3OAF/dfu7OAFfdfvOR3X70mN1+9Zvdfvaa4qg17oDyUDbd" +
  "fvPGCN13+91+9M4A3Xf83X71zgDdd/3dfvbOAN13/t1+692W+91+7N2e/N1+7d2e/d1+7t2e/uLoNe6A" +
  "8lA23X7vxghP3X7wzgBH3X7xzgBf3X7yzgBX3X73kd1++Jjdfvmb3X76muIYNu6A8lA23X73xghP3X74" +
  "zgBH3X75zgBf3X76zgBX3X7vkd1+8JjdfvGb3X7ymuJINu6A8lA2IcTANgHdNP/DLDTd+d3hyd3l3SEA" +
  "AN059d13/911/g4AIdzGeZYwNBE8xgYAaWApCRnrGkfdfv+QIB5rYiPdfv6WIBUTExq3KAo63sbWAT4A" +
  "FxgJOt7GGAQMGMWv3fnd4cntWxTAtygSfbcoByEJABl+GBchCgAZfhgQfbcoByELABl+GAUhDAAZfrco" +
  "BBYAX8kRAADJ3eXdIQAA3Tn13Tb/ACHcxt1+/5YwUd1O/wYAaWApCeshPMYZ6xpPa2Ijft13/hMTGke3" +
  "KAU63sYYCDrextYBPgAXb8V4za02wd1u/iYAKSkpKSl55h8GAE8JKXz2eGfP69/dNP8Ypt353eHJOt/G" +
  "t8jtSyzAKi7Ar7mYPgCdPgCc4mc37oDwId/GNgDJ3eXdIQAA3Tkh6/85+e1bIMAqIsAGCMssyx3LGssb" +
  "EPbdc/XdcvbddffddPgqJMDtWybABgjLKssbyxzLHRD23U713Ub2/eXj3W734+PdZvjj/eHdy/h+KCTd" +
  "fvXGB0/dfvbOAEfdfvfOAP3l3Xfp/eHdfvjOAP3l3Xfq/eHLOMsZyzjLGcs4yxndcf3dfvXGBd13+d1+" +
  "9s4A3Xf63X73zgDdd/vdfvjOAN13/N1O+d1G+v3l491u++Pj3Wb84/3h3cv8figk3X75xgdP3X76zgBH" +
  "3X77zgD95d136f3h3X78zgD95d136v3hyzjLGcs4yxnLOMsZ3XH+1f3hTUTLeigcfcYHT3zOAEd7zgD9" +
  "5d136f3hes4A/eXdd+r94cs4yxnLOMsZyzjLGd1x/8UBCAAJwTABE9X94U1Ey3ooGgEHAAlNRHvOAP3l" +
  "3Xfp/eF6zgD95d136v3hyzjLGcs4yxnLOMsZ3X793Xfv3XHw3X7+3Xfx3XHy3X793Xfz3X7/3Xf03Tb/" +
  "AN1u/yYAKU1EIQQAOQl+3Xf6I37dd/tv3X76zfgL3Xf8KhTA3XX93XT+AQcACU55tygR3X78kSAL3W77" +
  "3X76zWIMGEDdTv3dRv4hCAAJTnm3KBHdfvyRIAvdbvvdfvrNswwYIN1O/d1G/iElAAl+tygST8v53X78" +
  "kSAJ3W773X76zaoN3TT/3X7/1gPa9Tj9KhTA/X4l3Xf/t8qMOxEgwCERADnrAQQA7bDdfvzdd+vdfv3d" +
  "d+zdfv7dd+3dfv/dd+4GCN3L7i7dy+0e3cvsHt3L6x4Q7iERADnrIQAAOQEEAO2w3cvufigg3X7rxgfd" +
  "d/zdfuzOAN13/d1+7c4A3Xf+3X7uzgDdd//dTvzdRv3dcf7dcP/dy/8+3cv+Ht3L/z7dy/4e3cv/Pt3L" +
  "/h7dfv7dd/XdfuvGBd13+N1+7M4A3Xf53X7tzgDdd/rdfu7OAN13+yERADnrIQ0AOQEEAO2w3cv7figg" +
  "3X7rxgzdd/zdfuzOAN13/d1+7c4A3Xf+3X7uzgDdd//dfvzdd/7dfv3dd//dy/8+3cv+Ht3L/z7dy/4e" +
  "3cv/Pt3L/h7dfv7dd/YRJMAhEQA56wEEAO2w3X783Xf33X793Xf43X7+3Xf53X7/3Xf6Bgjdy/ou3cv5" +
  "Ht3L+B7dy/ceEO4hAAA56yEMADkBBADtsN1+98YH3Xf73X74zgDdd/zdfvnOAN13/d1++s4A3Xf+3cv6" +
  "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" +
  "zfgLT91+6JEoXSEKADnrIQUAOQEEAO2w3X77tygOIQoAOeshGAA5AQQA7bDdbu7dZu/LPMsdyzzLHcs8" +
  "yx3dTvLdRvPdfva3KAbdTvfdRvjLOMsZyzjLGcs4yxl5zfgLT91+6JEgBSHEwDYBzU03zZE7zc1AzdhA" +
  "zcNSzZAWzY4XzQ4YzVpTzfRSOsTAtygJ3X7mzTtEw5REOsPAt8qURA48xc09UcENIPjdTuYGAAPdXucW" +
  "AHmTeJri7kjugPIHSd1+5t13/900/91+/913/gef3Xf/GAev3Xf+3Xf/3X7+3Xfmze1Aw5REzT1RIUAB" +
  "zV5QIQBA5REAAGXNfFLNj1LNo1IuPz4BzfdQIQAB5SpOyOURYAEhAALN/lEhQAHNt1IhQAHNSVAhCHrP" +
  "IY1JzUlTIYZ6zyGfSc1JUyGIe88htknNSVPNPVHNSlF75jAo9c09Uc1KUXvmMCD1yVBPQ0tFVCBQTEFU" +
  "Rk9STUVSAGZvciBTZWdhIE1hc3RlciBTeXN0ZW0AUHJlc3MgMSB0byBzdGFydAAuAM2UUC4AzapQLgDN" +
  "ilDNGknN2gq3KPfNAAvNPVEhQAHNXlAhAEDlEQAAZc18Us3eFCFAAc1JUM1lRBjScG9ja2V0LXBsYXRm" +
  "b3JtZXItc21zAFBvY2tldCBQbGF0Zm9ybWVyIFNNUyBFbmdpbmUAR2VuZXJhdGVkIGJ5IHBvY2tldC1w" +
  "bGF0Zm9ybWVyLXRvLXNtcyB3ZWIgZXhwb3J0ZXIuADpax7fIPp/Tfz6/0386b8e3IAQ+39N/OnDHtyAE" +
  "Pv/TfyFaxzYAyTpax7fAOmjH9pDTfzppx/aw0386b8e3IBc6bMfmD/bA0386bcfmP9N/OmrH9tDTfzpw" +
  "x7cgEDpux+YP9uDTfzprx/bw038hWsc2AcnNa0ohYsc2AdHBxdXtQ1vH7UNdx+1DX8chYcc2ACFlxzYA" +
  "IWPHNp8hWsc2AckhYsc2AMnB4eXF5c3eSvEhYsc2AMn9IVrH/W4AyT6f038+v9N/Pt/Tfz7/03/J3eXd" +
  "IQAA3Tn1/SFkx/1+AN13/q/dd//9TgA6Wse3KFg6aMfmD18WAOHlGT4PvT4AnOJvS+6A8ndLEQ8AGAk6" +
  "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" +
  "3Y4FV91+/t2OBm/dfv/djgdn3fnd4ckAAwQgCAgBAQcAeLEoCBFOyCFnVe2wyQAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//89LpmZAEw=";
