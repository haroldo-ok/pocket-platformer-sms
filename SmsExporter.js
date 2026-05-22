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
    'portal':  17,
    'portal2': 18,
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
    // Tile 277: blue portal
    const portalBlue = get('PORTAL');
    portalBlue ? encodeSprite8(portalBlue, 0) : encodeBlank();
    // Tile 278: orange portal
    const portalOrange = get('PORTAL2');
    portalOrange ? encodeSprite8(portalOrange, 0) : encodeBlank();

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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDT3Ah" +
  "AMB+BgBwEQHAAcAJ7bAy9cjNiXTNpW77zWBodhj9ZGV2a2l0U01TAAAAw45w7aPto+2j7aPto+2j7aPt" +
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
  "zgDdd9x7xgjdd916zgDdd959zgDdd998zgDdd+DdfvzGBt134d1+/c4A3Xfi3X7+zgDdd+Pdfv/OAN13" +
  "5N02/wAhfcbdfv+W0ncl3U7/BgBpYCkJKSkJKd11+910/N1++8at3Xf93X78zsXdd/7dfv3dd+Xdfv7d" +
  "d+bdfuXdd/3dfubdd/7dbv3dZv4RGAAZfrfKcSXdfuXGBN13591+5s4A3Xfo3W7n3WboXiNWIyN+K25n" +
  "BgjLLMsdyxrLGxD23XPp3XLq3XXr3XTs3W7l3WbmXiNWI04jbgYIyy3LGcsayxsQ9t1z991y+N1x+d11" +
  "+t1+5cYU3Xft3X7mzgDdd+7dbu3dZu5+3Xf73Tb8AN1++913/d1+/N13/t3L/H4oEN1++8YB3Xf93X78" +
  "zgDdd/7dTv3dRv7LKMsZeAftYt1+95FP3X74mEfdfvmdX91++pxX3X773Xf23X783Xf3B5/dd/jdd/nd" +
  "fvaBb91+94hn3X74i/3l3XfP/eHdfvmK3XXv3XTw/eXj3XXx4/3h3Xfy1cURLMAhLgA56wEEAO2wwdHd" +
  "fuXGFd13891+5s4A3Xf03X7lxhndd/XdfubOAN139t1+5cYQ3Xf33X7mzgDdd/jdfuXGEt13+d1+5s4A" +
  "3Xf63cv+fsL6I91+3d2W6d1+3t2e6t1+392e691+4N2e7OLXIu6A+voj3X7pxgTdd/vdfurOAN13/N1+" +
  "684A3Xf93X7szgDdd/7dfvvdlt3dfvzdnt7dfv3dnt/dfv7dnuDiFyPugPr6I91+2d2W791+2t2e8N1+" +
  "292e8d1+3N2e8uI3I+6A8voj3X7hxv/dd/vdfuLO/913/N1+487/3Xf93X7kzv/dd/553Zb7eN2e/Hvd" +
  "nv163Z7+4m8j7oDy+iPdbvPdZvR+tyAI3W7z3Wb0NgHdbvXdZvY2Ad1u991m+E4jft1x0d130gef3XfT" +
  "3XfU3W753Wb6TiN+3XHV3XfWB5/dd9fdd9jdbufdZuhOI0YjXiNWeMb4R3vO/196zv9X7UMkwO1TJsAh" +
  "AAAiLMAiLsAhMMA2ASExwDYAITLANgAhOMA2ABgI3W713Wb2NgDdbvPdZvR+tyh83V7l3VbmISoAOesB" +
  "BADtsN1u991m+E4jRngH7WLdfvuBT91+/IhH3X79jV/dfv6MV91u5d1m5nEjcCNzI3LdXufdVughKgA5" +
  "6wEEAO2w3W753Wb6TiNGeAftYt1++4FP3X78iEfdfv2NX91+/oxX3W7n3WbocSNwI3Mjct1u5d1m5iNG" +
  "I15IQ91u591m6CNWI27dcv3ddf7dbu3dZu5uJgAJEfh/KT/LHMsd7VI4Mz4IuT4BmOLGJO6A+u4k3X79" +
  "1kDdfv4XPx/efzgWPoDdvv0+Ad2e/uLnJO6A+u4kHgAYAh4B3X7lxhdP3X7mzgBHe7cob91u9d1m9jYA" +
  "3W7z3Wb0frcoXwo8AtZkOFjdXuXdVubFISwAOesBCAAJAQQA7bDdXuXdVuYhLAA5AQQA7bDB3V7l3Vbm" +
  "xSEsADnrAQwACQEEAO2w3V7n3VboISwAOQEEAO2wwd1u891m9DYArwIYAq8C3TT/wxEhEcPJIQAAOQEE" +
  "AO2wEcfJIQQAOQEEAO2w3fnd4cnd5d0hAADdOSH0/zn53Tb+ACF9xt1+/pbSByfdTv4GAGlgKQkpKQkp" +
  "3XX63XT73X76xq3dd/zdfvvOxd13/d1+/N13+t1+/d13+91u+t1m+xEYABl+t8oBJ91u/N1m/SNGI154" +
  "Kj/AlU97nN1x9N139d1O/N1G/SEFAAlGI17dcPbdc/fdfvzGFN13+N1+/c4A3Xf53W743Wb5ft13+t02" +
  "+wDdfvrdd/zdfvvdd/3dy/t+KBDdfvrGB913/N1++84A3Xf93U783Ub9yyjLGcsoyxnLKMsZPsDdvvY+" +
  "AN2e9+J5Ju6AB+YB3Xf63X73B+YB3Xf73Tb/AN1+/5Ewb91u+N1m+V4WAN1z/N1y/ct6KAcT3XP83XL9" +
  "3Ub83Vb9yyrLGN1+9JBf3X71mlfdbv8mACkpKRl91vh8Fz8f3n84KK+9PgGc4t4m7oD6/Cbdfvu3IBXd" +
  "fvq3IA9Vr/YPX91u9iYAxc1iccHdNP8Yi900/sOlJd353eHJ3eXdIQAA3Tn1zdwdMzPVDgAqFMARBAAZ" +
  "RnmQMBjh5W7R1RMGAHiVMAYTExMEGPYzM9UMGNzR1d353eHJAAIEBwkLDQ8SFBYYGh0fISMlJykrLjAy" +
  "NDY4Ojw+P0FDRUdJS0xOUFJTVVdYWltdXmBhY2RlZ2hpa2xtbm9wcXJzdHV2d3d4eXl6e3t8fH19fX5+" +
  "fn9/f39/f39/f39/fn5+fX19fHx7e3p5eXh3d3Z1dHNycXBvbm1sa2loZ2VkY2FgXl1bWlhXVVNSUE5M" +
  "S0lHRUNBPz48Ojg2NDIwLispJyUjIR8dGhgWFBIPDQsJBwQCAP78+ff18/Hu7Oro5uPh393b2dfV0tDO" +
  "zMrIxsTCwL+9u7m3tbSysK6tq6mopqWjoqCfnZybmZiXlZSTkpGQj46NjIuKiYmIh4eGhYWEhIODg4KC" +
  "goGBgYGBgYGBgYGBgoKCg4ODhISFhYaHh4iJiYqLjI2Oj5CRkpOUlZeYmZucnZ+goqOlpqipq62usLK0" +
  "tbe5u72/wMLExsjKzM7Q0tXX2dvd3+Hj5ujq7O7x8/X3+fz+f39/f39/fn5+fX19fHx7e3p5eXh3d3Z1" +
  "dHNycXBvbm1sa2loZ2VkY2FgXl1bWlhXVVNSUE5MS0lHRUNBQD48Ojg2NDIwLispJyUjIR8dGhgWFBIP" +
  "DQsJBwQCAP78+ff18/Hu7Oro5uPh393b2dfV0tDOzMrIxsTCwb+9u7m3tbSysK6tq6mopqWjoqCfnZyb" +
  "mZiXlZSTkpGQj46NjIuKiYmIh4eGhYWEhIODg4KCgoGBgYGBgYGBgYGBgoKCg4ODhISFhYaHh4iJiYqL" +
  "jI2Oj5CRkpOUlZeYmZucnZ+goqOlpqipq62usLK0tbe5u72/wMLExsjKzM7Q0tXX2dvd3+Hj5ujq7O7x" +
  "8/X3+fz+AAIEBwkLDQ8SFBYYGh0fISMlJykrLjAyNDY4Ojw+QEFDRUdJS0xOUFJTVVdYWltdXmBhY2Rl" +
  "Z2hpa2xtbm9wcXJzdHV2d3d4eXl6e3t8fH19fX5+fn9/f39/3eXdIQAA3Tkh+f85+d13/c0MJ+s+AjL/" +
  "/902/wBdVBN+3Xf+3X7/3Zb9MBXdTv4uAH2RMAYTExMsGPbr3TT/GNzdfv4ye8g+CP0he8j9lgAwBP02" +
  "AAjdNv4A3Tb/ACo1yCMj3X7/ltJHKyF7yN1+/pbSRyvdTv8GAGlgKQlNRDo5yIFPOjrIiEfdcfvdcPzh" +
  "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" +
  "IcfJhiNPeI4jR3uOI196jlfdcezdcO3dc+7dcu/tSyTAKibA3X7sgU/dfu2IR91+7o1f3X7vjN1x/N1w" +
  "/d1z/t13/91+/N13+N1+/d13+d1+/t13+t1+/913+wYI3cv7Lt3L+h7dy/ke3cv4HhDuIQ0AOeshFQA5" +
  "AQQA7bDtSyDAKiLA3XH0eMYB3Xf1fc4A3Xf2fM4A3Xf33cvvfsLjR91O/N1+/cYIR91+/s4A/eXdd+H9" +
  "4d1+/84A/eXdd+L94cX95f3lxd1e9N1W9d1u9t1m983JEf3hwbcgGO1bIMAqIsB6xgRXMAEj/eXFzckR" +
  "t8orTN1+8MYI3Xf03X7xzgDdd/XdfvLOAN139t1+884A3Xf3IRUAOeshEQA5AQQA7bDdy/d+KCDdfvTG" +
  "B913+N1+9c4A3Xf53X72zgDdd/rdfvfOAN13+91++N138t1++d13891++t139N1++9139QYD3cv1Lt3L" +
  "9B7dy/Me3cvyHhDu/SoUwP1+BrfKhEfdfvLdd/vtSyDA7VsiwD4IyyrLG8sYyxk9IPXdcffdcPjdc/nd" +
  "cvrLeigYecYH3Xf3eM4A3Xf4e84A3Xf5es4A3Xf63U733Ub4yzjLGcs4yxnLOMsZ3W77ec0IDN139t1+" +
  "+9139+1LIMDtWyLAPgjLKssbyxjLGT0g9d1x+N1w+d1z+t1y+8t6KBh5xgfdd/h4zgDdd/l7zgDdd/p6" +
  "zgDdd/vdTvjdRvnLOMsZyzjLGcs4yxkM3W73ec0IDE/9KhTA/UYG3X72kCgHeZAoA68YAj4BtyhH7Usk" +
  "wComwN1x+HjGCN13+X3OAN13+nzOAN13+91W8t1u891m9B4ABgPLIu1qEPp73Zb4et2e+X3dnvp83Z77" +
  "4oFH7oD6K0zdfvLdXvPdbvTdZvUGA4fLE+1qEPnG+E97zv9Hfc7/X3zO/91x/d1w/t1z/902/AAhAAAi" +
  "LMAiLsAhMMA2ASExwDYAITLANgAhM8A2ACE4wDYAIYnGNgAhisY2AMMrTN1u/t1m/+XdbvzdZv3l3V70" +
  "3Vb13W723Wb3zZAOtyAj7VsgwCoiwHrGBFcwASPdTv7dRv/F3U783Ub9xc2QDrfKK0zdbvDdZvHdXvLd" +
  "VvPdy/N+KBjdfvDGB2/dfvHOAGfdfvLOAF/dfvPOAFcGA8sqyxvLHMsdEPZ9xgHdd+N8zgDdd+R7zgDd" +
  "d+V6zgDdd+Y6wMe3wttLKhTAEQ0AGX63yttL7UsgwO1bIsA+CMsqyxvLGMsZPSD13XH83XD93XP+3XL/" +
  "y3ooGHnGB913/HjOAN13/XvOAN13/nrOAN13/91u/N1m/cs8yx3LPMsdyzzLHWV5xgbdd/R4zgDdd/V7" +
  "zgDdd/Z6zgDdd/fdfvTdd/zdfvXdd/3dfvbdd/7dfvfdd//dy/d+KBh5xg3dd/x4zgDdd/17zgDdd/56" +
  "zgDdd//dTvzdRv3LOMsZyzjLGcs4yxndfuM9R8VofM0IDMHdd/9oec0IDE/9KhTA/eXRIQ0AGV7dfv+T" +
  "KBH9Rg7dfv+QKAh5uygEkMLbSzq/x9YBPgAXMr/HzcRUKhTA3XX+3XT/Or/HtygN3U7+3Ub/IQ0ACU4Y" +
  "C91u/t1m/xEOABlOQXm3KAVIBgAYAwEAAB4AIb7He5YwOmsmACn9Ia3HxU1E/QnB/eXhI24mACkpKSkp" +
  "fVT9bgD1feYfb/EmAIVveozLJY/2eGfFz8FpYN8cGL/tSyDA7VsiwD4IyyrLG8sYyxk9IPXdfvjdd+fd" +
  "fvndd+jdfvrdd+ndfvvdd+rdfufGCN13691+6M4A3Xfs3X7pzgDdd+3dfurOAN137nnGBt1373jOAN13" +
  "8HvOAN138XrOAN138t02/wAhvcfdfv+W0tZL1d1e/xYAa2IpGdH9IR3HxU1E/QnB/X4A3Xf7r913/N13" +
  "/d13/vXdfvvdd/Pdfvzdd/Tdfv3dd/Xdfv7dd/bxPgPdy/Mm3cv0Ft3L9Rbdy/YWPSDt/eXhI37dd/uv" +
  "3Xf83Xf93Xf+9d1++913991+/N13+N1+/d13+d1+/t13+vE+A93L9ybdy/gW3cv5Ft3L+hY9IO39fgK3" +
  "KAU6v8cYCDq/x9YBPgAXt8rQS91+892W791+9N2e8N1+9d2e8d1+9t2e8uIwS+6A8tBL3X7zxgjdd/vd" +
  "fvTOAN13/N1+9c4A3Xf93X72zgDdd/553Zb7eN2e/Hvdnv163Z7+4mhL7oDy0Evdfvfdluvdfvjdnuzd" +
  "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" +
  "MhzH3Tb/ACEbx91+/5bSOVTdTv8GAGlgKQnddf3ddP4+i92G/d13+z7G3Y7+3Xf83W773Wb8ft13/d1+" +
  "+913+d1+/N13+t1u+d1m+iN+3Xf+3W773Wb8IyNOebcoBTocxxgIOhzH1gE+ABfdd/oqFMDddfvddPx5" +
  "tygh3X76tygN3U773Ub8IQ8ACUYYC91O+91G/CEQAAlGeBge3X76tygN3U773Ub8IREACX4YC91u+91m" +
  "/BESABl+tygEBgAYAq9HX1Ddbv4mACkpKSkp3X795h9PBgAJKXz2eGfP69/dfvq3yjNU7VsgwCoiwAYI" +
  "yyzLHcsayxsQ9jMz1d117d107u1bJMAqJsAGCMssyx3LGssbEPbdc+/dcvDddfHddPLdbv2vZ08GAymP" +
  "yxEQ+t1189109N139d1x9t1u/q9nTwYDKY/LERD63XX33XT43Xf53XH63X7rxgZP3X7szgBH3X7tzgBf" +
  "3X7uzgBX3X7zkd1+9JjdfvWb3X72muKLU+6A8jNU3X7zxgjdd/vdfvTOAN13/N1+9c4A3Xf93X72zgDd" +
  "d/7dfuvdlvvdfuzdnvzdfu3dnv3dfu7dnv7iy1PugPIzVN1+78YIT91+8M4AR91+8c4AX91+8s4AV91+" +
  "95HdfviY3X75m91++pri+1PugPIzVN1+98YIT91++M4AR91++c4AX91++s4AV91+75HdfvCY3X7xm91+" +
  "8priK1TugPIzVCHEwDYB3TT/ww9S3fnd4cnd5d0hAADdOfXdd//ddf4OACG9x3mWMDQRHccGAGlgKQkZ" +
  "6xpH3X7/kCAea2Ij3X7+liAVExMatygKOr/H1gE+ABcYCTq/xxgEDBjFr9353eHJ7VsUwLcoEn23KAch" +
  "CQAZfhgXIQoAGX4YEH23KAchCwAZfhgFIQwAGX63KAQWAF/JEQAAyd3l3SEAAN059d02/wAhvcfdfv+W" +
  "MFHdTv8GAGlgKQnrIR3HGesaT2tiI37dd/4TExpHtygFOr/HGAg6v8fWAT4AF2/FeM2QVMHdbv4mACkp" +
  "KSkpeeYfBgBPCSl89nhnz+vf3TT/GKbd+d3hyTrAx7fI7UsswCouwK+5mD4AnT4AnOJKVe6A8CHAxzYA" +
  "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" +
  "fvLdd/zdfvPdd/3dfvTdd/7dfvXdd//dfvUH5gHdd/bdfvLGB913991+884A3Xf43X70zgDdd/ndfvXO" +
  "AN13+t1+9rcoGN1+9913/N1++N13/d1++d13/t1++t13/91m/N1u/cs9yxzLPcscyz3LHMXV3W77fM0I" +
  "DG/Rwd1+6JXKHmfdbundZur95ePdbuvj491m7OP94d1+7AfmAd13+91+6cYH3Xf83X7qzgDdd/3dfuvO" +
  "AN13/t1+7M4A3Xf/3X77tygU3W783Wb9/eXj3W7+4+PdZv/j/eHLPMsdyzzLHcs8yx3dfu23KAbdTu7d" +
  "Ru/LOMsZyzjLGcs4yxl5zQgMT91+6JEoXSEKADnrIQUAOQEEAO2w3X77tygOIQoAOeshGAA5AQQA7bDd" +
  "bu7dZu/LPMsdyzzLHcs8yx3dTvLdRvPdfva3KAbdTvfdRvjLOMsZyzjLGcs4yxl5zQgMT91+6JEgBSHE" +
  "wDYBzU0szYoxzTBVzXRZzbBezbtezVxxzaAWzcYXzZQlzWQuzV41zaUYzSoZzfNxzY1xOsTAtygJ3X7m" +
  "zTNiw4xiOsPAt8qMYg48xc3Wb8ENIPjdTuYGAAPdXucWAHmTeJrih2fugPKgZ91+5t13/900/91+/913" +
  "/gef3Xf/GAev3Xf+3Xf/3X7+3XfmzdBew4xizdZvIUABzfduIQBA5REAAGXNFXHNKHHNPHEuPz4BzZBv" +
  "IQAB5SrByeURYAEhAALNl3AhQAHNUHEhQAHN4m4hCHrPISZozeJxIYZ6zyE4aM3icSGIe88hT2jN4nHN" +
  "1m/N42975jAo9c3Wb83jb3vmMCD1yVBPQ0tFVCBQTEFURk9STUVSAGZvciBTZWdhIE1hc3RlciBTeXN0" +
  "ZW0AUHJlc3MgMSB0byBzdGFydAAuAM0tby4AzUNvLgDNI2/Ns2fN2gq3KPfNEAvN1m8hQAHN924hAEDl" +
  "EQAAZc0Vcc3uFCFAAc3ibs1dYhjScG9ja2V0LXBsYXRmb3JtZXItc21zAFBvY2tldCBQbGF0Zm9ybWVy" +
  "IFNNUyBFbmdpbmUAR2VuZXJhdGVkIGJ5IHBvY2tldC1wbGF0Zm9ybWVyLXRvLXNtcyB3ZWIgZXhwb3J0" +
  "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" +
  "GAzdTgTdRgXdXgbdfgdX1cXdXvvdVvzdbv3dZv7NFXPx8d1++t2u/ygOr5NfPgCaVz4AnW+flGfd+d3h" +
  "yd3l3SEAAN059fUzM9Xddf7ddP8hAABdVA4g3X7/B+YBR93L/Cbdy/0W3cv+Ft3L/xYpyxPLEstAKALL" +
  "xX3dlgR83Z4Fe92eBnrdngc4HH3dlgRvfN2eBWd73Z4GX3rdngdX3X789gHdd/wNIK3R1d1u/t1m/935" +
  "3eHJ3eXdIQAA3Tn19fXdc/zdcv3ddf7ddP9NRN1eBN1WBWlgzcFx3XP+3XL/S0Ldfgbdd/rdfgfdd/vh" +
  "0dXlxd1u+t1m+83BcevBCevdc/7dcv9LQt1e/d1mBcUuAFUGCCkwARkQ+sEJ691z/t1y/91eBN1m/S4A" +
  "VQYIKTABGRD6TUTdXvzdZgXFLgBVBggpMAEZEPrB691zBd1yBmtiCevdcwXdcgZ7kXqYPgAX3XcH3V78" +
  "3WYELgBVBggpMAEZEPrr3XP83XL93TYEAN1+/N2GBF/dfv3djgVX3X7+3Y4Gb91+/92OB2fd+d3hyQAD" +
  "AAAAAAAAAAAEIAgIAQEPAHixKAgRwckhenTtsMkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//9mMZmZAEw=";
