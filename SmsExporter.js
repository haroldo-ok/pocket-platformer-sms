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
    'rotatingFireballCenter': 16,
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
    const mirrorH = px => px ? px.map(row => [...row].reverse()) : null;

    const get = name => sprites[name] || null;
    const startFlag  = get('START_FLAG_SPRITE');
    const finishFlag = get('FINISH_FLAG_SPRITE');
    const trampS     = get('TRAMPOLINE_SRPITE') || get('TRAMPOLINE_SPRITE');
    const coinS      = get('COIN_SPRITE');
    const pIdle      = get('PLAYER_IDLE_SPRITE');
    const pWalk      = get('PLAYER_WALK_SPRITE');
    const pJump      = get('PLAYER_JUMP_SPRITE');
    const flagClosed = get('FINISH_FLAG_CLOSED_SPRITE');
    const npcS       = get('NPC_SPRITE');
    const tpS        = get('TRIGGERED_PLATFORM');

    // Tile 256: start flag
    startFlag  ? encodeSprite8(startFlag,  0) : encodeBlank();
    // Tile 257: finish flag
    finishFlag ? encodeSprite8(finishFlag, 0) : encodeBlank();
    // Tile 258: blank (spike is a BG tile)
    encodeBlank();
    // Tile 259: trampoline
    trampS     ? encodeSprite8(trampS,     0) : encodeBlank();
    // Tile 260: coin
    coinS      ? encodeSprite8(coinS,      0) : encodeBlank();
    // Tile 261: player idle (right)
    pIdle      ? encodeSprite8(pIdle,      0) : encodeBlank();
    // Tile 262: player walk0 (right)
    pWalk      ? encodeSprite8(pWalk,      0) : encodeBlank();
    // Tile 263: player walk1 (right)
    pWalk      ? encodeSprite8(pWalk,      1) : encodeBlank();
    // Tile 264: player jump (right)
    pJump      ? encodeSprite8(pJump,      0) : encodeBlank();
    // Tile 265: finish flag closed
    flagClosed ? encodeSprite8(flagClosed, 0) : encodeBlank();
    // Tile 266: NPC
    npcS ? encodeSprite8(npcS, 0) : encodeBlank();
    // Tiles 267-270: barrel cannon (right, left, top, bottom)
    {
      const barrelSObj = get('BARREL_CANNON');
      const bPx = barrelSObj ? (barrelSObj.animation[0].sprite) : null;
      if (bPx) {
        tiles.push(encodeTile4bpp(bPx.map(row => [...row].reverse()), palette)); // 267 right (H-flip)
        tiles.push(encodeTile4bpp(bPx, palette));                                // 268 left (base)
        tiles.push(encodeTile4bpp(
          Array.from({length:8}, (_,r) => Array.from({length:8}, (_,c) => bPx[7-c][r])), palette)); // 269 top
        tiles.push(encodeTile4bpp(
          Array.from({length:8}, (_,r) => Array.from({length:8}, (_,c) => bPx[c][7-r])), palette)); // 270 bottom
      } else {
        encodeBlank(); encodeBlank(); encodeBlank(); encodeBlank();
      }
    }
    // Tile 271: triggered platform
    tpS ? encodeSprite8(tpS, 0) : encodeBlank();
    // Tiles 272-275: mirrored player (idle-L, walk0-L, walk1-L, jump-L)
    pIdle ? tiles.push(encodeTile4bpp(mirrorH(pIdle.animation[0].sprite), palette)) : encodeBlank();
    pWalk ? tiles.push(encodeTile4bpp(mirrorH(pWalk.animation[0].sprite), palette)) : encodeBlank();
    pWalk ? tiles.push(encodeTile4bpp(mirrorH(pWalk.animation[1].sprite), palette)) : encodeBlank();
    pJump ? tiles.push(encodeTile4bpp(mirrorH(pJump.animation[0].sprite), palette)) : encodeBlank();
    // Tile 276: rotating fireball
    const rfballS = get('ROTATING_FIREBALL_CENTER');
    rfballS ? encodeSprite8(rfballS, 0) : encodeBlank();

    const out = new Uint8Array(tiles.length * BYTES_PER_TILE);
    tiles.forEach((t, i) => out.set(t, i * BYTES_PER_TILE));
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

    // Rotating fireball table: per level: rfb_count, per ball: speed, amount, forwards
    function buildRfballTable(levels) {
      const bytes = [];
      for (const level of levels) {
        const balls = (level.levelObjects || []).filter(o => o.type === 'rotatingFireballCenter');
        bytes.push(Math.min(balls.length, 8));
        for (const ball of balls.slice(0, 8)) {
          const ea = ball.extraAttributes || {};
          const speed = Math.min(Math.max(ea.speed || 3, 1), 10);
          const amount = Math.min(Math.max(ea.fireBallsAmount || 3, 1), 8);
          const forwards = (ea.movementDirection !== 'backwards') ? 1 : 0;
          bytes.push(speed);
          bytes.push(amount);
          bytes.push(forwards);
        }
      }
      return new Uint8Array(bytes);
    }
    const rfballTable = buildRfballTable(levels);

    const parts = [header, physicsBytes, new Uint8Array(palette), bgTiles, spriteSheet, ...encodedLevels, npcTable, tpTable, rfballTable];
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDXmoh" +
  "AMB+BgBwEQHAAW8J7bAypMjNmG7NtGj7zW9idhj9ZGV2a2l0U01TAAAAw51q7aPto+2j7aPto+2j7aPt" +
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
  "3n3OAN1333zOAN134N1+/MYG3Xfh3X79zgDdd+Ldfv7OAN13491+/84A3Xfk3Tb/ACF9xt1+/5bSZyXd" +
  "Tv8GAGlgKQkpKQkp3XX73XT83X77xq3dd/3dfvzOxd13/t1+/d135d1+/t135t1+5d13/d1+5t13/t1u" +
  "/d1m/hEYABl+t8phJd1+5cYE3Xfn3X7mzgDdd+jdbufdZuheI1YjI34rbmcGCMssyx3LGssbEPbdc+nd" +
  "curddevddOzdbuXdZuZeI1YjTiNuBgjLLcsZyxrLGxD23XP33XL43XH53XX63X7lxhTdd+3dfubOAN13" +
  "7t1u7d1m7n7dd/vdNvwA3X773Xf93X783Xf+3cv8figQ3X77xgHdd/3dfvzOAN13/t1O/d1G/ssoyxl4" +
  "B+1i3X73kU/dfviYR91++Z1f3X76nFfdfvvdd/bdfvzdd/cHn913+N13+d1+9oFv3X73iGfdfviL/eXd" +
  "d8/94d1++Yrdde/ddPD95ePddfHj/eHdd/LVxREswCEuADnrAQQA7bDB0d1+5cYV3Xfz3X7mzgDdd/Td" +
  "fuXGGd139d1+5s4A3Xf23X7lxhDdd/fdfubOAN13+N1+5cYS3Xf53X7mzgDdd/rdy/5+wuoj3X7d3Zbp" +
  "3X7e3Z7q3X7f3Z7r3X7g3Z7s4sci7oD66iPdfunGBN13+91+6s4A3Xf83X7rzgDdd/3dfuzOAN13/t1+" +
  "+92W3d1+/N2e3t1+/d2e391+/t2e4OIHI+6A+uoj3X7Z3Zbv3X7a3Z7w3X7b3Z7x3X7c3Z7y4icj7oDy" +
  "6iPdfuHG/913+91+4s7/3Xf83X7jzv/dd/3dfuTO/913/nndlvt43Z78e92e/Xrdnv7iXyPugPLqI91u" +
  "891m9H63IAjdbvPdZvQ2Ad1u9d1m9jYB3W733Wb4TiN+3XHR3XfSB5/dd9Pdd9TdbvndZvpOI37dcdXd" +
  "d9YHn91319132N1u591m6E4jRiNeI1Z4xvhHe87/X3rO/1ftQyTA7VMmwCEAACIswCIuwCEwwDYBITHA" +
  "NgAhMsA2ACE4wDYAGAjdbvXdZvY2AN1u891m9H63KHzdXuXdVuYhKgA56wEEAO2w3W733Wb4TiNGeAft" +
  "Yt1++4FP3X78iEfdfv2NX91+/oxX3W7l3WbmcSNwI3Mjct1e591W6CEqADnrAQQA7bDdbvndZvpOI0Z4" +
  "B+1i3X77gU/dfvyIR91+/Y1f3X7+jFfdbufdZuhxI3AjcyNy3W7l3WbmI0YjXkhD3W7n3WboI1Yjbt1y" +
  "/d11/t1u7d1m7m4mAAkR+H8pP8scyx3tUjgzPgi5PgGY4rYk7oD63iTdfv3WQN1+/hc/H95/OBY+gN2+" +
  "/T4B3Z7+4tck7oD63iQeABgCHgHdfuXGF0/dfubOAEd7tyhv3W713Wb2NgDdbvPdZvR+tyhfCjwC1mQ4" +
  "WN1e5d1W5sUhLAA56wEIAAkBBADtsN1e5d1W5iEsADkBBADtsMHdXuXdVubFISwAOesBDAAJAQQA7bDd" +
  "XufdVughLAA5AQQA7bDB3W7z3Wb0NgCvAhgCrwLdNP/DASERcskhAAA5AQQA7bARdskhBAA5AQQA7bDd" +
  "+d3hyd3l3SEAAN05IfT/OfndNv4AIX3G3X7+ltL3Jt1O/gYAaWApCSkpCSnddfrddPvdfvrGrd13/N1+" +
  "+87F3Xf93X783Xf63X793Xf73W763Wb7ERgAGX63yvEm3W783Wb9I0YjXngqP8CVT3uc3XH03Xf13U78" +
  "3Ub9IQUACUYjXt1w9t1z991+/MYU3Xf43X79zgDdd/ndbvjdZvl+3Xf63Tb7AN1++t13/N1++913/d3L" +
  "+34oEN1++sYH3Xf83X77zgDdd/3dTvzdRv3LKMsZyyjLGcsoyxk+wN2+9j4A3Z734mkm7oAH5gHdd/rd" +
  "fvcH5gHdd/vdNv8A3X7/kTBv3W743Wb5XhYA3XP83XL9y3ooBxPdc/zdcv3dRvzdVv3LKssY3X70kF/d" +
  "fvWaV91u/yYAKSkpGX3W+HwXPx/efzgor70+AZzizibugPrsJt1++7cgFd1++rcgD1Wv9g9f3W72JgDF" +
  "zXFrwd00/xiL3TT+w5Ul3fnd4cnd5d0hAADdOfXNzB0zM9UOACoUwBEEABlGeZAwGOHlbtHVEwYAeJUw" +
  "BhMTEwQY9jMz1QwY3NHV3fnd4ckAAgQHCQsNDxIUFhgaHR8hIyUnKSsuMDI0Njg6PD4/QUNFR0lLTE5Q" +
  "UlNVV1haW11eYGFjZGVnaGlrbG1ub3BxcnN0dXZ3d3h5eXp7e3x8fX19fn5+f39/f39/f39/f39+fn59" +
  "fX18fHt7enl5eHd3dnV0c3JxcG9ubWxraWhnZWRjYWBeXVtaWFdVU1JQTkxLSUdFQ0E/Pjw6ODY0MjAu" +
  "KyknJSMhHx0aGBYUEg8NCwkHBAIA/vz59/Xz8e7s6ujm4+Hf3dvZ19XS0M7MysjGxMLAv727ube1tLKw" +
  "rq2rqaimpaOioJ+dnJuZmJeVlJOSkZCPjo2Mi4qJiYiHh4aFhYSEg4ODgoKCgYGBgYGBgYGBgYGCgoKD" +
  "g4OEhIWFhoeHiImJiouMjY6PkJGSk5SVl5iZm5ydn6Cio6WmqKmrra6wsrS1t7m7vb/AwsTGyMrMztDS" +
  "1dfZ293f4ePm6Ors7vHz9ff5/P5/f39/f39+fn59fX18fHt7enl5eHd3dnV0c3JxcG9ubWxraWhnZWRj" +
  "YWBeXVtaWFdVU1JQTkxLSUdFQ0FAPjw6ODY0MjAuKyknJSMhHx0aGBYUEg8NCwkHBAIA/vz59/Xz8e7s" +
  "6ujm4+Hf3dvZ19XS0M7MysjGxMLBv727ube1tLKwrq2rqaimpaOioJ+dnJuZmJeVlJOSkZCPjo2Mi4qJ" +
  "iYiHh4aFhYSEg4ODgoKCgYGBgYGBgYGBgYGCgoKDg4OEhIWFhoeHiImJiouMjY6PkJGSk5SVl5iZm5yd" +
  "n6Cio6WmqKmrra6wsrS1t7m7vb/AwsTGyMrMztDS1dfZ293f4ePm6Ors7vHz9ff5/P4AAgQHCQsNDxIU" +
  "FhgaHR8hIyUnKSsuMDI0Njg6PD5AQUNFR0lLTE5QUlNVV1haW11eYGFjZGVnaGlrbG1ub3BxcnN0dXZ3" +
  "d3h5eXp7e3x8fX19fn5+f39/f3/d5d0hAADdOSH5/zn53Xf9zfwm6z4CMv//3Tb/AF1UE37dd/7dfv/d" +
  "lv0wFd1O/i4AfZEwBhMTEywY9uvdNP8Y3N1+/jJ7yD4I/SF7yP2WADAE/TYACN02/gDdNv8AKjXIIyPd" +
  "fv+W0jcrIXvI3X7+ltI3K91O/wYAaWApCU1EOjnIgU86OsiIR91x+91w/OHBxeUDAwrWEMIxK91u/iYA" +
  "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" +
  "wComwHjGBkcwASPlxd1e9N1W9d1u9t1m982QDrcoaN1O+N1G+d1u+t1m+93L+34oGN1++MYHT91++c4A" +
  "R91++s4Ab91++84AZ1lQBgPLLMsdyxrLGxD2HCAEFCABI2VqUx4ABgPLIu1qEPozM9XddfbddPchAAAi" +
  "KMAiKsAhicY2ACGKxjYAESDAIQAAOQEEAO2w3fnd4cnd5d0hAADdOSHj/zn57UsswO1bLsB5IXbJhiNP" +
  "eI4jR3uOI196jlfdcezdcO3dc+7dcu/tSyTAKibA3X7sgU/dfu2IR91+7o1f3X7vjN1x/N1w/d1z/t13" +
  "/91+/N13+N1+/d13+d1+/t13+t1+/913+wYI3cv7Lt3L+h7dy/ke3cv4HhDuIQ0AOeshFQA5AQQA7bDt" +
  "SyDAKiLA3XH0eMYB3Xf1fc4A3Xf2fM4A3Xf33cvvfsIBQt1O/N1+/cYIR91+/s4A/eXdd+H94d1+/84A" +
  "/eXdd+L94cX95f3lxd1e9N1W9d1u9t1m983JEf3hwbcgGO1bIMAqIsB6xgRXMAEj/eXFzckRt8pJRt1+" +
  "8MYI3Xf03X7xzgDdd/XdfvLOAN139t1+884A3Xf3IRUAOeshEQA5AQQA7bDdy/d+KCDdfvTGB913+N1+" +
  "9c4A3Xf53X72zgDdd/rdfvfOAN13+91++N138t1++d13891++t139N1++9139QYD3cv1Lt3L9B7dy/Me" +
  "3cvyHhDu/SoUwP1+BrfKokHdfvLdd/vtSyDA7VsiwD4IyyrLG8sYyxk9IPXdcffdcPjdc/ndcvrLeigY" +
  "ecYH3Xf3eM4A3Xf4e84A3Xf5es4A3Xf63U733Ub4yzjLGcs4yxnLOMsZ3W77ec0IDN139t1++9139+1L" +
  "IMDtWyLAPgjLKssbyxjLGT0g9d1x+N1w+d1z+t1y+8t6KBh5xgfdd/h4zgDdd/l7zgDdd/p6zgDdd/vd" +
  "TvjdRvnLOMsZyzjLGcs4yxkM3W73ec0IDE/9KhTA/UYG3X72kCgHeZAoA68YAj4BtyhH7UskwComwN1x" +
  "+HjGCN13+X3OAN13+nzOAN13+91W8t1u891m9B4ABgPLIu1qEPp73Zb4et2e+X3dnvp83Z774p9B7oD6" +
  "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" +
  "ADkBBADtsCEywDYBITbANgAhMcA2ACEwwDYAITjANgA6G8e3KBbNEUwYET5D3Yb9bz7AzgBnfrcgAjYB" +
  "3TT9w/1G3fnd4cnd5d0hAADdOfXdd//ddf4OACEbx3mWMDQRi8YGAGlgKQkZ6xpH3X7/kCAea2Ij3X7+" +
  "liAVExMatygKOhzH1gE+ABcYCTocxxgEDBjFr9353eHJ3eXdIQAA3Tkh6/85+Tocx9YBPgAXMhzH3Tb/" +
  "ACEbx91+/5bSV07dTv8GAGlgKQnddf3ddP4+i92G/d13+z7G3Y7+3Xf83W773Wb8ft13/d1++913+d1+" +
  "/N13+t1u+d1m+iN+3Xf+3W773Wb8IyNOebcoBTocxxgIOhzH1gE+ABfdd/oqFMDddfvddPx5tygh3X76" +
  "tygN3U773Ub8IQ8ACUYYC91O+91G/CEQAAlGeBge3X76tygN3U773Ub8IREACX4YC91u+91m/BESABl+" +
  "tygEBgAYAq9HX1Ddbv4mACkpKSkp3X795h9PBgAJKXz2eGfP69/dfvq3ylFO7VsgwCoiwAYIyyzLHcsa" +
  "yxsQ9jMz1d117d107u1bJMAqJsAGCMssyx3LGssbEPbdc+/dcvDddfHddPLdbv2vZ08GAymPyxEQ+t11" +
  "89109N139d1x9t1u/q9nTwYDKY/LERD63XX33XT43Xf53XH63X7rxgZP3X7szgBH3X7tzgBf3X7uzgBX" +
  "3X7zkd1+9JjdfvWb3X72muKpTe6A8lFO3X7zxgjdd/vdfvTOAN13/N1+9c4A3Xf93X72zgDdd/7dfuvd" +
  "lvvdfuzdnvzdfu3dnv3dfu7dnv7i6U3ugPJRTt1+78YIT91+8M4AR91+8c4AX91+8s4AV91+95HdfviY" +
  "3X75m91++priGU7ugPJRTt1+98YIT91++M4AR91++c4AX91++s4AV91+75HdfvCY3X7xm91+8priSU7u" +
  "gPJRTiHEwDYB3TT/wy1M3fnd4cnd5d0hAADdOfXdd//ddf4OACG9x3mWMDQRHccGAGlgKQkZ6xpH3X7/" +
  "kCAea2Ij3X7+liAVExMatygKOr/H1gE+ABcYCTq/xxgEDBjFr9353eHJ7VsUwLcoEn23KAchCQAZfhgX" +
  "IQoAGX4YEH23KAchCwAZfhgFIQwAGX63KAQWAF/JEQAAyd3l3SEAAN059d02/wAhvcfdfv+WMFHdTv8G" +
  "AGlgKQnrIR3HGesaT2tiI37dd/4TExpHtygFOr/HGAg6v8fWAT4AF2/FeM2uTsHdbv4mACkpKSkpeeYf" +
  "BgBPCSl89nhnz+vf3TT/GKbd+d3hyTrAx7fI7UsswCouwK+5mD4AnT4AnOJoT+6A8CHAxzYAyd3l3SEA" +
  "AN05Iev/OfntWyDAKiLABgjLLMsdyxrLGxD23XP13XL23XX33XT4KiTA7VsmwAYIyyrLG8scyx0Q9t1O" +
  "9d1G9v3l491u9+Pj3Wb44/3h3cv4figk3X71xgdP3X72zgBH3X73zgD95d136f3h3X74zgD95d136v3h" +
  "yzjLGcs4yxnLOMsZ3XH93X71xgXdd/ndfvbOAN13+t1+984A3Xf73X74zgDdd/zdTvndRvr95ePdbvvj" +
  "491m/OP94d3L/H4oJN1++cYHT91++s4AR91++84A/eXdd+n94d1+/M4A/eXdd+r94cs4yxnLOMsZyzjL" +
  "Gd1x/tX94U1Ey3ooHH3GB098zgBHe84A/eXdd+n94XrOAP3l3Xfq/eHLOMsZyzjLGcs4yxndcf/FAQgA" +
  "CcEwARPV/eFNRMt6KBoBBwAJTUR7zgD95d136f3hes4A/eXdd+r94cs4yxnLOMsZyzjLGd1+/d13791x" +
  "8N1+/t138d1x8t1+/d13891+/9139N02/wDdbv8mAClNRCEEADkJft13+iN+3Xf7b91++s0IDN13/CoU" +
  "wN11/d10/gEHAAlOebcoEd1+/JEgC91u+91++s1yDBhA3U793Ub+IQgACU55tygR3X78kSAL3W773X76" +
  "zcMMGCDdTv3dRv4hJQAJfrcoEk/L+d1+/JEgCd1u+91++s26Dd00/91+/9YD2vZQ/SoUwP1+Jd13/7fK" +
  "jVMRIMAhEQA56wEEAO2w3X783Xfr3X793Xfs3X7+3Xft3X7/3XfuBgjdy+4u3cvtHt3L7B7dy+seEO4h" +
  "EQA56yEAADkBBADtsN3L7n4oIN1+68YH3Xf83X7szgDdd/3dfu3OAN13/t1+7s4A3Xf/3U783Ub93XH+" +
  "3XD/3cv/Pt3L/h7dy/8+3cv+Ht3L/z7dy/4e3X7+3Xf13X7rxgXdd/jdfuzOAN13+d1+7c4A3Xf63X7u" +
  "zgDdd/shEQA56yENADkBBADtsN3L+34oIN1+68YM3Xf83X7szgDdd/3dfu3OAN13/t1+7s4A3Xf/3X78" +
  "3Xf+3X793Xf/3cv/Pt3L/h7dy/8+3cv+Ht3L/z7dy/4e3X7+3Xf2ESTAIREAOesBBADtsN1+/N13991+" +
  "/d13+N1+/t13+d1+/913+gYI3cv6Lt3L+R7dy/ge3cv3HhDuIQAAOeshDAA5AQQA7bDdfvfGB913+91+" +
  "+M4A3Xf83X75zgDdd/3dfvrOAN13/t3L+n4oDiEAADnrIRAAOQEEAO2wwcXLOMsZyzjLGcs4yxndcf/d" +
  "TvvdRvzdy/5+KAzdfvfGDk/dfvjOAEfLOMsZyzjLGcs4yxndcf7dTvXdfvaROCrdRv/dfv6QOB7FaHnN" +
  "CAzBKhTAESUAGV7L+5MgB8Voec26DcEEGNwMGNDd+d3hyd3l3SEAAN05Iej/OfnNb0/dNv8A3X7/3Xf9" +
  "3Tb+AN1+/d13+91+/t13/AYC3cv7Jt3L/BYQ9j7F3Yb73Xf9Psfdjvzdd/7dfv3dd+jdfv7dd+ndfujG" +
  "At136t1+6c4A3Xfr3W7q3Wbrft13/rfKSVbdXv4cweHlxXPh5Ubh5SNOeOYf3XHs3W7q3WbrbhYA3Xft" +
  "3XLue9YoIBxpJgApKSkpKd1e7d1W7hkpfPZ4Z88hAADfw0lWfdbI2klWaK9nXwYDKY/LExD63XXv3XTw" +
  "3Xfx3XPyaa9nTwYDKY/LERD63XXz3XT03Xf13XH27VsgwCoiwAYIyyzLHcsayxsQ9t1z991y+N11+d10" +
  "+u1bJMAqJsAGCMssyx3LGssbEPbdc/vdcvzddf3ddP7dfvfGBk/dfvjOAEfdfvnOAF/dfvrOAFfdfu+R" +
  "3X7wmN1+8ZvdfvKa4ulU7oDyhFXdfu/GCE/dfvDOAEfdfvHOAF/dfvLOAFfdfveR3X74mN1++Zvdfvqa" +
  "4hlV7oDyhFXdfvvGCE/dfvzOAEfdfv3OAF/dfv7OAFd53ZbzeN2e9HvdnvV63Z724klV7oD6hFXdfvPG" +
  "At13+91+9M4A3Xf83X71zgDdd/3dfvbOAN13/t1++5HdfvyY3X79m91+/prigVXugPKKVd02/gAYBN02" +
  "/gHdfv63wklW4eUjIyNOKhTA3XX93XT+ebcoEN1u/d1m/hEIABl+3Xf+GA7dXv3dVv4hBwAZft13/t1O" +
  "/t1+/rcoCa/dcf3dd/4YB6/dd/3dd/7dfv3dd/vdfv7dd/zdfuzdd/3dNv4ABgXdy/0m3cv+FhD23X79" +
  "3Ybt3Xf53X7+3Y7u3Xf63X753Xf93X763Xf+3cv9Jt3L/hbdfv3dd/ndfv72eN13+t1u+d1m+s/dbvvd" +
  "ZvzfweHlxTYA3TT/3X7/1hDaplMqFMARJQAZfrfKyVjdNv8A3U7/BgBpYCkJEQXIGd11/d10/t1+/cYC" +
  "3Xfq3X7+zgDdd+vdburdZutOebfKvlgM0eHl1XHdbv3dZv5e3W793Wb+I37dd/575h/13X7+3Xfs8d1u" +
  "6t1m624GAN137d1w7nnWBSAe3W7+JgApKSkpKd1e7d1W7hkpfPZ4Z88hAADfw75YfdZ42r5YSwYAEQAA" +
  "PgPLIcsQyxPLEj0g9d1+/t13+6/dd/zdd/3dd/713X773Xfv3X783Xfw3X793Xfx3X7+3Xfy8T4D3cvv" +
  "Jt3L8Bbdy/EW3cvyFj0g7dXFESDAIRcAOesBBADtsMHR3X773Xfz3X783Xf03X793Xf13X7+3Xf2Pgjd" +
  "y/Yu3cv1Ht3L9B7dy/MePSDt1cURJMAhFwA56wEEAO2wwdHdfvvdd/fdfvzdd/jdfv3dd/ndfv7dd/o+" +
  "CN3L+i7dy/ke3cv4Ht3L9x49IO3dfvPGBt13+91+9M4A3Xf83X71zgDdd/3dfvbOAN13/nndlvt43Z78" +
  "e92e/Xrdnv7i8VfugPKMWHnGCN13+3jOAN13/HvOAN13/XrOAN13/t1+892W+91+9N2e/N1+9d2e/d1+" +
  "9t2e/uIpWO6A8oxY3X73xghP3X74zgBH3X75zgBf3X76zgBX3X7vkd1+8JjdfvGb3X7ymuJZWO6A8oxY" +
  "3X7vxghP3X7wzgBH3X7xzgBf3X7yzgBX3X73kd1++Jjdfvmb3X76muKJWO6A+o9YrxgCPgG3ICr9KhTA" +
  "/V4lFgDL4t1u7CYAKSkpKSndTu3dRu4JKXz2eGfP69/B4eXFNgDdNP/dfv/WENpkVt353eHJIQAAIj/A" +
  "LgDDHmkhOsB+tygDPXfJNgUBOcAKPOYDAsnd5d0hAADdOSH2/zn53Xf+PgIy///dfv4yxcDdfv7NRwvt" +
  "UzXI7Us1yCEEAAkiN8gqNchOIwYAXhYAaWDN0GsqN8gZIjnIDgAhQ8AGAAk2AAx51oA48iHGwDYAAcXH" +
  "HgBrJgApKQkjIzYAHHvWEDjwIb3HNgAhvsc2ACG/xzYBIcDHNgAhG8c2ACEcxzYAIf//NgLdNv8AKjXI" +
  "IyNO3X7/kdIjW91O/wYAaWApCesqOcgZ491+9sYC3Xf83X73zgDdd/3dbvzdZv1O3X72xgHdd/jdfvfO" +
  "AN13+Xn+BygE1gggVzq9x9YwMFDtS73HBgBpYCkJ6yEdxxnr4eV+Eu1LvccGAGlgKQkRHccZ6xPdbvjd" +
  "Zvl+Eu1LvccGAGlgKQkRHccZ6xMT3W783Wb9ftYHPgEoAa8SIb3HNN1u/N1m/X7+CigE1gsgVzobx9Yw" +
  "MFDtSxvHBgBpYCkJ6yGLxhnr4eV+Eu1LG8cGAGlgKQkRi8YZ6xPdbvjdZvl+Eu1LG8cGAGlgKQkRi8YZ" +
  "6xMT3W783Wb9ftYKPgEoAa8SIRvHNN1u/N1m/X7WCcIdWzq+x9YIMHw6vsfdd/zdNv0A3X783Xf63X79" +
  "3Xf73cv6Jt3L+xY+rd2G+t13/D7H3Y773Xf94eV+3W783Wb9dzq+x913/N02/QDdy/wm3cv9Fj6t3Yb8" +
  "3Xf6Psfdjv3dd/vdfvrGAd13/N1++84A3Xf93W743Wb5ft1u/N1m/Xchvsc03TT/w4VZIcTANgAhw8A2" +
  "ACEAACJBwCI/wCYQIiDAZSIiwBEgwCYgIiTAZSImwCIswCIuwCIowCIqwCE4wDYAITbANgAhMMA2ACEx" +
  "wDYBITLANgAhM8A2ACE1wDYAITrANgAhOcA2ACE3wDYA3Tb/ACo1yCMj3X7/ltIfXN1O/wYAaWApCU1E" +
  "OjnIgd13/Do6yIjdd/3dbvzdZv0jI349IFvdbvzdZv1+3Xf6r913+913/N13/T4L3cv6Jt3L+xbdy/wW" +
  "3cv9Fj0g7cUhBgA5AQQA7bDBKjnICSNOBgALeAftYlhBVQ4APgPLIMsTyxI9IPftQyTA7VMmwBgG3TT/" +
  "w41b3X7+zR4e3X7+zQgqzeVpIUABzQZpIQAH5REAACY4zSRrzVUVIUABzfFo3fnd4clPBgDFzeVpwctA" +
  "KAUhPwAYAyEAAMXNMmnBBHjWCDjkxS4AzTJpwXnD7ljd5d0hAADdOSHk/zn5IQAA49025gAh//82AioU" +
  "wN11/t10/xEEABl+3Xfnr83uWM3lad1+5N13/t1+5d13/83yad1z/N1y/d1+/N135N1+/d135d1+/i/d" +
  "d/7dfv8v3Xf/3X7k3ab+3Xf63X7l3ab/3Xf73X763Xf93X773Xf+3X7k3Xf/OsbAtyhf3X7/5jDdd/86" +
  "qcW3IDDdfv+3KCo6x8BPBgADAzrIwF8WAHmTeJriLl3ugPI+XTrHwMYCMsfAzQgdGAPNsR3dfv8yqcXN" +
  "5WnNa2vNoBbNGhnNAmzNnGvN8mkzM9XDp1whJMB+IzLBx34jMsLHfiMyw8d+MsTH3V793Vb+4eXNsTI6" +
  "MMC3IBE6MsC3IAs6M8C3IAUhMcA2ASEwwDYAzXEyrzJyyTJzyTJ0yTJ1ya8ydskyd8kyeMkyecnNTCDN" +
  "bTzN8D46fsa3KCTdfv/N1jDNa2vNoBbNthfNhCXNVC7NlRjNGhnNAmzNnGvDp1whqsU2/81aRjrGwLcg" +
  "KDqqxTwoIjqsxbcoDDqqxW86q8XN4hwYEN3L/WYoCjqqxW86q8XN4hw6xMC3wjthKhTAESYAGX63yjth" +
  "3Xfo7VsgwCoiwAYIyyzLHcsayxsQ9t1z/N1y/d11/t10/+1bJMAqJsAGCMssyx3LGssbEPbdc/LdcvPd" +
  "dfTddPUh//82AiEUADnrIQ4AOQEEAO2w3X71B+YB3Xf23X7yxgfdd+ndfvPOAN136t1+9M4A3Xfr3X71" +
  "zgDdd+zdfva3KA4hFAA56yEFADkBBADtsN1O+N1G+cs4yxnLOMsZyzjLGd1x991+/MYBT91+/c4AR91+" +
  "/s4AX91+/84AV91x+N1w+d1z+t1y+3oH5gHdd+15xgfdd+54zgDdd+97zgDdd/B6zgDdd/Hdfu23KBjd" +
  "fu7dd/jdfu/dd/ndfvDdd/rdfvHdd/vdZvjdbvnLPcscyz3LHMs9yxzF1d1u93zNCAxv0cHdfuiVyjZh" +
  "3X7y3Xf43X7z3Xf53X703Xf63X713Xf73X72tygY3X7p3Xf43X7q3Xf53X7r3Xf63X7s3Xf73W743Wb5" +
  "yzzLHcs8yx3LPMsd3XX73X78xgTdd/Ldfv3OAN13891+/s4A3Xf03X7/zgDdd/XdfvLdd/zdfvPdd/3d" +
  "fvTdd/7dfvXdd//dfvUH5gHdd/bdfvLGB913991+884A3Xf43X70zgDdd/ndfvXOAN13+t1+9rcoGN1+" +
  "9913/N1++N13/d1++d13/t1++t13/91m/N1u/cs9yxzLPcscyz3LHMXV3W77fM0IDG/Rwd1+6JXKNmHd" +
  "bundZur95ePdbuvj491m7OP94d1+7AfmAd13+91+6cYH3Xf83X7qzgDdd/3dfuvOAN13/t1+7M4A3Xf/" +
  "3X77tygU3W783Wb9/eXj3W7+4+PdZv/j/eHLPMsdyzzLHcs8yx3dfu23KAbdTu7dRu/LOMsZyzjLGcs4" +
  "yxl5zQgMT91+6JEoXSEKADnrIQUAOQEEAO2w3X77tygOIQoAOeshGAA5AQQA7bDdbu7dZu/LPMsdyzzL" +
  "Hcs8yx3dTvLdRvPdfva3KAbdTvfdRvjLOMsZyzjLGcs4yxl5zQgMT91+6JEgBSHEwDYBzU5PzZJTzc5Y" +
  "zdlYzWtrzaAWzbYXzYQlzVQuzZUYzRoZzQJszZxrOsTAtygJ3X7mzU5cw6dcOsPAt8qnXA48xc3lacEN" +
  "IPjdTuYGAAPdXucWAHmTeJrilmHugPKvYd1+5t13/900/91+/913/gef3Xf/GAev3Xf+3Xf/3X7+3Xfm" +
  "ze5Yw6dczeVpIUABzQZpIQBA5REAAGXNJGvNN2vNS2suPz4BzZ9pIQAB5SpwyeURYAEhAALNpmohQAHN" +
  "X2shQAHN8WghCHrPITVizfFrIYZ6zyFHYs3xayGIe88hXmLN8WvN5WnN8ml75jAo9c3lac3yaXvmMCD1" +
  "yVBPQ0tFVCBQTEFURk9STUVSAGZvciBTZWdhIE1hc3RlciBTeXN0ZW0AUHJlc3MgMSB0byBzdGFydAAu" +
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
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABHZW5lcmF0" +
  "ZWQgYnkgcG9ja2V0LXBsYXRmb3JtZXItdG8tc21zIHdlYiBleHBvcnRlci4AUG9ja2V0IFBsYXRmb3Jt" +
  "ZXIgU01TIEVuZ2luZQBwb2NrZXQtcGxhdGZvcm1lci1zbXMAU0RTQwEDAQElIMp/rX95f1RNUiBTRUdB" +
  "//8npJmZAEw=";
