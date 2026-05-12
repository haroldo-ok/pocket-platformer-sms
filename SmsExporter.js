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
    // Barrel cannon sprite = tile 267 (VRAM_SPR_BARREL)
    const barrelS = get('BARREL_CANNON');
    barrelS ? encodeSprite8(barrelS, 0) : encodeBlank();

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
        // Barrel cannon: encode direction in top 2 bits of y
        // dir: 0=right, 1=top, 2=left, 3=bottom
        if (obj.type === 'barrelCannon') {
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
    const parts = [header, physicsBytes, new Uint8Array(palette), bgTiles, spriteSheet, ...encodedLevels, npcTable];
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDD1VUh" +
  "AMB+BgBwEQHAAVsI7bAykMfNjVnNK1T7zeZNdhj9ZGV2a2l0U01TAAAAwxRW7aPto+2j7aPto+2j7aPt" +
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
  "fhgYGBgYfgA+DAwMDGw4AGZseHB4bGYAYGBgYGBgfgBjd39ra2NjAGZmdn5uZmYAPGZmZmZmPAB8ZmZ8" +
  "YGBgADxmZmZqbDYAfGZmfGxmZgA8ZmA8BmY8AH4YGBgYGBgAZmZmZmZmPABmZmZmZjwYAGNja2t/d2MA" +
  "ZmY8GDxmZgBmZmY8GBgYAH4GDBgwYH4AfGBgYGBgfAAAYDAYDAYAAD4GBgYGBj4APGYAAAAAAAAAAAAA" +
  "AAAA/zAYAAAAAAAAAAA8Bj5mPgBgYHxmZmZ8AAAAPGZgZjwABgY+ZmZmPgAAADxmfmA8ABwwMHwwMDAA" +
  "AAA+ZmY+BjxgYHxmZmZmABgAOBgYGDwAGAA4GBgYGHBgYGZseGxmADgYGBgYGDwAAAA2f2trYwAAAHxm" +
  "ZmZmAAAAPGZmZjwAAAB8ZmZ8YGAAAD5mZj4GBwAAbHZgYGAAAAA+YDwGfAAwMHwwMDAcAAAAZmZmZj4A" +
  "AABmZmY8GAAAAGNra382AAAAZjwYPGYAAABmZmY+BjwAAH4MGDB+AAwYGHAYGAwAGBgYGBgYGAAwGBgO" +
  "GBgwADFrRgAAAAAA///////////d5d0hAADdOfVNRO1TBMDdfggyBsDdfgYyAMB71sB6Fz8f3oA+ABfd" +
  "d/56B+YB3Xf/OgDAtyhy3cv/RiBY3X7+tyhS7UMCwN1+BDIBwDoBwLcoQjoDwMt/ICI6A8DugNaBMBkq" +
  "AsBVHgDdbggmAHu1X3q0V8UqBMDN6FbBIQLAfsYIdzACIzTdfgjGAt13CCEBwDUYuCEEwH7GEHcwAiM0" +
  "/SEAwP01ABiI3fnd4eHx8TPp3eXdIQAA3Tn1IgfANgEqB8AjcyNyKgfAIyMj3X4EdyPdfgV3KgfAAQ8A" +
  "CTYBKgfAARAACd1eBnMqB8ABEQAJ3X4IdyoHwAESAAndfgaHh4d3KgfAARMACd1WCHqHh4eHdyoHwAEU" +
  "AAk2ACoHwAEVAAk2AioHwAEWAAndfgp3KgfAARcACd1+C3cqB8ABGAAJNgDtSwfAIRkACU1EeofFZy4A" +
  "VQYIKTABGRD6wV17Au1LB8AhGgAJ6yEZAAlm1d1eCy4AVQYIKTABGRD60X0SKgfAARsACTYAKgfAARwA" +
  "Ca93I3cqB8ABHgAJr3cjd+1LB8AhJgAJ6yESAAl+xvwS7UsHwCEnAAnrIRMACX7G/BLtSwfAISQACcXr" +
  "/eH9fhLdd/7dNv8AISYACU4GAN1+/pFP3X7/mEfLKMsZeRLtSwfAISUACcXr/eH9fhPdd/7dNv8AIScA" +
  "CU4GAN1+/pFP3X7/mEfLKMsZeRIqB8ABIAAJNgAqB8ABIQAJNgAjNgHd+d3h4fHx8fHp3eXdIQAA3Tn9" +
  "Ifb//Tn9+d11/t10/055t8rnCd1u/t1m/yIJwN11+t10+91++sYc3Xf83X77zgDdd/3dbvzdZv1eI36z" +
  "yl4J3U763Ub7IR4ACX4jMg3AfjIOwCENwLYgD91u/N1m/X4jMg3AfjIOwCoNwCILwCoNwCMjIg3AKgvA" +
  "ftaAIBDdbvzdZv1+I2ZvIg3AIgvA3U763Ub7IRsACX4yD8DdTvrdRvsDCt13/AMK3Xf9CzoPwCoLwF71" +
  "ewefV/EPMAchAAC/7VLr3X78g1/dfv2KV3sCA3oC7UsJwAMDAwrdd/gDCt13+Qs6D8BfKgvAI37dd/oH" +
  "n913+8tLKBCv3Zb63Xf8n92W+913/RgM3X763Xf83X773Xf93X783Yb4X91+/d2O+Vd7AgN6AjoPwMtX" +
  "yk4JKg3AIgvAKg3AIyMiDcAqC8B+7UsJwNaAIBBZUCEcABl+I2ZvIg3AIgvAWVAhGwAZfjIPwAMzM2lg" +
  "5X7dd/gjft13+ToPwE8qC8B+3Xf6B5/dd/vLQSgQr92W+t13/J/dlvvdd/0YDN1++t13/N1++913/d1+" +
  "+N2G/E/dfvndjv1H4eVxI3DtSwnAAwMDCt13+AMK3Xf5CzoPwF8qC8Ajft13+gef3Xf7y0soEK/dlvrd" +
  "d/yf3Zb73Xf9GAzdfvrdd/zdfvvdd/3dfvzdhvhf3X793Y75V3sCA3oCKgnAAR4ACToNwHcjOg7Ad91+" +
  "/sYNT91+/84AR2lgXiNWerMoYd1+/sYB3Xf83X7/zgDdd/3dbvzdZv1+I2ZvGevdbvzdZv1zI3JpYCNG" +
  "3W783Wb9XiNWy3goHN1O/t1G/yESAAluJgAZy3woGd1u/t1m/zYAGA967oDWgTgI3W7+3Wb/NgAqCcAB" +
  "IQAJTiNGK3ixKAQLcSNw3fnd4cnd5d0hAADdOfX19d11/t10/055t8rBCt1u/t1m/yIQwO1LEMDF/eH9" +
  "XhbF/eH9fhiDMhLAxf3h/X4PtyAMWVAhGgAZfiESwIZ3WVAhEQAZft13+t02+wBZUCEQABl+3Xf83Tb9" +
  "AGlgIyMjXiNWaWAjTiNGOhLA9TPdbvrdZvvl3W783Wb95WlgzQAF7UsQwCEUAAl+tygEPXcYOiEYAAnr" +
  "GjITwGlgxQEZAAnBfiETwIZ3IRoACU46E8CROAUhE8A2ADoTwBLtSxDAIRQACeshFQAJfhLd+d3hyXy1" +
  "yOXNXFXhKxj1zeJWzXlXwxNXIf//NgI6AIDWUCAVOgGA1lAgDjoCgNZMIAc6A4DWVCgCr8k+Ackh//82" +
  "AiEAgCIUwC4nIhbALjgiGMAuSCIawDoFgG8mACkpKSkpAUiACSIcwCocwBGAARkiHsDJ3eXdIQAA3Tkh" +
  "9v85+d13/ioewN11/N10/SH//zYC3Tb/AN1+/92W/tLtC91u/N1m/U4GAN1u/N1m/SNeFgBpYM1HVyEE" +
  "ABnj3X783Xf63X793Xf73W763Wb7IyN+3Xf73Xf63Tb7AE8GAGlgKQnddfjddPndfvbdhvjdd/rdfvfd" +
  "jvndd/vdfvrdd/jdfvvdd/ndfvzdd/rdfv3dd/vdfvrdhvjdd/zdfvvdjvndd/3dNP/DWQvdXvzdVv3d" +
  "+d3hyU9FKmLHXnmTMAYjXniTOAKvyWkmAFTFzUdXwWgmABnrKmTHGX7J3eXdIQAA3Tn13Xf/3XX+DgBZ" +
  "FgDrKSkR8sYZXVQjI363KBMaR91+/5AgC2tiI91+/pYoCxgADHnWEDjVEQAA3fnd4cnd5d0hAADdOfXd" +
  "d//ddf7dfv/NHgx6syAzb10WAOspKes+8oNPPsaKR1lQExMatyAV3X7/AmlgI91+/nc+ARIDAwOvAhgG" +
  "LH3WEDjO3fnd4cnd5d0hAADdOfU73Xf/3XX+3X7/zR4MS3qxIHrdbv7dfv/NYgzdbv7dfv/NHgxLaXpn" +
  "sSgFIyMjNgEO/x7/ebcgA7MoOXm3KAR7tyAx3X7/gd13/d1+/oNHxdVo3X79zfgL0cH9KhTA9f1WCPGS" +
  "IA6yKAvF1Wjdfv3NswzRwRw+AZPiOQ3ugPLwDAw+AZHiRQ3ugPLuDN353eHJzR4MS3pHsygKAwMK1ig4" +
  "Az4Bya/J3eXdIQAA3Tn13Xf/3XX+DgAGAGlgKQk+MoVfPseMV2tiIyN+tygTGkfdfv+QIAtrYiPdfv6W" +
  "KAsYAAx51hA40REAAN353eHJ3eXdIQAA3Tn1O0/ddf/F3W7/ec1iDcF6syBpxd1u/3nNOw7BHgAhMw4W" +
  "ABl+QYDdd/0hNw4WABl+3Ub/gN13/sXV3W7+3X79zfgL0cH9KhTA9f1GJfEEBSgky/iQIB/F1d1u/t1+" +
  "/c1iDevRwXy1IA3F1d1u/t1+/c2qDdHBHHvWBDii3fnd4ckB/wAAAAAB/93l3SEAAN059d13/911/t1+" +
  "/81iDXqzICdPBgBpYCkJETLHGV1UExMatyAO3X7/dyPdfv53PgESGAYMedYQONrd+d3hyd3l3SEAAN05" +
  "/SHo//05/fkGCMssyx3LGssbEPbdc+zdcu3dde7ddO8hAAA56yEEADkBBADtsN1+BN138N1+Bd138d1+" +
  "Bt138t1+B9138wYI3cvzLt3L8h7dy/Ee3cvwHhDuIQ8AOeshCAA5AQQA7bDdfusH5gHdd/u3IAjdfvoH" +
  "5gEoBT4Bw7ERIRQAOeshDwA5AQQA7bC3KCDdfvfGB913/N1++M4A3Xf93X75zgDdd/7dfvrOAN13/91u" +
  "/N1m/cs8yx3LPMsdyzzLHcHF3X77tygM3X7oxgdP3X7pzgBHyzjLGcs4yxnLOMsZec34C9139LcgBK/D" +
  "sRHdy/R+KASvw7ER7UsUwMX94f1eBnu3KArdfvSTIASvw7ERHgAhEwAJFgAZVnq3KArdfvSSIASvw7ER" +
  "HHvWEjjk3X7vB+YB3Xf13X7sxgfdd/bdfu3OAN13991+7s4A3Xf43X7vzgDdd/ndfvMH5gHdd/rdfvDG" +
  "B913+91+8c4A3Xf83X7yzgDdd/3dfvPOAN13/jpIxrcoXyEAADnrIQQAOQEEAO2w3X71tygOIQAAOesh" +
  "DgA5AQQA7bDBxcs4yxnLOMsZyzjLGd1x/91O8N1G8d1++rcoBt1O+91G/Ms4yxnLOMsZyzjLGWndfv/N" +
  "eje3KASvw7EROurGtyhN3U7s3Ubt3X71tygG3U723Ub3yzjLGcs4yxnLOMsZ3XH/3U7w3Ubx3X76tygG" +
  "3U773Ub8yzjLGcs4yxnLOMsZad1+/80XOrcoBK/DsRHdTuzdRu3dXu7dVu/dfvW3KAzdTvbdRvfdXvjd" +
  "VvnLOMsZyzjLGcs4yxndcf8hDgA56yEIADkBBADtsN1++rcoDiEOADnrIRMAOQEEAO2w3X723Xf93X73" +
  "3Xf+3cv+Pt3L/R7dy/4+3cv9Ht3L/j7dy/0e3X793Xf8KhTA3XX93XT+EQcAGX7dd/63KBTdfvTdlv4g" +
  "DN1u/N1+/81NDbcgKCoUwN11/d10/hEIABl+3Xf+tygX3X703Zb+IA/dbvzdfv/NTQ23KAOvGCEqFMDd" +
  "df7ddP8RJgAZft13/7coC91+9N2W/yADrxgCPgHd+d3h4cHB6d3l3SEAAN05/SHo//05/fkGCMssyx3L" +
  "GssbEPbdc+zdcu3dde7ddO8hAAA56yEEADkBBADtsN1+BN138N1+Bd138d1+Bt138t1+B9138wYI3cvz" +
  "Lt3L8h7dy/Ee3cvwHhDuIQ8AOeshCAA5AQQA7bDdfusH5gHdd/u3IAjdfvoH5gEoBT4Bw9YUIRQAOesh" +
  "DwA5AQQA7bC3KCDdfvfGB913/N1++M4A3Xf93X75zgDdd/7dfvrOAN13/91u/N1m/cs8yx3LPMsdyzzL" +
  "HcHF3X77tygM3X7oxgdP3X7pzgBHyzjLGcs4yxnLOMsZec34C9139LcgBK/D1hTdy/R+KASvw9YUDgAq" +
  "FMAREwAZWRYAGUZ4tygK3X70kCAEr8PWFAx51hI44N1+7wfmAd139d1+7MYH3Xf23X7tzgDdd/fdfu7O" +
  "AN13+N1+784A3Xf53X7zB+YB3Xf63X7wxgfdd/vdfvHOAN13/N1+8s4A3Xf93X7zzgDdd/46SMa3KF8h" +
  "AAA56yEEADkBBADtsN1+9bcoDiEAADnrIQ4AOQEEAO2wwcXLOMsZyzjLGcs4yxndcf/dTvDdRvHdfvq3" +
  "KAbdTvvdRvzLOMsZyzjLGcs4yxlp3X7/zXo3tygEr8PWFDrqxrcoTd1O7N1G7d1+9bcoBt1O9t1G98s4" +
  "yxnLOMsZyzjLGd1x/91O8N1G8d1++rcoBt1O+91G/Ms4yxnLOMsZyzjLGWndfv/NFzq3KASvw9YU3U7s" +
  "3Ubt3V7u3Vbv3X71tygM3U723Ub33V743Vb5yzjLGcs4yxnLOMsZ3XH/IQ4AOeshCAA5AQQA7bDdfvq3" +
  "KA4hDgA56yETADkBBADtsN1+9t13/d1+9913/t3L/j7dy/0e3cv+Pt3L/R7dy/4+3cv9Ht1+/d13/CoU" +
  "wN11/d10/hEHABl+3Xf+tygU3X703Zb+IAzdbvzdfv/NTQ23ICgqFMDddf3ddP4RCAAZft13/rcoF91+" +
  "9N2W/iAP3W783X7/zU0NtygDrxghKhTA3XX+3XT/ESYAGX7dd/+3KAvdfvTdlv8gA68YAj4B3fnd4eHB" +
  "wekh//82AioYwM0wVa9vzSNVDgEqGMAGAAluxXnNI1XBDHnWEDjtKhTAEQUAGW4mACkpKSkp7VsawOUh" +
  "IADNelftWxzAIYAB5SEAIM16Vz4B9TOv9TMqXMjlEWABIQACzR1WIUABw9ZWIf//NgIOAGkmACkpKSkp" +
  "KXz2eGfFz8EGACpixyNeeZMwDMVpeM34C8FfFgAYAxEAAGsmAMt7KAnLvSYAy+TfGAx7tygD6xgDEQAA" +
  "698EeNYgOMYMedYYOK7J3eXdIQAA3Tk7R00h//82AmgmACl89nhnxc/B3Tb/ACpixyNG3X7/kDALxd1u" +
  "/3nN+AvBGAGvX2smAMt7KAnLvSYAy+TfGAx7tygD6xgDEQAA69/dNP/dfv/WGDjCM93hyd3l3SEAAN05" +
  "9TsqYscjI37+gDADTxgDAYAA3XH9BgBYe92W/TAy1RYAa2IpGdF9VCFmx4bdd/4jeo7dd//dbv7dZv8j" +
  "I37WBSALIUPAFgAZfrcgAQQcGMh43fnd4clP1gIoD3n+BCgc/gUoHNYMKAYYGhEBAcnNABa3KAQRCQHJ" +
  "EQEByREDAckRBAHJEQEByd3l3SEAAN059Tsh//82Ag4AKmLHIyNGeZDSkRcGAGlgKQlFVHghZseGI196" +
  "jlfdc/7dcv8TExrdd/09yo0X3X791gPKjRfdfv3WDcqNF91+/dYOyo0X3X791gUgCyFDwAYACX63wo0X" +
  "3X791gfKjRfdfv3WCMqNF91+/dYJyo0X3X791goodt1+/dYLKG/dbv7dZv9uJgApKSntWz/Av+1S691u" +
  "/t1m/yNuJgApKSl71vh6Fz8f3n84Q6+7PgGa4lQX7oD6jRfLfCAyPsC9PgCc4mYX7oD6jRfdc//dNv4A" +
  "5cXdfv3NXhbB4XsGAN22/l943bb/VyYAxc3oVsEMw6EW3fnd4cnd5d0hAADdOTsh//82AipixyMjfv6A" +
  "MANPGAMBgAAGAHiRMHNYFgBrYikZ6/0qZsf9Gf3l0RMTGtYOIFj95dETGuY/3Xf//W4AJgApKSntWz/A" +
  "v+1S691u/yYAKSkpe9b4ehc/H95/OCuvuz4BmuIJGO6A+ioYy3wgGj7AvT4AnOIbGO6A+ioYU6/2C18m" +
  "AMXN6FbBBBiJM93hySH//zYCKmLHIyN+/oAwA08YAwGAAAYAeJHQWBYAa2IpGev9KmbH/Rn95dETExrW" +
  "DSBQ/W4AJgApKSntWz/Av+1S/eXr4SNuJgApKSl71vh6Fz8f3n84K6+7PgGa4pIY7oD6sxjLfCAaPsC9" +
  "PgCc4qQY7oD6sxhTr/YKXyYAxc3oVsEEGJLd5d0hAADdOSHz/zn57UsgwCoiwGVo7Us/wL/tQt11/N10" +
  "/REkwCEAADnrAQQA7bDdfvTdd/jdfvXdd/ndfvzW+N1+/Rc/H95/2rUZr92+/D4B3Z794hAZ7oDyFhnD" +
  "tRk6MMC3IArdNv4I3Tb/ARgs7UsowCoqwHy1sLEoFzo5wMtPKAUBBwEYAwEGAd1x/t1w/xgI3Tb+Bd02" +
  "/wHdfvzdd/rdNvsA3X763Xf83Tb9AN1+/N13+902+gDdfv7dd//dd/7dNv8A3X7+3Xf83Tb9AN1++t22" +
  "/N13/t1++922/d13/91++N13/d13/N02/QDdXv7dVv/dbvzdZv3N6Fbd+d3hyd3l3SEAAN05Iff/Ofkq" +
  "HsDddf3ddP7dNv8AKhTAEQQAGU7dfv3dd/fdfv7dd/jdfv+RMHjdbv3dZv5OBgDdbv3dZv4jXhYAaWDN" +
  "R1chBAAZ3XX53XT63W793Wb+IyN+3Xf+3Xf93Tb+AE8GAGlgKQnddfvddPzdfvvdhvndd/3dfvzdjvrd" +
  "d/7dfv3dd/rdfv7dd/vdfvrdhvfdd/3dfvvdjvjdd/7dNP/D1BnR1d353eHJ3eXdIQAA3Tn9Ifb//Tn9" +
  "+d13/N11+826Gd02/QBLQgMa3Xf/3X793Zb8ME1ZUN1+/9139t02/gDdfv7dlvYwNBMa3Xf3E902/wDd" +
  "fv/dlvcwHRrdd/gT3XP53XL63X753Yb4X91++s4AV900/xjb3TT+GMTdNP0YpFlQ3X7/3Xf4DgAT3XP+" +
  "3XL/ed2W+DA9ed2W+zA33V7+3Vb/Gt13+RPdNv8A3X7/3Zb5MB0a3Xf6E91z/d1y/t1+/d2G+l/dfv7O" +
  "AFfdNP8Y2wwYtt1e/t1W/xpPEz4gkTACDiAhyMBxBgB4kTBuGt13+BM+HN2W+DAE3Tb4HNVYFgBrYikZ" +
  "KRkpKRnR3XX53XT6Psndhvndd/0+wN2O+t13/t02/wDdfv/dlvgwFd1+/d2G/2/dfv7OAGcaE3fdNP8Y" +
  "491++cbJb91++s7AZ33dhvhvMAEkNgAEGI7d+d3hyQEAAB4SFiBpYCkD1RFpxBnRr3cjdxUg7xx71hc4" +
  "58nd5d0hAADdOfU7If//NgIOEmkmACkpKSkpKXz2eGfFz8HdNv8AKj/AyzzLHcs8yx3LPMsdfd2G/0fF" +
  "aXjN+AvB3Xf93Tb+AMt/KAzdbv3LvSYAy+TfGAu3KATh5RgDIQAA3900/91+/9YgOLkMedYXOJ/d+d3h" +
  "yQYSeNYX0GgmACkpKSkpKXz2eGfPDgAhAADfDHnWIDj2BBjfTz4CMv//ec1tGiHGwDYBIcfANgAhqcU2" +
  "/y4/PgHNFlXNXRzDphwOAHnGEyYAbykpKSkpKXz2eGfFz8EGACEAAN8EeNYgOPYMedYDONseACHHwHuG" +
  "VyHIwHqWMClLBgAhEwAJKSkpKSkjIyl89nhnz0oGAGlgKQkpCSkpCQHJwAnVzWhX0Rx71gI4xDrHwAYA" +
  "TwMDOsjAXxYAeZN4muIiHe6A8i8dIUR9zyE5HcNoVyFEfc8hRh3DaFcxOiBuZXh0IHBhZ2UAMTogY2xv" +
  "c2UAIcbANgAhqsU2/yGtxTYAzeYb/SH///02AAIqGMDDMFXd5d0hAADdOTvrS0IDCvXmP913//EHB+YD" +
  "Mq7FGk8GABEAAFNYQQ4APgPLIMsTyxI9IPd5Ia/FdyN4xgF3I3vOAHcjes4Ad91e/xYAIQAAZWpTHgAG" +
  "A8si7WoQ+u1Ts8UitcUhrcU2ASG3xTYAIQAAIizAIi7AIijAIirAITDANgAhMcA2ACEywDYAITPANgAz" +
  "3eHJTyEgwDqvxXcjOrDFdyM6scV3IzqyxXchJMA6s8V3Izq0xXcjOrXFdyM6tsV3IQAAIizAIi7AIijA" +
  "IirAITHANgAhMsA2AHnmEE8GAHixIAU+ATK3xTq3xbfIeLHIrzKtxTquxbcoEzquxT0oazquxf4CKDTW" +
  "A8oQH8k6r8VPOrDFxghHOrHFzgBfOrLFzgBX7UMgwO1TIsAhAAIiKMBlIirAITHANgHJOq/FTzqwxcb4" +
  "Rzqxxc7/Xzqyxc7/V+1DIMDtUyLAIQD+IijAIf//IirAITHANgHJOrPFTzq0xcb4Rzq1xc7/Xzq2xc7/" +
  "V+1DJMDtUybAIQD+IizAIf//Ii7AITLANgAhMcA2Ack6s8VPOrTFxghHOrXFzgBfOrbFzgBX7UMkwO1T" +
  "JsAhAAIiLMBlIi7AITHANgHJOjHAt8gqLMDtWy7AfcYqT3zOAEcwARPtQyzA7VMuwK+5PgeYPgCbPgCa" +
  "4m0f7oDwIQAHIizAZSIuwMnd5d0hAADdOf0h7v/9Of353XX+3XT/S0IqFsDddfjddPleI37dc+7dd+8H" +
  "n9138N138SEwwF57tygb3W743Wb5IyNWI37dcvrdd/sHn913/N13/Rge3W743Wb5xQEGAAnBfiNm3Xf6" +
  "fN13+wef3Xf83Xf93X763Xfy3X773Xfz3X783Xf03X793Xf1e7coHt1e+N1W+SEEABleI1bdc/p63Xf7" +
  "B5/dd/zdd/0YG91e+N1W+SEIABleI37dc/rdd/sHn913/N13/cURKMAhCgA56wEEAO2wwd3L/lbK3SDd" +
  "fvbdlvLdd/rdfvfdnvPdd/vdfvjdnvTdd/zdfvndnvXdd/3FESjAIQ4AOQEEAO2wwa/dlu7dd/Y+AN2e" +
  "79139z4A3Z7w3Xf4n92W8d13+d1++t2W9t1++92e991+/N2e+N1+/d2e+eLEIO6A8tUgxREowCEKADkB" +
  "BADtsMEhN8A2AcPQId3L/l4oaN1+9t2G8t13+t1+992O8913+91++N2O9N13/N1++d2O9d13/cURKMAh" +
  "DgA5AQQA7bDB3X7u3Zb63X7v3Z773X7w3Z783X7x3Z794jIh7oDyQyHFESjAIQIAOQEEAO2wwSE3wDYA" +
  "w9Ahxd1u/N1m/eXdbvrdZvvl3V723Vb33W743Wb5zZtY8fHBPgjLLMsdyxrLGz0g9d1z+t1y+911/N10" +
  "/cURKMAhDgA5AQQA7bDB7VsowCoqwD6A3b76Pv/dnvs+/92e/D7/3Z794rMh7oDy0CF71oB63gB93gB8" +
  "Fz8f3oAwCSEAACIowCIqwO1bIMAqIsA+CMssyx3LGssbPSD1e8b/3Xfues7/3Xfvfc7/3XfwfM7/3Xfx" +
  "e8YH3Xf2es4A3Xf3fc4A3Xf4fM4A3Xf53X7xB+YB3Xfy3cvyRiBV3X7u3Xf63X7v3Xf73X7w3Xf83X7x" +
  "3Xf93X7ytygg3X7uxgfdd/rdfu/OAN13+91+8M4A3Xf83X7xzgDdd/0+A93L/S7dy/we3cv7Ht3L+h49" +
  "IO0YDt02+v+v3Xf73Xf83Xf93X763Xfz3V723Vb33cv5figM3X72xgdf3X73zgBXyzrLG8s6yxvLOssb" +
  "3XP07VskwComwD4IyyzLHcsayxs9IPXdc/XdcvbddffddPjdXvXdVvbdfvXGB913+d1+9s4A3Xf63X73" +
  "zgDdd/vdfvjOAN13/N3L+H4oBt1e+d1W+ss6yxvLOssbyzrLG91z/d1e+d1W+t3L/H4oDN1+9cYOX91+" +
  "9s4AV8s6yxvLOssbyzrLG91z/N3L8kbC2CPF3W793X7zzfgLwbcoPSoUwBEGABl+tygWxd1u/d1+8834" +
  "C8EqFMARBgAZXpMoHMXdbv3dfvPNFzrBtyAOxd1u/d1+8816N8G3KE7F3W783X7zzfgLwbcoPSoUwBEG" +
  "ABl+tygWxd1u/N1+8834C8EqFMARBgAZXpMoHMXdbvzdfvPNFzrBtyAOxd1u/N1+8816N8G3KAOvGAI+" +
  "Ad13+8Xdbv3dfvTN+AvBtyg9KhTAEQYAGX63KBbF3W793X70zfgLwSoUwBEGABlekygcxd1u/d1+9M0X" +
  "OsG3IA7F3W793X70zXo3wbcoTsXdbvzdfvTN+AvBtyg9KhTAEQYAGX63KBbF3W783X70zfgLwSoUwBEG" +
  "ABlekygcxd1u/N1+9M0XOsG3IA7F3W783X70zXo3wbcoA68YAj4B3Xf6y2HKVyUhMMBOebcoJiEywDYB" +
  "ITPANgAhNsA2ACExwDYAITDANgA6SMa3ylclzcw3w1clKhbA3XX83XT9ERAAGX63KF55tyBa3X77tyAG" +
  "3X76tyhOITLANgAhM8A2ASE2wDYAITHANgAhOMA2AN1++7coCt02/AHdNv0AGAjdNvz/3Tb9AN1+/N13" +
  "/SE0wN1+/XchNcA2ADpIxrcoPM3MNxg33W783Wb9EQ8AGX7dd/23KCY6OMDdd/23IB0hMsA2ASEzwDYA" +
  "ITbANgAhOMA2ATpIxrcoA83MNyEywE7dfv7mEN13+t02+wB5t8pwJhE7wCEIADnrAQQA7bCv3b723Z73" +
  "PgDdnvg+AN2e+eKPJe6AB+YB3Xf93X773bb6IAfdfv23yk0m3X79tyAqKhbA3XX83XT9EQoAGX7dd/wj" +
  "ft13/d1+/N139t1+/d139wef3Xf43Xf53U723Ub3/eXj3W744+PdZvnj/eE6NsA83Xf9ITbA3X79dyoW" +
  "wBEMABluJgDdXv0WAL/tUut6B+1i/eXFzZtY8fGvk08+AJpHPgCdX5+UV+1DLMDtUy7AKhbAEQwAGd1+" +
  "/ZY4OCEywDYAITHANgEhAAAiO8AiPcAYI91++d22+N2299229iAVITLANgAqFsARDAAZfjI2wCExwDYB" +
  "OjPAt8pxKN1++922+spcKDo2wDwyNsDtSxbAWVAhDAAZbiYAXxYAv+1S3XX4fN13+Qef3Xf63Xf7IQoA" +
  "CU4jfkcH7WLlxd1e+N1W+d1u+t1m+82bWPHxr5NPPgCaRz4AnV+flFftQyzA7VMuwCE1wE4qFsDddfzd" +
  "dP0RDAAZbiYAXVTLfCgC6xPLKssbe8b8X3rO/1cGAHmTeJriECfugPJCKN1O/N1G/SEKAAlOI0Z4B+1i" +
  "5cXdXvjdVvndbvrdZvvNm1jx8U1EOjTA3Xf91cURKMAhCAA56wEEAO2wwdHdc/bdcvfdcfjdcPkGBN3L" +
  "+S7dy/ge3cv3Ht3L9h4Q7t1+/T0gXd1+8t2G9t13+t1+892O9913+91+9N2O+N13/N1+9d2O+d13/REo" +
  "wCEMADkBBADtsCoWwE4jRngHn19Xed2W+njdnvt73Z78et2e/eLGJ+6A8jso7UMowO1TKsAYaN1+8t2W" +
  "9t13+t1+892e9913+91+9N2e+N13/N1+9d2e+d13/REowCEMADkBBADtsCoWwE4jRngHn19Xr5FPPgCY" +
  "RyEAAO1S691++pHdfvuY3X78m91+/ZriMCjugPI7KO1DKMDtUyrAOjXAPDI1wDo2wCoWwBEMABlOkTgh" +
  "ITPANgAhMcA2ARgVITPANgAqFsARDAAZfjI2wCExwDYBOjLAtyBSOjPAtyBM7UsswCouwMt8KEHlxRHA" +
  "ACEAAM2bWPHxTUQ+CMsoyxnLGssbPSD17VMswO1DLsA+gLs+/5o+/5k+/5jivSjugPLJKCEAACIswCIu" +
  "wN353eHJ3eXdIQAA3Tkh9P85+REgwCEAADnrAQQA7bARKMAhCAA56wEEAO2w3X703Yb83Xf43X713Y79" +
  "3Xf53X723Y7+3Xf63X733Y7/3Xf7IQAAOeshBAA5AQQA7bDdfvTdd/jdfvXdd/ndfvbdd/rdfvfdd/sG" +
  "CN3L+y7dy/oe3cv5Ht3L+B4Q7q/dvvzdnv0+AN2e/j4A3Z7/4mkp7oDyairdfvTdd/zdfvXGBt13/d1+" +
  "9s4A3Xf+3X73zgDdd//tSyTAKibAeMYBRzABI+XF3V783Vb93W7+3Wb/zYAOtyAj7UskwComwHjGBkcw" +
  "ASPlxd1e/N1W/d1u/t1m/82ADrfKEyvdfvjGBt13/N1++c4A3Xf93X76zgDdd/7dfvvOAN13/yEEADnr" +
  "IQgAOQEEAO2w3cv/figg3X78xgfdd/jdfv3OAN13+d1+/s4A3Xf63X7/zgDdd/vdbvjdZvndXvrdVvsG" +
  "A8sqyxvLHMsdEPYGAynLE8sSEPkB+f8JTUR7zv9fes7/3XH13XD23XP33Tb0ACEAACIowCIqwMMTK93L" +
  "/37KEyvtSyTAKibAeMYBRzABI+XF3V703Vb13W723Wb3zYAOtyAi7UskwComwHjGBkcwASPlxd1e9N1W" +
  "9d1u9t1m982ADrcoXt1O+N1G+d1u+t1m+93L+34oGN1++MYHT91++c4AR91++s4Ab91++84AZ1lQBgPL" +
  "LMsdyxrLGxD2HCAEFCABI2VqUx4ABgPLIu1qEPozM9XddfbddPchAAAiKMAiKsARIMAhAAA5AQQA7bDd" +
  "+d3hyd3l3SEAAN05IeP/OfntSyTA7VsmwNXFESzAIQ0AOesBBADtsMHRed2G7E943Y7tR3vdju5fet2O" +
  "791x/N1w/d1z/t13/91+/N13+N1+/d13+d1+/t13+t1+/913+wYI3cv7Lt3L+h7dy/ke3cv4HhDuIQ0A" +
  "OeshFQA5AQQA7bDtSyDAKiLA3XH0eMYB3Xf1fc4A3Xf2fM4A3Xf33cvvfsIXLt1O/N1+/cYIR91+/s4A" +
  "/eXdd+H94d1+/84A/eXdd+L94cX95f3lxd1e9N1W9d1u9t1m9825Ef3hwbcgGO1bIMAqIsB6xgRXMAEj" +
  "/eXFzbkRt8pTMt1+8MYI3Xf03X7xzgDdd/XdfvLOAN139t1+884A3Xf3IRUAOeshEQA5AQQA7bDdy/d+" +
  "KCDdfvTGB913+N1+9c4A3Xf53X72zgDdd/rdfvfOAN13+91++N138t1++d13891++t139N1++9139QYD" +
  "3cv1Lt3L9B7dy/Me3cvyHhDu/SoUwP1+BrfKwi3dfvLdd/vtSyDA7VsiwD4IyyrLG8sYyxk9IPXdcffd" +
  "cPjdc/ndcvrLeigYecYH3Xf3eM4A3Xf4e84A3Xf5es4A3Xf63U733Ub4yzjLGcs4yxnLOMsZ3W77ec34" +
  "C9139t1++9139+1LIMDtWyLAPgjLKssbyxjLGT0g9d1x+N1w+d1z+t1y+8t6KBh5xgfdd/h4zgDdd/l7" +
  "zgDdd/p6zgDdd/vdTvjdRvnLOMsZyzjLGcs4yxkM3W73ec34C0/9KhTA/UYG3X72kCgHeZAoA68YAj4B" +
  "tyhH7UskwComwN1x+HjGCN13+X3OAN13+nzOAN13+91W8t1u891m9B4ABgPLIu1qEPp73Zb4et2e+X3d" +
  "nvp83Z774r8t7oD6UzLdfvLdXvPdbvTdZvUGA4fLE+1qEPnG+E97zv9Hfc7/X3zO/91x/d1w/t1z/902" +
  "/AAhAAAiLMAiLsAhMMA2ASExwDYAITLANgAhM8A2ACE4wDYAw1My3W7+3Wb/5d1u/N1m/eXdXvTdVvXd" +
  "bvbdZvfNgA63ICPtWyDAKiLAesYEVzABI91O/t1G/8XdTvzdRv3FzYAOt8pTMt1u8N1m8d1e8t1W893L" +
  "834oGN1+8MYHb91+8c4AZ91+8s4AX91+884AVwYDyyrLG8scyx0Q9n3GAd1343zOAN135HvOAN135XrO" +
  "AN135jrtxrfCDzIqFMARDQAZfrfKDzLtSyDA7VsiwD4IyyrLG8sYyxk9IPXdcfzdcP3dc/7dcv/LeigY" +
  "ecYH3Xf8eM4A3Xf9e84A3Xf+es4A3Xf/3W783Wb9yzzLHcs8yx3LPMsdZXnGBt139HjOAN139XvOAN13" +
  "9nrOAN13991+9N13/N1+9d13/d1+9t13/t1+9913/93L934oGHnGDd13/HjOAN13/XvOAN13/nrOAN13" +
  "/91O/N1G/cs4yxnLOMsZyzjLGd1+4z1HxWh8zfgLwd13/2h5zfgLT/0qFMD95dEhDQAZXt1+/5MoEf1G" +
  "Dt1+/5AoCHm7KASQwg8yOuzG1gE+ABcy7MbNnToqFMDddf7ddP867Ma3KA3dTv7dRv8hDQAJThgL3W7+" +
  "3Wb/EQ4AGU5BebcoBUgGABgDAQAAHgAh68Z7ljA6ayYAKf0h2sbFTUT9CcH95eEjbiYAKSkpKSl9VP1u" +
  "APV95h9v8SYAhW96jMslj/Z4Z8XPwWlg3xwYv+1LIMDtWyLAPgjLKssbyxjLGT0g9d1++N13591++d13" +
  "6N1++t136d1++9136t1++MYI3Xfr3X75zgDdd+zdfvrOAN137d1++84A3XfuecYG3XfveM4A3Xfwe84A" +
  "3Xfxes4A3Xfy3Tb/ACHqxt1+/5bSCjLV3V7/FgBrYikZ0f0hSsbFTUT9CcH9fgDdd/uv3Xf83Xf93Xf+" +
  "9d1++913891+/N139N1+/d139d1+/t139vE+A93L8ybdy/QW3cv1Ft3L9hY9IO395eEjft13+6/dd/zd" +
  "d/3dd/713X773Xf33X783Xf43X793Xf53X7+3Xf68T4D3cv3Jt3L+Bbdy/kW3cv6Fj0g7f1+ArcoBTrs" +
  "xhgIOuzG1gE+ABe3ygQy3X7z3Zbv3X703Z7w3X713Z7x3X723Z7y4mQx7oDyBDLdfvPGCN13+91+9M4A" +
  "3Xf83X71zgDdd/3dfvbOAN13/nndlvt43Z78e92e/Xrdnv7inDHugPIEMt1+992W691++N2e7N1++d2e" +
  "7d1++t2e7uK8Me6A8gQy3X73xgjdd/vdfvjOAN13/N1++c4A3Xf93X76zgDdd/7dfufdlvvdfujdnvzd" +
  "fundnv3dfurdnv7i/DHugPIEMiHEwDYB3TT/w5EwIe3GNgHdfuPdd/3dfuTdd/7dfuXdd//dNvwABgPd" +
  "y/0m3cv+Ft3L/xYQ8iEAACIswCIuwCEywDYAITPANgAqFsARDAAZfjI2wBEkwCEZADkBBADtsN353eHJ" +
  "3eXdIQAA3Tkh4P85+e1bIMAqIsAGCMssyx3LGssbEPbdc+TdcuXddebddOftWyTAKibABgjLLMsdyxrL" +
  "GxD23XPo3XLp3XXq3XTrKmLHIyN+/oA4Aj6A3XfsIf//NgLdfujGCN137d1+6c4A3Xfu3X7qzgDdd+/d" +
  "fuvOAN138N1+5MYG3Xfx3X7lzgDdd/LdfubOAN13891+584A3Xf03Tb9AN1+/d2W7NJ1N91O/QYAaWAp" +
  "Cd11+910/N1++yFmx4bdd/7dfvwjjt13/91u/t1m/37dd/zdd/mv3Xf63Xf73Xf83X753Xfg3X763Xfh" +
  "3X773Xfi3X783XfjBgPdy+Am3cvhFt3L4hbdy+MWEO7dfv7dd/vdfv/dd/zdbvvdZvwjft13/N13+a/d" +
  "d/rdd/vdd/zdfvndd/Xdfvrdd/bdfvvdd/fdfvzdd/gGA93L9Sbdy/YW3cv3Ft3L+BYQ7iEZADnrIRUA" +
  "OQEEAO2w3X7g3Zbx3X7h3Z7y3X7i3Z7z3X7j3Z704u8z7oDybzfdfuDGCE/dfuHOAEfdfuLOAF/dfuPO" +
  "AFfdfuSR3X7lmN1+5pvdfuea4h807oDybzfdfvndlu3dfvrdnu7dfvvdnu/dfvzdnvDiPzTugPJvN91+" +
  "+cYIT91++s4AR91++84AX91+/M4AV91+6JHdfumY3X7qm91+65ribzTugPJvN91O/t1G/wMDCv4CKB7+" +
  "A8pvN/4EyjM2/gXKXjf+DCgT/g0oMdYOKBrDbzchw8A2AcNvN80AFrfCbzchw8A2AcNvNzqtxbfCbzfd" +
  "bv7dZv/Nbx3Dbzc6xsC3wm833Tb/AN02/gDdfv7dlv0wNt1O/gYAaWApCd11+d10+t1++SFmx4bdd/vd" +
  "fvojjt13/N1u+91m/CMjftYNIAPdNP/dNP4Ywt1+/9139d1+/zKqxTrFwDKrxc26Gd1z991y+N02/gDd" +
  "TvfdRvgD3W733Wb4ft13/yHFwN1+/pYwZt1x991w+N1O/902/wDdfv+RME3dXvfdVvgTGt13+RPdc/fd" +
  "cvgeAHvdlvkwLt1u991m+H7dd/rdfvfGAd13+91++M4A3Xf83X773Yb63Xf33X78zgDdd/gcGMzdNP8Y" +
  "rd00/sMzNd1x9t1w991+/913+N02/gDdfv7dlvgwW91+/t2W9TBT3U723Ub3Awrdd/kD3XH23XD33Tb/" +
  "AN1+/92W+TAw3W723Wb3ft13+t1+9sYB3Xf73X73zgDdd/zdfvvdhvrdd/bdfvzOAN139900/xjI3TT+" +
  "GJ3dbvbdZvd+MqzFw2837UsswCouwMt8wm833X71xgRP3X72zgBH3X73zgBf3X74zgBX1cURJMAhHQA5" +
  "6wEEAO2wwdHdfvndd/Xdfvrdd/bdfvvdd/fdfvzdd/g+CN3L+C7dy/ce3cv2Ht3L9R49IO3dfvXGCN13" +
  "+d1+9s4A3Xf63X73zgDdd/vdfvjOAN13/HnGAk94zgBHMAETed2W+Xjdnvp73Z77et2e/OLVNu6A+m83" +
  "KhbAEQoAGU4jft1x+d13+gef3Xf73Xf8ITvA3V753Vb63U773Ub8PgLLI8sSyxHLED0g9eUhAADlIQ8A" +
  "5WlgzZFX8fFNROF73Yb5X3rdjvpXed2O+0943Y78R3MjciNxI3AhMsA2ASE2wDYAITHANgAhMMA2ACE4" +
  "wDYAOkjGtygWzcw3GBE+Q92G/W8+wM4AZ363IAI2Ad00/cMHM9353eHJ3eXdIQAA3Tn13Xf/3XX+DgAh" +
  "SMZ5ljA0EbjFBgBpYCkJGesaR91+/5AgHmtiI91+/pYgFRMTGrcoCjpJxtYBPgAXGAk6ScYYBAwYxa/d" +
  "+d3hyd3l3SEAAN05Iev/Ofk6ScbWAT4AFzJJxt02/wAhSMbdfv+W0hI63U7/BgBpYCkJ3XX93XT+Prjd" +
  "hv3dd/s+xd2O/t13/N1u+91m/H7dd/3dfvvdd/ndfvzdd/rdbvndZvojft13/t1u+91m/CMjTnm3KAU6" +
  "ScYYCDpJxtYBPgAX3Xf6KhTA3XX73XT8ebcoId1++rcoDd1O+91G/CEPAAlGGAvdTvvdRvwhEAAJRngY" +
  "Ht1++rcoDd1O+91G/CERAAl+GAvdbvvdZvwREgAZfrcoBAYAGAKvR19Q3W7+JgApKSkpKd1+/eYfTwYA" +
  "CSl89nhnz+vf3X76t8oMOu1bIMAqIsAGCMssyx3LGssbEPYzM9Xdde3ddO7tWyTAKibABgjLLMsdyxrL" +
  "GxD23XPv3XLw3XXx3XTy3W79r2dPBgMpj8sREPrddfPddPTdd/Xdcfbdbv6vZ08GAymPyxEQ+t119910" +
  "+N13+d1x+t1+68YGT91+7M4AR91+7c4AX91+7s4AV91+85HdfvSY3X71m91+9priZDnugPIMOt1+88YI" +
  "3Xf73X70zgDdd/zdfvXOAN13/d1+9s4A3Xf+3X7r3Zb73X7s3Z783X7t3Z793X7u3Z7+4qQ57oDyDDrd" +
  "fu/GCE/dfvDOAEfdfvHOAF/dfvLOAFfdfveR3X74mN1++Zvdfvqa4tQ57oDyDDrdfvfGCE/dfvjOAEfd" +
  "fvnOAF/dfvrOAFfdfu+R3X7wmN1+8ZvdfvKa4gQ67oDyDDohxMA2Ad00/8PoN9353eHJ3eXdIQAA3Tn1" +
  "3Xf/3XX+DgAh6sZ5ljA0EUrGBgBpYCkJGesaR91+/5AgHmtiI91+/pYgFRMTGrcoCjrsxtYBPgAXGAk6" +
  "7MYYBAwYxa/d+d3hye1bFMC3KBJ9tygHIQkAGX4YFyEKABl+GBB9tygHIQsAGX4YBSEMABl+tygEFgBf" +
  "yREAAMnd5d0hAADdOfXdNv8AIerG3X7/ljBR3U7/BgBpYCkJ6yFKxhnrGk9rYiN+3Xf+ExMaR7coBTrs" +
  "xhgIOuzG1gE+ABdvxXjNaTrB3W7+JgApKSkpKXnmHwYATwkpfPZ4Z8/r3900/xim3fnd4ck67ca3yO1L" +
  "LMAqLsCvuZg+AJ0+AJziIzvugPAh7cY2AMnd5d0hAADdOSHr/zn57VsgwCoiwAYIyyzLHcsayxsQ9t1z" +
  "9d1y9t119910+CokwO1bJsAGCMsqyxvLHMsdEPbdTvXdRvb95ePdbvfj491m+OP94d3L+H4oJN1+9cYH" +
  "T91+9s4AR91+984A/eXdd+n94d1++M4A/eXdd+r94cs4yxnLOMsZyzjLGd1x/d1+9cYF3Xf53X72zgDd" +
  "d/rdfvfOAN13+91++M4A3Xf83U753Ub6/eXj3W774+PdZvzj/eHdy/x+KCTdfvnGB0/dfvrOAEfdfvvO" +
  "AP3l3Xfp/eHdfvzOAP3l3Xfq/eHLOMsZyzjLGcs4yxndcf7V/eFNRMt6KBx9xgdPfM4AR3vOAP3l3Xfp" +
  "/eF6zgD95d136v3hyzjLGcs4yxnLOMsZ3XH/xQEIAAnBMAET1f3hTUTLeigaAQcACU1Ee84A/eXdd+n9" +
  "4XrOAP3l3Xfq/eHLOMsZyzjLGcs4yxndfv3dd+/dcfDdfv7dd/HdcfLdfv3dd/Pdfv/dd/TdNv8A3W7/" +
  "JgApTUQhBAA5CX7dd/ojft13+2/dfvrN+Avdd/wqFMDddf3ddP4BBwAJTnm3KBHdfvyRIAvdbvvdfvrN" +
  "YgwYQN1O/d1G/iEIAAlOebcoEd1+/JEgC91u+91++s2zDBgg3U793Ub+ISUACX63KBJPy/ndfvyRIAnd" +
  "bvvdfvrNqg3dNP/dfv/WA9qxPP0qFMD9fiXdd/+3ykg/ESDAIREAOesBBADtsN1+/N13691+/d137N1+" +
  "/t137d1+/9137gYI3cvuLt3L7R7dy+we3cvrHhDuIREAOeshAAA5AQQA7bDdy+5+KCDdfuvGB913/N1+" +
  "7M4A3Xf93X7tzgDdd/7dfu7OAN13/91O/N1G/d1x/t1w/93L/z7dy/4e3cv/Pt3L/h7dy/8+3cv+Ht1+" +
  "/t139d1+68YF3Xf43X7szgDdd/ndfu3OAN13+t1+7s4A3Xf7IREAOeshDQA5AQQA7bDdy/t+KCDdfuvG" +
  "DN13/N1+7M4A3Xf93X7tzgDdd/7dfu7OAN13/91+/N13/t1+/d13/93L/z7dy/4e3cv/Pt3L/h7dy/8+" +
  "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" +
  "AOPdNuYAIf//NgIqFMDddf7ddP8RBAAZft1356/NqUTNXFXdfuTdd/7dfuXdd//NaVXdc/zdcv3dfvzd" +
  "d+Tdfv3dd+Xdfv4v3Xf83X7/L913/d1+5N2m/N13/t1+5d2m/d13/91O5DrGwLcoXXnmMN13/zqpxbcg" +
  "MN1+/7coKjrHwE8GAAMDOsjAXxYAeZN4muLGSO6A8tZIOsfAxgIyx8DNphwYA81PHd1+/zKpxc1cVc3i" +
  "Vs2QFs22GM15V80TV81pVTMz1cNQSCEkwH4jMu7GfiMy78Z+IzLwxn4y8cbF3V7+3Vb/3W7k3WblzXkf" +
  "wTowwLcgEToywLcgCzozwLcgBSExwDYBITDANgDFzT4fzc4ozSQrwTqtxbcoGXnNAx7N4lbNkBbNMRjN" +
  "thjNeVfNE1fDUEghqsU2/yGtxTYAzWQyOsbAtyAoOqrFPCgiOqzFtygMOqrFbzqrxc2AHBgQ3cv+ZigK" +
  "OqrFbzqrxc2AHDrEwLfCuEwqFMARJgAZfrfKuEzdd+jtWyDAKiLABgjLLMsdyxrLGxD23XP83XL93XX+" +
  "3XT/7VskwComwAYIyyzLHcsayxsQ9t1z8t1y89119N109SH//zYCIRQAOeshDgA5AQQA7bDdfvUH5gHd" +
  "d/bdfvLGB9136d1+884A3Xfq3X70zgDdd+vdfvXOAN137N1+9rcoDiEUADnrIQUAOQEEAO2w3U743Ub5" +
  "yzjLGcs4yxnLOMsZ3XH33X78xgFP3X79zgBH3X7+zgBf3X7/zgBX3XH43XD53XP63XL7egfmAd137XnG" +
  "B9137njOAN1373vOAN138HrOAN138d1+7bcoGN1+7t13+N1+7913+d1+8N13+t1+8d13+91m+N1u+cs9" +
  "yxzLPcscyz3LHMXV3W73fM34C2/Rwd1+6JXKs0zdfvLdd/jdfvPdd/ndfvTdd/rdfvXdd/vdfva3KBjd" +
  "fundd/jdfurdd/ndfuvdd/rdfuzdd/vdbvjdZvnLPMsdyzzLHcs8yx3ddfvdfvzGBN138t1+/c4A3Xfz" +
  "3X7+zgDdd/Tdfv/OAN139d1+8t13/N1+8913/d1+9N13/t1+9d13/91+9QfmAd139t1+8sYH3Xf33X7z" +
  "zgDdd/jdfvTOAN13+d1+9c4A3Xf63X72tygY3X733Xf83X743Xf93X753Xf+3X763Xf/3Wb83W79yz3L" +
  "HMs9yxzLPcscxdXdbvt8zfgLb9HB3X7olcqzTN1u6d1m6v3l491u6+Pj3Wbs4/3h3X7sB+YB3Xf73X7p" +
  "xgfdd/zdfurOAN13/d1+684A3Xf+3X7szgDdd//dfvu3KBTdbvzdZv395ePdbv7j491m/+P94cs8yx3L" +
  "PMsdyzzLHd1+7bcoBt1O7t1G78s4yxnLOMsZyzjLGXnN+AtP3X7okShdIQoAOeshBQA5AQQA7bDdfvu3" +
  "KA4hCgA56yEYADkBBADtsN1u7t1m78s8yx3LPMsdyzzLHd1O8t1G891+9rcoBt1O991G+Ms4yxnLOMsZ" +
  "yzjLGXnN+AtP3X7okSAFIcTANgHNCTvNTT/NiUTNlETN4lbNkBbNlhfNMRjNthjNeVfNE1c6xMC3KAnd" +
  "fubN90fDUEg6w8C3ylBIDjzFzVxVwQ0g+N1O5gYAA91e5xYAeZN4muINTe6A8iZN3X7m3Xf/3TT/3X7/" +
  "3Xf+B5/dd/8YB6/dd/7dd//dfv7dd+bNqUTDUEjNXFUhQAHNfVQhAEDlEQAAZc2bVs2uVs3CVi4/PgHN" +
  "FlUhAAHlKlzI5RFgASEAAs0dViFAAc3WViFAAc1oVCEIes8hrE3NaFchhnrPIb5NzWhXIYh7zyHVTc1o" +
  "V81cVc1pVXvmMCj1zVxVzWlVe+YwIPXJUE9DS0VUIFBMQVRGT1JNRVIAZm9yIFNlZ2EgTWFzdGVyIFN5" +
  "c3RlbQBQcmVzcyAxIHRvIHN0YXJ0AC4AzbNULgDNyVQuAM2pVM05Tc3aCrco980AC81cVSFAAc19VCEA" +
  "QOURAABlzZtWzd4UIUABzWhUzSFIGNJwb2NrZXQtcGxhdGZvcm1lci1zbXMAUG9ja2V0IFBsYXRmb3Jt" +
  "ZXIgU01TIEVuZ2luZQBHZW5lcmF0ZWQgYnkgcG9ja2V0LXBsYXRmb3JtZXItdG8tc21zIHdlYiBleHBv" +
  "cnRlci4AOmjHt8g+n9N/Pr/Tfzp9x7cgBD7f0386fse3IAQ+/9N/IWjHNgDJOmjHt8A6dsf2kNN/OnfH" +
  "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" +
  "3eHJ3eXdIQAA3Tn19fXdc/zdcv3ddf7ddP9NRN1eBN1WBWlgzUdX3XP+3XL/S0Ldfgbdd/rdfgfdd/vh" +
  "0dXlxd1u+t1m+81HV+vBCevdc/7dcv9LQt1e/d1mBcUuAFUGCCkwARkQ+sEJ691z/t1y/91eBN1m/S4A" +
  "VQYIKTABGRD6TUTdXvzdZgXFLgBVBggpMAEZEPrB691zBd1yBmtiCevdcwXdcgZ7kXqYPgAX3XcH3V78" +
  "3WYELgBVBggpMAEZEPrr3XP83XL93TYEAN1+/N2GBF/dfv3djgVX3X7+3Y4Gb91+/92OB2fd+d3hyQAD" +
  "BCAICAEBBwB4sSgIEVzIIYZZ7bDJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//+PP5mZAEw=";
