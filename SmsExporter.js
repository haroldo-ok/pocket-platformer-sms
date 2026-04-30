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
    spikeS     ? encodeSprite8(spikeS,     0) : encodeBlank();
    trampS     ? encodeSprite8(trampS,     0) : encodeBlank();
    coinS      ? encodeSprite8(coinS,      0) : encodeBlank();
    pIdle      ? encodeSprite8(pIdle,      0) : encodeBlank();
    pWalk      ? encodeSprite8(pWalk,      0) : encodeBlank();
    pWalk      ? encodeSprite8(pWalk,      1) : encodeBlank();
    pJump      ? encodeSprite8(pJump,      0) : encodeBlank();
    flagClosed ? encodeSprite8(flagClosed, 0) : encodeBlank(); /* tile 265 */

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
        let typeId = OBJECT_TYPE_MAP[obj.type];
        if (typeId === undefined) continue;
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDwUIh" +
  "AMB+BgBwEQHAATgD7bAybcLNd0bNF0H7zdI6dhj9ZGV2a2l0U01TAAAAwwBD7aPto+2j7aPto+2j7aPt" +
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
  "3XP07VskwComwD4IyyzLHcsayxs9IPXdc/XdcvbddffddPjdXvXdVvbdfvXGB913+d1+9s4A3Xf63X73" +
  "zgDdd/vdfvjOAN13/N3L+H4oBt1e+d1W+ss6yxvLOssbyzrLG91z/d1e+d1W+t3L/H4oDN1+9cYOX91+" +
  "9s4AV8s6yxvLOssbyzrLG91z/N3L8kbCaBvF3W793X7zzfgLwbcoPSoUwBEGABl+tygWxd1u/d1+8834" +
  "C8EqFMARBgAZXpMoHMXdbv3dfvPNEDDBtyAOxd1u/d1+881zLcG3KE7F3W783X7zzfgLwbcoPSoUwBEG" +
  "ABl+tygWxd1u/N1+8834C8EqFMARBgAZXpMoHMXdbvzdfvPNEDDBtyAOxd1u/N1+881zLcG3KAOvGAI+" +
  "Ad13+8Xdbv3dfvTN+AvBtyg9KhTAEQYAGX63KBbF3W793X70zfgLwSoUwBEGABlekygcxd1u/d1+9M0Q" +
  "MMG3IA7F3W793X70zXMtwbcoTsXdbvzdfvTN+AvBtyg9KhTAEQYAGX63KBbF3W783X70zfgLwSoUwBEG" +
  "ABlekygcxd1u/N1+9M0QMMG3IA7F3W783X70zXMtwbcoA68YAj4B3Xf6y2HK5xwhMMBOebcoJiEywDYB" +
  "ITPANgAhNsA2ACExwDYAITDANgA6VcG3yucczcUtw+ccKhbA3XX83XT9ERAAGX63KF55tyBa3X77tyAG" +
  "3X76tyhOITLANgAhM8A2ASE2wDYAITHANgAhOMA2AN1++7coCt02/AHdNv0AGAjdNvz/3Tb9AN1+/N13" +
  "/SE0wN1+/XchNcA2ADpVwbcoPM3FLRg33W783Wb9EQ8AGX7dd/23KCY6OMDdd/23IB0hMsA2ASEzwDYA" +
  "ITbANgAhOMA2ATpVwbcoA83FLSEywE7dfv7mEN13+N02+QB5t8oOHhE7wCEGADnrAQQA7bCv3b703Z71" +
  "PgDdnvY+AN2e9+IfHe6AB+YB3Xf93X753bb4IAfdfv23yusdKhbA3XX63XT73X79tyAz3X763Xf83X77" +
  "3Xf93W783Wb9EQoAGX7dd/wjft13/d1+/N139N1+/d139Qef3Xf23Xf33U703Ub1/eXj3W724+PdZvfj" +
  "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" +
  "3X753Xfz3X763Xf03X773Xf1BgPdy/Uu3cv0Ht3L8x7dy/IeEO79KhTA/X4Gt8pmJd1+8t13++1LIMDt" +
  "WyLAPgjLKssbyxjLGT0g9d1x991w+N1z+d1y+st6KBh5xgfdd/d4zgDdd/h7zgDdd/l6zgDdd/rdTvfd" +
  "RvjLOMsZyzjLGcs4yxndbvt5zfgL3Xf23X773Xf37UsgwO1bIsA+CMsqyxvLGMsZPSD13XH43XD53XP6" +
  "3XL7y3ooGHnGB913+HjOAN13+XvOAN13+nrOAN13+91O+N1G+cs4yxnLOMsZyzjLGQzdbvd5zfgLT/0q" +
  "FMD9RgbdfvaQKAd5kCgDrxgCPgG3KEftSyTAKibA3XH4eMYI3Xf5fc4A3Xf6fM4A3Xf73Vby3W7z3Wb0" +
  "HgAGA8si7WoQ+nvdlvh63Z75fd2e+nzdnvviYyXugPr3Kd1+8t1e891u9N1m9QYDh8sT7WoQ+cb4T3vO" +
  "/0d9zv9ffM7/3XH93XD+3XP/3Tb8ACEAACIswCIuwCEwwDYBITHANgAhMsA2ACEzwDYAITjANgDD9ynd" +
  "bv7dZv/l3W783Wb95d1e9N1W9d1u9t1m981iDbcgI+1bIMAqIsB6xgRXMAEj3U7+3Ub/xd1O/N1G/cXN" +
  "Yg23yvcp3W7w3Wbx3V7y3Vbz3cvzfigY3X7wxgdv3X7xzgBn3X7yzgBf3X7zzgBXBgPLKssbyxzLHRD2" +
  "fcYB3XfjfM4A3Xfke84A3Xfles4A3XfmOvrBt8KzKSoUwBENABl+t8qzKe1LIMDtWyLAPgjLKssbyxjL" +
  "GT0g9d1x/N1w/d1z/t1y/8t6KBh5xgfdd/x4zgDdd/17zgDdd/56zgDdd//dbvzdZv3LPMsdyzzLHcs8" +
  "yx1lecYG3Xf0eM4A3Xf1e84A3Xf2es4A3Xf33X703Xf83X713Xf93X723Xf+3X733Xf/3cv3figYecYN" +
  "3Xf8eM4A3Xf9e84A3Xf+es4A3Xf/3U783Ub9yzjLGcs4yxnLOMsZ3X7jPUfFaHzN+AvB3Xf/aHnN+AtP" +
  "/SoUwP3l0SENABle3X7/kygR/UYO3X7/kCgIebsoBJDCsyk6+cHWAT4AFzL5wc2WMCoUwN11/t10/zr5" +
  "wbcoDd1O/t1G/yENAAlOGAvdbv7dZv8RDgAZTkF5tygFSAYAGAMBAAAeACH4wXuWMDprJgAp/SHnwcVN" +
  "RP0Jwf3l4SNuJgApKSkpKX1U/W4A9X3mH2/xJgCFb3qMyyWP9nhnxc/BaWDfHBi/7UsgwO1bIsA+CMsq" +
  "yxvLGMsZPSD13X743Xfn3X753Xfo3X763Xfp3X773Xfq3X74xgjdd+vdfvnOAN137N1++s4A3Xft3X77" +
  "zgDdd+55xgbdd+94zgDdd/B7zgDdd/F6zgDdd/LdNv8AIffB3X7/ltKuKdXdXv8WAGtiKRnR/SFXwcVN" +
  "RP0Jwf1+AN13+6/dd/zdd/3dd/713X773Xfz3X783Xf03X793Xf13X7+3Xf28T4D3cvzJt3L9Bbdy/UW" +
  "3cv2Fj0g7f3l4SN+3Xf7r913/N13/d13/vXdfvvdd/fdfvzdd/jdfv3dd/ndfv7dd/rxPgPdy/cm3cv4" +
  "Ft3L+Rbdy/oWPSDt/X4CtygFOvnBGAg6+cHWAT4AF7fKqCndfvPdlu/dfvTdnvDdfvXdnvHdfvbdnvLi" +
  "CCnugPKoKd1+88YI3Xf73X70zgDdd/zdfvXOAN13/d1+9s4A3Xf+ed2W+3jdnvx73Z79et2e/uJAKe6A" +
  "8qgp3X733Zbr3X743Z7s3X753Z7t3X763Z7u4mAp7oDyqCndfvfGCN13+91++M4A3Xf83X75zgDdd/3d" +
  "fvrOAN13/t1+592W+91+6N2e/N1+6d2e/d1+6t2e/uKgKe6A8qgpIcTANgHdNP/DNSgh+sE2Ad1+4913" +
  "/d1+5N13/t1+5d13/902/AAGA93L/Sbdy/4W3cv/FhDyIQAAIizAIi7AITLANgAhM8A2ACoWwBEMABl+" +
  "MjbAESTAIRkAOQEEAO2w3fnd4cnd5d0hAADdOSHi/zn57VsgwCoiwAYIyyzLHcsayxsQ9jMz1d115N10" +
  "5e1bJMAqJsAGCMssyx3LGssbEPbdc+bdcufddejddOkqP8IjI37+gDAJ3Xf+3Tb/ABgI3Tb+gN02/wDd" +
  "Tv4h//82At1+5sYI3Xfq3X7nzgDdd+vdfujOAN137N1+6c4A3Xft3X7ixgbdd+7dfuPOAN13791+5M4A" +
  "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" +
  "CMssyx3LGssbEPYzM9XddfHddPIqJMDtWybABgjLKssbyxzLHRD2wcX95ePdbvHj491m8uP94d3L8n4o" +
  "JN1+78YHT91+8M4AR91+8c4A/eXdd+394d1+8s4A/eXdd+794cs4yxnLOMsZyzjLGd1x/d1+78YF3Xfz" +
  "3X7wzgDdd/TdfvHOAN139d1+8s4A3Xf23U7z3Ub0/eXj3W714+PdZvbj/eHdy/Z+KCTdfvPGB0/dfvTO" +
  "AEfdfvXOAP3l3Xft/eHdfvbOAP3l3Xfu/eHLOMsZyzjLGcs4yxndcf7V/eFNRMt6KBx9xgdPfM4AR3vO" +
  "AP3l3Xft/eF6zgD95d137v3hyzjLGcs4yxnLOMsZ3XH/xQEIAAnBMAET1f3hTUTLeigaAQcACU1Ee84A" +
  "/eXdd+394XrOAP3l3Xfu/eHLOMsZyzjLGcs4yxndfv3dd/fdcfjdfv7dd/ndcfrdfv3dd/vdfv/dd/zd" +
  "Nv8A3W7/JgApTUQhCAA5CU4jXsXVa3nN+AvRwd13/v0qFMD95eHFAQcACcFGeLcoDXjdlv4gB2t5zWIM" +
  "GBn95eHFAQgACcFufbcoC91+/pUgBWt5zbMM3TT/3X7/1gM4ot353eHJ3eXdIQAA3Tkh6P85+c0jMd02" +
  "/wDdbv8mACkpEf/BGePdfujGAt136t1+6c4A3Xfr3W7q3Wbrft13/rfKizXdXv4cweHlxXPh5Ubh5SNO" +
  "eOYf3XHs3W7q3WbrbhYA3Xft3XLue9YoIBxpJgApKSkpKd1e7d1W7hkpfPZ4Z88hAADfw4s1fdbI2os1" +
  "aK9nXwYDKY/LExD63XXv3XTw3Xfx3XPyaa9nTwYDKY/LERD63XXz3XT03Xf13XH27VsgwCoiwAYIyyzL" +
  "HcsayxsQ9t1z991y+N11+d10+u1bJMAqJsAGCMssyx3LGssbEPbdc/vdcvzddf3ddP7dfvfGBk/dfvjO" +
  "AEfdfvnOAF/dfvrOAFfdfu+R3X7wmN1+8ZvdfvKa4is07oDyxjTdfu/GCE/dfvDOAEfdfvHOAF/dfvLO" +
  "AFfdfveR3X74mN1++Zvdfvqa4ls07oDyxjTdfvvGCE/dfvzOAEfdfv3OAF/dfv7OAFd53ZbzeN2e9Hvd" +
  "nvV63Z724os07oD6xjTdfvPGAt13+91+9M4A3Xf83X71zgDdd/3dfvbOAN13/t1++5HdfvyY3X79m91+" +
  "/priwzTugPLMNN02/gAYBN02/gHdfv63wos14eUjIyNOKhTA3XX93XT+ebcoEN1u/d1m/hEIABl+3Xf+" +
  "GA7dXv3dVv4hBwAZft13/t1O/t1+/rcoCa/dcf3dd/4YB6/dd/3dd/7dfv3dd/vdfv7dd/zdfuzdd/3d" +
  "Nv4ABgXdy/0m3cv+FhD23X793Ybt3Xf53X7+3Y7u3Xf63X753Xf93X763Xf+3cv9Jt3L/hbdfv3dd/nd" +
  "fv72eN13+t1u+d1m+s/dbvvdZvzfweHlxTYA3TT/3X7/1hDaGjPd+d3hySEAACI/wC4Aw4FBITrAfrco" +
  "Az13yTYFATnACjzmAwLJ3eXdIQAA3Tkh9/85+U8h//82AnnNNwvtUz/C7Us/wiEEAAkiQcIqP8JOIwYA" +
  "XhYAaWDNM0QqQcIZIkPCDgAhQ8AGAAk2AAx51oA48gH/wR4AayYAKSkJIyM2ABx71hA48CH3wTYAIfjB" +
  "NgAh+cE2ASH6wTYAIVXBNgAhVsE2ACH//zYC3Tb/ACo/wiMjTt1+/5HS4TfdTv8GAGlgKQnrKkPCGePd" +
  "fvfGAt13/d1++M4A3Xf+3W793Wb+Tt1+98YB3Xf53X74zgDdd/p5/gcoBNYIIFc698HWMDBQ7Uv3wQYA" +
  "aWApCeshV8EZ6+HlfhLtS/fBBgBpYCkJEVfBGesT3W753Wb6fhLtS/fBBgBpYCkJEVfBGesTE91u/d1m" +
  "/n7WBz4BKAGvEiH3wTTdbv3dZv5+/gooBNYLIFc6VcHWMDBQ7UtVwQYAaWApCeshxcAZ6+HlfhLtS1XB" +
  "BgBpYCkJEcXAGesT3W753Wb6fhLtS1XBBgBpYCkJEcXAGesTE91u/d1m/n7WCj4BKAGvEiFVwTTdbv3d" +
  "Zv5+1gnC2zc6+MHWCDB8OvjB3Xf93Tb+AN1+/d13+91+/t13/N3L+ybdy/wWPufdhvvdd/0+wd2O/N13" +
  "/uHlft1u/d1m/nc6+MHdd/3dNv4A3cv9Jt3L/hY+592G/d13+z7B3Y7+3Xf83X77xgHdd/3dfvzOAN13" +
  "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" +
  "bv3dZv7NDUXx8d1++t2u/ygOr5NfPgCaVz4AnW+flGfd+d3hyd3l3SEAAN059fUzM9Xddf7ddP8hAABd" +
  "VA4g3X7/B+YBR93L/Cbdy/0W3cv+Ft3L/xYpyxPLEstAKALLxX3dlgR83Z4Fe92eBnrdngc4HH3dlgRv" +
  "fN2eBWd73Z4GX3rdngdX3X789gHdd/wNIK3R1d1u/t1m/9353eHJ3eXdIQAA3Tn19fXdc/zdcv3ddf7d" +
  "dP9NRN1eBN1WBWlgzTNE3XP+3XL/S0Ldfgbdd/rdfgfdd/vh0dXlxd1u+t1m+80zROvBCevdc/7dcv9L" +
  "Qt1e/d1mBcUuAFUGCCkwARkQ+sEJ691z/t1y/91eBN1m/S4AVQYIKTABGRD6TUTdXvzdZgXFLgBVBggp" +
  "MAEZEPrB691zBd1yBmtiCevdcwXdcgZ7kXqYPgAX3XcH3V783WYELgBVBggpMAEZEPrr3XP83XL93TYE" +
  "AN1+/N2GBF/dfv3djgVX3X7+3Y4Gb91+/92OB2fd+d3hyQQgCAgBAQUAeLEoCBE5wyFyRu2wyQAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "////q5mZAEw=";
