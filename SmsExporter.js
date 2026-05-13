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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDCVch" +
  "AMB+BgBwEQHAAVwI7bAykcfNwVrNX1X7zRpPdhj9ZGV2a2l0U01TAAAAw0hX7aPto+2j7aPto+2j7aPt" +
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
  "xgbdd/zdfvnOAN13/d1++s4A3Xf+3X77zgDdd/8hBAA56yEIADkBBADtsN3L/34oIN1+/MYH3Xf43X79" +
  "zgDdd/ndfv7OAN13+t1+/84A3Xf73W743Wb53V763Vb7BgPLKssbyxzLHRD2BgMpyxPLEhD5Afn/CU1E" +
  "e87/X3rO/91x9d1w9t1z99029AAhAAAiKMAiKsAhuMU2AMPzK93L/37K8yvtSyTAKibAeMYBRzABI+XF" +
  "3V703Vb13W723Wb3zYAOtyAi7UskwComwHjGBkcwASPlxd1e9N1W9d1u9t1m982ADrcoY91O+N1G+d1u" +
  "+t1m+93L+34oGN1++MYHT91++c4AR91++s4Ab91++84AZ1lQBgPLLMsdyxrLGxD2HCAEFCABI2VqUx4A" +
  "BgPLIu1qEPozM9XddfbddPchAAAiKMAiKsAhuMU2ABEgwCEAADkBBADtsN353eHJ3eXdIQAA3Tkh4/85" +
  "+e1LJMDtWybA1cURLMAhDQA56wEEAO2wwdF53YbsT3jdju1He92O7l963Y7v3XH83XD93XP+3Xf/3X78" +
  "3Xf43X793Xf53X7+3Xf63X7/3Xf7Bgjdy/su3cv6Ht3L+R7dy/geEO4hDQA56yEVADkBBADtsO1LIMAq" +
  "IsDdcfR4xgHdd/V9zgDdd/Z8zgDdd/fdy+9+wvwu3U783X79xghH3X7+zgD95d134f3h3X7/zgD95d13" +
  "4v3hxf3l/eXF3V703Vb13W723Wb3zbkR/eHBtyAY7VsgwCoiwHrGBFcwASP95cXNuRG3yjgz3X7wxgjd" +
  "d/TdfvHOAN139d1+8s4A3Xf23X7zzgDdd/chFQA56yERADkBBADtsN3L934oIN1+9MYH3Xf43X71zgDd" +
  "d/ndfvbOAN13+t1+984A3Xf73X743Xfy3X753Xfz3X763Xf03X773Xf1BgPdy/Uu3cv0Ht3L8x7dy/Ie" +
  "EO79KhTA/X4Gt8qiLt1+8t13++1LIMDtWyLAPgjLKssbyxjLGT0g9d1x991w+N1z+d1y+st6KBh5xgfd" +
  "d/d4zgDdd/h7zgDdd/l6zgDdd/rdTvfdRvjLOMsZyzjLGcs4yxndbvt5zfgL3Xf23X773Xf37UsgwO1b" +
  "IsA+CMsqyxvLGMsZPSD13XH43XD53XP63XL7y3ooGHnGB913+HjOAN13+XvOAN13+nrOAN13+91O+N1G" +
  "+cs4yxnLOMsZyzjLGQzdbvd5zfgLT/0qFMD9RgbdfvaQKAd5kCgDrxgCPgG3KEftSyTAKibA3XH4eMYI" +
  "3Xf5fc4A3Xf6fM4A3Xf73Vby3W7z3Wb0HgAGA8si7WoQ+nvdlvh63Z75fd2e+nzdnvviny7ugPo4M91+" +
  "8t1e891u9N1m9QYDh8sT7WoQ+cb4T3vO/0d9zv9ffM7/3XH93XD+3XP/3Tb8ACEAACIswCIuwCEwwDYB" +
  "ITHANgAhMsA2ACEzwDYAITjANgAhuMU2AMM4M91u/t1m/+XdbvzdZv3l3V703Vb13W723Wb3zYAOtyAj" +
  "7VsgwCoiwHrGBFcwASPdTv7dRv/F3U783Ub9xc2ADrfKODPdbvDdZvHdXvLdVvPdy/N+KBjdfvDGB2/d" +
  "fvHOAGfdfvLOAF/dfvPOAFcGA8sqyxvLHMsdEPZ9xgHdd+N8zgDdd+R7zgDdd+V6zgDdd+Y67sa3wvQy" +
  "KhTAEQ0AGX63yvQy7UsgwO1bIsA+CMsqyxvLGMsZPSD13XH83XD93XP+3XL/y3ooGHnGB913/HjOAN13" +
  "/XvOAN13/nrOAN13/91u/N1m/cs8yx3LPMsdyzzLHWV5xgbdd/R4zgDdd/V7zgDdd/Z6zgDdd/fdfvTd" +
  "d/zdfvXdd/3dfvbdd/7dfvfdd//dy/d+KBh5xg3dd/x4zgDdd/17zgDdd/56zgDdd//dTvzdRv3LOMsZ" +
  "yzjLGcs4yxndfuM9R8VofM34C8Hdd/9oec34C0/9KhTA/eXRIQ0AGV7dfv+TKBH9Rg7dfv+QKAh5uygE" +
  "kML0MjrtxtYBPgAXMu3GzdE7KhTA3XX+3XT/Ou3GtygN3U7+3Ub/IQ0ACU4YC91u/t1m/xEOABlOQXm3" +
  "KAVIBgAYAwEAAB4AIezGe5YwOmsmACn9IdvGxU1E/QnB/eXhI24mACkpKSkpfVT9bgD1feYfb/EmAIVv" +
  "eozLJY/2eGfFz8FpYN8cGL/tSyDA7VsiwD4IyyrLG8sYyxk9IPXdfvjdd+fdfvndd+jdfvrdd+ndfvvd" +
  "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" +
  "T91++M4AR91++c4AX91++s4AV91+75HdfvCY3X7xm91+8priODvugPJAOyHEwDYB3TT/wxw53fnd4cnd" +
  "5d0hAADdOfXdd//ddf4OACHrxnmWMDQRS8YGAGlgKQkZ6xpH3X7/kCAea2Ij3X7+liAVExMatygKOu3G" +
  "1gE+ABcYCTrtxhgEDBjFr9353eHJ7VsUwLcoEn23KAchCQAZfhgXIQoAGX4YEH23KAchCwAZfhgFIQwA" +
  "GX63KAQWAF/JEQAAyd3l3SEAAN059d02/wAh68bdfv+WMFHdTv8GAGlgKQnrIUvGGesaT2tiI37dd/4T" +
  "ExpHtygFOu3GGAg67cbWAT4AF2/FeM2dO8Hdbv4mACkpKSkpeeYfBgBPCSl89nhnz+vf3TT/GKbd+d3h" +
  "yTruxrfI7UsswCouwK+5mD4AnT4AnOJXPO6A8CHuxjYAyd3l3SEAAN05Iev/OfntWyDAKiLABgjLLMsd" +
  "yxrLGxD23XP13XL23XX33XT4KiTA7VsmwAYIyyrLG8scyx0Q9t1O9d1G9v3l491u9+Pj3Wb44/3h3cv4" +
  "figk3X71xgdP3X72zgBH3X73zgD95d136f3h3X74zgD95d136v3hyzjLGcs4yxnLOMsZ3XH93X71xgXd" +
  "d/ndfvbOAN13+t1+984A3Xf73X74zgDdd/zdTvndRvr95ePdbvvj491m/OP94d3L/H4oJN1++cYHT91+" +
  "+s4AR91++84A/eXdd+n94d1+/M4A/eXdd+r94cs4yxnLOMsZyzjLGd1x/tX94U1Ey3ooHH3GB098zgBH" +
  "e84A/eXdd+n94XrOAP3l3Xfq/eHLOMsZyzjLGcs4yxndcf/FAQgACcEwARPV/eFNRMt6KBoBBwAJTUR7" +
  "zgD95d136f3hes4A/eXdd+r94cs4yxnLOMsZyzjLGd1+/d13791x8N1+/t138d1x8t1+/d13891+/913" +
  "9N02/wDdbv8mAClNRCEEADkJft13+iN+3Xf7b91++s34C913/CoUwN11/d10/gEHAAlOebcoEd1+/JEg" +
  "C91u+91++s1iDBhA3U793Ub+IQgACU55tygR3X78kSAL3W773X76zbMMGCDdTv3dRv4hJQAJfrcoEk/L" +
  "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" +
  "7bDdTvjdRvnLOMsZyzjLGcs4yxndcffdfvzGAU/dfv3OAEfdfv7OAF/dfv/OAFfdcfjdcPndc/rdcvt6" +
  "B+YB3XftecYH3XfueM4A3Xfve84A3Xfwes4A3Xfx3X7ttygY3X7u3Xf43X7v3Xf53X7w3Xf63X7x3Xf7" +
  "3Wb43W75yz3LHMs9yxzLPcscxdXdbvd8zfgLb9HB3X7olcrnTd1+8t13+N1+8913+d1+9N13+t1+9d13" +
  "+91+9rcoGN1+6d13+N1+6t13+d1+6913+t1+7N13+91u+N1m+cs8yx3LPMsdyzzLHd11+91+/MYE3Xfy" +
  "3X79zgDdd/Pdfv7OAN139N1+/84A3Xf13X7y3Xf83X7z3Xf93X703Xf+3X713Xf/3X71B+YB3Xf23X7y" +
  "xgfdd/fdfvPOAN13+N1+9M4A3Xf53X71zgDdd/rdfva3KBjdfvfdd/zdfvjdd/3dfvndd/7dfvrdd//d" +
  "Zvzdbv3LPcscyz3LHMs9yxzF1d1u+3zN+Atv0cHdfuiVyudN3W7p3Wbq/eXj3W7r4+PdZuzj/eHdfuwH" +
  "5gHdd/vdfunGB913/N1+6s4A3Xf93X7rzgDdd/7dfuzOAN13/91++7coFN1u/N1m/f3l491u/uPj3Wb/" +
  "4/3hyzzLHcs8yx3LPMsd3X7ttygG3U7u3UbvyzjLGcs4yxnLOMsZec34C0/dfuiRKF0hCgA56yEFADkB" +
  "BADtsN1++7coDiEKADnrIRgAOQEEAO2w3W7u3WbvyzzLHcs8yx3LPMsd3U7y3Ubz3X72tygG3U733Ub4" +
  "yzjLGcs4yxnLOMsZec34C0/dfuiRIAUhxMA2Ac09PM2BQM29Rc3IRc0WWM2QFs2WF811GM36GM2tWM1H" +
  "WDrEwLcoCd1+5s0rScOESTrDwLfKhEkOPMXNkFbBDSD43U7mBgAD3V7nFgB5k3ia4kFO7oDyWk7dfubd" +
  "d//dNP/dfv/dd/4Hn913/xgHr913/t13/91+/t135s3dRcOESc2QViFAAc2xVSEAQOURAABlzc9XzeJX" +
  "zfZXLj8+Ac1KViEAAeUqXcjlEWABIQACzVFXIUABzQpYIUABzZxVIQh6zyHgTs2cWCGGes8h8k7NnFgh" +
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
  "//8fA5mZAEw=";
