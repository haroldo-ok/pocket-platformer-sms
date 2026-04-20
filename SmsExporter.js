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
 * Tile VRAM layout:
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
    startFlag:   1,
    finishFlag:  2,
    spike:       3,
    trampoline:  4,
    collectible: 5,
  };

  // Map pocket-platformer ObjectTypes strings → our IDs
  const OBJECT_TYPE_MAP = {
    'startFlag':   OBJ_TYPE.startFlag,
    'finishFlag':  OBJ_TYPE.finishFlag,
    'spike':       OBJ_TYPE.spike,
    'trampoline':  OBJ_TYPE.trampoline,
    'collectible': OBJ_TYPE.collectible,
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
  // Returns encoded tiles for all object/player sprites in a fixed order
  // matching the VRAM layout expected by pocket_platformer.c
  // Tile order (each 8×8 tile = 32 bytes, 8×16 sprites use 2 tiles):
  //   0-1   start flag  (top/bottom)
  //   2-3   finish flag (top/bottom)
  //   4-5   spike       (top/bottom)
  //   6-7   trampoline  (top/bottom)
  //   8-9   coin        (top/bottom)
  //   10-11 player idle (top/bottom)
  //   12-13 player walk frame 0 (top/bottom)
  //   14-15 player walk frame 1 (top/bottom)
  //   16-17 player jump (top/bottom)
  function buildSpriteSheet(sprites, palette) {
    const tiles = [];

    function encodeSprite16(spriteObj, frameIdx) {
      // An 8×16 sprite is stored as two 8×8 tiles (top half, bottom half)
      const anim = spriteObj.animation || spriteObj;
      const frame = Array.isArray(anim) ? (anim[frameIdx] || anim[0]) : anim;
      const rows = frame.sprite || frame;

      // Top 8 rows
      const top = rows.slice(0, 8);
      // Bottom 8 rows (pad with transparent if sprite is only 8 tall)
      const bot = rows.length > 8 ? rows.slice(8, 16) :
        Array(8).fill(Array(8).fill('transp'));

      tiles.push(encodeTile4bpp(top, palette));
      tiles.push(encodeTile4bpp(bot, palette));
    }

    // Fallback blank sprite
    const blank8 = Array(8).fill(Array(8).fill('transp'));
    function encodeBlank() {
      tiles.push(encodeTile4bpp(blank8, palette));
      tiles.push(encodeTile4bpp(blank8, palette));
    }

    const get = name => sprites[name] || null;

    const startFlag  = get('START_FLAG_SPRITE');
    const finishFlag = get('FINISH_FLAG_SPRITE');
    const spikeS     = get('SPIKE_SPRITE');
    const trampS     = get('TRAMPOLINE_SRPITE') || get('TRAMPOLINE_SPRITE');
    const coinS      = get('COLLECTIBLE');
    const pIdle      = get('PLAYER_IDLE_SPRITE');
    const pWalk      = get('PLAYER_WALK_SPRITE');
    const pJump      = get('PLAYER_JUMP_SPRITE');

    startFlag  ? encodeSprite16(startFlag,  0) : encodeBlank();
    finishFlag ? encodeSprite16(finishFlag, 0) : encodeBlank();
    spikeS     ? encodeSprite16(spikeS,     0) : encodeBlank();
    trampS     ? encodeSprite16(trampS,     0) : encodeBlank();
    coinS      ? encodeSprite16(coinS,      0) : encodeBlank();
    pIdle      ? encodeSprite16(pIdle,      0) : encodeBlank();
    // Walk: 2 frames
    pWalk      ? encodeSprite16(pWalk,      0) : encodeBlank();
    pWalk      ? encodeSprite16(pWalk,      1) : encodeBlank();
    pJump      ? encodeSprite16(pJump,      0) : encodeBlank();

    // Merge into single Uint8Array
    const total = tiles.length * BYTES_PER_TILE;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const t of tiles) {
      out.set(t, offset);
      offset += BYTES_PER_TILE;
    }
    return out;
  }

  // ─── BG tileset builder ───────────────────────────────────────────────────────
  // Returns { encoded: Uint8Array, tileCount: N }
  // Tiles are de-duplicated. Returns mapping: original tile index → VRAM tile index.
  function buildBgTileset(levels, sprites, palette) {
    // Collect all unique tileData values used across all levels
    // tileData values: 0=empty, 1..N = tile types
    // We map them to our palette-quantised tiles
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
    }

    // Encode each unique tile
    for (const tileIdx of tileOrder) {
      const spriteKey = `TILE_${tileIdx}`;
      const spriteObj = sprites[spriteKey];
      if (spriteObj) {
        const frame = spriteObj.animation[0];
        tileCache.set(tileIdx, encodeTile4bpp(frame.sprite, palette));
      } else {
        // Solid colour fallback
        const fallback = Array(8).fill(Array(8).fill('888888'));
        tileCache.set(tileIdx, encodeTile4bpp(fallback, palette));
      }
    }

    const tileCount = tileOrder.length;
    const encoded = new Uint8Array(tileCount * BYTES_PER_TILE);
    const indexMap = new Map(); // tileData value → 1-based VRAM tile index
    let vramIdx = 1;
    let offset = 0;
    for (const tileIdx of tileOrder) {
      encoded.set(tileCache.get(tileIdx), offset);
      indexMap.set(tileIdx, vramIdx);
      offset += BYTES_PER_TILE;
      vramIdx++;
    }

    return { encoded, tileCount, indexMap };
  }

  // ─── Level serialiser ─────────────────────────────────────────────────────────
  // Returns Uint8Array for one level in columnar format
  function encodeLevel(level, indexMap) {
    const tileData = level.tileData;
    const mapH = tileData.length;
    const mapW = tileData[0].length;

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
        buf[off++] = tileVal === 0 ? 0 : clampByte(indexMap.get(tileVal) || 0);
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
    writeInt16(toFP(playerObj.jumpSpeed         || 0.44) * 8); // scale up for Z80
    writeUint8(playerObj.maxJumpFrames          || 18);
    writeInt16(toFP(playerObj.maxFallSpeed      || 16));
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
    const { encoded: bgTiles, tileCount, indexMap } = buildBgTileset(levels, sprites, palette);

    // 4. Build sprite sheet
    const spriteSheet = buildSpriteSheet(sprites, palette);

    // 5. Encode each level
    const encodedLevels = levels.map(l => encodeLevel(l, indexMap));

    // 6. Encode physics
    const physicsBytes = encodePhysics(playerObject || {});

    // 7. Build header
    const header = new Uint8Array(6);
    header[0] = 0x50; // 'P'
    header[1] = 0x50; // 'P'
    header[2] = 0x4C; // 'L'
    header[3] = 0x54; // 'T'
    header[4] = Math.min(levels.length, 255);
    header[5] = Math.min(tileCount, 255);

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

      const resourceBlob = buildResourceBlob(gameData);
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
SmsExporter.BASE_ROM_B64 =
  "8+1WMfDfGBkOv/Ptae1h+8kAAAAAAAAAfdO+fCMr077JIQAAIvz/IQECIv7/GAw6/v/JMv7/yQDDo0Eh" +
  "AMB+BgBwEQHAAUsB7bAygMDNSkPN+T/7zbo5dhj9ZGV2a2l0U01TAAAAw+JB7aPto+2j7aPto+2j7aPt" +
  "o+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPt" +
  "o+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPt" +
  "o+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPt" +
  "o+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPto+2j7aPt" +
  "o8kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAQN/g/wHKStD/OtE60jnTOM9I0DrROtI50znU" +
  "OtU51jrXONg42TjaONs43TjeON8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/PQBfALsOsf+Ajo6PVYAPjzGxMb8O" +
  "zv//8fHwqgC+Pr8/vw+qDnH/AA4ODyBOVY+P/0B//w7/qgD+/g+6MQ3/AXFxcVUAjYxxcHH8Do////Pz" +
  "8yr8qgH9/Q26cI6AsbGxjzCPD48xsTG/Ds7/8fHx8Iq/Pr4+Pw+qcA4AcXFxDw5x8I+Pj/8Qjv/+/v4P" +
  "unENAXFxcfGMjYxxcHH8cfP/j4+Pqvz9/f0Nu3COgLGxgP8wjw+PMbEAqnDx/87O//+/Pr4+vz+AVapw" +
  "DgBxcQD/cI/wcXEAqkD+/3D+////AFW6cA0BcXEB//GMjYxxcAGqcPP/j4///6j8/f39AFXr/wAODnFx" +
  "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" +
  "AgAAAAAAAAAADg4AAAAAAAAAAgAAAAAAAAAADg4AAAAAAAAAAgAAAAAAAAAADg4AAAAAAAAAAgAAAAAA" +
  "AAAADg4AAAAAAAAAAgAAAAAAAAAADg4AAAAAAAAAAgAAAAAAAAAADg4AAAAAAAAAAgAAAAAAAAAADg4A" +
  "AAAAAAAAAgAAAAAAAAAADg4AAAAAAAAAAgAAAAAAAAAADg4AAAAAAAAAAgAAAAAAAAAADg4AAAAAAAIF" +
  "AgAAAAAAAAAADg4AAAAAAAIAAAAAAAAAAAAADg4AAAAAAAIAAAAAAAAAAAAADg4AAAAAAAIAAAAAAAAA" +
  "AAAADg4AAAAAAAIAAAAAAAAAAAAADg4AAAAAAAIAAAAAAAAAAAAADg4AAAAAAAIAAAAAAAAAAAAADg4A" +
  "AAAAAAIAAAAAAAAAAAAADg4AAAAAAAIAAAAAAAAAAAAADg4AAAAAAAIAAAAAAAAAAAAADg4ODg4ODgIO" +
  "Dg4ODg4ODg4ODhBYE/AwFohwH4BwH3hwH3BwH2hwH2BwH1hwH1gQIFgYIFggIFgoIFgwIFg4IFhAIGBA" +
  "IGA4IGAwIGAoIGAgIGAYIGAQIIgwJjhAGXhAFEAYHHAQGJAQGIgQGIAQGHgQGHggKyhAMiBAMhhAMhBA" +
  "MlBAHVAYNAgwN6g4OHBAOZhAO5AgMEAwMMAwLLggGwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAgADAAAABAAFAAYABwAI" +
  "AAkACgALAAwADQAOAA8AAQACAAMAAAAEAAUABgAHAAgACQAKAAsADAANAA4ADwAQABEAEgATABQAFQAW" +
  "ABcAGAAZABoAGwAcAB0AHgAfABAAEQASABMAFAAVABYAFwAYABkAGgAbABwAHQAeAB8AIAAgACAAIAAg" +
  "ACAAIAAgACAAIAAgACEAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIQAgACAAIAAgACAAIAAg" +
  "ACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAi" +
  "ACMAJAAlACYAJwAoACkAKgArACwALQAqAi4ALwAwACIAIwAkACUAJgAnACgAKQAqACsALAAtACoCLgAv" +
  "ADAAMQAgADIAIAAzADQANQA2ADQANwA4ADUCOQA6ACAAMQI7ACAAMgAgADMANAA1ADYANAA3ADgANQI5" +
  "ADoAIAAxAiAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAg" +
  "ACAAIAAgACAAIAA0BDoGPAAgAD0APgAvAj8AKgBAAEEANAYpACsCQgA6BigCOgY8ACAAPQA+AC8CPwAq" +
  "AEAAQQA0BikAKwJCADoGNQJDAEQAIABFAEYANAJHAEgASQBKACgEPARIAEoCQwI1AkMARAAgAEUARgA0" +
  "AkcASABJAEoAKAQ8BEgASgJDAiAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAg" +
  "ACAAIAAgACAAIAAgACAAIAAgACAAIAAkAEsATABNAE4ATQBLAEAATQAvAi4CTwBQACQCUQBPAiQASwBM" +
  "AE0ATgBNAEsAQABNAC8CLgJPAFAAJAJRAE8CUgAgACAAIAAgACAAIABIAiAAIABTACAAIABUACAASQBS" +
  "ACAAIAAgACAAIAAgAEgCIAAgAFMAIAAgAFQAIABJACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAg" +
  "ACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIABVACsAVgBXAD4CJgIoAFgAQQAlAiwAKwJP" +
  "AkUGWQBaAFsAXABFBCUAKQBdAF4ALgJcAl8ALAJfAlUCRQRZAFoANABCBEIGIABgAEIGNQA2ADcCJQZh" +
  "AEgAYgBjAGICZAA1AkIEQgYgADgCSABiAGUASABfBEMCZgBIAmMCNQIyAiAAIAAgACAAIAAgACAAIAAg" +
  "ACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIABnAGgAaQBqAGsAbABt" +
  "AG4AbwBwAHEAcgBzAHQAdQB2AGcAaABpAGoAawBsAG0AbgBvAHAAcQByAHMAdAB1AHYAdwB4AHkAegB7" +
  "AHwAfQB+AH8AgACBAIIAgwCEAIUAhgB3AHgAeQB6AHsAfAB9AH4AfwCAAIEAggCDAIQAhQCGAAAAhwAA" +
  "AAAAAAAAAAAAAACIAAAAiQAAAAAAigCLAAAAAACHAAAAAAAAAAAAAAAAAIgAAACJAAAAAACKAIsAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAABAAD+BwgRLm/vdzYHDx8zEnwIGQAHDhl4gHQl4AAFBXMLG/5+NxMQDAUGAzkYDA8DAgMA" +
  "QSgcHw8FBAMhHzcHB+/gvG7yu3fr5UAPAMCQDOBc8g5FiZ2fAGCc/P7+dnr+tU6yBBiw0GBKsEz44EBg" +
  "AM/6fvz4sJBgIR96tMz/DxEua+13N3sPHzMWfggYPAAOGXyCdCREAAAFBXMLGzfqMSAcFxsNAAAHAB4/" +
  "AwgMIBcuHx8TIT8HD+/gfPq+T7916UAPAIAEQOCcBnr9xY8fAOD8xLJ6+vb6mvIEiHCgwABkDPhwgMAA" +
  "ACALZg78+CAhP/z8/gcIES5v73c2Bw8fMxJ8CBkABw4ZeIB0JeAABQVzCxv+fjcTEAwFBgM5GAwPAwID" +
  "AEEoHB8PBQQDIR83Bwfv4Lxu8rt36+VADwDAkAzgXPIORYmdnwBgnPz+/nZ6/rVOsgQYsNBgSrBM+OBA" +
  "YADP+n78+LCQYCEferTM/w8RLmvtdzd7Dx8zFn4IGDwADhl8gnQkRAAABQVzCxs3+jEZCAQCAwEAHg4H" +
  "AwEBAAAgCy4WDwcCIT8HA+/gfPq+T791yUAPAIAEQOCcBnr9xY8/AOD8xLJ6+vb64oYc7PRYgAAceOAQ" +
  "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" +
  "fnZmPAABAGi8GDh+AAEAeDxmBgwYMH4AAQB4PGYGHAZmPAABAGiGDBw8bH4AAQB4fmB8BgZmPAABAHgc" +
  "MGB8ZmY8AAEAaA4wfgYMGAABAGhsZjw8PAABAHg8ZmY+Bgw4AAEAAAAAAAAAABgYGBgYABgAbGxsAAAA" +
  "AAA2Nn82fzY2AAw/aD4LfhgAYGYMGDBmBgA4bGw4bWY7ABgYGAAAAAAADBgwMDAYDAAwGAwMDBgwAAAY" +
  "fjx+GAAAABgYfhgYAAAAAAAAABgYMAAAAH4AAAAAAAAAAAAYGAAABgwYMGAAADxmbn52ZjwAGDgYGBgY" +
  "fgA8ZgYMGDB+ADxmBhwGZjwADBw8bH4MDAB+YHwGBmY8ABwwYHxmZjwAfgYMGDAwMAA8ZmY8ZmY8ADxm" +
  "Zj4GDDgAAAAYGAAYGAAAABgYABgYMAwYMGAwGAwAAAB+AH4AAAAwGAwGDBgwADxmDBgYABgAPGZuam5g" +
  "PAA8ZmZ+ZmZmAHxmZnxmZnwAPGZgYGBmPAB4bGZmZmx4AH5gYHxgYH4AfmBgfGBgYAA8ZmBuZmY8AGZm" +
  "Zn5mZmYAfhgYGBgYfgA+DAwMDGw4AGZseHB4bGYAYGBgYGBgfgBjd39ra2NjAGZmdn5uZmYAPGZmZmZm" +
  "PAB8ZmZ8YGBgADxmZmZqbDYAfGZmfGxmZgA8ZmA8BmY8AH4YGBgYGBgAZmZmZmZmPABmZmZmZjwYAGNj" +
  "a2t/d2MAZmY8GDxmZgBmZmY8GBgYAH4GDBgwYH4AfGBgYGBgfAAAYDAYDAYAAD4GBgYGBj4APGYAAAAA" +
  "AAAAAAAAAAAA/zAYAAAAAAAAAAA8Bj5mPgBgYHxmZmZ8AAAAPGZgZjwABgY+ZmZmPgAAADxmfmA8ABww" +
  "MHwwMDAAAAA+ZmY+BjxgYHxmZmZmABgAOBgYGDwAGAA4GBgYGHBgYGZseGxmADgYGBgYGDwAAAA2f2tr" +
  "YwAAAHxmZmZmAAAAPGZmZjwAAAB8ZmZ8YGAAAD5mZj4GBwAAbHZgYGAAAAA+YDwGfAAwMHwwMDAcAAAA" +
  "ZmZmZj4AAABmZmY8GAAAAGNra382AAAAZjwYPGYAAABmZmY+BjwAAH4MGDB+AAwYGHAYGAwAGBgYGBgY" +
  "GAAwGBgOGBgwADFrRgAAAAAA//////////+MAAAi/AAEBPwAAwOq/QDg/ADwCP0AgP4A8Kr4AHyCfPgA" +
  "xgL++QA4gP0AfKr4AGCEfCD64Nz8AIQ8/QB4qvgAAQIBIP0AIP4A/QABqv0AECD2YOAA+QDw4Kr6AAID" +
  "/gAD+wAC+QABAyL2AICA+QDAwKr6AAcP+gALDAD9AA+q+gDAwCD8IED6AICA/QDAovkABAQg9gMD+QAD" +
  "A6L8ACBAIPKAIMD5AMDAqvwABwgg/QgA/gAHqv0A4P4AEAD+AOCq8QBggIDwAHCICHAg9wD5AHBw6gCA" +
  "gM+PwPn/IENzAJ/A4CDlv4D/jwB4eEDqaEBAjYAh//8gQ8gAxwAeIRsgAEAADwAQPDw46gAICIiAUPP/" +
  "qAAIyCD//8wACPjz/48ABwcHqsgAIEAB//8gqyC//uwAP///jwDAwMDqdAB4fwcDO/8gRVR8/0dHIVUw" +
  "OD+DPwAIfKoL/w4BAft/IB8KERAgewT/jwAODgTqAwQD/44AAPsgUQYEsYAQIHQBwID/vwADqhP/4BDg" +
  "DwMgWTDwBwcgVcAA/we/AODqAEeAB/j4//8go8cG/Pwg7wKPADh//foAAAI+XwiA9wCCgn4fB+Dg5AD+" +
  "P4DgjwABAQGq4gA//w0JINgh/QgMIPoP+I8AwMDA6gCABAf//2ANILyEAAAhnwAAjwB4+PjqAAgI+f78" +
  "fX8O/gMIAPn/ILUA/3yPAAcHBuoGBET8AAD8/yAVjkAEAwAg1QT8AA8AAYODA6poAuF/AAb/IBWiQkCd" +
  "DCBlwX5gBI8AgYGB+sYgRf8fHw//5Qhh/78PH/8gc8JfD58Ax4JUpH//nwCq9v/jf/D/QQEAASD39xFm" +
  "Dvj////+/BGq7//PDwD////P7//vEWb4/38/fxFm8P/94ICAEar3/+fw/0cBAAP3//cRZvz//PwRZvj/" +
  "/AAAEWb4/y8HBxFm+P/88OARpv7/e/D/9wAAABGm/v/f+P9/Hx8Rpvb/v/vw/z8AAAARZvj/f39/Ear3" +
  "//jw/9DAwID3//0RZn//VxGqf//5f/8Bf//7EWY//4D1EWZ//z8RZn///hGqP/839z//AOMgf38RZn//" +
  "9BGqP/+rzz//AU8//7vvEarf//wf/+Dg8N///hGmf//+P/8ABxGqf//Lf/9Jf//vEWb4/78DABGq+//8" +
  "+P/4oAD7//4RZvz/AwMRqvv/x/j/ggAA+//vEar+//rw//LAwMD+//4Rpv7/X/D/fw8DARFm/P/+4BGq" +
  "n//f/B//AID4IN/9Eaof/95ffyA/AAuf/99/Earv/zkP/wAAABHv/30Rqp//c38f/wMDPyC/+xGqP//7" +
  "9j//AFJ///sRZn//HxGqP//7/j//8Ph///sRqr//jz//Bw+//98RZvH/Pz8/Earv//zg/+jg4MD17//+" +
  "Ears/3G+Wg4A////IAog7vv7Eab9/3/h//z8fH4RZvD/XwcPDxFm8P/++PD6Eab9/+/w/z8PD78Rqn//" +
  "9z//A38AEap///t///EAEap//+d//6d///cRpvf/f/D/Pw8PBxGq9//88P+oAAAA9//+EWb4/z8ffxGm" +
  "/v/v8P/+gAAAEar1/3+/8P9+fj5//f+/Ear8/9LfDwD///+bIP33EWbw/38fDx8Rpv7/7/j/+ODgEWb4" +
  "/wsBAxFm/P/8+BFm+P/8+PgRqj//xv4//8D8IH/vEaof//39jx//AAAPn//93xFmf//9Eap//01//0l/" +
  "/98Rqn///n//wAARqj//6vM//wDTP//u+xGqf/+ff/8ff//fEag8/9v+AwD8/wYAIV37/gKo/P8HD/z/" +
  "Dwcg/geo/P/84CD+8P7/4KhS/1/+f78QIOL9P38P9v/9AKj8//mo/v8QIP4AqFL/X/5/vwAg4v0/f3/2" +
  "//0AqPj/8J2B+P/7owEh+fbBpP7/vwCo+P/9gID8/4jAIP3AqPz/fwH8/wMDIP0DqP7//P7//gCo+P/w" +
  "wAT4//vwAyD69gCo8P/fgAAG8P/PLAT++P9AAAeo8f/fgDDx/88sAPn/QADo9v/f/9+9Pv55//Z5fyBD" +
  "/7/f7z+oPP/bf/4A/P8AACFf33+6sAE/cADwAM4/ICFRCAAAIHcwYIMAwMDAgPD6D/8iEOMAQEDf/zAE" +
  "cjgERCA3L3/hjACAweM4OLoPAMfnwEDgz4BAuQICACA/wN+JACA8vAEB68DGICA0AHAAoQDjIOQEeJUA" +
  "4yAQQAAcHh4I+IAA6kDEBAQAPkE+qADkBH8BY5wA/ARAHI0AAwMDPqqfACAQIK9fEL8AH48A4ODg+gM/" +
  "PAA6PkIwI/8+ACpuQnAhUh8cGB4A5QA+BDyqNQD//QcBIMUICAUAIPcCjwACBwfqx/+BggGACIAgU9gC" +
  "A/Agc+AAAOwAAfB46gf/8AjwAQABIFaHeBgAIFN/gOAA7QDwAaoLAPyDQCOAIGv+Y8Agu4EAjAB+Pxzg" +
  "4PovnwGAAAcAAw8/QcEABgAFIB8ffwCdAICAB6o6AP8f4OAg2RAgECD6wMCNAODg4OCqIwL/g0AAACDL" +
  "gkIBPwD/g4wAfHw8AQHq//wEBAAgEAAg0gAB4BAfAP/8BIwAAwMD4ODqAP4iAgMEAwAgRQECIMcEIF/+" +
  "AosAAcHBA6B/ADB/ADggfwAwIH8AQCB/AAEgfwDAwEDf4P8Bx0TQ/zrROtI50zjFRdA60TrSOdM51DrV" +
  "OdY61zjYONk42jjbON043jjfPz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz0AADABAwQVFggXKjobKx4vPwEFFSUW" +
  "KRoqOis7Li8/AAAAAAEAAgADAAQABQAGAAcACAAJAAoACwAMAA0ADgAPAA8AEAARABIAEwAUABUAFgAX" +
  "ABgAGQAaABsAHAAdAB4AHwAgACEAIgAjACQAJQAmACcAJwAoACkAKgArACwALQAuAC8AMAAxADIAMwA0" +
  "ADUANgA3ADgAOQA5ADoAOwA8AD0APgA/AEAAQQBBAEIAQwBEAEUARgBHAEgASQBKAEsATABNAE4ATwBQ" +
  "AFEAUgBTAFQAVQBWAFcAWABUAFUAWQBaAFsAXABdAF4AQQBBAEEAQQBBAEEAQQBBAEEAQQBBAEEAQQBB" +
  "AEEAQQBBAEEAQQBBAEEAQQBBAEEAQQBBAEEAPAABAgMVFyorPwYaJCA6Ed3l3SEAAN059U1E7VMEwN1+" +
  "CDIGwN1+BjIAwHvWwHoXPx/egD4AF913/noH5gHdd/86AMC3KHLdy/9GIFjdfv63KFLtQwLA3X4EMgHA" +
  "OgHAtyhCOgPAy38gIjoDwO6A1oEwGSoCwFUeAN1uCCYAe7VferRXxSoEwM22QsEhAsB+xgh3MAIjNN1+" +
  "CMYC3XcIIQHANRi4IQTAfsYQdzACIzT9IQDA/TUAGIjd+d3h4fHxM+nd5d0hAADdOfUiB8A2ASoHwCNz" +
  "I3IqB8AjIyPdfgR3I91+BXcqB8ABDwAJNgEqB8ABEAAJ3V4GcyoHwAERAAndfgh3KgfAARIACd1+BoeH" +
  "h3cqB8ABEwAJ3VYIeoeHh4d3KgfAARQACTYAKgfAARUACTYCKgfAARYACd1+CncqB8ABFwAJ3X4LdyoH" +
  "wAEYAAk2AO1LB8AhGQAJTUR6h8VnLgBVBggpMAEZEPrBXXsC7UsHwCEaAAnrIRkACWbV3V4LLgBVBggp" +
  "MAEZEPrRfRIqB8ABGwAJNgAqB8ABHAAJr3cjdyoHwAEeAAmvdyN37UsHwCEmAAnrIRIACX7G/BLtSwfA" +
  "IScACeshEwAJfsb8Eu1LB8AhJAAJxev94f1+Et13/t02/wAhJgAJTgYA3X7+kU/dfv+YR8soyxl5Eu1L" +
  "B8AhJQAJxev94f1+E913/t02/wAhJwAJTgYA3X7+kU/dfv+YR8soyxl5EioHwAEgAAk2ACoHwAEhAAk2" +
  "ACM2Ad353eHh8fHx8end5d0hAADdOf0h9v/9Of353XX+3XT/Tnm3yr4r3W7+3Wb/IgnA3XX63XT73X76" +
  "xhzdd/zdfvvOAN13/d1u/N1m/V4jfrPKNSvdTvrdRvshHgAJfiMyDcB+Mg7AIQ3AtiAP3W783Wb9fiMy" +
  "DcB+Mg7AKg3AIgvAKg3AIyMiDcAqC8B+1oAgEN1u/N1m/X4jZm8iDcAiC8DdTvrdRvshGwAJfjIPwN1O" +
  "+t1G+wMK3Xf8Awrdd/0LOg/AKgvAXvV7B59X8Q8wByEAAL/tUuvdfvyDX91+/YpXewIDegLtSwnAAwMD" +
  "Ct13+AMK3Xf5CzoPwF8qC8Ajft13+gef3Xf7y0soEK/dlvrdd/yf3Zb73Xf9GAzdfvrdd/zdfvvdd/3d" +
  "fvzdhvhf3X793Y75V3sCA3oCOg/Ay1fKJSsqDcAiC8AqDcAjIyINwCoLwH7tSwnA1oAgEFlQIRwAGX4j" +
  "Zm8iDcAiC8BZUCEbABl+Mg/AAzMzaWDlft13+CN+3Xf5Og/ATyoLwH7dd/oHn913+8tBKBCv3Zb63Xf8" +
  "n92W+913/RgM3X763Xf83X773Xf93X743Yb8T91++d2O/Ufh5XEjcO1LCcADAwMK3Xf4Awrdd/kLOg/A" +
  "XyoLwCN+3Xf6B5/dd/vLSygQr92W+t13/J/dlvvdd/0YDN1++t13/N1++913/d1+/N2G+F/dfv3djvlX" +
  "ewIDegIqCcABHgAJOg3AdyM6DsB33X7+xg1P3X7/zgBHaWBeI1Z6syhh3X7+xgHdd/zdfv/OAN13/d1u" +
  "/N1m/X4jZm8Z691u/N1m/XMjcmlgI0bdbvzdZv1eI1bLeCgc3U7+3Ub/IRIACW4mABnLfCgZ3W7+3Wb/" +
  "NgAYD3rugNaBOAjdbv7dZv82ACoJwAEhAAlOI0YreLEoBAtxI3Dd+d3hyd3l3SEAAN059fX13XX+3XT/" +
  "Tnm3ypgs3W7+3Wb/IhDA7UsQwMX94f1eFsX94f1+GIMyEsDF/eH9fg+3IAxZUCEaABl+IRLAhndZUCER" +
  "ABl+3Xf63Tb7AFlQIRAAGX7dd/zdNv0AaWAjIyNeI1ZpYCNOI0Y6EsD1M91u+t1m++XdbvzdZv3laWDN" +
  "1ybtSxDAIRQACX63KAQ9dxg6IRgACesaMhPAaWDFARkACcF+IRPAhnchGgAJTjoTwJE4BSETwDYAOhPA" +
  "Eu1LEMAhFAAJ6yEVAAl+Et353eHJfLXI5c0qQeErGPXNsELNLUPD4ULrGrfIbyYA3xMY9iH//zYCyc28" +
  "LCEAgCIUwC4GIhbALhciGMAuJyIawDoFgCYAbykpKSkpASeACSIcwMnd5d0hAADdOSH2/zn53Xf+zbws" +
  "KhzA3XX83XT93Tb/AN1+/92W/tKjLd1u/N1m/U4GAN1u/N1m/SNeFgBpYM0VQzMz1d1+/N13+t1+/d13" +
  "+91u+t1m+yMjft13+913+t02+wBPBgBpYCkJ3XX43XT53X78xgTdd/rdfv3OAN13+91++t2G9t13/N1+" +
  "+92O9913/d1+/N2G+N139t1+/d2O+d13991+9t13/N1+9913/d00/8MNLd1e/N1W/d353eHJT0UqUcBe" +
  "eZMwBiNeeJM4Aq/JaSYAVMXNFUPBaCYAGesqU8AZfslMeQefR2lgy3goBCEHAAnLLMsdyyzLHcssyx1N" +
  "WnsHn1drYst6KAQhBwAZyyzLHcssyx3LLMsdec2uLbc+AcCvyc28LCoYwM3+QK9vzfFADgEqGMAGAAlu" +
  "xXnN8UDBDHnWEDjtKhTAEQUAGW4mACkpKSkp7VsawOUhIADNLkM+AfUzr/UzIQAD5RFgASGiGs3rQSFA" +
  "AcOkQt3l3SEAAN059fXNvCzdNv4A3Tb/ACpRwCNO3X7+BgDdd/zdcP3dfv+RMDXdfv/WGDAu3W7/3X7+" +
  "za4tX7coBBYAGAMRAADdbv8mACkpKSkpwcUJKXz2eGfP69/dNP8Ytd1G/3jWGDAYaCYAKSkpKSnR1Rkp" +
  "fPZ4Z88hAADfBBjj3TT+3X7+1iDafS7d+d3hyU9Fxc28LMFpJgApfPZ4Z88OACpRwCNeeZMwCcVpeM2u" +
  "LcEYAa9vJgDfDHnWGDjjyU89KBN5/gIoEP4DKA/+BCgO1gUoDRgOr8k+Ask+BMk+Bsk+CMmvyd3l3SEA" +
  "AN059TvNvCwOACpRwCMjRnmQ0hIwBgBpYCkJRVR4IVXAhiNfeo5XMzPVExMa3Xf/PcoOMN1+/9YFIAoh" +
  "L8AGAAl+tyBx4eVuJgApKSk6LsBfFgC/7VLr4eUjbiYAKSkpfcb4b3zO/2d71vh6Fz8f3n84Q3rugNaB" +
  "MDx91vh8Fz8f3n84MX3WwHwXPx/egDAm5cXV3X7/zSwv0cHh3Xf/Q6/dXv8WALNfeLJXfcYIbyYAxc22" +
  "QsEMw2Iv3fnd4cnd5d0hAADdOSH7/zn5Kh7AfAefRzouwF8WAHyTT3iaRyogwHwHn198xvjdd/t7zv/d" +
  "d/x51vh4Fz8f3n/aCDF47oDWgdIIMd1++9b43X78Fz8f3n/aCDHdfvvWwN1+/Bc/H96A0ggxOibAtyAG" +
  "3Tb9DhgXKiLAfLUoDDoswOYCxgzdd/0YBN02/Qo6KMC3KAmv3Xf+3Xf/GAjdNv4A3Tb/At1e/t1W/91+" +
  "+8YI3Xf+Dw8P5h8mAG8pKSkpKd1x/3kPDw/mHwYATwkpfPZ4Z8/dfv0OALNvebJn391G/w4A3X79FgCx" +
  "X3qwV91u/iYAzbZC3fnd4cnd5d0hAADdOSH6/zn57UsewCEiwH7dd/ojft13++HlCd11/N10/Xzdd/4H" +
  "n913/6/dvvrdnvviSDHugPLQMe1bIMDdTvzdfv3GBUfFaWDN1C3BtyARKiDAXXzGBVdpYM3ULbfKLjLd" +
  "fv7GBt13/N1+/84A3Xf93X783Xf+3X793Xf/3cv9figQ3X78xgfdd/7dfv3OAN13/91u/t1m/8ssyx3L" +
  "LMsdyyzLHSkpKX3G+U98zv/dcf3dNvwAIQAAIiLAGF7dy/t+KFjtWyDA3W783Wb9zdQttyAUKiDAXXzG" +
  "BVfdbvzdZv3N1C23KDTdbv7dZv/dy/9+KArdbv7dZv8RBwAZyyzLHcssyx3LLMsdI32Hh4fdd/3dNvwA" +
  "IQAAIiLAIR7A3X78dyPdfv133fnd4cnd5d0hAADdOSH4/zn57UsgwCEkwH7dd/gjft13+eHlCd11+t10" +
  "+3zdd/wHn913/d1+/MYH3Xf+3X79zgDdd/+v3b743Z754ooy7oDyFDPdTvrdfvvGB0cqHsARAAEZxVlQ" +
  "zdQtX8F7tyAPKh7AEQAEGVlQzdQttyhV3X7+3Xf63X7/3Xf73cv/figQ3X78xg7dd/rdfv3OAN13+8Hh" +
  "5cXLLMsdyyzLHcssyx0pKSl9xvlPfM7/3XH73Tb6ACEAACIkwCEmwDYBISrANgAYaCEmwDYAGGHdy/l+" +
  "KFsqHsB8PE/dXvrdVvthzdQttyATKh7AAQAECd1e+t1W+83ULbcoNd1O/N1G/d3L/X4oBt1O/t1G/8so" +
  "yxnLKMsZyyjLGQN5h4eH3Xf73Tb6ACEAACIkwCEnwDYAISDA3X76dyPdfvt33fnd4ck6JsC3wO1LJMAh" +
  "gAAJ6+1TJMAqFsABDQAJTiNGeZN4muKrM+6A8O1DJMDJ3eXdIQAA3Tn19fVNRN1z/t1y/yoWwN11/N10" +
  "/d1+/MYC3Xf63X79zgDdd/vLUShI7VsiwOHlfiNmb3uVX3qcV+1TIsAqFsB+I27tRN13/J+V3Xf9e92W" +
  "/Hrdnv3iEjTugPIhNCEiwN1+/Hcj3X79dyEowDYBw9w0y1koXBEiwBrdd/wTGt13/Rvh5X4jZm/dfvyF" +
  "3Xf63X79jN13+2ti3X76dyPdfvt3KhbAft13/CN+3Xf93X783Zb63X793Z774nY07oDygjTdfvwSE91+" +
  "/RIhKMA2ABhTOibAtygN4dHV5SEEABleI1YYC+HR1eUhCAAZXiNWKiLAxc0VQ8FaewefV+1TIsAqIsA+" +
  "57s+/5rixjTugPLcNBEZgCk/yxzLHe1SMAYhAAAiIsDdy/5mKHQ6JsDdd/0qFsB9xgpffM4AV91+/bco" +
  "IOteI26vk1+flVftUyTAKhbAEQwAGX4yJ8AhJsA2ABg9xQEPAAnBfrcoMzoqwLcgLeteI26vk1+flVft" +
  "UyTAKhbAEQwAGW4mAF1Uy3woAusTyyrLGyEnwHMhKsA2AREnwBq3KBrLYSgUKiTAfcb0T3zO/0ftQyTA" +
  "Gj0SGAKvEt353eHJ3eXdIQAA3Tkh9f85+SoewEx5B59HKiDAXHsHn1fF1c28LNHBIQcAGeMhBgAJ3XX3" +
  "3XT43Tb/ACpRwCMj3X7/ltLYNtXdXv8WAGtiKRnR3XX73XT83X77IVXAht13/d1+/COO3Xf+3X793Xf5" +
  "3X7+3Xf63W753Wb6biYAKSkp3XX73XT83W753Wb6I24mACkpKd1++92W991+/N2e+OIeNu6A8tI23X77" +
  "xgjdd/3dfvzOAN13/nndlv143Z7+4j427oDy0jZ93Zb1fN2e9uJONu6A8tI21REIABnRe5V6nOJgNu6A" +
  "8tI23W753Wb6IyN+/gIoDv4DKBH+BCgU1gUoRRhUIU/ANgEYTSFQwDYBGEYqFsDFAQoACcF+I2Zv1RGA" +
  "ARnRr5Xdd/2flN13/iEkwN1+/Xcj3X7+dyEnwDYAISbANgAYET4v3Yb/bz7AzgBnfrcgAjYB3TT/w7M1" +
  "3fnd4ckqHsBMeQefRyGE/wnrKlHAbiYAKSkpJct6KAMRAAB9k3ya4gQ37oDyCDfrIS7AczouwE8+/5Fv" +
  "zWNAOi7ATwYAWVDLeCgFIQcACevLKssbyyrLG8sqyxs6V8CTyHvGIG/mH0/Vec38LtEhV8BzySEtwH63" +
  "KAM9d8k2BAEswAo85gMCyd3l3SEAAN059U/FzbwswXnN7SztU1HA7UtRwCEEAAkiU8AqUcBOIwYAXhYA" +
  "aWDNFUMqU8AZIlXADgAhL8AGAAk2AAx51iA48iFPwDYAIVDANgAhLsA2ACFXwDYAIQAQIh7AJlAiIMBl" +
  "IiTAIiLAISbANgAhJ8A2ACEqwDYAISnANgAhKMA2ACEswDYAIS3ANgBOKlHAIyNGeZAwSAYAaWApCes6" +
  "VcCD3Xf+OlbAit13/+HlIyN+PSAo4eV+h4eHRw4A7UMewCpVwBkjbiYAKSkpfcb4T3zO/0EOAO1DIMAY" +
  "AwwYrs0qQSFAAc1LQCEACOURAAAmOM1pQs1sLiFAAc02QN353eHJTwYAxc0qQcHLQCgFIT8AGAMhAADF" +
  "zXdAwQR41gY45MUuAM13QMF5w2A33eXdIQAA3Tn19SEAAOPdNv8A/SoUwP1+BN13/q/NYDfNKkHBxcXN" +
  "N0HBMzPVeS9PeC9H3X78oV/dfv2gV+HlzbEzzYYzISbANgDNDTHNPzLNfDXN3TbNSzfNsELNUy/NFzDN" +
  "LUPN4UI6UMC3KAjdfv/NZzgYqjpPwLcopA48xc0qQcENIPjdNP/dfv/dlv44BN02/wDdfv/NYDcYg80q" +
  "QSFAAc1LQCEAQOURAABlzWlCzXxCzZBCLj8+Ac3kQCEAAeUhAAPlEWABIaIazetBIUABzaRCIUABzTZA" +
  "IQh6zyGXOc2xLCEIe88hqTnNsSzNKkHNN0F75jAo9c0qQc03QXvmMCD1yVBPQ0tFVCBQTEFURk9STUVS" +
  "AFByZXNzIDEgdG8gc3RhcnQALgHNgUAuAc2XQC4AzXdAzcIszS45zSpBIUABzUtAIQBA5REAAGXNaULN" +
  "FS4hQAHNNkDNkTgY23BvY2tldC1wbGF0Zm9ybWVyLXNtcwBQb2NrZXQgUGxhdGZvcm1lciBTTVMgRW5n" +
  "aW5lAEdlbmVyYXRlZCBieSBwb2NrZXQtcGxhdGZvcm1lci10by1zbXMgd2ViIGV4cG9ydGVyLgA6WMC3" +
  "yD6f038+v9N/Om3AtyAEPt/TfzpuwLcgBD7/038hWMA2AMk6WMC3wDpmwPaQ0386Z8D2sNN/Om3AtyAX" +
  "OmrA5g/2wNN/OmvA5j/TfzpowPbQ0386bsC3IBA6bMDmD/bg0386acD28NN/IVjANgHJzVg6IWDANgHR" +
  "wcXV7UNZwO1DW8DtQ13AIV/ANgAhY8A2ACFhwDafIVjANgHJIWDANgDJweHlxeXNyzrxIWDANgDJ/SFY" +
  "wP1uAMk+n9N/Pr/Tfz7f038+/9N/yd3l3SEAAN059f0hYsD9fgDdd/6v3Xf//U4AOljAtyhYOmbA5g9f" +
  "FgDh5Rk+D70+AJziXDvugPJkOxEPABgJOmbA5g+BXxefe/aQ0386Z8DmD18WAOHlGT4PvT4AnOKIO+6A" +
  "8pA7EQ8AGAk6Z8DmD4FfF5979rDTfzptwLcoCTpvwPbQ038YMjpYwLcoLDpowOYPXxYA4eUZPg+9PgCc" +
  "4sk77oDy0TsRDwAYCTpowOYPgV8Xn3v20NN/Om7AtygJOnDA9vDTfxgyOljAtygsOmnA5g9vJgDR1Rk+" +
  "D70+AJziCjzugPISPAEPABgJOmnA5g+BTxefefbw03/d+d3hyd3l3SEAAN059d1+BDJiwDpYwLfKDz06" +
  "ZsDmD08eAP0hYsD9fgDdd/6v3Xf/ed2G/kd73Y7/X/1OAD4PuD4Am+JpPO6A8nE8EQ8AGAk6ZsDmD4Ff" +
  "F5979pDTfzpnwOYPXxYA4eUZPg+9PgCc4pU87oDynTwRDwAYCTpnwOYPgV8Xn3v2sNN/Om3AtyAsOmjA" +
  "5g9vJgDR1Rk+D70+AJzixzzugPLPPBEPABgJOmjA5g+BXxefe/bQ0386bsC3ICw6acDmD28mANHVGT4P" +
  "vT4AnOL5PO6A8gE9AQ8AGAk6acDmD4FPF5959vDTf9353eHJ3eXdIQAA3Tn1OnHAt8rZPf0hYsD9fgDd" +
  "d/6v3Xf//U4AOm3AtyhNOljAtyg+OmrA5g/2wNN/OmvA5j/TfzpowOYPXxYA4eUZPg+9PgCc4mc97oDy" +
  "bz0RDwAYCTpowOYPgV8Xn3v20NN/GAQ+39N/IW3ANgA6bsC3KEY6WMC3KDc6bMDmD/bg0386acDmD28m" +
  "ANHVGT4PvT4AnOKzPe6A8rs9AQ8AGAk6acDmD4FPF5959vDTfxgEPv/TfyFuwDYAIXHANgDd+d3hyc0U" +
  "PSF5wDYA0cHF1e1DcsDtQ3TA7UN2wCF4wDYAIXrANgAhBAA5TstBKAURAQAYAxEAACFtwHPLSSgFAQEA" +
  "GAMBAAAhbsBxIXHANgHJIXnANgDJ/SFxwP1uAMn9IQQA/Tn9fgD1M/0r/Sv9bgD9ZgHlzd498TMhecA2" +
  "Ack6WMC3yDpfwLfC7j4qW8BGIzpjwLcoCT0yY8AgAypkwHj+gDh0MmHAy2cgOMt3yho/y28oIzJswDpu" +
  "wLfCaT46bMDmA/4DIHc6ccC3KHEybsA+/9N/w2k+MmrAOm3Atyhew2k+y3cgEMtvKAYyZ8DDID8yZsDD" +
  "ID/LbygMMmnAOm7AtyhAw2k+MmjAOm3Atyg0w2k+PTJfwMn+QDgGOmHAwzg//jgoBzgJ5gcyX8AiW8DJ" +
  "/ggwQv4AKDH+ASgnyXjTf8NpPnhP5g9HOmLAgP4POAI+D0d55vCw03/DaT7LdyApwxk/Il3Aw2k+OmDA" +
  "t8pYOipdwMNpPtYEMmPATiNGIyJkwCpZwAnDaT54MmvAOm3Atyiqw2k+yTpxwLfIOnjAt8KuPyp0wEYj" +
  "OnrAtygJPTJ6wCADKnvAeP5A2rM/y2coDMtvIAUyb8AYAzJwwNN/w4I/PTJ4wMn+OCgHOAnmBzJ4wCJ0" +
  "wMn+CDAf/gAoC/4BKAHJInbAw4I/OnnAt8oUPSp2wCJ0wMOCP9YEMnrATiNGIyJ7wCpywAnDgj/J237W" +
  "sCD6237WyCD6r2/N8UAOACErQAYACX7z07959oDTv/sMedYLOOrNsELN4ULDgUEEIP//////AAAA/+tK" +
  "IUzBBgAJfrN389O/efaA07/7yU1ceS9HIUzBFgAZfqB389O/e/aA07/7yfN9078+iNO/+8nzfdO/PonT" +
  "v/vJ833Tvz6H07/7yctFKAUB+wAYAwH/AHnz078+htO/+8nLRSgU5SECAc02QOE+EDJOwT4CMlDBGBLl" +
  "IQIBzUtA4T4IMk7BPgEyUMHLTSgTIQEBzTZAPhAyT8E6TsGHMk7BySEBAc1LQCFPwTYIyV9FFgAhAMAZ" +
  "z3jTvslfRRYAIRDAGc94077JEQDADr/z7VntUfsGEA6+7aMg/MkREMAOv/PtWe1R+wYQDr7toyD8yX3T" +
  "vskhfcA2ACF9wMtGKPnJ7VuDwMk6hcAvTzqGwC9HOoPAoV86hMCgV8k6g8D9IYXA/aYAXzqEwP2mAVfJ" +
  "OoPAL/U6hMAvT/H9IYXA/aYAX3n9pgFXyTp/wMkhf8A2AMkigcDJIofAyfN9078+itO/+8nbfkfbfrjI" +
  "w5tB9eXbvzJ+wAfSz0EhfcA2ASqDwCKFwNvcLyGDwHcj290vdyqBwHy1KBHD0kEqh8DF1f3lzSxD/eHR" +
  "weHx++1N5SF/wDYB4e1F3eXdIQAA3Tk76ykpKSkp68vy69XP4d1+Bt2uB913/91eBN1WBQYB3X4HoE/d" +
  "fv+gKA5+DA0oBNO+GBMv074YDnm3KAY+/9O+GAQ+ANO+yyB41hA40iMberMgyjPd4eHx8enL8g6/8+1Z" +
  "7VH70cHVCwQMWEHTvgAQ+x3CX0LJy/TPweHFDr7tWSsrfO1RtSD2yREAwA6/8+1Z7VH7BhCv074AEPvJ" +
  "ERDADr/z7VntUfsGEK/TvgAQ+8kiicDJ6yqJwBnDGAAhS8E2AMk6S8H+QDAeT33+0SgbIYvABgAJPXch" +
  "y8B5yyEJciNzPDJLwT3JPv/JPv7JIQB/zzpLwbcoJUcOviGLwO2jIPz+QCgEPtDteSGAf88OvjpLwYdH" +
  "IcvA7aMg/Mk+0NO+yU1Er2+wBhAgBAYIeSnLERcwARkQ9+vJ6cnL9M/r0cHVCwQMeEEOvu2jIPw9wjxD" +
  "yQQgCAgBAQUAeLEoCBFMwSFFQ+2wyQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
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
  "ZXIgU01TIEVuZ2luZQBwb2NrZXQtcGxhdGZvcm1lci1zbXMAU0RTQwEAAQElIMp/rX95f1RNUiBTRUdB" +
  "//+26JmZAEw=";
