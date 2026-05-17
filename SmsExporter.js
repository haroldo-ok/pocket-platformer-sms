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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDNGEh" +
  "AMB+BgBwEQHAASYJ7bAyW8jN7GTNil/7zUVZdhj9ZGV2a2l0U01TAAAAw3Nh7aPto+2j7aPto+2j7aPt" +
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
  "fM4A3Xfm3X78xgbdd+fdfv3OAN136N1+/s4A3Xfp3X7/zgDdd+rdNv8AIXXG3X7/ltKvJd1O/wYAaWAp" +
  "CSkpKQnddfvddPzdfvvGrd13/d1+/M7F3Xf+3X793Xfr3X7+3Xfs3X7r3Xf93X7s3Xf+3W793Wb+ERgA" +
  "GX7dd/63yqkl3X7rxhXdd+3dfuzOAN137t1u7d1m7k7dfuvGEN13791+7M4A3Xfw3X7rxgTdd/HdfuzO" +
  "AN138t1+68YS3Xfz3X7szgDdd/R5t8olIt1e691W7CEqADnrAQQA7bDdbu/dZvB+3Xf9I37dd/7dTv3d" +
  "fv5HB+1i3X75gU/dfvqIR91++41f3X78jFfdbuvdZuxxI3AjcyNy3V7x3VbyISwAOesBBADtsN1u891m" +
  "9E4jRngH7WLdfvuBT91+/IhH3X79jV/dfv6MV91u8d1m8nEjcCNzI3LdXuvdVuwhLAA56wEEAO2w3X78" +
  "3Xf13X793Xf23V7x3VbyISwAOesBBADtsN1+/N13991+/d13+N1+68YU3Xf53X7szgDdd/rdbvndZvp+" +
  "3Xf+3Xf73Tb8AN1++92G9d13/d1+/N2O9t13/t1+/db43X7+Fz8f3n84OT4I3b71PgHdnvbiriLugPrY" +
  "It1+99ZA3X74Fz8f3n84GD6A3b73PgHdnvjizyLugPrYIt02/gAYBN02/gHdfv7dd/3dfuvGF913991+" +
  "7M4A3Xf43X7+t8qOI91u7d1m7n7dd/63yo4j3W733Wb4ft13/jzdbvfdZvh31mTanCPdfuvdd/3dfuzd" +
  "d/7dXv3dVv4hLAA56wEIAAkBBADtsN1e691W7CEsADkBBADtsN1+6913/d1+7N13/t1e/d1W/iEsADnr" +
  "AQwACQEEAO2w3V7x3VbyISwAOQEEAO2w3W7t3WbuNgDdbvfdZvg2ABgO3X79tyAI3W733Wb4NgDdXvHd" +
  "VvIhLAA56wEEAO2w3X773XfT3X783XfU3X793XfV3X7+3XfWBgjdy9Yu3cvVHt3L1B7dy9MeEO7dXuvd" +
  "VuwhJgA56wEEAO2wBgjdy/gu3cv3Ht3L9h7dy/UeEO7dbvndZvp+3Xf63Xf53Tb6AN1++d138d1++t13" +
  "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" +
  "3XL6y3ooGHnGB91393jOAN13+HvOAN13+XrOAN13+t1O991G+Ms4yxnLOMsZyzjLGd1u+3nNCAzdd/bd" +
  "fvvdd/ftSyDA7VsiwD4IyyrLG8sYyxk9IPXdcfjdcPndc/rdcvvLeigYecYH3Xf4eM4A3Xf5e84A3Xf6" +
  "es4A3Xf73U743Ub5yzjLGcs4yxnLOMsZDN1u93nNCAxP/SoUwP1GBt1+9pAoB3mQKAOvGAI+AbcoR+1L" +
  "JMAqJsDdcfh4xgjdd/l9zgDdd/p8zgDdd/vdVvLdbvPdZvQeAAYDyyLtahD6e92W+Hrdnvl93Z76fN2e" +
  "++K+OO6A+lw93X7y3V7z3W703Wb1BgOHyxPtahD5xvhPe87/R33O/198zv/dcf3dcP7dc//dNvwAIQAA" +
  "IizAIi7AITDANgEhMcA2ACEywDYAITPANgAhOMA2ACGBxjYAIYLGNgDDXD3dbv7dZv/l3W783Wb95d1e" +
  "9N1W9d1u9t1m982QDrcgI+1bIMAqIsB6xgRXMAEj3U7+3Ub/xd1O/N1G/cXNkA63ylw93W7w3Wbx3V7y" +
  "3Vbz3cvzfigY3X7wxgdv3X7xzgBn3X7yzgBf3X7zzgBXBgPLKssbyxzLHRD2fcYB3XfjfM4A3Xfke84A" +
  "3Xfles4A3XfmOrjHt8IYPSoUwBENABl+t8oYPe1LIMDtWyLAPgjLKssbyxjLGT0g9d1x/N1w/d1z/t1y" +
  "/8t6KBh5xgfdd/x4zgDdd/17zgDdd/56zgDdd//dbvzdZv3LPMsdyzzLHcs8yx1lecYG3Xf0eM4A3Xf1" +
  "e84A3Xf2es4A3Xf33X703Xf83X713Xf93X723Xf+3X733Xf/3cv3figYecYN3Xf8eM4A3Xf9e84A3Xf+" +
  "es4A3Xf/3U783Ub9yzjLGcs4yxnLOMsZ3X7jPUfFaHzNCAzB3Xf/aHnNCAxP/SoUwP3l0SENABle3X7/" +
  "kygR/UYO3X7/kCgIebsoBJDCGD06t8fWAT4AFzK3x831RSoUwN11/t10/zq3x7coDd1O/t1G/yENAAlO" +
  "GAvdbv7dZv8RDgAZTkF5tygFSAYAGAMBAAAeACG2x3uWMDprJgAp/SGlx8VNRP0Jwf3l4SNuJgApKSkp" +
  "KX1U/W4A9X3mH2/xJgCFb3qMyyWP9nhnxc/BaWDfHBi/7UsgwO1bIsA+CMsqyxvLGMsZPSD13X743Xfn" +
  "3X753Xfo3X763Xfp3X773Xfq3X74xgjdd+vdfvnOAN137N1++s4A3Xft3X77zgDdd+55xgbdd+94zgDd" +
  "d/B7zgDdd/F6zgDdd/LdNv8AIbXH3X7/ltITPdXdXv8WAGtiKRnR/SEVx8VNRP0Jwf1+AN13+6/dd/zd" +
  "d/3dd/713X773Xfz3X783Xf03X793Xf13X7+3Xf28T4D3cvzJt3L9Bbdy/UW3cv2Fj0g7f3l4SN+3Xf7" +
  "r913/N13/d13/vXdfvvdd/fdfvzdd/jdfv3dd/ndfv7dd/rxPgPdy/cm3cv4Ft3L+Rbdy/oWPSDt/X4C" +
  "tygFOrfHGAg6t8fWAT4AF7fKDT3dfvPdlu/dfvTdnvDdfvXdnvHdfvbdnvLibTzugPINPd1+88YI3Xf7" +
  "3X70zgDdd/zdfvXOAN13/d1+9s4A3Xf+ed2W+3jdnvx73Z79et2e/uKlPO6A8g093X733Zbr3X743Z7s" +
  "3X753Z7t3X763Z7u4sU87oDyDT3dfvfGCN13+91++M4A3Xf83X75zgDdd/3dfvrOAN13/t1+592W+91+" +
  "6N2e/N1+6d2e/d1+6t2e/uIFPe6A8g09IcTANgHdNP/DmjshuMc2Ad1+4913/d1+5N13/t1+5d13/902" +
  "/AAGA93L/Sbdy/4W3cv/FhDyIQAAIizAIi7AITLANgAhM8A2ACoWwBEMABl+MjbAESTAIRkAOQEEAO2w" +
  "3fnd4cnd5d0hAADdOSHd/zn57VsgwCoiwAYIyyzLHcsayxsQ9t1z5d1y5t1159106O1bJMAqJsAGCMss" +
  "yx3LGssbEPbdc+ndcurddevddOwqLcgjI37+gDgCPoDdd+0h//82At1+6cYI3Xfu3X7qzgDdd+/dfuvO" +
  "AN138N1+7M4A3Xfx3X7lxgbdd/LdfubOAN13891+584A3Xf03X7ozgDdd/XdNv0A3X793Zbt0s1C3U79" +
  "BgBpYCkJ6yoxyBnddfbddPdur2dPBgMpj8sREPrddeHddOLdd+PdceTdTvbdRvcDAwrdd/jdTvbdRvcD" +
  "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" +
  "8mmvZ08GAymPyxEQ+t1189109N139d1x9u1bIMAqIsAGCMssyx3LGssbEPbdc/fdcvjddfnddPrtWyTA" +
  "KibABgjLLMsdyxrLGxD23XP73XL83XX93XT+3X73xgZP3X74zgBH3X75zgBf3X76zgBX3X7vkd1+8Jjd" +
  "fvGb3X7ymuL8S+6A8pdM3X7vxghP3X7wzgBH3X7xzgBf3X7yzgBX3X73kd1++Jjdfvmb3X76muIsTO6A" +
  "8pdM3X77xghP3X78zgBH3X79zgBf3X7+zgBXed2W83jdnvR73Z71et2e9uJcTO6A+pdM3X7zxgLdd/vd" +
  "fvTOAN13/N1+9c4A3Xf93X72zgDdd/7dfvuR3X78mN1+/Zvdfv6a4pRM7oDynUzdNv4AGATdNv4B3X7+" +
  "t8JcTeHlIyMjTioUwN11/d10/nm3KBDdbv3dZv4RCAAZft13/hgO3V793Vb+IQcAGX7dd/7dTv7dfv63" +
  "KAmv3XH93Xf+GAev3Xf93Xf+3X793Xf73X7+3Xf83X7s3Xf93Tb+AAYF3cv9Jt3L/hYQ9t1+/d2G7d13" +
  "+d1+/t2O7t13+t1++d13/d1++t13/t3L/Sbdy/4W3X793Xf53X7+9njdd/rdbvndZvrP3W773Wb838Hh" +
  "5cU2AN00/91+/9YQ2rlKKhTAESUAGX63ytxP3Tb/AN1O/wYAaWApCRH9xxnddf3ddP7dfv3GAt136t1+" +
  "/s4A3Xfr3W7q3WbrTnm3ytFPDNHh5dVx3W793Wb+Xt1u/d1m/iN+3Xf+e+Yf9d1+/t137PHdburdZutu" +
  "BgDdd+3dcO551gUgHt1u/iYAKSkpKSndXu3dVu4ZKXz2eGfPIQAA38PRT33WeNrRT0sGABEAAD4DyyHL" +
  "EMsTyxI9IPXdfv7dd/uv3Xf83Xf93Xf+9d1++913791+/N138N1+/d138d1+/t138vE+A93L7ybdy/AW" +
  "3cvxFt3L8hY9IO3VxREgwCEXADnrAQQA7bDB0d1++913891+/N139N1+/d139d1+/t139j4I3cv2Lt3L" +
  "9R7dy/Qe3cvzHj0g7dXFESTAIRcAOesBBADtsMHR3X773Xf33X783Xf43X793Xf53X7+3Xf6Pgjdy/ou" +
  "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" +
  "zbtgIUABzdxfIQBA5REAAGXN+mHNDWLNIWIuPz4BzXVgIQAB5SonyeURYAEhAALNfGEhQAHNNWIhQAHN" +
  "x18hCHrPIQtZzcdiIYZ6zyEdWc3HYiGIe88hNFnNx2LNu2DNyGB75jAo9c27YM3IYHvmMCD1yVBPQ0tF" +
  "VCBQTEFURk9STUVSAGZvciBTZWdhIE1hc3RlciBTeXN0ZW0AUHJlc3MgMSB0byBzdGFydAAuAM0SYC4A" +
  "zShgLgDNCGDNmFjN2gq3KPfNEAvNu2AhQAHN3F8hAEDlEQAAZc36Yc3uFCFAAc3HX815UxjScG9ja2V0" +
  "LXBsYXRmb3JtZXItc21zAFBvY2tldCBQbGF0Zm9ybWVyIFNNUyBFbmdpbmUAR2VuZXJhdGVkIGJ5IHBv" +
  "Y2tldC1wbGF0Zm9ybWVyLXRvLXNtcyB3ZWIgZXhwb3J0ZXIuADozyLfIPp/Tfz6/0386SMi3IAQ+39N/" +
  "OknItyAEPv/TfyEzyDYAyTozyLfAOkHI9pDTfzpCyPaw0386SMi3IBc6RcjmD/bA0386RsjmP9N/OkPI" +
  "9tDTfzpJyLcgEDpHyOYP9uDTfzpEyPbw038hM8g2AcnN6VkhO8g2AdHBxdXtQzTI7UM2yO1DOMghOsg2" +
  "ACE+yDYAITzINp8hM8g2AckhO8g2AMnB4eXF5c1cWvEhO8g2AMn9ITPI/W4AyT6f038+v9N/Pt/Tfz7/" +
  "03/J3eXdIQAA3Tn1/SE9yP1+AN13/q/dd//9TgA6M8i3KFg6QcjmD18WAOHlGT4PvT4AnOLtWu6A8vVa" +
  "EQ8AGAk6QcjmD4FfF5979pDTfzpCyOYPXxYA4eUZPg+9PgCc4hlb7oDyIVsRDwAYCTpCyOYPgV8Xn3v2" +
  "sNN/OkjItygJOkrI9tDTfxgyOjPItygsOkPI5g9fFgDh5Rk+D70+AJziWlvugPJiWxEPABgJOkPI5g+B" +
  "Xxefe/bQ0386Sci3KAk6S8j28NN/GDI6M8i3KCw6RMjmD28mANHVGT4PvT4AnOKbW+6A8qNbAQ8AGAk6" +
  "RMjmD4FPF5959vDTf9353eHJ3eXdIQAA3Tn13X4EMj3IOjPIt8qgXDpByOYPTx4A/SE9yP1+AN13/q/d" +
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
  "///hXpmZAEw=";
