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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDD92Ah" +
  "AMB+BgBwEQHAAS4J7bAyY8jNr2TNTV/7zQhZdhj9ZGV2a2l0U01TAAAAwzZh7aPto+2j7aPto+2j7aPt" +
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
  "PgjLKssbyxjLGT0g9d1x+N1w+d1z+t1y+8t6KBh5xgfdd/h4zgDdd/l7zgDdd/p6zgDdd/vdTvjdRvnL" +
  "OMsZyzjLGcs4yxkM3W73ec0IDE/9KhTA/UYG3X72kCgHeZAoA68YAj4BtyhH7UskwComwN1x+HjGCN13" +
  "+X3OAN13+nzOAN13+91W8t1u891m9B4ABgPLIu1qEPp73Zb4et2e+X3dnvp83Z774nU47oD6Ez3dfvLd" +
  "XvPdbvTdZvUGA4fLE+1qEPnG+E97zv9Hfc7/X3zO/91x/d1w/t1z/902/AAhAAAiLMAiLsAhMMA2ASEx" +
  "wDYAITLANgAhM8A2ACE4wDYAIYnGNgAhisY2AMMTPd1u/t1m/+XdbvzdZv3l3V703Vb13W723Wb3zZAO" +
  "tyAj7VsgwCoiwHrGBFcwASPdTv7dRv/F3U783Ub9xc2QDrfKEz3dbvDdZvHdXvLdVvPdy/N+KBjdfvDG" +
  "B2/dfvHOAGfdfvLOAF/dfvPOAFcGA8sqyxvLHMsdEPZ9xgHdd+N8zgDdd+R7zgDdd+V6zgDdd+Y6wMe3" +
  "ws88KhTAEQ0AGX63ys887UsgwO1bIsA+CMsqyxvLGMsZPSD13XH83XD93XP+3XL/y3ooGHnGB913/HjO" +
  "AN13/XvOAN13/nrOAN13/91u/N1m/cs8yx3LPMsdyzzLHWV5xgbdd/R4zgDdd/V7zgDdd/Z6zgDdd/fd" +
  "fvTdd/zdfvXdd/3dfvbdd/7dfvfdd//dy/d+KBh5xg3dd/x4zgDdd/17zgDdd/56zgDdd//dTvzdRv3L" +
  "OMsZyzjLGcs4yxndfuM9R8VofM0IDMHdd/9oec0IDE/9KhTA/eXRIQ0AGV7dfv+TKBH9Rg7dfv+QKAh5" +
  "uygEkMLPPDq/x9YBPgAXMr/HzaxFKhTA3XX+3XT/Or/HtygN3U7+3Ub/IQ0ACU4YC91u/t1m/xEOABlO" +
  "QXm3KAVIBgAYAwEAAB4AIb7He5YwOmsmACn9Ia3HxU1E/QnB/eXhI24mACkpKSkpfVT9bgD1feYfb/Em" +
  "AIVveozLJY/2eGfFz8FpYN8cGL/tSyDA7VsiwD4IyyrLG8sYyxk9IPXdfvjdd+fdfvndd+jdfvrdd+nd" +
  "fvvdd+rdfvjGCN13691++c4A3Xfs3X76zgDdd+3dfvvOAN137nnGBt1373jOAN138HvOAN138XrOAN13" +
  "8t02/wAhvcfdfv+W0so81d1e/xYAa2IpGdH9IR3HxU1E/QnB/X4A3Xf7r913/N13/d13/vXdfvvdd/Pd" +
  "fvzdd/Tdfv3dd/Xdfv7dd/bxPgPdy/Mm3cv0Ft3L9Rbdy/YWPSDt/eXhI37dd/uv3Xf83Xf93Xf+9d1+" +
  "+913991+/N13+N1+/d13+d1+/t13+vE+A93L9ybdy/gW3cv5Ft3L+hY9IO39fgK3KAU6v8cYCDq/x9YB" +
  "PgAXt8rEPN1+892W791+9N2e8N1+9d2e8d1+9t2e8uIkPO6A8sQ83X7zxgjdd/vdfvTOAN13/N1+9c4A" +
  "3Xf93X72zgDdd/553Zb7eN2e/Hvdnv163Z7+4lw87oDyxDzdfvfdluvdfvjdnuzdfvndnu3dfvrdnu7i" +
  "fDzugPLEPN1+98YI3Xf73X74zgDdd/zdfvnOAN13/d1++s4A3Xf+3X7n3Zb73X7o3Z783X7p3Z793X7q" +
  "3Z7+4rw87oDyxDwhxMA2Ad00/8NROyHAxzYB3X7j3Xf93X7k3Xf+3X7l3Xf/3Tb8AAYD3cv9Jt3L/hbd" +
  "y/8WEPIhAAAiLMAiLsAhMsA2ACEzwDYAKhbAEQwAGX4yNsARJMAhGQA5AQQA7bDd+d3hyd3l3SEAAN05" +
  "Id3/OfntWyDAKiLABgjLLMsdyxrLGxD23XPl3XLm3XXn3XTo7VskwComwAYIyyzLHcsayxsQ9t1z6d1y" +
  "6t1169107Co1yCMjfv6AOAI+gN137SH//zYC3X7pxgjdd+7dfurOAN13791+684A3Xfw3X7szgDdd/Hd" +
  "fuXGBt138t1+5s4A3Xfz3X7nzgDdd/TdfujOAN139d02/QDdfv3dlu3ShELdTv0GAGlgKQnrKjnIGd11" +
  "9t10926vZ08GAymPyxEQ+t114d104t13491x5N1O9t1G9wMDCt13+N1O9t1G9wMK3Xf53X741g4+ASgB" +
  "r913+t1++d13+902/ADdfvq3KA7dfvvmP913/t02/wAYDN1++913/t1+/N13/91e/t1+/1cH7WIGA8sj" +
  "yxLtahD4MzPV3XXf3XTg3X7h3Zby3X7i3Z7z3X7j3Z703X7k3Z714oQ+7oDyfkLdfuHGCE/dfuLOAEfd" +
  "fuPOAF/dfuTOAFfdfuWR3X7mmN1+55vdfuia4rQ+7oDyfkLdft3dlu7dft7dnu/dft/dnvDdfuDdnvHi" +
  "1D7ugPJ+Qt1+3cYIT91+3s4AR91+384AX91+4M4AV91+6ZHdfuqY3X7rm91+7JriBD/ugPJ+Qt1++NYC" +
  "KC/dfvjWA8p+Qt1++NYEyrZA3X741gXKbULdfvjWDCgY3X741g0oM91++rcgGsN+QiHDwDYBw35CzQ8W" +
  "t8J+QiHDwDYBw35COn7Gt8J+Qt1u9t1m981FJ8N+QjrGwLfCfkLdNv8A3Tb+AN1+/t2W/TA23U7+BgBp" +
  "YCkJ3XX53XT63X75ITnIht13+91++iOO3Xf83W773Wb8IyN+1g0gA900/900/hjC3X7/3Xf23X7/MqrF" +
  "OsXAMqvFzRUa3XP33XL43Tb+AN1O991G+APdbvfdZvh+3Xf/IcXA3X7+ljBm3XH33XD43U7/3Tb/AN1+" +
  "/5EwTd1e991W+BMa3Xf5E91z991y+B4Ae92W+TAu3W733Wb4ft13+t1+98YB3Xf73X74zgDdd/zdfvvd" +
  "hvrdd/fdfvzOAN13+BwYzN00/xit3TT+w9M/3XH63XD73X7/3Xf83Tb/AN1+/92W/DA+3X7/3Zb2MDbd" +
  "XvrdVvsTGk8T3XP63XL7HgB7kTAb3W763Wb7ft1u+t1m+yOF3Xf6PgCM3Xf7HBjh3TT/GLrdbvrdZvt+" +
  "MqzFw35C7UsswCouwMt8wn5C3X753Xfhr9134t1349135N1+4d13+d1+4t13+t1+4913+91+5N13/AYD" +
  "3cv5Jt3L+hbdy/sW3cv8FhDu3X75xgTdd93dfvrOAN133t1++84A3Xff3X78zgDdd+ARJMAhHAA56wEE" +
  "AO2wBgjdy/wu3cv7Ht3L+h7dy/keEO7dfvnGCN134d1++s4A3Xfi3X77zgDdd+PdfvzOAN135N1+3cYC" +
  "3Xf53X7ezgDdd/rdft/OAN13+91+4M4A3Xf83X753Zbh3X763Z7i3X773Z7j3X783Z7k4pxB7oD6fkIq" +
  "FsDddf7ddP8RCgAZft13/iN+3Xf/3X7+3Xfd3X7/3XfeB5/dd9/dd+Ddft3dd/ndft7dd/rdft/dd/vd" +
  "fuDdd/wGAt3L+Sbdy/oW3cv7Ft3L/BYQ7iEAAOUuD+XdXvndVvrdbvvdZvzNs2Lx8d1z4d1y4t114910" +
  "5N1+4d2G3d13+d1+4t2O3t13+t1+492O3913+91+5N2O4N13/BE7wCEcADkBBADtsCEywDYBITbANgAh" +
  "McA2ACEwwDYAITjANgA6G8e3KBbN20IYET5D3Yb9bz7AzgBnfrcgAjYB3TT9w8c93fnd4cnd5d0hAADd" +
  "OfXdd//ddf4OACEbx3mWMDQRi8YGAGlgKQkZ6xpH3X7/kCAea2Ij3X7+liAVExMatygKOhzH1gE+ABcY" +
  "CTocxxgEDBjFr9353eHJ3eXdIQAA3Tkh6/85+Tocx9YBPgAXMhzH3Tb/ACEbx91+/5bSIUXdTv8GAGlg" +
  "KQnddf3ddP4+i92G/d13+z7G3Y7+3Xf83W773Wb8ft13/d1++913+d1+/N13+t1u+d1m+iN+3Xf+3W77" +
  "3Wb8IyNOebcoBTocxxgIOhzH1gE+ABfdd/oqFMDddfvddPx5tygh3X76tygN3U773Ub8IQ8ACUYYC91O" +
  "+91G/CEQAAlGeBge3X76tygN3U773Ub8IREACX4YC91u+91m/BESABl+tygEBgAYAq9HX1Ddbv4mACkp" +
  "KSkp3X795h9PBgAJKXz2eGfP69/dfvq3yhtF7VsgwCoiwAYIyyzLHcsayxsQ9jMz1d117d107u1bJMAq" +
  "JsAGCMssyx3LGssbEPbdc+/dcvDddfHddPLdbv2vZ08GAymPyxEQ+t1189109N139d1x9t1u/q9nTwYD" +
  "KY/LERD63XX33XT43Xf53XH63X7rxgZP3X7szgBH3X7tzgBf3X7uzgBX3X7zkd1+9JjdfvWb3X72muJz" +
  "RO6A8htF3X7zxgjdd/vdfvTOAN13/N1+9c4A3Xf93X72zgDdd/7dfuvdlvvdfuzdnvzdfu3dnv3dfu7d" +
  "nv7is0TugPIbRd1+78YIT91+8M4AR91+8c4AX91+8s4AV91+95HdfviY3X75m91++pri40TugPIbRd1+" +
  "98YIT91++M4AR91++c4AX91++s4AV91+75HdfvCY3X7xm91+8priE0XugPIbRSHEwDYB3TT/w/dC3fnd" +
  "4cnd5d0hAADdOfXdd//ddf4OACG9x3mWMDQRHccGAGlgKQkZ6xpH3X7/kCAea2Ij3X7+liAVExMatygK" +
  "Or/H1gE+ABcYCTq/xxgEDBjFr9353eHJ7VsUwLcoEn23KAchCQAZfhgXIQoAGX4YEH23KAchCwAZfhgF" +
  "IQwAGX63KAQWAF/JEQAAyd3l3SEAAN059d02/wAhvcfdfv+WMFHdTv8GAGlgKQnrIR3HGesaT2tiI37d" +
  "d/4TExpHtygFOr/HGAg6v8fWAT4AF2/FeM14RcHdbv4mACkpKSkpeeYfBgBPCSl89nhnz+vf3TT/GKbd" +
  "+d3hyTrAx7fI7UsswCouwK+5mD4AnT4AnOIyRu6A8CHAxzYAyd3l3SEAAN05Iev/OfntWyDAKiLABgjL" +
  "LMsdyxrLGxD23XP13XL23XX33XT4KiTA7VsmwAYIyyrLG8scyx0Q9t1O9d1G9v3l491u9+Pj3Wb44/3h" +
  "3cv4figk3X71xgdP3X72zgBH3X73zgD95d136f3h3X74zgD95d136v3hyzjLGcs4yxnLOMsZ3XH93X71" +
  "xgXdd/ndfvbOAN13+t1+984A3Xf73X74zgDdd/zdTvndRvr95ePdbvvj491m/OP94d3L/H4oJN1++cYH" +
  "T91++s4AR91++84A/eXdd+n94d1+/M4A/eXdd+r94cs4yxnLOMsZyzjLGd1x/tX94U1Ey3ooHH3GB098" +
  "zgBHe84A/eXdd+n94XrOAP3l3Xfq/eHLOMsZyzjLGcs4yxndcf/FAQgACcEwARPV/eFNRMt6KBoBBwAJ" +
  "TUR7zgD95d136f3hes4A/eXdd+r94cs4yxnLOMsZyzjLGd1+/d13791x8N1+/t138d1x8t1+/d13891+" +
  "/9139N02/wDdbv8mAClNRCEEADkJft13+iN+3Xf7b91++s0IDN13/CoUwN11/d10/gEHAAlOebcoEd1+" +
  "/JEgC91u+91++s1yDBhA3U793Ub+IQgACU55tygR3X78kSAL3W773X76zcMMGCDdTv3dRv4hJQAJfrco" +
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
  "///BH5mZAEw=";
