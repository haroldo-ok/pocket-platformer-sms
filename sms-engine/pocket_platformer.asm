;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module pocket_platformer
	.optsdcc -mz80
	
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl ___SMS__SDSC_signature
	.globl ___SMS__SDSC_descr
	.globl ___SMS__SDSC_name
	.globl ___SMS__SDSC_author
	.globl ___SMS__SEGA_signature
	.globl _main
	.globl _SMS_VRAMmemsetW
	.globl _SMS_VRAMmemcpy
	.globl _SMS_getKeysStatus
	.globl _SMS_print
	.globl _SMS_configureTextRenderer
	.globl _SMS_zeroSpritePalette
	.globl _SMS_zeroBGPalette
	.globl _SMS_loadBGPalette
	.globl _SMS_setSpritePaletteColor
	.globl _SMS_setBGPaletteColor
	.globl _SMS_copySpritestoSAT
	.globl _SMS_finalizeSprites
	.globl _SMS_addSprite_f
	.globl _SMS_initSprites
	.globl _SMS_load1bppTiles
	.globl _SMS_crt0_RST18
	.globl _SMS_crt0_RST08
	.globl _SMS_waitForVBlank
	.globl _SMS_setSpriteMode
	.globl _SMS_useFirstHalfTilesforSprites
	.globl _SMS_setBackdropColor
	.globl _SMS_setBGScrollX
	.globl _SMS_VDPturnOffFeature
	.globl _SMS_VDPturnOnFeature
	.globl _SMS_SRAM
	.globl _SRAM_bank_to_be_mapped_on_slot2
	.globl _ROM_bank_to_be_mapped_on_slot0
	.globl _ROM_bank_to_be_mapped_on_slot1
	.globl _ROM_bank_to_be_mapped_on_slot2
;--------------------------------------------------------
; special function registers
;--------------------------------------------------------
_SMS_VDPControlPort	=	0x00bf
;--------------------------------------------------------
; ram data
;--------------------------------------------------------
	.area _DATA
_ROM_bank_to_be_mapped_on_slot2	=	0xffff
_ROM_bank_to_be_mapped_on_slot1	=	0xfffe
_ROM_bank_to_be_mapped_on_slot0	=	0xfffd
_SRAM_bank_to_be_mapped_on_slot2	=	0xfffc
_SMS_SRAM	=	0x8000
_res_header:
	.ds 2
_res_physics:
	.ds 2
_res_palette:
	.ds 2
_res_tileset:
	.ds 2
_res_sprites:
	.ds 2
_res_levels:
	.ds 2
_player:
	.ds 32
_camera_x:
	.ds 2
_prev_cam_x:
	.ds 2
_coin_collected:
	.ds 128
_level_complete:
	.ds 1
_player_died:
	.ds 1
_vp_blocks:
	.ds 144
_vp_block_count:
	.ds 1
_vp_violet_active:
	.ds 1
_rb_blocks:
	.ds 144
_rb_switches:
	.ds 16
_rb_block_count:
	.ds 1
_rb_switch_count:
	.ds 1
_rb_red_active:
	.ds 1
_rb_switch_locked:
	.ds 1
_prev_player_y:
	.ds 4
_disp_blocks:
	.ds 64
_fg_disp_blocks:
	.ds 48
_cur_level:
	.ds 2
_cur_map:
	.ds 2
_cur_objects:
	.ds 2
;--------------------------------------------------------
; ram data
;--------------------------------------------------------
	.area _INITIALIZED
_treadmill_bonus:
	.ds 4
_treadmill_active:
	.ds 1
;--------------------------------------------------------
; absolute external ram data
;--------------------------------------------------------
	.area _DABS (ABS)
;--------------------------------------------------------
; global & static initialisations
;--------------------------------------------------------
	.area _HOME
	.area _GSINIT
	.area _GSFINAL
	.area _GSINIT
;--------------------------------------------------------
; Home
;--------------------------------------------------------
	.area _HOME
	.area _HOME
;--------------------------------------------------------
; code
;--------------------------------------------------------
	.area _CODE
;pocket_platformer.c:208: static unsigned char has_resource(void) {
;	---------------------------------
; Function has_resource
; ---------------------------------
_has_resource:
;pocket_platformer.c:210: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:211: return (p[0]=='P' && p[1]=='P' && p[2]=='L' && p[3]=='T');
	ld	a, (#0x8000)
	sub	a, #0x50
	jr	NZ, 00103$
	ld	a, (#0x8001)
	sub	a, #0x50
	jr	NZ, 00103$
	ld	a, (#0x8002)
	sub	a, #0x4c
	jr	NZ, 00103$
	ld	a, (#0x8003)
	sub	a, #0x54
	jr	Z, 00104$
00103$:
	xor	a, a
	ret
00104$:
	ld	a, #0x01
;pocket_platformer.c:212: }
	ret
;pocket_platformer.c:214: static void init_resources(void) {
;	---------------------------------
; Function init_resources
; ---------------------------------
_init_resources:
;pocket_platformer.c:215: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:216: res_header  = (resource_header *)RESOURCE_BASE_ADDR;
	ld	hl, #0x8000
	ld	(_res_header), hl
;pocket_platformer.c:217: res_physics = (physics_config  *)(RESOURCE_BASE_ADDR + sizeof(resource_header));
	ld	l, #0x28
	ld	(_res_physics), hl
;pocket_platformer.c:218: res_palette = (unsigned char   *)res_physics + sizeof(physics_config);
	ld	l, #0x39
	ld	(_res_palette), hl
;pocket_platformer.c:219: res_tileset = res_palette + 16;
	ld	l, #0x49
	ld	(_res_tileset), hl
;pocket_platformer.c:221: res_sprites = res_tileset + (unsigned int)res_header->num_tiles * 32u;
	ld	a, (#0x8005)
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	bc,#0x8049
	add	hl,bc
	ld	(_res_sprites), hl
;pocket_platformer.c:222: res_levels  = (level_header *)(res_sprites + 10u * 32u);
	ld	hl, (_res_sprites)
	ld	de, #0x0140
	add	hl, de
	ld	(_res_levels), hl
;pocket_platformer.c:223: }
	ret
;pocket_platformer.c:225: static level_header *get_level(unsigned char n) {
;	---------------------------------
; Function get_level
; ---------------------------------
_get_level:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-10
	add	hl, sp
	ld	sp, hl
	ld	-2 (ix), a
;pocket_platformer.c:226: level_header *lh = res_levels;
	ld	hl, (_res_levels)
	ld	-4 (ix), l
	ld	-3 (ix), h
;pocket_platformer.c:228: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:229: for (i = 0; i < n; i++) {
	ld	-1 (ix), #0x00
00103$:
	ld	a, -1 (ix)
	sub	a, -2 (ix)
	jp	NC, 00101$
;pocket_platformer.c:230: unsigned int sz = sizeof(level_header)
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	c, (hl)
	ld	b, #0x00
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	e, (hl)
	ld	d, #0x00
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	call	__mulint
	ld	hl, #0x0004
	add	hl, de
	ex	(sp), hl
	ld	a, -4 (ix)
	ld	-6 (ix), a
	ld	a, -3 (ix)
	ld	-5 (ix), a
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	inc	hl
	inc	hl
	ld	a, (hl)
	ld	-5 (ix), a
	ld	-6 (ix), a
	ld	-5 (ix), #0x00
	ld	c, a
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	-8 (ix), l
	ld	-7 (ix), h
	ld	a, -10 (ix)
	add	a, -8 (ix)
	ld	-6 (ix), a
	ld	a, -9 (ix)
	adc	a, -7 (ix)
	ld	-5 (ix), a
	ld	a, -6 (ix)
	ld	-8 (ix), a
	ld	a, -5 (ix)
	ld	-7 (ix), a
;pocket_platformer.c:233: lh = (level_header *)((unsigned char *)lh + sz);
	ld	a, -4 (ix)
	ld	-6 (ix), a
	ld	a, -3 (ix)
	ld	-5 (ix), a
	ld	a, -6 (ix)
	add	a, -8 (ix)
	ld	-4 (ix), a
	ld	a, -5 (ix)
	adc	a, -7 (ix)
	ld	-3 (ix), a
;pocket_platformer.c:229: for (i = 0; i < n; i++) {
	inc	-1 (ix)
	jp	00103$
00101$:
;pocket_platformer.c:235: return lh;
	ld	e, -4 (ix)
	ld	d, -3 (ix)
;pocket_platformer.c:236: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:241: static unsigned char get_tile(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function get_tile
; ---------------------------------
_get_tile:
	ld	c, a
	ld	b, l
;pocket_platformer.c:242: if (tx >= cur_level->map_w || ty >= cur_level->map_h) return 0;
	ld	hl, (_cur_level)
	ld	e, (hl)
	ld	a, c
	sub	a, e
	jr	NC, 00101$
	inc	hl
	ld	e, (hl)
	ld	a, b
	sub	a, e
	jr	C, 00102$
00101$:
	xor	a, a
	ret
00102$:
;pocket_platformer.c:243: return cur_map[(unsigned int)tx * cur_level->map_h + ty];
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
	ld	d, h
	push	bc
	call	__mulint
	pop	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, de
	ex	de, hl
	ld	hl, (_cur_map)
	add	hl, de
	ld	a, (hl)
;pocket_platformer.c:244: }
	ret
;pocket_platformer.c:247: static disp_entry *disp_find(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function disp_find
; ---------------------------------
_disp_find:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	ld	-1 (ix), a
	ld	-2 (ix), l
;pocket_platformer.c:249: for (i = 0; i < MAX_DISP; i++)
	ld	c, #0x00
00106$:
;pocket_platformer.c:250: if (disp_blocks[i].frame && disp_blocks[i].tx == tx && disp_blocks[i].ty == ty)
	ld	e, c
	ld	d, #0x00
	ex	de, hl
	add	hl, hl
	add	hl, hl
	ld	de, #_disp_blocks
	add	hl, de
;	spillPairReg hl
;	spillPairReg hl
	ld	e, l
	ld	d, h
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	ld	a, (hl)
	or	a, a
	jr	Z, 00107$
	ld	a, (de)
	ld	b, a
	ld	a, -1 (ix)
	sub	a, b
	jr	NZ, 00107$
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a,-2 (ix)
	sub	a,(hl)
	jr	Z, 00108$
;pocket_platformer.c:251: return &disp_blocks[i];
	jr	00107$
00107$:
;pocket_platformer.c:249: for (i = 0; i < MAX_DISP; i++)
	inc	c
	ld	a, c
	sub	a, #0x10
	jr	C, 00106$
;pocket_platformer.c:252: return 0;
	ld	de, #0x0000
00108$:
;pocket_platformer.c:253: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:255: static void disp_touch(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function disp_touch
; ---------------------------------
_disp_touch:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	ld	-1 (ix), a
;pocket_platformer.c:257: if (disp_find(tx, ty)) return; /* already active */
	ld	-2 (ix), l
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_find
	ld	a, d
;pocket_platformer.c:258: for (i = 0; i < MAX_DISP; i++) {
	or	a,e
	jr	NZ, 00108$
	ld	l,a
;	spillPairReg hl
;	spillPairReg hl
00106$:
;pocket_platformer.c:259: if (!disp_blocks[i].frame) {
	ld	e, l
	ld	d, #0x00
	ex	de, hl
	add	hl, hl
	add	hl, hl
	ex	de, hl
	ld	a, #<(_disp_blocks)
	add	a, e
	ld	c, a
	ld	a, #>(_disp_blocks)
	adc	a, d
	ld	b, a
	ld	e, c
	ld	d, b
	inc	de
	inc	de
	ld	a, (de)
	or	a, a
	jr	NZ, 00107$
;pocket_platformer.c:260: disp_blocks[i].tx = tx;
	ld	a, -1 (ix)
	ld	(bc), a
;pocket_platformer.c:261: disp_blocks[i].ty = ty;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a, -2 (ix)
	ld	(hl), a
;pocket_platformer.c:262: disp_blocks[i].frame = 1;
	ld	a, #0x01
	ld	(de), a
;pocket_platformer.c:263: disp_blocks[i].is_connected = 0;
	inc	bc
	inc	bc
	inc	bc
	xor	a, a
	ld	(bc), a
;pocket_platformer.c:264: return;
	jr	00108$
00107$:
;pocket_platformer.c:258: for (i = 0; i < MAX_DISP; i++) {
	inc	l
	ld	a, l
	sub	a, #0x10
	jr	C, 00106$
00108$:
;pocket_platformer.c:267: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:270: static void disp_touch_connected(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function disp_touch_connected
; ---------------------------------
_disp_touch_connected:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	dec	sp
	ld	-1 (ix), a
;pocket_platformer.c:272: if (disp_find(tx, ty)) return; /* already triggered */
	ld	-2 (ix), l
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_find
	ld	c, e
	ld	a, d
	or	a, c
	jr	NZ, 00120$
;pocket_platformer.c:273: disp_touch(tx, ty);
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_touch
;pocket_platformer.c:276: disp_entry *e = disp_find(tx, ty);
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_find
	ld	c, e
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;pocket_platformer.c:277: if (e) e->is_connected = 1;
	ld	a,d
	ld	h,a
	or	a, c
	jr	Z, 00130$
	inc	hl
	inc	hl
	inc	hl
	ld	(hl), #0x01
;pocket_platformer.c:280: for (dx = -1; dx <= 1; dx++) {
00130$:
	ld	c, #0xff
;pocket_platformer.c:281: for (dy = -1; dy <= 1; dy++) {
00128$:
	ld	e, #0xff
00117$:
;pocket_platformer.c:283: if (dx == 0 && dy == 0) continue;
	ld	a, c
	or	a,a
	jr	NZ, 00106$
	or	a,e
	jr	Z, 00114$
00106$:
;pocket_platformer.c:284: if (dx != 0 && dy != 0) continue; /* diagonal - skip */
	ld	a, c
	or	a, a
	jr	Z, 00109$
	ld	a, e
	or	a, a
	jr	NZ, 00114$
00109$:
;pocket_platformer.c:285: nx = (unsigned char)((int)tx + dx);
	ld	a, -1 (ix)
	add	a, c
	ld	-3 (ix), a
;pocket_platformer.c:286: ny = (unsigned char)((int)ty + dy);
	ld	a, -2 (ix)
	add	a, e
	ld	b, a
;pocket_platformer.c:287: if (get_tile(nx, ny) == res_header->conn_vram_idx && res_header->conn_vram_idx)
	push	bc
	push	de
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -3 (ix)
	call	_get_tile
	pop	de
	pop	bc
	ld	iy, (_res_header)
	push	af
	ld	d, 8 (iy)
	pop	af
	sub	a,d
	jr	NZ, 00114$
	or	a,d
	jr	Z, 00114$
;pocket_platformer.c:288: disp_touch_connected(nx, ny);
	push	bc
	push	de
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -3 (ix)
	call	_disp_touch_connected
	pop	de
	pop	bc
00114$:
;pocket_platformer.c:281: for (dy = -1; dy <= 1; dy++) {
	inc	e
	ld	a, #0x01
	sub	a, e
	jp	PO, 00171$
	xor	a, #0x80
00171$:
	jp	P, 00117$
;pocket_platformer.c:280: for (dx = -1; dx <= 1; dx++) {
	inc	c
	ld	a, #0x01
	sub	a, c
	jp	PO, 00172$
	xor	a, #0x80
00172$:
	jp	P, 00128$
00120$:
;pocket_platformer.c:291: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:294: static unsigned char disp_is_gone(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function disp_is_gone
; ---------------------------------
_disp_is_gone:
;pocket_platformer.c:295: disp_entry *e = disp_find(tx, ty);
	call	_disp_find
	ld	c, e
;pocket_platformer.c:296: return (e && e->frame >= DISP_GONE_AT) ? 1 : 0;
	ld	a,d
	ld	b,a
	or	a, e
	jr	Z, 00103$
	inc	bc
	inc	bc
	ld	a, (bc)
	sub	a, #0x28
	jr	C, 00103$
	ld	a, #0x01
	ret
00103$:
	xor	a, a
;pocket_platformer.c:297: }
	ret
;pocket_platformer.c:300: static fg_disp_entry *fg_disp_find(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function fg_disp_find
; ---------------------------------
_fg_disp_find:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	ld	-1 (ix), a
	ld	-2 (ix), l
;pocket_platformer.c:302: for (i = 0; i < MAX_FG_DISP; i++)
	ld	c, #0x00
00106$:
;pocket_platformer.c:303: if (fg_disp_blocks[i].frame && fg_disp_blocks[i].tx == tx && fg_disp_blocks[i].ty == ty)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	a, #<(_fg_disp_blocks)
	add	a, l
	ld	e, a
	ld	a, #>(_fg_disp_blocks)
	adc	a, h
	ld	d, a
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	ld	a, (hl)
	or	a, a
	jr	Z, 00107$
	ld	a, (de)
	ld	b, a
	ld	a, -1 (ix)
	sub	a, b
	jr	NZ, 00107$
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a,-2 (ix)
	sub	a,(hl)
	jr	Z, 00108$
;pocket_platformer.c:304: return &fg_disp_blocks[i];
	jr	00107$
00107$:
;pocket_platformer.c:302: for (i = 0; i < MAX_FG_DISP; i++)
	inc	c
	ld	a, c
	sub	a, #0x10
	jr	C, 00106$
;pocket_platformer.c:305: return 0;
	ld	de, #0x0000
00108$:
;pocket_platformer.c:306: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:311: static void fg_disp_touch_connected(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function fg_disp_touch_connected
; ---------------------------------
_fg_disp_touch_connected:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	dec	sp
	ld	c, a
	ld	-1 (ix), l
;pocket_platformer.c:315: if (fg_disp_find(tx, ty)) return;
	push	bc
	ld	l, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_fg_disp_find
	pop	bc
	ld	a, d
	or	a, e
	jr	NZ, 00110$
;pocket_platformer.c:316: fg_disp_touch(tx, ty);
	push	bc
	ld	l, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_fg_disp_touch
	pop	bc
;pocket_platformer.c:317: for (d = 0; d < 4; d++) {
	ld	e, #0x00
00108$:
;pocket_platformer.c:318: unsigned char nx = (unsigned char)(tx + dx[d]);
	ld	hl, #_fg_disp_touch_connected_dx_65536_191
	ld	d, #0x00
	add	hl, de
	ld	a, (hl)
	ld	b, c
	add	a, b
	ld	-3 (ix), a
;pocket_platformer.c:319: unsigned char ny = (unsigned char)(ty + dy[d]);
	ld	hl, #_fg_disp_touch_connected_dy_65536_191
	ld	d, #0x00
	add	hl, de
	ld	a, (hl)
	ld	b, -1 (ix)
	add	a, b
	ld	-2 (ix), a
;pocket_platformer.c:320: unsigned char t = get_tile(nx, ny);
	push	bc
	push	de
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -3 (ix)
	call	_get_tile
	pop	de
	pop	bc
;pocket_platformer.c:322: if (res_header->fg_disp_vram_idx &&
	ld	iy, (_res_header)
	push	af
	ld	b, 37 (iy)
	pop	af
	inc	b
	dec	b
	jr	Z, 00109$
;pocket_platformer.c:323: t == (res_header->fg_disp_vram_idx | 0x80) &&
	set	7, b
	sub	a, b
	jr	NZ, 00109$
;pocket_platformer.c:324: !fg_disp_find(nx, ny))
	push	bc
	push	de
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -3 (ix)
	call	_fg_disp_find
	ex	de, hl
	pop	de
	pop	bc
	ld	a, h
	or	a, l
	jr	NZ, 00109$
;pocket_platformer.c:325: fg_disp_touch_connected(nx, ny);
	push	bc
	push	de
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -3 (ix)
	call	_fg_disp_touch_connected
	pop	de
	pop	bc
00109$:
;pocket_platformer.c:317: for (d = 0; d < 4; d++) {
	inc	e
	ld	a, e
	sub	a, #0x04
	jr	C, 00108$
00110$:
;pocket_platformer.c:327: }
	ld	sp, ix
	pop	ix
	ret
_fg_disp_touch_connected_dx_65536_191:
	.db #0x01	;  1
	.db #0xff	; -1
	.db #0x00	;  0
	.db #0x00	;  0
_fg_disp_touch_connected_dy_65536_191:
	.db #0x00	;  0
	.db #0x00	;  0
	.db #0x01	;  1
	.db #0xff	; -1
;pocket_platformer.c:329: static void fg_disp_touch(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function fg_disp_touch
; ---------------------------------
_fg_disp_touch:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	ld	-1 (ix), a
;pocket_platformer.c:331: if (fg_disp_find(tx, ty)) return;
	ld	-2 (ix), l
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_fg_disp_find
	ld	a, d
;pocket_platformer.c:332: for (i = 0; i < MAX_FG_DISP; i++) {
	or	a,e
	jr	NZ, 00108$
	ld	c,a
00106$:
;pocket_platformer.c:333: if (!fg_disp_blocks[i].frame) {
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	de, #_fg_disp_blocks
	add	hl, de
	ld	e, l
	ld	d, h
	inc	de
	inc	de
	ld	a, (de)
	or	a, a
	jr	NZ, 00107$
;pocket_platformer.c:334: fg_disp_blocks[i].tx = tx;
	ld	a, -1 (ix)
	ld	(hl), a
;pocket_platformer.c:335: fg_disp_blocks[i].ty = ty;
	inc	hl
	ld	a, -2 (ix)
	ld	(hl), a
;pocket_platformer.c:336: fg_disp_blocks[i].frame = 1;
	ld	a, #0x01
	ld	(de), a
;pocket_platformer.c:337: return;
	jr	00108$
00107$:
;pocket_platformer.c:332: for (i = 0; i < MAX_FG_DISP; i++) {
	inc	c
	ld	a, c
	sub	a, #0x10
	jr	C, 00106$
00108$:
;pocket_platformer.c:340: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:350: static unsigned char is_solid_px(long fpx, long fpy) {
;	---------------------------------
; Function is_solid_px
; ---------------------------------
_is_solid_px:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	iy, #-24
	add	iy, sp
	ld	sp, iy
;pocket_platformer.c:352: long px = fpx >> 8, py = fpy >> 8;
	ld	b, #0x08
00267$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00267$
	ld	-20 (ix), e
	ld	-19 (ix), d
	ld	-18 (ix), l
	ld	-17 (ix), h
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, 4 (ix)
	ld	-16 (ix), a
	ld	a, 5 (ix)
	ld	-15 (ix), a
	ld	a, 6 (ix)
	ld	-14 (ix), a
	ld	a, 7 (ix)
	ld	-13 (ix), a
	ld	b, #0x08
00269$:
	sra	-13 (ix)
	rr	-14 (ix)
	rr	-15 (ix)
	rr	-16 (ix)
	djnz	00269$
	ld	hl, #15
	add	hl, sp
	ex	de, hl
	ld	hl, #8
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:353: if (px < 0 || py < 0) return 1;
	ld	a, -21 (ix)
	rlca
	and	a,#0x01
	ld	-5 (ix), a
	or	a, a
	jr	NZ, 00101$
	ld	a, -6 (ix)
	rlca
	and	a,#0x01
	jr	Z, 00102$
00101$:
	ld	a, #0x01
	jp	00132$
00102$:
;pocket_platformer.c:355: (unsigned char)(py / TILE_SIZE));
	ld	hl, #20
	add	hl, sp
	ex	de, hl
	ld	hl, #15
	add	hl, sp
	ld	bc, #4
	ldir
	or	a, a
	jr	Z, 00134$
	ld	a, -9 (ix)
	add	a, #0x07
	ld	-4 (ix), a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
00134$:
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	srl	h
	rr	l
	srl	h
	rr	l
	srl	h
	rr	l
;pocket_platformer.c:354: t = get_tile((unsigned char)(px / TILE_SIZE),
	pop	bc
	push	bc
	ld	a, -5 (ix)
	or	a, a
	jr	Z, 00135$
	ld	a, -24 (ix)
	add	a, #0x07
	ld	c, a
	ld	a, -23 (ix)
	adc	a, #0x00
	ld	b, a
00135$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	a, c
	call	_get_tile
;pocket_platformer.c:356: if (t == 0) return 0;
	ld	-12 (ix), a
	or	a, a
	jr	NZ, 00105$
	xor	a, a
	jp	00132$
00105$:
;pocket_platformer.c:358: if (t & 0x80) return 0;
	bit	7, -12 (ix)
	jr	Z, 00107$
	xor	a, a
	jp	00132$
00107$:
;pocket_platformer.c:360: if (res_header->one_way_vram_idx && t == res_header->one_way_vram_idx) return 0;
	ld	bc, (_res_header)
	push	bc
	pop	iy
	ld	e, 6 (iy)
	ld	a, e
	or	a, a
	jr	Z, 00151$
	ld	a, -12 (ix)
	sub	a, e
	jr	NZ, 00151$
	xor	a, a
	jp	00132$
;pocket_platformer.c:364: for (di = 0; di < 18; di++) {
00151$:
	ld	e, #0x00
00130$:
;pocket_platformer.c:365: if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
	ld	hl, #0x0013
	add	hl, bc
	ld	d, #0x00
	add	hl, de
	ld	d, (hl)
	ld	a, d
	or	a, a
	jr	Z, 00131$
	ld	a, -12 (ix)
	sub	a, d
	jr	NZ, 00131$
	xor	a, a
	jp	00132$
00131$:
;pocket_platformer.c:364: for (di = 0; di < 18; di++) {
	inc	e
	ld	a, e
	sub	a, #0x12
	jr	C, 00130$
;pocket_platformer.c:370: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	a, -17 (ix)
	rlca
	and	a,#0x01
	ld	-11 (ix), a
	ld	a, -20 (ix)
	add	a, #0x07
	ld	-10 (ix), a
	ld	a, -19 (ix)
	adc	a, #0x00
	ld	-9 (ix), a
	ld	a, -18 (ix)
	adc	a, #0x00
	ld	-8 (ix), a
	ld	a, -17 (ix)
	adc	a, #0x00
	ld	-7 (ix), a
;pocket_platformer.c:371: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	a, -13 (ix)
	rlca
	and	a,#0x01
	ld	-6 (ix), a
	ld	a, -16 (ix)
	add	a, #0x07
	ld	-5 (ix), a
	ld	a, -15 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
;pocket_platformer.c:369: if (vp_block_count) {
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00118$
;pocket_platformer.c:370: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -11 (ix)
	or	a, a
	jr	Z, 00136$
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #14
	add	hl, sp
	ld	bc, #4
	ldir
00136$:
	pop	bc
	push	bc
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:371: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	c, -16 (ix)
	ld	b, -15 (ix)
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00137$
	ld	c, -5 (ix)
	ld	b, -4 (ix)
00137$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:372: if (vp_is_passable(dtx, dty)) return 0;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_vp_is_passable
	or	a, a
	jr	Z, 00118$
	xor	a, a
	jp	00132$
00118$:
;pocket_platformer.c:375: if (rb_block_count) {
	ld	a, (_rb_block_count+0)
	or	a, a
	jr	Z, 00122$
;pocket_platformer.c:376: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	c, -20 (ix)
	ld	b, -19 (ix)
	ld	a, -11 (ix)
	or	a, a
	jr	Z, 00138$
	ld	c, -10 (ix)
	ld	b, -9 (ix)
00138$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:377: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	c, -16 (ix)
	ld	b, -15 (ix)
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00139$
	ld	c, -5 (ix)
	ld	b, -4 (ix)
00139$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:378: if (rb_is_passable(dtx, dty)) return 0;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_rb_is_passable
	or	a, a
	jr	Z, 00122$
	xor	a, a
	jp	00132$
00122$:
;pocket_platformer.c:382: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	c, -20 (ix)
	ld	b, -19 (ix)
	ld	e, -18 (ix)
	ld	d, -17 (ix)
	ld	a, -11 (ix)
	or	a, a
	jr	Z, 00140$
	ld	c, -10 (ix)
	ld	b, -9 (ix)
	ld	e, -8 (ix)
	ld	d, -7 (ix)
00140$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:383: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	hl, #14
	add	hl, sp
	ex	de, hl
	ld	hl, #8
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00141$
	ld	hl, #14
	add	hl, sp
	ex	de, hl
	ld	hl, #19
	add	hl, sp
	ld	bc, #4
	ldir
00141$:
	ld	a, -10 (ix)
	ld	-3 (ix), a
	ld	a, -9 (ix)
	ld	-2 (ix), a
	srl	-2 (ix)
	rr	-3 (ix)
	srl	-2 (ix)
	rr	-3 (ix)
	srl	-2 (ix)
	rr	-3 (ix)
	ld	a, -3 (ix)
	ld	-4 (ix), a
;pocket_platformer.c:360: if (res_header->one_way_vram_idx && t == res_header->one_way_vram_idx) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:384: if ((res_header->disp_vram_idx && t == res_header->disp_vram_idx &&
	ld	-3 (ix), l
	ld	-2 (ix), h
	ld	de, #0x0007
	add	hl, de
	ld	a, (hl)
	ld	-2 (ix), a
	or	a, a
	jr	Z, 00129$
	ld	a, -12 (ix)
	sub	a, -2 (ix)
	jr	NZ, 00129$
;pocket_platformer.c:385: disp_is_gone(dtx, dty)) ||
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_is_gone
	or	a, a
	jr	NZ, 00123$
00129$:
;pocket_platformer.c:360: if (res_header->one_way_vram_idx && t == res_header->one_way_vram_idx) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:386: (res_header->conn_vram_idx && t == res_header->conn_vram_idx &&
	ld	-3 (ix), l
	ld	-2 (ix), h
	ld	de, #0x0008
	add	hl, de
	ld	a, (hl)
	ld	-2 (ix), a
	or	a, a
	jr	Z, 00124$
	ld	a, -12 (ix)
	sub	a, -2 (ix)
	jr	NZ, 00124$
;pocket_platformer.c:387: disp_is_gone(dtx, dty))) return 0;
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_is_gone
	or	a, a
	jr	Z, 00124$
00123$:
	xor	a, a
	jr	00132$
00124$:
;pocket_platformer.c:389: return 1;
	ld	a, #0x01
00132$:
;pocket_platformer.c:390: }
	ld	sp, ix
	pop	ix
	pop	hl
	pop	bc
	pop	bc
	jp	(hl)
;pocket_platformer.c:394: static unsigned char is_solid_falling_px(long fpx, long fpy) {
;	---------------------------------
; Function is_solid_falling_px
; ---------------------------------
_is_solid_falling_px:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	iy, #-24
	add	iy, sp
	ld	sp, iy
;pocket_platformer.c:396: long px = fpx >> 8, py = fpy >> 8;
	ld	b, #0x08
00254$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00254$
	ld	-20 (ix), e
	ld	-19 (ix), d
	ld	-18 (ix), l
	ld	-17 (ix), h
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, 4 (ix)
	ld	-16 (ix), a
	ld	a, 5 (ix)
	ld	-15 (ix), a
	ld	a, 6 (ix)
	ld	-14 (ix), a
	ld	a, 7 (ix)
	ld	-13 (ix), a
	ld	b, #0x08
00256$:
	sra	-13 (ix)
	rr	-14 (ix)
	rr	-15 (ix)
	rr	-16 (ix)
	djnz	00256$
	ld	hl, #15
	add	hl, sp
	ex	de, hl
	ld	hl, #8
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:397: if (px < 0 || py < 0) return 1;
	ld	a, -21 (ix)
	rlca
	and	a,#0x01
	ld	-5 (ix), a
	or	a, a
	jr	NZ, 00101$
	ld	a, -6 (ix)
	rlca
	and	a,#0x01
	jr	Z, 00102$
00101$:
	ld	a, #0x01
	jp	00129$
00102$:
;pocket_platformer.c:399: (unsigned char)(py / TILE_SIZE));
	ld	hl, #20
	add	hl, sp
	ex	de, hl
	ld	hl, #15
	add	hl, sp
	ld	bc, #4
	ldir
	or	a, a
	jr	Z, 00131$
	ld	a, -9 (ix)
	add	a, #0x07
	ld	-4 (ix), a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
00131$:
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	srl	h
	rr	l
	srl	h
	rr	l
	srl	h
	rr	l
;pocket_platformer.c:398: t = get_tile((unsigned char)(px / TILE_SIZE),
	pop	bc
	push	bc
	ld	a, -5 (ix)
	or	a, a
	jr	Z, 00132$
	ld	a, -24 (ix)
	add	a, #0x07
	ld	c, a
	ld	a, -23 (ix)
	adc	a, #0x00
	ld	b, a
00132$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	a, c
	call	_get_tile
;pocket_platformer.c:400: if (t == 0) return 0;
	ld	-12 (ix), a
	or	a, a
	jr	NZ, 00105$
	xor	a, a
	jp	00129$
00105$:
;pocket_platformer.c:402: if (t & 0x80) return 0;
	bit	7, -12 (ix)
	jr	Z, 00146$
	xor	a, a
	jp	00129$
;pocket_platformer.c:406: for (di = 0; di < 18; di++) {
00146$:
	ld	c, #0x00
00127$:
;pocket_platformer.c:407: if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
	ld	hl, (_res_header)
	ld	de, #0x0013
	add	hl, de
	ld	e, c
	ld	d, #0x00
	add	hl, de
	ld	b, (hl)
	ld	a, b
	or	a, a
	jr	Z, 00128$
	ld	a, -12 (ix)
	sub	a, b
	jr	NZ, 00128$
	xor	a, a
	jp	00129$
00128$:
;pocket_platformer.c:406: for (di = 0; di < 18; di++) {
	inc	c
	ld	a, c
	sub	a, #0x12
	jr	C, 00127$
;pocket_platformer.c:412: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	a, -17 (ix)
	rlca
	and	a,#0x01
	ld	-11 (ix), a
	ld	a, -20 (ix)
	add	a, #0x07
	ld	-10 (ix), a
	ld	a, -19 (ix)
	adc	a, #0x00
	ld	-9 (ix), a
	ld	a, -18 (ix)
	adc	a, #0x00
	ld	-8 (ix), a
	ld	a, -17 (ix)
	adc	a, #0x00
	ld	-7 (ix), a
;pocket_platformer.c:413: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	a, -13 (ix)
	rlca
	and	a,#0x01
	ld	-6 (ix), a
	ld	a, -16 (ix)
	add	a, #0x07
	ld	-5 (ix), a
	ld	a, -15 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
;pocket_platformer.c:411: if (vp_block_count) {
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00115$
;pocket_platformer.c:412: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -11 (ix)
	or	a, a
	jr	Z, 00133$
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #14
	add	hl, sp
	ld	bc, #4
	ldir
00133$:
	pop	bc
	push	bc
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:413: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	c, -16 (ix)
	ld	b, -15 (ix)
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00134$
	ld	c, -5 (ix)
	ld	b, -4 (ix)
00134$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:414: if (vp_is_passable(dtx, dty)) return 0;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_vp_is_passable
	or	a, a
	jr	Z, 00115$
	xor	a, a
	jp	00129$
00115$:
;pocket_platformer.c:417: if (rb_block_count) {
	ld	a, (_rb_block_count+0)
	or	a, a
	jr	Z, 00119$
;pocket_platformer.c:418: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	c, -20 (ix)
	ld	b, -19 (ix)
	ld	a, -11 (ix)
	or	a, a
	jr	Z, 00135$
	ld	c, -10 (ix)
	ld	b, -9 (ix)
00135$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:419: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	c, -16 (ix)
	ld	b, -15 (ix)
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00136$
	ld	c, -5 (ix)
	ld	b, -4 (ix)
00136$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:420: if (rb_is_passable(dtx, dty)) return 0;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_rb_is_passable
	or	a, a
	jr	Z, 00119$
	xor	a, a
	jp	00129$
00119$:
;pocket_platformer.c:423: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	c, -20 (ix)
	ld	b, -19 (ix)
	ld	e, -18 (ix)
	ld	d, -17 (ix)
	ld	a, -11 (ix)
	or	a, a
	jr	Z, 00137$
	ld	c, -10 (ix)
	ld	b, -9 (ix)
	ld	e, -8 (ix)
	ld	d, -7 (ix)
00137$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:424: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	hl, #14
	add	hl, sp
	ex	de, hl
	ld	hl, #8
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00138$
	ld	hl, #14
	add	hl, sp
	ex	de, hl
	ld	hl, #19
	add	hl, sp
	ld	bc, #4
	ldir
00138$:
	ld	a, -10 (ix)
	ld	-3 (ix), a
	ld	a, -9 (ix)
	ld	-2 (ix), a
	srl	-2 (ix)
	rr	-3 (ix)
	srl	-2 (ix)
	rr	-3 (ix)
	srl	-2 (ix)
	rr	-3 (ix)
	ld	a, -3 (ix)
	ld	-4 (ix), a
;pocket_platformer.c:407: if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:425: if ((res_header->disp_vram_idx && t == res_header->disp_vram_idx &&
	ld	-3 (ix), l
	ld	-2 (ix), h
	ld	de, #0x0007
	add	hl, de
	ld	a, (hl)
	ld	-2 (ix), a
	or	a, a
	jr	Z, 00126$
	ld	a, -12 (ix)
	sub	a, -2 (ix)
	jr	NZ, 00126$
;pocket_platformer.c:426: disp_is_gone(dtx, dty)) ||
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_is_gone
	or	a, a
	jr	NZ, 00120$
00126$:
;pocket_platformer.c:407: if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:427: (res_header->conn_vram_idx && t == res_header->conn_vram_idx &&
	ld	-3 (ix), l
	ld	-2 (ix), h
	ld	de, #0x0008
	add	hl, de
	ld	a, (hl)
	ld	-2 (ix), a
	or	a, a
	jr	Z, 00121$
	ld	a, -12 (ix)
	sub	a, -2 (ix)
	jr	NZ, 00121$
;pocket_platformer.c:428: disp_is_gone(dtx, dty))) return 0;
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_is_gone
	or	a, a
	jr	Z, 00121$
00120$:
	xor	a, a
	jr	00129$
00121$:
;pocket_platformer.c:430: return 1;
	ld	a, #0x01
00129$:
;pocket_platformer.c:431: }
	ld	sp, ix
	pop	ix
	pop	hl
	pop	bc
	pop	bc
	jp	(hl)
;pocket_platformer.c:436: static void load_graphics(void) {
;	---------------------------------
; Function load_graphics
; ---------------------------------
_load_graphics:
;pocket_platformer.c:438: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:439: SMS_loadBGPalette(res_palette);
	ld	hl, (_res_palette)
	call	_SMS_loadBGPalette
;pocket_platformer.c:440: SMS_setSpritePaletteColor(0, 0);
;	spillPairReg hl
;	spillPairReg hl
	xor	a, a
	ld	l, a
	call	_SMS_setSpritePaletteColor
;pocket_platformer.c:441: for (i = 1; i < 16; i++)
	ld	c, #0x01
00102$:
;pocket_platformer.c:442: SMS_setSpritePaletteColor(i, res_palette[i]);
	ld	hl, (_res_palette)
	ld	b, #0x00
	add	hl, bc
	ld	l, (hl)
;	spillPairReg hl
	push	bc
	ld	a, c
	call	_SMS_setSpritePaletteColor
	pop	bc
;pocket_platformer.c:441: for (i = 1; i < 16; i++)
	inc	c
	ld	a, c
	sub	a, #0x10
	jr	C, 00102$
;pocket_platformer.c:444: SMS_loadTiles(res_tileset, VRAM_BG_BASE,
	ld	hl, (_res_header)
	ld	de, #0x0005
	add	hl, de
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	de, (_res_tileset)
	push	hl
	ld	hl, #0x0020
	call	_SMS_VRAMmemcpy
;pocket_platformer.c:447: SMS_loadTiles(res_sprites, 256u, 10u * 32u);
	ld	de, (_res_sprites)
	ld	hl, #0x0140
	push	hl
	ld	hl, #0x2000
	call	_SMS_VRAMmemcpy
;pocket_platformer.c:448: SMS_load1bppTiles(font_1bpp, VRAM_TILE_FONT, font_1bpp_size, 0, 1);
	ld	a, #0x01
	push	af
	inc	sp
	xor	a, a
	push	af
	inc	sp
	ld	hl, (_font_1bpp_size)
	push	hl
	ld	de, #0x0160
	ld	hl, #_font_1bpp
	call	_SMS_load1bppTiles
;pocket_platformer.c:449: SMS_configureTextRenderer(VRAM_TILE_FONT - 32);
	ld	hl, #0x0140
;pocket_platformer.c:450: }
	jp	_SMS_configureTextRenderer
;pocket_platformer.c:452: static void draw_tilemap_full(void) {
;	---------------------------------
; Function draw_tilemap_full
; ---------------------------------
_draw_tilemap_full:
;pocket_platformer.c:454: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:455: for (y = 0; y < SCREEN_TILES_H; y++) {
	ld	c, #0x00
00108$:
;pocket_platformer.c:456: SMS_setNextTileatXY(0, y);
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	a, h
	or	a, #0x78
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	rst	#0x08
	pop	bc
;pocket_platformer.c:457: for (x = 0; x < SCREEN_TILES_W; x++) {
	ld	b, #0x00
00106$:
;pocket_platformer.c:458: unsigned char t = (y < cur_level->map_h) ? get_tile(x, y) : 0;
	ld	hl, (_cur_level)
	inc	hl
	ld	e, (hl)
	ld	a, c
	sub	a, e
	jr	NC, 00112$
	push	bc
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, b
	call	_get_tile
	pop	bc
	ld	e, a
	ld	d, #0x00
	jr	00113$
00112$:
	ld	de, #0x0000
00113$:
;pocket_platformer.c:460: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
;pocket_platformer.c:459: if (t & 0x80)
	bit	7, e
	jr	Z, 00102$
;pocket_platformer.c:460: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	res	7, l
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	set	4, h
	rst	#0x18
	jr	00107$
00102$:
;pocket_platformer.c:462: SMS_setTile(t ? (unsigned int)(VRAM_BG_BASE + t - 1) : 0u);
	ld	a, e
	or	a, a
	jr	Z, 00114$
	ex	de, hl
	jr	00115$
00114$:
	ld	de, #0x0000
00115$:
	ex	de, hl
	rst	#0x18
00107$:
;pocket_platformer.c:457: for (x = 0; x < SCREEN_TILES_W; x++) {
	inc	b
	ld	a, b
	sub	a, #0x20
	jr	C, 00106$
;pocket_platformer.c:455: for (y = 0; y < SCREEN_TILES_H; y++) {
	inc	c
	ld	a, c
	sub	a, #0x18
	jr	C, 00108$
;pocket_platformer.c:465: }
	ret
;pocket_platformer.c:467: static void draw_tile_column(unsigned char scr_col, unsigned char map_col) {
;	---------------------------------
; Function draw_tile_column
; ---------------------------------
_draw_tile_column:
	push	ix
	ld	ix,#0
	add	ix,sp
	dec	sp
	ld	b, a
	ld	c, l
;pocket_platformer.c:469: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:470: SMS_setNextTileatXY(scr_col, 0);
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	ld	a, h
	or	a, #0x78
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	rst	#0x08
	pop	bc
;pocket_platformer.c:471: for (y = 0; y < SCREEN_TILES_H; y++) {
	ld	-1 (ix), #0x00
00105$:
;pocket_platformer.c:472: unsigned char t = (y < cur_level->map_h) ? get_tile(map_col, y) : 0;
	ld	hl, (_cur_level)
	inc	hl
	ld	b, (hl)
	ld	a, -1 (ix)
	sub	a, b
	jr	NC, 00109$
	push	bc
	ld	l, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_get_tile
	pop	bc
	jr	00110$
00109$:
	xor	a, a
00110$:
	ld	e, a
;pocket_platformer.c:474: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
;pocket_platformer.c:473: if (t & 0x80)
	bit	7, e
	jr	Z, 00102$
;pocket_platformer.c:474: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	res	7, l
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	set	4, h
	rst	#0x18
	jr	00106$
00102$:
;pocket_platformer.c:476: SMS_setTile(t ? (unsigned int)(VRAM_BG_BASE + t - 1) : 0u);
	ld	a, e
	or	a, a
	jr	Z, 00111$
	ex	de, hl
	jr	00112$
00111$:
	ld	de, #0x0000
00112$:
	ex	de, hl
	rst	#0x18
00106$:
;pocket_platformer.c:471: for (y = 0; y < SCREEN_TILES_H; y++) {
	inc	-1 (ix)
	ld	a, -1 (ix)
	sub	a, #0x18
	jr	C, 00105$
;pocket_platformer.c:478: }
	inc	sp
	pop	ix
	ret
;pocket_platformer.c:483: static unsigned char coins_remaining(void) {
;	---------------------------------
; Function coins_remaining
; ---------------------------------
_coins_remaining:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	dec	sp
;pocket_platformer.c:485: unsigned char n = cur_level->obj_count < MAX_OBJECTS ? cur_level->obj_count : MAX_OBJECTS;
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	a, (hl)
	cp	a, #0x80
	jr	NC, 00110$
	ld	c, a
	jr	00111$
00110$:
	ld	bc, #0x0080
00111$:
	ld	-3 (ix), c
;pocket_platformer.c:486: for (i = 0; i < n; i++)
	ld	b, #0x00
	ld	e, b
00106$:
	ld	a, e
	sub	a, -3 (ix)
	jr	NC, 00104$
;pocket_platformer.c:487: if (cur_objects[i].type == OBJ_COIN && !coin_collected[i]) count++;
	push	de
	ld	d, #0x00
	ld	l, e
	ld	h, d
	add	hl, hl
	add	hl, de
	pop	de
	ld	a, l
	ld	d, h
	ld	hl, #_cur_objects
	add	a, (hl)
	ld	-2 (ix), a
	inc	hl
	ld	a, d
	adc	a, (hl)
	ld	-1 (ix), a
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	inc	hl
	inc	hl
	ld	a, (hl)
	sub	a, #0x05
	jr	NZ, 00107$
	ld	hl, #_coin_collected
	ld	d, #0x00
	add	hl, de
	ld	a, (hl)
	or	a, a
	jr	NZ, 00107$
	inc	b
00107$:
;pocket_platformer.c:486: for (i = 0; i < n; i++)
	inc	e
	jr	00106$
00104$:
;pocket_platformer.c:488: return count;
	ld	a, b
;pocket_platformer.c:489: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:491: static unsigned int obj_sprite_tile(unsigned char type) {
;	---------------------------------
; Function obj_sprite_tile
; ---------------------------------
_obj_sprite_tile:
;pocket_platformer.c:492: switch (type) {
	ld	c, a
	sub	a, #0x02
	jr	Z, 00101$
	ld	a,c
	cp	a,#0x03
	jr	Z, 00103$
	cp	a,#0x04
	jr	Z, 00104$
	cp	a,#0x05
	jr	Z, 00105$
	sub	a, #0x0c
	jr	Z, 00102$
	jr	00106$
;pocket_platformer.c:493: case OBJ_FINISH_FLAG:        return VRAM_SPR_FINISH_FLAG;
00101$:
	ld	de, #0x0101
	ret
;pocket_platformer.c:494: case OBJ_FINISH_FLAG_LOCKED: return coins_remaining() ? VRAM_SPR_FLAG_CLOSED : VRAM_SPR_FINISH_FLAG;
00102$:
	call	_coins_remaining
	or	a, a
	jr	Z, 00110$
	ld	de, #0x0109
	ret
00110$:
	ld	de, #0x0101
	ret
;pocket_platformer.c:495: case OBJ_SPIKE:              return VRAM_SPR_SPIKE;
00103$:
	ld	de, #0x0102
	ret
;pocket_platformer.c:496: case OBJ_TRAMPOLINE:         return VRAM_SPR_TRAMPOLINE;
00104$:
	ld	de, #0x0103
	ret
;pocket_platformer.c:497: case OBJ_COIN:               return VRAM_SPR_COIN;
00105$:
	ld	de, #0x0104
	ret
;pocket_platformer.c:498: default:                     return VRAM_SPR_FINISH_FLAG;
00106$:
	ld	de, #0x0101
;pocket_platformer.c:499: }
;pocket_platformer.c:500: }
	ret
;pocket_platformer.c:502: static void draw_objects(void) {
;	---------------------------------
; Function draw_objects
; ---------------------------------
_draw_objects:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	dec	sp
;pocket_platformer.c:504: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:505: for (i = 0; i < cur_level->obj_count; i++) {
	ld	c, #0x00
00122$:
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	b, (hl)
	ld	a, c
	sub	a, b
	jp	NC, 00123$
;pocket_platformer.c:506: level_object *obj = &cur_objects[i];
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	b, l
	ld	d, h
	ld	a, b
	ld	hl, #_cur_objects
	add	a, (hl)
	inc	hl
	ld	e, a
	ld	a, d
	adc	a, (hl)
	ld	d, a
;pocket_platformer.c:508: if (obj->type == OBJ_START_FLAG) continue;
	ld	-2 (ix), e
	ld	-1 (ix), d
	inc	de
	inc	de
	ld	a, (de)
	ld	-3 (ix), a
	dec	a
	jp	Z,00119$
;pocket_platformer.c:509: if (obj->type == OBJ_COIN && coin_collected[i]) continue;
	ld	a, -3 (ix)
	sub	a, #0x05
	jr	NZ, 00104$
	ld	hl, #_coin_collected
	ld	b, #0x00
	add	hl, bc
	ld	a, (hl)
	or	a, a
	jp	NZ, 00119$
00104$:
;pocket_platformer.c:511: if (obj->type == 7 || obj->type == 8 || obj->type == 9) continue;
	ld	a, -3 (ix)
	sub	a, #0x07
	jp	Z,00119$
	ld	a, -3 (ix)
	sub	a, #0x08
	jp	Z,00119$
	ld	a, -3 (ix)
	sub	a, #0x09
	jp	Z,00119$
;pocket_platformer.c:512: if (obj->type == 10 || obj->type == 11) continue;
	ld	a, -3 (ix)
	sub	a, #0x0a
	jr	Z, 00119$
	ld	a, -3 (ix)
	sub	a, #0x0b
	jr	Z, 00119$
;pocket_platformer.c:513: sx = (int)obj->x * TILE_SIZE - (int)camera_x;
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	de, (_camera_x)
	cp	a, a
	sbc	hl, de
	ex	de, hl
;pocket_platformer.c:514: sy = (int)obj->y * TILE_SIZE;
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
;pocket_platformer.c:515: if (sx < -8 || sx > SCREEN_PX_W) continue;
	ld	a, e
	sub	a, #0xf8
	ld	a, d
	rla
	ccf
	rra
	sbc	a, #0x7f
	jr	C, 00119$
	xor	a, a
	cp	a, e
	ld	a, #0x01
	sbc	a, d
	jp	PO, 00199$
	xor	a, #0x80
00199$:
	jp	M, 00119$
;pocket_platformer.c:516: if (sy < 0  || sy > SCREEN_PX_H) continue;
	bit	7, h
	jr	NZ, 00119$
	ld	a, #0xc0
	cp	a, l
	ld	a, #0x00
	sbc	a, h
	jp	PO, 00200$
	xor	a, #0x80
00200$:
	jp	M, 00119$
;pocket_platformer.c:517: SMS_addSprite((unsigned char)sx, (unsigned char)sy,
	ld	-1 (ix), e
	ld	-2 (ix), #0x00
	push	hl
	push	bc
	ld	a, -3 (ix)
	call	_obj_sprite_tile
	pop	bc
	pop	hl
	ld	a, e
	ld	b, #0x00
	or	a, -2 (ix)
	ld	e, a
	ld	a, b
	or	a, -1 (ix)
	ld	d, a
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	call	_SMS_addSprite_f
	pop	bc
00119$:
;pocket_platformer.c:505: for (i = 0; i < cur_level->obj_count; i++) {
	inc	c
	jp	00122$
00123$:
;pocket_platformer.c:520: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:522: static void draw_player(void) {
;	---------------------------------
; Function draw_player
; ---------------------------------
_draw_player:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-13
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:523: int sx = (int)(player.x >> 8) - (int)camera_x;
	ld	bc, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	h, l
;	spillPairReg hl
;	spillPairReg hl
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	bc, (_camera_x)
	cp	a, a
	sbc	hl, bc
	ld	-4 (ix), l
	ld	-3 (ix), h
;pocket_platformer.c:524: int sy = (int)(player.y >> 8);
	ld	de, #_player + 4
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	a, -12 (ix)
	ld	-8 (ix), a
	ld	a, -11 (ix)
	ld	-7 (ix), a
;pocket_platformer.c:526: if (sx < -8 || sx > SCREEN_PX_W) return;
	ld	a, -4 (ix)
	sub	a, #0xf8
	ld	a, -3 (ix)
	rla
	ccf
	rra
	sbc	a, #0x7f
	jp	C,00110$
	xor	a, a
	cp	a, -4 (ix)
	ld	a, #0x01
	sbc	a, -3 (ix)
	jp	PO, 00134$
	xor	a, #0x80
00134$:
	jp	P, 00102$
	jp	00110$
00102$:
;pocket_platformer.c:527: if (!player.on_ground)
	ld	a, (#_player + 16)
	or	a, a
	jr	NZ, 00108$
;pocket_platformer.c:528: tile = VRAM_SPR_PLAYER_JUMP;
	ld	-2 (ix), #0x08
	ld	-1 (ix), #0x01
	jr	00109$
00108$:
;pocket_platformer.c:529: else if (player.vx != 0)
	ld	bc, (#_player + 8)
	ld	hl, (#_player + 10)
	ld	a, h
	or	a, l
	or	a, b
	or	a, c
	jr	Z, 00105$
;pocket_platformer.c:530: tile = (player.anim_frame & 2) ? VRAM_SPR_PLAYER_WALK1 : VRAM_SPR_PLAYER_WALK0;
	ld	a, (#_player + 25)
	bit	1, a
	jr	Z, 00112$
	ld	bc, #0x0107
	jr	00113$
00112$:
	ld	bc, #0x0106
00113$:
	ld	-2 (ix), c
	ld	-1 (ix), b
	jr	00109$
00105$:
;pocket_platformer.c:532: tile = VRAM_SPR_PLAYER_IDLE;
	ld	-2 (ix), #0x05
	ld	-1 (ix), #0x01
00109$:
;pocket_platformer.c:533: SMS_addSprite((unsigned char)sx, (unsigned char)sy, (unsigned char)tile);
	ld	a, -4 (ix)
	ld	-6 (ix), a
	ld	-5 (ix), #0x00
	ld	a, -6 (ix)
	ld	-4 (ix), a
	ld	-3 (ix), #0x00
	ld	a, -4 (ix)
	ld	-5 (ix), a
	ld	-6 (ix), #0x00
	ld	a, -2 (ix)
	ld	-1 (ix), a
	ld	-2 (ix), a
	ld	-1 (ix), #0x00
	ld	a, -2 (ix)
	ld	-4 (ix), a
	ld	-3 (ix), #0x00
	ld	a, -6 (ix)
	or	a, -4 (ix)
	ld	-2 (ix), a
	ld	a, -5 (ix)
	or	a, -3 (ix)
	ld	-1 (ix), a
	ld	a, -8 (ix)
	ld	-3 (ix), a
	ld	-4 (ix), a
	ld	-3 (ix), #0x00
	ld	e, -2 (ix)
	ld	d, -1 (ix)
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_addSprite_f
00110$:
;pocket_platformer.c:534: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:545: static void apply_treadmill(void) {
;	---------------------------------
; Function apply_treadmill
; ---------------------------------
_apply_treadmill:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-19
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:546: long bonus_target = 0;
	xor	a, a
	ld	-11 (ix), a
	ld	-10 (ix), a
	ld	-9 (ix), a
	ld	-8 (ix), a
;pocket_platformer.c:547: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:548: if (res_header->treadmill_right_vram_idx) {
	ld	iy, (_res_header)
	ld	a, 38 (iy)
	ld	-1 (ix), a
	or	a, a
	jp	Z, 00119$
;pocket_platformer.c:552: unsigned char fty = (unsigned char)(((player.y >> 8) + PLAYER_H) / TILE_SIZE);
	ld	de, #_player + 4
	ld	hl, #15
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	a, -4 (ix)
	ld	-19 (ix), a
	ld	a, -3 (ix)
	ld	-18 (ix), a
	ld	a, -2 (ix)
	ld	-17 (ix), a
	ld	a, -1 (ix)
	ld	-16 (ix), a
	ld	b, #0x08
00206$:
	sra	-16 (ix)
	rr	-17 (ix)
	rr	-18 (ix)
	rr	-19 (ix)
	djnz	00206$
	ld	a, -19 (ix)
	add	a, #0x08
	ld	-15 (ix), a
	ld	a, -18 (ix)
	adc	a, #0x00
	ld	-14 (ix), a
	ld	a, -17 (ix)
	adc	a, #0x00
	ld	-13 (ix), a
	ld	a, -16 (ix)
	adc	a, #0x00
	ld	-12 (ix), a
	ld	hl, #15
	add	hl, sp
	ex	de, hl
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
	bit	7, -12 (ix)
	jr	Z, 00128$
	ld	a, -19 (ix)
	add	a, #0x0f
	ld	-4 (ix), a
	ld	a, -18 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -17 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -16 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
00128$:
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	ld	-2 (ix), c
	ld	-1 (ix), b
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
	ld	a, -2 (ix)
	ld	-7 (ix), a
;pocket_platformer.c:553: unsigned char ftx = (unsigned char)((player.x >> 8) / TILE_SIZE);
	ld	de, #_player
	ld	hl, #15
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	a, -4 (ix)
	ld	-15 (ix), a
	ld	a, -3 (ix)
	ld	-14 (ix), a
	ld	a, -2 (ix)
	ld	-13 (ix), a
	ld	a, -1 (ix)
	ld	-12 (ix), a
	ld	b, #0x08
00208$:
	sra	-12 (ix)
	rr	-13 (ix)
	rr	-14 (ix)
	rr	-15 (ix)
	djnz	00208$
	ld	hl, #15
	add	hl, sp
	ex	de, hl
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
	bit	7, -12 (ix)
	jr	Z, 00129$
	ld	a, -15 (ix)
	add	a, #0x07
	ld	-4 (ix), a
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -12 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
00129$:
	ld	a, -4 (ix)
	ld	-2 (ix), a
	ld	a, -3 (ix)
	ld	-1 (ix), a
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
;pocket_platformer.c:554: unsigned char ft  = get_tile(ftx, fty);
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -2 (ix)
	ld	l, -7 (ix)
	call	_get_tile
	ld	-1 (ix), a
	ld	-6 (ix), a
;pocket_platformer.c:548: if (res_header->treadmill_right_vram_idx) {
	ld	hl, (_res_header)
	ld	-5 (ix), l
	ld	-4 (ix), h
;pocket_platformer.c:555: if (ft == res_header->treadmill_right_vram_idx)
	ld	a, -5 (ix)
	ld	-2 (ix), a
	ld	a, -4 (ix)
	ld	-1 (ix), a
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	de, #0x0026
	add	hl, de
	ld	a, (hl)
	ld	-3 (ix), a
;pocket_platformer.c:556: bonus_target = FP_MUL((long)res_physics->max_speed, FP(1.0/1.90));
	ld	hl, (_res_physics)
	ld	-2 (ix), l
	ld	-1 (ix), h
;pocket_platformer.c:555: if (ft == res_header->treadmill_right_vram_idx)
	ld	a, -6 (ix)
	sub	a, -3 (ix)
	jr	NZ, 00112$
;pocket_platformer.c:556: bonus_target = FP_MUL((long)res_physics->max_speed, FP(1.0/1.90));
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	ld	hl, #0x0086
	call	___mulsint2slong
	ld	b, #0x08
00212$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00212$
	ld	-11 (ix), e
	ld	-10 (ix), d
	ld	-9 (ix), l
	ld	-8 (ix), h
	jp	00113$
00112$:
;pocket_platformer.c:557: else if (res_header->treadmill_left_vram_idx &&
	ld	l, -5 (ix)
	ld	h, -4 (ix)
	ld	de, #0x0027
	add	hl, de
	ld	c, (hl)
	ld	a, c
	or	a, a
	jr	Z, 00108$
;pocket_platformer.c:558: ft == res_header->treadmill_left_vram_idx)
	ld	a, -6 (ix)
	sub	a, c
	jr	NZ, 00108$
;pocket_platformer.c:559: bonus_target = -FP_MUL((long)res_physics->max_speed, FP(1.0/1.90));
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	ld	hl, #0x0086
	call	___mulsint2slong
	ld	-4 (ix), e
	ld	-3 (ix), d
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	e, -2 (ix)
	ld	d, -1 (ix)
	ld	b, #0x08
00216$:
	sra	d
	rr	e
	rr	h
	rr	l
	djnz	00216$
	xor	a, a
	sub	a, l
	ld	c, a
	ld	a, #0x00
	sbc	a, h
	ld	b, a
	ld	hl, #0x0000
	sbc	hl, de
	ld	-11 (ix), c
	ld	-10 (ix), b
	ld	-9 (ix), l
	ld	-8 (ix), h
	jp	00113$
00108$:
;pocket_platformer.c:562: unsigned char ftx2 = (unsigned char)(((player.x >> 8) + PLAYER_W - 1) / TILE_SIZE);
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	b, #0x08
00218$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00218$
	ld	-15 (ix), e
	ld	-14 (ix), d
	ld	-13 (ix), l
	ld	-12 (ix), h
	ld	a, -15 (ix)
	add	a, #0x05
	ld	c, a
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -12 (ix)
	adc	a, #0x00
	ld	d, a
	ld	-4 (ix), c
	ld	-3 (ix), b
	ld	-2 (ix), e
	ld	-1 (ix), d
	bit	7, d
	jr	Z, 00130$
	ld	a, -15 (ix)
	add	a, #0x0c
	ld	-4 (ix), a
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -12 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
00130$:
	ld	a, -4 (ix)
	ld	-2 (ix), a
	ld	a, -3 (ix)
	ld	-1 (ix), a
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
	ld	a, -2 (ix)
	ld	-1 (ix), a
;pocket_platformer.c:563: unsigned char ft2  = get_tile(ftx2, fty);
	ld	l, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_get_tile
	ld	-5 (ix), a
;pocket_platformer.c:548: if (res_header->treadmill_right_vram_idx) {
	ld	hl, (_res_header)
	ld	-2 (ix), l
	ld	-1 (ix), h
;pocket_platformer.c:564: if (ft2 == res_header->treadmill_right_vram_idx)
	ld	a, -2 (ix)
	ld	-4 (ix), a
	ld	a, -1 (ix)
	ld	-3 (ix), a
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	de, #0x0026
	add	hl, de
	ld	a, (hl)
	ld	-6 (ix), a
;pocket_platformer.c:556: bonus_target = FP_MUL((long)res_physics->max_speed, FP(1.0/1.90));
	ld	hl, (_res_physics)
	ld	-4 (ix), l
	ld	-3 (ix), h
;pocket_platformer.c:564: if (ft2 == res_header->treadmill_right_vram_idx)
	ld	a, -5 (ix)
	sub	a, -6 (ix)
	jr	NZ, 00105$
;pocket_platformer.c:565: bonus_target = FP_MUL((long)res_physics->max_speed, FP(1.0/1.90));
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	ld	hl, #0x0086
	call	___mulsint2slong
	ld	-4 (ix), e
	ld	-3 (ix), d
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	a, -4 (ix)
	ld	-11 (ix), a
	ld	a, -3 (ix)
	ld	-10 (ix), a
	ld	a, -2 (ix)
	ld	-9 (ix), a
	ld	a, -1 (ix)
	ld	-8 (ix), a
	ld	b, #0x08
00222$:
	sra	-8 (ix)
	rr	-9 (ix)
	rr	-10 (ix)
	rr	-11 (ix)
	djnz	00222$
	jp	00113$
00105$:
;pocket_platformer.c:557: else if (res_header->treadmill_left_vram_idx &&
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	de, #0x0027
	add	hl, de
	ld	a, (hl)
;pocket_platformer.c:566: else if (res_header->treadmill_left_vram_idx &&
	ld	-1 (ix), a
	or	a, a
	jp	Z, 00113$
;pocket_platformer.c:567: ft2 == res_header->treadmill_left_vram_idx)
	ld	a, -5 (ix)
	sub	a, -1 (ix)
	jp	NZ,00113$
;pocket_platformer.c:568: bonus_target = -FP_MUL((long)res_physics->max_speed, FP(1.0/1.90));
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	ld	-2 (ix), a
	inc	hl
	ld	a, (hl)
	ld	-1 (ix), a
	ld	e, -2 (ix)
	ld	d, -1 (ix)
	ld	hl, #0x0086
	call	___mulsint2slong
	ld	-4 (ix), e
	ld	-3 (ix), d
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	a, -4 (ix)
	ld	-8 (ix), a
	ld	a, -3 (ix)
	ld	-7 (ix), a
	ld	a, -2 (ix)
	ld	-6 (ix), a
	ld	a, -1 (ix)
	ld	-5 (ix), a
	ld	b, #0x08
00226$:
	sra	-5 (ix)
	rr	-6 (ix)
	rr	-7 (ix)
	rr	-8 (ix)
	djnz	00226$
	xor	a, a
	sub	a, -8 (ix)
	ld	-4 (ix), a
	ld	a, #0x00
	sbc	a, -7 (ix)
	ld	-3 (ix), a
	ld	a, #0x00
	sbc	a, -6 (ix)
	ld	-2 (ix), a
	sbc	a, a
	sub	a, -5 (ix)
	ld	-1 (ix), a
	ld	hl, #8
	add	hl, sp
	ex	de, hl
	ld	hl, #15
	add	hl, sp
	ld	bc, #4
	ldir
00113$:
;pocket_platformer.c:572: if (player.falling || player.jumping || player.wall_jumping)
	ld	a, (#_player + 17)
	or	a, a
	jr	NZ, 00114$
	ld	a, (#_player + 18)
	or	a, a
	jr	NZ, 00114$
	ld	a, (#_player + 19)
	ld	-1 (ix), a
	or	a, a
	jr	Z, 00119$
00114$:
;pocket_platformer.c:573: bonus_target = 0;
	xor	a, a
	ld	-11 (ix), a
	ld	-10 (ix), a
	ld	-9 (ix), a
	ld	-8 (ix), a
00119$:
;pocket_platformer.c:575: if (bonus_target != 0) {
	ld	a, -8 (ix)
	or	a, -9 (ix)
	or	a, -10 (ix)
	or	a, -11 (ix)
	jr	Z, 00124$
;pocket_platformer.c:576: treadmill_bonus = bonus_target;
	ld	de, #_treadmill_bonus
	ld	hl, #8
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:577: treadmill_active = 1;
	ld	hl, #_treadmill_active
	ld	(hl), #0x01
	jp	00126$
00124$:
;pocket_platformer.c:579: treadmill_active = 0;
	ld	hl, #_treadmill_active
	ld	(hl), #0x00
;pocket_platformer.c:581: treadmill_bonus = FP_MUL(treadmill_bonus, FP(0.95));
	ld	hl, (_treadmill_bonus + 2)
	push	hl
	ld	hl, (_treadmill_bonus)
	push	hl
	ld	de, #0x00f3
	ld	hl, #0x0000
	call	__mullong
	pop	af
	pop	af
	ld	-4 (ix), e
	ld	-3 (ix), d
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	a, -4 (ix)
	ld	(_treadmill_bonus+0), a
	ld	a, -3 (ix)
	ld	(_treadmill_bonus+1), a
	ld	a, -2 (ix)
	ld	(_treadmill_bonus+2), a
	ld	a, -1 (ix)
	ld	(_treadmill_bonus+3), a
	ld	b, #0x08
00228$:
	ld	iy, #_treadmill_bonus
	sra	3 (iy)
	rr	2 (iy)
	rr	1 (iy)
	rr	0 (iy)
	djnz	00228$
;pocket_platformer.c:582: if (treadmill_bonus > -FP(0.1) && treadmill_bonus < FP(0.1))
	ld	a, #0xe7
	cp	a, 0 (iy)
	ld	de, (_treadmill_bonus + 1)
	ld	hl, #0xffff
	sbc	hl, de
	ld	a, #0xff
	sbc	a, 3 (iy)
	jp	PO, 00230$
	xor	a, #0x80
00230$:
	jp	P, 00121$
	ld	a, (_treadmill_bonus+0)
	sub	a, #0x19
	ld	a, (_treadmill_bonus+1)
	sbc	a, #0x00
	ld	a, (_treadmill_bonus+2)
	sbc	a, #0x00
	ld	a, (_treadmill_bonus+3)
	rla
	ccf
	rra
	sbc	a, #0x80
	jr	NC, 00121$
;pocket_platformer.c:583: treadmill_bonus = 0;
	xor	a, a
	ld	(_treadmill_bonus+0), a
	ld	(_treadmill_bonus+1), a
	ld	(_treadmill_bonus+2), a
	ld	(_treadmill_bonus+3), a
00121$:
;pocket_platformer.c:584: treadmill_active = 0;
	ld	hl, #_treadmill_active
	ld	(hl), #0x00
00126$:
;pocket_platformer.c:586: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:588: static void apply_gravity(void) {
;	---------------------------------
; Function apply_gravity
; ---------------------------------
_apply_gravity:
;pocket_platformer.c:590: if (player.falling) {
	ld	a, (#_player + 17)
	or	a, a
	ret	Z
;pocket_platformer.c:591: player.vy += GRAVITY;
	ld	hl, (#(_player + 12) + 0)
	ld	de, (#(_player + 12) + 2)
	ld	a, l
	add	a, #0x2a
	ld	c, a
	ld	a, h
	adc	a, #0x00
	ld	b, a
	jr	NC, 00117$
	inc	de
00117$:
	ld	((_player + 12)), bc
	ld	((_player + 12)+2), de
;pocket_platformer.c:592: if (player.vy > MAX_VY)
	xor	a, a
	cp	a, c
	ld	a, #0x07
	sbc	a, b
	ld	a, #0x00
	sbc	a, e
	ld	a, #0x00
	sbc	a, d
	jp	PO, 00118$
	xor	a, #0x80
00118$:
	ret	P
;pocket_platformer.c:593: player.vy = MAX_VY;
	ld	hl, #0x0700
	ld	((_player + 12)), hl
	ld	h, l
	ld	((_player + 12)+2), hl
;pocket_platformer.c:595: }
	ret
;pocket_platformer.c:597: static void handle_input(unsigned int joy, unsigned int joy_pressed) {
;	---------------------------------
; Function handle_input
; ---------------------------------
_handle_input:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	iy, #-18
	add	iy, sp
	ld	sp, iy
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	c, e
	ld	b, d
;pocket_platformer.c:598: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
	ld	-8 (ix), l
	ld	-7 (ix), h
	ld	e, (hl)
	inc	hl
	ld	a, (hl)
	ld	-18 (ix), e
	ld	-17 (ix), a
	rlca
	sbc	a, a
	ld	-16 (ix), a
	ld	-15 (ix), a
;pocket_platformer.c:599: long accel = player.on_ground ? (long)res_physics->ground_accel : (long)res_physics->air_accel;
	ld	hl, #(_player + 16)
	ld	e, (hl)
	ld	a, e
	or	a, a
	jr	Z, 00168$
	ld	l, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	ld	d, (hl)
	inc	hl
	ld	a, (hl)
	ld	-6 (ix), d
	ld	-5 (ix), a
	rlca
	sbc	a, a
	ld	-4 (ix), a
	ld	-3 (ix), a
	jr	00169$
00168$:
	ld	l, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	ld	bc, #0x0006
	add	hl, bc
	pop	bc
	ld	a, (hl)
	inc	hl
	ld	h, (hl)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	ld	-6 (ix), a
	ld	a, h
	ld	-5 (ix), a
	rlca
	sbc	a, a
	ld	-4 (ix), a
	ld	-3 (ix), a
00169$:
	ld	a, -6 (ix)
	ld	-14 (ix), a
	ld	a, -5 (ix)
	ld	-13 (ix), a
	ld	a, -4 (ix)
	ld	-12 (ix), a
	ld	a, -3 (ix)
	ld	-11 (ix), a
;pocket_platformer.c:600: long fric  = player.on_ground ? (long)res_physics->ground_friction : (long)res_physics->air_friction;
	ld	a, e
	or	a, a
	jr	Z, 00170$
	ld	e, -8 (ix)
	ld	d, -7 (ix)
	ld	hl, #4
	add	hl, de
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	ld	-6 (ix), e
	ld	a, d
	ld	-5 (ix), a
	rlca
	sbc	a, a
	ld	-4 (ix), a
	ld	-3 (ix), a
	jr	00171$
00170$:
	ld	e, -8 (ix)
	ld	d, -7 (ix)
	ld	hl, #8
	add	hl, de
	ld	e, (hl)
	inc	hl
	ld	a, (hl)
	ld	-6 (ix), e
	ld	-5 (ix), a
	rlca
	sbc	a, a
	ld	-4 (ix), a
	ld	-3 (ix), a
00171$:
;pocket_platformer.c:604: player.vx -= accel;
;pocket_platformer.c:606: player.facing_left = 1;
;pocket_platformer.c:612: player.vx = FP_MUL(player.vx, fric);
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #10
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
;pocket_platformer.c:603: if (joy & PORT_A_KEY_LEFT) {
	bit	2, -2 (ix)
	jp	Z,00112$
;pocket_platformer.c:604: player.vx -= accel;
	ld	a, -10 (ix)
	sub	a, -14 (ix)
	ld	-6 (ix), a
	ld	a, -9 (ix)
	sbc	a, -13 (ix)
	ld	-5 (ix), a
	ld	a, -8 (ix)
	sbc	a, -12 (ix)
	ld	-4 (ix), a
	ld	a, -7 (ix)
	sbc	a, -11 (ix)
	ld	-3 (ix), a
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #14
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
;pocket_platformer.c:605: if (player.vx < -max_spd) player.vx = -max_spd;
	xor	a, a
	sub	a, -18 (ix)
	ld	-10 (ix), a
	ld	a, #0x00
	sbc	a, -17 (ix)
	ld	-9 (ix), a
	ld	a, #0x00
	sbc	a, -16 (ix)
	ld	-8 (ix), a
	sbc	a, a
	sub	a, -15 (ix)
	ld	-7 (ix), a
	ld	a, -6 (ix)
	sub	a, -10 (ix)
	ld	a, -5 (ix)
	sbc	a, -9 (ix)
	ld	a, -4 (ix)
	sbc	a, -8 (ix)
	ld	a, -3 (ix)
	sbc	a, -7 (ix)
	jp	PO, 00507$
	xor	a, #0x80
00507$:
	jp	P, 00102$
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #10
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
00102$:
;pocket_platformer.c:606: player.facing_left = 1;
	ld	hl, #(_player + 23)
	ld	(hl), #0x01
	jp	00113$
00112$:
;pocket_platformer.c:607: } else if (joy & PORT_A_KEY_RIGHT) {
	bit	3, -2 (ix)
	jr	Z, 00109$
;pocket_platformer.c:608: player.vx += accel;
	ld	a, -10 (ix)
	add	a, -14 (ix)
	ld	-6 (ix), a
	ld	a, -9 (ix)
	adc	a, -13 (ix)
	ld	-5 (ix), a
	ld	a, -8 (ix)
	adc	a, -12 (ix)
	ld	-4 (ix), a
	ld	a, -7 (ix)
	adc	a, -11 (ix)
	ld	-3 (ix), a
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #14
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
;pocket_platformer.c:609: if (player.vx > max_spd) player.vx = max_spd;
	ld	a, -18 (ix)
	sub	a, -6 (ix)
	ld	a, -17 (ix)
	sbc	a, -5 (ix)
	ld	a, -16 (ix)
	sbc	a, -4 (ix)
	ld	a, -15 (ix)
	sbc	a, -3 (ix)
	jp	PO, 00509$
	xor	a, #0x80
00509$:
	jp	P, 00104$
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #2
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
00104$:
;pocket_platformer.c:610: player.facing_left = 0;
	ld	hl, #(_player + 23)
	ld	(hl), #0x00
	jp	00113$
00109$:
;pocket_platformer.c:612: player.vx = FP_MUL(player.vx, fric);
	push	bc
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	hl
	ld	l, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	hl
	ld	e, -10 (ix)
	ld	d, -9 (ix)
	ld	l, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	__mullong
	pop	af
	pop	af
	pop	bc
	ld	a, #0x08
00510$:
	sra	h
	rr	l
	rr	d
	rr	e
	dec	a
	jr	NZ, 00510$
	ld	-6 (ix), e
	ld	-5 (ix), d
	ld	-4 (ix), l
	ld	-3 (ix), h
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #14
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
;pocket_platformer.c:613: if (player.vx > -FP(0.5) && player.vx < FP(0.5)) player.vx = 0;
	ld	de, (#(_player + 8) + 0)
	ld	hl, (#(_player + 8) + 2)
	ld	a, #0x80
	cp	a, -6 (ix)
	ld	a, #0xff
	sbc	a, -5 (ix)
	ld	a, #0xff
	sbc	a, -4 (ix)
	ld	a, #0xff
	sbc	a, -3 (ix)
	jp	PO, 00512$
	xor	a, #0x80
00512$:
	jp	P, 00113$
	ld	a, e
	sub	a, #0x80
	ld	a, d
	sbc	a, #0x00
	ld	a, l
	sbc	a, #0x00
	ld	a, h
	rla
	ccf
	rra
	sbc	a, #0x80
	jr	NC, 00113$
	ld	hl, #0x0000
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
00113$:
;pocket_platformer.c:620: long px_l = (player.x >> 8) - 1;           /* 1px left of player */
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	a, #0x08
00513$:
	sra	h
	rr	l
	rr	d
	rr	e
	dec	a
	jr	NZ, 00513$
	ld	a, e
	add	a, #0xff
	ld	-18 (ix), a
	ld	a, d
	adc	a, #0xff
	ld	-17 (ix), a
	ld	a, l
	adc	a, #0xff
	ld	-16 (ix), a
	ld	a, h
	adc	a, #0xff
	ld	-15 (ix), a
;pocket_platformer.c:621: long px_r = (player.x >> 8) + PLAYER_W + 1; /* 1px beyond right edge */
	ld	a, e
	add	a, #0x07
	ld	-10 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-9 (ix), a
	ld	a, l
	adc	a, #0x00
	ld	-8 (ix), a
	ld	a, h
	adc	a, #0x00
	ld	-7 (ix), a
;pocket_platformer.c:622: unsigned char px8_l = (unsigned char)(px_l >= 0 ? px_l / TILE_SIZE : 255);
	ld	a, -15 (ix)
	rlca
	and	a,#0x01
	ld	-14 (ix), a
	bit	0, -14 (ix)
	jr	NZ, 00172$
	ld	a, -18 (ix)
	ld	-6 (ix), a
	ld	a, -17 (ix)
	ld	-5 (ix), a
	ld	a, -16 (ix)
	ld	-4 (ix), a
	ld	a, -15 (ix)
	ld	-3 (ix), a
	ld	a, -14 (ix)
	or	a, a
	jr	Z, 00174$
	ld	a, -18 (ix)
	add	a, #0x07
	ld	-6 (ix), a
	ld	a, -17 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
	ld	a, -16 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -15 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
00174$:
	ld	a, #0x03
00515$:
	sra	-3 (ix)
	rr	-4 (ix)
	rr	-5 (ix)
	rr	-6 (ix)
	dec	a
	jr	NZ, 00515$
	jr	00173$
00172$:
	ld	-6 (ix), #0xff
	xor	a, a
	ld	-5 (ix), a
	ld	-4 (ix), a
	ld	-3 (ix), a
00173$:
	ld	a, -6 (ix)
	ld	-13 (ix), a
;pocket_platformer.c:623: unsigned char px8_r = (unsigned char)(px_r / TILE_SIZE);
	ld	e, -10 (ix)
	ld	d, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	bit	7, -7 (ix)
	jr	Z, 00175$
	ld	a, -10 (ix)
	add	a, #0x07
	ld	e, a
	ld	a, -9 (ix)
	adc	a, #0x00
	ld	d, a
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
00175$:
	srl	d
	rr	e
	srl	d
	rr	e
	srl	d
	rr	e
	ld	-12 (ix), e
;pocket_platformer.c:624: unsigned char py8   = (unsigned char)((player.y >> 8) / TILE_SIZE);
	ld	de, (#_player + 4)
	ld	hl, (#_player + 6)
	ld	a, #0x08
00517$:
	sra	h
	rr	l
	rr	d
	rr	e
	dec	a
	jr	NZ, 00517$
	ld	-11 (ix), e
	ld	-10 (ix), d
	ld	-9 (ix), l
	ld	-8 (ix), h
	ld	e, -11 (ix)
	ld	d, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -11 (ix)
	add	a, #0x07
	ld	-7 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, -9 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	bit	7, -8 (ix)
	jr	Z, 00176$
	ld	e, -7 (ix)
	ld	d, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
00176$:
	srl	d
	rr	e
	srl	d
	rr	e
	srl	d
	rr	e
	ld	-3 (ix), e
;pocket_platformer.c:625: unsigned char pb8   = (unsigned char)(((player.y >> 8) + PLAYER_H - 1) / TILE_SIZE);
	ld	e, -7 (ix)
	ld	d, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	bit	7, -4 (ix)
	jr	Z, 00177$
	ld	a, -11 (ix)
	add	a, #0x0e
	ld	e, a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	d, a
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
00177$:
	srl	d
	rr	e
	srl	d
	rr	e
	srl	d
	rr	e
	ld	-4 (ix), e
;pocket_platformer.c:628: unsigned char wall_left  = (px_l >= 0) &&
	bit	0, -14 (ix)
	jp	NZ, 00178$
	push	bc
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_get_tile
	pop	bc
	or	a, a
	jr	Z, 00186$
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	a, (hl)
	or	a, a
	jr	Z, 00191$
	push	bc
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_get_tile
	pop	bc
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	e, (hl)
	sub	a, e
	jr	Z, 00186$
00191$:
	push	bc
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_rb_is_passable
	pop	bc
	or	a, a
	jr	NZ, 00186$
	push	bc
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_vp_is_passable
	pop	bc
	or	a, a
	jr	Z, 00179$
00186$:
	push	bc
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_get_tile
	pop	bc
	or	a, a
	jr	Z, 00178$
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	a, (hl)
	or	a, a
	jr	Z, 00203$
	push	bc
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_get_tile
	pop	bc
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	e, (hl)
	sub	a, e
	jr	Z, 00178$
00203$:
	push	bc
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_rb_is_passable
	pop	bc
	or	a, a
	jr	NZ, 00178$
	push	bc
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_vp_is_passable
	pop	bc
	or	a, a
	jr	Z, 00179$
00178$:
	xor	a, a
	jr	00180$
00179$:
	ld	a, #0x01
00180$:
	ld	-5 (ix), a
;pocket_platformer.c:630: unsigned char wall_right =
	push	bc
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -12 (ix)
	call	_get_tile
	pop	bc
	or	a, a
	jr	Z, 00213$
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	a, (hl)
	or	a, a
	jr	Z, 00218$
	push	bc
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -12 (ix)
	call	_get_tile
	pop	bc
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	e, (hl)
	sub	a, e
	jr	Z, 00213$
00218$:
	push	bc
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -12 (ix)
	call	_rb_is_passable
	pop	bc
	or	a, a
	jr	NZ, 00213$
	push	bc
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -12 (ix)
	call	_vp_is_passable
	pop	bc
	or	a, a
	jr	Z, 00209$
00213$:
	push	bc
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -12 (ix)
	call	_get_tile
	pop	bc
	or	a, a
	jr	Z, 00208$
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	a, (hl)
	or	a, a
	jr	Z, 00230$
	push	bc
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -12 (ix)
	call	_get_tile
	pop	bc
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	e, (hl)
	sub	a, e
	jr	Z, 00208$
00230$:
	push	bc
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -12 (ix)
	call	_rb_is_passable
	pop	bc
	or	a, a
	jr	NZ, 00208$
	push	bc
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -12 (ix)
	call	_vp_is_passable
	pop	bc
	or	a, a
	jr	Z, 00209$
00208$:
	xor	a, a
	jr	00210$
00209$:
	ld	a, #0x01
00210$:
	ld	-6 (ix), a
;pocket_platformer.c:637: player.jumping = 1;
;pocket_platformer.c:638: player.wall_jumping = 0;
;pocket_platformer.c:639: player.jump_frames = 0;
;pocket_platformer.c:640: player.falling = 0;
;pocket_platformer.c:653: player.wall_jump_dir = wall_left ? 1 : 255;
;pocket_platformer.c:654: player.wall_push_frames = 0;
;pocket_platformer.c:635: if (joy_pressed & PORT_A_KEY_1) {
	bit	4, c
	jp	Z,00133$
;pocket_platformer.c:636: if (player.on_ground) {
	ld	hl, #(_player + 16)
	ld	c, (hl)
	ld	a, c
	or	a, a
	jr	Z, 00130$
;pocket_platformer.c:637: player.jumping = 1;
	ld	hl, #(_player + 18)
	ld	(hl), #0x01
;pocket_platformer.c:638: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:639: player.jump_frames = 0;
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
;pocket_platformer.c:640: player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
;pocket_platformer.c:641: player.on_ground = 0;
	ld	hl, #(_player + 16)
	ld	(hl), #0x00
;pocket_platformer.c:642: if (vp_block_count) vp_toggle();
	ld	a, (_vp_block_count+0)
	or	a, a
	jp	Z, 00133$
	call	_vp_toggle
	jp	00133$
00130$:
;pocket_platformer.c:598: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
;pocket_platformer.c:643: } else if (res_physics->has_wall_jump && !player.on_ground &&
	ld	-4 (ix), l
	ld	-3 (ix), h
	ld	de, #16
	add	hl, de
;pocket_platformer.c:650: player.double_jump_used = 0;
;pocket_platformer.c:643: } else if (res_physics->has_wall_jump && !player.on_ground &&
	ld	a, (hl)
	or	a, a
	jr	Z, 00124$
	ld	a, c
	or	a, a
	jr	NZ, 00124$
;pocket_platformer.c:644: (wall_left || wall_right)) {
	ld	a, -5 (ix)
	or	a, a
	jr	NZ, 00123$
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00124$
00123$:
;pocket_platformer.c:646: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:647: player.wall_jumping = 1;
	ld	hl, #(_player + 19)
	ld	(hl), #0x01
;pocket_platformer.c:648: player.jump_frames = 0;
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
;pocket_platformer.c:649: player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
;pocket_platformer.c:650: player.double_jump_used = 0;
	ld	hl, #(_player + 24)
	ld	(hl), #0x00
;pocket_platformer.c:653: player.wall_jump_dir = wall_left ? 1 : 255;
	ld	a, -5 (ix)
	or	a, a
	jr	Z, 00235$
	ld	-4 (ix), #0x01
	ld	-3 (ix), #0
	jr	00236$
00235$:
	ld	-4 (ix), #0xff
	ld	-3 (ix), #0
00236$:
	ld	a, -4 (ix)
	ld	-3 (ix), a
	ld	hl, #(_player + 20)
	ld	a, -3 (ix)
	ld	(hl), a
;pocket_platformer.c:654: player.wall_push_frames = 0;
	ld	hl, #(_player + 21)
	ld	(hl), #0x00
;pocket_platformer.c:655: if (vp_block_count) vp_toggle();
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00133$
	call	_vp_toggle
	jr	00133$
00124$:
;pocket_platformer.c:656: } else if (res_physics->has_double_jump && !player.double_jump_used) {
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	de, #0x000f
	add	hl, de
	ld	a, (hl)
	ld	-3 (ix), a
	or	a, a
	jr	Z, 00133$
	ld	a, (#(_player + 24) + 0)
	ld	-3 (ix), a
	or	a, a
	jr	NZ, 00133$
;pocket_platformer.c:657: player.jumping = 1;
	ld	hl, #(_player + 18)
	ld	(hl), #0x01
;pocket_platformer.c:658: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:659: player.jump_frames = 0;
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
;pocket_platformer.c:660: player.double_jump_used = 1;
	ld	hl, #(_player + 24)
	ld	(hl), #0x01
;pocket_platformer.c:661: if (vp_block_count) vp_toggle();
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00133$
	call	_vp_toggle
00133$:
;pocket_platformer.c:668: if (player.jumping) {
	ld	hl, #(_player + 18)
	ld	c, (hl)
;pocket_platformer.c:669: if (joy & PORT_A_KEY_1 || player.forced_jump_speed > 0) {
	ld	a, -2 (ix)
	and	a, #0x10
	ld	-6 (ix), a
	ld	-5 (ix), #0x00
;pocket_platformer.c:673: player.vy = -(remaining * js);
;pocket_platformer.c:668: if (player.jumping) {
	ld	a, c
	or	a, a
	jp	Z, 00143$
;pocket_platformer.c:669: if (joy & PORT_A_KEY_1 || player.forced_jump_speed > 0) {
	ld	de, #(_player + 28)
	ld	hl, #8
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	xor	a, a
	cp	a, -10 (ix)
	sbc	a, -9 (ix)
	ld	a, #0x00
	sbc	a, -8 (ix)
	ld	a, #0x00
	sbc	a, -7 (ix)
	jp	PO, 00524$
	xor	a, #0x80
00524$:
	rlca
	and	a,#0x01
	ld	-3 (ix), a
	ld	a, -5 (ix)
	or	a, -6 (ix)
	jr	NZ, 00138$
	ld	a, -3 (ix)
	or	a, a
	jp	Z, 00139$
00138$:
;pocket_platformer.c:670: long js = player.forced_jump_speed > 0 ? player.forced_jump_speed : (long)res_physics->jump_speed;
	ld	a, -3 (ix)
	or	a, a
	jr	NZ, 00238$
	ld	hl, (_res_physics)
	ld	-4 (ix), l
	ld	-3 (ix), h
	ld	de, #0x000a
	add	hl, de
	ld	a, (hl)
	ld	-4 (ix), a
	inc	hl
	ld	a, (hl)
	ld	-3 (ix), a
	ld	a, -4 (ix)
	ld	-10 (ix), a
	ld	a, -3 (ix)
	ld	-9 (ix), a
	rlca
	sbc	a, a
	ld	-8 (ix), a
	ld	-7 (ix), a
00238$:
	ld	c, -10 (ix)
	ld	b, -9 (ix)
	push	iy
	ex	(sp), hl
	ld	l, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	ex	(sp), hl
	ld	h, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	pop	iy
;pocket_platformer.c:671: player.jump_frames++;
	ld	a, (#(_player + 22) + 0)
	inc	a
	ld	-3 (ix), a
	ld	hl, #(_player + 22)
	ld	a, -3 (ix)
	ld	(hl), a
;pocket_platformer.c:672: long remaining = (long)(res_physics->max_jump_frames - player.jump_frames);
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	e, -3 (ix)
	ld	d, #0x00
	cp	a, a
	sbc	hl, de
	ex	de, hl
	ld	a, d
	rlca
	sbc	hl, hl
;pocket_platformer.c:673: player.vy = -(remaining * js);
	push	iy
	push	bc
	call	__mullong
	pop	af
	pop	af
	xor	a, a
	sub	a, e
	ld	c, a
	ld	a, #0x00
	sbc	a, d
	ld	b, a
	ld	a, #0x00
	sbc	a, l
	ld	e, a
	sbc	a, a
	sub	a, h
	ld	d, a
	ld	((_player + 12)), bc
	ld	((_player + 12)+2), de
;pocket_platformer.c:674: if (player.jump_frames >= res_physics->max_jump_frames) {
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	a,-3 (ix)
	sub	a,(hl)
	jr	C, 00143$
;pocket_platformer.c:675: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:676: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
;pocket_platformer.c:677: player.forced_jump_speed = 0;
	ld	hl, #0x0000
	ld	((_player + 28)), hl
	ld	((_player + 28)+2), hl
	jr	00143$
00139$:
;pocket_platformer.c:679: } else if (player.forced_jump_speed == 0) {
	ld	a, -7 (ix)
	or	a, -8 (ix)
	or	a, -9 (ix)
	or	a, -10 (ix)
	jr	NZ, 00143$
;pocket_platformer.c:681: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:682: player.jump_frames = res_physics->max_jump_frames;
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	a, (hl)
	ld	(#(_player + 22)),a
;pocket_platformer.c:683: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
00143$:
;pocket_platformer.c:689: if (player.wall_jumping) {
	ld	a, (#(_player + 19) + 0)
	or	a, a
	jp	Z, 00159$
;pocket_platformer.c:690: if (joy & PORT_A_KEY_1) {
	ld	a, -5 (ix)
	or	a, -6 (ix)
	jp	Z, 00156$
;pocket_platformer.c:691: player.jump_frames++;
	ld	a, (#(_player + 22) + 0)
	inc	a
	ld	(#(_player + 22)),a
;pocket_platformer.c:598: long max_spd = (long)res_physics->max_speed;
	ld	bc, (_res_physics)
;pocket_platformer.c:692: long remaining = (long)(res_physics->max_jump_frames - player.jump_frames);
	ld	e, c
	ld	d, b
	ld	hl, #12
	add	hl, de
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	e, a
	ld	d, #0x00
	cp	a, a
	sbc	hl, de
	ld	-8 (ix), l
	ld	a, h
	ld	-7 (ix), a
	rlca
	sbc	a, a
	ld	-6 (ix), a
	ld	-5 (ix), a
;pocket_platformer.c:693: player.vy = -(remaining * (long)res_physics->jump_speed);
	ld	hl, #10
	add	hl, bc
	ld	c, (hl)
	inc	hl
	ld	a, (hl)
	ld	b, a
	rlca
	sbc	hl, hl
	push	hl
	push	bc
	ld	e, -8 (ix)
	ld	d, -7 (ix)
	ld	l, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	__mullong
	pop	af
	pop	af
	xor	a, a
	sub	a, e
	ld	c, a
	ld	a, #0x00
	sbc	a, d
	ld	b, a
	ld	a, #0x00
	sbc	a, l
	ld	e, a
	sbc	a, a
	sub	a, h
	ld	d, a
	ld	((_player + 12)), bc
	ld	((_player + 12)+2), de
;pocket_platformer.c:695: if (player.wall_push_frames < (res_physics->max_jump_frames / 2 - 4)) {
	ld	hl, #(_player + 21)
	ld	c, (hl)
;pocket_platformer.c:598: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
;pocket_platformer.c:695: if (player.wall_push_frames < (res_physics->max_jump_frames / 2 - 4)) {
	ld	-4 (ix), l
	ld	-3 (ix), h
	ld	de, #12
	add	hl, de
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	e, l
	ld	d, h
	bit	7, h
	jr	Z, 00239$
	ex	de, hl
	inc	de
00239$:
	sra	d
	rr	e
	ld	a, e
	add	a, #0xfc
	ld	e, a
	ld	a, d
	adc	a, #0xff
	ld	d, a
	ld	b, #0x00
	ld	a, c
	sub	a, e
	ld	a, b
	sbc	a, d
	jp	PO, 00525$
	xor	a, #0x80
00525$:
	jp	P, 00152$
;pocket_platformer.c:697: long push = remaining * (long)res_physics->jump_speed;
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	ld	hl, #10
	add	hl, bc
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
	ld	a, b
	rlca
	sbc	hl, hl
	push	hl
	push	bc
	ld	e, -8 (ix)
	ld	d, -7 (ix)
	ld	l, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	__mullong
	pop	af
	pop	af
	ld	c, l
	ld	b, h
;pocket_platformer.c:698: if (player.wall_jump_dir == 1) {   /* off left wall → push right */
	ld	a, (#(_player + 20) + 0)
	ld	-3 (ix), a
;pocket_platformer.c:612: player.vx = FP_MUL(player.vx, fric);
	push	de
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #8
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
;pocket_platformer.c:699: player.vx += push >> 4;         /* scale down push */
	ld	-10 (ix), e
	ld	-9 (ix), d
	ld	-8 (ix), c
	ld	-7 (ix), b
	ld	b, #0x04
00526$:
	sra	-7 (ix)
	rr	-8 (ix)
	rr	-9 (ix)
	rr	-10 (ix)
	djnz	00526$
;pocket_platformer.c:698: if (player.wall_jump_dir == 1) {   /* off left wall → push right */
	ld	a, -3 (ix)
	dec	a
	jr	NZ, 00149$
;pocket_platformer.c:699: player.vx += push >> 4;         /* scale down push */
	ld	a, -14 (ix)
	add	a, -10 (ix)
	ld	-6 (ix), a
	ld	a, -13 (ix)
	adc	a, -9 (ix)
	ld	-5 (ix), a
	ld	a, -12 (ix)
	adc	a, -8 (ix)
	ld	-4 (ix), a
	ld	a, -11 (ix)
	adc	a, -7 (ix)
	ld	-3 (ix), a
	ld	de, #(_player + 8)
	ld	hl, #12
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:598: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
;pocket_platformer.c:700: if (player.vx > (long)res_physics->max_speed)
	ld	a, b
	rlca
	sbc	a, a
	ld	e, a
	ld	d, a
	ld	a, c
	sub	a, -6 (ix)
	ld	a, b
	sbc	a, -5 (ix)
	ld	a, e
	sbc	a, -4 (ix)
	ld	a, d
	sbc	a, -3 (ix)
	jp	PO, 00530$
	xor	a, #0x80
00530$:
	jp	P, 00150$
;pocket_platformer.c:701: player.vx = (long)res_physics->max_speed;
	ld	((_player + 8)), bc
	ld	((_player + 8)+2), de
	jr	00150$
00149$:
;pocket_platformer.c:703: player.vx -= push >> 4;
	ld	a, -14 (ix)
	sub	a, -10 (ix)
	ld	-6 (ix), a
	ld	a, -13 (ix)
	sbc	a, -9 (ix)
	ld	-5 (ix), a
	ld	a, -12 (ix)
	sbc	a, -8 (ix)
	ld	-4 (ix), a
	ld	a, -11 (ix)
	sbc	a, -7 (ix)
	ld	-3 (ix), a
	ld	de, #(_player + 8)
	ld	hl, #12
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:598: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
;pocket_platformer.c:700: if (player.vx > (long)res_physics->max_speed)
	ld	a, b
	rlca
	sbc	a, a
	ld	e, a
	ld	d, a
;pocket_platformer.c:704: if (player.vx < -(long)res_physics->max_speed)
	xor	a, a
	sub	a, c
	ld	c, a
	ld	a, #0x00
	sbc	a, b
	ld	b, a
	ld	hl, #0x0000
	sbc	hl, de
	ex	de, hl
	ld	a, -6 (ix)
	sub	a, c
	ld	a, -5 (ix)
	sbc	a, b
	ld	a, -4 (ix)
	sbc	a, e
	ld	a, -3 (ix)
	sbc	a, d
	jp	PO, 00531$
	xor	a, #0x80
00531$:
	jp	P, 00150$
;pocket_platformer.c:705: player.vx = -(long)res_physics->max_speed;
	ld	((_player + 8)), bc
	ld	((_player + 8)+2), de
00150$:
;pocket_platformer.c:707: player.wall_push_frames++;
	ld	a, (#(_player + 21) + 0)
	inc	a
	ld	(#(_player + 21)),a
00152$:
;pocket_platformer.c:709: if (player.jump_frames >= res_physics->max_jump_frames) {
	ld	a, (#(_player + 22) + 0)
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	c, (hl)
	sub	a, c
	jr	C, 00159$
;pocket_platformer.c:710: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:711: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
	jr	00159$
00156$:
;pocket_platformer.c:714: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:715: player.jump_frames = res_physics->max_jump_frames;
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	a, (hl)
	ld	(#(_player + 22)),a
;pocket_platformer.c:716: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
00159$:
;pocket_platformer.c:721: if (!player.jumping && !player.wall_jumping && player.vy < 0) {
	ld	a, (#(_player + 18) + 0)
	or	a, a
	jr	NZ, 00166$
	ld	a, (#(_player + 19) + 0)
	or	a, a
	jr	NZ, 00166$
	ld	bc, (#(_player + 12) + 0)
	ld	hl, (#(_player + 12) + 2)
	bit	7, h
	jr	Z, 00166$
;pocket_platformer.c:722: player.vy = FP_MUL(player.vy, FP(0.75));
	push	hl
	push	bc
	ld	de, #0x00c0
	ld	hl, #0x0000
	call	__mullong
	pop	af
	pop	af
	ld	c, l
	ld	b, h
	ld	a, #0x08
00532$:
	sra	b
	rr	c
	rr	d
	rr	e
	dec	a
	jr	NZ, 00532$
	ld	((_player + 12)), de
	ld	((_player + 12)+2), bc
;pocket_platformer.c:723: if (player.vy > -FP(0.5)) player.vy = 0;
	ld	a, #0x80
	cp	a, e
	ld	a, #0xff
	sbc	a, d
	ld	a, #0xff
	sbc	a, c
	ld	a, #0xff
	sbc	a, b
	jp	PO, 00534$
	xor	a, #0x80
00534$:
	jp	P, 00166$
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
00166$:
;pocket_platformer.c:725: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:727: static void move_player_x(void) {
;	---------------------------------
; Function move_player_x
; ---------------------------------
_move_player_x:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-12
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:728: long total_vx = player.vx + (treadmill_active ? treadmill_bonus : 0);
	ld	de, #(_player + 8)
	ld	hl, #4
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	a, (_treadmill_active+0)
	or	a, a
	jr	Z, 00114$
	ld	hl, #8
	add	hl, sp
	ex	de, hl
	ld	hl, #_treadmill_bonus
	ld	bc, #4
	ldir
	jr	00115$
00114$:
	xor	a, a
	ld	-4 (ix), a
	ld	-3 (ix), a
	ld	-2 (ix), a
	ld	-1 (ix), a
00115$:
	ld	a, -8 (ix)
	add	a, -4 (ix)
	ld	c, a
	ld	a, -7 (ix)
	adc	a, -3 (ix)
	ld	b, a
	ld	a, -6 (ix)
	adc	a, -2 (ix)
	ld	e, a
	ld	a, -5 (ix)
	adc	a, -1 (ix)
	ld	d, a
;pocket_platformer.c:729: long new_x = player.x + total_vx;
	push	de
	push	bc
	ld	de, #_player
	ld	hl, #12
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
	ld	a, c
	add	a, -4 (ix)
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, b
	adc	a, -3 (ix)
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, e
	adc	a, -2 (ix)
	push	iy
	ld	-14 (ix), a
	pop	iy
	ld	a, d
	adc	a, -1 (ix)
	ex	(sp), hl
	push	iy
	ex	(sp), hl
	ld	-10 (ix), l
	ex	(sp), hl
	pop	iy
	ld	-9 (ix), a
;pocket_platformer.c:730: long px    = new_x >> 8;
	ld	a, -12 (ix)
	ld	-8 (ix), a
	ld	a, -11 (ix)
	ld	-7 (ix), a
	ld	a, -10 (ix)
	ld	-6 (ix), a
	ld	a, -9 (ix)
	ld	-5 (ix), a
	ld	a, #0x08
00153$:
	sra	-5 (ix)
	rr	-6 (ix)
	rr	-7 (ix)
	rr	-8 (ix)
	dec	a
	jr	NZ, 00153$
;pocket_platformer.c:733: if (is_solid_px(r, player.y + FP(1)) ||
;pocket_platformer.c:731: if (total_vx > 0) {
	xor	a, a
	cp	a, c
	sbc	a, b
	ld	a, #0x00
	sbc	a, e
	ld	a, #0x00
	sbc	a, d
	jp	PO, 00155$
	xor	a, #0x80
00155$:
	jp	P, 00110$
;pocket_platformer.c:732: long r = new_x + FP(PLAYER_W);
	ld	a, -12 (ix)
	ld	-4 (ix), a
	ld	a, -11 (ix)
	add	a, #0x06
	ld	-3 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -9 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
;pocket_platformer.c:733: if (is_solid_px(r, player.y + FP(1)) ||
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, b
	add	a, #0x01
	ld	b, a
	jr	NC, 00156$
	inc	hl
00156$:
	push	hl
	push	bc
	ld	e, -4 (ix)
	ld	d, -3 (ix)
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	_is_solid_px
	or	a, a
	jr	NZ, 00101$
;pocket_platformer.c:734: is_solid_px(r, player.y + FP(PLAYER_H - 2))) {
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, b
	add	a, #0x06
	ld	b, a
	jr	NC, 00157$
	inc	hl
00157$:
	push	hl
	push	bc
	ld	e, -4 (ix)
	ld	d, -3 (ix)
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	_is_solid_px
	or	a, a
	jp	Z, 00111$
00101$:
;pocket_platformer.c:735: long tile_r = (px + PLAYER_W) / TILE_SIZE;
	ld	a, -8 (ix)
	add	a, #0x06
	ld	c, a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	d, a
	ld	-4 (ix), c
	ld	-3 (ix), b
	ld	-2 (ix), e
	ld	-1 (ix), d
	bit	7, d
	jr	Z, 00116$
	ld	a, c
	add	a, #0x07
	ld	-4 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-1 (ix), a
00116$:
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	e, -2 (ix)
	ld	d, -1 (ix)
	ld	b, #0x03
00158$:
	sra	d
	rr	e
	rr	h
	rr	l
	djnz	00158$
;pocket_platformer.c:736: new_x = (tile_r * TILE_SIZE - PLAYER_W - 1) * FP_ONE;
	ld	b, #0x03
00160$:
	add	hl, hl
	rl	e
	rl	d
	djnz	00160$
	ld	bc, #0xfff9
	add	hl,bc
	ld	c, l
	ld	b, h
	ld	a, e
	adc	a, #0xff
	ld	e, a
	ld	a, d
	adc	a, #0xff
	ld	-11 (ix), c
	ld	-10 (ix), b
	ld	-9 (ix), e
	ld	-12 (ix), #0x00
;pocket_platformer.c:737: player.vx = 0;
	ld	hl, #0x0000
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
	jp	00111$
00110$:
;pocket_platformer.c:739: } else if (total_vx < 0) {
	bit	7, d
	jp	Z, 00111$
;pocket_platformer.c:740: if (is_solid_px(new_x, player.y + FP(1)) ||
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, b
	add	a, #0x01
	ld	b, a
	jr	NC, 00164$
	inc	hl
00164$:
	push	hl
	push	bc
	ld	e, -12 (ix)
	ld	d, -11 (ix)
	ld	l, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	_is_solid_px
	or	a, a
	jr	NZ, 00104$
;pocket_platformer.c:741: is_solid_px(new_x, player.y + FP(PLAYER_H - 2))) {
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, b
	add	a, #0x06
	ld	b, a
	jr	NC, 00165$
	inc	hl
00165$:
	push	hl
	push	bc
	ld	e, -12 (ix)
	ld	d, -11 (ix)
	ld	l, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	_is_solid_px
	or	a, a
	jr	Z, 00111$
00104$:
;pocket_platformer.c:742: long tile_l = px / TILE_SIZE + 1;
	ld	c, -8 (ix)
	ld	b, -7 (ix)
	ld	l, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	bit	7, -5 (ix)
	jr	Z, 00117$
	ld	a, -8 (ix)
	add	a, #0x07
	ld	c, a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
00117$:
	ld	e, c
	ld	d, b
	ld	b, #0x03
00166$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00166$
	inc	e
	jr	NZ, 00168$
	inc	d
	jr	NZ, 00168$
	inc	hl
00168$:
;pocket_platformer.c:743: new_x = tile_l * TILE_SIZE * FP_ONE;
	ld	h, l
;	spillPairReg hl
;	spillPairReg hl
	ld	l, d
;	spillPairReg hl
;	spillPairReg hl
	ld	d, e
	ld	e, #0x00
	ld	b, #0x03
00169$:
	sla	d
	adc	hl, hl
	djnz	00169$
	inc	sp
	inc	sp
	push	de
	ld	-10 (ix), l
	ld	-9 (ix), h
;pocket_platformer.c:744: player.vx = 0;
	ld	hl, #0x0000
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
00111$:
;pocket_platformer.c:747: player.x = new_x;
	ld	de, #_player
	ld	hl, #0
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:748: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:750: static void move_player_y(void) {
;	---------------------------------
; Function move_player_y
; ---------------------------------
_move_player_y:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-29
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:751: long new_y = player.y + player.vy;
	ld	bc, (#(_player + 4) + 0)
	ld	de, (#(_player + 4) + 2)
	push	de
	push	bc
	ld	de, #(_player + 12)
	ld	hl, #13
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
	ld	a, c
	add	a, -20 (ix)
	ld	c, a
	ld	a, b
	adc	a, -19 (ix)
	ld	b, a
	ld	a, e
	adc	a, -18 (ix)
	ld	e, a
	ld	a, d
	adc	a, -17 (ix)
	ld	-4 (ix), c
	ld	-3 (ix), b
	ld	-2 (ix), e
	ld	-1 (ix), a
;pocket_platformer.c:752: long py    = new_y >> 8;
	ld	a, -4 (ix)
	ld	-8 (ix), a
	ld	a, -3 (ix)
	ld	-7 (ix), a
	ld	a, -2 (ix)
	ld	-6 (ix), a
	ld	a, -1 (ix)
	ld	-5 (ix), a
	ld	b, #0x08
00338$:
	sra	-5 (ix)
	rr	-6 (ix)
	rr	-7 (ix)
	rr	-8 (ix)
	djnz	00338$
	ld	hl, #13
	add	hl, sp
	ex	de, hl
	ld	hl, #21
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:755: if (is_solid_falling_px(player.x + FP(1),            b) ||
	ld	bc, (#_player + 0)
	ld	hl, (#_player + 2)
;pocket_platformer.c:780: player.jumping = 0;
;pocket_platformer.c:781: player.wall_jumping = 0;
;pocket_platformer.c:755: if (is_solid_falling_px(player.x + FP(1),            b) ||
	ld	-12 (ix), c
	ld	a, b
	add	a, #0x01
	ld	-11 (ix), a
	ld	a, l
	adc	a, #0x00
	ld	-10 (ix), a
	ld	a, h
	adc	a, #0x00
	ld	-9 (ix), a
;pocket_platformer.c:753: if (player.vy >= 0) {
	bit	7, -17 (ix)
	jp	NZ, 00131$
;pocket_platformer.c:754: long b = new_y + FP(PLAYER_H);
	ld	c, -4 (ix)
	ld	a, -3 (ix)
	add	a, #0x08
	ld	b, a
	ld	a, -2 (ix)
	adc	a, #0x00
	push	iy
	ld	-31 (ix), a
	pop	iy
	ld	a, -1 (ix)
	adc	a, #0x00
	push	iy
	ld	-30 (ix), a
	pop	iy
;pocket_platformer.c:755: if (is_solid_falling_px(player.x + FP(1),            b) ||
	push	bc
	push	iy
	push	iy
	push	bc
	ld	e, -12 (ix)
	ld	d, -11 (ix)
	ld	l, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	_is_solid_falling_px
	pop	iy
	pop	bc
	or	a, a
	jr	NZ, 00108$
;pocket_platformer.c:756: is_solid_falling_px(player.x + FP(PLAYER_W - 2), b)) {
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	a, d
	add	a, #0x04
	ld	d, a
	jr	NC, 00340$
	inc	hl
00340$:
	push	iy
	push	bc
	call	_is_solid_falling_px
	or	a, a
	jp	Z, 00132$
00108$:
;pocket_platformer.c:757: long tile_b = (py + PLAYER_H) / TILE_SIZE;
	ld	a, -16 (ix)
	add	a, #0x08
	ld	-12 (ix), a
	ld	a, -15 (ix)
	adc	a, #0x00
	ld	-11 (ix), a
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	-10 (ix), a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	-9 (ix), a
	ld	hl, #21
	add	hl, sp
	ex	de, hl
	ld	hl, #17
	add	hl, sp
	ld	bc, #4
	ldir
	bit	7, -9 (ix)
	jr	Z, 00141$
	ld	a, -12 (ix)
	add	a, #0x07
	ld	-8 (ix), a
	ld	a, -11 (ix)
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, -9 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
00141$:
	ld	a, -8 (ix)
	ld	-14 (ix), a
	ld	a, -7 (ix)
	ld	-13 (ix), a
	ld	a, -6 (ix)
	ld	-12 (ix), a
	ld	a, -5 (ix)
	ld	-11 (ix), a
	ld	b, #0x03
00341$:
	sra	-11 (ix)
	rr	-12 (ix)
	rr	-13 (ix)
	rr	-14 (ix)
	djnz	00341$
;pocket_platformer.c:760: if (res_header->one_way_vram_idx) {
	ld	iy, (_res_header)
	ld	a, 6 (iy)
	or	a, a
	jp	Z, 00106$
;pocket_platformer.c:761: unsigned char t1 = get_tile(
	ld	a, -14 (ix)
	ld	-5 (ix), a
	ld	bc, (#_player + 0)
	ld	de, (#_player + 2)
	ld	a, #0x08
00343$:
	sra	d
	rr	e
	rr	b
	rr	c
	dec	a
	jr	NZ, 00343$
	ld	-9 (ix), c
	ld	-8 (ix), b
	ld	-7 (ix), e
	ld	-6 (ix), d
	bit	7, d
	jr	Z, 00142$
	ld	a, c
	add	a, #0x07
	ld	-9 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-8 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-6 (ix), a
00142$:
	ld	c, -9 (ix)
	ld	b, -8 (ix)
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_get_tile
	ld	-10 (ix), a
;pocket_platformer.c:764: unsigned char t2 = get_tile(
	ld	a, -5 (ix)
	ld	-9 (ix), a
	ld	bc, (#_player + 0)
	ld	de, (#_player + 2)
	ld	a, #0x08
00345$:
	sra	d
	rr	e
	rr	b
	rr	c
	dec	a
	jr	NZ, 00345$
	ld	-8 (ix), c
	ld	-7 (ix), b
	ld	-6 (ix), e
	ld	-5 (ix), d
	bit	7, d
	jr	Z, 00143$
	ld	a, c
	add	a, #0x07
	ld	-8 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-5 (ix), a
00143$:
	ld	c, -8 (ix)
	ld	b, -7 (ix)
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	inc	c
	ld	l, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_get_tile
	ld	c, a
;pocket_platformer.c:760: if (res_header->one_way_vram_idx) {
	ld	iy, (_res_header)
;pocket_platformer.c:767: unsigned char is_one_way =
	ld	b, 6 (iy)
	ld	a, -10 (ix)
	sub	a, b
	jr	Z, 00145$
	ld	a, c
	sub	a, b
	jr	Z, 00145$
	xor	a, a
	jr	00146$
00145$:
	ld	a, #0x01
00146$:
;pocket_platformer.c:770: if (is_one_way) {
	or	a, a
	jr	Z, 00106$
;pocket_platformer.c:771: long prev_feet = player.y + FP(PLAYER_H);
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	-8 (ix), c
	ld	a, b
	add	a, #0x08
	ld	-7 (ix), a
	ld	a, l
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, h
	adc	a, #0x00
	ld	-5 (ix), a
;pocket_platformer.c:772: long tile_top  = tile_b * TILE_SIZE * FP_ONE;
	ld	d, -14 (ix)
	ld	l, -13 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -12 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	e, #0x00
	ld	b, #0x03
00349$:
	sla	d
	adc	hl, hl
	djnz	00349$
;pocket_platformer.c:773: if (prev_feet > tile_top) goto skip_land;
	ld	a, e
	sub	a, -8 (ix)
	ld	a, d
	sbc	a, -7 (ix)
	ld	a, l
	sbc	a, -6 (ix)
	ld	a, h
	sbc	a, -5 (ix)
	jp	PO, 00351$
	xor	a, #0x80
00351$:
	jp	M, 00132$
00106$:
;pocket_platformer.c:776: new_y = (tile_b * TILE_SIZE - PLAYER_H) * FP_ONE;
	ld	a, -14 (ix)
	ld	e, -13 (ix)
	ld	l, -12 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -11 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	b, #0x03
00352$:
	add	a, a
	rl	e
	adc	hl, hl
	djnz	00352$
	add	a, #0xf8
	ld	c, a
	ld	a, e
	adc	a, #0xff
	ld	b, a
	ld	a, l
	adc	a, #0xff
	ld	e, a
	ld	a, h
	adc	a, #0xff
	ld	-3 (ix), c
	ld	-2 (ix), b
	ld	-1 (ix), e
	ld	-4 (ix), #0x00
;pocket_platformer.c:777: player.vy = 0;
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
;pocket_platformer.c:778: player.on_ground = 1;
	ld	hl, #(_player + 16)
	ld	(hl), #0x01
;pocket_platformer.c:779: player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
;pocket_platformer.c:780: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:781: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:782: player.double_jump_used = 0;
	ld	hl, #(_player + 24)
	ld	(hl), #0x00
;pocket_platformer.c:783: skip_land:;
	jp	00132$
00131$:
;pocket_platformer.c:786: if (is_solid_px(player.x + FP(1),            new_y) ||
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	hl
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	hl
	ld	e, -12 (ix)
	ld	d, -11 (ix)
	ld	l, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	_is_solid_px
	or	a, a
	jr	NZ, 00127$
;pocket_platformer.c:787: is_solid_px(player.x + FP(PLAYER_W - 2), new_y)) {
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	a, d
	add	a, #0x04
	ld	d, a
	jr	NC, 00356$
	inc	hl
00356$:
	ld	c, -2 (ix)
	ld	b, -1 (ix)
	push	bc
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	push	bc
	call	_is_solid_px
	or	a, a
	jp	Z, 00132$
00127$:
;pocket_platformer.c:788: long tile_t = py / TILE_SIZE + 1;
	ld	l, -16 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -15 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	e, -14 (ix)
	ld	d, -13 (ix)
	bit	7, -13 (ix)
	jr	Z, 00147$
	ld	a, -16 (ix)
	add	a, #0x07
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -15 (ix)
	adc	a, #0x00
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	d, a
00147$:
	ld	b, #0x03
00357$:
	sra	d
	rr	e
	rr	h
	rr	l
	djnz	00357$
	ld	a, l
	add	a, #0x01
	ld	-29 (ix), a
	ld	a, h
	adc	a, #0x00
	ld	-28 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-27 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-26 (ix), a
;pocket_platformer.c:791: if (!rb_switch_locked && res_header->switch_vram_idx) {
	ld	a, (_rb_switch_locked+0)
	or	a, a
	jp	NZ, 00125$
	ld	hl, (_res_header)
	ld	de, #0x000d
	add	hl, de
	ld	a, (hl)
	or	a, a
	jp	Z, 00125$
;pocket_platformer.c:792: unsigned char htx_l = (unsigned char)((player.x >> 8) / TILE_SIZE);
	ld	bc, (#_player + 0)
	ld	de, (#_player + 2)
	ld	a, #0x08
00359$:
	sra	d
	rr	e
	rr	b
	rr	c
	dec	a
	jr	NZ, 00359$
	ld	-4 (ix), c
	ld	-3 (ix), b
	ld	-2 (ix), e
	ld	-1 (ix), d
	bit	7, d
	jr	Z, 00148$
	ld	a, c
	add	a, #0x07
	ld	-4 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-1 (ix), a
00148$:
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	srl	h
	rr	l
	srl	h
	rr	l
	srl	h
	rr	l
	ld	h, l
;	spillPairReg hl
;	spillPairReg hl
;pocket_platformer.c:793: unsigned char htx_r = (unsigned char)(((player.x >> 8) + PLAYER_W) / TILE_SIZE);
	ld	a, c
	add	a, #0x06
	ld	-12 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-11 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-10 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-9 (ix), a
	ld	a, -12 (ix)
	ld	-4 (ix), a
	ld	a, -11 (ix)
	ld	-3 (ix), a
	ld	a, -10 (ix)
	ld	-2 (ix), a
	ld	a, -9 (ix)
	ld	-1 (ix), a
	bit	7, -9 (ix)
	jr	Z, 00149$
	ld	a, c
	add	a, #0x0d
	ld	-4 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-1 (ix), a
00149$:
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:794: unsigned char hty   = (unsigned char)(tile_t - 1);  /* ceiling row */
	ld	a, -29 (ix)
	dec	a
	ld	b, a
;pocket_platformer.c:795: unsigned char tl = get_tile(htx_l, hty);
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, h
	call	_get_tile
	pop	bc
	ld	-1 (ix), a
;pocket_platformer.c:796: unsigned char tr = get_tile(htx_r, hty);
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_get_tile
	ld	c, a
;pocket_platformer.c:760: if (res_header->one_way_vram_idx) {
	ld	iy, (_res_header)
;pocket_platformer.c:797: if ((tl == res_header->switch_vram_idx || tl == res_header->switch_blue_vram_idx ||
	push	iy
	pop	de
	ld	hl, #13
	add	hl, de
	ld	e, (hl)
	ld	a, -1 (ix)
	sub	a, e
	jr	Z, 00119$
	ld	b, 14 (iy)
	ld	a, -1 (ix)
	sub	a, b
	jr	Z, 00119$
;pocket_platformer.c:798: tr == res_header->switch_vram_idx || tr == res_header->switch_blue_vram_idx)) {
	ld	a,c
	cp	a,e
	jr	Z, 00119$
	sub	a, b
	jp	NZ,00125$
00119$:
;pocket_platformer.c:800: rb_red_active = !rb_red_active;
	ld	a, (_rb_red_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
	ld	(_rb_red_active+0), a
;pocket_platformer.c:801: rb_redraw_all();
	call	_rb_redraw_all
;pocket_platformer.c:760: if (res_header->one_way_vram_idx) {
	ld	hl, (_res_header)
	ld	-2 (ix), l
	ld	-1 (ix), h
;pocket_platformer.c:804: unsigned char sw_idx = rb_red_active
	ld	a, (_rb_red_active+0)
	or	a, a
	jr	Z, 00150$
	ld	c, -2 (ix)
	ld	b, -1 (ix)
	ld	hl, #13
	add	hl, bc
	ld	c, (hl)
	jr	00151$
00150$:
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	de, #0x000e
	add	hl, de
	ld	c, (hl)
00151$:
	ld	b, c
;pocket_platformer.c:807: unsigned int sw_vt = sw_idx
	ld	a, c
	or	a, a
	jr	Z, 00152$
	ld	c, b
	ld	b, #0x00
	jr	00153$
00152$:
	ld	bc, #0x0000
00153$:
;pocket_platformer.c:809: for (si = 0; si < rb_switch_count; si++) {
	ld	e, #0x00
00134$:
	ld	hl, #_rb_switch_count
	ld	a, e
	sub	a, (hl)
	jr	NC, 00111$
;pocket_platformer.c:810: SMS_setNextTileatXY(rb_switches[si].tx % SCREEN_TILES_W,
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	ld	iy, #_rb_switches
	push	bc
	ld	c, l
	ld	b, h
	add	iy, bc
	pop	bc
	push	iy
	pop	hl
	inc	hl
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	a, l
	ld	d, h
	ld	l, 0 (iy)
;	spillPairReg hl
	push	af
	ld	a, l
	and	a, #0x1f
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	pop	af
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	a, l
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, d
	adc	a, h
	sla	l
	adc	a, a
	or	a, #0x78
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	rst	#0x08
	pop	bc
;pocket_platformer.c:812: SMS_setTile(sw_vt);
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x18
;pocket_platformer.c:809: for (si = 0; si < rb_switch_count; si++) {
	inc	e
	jr	00134$
00111$:
;pocket_platformer.c:818: long ppx = player.x >> 8, ppy = new_y >> 8;
	ld	bc, (#_player + 0)
	ld	de, (#_player + 2)
	ld	a, #0x08
00367$:
	sra	d
	rr	e
	rr	b
	rr	c
	dec	a
	jr	NZ, 00367$
	ld	a, -8 (ix)
	ld	-25 (ix), a
	ld	a, -7 (ix)
	ld	-24 (ix), a
	ld	a, -6 (ix)
	ld	-23 (ix), a
	ld	a, -5 (ix)
	ld	-22 (ix), a
;pocket_platformer.c:819: for (b = 0; b < rb_block_count; b++) {
	ld	a, -8 (ix)
	add	a, #0x08
	ld	-21 (ix), a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	-20 (ix), a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	-19 (ix), a
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	-18 (ix), a
	ld	a, c
	add	a, #0x06
	ld	-17 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-16 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-15 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-14 (ix), a
	ld	-1 (ix), #0x00
00137$:
	ld	hl, #_rb_block_count
	ld	a, -1 (ix)
	sub	a, (hl)
	jp	NC, 00118$
;pocket_platformer.c:820: long bx = (long)rb_blocks[b].tx * TILE_SIZE;
	push	de
	ld	e, -1 (ix)
	ld	d, #0x00
	ld	l, e
	ld	h, d
	add	hl, hl
	add	hl, de
	pop	de
	ld	iy, #_rb_blocks
	push	bc
	ld	c, l
	ld	b, h
	add	iy, bc
	pop	bc
	ld	a, 0 (iy)
	ld	-5 (ix), a
	xor	a, a
	ld	-4 (ix), a
	ld	-3 (ix), a
	ld	-2 (ix), a
	push	af
	ld	a, -5 (ix)
	ld	-13 (ix), a
	ld	a, -4 (ix)
	ld	-12 (ix), a
	ld	a, -3 (ix)
	ld	-11 (ix), a
	ld	a, -2 (ix)
	ld	-10 (ix), a
	pop	af
	ld	a, #0x03
00369$:
	sla	-13 (ix)
	rl	-12 (ix)
	rl	-11 (ix)
	rl	-10 (ix)
	dec	a
	jr	NZ,00369$
;pocket_platformer.c:821: long by = (long)rb_blocks[b].ty * TILE_SIZE;
	push	iy
	pop	hl
	inc	hl
	ld	a, (hl)
	ld	-5 (ix), a
	xor	a, a
	ld	-4 (ix), a
	ld	-3 (ix), a
	ld	-2 (ix), a
	push	af
	ld	a, -5 (ix)
	ld	-9 (ix), a
	ld	a, -4 (ix)
	ld	-8 (ix), a
	ld	a, -3 (ix)
	ld	-7 (ix), a
	ld	a, -2 (ix)
	ld	-6 (ix), a
	pop	af
	ld	a, #0x03
00371$:
	sla	-9 (ix)
	rl	-8 (ix)
	rl	-7 (ix)
	rl	-6 (ix)
	dec	a
	jr	NZ,00371$
;pocket_platformer.c:822: unsigned char solid = rb_blocks[b].is_red ? rb_red_active : !rb_red_active;
	ld	a, 2 (iy)
	or	a, a
	jr	Z, 00154$
	ld	a, (_rb_red_active+0)
	jr	00155$
00154$:
	ld	a, (_rb_red_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
00155$:
;pocket_platformer.c:823: if (solid &&
	or	a, a
	jp	Z, 00138$
;pocket_platformer.c:824: ppx + PLAYER_W > bx && ppx < bx + TILE_SIZE &&
	ld	a, -13 (ix)
	sub	a, -17 (ix)
	ld	a, -12 (ix)
	sbc	a, -16 (ix)
	ld	a, -11 (ix)
	sbc	a, -15 (ix)
	ld	a, -10 (ix)
	sbc	a, -14 (ix)
	jp	PO, 00373$
	xor	a, #0x80
00373$:
	jp	P, 00138$
	ld	a, -13 (ix)
	add	a, #0x08
	ld	-5 (ix), a
	ld	a, -12 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -11 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, c
	sub	a, -5 (ix)
	ld	a, b
	sbc	a, -4 (ix)
	ld	a, e
	sbc	a, -3 (ix)
	ld	a, d
	sbc	a, -2 (ix)
	jp	PO, 00374$
	xor	a, #0x80
00374$:
	jp	P, 00138$
;pocket_platformer.c:825: ppy + PLAYER_H > by && ppy < by + TILE_SIZE)
	ld	a, -9 (ix)
	sub	a, -21 (ix)
	ld	a, -8 (ix)
	sbc	a, -20 (ix)
	ld	a, -7 (ix)
	sbc	a, -19 (ix)
	ld	a, -6 (ix)
	sbc	a, -18 (ix)
	jp	PO, 00375$
	xor	a, #0x80
00375$:
	jp	P, 00138$
	ld	a, -9 (ix)
	add	a, #0x08
	ld	-5 (ix), a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -25 (ix)
	sub	a, -5 (ix)
	ld	a, -24 (ix)
	sbc	a, -4 (ix)
	ld	a, -23 (ix)
	sbc	a, -3 (ix)
	ld	a, -22 (ix)
	sbc	a, -2 (ix)
	jp	PO, 00376$
	xor	a, #0x80
00376$:
	jp	P, 00138$
;pocket_platformer.c:826: player_died = 1;
	ld	hl, #_player_died
	ld	(hl), #0x01
00138$:
;pocket_platformer.c:819: for (b = 0; b < rb_block_count; b++) {
	inc	-1 (ix)
	jp	00137$
00118$:
;pocket_platformer.c:829: rb_switch_locked = 1;
	ld	hl, #_rb_switch_locked
	ld	(hl), #0x01
00125$:
;pocket_platformer.c:832: new_y = tile_t * TILE_SIZE * FP_ONE;
	ld	a, -29 (ix)
	ld	-3 (ix), a
	ld	a, -28 (ix)
	ld	-2 (ix), a
	ld	a, -27 (ix)
	ld	-1 (ix), a
	ld	-4 (ix), #0x00
	ld	b, #0x03
00377$:
	sla	-3 (ix)
	rl	-2 (ix)
	rl	-1 (ix)
	djnz	00377$
;pocket_platformer.c:833: player.vy = 0;
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
;pocket_platformer.c:834: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:835: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:836: player.jump_frames = res_physics->max_jump_frames;
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	a, (hl)
	ld	(#(_player + 22)),a
00132$:
;pocket_platformer.c:839: player.y = new_y;
	ld	de, #(_player + 4)
	ld	hl, #25
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:840: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:845: static void check_object_collisions(void) {
;	---------------------------------
; Function check_object_collisions
; ---------------------------------
_check_object_collisions:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-30
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:846: long px = player.x >> 8, py = player.y >> 8;
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	b, #0x08
00217$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00217$
	inc	sp
	inc	sp
	push	de
	ld	-28 (ix), l
	ld	-27 (ix), h
	ld	de, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	b, #0x08
00219$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00219$
	ld	-26 (ix), e
	ld	-25 (ix), d
	ld	-24 (ix), l
	ld	-23 (ix), h
;pocket_platformer.c:848: unsigned char obj_count = cur_level->obj_count < MAX_OBJECTS
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	a, (hl)
	cp	a, #0x80
	jr	NC, 00129$
	ld	-2 (ix), a
	ld	-1 (ix), #0x00
	jr	00130$
00129$:
	ld	-2 (ix), #0x80
	ld	-1 (ix), #0
00130$:
	ld	c, -2 (ix)
;pocket_platformer.c:850: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:851: for (i = 0; i < obj_count; i++) {
	ld	a, -26 (ix)
	add	a, #0x08
	ld	-22 (ix), a
	ld	a, -25 (ix)
	adc	a, #0x00
	ld	-21 (ix), a
	ld	a, -24 (ix)
	adc	a, #0x00
	ld	-20 (ix), a
	ld	a, -23 (ix)
	adc	a, #0x00
	ld	-19 (ix), a
	ld	a, -30 (ix)
	add	a, #0x06
	ld	-18 (ix), a
	ld	a, -29 (ix)
	adc	a, #0x00
	ld	-17 (ix), a
	ld	a, -28 (ix)
	adc	a, #0x00
	ld	-16 (ix), a
	ld	a, -27 (ix)
	adc	a, #0x00
	ld	-15 (ix), a
	ld	e, #0x00
00126$:
	ld	a, e
	sub	a, c
	jp	NC, 00127$
;pocket_platformer.c:852: level_object *obj = &cur_objects[i];
	push	de
	ld	d, #0x00
	ld	l, e
	ld	h, d
	add	hl, hl
	add	hl, de
	pop	de
	ld	a, l
	ld	d, h
	ld	hl, #_cur_objects
	add	a, (hl)
	inc	hl
	ld	b, a
	ld	a, d
	adc	a, (hl)
	ld	d, a
;pocket_platformer.c:853: long ox = (long)obj->x * TILE_SIZE, oy = (long)obj->y * TILE_SIZE;
	ld	-14 (ix), b
	ld	-13 (ix), d
	ld	l, b
	ld	h, d
	ld	l, (hl)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	xor	a, a
	ld	h, a
	ld	d, a
	ld	b, #0x03
00221$:
	add	hl, hl
	adc	a, a
	rl	d
	djnz	00221$
	ld	-12 (ix), l
	ld	-11 (ix), h
	ld	-10 (ix), a
	ld	-9 (ix), d
	ld	l, -14 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -13 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	l, (hl)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	xor	a, a
	ld	h, a
	ld	d, a
	ld	b, #0x03
00223$:
	add	hl, hl
	adc	a, a
	rl	d
	djnz	00223$
	ld	-8 (ix), l
	ld	-7 (ix), h
	ld	-6 (ix), a
	ld	-5 (ix), d
	ld	a, -8 (ix)
	ld	-4 (ix), a
	ld	a, -7 (ix)
	ld	-3 (ix), a
	ld	a, -6 (ix)
	ld	-2 (ix), a
	ld	a, -5 (ix)
	ld	-1 (ix), a
;pocket_platformer.c:854: if (px + PLAYER_W <= ox || px >= ox + TILE_SIZE) continue;
	ld	a, -12 (ix)
	sub	a, -18 (ix)
	ld	a, -11 (ix)
	sbc	a, -17 (ix)
	ld	a, -10 (ix)
	sbc	a, -16 (ix)
	ld	a, -9 (ix)
	sbc	a, -15 (ix)
	jp	PO, 00225$
	xor	a, #0x80
00225$:
	jp	P, 00123$
	ld	a, -12 (ix)
	add	a, #0x08
	ld	b, a
	ld	a, -11 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -9 (ix)
	adc	a, #0x00
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -30 (ix)
	sub	a, b
	ld	a, -29 (ix)
	sbc	a, d
	ld	a, -28 (ix)
	sbc	a, l
	ld	a, -27 (ix)
	sbc	a, h
	jp	PO, 00226$
	xor	a, #0x80
00226$:
	jp	P, 00123$
;pocket_platformer.c:855: if (py + PLAYER_H <= oy || py >= oy + TILE_SIZE) continue;
	ld	a, -4 (ix)
	sub	a, -22 (ix)
	ld	a, -3 (ix)
	sbc	a, -21 (ix)
	ld	a, -2 (ix)
	sbc	a, -20 (ix)
	ld	a, -1 (ix)
	sbc	a, -19 (ix)
	jp	PO, 00227$
	xor	a, #0x80
00227$:
	jp	P, 00123$
	ld	a, -4 (ix)
	add	a, #0x08
	ld	b, a
	ld	a, -3 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -26 (ix)
	sub	a, b
	ld	a, -25 (ix)
	sbc	a, d
	ld	a, -24 (ix)
	sbc	a, l
	ld	a, -23 (ix)
	sbc	a, h
	jp	PO, 00228$
	xor	a, #0x80
00228$:
	jp	P, 00123$
;pocket_platformer.c:856: switch (obj->type) {
	ld	l, -14 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -13 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	ld	a, (hl)
	cp	a, #0x02
	jr	Z, 00107$
	cp	a, #0x03
	jr	Z, 00111$
	cp	a, #0x04
	jr	Z, 00112$
	cp	a, #0x05
	jp	Z,00119$
	sub	a, #0x0c
	jr	Z, 00108$
	jp	00123$
;pocket_platformer.c:857: case OBJ_FINISH_FLAG: level_complete = 1; break;
00107$:
	ld	hl, #_level_complete
	ld	(hl), #0x01
	jp	00123$
;pocket_platformer.c:858: case OBJ_FINISH_FLAG_LOCKED:
00108$:
;pocket_platformer.c:859: if (!coins_remaining()) level_complete = 1;
	push	bc
	push	de
	call	_coins_remaining
	pop	de
	pop	bc
	or	a, a
	jp	NZ, 00123$
	ld	hl, #_level_complete
	ld	(hl), #0x01
;pocket_platformer.c:860: break;
	jp	00123$
;pocket_platformer.c:861: case OBJ_SPIKE: player_died = 1; break;
00111$:
	ld	hl, #_player_died
	ld	(hl), #0x01
	jp	00123$
;pocket_platformer.c:862: case OBJ_TRAMPOLINE:
00112$:
;pocket_platformer.c:863: if (player.vy >= 0) {
	ld	hl, #_player + 12
	ld	b, (hl)
	inc	hl
	ld	d, (hl)
	inc	hl
	inc	hl
	ld	a, (hl)
	dec	hl
	ld	l, (hl)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	bit	7,a
	jp	NZ, 00123$
;pocket_platformer.c:864: long tramp_mid = (long)obj->y * TILE_SIZE + TILE_SIZE / 2;
	ld	a, -8 (ix)
	add	a, #0x04
	ld	-4 (ix), a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
;pocket_platformer.c:865: if ((player.y >> 8) + PLAYER_H <= tramp_mid + 2) {
	ld	hl, #(_player + 4)
	ld	b, (hl)
	inc	hl
	ld	d, (hl)
	inc	hl
	inc	hl
	ld	a, (hl)
	dec	hl
	ld	l, (hl)
;	spillPairReg hl
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	-12 (ix), b
	ld	-11 (ix), d
	ld	-10 (ix), l
	ld	-9 (ix), h
	ld	b, #0x08
00234$:
	sra	-9 (ix)
	rr	-10 (ix)
	rr	-11 (ix)
	rr	-12 (ix)
	djnz	00234$
	ld	a, -12 (ix)
	add	a, #0x08
	ld	-8 (ix), a
	ld	a, -11 (ix)
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, -9 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
	ld	a, -4 (ix)
	add	a, #0x02
	ld	b, a
	ld	a, -3 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, b
	sub	a, -8 (ix)
	ld	a, d
	sbc	a, -7 (ix)
	ld	a, l
	sbc	a, -6 (ix)
	ld	a, h
	sbc	a, -5 (ix)
	jp	PO, 00236$
	xor	a, #0x80
00236$:
	jp	M, 00123$
;pocket_platformer.c:866: long base = (long)res_physics->jump_speed;
	ld	hl, (_res_physics)
	push	bc
	ld	bc, #0x000a
	add	hl, bc
	pop	bc
	ld	b, (hl)
	inc	hl
	ld	a, (hl)
	ld	-8 (ix), b
	ld	-7 (ix), a
	rlca
	sbc	a, a
	ld	-6 (ix), a
	ld	-5 (ix), a
;pocket_platformer.c:867: player.forced_jump_speed = base + base * 4 / 15;
	ld	l, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	b, -6 (ix)
	ld	d, -5 (ix)
	ld	a, #0x02
00237$:
	add	hl, hl
	rl	b
	rl	d
	dec	a
	jr	NZ,00237$
	push	bc
	push	de
	ld	iy, #0x0000
	push	iy
	ld	iy, #0x000f
	push	iy
	ex	de, hl
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	call	__divslong
	pop	af
	pop	af
	push	de
	pop	iy
	pop	de
	pop	bc
	push	iy
	ld	a, -32 (ix)
	pop	iy
	add	a, -8 (ix)
	ld	-4 (ix), a
	push	iy
	ld	a, -31 (ix)
	pop	iy
	adc	a, -7 (ix)
	ld	-3 (ix), a
	ld	a, l
	adc	a, -6 (ix)
	ld	-2 (ix), a
	ld	a, h
	adc	a, -5 (ix)
	ld	-1 (ix), a
	push	de
	push	bc
	ld	de, #(_player + 28)
	ld	hl, #30
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
;pocket_platformer.c:868: player.jumping = 1;
	ld	hl, #(_player + 18)
	ld	(hl), #0x01
;pocket_platformer.c:869: player.jump_frames = 0;
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
;pocket_platformer.c:870: player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
;pocket_platformer.c:871: player.on_ground = 0;
	ld	hl, #(_player + 16)
	ld	(hl), #0x00
;pocket_platformer.c:872: player.double_jump_used = 0;
	ld	hl, #(_player + 24)
	ld	(hl), #0x00
;pocket_platformer.c:873: if (vp_block_count) vp_toggle();
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00123$
	push	bc
	push	de
	call	_vp_toggle
	pop	de
	pop	bc
;pocket_platformer.c:876: break;
	jr	00123$
;pocket_platformer.c:877: case OBJ_COIN:
00119$:
;pocket_platformer.c:878: if (!coin_collected[i]) coin_collected[i] = 1; break;
	ld	hl, #_coin_collected
	ld	d, #0x00
	add	hl, de
	ld	a, (hl)
	or	a, a
	jr	NZ, 00123$
	ld	(hl), #0x01
;pocket_platformer.c:879: }
00123$:
;pocket_platformer.c:851: for (i = 0; i < obj_count; i++) {
	inc	e
	jp	00126$
00127$:
;pocket_platformer.c:881: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:896: static unsigned char vp_is_passable(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function vp_is_passable
; ---------------------------------
_vp_is_passable:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	ld	-1 (ix), a
	ld	-2 (ix), l
;pocket_platformer.c:898: for (i = 0; i < vp_block_count; i++) {
	ld	c, #0x00
00106$:
	ld	hl, #_vp_block_count
	ld	a, c
	sub	a, (hl)
	jr	NC, 00104$
;pocket_platformer.c:899: if (vp_blocks[i].tx == tx && vp_blocks[i].ty == ty) {
	ld	de, #_vp_blocks+0
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	add	hl, de
	ex	de, hl
	ld	a, (de)
	ld	b, a
	ld	a, -1 (ix)
	sub	a, b
	jr	NZ, 00107$
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a,-2 (ix)
	sub	a,(hl)
	jr	NZ, 00107$
;pocket_platformer.c:902: return vp_blocks[i].is_violet ? !vp_violet_active : vp_violet_active;
	inc	de
	inc	de
	ld	a, (de)
	or	a, a
	jr	Z, 00110$
	ld	a, (_vp_violet_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
	jr	00108$
00110$:
	ld	a, (_vp_violet_active+0)
	jr	00108$
00107$:
;pocket_platformer.c:898: for (i = 0; i < vp_block_count; i++) {
	inc	c
	jr	00106$
00104$:
;pocket_platformer.c:905: return 0;
	xor	a, a
00108$:
;pocket_platformer.c:906: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:909: static void vp_toggle(void) {
;	---------------------------------
; Function vp_toggle
; ---------------------------------
_vp_toggle:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-21
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:911: vp_violet_active = !vp_violet_active;
	ld	a, (_vp_violet_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
	ld	(_vp_violet_active+0), a
;pocket_platformer.c:912: for (i = 0; i < vp_block_count; i++) {
	ld	-1 (ix), #0x00
00113$:
	ld	hl, #_vp_block_count
	ld	a, -1 (ix)
	sub	a, (hl)
	jp	NC, 00115$
;pocket_platformer.c:913: unsigned char tx    = vp_blocks[i].tx;
	ld	c, -1 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	-3 (ix), l
	ld	-2 (ix), h
	ld	a, #<(_vp_blocks)
	add	a, -3 (ix)
	ld	-5 (ix), a
	ld	a, #>(_vp_blocks)
	adc	a, -2 (ix)
	ld	-4 (ix), a
	ld	l, -5 (ix)
	ld	h, -4 (ix)
	ld	a, (hl)
	ld	-3 (ix), a
;pocket_platformer.c:914: unsigned char ty    = vp_blocks[i].ty;
	ld	a, -5 (ix)
	ld	-7 (ix), a
	ld	a, -4 (ix)
	ld	-6 (ix), a
	ld	l, -7 (ix)
	ld	h, -6 (ix)
	inc	hl
	ld	a, (hl)
	ld	-2 (ix), a
;pocket_platformer.c:915: unsigned char solid = vp_blocks[i].is_violet ? vp_violet_active : !vp_violet_active;
	ld	l, -5 (ix)
	ld	h, -4 (ix)
	inc	hl
	inc	hl
	ld	c, (hl)
	ld	a, c
	or	a, a
	jr	Z, 00117$
	ld	a, (_vp_violet_active+0)
	jr	00118$
00117$:
	ld	a, (_vp_violet_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
00118$:
	ld	-6 (ix), a
;pocket_platformer.c:919: idx = solid ? res_header->vio_solid_vram_idx : res_header->vio_ghost_vram_idx;
	ld	hl, (_res_header)
	ld	-5 (ix), l
	ld	-4 (ix), h
;pocket_platformer.c:918: if (vp_blocks[i].is_violet)
	ld	a, c
	or	a, a
	jr	Z, 00102$
;pocket_platformer.c:919: idx = solid ? res_header->vio_solid_vram_idx : res_header->vio_ghost_vram_idx;
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00119$
	ld	c, -5 (ix)
	ld	b, -4 (ix)
	ld	hl, #15
	add	hl, bc
	ld	b, (hl)
	jr	00120$
00119$:
	ld	c, -5 (ix)
	ld	b, -4 (ix)
	ld	hl, #16
	add	hl, bc
	ld	b, (hl)
00120$:
	ld	a, b
	jr	00103$
00102$:
;pocket_platformer.c:921: idx = solid ? res_header->pink_solid_vram_idx : res_header->pink_ghost_vram_idx;
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00121$
	ld	c, -5 (ix)
	ld	b, -4 (ix)
	ld	hl, #17
	add	hl, bc
	ld	a, (hl)
	jr	00122$
00121$:
	ld	l, -5 (ix)
	ld	h, -4 (ix)
	ld	de, #0x0012
	add	hl, de
	ld	a, (hl)
00122$:
00103$:
;pocket_platformer.c:922: vt = idx ? (unsigned int)(VRAM_BG_BASE + idx - 1) : 0u;
	or	a, a
	jr	Z, 00123$
	ld	b, #0x00
	jr	00124$
00123$:
	xor	a, a
	ld	b, a
00124$:
	ld	e, a
	ld	d, b
;pocket_platformer.c:923: SMS_setNextTileatXY(tx % SCREEN_TILES_W, ty);
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	a, -3 (ix)
	and	a, #0x1f
	ld	c, a
	ld	b, #0x00
	add	hl, bc
	add	hl, hl
	ld	a, h
	or	a, #0x78
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x08
;pocket_platformer.c:924: SMS_setTile(vt);
	ex	de, hl
	rst	#0x18
;pocket_platformer.c:926: if (solid) {
	ld	a, -6 (ix)
	or	a, a
	jp	Z, 00114$
;pocket_platformer.c:927: long px = player.x >> 8, py = player.y >> 8;
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	b, #0x08
00198$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00198$
	inc	sp
	inc	sp
	push	de
	ld	-19 (ix), l
	ld	-18 (ix), h
	ld	de, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	b, #0x08
00200$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00200$
	ld	-17 (ix), e
	ld	-16 (ix), d
	ld	-15 (ix), l
	ld	-14 (ix), h
;pocket_platformer.c:928: long bx = (long)tx * TILE_SIZE, by = (long)ty * TILE_SIZE;
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	xor	a, a
	ld	h, a
	ld	c, a
	ld	b, #0x03
00202$:
	add	hl, hl
	adc	a, a
	rl	c
	djnz	00202$
	ld	-13 (ix), l
	ld	-12 (ix), h
	ld	-11 (ix), a
	ld	-10 (ix), c
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	xor	a, a
	ld	h, a
	ld	c, a
	ld	b, #0x03
00204$:
	add	hl, hl
	adc	a, a
	rl	c
	djnz	00204$
	ld	-9 (ix), l
	ld	-8 (ix), h
	ld	-7 (ix), a
	ld	-6 (ix), c
;pocket_platformer.c:929: if (px + PLAYER_W > bx && px < bx + TILE_SIZE &&
	ld	a, -21 (ix)
	add	a, #0x06
	ld	c, a
	ld	a, -20 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -19 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -18 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -13 (ix)
	sub	a, c
	ld	a, -12 (ix)
	sbc	a, b
	ld	a, -11 (ix)
	sbc	a, e
	ld	a, -10 (ix)
	sbc	a, d
	jp	PO, 00206$
	xor	a, #0x80
00206$:
	jp	P, 00114$
	ld	a, -13 (ix)
	add	a, #0x08
	ld	-5 (ix), a
	ld	a, -12 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -11 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -21 (ix)
	sub	a, -5 (ix)
	ld	a, -20 (ix)
	sbc	a, -4 (ix)
	ld	a, -19 (ix)
	sbc	a, -3 (ix)
	ld	a, -18 (ix)
	sbc	a, -2 (ix)
	jp	PO, 00207$
	xor	a, #0x80
00207$:
	jp	P, 00114$
;pocket_platformer.c:930: py + PLAYER_H > by && py < by + TILE_SIZE)
	ld	a, -17 (ix)
	add	a, #0x08
	ld	c, a
	ld	a, -16 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -15 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -9 (ix)
	sub	a, c
	ld	a, -8 (ix)
	sbc	a, b
	ld	a, -7 (ix)
	sbc	a, e
	ld	a, -6 (ix)
	sbc	a, d
	jp	PO, 00208$
	xor	a, #0x80
00208$:
	jp	P, 00114$
	ld	a, -9 (ix)
	add	a, #0x08
	ld	c, a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -17 (ix)
	sub	a, c
	ld	a, -16 (ix)
	sbc	a, b
	ld	a, -15 (ix)
	sbc	a, e
	ld	a, -14 (ix)
	sbc	a, d
	jp	PO, 00209$
	xor	a, #0x80
00209$:
	jp	P, 00114$
;pocket_platformer.c:931: player_died = 1;
	ld	hl, #_player_died
	ld	(hl), #0x01
00114$:
;pocket_platformer.c:912: for (i = 0; i < vp_block_count; i++) {
	inc	-1 (ix)
	jp	00113$
00115$:
;pocket_platformer.c:934: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:937: static unsigned char rb_is_passable(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function rb_is_passable
; ---------------------------------
_rb_is_passable:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	ld	-1 (ix), a
	ld	-2 (ix), l
;pocket_platformer.c:939: for (i = 0; i < rb_block_count; i++) {
	ld	c, #0x00
00106$:
	ld	hl, #_rb_block_count
	ld	a, c
	sub	a, (hl)
	jr	NC, 00104$
;pocket_platformer.c:940: if (rb_blocks[i].tx == tx && rb_blocks[i].ty == ty) {
	ld	de, #_rb_blocks+0
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	add	hl, de
	ex	de, hl
	ld	a, (de)
	ld	b, a
	ld	a, -1 (ix)
	sub	a, b
	jr	NZ, 00107$
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a,-2 (ix)
	sub	a,(hl)
	jr	NZ, 00107$
;pocket_platformer.c:942: return rb_blocks[i].is_red ? !rb_red_active : rb_red_active;
	inc	de
	inc	de
	ld	a, (de)
	or	a, a
	jr	Z, 00110$
	ld	a, (_rb_red_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
	jr	00108$
00110$:
	ld	a, (_rb_red_active+0)
	jr	00108$
00107$:
;pocket_platformer.c:939: for (i = 0; i < rb_block_count; i++) {
	inc	c
	jr	00106$
00104$:
;pocket_platformer.c:945: return 0;
	xor	a, a
00108$:
;pocket_platformer.c:946: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:948: static unsigned int rb_vram_for_block(unsigned char is_red, unsigned char solid) {
;	---------------------------------
; Function rb_vram_for_block
; ---------------------------------
_rb_vram_for_block:
;pocket_platformer.c:951: idx = solid ? res_header->red_solid_vram_idx  : res_header->red_ghost_vram_idx;
;pocket_platformer.c:950: if (is_red)
	ld	de, (_res_header)
	or	a, a
	jr	Z, 00102$
;pocket_platformer.c:951: idx = solid ? res_header->red_solid_vram_idx  : res_header->red_ghost_vram_idx;
	ld	a, l
	or	a, a
	jr	Z, 00106$
	ld	hl, #9
	add	hl, de
	ld	a, (hl)
	jr	00103$
00106$:
	ld	hl, #10
	add	hl, de
	ld	a, (hl)
	jr	00103$
00102$:
;pocket_platformer.c:953: idx = solid ? res_header->blue_solid_vram_idx : res_header->blue_ghost_vram_idx;
	ld	a, l
	or	a, a
	jr	Z, 00108$
	ld	hl, #11
	add	hl, de
	ld	a, (hl)
	jr	00109$
00108$:
	ld	hl, #12
	add	hl, de
	ld	a, (hl)
00109$:
00103$:
;pocket_platformer.c:954: return idx ? (unsigned int)(VRAM_BG_BASE + idx - 1) : 0u;
	or	a, a
	jr	Z, 00110$
	ld	d, #0x00
	ld	e, a
	ret
00110$:
	ld	de, #0x0000
;pocket_platformer.c:955: }
	ret
;pocket_platformer.c:958: static void rb_redraw_all(void) {
;	---------------------------------
; Function rb_redraw_all
; ---------------------------------
_rb_redraw_all:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
;pocket_platformer.c:960: for (i = 0; i < rb_block_count; i++) {
	ld	-1 (ix), #0x00
00103$:
	ld	hl, #_rb_block_count
	ld	a, -1 (ix)
	sub	a, (hl)
	jr	NC, 00105$
;pocket_platformer.c:961: unsigned char tx = rb_blocks[i].tx;
	ld	c, -1 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ex	de, hl
	ld	hl, #_rb_blocks
	add	hl, de
	ex	de, hl
	ld	a, (de)
	ld	c, a
;pocket_platformer.c:962: unsigned char ty = rb_blocks[i].ty;
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a, (hl)
	ld	-2 (ix), a
;pocket_platformer.c:963: unsigned char solid = rb_blocks[i].is_red ? rb_red_active : !rb_red_active;
	inc	de
	inc	de
	ld	a, (de)
	ld	b, a
	or	a, a
	jr	Z, 00107$
	ld	a, (_rb_red_active+0)
	jr	00108$
00107$:
	ld	a, (_rb_red_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
00108$:
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
;pocket_platformer.c:964: unsigned int vt = rb_vram_for_block(rb_blocks[i].is_red, solid);
	push	bc
	ld	a, b
	call	_rb_vram_for_block
	pop	bc
;pocket_platformer.c:965: SMS_setNextTileatXY(tx % SCREEN_TILES_W, ty);
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	a, c
	and	a, #0x1f
	ld	b, #0x00
	ld	c, a
	add	hl, bc
	add	hl, hl
	ld	a, h
	or	a, #0x78
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x08
;pocket_platformer.c:966: SMS_setTile(vt);
	ex	de, hl
	rst	#0x18
;pocket_platformer.c:960: for (i = 0; i < rb_block_count; i++) {
	inc	-1 (ix)
	jr	00103$
00105$:
;pocket_platformer.c:968: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:970: static void check_rb_switch(void) {
;	---------------------------------
; Function check_rb_switch
; ---------------------------------
_check_rb_switch:
;pocket_platformer.c:972: if (rb_switch_locked && player.vy > 0) rb_switch_locked = 0;
	ld	a, (_rb_switch_locked+0)
	or	a, a
	ret	Z
	ld	bc, (#(_player + 12) + 0)
	ld	hl, (#(_player + 12) + 2)
	xor	a, a
	cp	a, c
	sbc	a, b
	ld	a, #0x00
	sbc	a, l
	ld	a, #0x00
	sbc	a, h
	jp	PO, 00116$
	xor	a, #0x80
00116$:
	ret	P
	ld	hl, #_rb_switch_locked
	ld	(hl), #0x00
;pocket_platformer.c:973: }
	ret
;pocket_platformer.c:975: static void check_disp_touch(void) {
;	---------------------------------
; Function check_disp_touch
; ---------------------------------
_check_disp_touch:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-21
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:980: long px = player.x >> 8, py = player.y >> 8;
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	b, #0x08
00250$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00250$
	ld	-11 (ix), e
	ld	-10 (ix), d
	ld	-9 (ix), l
	ld	-8 (ix), h
	ld	hl, (#(_player + 4) + 0)
	ld	de, (#(_player + 4) + 2)
	ld	b, #0x08
00252$:
	sra	d
	rr	e
	rr	h
	rr	l
	djnz	00252$
;pocket_platformer.c:981: unsigned char tx_l = (unsigned char)(px / TILE_SIZE);
	ld	c, -11 (ix)
	ld	b, -10 (ix)
	push	iy
	ex	(sp), hl
	ld	l, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	ex	(sp), hl
	ld	h, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	pop	iy
	bit	7, -8 (ix)
	jr	Z, 00129$
	ld	a, -11 (ix)
	add	a, #0x07
	ld	c, a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -9 (ix)
	adc	a, #0x00
	push	iy
	ld	-23 (ix), a
	pop	iy
	ld	a, -8 (ix)
	adc	a, #0x00
	push	iy
	ld	-22 (ix), a
	pop	iy
00129$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-3 (ix), c
;pocket_platformer.c:982: unsigned char tx_r = (unsigned char)((px + PLAYER_W - 1) / TILE_SIZE);
	ld	a, -11 (ix)
	add	a, #0x05
	ld	-7 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, -9 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	c, -7 (ix)
	ld	b, -6 (ix)
	push	iy
	ex	(sp), hl
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	ex	(sp), hl
	ld	h, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	pop	iy
	bit	7, -4 (ix)
	jr	Z, 00130$
	ld	a, -7 (ix)
	add	a, #0x07
	ld	c, a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -5 (ix)
	adc	a, #0x00
	push	iy
	ld	-23 (ix), a
	pop	iy
	ld	a, -4 (ix)
	adc	a, #0x00
	push	iy
	ld	-22 (ix), a
	pop	iy
00130$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-2 (ix), c
;pocket_platformer.c:983: unsigned char ty_body  = (unsigned char)(py / TILE_SIZE);
	push	de
	pop	iy
	ld	c, l
	ld	b, h
	bit	7, d
	jr	Z, 00131$
	ld	a, l
	add	a, #0x07
	ld	c, a
	ld	a, h
	adc	a, #0x00
	ld	b, a
	ld	a, e
	adc	a, #0x00
	push	iy
	ld	-23 (ix), a
	pop	iy
	ld	a, d
	adc	a, #0x00
	push	iy
	ld	-22 (ix), a
	pop	iy
00131$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:984: unsigned char ty_feet  = (unsigned char)((py + PLAYER_H) / TILE_SIZE); /* tile below feet */
	push	bc
	ld	bc, #0x0008
	add	hl, bc
	pop	bc
	jr	NC, 00254$
	inc	de
00254$:
	push	de
	pop	iy
	ld	c, l
	ld	b, h
	bit	7, d
	jr	Z, 00132$
	ld	bc, #0x7
	add	hl,bc
	ld	c, l
	ld	b, h
	ld	a, e
	adc	a, #0x00
	push	iy
	ld	-23 (ix), a
	pop	iy
	ld	a, d
	adc	a, #0x00
	push	iy
	ld	-22 (ix), a
	pop	iy
00132$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:985: unsigned char probes[3][2] = {
	ld	a, -3 (ix)
	ld	-17 (ix), a
	ld	-16 (ix), c
	ld	a, -2 (ix)
	ld	-15 (ix), a
	ld	-14 (ix), c
	ld	a, -3 (ix)
	ld	-13 (ix), a
	ld	a, -1 (ix)
	ld	-12 (ix), a
;pocket_platformer.c:991: for (c = 0; c < 3; c++) {
	ld	-1 (ix), #0x00
00119$:
;pocket_platformer.c:992: unsigned char tx = probes[c][0], ty = probes[c][1];
	ld	l, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	ld	c, l
	ld	b, h
	ld	hl, #4
	add	hl, sp
	add	hl, bc
	ld	a, (hl)
	ld	-6 (ix), a
	inc	hl
	ld	a, (hl)
;pocket_platformer.c:993: unsigned char t = get_tile(tx, ty);
	ld	-5 (ix), a
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -6 (ix)
	call	_get_tile
	ld	-4 (ix), a
;pocket_platformer.c:994: if (res_header->disp_vram_idx && t == res_header->disp_vram_idx)
	ld	hl, (_res_header)
	ld	-3 (ix), l
	ld	-2 (ix), h
	ld	bc,#7
	add	hl,bc
	ld	c, (hl)
	ld	a, c
	or	a, a
	jr	Z, 00109$
	ld	a, -4 (ix)
	sub	a, c
	jr	NZ, 00109$
;pocket_platformer.c:995: disp_touch(tx, ty);
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -6 (ix)
	call	_disp_touch
	jr	00120$
00109$:
;pocket_platformer.c:996: else if (res_header->conn_vram_idx && t == res_header->conn_vram_idx)
	ld	c, -3 (ix)
	ld	b, -2 (ix)
	ld	hl, #8
	add	hl, bc
	ld	c, (hl)
	ld	a, c
	or	a, a
	jr	Z, 00105$
	ld	a, -4 (ix)
	sub	a, c
	jr	NZ, 00105$
;pocket_platformer.c:997: disp_touch_connected(tx, ty);
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -6 (ix)
	call	_disp_touch_connected
	jr	00120$
00105$:
;pocket_platformer.c:999: else if (res_header->fg_disp_vram_idx &&
	ld	c, -3 (ix)
	ld	b, -2 (ix)
	ld	hl, #37
	add	hl, bc
	ld	a, (hl)
	or	a, a
	jr	Z, 00120$
;pocket_platformer.c:1000: t == (res_header->fg_disp_vram_idx | 0x80))
	ld	c, a
	set	7, c
	ld	a, -4 (ix)
	sub	a, c
	jr	NZ, 00120$
;pocket_platformer.c:1001: fg_disp_touch_connected(tx, ty);
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -6 (ix)
	call	_fg_disp_touch_connected
00120$:
;pocket_platformer.c:991: for (c = 0; c < 3; c++) {
	inc	-1 (ix)
	ld	a, -1 (ix)
	sub	a, #0x03
	jp	C, 00119$
;pocket_platformer.c:1005: if (res_header->fg_disp_vram_idx) {
	ld	iy, (_res_header)
	ld	a, 37 (iy)
	ld	-1 (ix), a
	or	a, a
	jp	Z, 00127$
;pocket_platformer.c:1006: unsigned char tx_l = (unsigned char)((player.x >> 8) / TILE_SIZE);
	ld	de, #_player
	ld	hl, #17
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	a, -4 (ix)
	ld	-21 (ix), a
	ld	a, -3 (ix)
	ld	-20 (ix), a
	ld	a, -2 (ix)
	ld	-19 (ix), a
	ld	a, -1 (ix)
	ld	-18 (ix), a
	ld	b, #0x08
00261$:
	sra	-18 (ix)
	rr	-19 (ix)
	rr	-20 (ix)
	rr	-21 (ix)
	djnz	00261$
	ld	hl, #17
	add	hl, sp
	ex	de, hl
	ld	hl, #0
	add	hl, sp
	ld	bc, #4
	ldir
	bit	7, -18 (ix)
	jr	Z, 00133$
	ld	a, -21 (ix)
	add	a, #0x07
	ld	-4 (ix), a
	ld	a, -20 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -19 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -18 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
00133$:
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	ld	-2 (ix), c
	ld	-1 (ix), b
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
	ld	a, -2 (ix)
	ld	-11 (ix), a
;pocket_platformer.c:1007: unsigned char tx_r = (unsigned char)(((player.x >> 8) + PLAYER_W - 1) / TILE_SIZE);
	ld	a, -21 (ix)
	add	a, #0x05
	ld	-8 (ix), a
	ld	a, -20 (ix)
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, -19 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, -18 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
	ld	hl, #17
	add	hl, sp
	ex	de, hl
	ld	hl, #13
	add	hl, sp
	ld	bc, #4
	ldir
	bit	7, -5 (ix)
	jr	Z, 00134$
	ld	a, -21 (ix)
	add	a, #0x0c
	ld	-4 (ix), a
	ld	a, -20 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -19 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -18 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
00134$:
	ld	a, -4 (ix)
	ld	-2 (ix), a
	ld	a, -3 (ix)
	ld	-1 (ix), a
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
	srl	-1 (ix)
	rr	-2 (ix)
	ld	a, -2 (ix)
	ld	-10 (ix), a
;pocket_platformer.c:1008: unsigned char ty_t = (unsigned char)((player.y >> 8) / TILE_SIZE);
	ld	de, #(_player + 4)
	ld	hl, #17
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	a, -4 (ix)
	ld	-9 (ix), a
	ld	a, -3 (ix)
	ld	-8 (ix), a
	ld	a, -2 (ix)
	ld	-7 (ix), a
	ld	a, -1 (ix)
	ld	-6 (ix), a
	ld	b, #0x08
00263$:
	sra	-6 (ix)
	rr	-7 (ix)
	rr	-8 (ix)
	rr	-9 (ix)
	djnz	00263$
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #12
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -9 (ix)
	add	a, #0x07
	ld	-5 (ix), a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	bit	7, -6 (ix)
	jr	Z, 00135$
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #16
	add	hl, sp
	ld	bc, #4
	ldir
00135$:
	pop	bc
	push	bc
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:1009: unsigned char ty_b = (unsigned char)(((player.y >> 8) + PLAYER_H - 1) / TILE_SIZE);
	ld	c, -5 (ix)
	ld	b, -4 (ix)
	bit	7, -2 (ix)
	jr	Z, 00136$
	ld	a, -9 (ix)
	add	a, #0x0e
	ld	c, a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	b, a
00136$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-2 (ix), c
;pocket_platformer.c:1011: for (bx = tx_l; bx <= tx_r; bx++) {
	ld	c, -11 (ix)
00125$:
	ld	a, -10 (ix)
	sub	a, c
	jr	C, 00127$
;pocket_platformer.c:1012: for (by = ty_t; by <= ty_b; by++) {
	ld	b, -1 (ix)
00122$:
	ld	a, -2 (ix)
	sub	a, b
	jr	C, 00126$
;pocket_platformer.c:1013: unsigned char bt = get_tile(bx, by);
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_get_tile
	pop	bc
;pocket_platformer.c:1014: if (bt == (res_header->fg_disp_vram_idx | 0x80))
	ld	hl, (_res_header)
	ld	de, #0x0025
	add	hl, de
	ld	e, (hl)
	set	7, e
	sub	a, e
	jr	NZ, 00123$
;pocket_platformer.c:1015: fg_disp_touch_connected(bx, by);
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_fg_disp_touch_connected
	pop	bc
00123$:
;pocket_platformer.c:1012: for (by = ty_t; by <= ty_b; by++) {
	inc	b
	jr	00122$
00126$:
;pocket_platformer.c:1011: for (bx = tx_l; bx <= tx_r; bx++) {
	inc	c
	jr	00125$
00127$:
;pocket_platformer.c:1019: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1021: static void update_disappearing_blocks(void) {
;	---------------------------------
; Function update_disappearing_blocks
; ---------------------------------
_update_disappearing_blocks:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-24
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:1023: check_disp_touch();
	call	_check_disp_touch
;pocket_platformer.c:1024: for (i = 0; i < MAX_DISP; i++) {
	ld	-1 (ix), #0x00
00125$:
;pocket_platformer.c:1027: disp_entry *e = &disp_blocks[i];
	ld	a, -1 (ix)
	ld	-3 (ix), a
	ld	-2 (ix), #0x00
	ld	a, -3 (ix)
	ld	-5 (ix), a
	ld	a, -2 (ix)
	ld	-4 (ix), a
	ld	b, #0x02
00269$:
	sla	-5 (ix)
	rl	-4 (ix)
	djnz	00269$
	ld	a, #<(_disp_blocks)
	add	a, -5 (ix)
	ld	-3 (ix), a
	ld	a, #>(_disp_blocks)
	adc	a, -4 (ix)
	ld	-2 (ix), a
	ld	a, -3 (ix)
	ld	-24 (ix), a
	ld	a, -2 (ix)
	ld	-23 (ix), a
;pocket_platformer.c:1028: if (!e->frame) continue;
	ld	a, -24 (ix)
	add	a, #0x02
	ld	-22 (ix), a
	ld	a, -23 (ix)
	adc	a, #0x00
	ld	-21 (ix), a
	ld	l, -22 (ix)
	ld	h, -21 (ix)
	ld	a, (hl)
	ld	-2 (ix), a
	or	a, a
	jp	Z, 00110$
;pocket_platformer.c:1030: e->frame++;
	ld	e, -2 (ix)
	inc	e
	pop	bc
	pop	hl
	push	hl
	push	bc
	ld	(hl), e
;pocket_platformer.c:1031: tx = e->tx; ty = e->ty;
	pop	hl
	push	hl
	ld	b, (hl)
	pop	hl
	push	hl
	inc	hl
	ld	c, (hl)
;pocket_platformer.c:1032: scr_x = tx % SCREEN_TILES_W;
	ld	a, b
	and	a, #0x1f
;pocket_platformer.c:1033: scr_y = ty;
	ld	-20 (ix), c
;pocket_platformer.c:1035: if (e->frame == DISP_GONE_AT) {
	ld	l, -22 (ix)
	ld	h, -21 (ix)
	ld	l, (hl)
;	spillPairReg hl
;pocket_platformer.c:1037: SMS_setNextTileatXY(scr_x, scr_y);
	ld	d, #0x00
	ld	-19 (ix), a
	ld	-18 (ix), d
;pocket_platformer.c:1035: if (e->frame == DISP_GONE_AT) {
	ld	a, e
	sub	a, #0x28
	jr	NZ, 00108$
;pocket_platformer.c:1037: SMS_setNextTileatXY(scr_x, scr_y);
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	e, -19 (ix)
	ld	d, -18 (ix)
	add	hl, de
	add	hl, hl
	ld	a, h
	or	a, #0x78
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x08
;pocket_platformer.c:1038: SMS_setTile(0);
	ld	hl, #0x0000
	rst	#0x18
	jp	00110$
00108$:
;pocket_platformer.c:1040: else if (e->frame >= DISP_RESET_AT) {
	ld	a, l
	sub	a, #0xc8
	jp	C, 00110$
;pocket_platformer.c:1043: long bx = (long)tx * TILE_SIZE, by = (long)ty * TILE_SIZE;
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	xor	a, a
	ld	h, a
	ld	e, a
	ld	b, #0x03
00272$:
	add	hl, hl
	adc	a, a
	rl	e
	djnz	00272$
	ld	-17 (ix), l
	ld	-16 (ix), h
	ld	-15 (ix), a
	ld	-14 (ix), e
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	xor	a, a
	ld	h, a
	ld	c, a
	ld	b, #0x03
00274$:
	add	hl, hl
	adc	a, a
	rl	c
	djnz	00274$
	ld	-13 (ix), l
	ld	-12 (ix), h
	ld	-11 (ix), a
	ld	-10 (ix), c
;pocket_platformer.c:1044: long ppx = player.x >> 8, ppy = player.y >> 8;
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	b, #0x08
00276$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00276$
	ld	-9 (ix), e
	ld	-8 (ix), d
	ld	-7 (ix), l
	ld	-6 (ix), h
	ld	de, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	b, #0x08
00278$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00278$
	ld	-5 (ix), e
	ld	-4 (ix), d
	ld	-3 (ix), l
	ld	-2 (ix), h
;pocket_platformer.c:1045: unsigned char on_top =
	ld	a, -9 (ix)
	add	a, #0x06
	ld	c, a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -17 (ix)
	sub	a, c
	ld	a, -16 (ix)
	sbc	a, b
	ld	a, -15 (ix)
	sbc	a, e
	ld	a, -14 (ix)
	sbc	a, d
	jp	PO, 00280$
	xor	a, #0x80
00280$:
	jp	P, 00129$
	ld	a, -17 (ix)
	add	a, #0x08
	ld	c, a
	ld	a, -16 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -15 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -9 (ix)
	sub	a, c
	ld	a, -8 (ix)
	sbc	a, b
	ld	a, -7 (ix)
	sbc	a, e
	ld	a, -6 (ix)
	sbc	a, d
	jp	PO, 00281$
	xor	a, #0x80
00281$:
	jp	P, 00129$
	ld	a, -5 (ix)
	add	a, #0x08
	ld	c, a
	ld	a, -4 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -3 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, c
	sub	a, -13 (ix)
	ld	a, b
	sbc	a, -12 (ix)
	ld	a, e
	sbc	a, -11 (ix)
	ld	a, d
	sbc	a, -10 (ix)
	jp	PO, 00282$
	xor	a, #0x80
00282$:
	jp	M, 00129$
	ld	a, -13 (ix)
	add	a, #0x02
	ld	-5 (ix), a
	ld	a, -12 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -11 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -5 (ix)
	sub	a, c
	ld	a, -4 (ix)
	sbc	a, b
	ld	a, -3 (ix)
	sbc	a, e
	ld	a, -2 (ix)
	sbc	a, d
	jp	PO, 00283$
	xor	a, #0x80
00283$:
	jp	P, 00130$
00129$:
	ld	-2 (ix), #0x00
	jr	00131$
00130$:
	ld	-2 (ix), #0x01
00131$:
	ld	a, -2 (ix)
;pocket_platformer.c:1048: if (!on_top) {
	or	a, a
	jp	NZ, 00110$
;pocket_platformer.c:1049: unsigned char orig_vram = e->is_connected
	pop	hl
	push	hl
	inc	hl
	inc	hl
	inc	hl
	ld	c, (hl)
	ld	hl, (_res_header)
	ld	-3 (ix), l
	ld	-2 (ix), h
	ld	a, c
	or	a, a
	jr	Z, 00138$
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	de, #0x0008
	add	hl, de
	ld	a, (hl)
	ld	-2 (ix), a
	jr	00139$
00138$:
	ld	e, -3 (ix)
	ld	d, -2 (ix)
	ld	hl, #7
	add	hl, de
	ld	a, (hl)
	ld	-2 (ix), a
00139$:
	ld	c, -2 (ix)
;pocket_platformer.c:1052: vt = orig_vram ? (unsigned int)(VRAM_BG_BASE + orig_vram - 1) : 0u;
	ld	a, -2 (ix)
	or	a, a
	jr	Z, 00140$
	xor	a, a
	ld	-3 (ix), c
	ld	-2 (ix), a
	jr	00141$
00140$:
	xor	a, a
	ld	-3 (ix), a
	ld	-2 (ix), a
00141$:
	ld	a, -3 (ix)
	ld	-5 (ix), a
	ld	a, -2 (ix)
	ld	-4 (ix), a
;pocket_platformer.c:1053: SMS_setNextTileatXY(scr_x, scr_y);
	ld	a, -20 (ix)
	ld	-3 (ix), a
	ld	-2 (ix), #0x00
	ld	b, #0x05
00284$:
	sla	-3 (ix)
	rl	-2 (ix)
	djnz	00284$
	ld	a, -3 (ix)
	add	a, -19 (ix)
	ld	-7 (ix), a
	ld	a, -2 (ix)
	adc	a, -18 (ix)
	ld	-6 (ix), a
	ld	a, -7 (ix)
	ld	-3 (ix), a
	ld	a, -6 (ix)
	ld	-2 (ix), a
	sla	-3 (ix)
	rl	-2 (ix)
	ld	a, -3 (ix)
	ld	-7 (ix), a
	ld	a, -2 (ix)
	or	a, #0x78
	ld	-6 (ix), a
	ld	l, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x08
;pocket_platformer.c:1054: SMS_setTile(vt);
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x18
;pocket_platformer.c:1055: e->frame = 0;
	pop	bc
	pop	hl
	push	hl
	push	bc
	ld	(hl), #0x00
00110$:
;pocket_platformer.c:1024: for (i = 0; i < MAX_DISP; i++) {
	inc	-1 (ix)
	ld	a, -1 (ix)
	sub	a, #0x10
	jp	C, 00125$
;pocket_platformer.c:1060: if (res_header->fg_disp_vram_idx) {
	ld	hl, (_res_header)
	ld	de, #0x0025
	add	hl, de
	ld	a, (hl)
	or	a, a
	jp	Z, 00127$
;pocket_platformer.c:1062: for (j = 0; j < MAX_FG_DISP; j++) {
	ld	-1 (ix), #0x00
00126$:
;pocket_platformer.c:1064: fg_disp_entry *e = &fg_disp_blocks[j];
	ld	c, -1 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	de, #_fg_disp_blocks
	add	hl, de
	ld	-3 (ix), l
	ld	-2 (ix), h
;pocket_platformer.c:1065: if (!e->frame) continue;
	ld	a, -3 (ix)
	add	a, #0x02
	ld	-22 (ix), a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	-21 (ix), a
	ld	l, -22 (ix)
	ld	h, -21 (ix)
	ld	c, (hl)
	ld	a, c
	or	a, a
	jp	Z, 00121$
;pocket_platformer.c:1066: e->frame++;
	inc	c
	pop	de
	pop	hl
	push	hl
	push	de
	ld	(hl), c
;pocket_platformer.c:1067: tx = e->tx; ty = e->ty;
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	e, (hl)
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a, (hl)
	ld	-2 (ix), a
;pocket_platformer.c:1068: scr_x = tx % SCREEN_TILES_W;
	ld	a, e
	and	a, #0x1f
;pocket_platformer.c:1069: scr_y = ty;
	push	af
	ld	a, -2 (ix)
	ld	-20 (ix), a
	pop	af
;pocket_platformer.c:1070: if (e->frame == FG_DISP_GONE_AT) {
	ld	l, -22 (ix)
	ld	h, -21 (ix)
	ld	l, (hl)
;	spillPairReg hl
;pocket_platformer.c:1072: SMS_setNextTileatXY(scr_x, scr_y);
	ld	b, #0x00
	ld	-19 (ix), a
	ld	-18 (ix), b
;pocket_platformer.c:1070: if (e->frame == FG_DISP_GONE_AT) {
	ld	a, c
	sub	a, #0x05
	jr	NZ, 00119$
;pocket_platformer.c:1072: SMS_setNextTileatXY(scr_x, scr_y);
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	e, -19 (ix)
	ld	d, -18 (ix)
	add	hl, de
	add	hl, hl
	ld	a, h
	or	a, #0x78
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x08
;pocket_platformer.c:1073: SMS_setTile(0);
	ld	hl, #0x0000
	rst	#0x18
	jp	00121$
00119$:
;pocket_platformer.c:1074: } else if (e->frame >= FG_DISP_RESET_AT) {
	ld	a, l
	sub	a, #0x78
	jp	C, 00121$
;pocket_platformer.c:1076: long bx = (long)tx * TILE_SIZE, by = (long)ty * TILE_SIZE;
	ld	c, e
	ld	b, #0x00
	ld	de, #0x0000
	ld	a, #0x03
00288$:
	sla	c
	rl	b
	rl	e
	rl	d
	dec	a
	jr	NZ,00288$
	ld	a, -2 (ix)
	ld	-5 (ix), a
	xor	a, a
	ld	-4 (ix), a
	ld	-3 (ix), a
	ld	-2 (ix), a
	push	af
	ld	a, -5 (ix)
	ld	-17 (ix), a
	ld	a, -4 (ix)
	ld	-16 (ix), a
	ld	a, -3 (ix)
	ld	-15 (ix), a
	ld	a, -2 (ix)
	ld	-14 (ix), a
	pop	af
	ld	a, #0x03
00290$:
	sla	-17 (ix)
	rl	-16 (ix)
	rl	-15 (ix)
	rl	-14 (ix)
	dec	a
	jr	NZ,00290$
;pocket_platformer.c:1077: long ppx = player.x >> 8, ppy = player.y >> 8;
	push	de
	push	bc
	ld	de, #_player
	ld	hl, #23
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
	ld	a, -5 (ix)
	ld	-13 (ix), a
	ld	a, -4 (ix)
	ld	-12 (ix), a
	ld	a, -3 (ix)
	ld	-11 (ix), a
	ld	a, -2 (ix)
	ld	-10 (ix), a
	ld	a, #0x08
00292$:
	sra	-10 (ix)
	rr	-11 (ix)
	rr	-12 (ix)
	rr	-13 (ix)
	dec	a
	jr	NZ, 00292$
	push	de
	push	bc
	ld	de, #(_player + 4)
	ld	hl, #23
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
	ld	a, -5 (ix)
	ld	-9 (ix), a
	ld	a, -4 (ix)
	ld	-8 (ix), a
	ld	a, -3 (ix)
	ld	-7 (ix), a
	ld	a, -2 (ix)
	ld	-6 (ix), a
	ld	a, #0x08
00294$:
	sra	-6 (ix)
	rr	-7 (ix)
	rr	-8 (ix)
	rr	-9 (ix)
	dec	a
	jr	NZ, 00294$
;pocket_platformer.c:1078: unsigned char overlap =
	ld	a, -13 (ix)
	add	a, #0x06
	ld	-5 (ix), a
	ld	a, -12 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -11 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, c
	sub	a, -5 (ix)
	ld	a, b
	sbc	a, -4 (ix)
	ld	a, e
	sbc	a, -3 (ix)
	ld	a, d
	sbc	a, -2 (ix)
	jp	PO, 00296$
	xor	a, #0x80
00296$:
	jp	P, 00142$
	ld	a, c
	add	a, #0x08
	ld	-5 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -13 (ix)
	sub	a, -5 (ix)
	ld	a, -12 (ix)
	sbc	a, -4 (ix)
	ld	a, -11 (ix)
	sbc	a, -3 (ix)
	ld	a, -10 (ix)
	sbc	a, -2 (ix)
	jp	PO, 00297$
	xor	a, #0x80
00297$:
	jp	P, 00142$
	ld	a, -9 (ix)
	add	a, #0x08
	ld	c, a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -17 (ix)
	sub	a, c
	ld	a, -16 (ix)
	sbc	a, b
	ld	a, -15 (ix)
	sbc	a, e
	ld	a, -14 (ix)
	sbc	a, d
	jp	PO, 00298$
	xor	a, #0x80
00298$:
	jp	P, 00142$
	ld	a, -17 (ix)
	add	a, #0x08
	ld	c, a
	ld	a, -16 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -15 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -14 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -9 (ix)
	sub	a, c
	ld	a, -8 (ix)
	sbc	a, b
	ld	a, -7 (ix)
	sbc	a, e
	ld	a, -6 (ix)
	sbc	a, d
	jp	PO, 00299$
	xor	a, #0x80
00299$:
	jp	M, 00143$
00142$:
	xor	a, a
	jr	00144$
00143$:
	ld	a, #0x01
00144$:
;pocket_platformer.c:1081: if (!overlap) {
	or	a, a
	jr	NZ, 00121$
;pocket_platformer.c:1082: unsigned int vt = (unsigned int)(VRAM_BG_BASE + res_header->fg_disp_vram_idx - 1) | TILE_PRIORITY;
	ld	iy, (_res_header)
	ld	e, 37 (iy)
	ld	d, #0x00
	set	4, d
;pocket_platformer.c:1083: SMS_setNextTileatXY(scr_x, scr_y);
	ld	l, -20 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	c, -19 (ix)
	ld	b, -18 (ix)
	add	hl, bc
	add	hl, hl
	ld	a, h
	or	a, #0x78
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x08
;pocket_platformer.c:1084: SMS_setTile(vt);
	ex	de, hl
	rst	#0x18
;pocket_platformer.c:1085: e->frame = 0;
	pop	bc
	pop	hl
	push	hl
	push	bc
	ld	(hl), #0x00
00121$:
;pocket_platformer.c:1062: for (j = 0; j < MAX_FG_DISP; j++) {
	inc	-1 (ix)
	ld	a, -1 (ix)
	sub	a, #0x10
	jp	C, 00126$
00127$:
;pocket_platformer.c:1090: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1097: static void update_camera(void) {
;	---------------------------------
; Function update_camera
; ---------------------------------
_update_camera:
;pocket_platformer.c:1099: camera_x = 0;
	ld	hl, #0x0000
	ld	(_camera_x), hl
;pocket_platformer.c:1100: SMS_setBGScrollX(0);
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
;pocket_platformer.c:1101: }
	jp	_SMS_setBGScrollX
;pocket_platformer.c:1106: static void update_anim(void) {
;	---------------------------------
; Function update_anim
; ---------------------------------
_update_anim:
;pocket_platformer.c:1107: if (player.anim_timer) { player.anim_timer--; }
	ld	hl, #_player + 26
	ld	a, (hl)
	or	a, a
	jr	Z, 00102$
	dec	a
	ld	(hl), a
	ret
00102$:
;pocket_platformer.c:1108: else { player.anim_timer = 5; player.anim_frame = (player.anim_frame + 1) & 3; }
	ld	(hl), #0x05
	ld	bc, #_player + 25
	ld	a, (bc)
	inc	a
	and	a, #0x03
	ld	(bc), a
;pocket_platformer.c:1109: }
	ret
;pocket_platformer.c:1111: static void load_level(unsigned char n) {
;	---------------------------------
; Function load_level
; ---------------------------------
_load_level:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-9
	add	hl, sp
	ld	sp, hl
	ld	c, a
;pocket_platformer.c:1113: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:1114: cur_level   = get_level(n);
	ld	a, c
	call	_get_level
	ld	(_cur_level), de
;pocket_platformer.c:1115: cur_map     = (unsigned char *)cur_level + sizeof(level_header);
	ld	bc, (_cur_level)
	ld	hl, #0x0004
	add	hl, bc
	ld	(_cur_map), hl
;pocket_platformer.c:1117: (unsigned int)cur_level->map_w * cur_level->map_h);
	ld	hl, (_cur_level)
	ld	c, (hl)
	inc	hl
	ld	b, #0x00
	ld	e, (hl)
	ld	d, #0x00
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	call	__mulint
	ld	hl, (_cur_map)
	add	hl, de
	ld	(_cur_objects), hl
;pocket_platformer.c:1119: for (i = 0; i < MAX_OBJECTS; i++) coin_collected[i] = 0;
	ld	c, #0x00
00118$:
	ld	hl, #_coin_collected
	ld	b, #0x00
	add	hl, bc
	ld	(hl), #0x00
	inc	c
	ld	a, c
	sub	a, #0x80
	jr	C, 00118$
;pocket_platformer.c:1120: for (i = 0; i < MAX_DISP; i++) disp_blocks[i].frame = 0;
	ld	bc, #_disp_blocks+0
	ld	e, #0x00
00120$:
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, bc
	inc	hl
	inc	hl
	ld	(hl), #0x00
	inc	e
	ld	a, e
	sub	a, #0x10
	jr	C, 00120$
;pocket_platformer.c:1123: rb_block_count  = 0;
	ld	hl, #_rb_block_count
	ld	(hl), #0x00
;pocket_platformer.c:1124: rb_switch_count = 0;
	ld	hl, #_rb_switch_count
	ld	(hl), #0x00
;pocket_platformer.c:1125: rb_red_active   = 1;   /* red starts solid per pocket-platformer default */
	ld	hl, #_rb_red_active
	ld	(hl), #0x01
;pocket_platformer.c:1126: rb_switch_locked = 0;
	ld	hl, #_rb_switch_locked
	ld	(hl), #0x00
;pocket_platformer.c:1128: vp_block_count  = 0;
	ld	hl, #_vp_block_count
	ld	(hl), #0x00
;pocket_platformer.c:1129: vp_violet_active = 0;  /* state = "violet turn" (violet passable, pink solid) */
	ld	hl, #_vp_violet_active
	ld	(hl), #0x00
;pocket_platformer.c:1130: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:1131: for (i = 0; i < cur_level->obj_count; i++) {
	ld	-1 (ix), #0x00
00123$:
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	c, (hl)
	ld	a, -1 (ix)
	sub	a, c
	jp	NC, 00114$
;pocket_platformer.c:1132: level_object *obj = &cur_objects[i];
	ld	c, -1 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ex	de, hl
	ld	hl, (_cur_objects)
	add	hl, de
	ex	(sp), hl
;pocket_platformer.c:1133: if ((obj->type == 7 || obj->type == 8) && rb_block_count < MAX_RB_BLOCKS) {
	ld	a, -9 (ix)
	add	a, #0x02
	ld	-3 (ix), a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	c, (hl)
;pocket_platformer.c:1135: rb_blocks[rb_block_count].ty     = obj->y;
	ld	a, -9 (ix)
	add	a, #0x01
	ld	-7 (ix), a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
;pocket_platformer.c:1133: if ((obj->type == 7 || obj->type == 8) && rb_block_count < MAX_RB_BLOCKS) {
	ld	a,c
	cp	a,#0x07
	jr	Z, 00106$
	sub	a, #0x08
	jr	NZ, 00104$
00106$:
	ld	a, (_rb_block_count+0)
	sub	a, #0x30
	jr	NC, 00104$
;pocket_platformer.c:1134: rb_blocks[rb_block_count].tx     = obj->x;
	ld	bc, (_rb_block_count)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ex	de, hl
	ld	hl, #_rb_blocks
	add	hl, de
	ex	de, hl
	pop	hl
	push	hl
	ld	a, (hl)
	ld	(de), a
;pocket_platformer.c:1135: rb_blocks[rb_block_count].ty     = obj->y;
	ld	bc, (_rb_block_count)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	de, #_rb_blocks
	add	hl, de
	ex	de, hl
	inc	de
	ld	l, -7 (ix)
	ld	h, -6 (ix)
	ld	a, (hl)
	ld	(de), a
;pocket_platformer.c:1136: rb_blocks[rb_block_count].is_red = (obj->type == 7);
	ld	bc, (_rb_block_count)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	de, #_rb_blocks
	add	hl, de
	ex	de, hl
	inc	de
	inc	de
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	a, (hl)
	sub	a, #0x07
	ld	a, #0x01
	jr	Z, 00212$
	xor	a, a
00212$:
	ld	(de), a
;pocket_platformer.c:1137: rb_block_count++;
	ld	hl, #_rb_block_count
	inc	(hl)
00104$:
;pocket_platformer.c:1139: if ((obj->type == 10 || obj->type == 11) && vp_block_count < MAX_VP_BLOCKS) {
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	a, (hl)
	cp	a, #0x0a
	jr	Z, 00110$
	sub	a, #0x0b
	jr	NZ, 00108$
00110$:
	ld	a, (_vp_block_count+0)
	sub	a, #0x30
	jr	NC, 00108$
;pocket_platformer.c:1140: vp_blocks[vp_block_count].tx        = obj->x;
	ld	bc, (_vp_block_count)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ex	de, hl
	ld	hl, #_vp_blocks
	add	hl, de
	ex	de, hl
	pop	hl
	push	hl
	ld	a, (hl)
	ld	(de), a
;pocket_platformer.c:1141: vp_blocks[vp_block_count].ty        = obj->y;
	ld	bc, (_vp_block_count)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	de, #_vp_blocks
	add	hl, de
	ex	de, hl
	inc	de
	ld	l, -7 (ix)
	ld	h, -6 (ix)
	ld	a, (hl)
	ld	(de), a
;pocket_platformer.c:1142: vp_blocks[vp_block_count].is_violet = (obj->type == 10);
	ld	bc, (_vp_block_count)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	de, #_vp_blocks
	add	hl, de
	ex	de, hl
	inc	de
	inc	de
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	a, (hl)
	sub	a, #0x0a
	ld	a, #0x01
	jr	Z, 00217$
	xor	a, a
00217$:
	ld	(de), a
;pocket_platformer.c:1143: vp_block_count++;
	ld	hl, #_vp_block_count
	inc	(hl)
00108$:
;pocket_platformer.c:1145: if (obj->type == 9 && rb_switch_count < MAX_RB_SWITCHES) {
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	a, (hl)
	sub	a, #0x09
	jp	NZ,00124$
	ld	a, (_rb_switch_count+0)
	sub	a, #0x08
	jr	NC, 00124$
;pocket_platformer.c:1146: rb_switches[rb_switch_count].tx = obj->x;
	ld	a, (_rb_switch_count+0)
	ld	-3 (ix), a
	ld	-2 (ix), #0x00
	ld	a, -3 (ix)
	ld	-5 (ix), a
	ld	a, -2 (ix)
	ld	-4 (ix), a
	sla	-5 (ix)
	rl	-4 (ix)
	ld	a, #<(_rb_switches)
	add	a, -5 (ix)
	ld	-3 (ix), a
	ld	a, #>(_rb_switches)
	adc	a, -4 (ix)
	ld	-2 (ix), a
	pop	hl
	push	hl
	ld	a, (hl)
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	(hl), a
;pocket_platformer.c:1147: rb_switches[rb_switch_count].ty = obj->y;
	ld	a, (_rb_switch_count+0)
	ld	-3 (ix), a
	ld	-2 (ix), #0x00
	sla	-3 (ix)
	rl	-2 (ix)
	ld	a, #<(_rb_switches)
	add	a, -3 (ix)
	ld	-5 (ix), a
	ld	a, #>(_rb_switches)
	adc	a, -2 (ix)
	ld	-4 (ix), a
	ld	a, -5 (ix)
	add	a, #0x01
	ld	-3 (ix), a
	ld	a, -4 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	l, -7 (ix)
	ld	h, -6 (ix)
	ld	a, (hl)
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	(hl), a
;pocket_platformer.c:1148: rb_switch_count++;
	ld	hl, #_rb_switch_count
	inc	(hl)
00124$:
;pocket_platformer.c:1131: for (i = 0; i < cur_level->obj_count; i++) {
	inc	-1 (ix)
	jp	00123$
00114$:
;pocket_platformer.c:1151: level_complete = player_died = 0;
	ld	hl, #_player_died
	ld	(hl), #0x00
	ld	hl, #_level_complete
	ld	(hl), #0x00
;pocket_platformer.c:1152: camera_x = prev_cam_x = 0;
	ld	hl, #0x0000
	ld	(_prev_cam_x), hl
	ld	(_camera_x), hl
;pocket_platformer.c:1155: player.x  = FP(2 * TILE_SIZE);
	ld	h, #0x10
	ld	(_player), hl
	ld	h, l
	ld	(_player+2), hl
;pocket_platformer.c:1156: player.y  = FP(4 * TILE_SIZE);
	ld	de, #_player+0
	ld	h, #0x20
	ld	((_player + 4)), hl
	ld	h, l
	ld	((_player + 4)+2), hl
;pocket_platformer.c:1157: player.vx = player.vy = 0;
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1158: player.on_ground = player.jump_frames = player.double_jump_used = 0;
	ld	hl, #(_player + 24)
	ld	(hl), #0x00
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
	ld	hl, #(_player + 16)
	ld	(hl), #0x00
;pocket_platformer.c:1159: treadmill_bonus = 0;
	xor	a, a
	ld	(_treadmill_bonus+0), a
	ld	(_treadmill_bonus+1), a
	ld	(_treadmill_bonus+2), a
	ld	(_treadmill_bonus+3), a
;pocket_platformer.c:1160: player.falling = 1; player.jumping = 0; player.wall_jumping = 0; player.wall_push_frames = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
	ld	hl, #(_player + 21)
	ld	(hl), #0x00
;pocket_platformer.c:1161: player.facing_left = player.anim_frame = player.anim_timer = 0;
	ld	hl, #(_player + 26)
	ld	(hl), #0x00
	ld	hl, #(_player + 25)
	ld	(hl), #0x00
	ld	hl, #(_player + 23)
	ld	(hl), #0x00
;pocket_platformer.c:1163: for (i = 0; i < cur_level->obj_count; i++) {
	ld	-1 (ix), #0x00
00126$:
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	a,-1 (ix)
	sub	a,(hl)
	jp	NC, 00117$
;pocket_platformer.c:1164: if (cur_objects[i].type == OBJ_START_FLAG) {
	ld	c, -1 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	c, l
	ld	b, h
	ld	a, (_cur_objects+0)
	add	a, c
	ld	-3 (ix), a
	ld	a, (_cur_objects+1)
	adc	a, b
	ld	-2 (ix), a
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	ld	a, (hl)
	dec	a
	jr	NZ, 00127$
;pocket_platformer.c:1165: player.x = (long)cur_objects[i].x * TILE_SIZE * FP_ONE;
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	a, (hl)
	ld	-4 (ix), a
	xor	a, a
	ld	-3 (ix), a
	ld	-2 (ix), a
	ld	-1 (ix), a
	ld	a, #0x0b
00224$:
	sla	-4 (ix)
	rl	-3 (ix)
	rl	-2 (ix)
	rl	-1 (ix)
	dec	a
	jr	NZ,00224$
	push	bc
	ld	hl, #7
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
;pocket_platformer.c:1167: player.y = (long)(cur_objects[i].y - 1) * TILE_SIZE * FP_ONE;
	ld	hl, (_cur_objects)
	add	hl, bc
	inc	hl
	ld	c, (hl)
	ld	b, #0x00
	dec	bc
	ld	a, b
	rlca
	sbc	hl, hl
	ld	e, b
	ld	b, c
	ld	d, l
	ld	c, #0x00
	ld	a, #0x03
00226$:
	sla	b
	rl	e
	rl	d
	dec	a
	jr	NZ,00226$
	ld	((_player + 4)), bc
	ld	((_player + 4)+2), de
;pocket_platformer.c:1168: break;
	jr	00117$
00127$:
;pocket_platformer.c:1163: for (i = 0; i < cur_level->obj_count; i++) {
	inc	-1 (ix)
	jp	00126$
00117$:
;pocket_platformer.c:1172: SMS_waitForVBlank();
	call	_SMS_waitForVBlank
;pocket_platformer.c:1173: SMS_displayOff();
	ld	hl, #0x0140
	call	_SMS_VDPturnOffFeature
;pocket_platformer.c:1174: SMS_VRAMmemsetW(0x3800, 0, 0x700);
	ld	hl, #0x0700
	push	hl
	ld	de, #0x0000
	ld	h, #0x38
	call	_SMS_VRAMmemsetW
;pocket_platformer.c:1175: draw_tilemap_full();
	call	_draw_tilemap_full
;pocket_platformer.c:1176: SMS_displayOn();
	ld	hl, #0x0140
	call	_SMS_VDPturnOnFeature
;pocket_platformer.c:1177: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1179: static void death_sequence(unsigned char n) {
;	---------------------------------
; Function death_sequence
; ---------------------------------
_death_sequence:
	ld	c, a
;pocket_platformer.c:1181: for (i = 0; i < 8; i++) {
	ld	b, #0x00
00102$:
;pocket_platformer.c:1182: SMS_waitForVBlank();
	push	bc
	call	_SMS_waitForVBlank
	pop	bc
;pocket_platformer.c:1183: SMS_setBackdropColor(i & 1 ? 0x3F : 0);
	bit	0, b
	jr	Z, 00106$
	ld	hl, #0x003f
	jr	00107$
00106$:
	ld	hl, #0x0000
00107$:
	push	bc
	call	_SMS_setBackdropColor
	pop	bc
;pocket_platformer.c:1181: for (i = 0; i < 8; i++) {
	inc	b
	ld	a, b
	sub	a, #0x08
	jr	C, 00102$
;pocket_platformer.c:1185: SMS_setBackdropColor(0);
	push	bc
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_setBackdropColor
	pop	bc
;pocket_platformer.c:1186: load_level(n);
	ld	a, c
;pocket_platformer.c:1187: }
	jp	_load_level
;pocket_platformer.c:1192: static void gameplay_loop(void) {
;	---------------------------------
; Function gameplay_loop
; ---------------------------------
_gameplay_loop:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-5
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:1193: unsigned int joy = 0, joy_prev = 0, joy_pressed;
	ld	hl, #0x0000
	ex	(sp), hl
;pocket_platformer.c:1194: unsigned char level_n = 0, total;
	ld	-1 (ix), #0x00
;pocket_platformer.c:1196: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:1197: total = res_header->level_count;
	ld	iy, (_res_header)
	ld	a, 4 (iy)
	ld	-3 (ix), a
;pocket_platformer.c:1198: load_level(0);
	xor	a, a
	call	_load_level
;pocket_platformer.c:1200: while (1) {
00112$:
;pocket_platformer.c:1201: SMS_waitForVBlank();
	call	_SMS_waitForVBlank
;pocket_platformer.c:1202: joy_prev    = joy;
	pop	bc
	push	bc
;pocket_platformer.c:1203: joy         = SMS_getKeysStatus();
	push	bc
	call	_SMS_getKeysStatus
	pop	bc
	inc	sp
	inc	sp
	push	de
;pocket_platformer.c:1204: joy_pressed = joy & ~joy_prev;
	ld	a, c
	cpl
	ld	c, a
	ld	a, b
	cpl
	ld	b, a
	ld	a, -5 (ix)
	and	a, c
	ld	e, a
	ld	a, -4 (ix)
	and	a, b
	ld	d, a
;pocket_platformer.c:1206: prev_player_y = player.y;
	ld	hl, #_player + 4
	ld	a, (hl)
	inc	hl
	ld	(_prev_player_y+0), a
	ld	a, (hl)
	inc	hl
	ld	(_prev_player_y+1), a
	ld	a, (hl)
	inc	hl
	ld	(_prev_player_y+2), a
	ld	a, (hl)
	ld	(_prev_player_y+3), a
;pocket_platformer.c:1207: handle_input(joy, joy_pressed);
	pop	hl
	push	hl
	call	_handle_input
;pocket_platformer.c:1209: if (!player.on_ground && !player.jumping && !player.wall_jumping) player.falling = 1;
	ld	bc, #_player + 16
	ld	a, (bc)
	or	a, a
	jr	NZ, 00102$
	ld	a, (#_player + 18)
	or	a, a
	jr	NZ, 00102$
	ld	a, (#_player + 19)
	or	a, a
	jr	NZ, 00102$
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
00102$:
;pocket_platformer.c:1210: player.on_ground = 0;
	xor	a, a
	ld	(bc), a
;pocket_platformer.c:1211: apply_gravity();
	call	_apply_gravity
;pocket_platformer.c:1212: apply_treadmill();
	call	_apply_treadmill
;pocket_platformer.c:1213: move_player_x();
	call	_move_player_x
;pocket_platformer.c:1214: move_player_y();
	call	_move_player_y
;pocket_platformer.c:1215: check_object_collisions();
	call	_check_object_collisions
;pocket_platformer.c:1216: check_rb_switch();
	call	_check_rb_switch
;pocket_platformer.c:1217: update_disappearing_blocks();
	call	_update_disappearing_blocks
;pocket_platformer.c:1218: update_camera();
	call	_update_camera
;pocket_platformer.c:1219: update_anim();
	call	_update_anim
;pocket_platformer.c:1221: SMS_initSprites();
	call	_SMS_initSprites
;pocket_platformer.c:1222: draw_objects();
	call	_draw_objects
;pocket_platformer.c:1223: draw_player();
	call	_draw_player
;pocket_platformer.c:1224: SMS_finalizeSprites();
	call	_SMS_finalizeSprites
;pocket_platformer.c:1225: SMS_copySpritestoSAT();
	call	_SMS_copySpritestoSAT
;pocket_platformer.c:1227: if (player_died) {
	ld	a, (_player_died+0)
	or	a, a
	jr	Z, 00109$
;pocket_platformer.c:1228: death_sequence(level_n);
	ld	a, -1 (ix)
	call	_death_sequence
	jp	00112$
00109$:
;pocket_platformer.c:1229: } else if (level_complete) {
	ld	a, (_level_complete+0)
	or	a, a
	jp	Z, 00112$
;pocket_platformer.c:1231: for (i = 0; i < 60; i++) SMS_waitForVBlank();
	ld	c, #0x3c
00116$:
	push	bc
	call	_SMS_waitForVBlank
	pop	bc
	dec	c
	jr	NZ, 00116$
;pocket_platformer.c:1232: level_n = (level_n + 1 < total) ? level_n + 1 : 0;
	ld	c, -1 (ix)
	ld	b, #0x00
	inc	bc
	ld	e, -3 (ix)
	ld	d, #0x00
	ld	a, c
	sub	a, e
	ld	a, b
	sbc	a, d
	jp	PO, 00167$
	xor	a, #0x80
00167$:
	jp	P, 00119$
	inc	-1 (ix)
	ld	a, -1 (ix)
	ld	-2 (ix), a
	rlca
	sbc	a, a
	ld	-1 (ix), a
	jr	00120$
00119$:
	xor	a, a
	ld	-2 (ix), a
	ld	-1 (ix), a
00120$:
	ld	a, -2 (ix)
;pocket_platformer.c:1233: load_level(level_n);
	ld	-1 (ix), a
	call	_load_level
;pocket_platformer.c:1236: }
	jp	00112$
;pocket_platformer.c:1241: static void title_screen(void) {
;	---------------------------------
; Function title_screen
; ---------------------------------
_title_screen:
;pocket_platformer.c:1243: SMS_waitForVBlank();
	call	_SMS_waitForVBlank
;pocket_platformer.c:1244: SMS_displayOff();
	ld	hl, #0x0140
	call	_SMS_VDPturnOffFeature
;pocket_platformer.c:1245: SMS_VRAMmemsetW(0, 0, 16 * 1024);
	ld	hl, #0x4000
	push	hl
	ld	de, #0x0000
	ld	h, l
	call	_SMS_VRAMmemsetW
;pocket_platformer.c:1246: SMS_zeroBGPalette();
	call	_SMS_zeroBGPalette
;pocket_platformer.c:1247: SMS_zeroSpritePalette();
	call	_SMS_zeroSpritePalette
;pocket_platformer.c:1248: SMS_setBGPaletteColor(1, 0x3F);
	ld	l, #0x3f
;	spillPairReg hl
;	spillPairReg hl
	ld	a, #0x01
	call	_SMS_setBGPaletteColor
;pocket_platformer.c:1249: SMS_load1bppTiles(font_1bpp, VRAM_TILE_FONT, font_1bpp_size, 0, 1);
	ld	hl, #0x100
	push	hl
	ld	hl, (_font_1bpp_size)
	push	hl
	ld	de, #0x0160
	ld	hl, #_font_1bpp
	call	_SMS_load1bppTiles
;pocket_platformer.c:1250: SMS_configureTextRenderer(VRAM_TILE_FONT - 32);
	ld	hl, #0x0140
	call	_SMS_configureTextRenderer
;pocket_platformer.c:1251: SMS_displayOn();
	ld	hl, #0x0140
	call	_SMS_VDPturnOnFeature
;pocket_platformer.c:1252: SMS_printatXY(4,  8, "POCKET PLATFORMER");
	ld	hl, #0x7a08
	rst	#0x08
	ld	hl, #___str_0
	call	_SMS_print
;pocket_platformer.c:1253: SMS_printatXY(3, 10, "for Sega Master System");
	ld	hl, #0x7a86
	rst	#0x08
	ld	hl, #___str_1
	call	_SMS_print
;pocket_platformer.c:1254: SMS_printatXY(4, 14, "Press 1 to start");
	ld	hl, #0x7b88
	rst	#0x08
	ld	hl, #___str_2
	call	_SMS_print
;pocket_platformer.c:1255: do { SMS_waitForVBlank(); joy = SMS_getKeysStatus(); }
00110$:
	call	_SMS_waitForVBlank
	call	_SMS_getKeysStatus
	ld	a, e
;pocket_platformer.c:1256: while (!(joy & (PORT_A_KEY_1 | PORT_A_KEY_2)));
	and	a, #0x30
	jr	Z, 00110$
;pocket_platformer.c:1257: do { SMS_waitForVBlank(); joy = SMS_getKeysStatus(); }
00113$:
	call	_SMS_waitForVBlank
	call	_SMS_getKeysStatus
	ld	a, e
;pocket_platformer.c:1258: while (joy & (PORT_A_KEY_1 | PORT_A_KEY_2));
	and	a, #0x30
	jr	NZ, 00113$
;pocket_platformer.c:1259: }
	ret
___str_0:
	.ascii "POCKET PLATFORMER"
	.db 0x00
___str_1:
	.ascii "for Sega Master System"
	.db 0x00
___str_2:
	.ascii "Press 1 to start"
	.db 0x00
;pocket_platformer.c:1264: void main(void) {
;	---------------------------------
; Function main
; ---------------------------------
_main::
;pocket_platformer.c:1266: SMS_useFirstHalfTilesforSprites(0);
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_useFirstHalfTilesforSprites
;pocket_platformer.c:1267: SMS_setSpriteMode(SPRITEMODE_NORMAL);
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_setSpriteMode
;pocket_platformer.c:1268: SMS_setBackdropColor(0);
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_setBackdropColor
;pocket_platformer.c:1270: while (1) {
00104$:
;pocket_platformer.c:1271: title_screen();
	call	_title_screen
;pocket_platformer.c:1272: if (!has_resource()) continue;
	call	_has_resource
	or	a, a
	jr	Z, 00104$
;pocket_platformer.c:1273: init_resources();
	call	_init_resources
;pocket_platformer.c:1274: SMS_waitForVBlank();
	call	_SMS_waitForVBlank
;pocket_platformer.c:1275: SMS_displayOff();
	ld	hl, #0x0140
	call	_SMS_VDPturnOffFeature
;pocket_platformer.c:1276: SMS_VRAMmemsetW(0, 0, 16 * 1024);
	ld	hl, #0x4000
	push	hl
	ld	de, #0x0000
	ld	h, l
	call	_SMS_VRAMmemsetW
;pocket_platformer.c:1277: load_graphics();
	call	_load_graphics
;pocket_platformer.c:1278: SMS_displayOn();
	ld	hl, #0x0140
	call	_SMS_VDPturnOnFeature
;pocket_platformer.c:1279: gameplay_loop();
	call	_gameplay_loop
;pocket_platformer.c:1281: }
	jr	00104$
	.area _CODE
__str_3:
	.ascii "pocket-platformer-sms"
	.db 0x00
__str_4:
	.ascii "Pocket Platformer SMS Engine"
	.db 0x00
__str_5:
	.ascii "Generated by pocket-platformer-to-sms web exporter."
	.db 0x00
	.area _INITIALIZER
__xinit__treadmill_bonus:
	.byte #0x00, #0x00, #0x00, #0x00	;  0
__xinit__treadmill_active:
	.db #0x00	; 0
	.area _CABS (ABS)
	.org 0x7FF0
___SMS__SEGA_signature:
	.db #0x54	; 84	'T'
	.db #0x4d	; 77	'M'
	.db #0x52	; 82	'R'
	.db #0x20	; 32
	.db #0x53	; 83	'S'
	.db #0x45	; 69	'E'
	.db #0x47	; 71	'G'
	.db #0x41	; 65	'A'
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x99	; 153
	.db #0x99	; 153
	.db #0x00	; 0
	.db #0x4c	; 76	'L'
	.org 0x7FCA
___SMS__SDSC_author:
	.ascii "pocket-platformer-sms"
	.db 0x00
	.org 0x7FAD
___SMS__SDSC_name:
	.ascii "Pocket Platformer SMS Engine"
	.db 0x00
	.org 0x7F79
___SMS__SDSC_descr:
	.ascii "Generated by pocket-platformer-to-sms web exporter."
	.db 0x00
	.org 0x7FE0
___SMS__SDSC_signature:
	.db #0x53	; 83	'S'
	.db #0x44	; 68	'D'
	.db #0x53	; 83	'S'
	.db #0x43	; 67	'C'
	.db #0x01	; 1
	.db #0x03	; 3
	.db #0x01	; 1
	.db #0x01	; 1
	.db #0x25	; 37
	.db #0x20	; 32
	.db #0xca	; 202
	.db #0x7f	; 127
	.db #0xad	; 173
	.db #0x7f	; 127
	.db #0x79	; 121	'y'
	.db #0x7f	; 127
