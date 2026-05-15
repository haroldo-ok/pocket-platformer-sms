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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDS1ch" +
  "AMB+BgBwEQHAAV0I7bAyksfNA1vNoVX7zVxPdhj9ZGV2a2l0U01TAAAAw4pX7aPto+2j7aPto+2j7aPt" +
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
  "xgfdd/d4zgDdd/h7zgDdd/l6zgDdd/rdTvfdRvjLOMsZyzjLGcs4yxndbvt5zfgL3Xf23X773Xf37Usg" +
  "wO1bIsA+CMsqyxvLGMsZPSD13XH43XD53XP63XL7y3ooGHnGB913+HjOAN13+XvOAN13+nrOAN13+91O" +
  "+N1G+cs4yxnLOMsZyzjLGQzdbvd5zfgLT/0qFMD9RgbdfvaQKAd5kCgDrxgCPgG3KEftSyTAKibA3XH4" +
  "eMYI3Xf5fc4A3Xf6fM4A3Xf73Vby3W7z3Wb0HgAGA8si7WoQ+nvdlvh63Z75fd2e+nzdnvvi3i7ugPp8" +
  "M91+8t1e891u9N1m9QYDh8sT7WoQ+cb4T3vO/0d9zv9ffM7/3XH93XD+3XP/3Tb8ACEAACIswCIuwCEw" +
  "wDYBITHANgAhMsA2ACEzwDYAITjANgAhuMU2ACG5xTYAw3wz3W7+3Wb/5d1u/N1m/eXdXvTdVvXdbvbd" +
  "ZvfNgA63ICPtWyDAKiLAesYEVzABI91O/t1G/8XdTvzdRv3FzYAOt8p8M91u8N1m8d1e8t1W893L834o" +
  "GN1+8MYHb91+8c4AZ91+8s4AX91+884AVwYDyyrLG8scyx0Q9n3GAd1343zOAN135HvOAN135XrOAN13" +
  "5jrvxrfCODMqFMARDQAZfrfKODPtSyDA7VsiwD4IyyrLG8sYyxk9IPXdcfzdcP3dc/7dcv/LeigYecYH" +
  "3Xf8eM4A3Xf9e84A3Xf+es4A3Xf/3W783Wb9yzzLHcs8yx3LPMsdZXnGBt139HjOAN139XvOAN139nrO" +
  "AN13991+9N13/N1+9d13/d1+9t13/t1+9913/93L934oGHnGDd13/HjOAN13/XvOAN13/nrOAN13/91O" +
  "/N1G/cs4yxnLOMsZyzjLGd1+4z1HxWh8zfgLwd13/2h5zfgLT/0qFMD95dEhDQAZXt1+/5MoEf1GDt1+" +
  "/5AoCHm7KASQwjgzOu7G1gE+ABcy7sbNFTwqFMDddf7ddP867sa3KA3dTv7dRv8hDQAJThgL3W7+3Wb/" +
  "EQ4AGU5BebcoBUgGABgDAQAAHgAh7cZ7ljA6ayYAKf0h3MbFTUT9CcH95eEjbiYAKSkpKSl9VP1uAPV9" +
  "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" +
  "ADkBBADtsN1+9QfmAd139t1+8sYH3Xfp3X7zzgDdd+rdfvTOAN13691+9c4A3Xfs3X72tygOIRQAOesh" +
  "BQA5AQQA7bDdTvjdRvnLOMsZyzjLGcs4yxndcffdfvzGAU/dfv3OAEfdfv7OAF/dfv/OAFfdcfjdcPnd" +
  "c/rdcvt6B+YB3XftecYH3XfueM4A3Xfve84A3Xfwes4A3Xfx3X7ttygY3X7u3Xf43X7v3Xf53X7w3Xf6" +
  "3X7x3Xf73Wb43W75yz3LHMs9yxzLPcscxdXdbvd8zfgLb9HB3X7olcopTt1+8t13+N1+8913+d1+9N13" +
  "+t1+9d13+91+9rcoGN1+6d13+N1+6t13+d1+6913+t1+7N13+91u+N1m+cs8yx3LPMsdyzzLHd11+91+" +
  "/MYE3Xfy3X79zgDdd/Pdfv7OAN139N1+/84A3Xf13X7y3Xf83X7z3Xf93X703Xf+3X713Xf/3X71B+YB" +
  "3Xf23X7yxgfdd/fdfvPOAN13+N1+9M4A3Xf53X71zgDdd/rdfva3KBjdfvfdd/zdfvjdd/3dfvndd/7d" +
  "fvrdd//dZvzdbv3LPcscyz3LHMs9yxzF1d1u+3zN+Atv0cHdfuiVyilO3W7p3Wbq/eXj3W7r4+PdZuzj" +
  "/eHdfuwH5gHdd/vdfunGB913/N1+6s4A3Xf93X7rzgDdd/7dfuzOAN13/91++7coFN1u/N1m/f3l491u" +
  "/uPj3Wb/4/3hyzzLHcs8yx3LPMsd3X7ttygG3U7u3UbvyzjLGcs4yxnLOMsZec34C0/dfuiRKF0hCgA5" +
  "6yEFADkBBADtsN1++7coDiEKADnrIRgAOQEEAO2w3W7u3WbvyzzLHcs8yx3LPMsd3U7y3Ubz3X72tygG" +
  "3U733Ub4yzjLGcs4yxnLOMsZec34C0/dfuiRIAUhxMA2Ac2BPM3FQM0BRs0MRs1YWM2QFs2WF811GM36" +
  "GM3vWM2JWDrEwLcoCd1+5s1vScPISTrDwLfKyEkOPMXN0lbBDSD43U7mBgAD3V7nFgB5k3ia4oNO7oDy" +
  "nE7dfubdd//dNP/dfv/dd/4Hn913/xgHr913/t13/91+/t135s0hRsPISc3SViFAAc3zVSEAQOURAABl" +
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
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//8YGJmZAEw=";
