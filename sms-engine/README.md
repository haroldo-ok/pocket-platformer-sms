# sms-engine

Z80 / Sega Master System engine for Pocket Platformer.

This directory contains the **C source** for the pre-compiled base ROM that is
embedded in `SmsExporter.js`. The web tool reads your Pocket Platformer project,
builds a binary resource blob (tiles, palette, maps, objects, physics config),
and appends it to a copy of this ROM to produce a downloadable `.sms` file.

---

## Files

| File | Description |
|------|-------------|
| `pocket_platformer.c` | Main engine: title screen, game loop, physics, scrolling, object interaction |
| `actor.c / actor.h`   | Sprite actor helper (draw, animate, path movement) from devkitSMS examples |
| `data/font.1bpp`      | 1bpp bitmap font used for HUD / title screen text |
| `lib/`                | Pre-built devkitSMS libraries (SMSlib, PSGlib, crt0) |
| `pocket_platformer.sms` | Pre-compiled ROM (kept here for reference; the live copy is embedded in `SmsExporter.js`) |
| `Makefile`            | Build instructions |

---

## Resource blob format

The JS exporter appends a binary blob immediately after the 32 KB engine ROM.
The engine maps it at address `0x8000` (ROM bank 2) and reads it via the
`RESOURCE_BANK` / `RESOURCE_BASE_ADDR` constants.

```
Offset  Size         Description
──────  ──────────── ────────────────────────────────────────────
0       4 bytes      Signature: "PPLT"
4       1 byte       level_count
5       1 byte       num_tiles  (unique BG tiles, tile 0 = blank)
6       17 bytes     physics_config struct (see below)
23      16 bytes     SMS palette  (16 × uint8, 2 bits/channel BGR)
39      num_tiles×32 BG tileset   (4bpp planar, 8×8 px per tile)
...     9×2×32       Sprite sheet (9 sprites × 2 halves × 32 bytes)
...     (repeated)   Level entries (see below)
```

### physics_config (17 bytes, all int16 are little-endian 8.8 fixed-point)

```
int16  max_speed
int16  ground_accel
int16  ground_friction
int16  air_accel
int16  air_friction
int16  jump_speed
uint8  max_jump_frames
int16  max_fall_speed
uint8  has_double_jump
uint8  has_wall_jump
```

### Sprite sheet tile order (VRAM offset 256)

```
Tiles 0-1   Start flag    (top / bottom 8×8 halves of an 8×16 sprite)
Tiles 2-3   Finish flag
Tiles 4-5   Spike
Tiles 6-7   Trampoline
Tiles 8-9   Collectible
Tiles 10-11 Player idle
Tiles 12-13 Player walk frame 0
Tiles 14-15 Player walk frame 1
Tiles 16-17 Player jump
```

### Level entry

```
uint8  map_w
uint8  map_h
uint8  obj_count
uint8  reserved (0)
map_w×map_h bytes  Tile indices, columnar order [x][y]  (0 = empty)
obj_count×3 bytes  Objects: x (tile), y (tile), type_id
```

### Object type IDs

```
1  startFlag   (player spawn point)
2  finishFlag  (level clear trigger)
3  spike       (kills player on touch)
4  trampoline  (launches player upward)
5  collectible (coin)
```

---

## Building

### Prerequisites

- [SDCC](https://sdcc.sourceforge.net/) ≥ 4.0 (provides the Z80 C compiler)
- [devkitSMS](https://github.com/sverx/devkitSMS) tools: `ihx2sms`, `folder2c`

**Install SDCC on Ubuntu/Debian:**
```bash
sudo apt install sdcc
```

**Build devkitSMS tools from source:**
```bash
git clone https://github.com/sverx/devkitSMS.git
gcc devkitSMS/ihx2sms/src/ihx2sms.c -o /usr/local/bin/ihx2sms
gcc devkitSMS/folder2c/src/folder2c.c -o /usr/local/bin/folder2c
```

### Build the ROM

```bash
cd sms-engine
make
```

### Re-embed the ROM in the web tool

After rebuilding, run this from the project root to update `SmsExporter.js`:

```bash
make -C sms-engine update-js
# or equivalently:
python3 tools/embed_rom.py sms-engine/pocket_platformer.sms SmsExporter.js
```

---

## Engine features

- **Full platformer physics**: gravity, variable-height jumping (hold button),
  optional double jump and wall jump (read from the physics config in the resource blob)
- **Horizontal scrolling**: SMS nametable column streaming — new tile columns are
  written to VRAM as the camera moves, keeping only 32 columns resident at once
- **Object interaction**: start/finish flags, spikes, trampolines, collectibles
- **Multi-level progression**: levels play in sequence; dying restarts the current level
- **8×16 tall sprites**: uses `SPRITEMODE_TALL` so each character/object uses two
  vertically-adjacent hardware sprites automatically
- **Title screen** with "Press 1 to start"
