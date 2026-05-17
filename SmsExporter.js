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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDBWEh" +
  "AMB+BgBwEQHAAS4J7bAyY8jNxWTNW1/7zRZZdhj9ZGV2a2l0U01TAAAAw0Rh7aPto+2j7aPto+2j7aPt" +
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
  "fM4A3Xfg3X78xgbdd+Hdfv3OAN134t1+/s4A3Xfj3X7/zgDdd+TdNv8AIX3G3X7/ltJgJd1O/wYAaWAp" +
  "CSkpCSnddfvddPzdfvvGrd13/d1+/M7F3Xf+3X793Xfl3X7+3Xfm3X7l3Xf93X7m3Xf+3W793Wb+ERgA" +
  "GX63ylol3X7lxgTdd+fdfubOAN136N1u591m6F4jViMjfituZwYIyyzLHcsayxsQ9t1z6d1y6t116910" +
  "7N1u5d1m5l4jViNOI24GCMstyxnLGssbEPbdc/fdcvjdcfnddfrdfuXGFN137d1+5s4A3Xfu3W7t3Wbu" +
  "ft13+902/ADdfvvdd/3dfvzdd/7dy/x+KBDdfvvGAd13/d1+/M4A3Xf+3U793Ub+yyjLGXgH7WLdfveR" +
  "T91++JhH3X75nV/dfvqcV91++9139t1+/N139wef3Xf43Xf53X72gW/dfveIZ91++Iv95d13z/3h3X75" +
  "it1179108P3l49118eP94d138tXFESzAIS4AOesBBADtsMHR3X7lxhXdd/PdfubOAN139N1+5cYZ3Xf1" +
  "3X7mzgDdd/bdfuXGEN13991+5s4A3Xf43X7lxhLdd/ndfubOAN13+t3L/n7C4yPdft3dlundft7dnurd" +
  "ft/dnuvdfuDdnuziwCLugPrjI91+6cYE3Xf73X7qzgDdd/zdfuvOAN13/d1+7M4A3Xf+3X773Zbd3X78" +
  "3Z7e3X793Z7f3X7+3Z7g4gAj7oD64yPdftndlu/dftrdnvDdftvdnvHdftzdnvLiICPugPLjI91+4cb/" +
  "3Xf73X7izv/dd/zdfuPO/913/d1+5M7/3Xf+ed2W+3jdnvx73Z79et2e/uJYI+6A8uMj3W7z3Wb0frcg" +
  "CN1u891m9DYB3W713Wb2NgHdbvfdZvhOI37dcdHdd9IHn91309131N1u+d1m+k4jft1x1d131gef3XfX" +
  "3XfY3W7n3WboTiNGI14jVnjG+Ed7zv9fes7/V+1DJMDtUybAIQAAIizAIi7AITDANgEhMcA2ACEywDYA" +
  "ITjANgAYCN1u9d1m9jYA3W7z3Wb0frcofN1e5d1W5iEqADnrAQQA7bDdbvfdZvhOI0Z4B+1i3X77gU/d" +
  "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" +
  "wBEGABlOkSgWxWjdfvPND0XBtyAKaN1+881yQrcoA68YAj4B3Xf63cv8ZsrPLiEwwF57tygmITLANgEh" +
  "M8A2ACE2wDYAITHANgAhMMA2ADobx7fKzy7NxELDzy7tSxbAxf3h/X4QtyhLe7cgR91++7cgBt1++rco" +
  "OyEywDYAITPANgEhNsA2ACExwDYAITjANgDdfvu3KAUBAQAYAwH/ACE0wHEhNcA2ADobx7coMM3EQhgr" +
  "IQ8ACX63KCM6OMC3IB0hMsA2ASEzwDYAITbANgAhOMA2ATobx7coA83EQjoywN13+91+/uYQ3Xf13Tb2" +
  "AN1++7fK7i8RO8AhCwA56wEEAO2wr92++N2e+T4A3Z76PgDdnvviCy/ugAfmAd13991+9t229SAH3X73" +
  "t8rML91+97coECEEADnrIQsAOQEEAO2wGBgqFsARCgAZTiN+3XHx3XfyB5/dd/Pdd/QhCgA56yEEADkB" +
  "BADtsDo2wDzdd/shNsDdfvt3KhbAEQwAGW4mAN1O+wYAv+1C63oH7WLdTvndRvrF3U733Ub4xc3LY/Hx" +
  "r5NPPgCaRz4AnV+flFftQyzA7VMuwP0qFsD9TgzdfvuRODchMsA2ACExwDYBIQAAIjvAIj3AGCLdfvvd" +
  "tvrdtvndtvggFCEywDYA/SoWwP1+DDI2wCExwDYBOjPA3Xf7t8q8Mt1+9t229cqnMjo2wDzdd/shNsDd" +
  "fvt3KhbA3XX43XT53X743Xf23X753Xf33W723Wb3EQwAGX7dd/rdd/TdNvUA3X773Xf23Tb3AN1+9N2W" +
  "9t13+t1+9d2e9913+91++t138d1++9138gef3Xfz3Xf03X743Xf63X753Xf73W763Wb7EQoAGX7dd/oj" +
  "ft13+91++t13+N1++913+Qef3Xf63Xf7b2fl3W743Wb55d1e8d1W8t1u891m9M3LY/HxMzPV3XXv3XTw" +
  "r92W7d13+D4A3Z7u3Xf5PgDdnu/dd/qf3Zbw3Xf7ESzAIQsAOQEEAO2wOjXA3Xf1KhbA3XX23XT33X72" +
  "3Xf63X733Xf73W763Wb7EQwAGX7dd/vdd/jdNvkA3X743Xf63X753Xf73cv5figQ3X74xgHdd/rdfvnO" +
  "AN13+91O+t1G+8soyxl5xvxPeM7/R91+9RYAkXqY4lsx7oDyjTLdTvbdRvchCgAJTiNGeAftYuXF3V7x" +
  "3Vby3W7z3Wb0zctj8fFNRDo0wN13+9XFESjAIQcAOesBBADtsMHR3XP03XL13XH23XD3BgTdy/cu3cv2" +
  "Ht3L9R7dy/QeEO7dfvs9IF3dfvDdhvTdd/jdfvHdjvXdd/ndfvLdjvbdd/rdfvPdjvfdd/sRKMAhCwA5" +
  "AQQA7bAqFsBOI0Z4B59fV3ndlvh43Z75e92e+nrdnvviETLugPKGMu1DKMDtUyrAGGjdfvDdlvTdd/jd" +
  "fvHdnvXdd/ndfvLdnvbdd/rdfvPdnvfdd/sRKMAhCwA5AQQA7bAqFsBOI35HB59fV6+RTz4AmEchAADt" +
  "UuvdfviR3X75mN1++pvdfvua4nsy7oDyhjLtQyjA7VMqwDo1wDwyNcA6NsAqFsARDAAZTpE4ISEzwDYA" +
  "ITHANgEYFSEzwDYAKhbAEQwAGX4yNsAhMcA2AToywLcgWTozwLcgU+1LLMDtWy7Ay3ooRzqJxrcgQdXF" +
  "EcAAIQAAzctj8fFNRD4IyyjLGcsayxs9IPXtUyzA7UMuwD6Auz7/mj7/mT7/mOIPM+6A8hszIQAAIizA" +
  "Ii7A3fnd4cnd5d0hAADdOSH0/zn57UsowO1bKsB5ITHJhiNPeI4jR3uOI196jlfdcfzdcP3dc/7dcv8R" +
  "IMAhAAA56wEEAO2w3X703Yb83Xf43X713Y793Xf53X723Y7+3Xf63X733Y7/3Xf7IQAAOeshBAA5AQQA" +
  "7bDdfvTdd/jdfvXdd/ndfvbdd/rdfvfdd/sGCN3L+y7dy/oe3cv5Ht3L+B4Q7q/dvvzdnv0+AN2e/j4A" +
  "3Z7/4tQz7oDy3zTdfvTdd/zdfvXGBt13/d1+9s4A3Xf+3X73zgDdd//tSyTAKibAeMYBRzABI+XF3V78" +
  "3Vb93W7+3Wb/zZAOtyAj7UskwComwHjGBkcwASPlxd1e/N1W/d1u/t1m/82QDrfKkjXdfvjGBt13/N1+" +
  "+c4A3Xf93X76zgDdd/7dfvvOAN13/yEEADnrIQgAOQEEAO2w3cv/figg3X78xgfdd/jdfv3OAN13+d1+" +
  "/s4A3Xf63X7/zgDdd/vdbvjdZvndXvrdVvsGA8sqyxvLHMsdEPYGAynLE8sSEPkB+f8JTUR7zv9fes7/" +
  "3XH13XD23XP33Tb0ACEAACIowCIqwCGJxjYAIYrGNgDDkjXdy/9+ypI17UskwComwHjGAUcwASPlxd1e" +
  "9N1W9d1u9t1m982QDrcgIu1LJMAqJsB4xgZHMAEj5cXdXvTdVvXdbvbdZvfNkA63KGjdTvjdRvndbvrd" +
  "Zvvdy/t+KBjdfvjGB0/dfvnOAEfdfvrOAG/dfvvOAGdZUAYDyyzLHcsayxsQ9hwgBBQgASNlalMeAAYD" +
  "yyLtahD6MzPV3XX23XT3IQAAIijAIirAIYnGNgAhisY2ABEgwCEAADkBBADtsN353eHJ3eXdIQAA3Tkh" +
  "4/85+e1LLMDtWy7AeSE1yYYjT3iOI0d7jiNfeo5X3XHs3XDt3XPu3XLv7UskwComwN1+7IFP3X7tiEfd" +
  "fu6NX91+74zdcfzdcP3dc/7dd//dfvzdd/jdfv3dd/ndfv7dd/rdfv/dd/sGCN3L+y7dy/oe3cv5Ht3L" +
  "+B4Q7iENADnrIRUAOQEEAO2w7UsgwCoiwN1x9HjGAd139X3OAN139nzOAN13993L737CtDjdTvzdfv3G" +
  "CEfdfv7OAP3l3Xfh/eHdfv/OAP3l3Xfi/eHF/eX95cXdXvTdVvXdbvbdZvfNyRH94cG3IBjtWyDAKiLA" +
  "esYEVzABI/3lxc3JEbfK/DzdfvDGCN139N1+8c4A3Xf13X7yzgDdd/bdfvPOAN139yEVADnrIREAOQEE" +
  "AO2w3cv3figg3X70xgfdd/jdfvXOAN13+d1+9s4A3Xf63X73zgDdd/vdfvjdd/Ldfvndd/Pdfvrdd/Td" +
  "fvvdd/UGA93L9S7dy/Qe3cvzHt3L8h4Q7v0qFMD9fga3ylU43X7y3Xf77UsgwO1bIsA+CMsqyxvLGMsZ" +
  "PSD13XH33XD43XP53XL6y3ooGHnGB91393jOAN13+HvOAN13+XrOAN13+t1O991G+Ms4yxnLOMsZyzjL" +
  "Gd1u+3nNCAzdd/bdfvvdd/ftSyDA7VsiwD4IyyrLG8sYyxk9IPXdcfjdcPndc/rdcvvLeigYecYH3Xf4" +
  "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" +
  "fvTOAN13691+9c4A3Xfs3X72tygOIRQAOeshBQA5AQQA7bDdTvjdRvnLOMsZyzjLGcs4yxndcffdfvzG" +
  "AU/dfv3OAEfdfv7OAF/dfv/OAFfdcfjdcPndc/rdcvt6B+YB3XftecYH3XfueM4A3Xfve84A3Xfwes4A" +
  "3Xfx3X7ttygY3X7u3Xf43X7v3Xf53X7w3Xf63X7x3Xf73Wb43W75yz3LHMs9yxzLPcscxdXdbvd8zQgM" +
  "b9HB3X7olcrgV91+8t13+N1+8913+d1+9N13+t1+9d13+91+9rcoGN1+6d13+N1+6t13+d1+6913+t1+" +
  "7N13+91u+N1m+cs8yx3LPMsdyzzLHd11+91+/MYE3Xfy3X79zgDdd/Pdfv7OAN139N1+/84A3Xf13X7y" +
  "3Xf83X7z3Xf93X703Xf+3X713Xf/3X71B+YB3Xf23X7yxgfdd/fdfvPOAN13+N1+9M4A3Xf53X71zgDd" +
  "d/rdfva3KBjdfvfdd/zdfvjdd/3dfvndd/7dfvrdd//dZvzdbv3LPcscyz3LHMs9yxzF1d1u+3zNCAxv" +
  "0cHdfuiVyuBX3W7p3Wbq/eXj3W7r4+PdZuzj/eHdfuwH5gHdd/vdfunGB913/N1+6s4A3Xf93X7rzgDd" +
  "d/7dfuzOAN13/91++7coFN1u/N1m/f3l491u/uPj3Wb/4/3hyzzLHcs8yx3LPMsd3X7ttygG3U7u3Ubv" +
  "yzjLGcs4yxnLOMsZec0IDE/dfuiRKF0hCgA56yEFADkBBADtsN1++7coDiEKADnrIRgAOQEEAO2w3W7u" +
  "3WbvyzzLHcs8yx3LPMsd3U7y3Ubz3X72tygG3U733Ub4yzjLGcs4yxnLOMsZec0IDE/dfuiRIAUhxMA2" +
  "Ac0BRs1FSs2BT82MT80SYs2fFs2tF819Jc2MGM0RGc2pYs1DYjrEwLcoCd1+5s37UsNUUzrDwLfKVFMO" +
  "PMXNjGDBDSD43U7mBgAD3V7nFgB5k3ia4j1Y7oDyVljdfubdd//dNP/dfv/dd/4Hn913/xgHr913/t13" +
  "/91+/t135s2hT8NUU82MYCFAAc2tXyEAQOURAABlzcthzd5hzfJhLj8+Ac1GYCEAAeUqL8nlEWABIQAC" +
  "zU1hIUABzQZiIUABzZhfIQh6zyHcWM2YYiGGes8h7ljNmGIhiHvPIQVZzZhizYxgzZlge+YwKPXNjGDN" +
  "mWB75jAg9clQT0NLRVQgUExBVEZPUk1FUgBmb3IgU2VnYSBNYXN0ZXIgU3lzdGVtAFByZXNzIDEgdG8g" +
  "c3RhcnQALgDN418uAM35Xy4AzdlfzWlYzdoKtyj3zRALzYxgIUABza1fIQBA5REAAGXNy2HN7hQhQAHN" +
  "mF/NJVMY0nBvY2tldC1wbGF0Zm9ybWVyLXNtcwBQb2NrZXQgUGxhdGZvcm1lciBTTVMgRW5naW5lAEdl" +
  "bmVyYXRlZCBieSBwb2NrZXQtcGxhdGZvcm1lci10by1zbXMgd2ViIGV4cG9ydGVyLgA6O8i3yD6f038+" +
  "v9N/OlDItyAEPt/TfzpRyLcgBD7/038hO8g2AMk6O8i3wDpJyPaQ0386Ssj2sNN/OlDItyAXOk3I5g/2" +
  "wNN/Ok7I5j/TfzpLyPbQ0386Uci3IBA6T8jmD/bg0386TMj28NN/ITvINgHJzbpZIUPINgHRwcXV7UM8" +
  "yO1DPsjtQ0DIIULINgAhRsg2ACFEyDafITvINgHJIUPINgDJweHlxeXNLVrxIUPINgDJ/SE7yP1uAMk+" +
  "n9N/Pr/Tfz7f038+/9N/yd3l3SEAAN059f0hRcj9fgDdd/6v3Xf//U4AOjvItyhYOknI5g9fFgDh5Rk+" +
  "D70+AJzivlrugPLGWhEPABgJOknI5g+BXxefe/aQ0386SsjmD18WAOHlGT4PvT4AnOLqWu6A8vJaEQ8A" +
  "GAk6SsjmD4FfF5979rDTfzpQyLcoCTpSyPbQ038YMjo7yLcoLDpLyOYPXxYA4eUZPg+9PgCc4itb7oDy" +
  "M1sRDwAYCTpLyOYPgV8Xn3v20NN/OlHItygJOlPI9vDTfxgyOjvItygsOkzI5g9vJgDR1Rk+D70+AJzi" +
  "bFvugPJ0WwEPABgJOkzI5g+BTxefefbw03/d+d3hyd3l3SEAAN059d1+BDJFyDo7yLfKcVw6ScjmD08e" +
  "AP0hRcj9fgDdd/6v3Xf/ed2G/kd73Y7/X/1OAD4PuD4Am+LLW+6A8tNbEQ8AGAk6ScjmD4FfF5979pDT" +
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
  "//8DK5mZAEw=";
