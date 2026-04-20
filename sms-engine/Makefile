## Pocket Platformer — Sega Master System Engine
## Requires: SDCC, ihx2sms, folder2c  (all from devkitSMS)
##   https://github.com/sverx/devkitSMS

PRJNAME  := pocket_platformer
OBJS     := data.rel actor.rel $(PRJNAME).rel

.PHONY: all clean update-js

# ── Build the ROM ─────────────────────────────────────────────────────────────
all: $(PRJNAME).sms

# Pack the data/ folder into a C array (generates data.c + data.h)
data.c data.h: data/font.1bpp
	folder2c data data

# Compile each .c → .rel
%.rel: %.c
	sdcc -c -mz80 --peep-file lib/peep-rules.txt $<

# Link all .rel files → Intel HEX, then convert to SMS ROM
$(PRJNAME).sms: $(OBJS)
	sdcc -o $(PRJNAME).ihx -mz80 --no-std-crt0 --data-loc 0xC000 \
	     lib/crt0_sms.rel $(OBJS) lib/SMSlib.lib lib/PSGlib.rel
	ihx2sms $(PRJNAME).ihx $(PRJNAME).sms
	@echo ""
	@echo "Built: $(PRJNAME).sms"

# ── Re-embed the ROM into SmsExporter.js ─────────────────────────────────────
# Run this after rebuilding the ROM to keep the web tool in sync.
update-js: $(PRJNAME).sms
	python3 ../tools/embed_rom.py $(PRJNAME).sms ../SmsExporter.js
	@echo "SmsExporter.js updated with new ROM."

# ── Clean build artifacts ─────────────────────────────────────────────────────
clean:
	rm -f *.rel *.asm *.lst *.sym *.noi *.map *.lk *.ihx data.c data.h
	@echo "Cleaned. Run 'make' to rebuild."
