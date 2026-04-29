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
    if (sprites['RED_BLUE_BLOCK_SWITCH']) {
      specialTilePixels.set(-6, sprites['RED_BLUE_BLOCK_SWITCH'].animation[0].sprite); // switch red frame
      if (sprites['RED_BLUE_BLOCK_SWITCH'].animation[1])
        specialTilePixels.set(-7, sprites['RED_BLUE_BLOCK_SWITCH'].animation[1].sprite); // switch blue frame
    }

    // Encode each unique tile.

    // Add red/blue block tiles if any level uses them (levelObjects contain redBlock/blueBlock/redBlueSwitch)
    const hasRedBlue = levels.some(l => l.levelObjects && l.levelObjects.some(
        o => o.type === 'redBlock' || o.type === 'blueBlock' || o.type === 'redBlueSwitch' || o.type === 'redblueblockswitch'));
    if (hasRedBlue) {
      [-2, -3, -4, -5, -6, -7].forEach(k => {
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
    if (level.levelObjects) {
      for (const obj of level.levelObjects) {
        if (obj.type === 'connectedDisappearingBlock') connectedPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'redBlock')       redBlockPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'blueBlock')      blueBlockPos.add(`${obj.x},${obj.y}`);
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
    const header = new Uint8Array(15);
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
    header[14] = indexMap.has(-7) ? Math.min(indexMap.get(-7), 255) : 0; // switch blue frame

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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDD2zUh" +
  "AMB+BgBwEQHAAT0C7bAycsHNhzjNMTT7zewtdhj9ZGV2a2l0U01TAAAAwxo27aPto+2j7aPto+2j7aPt" +
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
  "tCHdbv7dZv/l3W783Wb95d1e9N1W9d1u9t1m981iDbcgI+1bIMAqIsB6xgRXMAEj3U7+3Ub/xd1O/N1G" +
  "/cXNYg23yrQh3W7w3Wbx3V7y3Vbz3cvzfigY3X7wxgdv3X7xzgBn3X7yzgBf3X7zzgBXBgPLKssbyxzL" +
  "HRD2fcYB3XfjfM4A3Xfke84A3Xfles4A3XfmOv/At8KAISoUwBENABl+t8qAIe1LIMDtWyLAPgjLKssb" +
  "yxjLGT0g9d1x/N1w/d1z/t1y/8t6KBh5xgfdd/x4zgDdd/17zgDdd/56zgDdd//dbvzdZv3LPMsdyzzL" +
  "Hcs8yx1lecYG3Xf0eM4A3Xf1e84A3Xf2es4A3Xf33X703Xf83X713Xf93X723Xf+3X733Xf/3cv3figY" +
  "ecYN3Xf8eM4A3Xf9e84A3Xf+es4A3Xf/3U783Ub9yzjLGcs4yxnLOMsZ3UbjxWh8zfgLwd13/2h5zfgL" +
  "T/0qFMD95dEhDQAZXt1+/5MoEf1GDt1+/5AoCHm7KASQwoAhOv7A1gE+ABcy/sDNriQqFMDddf7ddP86" +
  "/sC3KA3dTv7dRv8hDQAJThgL3W7+3Wb/EQ4AGU5BebcoBUgGABgDAQAAHgAh/cB7ljA6ayYAKf0h7MDF" +
  "TUT9CcH95eEjbiYAKSkpKSl9VP1uAPV95h9v8SYAhW96jMslj/Z4Z8XPwWlg3xwYv+1LIMDtWyLAPgjL" +
  "KssbyxjLGT0g9d1++N13591++d136N1++t136d1++9136t1++MYI3Xfr3X75zgDdd+zdfvrOAN137d1+" +
  "+84A3XfuecYG3XfveM4A3Xfwe84A3Xfxes4A3Xfy3Tb/ACH8wN1+/5bSeyHV3V7/FgBrYikZ0f0hXMDF" +
  "TUT9CcH9fgDdd/uv3Xf83Xf93Xf+9d1++913891+/N139N1+/d139d1+/t139vE+A93L8ybdy/QW3cv1" +
  "Ft3L9hY9IO395eEjft13+6/dd/zdd/3dd/713X773Xf33X783Xf43X793Xf53X7+3Xf68T4D3cv3Jt3L" +
  "+Bbdy/kW3cv6Fj0g7f1+ArcoBTr+wBgIOv7A1gE+ABe3ynUh3X7z3Zbv3X703Z7w3X713Z7x3X723Z7y" +
  "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" +
  "+t1+B913++HR1eXF3W763Wb7zU0368EJ691z/t1y/0tC3V793WYFxS4AVQYIKTABGRD6wQnr3XP+3XL/" +
  "3V4E3Wb9LgBVBggpMAEZEPpNRN1e/N1mBcUuAFUGCCkwARkQ+sHr3XMF3XIGa2IJ691zBd1yBnuRepg+" +
  "ABfddwfdXvzdZgQuAFUGCCkwARkQ+uvdc/zdcv3dNgQA3X783YYEX91+/d2OBVfdfv7djgZv3X7/3Y4H" +
  "Z9353eHJBCAICAEBBQB4sSgIET7CIYI47bDJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//8+CJmZAEw=";
