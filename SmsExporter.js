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
    // Foreground tile sprite (sentinel -200)
    if (sprites['FOREGROUND_TILE'])
      specialTilePixels.set(-200, sprites['FOREGROUND_TILE'].animation[0].sprite);

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

    // Add foreground tile sprite if any level uses foregroundTile objects
    const hasFgTile = levels.some(l => l.levelObjects &&
      l.levelObjects.some(o => o.type === 'foregroundTile'));
    if (hasFgTile && !tileCache.has(-200) && specialTilePixels.has(-200)) {
      tileCache.set(-200, null);
      tileOrder.push(-200);
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
    const fgPos         = new Set();  // foreground tiles (priority bit)
    if (level.levelObjects) {
      for (const obj of level.levelObjects) {
        if (obj.type === 'connectedDisappearingBlock') connectedPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'redBlock')       redBlockPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'blueBlock')      blueBlockPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'violetBlock')    violetPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'pinkBlock')      pinkPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'redBlueSwitch' || obj.type === 'redblueblockswitch')  switchPos.add(`${obj.x},${obj.y}`);
        if (obj.type === 'foregroundTile') fgPos.add(`${obj.x},${obj.y}`);
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
          // Deko tiles are drawn as BG tiles (always passable)
          buf[off++] = clampByte(indexMap.get(dekoPos.get(`${x},${y}`)) || 0);
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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDKkMh" +
  "AMB+BgBwEQHAATgD7bAybcLN4EbNgEH7zTs7dhj9ZGV2a2l0U01TAAAAw2lD7aPto+2j7aPto+2j7aPt" +
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
  "VzABI/3lxc1+ELfKXyrdfvDGCN139N1+8c4A3Xf13X7yzgDdd/bdfvPOAN139yEVADnrIREAOQEEAO2w" +
  "3cv3figg3X70xgfdd/jdfvXOAN13+d1+9s4A3Xf63X73zgDdd/vdfvjdd/Ldfvndd/Pdfvrdd/Tdfvvd" +
  "d/UGA93L9S7dy/Qe3cvzHt3L8h4Q7v0qFMD9fga3ys4l3X7y3Xf77UsgwO1bIsA+CMsqyxvLGMsZPSD1" +
  "3XH33XD43XP53XL6y3ooGHnGB91393jOAN13+HvOAN13+XrOAN13+t1O991G+Ms4yxnLOMsZyzjLGd1u" +
  "+3nN+gvdd/bdfvvdd/ftSyDA7VsiwD4IyyrLG8sYyxk9IPXdcfjdcPndc/rdcvvLeigYecYH3Xf4eM4A" +
  "3Xf5e84A3Xf6es4A3Xf73U743Ub5yzjLGcs4yxnLOMsZDN1u93nN+gtP/SoUwP1GBt1+9pAoB3mQKAOv" +
  "GAI+AbcoR+1LJMAqJsDdcfh4xgjdd/l9zgDdd/p8zgDdd/vdVvLdbvPdZvQeAAYDyyLtahD6e92W+Hrd" +
  "nvl93Z76fN2e++LLJe6A+l8q3X7y3V7z3W703Wb1BgOHyxPtahD5xvhPe87/R33O/198zv/dcf3dcP7d" +
  "c//dNvwAIQAAIizAIi7AITDANgEhMcA2ACEywDYAITPANgAhOMA2AMNfKt1u/t1m/+XdbvzdZv3l3V70" +
  "3Vb13W723Wb3zWQNtyAj7VsgwCoiwHrGBFcwASPdTv7dRv/F3U783Ub9xc1kDbfKXyrdbvDdZvHdXvLd" +
  "VvPdy/N+KBjdfvDGB2/dfvHOAGfdfvLOAF/dfvPOAFcGA8sqyxvLHMsdEPZ9xgHdd+N8zgDdd+R7zgDd" +
  "d+V6zgDdd+Y6+sG3whsqKhTAEQ0AGX63yhsq7UsgwO1bIsA+CMsqyxvLGMsZPSD13XH83XD93XP+3XL/" +
  "y3ooGHnGB913/HjOAN13/XvOAN13/nrOAN13/91u/N1m/cs8yx3LPMsdyzzLHWV5xgbdd/R4zgDdd/V7" +
  "zgDdd/Z6zgDdd/fdfvTdd/zdfvXdd/3dfvbdd/7dfvfdd//dy/d+KBh5xg3dd/x4zgDdd/17zgDdd/56" +
  "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" +
  "ljA0EcXABgBpYCkJGesaR91+/5AgHmtiI91+/pYgFRMTGrcoCjpWwdYBPgAXGAk6VsEYBAwYxa/d+d3h" +
  "yd3l3SEAAN05Iev/Ofk6VsHWAT4AFzJWwd02/wAhVcHdfv+W0nMw3U7/BgBpYCkJ3XX93XT+PsXdhv3d" +
  "d/s+wN2O/t13/N1u+91m/H7dd/3dfvvdd/ndfvzdd/rdbvndZvojft13/t1u+91m/CMjTnm3KAU6VsEY" +
  "CDpWwdYBPgAX3Xf6KhTA3XX73XT8ebcoId1++rcoDd1O+91G/CEPAAlGGAvdTvvdRvwhEAAJRngYHt1+" +
  "+rcoDd1O+91G/CERAAl+GAvdbvvdZvwREgAZfrcoBAYAGAKvR19Q3W7+JgApKSkpKd1+/eYfTwYACSl8" +
  "9nhnz+vf3X76t8ptMO1bIMAqIsAGCMssyx3LGssbEPYzM9Xdde3ddO7tWyTAKibABgjLLMsdyxrLGxD2" +
  "3XPv3XLw3XXx3XTy3W79r2dPBgMpj8sREPrddfPddPTdd/Xdcfbdbv6vZ08GAymPyxEQ+t119910+N13" +
  "+d1x+t1+68YGT91+7M4AR91+7c4AX91+7s4AV91+85HdfvSY3X71m91+9prixS/ugPJtMN1+88YI3Xf7" +
  "3X70zgDdd/zdfvXOAN13/d1+9s4A3Xf+3X7r3Zb73X7s3Z783X7t3Z793X7u3Z7+4gUw7oDybTDdfu/G" +
  "CE/dfvDOAEfdfvHOAF/dfvLOAFfdfveR3X74mN1++Zvdfvqa4jUw7oDybTDdfvfGCE/dfvjOAEfdfvnO" +
  "AF/dfvrOAFfdfu+R3X7wmN1+8ZvdfvKa4mUw7oDybTAhxMA2Ad00/8NJLt353eHJ3eXdIQAA3Tn13Xf/" +
  "3XX+DgAh98F5ljA0EVfBBgBpYCkJGesaR91+/5AgHmtiI91+/pYgFRMTGrcoCjr5wdYBPgAXGAk6+cEY" +
  "BAwYxa/d+d3hye1bFMC3KBJ9tygHIQkAGX4YFyEKABl+GBB9tygHIQsAGX4YBSEMABl+tygEFgBfyREA" +
  "AMnd5d0hAADdOfXdNv8AIffB3X7/ljBR3U7/BgBpYCkJ6yFXwRnrGk9rYiN+3Xf+ExMaR7coBTr5wRgI" +
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
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABHZW5lcmF0" +
  "ZWQgYnkgcG9ja2V0LXBsYXRmb3JtZXItdG8tc21zIHdlYiBleHBvcnRlci4AUG9ja2V0IFBsYXRmb3Jt" +
  "ZXIgU01TIEVuZ2luZQBwb2NrZXQtcGxhdGZvcm1lci1zbXMAU0RTQwEDAQElIMp/rX95f1RNUiBTRUdB" +
  "//+q5JmZAEw=";
