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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDBGEh" +
  "AMB+BgBwEQHAAS4J7bAyY8jNxGTNWl/7zRVZdhj9ZGV2a2l0U01TAAAAw0Nh7aPto+2j7aPto+2j7aPt" +
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
  "zgDdd+DdfvzGBt134d1+/c4A3Xfi3X7+zgDdd+Pdfv/OAN135N02/wAhfcbdfv+W0l8l3U7/BgBpYCkJ" +
  "KSkJKd11+910/N1++8at3Xf93X78zsXdd/7dfv3dd+Xdfv7dd+bdfuXdd/3dfubdd/7dbv3dZv4RGAAZ" +
  "frfKWSXdfuXGBN13591+5s4A3Xfo3W7n3WboXiNWIyN+K25nBgjLLMsdyxrLGxD23XPp3XLq3XXr3XTs" +
  "3W7l3WbmXiNWI04jbgYIyy3LGcsayxsQ9t1z991y+N1x+d11+t1+5cYU3Xft3X7mzgDdd+7dbu3dZu5+" +
  "3Xf73Tb8AN1++913/d1+/N13/t3L/H4oEN1++8YB3Xf93X78zgDdd/7dTv3dRv7LKMsZeAftYt1+95FP" +
  "3X74mEfdfvmdX91++pxX3X773Xf23X783Xf3B5/dd/jdd/ndfvaBb91+94hn3X74i/3l3XfP/eHdfvmK" +
  "3XXv3XTw/eXj3XXx4/3h3Xfy1cURLMAhLgA56wEEAO2wwdHdfuXGFd13891+5s4A3Xf03X7lxhndd/Xd" +
  "fubOAN139t1+5cYQ3Xf33X7mzgDdd/jdfuXGEt13+d1+5s4A3Xf63cv+fsLiI91+3d2W6d1+3t2e6t1+" +
  "392e691+4N2e7OK/Iu6A+uIj3X7pxgTdd/vdfurOAN13/N1+684A3Xf93X7szgDdd/7dfvvdlt3dfvzd" +
  "nt7dfv3dnt/dfv7dnuDi/yLugPriI91+2d2W791+2t2e8N1+292e8d1+3N2e8uIfI+6A8uIj3X7hxv/d" +
  "d/vdfuLO/913/N1+487/3Xf93X7kzv/dd/553Zb7eN2e/Hvdnv163Z7+4lcj7oDy4iPdbvPdZvR+tyAI" +
  "3W7z3Wb0NgHdbvXdZvY2Ad1u991m+E4jft1x0d130gef3XfT3XfU3W753Wb6TiN+3XHV3XfWB5/dd9fd" +
  "d9jdbufdZuhOI0YjXiNWeMb4R3vO/196zv9X7UMkwO1TJsAhAAAiLMAiLsAhMMA2ASExwDYAITLANgAh" +
  "OMA2ABgI3W713Wb2NgDdbvPdZvR+tyh83V7l3VbmISoAOesBBADtsN1u991m+E4jRngH7WLdfvuBT91+" +
  "/IhH3X79jV/dfv6MV91u5d1m5nEjcCNzI3LdXufdVughKgA56wEEAO2w3W753Wb6TiNGeAftYt1++4FP" +
  "3X78iEfdfv2NX91+/oxX3W7n3WbocSNwI3Mjct1u5d1m5iNGI15IQ91u591m6CNWI27dcv3ddf7dbu3d" +
  "Zu5uJgAJEfh/KT/LHMsd7VI4Mz4IuT4BmOKuJO6A+tYk3X791kDdfv4XPx/efzgWPoDdvv0+Ad2e/uLP" +
  "JO6A+tYkHgAYAh4B3X7lxhdP3X7mzgBHe7cob91u9d1m9jYA3W7z3Wb0frcoXwo8AtZkOFjdXuXdVubF" +
  "ISwAOesBCAAJAQQA7bDdXuXdVuYhLAA5AQQA7bDB3V7l3VbmxSEsADnrAQwACQEEAO2w3V7n3VboISwA" +
  "OQEEAO2wwd1u891m9DYArwIYAq8C3TT/w/kgETHJIQAAOQEEAO2wETXJIQQAOQEEAO2w3fnd4cnd5d0h" +
  "AADdOSH0/zn53Tb+ACF9xt1+/pbS7ybdTv4GAGlgKQkpKQkp3XX63XT73X76xq3dd/zdfvvOxd13/d1+" +
  "/N13+t1+/d13+91u+t1m+xEYABl+t8rpJt1u/N1m/SNGI154Kj/AlU97nN1x9N139d1O/N1G/SEFAAlG" +
  "I17dcPbdc/fdfvzGFN13+N1+/c4A3Xf53W743Wb5ft13+t02+wDdfvrdd/zdfvvdd/3dy/t+KBDdfvrG" +
  "B913/N1++84A3Xf93U783Ub9yyjLGcsoyxnLKMsZPsDdvvY+AN2e9+JhJu6AB+YB3Xf63X73B+YB3Xf7" +
  "3Tb/AN1+/5Ewb91u+N1m+V4WAN1z/N1y/ct6KAcT3XP83XL93Ub83Vb9yyrLGN1+9JBf3X71mlfdbv8m" +
  "ACkpKRl91vh8Fz8f3n84KK+9PgGc4sYm7oD65Cbdfvu3IBXdfvq3IA9Vr/YPX91u9iYAxc0XYsHdNP8Y" +
  "i900/sONJd353eHJ3eXdIQAA3Tk760tCAwr15j/dd//xBwfmAzJ/xhpPBgARAABTWEEOAD4DyyDLE8sS" +
  "PSD3eSGAxncjeMYBdyN7zgB3I3rOAHfdXv8WACEAAGVqUx4ABgPLIu1qEPrtU4TGIobGIX7GNgEhiMY2" +
  "ACEAACIswCIuwCIowCIqwCEwwDYAITHANgAhMsA2ACEzwDYAM93hyd3l3SEAAN059fVPISDAOoDGdyM6" +
  "gcZ3IzqCxncjOoPGdyEkwDqExncjOoXGdyM6hsZ3IzqHxnchAAAiLMAiLsAiKMAiKsAhMcA2ACEywDYA" +
  "eeYQTwYAeLEgBT4BMojGOojGt8oeKXixyh4przJ+xjp/xrcoFjp/xj3Kpyg6f8b+AihP1gPK5ijDGSk6" +
  "gMbdd/w6gcbGCN13/TqCxs4A3Xf+OoPGzgDdd/8RIMAhAAA5AQQA7bAhAAIiKMBlIirAIizAIi7AITHA" +
  "NgEhisY2AcMZKTqAxsYA3Xf8OoHGzvjdd/06gsbO/913/jqDxs7/3Xf/ESDAIQAAOQEEAO2wIQD+IijA" +
  "If//IirAIQAAIizAIi7AITHANgEhisY2ARhyOoTGTzqFxsb4RzqGxs7/XzqHxs7/V+1DJMDtUybAIQD6" +
  "IizAIf//Ii7AIQAAIijAIirAITLANgAhMcA2ARgzOoTGTzqFxsYIRzqGxs4AXzqHxs4AV+1DJMDtUybA" +
  "IQAGIizAZSIuwCIowCIqwCExwDYBIYnGNgHd+d3hyToxwLfIOorGt8AqLMDtWy7AfcYqT3zOAEcwARPt" +
  "QyzA7VMuwK+5PgeYPgCbPgCa4lcp7oDwIQAHIizAZSIuwMnd5d0hAADdOf0h7f/9Of353XX+3XT/3XP8" +
  "3XL9KhbA3XX13XT2TiN+RwefX1c6MMDdd/e3KBzdbvXdZvYjIyN+K27ddfjdd/kHn913+t13+xgd3W71" +
  "3Wb2xQEHAAnBfitu3XX43Xf5B5/dd/rdd/vdfve3KB7dbvXdZvYjIyMjI34rbt119N139Qef3Xf23Xf3" +
  "GB3dbvXdZvbFAQkACcF+K27ddfTdd/UHn9139t13993L/lbKmSrVxREowCEHADnrAQQA7bDB0d1+8N2W" +
  "+N139N1+8d2e+d139d1+8t2e+t139t1+892e+91399XFESjAIQsAOQEEAO2wwdGvkU8+AJhHIQAA7VLr" +
  "3X70kd1+9Zjdfvab3X73muKBKu6A8owq7UMowO1TKsAhN8A2ASGKxjYAw48r3cv+Xihy1cURKMAhBwA5" +
  "6wEEAO2wwdHdfvDdhvjdd/TdfvHdjvndd/XdfvLdjvrdd/bdfvPdjvvdd/fVxREowCELADkBBADtsMHR" +
  "ed2W9HjdnvV73Z72et2e9+L5Ku6A8gQr7UMowO1TKsAhN8A2ACGKxjYAw48rOonGtyB47VsowCoqwN1O" +
  "9t1G98XdTvTdRvXFzcpj8fFNRD4IyyjLGcsayxs9IPXtUyjA7UMqwNXFESjAIQ8AOesBBADtsMHRPoC7" +
  "Pv+aPv+ZPv+Y4mor7oDyjyvdfvjWgN1++d4A3X763gDdfvsXPx/egDAJIQAAIijAIirA7VsgwCoiwAYI" +
  "yyzLHcsayxsQ9nvG/9137XrO/9137n3O/91373zO/9138HvGB913+HrOAN13+X3OAN13+nzOAN13+91+" +
  "8AfmAd138d3L8UYgTiEHADnrIQAAOQEEAO2w3X7xtygg3X7txgfdd/Tdfu7OAN139d1+784A3Xf23X7w" +
  "zgDdd/fdbvTdZvXdXvbdVvcGA8sqyxvLHMsdEPYYAyH/AN118t1O+N1G+d3L+34oDN1++MYHT91++c4A" +
  "R8s4yxnLOMsZyzjLGd1x8+1bJMAqJsAGCMssyx3LGssbEPbl/eFLQnvGB9139HrOAN139X3OAN139nzO" +
  "AN1398t8KBTdTvTdRvX95ePdbvbj491m9+P94cs4yxnLOMsZyzjLGd1+9N13+N1+9d13+d1+9t13+t1+" +
  "9913+93L934oGHvGDt13+HrOAN13+X3OAN13+nzOAN13+91G+N1W+cs6yxjLOssYyzrLGN3L8UbCgy3F" +
  "ad1+8s0IDMG3KDb9KhTA/X4GtygUxWndfvLNCAzBKhTAEQYAGV6TKBjFad1+8s0ORcG3IAzFad1+8s1x" +
  "QsG3KEXFaN1+8s0IDMG3KDb9KhTA/X4GtygUxWjdfvLNCAzBKhTAEQYAGV6TKBjFaN1+8s0ORcG3IAzF" +
  "aN1+8s1xQsG3KAOvGAI+Ad13+8Vp3X7zzQgMwbcoNyoUwBEGABl+tygUxWndfvPNCAzBKhTAEQYAGV6T" +
  "KBjFad1+880ORcG3IAzFad1+881xQsG3KEPFaN1+880IDMG3KDT9KhTA/X4GtygUxWjdfvPNCAzBKhTA" +
  "EQYAGU6RKBbFaN1+880ORcG3IApo3X7zzXFCtygDrxgCPgHdd/rdy/xmys4uITDAXnu3KCYhMsA2ASEz" +
  "wDYAITbANgAhMcA2ACEwwDYAOhvHt8rOLs3DQsPOLu1LFsDF/eH9fhC3KEt7tyBH3X77tyAG3X76tyg7" +
  "ITLANgAhM8A2ASE2wDYAITHANgAhOMA2AN1++7coBQEBABgDAf8AITTAcSE1wDYAOhvHtygwzcNCGCsh" +
  "DwAJfrcoIzo4wLcgHSEywDYBITPANgAhNsA2ACE4wDYBOhvHtygDzcNCOjLA3Xf73X7+5hDdd/XdNvYA" +
  "3X77t8rtLxE7wCELADnrAQQA7bCv3b743Z75PgDdnvo+AN2e++IKL+6AB+YB3Xf33X723bb1IAfdfve3" +
  "yssv3X73tygQIQQAOeshCwA5AQQA7bAYGCoWwBEKABlOI37dcfHdd/IHn91389139CEKADnrIQQAOQEE" +
  "AO2wOjbAPN13+yE2wN1++3cqFsARDAAZbiYA3U77BgC/7ULregftYt1O+d1G+sXdTvfdRvjFzcpj8fGv" +
  "k08+AJpHPgCdX5+UV+1DLMDtUy7A/SoWwP1ODN1++5E4NyEywDYAITHANgEhAAAiO8AiPcAYIt1++922" +
  "+t22+d22+CAUITLANgD9KhbA/X4MMjbAITHANgE6M8Ddd/u3yrsy3X723bb1yqYyOjbAPN13+yE2wN1+" +
  "+3cqFsDddfjddPndfvjdd/bdfvndd/fdbvbdZvcRDAAZft13+t139N029QDdfvvdd/bdNvcA3X703Zb2" +
  "3Xf63X713Z733Xf73X763Xfx3X773XfyB5/dd/Pdd/Tdfvjdd/rdfvndd/vdbvrdZvsRCgAZft13+iN+" +
  "3Xf73X763Xf43X773Xf5B5/dd/rdd/tvZ+XdbvjdZvnl3V7x3Vby3W7z3Wb0zcpj8fEzM9Xdde/ddPCv" +
  "3Zbt3Xf4PgDdnu7dd/k+AN2e7913+p/dlvDdd/sRLMAhCwA5AQQA7bA6NcDdd/UqFsDddfbddPfdfvbd" +
  "d/rdfvfdd/vdbvrdZvsRDAAZft13+913+N02+QDdfvjdd/rdfvndd/vdy/l+KBDdfvjGAd13+t1++c4A" +
  "3Xf73U763Ub7yyjLGXnG/E94zv9H3X71FgCRepjiWjHugPKMMt1O9t1G9yEKAAlOI0Z4B+1i5cXdXvHd" +
  "VvLdbvPdZvTNymPx8U1EOjTA3Xf71cURKMAhBwA56wEEAO2wwdHdc/TdcvXdcfbdcPcGBN3L9y7dy/Ye" +
  "3cv1Ht3L9B4Q7t1++z0gXd1+8N2G9N13+N1+8d2O9d13+d1+8t2O9t13+t1+892O9913+xEowCELADkB" +
  "BADtsCoWwE4jRngHn19Xed2W+Hjdnvl73Z76et2e++IQMu6A8oUy7UMowO1TKsAYaN1+8N2W9N13+N1+" +
  "8d2e9d13+d1+8t2e9t13+t1+892e9913+xEowCELADkBBADtsCoWwE4jfkcHn19Xr5FPPgCYRyEAAO1S" +
  "691++JHdfvmY3X76m91++5riejLugPKFMu1DKMDtUyrAOjXAPDI1wDo2wCoWwBEMABlOkTghITPANgAh" +
  "McA2ARgVITPANgAqFsARDAAZfjI2wCExwDYBOjLAtyBZOjPAtyBT7UsswO1bLsDLeihHOonGtyBB1cUR" +
  "wAAhAADNymPx8U1EPgjLKMsZyxrLGz0g9e1TLMDtQy7APoC7Pv+aPv+ZPv+Y4g4z7oDyGjMhAAAiLMAi" +
  "LsDd+d3hyd3l3SEAAN05IfT/OfntSyjA7VsqwHkhMcmGI094jiNHe44jX3qOV91x/N1w/d1z/t1y/xEg" +
  "wCEAADnrAQQA7bDdfvTdhvzdd/jdfvXdjv3dd/ndfvbdjv7dd/rdfvfdjv/dd/shAAA56yEEADkBBADt" +
  "sN1+9N13+N1+9d13+d1+9t13+t1+9913+wYI3cv7Lt3L+h7dy/ke3cv4HhDur92+/N2e/T4A3Z7+PgDd" +
  "nv/i0zPugPLeNN1+9N13/N1+9cYG3Xf93X72zgDdd/7dfvfOAN13/+1LJMAqJsB4xgFHMAEj5cXdXvzd" +
  "Vv3dbv7dZv/NkA63ICPtSyTAKibAeMYGRzABI+XF3V783Vb93W7+3Wb/zZAOt8qRNd1++MYG3Xf83X75" +
  "zgDdd/3dfvrOAN13/t1++84A3Xf/IQQAOeshCAA5AQQA7bDdy/9+KCDdfvzGB913+N1+/c4A3Xf53X7+" +
  "zgDdd/rdfv/OAN13+91u+N1m+d1e+t1W+wYDyyrLG8scyx0Q9gYDKcsTyxIQ+QH5/wlNRHvO/196zv/d" +
  "cfXdcPbdc/fdNvQAIQAAIijAIirAIYnGNgAhisY2AMORNd3L/37KkTXtSyTAKibAeMYBRzABI+XF3V70" +
  "3Vb13W723Wb3zZAOtyAi7UskwComwHjGBkcwASPlxd1e9N1W9d1u9t1m982QDrcoaN1O+N1G+d1u+t1m" +
  "+93L+34oGN1++MYHT91++c4AR91++s4Ab91++84AZ1lQBgPLLMsdyxrLGxD2HCAEFCABI2VqUx4ABgPL" +
  "Iu1qEPozM9XddfbddPchAAAiKMAiKsAhicY2ACGKxjYAESDAIQAAOQEEAO2w3fnd4cnd5d0hAADdOSHj" +
  "/zn57UsswO1bLsB5ITXJhiNPeI4jR3uOI196jlfdcezdcO3dc+7dcu/tSyTAKibA3X7sgU/dfu2IR91+" +
  "7o1f3X7vjN1x/N1w/d1z/t13/91+/N13+N1+/d13+d1+/t13+t1+/913+wYI3cv7Lt3L+h7dy/ke3cv4" +
  "HhDuIQ0AOeshFQA5AQQA7bDtSyDAKiLA3XH0eMYB3Xf1fc4A3Xf2fM4A3Xf33cvvfsKzON1O/N1+/cYI" +
  "R91+/s4A/eXdd+H94d1+/84A/eXdd+L94cX95f3lxd1e9N1W9d1u9t1m983JEf3hwbcgGO1bIMAqIsB6" +
  "xgRXMAEj/eXFzckRt8r7PN1+8MYI3Xf03X7xzgDdd/XdfvLOAN139t1+884A3Xf3IRUAOeshEQA5AQQA" +
  "7bDdy/d+KCDdfvTGB913+N1+9c4A3Xf53X72zgDdd/rdfvfOAN13+91++N138t1++d13891++t139N1+" +
  "+9139QYD3cv1Lt3L9B7dy/Me3cvyHhDu/SoUwP1+BrfKVDjdfvLdd/vtSyDA7VsiwD4IyyrLG8sYyxk9" +
  "IPXdcffdcPjdc/ndcvrLeigYecYH3Xf3eM4A3Xf4e84A3Xf5es4A3Xf63U733Ub4yzjLGcs4yxnLOMsZ" +
  "3W77ec0IDN139t1++9139+1LIMDtWyLAPgjLKssbyxjLGT0g9d1x+N1w+d1z+t1y+8t6KBh5xgfdd/h4" +
  "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" +
  "3Xfd3X7/3XfeB5/dd9/dd+Ddft3dd/ndft7dd/rdft/dd/vdfuDdd/wGAt3L+Sbdy/oW3cv7Ft3L/BYQ" +
  "7iEAAOUuD+XdXvndVvrdbvvdZvzNwGLx8d1z4d1y4t1149105N1+4d2G3d13+d1+4t2O3t13+t1+492O" +
  "3913+91+5N2O4N13/BE7wCEcADkBBADtsCEywDYBITbANgAhMcA2ACEwwDYAITjANgA6G8e3KBbNw0IY" +
  "ET5D3Yb9bz7AzgBnfrcgAjYB3TT9w6893fnd4cnd5d0hAADdOfXdd//ddf4OACEbx3mWMDQRi8YGAGlg" +
  "KQkZ6xpH3X7/kCAea2Ij3X7+liAVExMatygKOhzH1gE+ABcYCTocxxgEDBjFr9353eHJ3eXdIQAA3Tkh" +
  "6/85+Tocx9YBPgAXMhzH3Tb/ACEbx91+/5bSCUXdTv8GAGlgKQnddf3ddP4+i92G/d13+z7G3Y7+3Xf8" +
  "3W773Wb8ft13/d1++913+d1+/N13+t1u+d1m+iN+3Xf+3W773Wb8IyNOebcoBTocxxgIOhzH1gE+ABfd" +
  "d/oqFMDddfvddPx5tygh3X76tygN3U773Ub8IQ8ACUYYC91O+91G/CEQAAlGeBge3X76tygN3U773Ub8" +
  "IREACX4YC91u+91m/BESABl+tygEBgAYAq9HX1Ddbv4mACkpKSkp3X795h9PBgAJKXz2eGfP69/dfvq3" +
  "ygNF7VsgwCoiwAYIyyzLHcsayxsQ9jMz1d117d107u1bJMAqJsAGCMssyx3LGssbEPbdc+/dcvDddfHd" +
  "dPLdbv2vZ08GAymPyxEQ+t1189109N139d1x9t1u/q9nTwYDKY/LERD63XX33XT43Xf53XH63X7rxgZP" +
  "3X7szgBH3X7tzgBf3X7uzgBX3X7zkd1+9JjdfvWb3X72muJbRO6A8gNF3X7zxgjdd/vdfvTOAN13/N1+" +
  "9c4A3Xf93X72zgDdd/7dfuvdlvvdfuzdnvzdfu3dnv3dfu7dnv7im0TugPIDRd1+78YIT91+8M4AR91+" +
  "8c4AX91+8s4AV91+95HdfviY3X75m91++priy0TugPIDRd1+98YIT91++M4AR91++c4AX91++s4AV91+" +
  "75HdfvCY3X7xm91+8pri+0TugPIDRSHEwDYB3TT/w99C3fnd4cnd5d0hAADdOfXdd//ddf4OACG9x3mW" +
  "MDQRHccGAGlgKQkZ6xpH3X7/kCAea2Ij3X7+liAVExMatygKOr/H1gE+ABcYCTq/xxgEDBjFr9353eHJ" +
  "7VsUwLcoEn23KAchCQAZfhgXIQoAGX4YEH23KAchCwAZfhgFIQwAGX63KAQWAF/JEQAAyd3l3SEAAN05" +
  "9d02/wAhvcfdfv+WMFHdTv8GAGlgKQnrIR3HGesaT2tiI37dd/4TExpHtygFOr/HGAg6v8fWAT4AF2/F" +
  "eM1gRcHdbv4mACkpKSkpeeYfBgBPCSl89nhnz+vf3TT/GKbd+d3hyTrAx7fI7UsswCouwK+5mD4AnT4A" +
  "nOIaRu6A8CHAxzYAyd3l3SEAAN05Iev/OfntWyDAKiLABgjLLMsdyxrLGxD23XP13XL23XX33XT4KiTA" +
  "7VsmwAYIyyrLG8scyx0Q9t1O9d1G9v3l491u9+Pj3Wb44/3h3cv4figk3X71xgdP3X72zgBH3X73zgD9" +
  "5d136f3h3X74zgD95d136v3hyzjLGcs4yxnLOMsZ3XH93X71xgXdd/ndfvbOAN13+t1+984A3Xf73X74" +
  "zgDdd/zdTvndRvr95ePdbvvj491m/OP94d3L/H4oJN1++cYHT91++s4AR91++84A/eXdd+n94d1+/M4A" +
  "/eXdd+r94cs4yxnLOMsZyzjLGd1x/tX94U1Ey3ooHH3GB098zgBHe84A/eXdd+n94XrOAP3l3Xfq/eHL" +
  "OMsZyzjLGcs4yxndcf/FAQgACcEwARPV/eFNRMt6KBoBBwAJTUR7zgD95d136f3hes4A/eXdd+r94cs4" +
  "yxnLOMsZyzjLGd1+/d13791x8N1+/t138d1x8t1+/d13891+/9139N02/wDdbv8mAClNRCEEADkJft13" +
  "+iN+3Xf7b91++s0IDN13/CoUwN11/d10/gEHAAlOebcoEd1+/JEgC91u+91++s1yDBhA3U793Ub+IQgA" +
  "CU55tygR3X78kSAL3W773X76zcMMGCDdTv3dRv4hJQAJfrcoEk/L+d1+/JEgCd1u+91++s26Dd00/91+" +
  "/9YD2qhH/SoUwP1+Jd13/7fKP0oRIMAhEQA56wEEAO2w3X783Xfr3X793Xfs3X7+3Xft3X7/3XfuBgjd" +
  "y+4u3cvtHt3L7B7dy+seEO4hEQA56yEAADkBBADtsN3L7n4oIN1+68YH3Xf83X7szgDdd/3dfu3OAN13" +
  "/t1+7s4A3Xf/3U783Ub93XH+3XD/3cv/Pt3L/h7dy/8+3cv+Ht3L/z7dy/4e3X7+3Xf13X7rxgXdd/jd" +
  "fuzOAN13+d1+7c4A3Xf63X7uzgDdd/shEQA56yENADkBBADtsN3L+34oIN1+68YM3Xf83X7szgDdd/3d" +
  "fu3OAN13/t1+7s4A3Xf/3X783Xf+3X793Xf/3cv/Pt3L/h7dy/8+3cv+Ht3L/z7dy/4e3X7+3Xf2ESTA" +
  "IREAOesBBADtsN1+/N13991+/d13+N1+/t13+d1+/913+gYI3cv6Lt3L+R7dy/ge3cv3HhDuIQAAOesh" +
  "DAA5AQQA7bDdfvfGB913+91++M4A3Xf83X75zgDdd/3dfvrOAN13/t3L+n4oDiEAADnrIRAAOQEEAO2w" +
  "wcXLOMsZyzjLGcs4yxndcf/dTvvdRvzdy/5+KAzdfvfGDk/dfvjOAEfLOMsZyzjLGcs4yxndcf7dTvXd" +
  "fvaROCrdRv/dfv6QOB7FaHnNCAzBKhTAESUAGV7L+5MgB8Voec26DcEEGNwMGNDd+d3hyd3l3SEAAN05" +
  "Iej/OfnNIUbdNv8A3X7/3Xf93Tb+AN1+/d13+91+/t13/AYC3cv7Jt3L/BYQ9j7F3Yb73Xf9Psfdjvzd" +
  "d/7dfv3dd+jdfv7dd+ndfujGAt136t1+6c4A3Xfr3W7q3Wbrft13/rfK+0zdXv4cweHlxXPh5Ubh5SNO" +
  "eOYf3XHs3W7q3WbrbhYA3Xft3XLue9YoIBxpJgApKSkpKd1e7d1W7hkpfPZ4Z88hAADfw/tMfdbI2vtM" +
  "aK9nXwYDKY/LExD63XXv3XTw3Xfx3XPyaa9nTwYDKY/LERD63XXz3XT03Xf13XH27VsgwCoiwAYIyyzL" +
  "HcsayxsQ9t1z991y+N11+d10+u1bJMAqJsAGCMssyx3LGssbEPbdc/vdcvzddf3ddP7dfvfGBk/dfvjO" +
  "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" +
  "9M4A3Xfr3X71zgDdd+zdfva3KA4hFAA56yEFADkBBADtsN1O+N1G+cs4yxnLOMsZyzjLGd1x991+/MYB" +
  "T91+/c4AR91+/s4AX91+/84AV91x+N1w+d1z+t1y+3oH5gHdd+15xgfdd+54zgDdd+97zgDdd/B6zgDd" +
  "d/Hdfu23KBjdfu7dd/jdfu/dd/ndfvDdd/rdfvHdd/vdZvjdbvnLPcscyz3LHMs9yxzF1d1u93zNCAxv" +
  "0cHdfuiVyt9X3X7y3Xf43X7z3Xf53X703Xf63X713Xf73X72tygY3X7p3Xf43X7q3Xf53X7r3Xf63X7s" +
  "3Xf73W743Wb5yzzLHcs8yx3LPMsd3XX73X78xgTdd/Ldfv3OAN13891+/s4A3Xf03X7/zgDdd/XdfvLd" +
  "d/zdfvPdd/3dfvTdd/7dfvXdd//dfvUH5gHdd/bdfvLGB913991+884A3Xf43X70zgDdd/ndfvXOAN13" +
  "+t1+9rcoGN1+9913/N1++N13/d1++d13/t1++t13/91m/N1u/cs9yxzLPcscyz3LHMXV3W77fM0IDG/R" +
  "wd1+6JXK31fdbundZur95ePdbuvj491m7OP94d1+7AfmAd13+91+6cYH3Xf83X7qzgDdd/3dfuvOAN13" +
  "/t1+7M4A3Xf/3X77tygU3W783Wb9/eXj3W7+4+PdZv/j/eHLPMsdyzzLHcs8yx3dfu23KAbdTu7dRu/L" +
  "OMsZyzjLGcs4yxl5zQgMT91+6JEoXSEKADnrIQUAOQEEAO2w3X77tygOIQoAOeshGAA5AQQA7bDdbu7d" +
  "Zu/LPMsdyzzLHcs8yx3dTvLdRvPdfva3KAbdTvfdRvjLOMsZyzjLGcs4yxl5zQgMT91+6JEgBSHEwDYB" +
  "zQBGzURKzYBPzYtPzRFizaAWza4XzXwlzY0YzRIZzahizUJiOsTAtygJ3X7mzfpSw1NTOsPAt8pTUw48" +
  "xc2LYMENIPjdTuYGAAPdXucWAHmTeJriPFjugPJVWN1+5t13/900/91+/913/gef3Xf/GAev3Xf+3Xf/" +
  "3X7+3XfmzaBPw1NTzYtgIUABzaxfIQBA5REAAGXNymHN3WHN8WEuPz4BzUVgIQAB5SovyeURYAEhAALN" +
  "TGEhQAHNBWIhQAHNl18hCHrPIdtYzZdiIYZ6zyHtWM2XYiGIe88hBFnNl2LNi2DNmGB75jAo9c2LYM2Y" +
  "YHvmMCD1yVBPQ0tFVCBQTEFURk9STUVSAGZvciBTZWdhIE1hc3RlciBTeXN0ZW0AUHJlc3MgMSB0byBz" +
  "dGFydAAuAM3iXy4AzfhfLgDN2F/NaFjN2gq3KPfNEAvNi2AhQAHNrF8hAEDlEQAAZc3KYc3uFCFAAc2X" +
  "X80kUxjScG9ja2V0LXBsYXRmb3JtZXItc21zAFBvY2tldCBQbGF0Zm9ybWVyIFNNUyBFbmdpbmUAR2Vu" +
  "ZXJhdGVkIGJ5IHBvY2tldC1wbGF0Zm9ybWVyLXRvLXNtcyB3ZWIgZXhwb3J0ZXIuADo7yLfIPp/Tfz6/" +
  "0386UMi3IAQ+39N/OlHItyAEPv/TfyE7yDYAyTo7yLfAOknI9pDTfzpKyPaw0386UMi3IBc6TcjmD/bA" +
  "0386TsjmP9N/OkvI9tDTfzpRyLcgEDpPyOYP9uDTfzpMyPbw038hO8g2AcnNuVkhQ8g2AdHBxdXtQzzI" +
  "7UM+yO1DQMghQsg2ACFGyDYAIUTINp8hO8g2AckhQ8g2AMnB4eXF5c0sWvEhQ8g2AMn9ITvI/W4AyT6f" +
  "038+v9N/Pt/Tfz7/03/J3eXdIQAA3Tn1/SFFyP1+AN13/q/dd//9TgA6O8i3KFg6ScjmD18WAOHlGT4P" +
  "vT4AnOK9Wu6A8sVaEQ8AGAk6ScjmD4FfF5979pDTfzpKyOYPXxYA4eUZPg+9PgCc4ula7oDy8VoRDwAY" +
  "CTpKyOYPgV8Xn3v2sNN/OlDItygJOlLI9tDTfxgyOjvItygsOkvI5g9fFgDh5Rk+D70+AJziKlvugPIy" +
  "WxEPABgJOkvI5g+BXxefe/bQ0386Uci3KAk6U8j28NN/GDI6O8i3KCw6TMjmD28mANHVGT4PvT4AnOJr" +
  "W+6A8nNbAQ8AGAk6TMjmD4FPF5959vDTf9353eHJ3eXdIQAA3Tn13X4EMkXIOjvIt8pwXDpJyOYPTx4A" +
  "/SFFyP1+AN13/q/dd/953Yb+R3vdjv9f/U4APg+4PgCb4spb7oDy0lsRDwAYCTpJyOYPgV8Xn3v2kNN/" +
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
  "///ZF5mZAEw=";
