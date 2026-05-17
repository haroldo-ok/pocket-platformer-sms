#!/usr/bin/env python3
import sys

def ihx2sms(ihx_path, sms_path, rom_size=32768):
    rom = bytearray(rom_size)
    with open(ihx_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line.startswith(':'): continue
            count = int(line[1:3], 16)
            addr  = int(line[3:7], 16)
            rtype = int(line[7:9], 16)
            if rtype != 0: continue
            for i in range(count):
                byte = int(line[9 + i*2 : 11 + i*2], 16)
                if addr + i < rom_size:
                    rom[addr + i] = byte
    checksum = sum(rom[0x0000:0x7FF0]) & 0xFFFF
    rom[0x7FFA] = checksum & 0xFF
    rom[0x7FFB] = (checksum >> 8) & 0xFF
    with open(sms_path, 'wb') as f:
        f.write(rom)
    used = rom_size - rom.count(0)
    print(f"Info: {used} bytes used/{rom_size} total [{used/rom_size*100:.2f}%]")
    print(f"Info: SEGA header found, checksum updated")

if __name__ == '__main__':
    ihx2sms(sys.argv[1], sys.argv[2])
