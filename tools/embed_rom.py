#!/usr/bin/env python3
"""
embed_rom.py — Re-embeds a compiled SMS ROM into SmsExporter.js.

Usage:
    python3 tools/embed_rom.py sms-engine/pocket_platformer.sms SmsExporter.js

Run this after rebuilding the engine (make -C sms-engine) to keep the
pre-compiled base ROM in SmsExporter.js in sync with the C source.
"""

import sys
import base64
import re

def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    rom_path = sys.argv[1]
    js_path  = sys.argv[2]

    # Load ROM and base64-encode it
    with open(rom_path, 'rb') as f:
        rom = f.read()

    if len(rom) < 32768:
        print(f"ERROR: ROM is {len(rom)} bytes — expected at least 32768.", file=sys.stderr)
        sys.exit(1)

    # Validate SEGA header at 0x7FF0
    sega_sig = rom[0x7FF0:0x7FF8]
    if sega_sig != b'TMR SEGA':
        print(f"WARNING: No SEGA header found at 0x7FF0 (got {sega_sig!r}). "
              "Make sure ihx2sms ran successfully.", file=sys.stderr)

    b64 = base64.b64encode(rom).decode('ascii')
    lines = [b64[i:i+80] for i in range(0, len(b64), 80)]
    b64_literal = '  "' + '" +\n  "'.join(lines) + '"'

    new_block = (
        "\n\n// Pre-compiled SMS base ROM (pocket_platformer.sms)\n"
        "// Built with SDCC + devkitSMS. Contains engine code only; "
        "game data is appended at runtime.\n"
        "// To rebuild: cd sms-engine && make && make update-js\n"
        f"SmsExporter.BASE_ROM_B64 =\n{b64_literal};\n"
    )

    # Read current JS
    with open(js_path, 'r') as f:
        src = f.read()

    marker = '\n\n// Pre-compiled SMS base ROM'
    idx = src.find(marker)
    if idx == -1:
        print(f"ERROR: Could not find ROM marker in {js_path}", file=sys.stderr)
        sys.exit(1)

    with open(js_path, 'w') as f:
        f.write(src[:idx] + new_block)

    print(f"OK  ROM: {len(rom):,} bytes  →  base64: {len(b64):,} chars  →  {js_path}")

if __name__ == '__main__':
    main()
