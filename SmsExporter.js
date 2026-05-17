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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDSGEh" +
  "AMB+BgBwEQHAAS4J7bAyY8jNCGXNnl/7zVlZdhj9ZGV2a2l0U01TAAAAw4dh7aPto+2j7aPto+2j7aPt" +
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
  "d/rdTvfdRvjLOMsZyzjLGcs4yxndbvt5zQgM3Xf23X773Xf37UsgwO1bIsA+CMsqyxvLGMsZPSD13XH4" +
  "3XD53XP63XL7y3ooGHnGB913+HjOAN13+XvOAN13+nrOAN13+91O+N1G+cs4yxnLOMsZyzjLGQzdbvd5" +
  "zQgMT/0qFMD9RgbdfvaQKAd5kCgDrxgCPgG3KEftSyTAKibA3XH4eMYI3Xf5fc4A3Xf6fM4A3Xf73Vby" +
  "3W7z3Wb0HgAGA8si7WoQ+nvdlvh63Z75fd2e+nzdnvvioTjugPo/Pd1+8t1e891u9N1m9QYDh8sT7WoQ" +
  "+cb4T3vO/0d9zv9ffM7/3XH93XD+3XP/3Tb8ACEAACIswCIuwCEwwDYBITHANgAhMsA2ACEzwDYAITjA" +
  "NgAhicY2ACGKxjYAwz893W7+3Wb/5d1u/N1m/eXdXvTdVvXdbvbdZvfNkA63ICPtWyDAKiLAesYEVzAB" +
  "I91O/t1G/8XdTvzdRv3FzZAOt8o/Pd1u8N1m8d1e8t1W893L834oGN1+8MYHb91+8c4AZ91+8s4AX91+" +
  "884AVwYDyyrLG8scyx0Q9n3GAd1343zOAN135HvOAN135XrOAN135jrAx7fC+zwqFMARDQAZfrfK+zzt" +
  "SyDA7VsiwD4IyyrLG8sYyxk9IPXdcfzdcP3dc/7dcv/LeigYecYH3Xf8eM4A3Xf9e84A3Xf+es4A3Xf/" +
  "3W783Wb9yzzLHcs8yx3LPMsdZXnGBt139HjOAN139XvOAN139nrOAN13991+9N13/N1+9d13/d1+9t13" +
  "/t1+9913/93L934oGHnGDd13/HjOAN13/XvOAN13/nrOAN13/91O/N1G/cs4yxnLOMsZyzjLGd1+4z1H" +
  "xWh8zQgMwd13/2h5zQgMT/0qFMD95dEhDQAZXt1+/5MoEf1GDt1+/5AoCHm7KASQwvs8Or/H1gE+ABcy" +
  "v8fN2EUqFMDddf7ddP86v8e3KA3dTv7dRv8hDQAJThgL3W7+3Wb/EQ4AGU5BebcoBUgGABgDAQAAHgAh" +
  "vsd7ljA6ayYAKf0hrcfFTUT9CcH95eEjbiYAKSkpKSl9VP1uAPV95h9v8SYAhW96jMslj/Z4Z8XPwWlg" +
  "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" +
  "3Xf73X7gzgDdd/zdfvndluHdfvrdnuLdfvvdnuPdfvzdnuTiyEHugPqqQioWwN11/t10/xEKABl+3Xf+" +
  "I37dd//dfv7dd93dfv/dd94Hn91339134N1+3d13+d1+3t13+t1+3913+91+4N13/AYC3cv5Jt3L+hbd" +
  "y/sW3cv8FhDuIQAA5S4P5d1e+d1W+t1u+91m/M0EY/Hx3XPh3XLi3XXj3XTk3X7h3Ybd3Xf53X7i3Y7e" +
  "3Xf63X7j3Y7f3Xf73X7k3Y7g3Xf8ETvAIRwAOQEEAO2wITLANgEhNsA2ACExwDYAITDANgAhOMA2ADob" +
  "x7coFs0HQxgRPkPdhv1vPsDOAGd+tyACNgHdNP3D8z3d+d3hyd3l3SEAAN059d13/911/g4AIRvHeZYw" +
  "NBGLxgYAaWApCRnrGkfdfv+QIB5rYiPdfv6WIBUTExq3KAo6HMfWAT4AFxgJOhzHGAQMGMWv3fnd4cnd" +
  "5d0hAADdOSHr/zn5OhzH1gE+ABcyHMfdNv8AIRvH3X7/ltJNRd1O/wYAaWApCd11/d10/j6L3Yb93Xf7" +
  "Psbdjv7dd/zdbvvdZvx+3Xf93X773Xf53X783Xf63W753Wb6I37dd/7dbvvdZvwjI055tygFOhzHGAg6" +
  "HMfWAT4AF913+ioUwN11+910/Hm3KCHdfvq3KA3dTvvdRvwhDwAJRhgL3U773Ub8IRAACUZ4GB7dfvq3" +
  "KA3dTvvdRvwhEQAJfhgL3W773Wb8ERIAGX63KAQGABgCr0dfUN1u/iYAKSkpKSndfv3mH08GAAkpfPZ4" +
  "Z8/r391++rfKR0XtWyDAKiLABgjLLMsdyxrLGxD2MzPV3XXt3XTu7VskwComwAYIyyzLHcsayxsQ9t1z" +
  "791y8N118d108t1u/a9nTwYDKY/LERD63XXz3XT03Xf13XH23W7+r2dPBgMpj8sREPrddffddPjdd/nd" +
  "cfrdfuvGBk/dfuzOAEfdfu3OAF/dfu7OAFfdfvOR3X70mN1+9Zvdfvaa4p9E7oDyR0XdfvPGCN13+91+" +
  "9M4A3Xf83X71zgDdd/3dfvbOAN13/t1+692W+91+7N2e/N1+7d2e/d1+7t2e/uLfRO6A8kdF3X7vxghP" +
  "3X7wzgBH3X7xzgBf3X7yzgBX3X73kd1++Jjdfvmb3X76muIPRe6A8kdF3X73xghP3X74zgBH3X75zgBf" +
  "3X76zgBX3X7vkd1+8JjdfvGb3X7ymuI/Re6A8kdFIcTANgHdNP/DI0Pd+d3hyd3l3SEAAN059d13/911" +
  "/g4AIb3HeZYwNBEdxwYAaWApCRnrGkfdfv+QIB5rYiPdfv6WIBUTExq3KAo6v8fWAT4AFxgJOr/HGAQM" +
  "GMWv3fnd4cntWxTAtygSfbcoByEJABl+GBchCgAZfhgQfbcoByELABl+GAUhDAAZfrcoBBYAX8kRAADJ" +
  "3eXdIQAA3Tn13Tb/ACG9x91+/5YwUd1O/wYAaWApCeshHccZ6xpPa2Ijft13/hMTGke3KAU6v8cYCDq/" +
  "x9YBPgAXb8V4zaRFwd1u/iYAKSkpKSl55h8GAE8JKXz2eGfP69/dNP8Ypt353eHJOsDHt8jtSyzAKi7A" +
  "r7mYPgCdPgCc4l5G7oDwIcDHNgDJ3eXdIQAA3Tkh6/85+e1bIMAqIsAGCMssyx3LGssbEPbdc/Xdcvbd" +
  "dffddPgqJMDtWybABgjLKssbyxzLHRD23U713Ub2/eXj3W734+PdZvjj/eHdy/h+KCTdfvXGB0/dfvbO" +
  "AEfdfvfOAP3l3Xfp/eHdfvjOAP3l3Xfq/eHLOMsZyzjLGcs4yxndcf3dfvXGBd13+d1+9s4A3Xf63X73" +
  "zgDdd/vdfvjOAN13/N1O+d1G+v3l491u++Pj3Wb84/3h3cv8figk3X75xgdP3X76zgBH3X77zgD95d13" +
  "6f3h3X78zgD95d136v3hyzjLGcs4yxnLOMsZ3XH+1f3hTUTLeigcfcYHT3zOAEd7zgD95d136f3hes4A" +
  "/eXdd+r94cs4yxnLOMsZyzjLGd1x/8UBCAAJwTABE9X94U1Ey3ooGgEHAAlNRHvOAP3l3Xfp/eF6zgD9" +
  "5d136v3hyzjLGcs4yxnLOMsZ3X793Xfv3XHw3X7+3Xfx3XHy3X793Xfz3X7/3Xf03Tb/AN1u/yYAKU1E" +
  "IQQAOQl+3Xf6I37dd/tv3X76zQgM3Xf8KhTA3XX93XT+AQcACU55tygR3X78kSAL3W773X76zXIMGEDd" +
  "Tv3dRv4hCAAJTnm3KBHdfvyRIAvdbvvdfvrNwwwYIN1O/d1G/iElAAl+tygST8v53X78kSAJ3W773X76" +
  "zboN3TT/3X7/1gPa7Ef9KhTA/X4l3Xf/t8qDShEgwCERADnrAQQA7bDdfvzdd+vdfv3dd+zdfv7dd+3d" +
  "fv/dd+4GCN3L7i7dy+0e3cvsHt3L6x4Q7iERADnrIQAAOQEEAO2w3cvufigg3X7rxgfdd/zdfuzOAN13" +
  "/d1+7c4A3Xf+3X7uzgDdd//dTvzdRv3dcf7dcP/dy/8+3cv+Ht3L/z7dy/4e3cv/Pt3L/h7dfv7dd/Xd" +
  "fuvGBd13+N1+7M4A3Xf53X7tzgDdd/rdfu7OAN13+yERADnrIQ0AOQEEAO2w3cv7figg3X7rxgzdd/zd" +
  "fuzOAN13/d1+7c4A3Xf+3X7uzgDdd//dfvzdd/7dfv3dd//dy/8+3cv+Ht3L/z7dy/4e3cv/Pt3L/h7d" +
  "fv7dd/YRJMAhEQA56wEEAO2w3X783Xf33X793Xf43X7+3Xf53X7/3Xf6Bgjdy/ou3cv5Ht3L+B7dy/ce" +
  "EO4hAAA56yEMADkBBADtsN1+98YH3Xf73X74zgDdd/zdfvnOAN13/d1++s4A3Xf+3cv6figOIQAAOesh" +
  "EAA5AQQA7bDBxcs4yxnLOMsZyzjLGd1x/91O+91G/N3L/n4oDN1+98YOT91++M4AR8s4yxnLOMsZyzjL" +
  "Gd1x/t1O9d1+9pE4Kt1G/91+/pA4HsVoec0IDMEqFMARJQAZXsv7kyAHxWh5zboNwQQY3AwY0N353eHJ" +
  "3eXdIQAA3Tkh6P85+c1lRt02/wDdfv/dd/3dNv4A3X793Xf73X7+3Xf8BgLdy/sm3cv8FhD2PsXdhvvd" +
  "d/0+x92O/N13/t1+/d136N1+/t136d1+6MYC3Xfq3X7pzgDdd+vdburdZut+3Xf+t8o/Td1e/hzB4eXF" +
  "c+HlRuHlI0545h/dcezdburdZutuFgDdd+3dcu571iggHGkmACkpKSkp3V7t3VbuGSl89nhnzyEAAN/D" +
  "P0191sjaP01or2dfBgMpj8sTEPrdde/ddPDdd/Hdc/Jpr2dPBgMpj8sREPrddfPddPTdd/XdcfbtWyDA" +
  "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" +
  "yyzLHcsayxsQ9t1z8t1y89119N109SH//zYCIRQAOeshDgA5AQQA7bDdfvUH5gHdd/bdfvLGB9136d1+" +
  "884A3Xfq3X70zgDdd+vdfvXOAN137N1+9rcoDiEUADnrIQUAOQEEAO2w3U743Ub5yzjLGcs4yxnLOMsZ" +
  "3XH33X78xgFP3X79zgBH3X7+zgBf3X7/zgBX3XH43XD53XP63XL7egfmAd137XnGB9137njOAN1373vO" +
  "AN138HrOAN138d1+7bcoGN1+7t13+N1+7913+d1+8N13+t1+8d13+91m+N1u+cs9yxzLPcscyz3LHMXV" +
  "3W73fM0IDG/Rwd1+6JXKI1jdfvLdd/jdfvPdd/ndfvTdd/rdfvXdd/vdfva3KBjdfundd/jdfurdd/nd" +
  "fuvdd/rdfuzdd/vdbvjdZvnLPMsdyzzLHcs8yx3ddfvdfvzGBN138t1+/c4A3Xfz3X7+zgDdd/Tdfv/O" +
  "AN139d1+8t13/N1+8913/d1+9N13/t1+9d13/91+9QfmAd139t1+8sYH3Xf33X7zzgDdd/jdfvTOAN13" +
  "+d1+9c4A3Xf63X72tygY3X733Xf83X743Xf93X753Xf+3X763Xf/3Wb83W79yz3LHMs9yxzLPcscxdXd" +
  "bvt8zQgMb9HB3X7olcojWN1u6d1m6v3l491u6+Pj3Wbs4/3h3X7sB+YB3Xf73X7pxgfdd/zdfurOAN13" +
  "/d1+684A3Xf+3X7szgDdd//dfvu3KBTdbvzdZv395ePdbv7j491m/+P94cs8yx3LPMsdyzzLHd1+7bco" +
  "Bt1O7t1G78s4yxnLOMsZyzjLGXnNCAxP3X7okShdIQoAOeshBQA5AQQA7bDdfvu3KA4hCgA56yEYADkB" +
  "BADtsN1u7t1m78s8yx3LPMsdyzzLHd1O8t1G891+9rcoBt1O991G+Ms4yxnLOMsZyzjLGXnNCAxP3X7o" +
  "kSAFIcTANgHNREbNiErNxE/Nz0/NVWLNnxbNrRfNzSXNjBjNERnN7GLNhmI6xMC3KAndfubNPlPDl1M6" +
  "w8C3ypdTDjzFzc9gwQ0g+N1O5gYAA91e5xYAeZN4muKAWO6A8plY3X7m3Xf/3TT/3X7/3Xf+B5/dd/8Y" +
  "B6/dd/7dd//dfv7dd+bN5E/Dl1PNz2AhQAHN8F8hAEDlEQAAZc0OYs0hYs01Yi4/PgHNiWAhAAHlKi/J" +
  "5RFgASEAAs2QYSFAAc1JYiFAAc3bXyEIes8hH1nN22IhhnrPITFZzdtiIYh7zyFIWc3bYs3PYM3cYHvm" +
  "MCj1zc9gzdxge+YwIPXJUE9DS0VUIFBMQVRGT1JNRVIAZm9yIFNlZ2EgTWFzdGVyIFN5c3RlbQBQcmVz" +
  "cyAxIHRvIHN0YXJ0AC4AzSZgLgDNPGAuAM0cYM2sWM3aCrco980QC83PYCFAAc3wXyEAQOURAABlzQ5i" +
  "ze4UIUABzdtfzWhTGNJwb2NrZXQtcGxhdGZvcm1lci1zbXMAUG9ja2V0IFBsYXRmb3JtZXIgU01TIEVu" +
  "Z2luZQBHZW5lcmF0ZWQgYnkgcG9ja2V0LXBsYXRmb3JtZXItdG8tc21zIHdlYiBleHBvcnRlci4AOjvI" +
  "t8g+n9N/Pr/TfzpQyLcgBD7f0386Uci3IAQ+/9N/ITvINgDJOjvIt8A6Scj2kNN/OkrI9rDTfzpQyLcg" +
  "FzpNyOYP9sDTfzpOyOY/0386S8j20NN/OlHItyAQOk/I5g/24NN/OkzI9vDTfyE7yDYByc39WSFDyDYB" +
  "0cHF1e1DPMjtQz7I7UNAyCFCyDYAIUbINgAhRMg2nyE7yDYBySFDyDYAycHh5cXlzXBa8SFDyDYAyf0h" +
  "O8j9bgDJPp/Tfz6/038+39N/Pv/Tf8nd5d0hAADdOfX9IUXI/X4A3Xf+r913//1OADo7yLcoWDpJyOYP" +
  "XxYA4eUZPg+9PgCc4gFb7oDyCVsRDwAYCTpJyOYPgV8Xn3v2kNN/OkrI5g9fFgDh5Rk+D70+AJziLVvu" +
  "gPI1WxEPABgJOkrI5g+BXxefe/aw0386UMi3KAk6Usj20NN/GDI6O8i3KCw6S8jmD18WAOHlGT4PvT4A" +
  "nOJuW+6A8nZbEQ8AGAk6S8jmD4FfF5979tDTfzpRyLcoCTpTyPbw038YMjo7yLcoLDpMyOYPbyYA0dUZ" +
  "Pg+9PgCc4q9b7oDyt1sBDwAYCTpMyOYPgU8Xn3n28NN/3fnd4cnd5d0hAADdOfXdfgQyRcg6O8i3yrRc" +
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
  "//9/T5mZAEw=";
