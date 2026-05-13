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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDRFch" +
  "AMB+BgBwEQHAAV0I7bAyksfN/FrNmlX7zVVPdhj9ZGV2a2l0U01TAAAAw4NX7aPto+2j7aPto+2j7aPt" +
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
  "Vih61cURKMAhBwA56wEEAO2wwdHdfvDdlvjdd/TdfvHdnvndd/XdfvLdnvrdd/bdfvPdnvvdd/fVxREo" +
  "wCELADkBBADtsMHRr5FPPgCYRyEAAO1S691+9JHdfvWY3X72m91+95riOiHugPJFIe1DKMDtUyrAITfA" +
  "NgHDPiLdy/5eKG3VxREowCEHADnrAQQA7bDB0d1+8N2G+N139N1+8d2O+d139d1+8t2O+t139t1+892O" +
  "+91399XFESjAIQsAOQEEAO2wwdF53Zb0eN2e9XvdnvZ63Z734q0h7oDyuCHtQyjA7VMqwCE3wDYAwz4i" +
  "OrjFtyB47VsowCoqwN1O9t1G98XdTvTdRvXFzQpa8fFNRD4IyyjLGcsayxs9IPXtUyjA7UMqwNXFESjA" +
  "IQ8AOesBBADtsMHRPoC7Pv+aPv+ZPv+Y4hki7oDyPiLdfvjWgN1++d4A3X763gDdfvsXPx/egDAJIQAA" +
  "IijAIirA7VsgwCoiwAYIyyzLHcsayxsQ9nvG/9137XrO/9137n3O/91373zO/9138HvGB913+HrOAN13" +
  "+X3OAN13+nzOAN13+91+8AfmAd138d3L8UYgTiEHADnrIQAAOQEEAO2w3X7xtygg3X7txgfdd/Tdfu7O" +
  "AN139d1+784A3Xf23X7wzgDdd/fdbvTdZvXdXvbdVvcGA8sqyxvLHMsdEPYYAyH/AN118t1O+N1G+d3L" +
  "+34oDN1++MYHT91++c4AR8s4yxnLOMsZyzjLGd1x8+1bJMAqJsAGCMssyx3LGssbEPbl/eFLQnvGB913" +
  "9HrOAN139X3OAN139nzOAN1398t8KBTdTvTdRvX95ePdbvbj491m9+P94cs4yxnLOMsZyzjLGd1+9N13" +
  "+N1+9d13+d1+9t13+t1+9913+93L934oGHvGDt13+HrOAN13+X3OAN13+nzOAN13+91G+N1W+cs6yxjL" +
  "OssYyzrLGN3L8UbCMiTFad1+8s34C8G3KDb9KhTA/X4GtygUxWndfvLN+AvBKhTAEQYAGV6TKBjFad1+" +
  "8s2LO8G3IAzFad1+8s3uOMG3KEXFaN1+8s34C8G3KDb9KhTA/X4GtygUxWjdfvLN+AvBKhTAEQYAGV6T" +
  "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" +
  "e84A3Xf5es4A3Xf63U733Ub4yzjLGcs4yxnLOMsZ3W77ec34C9139t1++9139+1LIMDtWyLAPgjLKssb" +
  "yxjLGT0g9d1x+N1w+d1z+t1y+8t6KBh5xgfdd/h4zgDdd/l7zgDdd/p6zgDdd/vdTvjdRvnLOMsZyzjL" +
  "Gcs4yxkM3W73ec34C0/9KhTA/UYG3X72kCgHeZAoA68YAj4BtyhH7UskwComwN1x+HjGCN13+X3OAN13" +
  "+nzOAN13+91W8t1u891m9B4ABgPLIu1qEPp73Zb4et2e+X3dnvp83Z774tMu7oD6cTPdfvLdXvPdbvTd" +
  "ZvUGA4fLE+1qEPnG+E97zv9Hfc7/X3zO/91x/d1w/t1z/902/AAhAAAiLMAiLsAhMMA2ASExwDYAITLA" +
  "NgAhM8A2ACE4wDYAIbjFNgAhucU2AMNxM91u/t1m/+XdbvzdZv3l3V703Vb13W723Wb3zYAOtyAj7Vsg" +
  "wCoiwHrGBFcwASPdTv7dRv/F3U783Ub9xc2ADrfKcTPdbvDdZvHdXvLdVvPdy/N+KBjdfvDGB2/dfvHO" +
  "AGfdfvLOAF/dfvPOAFcGA8sqyxvLHMsdEPZ9xgHdd+N8zgDdd+R7zgDdd+V6zgDdd+Y678a3wi0zKhTA" +
  "EQ0AGX63yi0z7UsgwO1bIsA+CMsqyxvLGMsZPSD13XH83XD93XP+3XL/y3ooGHnGB913/HjOAN13/XvO" +
  "AN13/nrOAN13/91u/N1m/cs8yx3LPMsdyzzLHWV5xgbdd/R4zgDdd/V7zgDdd/Z6zgDdd/fdfvTdd/zd" +
  "fvXdd/3dfvbdd/7dfvfdd//dy/d+KBh5xg3dd/x4zgDdd/17zgDdd/56zgDdd//dTvzdRv3LOMsZyzjL" +
  "Gcs4yxndfuM9R8VofM34C8Hdd/9oec34C0/9KhTA/eXRIQ0AGV7dfv+TKBH9Rg7dfv+QKAh5uygEkMIt" +
  "MzruxtYBPgAXMu7GzRE8KhTA3XX+3XT/Ou7GtygN3U7+3Ub/IQ0ACU4YC91u/t1m/xEOABlOQXm3KAVI" +
  "BgAYAwEAAB4AIe3Ge5YwOmsmACn9IdzGxU1E/QnB/eXhI24mACkpKSkpfVT9bgD1feYfb/EmAIVveozL" +
  "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" +
  "3X71B+YB3Xf23X7yxgfdd+ndfvPOAN136t1+9M4A3Xfr3X71zgDdd+zdfva3KA4hFAA56yEFADkBBADt" +
  "sN1O+N1G+cs4yxnLOMsZyzjLGd1x991+/MYBT91+/c4AR91+/s4AX91+/84AV91x+N1w+d1z+t1y+3oH" +
  "5gHdd+15xgfdd+54zgDdd+97zgDdd/B6zgDdd/Hdfu23KBjdfu7dd/jdfu/dd/ndfvDdd/rdfvHdd/vd" +
  "ZvjdbvnLPcscyz3LHMs9yxzF1d1u93zN+Atv0cHdfuiVyiJO3X7y3Xf43X7z3Xf53X703Xf63X713Xf7" +
  "3X72tygY3X7p3Xf43X7q3Xf53X7r3Xf63X7s3Xf73W743Wb5yzzLHcs8yx3LPMsd3XX73X78xgTdd/Ld" +
  "fv3OAN13891+/s4A3Xf03X7/zgDdd/XdfvLdd/zdfvPdd/3dfvTdd/7dfvXdd//dfvUH5gHdd/bdfvLG" +
  "B913991+884A3Xf43X70zgDdd/ndfvXOAN13+t1+9rcoGN1+9913/N1++N13/d1++d13/t1++t13/91m" +
  "/N1u/cs9yxzLPcscyz3LHMXV3W77fM34C2/Rwd1+6JXKIk7dbundZur95ePdbuvj491m7OP94d1+7Afm" +
  "Ad13+91+6cYH3Xf83X7qzgDdd/3dfuvOAN13/t1+7M4A3Xf/3X77tygU3W783Wb9/eXj3W7+4+PdZv/j" +
  "/eHLPMsdyzzLHcs8yx3dfu23KAbdTu7dRu/LOMsZyzjLGcs4yxl5zfgLT91+6JEoXSEKADnrIQUAOQEE" +
  "AO2w3X77tygOIQoAOeshGAA5AQQA7bDdbu7dZu/LPMsdyzzLHcs8yx3dTvLdRvPdfva3KAbdTvfdRvjL" +
  "OMsZyzjLGcs4yxl5zfgLT91+6JEgBSHEwDYBzX08zcFAzf1FzQhGzVFYzZAWzZYXzXUYzfoYzehYzYJY" +
  "OsTAtygJ3X7mzWtJw8RJOsPAt8rESQ48xc3LVsENIPjdTuYGAAPdXucWAHmTeJrifE7ugPKVTt1+5t13" +
  "/900/91+/913/gef3Xf/GAev3Xf+3Xf/3X7+3XfmzR1Gw8RJzctWIUABzexVIQBA5REAAGXNCljNHVjN" +
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
  "//87E5mZAEw=";
