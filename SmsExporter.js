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
        if (obj.type === 'disappearingForegroundTile') fgDispPos.add(`${obj.x},${obj.y}`);
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
    const header = new Uint8Array(38);
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
    // fg_disp_vram_idx: disappearing foreground tile (0=not used)
    header[37] = indexMap.has(-201) ? Math.min(indexMap.get(-201), 255) : 0;

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
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDEkkh" +
  "AMB+BgBwEQHAAWgD7bAyncLNykzNaEf7zSNBdhj9ZGV2a2l0U01TAAAAw1FJ7aPto+2j7aPto+2j7aPt" +
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
  "xc2ADrfKYSvdbvDdZvHdXvLdVvPdy/N+KBjdfvDGB2/dfvHOAGfdfvLOAF/dfvPOAFcGA8sqyxvLHMsd" +
  "EPZ9xgHdd+N8zgDdd+R7zgDdd+V6zgDdd+Y6+sG3wh0rKhTAEQ0AGX63yh0r7UsgwO1bIsA+CMsqyxvL" +
  "GMsZPSD13XH83XD93XP+3XL/y3ooGHnGB913/HjOAN13/XvOAN13/nrOAN13/91u/N1m/cs8yx3LPMsd" +
  "yzzLHWV5xgbdd/R4zgDdd/V7zgDdd/Z6zgDdd/fdfvTdd/zdfvXdd/3dfvbdd/7dfvfdd//dy/d+KBh5" +
  "xg3dd/x4zgDdd/17zgDdd/56zgDdd//dTvzdRv3LOMsZyzjLGcs4yxndfuM9R8VofM34C8Hdd/9oec34" +
  "C0/9KhTA/eXRIQ0AGV7dfv+TKBH9Rg7dfv+QKAh5uygEkMIdKzr5wdYBPgAXMvnBzQAyKhTA3XX+3XT/" +
  "OvnBtygN3U7+3Ub/IQ0ACU4YC91u/t1m/xEOABlOQXm3KAVIBgAYAwEAAB4AIfjBe5YwOmsmACn9IefB" +
  "xU1E/QnB/eXhI24mACkpKSkpfVT9bgD1feYfb/EmAIVveozLJY/2eGfFz8FpYN8cGL/tSyDA7VsiwD4I" +
  "yyrLG8sYyxk9IPXdfvjdd+fdfvndd+jdfvrdd+ndfvvdd+rdfvjGCN13691++c4A3Xfs3X76zgDdd+3d" +
  "fvvOAN137nnGBt1373jOAN138HvOAN138XrOAN138t02/wAh98Hdfv+W0hgr1d1e/xYAa2IpGdH9IVfB" +
  "xU1E/QnB/X4A3Xf7r913/N13/d13/vXdfvvdd/Pdfvzdd/Tdfv3dd/Xdfv7dd/bxPgPdy/Mm3cv0Ft3L" +
  "9Rbdy/YWPSDt/eXhI37dd/uv3Xf83Xf93Xf+9d1++913991+/N13+N1+/d13+d1+/t13+vE+A93L9ybd" +
  "y/gW3cv5Ft3L+hY9IO39fgK3KAU6+cEYCDr5wdYBPgAXt8oSK91+892W791+9N2e8N1+9d2e8d1+9t2e" +
  "8uJyKu6A8hIr3X7zxgjdd/vdfvTOAN13/N1+9c4A3Xf93X72zgDdd/553Zb7eN2e/Hvdnv163Z7+4qoq" +
  "7oDyEivdfvfdluvdfvjdnuzdfvndnu3dfvrdnu7iyirugPISK91+98YI3Xf73X74zgDdd/zdfvnOAN13" +
  "/d1++s4A3Xf+3X7n3Zb73X7o3Z783X7p3Z793X7q3Z7+4gor7oDyEishxMA2Ad00/8OfKSH6wTYB3X7j" +
  "3Xf93X7k3Xf+3X7l3Xf/3Tb8AAYD3cv9Jt3L/hbdy/8WEPIhAAAiLMAiLsAhMsA2ACEzwDYAKhbAEQwA" +
  "GX4yNsARJMAhGQA5AQQA7bDd+d3hyd3l3SEAAN05IeL/OfntWyDAKiLABgjLLMsdyxrLGxD2MzPV3XXk" +
  "3XTl7VskwComwAYIyyzLHcsayxsQ9t1z5t1y59116N106SpvwiMjfv6AMAndd/7dNv8AGAjdNv6A3Tb/" +
  "AN1O/iH//zYC3X7mxgjdd+rdfufOAN13691+6M4A3Xfs3X7pzgDdd+3dfuLGBt137t1+484A3Xfv3X7k" +
  "zgDdd/DdfuXOAN138R4Ae5HS2C7VFgBrYikZ0X1UIXPChiNHeo5X3XDy3XLzaGJur2dXBgMpj8sSEPrd" +
  "dfTddPXdd/bdcvfdbvLdZvMjbq9nVwYDKY/LEhD63XX43XT53Xf63XL73X743Xf83X753Xf93X763Xf+" +
  "3X773Xf/3X703Zbu3X713Z7v3X723Z7w3X733Z7x4qss7oDy1C7dfvTGCEfdfvXOAFfdfvbOAG/dfvfO" +
  "AGfdfuKQ3X7jmt1+5J3dfuWc4tss7oDy1C7dfvzdlurdfv3dnuvdfv7dnuzdfv/dnu3i+yzugPLULt1+" +
  "/MYIR91+/c4AV91+/s4Ab91+/84AZ91+5pDdfuea3X7ond1+6ZziKy3ugPLULt1u8t1m8yMjfv4CKBT+" +
  "Aygr/gQoL/4Fysgu1gwoC8PULiHDwDYBw9QuxdXNwhXRwbfC1C4hw8A2AcPULiHEwDYBw9QuISzARiNW" +
  "IyN+K27Lf8LULt1++MYE3Xf83X75zgDdd/3dfvrOAN13/t1++84A3Xf/ISTARiNWIyN+K25n3XD03XL1" +
  "3XX23XT3Bgjdy/cu3cv2Ht3L9R7dy/QeEO7dfvTGCN13+N1+9c4A3Xf53X72zgDdd/rdfvfOAN13+91+" +
  "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" +
  "3X7/B+YBR93L/Cbdy/0W3cv+Ft3L/xYpyxPLEstAKALLxX3dlgR83Z4Fe92eBnrdngc4HH3dlgRvfN2e" +
  "BWd73Z4GX3rdngdX3X789gHdd/wNIK3R1d1u/t1m/9353eHJ3eXdIQAA3Tn19fXdc/zdcv3ddf7ddP9N" +
  "RN1eBN1WBWlgzYRK3XP+3XL/S0Ldfgbdd/rdfgfdd/vh0dXlxd1u+t1m+82ESuvBCevdc/7dcv9LQt1e" +
  "/d1mBcUuAFUGCCkwARkQ+sEJ691z/t1y/91eBN1m/S4AVQYIKTABGRD6TUTdXvzdZgXFLgBVBggpMAEZ" +
  "EPrB691zBd1yBmtiCevdcwXdcgZ7kXqYPgAX3XcH3V783WYELgBVBggpMAEZEPrr3XP83XL93TYEAN1+" +
  "/N2GBF/dfv3djgVX3X7+3Y4Gb91+/92OB2fd+d3hyQADBCAICAEBBwB4sSgIEWnDIcNM7bDJAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "//+QhJmZAEw=";
