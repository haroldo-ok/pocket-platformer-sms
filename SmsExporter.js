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
    'portal2': 18,
  }; /* portal (blue/orange) handled specially below */

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
        // Portal: type determined by extraAttributes.portalType (check BEFORE typeId guard)
        if (obj.type === 'portal' || obj.type === 'portal2') {
          const isOrange = (obj.extraAttributes && obj.extraAttributes.portalType === 'orange')
                        || obj.type === 'portal2';
          objects.push({ x: obj.x, y: obj.y, type: isOrange ? 18 : 17 });
          continue;
        }
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDcHAh" +
  "AMB+BgBwEQHAAcAK7bAy9cnNqnTNxm77zYFodhj9ZGV2a2l0U01TAAAAw69w7aPto+2j7aPto+2j7aPt" +
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
  "GNzR1d353eHJAAIEBwkLDQ8SFBYYGh0fISMlJykrLjAyNDY4Ojw+P0FDRUdJS0xOUFJTVVdYWltdXmBh" +
  "Y2RlZ2hpa2xtbm9wcXJzdHV2d3d4eXl6e3t8fH19fX5+fn9/f39/f39/f39/fn5+fX19fHx7e3p5eXh3" +
  "d3Z1dHNycXBvbm1sa2loZ2VkY2FgXl1bWlhXVVNSUE5MS0lHRUNBPz48Ojg2NDIwLispJyUjIR8dGhgW" +
  "FBIPDQsJBwQCAP78+ff18/Hu7Oro5uPh393b2dfV0tDOzMrIxsTCwL+9u7m3tbSysK6tq6mopqWjoqCf" +
  "nZybmZiXlZSTkpGQj46NjIuKiYmIh4eGhYWEhIODg4KCgoGBgYGBgYGBgYGBgoKCg4ODhISFhYaHh4iJ" +
  "iYqLjI2Oj5CRkpOUlZeYmZucnZ+goqOlpqipq62usLK0tbe5u72/wMLExsjKzM7Q0tXX2dvd3+Hj5ujq" +
  "7O7x8/X3+fz+f39/f39/fn5+fX19fHx7e3p5eXh3d3Z1dHNycXBvbm1sa2loZ2VkY2FgXl1bWlhXVVNS" +
  "UE5MS0lHRUNBQD48Ojg2NDIwLispJyUjIR8dGhgWFBIPDQsJBwQCAP78+ff18/Hu7Oro5uPh393b2dfV" +
  "0tDOzMrIxsTCwb+9u7m3tbSysK6tq6mopqWjoqCfnZybmZiXlZSTkpGQj46NjIuKiYmIh4eGhYWEhIOD" +
  "g4KCgoGBgYGBgYGBgYGBgoKCg4ODhISFhYaHh4iJiYqLjI2Oj5CRkpOUlZeYmZucnZ+goqOlpqipq62u" +
  "sLK0tbe5u72/wMLExsjKzM7Q0tXX2dvd3+Hj5ujq7O7x8/X3+fz+AAIEBwkLDQ8SFBYYGh0fISMlJykr" +
  "LjAyNDY4Ojw+QEFDRUdJS0xOUFJTVVdYWltdXmBhY2RlZ2hpa2xtbm9wcXJzdHV2d3d4eXl6e3t8fH19" +
  "fX5+fn9/f39/3eXdIQAA3Tkh+f85+d13/c0tJ+s+AjL//902/wBdVBN+3Xf+3X7/3Zb9MBXdTv4uAH2R" +
  "MAYTExMsGPbr3TT/GNzdfv4ye8k+CP0he8n9lgAwBP02AAjdNv4A3Tb/ACo1ySMj3X7/ltJoKyF7yd1+" +
  "/pbSaCvdTv8GAGlgKQlNRDo5yYFPOjrJiEfdcfvdcPzhwcXlAwMK1hDCYivdbv4mACkpKX3GO913+XzO" +
  "yd13+t1u+91m/H6Hh4fh5XfBxQPdbvvdZvwjfoeHhwLh5SMjNg4jNgHh5QEEAAkad91++cYF3Xf73X76" +
  "zgDdd/xrYiNOedYBMAUBAQAYCD4IkTADAQgA3W773Wb8cd1++cYGT91++s4AR2tiIyN+AuHlAQcACTYB" +
  "ExMT3TT+3TT/w5cq3fnd4cnd5d0hAADdOf0h8P/9Of353XX+3XT/S0LtWyDBKiLBPgjLLMsdyxrLGz0g" +
  "9d1z+t1y+911/N10/e1bJMEqJsE+CMssyx3LGssbPSD1MzPV3XXy3XTz3X7+xvrdd/Tdfv/O/9139d1+" +
  "/sYG3Xf23X7/zgDdd/d5xvpfeM7/VyEGAAndTvrdRvt5xgbdd/h4zgDdd/ndfvDdd/rdfvHdd/vdfvrG" +
  "CN13/N1++84A3Xf9ed2W9njdnvfiKSzugPJlLN1+9N2W+N1+9d2e+eI9LO6A8mUs3X76ld1++5ziTSzu" +
  "gPJlLHvdlvx63Z794l0s7oDyZSwBAQAYAwEAAHnd+d3hyd3l3SEAAN05IfP/Ofk6e8m3yoAu3Tb+ACF7" +
  "yd1+/pbSgC7dbv4mACkpKRE7yRnddfXddPbhwcXlIQcACX7dd/+3ynou4cHF5SEGAAlO3X71xgLdd/rd" +
  "fvbOAN13+91u+t1m+37dd/wjft13/d1+9cYEX91+9s4AVxpHebcoOkgGAHndhvxfeN2O/VfdbvrdZvtz" +
  "I3LdbvrdZvtOI0Z71mh63gE4T3nGmE94zv5H3W763Wb7cSNwGDwOAN1+/JDdfv2ZMBXdfvzGaE/dfv3O" +
  "AUfdbvrdZvtxI3DdbvrdZvt+I2ZvGgYAT7/tQuvdbvrdZvtzI3LdfvXGAd13/N1+9s4A3Xf9OsTBtyAr" +
  "3W783Wb9ft13/913+N02+QDdbvXdZvZuJgDdXvjdVvnNbSu3KAUhxME2Ad1++t13991++913+N1+/N13" +
  "+d1+/d13+t1+9d13+91+9t13/N02/wHdbvvdZvwRBQAZ3X7/ltJ6LjrEwbfCei7dbvfdZvhOI2YRaAFp" +
  "zTNyMzPV3W7/JgApKSnl/eHdbvXdZvZOBgA+0d2G818+KN2O9FcaXwefV8X95f3l4c3icesRfwDNQnLr" +
  "/eHBCU1E3W753Wb6biYA3X7zxmlf3X70zidXGl8Hn1flxf3l4c3icdX94RF/AP3l4c1CcsHhGetpYM1t" +
  "K913/bcoBSHEwTYB3TT/w8st3TT+w4Ys3fnd4cnd5d0hAADdOSHy/zn5OnvJt8puMN02/gAhe8ndfv6W" +
  "0m4w3W7+JgApKSkRO8kZ48HFIQcACX63ymgw4eV+DgAqP8GV3Xf6eZzdd/vdfvLGAd139N1+884A3Xf1" +
  "3W703Wb1ft13/N02/QDdfvrW+N1++xc/H95/OHKv3b76PgHdnvviCy/ugPpvL93L/X4gWz7A3b78PgDd" +
  "nv3iIy/ugPpvL91++t13/913+N02+QDdfvjdd/rdNvsA3X763Xf53Tb4AK/2FN13+t1++d13+91+/N13" +
  "/913/N02/QDdXvrdVvvdbvzdZv3Ng3HdfvLdd/bdfvPdd/fBxd02/wEhBQAJ3X7/ltJoMN1u9t1m9yMj" +
  "fiNmb8URaAHNM3LB3XP43XL53W7/JgApKSnddfrddPvh5W4mAD7R3Yb4Xz4o3Y75VxpfB59X5cXdbvrd" +
  "ZvvN4nHV/eERfwD95eHNQnLB4RnddfzddP3dbvTdZvVuJgA+ad2G+F8+J92O+VcaXwefV+XF3W763Wb7" +
  "zeJx1f3hEX8A/eXhzUJyweEZ7Vs/wd1+/JNf3X79mld71vh6Fz8f3n84K6+7PgGa4kEw7oD6YjDLfCAa" +
  "PsC9PgCc4lMw7oD6YjBTr/YUXyYAxc2DccHdNP/DgS/dNP7DnS7d+d3hyd3l3SEAAN059fUqNckjI37+" +
  "gDgCPoDdd/whzMk2ACH//zYCAXzJ3Tb/AN1+/92W/NJBMTrMydYQ0kEx3V7/FgBrYikZ3XX93XT+/So5" +
  "yd1e/d1W/v0Z/X4C/hEoBNYSIGftW8zJFgBrYikpGQndfv937VvMyRYAa2IpKRkJIyM2AO1bzMkWAGti" +
  "KSkZCSMjIzYA7VvMyRYAa2IpKRkJ6xMTExP9KjnJxd1O/d1G/v0Jwf1+AhLtW8zJFgBrYikpGQkjNv8h" +
  "zMk03TT/w50w3Tb/AN1e/xYAEzrMyW8mAHuVepziWjHugPKmMd1e/xYAa2IpKRkJ5f3h/eXRIQQAGX7W" +
  "ESAq3V7/HHsHn1drYikpGRF8yRldVCMjIyN+1hIgDv3l4SMadxP9fgAS3TT/3TT/GJ/d+d3hyd3l3SEA" +
  "AN05IeH/OfntWyDBKiLBBgjLLMsdyxrLGxD23XPl3XLm3XXn3XTo7VskwSomwQYIyyzLHcsayxsQ9t1z" +
  "6d1y6t1169107DrMybfKejXdfuXGBt137d1+5s4A3Xfu3X7nzgDdd+/dfujOAN138N1+6cYI3Xfx3X7q" +
  "zgDdd/LdfuvOAN13891+7M4A3Xf03Tb/ACHMyd1+/5bSejXdTv8GAGlgKSkJEXzJGd1149105N1+48YC" +
  "3Xf13X7kzgDdd/bdbvXdZvZ+3Xf+tygO3X7+Pd1u9d1m9nfDdDUh//82At1u491m5E4GAGlgKQnr/So5" +
  "yf0Z/W4AJgARAAAGAynLE8sSEPnddffddPjdc/ndcvr9bgGvZ08GAymPyxEQ+t11+910/N13/d1x/t1+" +
  "98b+T91++M7/R91++c7/X91++s7/V3ndlu143Z7ue92e73rdnvDiBzPugPKaM91+98YKT91++M4AR91+" +
  "+c4AX91++s4AV91+5ZHdfuaY3X7nm91+6JriNzPugPKaM91++8b+T91+/M7/R91+/c7/X91+/s7/V3nd" +
  "lvF43Z7ye92e83rdnvTiZzPugPKaM91++8YKT91+/M4AR91+/c4AX91+/s4AV91+6ZHdfuqY3X7rm91+" +
  "7JrilzPugPqgM902/gAYBN02/gHdTv7R4eUjIyPVebcgBHfDdDV+t8J0NTYB4cHF5QMK3Xf9PMp0Nd02" +
  "/gAhzMndfv6W0nQ13U7+BgBpYCkpCeshfMkZ3XX33XT43X79lsJuNd1O/QYAaWApCd11+910/Do5yd2G" +
  "+913/To6yd2O/N13/t1+/d13+d1+/t13+t1u+d1m+n7dd/uv3Xf83Xf93Xf+3X773Xfh3X783Xfi3X79" +
  "3Xfj3X7+3XfkBgPdy+Em3cviFt3L4xbdy+QWEO7dfuHGAd13+91+4s4A3Xf83X7jzgDdd/3dfuTOAN13" +
  "/gYI3cv7Jt3L/Bbdy/0W3cv+FhDuESDBIRoAOQEEAO2w3X753Xf93X763Xf+3W793Wb+I37dd/7dd/uv" +
  "3Xf83Xf93Xf+BgPdy/sm3cv8Ft3L/Rbdy/4WEO7dfvvG/9134d1+/M7/3Xfi3X79zv/dd+Pdfv7O/913" +
  "5N1+4d13/N1+4t13/d1+4913/t02+wARJMEhGgA5AQQA7bAhAAAiKMEiKsEiLMEiLsEhMsE2ACExwTYB" +
  "3W713Wb2NjzdfvfGAt13/d1++M4A3Xf+3W793Wb+NjzdfvfGA913/d1++M4A3Xf+3W793Wb+NgEYBt00" +
  "/sPOM900/8NBMt353eHJ3eXdIQAA3Tn19TrMybfKQDYh//82Ag4AIczJeZbSQDYGAGlgKSkJEXzJGePh" +
  "5V4WAGtiKRnr/So5yf0Z/W4AJgApKSntWz/Bv+1S6/1uASYAKSkp3XX+3XT/e9b4ehc/H95/OFivuz4B" +
  "muLuNe6A+jw23cv/fiBFPsDdvv4+AN2e/+IGNu6A+jw24eUjI363KATLVyAn4eUjIyMjftYRIAUhFQEY" +
  "AyEWAX1THgBDs194slfdbv4mAMXNg3HBDMOXNd353eHJ3eXdIQAA3Tk760tCAwr15j/dd//xBwfmAzJ/" +
  "xxpPBgARAABTWEEOAD4DyyDLE8sSPSD3eSGAx3cjeMYBdyN7zgB3I3rOAHfdXv8WACEAAGVqUx4ABgPL" +
  "Iu1qEPrtU4THIobHIX7HNgEhiMc2ACEAACIswSIuwSIowSIqwSEwwTYAITHBNgAhMsE2ACEzwTYAM93h" +
  "yd3l3SEAAN059fVPISDBOoDHdyM6gcd3IzqCx3cjOoPHdyEkwTqEx3cjOoXHdyM6hsd3IzqHx3chAAAi" +
  "LMEiLsEiKMEiKsEhMcE2ACEywTYAeeYQTwYAeLEgBT4BMojHOojHt8pvOHixym84rzJ+xzp/x7coFjp/" +
  "xz3K+Dc6f8f+AihP1gPKNzjDajg6gMfdd/w6gcfGCN13/TqCx84A3Xf+OoPHzgDdd/8RIMEhAAA5AQQA" +
  "7bAhAAIiKMFlIirBIizBIi7BITHBNgEhisc2AcNqODqAx8YA3Xf8OoHHzvjdd/06gsfO/913/jqDx87/" +
  "3Xf/ESDBIQAAOQEEAO2wIQD+IijBIf//IirBIQAAIizBIi7BITHBNgEhisc2ARhyOoTHTzqFx8b4RzqG" +
  "x87/XzqHx87/V+1DJMHtUybBIQD6IizBIf//Ii7BIQAAIijBIirBITLBNgAhMcE2ARgzOoTHTzqFx8YI" +
  "RzqGx84AXzqHx84AV+1DJMHtUybBIQAGIizBZSIuwSIowSIqwSExwTYBIYnHNgHd+d3hyToxwbfIOorH" +
  "t8AqLMHtWy7BfcYqT3zOAEcwARPtQyzB7VMuwa+5PgeYPgCbPgCa4qg47oDwIQAHIizBZSIuwcnd5d0h" +
  "AADdOf0h7f/9Of353XX+3XT/3XP83XL9KhbA3XX13XT2TiN+RwefX1c6MMHdd/e3KBzdbvXdZvYjIyN+" +
  "K27ddfjdd/kHn913+t13+xgd3W713Wb2xQEHAAnBfitu3XX43Xf5B5/dd/rdd/vdfve3KB7dbvXdZvYj" +
  "IyMjI34rbt119N139Qef3Xf23Xf3GB3dbvXdZvbFAQkACcF+K27ddfTdd/UHn9139t13993L/lbK6jnV" +
  "xREowSEHADnrAQQA7bDB0d1+8N2W+N139N1+8d2e+d139d1+8t2e+t139t1+892e+91399XFESjBIQsA" +
  "OQEEAO2wwdGvkU8+AJhHIQAA7VLr3X70kd1+9Zjdfvab3X73muLSOe6A8t057UMowe1TKsEhN8E2ASGK" +
  "xzYAw+A63cv+Xihy1cURKMEhBwA56wEEAO2wwdHdfvDdhvjdd/TdfvHdjvndd/XdfvLdjvrdd/bdfvPd" +
  "jvvdd/fVxREowSELADkBBADtsMHRed2W9HjdnvV73Z72et2e9+JKOu6A8lU67UMowe1TKsEhN8E2ACGK" +
  "xzYAw+A6OonHtyB47VsowSoqwd1O9t1G98XdTvTdRvXFzbBz8fFNRD4IyyjLGcsayxs9IPXtUyjB7UMq" +
  "wdXFESjBIQ8AOesBBADtsMHRPoC7Pv+aPv+ZPv+Y4rs67oDy4DrdfvjWgN1++d4A3X763gDdfvsXPx/e" +
  "gDAJIQAAIijBIirB7VsgwSoiwQYIyyzLHcsayxsQ9nvG/9137XrO/9137n3O/91373zO/9138HvGB913" +
  "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" +
  "ASPdTv7dRv/F3U783Ub9xc2QDrfKTEzdbvDdZvHdXvLdVvPdy/N+KBjdfvDGB2/dfvHOAGfdfvLOAF/d" +
  "fvPOAFcGA8sqyxvLHMsdEPZ9xgHdd+N8zgDdd+R7zgDdd+V6zgDdd+Y6wMi3wvxLKhTAEQ0AGX63yvxL" +
  "7Usgwe1bIsE+CMsqyxvLGMsZPSD13XH83XD93XP+3XL/y3ooGHnGB913/HjOAN13/XvOAN13/nrOAN13" +
  "/91u/N1m/cs8yx3LPMsdyzzLHWV5xgbdd/R4zgDdd/V7zgDdd/Z6zgDdd/fdfvTdd/zdfvXdd/3dfvbd" +
  "d/7dfvfdd//dy/d+KBh5xg3dd/x4zgDdd/17zgDdd/56zgDdd//dTvzdRv3LOMsZyzjLGcs4yxndfuM9" +
  "R8VofM0IDMHdd/9oec0IDE/9KhTA/eXRIQ0AGV7dfv+TKBH9Rg7dfv+QKAh5uygEkML8Szq/yNYBPgAX" +
  "Mr/IzeVUKhTA3XX+3XT/Or/ItygN3U7+3Ub/IQ0ACU4YC91u/t1m/xEOABlOQXm3KAVIBgAYAwEAAB4A" +
  "Ib7Ie5YwOmsmACn9Ia3IxU1E/QnB/eXhI24mACkpKSkpfVT9bgD1feYfb/EmAIVveozLJY/2eGfFz8Fp" +
  "YN8cGL/tSyDB7VsiwT4IyyrLG8sYyxk9IPXdfvjdd+fdfvndd+jdfvrdd+ndfvvdd+rdfufGCN13691+" +
  "6M4A3Xfs3X7pzgDdd+3dfurOAN137nnGBt1373jOAN138HvOAN138XrOAN138t02/wAhvcjdfv+W0vdL" +
  "1d1e/xYAa2IpGdH9IR3IxU1E/QnB/X4A3Xf7r913/N13/d13/vXdfvvdd/Pdfvzdd/Tdfv3dd/Xdfv7d" +
  "d/bxPgPdy/Mm3cv0Ft3L9Rbdy/YWPSDt/eXhI37dd/uv3Xf83Xf93Xf+9d1++913991+/N13+N1+/d13" +
  "+d1+/t13+vE+A93L9ybdy/gW3cv5Ft3L+hY9IO39fgK3KAU6v8gYCDq/yNYBPgAXt8rxS91+892W791+" +
  "9N2e8N1+9d2e8d1+9t2e8uJRS+6A8vFL3X7zxgjdd/vdfvTOAN13/N1+9c4A3Xf93X72zgDdd/553Zb7" +
  "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" +
  "yBgEDBjFr9353eHJ3eXdIQAA3Tkh6/85+TocyNYBPgAXMhzI3Tb/ACEbyN1+/5bSWlTdTv8GAGlgKQnd" +
  "df3ddP4+i92G/d13+z7H3Y7+3Xf83W773Wb8ft13/d1++913+d1+/N13+t1u+d1m+iN+3Xf+3W773Wb8" +
  "IyNOebcoBTocyBgIOhzI1gE+ABfdd/oqFMDddfvddPx5tygh3X76tygN3U773Ub8IQ8ACUYYC91O+91G" +
  "/CEQAAlGeBge3X76tygN3U773Ub8IREACX4YC91u+91m/BESABl+tygEBgAYAq9HX1Ddbv4mACkpKSkp" +
  "3X795h9PBgAJKXz2eGfP69/dfvq3ylRU7VsgwSoiwQYIyyzLHcsayxsQ9jMz1d117d107u1bJMEqJsEG" +
  "CMssyx3LGssbEPbdc+/dcvDddfHddPLdbv2vZ08GAymPyxEQ+t1189109N139d1x9t1u/q9nTwYDKY/L" +
  "ERD63XX33XT43Xf53XH63X7rxgZP3X7szgBH3X7tzgBf3X7uzgBX3X7zkd1+9JjdfvWb3X72muKsU+6A" +
  "8lRU3X7zxgjdd/vdfvTOAN13/N1+9c4A3Xf93X72zgDdd/7dfuvdlvvdfuzdnvzdfu3dnv3dfu7dnv7i" +
  "7FPugPJUVN1+78YIT91+8M4AR91+8c4AX91+8s4AV91+95HdfviY3X75m91++priHFTugPJUVN1+98YI" +
  "T91++M4AR91++c4AX91++s4AV91+75HdfvCY3X7xm91+8priTFTugPJUVCHEwTYB3TT/wzBS3fnd4cnd" +
  "5d0hAADdOfXdd//ddf4OACG9yHmWMDQRHcgGAGlgKQkZ6xpH3X7/kCAea2Ij3X7+liAVExMatygKOr/I" +
  "1gE+ABcYCTq/yBgEDBjFr9353eHJ7VsUwLcoEn23KAchCQAZfhgXIQoAGX4YEH23KAchCwAZfhgFIQwA" +
  "GX63KAQWAF/JEQAAyd3l3SEAAN059d02/wAhvcjdfv+WMFHdTv8GAGlgKQnrIR3IGesaT2tiI37dd/4T" +
  "ExpHtygFOr/IGAg6v8jWAT4AF2/FeM2xVMHdbv4mACkpKSkpeeYfBgBPCSl89nhnz+vf3TT/GKbd+d3h" +
  "yTrAyLfI7UsswSouwa+5mD4AnT4AnOJrVe6A8CHAyDYAyd3l3SEAAN05Iev/OfntWyDBKiLBBgjLLMsd" +
  "yxrLGxD23XP13XL23XX33XT4KiTB7VsmwQYIyyrLG8scyx0Q9t1O9d1G9v3l491u9+Pj3Wb44/3h3cv4" +
  "figk3X71xgdP3X72zgBH3X73zgD95d136f3h3X74zgD95d136v3hyzjLGcs4yxnLOMsZ3XH93X71xgXd" +
  "d/ndfvbOAN13+t1+984A3Xf73X74zgDdd/zdTvndRvr95ePdbvvj491m/OP94d3L/H4oJN1++cYHT91+" +
  "+s4AR91++84A/eXdd+n94d1+/M4A/eXdd+r94cs4yxnLOMsZyzjLGd1x/tX94U1Ey3ooHH3GB098zgBH" +
  "e84A/eXdd+n94XrOAP3l3Xfq/eHLOMsZyzjLGcs4yxndcf/FAQgACcEwARPV/eFNRMt6KBoBBwAJTUR7" +
  "zgD95d136f3hes4A/eXdd+r94cs4yxnLOMsZyzjLGd1+/d13791x8N1+/t138d1x8t1+/d13891+/913" +
  "9N02/wDdbv8mAClNRCEEADkJft13+iN+3Xf7b91++s0IDN13/CoUwN11/d10/gEHAAlOebcoEd1+/JEg" +
  "C91u+91++s1yDBhA3U793Ub+IQgACU55tygR3X78kSAL3W773X76zcMMGCDdTv3dRv4hJQAJfrcoEk/L" +
  "+d1+/JEgCd1u+91++s26Dd00/91+/9YD2vlW/SoUwP1+Jd13/7fKkFkRIMEhEQA56wEEAO2w3X783Xfr" +
  "3X793Xfs3X7+3Xft3X7/3XfuBgjdy+4u3cvtHt3L7B7dy+seEO4hEQA56yEAADkBBADtsN3L7n4oIN1+" +
  "68YH3Xf83X7szgDdd/3dfu3OAN13/t1+7s4A3Xf/3U783Ub93XH+3XD/3cv/Pt3L/h7dy/8+3cv+Ht3L" +
  "/z7dy/4e3X7+3Xf13X7rxgXdd/jdfuzOAN13+d1+7c4A3Xf63X7uzgDdd/shEQA56yENADkBBADtsN3L" +
  "+34oIN1+68YM3Xf83X7szgDdd/3dfu3OAN13/t1+7s4A3Xf/3X783Xf+3X793Xf/3cv/Pt3L/h7dy/8+" +
  "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" +
  "3X78xgTdd/Ldfv3OAN13891+/s4A3Xf03X7/zgDdd/XdfvLdd/zdfvPdd/3dfvTdd/7dfvXdd//dfvUH" +
  "5gHdd/bdfvLGB913991+884A3Xf43X70zgDdd/ndfvXOAN13+t1+9rcoGN1+9913/N1++N13/d1++d13" +
  "/t1++t13/91m/N1u/cs9yxzLPcscyz3LHMXV3W77fM0IDG/Rwd1+6JXKP2fdbundZur95ePdbuvj491m" +
  "7OP94d1+7AfmAd13+91+6cYH3Xf83X7qzgDdd/3dfuvOAN13/t1+7M4A3Xf/3X77tygU3W783Wb9/eXj" +
  "3W7+4+PdZv/j/eHLPMsdyzzLHcs8yx3dfu23KAbdTu7dRu/LOMsZyzjLGcs4yxl5zQgMT91+6JEoXSEK" +
  "ADnrIQUAOQEEAO2w3X77tygOIQoAOeshGAA5AQQA7bDdbu7dZu/LPMsdyzzLHcs8yx3dTvLdRvPdfva3" +
  "KAbdTvfdRvjLOMsZyzjLGcs4yxl5zQgMT91+6JEgBSHEwTYBzW4szasxzVFVzZVZzdFezdxezX1xzcEW" +
  "zecXzbUlzYUuzX81zcYYzUsZzRRyza5xOsTBtygJ3X7mzVRiw61iOsPBt8qtYg48xc33b8ENIPjdTuYG" +
  "AAPdXucWAHmTeJriqGfugPLBZ91+5t13/900/91+/913/gef3Xf/GAev3Xf+3Xf/3X7+3XfmzfFew61i" +
  "zfdvIUABzRhvIQBA5REAAGXNNnHNSXHNXXEuPz4BzbFvIQAB5SrByuURYAEhAALNuHAhQAHNcXEhQAHN" +
  "A28hCHrPIUdozQNyIYZ6zyFZaM0DciGIe88hcGjNA3LN92/NBHB75jAo9c33b80EcHvmMCD1yVBPQ0tF" +
  "VCBQTEFURk9STUVSAGZvciBTZWdhIE1hc3RlciBTeXN0ZW0AUHJlc3MgMSB0byBzdGFydAAuAM1Oby4A" +
  "zWRvLgDNRG/N1GfN2gq3KPfNEAvN928hQAHNGG8hAEDlEQAAZc02cc28FCFAAc0Db81+YhjScG9ja2V0" +
  "LXBsYXRmb3JtZXItc21zAFBvY2tldCBQbGF0Zm9ybWVyIFNNUyBFbmdpbmUAR2VuZXJhdGVkIGJ5IHBv" +
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
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABHZW5lcmF0" +
  "ZWQgYnkgcG9ja2V0LXBsYXRmb3JtZXItdG8tc21zIHdlYiBleHBvcnRlci4AUG9ja2V0IFBsYXRmb3Jt" +
  "ZXIgU01TIEVuZ2luZQBwb2NrZXQtcGxhdGZvcm1lci1zbXMAU0RTQwEDAQElIMp/rX95f1RNUiBTRUdB" +
  "//+UQ5mZAEw=";
