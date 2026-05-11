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
    'npc':                13,
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDF1Mh" +
  "AMB+BgBwEQHAAVAI7bAyhcfNz1bNbVH7zShLdhj9ZGV2a2l0U01TAAAAw1ZT7aPto+2j7aPto+2j7aPt" +
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
  "3XH43XD53XP63XL7y3ooGHnGB913+HjOAN13+XvOAN13+nrOAN13+91O+N1G+cs4yxnLOMsZyzjLGQzd" +
  "bvd5zfgLT/0qFMD9RgbdfvaQKAd5kCgDrxgCPgG3KEftSyTAKibA3XH4eMYI3Xf5fc4A3Xf6fM4A3Xf7" +
  "3Vby3W7z3Wb0HgAGA8si7WoQ+nvdlvh63Z75fd2e+nzdnvviSCvugPrcL91+8t1e891u9N1m9QYDh8sT" +
  "7WoQ+cb4T3vO/0d9zv9ffM7/3XH93XD+3XP/3Tb8ACEAACIswCIuwCEwwDYBITHANgAhMsA2ACEzwDYA" +
  "ITjANgDD3C/dbv7dZv/l3W783Wb95d1e9N1W9d1u9t1m982ADrcgI+1bIMAqIsB6xgRXMAEj3U7+3Ub/" +
  "xd1O/N1G/cXNgA63ytwv3W7w3Wbx3V7y3Vbz3cvzfigY3X7wxgdv3X7xzgBn3X7yzgBf3X7zzgBXBgPL" +
  "KssbyxzLHRD2fcYB3XfjfM4A3Xfke84A3Xfles4A3XfmOuLGt8KYLyoUwBENABl+t8qYL+1LIMDtWyLA" +
  "PgjLKssbyxjLGT0g9d1x/N1w/d1z/t1y/8t6KBh5xgfdd/x4zgDdd/17zgDdd/56zgDdd//dbvzdZv3L" +
  "PMsdyzzLHcs8yx1lecYG3Xf0eM4A3Xf1e84A3Xf2es4A3Xf33X703Xf83X713Xf93X723Xf+3X733Xf/" +
  "3cv3figYecYN3Xf8eM4A3Xf9e84A3Xf+es4A3Xf/3U783Ub9yzjLGcs4yxnLOMsZ3X7jPUfFaHzN+AvB" +
  "3Xf/aHnN+AtP/SoUwP3l0SENABle3X7/kygR/UYO3X7/kCgIebsoBJDCmC864cbWAT4AFzLhxs0POCoU" +
  "wN11/t10/zrhxrcoDd1O/t1G/yENAAlOGAvdbv7dZv8RDgAZTkF5tygFSAYAGAMBAAAeACHgxnuWMDpr" +
  "JgAp/SHPxsVNRP0Jwf3l4SNuJgApKSkpKX1U/W4A9X3mH2/xJgCFb3qMyyWP9nhnxc/BaWDfHBi/7Usg" +
  "wO1bIsA+CMsqyxvLGMsZPSD13X743Xfn3X753Xfo3X763Xfp3X773Xfq3X74xgjdd+vdfvnOAN137N1+" +
  "+s4A3Xft3X77zgDdd+55xgbdd+94zgDdd/B7zgDdd/F6zgDdd/LdNv8AId/G3X7/ltKTL9XdXv8WAGti" +
  "KRnR/SE/xsVNRP0Jwf1+AN13+6/dd/zdd/3dd/713X773Xfz3X783Xf03X793Xf13X7+3Xf28T4D3cvz" +
  "Jt3L9Bbdy/UW3cv2Fj0g7f3l4SN+3Xf7r913/N13/d13/vXdfvvdd/fdfvzdd/jdfv3dd/ndfv7dd/rx" +
  "PgPdy/cm3cv4Ft3L+Rbdy/oWPSDt/X4CtygFOuHGGAg64cbWAT4AF7fKjS/dfvPdlu/dfvTdnvDdfvXd" +
  "nvHdfvbdnvLi7S7ugPKNL91+88YI3Xf73X70zgDdd/zdfvXOAN13/d1+9s4A3Xf+ed2W+3jdnvx73Z79" +
  "et2e/uIlL+6A8o0v3X733Zbr3X743Z7s3X753Z7t3X763Z7u4kUv7oDyjS/dfvfGCN13+91++M4A3Xf8" +
  "3X75zgDdd/3dfvrOAN13/t1+592W+91+6N2e/N1+6d2e/d1+6t2e/uKFL+6A8o0vIcTANgHdNP/DGi4h" +
  "4sY2Ad1+4913/d1+5N13/t1+5d13/902/AAGA93L/Sbdy/4W3cv/FhDyIQAAIizAIi7AITLANgAhM8A2" +
  "ACoWwBEMABl+MjbAESTAIRkAOQEEAO2w3fnd4cnd5d0hAADdOSHg/zn57VsgwCoiwAYIyyzLHcsayxsQ" +
  "9t1z5N1y5d115t105+1bJMAqJsAGCMssyx3LGssbEPbdc+jdcundderddOsqV8cjI37+gDgCPoDdd+wh" +
  "//82At1+6MYI3Xft3X7pzgDdd+7dfurOAN13791+684A3Xfw3X7kxgbdd/HdfuXOAN138t1+5s4A3Xfz" +
  "3X7nzgDdd/TdNv0A3X793Zbs0uc03U79BgBpYCkJ3XX73XT83X77IVvHht13/t1+/COO3Xf/3W7+3Wb/" +
  "ft13/N13+a/dd/rdd/vdd/zdfvndd+Ddfvrdd+Hdfvvdd+Ldfvzdd+MGA93L4Cbdy+EW3cviFt3L4xYQ" +
  "7t1+/t13+91+/913/N1u+91m/CN+3Xf83Xf5r913+t13+913/N1++d139d1++t139t1++913991+/N13" +
  "+AYD3cv1Jt3L9hbdy/cW3cv4FhDuIRkAOeshFQA5AQQA7bDdfuDdlvHdfuHdnvLdfuLdnvPdfuPdnvTi" +
  "eDHugPLhNN1+4MYIT91+4c4AR91+4s4AX91+484AV91+5JHdfuWY3X7mm91+55riqDHugPLhNN1++d2W" +
  "7d1++t2e7t1++92e791+/N2e8OLIMe6A8uE03X75xghP3X76zgBH3X77zgBf3X78zgBX3X7okd1+6Zjd" +
  "fuqb3X7rmuL4Me6A8uE03U7+3Ub/AwMK/gIoGv4DyuE0/gTKpTP+BcrQNP4MKA/WDSgaw+E0IcPANgHD" +
  "4TTNABa3wuE0IcPANgHD4TQ6xsC3wuE03Tb/AN02/gDdfv7dlv0wNt1O/gYAaWApCd11+d10+t1++SFb" +
  "x4bdd/vdfvojjt13/N1u+91m/CMjftYNIAPdNP/dNP4Ywt1+/9139d1+/zKqxTrFwDKrxc0XGd1z991y" +
  "+N02/gDdTvfdRvgD3W733Wb4ft13/yHFwN1+/pYwZt1x991w+N1O/902/wDdfv+RME3dXvfdVvgTGt13" +
  "+RPdc/fdcvgeAHvdlvkwLt1u991m+H7dd/rdfvfGAd13+91++M4A3Xf83X773Yb63Xf33X78zgDdd/gc" +
  "GMzdNP8Yrd00/sOlMt1x9t1w991+/913+N02/gDdfv7dlvgwW91+/t2W9TBT3U723Ub3Awrdd/kD3XH2" +
  "3XD33Tb/AN1+/92W+TAw3W723Wb3ft13+t1+9sYB3Xf73X73zgDdd/zdfvvdhvrdd/bdfvzOAN139900" +
  "/xjI3TT+GJ3dbvbdZvd+MqzFw+E07UsswCouwMt8wuE03X71xgRP3X72zgBH3X73zgBf3X74zgBX1cUR" +
  "JMAhHQA56wEEAO2wwdHdfvndd/Xdfvrdd/bdfvvdd/fdfvzdd/g+CN3L+C7dy/ce3cv2Ht3L9R49IO3d" +
  "fvXGCN13+d1+9s4A3Xf63X73zgDdd/vdfvjOAN13/HnGAk94zgBHMAETed2W+Xjdnvp73Z77et2e/OJH" +
  "NO6A+uE0KhbAEQoAGU4jft1x+d13+gef3Xf73Xf8ITvA3V753Vb63U773Ub8PgLLI8sSyxHLED0g9eUh" +
  "AADlIQ8A5WlgzdNU8fFNROF73Yb5X3rdjvpXed2O+0943Y78R3MjciNxI3AhMsA2ASE2wDYAITHANgAh" +
  "MMA2ACE4wDYAOj3GtygWzT41GBE+Q92G/W8+wM4AZ363IAI2Ad00/cOQMN353eHJ3eXdIQAA3Tn13Xf/" +
  "3XX+DgAhPcZ5ljA0Ea3FBgBpYCkJGesaR91+/5AgHmtiI91+/pYgFRMTGrcoCjo+xtYBPgAXGAk6PsYY" +
  "BAwYxa/d+d3hyd3l3SEAAN05Iev/Ofk6PsbWAT4AFzI+xt02/wAhPcbdfv+W0oQ33U7/BgBpYCkJ3XX9" +
  "3XT+Pq3dhv3dd/s+xd2O/t13/N1u+91m/H7dd/3dfvvdd/ndfvzdd/rdbvndZvojft13/t1u+91m/CMj" +
  "Tnm3KAU6PsYYCDo+xtYBPgAX3Xf6KhTA3XX73XT8ebcoId1++rcoDd1O+91G/CEPAAlGGAvdTvvdRvwh" +
  "EAAJRngYHt1++rcoDd1O+91G/CERAAl+GAvdbvvdZvwREgAZfrcoBAYAGAKvR19Q3W7+JgApKSkpKd1+" +
  "/eYfTwYACSl89nhnz+vf3X76t8p+N+1bIMAqIsAGCMssyx3LGssbEPYzM9Xdde3ddO7tWyTAKibABgjL" +
  "LMsdyxrLGxD23XPv3XLw3XXx3XTy3W79r2dPBgMpj8sREPrddfPddPTdd/Xdcfbdbv6vZ08GAymPyxEQ" +
  "+t119910+N13+d1x+t1+68YGT91+7M4AR91+7c4AX91+7s4AV91+85HdfvSY3X71m91+9pri1jbugPJ+" +
  "N91+88YI3Xf73X70zgDdd/zdfvXOAN13/d1+9s4A3Xf+3X7r3Zb73X7s3Z783X7t3Z793X7u3Z7+4hY3" +
  "7oDyfjfdfu/GCE/dfvDOAEfdfvHOAF/dfvLOAFfdfveR3X74mN1++Zvdfvqa4kY37oDyfjfdfvfGCE/d" +
  "fvjOAEfdfvnOAF/dfvrOAFfdfu+R3X7wmN1+8ZvdfvKa4nY37oDyfjchxMA2Ad00/8NaNd353eHJ3eXd" +
  "IQAA3Tn13Xf/3XX+DgAh38Z5ljA0ET/GBgBpYCkJGesaR91+/5AgHmtiI91+/pYgFRMTGrcoCjrhxtYB" +
  "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" +
  "r5NfPgCaVz4AnW+flGfd+d3hyd3l3SEAAN059fUzM9Xddf7ddP8hAABdVA4g3X7/B+YBR93L/Cbdy/0W" +
  "3cv+Ft3L/xYpyxPLEstAKALLxX3dlgR83Z4Fe92eBnrdngc4HH3dlgRvfN2eBWd73Z4GX3rdngdX3X78" +
  "9gHdd/wNIK3R1d1u/t1m/9353eHJ3eXdIQAA3Tn19fXdc/zdcv3ddf7ddP9NRN1eBN1WBWlgzYlU3XP+" +
  "3XL/S0Ldfgbdd/rdfgfdd/vh0dXlxd1u+t1m+82JVOvBCevdc/7dcv9LQt1e/d1mBcUuAFUGCCkwARkQ" +
  "+sEJ691z/t1y/91eBN1m/S4AVQYIKTABGRD6TUTdXvzdZgXFLgBVBggpMAEZEPrB691zBd1yBmtiCevd" +
  "cwXdcgZ7kXqYPgAX3XcH3V783WYELgBVBggpMAEZEPrr3XP83XL93TYEAN1+/N2GBF/dfv3djgVX3X7+" +
  "3Y4Gb91+/92OB2fd+d3hyQADBCAICAEBBwB4sSgIEVHIIchW7bDJAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//90J5mZAEw=";
