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
    'redBlueSwitch':      OBJ_TYPE.redBlueSwitch,
    'redblueblockswitch': OBJ_TYPE.redBlueSwitch,
    'violetBlock':        10,
    'pinkBlock':          11,
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
  // 9 sprites × 1 tile each (8×8, SPRITEMODE_NORMAL). Loaded at VRAM 256.
  //   Tile 256=start flag, 257=finish flag, 258=spike, 259=trampoline, 260=coin
  //   Tile 261=player idle, 262=player walk0, 263=player walk1, 264=player jump
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

    startFlag  ? encodeSprite8(startFlag,  0) : encodeBlank();
    finishFlag ? encodeSprite8(finishFlag, 0) : encodeBlank();
    spikeS     ? encodeSprite8(spikeS,     0) : encodeBlank();
    trampS     ? encodeSprite8(trampS,     0) : encodeBlank();
    coinS      ? encodeSprite8(coinS,      0) : encodeBlank();
    pIdle      ? encodeSprite8(pIdle,      0) : encodeBlank();
    pWalk      ? encodeSprite8(pWalk,      0) : encodeBlank();
    pWalk      ? encodeSprite8(pWalk,      1) : encodeBlank();
    pJump      ? encodeSprite8(pJump,      0) : encodeBlank();

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
        if (hasConnected && !tileCache.has(10)) {
          tileCache.set(10, null);
          tileOrder.push(10);
        }
      }
    }

    // Special tile values that don't follow the TILE_N naming convention
    const specialTilePixels = new Map();
    if (sprites['DISAPPEARING_BLOCK_SPRITE'])
      specialTilePixels.set(11, sprites['DISAPPEARING_BLOCK_SPRITE'].animation[0].sprite);
    if (sprites['CONNECTED_DISAPPEARING_BLOCK_SPRITE'])
      specialTilePixels.set(10, sprites['CONNECTED_DISAPPEARING_BLOCK_SPRITE'].animation[0].sprite);
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
    if (level.levelObjects) {
      for (const obj of level.levelObjects) {
        if (obj.type === 'connectedDisappearingBlock') connectedPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'redBlock')       redBlockPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'blueBlock')      blueBlockPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'violetBlock')    violetPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'pinkBlock')      pinkPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'redBlueSwitch' || obj.type === 'redblueblockswitch')  switchPos.add(`${obj.x},${obj.y}`);
      }
    }

    // Collect valid objects
    const objects = [];
    if (level.levelObjects) {
      for (const obj of level.levelObjects) {
        const typeId = OBJECT_TYPE_MAP[obj.type];
        if (typeId === undefined) continue;
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
          buf[off++] = clampByte(indexMap.get(dekoPos.get(`${x},${y}`)) || 0);
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
        } else if (tileVal === 0) {
          buf[off++] = 0;
        } else if ((tileVal === 1 || tileVal === 2) && isEdgePos(x, y)) {
          buf[off++] = clampByte(edgeVramIdx || 0);
        } else if (tileVal === 11 && connectedPos.has(`${x},${y}`)) {
          buf[off++] = clampByte(indexMap.get(10) || indexMap.get(tileVal) || 0);
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

    writeInt16(toFP(playerObj.maxSpeed         || 3.2));
    writeInt16(toFP(playerObj.groundAcceleration || 0.8));
    writeInt16(toFP(playerObj.groundFriction    || 0.65));
    writeInt16(toFP(playerObj.air_acceleration  || 0.8));
    writeInt16(toFP(playerObj.air_friction      || 0.75));
    // Jump speed per-frame factor (ramp formula: vy = -(maxJumpFrames-frame)*jumpSpeed)
    // Store raw jumpSpeed so C can compute each frame's velocity correctly.
    writeInt16(toFP(playerObj.jumpSpeed || 0.44));
    writeUint8(playerObj.maxJumpFrames          || 18);
    // maxFallSpeed capped to 7px/frame in C engine (tunneling prevention)
    writeInt16(toFP(Math.min(playerObj.maxFallSpeed || 16, 7)));
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
    const header = new Uint8Array(37);
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
    // conn_vram_idx: VRAM index of tile value 10 (connected disappearing block), or 0 if absent
    header[8] = indexMap.has(10) ? Math.min(indexMap.get(10), 255) : 0;
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

    // 8. Assemble everything
    const parts = [header, physicsBytes, new Uint8Array(palette), bgTiles, spriteSheet, ...encodedLevels];
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDREAh" +
  "AMB+BgBwEQHAAdQC7bAyCcLN8ELNmj77zVU4dhj9ZGV2a2l0U01TAAAAw4NA7aPto+2j7aPto+2j7aPt" +
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
  "AsBVHgDdbggmAHu1X3q0V8UqBMDNV0HBIQLAfsYIdzACIzTdfgjGAt13CCEBwDUYuCEEwH7GEHcwAiM0" +
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
  "yOXNyz/hKxj1zVFBzehBw4JBIf//NgI6AIDWUCAVOgGA1lAgDjoCgNZMIAc6A4DWVCgCr8k+Ackh//82" +
  "AiEAgCIUwC4lIhbALjYiGMAuRiIawDoFgG8mACkpKSkpAUaACSIcwCocwBEgARkiHsDJ3eXdIQAA3Tkh" +
  "9v85+d13/ioewN11/N10/SH//zYC3Tb/AN1+/92W/tLtC91u/N1m/U4GAN1u/N1m/SNeFgBpYM22QSEE" +
  "ABnj3X783Xf63X793Xf73W763Wb7IyN+3Xf73Xf63Tb7AE8GAGlgKQnddfjddPndfvbdhvjdd/rdfvfd" +
  "jvndd/vdfvrdd/jdfvvdd/ndfvzdd/rdfv3dd/vdfvrdhvjdd/zdfvvdjvndd/3dNP/DWQvdXvzdVv3d" +
  "+d3hyU9FKtvBXnmTMAYjXniTOAKvyWkmAFTFzbZBwWgmABnrKt3BGX7J3eXdIQAA3Tn13Xf/3XX+DgBZ" +
  "FgDrKSkRm8EZXVQjI363KBMaR91+/5AgC2tiI91+/pYoCxgADHnWEDjVEQAA3fnd4cnd5d0hAADdOfXd" +
  "d//ddf7dfv/NHgx6syAzb10WAOspKes+m4NPPsGKR1lQExMatyAV3X7/AmlgI91+/nc+ARIDAwOvAhgG" +
  "LH3WEDjO3fnd4cnd5d0hAADdOfU73Xf/3XX+3X7/zR4MS3qxIHrdbv7dfv/NYgzdbv7dfv/NHgxLaXpn" +
  "sSgFIyMjNgEO/x7/ebcgA7MoOXm3KAR7tyAx3X7/gd13/d1+/oNHxdVo3X79zfgL0cH9KhTA9f1WCPGS" +
  "IA6yKAvF1Wjdfv3NswzRwRw+AZPiOQ3ugPLwDAw+AZHiRQ3ugPLuDN353eHJzR4MS3pHsygKAwMK1ig4" +
  "Az4Bya/J3eXdIQAA3Tn9Iej//Tn9+QYIyyzLHcsayxsQ9t1z7N1y7d117t107yEAADnrIQQAOQEEAO2w" +
  "3X4E3Xfw3X4F3Xfx3X4G3Xfy3X4H3XfzBgjdy/Mu3cvyHt3L8R7dy/AeEO4hDwA56yEIADkBBADtsN1+" +
  "6wfmAd13+7cgCN1++gfmASgFPgHDSRAhFAA56yEPADkBBADtsLcoIN1+98YH3Xf83X74zgDdd/3dfvnO" +
  "AN13/t1++s4A3Xf/3W783Wb9yzzLHcs8yx3LPMsdwcXdfvu3KAzdfujGB0/dfunOAEfLOMsZyzjLGcs4" +
  "yxl5zfgL3Xf0tyAEr8NJEP0qFMD9TgZ5tygK3X70kSAEr8NJEN1+7wfmAd139d1+7MYH3Xf23X7tzgDd" +
  "d/fdfu7OAN13+N1+784A3Xf53X7zB+YB3Xf63X7wxgfdd/vdfvHOAN13/N1+8s4A3Xf93X7zzgDdd/46" +
  "8cC3KF8hAAA56yEEADkBBADtsN1+9bcoDiEAADnrIQ4AOQEEAO2wwcXLOMsZyzjLGcs4yxndcf/dTvDd" +
  "RvHdfvq3KAbdTvvdRvzLOMsZyzjLGcs4yxlp3X7/zfYqtygEr8NJEDqTwbcoTd1O7N1G7d1+9bcoBt1O" +
  "9t1G98s4yxnLOMsZyzjLGd1x/91O8N1G8d1++rcoBt1O+91G/Ms4yxnLOMsZyzjLGWndfv/Nky23KASv" +
  "w0kQ3U7s3Ubt3V7u3Vbv3X71tygM3U723Ub33V743Vb5yzjLGcs4yxnLOMsZ3XH/IQ4AOeshCAA5AQQA" +
  "7bDdfvq3KA4hDgA56yETADkBBADtsN1+9t13/d1+9913/t3L/j7dy/0e3cv+Pt3L/R7dy/4+3cv9Ht1+" +
  "/d13/CoUwN11/d10/hEHABl+3Xf+tygU3X703Zb+IAzdbvzdfv/NTQ23ICgqFMDddf3ddP4RCAAZft13" +
  "/rcoF91+9N2W/iAP3W783X7/zU0NtygDrxgCPgHd+d3h4cHB6d3l3SEAAN05/SHo//05/fkGCMssyx3L" +
  "GssbEPbdc+zdcu3dde7ddO8hAAA56yEEADkBBADtsN1+BN138N1+Bd138d1+Bt138t1+B9138wYI3cvz" +
  "Lt3L8h7dy/Ee3cvwHhDuIQ8AOeshCAA5AQQA7bDdfusH5gHdd/u3IAjdfvoH5gEoBT4BwzMTIRQAOesh" +
  "DwA5AQQA7bC3KCDdfvfGB913/N1++M4A3Xf93X75zgDdd/7dfvrOAN13/91u/N1m/cs8yx3LPMsdyzzL" +
  "HcHF3X77tygM3X7oxgdP3X7pzgBHyzjLGcs4yxnLOMsZec34C9139LcgBK/DMxMOACoUwBETABlZFgAZ" +
  "Rni3KArdfvSQIASvwzMTDHnWEjjg3X7vB+YB3Xf13X7sxgfdd/bdfu3OAN13991+7s4A3Xf43X7vzgDd" +
  "d/ndfvMH5gHdd/rdfvDGB913+91+8c4A3Xf83X7yzgDdd/3dfvPOAN13/jrxwLcoTd1O7N1G7d1+9bco" +
  "Bt1O9t1G98s4yxnLOMsZyzjLGd1x/91O8N1G8d1++rcoBt1O+91G/Ms4yxnLOMsZyzjLGWndfv/N9iq3" +
  "KASvwzMTOpPBtyhN3U7s3Ubt3X71tygG3U723Ub3yzjLGcs4yxnLOMsZ3XH/3U7w3Ubx3X76tygG3U77" +
  "3Ub8yzjLGcs4yxnLOMsZad1+/82TLbcoBK/DMxPdTuzdRu3dXu7dVu/dfvW3KAzdTvbdRvfdXvjdVvnL" +
  "OMsZyzjLGcs4yxndcf8hDgA56yEIADkBBADtsN1++rcoDiEOADnrIRMAOQEEAO2w3X723Xf93X733Xf+" +
  "3cv+Pt3L/R7dy/4+3cv9Ht3L/j7dy/0e3X793Xf8KhTA3XX93XT+EQcAGX7dd/63KBTdfvTdlv4gDN1u" +
  "/N1+/81NDbcgKCoUwN11/d10/hEIABl+3Xf+tygX3X703Zb+IA/dbvzdfv/NTQ23KAOvGAI+Ad353eHh" +
  "wcHpIf//NgIqGMDNnz+vb82SPw4BKhjABgAJbsV5zZI/wQx51hA47SoUwBEFABluJgApKSkpKe1bGsDl" +
  "ISAAzelB7VscwCEgAeUhACDN6UE+AfUzr/UzIQAD5RFgASEAAs2MQCFAAcNFQSH//zYCDgBpJgApKSkp" +
  "KSl89nhnxc/BBgAq28EjXnmTMAnFaXjN+AvBGAGvX7coBBYAGAMRAADr3wR41iA42gx51hg4wslHTSH/" +
  "/zYCaCYAKXz2eGfFz8EGACrbwSNeeJMwCcVoec34C8EYAa9ftygEFgAYAxEAAOvfBHjWGDjayU/WAigP" +
  "ef4DKA7+BCgO1gUoDhgQEQEByRECAckRAwHJEQQByREBAcnd5d0hAADdOfU7If//NgIOACrbwSMjRnmQ" +
  "0jQVBgBpYCkJRVR4Id/BhiNfeo5X3XP+3XL/ExMa3Xf9PcowFd1+/dYFIAshP8AGAAl+t8IwFd1+/dYH" +
  "yjAV3X791gjKMBXdfv3WCcowFd1+/dYKKHbdfv3WCyhv3W7+3Wb/biYAKSkp7Vs7wL/tUuvdbv7dZv8j" +
  "biYAKSkpe9b4ehc/H95/OEOvuz4BmuL3FO6A+jAVy3wgMj7AvT4AnOIJFe6A+jAV3XP/3Tb+AOXF3X79" +
  "zSMUweF7BgDdtv5feN22/1cmAMXNV0HBDMNcFN353eHJ3eXdIQAA3Tkh8/85+e1LIMAqIsBlaO1LO8C/" +
  "7ULddfzddP0RJMAhAAA56wEEAO2w3X703Xf43X713Xf53X781vjdfv0XPx/ef9o4Fq/dvvw+Ad2e/eKT" +
  "Fe6A8pkVwzgWOjDAtyAK3Tb+CN02/wEYLO1LKMAqKsB8tbCxKBc6OcDLTygFAQcBGAMBBgHdcf7dcP8Y" +
  "CN02/gXdNv8B3X783Xf63Tb7AN1++t13/N02/QDdfvzdd/vdNvoA3X7+3Xf/3Xf+3Tb/AN1+/t13/N02" +
  "/QDdfvrdtvzdd/7dfvvdtv3dd//dfvjdd/3dd/zdNv0A3V7+3Vb/3W783Wb9zVdB3fnd4ck6McC3yCos" +
  "wO1bLsB9xoBPfM4ARzABE+1DLMDtUy7Ar7k+B5g+AJs+AJribBbugPAhAAciLMBlIi7Ayd3l3SEAAN05" +
  "/SHs//05/fnddf7ddP/dc/zdcv3tSxbAaWBeI37dc+zdd+0Hn9137t137yEwwF57tygXaWAjI1Yjft1y" +
  "+N13+Qef3Xf63Xf7GBjF/eH9bgb9Zgfddfh83Xf5B5/dd/rdd/vdfvjdd/Ddfvndd/Hdfvrdd/Ldfvvd" +
  "d/N7tygNIQQACU4jRngHn18YCyEIAAlOI0Z4B59f3XH03XD13Xf23XP3ESjAIQwAOesBBADtsN3L/lYo" +
  "bt1++N2W8E/dfvndnvFH3X763Z7yX91++92e81ftQyjA7VMqwK/dluzdd/g+AN2e7d13+T4A3Z7u3Xf6" +
  "n92W7913+3ndlvh43Z75e92e+nrdnvvijBfugPKbFxEowCEMADkBBADtsCE3wDYBw4cY3cv+XihQ3X74" +
  "3YbwT91++d2O8UfdfvrdjvJf3X773Y7zV+1DKMDtUyrA3X7skd1+7Zjdfu6b3X7vmuLiF+6A8vEXESjA" +
  "IQAAOQEEAO2wITfANgDDhxjdbvbdZvfl3W703Wb15d1e+N1W+d1u+t1m+80AQvHxBgjLLMsdyxrLGxD2" +
  "3XP03XL13XX23XT3ESjAIQgAOQEEAO2wESjAIQwAOesBBADtsD6A3b70Pv/dnvU+/92e9j7/3Z734mIY" +
  "7oDyhxjdfvjWgN1++d4A3X763gDdfvsXPx/egDAJIQAAIijAIirA7VsgwCoiwAYIyyzLHcsayxsQ9nvG" +
  "/9139HrO/9139X3O/9139nzO/91393vGB913+HrOAN13+X3OAN13+nzOAN13+91+9wfmAd138d3L8UYg" +
  "Od1O9N1G9d1e9t1W991+8bcoGN1+9MYHT91+9c4AR91+9s4AX91+984AVz4DyyrLG8sYyxk9IPUYAwH/" +
  "AN1e+N1W+d3L+34oDN1++MYHX91++c4AV8s6yxvLOssbyzrLG91z8u1bJMAqJsAGCMssyx3LGssbEPbd" +
  "c/PdcvTddfXddPbdXvPdVvTdfvPGB913991+9M4A3Xf43X71zgDdd/ndfvbOAN13+t3L9n4oBt1e991W" +
  "+Ms6yxvLOssbyzrLG91z+91e991W+N3L+n4oDN1+88YOX91+9M4AV8s6yxvLOssbyzrLG91z+t3L8UbC" +
  "ThrF3W77ec34C8G3KDcqFMARBgAZfrcoFMXdbvt5zfgLwSoUwBEGABlekygYxd1u+3nNky3BtyAMxd1u" +
  "+3nN9irBtyhFxd1u+nnN+AvBtyg1KhTAEQYAGX63KBTF3W76ec34C8EqFMARBgAZXpMoFsXdbvp5zZMt" +
  "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" +
  "5cXdXvTdVvXdbvbdZvfNYg23KF7dTvjdRvndbvrdZvvdy/t+KBjdfvjGB0/dfvnOAEfdfvrOAG/dfvvO" +
  "AGdZUAYDyyzLHcsayxsQ9hwgBBQgASNlalMeAAYDyyLtahD6MzPV3XX23XT3IQAAIijAIirAESDAIQAA" +
  "OQEEAO2w3fnd4cnd5d0hAADdOSHj/zn57UskwO1bJsDVxREswCENADnrAQQA7bDB0XndhuxPeN2O7Ud7" +
  "3Y7uX3rdju/dcfzdcP3dc/7dd//dfvzdd/jdfv3dd/ndfv7dd/rdfv/dd/sGCN3L+y7dy/oe3cv5Ht3L" +
  "+B4Q7iENADnrIRUAOQEEAO2w7UsgwCoiwN1x9HjGAd139X3OAN139nzOAN13993L737CRiTdTvzdfv3G" +
  "CEfdfv7OAP3l3Xfh/eHdfv/OAP3l3Xfi/eHF/eX95cXdXvTdVvXdbvbdZvfNURD94cG3IBjtWyDAKiLA" +
  "esYEVzABI/3lxc1RELfKgijdfvDGCN139N1+8c4A3Xf13X7yzgDdd/bdfvPOAN139yEVADnrIREAOQEE" +
  "AO2w3cv3figg3X70xgfdd/jdfvXOAN13+d1+9s4A3Xf63X73zgDdd/vdfvjdd/Ldfvndd/Pdfvrdd/Td" +
  "fvvdd/UGA93L9S7dy/Qe3cvzHt3L8h4Q7v0qFMD9fga3yvEj3X7y3Xf77UsgwO1bIsA+CMsqyxvLGMsZ" +
  "PSD13XH33XD43XP53XL6y3ooGHnGB91393jOAN13+HvOAN13+XrOAN13+t1O991G+Ms4yxnLOMsZyzjL" +
  "Gd1u+3nN+Avdd/bdfvvdd/ftSyDA7VsiwD4IyyrLG8sYyxk9IPXdcfjdcPndc/rdcvvLeigYecYH3Xf4" +
  "eM4A3Xf5e84A3Xf6es4A3Xf73U743Ub5yzjLGcs4yxnLOMsZDN1u93nN+AtP/SoUwP1GBt1+9pAoB3mQ" +
  "KAOvGAI+AbcoR+1LJMAqJsDdcfh4xgjdd/l9zgDdd/p8zgDdd/vdVvLdbvPdZvQeAAYDyyLtahD6e92W" +
  "+Hrdnvl93Z76fN2e++LuI+6A+oIo3X7y3V7z3W703Wb1BgOHyxPtahD5xvhPe87/R33O/198zv/dcf3d" +
  "cP7dc//dNvwAIQAAIizAIi7AITDANgEhMcA2ACEywDYAITPANgAhOMA2AMOCKN1u/t1m/+XdbvzdZv3l" +
  "3V703Vb13W723Wb3zWINtyAj7VsgwCoiwHrGBFcwASPdTv7dRv/F3U783Ub9xc1iDbfKgijdbvDdZvHd" +
  "XvLdVvPdy/N+KBjdfvDGB2/dfvHOAGfdfvLOAF/dfvPOAFcGA8sqyxvLHMsdEPZ9xgHdd+N8zgDdd+R7" +
  "zgDdd+V6zgDdd+Y6lsG3wj4oKhTAEQ0AGX63yj4o7UsgwO1bIsA+CMsqyxvLGMsZPSD13XH83XD93XP+" +
  "3XL/y3ooGHnGB913/HjOAN13/XvOAN13/nrOAN13/91u/N1m/cs8yx3LPMsdyzzLHWV5xgbdd/R4zgDd" +
  "d/V7zgDdd/Z6zgDdd/fdfvTdd/zdfvXdd/3dfvbdd/7dfvfdd//dy/d+KBh5xg3dd/x4zgDdd/17zgDd" +
  "d/56zgDdd//dTvzdRv3LOMsZyzjLGcs4yxndfuM9R8VofM34C8Hdd/9oec34C0/9KhTA/eXRIQ0AGV7d" +
  "fv+TKBH9Rg7dfv+QKAh5uygEkMI+KDqVwdYBPgAXMpXBzRkuKhTA3XX+3XT/OpXBtygN3U7+3Ub/IQ0A" +
  "CU4YC91u/t1m/xEOABlOQXm3KAVIBgAYAwEAAB4AIZTBe5YwOmsmACn9IYPBxU1E/QnB/eXhI24mACkp" +
  "KSkpfVT9bgD1feYfb/EmAIVveozLJY/2eGfFz8FpYN8cGL/tSyDA7VsiwD4IyyrLG8sYyxk9IPXdfvjd" +
  "d+fdfvndd+jdfvrdd+ndfvvdd+rdfvjGCN13691++c4A3Xfs3X76zgDdd+3dfvvOAN137nnGBt1373jO" +
  "AN138HvOAN138XrOAN138t02/wAhk8Hdfv+W0jko1d1e/xYAa2IpGdH9IfPAxU1E/QnB/X4A3Xf7r913" +
  "/N13/d13/vXdfvvdd/Pdfvzdd/Tdfv3dd/Xdfv7dd/bxPgPdy/Mm3cv0Ft3L9Rbdy/YWPSDt/eXhI37d" +
  "d/uv3Xf83Xf93Xf+9d1++913991+/N13+N1+/d13+d1+/t13+vE+A93L9ybdy/gW3cv5Ft3L+hY9IO39" +
  "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" +
  "f88OvjrUwodHIVTC7aMg/Mk+0NO+yU1Er2+wBhAgBAYIeSnLERcwARkQ9+vJTwYAKhLCCcMYAOvtSxLC" +
  "GrfIJgBvCd8TGPXpycv0z+vRwdULBAx4QQ6+7aMg/D3C90HJ3eXdIQAA3Tn19fXdc/zdcv3ddf7ddP9N" +
  "RN1eBN1WBWlgzbZB3XP+3XL/S0Ldfgbdd/rdfgfdd/vh0dXlxd1u+t1m+822QevBCevdc/7dcv9LQt1e" +
  "/d1mBcUuAFUGCCkwARkQ+sEJ691z/t1y/91eBN1m/S4AVQYIKTABGRD6TUTdXvzdZgXFLgBVBggpMAEZ" +
  "EPrB691zBd1yBmtiCevdcwXdcgZ7kXqYPgAX3XcH3V783WYELgBVBggpMAEZEPrr3XP83XL93TYEAN1+" +
  "/N2GBF/dfv3djgVX3X7+3Y4Gb91+/92OB2fd+d3hyQQgCAgBAQUAeLEoCBHVwiHrQu2wyQAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//9E5ZmZAEw=";
