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
    'barrelCannon':       14,
    'triggeredPlatform':  15,
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
    // Barrel cannon sprites: tiles 267-270 (right, left, top, bottom)
    {
      const barrelSObj = get('BARREL_CANNON');
      const bPx = barrelSObj ? (barrelSObj.animation[0].sprite) : null;
      if (bPx) {
        // BARREL_DIR_RIGHT (0) = H-flipped (base sprite opens left)
        tiles.push(encodeTile4bpp(bPx.map(row => [...row].reverse()), palette));
        // BARREL_DIR_LEFT (2→slot1) = base sprite
        tiles.push(encodeTile4bpp(bPx, palette));
        // BARREL_DIR_TOP (1→slot2) = rotate 90° CW
        tiles.push(encodeTile4bpp(
          Array.from({length:8}, (_,r) => Array.from({length:8}, (_,c) => bPx[7-c][r])), palette));
        // BARREL_DIR_BOTTOM (3→slot3) = rotate 90° CCW
        tiles.push(encodeTile4bpp(
          Array.from({length:8}, (_,r) => Array.from({length:8}, (_,c) => bPx[c][7-r])), palette));
      } else {
        tiles.push(encodeTile4bpp(blank8, palette));
        tiles.push(encodeTile4bpp(blank8, palette));
        tiles.push(encodeTile4bpp(blank8, palette));
        tiles.push(encodeTile4bpp(blank8, palette));
      }
    }
    // Triggered platform sprite = tile 271 (after barrel tiles 267-270)
    const tpS = get('TRIGGERED_PLATFORM');
    tpS ? encodeSprite8(tpS, 0) : encodeBlank();
    // Mirrored player tiles 272-275 (idle, walk0, walk1, jump — H-flipped)
    const mirrorH = px => px ? px.map(row => [...row].reverse()) : null;
    pIdle ? tiles.push(encodeTile4bpp(mirrorH(pIdle.animation[0].sprite), palette)) : encodeBlank();
    pWalk ? tiles.push(encodeTile4bpp(mirrorH(pWalk.animation[0].sprite), palette)) : encodeBlank();
    pWalk ? tiles.push(encodeTile4bpp(mirrorH(pWalk.animation[1].sprite), palette)) : encodeBlank();
    pJump ? tiles.push(encodeTile4bpp(mirrorH(pJump.animation[0].sprite), palette)) : encodeBlank();

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
        // Barrel cannon / triggered platform: encode direction in top 2 bits of y
        // dir: 0=right, 1=top, 2=left, 3=bottom
        if (obj.type === 'barrelCannon' || obj.type === 'triggeredPlatform') {
          const dirMap = { 'right': 0, 'top': 1, 'left': 2, 'bottom': 3 };
          const dir = dirMap[obj.extraAttributes && obj.extraAttributes.currentFacingDirection] || 0;
          objects.push({ x: obj.x, y: (obj.y & 0x3F) | (dir << 6), type: typeId });
          continue;
        }
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
    // Triggered platform table: per level: tp_count (1), per TP: size (1), speed_idx (1), act_once (1)
    function buildTpTable(levels) {
      const bytes = [];
      for (const level of levels) {
        const tps = (level.levelObjects || []).filter(o => o.type === 'triggeredPlatform');
        bytes.push(Math.min(tps.length, 255));
        for (const tp of tps) {
          const ea = tp.extraAttributes || {};
          const size = ea.size || 3;
          const speedIdx = ea.speed || 3; // 1-7, index into pathMovementMapper
          const actOnce = (ea.activationOnce === 'moving endlessly when touched') ? 1 : 0;
          bytes.push(Math.min(size, 15));
          bytes.push(Math.min(speedIdx, 7));
          bytes.push(actOnce);
        }
      }
      return new Uint8Array(bytes);
    }
    const tpTable = buildTpTable(levels);

    const parts = [header, physicsBytes, new Uint8Array(palette), bgTiles, spriteSheet, ...encodedLevels, npcTable, tpTable];
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDA2Eh" +
  "AMB+BgBwEQHAAS4J7bAyY8jNw2TNWV/7zRRZdhj9ZGV2a2l0U01TAAAAw0Jh7aPto+2j7aPto+2j7aPt" +
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
  "AN134N1+/MYG3Xfh3X79zgDdd+Ldfv7OAN13491+/84A3Xfk3Tb/ACF9xt1+/5bSXiXdTv8GAGlgKQkp" +
  "KQkp3XX73XT83X77xq3dd/3dfvzOxd13/t1+/d135d1+/t135t1+5d13/d1+5t13/t1u/d1m/hEYABl+" +
  "t8pYJd1+5cYE3Xfn3X7mzgDdd+jdbufdZuheI1YjI34rbmcGCMssyx3LGssbEPbdc+ndcurddevddOzd" +
  "buXdZuZeI1YjTiNuBgjLLcsZyxrLGxD23XP33XL43XH53XX63X7lxhTdd+3dfubOAN137t1u7d1m7n7d" +
  "d/vdNvwA3X773Xf93X783Xf+3cv8figQ3X77xgHdd/3dfvzOAN13/t1O/d1G/ssoyxl4B+1i3X73kU/d" +
  "fviYR91++Z1f3X76nFfdfvvdd/bdfvzdd/cHn913+N13+d1+9oFv3X73iGfdfviL/eXdd8/94d1++Yrd" +
  "de/ddPD95ePddfHj/eHdd/LVxREswCEuADnrAQQA7bDB0d1+5cYV3Xfz3X7mzgDdd/TdfuXGGd139d1+" +
  "5s4A3Xf23X7lxhDdd/fdfubOAN13+N1+5cYS3Xf53X7mzgDdd/rdy/5+wuEj3X7d3Zbp3X7e3Z7q3X7f" +
  "3Z7r3X7g3Z7s4r4i7oD64SPdfunGBN13+91+6s4A3Xf83X7rzgDdd/3dfuzOAN13/t1++92W3d1+/N2e" +
  "3t1+/d2e391+/t2e4OL+Iu6A+uEj3X7Z3Zbv3X7a3Z7w3X7b3Z7x3X7c3Z7y4h4j7oDy4SPdfuHG/913" +
  "+91+4s7/3Xf83X7jzv/dd/3dfuTO/913/nndlvt43Z78e92e/Xrdnv7iViPugPLhI91u891m9H63IAjd" +
  "bvPdZvQ2Ad1u9d1m9jYB3W733Wb4TiN+3XHR3XfSB5/dd9Pdd9TdbvndZvpOI37dcdXdd9YHn9131913" +
  "2N1u591m6E4jRiNeI1Z4xvhHe87/X3rO/1ftQyTA7VMmwCEAACIswCIuwCEwwDYBITHANgAhMsA2ACE4" +
  "wDYAGAjdbvXdZvY2AN1u891m9H63KHzdXuXdVuYhKgA56wEEAO2w3W733Wb4TiNGeAftYt1++4FP3X78" +
  "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" +
  "BgAZTpEoFsVo3X7zzQ1FwbcgCmjdfvPNcEK3KAOvGAI+Ad13+t3L/GbKzS4hMMBee7coJiEywDYBITPA" +
  "NgAhNsA2ACExwDYAITDANgA6G8e3ys0uzcJCw80u7UsWwMX94f1+ELcoS3u3IEfdfvu3IAbdfvq3KDsh" +
  "MsA2ACEzwDYBITbANgAhMcA2ACE4wDYA3X77tygFAQEAGAMB/wAhNMBxITXANgA6G8e3KDDNwkIYKyEP" +
  "AAl+tygjOjjAtyAdITLANgEhM8A2ACE2wDYAITjANgE6G8e3KAPNwkI6MsDdd/vdfv7mEN139d029gDd" +
  "fvu3yuwvETvAIQsAOesBBADtsK/dvvjdnvk+AN2e+j4A3Z774gkv7oAH5gHdd/fdfvbdtvUgB91+97fK" +
  "yi/dfve3KBAhBAA56yELADkBBADtsBgYKhbAEQoAGU4jft1x8d138gef3Xfz3Xf0IQoAOeshBAA5AQQA" +
  "7bA6NsA83Xf7ITbA3X77dyoWwBEMABluJgDdTvsGAL/tQut6B+1i3U753Ub6xd1O991G+MXNyWPx8a+T" +
  "Tz4Amkc+AJ1fn5RX7UMswO1TLsD9KhbA/U4M3X77kTg3ITLANgAhMcA2ASEAACI7wCI9wBgi3X773bb6" +
  "3bb53bb4IBQhMsA2AP0qFsD9fgwyNsAhMcA2ATozwN13+7fKujLdfvbdtvXKpTI6NsA83Xf7ITbA3X77" +
  "dyoWwN11+N10+d1++N139t1++d13991u9t1m9xEMABl+3Xf63Xf03Tb1AN1++9139t029wDdfvTdlvbd" +
  "d/rdfvXdnvfdd/vdfvrdd/Hdfvvdd/IHn91389139N1++N13+t1++d13+91u+t1m+xEKABl+3Xf6I37d" +
  "d/vdfvrdd/jdfvvdd/kHn913+t13+29n5d1u+N1m+eXdXvHdVvLdbvPdZvTNyWPx8TMz1d1179108K/d" +
  "lu3dd/g+AN2e7t13+T4A3Z7v3Xf6n92W8N13+xEswCELADkBBADtsDo1wN139SoWwN119t10991+9t13" +
  "+t1+9913+91u+t1m+xEMABl+3Xf73Xf43Tb5AN1++N13+t1++d13+93L+X4oEN1++MYB3Xf63X75zgDd" +
  "d/vdTvrdRvvLKMsZecb8T3jO/0fdfvUWAJF6mOJZMe6A8osy3U723Ub3IQoACU4jRngH7WLlxd1e8d1W" +
  "8t1u891m9M3JY/HxTUQ6NMDdd/vVxREowCEHADnrAQQA7bDB0d1z9N1y9d1x9t1w9wYE3cv3Lt3L9h7d" +
  "y/Ue3cv0HhDu3X77PSBd3X7w3Yb03Xf43X7x3Y713Xf53X7y3Y723Xf63X7z3Y733Xf7ESjAIQsAOQEE" +
  "AO2wKhbATiNGeAefX1d53Zb4eN2e+Xvdnvp63Z774g8y7oDyhDLtQyjA7VMqwBho3X7w3Zb03Xf43X7x" +
  "3Z713Xf53X7y3Z723Xf63X7z3Z733Xf7ESjAIQsAOQEEAO2wKhbATiN+RwefX1evkU8+AJhHIQAA7VLr" +
  "3X74kd1++Zjdfvqb3X77muJ5Mu6A8oQy7UMowO1TKsA6NcA8MjXAOjbAKhbAEQwAGU6ROCEhM8A2ACEx" +
  "wDYBGBUhM8A2ACoWwBEMABl+MjbAITHANgE6MsC3IFk6M8C3IFPtSyzA7VsuwMt6KEc6ica3IEHVxRHA" +
  "ACEAAM3JY/HxTUQ+CMsoyxnLGssbPSD17VMswO1DLsA+gLs+/5o+/5k+/5jiDTPugPIZMyEAACIswCIu" +
  "wN353eHJ3eXdIQAA3Tkh9P85+e1LKMDtWyrAeSExyYYjT3iOI0d7jiNfeo5X3XH83XD93XP+3XL/ESDA" +
  "IQAAOesBBADtsN1+9N2G/N13+N1+9d2O/d13+d1+9t2O/t13+t1+992O/913+yEAADnrIQQAOQEEAO2w" +
  "3X703Xf43X713Xf53X723Xf63X733Xf7Bgjdy/su3cv6Ht3L+R7dy/geEO6v3b783Z79PgDdnv4+AN2e" +
  "/+LSM+6A8t003X703Xf83X71xgbdd/3dfvbOAN13/t1+984A3Xf/7UskwComwHjGAUcwASPlxd1e/N1W" +
  "/d1u/t1m/82QDrcgI+1LJMAqJsB4xgZHMAEj5cXdXvzdVv3dbv7dZv/NkA63ypA13X74xgbdd/zdfvnO" +
  "AN13/d1++s4A3Xf+3X77zgDdd/8hBAA56yEIADkBBADtsN3L/34oIN1+/MYH3Xf43X79zgDdd/ndfv7O" +
  "AN13+t1+/84A3Xf73W743Wb53V763Vb7BgPLKssbyxzLHRD2BgMpyxPLEhD5Afn/CU1Ee87/X3rO/91x" +
  "9d1w9t1z99029AAhAAAiKMAiKsAhicY2ACGKxjYAw5A13cv/fsqQNe1LJMAqJsB4xgFHMAEj5cXdXvTd" +
  "VvXdbvbdZvfNkA63ICLtSyTAKibAeMYGRzABI+XF3V703Vb13W723Wb3zZAOtyho3U743Ub53W763Wb7" +
  "3cv7figY3X74xgdP3X75zgBH3X76zgBv3X77zgBnWVAGA8ssyx3LGssbEPYcIAQUIAEjZWpTHgAGA8si" +
  "7WoQ+jMz1d119t109yEAACIowCIqwCGJxjYAIYrGNgARIMAhAAA5AQQA7bDd+d3hyd3l3SEAAN05IeP/" +
  "OfntSyzA7VsuwHkhNcmGI094jiNHe44jX3qOV91x7N1w7d1z7t1y7+1LJMAqJsDdfuyBT91+7YhH3X7u" +
  "jV/dfu+M3XH83XD93XP+3Xf/3X783Xf43X793Xf53X7+3Xf63X7/3Xf7Bgjdy/su3cv6Ht3L+R7dy/ge" +
  "EO4hDQA56yEVADkBBADtsO1LIMAqIsDdcfR4xgHdd/V9zgDdd/Z8zgDdd/fdy+9+wrI43U783X79xghH" +
  "3X7+zgD95d134f3h3X7/zgD95d134v3hxf3l/eXF3V703Vb13W723Wb3zckR/eHBtyAY7VsgwCoiwHrG" +
  "BFcwASP95cXNyRG3yvo83X7wxgjdd/TdfvHOAN139d1+8s4A3Xf23X7zzgDdd/chFQA56yERADkBBADt" +
  "sN3L934oIN1+9MYH3Xf43X71zgDdd/ndfvbOAN13+t1+984A3Xf73X743Xfy3X753Xfz3X763Xf03X77" +
  "3Xf1BgPdy/Uu3cv0Ht3L8x7dy/IeEO79KhTA/X4Gt8pTON1+8t13++1LIMDtWyLAPgjLKssbyxjLGT0g" +
  "9d1x991w+N1z+d1y+st6KBh5xgfdd/d4zgDdd/h7zgDdd/l6zgDdd/rdTvfdRvjLOMsZyzjLGcs4yxnd" +
  "bvt5zQgM3Xf23X773Xf37UsgwO1bIsA+CMsqyxvLGMsZPSD13XH43XD53XP63XL7y3ooGHnGB913+HjO" +
  "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" +
  "1gPap0f9KhTA/X4l3Xf/t8o+ShEgwCERADnrAQQA7bDdfvzdd+vdfv3dd+zdfv7dd+3dfv/dd+4GCN3L" +
  "7i7dy+0e3cvsHt3L6x4Q7iERADnrIQAAOQEEAO2w3cvufigg3X7rxgfdd/zdfuzOAN13/d1+7c4A3Xf+" +
  "3X7uzgDdd//dTvzdRv3dcf7dcP/dy/8+3cv+Ht3L/z7dy/4e3cv/Pt3L/h7dfv7dd/XdfuvGBd13+N1+" +
  "7M4A3Xf53X7tzgDdd/rdfu7OAN13+yERADnrIQ0AOQEEAO2w3cv7figg3X7rxgzdd/zdfuzOAN13/d1+" +
  "7c4A3Xf+3X7uzgDdd//dfvzdd/7dfv3dd//dy/8+3cv+Ht3L/z7dy/4e3cv/Pt3L/h7dfv7dd/YRJMAh" +
  "EQA56wEEAO2w3X783Xf33X793Xf43X7+3Xf53X7/3Xf6Bgjdy/ou3cv5Ht3L+B7dy/ceEO4hAAA56yEM" +
  "ADkBBADtsN1+98YH3Xf73X74zgDdd/zdfvnOAN13/d1++s4A3Xf+3cv6figOIQAAOeshEAA5AQQA7bDB" +
  "xcs4yxnLOMsZyzjLGd1x/91O+91G/N3L/n4oDN1+98YOT91++M4AR8s4yxnLOMsZyzjLGd1x/t1O9d1+" +
  "9pE4Kt1G/91+/pA4HsVoec0IDMEqFMARJQAZXsv7kyAHxWh5zboNwQQY3AwY0N353eHJ3eXdIQAA3Tkh" +
  "6P85+c0gRt02/wDdfv/dd/3dNv4A3X793Xf73X7+3Xf8BgLdy/sm3cv8FhD2PsXdhvvdd/0+x92O/N13" +
  "/t1+/d136N1+/t136d1+6MYC3Xfq3X7pzgDdd+vdburdZut+3Xf+t8r6TN1e/hzB4eXFc+HlRuHlI054" +
  "5h/dcezdburdZutuFgDdd+3dcu571iggHGkmACkpKSkp3V7t3VbuGSl89nhnzyEAAN/D+kx91sja+kxo" +
  "r2dfBgMpj8sTEPrdde/ddPDdd/Hdc/Jpr2dPBgMpj8sREPrddfPddPTdd/XdcfbtWyDAKiLABgjLLMsd" +
  "yxrLGxD23XP33XL43XX53XT67VskwComwAYIyyzLHcsayxsQ9t1z+91y/N11/d10/t1+98YGT91++M4A" +
  "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" +
  "zgDdd+vdfvXOAN137N1+9rcoDiEUADnrIQUAOQEEAO2w3U743Ub5yzjLGcs4yxnLOMsZ3XH33X78xgFP" +
  "3X79zgBH3X7+zgBf3X7/zgBX3XH43XD53XP63XL7egfmAd137XnGB9137njOAN1373vOAN138HrOAN13" +
  "8d1+7bcoGN1+7t13+N1+7913+d1+8N13+t1+8d13+91m+N1u+cs9yxzLPcscyz3LHMXV3W73fM0IDG/R" +
  "wd1+6JXK3lfdfvLdd/jdfvPdd/ndfvTdd/rdfvXdd/vdfva3KBjdfundd/jdfurdd/ndfuvdd/rdfuzd" +
  "d/vdbvjdZvnLPMsdyzzLHcs8yx3ddfvdfvzGBN138t1+/c4A3Xfz3X7+zgDdd/Tdfv/OAN139d1+8t13" +
  "/N1+8913/d1+9N13/t1+9d13/91+9QfmAd139t1+8sYH3Xf33X7zzgDdd/jdfvTOAN13+d1+9c4A3Xf6" +
  "3X72tygY3X733Xf83X743Xf93X753Xf+3X763Xf/3Wb83W79yz3LHMs9yxzLPcscxdXdbvt8zQgMb9HB" +
  "3X7olcreV91u6d1m6v3l491u6+Pj3Wbs4/3h3X7sB+YB3Xf73X7pxgfdd/zdfurOAN13/d1+684A3Xf+" +
  "3X7szgDdd//dfvu3KBTdbvzdZv395ePdbv7j491m/+P94cs8yx3LPMsdyzzLHd1+7bcoBt1O7t1G78s4" +
  "yxnLOMsZyzjLGXnNCAxP3X7okShdIQoAOeshBQA5AQQA7bDdfvu3KA4hCgA56yEYADkBBADtsN1u7t1m" +
  "78s8yx3LPMsdyzzLHd1O8t1G891+9rcoBt1O991G+Ms4yxnLOMsZyzjLGXnNCAxP3X7okSAFIcTANgHN" +
  "/0XNQ0rNf0/Nik/NEGLNnxbNrRfNeyXNjBjNERnNp2LNQWI6xMC3KAndfubN+VLDUlM6w8C3ylJTDjzF" +
  "zYpgwQ0g+N1O5gYAA91e5xYAeZN4muI7WO6A8lRY3X7m3Xf/3TT/3X7/3Xf+B5/dd/8YB6/dd/7dd//d" +
  "fv7dd+bNn0/DUlPNimAhQAHNq18hAEDlEQAAZc3JYc3cYc3wYS4/PgHNRGAhAAHlKi/J5RFgASEAAs1L" +
  "YSFAAc0EYiFAAc2WXyEIes8h2ljNlmIhhnrPIexYzZZiIYh7zyEDWc2WYs2KYM2XYHvmMCj1zYpgzZdg" +
  "e+YwIPXJUE9DS0VUIFBMQVRGT1JNRVIAZm9yIFNlZ2EgTWFzdGVyIFN5c3RlbQBQcmVzcyAxIHRvIHN0" +
  "YXJ0AC4AzeFfLgDN918uAM3XX81nWM3aCrco980QC82KYCFAAc2rXyEAQOURAABlzclhze4UIUABzZZf" +
  "zSNTGNJwb2NrZXQtcGxhdGZvcm1lci1zbXMAUG9ja2V0IFBsYXRmb3JtZXIgU01TIEVuZ2luZQBHZW5l" +
  "cmF0ZWQgYnkgcG9ja2V0LXBsYXRmb3JtZXItdG8tc21zIHdlYiBleHBvcnRlci4AOjvIt8g+n9N/Pr/T" +
  "fzpQyLcgBD7f0386Uci3IAQ+/9N/ITvINgDJOjvIt8A6Scj2kNN/OkrI9rDTfzpQyLcgFzpNyOYP9sDT" +
  "fzpOyOY/0386S8j20NN/OlHItyAQOk/I5g/24NN/OkzI9vDTfyE7yDYByc24WSFDyDYB0cHF1e1DPMjt" +
  "Qz7I7UNAyCFCyDYAIUbINgAhRMg2nyE7yDYBySFDyDYAycHh5cXlzSta8SFDyDYAyf0hO8j9bgDJPp/T" +
  "fz6/038+39N/Pv/Tf8nd5d0hAADdOfX9IUXI/X4A3Xf+r913//1OADo7yLcoWDpJyOYPXxYA4eUZPg+9" +
  "PgCc4rxa7oDyxFoRDwAYCTpJyOYPgV8Xn3v2kNN/OkrI5g9fFgDh5Rk+D70+AJzi6FrugPLwWhEPABgJ" +
  "OkrI5g+BXxefe/aw0386UMi3KAk6Usj20NN/GDI6O8i3KCw6S8jmD18WAOHlGT4PvT4AnOIpW+6A8jFb" +
  "EQ8AGAk6S8jmD4FfF5979tDTfzpRyLcoCTpTyPbw038YMjo7yLcoLDpMyOYPbyYA0dUZPg+9PgCc4mpb" +
  "7oDyclsBDwAYCTpMyOYPgU8Xn3n28NN/3fnd4cnd5d0hAADdOfXdfgQyRcg6O8i3ym9cOknI5g9PHgD9" +
  "IUXI/X4A3Xf+r913/3ndhv5He92O/1/9TgA+D7g+AJviyVvugPLRWxEPABgJOknI5g+BXxefe/aQ0386" +
  "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" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//+xGpmZAEw=";
