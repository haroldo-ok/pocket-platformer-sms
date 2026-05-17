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
  "/s4A3Xf63X7/zgDdd/vdbvjdZvndXvrdVvsGA8sqyxvLHMsdEPYGAynLE8sSEPkB+f8JTUR7zv9fes7/" +
  "3XH13XD23XP33Tb0ACEAACIowCIqwCGJxjYAIYrGNgDDkjXdy/9+ypI17UskwComwHjGAUcwASPlxd1e" +
  "9N1W9d1u9t1m982QDrcgIu1LJMAqJsB4xgZHMAEj5cXdXvTdVvXdbvbdZvfNkA63KGjdTvjdRvndbvrd" +
  "Zvvdy/t+KBjdfvjGB0/dfvnOAEfdfvrOAG/dfvvOAGdZUAYDyyzLHcsayxsQ9hwgBBQgASNlalMeAAYD" +
  "yyLtahD6MzPV3XX23XT3IQAAIijAIirAIYnGNgAhisY2ABEgwCEAADkBBADtsN353eHJ3eXdIQAA3Tkh" +
  "4/85+e1LJMDtWybA1cURLMAhDQA56wEEAO2wwdF53YbsT3jdju1He92O7l963Y7vV3khNcmGI094jiNH" +
  "e44jX3qOV91x/N1w/d1z/t1y/91+/N13+N1+/d13+d1+/t13+t1+/913+wYI3cv7Lt3L+h7dy/ke3cv4" +
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
  "zQBGzURKzYBPzYtPzRFizZ8Wza0XzX0lzYwYzREZzahizUJiOsTAtygJ3X7mzfpSw1NTOsPAt8pTUw48" +
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
  "//8hJZmZAEw=";
