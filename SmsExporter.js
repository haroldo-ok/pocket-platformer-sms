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
    if (sprites['RED_BLUE_BLOCK_SWITCH']) {
      specialTilePixels.set(-6, sprites['RED_BLUE_BLOCK_SWITCH'].animation[0].sprite); // switch red frame
      if (sprites['RED_BLUE_BLOCK_SWITCH'].animation[1])
        specialTilePixels.set(-7, sprites['RED_BLUE_BLOCK_SWITCH'].animation[1].sprite); // switch blue frame
    }

    // Encode each unique tile.

    // Add red/blue block tiles if any level uses them (levelObjects contain redBlock/blueBlock/redBlueSwitch)
    const hasRedBlue = levels.some(l => l.levelObjects && l.levelObjects.some(
        o => ['redBlock','blueBlock','redBlueSwitch','redblueblockswitch','violetBlock','pinkBlock'].includes(o.type)));
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
        // Check block/switch positions FIRST — their tileData may be 0
        // (blue blocks start inactive = tileData 0), which would otherwise
        // be swallowed by the tileVal===0 branch before we can check them.
        if (redBlockPos.has(`${x},${y}`)) {
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
    // Peak jump velocity = jumpSpeed * maxJumpFrames (pocket-platformer's ramp formula)
    const jumpPeak = (playerObj.jumpSpeed || 0.44) * (playerObj.maxJumpFrames || 18);
    writeInt16(toFP(jumpPeak));
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
    const header = new Uint8Array(19);
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDBzoh" +
  "AMB+BgBwEQHAAc8C7bAyBMLNszzNXTj7zRgydhj9ZGV2a2l0U01TAAAAw0Y67aPto+2j7aPto+2j7aPt" +
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
  "FgAYAxEAAOvfBHjWIDjaDHnWGDjCyUdNIf//NgJoJgApfPZ4Z8XPwQYAKtbBI154kzAJxWh5zfgLwRgB" +
  "r1+3KAQWABgDEQAA698EeNYYONrJT9YCKA95/gMoDv4EKA7WBSgOGBARAQHJEQIByREDAckRBAHJEQEB" +
  "yd3l3SEAAN059Tsh//82Ag4AKtbBIyNGeZDSEhUGAGlgKQlFVHgh2sGGI196jlfdc/7dcv8TExrdd/09" +
  "yg4V3X791gUgCyE6wAYACX63wg4V3X791gfKDhXdfv3WCMoOFd1+/dYJyg4V3X791goodt1+/dYLKG/d" +
  "bv7dZv9uJgApKSntWzbAv+1S691u/t1m/yNuJgApKSl71vh6Fz8f3n84Q6+7PgGa4tUU7oD6DhXLfCAy" +
  "PsC9PgCc4ucU7oD6DhXdc//dNv4A5cXdfv3NARTB4XsGAN22/l943bb/VyYAxc0aO8EMwzoU3fnd4cnd" +
  "5d0hAADdOSHz/zn57UsgwCoiwGVo7Us2wL/tQt11/N10/REkwCEAADnrAQQA7bDdfvTdd/jdfvXdd/nd" +
  "fvzW+N1+/Rc/H95/2hYWr92+/D4B3Z794nEV7oDydxXDFhY6MMC3IArdNv4I3Tb/ARgs7UsowCoqwHy1" +
  "sLEoFzo0wMtPKAUBBwEYAwEGAd1x/t1w/xgI3Tb+Bd02/wHdfvzdd/rdNvsA3X763Xf83Tb9AN1+/N13" +
  "+902+gDdfv7dd//dd/7dNv8A3X7+3Xf83Tb9AN1++t22/N13/t1++922/d13/91++N13/d13/N02/QDd" +
  "Xv7dVv/dbvzdZv3NGjvd+d3hyTowwLfAKizA7VsuwH3GgE98zgBHMAET7UMswO1TLsCvuT4HmD4Amz4A" +
  "muJKFu6A8CEAByIswGUiLsDJ3eXdIQAA3Tn9IfH//Tn9+d11/t10/91z/N1y/SoWwOPh5U4jft1x8913" +
  "9Aef3Xf13Xf2OjDA3Xf3tygN4eUjI04jfkcHn18YHd1+8d13+t1+8t13+91u+t1m+xEGABlOI0Z4B59f" +
  "V9XFESjAIQsAOesBBADtsMHR3cv+Vihm3X74kU/dfvmYR91++ptf3X77mlftQyjA7VMqwK/dlvPdd/g+" +
  "AN2e9N13+T4A3Z713Xf6n92W9t13+3ndlvh43Z75e92e+nrdnvviIxfugPIyFxEowCEHADkBBADtsCEy" +
  "wDYBwxwY3cv+XihI3X74gU/dfvmIR91++otf3X77ilftQyjA7VMqwN1+85HdfvSY3X71m91+9pricRfu" +
  "gPKAFxEowCECADkBBADtsCEywDYAwxwY3X73tygPwcUhBAAJTiN+RwefXxgNwcUhCAAJTiNGeAefX1fV" +
  "xd1e+N1W+d1u+t1m+83DO/HxTUQ+CMsoyxnLGssbPSD17VMowO1DKsDVxREowCELADnrAQQA7bDB0T7N" +
  "uz7/mj7/mT7/mOL3F+6A8hwY3X741jPdfvneAN1++t4A3X77Fz8f3oAwCSEAACIowCIqwAExwN3L/GbK" +
  "2xg6MMDdd/sqFsB9xgpffM4AV91++7coR+teI35XB+1ir5Pdd/g+AJrdd/k+AJ3dd/qflN13+8URLMAh" +
  "CQA5AQQA7bDBKhbAEQwAGX4CITDANgA67MC3KF7FzUglwRhXxQEPAAnBfrcoTTozwLcgR+teI35XB+1i" +
  "r5Pdd/g+AJrdd/k+AJ3dd/qflN13+8URLMAhCQA5AQQA7bDBKhbAEQwAGX7LPwIhM8A2ATrswLcoBcXN" +
  "SCXBCrcoOt3L/mYoMu1bLMAqLsB7xvbdd/h6zv/dd/l9zv/dd/p8zv/dd/vFESzAIQkAOQEEAO2wwQo9" +
  "AhgCrwLd+d3hyd3l3SEAAN05IfT/OfkRIMAhAAA56wEEAO2wESjAIQgAOesBBADtsN1+9N2G/N13+N1+" +
  "9d2O/d13+d1+9t2O/t13+t1+992O/913+yEAADnrIQQAOQEEAO2w3X703Xf43X713Xf53X723Xf63X73" +
  "3Xf7Bgjdy/su3cv6Ht3L+R7dy/geEO6v3b783Z79PgDdnv4+AN2e/+K5Ge6A8roa3X703Xf83X71xgbd" +
  "d/3dfvbOAN13/t1+984A3Xf/7UskwComwHjGAUcwASPlxd1e/N1W/d1u/t1m/81iDbcgI+1LJMAqJsB4" +
  "xgZHMAEj5cXdXvzdVv3dbv7dZv/NYg23ymMb3X74xgbdd/zdfvnOAN13/d1++s4A3Xf+3X77zgDdd/8h" +
  "BAA56yEIADkBBADtsN3L/34oIN1+/MYH3Xf43X79zgDdd/ndfv7OAN13+t1+/84A3Xf73W743Wb53V76" +
  "3Vb7BgPLKssbyxzLHRD2BgMpyxPLEhD5Afn/CU1Ee87/X3rO/91x9d1w9t1z99029AAhAAAiKMAiKsDD" +
  "Yxvdy/9+ymMb7UskwComwHjGAUcwASPlxd1e9N1W9d1u9t1m981iDbcgIu1LJMAqJsB4xgZHMAEj5cXd" +
  "XvTdVvXdbvbdZvfNYg23KF7dTvjdRvndbvrdZvvdy/t+KBjdfvjGB0/dfvnOAEfdfvrOAG/dfvvOAGdZ" +
  "UAYDyyzLHcsayxsQ9hwgBBQgASNlalMeAAYDyyLtahD6MzPV3XX23XT3IQAAIijAIirAESDAIQAAOQEE" +
  "AO2w3fnd4cnd5d0hAADdOSHj/zn57UskwO1bJsDVxREswCENADnrAQQA7bDB0XndhuxPeN2O7Ud73Y7u" +
  "X3rdju/dcfzdcP3dc/7dd//dfvzdd/jdfv3dd/ndfv7dd/rdfv/dd/sGCN3L+y7dy/oe3cv5Ht3L+B4Q" +
  "7iENADnrIRUAOQEEAO2w7UsgwCoiwN1x9HjGAd139X3OAN139nzOAN13993L737CVh7dTvzdfv3GCEfd" +
  "fv7OAP3l3Xfh/eHdfv/OAP3l3Xfi/eHF/eX95cXdXvTdVvXdbvbdZvfNURD94cG3IBjtWyDAKiLAesYE" +
  "VzABI/3lxc1RELfKgiLdfvDGCN139N1+8c4A3Xf13X7yzgDdd/bdfvPOAN139yEVADnrIREAOQEEAO2w" +
  "3cv3figg3X70xgfdd/jdfvXOAN13+d1+9s4A3Xf63X73zgDdd/vdfvjdd/Ldfvndd/Pdfvrdd/Tdfvvd" +
  "d/UGA93L9S7dy/Qe3cvzHt3L8h4Q7v0qFMD9fga3yhAe3X7y3Xf7KiDA7VsiwAYIyyrLG8scyx0Q9t11" +
  "9910+N1z+d1y+st6KBh9xgfdd/d8zgDdd/h7zgDdd/l6zgDdd/rdTvfdRvjLOMsZyzjLGcs4yxndbvt5" +
  "zfgL3Xf23X773Xf37UsgwO1bIsA+CMsqyxvLGMsZPSD13XH43XD53XP63XL7y3ooGHnGB913+HjOAN13" +
  "+XvOAN13+nrOAN13+91O+N1G+cs4yxnLOMsZyzjLGQzdbvd5zfgLT/0qFMD9RgbdfvaQKAd5kCgDrxgC" +
  "PgG3KEftSyTAKibA3XH4eMYI3Xf5fc4A3Xf6fM4A3Xf73Vby3W7z3Wb0HgAGA8si7WoQ+nvdlvh63Z75" +
  "fd2e+nzdnvviDR7ugPqCIt1+8t1e891u9N1m9QYDh8sT7WoQ+cb4T3vO/0d9zv9ffM7/3XH93XD+3XP/" +
  "3Tb8ACEAACIswCIuwCEwwDYBITPANgDDgiLdbv7dZv/l3W783Wb95d1e9N1W9d1u9t1m981iDbcgI+1b" +
  "IMAqIsB6xgRXMAEj3U7+3Ub/xd1O/N1G/cXNYg23yoIi3W7w3Wbx3V7y3Vbz3cvzfigY3X7wxgdv3X7x" +
  "zgBn3X7yzgBf3X7zzgBXBgPLKssbyxzLHRD2fcYB3XfjfM4A3Xfke84A3Xfles4A3XfmOpHBt8JOIioU" +
  "wBENABl+t8pOIu1LIMDtWyLAPgjLKssbyxjLGT0g9d1x/N1w/d1z/t1y/8t6KBh5xgfdd/x4zgDdd/17" +
  "zgDdd/56zgDdd//dbvzdZv3LPMsdyzzLHcs8yx1lecYG3Xf0eM4A3Xf1e84A3Xf2es4A3Xf33X703Xf8" +
  "3X713Xf93X723Xf+3X733Xf/3cv3figYecYN3Xf8eM4A3Xf9e84A3Xf+es4A3Xf/3U783Ub9yzjLGcs4" +
  "yxnLOMsZ3X7jPUfFaHzN+AvB3Xf/aHnN+AtP/SoUwP3l0SENABle3X7/kygR/UYO3X7/kCgIebsoBJDC" +
  "TiI6kMHWAT4AFzKQwc0ZKCoUwN11/t10/zqQwbcoDd1O/t1G/yENAAlOGAvdbv7dZv8RDgAZTkF5tygF" +
  "SAYAGAMBAAAeACGPwXuWMDprJgAp/SF+wcVNRP0Jwf3l4SNuJgApKSkpKX1U/W4A9X3mH2/xJgCFb3qM" +
  "yyWP9nhnxc/BaWDfHBi/7UsgwO1bIsA+CMsqyxvLGMsZPSD13X743Xfn3X753Xfo3X763Xfp3X773Xfq" +
  "3X74xgjdd+vdfvnOAN137N1++s4A3Xft3X77zgDdd+55xgbdd+94zgDdd/B7zgDdd/F6zgDdd/LdNv8A" +
  "IY7B3X7/ltJJItXdXv8WAGtiKRnR/SHuwMVNRP0Jwf1+AN13+6/dd/zdd/3dd/713X773Xfz3X783Xf0" +
  "3X793Xf13X7+3Xf28T4D3cvzJt3L9Bbdy/UW3cv2Fj0g7f3l4SN+3Xf7r913/N13/d13/vXdfvvdd/fd" +
  "fvzdd/jdfv3dd/ndfv7dd/rxPgPdy/cm3cv4Ft3L+Rbdy/oWPSDt/X4CtygFOpDBGAg6kMHWAT4AF7fK" +
  "QyLdfvPdlu/dfvTdnvDdfvXdnvHdfvbdnvLioyHugPJDIt1+88YI3Xf73X70zgDdd/zdfvXOAN13/d1+" +
  "9s4A3Xf+ed2W+3jdnvx73Z79et2e/uLbIe6A8kMi3X733Zbr3X743Z7s3X753Z7t3X763Z7u4vsh7oDy" +
  "QyLdfvfGCN13+91++M4A3Xf83X75zgDdd/3dfvrOAN13/t1+592W+91+6N2e/N1+6d2e/d1+6t2e/uI7" +
  "Iu6A8kMiIVvANgHdNP/D0CAhkcE2Ad1+4913/d1+5N13/t1+5d13/902/AAGA93L/Sbdy/4W3cv/FhDy" +
  "IQAAIizAIi7AITHANgARJMAhGQA5AQQA7bDd+d3hyd3l3SEAAN05IeX/OfntWyDAKiLABgjLLMsdyxrL" +
  "GxD2MzPV3XXn3XTo7VskwComwAYIyyzLHcsayxsQ9t1z6d1y6t1169107CH//zYC3X7pxgjdd+3dfurO" +
  "AN137t1+684A3Xfv3X7szgDdd/DdfuXGBt138d1+5s4A3Xfy3X7nzgDdd/PdfujOAN139N02/wAq1sEj" +
  "I91+/5bS8STdTv8GAGlgKQnddfvddPzdfvsh2sGG3Xf93X78I47dd/7dfv3dd/Xdfv7dd/bdbvXdZvZ+" +
  "3Xf+3Xf7r913/N13/d13/t1++913991+/N13+N1+/d13+d1+/t13+gYD3cv3Jt3L+Bbdy/kW3cv6FhDu" +
  "3X713Xf93X723Xf+3W793Wb+I37dd/7dd/uv3Xf83Xf93Xf+BgPdy/sm3cv8Ft3L/Rbdy/4WEO7dfvfd" +
  "lvHdfvjdnvLdfvndnvPdfvrdnvTi9SPugPLrJN1+98YIT91++M4AR91++c4AX91++s4AV91+5ZHdfuaY" +
  "3X7nm91+6JriJSTugPLrJN1++92W7d1+/N2e7t1+/d2e791+/t2e8OJFJO6A8usk3X77xghP3X78zgBH" +
  "3X79zgBf3X7+zgBX3X7pkd1+6pjdfuub3X7smuJ1JO6A8usk3U713Ub2AwMK/gIoDv4DKBH+BCgU1gUo" +
  "SRhYIVrANgEYUSFbwDYBGEoqFsARCwAZfituZwefX1fFAYABCcEwAROvlU8+AJxHIQAA7VLr7UMswO1T" +
  "LsABMcCvAiEwwDYAGBE+Ot2G/28+wM4AZ363IAI2Ad00/8MkI9353eHJ3eXdIQAA3Tn13Xf/3XX+DgAh" +
  "7MB5ljA0EVzABgBpYCkJGesaR91+/5AgHmtiI91+/pYgFRMTGrcoCjrtwNYBPgAXGAk67cAYBAwYxa/d" +
  "+d3hyd3l3SEAAN05Iev/Ofk67cDWAT4AFzLtwN02/wAh7MDdfv+W0o4n3U7/BgBpYCkJ3XX93XT+Plzd" +
  "hv3dd/s+wN2O/t13/N1u+91m/H7dd/3dfvvdd/ndfvzdd/rdbvndZvojft13/t1u+91m/CMjTnm3KAU6" +
  "7cAYCDrtwNYBPgAX3Xf6KhTA3XX73XT8ebcoId1++rcoDd1O+91G/CEPAAlGGAvdTvvdRvwhEAAJRngY" +
  "Ht1++rcoDd1O+91G/CERAAl+GAvdbvvdZvwREgAZfrcoBAYAGAKvR19Q3W7+JgApKSkpKd1+/eYfTwYA" +
  "CSl89nhnz+vf3X76t8qIJ+1bIMAqIsAGCMssyx3LGssbEPYzM9Xdde3ddO7tWyTAKibABgjLLMsdyxrL" +
  "GxD23XPv3XLw3XXx3XTy3W79r2dPBgMpj8sREPrddfPddPTdd/Xdcfbdbv6vZ08GAymPyxEQ+t119910" +
  "+N13+d1x+t1+68YGT91+7M4AR91+7c4AX91+7s4AV91+85HdfvSY3X71m91+9pri4CbugPKIJ91+88YI" +
  "3Xf73X70zgDdd/zdfvXOAN13/d1+9s4A3Xf+3X7r3Zb73X7s3Z783X7t3Z793X7u3Z7+4iAn7oDyiCfd" +
  "fu/GCE/dfvDOAEfdfvHOAF/dfvLOAFfdfveR3X74mN1++Zvdfvqa4lAn7oDyiCfdfvfGCE/dfvjOAEfd" +
  "fvnOAF/dfvrOAFfdfu+R3X7wmN1+8ZvdfvKa4oAn7oDyiCchW8A2Ad00/8NkJd353eHJ3eXdIQAA3Tn1" +
  "3Xf/3XX+DgAhjsF5ljA0Ee7ABgBpYCkJGesaR91+/5AgHmtiI91+/pYgFRMTGrcoCjqQwdYBPgAXGAk6" +
  "kMEYBAwYxa/d+d3hye1bFMC3KBJ9tygHIQkAGX4YFyEKABl+GBB9tygHIQsAGX4YBSEMABl+tygEFgBf" +
  "yREAAMnd5d0hAADdOfXdNv8AIY7B3X7/ljBR3U7/BgBpYCkJ6yHuwBnrGk9rYiN+3Xf+ExMaR7coBTqQ" +
  "wRgIOpDB1gE+ABdvxXjN5SfB3W7+JgApKSkpKXnmHwYATwkpfPZ4Z8/r3900/xim3fnd4ck6kcG3yO1L" +
  "LMAqLsCvuZg+AJ0+AJzinyjugPAhkcE2AMnd5d0hAADdOSHv/zn57VsgwCoiwAYIyyzLHcsayxsQ9jMz" +
  "1d118d108iokwO1bJsAGCMsqyxvLHMsdEPbBxf3l491u8ePj3Wby4/3h3cvyfigk3X7vxgdP3X7wzgBH" +
  "3X7xzgD95d137f3h3X7yzgD95d137v3hyzjLGcs4yxnLOMsZ3XH93X7vxgXdd/PdfvDOAN139N1+8c4A" +
  "3Xf13X7yzgDdd/bdTvPdRvT95ePdbvXj491m9uP94d3L9n4oJN1+88YHT91+9M4AR91+9c4A/eXdd+39" +
  "4d1+9s4A/eXdd+794cs4yxnLOMsZyzjLGd1x/tX94U1Ey3ooHH3GB098zgBHe84A/eXdd+394XrOAP3l" +
  "3Xfu/eHLOMsZyzjLGcs4yxndcf/FAQgACcEwARPV/eFNRMt6KBoBBwAJTUR7zgD95d137f3hes4A/eXd" +
  "d+794cs4yxnLOMsZyzjLGd1+/d13991x+N1+/t13+d1x+t1+/d13+91+/913/N02/wDdbv8mAClNRCEI" +
  "ADkJTiNexdVrec34C9HB3Xf+/SoUwP3l4cUBBwAJwUZ4tygNeN2W/iAHa3nNYgwYGf3l4cUBCAAJwW59" +
  "tygL3X7+lSAFa3nNswzdNP/dfv/WAzii3fnd4cnd5d0hAADdOSHo/zn5zaYo3Tb/AN1u/yYAKSkRlsEZ" +
  "491+6MYC3Xfq3X7pzgDdd+vdburdZut+3Xf+t8oOLd1e/hzB4eXFc+HlRuHlI0545h/dcezdburdZutu" +
  "FgDdd+3dcu571iggHGkmACkpKSkp3V7t3VbuGSl89nhnzyEAAN/DDi191sjaDi1or2dfBgMpj8sTEPrd" +
  "de/ddPDdd/Hdc/Jpr2dPBgMpj8sREPrddfPddPTdd/XdcfbtWyDAKiLABgjLLMsdyxrLGxD23XP33XL4" +
  "3XX53XT67VskwComwAYIyyzLHcsayxsQ9t1z+91y/N11/d10/t1+98YGT91++M4AR91++c4AX91++s4A" +
  "V91+75HdfvCY3X7xm91+8pririvugPJJLN1+78YIT91+8M4AR91+8c4AX91+8s4AV91+95HdfviY3X75" +
  "m91++pri3ivugPJJLN1++8YIT91+/M4AR91+/c4AX91+/s4AV3ndlvN43Z70e92e9XrdnvbiDizugPpJ" +
  "LN1+88YC3Xf73X70zgDdd/zdfvXOAN13/d1+9s4A3Xf+3X77kd1+/Jjdfv2b3X7+muJGLO6A8k8s3Tb+" +
  "ABgE3Tb+Ad1+/rfCDi3h5SMjI04qFMDddf3ddP55tygQ3W793Wb+EQgAGX7dd/4YDt1e/d1W/iEHABl+" +
  "3Xf+3U7+3X7+tygJr91x/d13/hgHr913/d13/t1+/d13+91+/t13/N1+7N13/d02/gAGBd3L/Sbdy/4W" +
  "EPbdfv3dhu3dd/ndfv7dju7dd/rdfvndd/3dfvrdd/7dy/0m3cv+Ft1+/d13+d1+/vZ43Xf63W753Wb6" +
  "z91u+91m/N/B4eXFNgDdNP/dfv/WENqdKt353eHJIQAAIjbALgDDxzghNcB+tygDPXfJNgUBNMAKPOYD" +
  "Asnd5d0hAADdOSH3/zn5TyH//zYCec03C+1T1sHtS9bBIQQACSLYwSrWwU4jBgBeFgBpYM15OyrYwRki" +
  "2sEOACE6wAYACTYADHnWIDjyAZbBHgBrJgApKQkjIzYAHHvWEDjwIY7BNgAhj8E2ACGQwTYBIZHBNgAh" +
  "7MA2ACHtwDYAIf//NgLdNv8AKtbBIyNO3X7/kdJkL91O/wYAaWApCesq2sEZ491+98YC3Xf93X74zgDd" +
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
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//8or5mZAEw=";
