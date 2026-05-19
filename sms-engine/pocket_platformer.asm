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
	.ds 31
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
_level_n_global:
	.ds 1
_dialogue_active:
	.ds 1
_dialogue_line:
	.ds 1
_dialogue_total:
	.ds 1
_dialogue_buf:
	.ds 928
_saved_nametable:
	.ds 320
_dialogue_btn_prev:
	.ds 1
_npc_contact_idx:
	.ds 1
_npc_contact_level:
	.ds 1
_npc_contact_auto:
	.ds 1
_tp:
	.ds 208
_tp_count:
	.ds 1
_barrel_active:
	.ds 1
_barrel_dir:
	.ds 1
_barrel_cx:
	.ds 4
_barrel_cy:
	.ds 4
_barrel_btn_released:
	.ds 1
_barrel_launched:
	.ds 1
_barrel_launched_h:
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
_rfb:
	.ds 64
_rfb_count:
	.ds 1
;--------------------------------------------------------
; ram data
;--------------------------------------------------------
	.area _INITIALIZED
_tp_carry_vx:
	.ds 4
_tp_carry_vy:
	.ds 4
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
;pocket_platformer.c:275: static unsigned char has_resource(void) {
;	---------------------------------
; Function has_resource
; ---------------------------------
_has_resource:
;pocket_platformer.c:277: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:278: return (p[0]=='P' && p[1]=='P' && p[2]=='L' && p[3]=='T');
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
;pocket_platformer.c:279: }
	ret
_tp_speed_table:
	.dw #0x0000
	.dw #0x0055
	.dw #0x00ab
	.dw #0x0100
	.dw #0x0155
	.dw #0x0200
	.dw #0x02ab
	.dw #0x0400
;pocket_platformer.c:281: static void init_resources(void) {
;	---------------------------------
; Function init_resources
; ---------------------------------
_init_resources:
;pocket_platformer.c:282: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:283: res_header  = (resource_header *)RESOURCE_BASE_ADDR;
	ld	hl, #0x8000
	ld	(_res_header), hl
;pocket_platformer.c:284: res_physics = (physics_config  *)(RESOURCE_BASE_ADDR + sizeof(resource_header));
	ld	l, #0x27
	ld	(_res_physics), hl
;pocket_platformer.c:285: res_palette = (unsigned char   *)res_physics + sizeof(physics_config);
	ld	l, #0x38
	ld	(_res_palette), hl
;pocket_platformer.c:286: res_tileset = res_palette + 16;
	ld	l, #0x48
	ld	(_res_tileset), hl
;pocket_platformer.c:288: res_sprites = res_tileset + (unsigned int)res_header->num_tiles * 32u;
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
	ld	bc,#0x8048
	add	hl,bc
	ld	(_res_sprites), hl
;pocket_platformer.c:289: res_levels  = (level_header *)(res_sprites + 21u * 32u); /* +fireball */
	ld	hl, (_res_sprites)
	ld	de, #0x02a0
	add	hl, de
	ld	(_res_levels), hl
;pocket_platformer.c:290: }
	ret
;pocket_platformer.c:292: static level_header *get_level(unsigned char n) {
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
;pocket_platformer.c:293: level_header *lh = res_levels;
	ld	hl, (_res_levels)
	ld	-4 (ix), l
	ld	-3 (ix), h
;pocket_platformer.c:295: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:296: for (i = 0; i < n; i++) {
	ld	-1 (ix), #0x00
00103$:
	ld	a, -1 (ix)
	sub	a, -2 (ix)
	jp	NC, 00101$
;pocket_platformer.c:297: unsigned int sz = sizeof(level_header)
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
;pocket_platformer.c:300: lh = (level_header *)((unsigned char *)lh + sz);
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
;pocket_platformer.c:296: for (i = 0; i < n; i++) {
	inc	-1 (ix)
	jp	00103$
00101$:
;pocket_platformer.c:302: return lh;
	ld	e, -4 (ix)
	ld	d, -3 (ix)
;pocket_platformer.c:303: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:308: static unsigned char get_tile(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function get_tile
; ---------------------------------
_get_tile:
	ld	c, a
	ld	b, l
;pocket_platformer.c:309: if (tx >= cur_level->map_w || ty >= cur_level->map_h) return 0;
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
;pocket_platformer.c:310: return cur_map[(unsigned int)tx * cur_level->map_h + ty];
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
;pocket_platformer.c:311: }
	ret
;pocket_platformer.c:314: static disp_entry *disp_find(unsigned char tx, unsigned char ty) {
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
;pocket_platformer.c:316: for (i = 0; i < MAX_DISP; i++)
	ld	c, #0x00
00106$:
;pocket_platformer.c:317: if (disp_blocks[i].frame && disp_blocks[i].tx == tx && disp_blocks[i].ty == ty)
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
;pocket_platformer.c:318: return &disp_blocks[i];
	jr	00107$
00107$:
;pocket_platformer.c:316: for (i = 0; i < MAX_DISP; i++)
	inc	c
	ld	a, c
	sub	a, #0x10
	jr	C, 00106$
;pocket_platformer.c:319: return 0;
	ld	de, #0x0000
00108$:
;pocket_platformer.c:320: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:322: static void disp_touch(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function disp_touch
; ---------------------------------
_disp_touch:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	ld	-1 (ix), a
;pocket_platformer.c:324: if (disp_find(tx, ty)) return; /* already active */
	ld	-2 (ix), l
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_find
	ld	a, d
;pocket_platformer.c:325: for (i = 0; i < MAX_DISP; i++) {
	or	a,e
	jr	NZ, 00108$
	ld	l,a
;	spillPairReg hl
;	spillPairReg hl
00106$:
;pocket_platformer.c:326: if (!disp_blocks[i].frame) {
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
;pocket_platformer.c:327: disp_blocks[i].tx = tx;
	ld	a, -1 (ix)
	ld	(bc), a
;pocket_platformer.c:328: disp_blocks[i].ty = ty;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a, -2 (ix)
	ld	(hl), a
;pocket_platformer.c:329: disp_blocks[i].frame = 1;
	ld	a, #0x01
	ld	(de), a
;pocket_platformer.c:330: disp_blocks[i].is_connected = 0;
	inc	bc
	inc	bc
	inc	bc
	xor	a, a
	ld	(bc), a
;pocket_platformer.c:331: return;
	jr	00108$
00107$:
;pocket_platformer.c:325: for (i = 0; i < MAX_DISP; i++) {
	inc	l
	ld	a, l
	sub	a, #0x10
	jr	C, 00106$
00108$:
;pocket_platformer.c:334: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:337: static void disp_touch_connected(unsigned char tx, unsigned char ty) {
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
;pocket_platformer.c:339: if (disp_find(tx, ty)) return; /* already triggered */
	ld	-2 (ix), l
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_find
	ld	c, e
	ld	a, d
	or	a, c
	jr	NZ, 00120$
;pocket_platformer.c:340: disp_touch(tx, ty);
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_touch
;pocket_platformer.c:343: disp_entry *e = disp_find(tx, ty);
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
;pocket_platformer.c:344: if (e) e->is_connected = 1;
	ld	a,d
	ld	h,a
	or	a, c
	jr	Z, 00130$
	inc	hl
	inc	hl
	inc	hl
	ld	(hl), #0x01
;pocket_platformer.c:347: for (dx = -1; dx <= 1; dx++) {
00130$:
	ld	c, #0xff
;pocket_platformer.c:348: for (dy = -1; dy <= 1; dy++) {
00128$:
	ld	e, #0xff
00117$:
;pocket_platformer.c:350: if (dx == 0 && dy == 0) continue;
	ld	a, c
	or	a,a
	jr	NZ, 00106$
	or	a,e
	jr	Z, 00114$
00106$:
;pocket_platformer.c:351: if (dx != 0 && dy != 0) continue; /* diagonal - skip */
	ld	a, c
	or	a, a
	jr	Z, 00109$
	ld	a, e
	or	a, a
	jr	NZ, 00114$
00109$:
;pocket_platformer.c:352: nx = (unsigned char)((int)tx + dx);
	ld	a, -1 (ix)
	add	a, c
	ld	-3 (ix), a
;pocket_platformer.c:353: ny = (unsigned char)((int)ty + dy);
	ld	a, -2 (ix)
	add	a, e
	ld	b, a
;pocket_platformer.c:354: if (get_tile(nx, ny) == res_header->conn_vram_idx && res_header->conn_vram_idx)
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
;pocket_platformer.c:355: disp_touch_connected(nx, ny);
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
;pocket_platformer.c:348: for (dy = -1; dy <= 1; dy++) {
	inc	e
	ld	a, #0x01
	sub	a, e
	jp	PO, 00171$
	xor	a, #0x80
00171$:
	jp	P, 00117$
;pocket_platformer.c:347: for (dx = -1; dx <= 1; dx++) {
	inc	c
	ld	a, #0x01
	sub	a, c
	jp	PO, 00172$
	xor	a, #0x80
00172$:
	jp	P, 00128$
00120$:
;pocket_platformer.c:358: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:361: static unsigned char disp_is_gone(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function disp_is_gone
; ---------------------------------
_disp_is_gone:
;pocket_platformer.c:362: disp_entry *e = disp_find(tx, ty);
	call	_disp_find
	ld	c, e
;pocket_platformer.c:363: return (e && e->frame >= DISP_GONE_AT) ? 1 : 0;
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
;pocket_platformer.c:364: }
	ret
;pocket_platformer.c:367: static fg_disp_entry *fg_disp_find(unsigned char tx, unsigned char ty) {
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
;pocket_platformer.c:369: for (i = 0; i < MAX_FG_DISP; i++)
	ld	c, #0x00
00106$:
;pocket_platformer.c:370: if (fg_disp_blocks[i].frame && fg_disp_blocks[i].tx == tx && fg_disp_blocks[i].ty == ty)
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
;pocket_platformer.c:371: return &fg_disp_blocks[i];
	jr	00107$
00107$:
;pocket_platformer.c:369: for (i = 0; i < MAX_FG_DISP; i++)
	inc	c
	ld	a, c
	sub	a, #0x10
	jr	C, 00106$
;pocket_platformer.c:372: return 0;
	ld	de, #0x0000
00108$:
;pocket_platformer.c:373: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:378: static void fg_disp_touch_connected(unsigned char tx, unsigned char ty) {
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
;pocket_platformer.c:382: if (fg_disp_find(tx, ty)) return;
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
;pocket_platformer.c:383: fg_disp_touch(tx, ty);
	push	bc
	ld	l, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_fg_disp_touch
	pop	bc
;pocket_platformer.c:384: for (d = 0; d < 4; d++) {
	ld	e, #0x00
00108$:
;pocket_platformer.c:385: unsigned char nx = (unsigned char)(tx + dx[d]);
	ld	hl, #_fg_disp_touch_connected_dx_65536_191
	ld	d, #0x00
	add	hl, de
	ld	a, (hl)
	ld	b, c
	add	a, b
	ld	-3 (ix), a
;pocket_platformer.c:386: unsigned char ny = (unsigned char)(ty + dy[d]);
	ld	hl, #_fg_disp_touch_connected_dy_65536_191
	ld	d, #0x00
	add	hl, de
	ld	a, (hl)
	ld	b, -1 (ix)
	add	a, b
	ld	-2 (ix), a
;pocket_platformer.c:387: unsigned char t = get_tile(nx, ny);
	push	bc
	push	de
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -3 (ix)
	call	_get_tile
	pop	de
	pop	bc
;pocket_platformer.c:389: if (res_header->fg_disp_vram_idx &&
	ld	iy, (_res_header)
	push	af
	ld	b, 37 (iy)
	pop	af
	inc	b
	dec	b
	jr	Z, 00109$
;pocket_platformer.c:390: t == (res_header->fg_disp_vram_idx | 0x80) &&
	set	7, b
	sub	a, b
	jr	NZ, 00109$
;pocket_platformer.c:391: !fg_disp_find(nx, ny))
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
;pocket_platformer.c:392: fg_disp_touch_connected(nx, ny);
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
;pocket_platformer.c:384: for (d = 0; d < 4; d++) {
	inc	e
	ld	a, e
	sub	a, #0x04
	jr	C, 00108$
00110$:
;pocket_platformer.c:394: }
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
;pocket_platformer.c:396: static void fg_disp_touch(unsigned char tx, unsigned char ty) {
;	---------------------------------
; Function fg_disp_touch
; ---------------------------------
_fg_disp_touch:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	ld	-1 (ix), a
;pocket_platformer.c:398: if (fg_disp_find(tx, ty)) return;
	ld	-2 (ix), l
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_fg_disp_find
	ld	a, d
;pocket_platformer.c:399: for (i = 0; i < MAX_FG_DISP; i++) {
	or	a,e
	jr	NZ, 00108$
	ld	c,a
00106$:
;pocket_platformer.c:400: if (!fg_disp_blocks[i].frame) {
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
;pocket_platformer.c:401: fg_disp_blocks[i].tx = tx;
	ld	a, -1 (ix)
	ld	(hl), a
;pocket_platformer.c:402: fg_disp_blocks[i].ty = ty;
	inc	hl
	ld	a, -2 (ix)
	ld	(hl), a
;pocket_platformer.c:403: fg_disp_blocks[i].frame = 1;
	ld	a, #0x01
	ld	(de), a
;pocket_platformer.c:404: return;
	jr	00108$
00107$:
;pocket_platformer.c:399: for (i = 0; i < MAX_FG_DISP; i++) {
	inc	c
	ld	a, c
	sub	a, #0x10
	jr	C, 00106$
00108$:
;pocket_platformer.c:407: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:417: static unsigned char is_solid_px(long fpx, long fpy) {
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
;pocket_platformer.c:419: long px = fpx >> 8, py = fpy >> 8;
	ld	b, #0x08
00280$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00280$
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
00282$:
	sra	-13 (ix)
	rr	-14 (ix)
	rr	-15 (ix)
	rr	-16 (ix)
	djnz	00282$
	ld	hl, #15
	add	hl, sp
	ex	de, hl
	ld	hl, #8
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:420: if (px < 0 || py < 0) return 1;
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
	jp	00135$
00102$:
;pocket_platformer.c:422: (unsigned char)(py / TILE_SIZE));
	ld	hl, #20
	add	hl, sp
	ex	de, hl
	ld	hl, #15
	add	hl, sp
	ld	bc, #4
	ldir
	or	a, a
	jr	Z, 00137$
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
00137$:
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
;pocket_platformer.c:421: t = get_tile((unsigned char)(px / TILE_SIZE),
	pop	bc
	push	bc
	ld	a, -5 (ix)
	or	a, a
	jr	Z, 00138$
	ld	a, -24 (ix)
	add	a, #0x07
	ld	c, a
	ld	a, -23 (ix)
	adc	a, #0x00
	ld	b, a
00138$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	a, c
	call	_get_tile
;pocket_platformer.c:423: if (t == 0) return 0;
	ld	-12 (ix), a
	or	a, a
	jr	NZ, 00105$
	xor	a, a
	jp	00135$
00105$:
;pocket_platformer.c:425: if (t & 0x80) return 0;
	bit	7, -12 (ix)
	jr	Z, 00107$
	xor	a, a
	jp	00135$
00107$:
;pocket_platformer.c:427: if (res_header->one_way_vram_idx && t == res_header->one_way_vram_idx) return 0;
	ld	bc, (_res_header)
	push	bc
	pop	iy
	ld	e, 6 (iy)
	ld	a, e
	or	a, a
	jr	Z, 00154$
	ld	a, -12 (ix)
	sub	a, e
	jr	NZ, 00154$
	xor	a, a
	jp	00135$
;pocket_platformer.c:431: for (di = 0; di < 18; di++) {
00154$:
	ld	e, #0x00
00133$:
;pocket_platformer.c:432: if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
	ld	hl, #0x0013
	add	hl, bc
	ld	d, #0x00
	add	hl, de
	ld	d, (hl)
	ld	a, d
	or	a, a
	jr	Z, 00134$
	ld	a, -12 (ix)
	sub	a, d
	jr	NZ, 00134$
	xor	a, a
	jp	00135$
00134$:
;pocket_platformer.c:431: for (di = 0; di < 18; di++) {
	inc	e
	ld	a, e
	sub	a, #0x12
	jr	C, 00133$
;pocket_platformer.c:437: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
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
;pocket_platformer.c:438: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
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
;pocket_platformer.c:436: if (vp_block_count) {
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00118$
;pocket_platformer.c:437: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -11 (ix)
	or	a, a
	jr	Z, 00139$
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #14
	add	hl, sp
	ld	bc, #4
	ldir
00139$:
	pop	bc
	push	bc
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:438: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	c, -16 (ix)
	ld	b, -15 (ix)
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00140$
	ld	c, -5 (ix)
	ld	b, -4 (ix)
00140$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:439: if (vp_is_passable(dtx, dty)) return 0;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_vp_is_passable
	or	a, a
	jr	Z, 00118$
	xor	a, a
	jp	00135$
00118$:
;pocket_platformer.c:442: if (rb_block_count) {
	ld	a, (_rb_block_count+0)
	or	a, a
	jr	Z, 00122$
;pocket_platformer.c:443: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	c, -20 (ix)
	ld	b, -19 (ix)
	ld	a, -11 (ix)
	or	a, a
	jr	Z, 00141$
	ld	c, -10 (ix)
	ld	b, -9 (ix)
00141$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:444: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	c, -16 (ix)
	ld	b, -15 (ix)
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00142$
	ld	c, -5 (ix)
	ld	b, -4 (ix)
00142$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:445: if (rb_is_passable(dtx, dty)) return 0;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_rb_is_passable
	or	a, a
	jr	Z, 00122$
	xor	a, a
	jp	00135$
00122$:
;pocket_platformer.c:449: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
	ld	c, -20 (ix)
	ld	b, -19 (ix)
	ld	e, -18 (ix)
	ld	d, -17 (ix)
	ld	a, -11 (ix)
	or	a, a
	jr	Z, 00143$
	ld	c, -10 (ix)
	ld	b, -9 (ix)
	ld	e, -8 (ix)
	ld	d, -7 (ix)
00143$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-1 (ix), c
;pocket_platformer.c:450: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
	ld	hl, #14
	add	hl, sp
	ex	de, hl
	ld	hl, #8
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00144$
	ld	hl, #14
	add	hl, sp
	ex	de, hl
	ld	hl, #19
	add	hl, sp
	ld	bc, #4
	ldir
00144$:
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
;pocket_platformer.c:427: if (res_header->one_way_vram_idx && t == res_header->one_way_vram_idx) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:451: if ((res_header->disp_vram_idx && t == res_header->disp_vram_idx &&
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
;pocket_platformer.c:452: disp_is_gone(dtx, dty)) ||
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_is_gone
	or	a, a
	jr	NZ, 00123$
00129$:
;pocket_platformer.c:427: if (res_header->one_way_vram_idx && t == res_header->one_way_vram_idx) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:453: (res_header->conn_vram_idx && t == res_header->conn_vram_idx &&
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
;pocket_platformer.c:454: disp_is_gone(dtx, dty))) return 0;
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_is_gone
	or	a, a
	jr	Z, 00124$
00123$:
	xor	a, a
	jr	00135$
00124$:
;pocket_platformer.c:427: if (res_header->one_way_vram_idx && t == res_header->one_way_vram_idx) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:457: if (res_header->spike_vram_idx && t == res_header->spike_vram_idx) return 0;
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	de, #0x0026
	add	hl, de
	ld	a, (hl)
	ld	-1 (ix), a
	or	a, a
	jr	Z, 00131$
	ld	a, -12 (ix)
	sub	a, -1 (ix)
	jr	NZ, 00131$
	xor	a, a
	jr	00135$
00131$:
;pocket_platformer.c:458: return 1;
	ld	a, #0x01
00135$:
;pocket_platformer.c:459: }
	ld	sp, ix
	pop	ix
	pop	hl
	pop	bc
	pop	bc
	jp	(hl)
;pocket_platformer.c:463: static unsigned char is_solid_falling_px(long fpx, long fpy) {
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
;pocket_platformer.c:465: long px = fpx >> 8, py = fpy >> 8;
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
;pocket_platformer.c:466: if (px < 0 || py < 0) return 1;
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
;pocket_platformer.c:468: (unsigned char)(py / TILE_SIZE));
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
;pocket_platformer.c:467: t = get_tile((unsigned char)(px / TILE_SIZE),
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
;pocket_platformer.c:469: if (t == 0) return 0;
	ld	-12 (ix), a
	or	a, a
	jr	NZ, 00105$
	xor	a, a
	jp	00132$
00105$:
;pocket_platformer.c:471: if (t & 0x80) return 0;
	bit	7, -12 (ix)
	jr	Z, 00149$
	xor	a, a
	jp	00132$
;pocket_platformer.c:475: for (di = 0; di < 18; di++) {
00149$:
	ld	c, #0x00
00130$:
;pocket_platformer.c:476: if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
	ld	hl, (_res_header)
	ld	de, #0x0013
	add	hl, de
	ld	e, c
	ld	d, #0x00
	add	hl, de
	ld	b, (hl)
	ld	a, b
	or	a, a
	jr	Z, 00131$
	ld	a, -12 (ix)
	sub	a, b
	jr	NZ, 00131$
	xor	a, a
	jp	00132$
00131$:
;pocket_platformer.c:475: for (di = 0; di < 18; di++) {
	inc	c
	ld	a, c
	sub	a, #0x12
	jr	C, 00130$
;pocket_platformer.c:481: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
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
;pocket_platformer.c:482: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
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
;pocket_platformer.c:480: if (vp_block_count) {
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00115$
;pocket_platformer.c:481: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
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
;pocket_platformer.c:482: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
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
;pocket_platformer.c:483: if (vp_is_passable(dtx, dty)) return 0;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_vp_is_passable
	or	a, a
	jr	Z, 00115$
	xor	a, a
	jp	00132$
00115$:
;pocket_platformer.c:486: if (rb_block_count) {
	ld	a, (_rb_block_count+0)
	or	a, a
	jr	Z, 00119$
;pocket_platformer.c:487: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
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
;pocket_platformer.c:488: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
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
;pocket_platformer.c:489: if (rb_is_passable(dtx, dty)) return 0;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_rb_is_passable
	or	a, a
	jr	Z, 00119$
	xor	a, a
	jp	00132$
00119$:
;pocket_platformer.c:492: unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
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
;pocket_platformer.c:493: unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
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
;pocket_platformer.c:476: if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:494: if ((res_header->disp_vram_idx && t == res_header->disp_vram_idx &&
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
;pocket_platformer.c:495: disp_is_gone(dtx, dty)) ||
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_is_gone
	or	a, a
	jr	NZ, 00120$
00126$:
;pocket_platformer.c:476: if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:496: (res_header->conn_vram_idx && t == res_header->conn_vram_idx &&
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
;pocket_platformer.c:497: disp_is_gone(dtx, dty))) return 0;
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -1 (ix)
	call	_disp_is_gone
	or	a, a
	jr	Z, 00121$
00120$:
	xor	a, a
	jr	00132$
00121$:
;pocket_platformer.c:476: if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
	ld	hl, (_res_header)
;pocket_platformer.c:500: if (res_header->spike_vram_idx && t == res_header->spike_vram_idx) return 0;
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	de, #0x0026
	add	hl, de
	ld	a, (hl)
	ld	-1 (ix), a
	or	a, a
	jr	Z, 00128$
	ld	a, -12 (ix)
	sub	a, -1 (ix)
	jr	NZ, 00128$
	xor	a, a
	jr	00132$
00128$:
;pocket_platformer.c:501: return 1;
	ld	a, #0x01
00132$:
;pocket_platformer.c:502: }
	ld	sp, ix
	pop	ix
	pop	hl
	pop	bc
	pop	bc
	jp	(hl)
;pocket_platformer.c:507: static void load_graphics(void) {
;	---------------------------------
; Function load_graphics
; ---------------------------------
_load_graphics:
;pocket_platformer.c:509: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:510: SMS_loadBGPalette(res_palette);
	ld	hl, (_res_palette)
	call	_SMS_loadBGPalette
;pocket_platformer.c:511: SMS_setSpritePaletteColor(0, 0);
;	spillPairReg hl
;	spillPairReg hl
	xor	a, a
	ld	l, a
	call	_SMS_setSpritePaletteColor
;pocket_platformer.c:512: for (i = 1; i < 16; i++)
	ld	c, #0x01
00102$:
;pocket_platformer.c:513: SMS_setSpritePaletteColor(i, res_palette[i]);
	ld	hl, (_res_palette)
	ld	b, #0x00
	add	hl, bc
	ld	l, (hl)
;	spillPairReg hl
	push	bc
	ld	a, c
	call	_SMS_setSpritePaletteColor
	pop	bc
;pocket_platformer.c:512: for (i = 1; i < 16; i++)
	inc	c
	ld	a, c
	sub	a, #0x10
	jr	C, 00102$
;pocket_platformer.c:515: SMS_loadTiles(res_tileset, VRAM_BG_BASE,
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
;pocket_platformer.c:518: SMS_loadTiles(res_sprites, 256u, 20u * 32u);
	ld	de, (_res_sprites)
	ld	hl, #0x0280
	push	hl
	ld	hl, #0x2000
	call	_SMS_VRAMmemcpy
;pocket_platformer.c:519: SMS_load1bppTiles(font_1bpp, VRAM_TILE_FONT, font_1bpp_size, 0, 1);
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
;pocket_platformer.c:520: SMS_configureTextRenderer(VRAM_TILE_FONT - 32);
	ld	hl, #0x0140
;pocket_platformer.c:521: }
	jp	_SMS_configureTextRenderer
;pocket_platformer.c:523: static void draw_tilemap_full(void) {
;	---------------------------------
; Function draw_tilemap_full
; ---------------------------------
_draw_tilemap_full:
;pocket_platformer.c:525: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:526: for (y = 0; y < SCREEN_TILES_H; y++) {
	ld	c, #0x00
00108$:
;pocket_platformer.c:527: SMS_setNextTileatXY(0, y);
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
;pocket_platformer.c:528: for (x = 0; x < SCREEN_TILES_W; x++) {
	ld	b, #0x00
00106$:
;pocket_platformer.c:529: unsigned char t = (y < cur_level->map_h) ? get_tile(x, y) : 0;
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
;pocket_platformer.c:531: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
;pocket_platformer.c:530: if (t & 0x80)
	bit	7, e
	jr	Z, 00102$
;pocket_platformer.c:531: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	res	7, l
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	set	4, h
	rst	#0x18
	jr	00107$
00102$:
;pocket_platformer.c:533: SMS_setTile(t ? (unsigned int)(VRAM_BG_BASE + t - 1) : 0u);
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
;pocket_platformer.c:528: for (x = 0; x < SCREEN_TILES_W; x++) {
	inc	b
	ld	a, b
	sub	a, #0x20
	jr	C, 00106$
;pocket_platformer.c:526: for (y = 0; y < SCREEN_TILES_H; y++) {
	inc	c
	ld	a, c
	sub	a, #0x18
	jr	C, 00108$
;pocket_platformer.c:536: }
	ret
;pocket_platformer.c:538: static void draw_tile_column(unsigned char scr_col, unsigned char map_col) {
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
;pocket_platformer.c:540: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:541: SMS_setNextTileatXY(scr_col, 0);
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
;pocket_platformer.c:542: for (y = 0; y < SCREEN_TILES_H; y++) {
	ld	-1 (ix), #0x00
00105$:
;pocket_platformer.c:543: unsigned char t = (y < cur_level->map_h) ? get_tile(map_col, y) : 0;
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
;pocket_platformer.c:545: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
;pocket_platformer.c:544: if (t & 0x80)
	bit	7, e
	jr	Z, 00102$
;pocket_platformer.c:545: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	res	7, l
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	set	4, h
	rst	#0x18
	jr	00106$
00102$:
;pocket_platformer.c:547: SMS_setTile(t ? (unsigned int)(VRAM_BG_BASE + t - 1) : 0u);
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
;pocket_platformer.c:542: for (y = 0; y < SCREEN_TILES_H; y++) {
	inc	-1 (ix)
	ld	a, -1 (ix)
	sub	a, #0x18
	jr	C, 00105$
;pocket_platformer.c:549: }
	inc	sp
	pop	ix
	ret
;pocket_platformer.c:554: static unsigned char coins_remaining(void) {
;	---------------------------------
; Function coins_remaining
; ---------------------------------
_coins_remaining:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	dec	sp
;pocket_platformer.c:556: unsigned char n = cur_level->obj_count < MAX_OBJECTS ? cur_level->obj_count : MAX_OBJECTS;
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
;pocket_platformer.c:557: for (i = 0; i < n; i++)
	ld	b, #0x00
	ld	e, b
00106$:
	ld	a, e
	sub	a, -3 (ix)
	jr	NC, 00104$
;pocket_platformer.c:558: if (cur_objects[i].type == OBJ_COIN && !coin_collected[i]) count++;
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
;pocket_platformer.c:557: for (i = 0; i < n; i++)
	inc	e
	jr	00106$
00104$:
;pocket_platformer.c:559: return count;
	ld	a, b
;pocket_platformer.c:560: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:562: static unsigned int obj_sprite_tile(unsigned char type) {
;	---------------------------------
; Function obj_sprite_tile
; ---------------------------------
_obj_sprite_tile:
;pocket_platformer.c:563: switch (type) {
	ld	c, a
	sub	a, #0x02
	jr	Z, 00101$
	ld	a,c
	cp	a,#0x04
	jr	Z, 00103$
	cp	a,#0x05
	jr	Z, 00104$
	sub	a, #0x0c
	jr	Z, 00102$
	jr	00105$
;pocket_platformer.c:564: case OBJ_FINISH_FLAG:        return VRAM_SPR_FINISH_FLAG;
00101$:
	ld	de, #0x0101
	ret
;pocket_platformer.c:565: case OBJ_FINISH_FLAG_LOCKED: return coins_remaining() ? VRAM_SPR_FLAG_CLOSED : VRAM_SPR_FINISH_FLAG;
00102$:
	call	_coins_remaining
	or	a, a
	jr	Z, 00109$
	ld	de, #0x0109
	ret
00109$:
	ld	de, #0x0101
	ret
;pocket_platformer.c:566: case OBJ_TRAMPOLINE:         return VRAM_SPR_TRAMPOLINE;
00103$:
	ld	de, #0x0103
	ret
;pocket_platformer.c:567: case OBJ_COIN:               return VRAM_SPR_COIN;
00104$:
	ld	de, #0x0104
	ret
;pocket_platformer.c:568: default:                     return VRAM_SPR_FINISH_FLAG;
00105$:
	ld	de, #0x0101
;pocket_platformer.c:569: }
;pocket_platformer.c:570: }
	ret
;pocket_platformer.c:572: static void draw_objects(void) {
;	---------------------------------
; Function draw_objects
; ---------------------------------
_draw_objects:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	dec	sp
;pocket_platformer.c:574: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:575: for (i = 0; i < cur_level->obj_count; i++) {
	ld	c, #0x00
00132$:
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	b, (hl)
	ld	a, c
	sub	a, b
	jp	NC, 00133$
;pocket_platformer.c:576: level_object *obj = &cur_objects[i];
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
;pocket_platformer.c:578: if (obj->type == OBJ_START_FLAG) continue;
	ld	-2 (ix), e
	ld	-1 (ix), d
	inc	de
	inc	de
	ld	a, (de)
	ld	-3 (ix), a
	dec	a
	jp	Z,00129$
;pocket_platformer.c:579: if (obj->type == OBJ_SPIKE) continue;  /* spike is a BG tile */
	ld	a, -3 (ix)
	sub	a, #0x03
	jp	Z,00129$
;pocket_platformer.c:580: if (obj->type == OBJ_NPC) continue;    /* NPC sprite handled separately */
	ld	a, -3 (ix)
	sub	a, #0x0d
	jp	Z,00129$
;pocket_platformer.c:581: if (obj->type == OBJ_BARREL) continue; /* drawn by draw_barrels() */
	ld	a, -3 (ix)
	sub	a, #0x0e
	jp	Z,00129$
;pocket_platformer.c:582: if (obj->type == OBJ_TPLAT)  continue; /* drawn by draw_tp() */
	ld	a, -3 (ix)
	sub	a, #0x0f
	jp	Z,00129$
;pocket_platformer.c:583: if (obj->type == OBJ_RFBALL) continue; /* drawn by draw_rfball() */
	ld	a, -3 (ix)
	sub	a, #0x10
	jp	Z,00129$
;pocket_platformer.c:584: if (obj->type == OBJ_COIN && coin_collected[i]) continue;
	ld	a, -3 (ix)
	sub	a, #0x05
	jr	NZ, 00114$
	ld	hl, #_coin_collected
	ld	b, #0x00
	add	hl, bc
	ld	a, (hl)
	or	a, a
	jp	NZ, 00129$
00114$:
;pocket_platformer.c:586: if (obj->type == 7 || obj->type == 8 || obj->type == 9) continue;
	ld	a, -3 (ix)
	sub	a, #0x07
	jp	Z,00129$
	ld	a, -3 (ix)
	sub	a, #0x08
	jp	Z,00129$
	ld	a, -3 (ix)
	sub	a, #0x09
	jp	Z,00129$
;pocket_platformer.c:587: if (obj->type == 10 || obj->type == 11) continue;
	ld	a, -3 (ix)
	sub	a, #0x0a
	jr	Z, 00129$
	ld	a, -3 (ix)
	sub	a, #0x0b
	jr	Z, 00129$
;pocket_platformer.c:588: sx = (int)obj->x * TILE_SIZE - (int)camera_x;
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
;pocket_platformer.c:589: sy = (int)obj->y * TILE_SIZE;
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
;pocket_platformer.c:590: if (sx < -8 || sx > SCREEN_PX_W) continue;
	ld	a, e
	sub	a, #0xf8
	ld	a, d
	rla
	ccf
	rra
	sbc	a, #0x7f
	jr	C, 00129$
	xor	a, a
	cp	a, e
	ld	a, #0x01
	sbc	a, d
	jp	PO, 00239$
	xor	a, #0x80
00239$:
	jp	M, 00129$
;pocket_platformer.c:591: if (sy < 0  || sy > SCREEN_PX_H) continue;
	bit	7, h
	jr	NZ, 00129$
	ld	a, #0xc0
	cp	a, l
	ld	a, #0x00
	sbc	a, h
	jp	PO, 00240$
	xor	a, #0x80
00240$:
	jp	M, 00129$
;pocket_platformer.c:592: SMS_addSprite((unsigned char)sx, (unsigned char)sy,
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
00129$:
;pocket_platformer.c:575: for (i = 0; i < cur_level->obj_count; i++) {
	inc	c
	jp	00132$
00133$:
;pocket_platformer.c:595: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:602: static void draw_barrels(void) {
;	---------------------------------
; Function draw_barrels
; ---------------------------------
_draw_barrels:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	dec	sp
;pocket_platformer.c:605: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:606: n = cur_level->obj_count < MAX_OBJECTS ? cur_level->obj_count : MAX_OBJECTS;
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	a, (hl)
	cp	a, #0x80
	jr	NC, 00120$
	ld	c, a
	jr	00121$
00120$:
	ld	bc, #0x0080
00121$:
;pocket_platformer.c:607: for (i = 0; i < n; i++) {
	ld	b, #0x00
00117$:
	ld	a, b
	sub	a, c
	jp	NC, 00118$
;pocket_platformer.c:608: level_object *obj = &cur_objects[i];
	ld	e, b
	ld	d, #0x00
	ld	l, e
	ld	h, d
	add	hl, hl
	add	hl, de
	ex	de, hl
	ld	iy, (_cur_objects)
	add	iy, de
	push	iy
	pop	de
;pocket_platformer.c:611: if (obj->type != OBJ_BARREL) continue;
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	ld	a, (hl)
	sub	a, #0x0e
	jp	NZ,00114$
;pocket_platformer.c:612: raw_y = obj->y & 0x3F;
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a, (hl)
	ld	-3 (ix), a
	and	a, #0x3f
	ld	-1 (ix), a
;pocket_platformer.c:613: sx = (int)obj->x * TILE_SIZE - (int)camera_x;
	ld	a, (de)
	ld	l, a
;	spillPairReg hl
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
;pocket_platformer.c:614: sy = (int)raw_y  * TILE_SIZE;
	ld	l, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	-2 (ix), l
	ld	-1 (ix), h
;pocket_platformer.c:615: if (sx < -8 || sx > SCREEN_PX_W) continue;
	ld	a, e
	sub	a, #0xf8
	ld	a, d
	rla
	ccf
	rra
	sbc	a, #0x7f
	jr	C, 00114$
	xor	a, a
	cp	a, e
	ld	a, #0x01
	sbc	a, d
	jp	PO, 00180$
	xor	a, #0x80
00180$:
	jp	M, 00114$
;pocket_platformer.c:616: if (sy < 0  || sy > SCREEN_PX_H) continue;
	bit	7, -1 (ix)
	jr	NZ, 00114$
	ld	a, #0xc0
	cp	a, -2 (ix)
	ld	a, #0x00
	sbc	a, -1 (ix)
	jp	PO, 00181$
	xor	a, #0x80
00181$:
	jp	M, 00114$
;pocket_platformer.c:618: unsigned char dir = obj->y >> 6;
	ld	a, -3 (ix)
	rlca
	rlca
	and	a, #0x03
;pocket_platformer.c:620: switch (dir) {
	cp	a, #0x01
	jr	Z, 00110$
	cp	a, #0x02
	jr	Z, 00109$
	sub	a, #0x03
	jr	Z, 00111$
	jr	00112$
;pocket_platformer.c:621: case BARREL_DIR_LEFT:   btile = VRAM_SPR_BARREL_LEFT;   break;
00109$:
	ld	hl, #0x010c
	jr	00113$
;pocket_platformer.c:622: case BARREL_DIR_TOP:    btile = VRAM_SPR_BARREL_TOP;    break;
00110$:
	ld	hl, #0x010d
	jr	00113$
;pocket_platformer.c:623: case BARREL_DIR_BOTTOM: btile = VRAM_SPR_BARREL_BOTTOM; break;
00111$:
	ld	hl, #0x010e
	jr	00113$
;pocket_platformer.c:624: default:                btile = VRAM_SPR_BARREL_RIGHT;  break;
00112$:
	ld	hl, #0x010b
;pocket_platformer.c:625: }
00113$:
;pocket_platformer.c:626: SMS_addSprite((unsigned char)sx, (unsigned char)sy,
	ld	d, e
	ld	e, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	a, l
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
	or	a, e
	ld	e, a
	ld	a, l
	or	a, d
	ld	d, a
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	call	_SMS_addSprite_f
	pop	bc
00114$:
;pocket_platformer.c:607: for (i = 0; i < n; i++) {
	inc	b
	jp	00117$
00118$:
;pocket_platformer.c:630: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:632: static void draw_npcs(void) {
;	---------------------------------
; Function draw_npcs
; ---------------------------------
_draw_npcs:
;pocket_platformer.c:635: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:636: n = cur_level->obj_count < MAX_OBJECTS
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	a, (hl)
	cp	a, #0x80
	jr	NC, 00115$
;pocket_platformer.c:637: ? cur_level->obj_count : MAX_OBJECTS;
	ld	c, a
	jr	00116$
00115$:
	ld	bc, #0x0080
00116$:
;pocket_platformer.c:638: for (i = 0; i < n; i++) {
	ld	b, #0x00
00112$:
	ld	a, b
	sub	a, c
	ret	NC
;pocket_platformer.c:639: level_object *obj = &cur_objects[i];
	ld	e, b
	ld	d, #0x00
	ld	l, e
	ld	h, d
	add	hl, hl
	add	hl, de
	ex	de, hl
	ld	iy, (_cur_objects)
	add	iy, de
;pocket_platformer.c:641: if (obj->type != OBJ_NPC) continue;
	push	iy
	pop	de
	inc	de
	inc	de
	ld	a, (de)
	sub	a, #0x0d
	jr	NZ, 00109$
;pocket_platformer.c:642: sx = (int)obj->x * TILE_SIZE - (int)camera_x;
	ld	l, 0 (iy)
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
;pocket_platformer.c:643: sy = (int)obj->y * TILE_SIZE;
	push	iy
	ex	de, hl
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
;pocket_platformer.c:644: if (sx < -8 || sx > SCREEN_PX_W) continue;
	ld	a, e
	sub	a, #0xf8
	ld	a, d
	rla
	ccf
	rra
	sbc	a, #0x7f
	jr	C, 00109$
	xor	a, a
	cp	a, e
	ld	a, #0x01
	sbc	a, d
	jp	PO, 00160$
	xor	a, #0x80
00160$:
	jp	M, 00109$
;pocket_platformer.c:645: if (sy < 0  || sy > SCREEN_PX_H) continue;
	bit	7, h
	jr	NZ, 00109$
	ld	a, #0xc0
	cp	a, l
	ld	a, #0x00
	sbc	a, h
	jp	PO, 00161$
	xor	a, #0x80
00161$:
	jp	M, 00109$
;pocket_platformer.c:646: SMS_addSprite((unsigned char)sx, (unsigned char)sy,
	ld	d, e
	xor	a, a
	or	a, #0x0a
	ld	e, a
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	call	_SMS_addSprite_f
	pop	bc
00109$:
;pocket_platformer.c:638: for (i = 0; i < n; i++) {
	inc	b
;pocket_platformer.c:649: }
	jr	00112$
;pocket_platformer.c:651: static void draw_player(void) {
;	---------------------------------
; Function draw_player
; ---------------------------------
_draw_player:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-7
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:652: int sx = (int)(player.x >> 8) - (int)camera_x;
	ld	hl, (#_player + 0)
	ld	de, (#_player + 2)
	ld	a, h
	ld	hl, (_camera_x)
	sub	a, l
	ld	c, a
	ld	a, e
	sbc	a, h
	ld	-6 (ix), c
	ld	-5 (ix), a
;pocket_platformer.c:653: int sy = (int)(player.y >> 8);
	ld	bc, (#_player + 4)
	ld	hl, (#_player + 6)
	ld	-4 (ix), b
	ld	-3 (ix), l
;pocket_platformer.c:655: if (sx < -8 || sx > SCREEN_PX_W) return;
	ld	a, -6 (ix)
	sub	a, #0xf8
	ld	a, -5 (ix)
	rla
	ccf
	rra
	sbc	a, #0x7f
	jp	C,00110$
	xor	a, a
	cp	a, -6 (ix)
	ld	a, #0x01
	sbc	a, -5 (ix)
	jp	PO, 00162$
	xor	a, #0x80
00162$:
	jp	P, 00102$
	jp	00110$
00102$:
;pocket_platformer.c:656: if (!player.on_ground)
	ld	hl, #_player + 16
	ld	c, (hl)
;pocket_platformer.c:657: tile = player.facing_left ? VRAM_SPR_PLAYER_JUMP_L  : VRAM_SPR_PLAYER_JUMP;
	ld	a, (#_player + 23)
	ld	-7 (ix), a
;pocket_platformer.c:656: if (!player.on_ground)
	ld	a, c
	or	a, a
	jr	NZ, 00108$
;pocket_platformer.c:657: tile = player.facing_left ? VRAM_SPR_PLAYER_JUMP_L  : VRAM_SPR_PLAYER_JUMP;
	ld	a, -7 (ix)
	or	a, a
	jr	Z, 00112$
	ld	bc, #0x0113
	jr	00113$
00112$:
	ld	bc, #0x0108
00113$:
	ld	-2 (ix), c
	ld	-1 (ix), b
	jr	00109$
00108$:
;pocket_platformer.c:658: else if (player.vx != 0)
	ld	bc, (#_player + 8)
	ld	hl, (#_player + 10)
	ld	a, h
	or	a, l
	or	a, b
	or	a, c
	jr	Z, 00105$
;pocket_platformer.c:660: ? ((player.anim_frame & 2) ? VRAM_SPR_PLAYER_WALK1_L : VRAM_SPR_PLAYER_WALK0_L)
	ld	a, (#_player + 25)
	and	a, #0x02
	ld	-2 (ix), a
	ld	-1 (ix), #0x00
;pocket_platformer.c:659: tile = player.facing_left
	ld	a, -7 (ix)
	or	a, a
	jr	Z, 00114$
;pocket_platformer.c:660: ? ((player.anim_frame & 2) ? VRAM_SPR_PLAYER_WALK1_L : VRAM_SPR_PLAYER_WALK0_L)
	ld	a, -1 (ix)
	or	a, -2 (ix)
	jr	Z, 00116$
	ld	-2 (ix), #0x12
	ld	-1 (ix), #0x01
	jr	00109$
00116$:
	ld	-2 (ix), #0x11
	ld	-1 (ix), #0x01
	jr	00109$
00114$:
;pocket_platformer.c:661: : ((player.anim_frame & 2) ? VRAM_SPR_PLAYER_WALK1   : VRAM_SPR_PLAYER_WALK0);
	ld	a, -1 (ix)
	or	a, -2 (ix)
	jr	Z, 00118$
	ld	-2 (ix), #0x07
	ld	-1 (ix), #0x01
	jr	00109$
00118$:
	ld	-2 (ix), #0x06
	ld	-1 (ix), #0x01
	jr	00109$
00105$:
;pocket_platformer.c:663: tile = player.facing_left ? VRAM_SPR_PLAYER_IDLE_L : VRAM_SPR_PLAYER_IDLE;
	ld	a, -7 (ix)
	or	a, a
	jr	Z, 00120$
	ld	-2 (ix), #0x10
	ld	-1 (ix), #0x01
	jr	00121$
00120$:
	ld	-2 (ix), #0x05
	ld	-1 (ix), #0x01
00121$:
00109$:
;pocket_platformer.c:664: SMS_addSprite((unsigned char)sx, (unsigned char)sy, (unsigned char)tile);
	ld	b, -6 (ix)
	ld	c, #0x00
	ld	a, -2 (ix)
	ld	d, #0x00
	or	a, c
	ld	e, a
	ld	a, d
	or	a, b
	ld	d, a
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_addSprite_f
00110$:
;pocket_platformer.c:665: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:676: static unsigned char *get_npc_table(void) {
;	---------------------------------
; Function get_npc_table
; ---------------------------------
_get_npc_table:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-9
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:677: level_header *lh = res_levels;
	ld	hl, (_res_levels)
	ld	-3 (ix), l
	ld	-2 (ix), h
;pocket_platformer.c:679: for (i = 0; i < res_header->level_count; i++) {
	ld	-1 (ix), #0x00
00103$:
	ld	hl, (_res_header)
	ld	de, #0x0004
	add	hl, de
	ld	c, (hl)
;pocket_platformer.c:683: lh = (level_header *)((unsigned char *)lh + sz);
	ld	a, -3 (ix)
	ld	-9 (ix), a
	ld	a, -2 (ix)
	ld	-8 (ix), a
;pocket_platformer.c:679: for (i = 0; i < res_header->level_count; i++) {
	ld	a, -1 (ix)
	sub	a, c
	jr	NC, 00101$
;pocket_platformer.c:680: unsigned int sz = sizeof(level_header)
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	c, (hl)
	ld	b, #0x00
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -2 (ix)
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
	ld	-7 (ix), l
	ld	-6 (ix), h
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	inc	hl
	inc	hl
	ld	a, (hl)
	ld	-2 (ix), a
	ld	-3 (ix), a
	ld	-2 (ix), #0x00
	ld	c, a
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	-5 (ix), l
	ld	-4 (ix), h
	ld	a, -5 (ix)
	add	a, -7 (ix)
	ld	-3 (ix), a
	ld	a, -4 (ix)
	adc	a, -6 (ix)
	ld	-2 (ix), a
	ld	a, -3 (ix)
	ld	-6 (ix), a
	ld	a, -2 (ix)
	ld	-5 (ix), a
;pocket_platformer.c:683: lh = (level_header *)((unsigned char *)lh + sz);
	ld	a, -6 (ix)
	add	a, -9 (ix)
	ld	-3 (ix), a
	ld	a, -5 (ix)
	adc	a, -8 (ix)
	ld	-2 (ix), a
;pocket_platformer.c:679: for (i = 0; i < res_header->level_count; i++) {
	inc	-1 (ix)
	jp	00103$
00101$:
;pocket_platformer.c:685: return (unsigned char *)lh;
	pop	de
	push	de
;pocket_platformer.c:686: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:689: static void load_npc_dialogue(unsigned char level_n, unsigned char npc_idx) {
;	---------------------------------
; Function load_npc_dialogue
; ---------------------------------
_load_npc_dialogue:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	iy, #-10
	add	iy, sp
	ld	sp, iy
	ld	-4 (ix), a
	ld	-5 (ix), l
;pocket_platformer.c:690: unsigned char *p = get_npc_table();
	call	_get_npc_table
;pocket_platformer.c:693: for (li = 0; li < level_n; li++) {
	ld	-3 (ix), #0x00
00119$:
;pocket_platformer.c:694: unsigned char cnt = *p++;
	ld	c, e
	ld	b, d
	inc	bc
	ld	a, (de)
	ld	-1 (ix), a
;pocket_platformer.c:693: for (li = 0; li < level_n; li++) {
	ld	a, -3 (ix)
	sub	a, -4 (ix)
	jr	NC, 00103$
;pocket_platformer.c:694: unsigned char cnt = *p++;
	ld	e, c
	ld	d, b
	ld	a, -1 (ix)
	ld	-10 (ix), a
;pocket_platformer.c:695: for (ni = 0; ni < cnt; ni++) {
	ld	-2 (ix), #0x00
00116$:
	ld	a, -2 (ix)
	sub	a, -10 (ix)
	jr	NC, 00120$
;pocket_platformer.c:697: p++;            /* play_automatically */
	inc	de
;pocket_platformer.c:698: lines = *p++;
	ld	a, (de)
	ld	-9 (ix), a
	inc	de
;pocket_platformer.c:699: for (ll = 0; ll < lines; ll++) {
	ld	-1 (ix), #0x00
00113$:
	ld	a, -1 (ix)
	sub	a, -9 (ix)
	jr	NC, 00117$
;pocket_platformer.c:700: unsigned char ln = *p++;
	ld	a, (de)
	ld	-8 (ix), a
	inc	de
	ld	-7 (ix), e
	ld	-6 (ix), d
;pocket_platformer.c:701: p += ln;
	ld	a, -7 (ix)
	add	a, -8 (ix)
	ld	e, a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	d, a
;pocket_platformer.c:699: for (ll = 0; ll < lines; ll++) {
	inc	-1 (ix)
	jr	00113$
00117$:
;pocket_platformer.c:695: for (ni = 0; ni < cnt; ni++) {
	inc	-2 (ix)
	jr	00116$
00120$:
;pocket_platformer.c:693: for (li = 0; li < level_n; li++) {
	inc	-3 (ix)
	jr	00119$
00103$:
;pocket_platformer.c:707: unsigned char cnt = *p++;
	ld	e, c
	ld	d, b
	ld	a, -1 (ix)
	ld	-8 (ix), a
;pocket_platformer.c:708: for (ni = 0; ni < cnt && ni < npc_idx; ni++) {
	ld	c, #0x00
00126$:
;pocket_platformer.c:694: unsigned char cnt = *p++;
	inc	de
	ld	-2 (ix), e
	ld	-1 (ix), d
;pocket_platformer.c:708: for (ni = 0; ni < cnt && ni < npc_idx; ni++) {
	ld	a, c
	sub	a, -8 (ix)
	jr	NC, 00105$
	ld	a, c
	sub	a, -5 (ix)
	jr	NC, 00105$
;pocket_platformer.c:710: p++;
	ld	e, -2 (ix)
	ld	d, -1 (ix)
;pocket_platformer.c:711: lines = *p++;
	ld	a, (de)
	ld	-7 (ix), a
	inc	de
;pocket_platformer.c:712: for (ll = 0; ll < lines; ll++) {
	ld	-1 (ix), #0x00
00122$:
	ld	a, -1 (ix)
	sub	a, -7 (ix)
	jr	NC, 00127$
;pocket_platformer.c:713: unsigned char ln = *p++;
	ld	a, (de)
	ld	-6 (ix), a
	inc	de
	ld	-3 (ix), e
	ld	-2 (ix), d
;pocket_platformer.c:714: p += ln;
	ld	a, -3 (ix)
	add	a, -6 (ix)
	ld	e, a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	d, a
;pocket_platformer.c:712: for (ll = 0; ll < lines; ll++) {
	inc	-1 (ix)
	jr	00122$
00127$:
;pocket_platformer.c:708: for (ni = 0; ni < cnt && ni < npc_idx; ni++) {
	inc	c
	jr	00126$
00105$:
;pocket_platformer.c:719: p++; /* skip play_automatically (already used to decide when to trigger) */
	ld	e, -2 (ix)
	ld	d, -1 (ix)
;pocket_platformer.c:721: unsigned char line_count = *p++;
	ld	a, (de)
	ld	c, a
	inc	de
;pocket_platformer.c:723: if (line_count > DIALOGUE_MAX_LINES) line_count = DIALOGUE_MAX_LINES;
	ld	a, #0x20
	sub	a, c
	jr	NC, 00107$
	ld	c, #0x20
00107$:
;pocket_platformer.c:724: dialogue_total = line_count;
	ld	hl, #_dialogue_total
	ld	(hl), c
;pocket_platformer.c:725: for (ll = 0; ll < line_count; ll++) {
	ld	b, #0x00
00132$:
	ld	a, b
	sub	a, c
	jr	NC, 00134$
;pocket_platformer.c:726: unsigned char ln = *p++;
	ld	a, (de)
	ld	-8 (ix), a
	inc	de
;pocket_platformer.c:728: if (ln > DIALOGUE_TEXT_W) ln = DIALOGUE_TEXT_W;
	ld	a, #0x1c
	sub	a, -8 (ix)
	jr	NC, 00154$
	ld	-8 (ix), #0x1c
;pocket_platformer.c:729: for (cc = 0; cc < ln; cc++)
00154$:
	push	de
	ld	e, b
	ld	d, #0x00
	ld	l, e
	ld	h, d
	add	hl, hl
	add	hl, de
	add	hl, hl
	add	hl, de
	add	hl, hl
	add	hl, hl
	add	hl, de
	pop	de
	ld	-7 (ix), l
	ld	-6 (ix), h
	ld	a, #<(_dialogue_buf)
	add	a, -7 (ix)
	ld	-3 (ix), a
	ld	a, #>(_dialogue_buf)
	adc	a, -6 (ix)
	ld	-2 (ix), a
	ld	-1 (ix), #0x00
00129$:
	ld	a, -1 (ix)
	sub	a, -8 (ix)
	jr	NC, 00159$
;pocket_platformer.c:730: dialogue_buf[ll][cc] = *p++;
	ld	a, -3 (ix)
	add	a, -1 (ix)
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, (de)
	inc	de
	ld	(hl), a
;pocket_platformer.c:729: for (cc = 0; cc < ln; cc++)
	inc	-1 (ix)
	jr	00129$
00159$:
;pocket_platformer.c:731: dialogue_buf[ll][ln] = '\0';
	ld	a, -7 (ix)
	add	a, #<(_dialogue_buf)
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -6 (ix)
	adc	a, #>(_dialogue_buf)
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, l
	add	a, -8 (ix)
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	jr	NC, 00251$
	inc	h
00251$:
	ld	(hl), #0x00
;pocket_platformer.c:725: for (ll = 0; ll < line_count; ll++) {
	inc	b
	jr	00132$
00134$:
;pocket_platformer.c:735: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:738: static void save_dialogue_rows(void) {
;	---------------------------------
; Function save_dialogue_rows
; ---------------------------------
_save_dialogue_rows:
;pocket_platformer.c:741: unsigned int idx = 0;
	ld	bc, #0x0000
;pocket_platformer.c:742: for (row = DIALOGUE_BOX_ROW; row < DIALOGUE_BOX_ROW + DIALOGUE_ROWS; row++) {
	ld	e, #0x12
;pocket_platformer.c:743: for (col = 0; col < 32; col++) {
00110$:
	ld	d, #0x20
00105$:
;pocket_platformer.c:746: saved_nametable[idx++] = 0; /* can't easily read back; we'll redraw instead */
	ld	l, c
	ld	h, b
	add	hl, hl
	inc	bc
	push	de
	ld	de, #_saved_nametable
	add	hl, de
	pop	de
	xor	a, a
	ld	(hl), a
	inc	hl
	ld	(hl), a
;pocket_platformer.c:743: for (col = 0; col < 32; col++) {
	dec	d
	jr	NZ, 00105$
;pocket_platformer.c:742: for (row = DIALOGUE_BOX_ROW; row < DIALOGUE_BOX_ROW + DIALOGUE_ROWS; row++) {
	inc	e
	ld	a, e
	sub	a, #0x17
	jr	C, 00110$
;pocket_platformer.c:749: }
	ret
;pocket_platformer.c:752: static void restore_dialogue_rows(void) {
;	---------------------------------
; Function restore_dialogue_rows
; ---------------------------------
_restore_dialogue_rows:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	dec	sp
;pocket_platformer.c:754: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:755: for (row = DIALOGUE_BOX_ROW; row < DIALOGUE_BOX_ROW + DIALOGUE_ROWS; row++) {
	ld	c, #0x12
00108$:
;pocket_platformer.c:756: SMS_setNextTileatXY(0, row);
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
;pocket_platformer.c:757: for (col = 0; col < 32; col++) {
	ld	-1 (ix), #0x00
00106$:
;pocket_platformer.c:758: unsigned char map_x = (unsigned char)(camera_x / TILE_SIZE + col);
	ld	hl, (_camera_x)
	srl	h
	rr	l
	srl	h
	rr	l
	srl	h
	rr	l
	ld	a, l
	add	a, -1 (ix)
	ld	b, a
;pocket_platformer.c:760: unsigned char t = get_tile(map_x, map_y);
	push	bc
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, b
	call	_get_tile
	pop	bc
;pocket_platformer.c:762: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	ld	-3 (ix), a
	ld	-2 (ix), #0x00
;pocket_platformer.c:761: if (t & 0x80)
	bit	7, a
	jr	Z, 00102$
;pocket_platformer.c:762: SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	res	7, l
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	set	4, h
	rst	#0x18
	jr	00107$
00102$:
;pocket_platformer.c:764: SMS_setTile(t ? (unsigned int)(VRAM_BG_BASE + t - 1) : 0u);
	or	a, a
	jr	Z, 00112$
	pop	hl
	push	hl
	jr	00113$
00112$:
	ld	hl, #0x0000
00113$:
	rst	#0x18
00107$:
;pocket_platformer.c:757: for (col = 0; col < 32; col++) {
	inc	-1 (ix)
	ld	a, -1 (ix)
	sub	a, #0x20
	jr	C, 00106$
;pocket_platformer.c:755: for (row = DIALOGUE_BOX_ROW; row < DIALOGUE_BOX_ROW + DIALOGUE_ROWS; row++) {
	inc	c
	ld	a, c
	sub	a, #0x17
	jr	C, 00108$
;pocket_platformer.c:767: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:770: static void draw_dialogue_box(void) {
;	---------------------------------
; Function draw_dialogue_box
; ---------------------------------
_draw_dialogue_box:
;pocket_platformer.c:775: for (unsigned char row = DIALOGUE_BOX_ROW; row < DIALOGUE_BOX_ROW + DIALOGUE_ROWS; row++) {
	ld	b, #0x12
00106$:
	ld	a, b
	sub	a, #0x17
	ret	NC
;pocket_platformer.c:776: SMS_setNextTileatXY(0, row);
	ld	l, b
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
	rst	#0x08
;pocket_platformer.c:777: for (col = 0; col < 32; col++) SMS_setTile(blank);
	ld	c, #0x00
00103$:
	ld	hl, #0x0000
	rst	#0x18
	inc	c
	ld	a, c
	sub	a, #0x20
	jr	C, 00103$
;pocket_platformer.c:775: for (unsigned char row = DIALOGUE_BOX_ROW; row < DIALOGUE_BOX_ROW + DIALOGUE_ROWS; row++) {
	inc	b
;pocket_platformer.c:779: }
	jr	00106$
;pocket_platformer.c:782: static void open_dialogue(unsigned char level_n, unsigned char npc_idx) {
;	---------------------------------
; Function open_dialogue
; ---------------------------------
_open_dialogue:
	ld	c, a
;pocket_platformer.c:783: map_res_bank();
	ld	a, #0x02
	ld	(#_ROM_bank_to_be_mapped_on_slot2), a
;pocket_platformer.c:784: load_npc_dialogue(level_n, npc_idx);
	ld	a, c
	call	_load_npc_dialogue
;pocket_platformer.c:785: dialogue_active = 1;
	ld	hl, #_dialogue_active
	ld	(hl), #0x01
;pocket_platformer.c:786: dialogue_line   = 0;
	ld	hl, #_dialogue_line
	ld	(hl), #0x00
;pocket_platformer.c:787: dialogue_btn_prev = 0xFF; /* force release required first */
	ld	hl, #_dialogue_btn_prev
	ld	(hl), #0xff
;pocket_platformer.c:790: SMS_setBGPaletteColor(1, 0x3F);
	ld	l, #0x3f
;	spillPairReg hl
;	spillPairReg hl
	ld	a, #0x01
	call	_SMS_setBGPaletteColor
;pocket_platformer.c:791: draw_dialogue_box();
	call	_draw_dialogue_box
;pocket_platformer.c:792: render_dialogue();
;pocket_platformer.c:793: }
	jp	_render_dialogue
;pocket_platformer.c:796: static void render_dialogue(void) {
;	---------------------------------
; Function render_dialogue
; ---------------------------------
_render_dialogue:
;pocket_platformer.c:799: for (l = 0; l < 3; l++) {
	ld	c, #0x00
00120$:
;pocket_platformer.c:800: unsigned char row = DIALOGUE_BOX_ROW + 1 + l;
	ld	a, c
	add	a, #0x13
;pocket_platformer.c:801: SMS_setNextTileatXY(0, row);
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	l, a
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
;pocket_platformer.c:803: for (c = 0; c < 32; c++) SMS_setTile(0);
	ld	b, #0x00
00118$:
	ld	hl, #0x0000
	rst	#0x18
	inc	b
	ld	a, b
	sub	a, #0x20
	jr	C, 00118$
;pocket_platformer.c:799: for (l = 0; l < 3; l++) {
	inc	c
	ld	a, c
	sub	a, #0x03
	jr	C, 00120$
;pocket_platformer.c:806: for (l = 0; l < 2; l++) {
	ld	e, #0x00
00122$:
;pocket_platformer.c:807: unsigned char li = dialogue_line + l;
	ld	hl, #_dialogue_line
	ld	a, e
	add	a, (hl)
	ld	d, a
;pocket_platformer.c:808: if (li < dialogue_total)
	ld	hl, #_dialogue_total
	ld	a, d
	sub	a, (hl)
	jr	NC, 00123$
;pocket_platformer.c:809: SMS_printatXY(2, DIALOGUE_BOX_ROW + 1 + l, dialogue_buf[li]);
	ld	c, e
	ld	b, #0x00
	ld	hl, #0x0013
	add	hl, bc
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	inc	hl
	inc	hl
	add	hl, hl
	ld	a, h
	or	a, #0x78
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x08
	ld	c, d
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	add	hl, hl
	add	hl, bc
	add	hl, hl
	add	hl, hl
	add	hl, bc
	ld	bc, #_dialogue_buf
	add	hl, bc
	push	de
	call	_SMS_print
	pop	de
00123$:
;pocket_platformer.c:806: for (l = 0; l < 2; l++) {
	inc	e
	ld	a, e
	sub	a, #0x02
	jr	C, 00122$
;pocket_platformer.c:812: if (dialogue_line + 2 < dialogue_total)
	ld	a, (_dialogue_line+0)
	ld	b, #0x00
	ld	c, a
	inc	bc
	inc	bc
	ld	a, (_dialogue_total+0)
	ld	e, a
	ld	d, #0x00
	ld	a, c
	sub	a, e
	ld	a, b
	sbc	a, d
	jp	PO, 00169$
	xor	a, #0x80
00169$:
	jp	P, 00112$
;pocket_platformer.c:813: SMS_printatXY(2, DIALOGUE_BOX_ROW + 3, "1: next page");
	ld	hl, #0x7d44
	rst	#0x08
	ld	hl, #___str_0
	jp	_SMS_print
;pocket_platformer.c:815: SMS_printatXY(2, DIALOGUE_BOX_ROW + 3, "1: close");
00112$:
	ld	hl, #0x7d44
	rst	#0x08
	ld	hl, #___str_1
;pocket_platformer.c:816: }
	jp	_SMS_print
___str_0:
	.ascii "1: next page"
	.db 0x00
___str_1:
	.ascii "1: close"
	.db 0x00
;pocket_platformer.c:819: static void close_dialogue(void) {
;	---------------------------------
; Function close_dialogue
; ---------------------------------
_close_dialogue:
;pocket_platformer.c:820: dialogue_active = 0;
	ld	hl, #_dialogue_active
	ld	(hl), #0x00
;pocket_platformer.c:821: npc_contact_idx = 0xFF;
	ld	hl, #_npc_contact_idx
	ld	(hl), #0xff
;pocket_platformer.c:822: restore_dialogue_rows();
	call	_restore_dialogue_rows
;pocket_platformer.c:824: map_res_bank();
	ld	iy, #_ROM_bank_to_be_mapped_on_slot2
	ld	0 (iy), #0x02
;pocket_platformer.c:825: SMS_loadBGPalette(res_palette);
	ld	hl, (_res_palette)
;pocket_platformer.c:826: }
	jp	_SMS_loadBGPalette
;pocket_platformer.c:835: static unsigned char *get_tp_table(void) {
;	---------------------------------
; Function get_tp_table
; ---------------------------------
_get_tp_table:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	dec	sp
;pocket_platformer.c:836: unsigned char *p = get_npc_table();
	call	_get_npc_table
;pocket_platformer.c:839: for (li = 0; li < res_header->level_count; li++) {
	ld	c, #0x00
00111$:
	ld	hl, (_res_header)
	inc	hl
	inc	hl
	inc	hl
	inc	hl
	ld	b, (hl)
	ld	a, c
	sub	a, b
	jr	NC, 00103$
;pocket_platformer.c:840: unsigned char cnt = *p++;
	ld	a, (de)
	ld	-3 (ix), a
	inc	de
;pocket_platformer.c:842: for (ni = 0; ni < cnt; ni++) {
	ld	b, #0x00
00108$:
	ld	a, b
	sub	a, -3 (ix)
	jr	NC, 00112$
;pocket_platformer.c:844: p++; /* play_auto */
	inc	de
;pocket_platformer.c:845: lines = *p++;
	ld	a, (de)
	ld	-2 (ix), a
	inc	de
;pocket_platformer.c:846: for (ll = 0; ll < lines; ll++) { unsigned char ln = *p++; p += ln; }
	ld	-1 (ix), #0x00
00105$:
	ld	a, -1 (ix)
	sub	a, -2 (ix)
	jr	NC, 00109$
	ld	a, (de)
	inc	de
	add	a, e
	ld	e, a
	ld	a, #0x00
	adc	a, d
	ld	d, a
	inc	-1 (ix)
	jr	00105$
00109$:
;pocket_platformer.c:842: for (ni = 0; ni < cnt; ni++) {
	inc	b
	jr	00108$
00112$:
;pocket_platformer.c:839: for (li = 0; li < res_header->level_count; li++) {
	inc	c
	jr	00111$
00103$:
;pocket_platformer.c:849: return p;
;pocket_platformer.c:850: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:853: static void load_tp_level(unsigned char level_n) {
;	---------------------------------
; Function load_tp_level
; ---------------------------------
_load_tp_level:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-18
	add	hl, sp
	ld	sp, hl
	ld	-5 (ix), a
;pocket_platformer.c:854: unsigned char *p = get_tp_table();
	call	_get_tp_table
	ld	c, e
	ld	b, d
;pocket_platformer.c:857: for (li = 0; li < level_n; li++) {
	ld	-1 (ix), #0x00
00118$:
;pocket_platformer.c:858: unsigned char cnt = *p++;
	ld	e, c
	ld	d, b
	inc	de
	ld	a, (bc)
	ld	-2 (ix), a
;pocket_platformer.c:857: for (li = 0; li < level_n; li++) {
	ld	a, -1 (ix)
	sub	a, -5 (ix)
	jr	NC, 00102$
;pocket_platformer.c:858: unsigned char cnt = *p++;
	ld	c, -2 (ix)
;pocket_platformer.c:860: for (ti = 0; ti < cnt; ti++) { p += 3; } /* size, speed_idx, act_once */
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
00115$:
	ld	a, l
	sub	a, c
	jr	NC, 00141$
	inc	de
	inc	de
	inc	de
	inc	l
	jr	00115$
00141$:
	ld	c, e
	ld	b, d
;pocket_platformer.c:857: for (li = 0; li < level_n; li++) {
	inc	-1 (ix)
	jr	00118$
00102$:
;pocket_platformer.c:862: tp_count = *p++;
	ld	a, -2 (ix)
	ld	(_tp_count+0), a
;pocket_platformer.c:863: if (tp_count > MAX_TP) tp_count = MAX_TP;
	ld	a, #0x08
	ld	iy, #_tp_count
	sub	a, 0 (iy)
	jr	NC, 00140$
	ld	0 (iy), #0x08
;pocket_platformer.c:867: for (i = 0; i < cur_level->obj_count && obj_tp_idx < tp_count; i++) {
00140$:
	ld	-4 (ix), e
	ld	-3 (ix), d
	ld	-2 (ix), #0x00
	ld	-1 (ix), #0x00
00122$:
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	a,-1 (ix)
	sub	a,(hl)
	jp	NC, 00123$
	ld	hl, #_tp_count
	ld	a, -2 (ix)
	sub	a, (hl)
	jp	NC, 00123$
;pocket_platformer.c:868: level_object *obj = &cur_objects[i];
	ld	c, -1 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ex	de, hl
	ld	hl, (_cur_objects)
	add	hl, de
;pocket_platformer.c:869: if (obj->type != OBJ_TPLAT) continue;
	ld	-8 (ix), l
	ld	-7 (ix), h
	inc	hl
	inc	hl
	ld	c, l
	ld	b, h
	ld	a, (bc)
	sub	a, #0x0f
	jp	NZ,00112$
;pocket_platformer.c:871: unsigned char raw_y  = obj->y & 0x3F;
	ld	c, -8 (ix)
	ld	b, -7 (ix)
	inc	bc
	ld	a, (bc)
	push	af
	and	a, #0x3f
	ld	-6 (ix), a
	pop	af
;pocket_platformer.c:872: unsigned char dir    = obj->y >> 6;
	rlca
	rlca
	and	a, #0x03
	ld	-18 (ix), a
;pocket_platformer.c:873: unsigned char size   = p[0];
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	ld	-17 (ix), a
;pocket_platformer.c:874: unsigned char spd_i  = p[1] < 8 ? p[1] : 7;
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	inc	bc
	ld	a, (bc)
	cp	a, #0x08
	jr	NC, 00125$
	ld	-10 (ix), a
	ld	-9 (ix), #0x00
	jr	00126$
00125$:
	ld	-10 (ix), #0x07
	ld	-9 (ix), #0
00126$:
	ld	c, -10 (ix)
;pocket_platformer.c:875: unsigned char endless = p[2];
	ld	e, -4 (ix)
	ld	d, -3 (ix)
	inc	de
	inc	de
	ld	a, (de)
	ld	-16 (ix), a
;pocket_platformer.c:876: long ix = (long)obj->x * TILE_SIZE * FP_ONE;
	ld	l, -8 (ix)
	ld	h, -7 (ix)
	ld	e, (hl)
	ld	d, #0x00
	ld	hl, #0x0000
	ld	h, l
;	spillPairReg hl
;	spillPairReg hl
	ld	l, d
;	spillPairReg hl
;	spillPairReg hl
	ld	d, e
	ld	e, #0x00
	ld	b, #0x03
00202$:
	sla	d
	adc	hl, hl
	djnz	00202$
	ld	-15 (ix), e
	ld	-14 (ix), d
	ld	-13 (ix), l
	ld	-12 (ix), h
;pocket_platformer.c:877: long iy = (long)raw_y  * TILE_SIZE * FP_ONE;
	ld	e, -6 (ix)
	ld	d, #0x00
	ld	hl, #0x0000
	ld	h, l
;	spillPairReg hl
;	spillPairReg hl
	ld	l, d
;	spillPairReg hl
;	spillPairReg hl
	ld	d, e
	ld	e, #0x00
	ld	b, #0x03
00204$:
	sla	d
	adc	hl, hl
	djnz	00204$
	ld	-11 (ix), e
	ld	-10 (ix), d
	ld	-9 (ix), l
	ld	-8 (ix), h
;pocket_platformer.c:878: int  spd = tp_speed_table[spd_i];
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	ld	de, #_tp_speed_table
	add	hl, de
	ld	a, (hl)
	ld	-7 (ix), a
	inc	hl
	ld	a, (hl)
	ld	-6 (ix), a
;pocket_platformer.c:879: tp[obj_tp_idx].init_x  = ix;
	ld	c, -2 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	add	hl, hl
	add	hl, hl
	add	hl, bc
	add	hl, hl
	ex	de, hl
	ld	hl, #_tp
	add	hl, de
	ex	de, hl
	ld	hl, #0x0008
	add	hl, de
	ex	de, hl
	push	hl
	ld	hl, #5
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	de
;pocket_platformer.c:880: tp[obj_tp_idx].init_y  = iy;
	ld	hl, #0x000c
	add	hl, de
	ex	de, hl
	push	hl
	ld	hl, #9
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	de
;pocket_platformer.c:881: tp[obj_tp_idx].x       = ix;
	push	de
	ld	hl, #5
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	de
;pocket_platformer.c:882: tp[obj_tp_idx].y       = iy;
	ld	hl, #0x0004
	add	hl, de
	ex	de, hl
	push	hl
	ld	hl, #9
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	de
;pocket_platformer.c:883: tp[obj_tp_idx].width   = (unsigned char)(size * TILE_SIZE);
	ld	hl, #0x0014
	add	hl, de
	ld	a, -17 (ix)
	add	a, a
	add	a, a
	add	a, a
	ld	(hl), a
;pocket_platformer.c:884: tp[obj_tp_idx].endless = endless;
	ld	hl, #0x0016
	add	hl, de
	ld	a, -16 (ix)
	ld	(hl), a
;pocket_platformer.c:885: tp[obj_tp_idx].moving  = 0;
	ld	hl, #0x0015
	add	hl, de
	ld	(hl), #0x00
;pocket_platformer.c:886: tp[obj_tp_idx].oob_timer = 0;
	ld	hl, #0x0017
	add	hl, de
	ld	(hl), #0x00
;pocket_platformer.c:887: tp[obj_tp_idx].active  = 1;
	ld	hl, #0x0018
	add	hl, de
	ld	(hl), #0x01
;pocket_platformer.c:889: tp[obj_tp_idx].vx = 0;
	ld	hl, #0x0010
	add	hl, de
	ld	c,l
	ld	b,h
	xor	a, a
	ld	(hl), a
	inc	hl
	ld	(hl), a
;pocket_platformer.c:890: tp[obj_tp_idx].vy = 0;
	ld	hl, #0x0012
	add	hl, de
	ld	(hl), #0x00
	inc	hl
	ld	(hl), #0x00
	dec	hl
;pocket_platformer.c:891: switch (dir) {
	ld	a, -18 (ix)
	or	a, a
	jr	Z, 00107$
;pocket_platformer.c:893: case 1: tp[obj_tp_idx].vy = -spd; break; /* top */
	xor	a, a
	sub	a, -7 (ix)
	ld	-9 (ix), a
	sbc	a, a
	sub	a, -6 (ix)
	ld	-8 (ix), a
;pocket_platformer.c:891: switch (dir) {
	ld	a, -18 (ix)
	dec	a
	jr	Z, 00108$
	ld	a, -18 (ix)
	sub	a, #0x02
	jr	Z, 00109$
	ld	a, -18 (ix)
	sub	a, #0x03
	jr	Z, 00110$
	jr	00111$
;pocket_platformer.c:892: case 0: tp[obj_tp_idx].vx =  spd; break; /* right */
00107$:
	ld	a, -7 (ix)
	ld	(bc), a
	inc	bc
	ld	a, -6 (ix)
	ld	(bc), a
	jr	00111$
;pocket_platformer.c:893: case 1: tp[obj_tp_idx].vy = -spd; break; /* top */
00108$:
	ld	a, -9 (ix)
	ld	(hl), a
	inc	hl
	ld	a, -8 (ix)
	ld	(hl), a
	jr	00111$
;pocket_platformer.c:894: case 2: tp[obj_tp_idx].vx = -spd; break; /* left */
00109$:
	ld	a, -9 (ix)
	ld	(bc), a
	inc	bc
	ld	a, -8 (ix)
	ld	(bc), a
	jr	00111$
;pocket_platformer.c:895: case 3: tp[obj_tp_idx].vy =  spd; break; /* bottom */
00110$:
	ld	a, -7 (ix)
	ld	(hl), a
	inc	hl
	ld	a, -6 (ix)
	ld	(hl), a
;pocket_platformer.c:896: }
00111$:
;pocket_platformer.c:897: p += 3;
	ld	a, -4 (ix)
	add	a, #0x03
	ld	-4 (ix), a
	jr	NC, 00210$
	inc	-3 (ix)
00210$:
;pocket_platformer.c:898: obj_tp_idx++;
	inc	-2 (ix)
00112$:
;pocket_platformer.c:867: for (i = 0; i < cur_level->obj_count && obj_tp_idx < tp_count; i++) {
	inc	-1 (ix)
	jp	00122$
00123$:
;pocket_platformer.c:902: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:905: static void update_tp(void) {
;	---------------------------------
; Function update_tp
; ---------------------------------
_update_tp:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-47
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:907: long px = player.x >> 8, py = player.y >> 8;
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	b, #0x08
00228$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00228$
	ld	-4 (ix), e
	ld	-3 (ix), d
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	de, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	b, #0x08
00230$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00230$
;pocket_platformer.c:908: long player_bonus_x = 0, player_bonus_y = 0;
	xor	a, a
	ld	-47 (ix), a
	ld	-46 (ix), a
	ld	-45 (ix), a
	ld	-44 (ix), a
	xor	a, a
	ld	-43 (ix), a
	ld	-42 (ix), a
	ld	-41 (ix), a
	ld	-40 (ix), a
;pocket_platformer.c:910: for (i = 0; i < tp_count; i++) {
	ld	a, -4 (ix)
	add	a, #0x01
	ld	-39 (ix), a
	ld	a, -3 (ix)
	adc	a, #0x00
	ld	-38 (ix), a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	-37 (ix), a
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	-36 (ix), a
	ld	a, e
	add	a, #0x08
	ld	-35 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-34 (ix), a
	ld	a, l
	adc	a, #0x00
	ld	-33 (ix), a
	ld	a, h
	adc	a, #0x00
	ld	-32 (ix), a
	ld	a, -4 (ix)
	add	a, #0x06
	ld	-31 (ix), a
	ld	a, -3 (ix)
	adc	a, #0x00
	ld	-30 (ix), a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	-29 (ix), a
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	-28 (ix), a
	ld	-1 (ix), #0x00
00124$:
	ld	hl, #_tp_count
	ld	a, -1 (ix)
	sub	a, (hl)
	jp	NC, 00122$
;pocket_platformer.c:911: tp_state *t = &tp[i];
	ld	c, -1 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	add	hl, hl
	add	hl, hl
	add	hl, bc
	add	hl, hl
	ld	-5 (ix), l
	ld	-4 (ix), h
	ld	a, -5 (ix)
	add	a, #<(_tp)
	ld	-3 (ix), a
	ld	a, -4 (ix)
	adc	a, #>(_tp)
	ld	-2 (ix), a
	ld	a, -3 (ix)
	ld	-27 (ix), a
	ld	a, -2 (ix)
	ld	-26 (ix), a
;pocket_platformer.c:912: if (!t->active) continue;
	ld	a, -27 (ix)
	ld	-3 (ix), a
	ld	a, -26 (ix)
	ld	-2 (ix), a
	ld	l, -3 (ix)
	ld	h, -2 (ix)
	ld	de, #0x0018
	add	hl, de
	ld	a, (hl)
	or	a, a
	jp	Z, 00121$
;pocket_platformer.c:916: long plat_top  = t->y >> 8;
	ld	a, -27 (ix)
	add	a, #0x04
	ld	-25 (ix), a
	ld	a, -26 (ix)
	adc	a, #0x00
	ld	-24 (ix), a
	ld	l, -25 (ix)
	ld	h, -24 (ix)
	ld	e, (hl)
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
	ld	b, #0x08
00232$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00232$
	ld	-23 (ix), e
	ld	-22 (ix), d
	ld	-21 (ix), l
	ld	-20 (ix), h
;pocket_platformer.c:917: long plat_left = (t->x >> 8) - t->width / 2;
	ld	l, -27 (ix)
	ld	h, -26 (ix)
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	inc	hl
	ld	c, (hl)
	inc	hl
	ld	l, (hl)
;	spillPairReg hl
	ld	b, #0x08
00234$:
	sra	l
	rr	c
	rr	d
	rr	e
	djnz	00234$
	ld	-9 (ix), e
	ld	-8 (ix), d
	ld	-7 (ix), c
	ld	-6 (ix), l
	ld	a, -27 (ix)
	add	a, #0x14
	ld	-19 (ix), a
	ld	a, -26 (ix)
	adc	a, #0x00
	ld	-18 (ix), a
	ld	l, -19 (ix)
	ld	h, -18 (ix)
	ld	a, (hl)
	ld	-5 (ix), a
	ld	-4 (ix), #0x00
	ld	a, -5 (ix)
	ld	-3 (ix), a
	ld	a, -4 (ix)
	ld	-2 (ix), a
	bit	7, -4 (ix)
	jr	Z, 00127$
	ld	a, -5 (ix)
	add	a, #0x01
	ld	-3 (ix), a
	ld	a, -4 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
00127$:
	ld	c, -3 (ix)
	ld	b, -2 (ix)
	sra	b
	rr	c
	ld	a, b
	rlca
	sbc	hl, hl
	ld	a, -9 (ix)
	sub	a, c
	ld	c, a
	ld	a, -8 (ix)
	sbc	a, b
	ld	b, a
	ld	a, -7 (ix)
	sbc	a, l
	ld	e, a
	ld	a, -6 (ix)
	sbc	a, h
	ld	d, a
;pocket_platformer.c:918: long plat_right = plat_left + t->width;
	ld	a, -5 (ix)
	ld	-10 (ix), a
	ld	a, -4 (ix)
	ld	-9 (ix), a
	rlca
	sbc	a, a
	ld	-8 (ix), a
	ld	-7 (ix), a
	ld	a, -10 (ix)
	add	a, c
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -9 (ix)
	adc	a, b
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -8 (ix)
	adc	a, e
	push	iy
	ld	-49 (ix), a
	pop	iy
	ld	a, -7 (ix)
	adc	a, d
	ld	-17 (ix), l
	ld	-16 (ix), h
	push	iy
	ex	(sp), hl
	ld	-15 (ix), l
	ex	(sp), hl
	pop	iy
	ld	-14 (ix), a
;pocket_platformer.c:922: if (player.vy >= 0 &&
	push	de
	push	bc
	ld	de, #(_player + 12)
	ld	hl, #46
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
;pocket_platformer.c:926: if (!t->moving) t->moving = 1;
	ld	a, -27 (ix)
	add	a, #0x15
	ld	-13 (ix), a
	ld	a, -26 (ix)
	adc	a, #0x00
	ld	-12 (ix), a
;pocket_platformer.c:927: t->is_carrying = 1;
	ld	a, -27 (ix)
	add	a, #0x19
	ld	-11 (ix), a
	ld	a, -26 (ix)
	adc	a, #0x00
	ld	-10 (ix), a
;pocket_platformer.c:929: player_bonus_x = t->vx;
	ld	a, -27 (ix)
	add	a, #0x10
	ld	-9 (ix), a
	ld	a, -26 (ix)
	adc	a, #0x00
	ld	-8 (ix), a
;pocket_platformer.c:930: player_bonus_y = t->vy;
	ld	a, -27 (ix)
	add	a, #0x12
	ld	-7 (ix), a
	ld	a, -26 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
;pocket_platformer.c:922: if (player.vy >= 0 &&
	bit	7, -2 (ix)
	jp	NZ, 00106$
;pocket_platformer.c:923: player_bot >= plat_top && player_bot <= plat_top + 4 &&
	ld	a, -35 (ix)
	sub	a, -23 (ix)
	ld	a, -34 (ix)
	sbc	a, -22 (ix)
	ld	a, -33 (ix)
	sbc	a, -21 (ix)
	ld	a, -32 (ix)
	sbc	a, -20 (ix)
	jp	PO, 00236$
	xor	a, #0x80
00236$:
	jp	M, 00106$
	ld	a, -23 (ix)
	add	a, #0x04
	ld	-5 (ix), a
	ld	a, -22 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -21 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -20 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -5 (ix)
	sub	a, -35 (ix)
	ld	a, -4 (ix)
	sbc	a, -34 (ix)
	ld	a, -3 (ix)
	sbc	a, -33 (ix)
	ld	a, -2 (ix)
	sbc	a, -32 (ix)
	jp	PO, 00237$
	xor	a, #0x80
00237$:
	jp	M, 00106$
;pocket_platformer.c:924: px + 1 < plat_right && player_right - 1 > plat_left) {
	ld	a, -39 (ix)
	sub	a, -17 (ix)
	ld	a, -38 (ix)
	sbc	a, -16 (ix)
	ld	a, -37 (ix)
	sbc	a, -15 (ix)
	ld	a, -36 (ix)
	sbc	a, -14 (ix)
	jp	PO, 00238$
	xor	a, #0x80
00238$:
	jp	P, 00106$
	ld	a, -31 (ix)
	add	a, #0xff
	ld	-5 (ix), a
	ld	a, -30 (ix)
	adc	a, #0xff
	ld	-4 (ix), a
	ld	a, -29 (ix)
	adc	a, #0xff
	ld	-3 (ix), a
	ld	a, -28 (ix)
	adc	a, #0xff
	ld	-2 (ix), a
	ld	a, c
	sub	a, -5 (ix)
	ld	a, b
	sbc	a, -4 (ix)
	ld	a, e
	sbc	a, -3 (ix)
	ld	a, d
	sbc	a, -2 (ix)
	jp	PO, 00239$
	xor	a, #0x80
00239$:
	jp	P, 00106$
;pocket_platformer.c:926: if (!t->moving) t->moving = 1;
	ld	l, -13 (ix)
	ld	h, -12 (ix)
	ld	a, (hl)
	or	a, a
	jr	NZ, 00104$
	ld	l, -13 (ix)
	ld	h, -12 (ix)
	ld	(hl), #0x01
00104$:
;pocket_platformer.c:927: t->is_carrying = 1;
	ld	l, -11 (ix)
	ld	h, -10 (ix)
	ld	(hl), #0x01
;pocket_platformer.c:929: player_bonus_x = t->vx;
	ld	l, -9 (ix)
	ld	h, -8 (ix)
	ld	c, (hl)
	inc	hl
	ld	a, (hl)
	ld	-47 (ix), c
	ld	-46 (ix), a
	rlca
	sbc	a, a
	ld	-45 (ix), a
	ld	-44 (ix), a
;pocket_platformer.c:930: player_bonus_y = t->vy;
	ld	l, -7 (ix)
	ld	h, -6 (ix)
	ld	c, (hl)
	inc	hl
	ld	a, (hl)
	ld	-43 (ix), c
	ld	-42 (ix), a
	rlca
	sbc	a, a
	ld	-41 (ix), a
	ld	-40 (ix), a
;pocket_platformer.c:932: player.y = t->y - FP(PLAYER_H);
	ld	l, -25 (ix)
	ld	h, -24 (ix)
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
	inc	hl
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	ld	a,b
	add	a,#0xf8
	ld	b, a
	ld	a, e
	adc	a, #0xff
	ld	e, a
	ld	a, d
	adc	a, #0xff
	ld	d, a
	ld	((_player + 4)), bc
	ld	((_player + 4)+2), de
;pocket_platformer.c:933: player.vy = 0;
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
;pocket_platformer.c:934: player.on_ground = 1;
	ld	hl, #(_player + 16)
	ld	(hl), #0x01
;pocket_platformer.c:935: player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
;pocket_platformer.c:936: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:937: player.double_jump_used = 0;
	ld	hl, #(_player + 24)
	ld	(hl), #0x00
	jr	00107$
00106$:
;pocket_platformer.c:939: t->is_carrying = 0;
	ld	l, -11 (ix)
	ld	h, -10 (ix)
	ld	(hl), #0x00
00107$:
;pocket_platformer.c:944: if (t->moving) {
	ld	l, -13 (ix)
	ld	h, -12 (ix)
	ld	a, (hl)
	or	a, a
	jr	Z, 00113$
;pocket_platformer.c:945: t->x += t->vx;
	ld	e, -27 (ix)
	ld	d, -26 (ix)
	ld	hl, #42
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	l, -9 (ix)
	ld	h, -8 (ix)
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
	ld	a, b
	rlca
	sbc	hl, hl
	ld	a, -5 (ix)
	add	a, c
	ld	c, a
	ld	a, -4 (ix)
	adc	a, b
	ld	b, a
	ld	a, -3 (ix)
	adc	a, l
	ld	e, a
	ld	a, -2 (ix)
	adc	a, h
	ld	d, a
	ld	l, -27 (ix)
	ld	h, -26 (ix)
	ld	(hl), c
	inc	hl
	ld	(hl), b
	inc	hl
	ld	(hl), e
	inc	hl
	ld	(hl), d
;pocket_platformer.c:946: t->y += t->vy;
	ld	e, -25 (ix)
	ld	d, -24 (ix)
	ld	hl, #42
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	l, -7 (ix)
	ld	h, -6 (ix)
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
	ld	a, b
	rlca
	sbc	hl, hl
	ld	a, -5 (ix)
	add	a, c
	ld	c, a
	ld	a, -4 (ix)
	adc	a, b
	ld	b, a
	ld	a, -3 (ix)
	adc	a, l
	ld	e, a
	ld	a, -2 (ix)
	adc	a, h
	ld	d, a
	ld	l, -25 (ix)
	ld	h, -24 (ix)
	ld	(hl), c
	inc	hl
	ld	(hl), b
	inc	hl
	ld	(hl), e
	inc	hl
	ld	(hl), d
00113$:
;pocket_platformer.c:951: int tx = (int)(t->x >> 8);
	ld	l, -27 (ix)
	ld	h, -26 (ix)
	inc	hl
	ld	b, (hl)
	inc	hl
	ld	e, (hl)
	ld	c, b
	ld	b, e
;pocket_platformer.c:952: int ty = (int)(t->y >> 8);
	ld	l, -25 (ix)
	ld	h, -24 (ix)
	inc	hl
	ld	d, (hl)
	inc	hl
	ld	l, (hl)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	ld	-3 (ix), d
	ld	-2 (ix), l
;pocket_platformer.c:953: unsigned char oob = (tx + (int)t->width < -8 ||
	ld	l, -19 (ix)
	ld	h, -18 (ix)
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, bc
	ld	de, #0x7ff8
	add	hl, hl
	ccf
	rr	h
	rr	l
	sbc	hl, de
	jr	C, 00129$
	ld	a, #0x08
	cp	a, c
	ld	a, #0x01
	sbc	a, b
	jp	PO, 00240$
	xor	a, #0x80
00240$:
	jp	M, 00129$
	ld	a, -3 (ix)
	sub	a, #0x40
	ld	a, -2 (ix)
	rla
	ccf
	rra
	sbc	a, #0x7f
	jr	C, 00129$
	ld	a, #0x80
	cp	a, -3 (ix)
	ld	a, #0x01
	sbc	a, -2 (ix)
	jp	PO, 00241$
	xor	a, #0x80
00241$:
	jp	M, 00129$
	ld	e, #0x00
	jr	00130$
00129$:
	ld	e, #0x01
00130$:
;pocket_platformer.c:960: t->oob_timer++;
	ld	a, -27 (ix)
	add	a, #0x17
	ld	c, a
	ld	a, -26 (ix)
	adc	a, #0x00
	ld	b, a
;pocket_platformer.c:957: if (oob) {
	ld	a, e
	or	a, a
	jr	Z, 00119$
;pocket_platformer.c:958: t->is_carrying = 0;
	ld	l, -11 (ix)
	ld	h, -10 (ix)
	ld	(hl), #0x00
;pocket_platformer.c:959: if (t->moving) {
	ld	l, -13 (ix)
	ld	h, -12 (ix)
	ld	a, (hl)
	or	a, a
	jr	Z, 00121$
;pocket_platformer.c:960: t->oob_timer++;
	ld	a, (bc)
	inc	a
	ld	(bc), a
;pocket_platformer.c:961: if (t->oob_timer >= 100) {
	sub	a, #0x64
	jr	C, 00121$
;pocket_platformer.c:962: t->x = t->init_x;
	ld	e, -27 (ix)
	ld	d, -26 (ix)
	push	bc
	ld	hl, #44
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0008
	add	hl, bc
	ld	bc, #0x0004
	ldir
	ld	e, -27 (ix)
	ld	d, -26 (ix)
	ld	hl, #44
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
;pocket_platformer.c:963: t->y = t->init_y;
	ld	e, -27 (ix)
	ld	d, -26 (ix)
	push	bc
	ld	hl, #44
	add	hl, sp
	ex	de, hl
	ld	bc, #0x000c
	add	hl, bc
	ld	bc, #0x0004
	ldir
	ld	e, -25 (ix)
	ld	d, -24 (ix)
	ld	hl, #44
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
;pocket_platformer.c:964: t->moving  = 0;
	ld	l, -13 (ix)
	ld	h, -12 (ix)
	ld	(hl), #0x00
;pocket_platformer.c:965: t->oob_timer = 0;
	xor	a, a
	ld	(bc), a
	jr	00121$
00119$:
;pocket_platformer.c:969: t->oob_timer = 0;
	xor	a, a
	ld	(bc), a
00121$:
;pocket_platformer.c:910: for (i = 0; i < tp_count; i++) {
	inc	-1 (ix)
	jp	00124$
00122$:
;pocket_platformer.c:975: tp_carry_vx = player_bonus_x;
	ld	de, #_tp_carry_vx
	ld	hl, #0
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:976: tp_carry_vy = player_bonus_y;
	ld	de, #_tp_carry_vy
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:977: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:980: static void draw_tp(void) {
;	---------------------------------
; Function draw_tp
; ---------------------------------
_draw_tp:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-12
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:982: for (i = 0; i < tp_count; i++) {
	ld	-2 (ix), #0x00
00116$:
	ld	hl, #_tp_count
	ld	a, -2 (ix)
	sub	a, (hl)
	jp	NC, 00117$
;pocket_platformer.c:983: tp_state *t = &tp[i];
	ld	c, -2 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	add	hl, hl
	add	hl, hl
	add	hl, bc
	add	hl, hl
	ld	-6 (ix), l
	ld	-5 (ix), h
	ld	a, -6 (ix)
	add	a, #<(_tp)
	ld	-4 (ix), a
	ld	a, -5 (ix)
	adc	a, #>(_tp)
	ld	-3 (ix), a
;pocket_platformer.c:986: if (!t->active) continue;
	ld	a, -4 (ix)
	ld	-6 (ix), a
	ld	a, -3 (ix)
	ld	-5 (ix), a
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	de, #0x0018
	add	hl, de
	ld	a, (hl)
	or	a, a
	jp	Z, 00111$
;pocket_platformer.c:987: tx = (int)(t->x >> 8) - (int)camera_x;
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	inc	hl
	ld	b, (hl)
	inc	hl
	ld	e, (hl)
	ld	a, b
	ld	hl, (_camera_x)
	sub	a, l
	ld	c, a
	ld	a, e
	sbc	a, h
	ld	-12 (ix), c
	ld	-11 (ix), a
;pocket_platformer.c:988: ty = (int)(t->y >> 8);
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	ld	hl,#0x5
	add	hl,bc
	ld	b, (hl)
	inc	hl
	ld	e, (hl)
	ld	-10 (ix), b
	ld	-9 (ix), e
;pocket_platformer.c:989: segs = t->width / TILE_SIZE;
	ld	a, -4 (ix)
	add	a, #0x14
	ld	-8 (ix), a
	ld	a, -3 (ix)
	adc	a, #0x00
	ld	-7 (ix), a
	ld	l, -8 (ix)
	ld	h, -7 (ix)
	ld	a, (hl)
	ld	-6 (ix), a
	ld	-5 (ix), #0x00
	ld	a, -6 (ix)
	ld	-4 (ix), a
	ld	a, -5 (ix)
	ld	-3 (ix), a
	bit	7, -5 (ix)
	jr	Z, 00119$
	ld	a, -6 (ix)
	add	a, #0x07
	ld	-4 (ix), a
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
00119$:
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	sra	b
	rr	c
	sra	b
	rr	c
	sra	b
	rr	c
;pocket_platformer.c:991: for (seg = 0; seg < segs; seg++) {
	ld	a, #0xc0
	cp	a, -10 (ix)
	ld	a, #0x00
	sbc	a, -9 (ix)
	jp	PO, 00178$
	xor	a, #0x80
00178$:
	rlca
	and	a,#0x01
	ld	-6 (ix), a
	ld	a, -9 (ix)
	rlca
	and	a,#0x01
	ld	-5 (ix), a
	ld	-1 (ix), #0x00
00114$:
	ld	a, -1 (ix)
	sub	a, c
	jr	NC, 00111$
;pocket_platformer.c:992: int sx = tx - (int)(t->width / 2) + seg * TILE_SIZE;
	ld	l, -8 (ix)
	ld	h, -7 (ix)
	ld	e, (hl)
	ld	d, #0x00
	ld	-4 (ix), e
	ld	-3 (ix), d
	bit	7, d
	jr	Z, 00120$
	inc	de
	ld	-4 (ix), e
	ld	-3 (ix), d
00120$:
	ld	b, -4 (ix)
	ld	d, -3 (ix)
	sra	d
	rr	b
	ld	a, -12 (ix)
	sub	a, b
	ld	e, a
	ld	a, -11 (ix)
	sbc	a, d
	ld	d, a
	ld	l, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	add	hl, de
;pocket_platformer.c:993: if (sx < -8 || sx > SCREEN_PX_W) continue;
	ld	a, l
	sub	a, #0xf8
	ld	a, h
	rla
	ccf
	rra
	sbc	a, #0x7f
	jr	C, 00109$
	xor	a, a
	cp	a, l
	ld	a, #0x01
	sbc	a, h
	jp	PO, 00179$
	xor	a, #0x80
00179$:
	jp	M, 00109$
;pocket_platformer.c:994: if (ty < 0  || ty > SCREEN_PX_H)  continue;
	ld	a, -5 (ix)
	or	a, a
	jr	NZ, 00109$
	ld	a, -6 (ix)
	or	a, a
	jr	NZ, 00109$
;pocket_platformer.c:995: SMS_addSprite((unsigned char)sx, (unsigned char)ty,
;	spillPairReg hl
;	spillPairReg hl
	ld	d, l
	xor	a, a
	or	a, #0x0f
	ld	e, a
	ld	l, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	call	_SMS_addSprite_f
	pop	bc
00109$:
;pocket_platformer.c:991: for (seg = 0; seg < segs; seg++) {
	inc	-1 (ix)
	jr	00114$
00111$:
;pocket_platformer.c:982: for (i = 0; i < tp_count; i++) {
	inc	-2 (ix)
	jp	00116$
00117$:
;pocket_platformer.c:999: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1084: static unsigned char *get_rfball_table(void) {
;	---------------------------------
; Function get_rfball_table
; ---------------------------------
_get_rfball_table:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
;pocket_platformer.c:1086: unsigned char *p = get_tp_table();
	call	_get_tp_table
	inc	sp
	inc	sp
	push	de
;pocket_platformer.c:1088: for (li = 0; li < res_header->level_count; li++) {
	ld	c, #0x00
00107$:
	ld	hl, (_res_header)
	ld	de, #0x0004
	add	hl, de
	ld	b, (hl)
	ld	a, c
	sub	a, b
	jr	NC, 00102$
;pocket_platformer.c:1089: unsigned char cnt = *p++;
	pop	hl
	push	hl
	ld	l, (hl)
;	spillPairReg hl
	pop	de
	push	de
	inc	de
;pocket_platformer.c:1091: for (ti = 0; ti < cnt; ti++) p += 3; /* size, speed_idx, act_once */
	ld	b, #0x00
00104$:
	ld	a, b
	sub	a, l
	jr	NC, 00115$
	inc	de
	inc	de
	inc	de
	inc	b
	jr	00104$
00115$:
	inc	sp
	inc	sp
	push	de
;pocket_platformer.c:1088: for (li = 0; li < res_header->level_count; li++) {
	inc	c
	jr	00107$
00102$:
;pocket_platformer.c:1093: return p;
	pop	de
	push	de
;pocket_platformer.c:1094: }
	ld	sp, ix
	pop	ix
	ret
_sin_table:
	.db #0x00	;  0
	.db #0x02	;  2
	.db #0x04	;  4
	.db #0x07	;  7
	.db #0x09	;  9
	.db #0x0b	;  11
	.db #0x0d	;  13
	.db #0x0f	;  15
	.db #0x12	;  18
	.db #0x14	;  20
	.db #0x16	;  22
	.db #0x18	;  24
	.db #0x1a	;  26
	.db #0x1d	;  29
	.db #0x1f	;  31
	.db #0x21	;  33
	.db #0x23	;  35
	.db #0x25	;  37
	.db #0x27	;  39
	.db #0x29	;  41
	.db #0x2b	;  43
	.db #0x2e	;  46
	.db #0x30	;  48	'0'
	.db #0x32	;  50	'2'
	.db #0x34	;  52	'4'
	.db #0x36	;  54	'6'
	.db #0x38	;  56	'8'
	.db #0x3a	;  58
	.db #0x3c	;  60
	.db #0x3e	;  62
	.db #0x3f	;  63
	.db #0x41	;  65	'A'
	.db #0x43	;  67	'C'
	.db #0x45	;  69	'E'
	.db #0x47	;  71	'G'
	.db #0x49	;  73	'I'
	.db #0x4b	;  75	'K'
	.db #0x4c	;  76	'L'
	.db #0x4e	;  78	'N'
	.db #0x50	;  80	'P'
	.db #0x52	;  82	'R'
	.db #0x53	;  83	'S'
	.db #0x55	;  85	'U'
	.db #0x57	;  87	'W'
	.db #0x58	;  88	'X'
	.db #0x5a	;  90	'Z'
	.db #0x5b	;  91
	.db #0x5d	;  93
	.db #0x5e	;  94
	.db #0x60	;  96
	.db #0x61	;  97	'a'
	.db #0x63	;  99	'c'
	.db #0x64	;  100	'd'
	.db #0x65	;  101	'e'
	.db #0x67	;  103	'g'
	.db #0x68	;  104	'h'
	.db #0x69	;  105	'i'
	.db #0x6b	;  107	'k'
	.db #0x6c	;  108	'l'
	.db #0x6d	;  109	'm'
	.db #0x6e	;  110	'n'
	.db #0x6f	;  111	'o'
	.db #0x70	;  112	'p'
	.db #0x71	;  113	'q'
	.db #0x72	;  114	'r'
	.db #0x73	;  115	's'
	.db #0x74	;  116	't'
	.db #0x75	;  117	'u'
	.db #0x76	;  118	'v'
	.db #0x77	;  119	'w'
	.db #0x77	;  119	'w'
	.db #0x78	;  120	'x'
	.db #0x79	;  121	'y'
	.db #0x79	;  121	'y'
	.db #0x7a	;  122	'z'
	.db #0x7b	;  123
	.db #0x7b	;  123
	.db #0x7c	;  124
	.db #0x7c	;  124
	.db #0x7d	;  125
	.db #0x7d	;  125
	.db #0x7d	;  125
	.db #0x7e	;  126
	.db #0x7e	;  126
	.db #0x7e	;  126
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7e	;  126
	.db #0x7e	;  126
	.db #0x7e	;  126
	.db #0x7d	;  125
	.db #0x7d	;  125
	.db #0x7d	;  125
	.db #0x7c	;  124
	.db #0x7c	;  124
	.db #0x7b	;  123
	.db #0x7b	;  123
	.db #0x7a	;  122	'z'
	.db #0x79	;  121	'y'
	.db #0x79	;  121	'y'
	.db #0x78	;  120	'x'
	.db #0x77	;  119	'w'
	.db #0x77	;  119	'w'
	.db #0x76	;  118	'v'
	.db #0x75	;  117	'u'
	.db #0x74	;  116	't'
	.db #0x73	;  115	's'
	.db #0x72	;  114	'r'
	.db #0x71	;  113	'q'
	.db #0x70	;  112	'p'
	.db #0x6f	;  111	'o'
	.db #0x6e	;  110	'n'
	.db #0x6d	;  109	'm'
	.db #0x6c	;  108	'l'
	.db #0x6b	;  107	'k'
	.db #0x69	;  105	'i'
	.db #0x68	;  104	'h'
	.db #0x67	;  103	'g'
	.db #0x65	;  101	'e'
	.db #0x64	;  100	'd'
	.db #0x63	;  99	'c'
	.db #0x61	;  97	'a'
	.db #0x60	;  96
	.db #0x5e	;  94
	.db #0x5d	;  93
	.db #0x5b	;  91
	.db #0x5a	;  90	'Z'
	.db #0x58	;  88	'X'
	.db #0x57	;  87	'W'
	.db #0x55	;  85	'U'
	.db #0x53	;  83	'S'
	.db #0x52	;  82	'R'
	.db #0x50	;  80	'P'
	.db #0x4e	;  78	'N'
	.db #0x4c	;  76	'L'
	.db #0x4b	;  75	'K'
	.db #0x49	;  73	'I'
	.db #0x47	;  71	'G'
	.db #0x45	;  69	'E'
	.db #0x43	;  67	'C'
	.db #0x41	;  65	'A'
	.db #0x3f	;  63
	.db #0x3e	;  62
	.db #0x3c	;  60
	.db #0x3a	;  58
	.db #0x38	;  56	'8'
	.db #0x36	;  54	'6'
	.db #0x34	;  52	'4'
	.db #0x32	;  50	'2'
	.db #0x30	;  48	'0'
	.db #0x2e	;  46
	.db #0x2b	;  43
	.db #0x29	;  41
	.db #0x27	;  39
	.db #0x25	;  37
	.db #0x23	;  35
	.db #0x21	;  33
	.db #0x1f	;  31
	.db #0x1d	;  29
	.db #0x1a	;  26
	.db #0x18	;  24
	.db #0x16	;  22
	.db #0x14	;  20
	.db #0x12	;  18
	.db #0x0f	;  15
	.db #0x0d	;  13
	.db #0x0b	;  11
	.db #0x09	;  9
	.db #0x07	;  7
	.db #0x04	;  4
	.db #0x02	;  2
	.db #0x00	;  0
	.db #0xfe	; -2
	.db #0xfc	; -4
	.db #0xf9	; -7
	.db #0xf7	; -9
	.db #0xf5	; -11
	.db #0xf3	; -13
	.db #0xf1	; -15
	.db #0xee	; -18
	.db #0xec	; -20
	.db #0xea	; -22
	.db #0xe8	; -24
	.db #0xe6	; -26
	.db #0xe3	; -29
	.db #0xe1	; -31
	.db #0xdf	; -33
	.db #0xdd	; -35
	.db #0xdb	; -37
	.db #0xd9	; -39
	.db #0xd7	; -41
	.db #0xd5	; -43
	.db #0xd2	; -46
	.db #0xd0	; -48
	.db #0xce	; -50
	.db #0xcc	; -52
	.db #0xca	; -54
	.db #0xc8	; -56
	.db #0xc6	; -58
	.db #0xc4	; -60
	.db #0xc2	; -62
	.db #0xc0	; -64
	.db #0xbf	; -65
	.db #0xbd	; -67
	.db #0xbb	; -69
	.db #0xb9	; -71
	.db #0xb7	; -73
	.db #0xb5	; -75
	.db #0xb4	; -76
	.db #0xb2	; -78
	.db #0xb0	; -80
	.db #0xae	; -82
	.db #0xad	; -83
	.db #0xab	; -85
	.db #0xa9	; -87
	.db #0xa8	; -88
	.db #0xa6	; -90
	.db #0xa5	; -91
	.db #0xa3	; -93
	.db #0xa2	; -94
	.db #0xa0	; -96
	.db #0x9f	; -97
	.db #0x9d	; -99
	.db #0x9c	; -100
	.db #0x9b	; -101
	.db #0x99	; -103
	.db #0x98	; -104
	.db #0x97	; -105
	.db #0x95	; -107
	.db #0x94	; -108
	.db #0x93	; -109
	.db #0x92	; -110
	.db #0x91	; -111
	.db #0x90	; -112
	.db #0x8f	; -113
	.db #0x8e	; -114
	.db #0x8d	; -115
	.db #0x8c	; -116
	.db #0x8b	; -117
	.db #0x8a	; -118
	.db #0x89	; -119
	.db #0x89	; -119
	.db #0x88	; -120
	.db #0x87	; -121
	.db #0x87	; -121
	.db #0x86	; -122
	.db #0x85	; -123
	.db #0x85	; -123
	.db #0x84	; -124
	.db #0x84	; -124
	.db #0x83	; -125
	.db #0x83	; -125
	.db #0x83	; -125
	.db #0x82	; -126
	.db #0x82	; -126
	.db #0x82	; -126
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x82	; -126
	.db #0x82	; -126
	.db #0x82	; -126
	.db #0x83	; -125
	.db #0x83	; -125
	.db #0x83	; -125
	.db #0x84	; -124
	.db #0x84	; -124
	.db #0x85	; -123
	.db #0x85	; -123
	.db #0x86	; -122
	.db #0x87	; -121
	.db #0x87	; -121
	.db #0x88	; -120
	.db #0x89	; -119
	.db #0x89	; -119
	.db #0x8a	; -118
	.db #0x8b	; -117
	.db #0x8c	; -116
	.db #0x8d	; -115
	.db #0x8e	; -114
	.db #0x8f	; -113
	.db #0x90	; -112
	.db #0x91	; -111
	.db #0x92	; -110
	.db #0x93	; -109
	.db #0x94	; -108
	.db #0x95	; -107
	.db #0x97	; -105
	.db #0x98	; -104
	.db #0x99	; -103
	.db #0x9b	; -101
	.db #0x9c	; -100
	.db #0x9d	; -99
	.db #0x9f	; -97
	.db #0xa0	; -96
	.db #0xa2	; -94
	.db #0xa3	; -93
	.db #0xa5	; -91
	.db #0xa6	; -90
	.db #0xa8	; -88
	.db #0xa9	; -87
	.db #0xab	; -85
	.db #0xad	; -83
	.db #0xae	; -82
	.db #0xb0	; -80
	.db #0xb2	; -78
	.db #0xb4	; -76
	.db #0xb5	; -75
	.db #0xb7	; -73
	.db #0xb9	; -71
	.db #0xbb	; -69
	.db #0xbd	; -67
	.db #0xbf	; -65
	.db #0xc0	; -64
	.db #0xc2	; -62
	.db #0xc4	; -60
	.db #0xc6	; -58
	.db #0xc8	; -56
	.db #0xca	; -54
	.db #0xcc	; -52
	.db #0xce	; -50
	.db #0xd0	; -48
	.db #0xd2	; -46
	.db #0xd5	; -43
	.db #0xd7	; -41
	.db #0xd9	; -39
	.db #0xdb	; -37
	.db #0xdd	; -35
	.db #0xdf	; -33
	.db #0xe1	; -31
	.db #0xe3	; -29
	.db #0xe6	; -26
	.db #0xe8	; -24
	.db #0xea	; -22
	.db #0xec	; -20
	.db #0xee	; -18
	.db #0xf1	; -15
	.db #0xf3	; -13
	.db #0xf5	; -11
	.db #0xf7	; -9
	.db #0xf9	; -7
	.db #0xfc	; -4
	.db #0xfe	; -2
_cos_table:
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7e	;  126
	.db #0x7e	;  126
	.db #0x7e	;  126
	.db #0x7d	;  125
	.db #0x7d	;  125
	.db #0x7d	;  125
	.db #0x7c	;  124
	.db #0x7c	;  124
	.db #0x7b	;  123
	.db #0x7b	;  123
	.db #0x7a	;  122	'z'
	.db #0x79	;  121	'y'
	.db #0x79	;  121	'y'
	.db #0x78	;  120	'x'
	.db #0x77	;  119	'w'
	.db #0x77	;  119	'w'
	.db #0x76	;  118	'v'
	.db #0x75	;  117	'u'
	.db #0x74	;  116	't'
	.db #0x73	;  115	's'
	.db #0x72	;  114	'r'
	.db #0x71	;  113	'q'
	.db #0x70	;  112	'p'
	.db #0x6f	;  111	'o'
	.db #0x6e	;  110	'n'
	.db #0x6d	;  109	'm'
	.db #0x6c	;  108	'l'
	.db #0x6b	;  107	'k'
	.db #0x69	;  105	'i'
	.db #0x68	;  104	'h'
	.db #0x67	;  103	'g'
	.db #0x65	;  101	'e'
	.db #0x64	;  100	'd'
	.db #0x63	;  99	'c'
	.db #0x61	;  97	'a'
	.db #0x60	;  96
	.db #0x5e	;  94
	.db #0x5d	;  93
	.db #0x5b	;  91
	.db #0x5a	;  90	'Z'
	.db #0x58	;  88	'X'
	.db #0x57	;  87	'W'
	.db #0x55	;  85	'U'
	.db #0x53	;  83	'S'
	.db #0x52	;  82	'R'
	.db #0x50	;  80	'P'
	.db #0x4e	;  78	'N'
	.db #0x4c	;  76	'L'
	.db #0x4b	;  75	'K'
	.db #0x49	;  73	'I'
	.db #0x47	;  71	'G'
	.db #0x45	;  69	'E'
	.db #0x43	;  67	'C'
	.db #0x41	;  65	'A'
	.db #0x40	;  64
	.db #0x3e	;  62
	.db #0x3c	;  60
	.db #0x3a	;  58
	.db #0x38	;  56	'8'
	.db #0x36	;  54	'6'
	.db #0x34	;  52	'4'
	.db #0x32	;  50	'2'
	.db #0x30	;  48	'0'
	.db #0x2e	;  46
	.db #0x2b	;  43
	.db #0x29	;  41
	.db #0x27	;  39
	.db #0x25	;  37
	.db #0x23	;  35
	.db #0x21	;  33
	.db #0x1f	;  31
	.db #0x1d	;  29
	.db #0x1a	;  26
	.db #0x18	;  24
	.db #0x16	;  22
	.db #0x14	;  20
	.db #0x12	;  18
	.db #0x0f	;  15
	.db #0x0d	;  13
	.db #0x0b	;  11
	.db #0x09	;  9
	.db #0x07	;  7
	.db #0x04	;  4
	.db #0x02	;  2
	.db #0x00	;  0
	.db #0xfe	; -2
	.db #0xfc	; -4
	.db #0xf9	; -7
	.db #0xf7	; -9
	.db #0xf5	; -11
	.db #0xf3	; -13
	.db #0xf1	; -15
	.db #0xee	; -18
	.db #0xec	; -20
	.db #0xea	; -22
	.db #0xe8	; -24
	.db #0xe6	; -26
	.db #0xe3	; -29
	.db #0xe1	; -31
	.db #0xdf	; -33
	.db #0xdd	; -35
	.db #0xdb	; -37
	.db #0xd9	; -39
	.db #0xd7	; -41
	.db #0xd5	; -43
	.db #0xd2	; -46
	.db #0xd0	; -48
	.db #0xce	; -50
	.db #0xcc	; -52
	.db #0xca	; -54
	.db #0xc8	; -56
	.db #0xc6	; -58
	.db #0xc4	; -60
	.db #0xc2	; -62
	.db #0xc1	; -63
	.db #0xbf	; -65
	.db #0xbd	; -67
	.db #0xbb	; -69
	.db #0xb9	; -71
	.db #0xb7	; -73
	.db #0xb5	; -75
	.db #0xb4	; -76
	.db #0xb2	; -78
	.db #0xb0	; -80
	.db #0xae	; -82
	.db #0xad	; -83
	.db #0xab	; -85
	.db #0xa9	; -87
	.db #0xa8	; -88
	.db #0xa6	; -90
	.db #0xa5	; -91
	.db #0xa3	; -93
	.db #0xa2	; -94
	.db #0xa0	; -96
	.db #0x9f	; -97
	.db #0x9d	; -99
	.db #0x9c	; -100
	.db #0x9b	; -101
	.db #0x99	; -103
	.db #0x98	; -104
	.db #0x97	; -105
	.db #0x95	; -107
	.db #0x94	; -108
	.db #0x93	; -109
	.db #0x92	; -110
	.db #0x91	; -111
	.db #0x90	; -112
	.db #0x8f	; -113
	.db #0x8e	; -114
	.db #0x8d	; -115
	.db #0x8c	; -116
	.db #0x8b	; -117
	.db #0x8a	; -118
	.db #0x89	; -119
	.db #0x89	; -119
	.db #0x88	; -120
	.db #0x87	; -121
	.db #0x87	; -121
	.db #0x86	; -122
	.db #0x85	; -123
	.db #0x85	; -123
	.db #0x84	; -124
	.db #0x84	; -124
	.db #0x83	; -125
	.db #0x83	; -125
	.db #0x83	; -125
	.db #0x82	; -126
	.db #0x82	; -126
	.db #0x82	; -126
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x81	; -127
	.db #0x82	; -126
	.db #0x82	; -126
	.db #0x82	; -126
	.db #0x83	; -125
	.db #0x83	; -125
	.db #0x83	; -125
	.db #0x84	; -124
	.db #0x84	; -124
	.db #0x85	; -123
	.db #0x85	; -123
	.db #0x86	; -122
	.db #0x87	; -121
	.db #0x87	; -121
	.db #0x88	; -120
	.db #0x89	; -119
	.db #0x89	; -119
	.db #0x8a	; -118
	.db #0x8b	; -117
	.db #0x8c	; -116
	.db #0x8d	; -115
	.db #0x8e	; -114
	.db #0x8f	; -113
	.db #0x90	; -112
	.db #0x91	; -111
	.db #0x92	; -110
	.db #0x93	; -109
	.db #0x94	; -108
	.db #0x95	; -107
	.db #0x97	; -105
	.db #0x98	; -104
	.db #0x99	; -103
	.db #0x9b	; -101
	.db #0x9c	; -100
	.db #0x9d	; -99
	.db #0x9f	; -97
	.db #0xa0	; -96
	.db #0xa2	; -94
	.db #0xa3	; -93
	.db #0xa5	; -91
	.db #0xa6	; -90
	.db #0xa8	; -88
	.db #0xa9	; -87
	.db #0xab	; -85
	.db #0xad	; -83
	.db #0xae	; -82
	.db #0xb0	; -80
	.db #0xb2	; -78
	.db #0xb4	; -76
	.db #0xb5	; -75
	.db #0xb7	; -73
	.db #0xb9	; -71
	.db #0xbb	; -69
	.db #0xbd	; -67
	.db #0xbf	; -65
	.db #0xc0	; -64
	.db #0xc2	; -62
	.db #0xc4	; -60
	.db #0xc6	; -58
	.db #0xc8	; -56
	.db #0xca	; -54
	.db #0xcc	; -52
	.db #0xce	; -50
	.db #0xd0	; -48
	.db #0xd2	; -46
	.db #0xd5	; -43
	.db #0xd7	; -41
	.db #0xd9	; -39
	.db #0xdb	; -37
	.db #0xdd	; -35
	.db #0xdf	; -33
	.db #0xe1	; -31
	.db #0xe3	; -29
	.db #0xe6	; -26
	.db #0xe8	; -24
	.db #0xea	; -22
	.db #0xec	; -20
	.db #0xee	; -18
	.db #0xf1	; -15
	.db #0xf3	; -13
	.db #0xf5	; -11
	.db #0xf7	; -9
	.db #0xf9	; -7
	.db #0xfc	; -4
	.db #0xfe	; -2
	.db #0x00	;  0
	.db #0x02	;  2
	.db #0x04	;  4
	.db #0x07	;  7
	.db #0x09	;  9
	.db #0x0b	;  11
	.db #0x0d	;  13
	.db #0x0f	;  15
	.db #0x12	;  18
	.db #0x14	;  20
	.db #0x16	;  22
	.db #0x18	;  24
	.db #0x1a	;  26
	.db #0x1d	;  29
	.db #0x1f	;  31
	.db #0x21	;  33
	.db #0x23	;  35
	.db #0x25	;  37
	.db #0x27	;  39
	.db #0x29	;  41
	.db #0x2b	;  43
	.db #0x2e	;  46
	.db #0x30	;  48	'0'
	.db #0x32	;  50	'2'
	.db #0x34	;  52	'4'
	.db #0x36	;  54	'6'
	.db #0x38	;  56	'8'
	.db #0x3a	;  58
	.db #0x3c	;  60
	.db #0x3e	;  62
	.db #0x40	;  64
	.db #0x41	;  65	'A'
	.db #0x43	;  67	'C'
	.db #0x45	;  69	'E'
	.db #0x47	;  71	'G'
	.db #0x49	;  73	'I'
	.db #0x4b	;  75	'K'
	.db #0x4c	;  76	'L'
	.db #0x4e	;  78	'N'
	.db #0x50	;  80	'P'
	.db #0x52	;  82	'R'
	.db #0x53	;  83	'S'
	.db #0x55	;  85	'U'
	.db #0x57	;  87	'W'
	.db #0x58	;  88	'X'
	.db #0x5a	;  90	'Z'
	.db #0x5b	;  91
	.db #0x5d	;  93
	.db #0x5e	;  94
	.db #0x60	;  96
	.db #0x61	;  97	'a'
	.db #0x63	;  99	'c'
	.db #0x64	;  100	'd'
	.db #0x65	;  101	'e'
	.db #0x67	;  103	'g'
	.db #0x68	;  104	'h'
	.db #0x69	;  105	'i'
	.db #0x6b	;  107	'k'
	.db #0x6c	;  108	'l'
	.db #0x6d	;  109	'm'
	.db #0x6e	;  110	'n'
	.db #0x6f	;  111	'o'
	.db #0x70	;  112	'p'
	.db #0x71	;  113	'q'
	.db #0x72	;  114	'r'
	.db #0x73	;  115	's'
	.db #0x74	;  116	't'
	.db #0x75	;  117	'u'
	.db #0x76	;  118	'v'
	.db #0x77	;  119	'w'
	.db #0x77	;  119	'w'
	.db #0x78	;  120	'x'
	.db #0x79	;  121	'y'
	.db #0x79	;  121	'y'
	.db #0x7a	;  122	'z'
	.db #0x7b	;  123
	.db #0x7b	;  123
	.db #0x7c	;  124
	.db #0x7c	;  124
	.db #0x7d	;  125
	.db #0x7d	;  125
	.db #0x7d	;  125
	.db #0x7e	;  126
	.db #0x7e	;  126
	.db #0x7e	;  126
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
	.db #0x7f	;  127
;pocket_platformer.c:1096: static void load_rfball_level(unsigned char level_n) {
;	---------------------------------
; Function load_rfball_level
; ---------------------------------
_load_rfball_level:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-7
	add	hl, sp
	ld	sp, hl
	ld	-3 (ix), a
;pocket_platformer.c:1097: unsigned char *p = get_rfball_table();
	call	_get_rfball_table
	ex	de, hl
;pocket_platformer.c:1099: map_res_bank();
	ld	a, #0x02
	ld	(#_ROM_bank_to_be_mapped_on_slot2), a
;pocket_platformer.c:1101: for (li = 0; li < level_n; li++) {
	ld	-1 (ix), #0x00
00113$:
;pocket_platformer.c:1102: unsigned char cnt = *p++;
	ld	e, l
	ld	d, h
	inc	de
	ld	a, (hl)
	ld	-2 (ix), a
;pocket_platformer.c:1101: for (li = 0; li < level_n; li++) {
	ld	a, -1 (ix)
	sub	a, -3 (ix)
	jr	NC, 00102$
;pocket_platformer.c:1102: unsigned char cnt = *p++;
	ld	c, -2 (ix)
;pocket_platformer.c:1104: for (ri = 0; ri < cnt; ri++) p += 3; /* speed, amount, forwards */
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
00110$:
	ld	a, l
	sub	a, c
	jr	NC, 00135$
	inc	de
	inc	de
	inc	de
	inc	l
	jr	00110$
00135$:
	ex	de, hl
;pocket_platformer.c:1101: for (li = 0; li < level_n; li++) {
	inc	-1 (ix)
	jr	00113$
00102$:
;pocket_platformer.c:1106: rfb_count = *p++;
	ld	a, -2 (ix)
	ld	(_rfb_count+0), a
;pocket_platformer.c:1107: if (rfb_count > MAX_RFBALL) rfb_count = MAX_RFBALL;
	ld	a, #0x08
	ld	iy, #_rfb_count
	sub	a, 0 (iy)
	jr	NC, 00134$
	ld	0 (iy), #0x08
;pocket_platformer.c:1111: for (i = 0; i < cur_level->obj_count && obj_ri < rfb_count; i++) {
00134$:
	ld	-2 (ix), #0x00
	ld	-1 (ix), #0x00
00117$:
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	a,-1 (ix)
	sub	a,(hl)
	jp	NC, 00118$
	ld	hl, #_rfb_count
	ld	a, -2 (ix)
	sub	a, (hl)
	jp	NC, 00118$
;pocket_platformer.c:1112: level_object *obj = &cur_objects[i];
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
	ld	c, a
	ld	a, (_cur_objects+1)
	adc	a, b
	ld	b, a
	ld	-5 (ix), c
	ld	-4 (ix), b
;pocket_platformer.c:1113: if (obj->type != OBJ_RFBALL) continue;
	pop	hl
	pop	bc
	push	bc
	push	hl
	inc	bc
	inc	bc
	ld	a, (bc)
	sub	a, #0x10
	jp	NZ,00107$
;pocket_platformer.c:1114: rfb[obj_ri].cx      = (unsigned char)obj->x * TILE_SIZE;
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	a, l
	add	a, #<(_rfb)
	ld	-7 (ix), a
	ld	a, h
	adc	a, #>(_rfb)
	ld	-6 (ix), a
	ld	l, -5 (ix)
	ld	h, -4 (ix)
	ld	a, (hl)
	add	a, a
	add	a, a
	add	a, a
	pop	hl
	push	hl
	ld	(hl), a
;pocket_platformer.c:1115: rfb[obj_ri].cy      = (unsigned char)obj->y * TILE_SIZE;
	pop	bc
	push	bc
	inc	bc
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a, (hl)
	add	a, a
	add	a, a
	add	a, a
	ld	(bc), a
;pocket_platformer.c:1116: rfb[obj_ri].angle   = 270;
	pop	hl
	push	hl
	inc	hl
	inc	hl
	ld	(hl), #0x0e
	inc	hl
	ld	(hl), #0x01
;pocket_platformer.c:1117: rfb[obj_ri].speed    = p[0];
	pop	hl
	push	hl
	ld	bc, #0x0004
	add	hl, bc
	ld	a, (de)
	ld	(hl), a
;pocket_platformer.c:1118: rfb[obj_ri].amount   = p[1] < 1 ? 1 : (p[1] > 8 ? 8 : p[1]);
	ld	a, -7 (ix)
	add	a, #0x05
	ld	-5 (ix), a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	c, (hl)
	ld	a, c
	sub	a, #0x01
	jr	NC, 00120$
	ld	bc, #0x0001
	jr	00121$
00120$:
	ld	a, #0x08
	sub	a, c
	jr	NC, 00122$
	ld	bc, #0x0008
00122$:
00121$:
	ld	l, -5 (ix)
	ld	h, -4 (ix)
	ld	(hl), c
;pocket_platformer.c:1119: rfb[obj_ri].forwards = p[2];
	ld	a, -7 (ix)
	add	a, #0x06
	ld	c, a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	b, a
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	ld	a, (hl)
	ld	(bc), a
;pocket_platformer.c:1120: rfb[obj_ri].active   = 1;
	pop	hl
	push	hl
	ld	bc, #0x0007
	add	hl, bc
	ld	(hl), #0x01
;pocket_platformer.c:1121: p += 3;
	inc	de
	inc	de
	inc	de
;pocket_platformer.c:1122: obj_ri++;
	inc	-2 (ix)
00107$:
;pocket_platformer.c:1111: for (i = 0; i < cur_level->obj_count && obj_ri < rfb_count; i++) {
	inc	-1 (ix)
	jp	00117$
00118$:
;pocket_platformer.c:1125: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1128: static unsigned char rfball_hits_player(int px, int py) {
;	---------------------------------
; Function rfball_hits_player
; ---------------------------------
_rfball_hits_player:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	iy, #-16
	add	iy, sp
	ld	sp, iy
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	c, e
	ld	b, d
;pocket_platformer.c:1129: long plx = player.x >> 8, ply = player.y >> 8;
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	a, #0x08
00131$:
	sra	h
	rr	l
	rr	d
	rr	e
	dec	a
	jr	NZ, 00131$
	ld	-6 (ix), e
	ld	-5 (ix), d
	ld	-4 (ix), l
	ld	-3 (ix), h
	ld	de, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, #0x08
00133$:
	sra	h
	rr	l
	rr	d
	rr	e
	dec	a
	jr	NZ, 00133$
	inc	sp
	inc	sp
	push	de
	ld	-14 (ix), l
	ld	-13 (ix), h
;pocket_platformer.c:1132: int fb_l = px - hb, fb_r = px + hb;
	ld	a, -2 (ix)
	add	a, #0xfa
	ld	-12 (ix), a
	ld	a, -1 (ix)
	adc	a, #0xff
	ld	-11 (ix), a
	ld	a, -2 (ix)
	add	a, #0x06
	ld	-10 (ix), a
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	-9 (ix), a
;pocket_platformer.c:1133: int fb_t = py - hb, fb_b = py + hb;
	ld	a, c
	add	a, #0xfa
	ld	e, a
	ld	a, b
	adc	a, #0xff
	ld	d, a
	ld	hl, #0x0006
	add	hl, bc
;pocket_platformer.c:1135: long pl_r = plx + PLAYER_W, pl_b = ply + PLAYER_H;
	ld	c, -6 (ix)
	ld	b, -5 (ix)
	ld	a, c
	add	a, #0x06
	ld	-8 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, -16 (ix)
	ld	-6 (ix), a
	ld	a, -15 (ix)
	ld	-5 (ix), a
	ld	a, -6 (ix)
	add	a, #0x08
	ld	-4 (ix), a
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
;pocket_platformer.c:1136: return (fb_r > (int)plx && fb_l < (int)pl_r &&
	ld	a, c
	sub	a, -10 (ix)
	ld	a, b
	sbc	a, -9 (ix)
	jp	PO, 00135$
	xor	a, #0x80
00135$:
	jp	P, 00103$
	ld	a, -12 (ix)
	sub	a, -8 (ix)
	ld	a, -11 (ix)
	sbc	a, -7 (ix)
	jp	PO, 00136$
	xor	a, #0x80
00136$:
	jp	P, 00103$
;pocket_platformer.c:1137: fb_b > (int)ply && fb_t < (int)pl_b) ? 1 : 0;
	ld	a, -6 (ix)
	sub	a, l
	ld	a, -5 (ix)
	sbc	a, h
	jp	PO, 00137$
	xor	a, #0x80
00137$:
	jp	P, 00103$
	ld	a, e
	sub	a, -4 (ix)
	ld	a, d
	sbc	a, -3 (ix)
	jp	PO, 00138$
	xor	a, #0x80
00138$:
	jp	P, 00103$
	ld	bc, #0x0001
	jr	00104$
00103$:
	ld	bc, #0x0000
00104$:
	ld	a, c
;pocket_platformer.c:1138: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1140: static void update_rfball(void) {
;	---------------------------------
; Function update_rfball
; ---------------------------------
_update_rfball:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-13
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:1142: if (!rfb_count) return;
	ld	a, (_rfb_count+0)
	or	a, a
;pocket_platformer.c:1143: for (i = 0; i < rfb_count; i++) {
	jp	Z,00126$
	ld	-2 (ix), #0x00
00125$:
	ld	hl, #_rfb_count
	ld	a, -2 (ix)
	sub	a, (hl)
	jp	NC, 00126$
;pocket_platformer.c:1144: rfball_state *r = &rfb[i];
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	de, #_rfb
	add	hl, de
	ld	-11 (ix), l
	ld	-10 (ix), h
;pocket_platformer.c:1146: if (!r->active) continue;
	pop	hl
	pop	bc
	push	bc
	push	hl
	ld	hl, #7
	add	hl, bc
	ld	a, (hl)
	ld	-1 (ix), a
	or	a, a
	jp	Z, 00118$
;pocket_platformer.c:1148: if (r->forwards) {
	pop	hl
	pop	bc
	push	bc
	push	hl
	ld	hl, #6
	add	hl, bc
	ld	c, (hl)
;pocket_platformer.c:1149: r->angle += r->speed;
	ld	a, -11 (ix)
	add	a, #0x02
	ld	-6 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	a, (hl)
	ld	-4 (ix), a
	inc	hl
	ld	a, (hl)
	ld	-3 (ix), a
	ld	a, -11 (ix)
	add	a, #0x04
	ld	e, a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	d, a
;pocket_platformer.c:1152: if (r->angle < (unsigned int)r->speed) r->angle += 360;
	ld	a, (de)
	ld	b, a
;pocket_platformer.c:1148: if (r->forwards) {
	ld	a, c
	or	a, a
	jr	Z, 00110$
;pocket_platformer.c:1149: r->angle += r->speed;
	ld	c, b
	ld	b, #0x00
	ld	a, c
	add	a, -4 (ix)
	ld	e, a
	ld	a, b
	adc	a, -3 (ix)
	ld	d, a
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	(hl), e
	inc	hl
	ld	(hl), d
;pocket_platformer.c:1150: if (r->angle >= 360) r->angle -= 360;
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
	ld	a, e
	sub	a, #0x68
	ld	a, d
	sbc	a, #0x01
	jr	C, 00111$
	ld	a, c
	add	a, #0x98
	ld	c, a
	ld	a, b
	adc	a, #0xfe
	ld	b, a
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	(hl), c
	inc	hl
	ld	(hl), b
	jr	00111$
00110$:
;pocket_platformer.c:1152: if (r->angle < (unsigned int)r->speed) r->angle += 360;
	ld	c, #0x00
	ld	a, -4 (ix)
	sub	a, b
	ld	a, -3 (ix)
	sbc	a, c
	jr	NC, 00108$
	ld	a, -4 (ix)
	add	a, #0x68
	ld	c, a
	ld	a, -3 (ix)
	adc	a, #0x01
	ld	b, a
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	(hl), c
	inc	hl
	ld	(hl), b
00108$:
;pocket_platformer.c:1153: r->angle -= r->speed;
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	a, (hl)
	inc	hl
	ld	h, (hl)
;	spillPairReg hl
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, (de)
	ld	b, #0x00
	ld	c, a
	cp	a, a
	sbc	hl, bc
	ex	de, hl
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	(hl), e
	inc	hl
	ld	(hl), d
00111$:
;pocket_platformer.c:1156: if (!player_died && rfball_hits_player((int)r->cx, (int)r->cy))
	ld	a, -11 (ix)
	add	a, #0x01
	ld	-4 (ix), a
	ld	a, -10 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, (_player_died+0)
	or	a, a
	jr	NZ, 00139$
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	ld	-1 (ix), a
	ld	-8 (ix), a
	ld	-7 (ix), #0x00
	ld	l, -11 (ix)
	ld	h, -10 (ix)
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	e, -8 (ix)
	ld	d, -7 (ix)
	call	_rfball_hits_player
	or	a, a
	jr	Z, 00139$
;pocket_platformer.c:1157: player_died = 1;
	ld	hl, #_player_died
	ld	(hl), #0x01
;pocket_platformer.c:1159: for (arm = 1; arm < r->amount && !player_died; arm++) {
00139$:
	ld	a, -6 (ix)
	ld	-9 (ix), a
	ld	a, -5 (ix)
	ld	-8 (ix), a
	ld	a, -4 (ix)
	ld	-7 (ix), a
	ld	a, -3 (ix)
	ld	-6 (ix), a
	ld	a, -11 (ix)
	ld	-5 (ix), a
	ld	a, -10 (ix)
	ld	-4 (ix), a
	ld	-1 (ix), #0x01
00122$:
	ld	l, -5 (ix)
	ld	h, -4 (ix)
	ld	de, #0x0005
	add	hl, de
	ld	a,-1 (ix)
	sub	a,(hl)
	jp	NC, 00118$
	ld	a, (_player_died+0)
	or	a, a
	jp	NZ, 00118$
;pocket_platformer.c:1160: unsigned int ang = r->angle % 360;
	ld	l, -9 (ix)
	ld	h, -8 (ix)
	ld	c, (hl)
	inc	hl
	ld	h, (hl)
;	spillPairReg hl
	ld	de, #0x0168
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	call	__moduint
	inc	sp
	inc	sp
	push	de
;pocket_platformer.c:1161: int radius = (int)arm * TILE_SIZE;
	ld	l, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	push	hl
	pop	iy
;pocket_platformer.c:1162: int ax = (int)r->cx + (radius * (int)cos_table[ang]) / 127;
	ld	l, -11 (ix)
	ld	h, -10 (ix)
	ld	c, (hl)
	ld	b, #0x00
	ld	a, #<(_cos_table)
	add	a, -13 (ix)
	ld	e, a
	ld	a, #>(_cos_table)
	adc	a, -12 (ix)
	ld	d, a
	ld	a, (de)
	ld	e, a
	rlca
	sbc	a, a
	ld	d, a
	push	bc
	push	iy
	push	iy
	pop	hl
	call	__mulint
	ex	de, hl
	ld	de, #0x007f
	call	__divsint
	ex	de, hl
	pop	iy
	pop	bc
	add	hl, bc
	ld	c, l
	ld	b, h
;pocket_platformer.c:1163: int ay = (int)r->cy + (radius * (int)sin_table[ang]) / 127;
	ld	l, -7 (ix)
	ld	h, -6 (ix)
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	add	a, #<(_sin_table)
	ld	e, a
	ld	a, -12 (ix)
	adc	a, #>(_sin_table)
	ld	d, a
	ld	a, (de)
	ld	e, a
	rlca
	sbc	a, a
	ld	d, a
	push	hl
	push	bc
	push	iy
	pop	hl
	call	__mulint
	push	de
	pop	iy
	ld	de, #0x007f
	push	iy
	pop	hl
	call	__divsint
	pop	bc
	pop	hl
	add	hl, de
	ex	de, hl
;pocket_platformer.c:1164: if (rfball_hits_player(ax, ay)) player_died = 1;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	call	_rfball_hits_player
	ld	-3 (ix), a
	or	a, a
	jr	Z, 00123$
	ld	hl, #_player_died
	ld	(hl), #0x01
00123$:
;pocket_platformer.c:1159: for (arm = 1; arm < r->amount && !player_died; arm++) {
	inc	-1 (ix)
	jp	00122$
00118$:
;pocket_platformer.c:1143: for (i = 0; i < rfb_count; i++) {
	inc	-2 (ix)
	jp	00125$
00126$:
;pocket_platformer.c:1167: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1169: static void draw_rfball(void) {
;	---------------------------------
; Function draw_rfball
; ---------------------------------
_draw_rfball:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-14
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:1172: if (!rfb_count) return;
	ld	a, (_rfb_count+0)
	or	a, a
;pocket_platformer.c:1173: for (i = 0; i < rfb_count; i++) {
	jp	Z,00123$
	ld	-2 (ix), #0x00
00122$:
	ld	hl, #_rfb_count
	ld	a, -2 (ix)
	sub	a, (hl)
	jp	NC, 00123$
;pocket_platformer.c:1174: rfball_state *r = &rfb[i];
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	de, #_rfb
	add	hl, de
	ex	(sp), hl
;pocket_platformer.c:1177: if (!r->active) continue;
	pop	bc
	push	bc
	ld	hl, #7
	add	hl, bc
	ld	a, (hl)
	or	a, a
	jp	Z, 00116$
;pocket_platformer.c:1179: sx = (int)r->cx - (int)camera_x;
	pop	hl
	push	hl
	ld	a, (hl)
	ld	c, #0x00
	ld	hl, (_camera_x)
	sub	a, l
	ld	-6 (ix), a
	ld	a, c
	sbc	a, h
	ld	-5 (ix), a
;pocket_platformer.c:1180: sy = (int)r->cy;
	ld	a, -14 (ix)
	add	a, #0x01
	ld	-12 (ix), a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	-11 (ix), a
	ld	l, -12 (ix)
	ld	h, -11 (ix)
	ld	a, (hl)
	ld	-4 (ix), a
	ld	-3 (ix), #0x00
;pocket_platformer.c:1181: if (sx >= -8 && sx <= SCREEN_PX_W && sy >= 0 && sy <= SCREEN_PX_H)
	ld	a, -6 (ix)
	sub	a, #0xf8
	ld	a, -5 (ix)
	rla
	ccf
	rra
	sbc	a, #0x7f
	jr	C, 00137$
	xor	a, a
	cp	a, -6 (ix)
	ld	a, #0x01
	sbc	a, -5 (ix)
	jp	PO, 00197$
	xor	a, #0x80
00197$:
	jp	M, 00137$
	bit	7, -3 (ix)
	jr	NZ, 00137$
	ld	a, #0xc0
	cp	a, -4 (ix)
	ld	a, #0x00
	sbc	a, -3 (ix)
	jp	PO, 00198$
	xor	a, #0x80
00198$:
	jp	M, 00137$
;pocket_platformer.c:1182: SMS_addSprite((unsigned char)sx, (unsigned char)sy, tile);
	ld	a, -6 (ix)
	ld	-1 (ix), a
	ld	-8 (ix), a
	ld	-7 (ix), #0x00
	ld	a, -8 (ix)
	ld	-6 (ix), a
	ld	-5 (ix), #0x00
	ld	a, -6 (ix)
	ld	-7 (ix), a
	ld	-8 (ix), #0x00
	xor	a, a
	or	a, #0x14
	ld	-6 (ix), a
	ld	a, -7 (ix)
	ld	-5 (ix), a
	ld	a, -4 (ix)
	ld	-1 (ix), a
	ld	-4 (ix), a
	ld	-3 (ix), #0x00
	ld	e, -6 (ix)
	ld	d, -5 (ix)
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_addSprite_f
;pocket_platformer.c:1184: for (arm = 1; arm < r->amount; arm++) {
00137$:
	ld	a, -14 (ix)
	ld	-10 (ix), a
	ld	a, -13 (ix)
	ld	-9 (ix), a
	pop	bc
	push	bc
	ld	-1 (ix), #0x01
00119$:
	ld	hl, #5
	add	hl, bc
	ld	a,-1 (ix)
	sub	a,(hl)
	jp	NC, 00116$
;pocket_platformer.c:1185: unsigned int ang = r->angle % 360;
	ld	l, -10 (ix)
	ld	h, -9 (ix)
	inc	hl
	inc	hl
	ld	a, (hl)
	inc	hl
	ld	h, (hl)
;	spillPairReg hl
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	ld	de, #0x0168
	call	__moduint
	pop	bc
	ld	-8 (ix), e
	ld	-7 (ix), d
;pocket_platformer.c:1186: int radius = (int)arm * TILE_SIZE;
	ld	l, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, hl
	add	hl, hl
	add	hl, hl
	ld	-6 (ix), l
	ld	-5 (ix), h
;pocket_platformer.c:1187: int ax = (int)r->cx + (radius * (int)cos_table[ang]) / 127;
	pop	hl
	push	hl
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	a, #<(_cos_table)
	add	a, -8 (ix)
	ld	e, a
	ld	a, #>(_cos_table)
	adc	a, -7 (ix)
	ld	d, a
	ld	a, (de)
	ld	e, a
	rlca
	sbc	a, a
	ld	d, a
	push	hl
	push	bc
	ld	l, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	__mulint
	push	de
	pop	iy
	ld	de, #0x007f
	push	iy
	pop	hl
	call	__divsint
	pop	bc
	pop	hl
	add	hl, de
	ld	-4 (ix), l
	ld	-3 (ix), h
;pocket_platformer.c:1188: int ay = (int)r->cy + (radius * (int)sin_table[ang]) / 127;
	ld	l, -12 (ix)
	ld	h, -11 (ix)
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	a, #<(_sin_table)
	add	a, -8 (ix)
	ld	e, a
	ld	a, #>(_sin_table)
	adc	a, -7 (ix)
	ld	d, a
	ld	a, (de)
	ld	e, a
	rlca
	sbc	a, a
	ld	d, a
	push	hl
	push	bc
	ld	l, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	__mulint
	push	de
	pop	iy
	ld	de, #0x007f
	push	iy
	pop	hl
	call	__divsint
	pop	bc
	pop	hl
	add	hl, de
;pocket_platformer.c:1189: sx = ax - (int)camera_x;
	ld	de, (_camera_x)
	ld	a, -4 (ix)
	sub	a, e
	ld	e, a
	ld	a, -3 (ix)
	sbc	a, d
	ld	d, a
;pocket_platformer.c:1191: if (sx >= -8 && sx <= SCREEN_PX_W && sy >= 0 && sy <= SCREEN_PX_H)
	ld	a, e
	sub	a, #0xf8
	ld	a, d
	rla
	ccf
	rra
	sbc	a, #0x7f
	jr	C, 00120$
	xor	a, a
	cp	a, e
	ld	a, #0x01
	sbc	a, d
	jp	PO, 00199$
	xor	a, #0x80
00199$:
	jp	M, 00120$
	bit	7, h
	jr	NZ, 00120$
	ld	a, #0xc0
	cp	a, l
	ld	a, #0x00
	sbc	a, h
	jp	PO, 00200$
	xor	a, #0x80
00200$:
	jp	M, 00120$
;pocket_platformer.c:1192: SMS_addSprite((unsigned char)sx, (unsigned char)sy, tile);
	ld	d, e
	xor	a, a
	or	a, #0x14
	ld	e, a
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	call	_SMS_addSprite_f
	pop	bc
00120$:
;pocket_platformer.c:1184: for (arm = 1; arm < r->amount; arm++) {
	inc	-1 (ix)
	jp	00119$
00116$:
;pocket_platformer.c:1173: for (i = 0; i < rfb_count; i++) {
	inc	-2 (ix)
	jp	00122$
00123$:
;pocket_platformer.c:1195: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1200: static void barrel_enter(level_object *obj) {
;	---------------------------------
; Function barrel_enter
; ---------------------------------
_barrel_enter:
	push	ix
	ld	ix,#0
	add	ix,sp
	dec	sp
	ex	de, hl
;pocket_platformer.c:1201: unsigned char raw_y = obj->y & 0x3F;
	ld	c, e
	ld	b, d
	inc	bc
	ld	a, (bc)
	push	af
	and	a, #0x3f
	ld	-1 (ix), a
	pop	af
;pocket_platformer.c:1202: barrel_dir  = obj->y >> 6;
	rlca
	rlca
	and	a, #0x03
	ld	(_barrel_dir+0), a
;pocket_platformer.c:1203: barrel_cx   = (long)obj->x * TILE_SIZE * FP_ONE + FP(TILE_SIZE / 2) - FP(PLAYER_W / 2);
	ld	a, (de)
	ld	c, a
	ld	b, #0x00
	ld	de, #0x0000
	ld	d, e
	ld	e, b
	ld	b, c
	ld	c, #0x00
	ld	a, #0x03
00103$:
	sla	b
	rl	e
	rl	d
	dec	a
	jr	NZ,00103$
	ld	a, c
	ld	hl, #_barrel_cx
	ld	(hl), a
	inc	hl
	ld	a, b
	add	a, #0x01
	ld	(hl), a
	inc	hl
	ld	a, e
	adc	a, #0x00
	ld	(hl), a
	inc	hl
	ld	a, d
	adc	a, #0x00
	ld	(hl), a
;pocket_platformer.c:1204: barrel_cy   = (long)raw_y  * TILE_SIZE * FP_ONE + FP(TILE_SIZE / 2) - FP(PLAYER_H / 2);
	ld	e, -1 (ix)
	ld	d, #0x00
	ld	hl, #0x0000
	ld	h, l
;	spillPairReg hl
;	spillPairReg hl
	ld	l, d
;	spillPairReg hl
;	spillPairReg hl
	ld	d, e
	ld	e, #0x00
	ld	b, #0x03
00105$:
	sla	d
	adc	hl, hl
	djnz	00105$
	ld	(_barrel_cy), de
	ld	(_barrel_cy + 2), hl
;pocket_platformer.c:1205: barrel_active        = 1;
	ld	hl, #_barrel_active
	ld	(hl), #0x01
;pocket_platformer.c:1206: barrel_btn_released  = 0;
	ld	hl, #_barrel_btn_released
	ld	(hl), #0x00
;pocket_platformer.c:1207: player.vx = player.vy = 0;
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1208: player.jumping = player.falling = player.on_ground = 0;
	ld	hl, #(_player + 16)
	ld	(hl), #0x00
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:1209: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:1210: }
	inc	sp
	pop	ix
	ret
;pocket_platformer.c:1212: static void barrel_update(unsigned char joy) {
;	---------------------------------
; Function barrel_update
; ---------------------------------
_barrel_update:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	push	af
	ld	c, a
;pocket_platformer.c:1214: player.x  = barrel_cx;
	ld	hl, #_player
	ld	a, (_barrel_cx+0)
	ld	(hl), a
	inc	hl
	ld	a, (_barrel_cx+1)
	ld	(hl), a
	inc	hl
	ld	a, (_barrel_cx+2)
	ld	(hl), a
	inc	hl
	ld	a, (_barrel_cx+3)
	ld	(hl), a
;pocket_platformer.c:1215: player.y  = barrel_cy;
	ld	hl, #(_player + 4)
	ld	a, (_barrel_cy+0)
	ld	(hl), a
	inc	hl
	ld	a, (_barrel_cy+1)
	ld	(hl), a
	inc	hl
	ld	a, (_barrel_cy+2)
	ld	(hl), a
	inc	hl
	ld	a, (_barrel_cy+3)
	ld	(hl), a
;pocket_platformer.c:1216: player.vx = player.vy = 0;
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1217: player.jumping = player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:1219: if (!(joy & PORT_A_KEY_1))
	ld	a, c
	and	a, #0x10
	ld	c, a
	ld	b, #0x00
	ld	a, b
	or	a, c
	jr	NZ, 00102$
;pocket_platformer.c:1220: barrel_btn_released = 1;
	ld	a, #0x01
	ld	(#_barrel_btn_released), a
00102$:
;pocket_platformer.c:1222: if (barrel_btn_released && (joy & PORT_A_KEY_1)) {
	ld	a, (_barrel_btn_released+0)
	or	a, a
	jp	Z, 00111$
	ld	a, b
	or	a, c
	jp	Z, 00111$
;pocket_platformer.c:1224: barrel_active = 0;
	xor	a, a
	ld	(#_barrel_active), a
;pocket_platformer.c:1225: switch (barrel_dir) {
	ld	a, (_barrel_dir+0)
	or	a, a
	jr	Z, 00103$
	ld	a, (_barrel_dir+0)
	dec	a
	jp	Z,00105$
	ld	a,(_barrel_dir+0)
	cp	a,#0x02
	jr	Z, 00104$
	sub	a, #0x03
	jp	Z,00106$
	jp	00107$
;pocket_platformer.c:1226: case BARREL_DIR_RIGHT:
00103$:
;pocket_platformer.c:1227: player.x  = barrel_cx + FP(TILE_SIZE);
	ld	a, (_barrel_cx+0)
	ld	-4 (ix), a
	ld	a, (_barrel_cx+1)
	add	a, #0x08
	ld	-3 (ix), a
	ld	a, (_barrel_cx+2)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, (_barrel_cx+3)
	adc	a, #0x00
	ld	-1 (ix), a
	ld	de, #_player
	ld	hl, #0
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:1228: player.vx = BARREL_LAUNCH_SPEED_H;
	ld	hl, #0x0200
	ld	((_player + 8)), hl
	ld	h, l
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1229: player.vy = 0;
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
;pocket_platformer.c:1230: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
;pocket_platformer.c:1231: barrel_launched_h = 1;
	ld	hl, #_barrel_launched_h
	ld	(hl), #0x01
;pocket_platformer.c:1232: break;
	jp	00107$
;pocket_platformer.c:1233: case BARREL_DIR_LEFT:
00104$:
;pocket_platformer.c:1234: player.x  = barrel_cx - FP(TILE_SIZE);
	ld	a, (_barrel_cx+0)
	add	a, #0x00
	ld	-4 (ix), a
	ld	a, (_barrel_cx+1)
	adc	a, #0xf8
	ld	-3 (ix), a
	ld	a, (_barrel_cx+2)
	adc	a, #0xff
	ld	-2 (ix), a
	ld	a, (_barrel_cx+3)
	adc	a, #0xff
	ld	-1 (ix), a
	ld	de, #_player
	ld	hl, #0
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:1235: player.vx = -BARREL_LAUNCH_SPEED_H;
	ld	hl, #0xfe00
	ld	((_player + 8)), hl
	ld	hl, #0xffff
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1236: player.vy = 0;
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
;pocket_platformer.c:1237: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
;pocket_platformer.c:1238: barrel_launched_h = 1;
	ld	hl, #_barrel_launched_h
	ld	(hl), #0x01
;pocket_platformer.c:1239: break;
	jr	00107$
;pocket_platformer.c:1240: case BARREL_DIR_TOP:
00105$:
;pocket_platformer.c:1241: player.y    = barrel_cy - FP(TILE_SIZE);
	ld	a, (_barrel_cy+0)
	ld	c,a
	ld	a,(_barrel_cy+1)
	add	a,#0xf8
	ld	b, a
	ld	a, (_barrel_cy+2)
	adc	a, #0xff
	ld	e, a
	ld	a, (_barrel_cy+3)
	adc	a, #0xff
	ld	d, a
	ld	((_player + 4)), bc
	ld	((_player + 4)+2), de
;pocket_platformer.c:1242: player.vy   = -BARREL_LAUNCH_SPEED_V;
	ld	hl, #0xfa00
	ld	((_player + 12)), hl
	ld	hl, #0xffff
	ld	((_player + 12)+2), hl
;pocket_platformer.c:1243: player.vx   = 0;
	ld	hl, #0x0000
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1244: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:1245: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
;pocket_platformer.c:1246: break;
	jr	00107$
;pocket_platformer.c:1247: case BARREL_DIR_BOTTOM:
00106$:
;pocket_platformer.c:1248: player.y    = barrel_cy + FP(TILE_SIZE);
	ld	a, (#_barrel_cy + 0)
	ld	c, a
	ld	a, (_barrel_cy+1)
	add	a, #0x08
	ld	b, a
	ld	a, (_barrel_cy+2)
	adc	a, #0x00
	ld	e, a
	ld	a, (_barrel_cy+3)
	adc	a, #0x00
	ld	d, a
	ld	((_player + 4)), bc
	ld	((_player + 4)+2), de
;pocket_platformer.c:1249: player.vy   = BARREL_LAUNCH_SPEED_V;
	ld	hl, #0x0600
	ld	((_player + 12)), hl
	ld	h, l
	ld	((_player + 12)+2), hl
;pocket_platformer.c:1250: player.vx   = 0;
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1251: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
;pocket_platformer.c:1253: }
00107$:
;pocket_platformer.c:1254: barrel_launched = 1;
	ld	hl, #_barrel_launched
	ld	(hl), #0x01
00111$:
;pocket_platformer.c:1256: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1263: static void apply_gravity(void) {
;	---------------------------------
; Function apply_gravity
; ---------------------------------
_apply_gravity:
;pocket_platformer.c:1265: if (player.falling && !barrel_launched_h) {
	ld	a, (#_player + 17)
	or	a, a
	ret	Z
	ld	a, (_barrel_launched_h+0)
	or	a, a
	ret	NZ
;pocket_platformer.c:1266: player.vy += GRAVITY;
	ld	hl, (#(_player + 12) + 0)
	ld	de, (#(_player + 12) + 2)
	ld	a, l
	add	a, #0x2a
	ld	c, a
	ld	a, h
	adc	a, #0x00
	ld	b, a
	jr	NC, 00123$
	inc	de
00123$:
	ld	((_player + 12)), bc
	ld	((_player + 12)+2), de
;pocket_platformer.c:1267: if (player.vy > MAX_VY)
	xor	a, a
	cp	a, c
	ld	a, #0x07
	sbc	a, b
	ld	a, #0x00
	sbc	a, e
	ld	a, #0x00
	sbc	a, d
	jp	PO, 00124$
	xor	a, #0x80
00124$:
	ret	P
;pocket_platformer.c:1268: player.vy = MAX_VY;
	ld	hl, #0x0700
	ld	((_player + 12)), hl
	ld	h, l
	ld	((_player + 12)+2), hl
;pocket_platformer.c:1270: }
	ret
;pocket_platformer.c:1272: static void handle_input(unsigned int joy, unsigned int joy_pressed) {
;	---------------------------------
; Function handle_input
; ---------------------------------
_handle_input:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	iy, #-19
	add	iy, sp
	ld	sp, iy
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	-4 (ix), e
	ld	-3 (ix), d
;pocket_platformer.c:1273: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
	ld	-11 (ix), l
	ld	-10 (ix), h
	ld	c, (hl)
	inc	hl
	ld	a, (hl)
	ld	b, a
	rlca
	sbc	a, a
	ld	e, a
	ld	d, a
;pocket_platformer.c:1274: long accel = player.on_ground ? (long)res_physics->ground_accel : (long)res_physics->air_accel;
	ld	a, (#(_player + 16) + 0)
	ld	-9 (ix), a
	or	a, a
	jr	Z, 00171$
	ld	l, -11 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	inc	hl
	ld	a, (hl)
	dec	hl
	ld	l, (hl)
;	spillPairReg hl
	ld	-8 (ix), l
	ld	-7 (ix), a
	rlca
	sbc	a, a
	ld	-6 (ix), a
	ld	-5 (ix), a
	jr	00172$
00171$:
	ld	l, -11 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	ld	bc, #0x0007
	add	hl, bc
	pop	bc
	ld	a, (hl)
	dec	hl
	ld	l, (hl)
;	spillPairReg hl
	ld	-8 (ix), l
	ld	-7 (ix), a
	rlca
	sbc	a, a
	ld	-6 (ix), a
	ld	-5 (ix), a
00172$:
;pocket_platformer.c:1275: long fric  = player.on_ground ? (long)res_physics->ground_friction : (long)res_physics->air_friction;
	ld	a, -9 (ix)
	or	a, a
	jr	Z, 00173$
	ld	l, -11 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	inc	hl
	inc	hl
	inc	hl
	ld	a, (hl)
	dec	hl
	ld	l, (hl)
;	spillPairReg hl
	ld	-12 (ix), l
	ld	-11 (ix), a
	rlca
	sbc	a, a
	ld	-10 (ix), a
	ld	-9 (ix), a
	jr	00174$
00173$:
	ld	l, -11 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	ld	bc, #0x0009
	add	hl, bc
	pop	bc
	ld	a, (hl)
	dec	hl
	ld	l, (hl)
;	spillPairReg hl
	ld	-12 (ix), l
	ld	-11 (ix), a
	rlca
	sbc	a, a
	ld	-10 (ix), a
	ld	-9 (ix), a
00174$:
;pocket_platformer.c:1279: player.vx -= accel;
;pocket_platformer.c:1281: player.facing_left = 1;
;pocket_platformer.c:1278: if (joy & PORT_A_KEY_LEFT) {
	bit	2, -2 (ix)
	jp	Z,00114$
;pocket_platformer.c:1279: player.vx -= accel;
	push	de
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #7
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
	ld	a, -16 (ix)
	sub	a, -8 (ix)
	ld	-12 (ix), a
	ld	a, -15 (ix)
	sbc	a, -7 (ix)
	ld	-11 (ix), a
	ld	a, -14 (ix)
	sbc	a, -6 (ix)
	ld	-10 (ix), a
	ld	a, -13 (ix)
	sbc	a, -5 (ix)
	ld	-9 (ix), a
	push	de
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #11
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
;pocket_platformer.c:1280: if (player.vx < -max_spd) player.vx = -max_spd;
	xor	a, a
	sub	a, c
	ld	c, a
	ld	a, #0x00
	sbc	a, b
	ld	b, a
	ld	hl, #0x0000
	sbc	hl, de
	ex	de, hl
	ld	a, -12 (ix)
	sub	a, c
	ld	a, -11 (ix)
	sbc	a, b
	ld	a, -10 (ix)
	sbc	a, e
	ld	a, -9 (ix)
	sbc	a, d
	jp	PO, 00520$
	xor	a, #0x80
00520$:
	jp	P, 00102$
	ld	((_player + 8)), bc
	ld	((_player + 8)+2), de
00102$:
;pocket_platformer.c:1281: player.facing_left = 1;
	ld	hl, #(_player + 23)
	ld	(hl), #0x01
;pocket_platformer.c:1282: barrel_launched_h = 0; /* player took control: restore gravity */
	ld	hl, #_barrel_launched_h
	ld	(hl), #0x00
	jp	00115$
00114$:
;pocket_platformer.c:1283: } else if (joy & PORT_A_KEY_RIGHT) {
	bit	3, -2 (ix)
	jr	Z, 00111$
;pocket_platformer.c:1284: player.vx += accel;
	push	de
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #7
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
	ld	a, -16 (ix)
	add	a, -8 (ix)
	ld	-12 (ix), a
	ld	a, -15 (ix)
	adc	a, -7 (ix)
	ld	-11 (ix), a
	ld	a, -14 (ix)
	adc	a, -6 (ix)
	ld	-10 (ix), a
	ld	a, -13 (ix)
	adc	a, -5 (ix)
	ld	-9 (ix), a
	push	de
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #11
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
;pocket_platformer.c:1285: if (player.vx > max_spd) player.vx = max_spd;
	ld	a, c
	sub	a, -12 (ix)
	ld	a, b
	sbc	a, -11 (ix)
	ld	a, e
	sbc	a, -10 (ix)
	ld	a, d
	sbc	a, -9 (ix)
	jp	PO, 00522$
	xor	a, #0x80
00522$:
	jp	P, 00104$
	ld	((_player + 8)), bc
	ld	((_player + 8)+2), de
00104$:
;pocket_platformer.c:1286: player.facing_left = 0;
	ld	hl, #(_player + 23)
	ld	(hl), #0x00
;pocket_platformer.c:1287: barrel_launched_h = 0; /* player took control: restore gravity */
	ld	hl, #_barrel_launched_h
	ld	(hl), #0x00
	jp	00115$
00111$:
;pocket_platformer.c:1288: } else if (!barrel_launched) {
	ld	a, (_barrel_launched+0)
	or	a, a
	jr	NZ, 00115$
;pocket_platformer.c:1289: player.vx = FP_MUL(player.vx, fric);
	ld	de, (#(_player + 8) + 0)
	ld	hl, (#(_player + 8) + 2)
	ld	c, -10 (ix)
	ld	b, -9 (ix)
	push	bc
	ld	c, -12 (ix)
	ld	b, -11 (ix)
	push	bc
	call	__mullong
	pop	af
	pop	af
	ld	c, l
	ld	b, h
	ld	a, #0x08
00523$:
	sra	b
	rr	c
	rr	d
	rr	e
	dec	a
	jr	NZ, 00523$
	ld	((_player + 8)), de
	ld	((_player + 8)+2), bc
;pocket_platformer.c:1290: if (player.vx > -FP(0.5) && player.vx < FP(0.5)) player.vx = 0;
	push	de
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #15
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
	ld	a, #0x80
	cp	a, e
	ld	a, #0xff
	sbc	a, d
	ld	a, #0xff
	sbc	a, c
	ld	a, #0xff
	sbc	a, b
	jp	PO, 00525$
	xor	a, #0x80
00525$:
	jp	P, 00115$
	ld	a, -8 (ix)
	sub	a, #0x80
	ld	a, -7 (ix)
	sbc	a, #0x00
	ld	a, -6 (ix)
	sbc	a, #0x00
	ld	a, -5 (ix)
	rla
	ccf
	rra
	sbc	a, #0x80
	jr	NC, 00115$
	ld	hl, #0x0000
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
00115$:
;pocket_platformer.c:1297: long px_l = (player.x >> 8) - 1;           /* 1px left of player */
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	b, #0x08
00526$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00526$
	ld	a, e
	add	a, #0xff
	ld	-19 (ix), a
	ld	a, d
	adc	a, #0xff
	ld	-18 (ix), a
	ld	a, l
	adc	a, #0xff
	ld	-17 (ix), a
	ld	a, h
	adc	a, #0xff
	ld	-16 (ix), a
;pocket_platformer.c:1298: long px_r = (player.x >> 8) + PLAYER_W + 1; /* 1px beyond right edge */
	ld	a, e
	add	a, #0x07
	ld	-8 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, l
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, h
	adc	a, #0x00
	ld	-5 (ix), a
;pocket_platformer.c:1299: unsigned char px8_l = (unsigned char)(px_l >= 0 ? px_l / TILE_SIZE : 255);
	ld	a, -16 (ix)
	rlca
	and	a,#0x01
	ld	-15 (ix), a
	bit	0, -15 (ix)
	jr	NZ, 00175$
	ld	hl, #7
	add	hl, sp
	ex	de, hl
	ld	hl, #0
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -15 (ix)
	or	a, a
	jr	Z, 00177$
	ld	a, -19 (ix)
	add	a, #0x07
	ld	-12 (ix), a
	ld	a, -18 (ix)
	adc	a, #0x00
	ld	-11 (ix), a
	ld	a, -17 (ix)
	adc	a, #0x00
	ld	-10 (ix), a
	ld	a, -16 (ix)
	adc	a, #0x00
	ld	-9 (ix), a
00177$:
	ld	l, -12 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -11 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	e, -10 (ix)
	ld	d, -9 (ix)
	ld	b, #0x03
00528$:
	sra	d
	rr	e
	rr	h
	rr	l
	djnz	00528$
	jr	00176$
00175$:
	ld	hl, #0x00ff
00176$:
	ld	-14 (ix), l
;pocket_platformer.c:1300: unsigned char px8_r = (unsigned char)(px_r / TILE_SIZE);
	ld	c, -8 (ix)
	ld	b, -7 (ix)
	bit	7, -5 (ix)
	jr	Z, 00178$
	ld	a, -8 (ix)
	add	a, #0x07
	ld	c, a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	b, a
00178$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-13 (ix), c
;pocket_platformer.c:1301: unsigned char py8   = (unsigned char)((player.y >> 8) / TILE_SIZE);
	ld	de, (#_player + 4)
	ld	hl, (#_player + 6)
	ld	b, #0x08
00530$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00530$
	push	hl
	pop	iy
	ld	c, e
	ld	b, d
	ld	a, e
	add	a, #0x07
	ld	-12 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-11 (ix), a
	ld	a, l
	adc	a, #0x00
	ld	-10 (ix), a
	ld	a, h
	adc	a, #0x00
	ld	-9 (ix), a
	bit	7, h
	jr	Z, 00179$
	ld	c, -12 (ix)
	ld	b, -11 (ix)
	push	iy
	ex	(sp), hl
	ld	l, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	ex	(sp), hl
	ld	h, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	pop	iy
00179$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:1302: unsigned char pb8   = (unsigned char)(((player.y >> 8) + PLAYER_H - 1) / TILE_SIZE);
	ld	a, -12 (ix)
	ld	-8 (ix), a
	ld	a, -11 (ix)
	ld	-7 (ix), a
	ld	a, -10 (ix)
	ld	-6 (ix), a
	ld	a, -9 (ix)
	ld	-5 (ix), a
	bit	7, -9 (ix)
	jr	Z, 00180$
	ld	a, e
	add	a, #0x0e
	ld	-8 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, l
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, h
	adc	a, #0x00
	ld	-5 (ix), a
00180$:
	ld	b, -8 (ix)
	ld	d, -7 (ix)
	srl	d
	rr	b
	srl	d
	rr	b
	srl	d
	rr	b
;pocket_platformer.c:1305: unsigned char wall_left  = (px_l >= 0) &&
	bit	0, -15 (ix)
	jp	NZ, 00181$
	push	bc
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -14 (ix)
	call	_get_tile
	pop	bc
	or	a, a
	jr	Z, 00189$
	ld	iy, (_res_header)
	ld	a, 6 (iy)
	or	a, a
	jr	Z, 00194$
	push	bc
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -14 (ix)
	call	_get_tile
	pop	bc
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	e, (hl)
	sub	a, e
	jr	Z, 00189$
00194$:
	push	bc
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -14 (ix)
	call	_rb_is_passable
	pop	bc
	or	a, a
	jr	NZ, 00189$
	push	bc
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -14 (ix)
	call	_vp_is_passable
	pop	bc
	or	a, a
	jr	Z, 00182$
00189$:
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -14 (ix)
	call	_get_tile
	pop	bc
	or	a, a
	jr	Z, 00181$
	ld	iy, (_res_header)
	ld	a, 6 (iy)
	or	a, a
	jr	Z, 00206$
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -14 (ix)
	call	_get_tile
	pop	bc
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	e, (hl)
	sub	a, e
	jr	Z, 00181$
00206$:
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -14 (ix)
	call	_rb_is_passable
	pop	bc
	or	a, a
	jr	NZ, 00181$
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -14 (ix)
	call	_vp_is_passable
	pop	bc
	or	a, a
	jr	Z, 00182$
00181$:
	xor	a, a
	jr	00183$
00182$:
	ld	a, #0x01
00183$:
	ld	-5 (ix), a
;pocket_platformer.c:1307: unsigned char wall_right =
	push	bc
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_get_tile
	pop	bc
	or	a, a
	jr	Z, 00216$
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	a, (hl)
	or	a, a
	jr	Z, 00221$
	push	bc
	ld	l, c
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
	jr	Z, 00216$
00221$:
	push	bc
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_rb_is_passable
	pop	bc
	or	a, a
	jr	NZ, 00216$
	push	bc
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_vp_is_passable
	pop	bc
	or	a, a
	jr	Z, 00212$
00216$:
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_get_tile
	pop	bc
	or	a, a
	jr	Z, 00211$
	ld	iy, (_res_header)
	ld	a, 6 (iy)
	or	a, a
	jr	Z, 00233$
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_get_tile
	pop	bc
	ld	hl, (_res_header)
	ld	de, #0x0006
	add	hl, de
	ld	c, (hl)
	sub	a, c
	jr	Z, 00211$
00233$:
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_rb_is_passable
	pop	bc
	or	a, a
	jr	NZ, 00211$
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -13 (ix)
	call	_vp_is_passable
	or	a, a
	jr	Z, 00212$
00211$:
	xor	a, a
	jr	00213$
00212$:
	ld	a, #0x01
00213$:
	ld	-6 (ix), a
;pocket_platformer.c:1314: player.jumping = 1;
;pocket_platformer.c:1315: player.wall_jumping = 0;
;pocket_platformer.c:1316: player.jump_frames = 0;
;pocket_platformer.c:1317: player.falling = 0;
;pocket_platformer.c:1330: player.wall_jump_dir = wall_left ? 1 : 255;
;pocket_platformer.c:1331: player.wall_push_frames = 0;
;pocket_platformer.c:1312: if (joy_pressed & PORT_A_KEY_1) {
	bit	4, -4 (ix)
	jp	Z,00135$
;pocket_platformer.c:1313: if (player.on_ground) {
	ld	hl, #(_player + 16)
	ld	e, (hl)
	ld	a, e
	or	a, a
	jr	Z, 00132$
;pocket_platformer.c:1314: player.jumping = 1;
	ld	hl, #(_player + 18)
	ld	(hl), #0x01
;pocket_platformer.c:1315: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:1316: player.jump_frames = 0;
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
;pocket_platformer.c:1317: player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
;pocket_platformer.c:1318: player.on_ground = 0;
	ld	hl, #(_player + 16)
	ld	(hl), #0x00
;pocket_platformer.c:1319: if (vp_block_count) vp_toggle();
	ld	a, (_vp_block_count+0)
	or	a, a
	jp	Z, 00135$
	call	_vp_toggle
	jp	00135$
00132$:
;pocket_platformer.c:1273: long max_spd = (long)res_physics->max_speed;
	ld	bc, (_res_physics)
;pocket_platformer.c:1320: } else if (res_physics->has_wall_jump && !player.on_ground &&
	push	bc
	pop	iy
;	spillPairReg hl
;pocket_platformer.c:1327: player.double_jump_used = 0;
;pocket_platformer.c:1320: } else if (res_physics->has_wall_jump && !player.on_ground &&
	ld	a, 16 (iy)
	or	a, a
	jr	Z, 00126$
	ld	a, e
	or	a, a
	jr	NZ, 00126$
;pocket_platformer.c:1321: (wall_left || wall_right)) {
	ld	a, -5 (ix)
	or	a, a
	jr	NZ, 00125$
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00126$
00125$:
;pocket_platformer.c:1323: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:1324: player.wall_jumping = 1;
	ld	hl, #(_player + 19)
	ld	(hl), #0x01
;pocket_platformer.c:1325: player.jump_frames = 0;
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
;pocket_platformer.c:1326: player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
;pocket_platformer.c:1327: player.double_jump_used = 0;
	ld	hl, #(_player + 24)
	ld	(hl), #0x00
;pocket_platformer.c:1330: player.wall_jump_dir = wall_left ? 1 : 255;
	ld	a, -5 (ix)
	or	a, a
	jr	Z, 00238$
	ld	bc, #0x0001
	jr	00239$
00238$:
	ld	bc, #0x00ff
00239$:
	ld	hl, #(_player + 20)
	ld	(hl), c
;pocket_platformer.c:1331: player.wall_push_frames = 0;
	ld	hl, #(_player + 21)
	ld	(hl), #0x00
;pocket_platformer.c:1332: if (vp_block_count) vp_toggle();
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00135$
	call	_vp_toggle
	jr	00135$
00126$:
;pocket_platformer.c:1333: } else if (res_physics->has_double_jump && !player.double_jump_used) {
	ld	hl, #15
	add	hl, bc
	ld	a, (hl)
	or	a, a
	jr	Z, 00135$
	ld	a, (#(_player + 24) + 0)
	or	a, a
	jr	NZ, 00135$
;pocket_platformer.c:1334: player.jumping = 1;
	ld	hl, #(_player + 18)
	ld	(hl), #0x01
;pocket_platformer.c:1335: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:1336: player.jump_frames = 0;
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
;pocket_platformer.c:1337: player.double_jump_used = 1;
	ld	hl, #(_player + 24)
	ld	(hl), #0x01
;pocket_platformer.c:1338: if (vp_block_count) vp_toggle();
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00135$
	call	_vp_toggle
00135$:
;pocket_platformer.c:1345: if (player.jumping) {
	ld	a, (#(_player + 18) + 0)
	ld	-5 (ix), a
;pocket_platformer.c:1346: if (joy & PORT_A_KEY_1 || player.forced_jump_speed > 0) {
	ld	a, -2 (ix)
	and	a, #0x10
	ld	-11 (ix), a
	ld	-10 (ix), #0x00
;pocket_platformer.c:1350: player.vy = -(remaining * js);
;pocket_platformer.c:1345: if (player.jumping) {
	ld	a, -5 (ix)
	or	a, a
	jp	Z, 00145$
;pocket_platformer.c:1346: if (joy & PORT_A_KEY_1 || player.forced_jump_speed > 0) {
	ld	de, #(_player + 27)
	ld	hl, #11
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	xor	a, a
	cp	a, -8 (ix)
	sbc	a, -7 (ix)
	ld	a, #0x00
	sbc	a, -6 (ix)
	ld	a, #0x00
	sbc	a, -5 (ix)
	jp	PO, 00537$
	xor	a, #0x80
00537$:
	rlca
	and	a,#0x01
	ld	-9 (ix), a
	ld	a, -10 (ix)
	or	a, -11 (ix)
	jr	NZ, 00140$
	ld	a, -9 (ix)
	or	a, a
	jp	Z, 00141$
00140$:
;pocket_platformer.c:1347: long js = player.forced_jump_speed > 0 ? player.forced_jump_speed : (long)res_physics->jump_speed;
	ld	a, -9 (ix)
	or	a, a
	jr	Z, 00240$
	ld	hl, #4
	add	hl, sp
	ex	de, hl
	ld	hl, #11
	add	hl, sp
	ld	bc, #4
	ldir
	jr	00241$
00240$:
	ld	hl, (_res_physics)
	ld	de, #0x000a
	add	hl, de
	ld	c, (hl)
	inc	hl
	ld	a, (hl)
	ld	-15 (ix), c
	ld	-14 (ix), a
	rlca
	sbc	a, a
	ld	-13 (ix), a
	ld	-12 (ix), a
00241$:
	ld	hl, #10
	add	hl, sp
	ex	de, hl
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:1348: player.jump_frames++;
	ld	a, (#(_player + 22) + 0)
	inc	a
	ld	-5 (ix), a
	ld	hl, #(_player + 22)
	ld	a, -5 (ix)
	ld	(hl), a
;pocket_platformer.c:1349: long remaining = (long)(res_physics->max_jump_frames - player.jump_frames);
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	c, -5 (ix)
	ld	b, #0x00
	cp	a, a
	sbc	hl, bc
	ex	de, hl
	ld	a, d
	rlca
	sbc	hl, hl
;pocket_platformer.c:1350: player.vy = -(remaining * js);
	ld	c, -7 (ix)
	ld	b, -6 (ix)
	push	bc
	ld	c, -9 (ix)
	ld	b, -8 (ix)
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
;pocket_platformer.c:1351: if (player.jump_frames >= res_physics->max_jump_frames) {
	ld	iy, (_res_physics)
	ld	c, 12 (iy)
	ld	a, -5 (ix)
	sub	a, c
	jr	C, 00145$
;pocket_platformer.c:1352: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:1353: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
;pocket_platformer.c:1354: player.forced_jump_speed = 0;
	ld	hl, #0x0000
	ld	((_player + 27)), hl
	ld	((_player + 27)+2), hl
	jr	00145$
00141$:
;pocket_platformer.c:1356: } else if (player.forced_jump_speed == 0) {
	ld	a, -5 (ix)
	or	a, -6 (ix)
	or	a, -7 (ix)
	or	a, -8 (ix)
	jr	NZ, 00145$
;pocket_platformer.c:1358: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:1359: player.jump_frames = res_physics->max_jump_frames;
	ld	iy, (_res_physics)
	ld	a, 12 (iy)
	ld	(#(_player + 22)),a
;pocket_platformer.c:1360: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
00145$:
;pocket_platformer.c:1366: if (player.wall_jumping) {
	ld	a, (#(_player + 19) + 0)
	ld	-5 (ix), a
	or	a, a
	jp	Z, 00161$
;pocket_platformer.c:1367: if (joy & PORT_A_KEY_1) {
	ld	a, -10 (ix)
	or	a, -11 (ix)
	jp	Z, 00158$
;pocket_platformer.c:1368: player.jump_frames++;
	ld	a, (#(_player + 22) + 0)
	inc	a
	ld	-5 (ix), a
	ld	hl, #(_player + 22)
	ld	a, -5 (ix)
	ld	(hl), a
;pocket_platformer.c:1273: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
	ld	-8 (ix), l
	ld	-7 (ix), h
;pocket_platformer.c:1369: long remaining = (long)(res_physics->max_jump_frames - player.jump_frames);
	ld	a, -8 (ix)
	ld	-10 (ix), a
	ld	a, -7 (ix)
	ld	-9 (ix), a
	ld	l, -10 (ix)
	ld	h, -9 (ix)
	ld	de, #0x000c
	add	hl, de
	ld	a, (hl)
	ld	-6 (ix), a
	ld	-12 (ix), a
	ld	-11 (ix), #0x00
	ld	a, -5 (ix)
	ld	-10 (ix), a
	ld	-9 (ix), #0x00
	ld	a, -12 (ix)
	sub	a, -10 (ix)
	ld	-6 (ix), a
	ld	a, -11 (ix)
	sbc	a, -9 (ix)
	ld	-5 (ix), a
	ld	a, -6 (ix)
	ld	-15 (ix), a
	ld	a, -5 (ix)
	ld	-14 (ix), a
	rlca
	sbc	a, a
	ld	-13 (ix), a
	ld	-12 (ix), a
;pocket_platformer.c:1370: player.vy = -(remaining * (long)res_physics->jump_speed);
	ld	a, -8 (ix)
	ld	-6 (ix), a
	ld	a, -7 (ix)
	ld	-5 (ix), a
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	de, #0x000a
	add	hl, de
	ld	a, (hl)
	ld	-6 (ix), a
	inc	hl
	ld	a, (hl)
	ld	-5 (ix), a
	ld	a, -6 (ix)
	ld	-8 (ix), a
	ld	a, -5 (ix)
	ld	-7 (ix), a
	rlca
	sbc	a, a
;	spillPairReg hl
;	spillPairReg hl
	ld	-6 (ix), a
	ld	-5 (ix), a
	ld	l, a
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	push	hl
	ld	l, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	hl
	ld	e, -15 (ix)
	ld	d, -14 (ix)
	ld	l, -13 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -12 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	__mullong
	pop	af
	pop	af
	inc	sp
	inc	sp
	push	de
	ld	-17 (ix), l
	ld	-16 (ix), h
	xor	a, a
	sub	a, -19 (ix)
	ld	-8 (ix), a
	ld	a, #0x00
	sbc	a, -18 (ix)
	ld	-7 (ix), a
	ld	a, #0x00
	sbc	a, -17 (ix)
	ld	-6 (ix), a
	sbc	a, a
	sub	a, -16 (ix)
	ld	-5 (ix), a
	ld	de, #(_player + 12)
	ld	hl, #11
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:1372: if (player.wall_push_frames < (res_physics->max_jump_frames / 2 - 4)) {
	ld	a, (#(_player + 21) + 0)
	ld	-11 (ix), a
;pocket_platformer.c:1273: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
	ld	-10 (ix), l
	ld	-9 (ix), h
;pocket_platformer.c:1372: if (player.wall_push_frames < (res_physics->max_jump_frames / 2 - 4)) {
	ld	a, -10 (ix)
	ld	-6 (ix), a
	ld	a, -9 (ix)
	ld	-5 (ix), a
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	de, #0x000c
	add	hl, de
	ld	a, (hl)
	ld	-5 (ix), a
	ld	-8 (ix), a
	ld	-7 (ix), #0x00
	ld	a, -8 (ix)
	ld	-6 (ix), a
	ld	a, -7 (ix)
	ld	-5 (ix), a
	bit	7, -7 (ix)
	jr	Z, 00242$
	ld	a, -8 (ix)
	add	a, #0x01
	ld	-6 (ix), a
	ld	a, -7 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
00242$:
	ld	c, -6 (ix)
	ld	b, -5 (ix)
	sra	b
	rr	c
	ld	a, c
	add	a, #0xfc
	ld	c, a
	ld	a, b
	adc	a, #0xff
	ld	b, a
	ld	a, -11 (ix)
	ld	d, #0x00
	sub	a, c
	ld	a, d
	sbc	a, b
	jp	PO, 00538$
	xor	a, #0x80
00538$:
	jp	P, 00154$
;pocket_platformer.c:1374: long push = remaining * (long)res_physics->jump_speed;
	ld	c, -10 (ix)
	ld	b, -9 (ix)
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
	ld	e, -15 (ix)
	ld	d, -14 (ix)
	ld	l, -13 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -12 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	__mullong
	pop	af
	pop	af
	ld	c, l
	ld	b, h
;pocket_platformer.c:1375: if (player.wall_jump_dir == 1) {   /* off left wall → push right */
	ld	a, (#(_player + 20) + 0)
	ld	-5 (ix), a
;pocket_platformer.c:1289: player.vx = FP_MUL(player.vx, fric);
	push	de
	push	bc
	ld	de, #(_player + 8)
	ld	hl, #7
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	pop	bc
	pop	de
;pocket_platformer.c:1376: player.vx += push >> 4;         /* scale down push */
	ld	-12 (ix), e
	ld	-11 (ix), d
	ld	-10 (ix), c
	ld	-9 (ix), b
	ld	b, #0x04
00539$:
	sra	-9 (ix)
	rr	-10 (ix)
	rr	-11 (ix)
	rr	-12 (ix)
	djnz	00539$
;pocket_platformer.c:1375: if (player.wall_jump_dir == 1) {   /* off left wall → push right */
	ld	a, -5 (ix)
	dec	a
	jr	NZ, 00151$
;pocket_platformer.c:1376: player.vx += push >> 4;         /* scale down push */
	ld	a, -16 (ix)
	add	a, -12 (ix)
	ld	-8 (ix), a
	ld	a, -15 (ix)
	adc	a, -11 (ix)
	ld	-7 (ix), a
	ld	a, -14 (ix)
	adc	a, -10 (ix)
	ld	-6 (ix), a
	ld	a, -13 (ix)
	adc	a, -9 (ix)
	ld	-5 (ix), a
	ld	de, #(_player + 8)
	ld	hl, #11
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:1273: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
;pocket_platformer.c:1377: if (player.vx > (long)res_physics->max_speed)
	ld	a, b
	rlca
	sbc	a, a
	ld	e, a
	ld	d, a
	ld	a, c
	sub	a, -8 (ix)
	ld	a, b
	sbc	a, -7 (ix)
	ld	a, e
	sbc	a, -6 (ix)
	ld	a, d
	sbc	a, -5 (ix)
	jp	PO, 00543$
	xor	a, #0x80
00543$:
	jp	P, 00152$
;pocket_platformer.c:1378: player.vx = (long)res_physics->max_speed;
	ld	((_player + 8)), bc
	ld	((_player + 8)+2), de
	jr	00152$
00151$:
;pocket_platformer.c:1380: player.vx -= push >> 4;
	ld	a, -16 (ix)
	sub	a, -12 (ix)
	ld	-8 (ix), a
	ld	a, -15 (ix)
	sbc	a, -11 (ix)
	ld	-7 (ix), a
	ld	a, -14 (ix)
	sbc	a, -10 (ix)
	ld	-6 (ix), a
	ld	a, -13 (ix)
	sbc	a, -9 (ix)
	ld	-5 (ix), a
	ld	de, #(_player + 8)
	ld	hl, #11
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:1273: long max_spd = (long)res_physics->max_speed;
	ld	hl, (_res_physics)
	ld	c, (hl)
	inc	hl
	ld	a, (hl)
;pocket_platformer.c:1377: if (player.vx > (long)res_physics->max_speed)
	ld	b, a
	rlca
	sbc	a, a
	ld	e, a
	ld	d, a
;pocket_platformer.c:1381: if (player.vx < -(long)res_physics->max_speed)
	xor	a, a
	sub	a, c
	ld	c, a
	ld	a, #0x00
	sbc	a, b
	ld	b, a
	ld	hl, #0x0000
	sbc	hl, de
	ex	de, hl
	ld	a, -8 (ix)
	sub	a, c
	ld	a, -7 (ix)
	sbc	a, b
	ld	a, -6 (ix)
	sbc	a, e
	ld	a, -5 (ix)
	sbc	a, d
	jp	PO, 00544$
	xor	a, #0x80
00544$:
	jp	P, 00152$
;pocket_platformer.c:1382: player.vx = -(long)res_physics->max_speed;
	ld	((_player + 8)), bc
	ld	((_player + 8)+2), de
00152$:
;pocket_platformer.c:1384: player.wall_push_frames++;
	ld	a, (#(_player + 21) + 0)
	inc	a
	ld	(#(_player + 21)),a
00154$:
;pocket_platformer.c:1386: if (player.jump_frames >= res_physics->max_jump_frames) {
	ld	a, (#(_player + 22) + 0)
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	c, (hl)
	sub	a, c
	jr	C, 00161$
;pocket_platformer.c:1387: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:1388: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
	jr	00161$
00158$:
;pocket_platformer.c:1391: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:1392: player.jump_frames = res_physics->max_jump_frames;
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	a, (hl)
	ld	(#(_player + 22)),a
;pocket_platformer.c:1393: player.falling = 1;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
00161$:
;pocket_platformer.c:1399: if (!player.jumping && !player.wall_jumping && player.vy < 0 && !barrel_launched) {
	ld	a, (#(_player + 18) + 0)
	or	a, a
	jr	NZ, 00169$
	ld	a, (#(_player + 19) + 0)
	or	a, a
	jr	NZ, 00169$
	ld	bc, (#(_player + 12) + 0)
	ld	de, (#(_player + 12) + 2)
	bit	7, d
	jr	Z, 00169$
	ld	a, (_barrel_launched+0)
	or	a, a
	jr	NZ, 00169$
;pocket_platformer.c:1400: player.vy = FP_MUL(player.vy, FP(0.75));
	push	de
	push	bc
	ld	de, #0x00c0
	ld	hl, #0x0000
	call	__mullong
	pop	af
	pop	af
	ld	c, l
	ld	b, h
	ld	a, #0x08
00545$:
	sra	b
	rr	c
	rr	d
	rr	e
	dec	a
	jr	NZ, 00545$
	ld	((_player + 12)), de
	ld	((_player + 12)+2), bc
;pocket_platformer.c:1401: if (player.vy > -FP(0.5)) player.vy = 0;
	ld	a, #0x80
	cp	a, e
	ld	a, #0xff
	sbc	a, d
	ld	a, #0xff
	sbc	a, c
	ld	a, #0xff
	sbc	a, b
	jp	PO, 00547$
	xor	a, #0x80
00547$:
	jp	P, 00169$
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
00169$:
;pocket_platformer.c:1403: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1405: static void move_player_x(void) {
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
;pocket_platformer.c:1406: long total_vx = player.vx + tp_carry_vx;
	ld	bc, (#(_player + 8) + 0)
	ld	de, (#(_player + 8) + 2)
	ld	a, c
	ld	hl, #_tp_carry_vx
	add	a, (hl)
	inc	hl
	ld	c, a
	ld	a, b
	adc	a, (hl)
	inc	hl
	ld	b, a
	ld	a, e
	adc	a, (hl)
	inc	hl
	ld	e, a
	ld	a, d
	adc	a, (hl)
	ld	d, a
	ld	-4 (ix), c
	ld	-3 (ix), b
	ld	-2 (ix), e
	ld	-1 (ix), d
;pocket_platformer.c:1407: long new_x = player.x + total_vx;
	ld	de, #_player
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	a, -12 (ix)
	add	a, -4 (ix)
	ld	-8 (ix), a
	ld	a, -11 (ix)
	adc	a, -3 (ix)
	ld	-7 (ix), a
	ld	a, -10 (ix)
	adc	a, -2 (ix)
	ld	-6 (ix), a
	ld	a, -9 (ix)
	adc	a, -1 (ix)
	ld	-5 (ix), a
	ld	hl, #0
	add	hl, sp
	ex	de, hl
	ld	hl, #4
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:1408: long px    = new_x >> 8;
	ld	a, -12 (ix)
	ld	-8 (ix), a
	ld	a, -11 (ix)
	ld	-7 (ix), a
	ld	a, -10 (ix)
	ld	-6 (ix), a
	ld	a, -9 (ix)
	ld	-5 (ix), a
	ld	b, #0x08
00146$:
	sra	-5 (ix)
	rr	-6 (ix)
	rr	-7 (ix)
	rr	-8 (ix)
	djnz	00146$
;pocket_platformer.c:1411: if (is_solid_px(r, player.y + FP(1)) ||
;pocket_platformer.c:1409: if (total_vx > 0) {
	xor	a, a
	cp	a, -4 (ix)
	sbc	a, -3 (ix)
	ld	a, #0x00
	sbc	a, -2 (ix)
	ld	a, #0x00
	sbc	a, -1 (ix)
	jp	PO, 00148$
	xor	a, #0x80
00148$:
	jp	P, 00110$
;pocket_platformer.c:1410: long r = new_x + FP(PLAYER_W);
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
;pocket_platformer.c:1411: if (is_solid_px(r, player.y + FP(1)) ||
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, b
	add	a, #0x01
	ld	b, a
	jr	NC, 00149$
	inc	hl
00149$:
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
;pocket_platformer.c:1412: is_solid_px(r, player.y + FP(PLAYER_H - 2))) {
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, b
	add	a, #0x06
	ld	b, a
	jr	NC, 00150$
	inc	hl
00150$:
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
;pocket_platformer.c:1413: long tile_r = (px + PLAYER_W) / TILE_SIZE;
	ld	a, -8 (ix)
	add	a, #0x06
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
	ld	hl, #4
	add	hl, sp
	ex	de, hl
	ld	hl, #8
	add	hl, sp
	ld	bc, #4
	ldir
	bit	7, -1 (ix)
	jr	Z, 00114$
	ld	a, -4 (ix)
	add	a, #0x07
	ld	-8 (ix), a
	ld	a, -3 (ix)
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
00114$:
	ld	l, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	e, -6 (ix)
	ld	d, -5 (ix)
	ld	b, #0x03
00151$:
	sra	d
	rr	e
	rr	h
	rr	l
	djnz	00151$
;pocket_platformer.c:1414: new_x = (tile_r * TILE_SIZE - PLAYER_W - 1) * FP_ONE;
	ld	b, #0x03
00153$:
	add	hl, hl
	rl	e
	rl	d
	djnz	00153$
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
;pocket_platformer.c:1415: player.vx = 0;
	ld	hl, #0x0000
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1416: barrel_launched = 0;
	ld	hl, #_barrel_launched
	ld	(hl), #0x00
;pocket_platformer.c:1417: barrel_launched_h = 0;
	ld	hl, #_barrel_launched_h
	ld	(hl), #0x00
	jp	00111$
00110$:
;pocket_platformer.c:1419: } else if (total_vx < 0) {
	bit	7, -1 (ix)
	jp	Z, 00111$
;pocket_platformer.c:1420: if (is_solid_px(new_x, player.y + FP(1)) ||
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, b
	add	a, #0x01
	ld	b, a
	jr	NC, 00157$
	inc	hl
00157$:
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
;pocket_platformer.c:1421: is_solid_px(new_x, player.y + FP(PLAYER_H - 2))) {
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, b
	add	a, #0x06
	ld	b, a
	jr	NC, 00158$
	inc	hl
00158$:
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
;pocket_platformer.c:1422: long tile_l = px / TILE_SIZE + 1;
	ld	c, -8 (ix)
	ld	b, -7 (ix)
	ld	l, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	bit	7, -5 (ix)
	jr	Z, 00115$
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
00115$:
	ld	e, c
	ld	d, b
	ld	b, #0x03
00159$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00159$
	inc	e
	jr	NZ, 00161$
	inc	d
	jr	NZ, 00161$
	inc	hl
00161$:
;pocket_platformer.c:1423: new_x = tile_l * TILE_SIZE * FP_ONE;
	ld	h, l
;	spillPairReg hl
;	spillPairReg hl
	ld	l, d
;	spillPairReg hl
;	spillPairReg hl
	ld	d, e
	ld	e, #0x00
	ld	b, #0x03
00162$:
	sla	d
	adc	hl, hl
	djnz	00162$
	inc	sp
	inc	sp
	push	de
	ld	-10 (ix), l
	ld	-9 (ix), h
;pocket_platformer.c:1424: player.vx = 0;
	ld	hl, #0x0000
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1425: barrel_launched = 0;
	ld	hl, #_barrel_launched
	ld	(hl), #0x00
;pocket_platformer.c:1426: barrel_launched_h = 0;
	ld	hl, #_barrel_launched_h
	ld	(hl), #0x00
00111$:
;pocket_platformer.c:1429: player.x = new_x;
	ld	de, #_player
	ld	hl, #0
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:1430: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1432: static void move_player_y(void) {
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
;pocket_platformer.c:1433: long total_vy = player.vy + tp_carry_vy;
	ld	bc, (#(_player + 12) + 0)
	ld	de, (#(_player + 12) + 2)
	ld	a, c
	ld	hl, #_tp_carry_vy
	add	a, (hl)
	inc	hl
	ld	c, a
	ld	a, b
	adc	a, (hl)
	inc	hl
	ld	b, a
	ld	a, e
	adc	a, (hl)
	inc	hl
	ld	e, a
	ld	a, d
	adc	a, (hl)
	ld	d, a
	ld	-20 (ix), c
	ld	-19 (ix), b
	ld	-18 (ix), e
	ld	-17 (ix), d
;pocket_platformer.c:1434: long new_y = player.y + total_vy;
	ld	bc, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	a, -20 (ix)
	add	a, c
	ld	c, a
	ld	a, -19 (ix)
	adc	a, b
	ld	b, a
	ld	a, -18 (ix)
	adc	a, l
	ld	e, a
	ld	a, -17 (ix)
	adc	a, h
	ld	-4 (ix), c
	ld	-3 (ix), b
	ld	-2 (ix), e
	ld	-1 (ix), a
;pocket_platformer.c:1435: long py    = new_y >> 8;
	ld	a, -4 (ix)
	ld	-8 (ix), a
	ld	a, -3 (ix)
	ld	-7 (ix), a
	ld	a, -2 (ix)
	ld	-6 (ix), a
	ld	a, -1 (ix)
	ld	-5 (ix), a
	ld	b, #0x08
00346$:
	sra	-5 (ix)
	rr	-6 (ix)
	rr	-7 (ix)
	rr	-8 (ix)
	djnz	00346$
	ld	hl, #13
	add	hl, sp
	ex	de, hl
	ld	hl, #21
	add	hl, sp
	ld	bc, #4
	ldir
;pocket_platformer.c:1438: if (is_solid_falling_px(player.x + FP(1),            b) ||
	ld	bc, (#_player + 0)
	ld	hl, (#_player + 2)
;pocket_platformer.c:1463: player.jumping = 0;
;pocket_platformer.c:1464: player.wall_jumping = 0;
;pocket_platformer.c:1438: if (is_solid_falling_px(player.x + FP(1),            b) ||
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
;pocket_platformer.c:1436: if (total_vy >= 0) {
	bit	7, -17 (ix)
	jp	NZ, 00133$
;pocket_platformer.c:1437: long b = new_y + FP(PLAYER_H);
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
;pocket_platformer.c:1438: if (is_solid_falling_px(player.x + FP(1),            b) ||
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
;pocket_platformer.c:1439: is_solid_falling_px(player.x + FP(PLAYER_W - 2), b)) {
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	a, d
	add	a, #0x04
	ld	d, a
	jr	NC, 00348$
	inc	hl
00348$:
	push	iy
	push	bc
	call	_is_solid_falling_px
	or	a, a
	jp	Z, 00134$
00108$:
;pocket_platformer.c:1440: long tile_b = (py + PLAYER_H) / TILE_SIZE;
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
	jr	Z, 00143$
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
00143$:
	ld	a, -8 (ix)
	ld	-14 (ix), a
	ld	a, -7 (ix)
	ld	-13 (ix), a
	ld	a, -6 (ix)
	ld	-12 (ix), a
	ld	a, -5 (ix)
	ld	-11 (ix), a
	ld	b, #0x03
00349$:
	sra	-11 (ix)
	rr	-12 (ix)
	rr	-13 (ix)
	rr	-14 (ix)
	djnz	00349$
;pocket_platformer.c:1443: if (res_header->one_way_vram_idx) {
	ld	iy, (_res_header)
	ld	a, 6 (iy)
	or	a, a
	jp	Z, 00106$
;pocket_platformer.c:1444: unsigned char t1 = get_tile(
	ld	a, -14 (ix)
	ld	-5 (ix), a
	ld	bc, (#_player + 0)
	ld	de, (#_player + 2)
	ld	a, #0x08
00351$:
	sra	d
	rr	e
	rr	b
	rr	c
	dec	a
	jr	NZ, 00351$
	ld	-9 (ix), c
	ld	-8 (ix), b
	ld	-7 (ix), e
	ld	-6 (ix), d
	bit	7, d
	jr	Z, 00144$
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
00144$:
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
;pocket_platformer.c:1447: unsigned char t2 = get_tile(
	ld	a, -5 (ix)
	ld	-9 (ix), a
	ld	bc, (#_player + 0)
	ld	de, (#_player + 2)
	ld	a, #0x08
00353$:
	sra	d
	rr	e
	rr	b
	rr	c
	dec	a
	jr	NZ, 00353$
	ld	-8 (ix), c
	ld	-7 (ix), b
	ld	-6 (ix), e
	ld	-5 (ix), d
	bit	7, d
	jr	Z, 00145$
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
00145$:
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
;pocket_platformer.c:1443: if (res_header->one_way_vram_idx) {
	ld	iy, (_res_header)
;pocket_platformer.c:1450: unsigned char is_one_way =
	ld	b, 6 (iy)
	ld	a, -10 (ix)
	sub	a, b
	jr	Z, 00147$
	ld	a, c
	sub	a, b
	jr	Z, 00147$
	xor	a, a
	jr	00148$
00147$:
	ld	a, #0x01
00148$:
;pocket_platformer.c:1453: if (is_one_way) {
	or	a, a
	jr	Z, 00106$
;pocket_platformer.c:1454: long prev_feet = player.y + FP(PLAYER_H);
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
;pocket_platformer.c:1455: long tile_top  = tile_b * TILE_SIZE * FP_ONE;
	ld	d, -14 (ix)
	ld	l, -13 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -12 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	e, #0x00
	ld	b, #0x03
00357$:
	sla	d
	adc	hl, hl
	djnz	00357$
;pocket_platformer.c:1456: if (prev_feet > tile_top) goto skip_land;
	ld	a, e
	sub	a, -8 (ix)
	ld	a, d
	sbc	a, -7 (ix)
	ld	a, l
	sbc	a, -6 (ix)
	ld	a, h
	sbc	a, -5 (ix)
	jp	PO, 00359$
	xor	a, #0x80
00359$:
	jp	M, 00134$
00106$:
;pocket_platformer.c:1459: new_y = (tile_b * TILE_SIZE - PLAYER_H) * FP_ONE;
	ld	a, -14 (ix)
	ld	e, -13 (ix)
	ld	l, -12 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -11 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	b, #0x03
00360$:
	add	a, a
	rl	e
	adc	hl, hl
	djnz	00360$
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
;pocket_platformer.c:1460: player.vy = 0;
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
;pocket_platformer.c:1461: player.on_ground = 1;
	ld	hl, #(_player + 16)
	ld	(hl), #0x01
;pocket_platformer.c:1462: player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
;pocket_platformer.c:1463: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:1464: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:1465: player.double_jump_used = 0;
	ld	hl, #(_player + 24)
	ld	(hl), #0x00
;pocket_platformer.c:1466: barrel_launched = 0;
	ld	hl, #_barrel_launched
	ld	(hl), #0x00
;pocket_platformer.c:1467: barrel_launched_h = 0;
	ld	hl, #_barrel_launched_h
	ld	(hl), #0x00
;pocket_platformer.c:1468: skip_land:;
	jp	00134$
00133$:
;pocket_platformer.c:1471: if (is_solid_px(player.x + FP(1),            new_y) ||
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
	jr	NZ, 00129$
;pocket_platformer.c:1472: is_solid_px(player.x + FP(PLAYER_W - 2), new_y)) {
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	a, d
	add	a, #0x04
	ld	d, a
	jr	NC, 00364$
	inc	hl
00364$:
	ld	c, -2 (ix)
	ld	b, -1 (ix)
	push	bc
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	push	bc
	call	_is_solid_px
	or	a, a
	jp	Z, 00134$
00129$:
;pocket_platformer.c:1473: long tile_t = py / TILE_SIZE + 1;
	ld	l, -16 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -15 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	e, -14 (ix)
	ld	d, -13 (ix)
	bit	7, -13 (ix)
	jr	Z, 00149$
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
00149$:
	ld	b, #0x03
00365$:
	sra	d
	rr	e
	rr	h
	rr	l
	djnz	00365$
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
;pocket_platformer.c:1476: if (!rb_switch_locked && res_header->switch_vram_idx) {
	ld	a, (_rb_switch_locked+0)
	or	a, a
	jp	NZ, 00125$
	ld	hl, (_res_header)
	ld	de, #0x000d
	add	hl, de
	ld	a, (hl)
	or	a, a
	jp	Z, 00125$
;pocket_platformer.c:1477: unsigned char htx_l = (unsigned char)((player.x >> 8) / TILE_SIZE);
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
	ld	-4 (ix), c
	ld	-3 (ix), b
	ld	-2 (ix), e
	ld	-1 (ix), d
	bit	7, d
	jr	Z, 00150$
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
00150$:
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
;pocket_platformer.c:1478: unsigned char htx_r = (unsigned char)(((player.x >> 8) + PLAYER_W) / TILE_SIZE);
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
	jr	Z, 00151$
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
00151$:
	ld	c, -4 (ix)
	ld	b, -3 (ix)
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
;pocket_platformer.c:1479: unsigned char hty   = (unsigned char)(tile_t - 1);  /* ceiling row */
	ld	a, -29 (ix)
	dec	a
	ld	b, a
;pocket_platformer.c:1480: unsigned char tl = get_tile(htx_l, hty);
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, h
	call	_get_tile
	pop	bc
	ld	-1 (ix), a
;pocket_platformer.c:1481: unsigned char tr = get_tile(htx_r, hty);
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_get_tile
	ld	c, a
;pocket_platformer.c:1443: if (res_header->one_way_vram_idx) {
	ld	iy, (_res_header)
;pocket_platformer.c:1482: if ((tl == res_header->switch_vram_idx || tl == res_header->switch_blue_vram_idx ||
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
;pocket_platformer.c:1483: tr == res_header->switch_vram_idx || tr == res_header->switch_blue_vram_idx)) {
	ld	a,c
	cp	a,e
	jr	Z, 00119$
	sub	a, b
	jp	NZ,00125$
00119$:
;pocket_platformer.c:1485: rb_red_active = !rb_red_active;
	ld	a, (_rb_red_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
	ld	(_rb_red_active+0), a
;pocket_platformer.c:1486: rb_redraw_all();
	call	_rb_redraw_all
;pocket_platformer.c:1443: if (res_header->one_way_vram_idx) {
	ld	hl, (_res_header)
	ld	-2 (ix), l
	ld	-1 (ix), h
;pocket_platformer.c:1489: unsigned char sw_idx = rb_red_active
	ld	a, (_rb_red_active+0)
	or	a, a
	jr	Z, 00152$
	ld	c, -2 (ix)
	ld	b, -1 (ix)
	ld	hl, #13
	add	hl, bc
	ld	c, (hl)
	jr	00153$
00152$:
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	de, #0x000e
	add	hl, de
	ld	c, (hl)
00153$:
	ld	b, c
;pocket_platformer.c:1492: unsigned int sw_vt = sw_idx
	ld	a, c
	or	a, a
	jr	Z, 00154$
	ld	c, b
	ld	b, #0x00
	jr	00155$
00154$:
	ld	bc, #0x0000
00155$:
;pocket_platformer.c:1494: for (si = 0; si < rb_switch_count; si++) {
	ld	e, #0x00
00136$:
	ld	hl, #_rb_switch_count
	ld	a, e
	sub	a, (hl)
	jr	NC, 00111$
;pocket_platformer.c:1495: SMS_setNextTileatXY(rb_switches[si].tx % SCREEN_TILES_W,
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
;pocket_platformer.c:1497: SMS_setTile(sw_vt);
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x18
;pocket_platformer.c:1494: for (si = 0; si < rb_switch_count; si++) {
	inc	e
	jr	00136$
00111$:
;pocket_platformer.c:1503: long ppx = player.x >> 8, ppy = new_y >> 8;
	ld	bc, (#_player + 0)
	ld	de, (#_player + 2)
	ld	a, #0x08
00375$:
	sra	d
	rr	e
	rr	b
	rr	c
	dec	a
	jr	NZ, 00375$
	ld	a, -8 (ix)
	ld	-25 (ix), a
	ld	a, -7 (ix)
	ld	-24 (ix), a
	ld	a, -6 (ix)
	ld	-23 (ix), a
	ld	a, -5 (ix)
	ld	-22 (ix), a
;pocket_platformer.c:1504: for (b = 0; b < rb_block_count; b++) {
	ld	a, -25 (ix)
	add	a, #0x08
	ld	-21 (ix), a
	ld	a, -24 (ix)
	adc	a, #0x00
	ld	-20 (ix), a
	ld	a, -23 (ix)
	adc	a, #0x00
	ld	-19 (ix), a
	ld	a, -22 (ix)
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
00139$:
	ld	hl, #_rb_block_count
	ld	a, -1 (ix)
	sub	a, (hl)
	jp	NC, 00118$
;pocket_platformer.c:1505: long bx = (long)rb_blocks[b].tx * TILE_SIZE;
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
00377$:
	sla	-13 (ix)
	rl	-12 (ix)
	rl	-11 (ix)
	rl	-10 (ix)
	dec	a
	jr	NZ,00377$
;pocket_platformer.c:1506: long by = (long)rb_blocks[b].ty * TILE_SIZE;
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
00379$:
	sla	-9 (ix)
	rl	-8 (ix)
	rl	-7 (ix)
	rl	-6 (ix)
	dec	a
	jr	NZ,00379$
;pocket_platformer.c:1507: unsigned char solid = rb_blocks[b].is_red ? rb_red_active : !rb_red_active;
	ld	a, 2 (iy)
	or	a, a
	jr	Z, 00156$
	ld	a, (_rb_red_active+0)
	jr	00157$
00156$:
	ld	a, (_rb_red_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
00157$:
;pocket_platformer.c:1508: if (solid &&
	or	a, a
	jp	Z, 00140$
;pocket_platformer.c:1509: ppx + PLAYER_W > bx && ppx < bx + TILE_SIZE &&
	ld	a, -13 (ix)
	sub	a, -17 (ix)
	ld	a, -12 (ix)
	sbc	a, -16 (ix)
	ld	a, -11 (ix)
	sbc	a, -15 (ix)
	ld	a, -10 (ix)
	sbc	a, -14 (ix)
	jp	PO, 00381$
	xor	a, #0x80
00381$:
	jp	P, 00140$
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
	jp	PO, 00382$
	xor	a, #0x80
00382$:
	jp	P, 00140$
;pocket_platformer.c:1510: ppy + PLAYER_H > by && ppy < by + TILE_SIZE)
	ld	a, -9 (ix)
	sub	a, -21 (ix)
	ld	a, -8 (ix)
	sbc	a, -20 (ix)
	ld	a, -7 (ix)
	sbc	a, -19 (ix)
	ld	a, -6 (ix)
	sbc	a, -18 (ix)
	jp	PO, 00383$
	xor	a, #0x80
00383$:
	jp	P, 00140$
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
	jp	PO, 00384$
	xor	a, #0x80
00384$:
	jp	P, 00140$
;pocket_platformer.c:1511: player_died = 1;
	ld	hl, #_player_died
	ld	(hl), #0x01
00140$:
;pocket_platformer.c:1504: for (b = 0; b < rb_block_count; b++) {
	inc	-1 (ix)
	jp	00139$
00118$:
;pocket_platformer.c:1514: rb_switch_locked = 1;
	ld	hl, #_rb_switch_locked
	ld	(hl), #0x01
00125$:
;pocket_platformer.c:1517: new_y = tile_t * TILE_SIZE * FP_ONE;
	ld	a, -29 (ix)
	ld	-3 (ix), a
	ld	a, -28 (ix)
	ld	-2 (ix), a
	ld	a, -27 (ix)
	ld	-1 (ix), a
	ld	-4 (ix), #0x00
	ld	b, #0x03
00385$:
	sla	-3 (ix)
	rl	-2 (ix)
	rl	-1 (ix)
	djnz	00385$
;pocket_platformer.c:1518: player.vy = 0;
	ld	hl, #0x0000
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
;pocket_platformer.c:1519: player.jumping = 0;
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
;pocket_platformer.c:1520: player.wall_jumping = 0;
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
;pocket_platformer.c:1521: player.jump_frames = res_physics->max_jump_frames;
	ld	hl, (_res_physics)
	ld	de, #0x000c
	add	hl, de
	ld	a, (hl)
	ld	(#(_player + 22)),a
;pocket_platformer.c:1523: if (tp_carry_vy < 0) player_died = 1;
	ld	a, (_tp_carry_vy+3)
	bit	7, a
	jr	Z, 00134$
	ld	hl, #_player_died
	ld	(hl), #0x01
00134$:
;pocket_platformer.c:1526: player.y = new_y;
	ld	de, #(_player + 4)
	ld	hl, #25
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:1527: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1532: static void check_object_collisions(void) {
;	---------------------------------
; Function check_object_collisions
; ---------------------------------
_check_object_collisions:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-35
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:1533: long px = player.x >> 8, py = player.y >> 8;
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	b, #0x08
00392$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00392$
	ld	-27 (ix), e
	ld	-26 (ix), d
	ld	-25 (ix), l
	ld	-24 (ix), h
	ld	de, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	b, #0x08
00394$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00394$
	ld	-23 (ix), e
	ld	-22 (ix), d
	ld	-21 (ix), l
	ld	-20 (ix), h
;pocket_platformer.c:1535: unsigned char obj_count = cur_level->obj_count < MAX_OBJECTS
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	a, (hl)
	cp	a, #0x80
	jr	C, 00165$
	ld	a, #0x80
00165$:
	ld	-19 (ix), a
;pocket_platformer.c:1537: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:1538: for (i = 0; i < obj_count; i++) {
	ld	a, -23 (ix)
	add	a, #0x08
	ld	-18 (ix), a
	ld	a, -22 (ix)
	adc	a, #0x00
	ld	-17 (ix), a
	ld	a, -21 (ix)
	adc	a, #0x00
	ld	-16 (ix), a
	ld	a, -20 (ix)
	adc	a, #0x00
	ld	-15 (ix), a
	ld	a, -27 (ix)
	add	a, #0x06
	ld	-14 (ix), a
	ld	a, -26 (ix)
	adc	a, #0x00
	ld	-13 (ix), a
	ld	a, -25 (ix)
	adc	a, #0x00
	ld	-12 (ix), a
	ld	a, -24 (ix)
	adc	a, #0x00
	ld	-11 (ix), a
	ld	-3 (ix), #0x00
00161$:
	ld	a, -3 (ix)
	sub	a, -19 (ix)
	jp	NC, 00162$
;pocket_platformer.c:1539: level_object *obj = &cur_objects[i];
	ld	c, -3 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ex	de, hl
	ld	hl, (_cur_objects)
	add	hl, de
;pocket_platformer.c:1540: long ox = (long)obj->x * TILE_SIZE;
	ld	-10 (ix), l
	ld	-9 (ix), h
	ld	l, (hl)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	xor	a, a
	ld	h, a
	ld	c, a
	ld	b, #0x03
00396$:
	add	hl, hl
	adc	a, a
	rl	c
	djnz	00396$
	ld	-31 (ix), l
	ld	-30 (ix), h
	ld	-29 (ix), a
	ld	-28 (ix), c
;pocket_platformer.c:1541: long oy = (long)(obj->type == OBJ_BARREL ? (obj->y & 0x3F) : obj->y) * TILE_SIZE;
	ld	c, -10 (ix)
	ld	b, -9 (ix)
	inc	bc
	inc	bc
	ld	a, (bc)
	ld	-8 (ix), a
	ld	c, -10 (ix)
	ld	b, -9 (ix)
	inc	bc
	ld	a, (bc)
	ld	-7 (ix), a
	ld	a, -8 (ix)
	sub	a, #0x0e
	ld	a, #0x01
	jr	Z, 00399$
	xor	a, a
00399$:
	ld	-6 (ix), a
	ld	a, -7 (ix)
	ld	-5 (ix), a
	ld	-4 (ix), #0x00
	ld	a, -6 (ix)
	or	a, a
	jr	Z, 00166$
	ld	a, -5 (ix)
	and	a, #0x3f
	ld	-2 (ix), a
	ld	-1 (ix), #0x00
	jr	00167$
00166$:
	ld	a, -5 (ix)
	ld	-2 (ix), a
	ld	a, -4 (ix)
	ld	-1 (ix), a
00167$:
	ld	e, -2 (ix)
	ld	a, -1 (ix)
	ld	d, a
	rlca
	sbc	hl, hl
	ld	b, #0x03
00400$:
	sla	e
	rl	d
	adc	hl, hl
	djnz	00400$
	inc	sp
	inc	sp
	push	de
	ld	-33 (ix), l
	ld	-32 (ix), h
;pocket_platformer.c:1542: if (px + PLAYER_W <= ox || px >= ox + TILE_SIZE) continue;
	ld	a, -31 (ix)
	sub	a, -14 (ix)
	ld	a, -30 (ix)
	sbc	a, -13 (ix)
	ld	a, -29 (ix)
	sbc	a, -12 (ix)
	ld	a, -28 (ix)
	sbc	a, -11 (ix)
	jp	PO, 00402$
	xor	a, #0x80
00402$:
	jp	P, 00139$
	ld	a, -31 (ix)
	add	a, #0x08
	ld	c, a
	ld	a, -30 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -29 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -28 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -27 (ix)
	sub	a, c
	ld	a, -26 (ix)
	sbc	a, b
	ld	a, -25 (ix)
	sbc	a, e
	ld	a, -24 (ix)
	sbc	a, d
	jp	PO, 00403$
	xor	a, #0x80
00403$:
	jp	P, 00139$
;pocket_platformer.c:1543: if (py + PLAYER_H <= oy || py >= oy + TILE_SIZE) continue;
	ld	a, -35 (ix)
	sub	a, -18 (ix)
	ld	a, -34 (ix)
	sbc	a, -17 (ix)
	ld	a, -33 (ix)
	sbc	a, -16 (ix)
	ld	a, -32 (ix)
	sbc	a, -15 (ix)
	jp	PO, 00404$
	xor	a, #0x80
00404$:
	jp	P, 00139$
	ld	a, -35 (ix)
	add	a, #0x08
	ld	c, a
	ld	a, -34 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -33 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -32 (ix)
	adc	a, #0x00
	ld	d, a
	ld	a, -23 (ix)
	sub	a, c
	ld	a, -22 (ix)
	sbc	a, b
	ld	a, -21 (ix)
	sbc	a, e
	ld	a, -20 (ix)
	sbc	a, d
	jp	PO, 00405$
	xor	a, #0x80
00405$:
	jp	P, 00139$
;pocket_platformer.c:1544: switch (obj->type) {
	ld	a, -8 (ix)
	sub	a, #0x02
	jr	Z, 00107$
	ld	a, -8 (ix)
	sub	a, #0x03
	jp	Z,00139$
	ld	a, -8 (ix)
	sub	a, #0x04
	jp	Z,00128$
	ld	a, -8 (ix)
	sub	a, #0x05
	jp	Z,00135$
	ld	a, -8 (ix)
	sub	a, #0x0c
	jr	Z, 00108$
	ld	a, -8 (ix)
	sub	a, #0x0d
	jr	Z, 00117$
	ld	a, -6 (ix)
	or	a, a
	jr	NZ, 00114$
	jp	00139$
;pocket_platformer.c:1545: case OBJ_FINISH_FLAG: level_complete = 1; break;
00107$:
	ld	hl, #_level_complete
	ld	(hl), #0x01
	jp	00139$
;pocket_platformer.c:1546: case OBJ_FINISH_FLAG_LOCKED:
00108$:
;pocket_platformer.c:1547: if (!coins_remaining()) level_complete = 1;
	call	_coins_remaining
	or	a, a
	jp	NZ, 00139$
	ld	hl, #_level_complete
	ld	(hl), #0x01
;pocket_platformer.c:1548: break;
	jp	00139$
;pocket_platformer.c:1552: case OBJ_BARREL:
00114$:
;pocket_platformer.c:1553: if (!barrel_active) barrel_enter(obj);
	ld	a, (_barrel_active+0)
	or	a, a
	jp	NZ, 00139$
	ld	l, -10 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	_barrel_enter
;pocket_platformer.c:1554: break;
	jp	00139$
;pocket_platformer.c:1555: case OBJ_NPC:
00117$:
;pocket_platformer.c:1556: if (!dialogue_active) {
	ld	a, (_dialogue_active+0)
	or	a, a
	jp	NZ, 00139$
;pocket_platformer.c:1560: for (k = 0; k < i; k++)
	ld	-1 (ix), #0x00
	ld	-2 (ix), #0x00
00142$:
	ld	a, -2 (ix)
	sub	a, -3 (ix)
	jr	NC, 00205$
;pocket_platformer.c:1561: if (cur_objects[k].type == OBJ_NPC) ni++;
	ld	c, -2 (ix)
	ld	b, #0x00
	ld	l, c
	ld	h, b
	add	hl, hl
	add	hl, bc
	ld	-7 (ix), l
	ld	-6 (ix), h
	ld	a, -7 (ix)
	ld	hl, #_cur_objects
	add	a, (hl)
	ld	-5 (ix), a
	ld	a, -6 (ix)
	inc	hl
	adc	a, (hl)
	ld	-4 (ix), a
	ld	l, -5 (ix)
	ld	h, -4 (ix)
	inc	hl
	inc	hl
	ld	a, (hl)
	sub	a, #0x0d
	jr	NZ, 00143$
	inc	-1 (ix)
00143$:
;pocket_platformer.c:1560: for (k = 0; k < i; k++)
	inc	-2 (ix)
	jr	00142$
00205$:
	ld	a, -1 (ix)
	ld	-10 (ix), a
;pocket_platformer.c:1562: npc_contact_idx   = ni;
	ld	a, -1 (ix)
	ld	(_npc_contact_idx+0), a
;pocket_platformer.c:1563: npc_contact_level = level_n_global;
	ld	a, (_level_n_global+0)
	ld	(_npc_contact_level+0), a
;pocket_platformer.c:1565: p = get_npc_table();
	call	_get_npc_table
	ld	-9 (ix), e
	ld	-8 (ix), d
;pocket_platformer.c:1568: for (li = 0; li < level_n_global; li++) {
	ld	-2 (ix), #0x00
00151$:
;pocket_platformer.c:1569: unsigned char cnt = *p++;
	ld	c, -9 (ix)
	ld	b, -8 (ix)
	inc	bc
	ld	l, -9 (ix)
	ld	h, -8 (ix)
	ld	a, (hl)
	ld	-1 (ix), a
;pocket_platformer.c:1568: for (li = 0; li < level_n_global; li++) {
	ld	hl, #_level_n_global
	ld	a, -2 (ix)
	sub	a, (hl)
	jr	NC, 00123$
;pocket_platformer.c:1569: unsigned char cnt = *p++;
	ld	-9 (ix), c
	ld	-8 (ix), b
	ld	c, -1 (ix)
;pocket_platformer.c:1571: for (nj = 0; nj < cnt; nj++) {
	ld	-1 (ix), #0x00
00148$:
	ld	a, -1 (ix)
	sub	a, c
	jr	NC, 00152$
;pocket_platformer.c:1573: p++;
	ld	e, -9 (ix)
	ld	d, -8 (ix)
	inc	de
;pocket_platformer.c:1574: lines = *p++;
	ld	a, (de)
	ld	-7 (ix), a
	inc	de
	ld	-9 (ix), e
	ld	-8 (ix), d
;pocket_platformer.c:1575: for (ll = 0; ll < lines; ll++) { unsigned char ln = *p++; p += ln; }
	ld	e, #0x00
00145$:
	ld	a, e
	sub	a, -7 (ix)
	jr	NC, 00149$
	ld	l, -9 (ix)
	ld	h, -8 (ix)
	ld	a, (hl)
	ld	-6 (ix), a
	ld	a, -9 (ix)
	add	a, #0x01
	ld	-5 (ix), a
	ld	a, -8 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -5 (ix)
	add	a, -6 (ix)
	ld	-9 (ix), a
	ld	a, -4 (ix)
	adc	a, #0x00
	ld	-8 (ix), a
	inc	e
	jr	00145$
00149$:
;pocket_platformer.c:1571: for (nj = 0; nj < cnt; nj++) {
	inc	-1 (ix)
	jr	00148$
00152$:
;pocket_platformer.c:1568: for (li = 0; li < level_n_global; li++) {
	inc	-2 (ix)
	jp	00151$
00123$:
;pocket_platformer.c:1579: { unsigned char cnt = *p++;
	ld	-6 (ix), c
	ld	-5 (ix), b
	ld	a, -1 (ix)
	ld	-4 (ix), a
;pocket_platformer.c:1581: for (nj = 0; nj < cnt && nj < ni; nj++) {
	ld	-1 (ix), #0x00
00158$:
	ld	a, -1 (ix)
	sub	a, -4 (ix)
	jr	NC, 00125$
	ld	a, -1 (ix)
	sub	a, -10 (ix)
	jr	NC, 00125$
;pocket_platformer.c:1583: p++;
	ld	e, -6 (ix)
	ld	d, -5 (ix)
	inc	de
;pocket_platformer.c:1584: lines = *p++;
	ld	a, (de)
	ld	c, a
	inc	de
	ld	-6 (ix), e
	ld	-5 (ix), d
;pocket_platformer.c:1585: for (ll = 0; ll < lines; ll++) { unsigned char ln = *p++; p += ln; }
	ld	e, #0x00
00154$:
	ld	a, e
	sub	a, c
	jr	NC, 00159$
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	a, (hl)
	ld	l, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	add	a, l
	ld	-6 (ix), a
	ld	a, #0x00
	adc	a, h
	ld	-5 (ix), a
	inc	e
	jr	00154$
00159$:
;pocket_platformer.c:1581: for (nj = 0; nj < cnt && nj < ni; nj++) {
	inc	-1 (ix)
	jr	00158$
00125$:
;pocket_platformer.c:1588: npc_contact_auto = *p; /* play_automatically byte */
	ld	l, -6 (ix)
	ld	h, -5 (ix)
	ld	a, (hl)
	ld	(_npc_contact_auto+0), a
;pocket_platformer.c:1590: break;
	jp	00139$
;pocket_platformer.c:1591: case OBJ_TRAMPOLINE:
00128$:
;pocket_platformer.c:1592: if (player.vy >= 0) {
	ld	bc, (#_player + 12)
	ld	hl, (#_player + 14)
	bit	7, h
	jp	NZ, 00139$
;pocket_platformer.c:1593: long tramp_mid = (long)obj->y * TILE_SIZE + TILE_SIZE / 2;
	ld	a, -7 (ix)
	ld	-31 (ix), a
	xor	a, a
	ld	-30 (ix), a
	ld	-29 (ix), a
	ld	-28 (ix), a
	ld	a, -31 (ix)
	ld	-7 (ix), a
	ld	a, -30 (ix)
	ld	-6 (ix), a
	ld	a, -29 (ix)
	ld	-5 (ix), a
	ld	a, -28 (ix)
	ld	-4 (ix), a
	ld	b, #0x03
00414$:
	sla	-7 (ix)
	rl	-6 (ix)
	rl	-5 (ix)
	rl	-4 (ix)
	djnz	00414$
	ld	a, -7 (ix)
	add	a, #0x04
	ld	-35 (ix), a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	-34 (ix), a
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	-33 (ix), a
	ld	a, -4 (ix)
	adc	a, #0x00
	ld	-32 (ix), a
;pocket_platformer.c:1594: if ((player.y >> 8) + PLAYER_H <= tramp_mid + 2) {
	ld	de, #(_player + 4)
	ld	hl, #28
	add	hl, sp
	ex	de, hl
	ld	bc, #0x0004
	ldir
	ld	b, #0x08
00416$:
	sra	-4 (ix)
	rr	-5 (ix)
	rr	-6 (ix)
	rr	-7 (ix)
	djnz	00416$
	ld	a, -7 (ix)
	add	a, #0x08
	ld	-31 (ix), a
	ld	a, -6 (ix)
	adc	a, #0x00
	ld	-30 (ix), a
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	-29 (ix), a
	ld	a, -4 (ix)
	adc	a, #0x00
	ld	-28 (ix), a
	ld	a, -35 (ix)
	add	a, #0x02
	ld	-7 (ix), a
	ld	a, -34 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, -33 (ix)
	adc	a, #0x00
	ld	-5 (ix), a
	ld	a, -32 (ix)
	adc	a, #0x00
	ld	-4 (ix), a
	ld	a, -7 (ix)
	sub	a, -31 (ix)
	ld	a, -6 (ix)
	sbc	a, -30 (ix)
	ld	a, -5 (ix)
	sbc	a, -29 (ix)
	ld	a, -4 (ix)
	sbc	a, -28 (ix)
	jp	PO, 00418$
	xor	a, #0x80
00418$:
	jp	M, 00139$
;pocket_platformer.c:1595: long base = (long)res_physics->jump_speed;
	ld	hl, (_res_physics)
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	de, #0x000a
	add	hl, de
	ld	a, (hl)
	ld	-2 (ix), a
	inc	hl
	ld	a, (hl)
	ld	-1 (ix), a
	ld	a, -2 (ix)
	ld	-35 (ix), a
	ld	a, -1 (ix)
	ld	-34 (ix), a
	rlca
	sbc	a, a
	ld	-33 (ix), a
	ld	-32 (ix), a
;pocket_platformer.c:1596: player.forced_jump_speed = base + base * 4 / 15;
	ld	a, -35 (ix)
	ld	-7 (ix), a
	ld	a, -34 (ix)
	ld	-6 (ix), a
	ld	a, -33 (ix)
	ld	-5 (ix), a
	ld	a, -32 (ix)
	ld	-4 (ix), a
	ld	b, #0x02
00419$:
	sla	-7 (ix)
	rl	-6 (ix)
	rl	-5 (ix)
	rl	-4 (ix)
	djnz	00419$
	ld	hl, #0x0000
	push	hl
	ld	l, #0x0f
	push	hl
	ld	e, -7 (ix)
	ld	d, -6 (ix)
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	call	__divslong
	pop	af
	pop	af
	ld	-31 (ix), e
	ld	-30 (ix), d
	ld	-29 (ix), l
	ld	-28 (ix), h
	ld	a, -31 (ix)
	add	a, -35 (ix)
	ld	-7 (ix), a
	ld	a, -30 (ix)
	adc	a, -34 (ix)
	ld	-6 (ix), a
	ld	a, -29 (ix)
	adc	a, -33 (ix)
	ld	-5 (ix), a
	ld	a, -28 (ix)
	adc	a, -32 (ix)
	ld	-4 (ix), a
	ld	de, #(_player + 27)
	ld	hl, #28
	add	hl, sp
	ld	bc, #0x0004
	ldir
;pocket_platformer.c:1597: player.jumping = 1;
	ld	hl, #(_player + 18)
	ld	(hl), #0x01
;pocket_platformer.c:1598: player.jump_frames = 0;
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
;pocket_platformer.c:1599: player.falling = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x00
;pocket_platformer.c:1600: player.on_ground = 0;
	ld	hl, #(_player + 16)
	ld	(hl), #0x00
;pocket_platformer.c:1601: player.double_jump_used = 0;
	ld	hl, #(_player + 24)
	ld	(hl), #0x00
;pocket_platformer.c:1602: if (vp_block_count) vp_toggle();
	ld	a, (_vp_block_count+0)
	or	a, a
	jr	Z, 00139$
	call	_vp_toggle
;pocket_platformer.c:1605: break;
	jr	00139$
;pocket_platformer.c:1606: case OBJ_COIN:
00135$:
;pocket_platformer.c:1607: if (!coin_collected[i]) coin_collected[i] = 1; break;
	ld	a, #<(_coin_collected)
	add	a, -3 (ix)
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, #>(_coin_collected)
	adc	a, #0x00
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, (hl)
	or	a, a
	jr	NZ, 00139$
	ld	(hl), #0x01
;pocket_platformer.c:1608: }
00139$:
;pocket_platformer.c:1538: for (i = 0; i < obj_count; i++) {
	inc	-3 (ix)
	jp	00161$
00162$:
;pocket_platformer.c:1610: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1625: static unsigned char vp_is_passable(unsigned char tx, unsigned char ty) {
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
;pocket_platformer.c:1627: for (i = 0; i < vp_block_count; i++) {
	ld	c, #0x00
00106$:
	ld	hl, #_vp_block_count
	ld	a, c
	sub	a, (hl)
	jr	NC, 00104$
;pocket_platformer.c:1628: if (vp_blocks[i].tx == tx && vp_blocks[i].ty == ty) {
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
;pocket_platformer.c:1631: return vp_blocks[i].is_violet ? !vp_violet_active : vp_violet_active;
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
;pocket_platformer.c:1627: for (i = 0; i < vp_block_count; i++) {
	inc	c
	jr	00106$
00104$:
;pocket_platformer.c:1634: return 0;
	xor	a, a
00108$:
;pocket_platformer.c:1635: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1638: static void vp_toggle(void) {
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
;pocket_platformer.c:1640: vp_violet_active = !vp_violet_active;
	ld	a, (_vp_violet_active+0)
	sub	a,#0x01
	ld	a, #0x00
	rla
	ld	(_vp_violet_active+0), a
;pocket_platformer.c:1641: for (i = 0; i < vp_block_count; i++) {
	ld	-1 (ix), #0x00
00113$:
	ld	hl, #_vp_block_count
	ld	a, -1 (ix)
	sub	a, (hl)
	jp	NC, 00115$
;pocket_platformer.c:1642: unsigned char tx    = vp_blocks[i].tx;
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
;pocket_platformer.c:1643: unsigned char ty    = vp_blocks[i].ty;
	ld	a, -5 (ix)
	ld	-7 (ix), a
	ld	a, -4 (ix)
	ld	-6 (ix), a
	ld	l, -7 (ix)
	ld	h, -6 (ix)
	inc	hl
	ld	a, (hl)
	ld	-2 (ix), a
;pocket_platformer.c:1644: unsigned char solid = vp_blocks[i].is_violet ? vp_violet_active : !vp_violet_active;
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
;pocket_platformer.c:1648: idx = solid ? res_header->vio_solid_vram_idx : res_header->vio_ghost_vram_idx;
	ld	hl, (_res_header)
	ld	-5 (ix), l
	ld	-4 (ix), h
;pocket_platformer.c:1647: if (vp_blocks[i].is_violet)
	ld	a, c
	or	a, a
	jr	Z, 00102$
;pocket_platformer.c:1648: idx = solid ? res_header->vio_solid_vram_idx : res_header->vio_ghost_vram_idx;
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
;pocket_platformer.c:1650: idx = solid ? res_header->pink_solid_vram_idx : res_header->pink_ghost_vram_idx;
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
;pocket_platformer.c:1651: vt = idx ? (unsigned int)(VRAM_BG_BASE + idx - 1) : 0u;
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
;pocket_platformer.c:1652: SMS_setNextTileatXY(tx % SCREEN_TILES_W, ty);
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
;pocket_platformer.c:1653: SMS_setTile(vt);
	ex	de, hl
	rst	#0x18
;pocket_platformer.c:1655: if (solid) {
	ld	a, -6 (ix)
	or	a, a
	jp	Z, 00114$
;pocket_platformer.c:1656: long px = player.x >> 8, py = player.y >> 8;
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
;pocket_platformer.c:1657: long bx = (long)tx * TILE_SIZE, by = (long)ty * TILE_SIZE;
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
;pocket_platformer.c:1658: if (px + PLAYER_W > bx && px < bx + TILE_SIZE &&
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
;pocket_platformer.c:1659: py + PLAYER_H > by && py < by + TILE_SIZE)
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
;pocket_platformer.c:1660: player_died = 1;
	ld	hl, #_player_died
	ld	(hl), #0x01
00114$:
;pocket_platformer.c:1641: for (i = 0; i < vp_block_count; i++) {
	inc	-1 (ix)
	jp	00113$
00115$:
;pocket_platformer.c:1663: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1666: static unsigned char rb_is_passable(unsigned char tx, unsigned char ty) {
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
;pocket_platformer.c:1668: for (i = 0; i < rb_block_count; i++) {
	ld	c, #0x00
00106$:
	ld	hl, #_rb_block_count
	ld	a, c
	sub	a, (hl)
	jr	NC, 00104$
;pocket_platformer.c:1669: if (rb_blocks[i].tx == tx && rb_blocks[i].ty == ty) {
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
;pocket_platformer.c:1671: return rb_blocks[i].is_red ? !rb_red_active : rb_red_active;
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
;pocket_platformer.c:1668: for (i = 0; i < rb_block_count; i++) {
	inc	c
	jr	00106$
00104$:
;pocket_platformer.c:1674: return 0;
	xor	a, a
00108$:
;pocket_platformer.c:1675: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1677: static unsigned int rb_vram_for_block(unsigned char is_red, unsigned char solid) {
;	---------------------------------
; Function rb_vram_for_block
; ---------------------------------
_rb_vram_for_block:
;pocket_platformer.c:1680: idx = solid ? res_header->red_solid_vram_idx  : res_header->red_ghost_vram_idx;
;pocket_platformer.c:1679: if (is_red)
	ld	de, (_res_header)
	or	a, a
	jr	Z, 00102$
;pocket_platformer.c:1680: idx = solid ? res_header->red_solid_vram_idx  : res_header->red_ghost_vram_idx;
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
;pocket_platformer.c:1682: idx = solid ? res_header->blue_solid_vram_idx : res_header->blue_ghost_vram_idx;
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
;pocket_platformer.c:1683: return idx ? (unsigned int)(VRAM_BG_BASE + idx - 1) : 0u;
	or	a, a
	jr	Z, 00110$
	ld	d, #0x00
	ld	e, a
	ret
00110$:
	ld	de, #0x0000
;pocket_platformer.c:1684: }
	ret
;pocket_platformer.c:1687: static void rb_redraw_all(void) {
;	---------------------------------
; Function rb_redraw_all
; ---------------------------------
_rb_redraw_all:
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
;pocket_platformer.c:1689: for (i = 0; i < rb_block_count; i++) {
	ld	-1 (ix), #0x00
00103$:
	ld	hl, #_rb_block_count
	ld	a, -1 (ix)
	sub	a, (hl)
	jr	NC, 00105$
;pocket_platformer.c:1690: unsigned char tx = rb_blocks[i].tx;
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
;pocket_platformer.c:1691: unsigned char ty = rb_blocks[i].ty;
	ld	l, e
;	spillPairReg hl
;	spillPairReg hl
	ld	h, d
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	ld	a, (hl)
	ld	-2 (ix), a
;pocket_platformer.c:1692: unsigned char solid = rb_blocks[i].is_red ? rb_red_active : !rb_red_active;
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
;pocket_platformer.c:1693: unsigned int vt = rb_vram_for_block(rb_blocks[i].is_red, solid);
	push	bc
	ld	a, b
	call	_rb_vram_for_block
	pop	bc
;pocket_platformer.c:1694: SMS_setNextTileatXY(tx % SCREEN_TILES_W, ty);
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
;pocket_platformer.c:1695: SMS_setTile(vt);
	ex	de, hl
	rst	#0x18
;pocket_platformer.c:1689: for (i = 0; i < rb_block_count; i++) {
	inc	-1 (ix)
	jr	00103$
00105$:
;pocket_platformer.c:1697: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1699: static void check_rb_switch(void) {
;	---------------------------------
; Function check_rb_switch
; ---------------------------------
_check_rb_switch:
;pocket_platformer.c:1701: if (rb_switch_locked && player.vy > 0) rb_switch_locked = 0;
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
;pocket_platformer.c:1702: }
	ret
;pocket_platformer.c:1704: static void check_disp_touch(void) {
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
;pocket_platformer.c:1709: long px = player.x >> 8, py = player.y >> 8;
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
;pocket_platformer.c:1710: unsigned char tx_l = (unsigned char)(px / TILE_SIZE);
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
;pocket_platformer.c:1711: unsigned char tx_r = (unsigned char)((px + PLAYER_W - 1) / TILE_SIZE);
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
;pocket_platformer.c:1712: unsigned char ty_body  = (unsigned char)(py / TILE_SIZE);
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
;pocket_platformer.c:1713: unsigned char ty_feet  = (unsigned char)((py + PLAYER_H) / TILE_SIZE); /* tile below feet */
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
;pocket_platformer.c:1714: unsigned char probes[3][2] = {
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
;pocket_platformer.c:1720: for (c = 0; c < 3; c++) {
	ld	-1 (ix), #0x00
00119$:
;pocket_platformer.c:1721: unsigned char tx = probes[c][0], ty = probes[c][1];
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
;pocket_platformer.c:1722: unsigned char t = get_tile(tx, ty);
	ld	-5 (ix), a
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -6 (ix)
	call	_get_tile
	ld	-4 (ix), a
;pocket_platformer.c:1723: if (res_header->disp_vram_idx && t == res_header->disp_vram_idx)
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
;pocket_platformer.c:1724: disp_touch(tx, ty);
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -6 (ix)
	call	_disp_touch
	jr	00120$
00109$:
;pocket_platformer.c:1725: else if (res_header->conn_vram_idx && t == res_header->conn_vram_idx)
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
;pocket_platformer.c:1726: disp_touch_connected(tx, ty);
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -6 (ix)
	call	_disp_touch_connected
	jr	00120$
00105$:
;pocket_platformer.c:1728: else if (res_header->fg_disp_vram_idx &&
	ld	c, -3 (ix)
	ld	b, -2 (ix)
	ld	hl, #37
	add	hl, bc
	ld	a, (hl)
	or	a, a
	jr	Z, 00120$
;pocket_platformer.c:1729: t == (res_header->fg_disp_vram_idx | 0x80))
	ld	c, a
	set	7, c
	ld	a, -4 (ix)
	sub	a, c
	jr	NZ, 00120$
;pocket_platformer.c:1730: fg_disp_touch_connected(tx, ty);
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, -6 (ix)
	call	_fg_disp_touch_connected
00120$:
;pocket_platformer.c:1720: for (c = 0; c < 3; c++) {
	inc	-1 (ix)
	ld	a, -1 (ix)
	sub	a, #0x03
	jp	C, 00119$
;pocket_platformer.c:1734: if (res_header->fg_disp_vram_idx) {
	ld	iy, (_res_header)
	ld	a, 37 (iy)
	ld	-1 (ix), a
	or	a, a
	jp	Z, 00127$
;pocket_platformer.c:1735: unsigned char tx_l = (unsigned char)((player.x >> 8) / TILE_SIZE);
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
;pocket_platformer.c:1736: unsigned char tx_r = (unsigned char)(((player.x >> 8) + PLAYER_W - 1) / TILE_SIZE);
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
;pocket_platformer.c:1737: unsigned char ty_t = (unsigned char)((player.y >> 8) / TILE_SIZE);
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
;pocket_platformer.c:1738: unsigned char ty_b = (unsigned char)(((player.y >> 8) + PLAYER_H - 1) / TILE_SIZE);
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
;pocket_platformer.c:1740: for (bx = tx_l; bx <= tx_r; bx++) {
	ld	c, -11 (ix)
00125$:
	ld	a, -10 (ix)
	sub	a, c
	jr	C, 00127$
;pocket_platformer.c:1741: for (by = ty_t; by <= ty_b; by++) {
	ld	b, -1 (ix)
00122$:
	ld	a, -2 (ix)
	sub	a, b
	jr	C, 00126$
;pocket_platformer.c:1742: unsigned char bt = get_tile(bx, by);
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_get_tile
	pop	bc
;pocket_platformer.c:1743: if (bt == (res_header->fg_disp_vram_idx | 0x80))
	ld	hl, (_res_header)
	ld	de, #0x0025
	add	hl, de
	ld	e, (hl)
	set	7, e
	sub	a, e
	jr	NZ, 00123$
;pocket_platformer.c:1744: fg_disp_touch_connected(bx, by);
	push	bc
	ld	l, b
;	spillPairReg hl
;	spillPairReg hl
	ld	a, c
	call	_fg_disp_touch_connected
	pop	bc
00123$:
;pocket_platformer.c:1741: for (by = ty_t; by <= ty_b; by++) {
	inc	b
	jr	00122$
00126$:
;pocket_platformer.c:1740: for (bx = tx_l; bx <= tx_r; bx++) {
	inc	c
	jr	00125$
00127$:
;pocket_platformer.c:1748: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1750: static void update_disappearing_blocks(void) {
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
;pocket_platformer.c:1752: check_disp_touch();
	call	_check_disp_touch
;pocket_platformer.c:1753: for (i = 0; i < MAX_DISP; i++) {
	ld	-1 (ix), #0x00
00125$:
;pocket_platformer.c:1756: disp_entry *e = &disp_blocks[i];
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
;pocket_platformer.c:1757: if (!e->frame) continue;
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
;pocket_platformer.c:1759: e->frame++;
	ld	e, -2 (ix)
	inc	e
	pop	bc
	pop	hl
	push	hl
	push	bc
	ld	(hl), e
;pocket_platformer.c:1760: tx = e->tx; ty = e->ty;
	pop	hl
	push	hl
	ld	b, (hl)
	pop	hl
	push	hl
	inc	hl
	ld	c, (hl)
;pocket_platformer.c:1761: scr_x = tx % SCREEN_TILES_W;
	ld	a, b
	and	a, #0x1f
;pocket_platformer.c:1762: scr_y = ty;
	ld	-20 (ix), c
;pocket_platformer.c:1764: if (e->frame == DISP_GONE_AT) {
	ld	l, -22 (ix)
	ld	h, -21 (ix)
	ld	l, (hl)
;	spillPairReg hl
;pocket_platformer.c:1766: SMS_setNextTileatXY(scr_x, scr_y);
	ld	d, #0x00
	ld	-19 (ix), a
	ld	-18 (ix), d
;pocket_platformer.c:1764: if (e->frame == DISP_GONE_AT) {
	ld	a, e
	sub	a, #0x28
	jr	NZ, 00108$
;pocket_platformer.c:1766: SMS_setNextTileatXY(scr_x, scr_y);
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
;pocket_platformer.c:1767: SMS_setTile(0);
	ld	hl, #0x0000
	rst	#0x18
	jp	00110$
00108$:
;pocket_platformer.c:1769: else if (e->frame >= DISP_RESET_AT) {
	ld	a, l
	sub	a, #0xc8
	jp	C, 00110$
;pocket_platformer.c:1772: long bx = (long)tx * TILE_SIZE, by = (long)ty * TILE_SIZE;
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
;pocket_platformer.c:1773: long ppx = player.x >> 8, ppy = player.y >> 8;
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
;pocket_platformer.c:1774: unsigned char on_top =
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
;pocket_platformer.c:1777: if (!on_top) {
	or	a, a
	jp	NZ, 00110$
;pocket_platformer.c:1778: unsigned char orig_vram = e->is_connected
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
;pocket_platformer.c:1781: vt = orig_vram ? (unsigned int)(VRAM_BG_BASE + orig_vram - 1) : 0u;
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
;pocket_platformer.c:1782: SMS_setNextTileatXY(scr_x, scr_y);
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
;pocket_platformer.c:1783: SMS_setTile(vt);
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	rst	#0x18
;pocket_platformer.c:1784: e->frame = 0;
	pop	bc
	pop	hl
	push	hl
	push	bc
	ld	(hl), #0x00
00110$:
;pocket_platformer.c:1753: for (i = 0; i < MAX_DISP; i++) {
	inc	-1 (ix)
	ld	a, -1 (ix)
	sub	a, #0x10
	jp	C, 00125$
;pocket_platformer.c:1789: if (res_header->fg_disp_vram_idx) {
	ld	hl, (_res_header)
	ld	de, #0x0025
	add	hl, de
	ld	a, (hl)
	or	a, a
	jp	Z, 00127$
;pocket_platformer.c:1791: for (j = 0; j < MAX_FG_DISP; j++) {
	ld	-1 (ix), #0x00
00126$:
;pocket_platformer.c:1793: fg_disp_entry *e = &fg_disp_blocks[j];
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
;pocket_platformer.c:1794: if (!e->frame) continue;
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
;pocket_platformer.c:1795: e->frame++;
	inc	c
	pop	de
	pop	hl
	push	hl
	push	de
	ld	(hl), c
;pocket_platformer.c:1796: tx = e->tx; ty = e->ty;
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
;pocket_platformer.c:1797: scr_x = tx % SCREEN_TILES_W;
	ld	a, e
	and	a, #0x1f
;pocket_platformer.c:1798: scr_y = ty;
	push	af
	ld	a, -2 (ix)
	ld	-20 (ix), a
	pop	af
;pocket_platformer.c:1799: if (e->frame == FG_DISP_GONE_AT) {
	ld	l, -22 (ix)
	ld	h, -21 (ix)
	ld	l, (hl)
;	spillPairReg hl
;pocket_platformer.c:1801: SMS_setNextTileatXY(scr_x, scr_y);
	ld	b, #0x00
	ld	-19 (ix), a
	ld	-18 (ix), b
;pocket_platformer.c:1799: if (e->frame == FG_DISP_GONE_AT) {
	ld	a, c
	sub	a, #0x05
	jr	NZ, 00119$
;pocket_platformer.c:1801: SMS_setNextTileatXY(scr_x, scr_y);
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
;pocket_platformer.c:1802: SMS_setTile(0);
	ld	hl, #0x0000
	rst	#0x18
	jp	00121$
00119$:
;pocket_platformer.c:1803: } else if (e->frame >= FG_DISP_RESET_AT) {
	ld	a, l
	sub	a, #0x78
	jp	C, 00121$
;pocket_platformer.c:1805: long bx = (long)tx * TILE_SIZE, by = (long)ty * TILE_SIZE;
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
;pocket_platformer.c:1806: long ppx = player.x >> 8, ppy = player.y >> 8;
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
;pocket_platformer.c:1807: unsigned char overlap =
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
;pocket_platformer.c:1810: if (!overlap) {
	or	a, a
	jr	NZ, 00121$
;pocket_platformer.c:1811: unsigned int vt = (unsigned int)(VRAM_BG_BASE + res_header->fg_disp_vram_idx - 1) | TILE_PRIORITY;
	ld	iy, (_res_header)
	ld	e, 37 (iy)
	ld	d, #0x00
	set	4, d
;pocket_platformer.c:1812: SMS_setNextTileatXY(scr_x, scr_y);
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
;pocket_platformer.c:1813: SMS_setTile(vt);
	ex	de, hl
	rst	#0x18
;pocket_platformer.c:1814: e->frame = 0;
	pop	bc
	pop	hl
	push	hl
	push	bc
	ld	(hl), #0x00
00121$:
;pocket_platformer.c:1791: for (j = 0; j < MAX_FG_DISP; j++) {
	inc	-1 (ix)
	ld	a, -1 (ix)
	sub	a, #0x10
	jp	C, 00126$
00127$:
;pocket_platformer.c:1819: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1826: static void update_camera(void) {
;	---------------------------------
; Function update_camera
; ---------------------------------
_update_camera:
;pocket_platformer.c:1828: camera_x = 0;
	ld	hl, #0x0000
	ld	(_camera_x), hl
;pocket_platformer.c:1829: SMS_setBGScrollX(0);
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
;pocket_platformer.c:1830: }
	jp	_SMS_setBGScrollX
;pocket_platformer.c:1835: static void update_anim(void) {
;	---------------------------------
; Function update_anim
; ---------------------------------
_update_anim:
;pocket_platformer.c:1836: if (player.anim_timer) { player.anim_timer--; }
	ld	hl, #_player + 26
	ld	a, (hl)
	or	a, a
	jr	Z, 00102$
	dec	a
	ld	(hl), a
	ret
00102$:
;pocket_platformer.c:1837: else { player.anim_timer = 5; player.anim_frame = (player.anim_frame + 1) & 3; }
	ld	(hl), #0x05
	ld	bc, #_player + 25
	ld	a, (bc)
	inc	a
	and	a, #0x03
	ld	(bc), a
;pocket_platformer.c:1838: }
	ret
;pocket_platformer.c:1840: static void load_level(unsigned char n) {
;	---------------------------------
; Function load_level
; ---------------------------------
_load_level:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-10
	add	hl, sp
	ld	sp, hl
	ld	-2 (ix), a
;pocket_platformer.c:1842: map_res_bank();
	ld	a, #0x02
	ld	(#_ROM_bank_to_be_mapped_on_slot2), a
;pocket_platformer.c:1843: level_n_global = n;
	ld	a, -2 (ix)
	ld	(_level_n_global+0), a
;pocket_platformer.c:1844: cur_level   = get_level(n);
	ld	a, -2 (ix)
	call	_get_level
	ld	(_cur_level), de
;pocket_platformer.c:1845: cur_map     = (unsigned char *)cur_level + sizeof(level_header);
	ld	bc, (_cur_level)
	ld	hl, #0x0004
	add	hl, bc
	ld	(_cur_map), hl
;pocket_platformer.c:1847: (unsigned int)cur_level->map_w * cur_level->map_h);
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
;pocket_platformer.c:1849: for (i = 0; i < MAX_OBJECTS; i++) coin_collected[i] = 0;
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
;pocket_platformer.c:1850: dialogue_active = 0;
	ld	hl, #_dialogue_active
	ld	(hl), #0x00
;pocket_platformer.c:1851: for (i = 0; i < MAX_DISP; i++) disp_blocks[i].frame = 0;
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
;pocket_platformer.c:1854: rb_block_count  = 0;
	ld	hl, #_rb_block_count
	ld	(hl), #0x00
;pocket_platformer.c:1855: rb_switch_count = 0;
	ld	hl, #_rb_switch_count
	ld	(hl), #0x00
;pocket_platformer.c:1856: rb_red_active   = 1;   /* red starts solid per pocket-platformer default */
	ld	hl, #_rb_red_active
	ld	(hl), #0x01
;pocket_platformer.c:1857: rb_switch_locked = 0;
	ld	hl, #_rb_switch_locked
	ld	(hl), #0x00
;pocket_platformer.c:1859: vp_block_count  = 0;
	ld	hl, #_vp_block_count
	ld	(hl), #0x00
;pocket_platformer.c:1860: vp_violet_active = 0;  /* state = "violet turn" (violet passable, pink solid) */
	ld	hl, #_vp_violet_active
	ld	(hl), #0x00
;pocket_platformer.c:1861: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:1862: for (i = 0; i < cur_level->obj_count; i++) {
	ld	-1 (ix), #0x00
00123$:
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	c, (hl)
	ld	a, -1 (ix)
	sub	a, c
	jp	NC, 00114$
;pocket_platformer.c:1863: level_object *obj = &cur_objects[i];
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
;pocket_platformer.c:1864: if ((obj->type == 7 || obj->type == 8) && rb_block_count < MAX_RB_BLOCKS) {
	ld	a, -10 (ix)
	add	a, #0x02
	ld	-4 (ix), a
	ld	a, -9 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	c, (hl)
;pocket_platformer.c:1866: rb_blocks[rb_block_count].ty     = obj->y;
	ld	a, -10 (ix)
	add	a, #0x01
	ld	-8 (ix), a
	ld	a, -9 (ix)
	adc	a, #0x00
	ld	-7 (ix), a
;pocket_platformer.c:1864: if ((obj->type == 7 || obj->type == 8) && rb_block_count < MAX_RB_BLOCKS) {
	ld	a,c
	cp	a,#0x07
	jr	Z, 00106$
	sub	a, #0x08
	jr	NZ, 00104$
00106$:
	ld	a, (_rb_block_count+0)
	sub	a, #0x30
	jr	NC, 00104$
;pocket_platformer.c:1865: rb_blocks[rb_block_count].tx     = obj->x;
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
;pocket_platformer.c:1866: rb_blocks[rb_block_count].ty     = obj->y;
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
	ld	l, -8 (ix)
	ld	h, -7 (ix)
	ld	a, (hl)
	ld	(de), a
;pocket_platformer.c:1867: rb_blocks[rb_block_count].is_red = (obj->type == 7);
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
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	sub	a, #0x07
	ld	a, #0x01
	jr	Z, 00212$
	xor	a, a
00212$:
	ld	(de), a
;pocket_platformer.c:1868: rb_block_count++;
	ld	hl, #_rb_block_count
	inc	(hl)
00104$:
;pocket_platformer.c:1870: if ((obj->type == 10 || obj->type == 11) && vp_block_count < MAX_VP_BLOCKS) {
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	cp	a, #0x0a
	jr	Z, 00110$
	sub	a, #0x0b
	jr	NZ, 00108$
00110$:
	ld	a, (_vp_block_count+0)
	sub	a, #0x30
	jr	NC, 00108$
;pocket_platformer.c:1871: vp_blocks[vp_block_count].tx        = obj->x;
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
;pocket_platformer.c:1872: vp_blocks[vp_block_count].ty        = obj->y;
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
	ld	l, -8 (ix)
	ld	h, -7 (ix)
	ld	a, (hl)
	ld	(de), a
;pocket_platformer.c:1873: vp_blocks[vp_block_count].is_violet = (obj->type == 10);
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
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	sub	a, #0x0a
	ld	a, #0x01
	jr	Z, 00217$
	xor	a, a
00217$:
	ld	(de), a
;pocket_platformer.c:1874: vp_block_count++;
	ld	hl, #_vp_block_count
	inc	(hl)
00108$:
;pocket_platformer.c:1876: if (obj->type == 9 && rb_switch_count < MAX_RB_SWITCHES) {
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	sub	a, #0x09
	jp	NZ,00124$
	ld	a, (_rb_switch_count+0)
	sub	a, #0x08
	jr	NC, 00124$
;pocket_platformer.c:1877: rb_switches[rb_switch_count].tx = obj->x;
	ld	a, (_rb_switch_count+0)
	ld	-4 (ix), a
	ld	-3 (ix), #0x00
	ld	a, -4 (ix)
	ld	-6 (ix), a
	ld	a, -3 (ix)
	ld	-5 (ix), a
	sla	-6 (ix)
	rl	-5 (ix)
	ld	a, #<(_rb_switches)
	add	a, -6 (ix)
	ld	-4 (ix), a
	ld	a, #>(_rb_switches)
	adc	a, -5 (ix)
	ld	-3 (ix), a
	pop	hl
	push	hl
	ld	a, (hl)
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	(hl), a
;pocket_platformer.c:1878: rb_switches[rb_switch_count].ty = obj->y;
	ld	a, (_rb_switch_count+0)
	ld	-4 (ix), a
	ld	-3 (ix), #0x00
	sla	-4 (ix)
	rl	-3 (ix)
	ld	a, #<(_rb_switches)
	add	a, -4 (ix)
	ld	-6 (ix), a
	ld	a, #>(_rb_switches)
	adc	a, -3 (ix)
	ld	-5 (ix), a
	ld	a, -6 (ix)
	add	a, #0x01
	ld	-4 (ix), a
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	l, -8 (ix)
	ld	h, -7 (ix)
	ld	a, (hl)
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	(hl), a
;pocket_platformer.c:1879: rb_switch_count++;
	ld	hl, #_rb_switch_count
	inc	(hl)
00124$:
;pocket_platformer.c:1862: for (i = 0; i < cur_level->obj_count; i++) {
	inc	-1 (ix)
	jp	00123$
00114$:
;pocket_platformer.c:1882: level_complete = player_died = 0;
	ld	hl, #_player_died
	ld	(hl), #0x00
	ld	hl, #_level_complete
	ld	(hl), #0x00
;pocket_platformer.c:1883: camera_x = prev_cam_x = 0;
	ld	hl, #0x0000
	ld	(_prev_cam_x), hl
	ld	(_camera_x), hl
;pocket_platformer.c:1886: player.x  = FP(2 * TILE_SIZE);
	ld	h, #0x10
	ld	(_player), hl
	ld	h, l
	ld	(_player+2), hl
;pocket_platformer.c:1887: player.y  = FP(4 * TILE_SIZE);
	ld	de, #_player+0
	ld	h, #0x20
	ld	((_player + 4)), hl
	ld	h, l
	ld	((_player + 4)+2), hl
;pocket_platformer.c:1888: player.vx = player.vy = 0;
	ld	((_player + 12)), hl
	ld	((_player + 12)+2), hl
	ld	((_player + 8)), hl
	ld	((_player + 8)+2), hl
;pocket_platformer.c:1889: player.on_ground = player.jump_frames = player.double_jump_used = 0;
	ld	hl, #(_player + 24)
	ld	(hl), #0x00
	ld	hl, #(_player + 22)
	ld	(hl), #0x00
	ld	hl, #(_player + 16)
	ld	(hl), #0x00
;pocket_platformer.c:1890: player.falling = 1; player.jumping = 0; player.wall_jumping = 0; player.wall_push_frames = 0;
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
	ld	hl, #(_player + 18)
	ld	(hl), #0x00
	ld	hl, #(_player + 19)
	ld	(hl), #0x00
	ld	hl, #(_player + 21)
	ld	(hl), #0x00
;pocket_platformer.c:1891: player.facing_left = player.anim_frame = player.anim_timer = 0;
	ld	hl, #(_player + 26)
	ld	(hl), #0x00
	ld	hl, #(_player + 25)
	ld	(hl), #0x00
	ld	hl, #(_player + 23)
	ld	(hl), #0x00
;pocket_platformer.c:1893: for (i = 0; i < cur_level->obj_count; i++) {
	ld	-1 (ix), #0x00
00126$:
	ld	hl, (_cur_level)
	inc	hl
	inc	hl
	ld	a,-1 (ix)
	sub	a,(hl)
	jp	NC, 00117$
;pocket_platformer.c:1894: if (cur_objects[i].type == OBJ_START_FLAG) {
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
	ld	-4 (ix), a
	ld	a, (_cur_objects+1)
	adc	a, b
	ld	-3 (ix), a
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	ld	a, (hl)
	dec	a
	jr	NZ, 00127$
;pocket_platformer.c:1895: player.x = (long)cur_objects[i].x * TILE_SIZE * FP_ONE;
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	ld	-6 (ix), a
	xor	a, a
	ld	-5 (ix), a
	ld	-4 (ix), a
	ld	-3 (ix), a
	ld	a, #0x0b
00224$:
	sla	-6 (ix)
	rl	-5 (ix)
	rl	-4 (ix)
	rl	-3 (ix)
	dec	a
	jr	NZ,00224$
	push	bc
	ld	hl, #6
	add	hl, sp
	ld	bc, #0x0004
	ldir
	pop	bc
;pocket_platformer.c:1897: player.y = (long)(cur_objects[i].y - 1) * TILE_SIZE * FP_ONE;
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
;pocket_platformer.c:1898: break;
	jr	00117$
00127$:
;pocket_platformer.c:1893: for (i = 0; i < cur_level->obj_count; i++) {
	inc	-1 (ix)
	jp	00126$
00117$:
;pocket_platformer.c:1902: load_tp_level(n);
	ld	a, -2 (ix)
	call	_load_tp_level
;pocket_platformer.c:1903: load_rfball_level(n);
	ld	a, -2 (ix)
	call	_load_rfball_level
;pocket_platformer.c:1904: SMS_waitForVBlank();
	call	_SMS_waitForVBlank
;pocket_platformer.c:1905: SMS_displayOff();
	ld	hl, #0x0140
	call	_SMS_VDPturnOffFeature
;pocket_platformer.c:1906: SMS_VRAMmemsetW(0x3800, 0, 0x700);
	ld	hl, #0x0700
	push	hl
	ld	de, #0x0000
	ld	h, #0x38
	call	_SMS_VRAMmemsetW
;pocket_platformer.c:1907: draw_tilemap_full();
	call	_draw_tilemap_full
;pocket_platformer.c:1908: SMS_displayOn();
	ld	hl, #0x0140
	call	_SMS_VDPturnOnFeature
;pocket_platformer.c:1909: }
	ld	sp, ix
	pop	ix
	ret
;pocket_platformer.c:1911: static void death_sequence(unsigned char n) {
;	---------------------------------
; Function death_sequence
; ---------------------------------
_death_sequence:
	ld	c, a
;pocket_platformer.c:1913: for (i = 0; i < 8; i++) {
	ld	b, #0x00
00102$:
;pocket_platformer.c:1914: SMS_waitForVBlank();
	push	bc
	call	_SMS_waitForVBlank
	pop	bc
;pocket_platformer.c:1915: SMS_setBackdropColor(i & 1 ? 0x3F : 0);
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
;pocket_platformer.c:1913: for (i = 0; i < 8; i++) {
	inc	b
	ld	a, b
	sub	a, #0x08
	jr	C, 00102$
;pocket_platformer.c:1917: SMS_setBackdropColor(0);
	push	bc
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_setBackdropColor
	pop	bc
;pocket_platformer.c:1918: load_level(n);
	ld	a, c
;pocket_platformer.c:1919: }
	jp	_load_level
;pocket_platformer.c:1924: static void gameplay_loop(void) {
;	---------------------------------
; Function gameplay_loop
; ---------------------------------
_gameplay_loop:
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	hl, #-28
	add	hl, sp
	ld	sp, hl
;pocket_platformer.c:1925: unsigned int joy = 0, joy_prev = 0, joy_pressed;
	ld	hl, #0x0000
	ex	(sp), hl
;pocket_platformer.c:1926: unsigned char level_n = 0, total;
	ld	-26 (ix), #0x00
;pocket_platformer.c:1928: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:1929: total = res_header->level_count;
	ld	hl, (_res_header)
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	de, #0x0004
	add	hl, de
	ld	a, (hl)
	ld	-25 (ix), a
;pocket_platformer.c:1930: load_level(0);
	xor	a, a
	call	_load_level
;pocket_platformer.c:1932: while (1) {
00138$:
;pocket_platformer.c:1933: SMS_waitForVBlank();
	call	_SMS_waitForVBlank
;pocket_platformer.c:1934: joy_prev    = joy;
	ld	a, -28 (ix)
	ld	-2 (ix), a
	ld	a, -27 (ix)
	ld	-1 (ix), a
;pocket_platformer.c:1935: joy         = SMS_getKeysStatus();
	call	_SMS_getKeysStatus
	ld	-4 (ix), e
	ld	-3 (ix), d
	ld	a, -4 (ix)
	ld	-28 (ix), a
	ld	a, -3 (ix)
	ld	-27 (ix), a
;pocket_platformer.c:1936: joy_pressed = joy & ~joy_prev;
	ld	a, -2 (ix)
	cpl
	ld	-2 (ix), a
	ld	a, -1 (ix)
	cpl
	ld	-1 (ix), a
	ld	a, -28 (ix)
	and	a, -2 (ix)
	ld	-6 (ix), a
	ld	a, -27 (ix)
	and	a, -1 (ix)
	ld	-5 (ix), a
	ld	a, -6 (ix)
	ld	-3 (ix), a
	ld	a, -5 (ix)
	ld	-2 (ix), a
;pocket_platformer.c:1940: unsigned char btn = (unsigned char)(joy & (PORT_A_KEY_1 | PORT_A_KEY_2));
	ld	a, -28 (ix)
	ld	-1 (ix), a
;pocket_platformer.c:1939: if (dialogue_active) {
	ld	a, (_dialogue_active+0)
	or	a, a
	jr	Z, 00108$
;pocket_platformer.c:1940: unsigned char btn = (unsigned char)(joy & (PORT_A_KEY_1 | PORT_A_KEY_2));
	ld	a, -1 (ix)
	and	a, #0x30
	ld	-1 (ix), a
;pocket_platformer.c:1941: if (!dialogue_btn_prev && btn) {
	ld	a, (_dialogue_btn_prev+0)
	or	a, a
	jr	NZ, 00105$
	ld	a, -1 (ix)
	or	a, a
	jr	Z, 00105$
;pocket_platformer.c:1943: if (dialogue_line + 2 < dialogue_total) {
	ld	a, (_dialogue_line+0)
	ld	c, a
	ld	b, #0x00
	inc	bc
	inc	bc
	ld	a, (_dialogue_total+0)
	ld	e, a
	ld	d, #0x00
	ld	a, c
	sub	a, e
	ld	a, b
	sbc	a, d
	jp	PO, 00311$
	xor	a, #0x80
00311$:
	jp	P, 00102$
;pocket_platformer.c:1944: dialogue_line += 2;
	ld	a, (_dialogue_line+0)
	add	a, #0x02
	ld	(_dialogue_line+0), a
;pocket_platformer.c:1945: render_dialogue();
	call	_render_dialogue
	jr	00105$
00102$:
;pocket_platformer.c:1947: close_dialogue();
	call	_close_dialogue
00105$:
;pocket_platformer.c:1950: dialogue_btn_prev = btn;
	ld	a, -1 (ix)
	ld	(_dialogue_btn_prev+0), a
;pocket_platformer.c:1951: SMS_waitForVBlank();
	call	_SMS_waitForVBlank
;pocket_platformer.c:1952: SMS_initSprites();
	call	_SMS_initSprites
;pocket_platformer.c:1953: draw_objects();
	call	_draw_objects
;pocket_platformer.c:1954: draw_player();
	call	_draw_player
;pocket_platformer.c:1955: SMS_finalizeSprites();
	call	_SMS_finalizeSprites
;pocket_platformer.c:1956: SMS_copySpritestoSAT();
	call	_SMS_copySpritestoSAT
;pocket_platformer.c:1958: joy      = SMS_getKeysStatus();
	call	_SMS_getKeysStatus
	inc	sp
	inc	sp
	push	de
;pocket_platformer.c:1960: continue;
	jp	00138$
00108$:
;pocket_platformer.c:1963: prev_player_y = player.y;
	ld	hl, #(_player + 4)
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
;pocket_platformer.c:1964: handle_input(joy, joy_pressed);
	ld	e, -3 (ix)
	ld	d, -2 (ix)
	pop	hl
	push	hl
	call	_handle_input
;pocket_platformer.c:1966: if (!player.on_ground && !player.jumping && !player.wall_jumping) player.falling = 1;
	ld	a, (#(_player + 16) + 0)
	or	a, a
	jr	NZ, 00110$
	ld	a, (#_player + 18)
	or	a, a
	jr	NZ, 00110$
	ld	a, (#_player + 19)
	or	a, a
	jr	NZ, 00110$
	ld	hl, #(_player + 17)
	ld	(hl), #0x01
00110$:
;pocket_platformer.c:1967: player.on_ground = 0;
	ld	hl, #(_player + 16)
	ld	(hl), #0x00
;pocket_platformer.c:1968: apply_gravity();
	call	_apply_gravity
;pocket_platformer.c:1969: tp_carry_vx = 0; tp_carry_vy = 0;
	xor	a, a
	ld	(_tp_carry_vx+0), a
	ld	(_tp_carry_vx+1), a
	ld	(_tp_carry_vx+2), a
	ld	(_tp_carry_vx+3), a
	xor	a, a
	ld	(_tp_carry_vy+0), a
	ld	(_tp_carry_vy+1), a
	ld	(_tp_carry_vy+2), a
	ld	(_tp_carry_vy+3), a
;pocket_platformer.c:1970: update_tp();
	call	_update_tp
;pocket_platformer.c:1971: move_player_x();
	call	_move_player_x
;pocket_platformer.c:1972: move_player_y();
	call	_move_player_y
;pocket_platformer.c:1974: if (barrel_active) {
	ld	a, (_barrel_active+0)
	or	a, a
	jr	Z, 00114$
;pocket_platformer.c:1975: barrel_update(joy);
	ld	a, -1 (ix)
	call	_barrel_update
;pocket_platformer.c:1976: SMS_initSprites();
	call	_SMS_initSprites
;pocket_platformer.c:1977: draw_objects();
	call	_draw_objects
;pocket_platformer.c:1978: draw_barrels();
	call	_draw_barrels
;pocket_platformer.c:1979: draw_tp();
	call	_draw_tp
;pocket_platformer.c:1980: draw_rfball();
	call	_draw_rfball
;pocket_platformer.c:1981: draw_npcs();
	call	_draw_npcs
;pocket_platformer.c:1982: draw_player();
	call	_draw_player
;pocket_platformer.c:1983: SMS_finalizeSprites();
	call	_SMS_finalizeSprites
;pocket_platformer.c:1984: SMS_copySpritestoSAT();
	call	_SMS_copySpritestoSAT
;pocket_platformer.c:1985: continue;
	jp	00138$
00114$:
;pocket_platformer.c:1987: npc_contact_idx = 0xFF; /* reset each frame */
	ld	hl, #_npc_contact_idx
	ld	(hl), #0xff
;pocket_platformer.c:1988: check_object_collisions();
	call	_check_object_collisions
;pocket_platformer.c:1990: if (!dialogue_active && npc_contact_idx != 0xFF) {
	ld	a, (_dialogue_active+0)
	or	a, a
	jr	NZ, 00121$
	ld	a, (_npc_contact_idx+0)
	inc	a
	jr	Z, 00121$
;pocket_platformer.c:1991: if (npc_contact_auto) {
	ld	a, (_npc_contact_auto+0)
	or	a, a
	jr	Z, 00118$
;pocket_platformer.c:1992: open_dialogue(npc_contact_level, npc_contact_idx);
	ld	a, (_npc_contact_idx+0)
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, (_npc_contact_level+0)
	call	_open_dialogue
	jr	00121$
00118$:
;pocket_platformer.c:1993: } else if (joy_pressed & PORT_A_KEY_1) {
	bit	4, -3 (ix)
	jr	Z, 00121$
;pocket_platformer.c:1994: open_dialogue(npc_contact_level, npc_contact_idx);
	ld	a, (_npc_contact_idx+0)
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	a, (_npc_contact_level+0)
	call	_open_dialogue
00121$:
;pocket_platformer.c:1998: if (!player_died && res_header->spike_vram_idx) {
	ld	a, (_player_died+0)
	or	a, a
	jp	NZ, 00129$
;pocket_platformer.c:1929: total = res_header->level_count;
	ld	hl, (_res_header)
;pocket_platformer.c:1998: if (!player_died && res_header->spike_vram_idx) {
	ld	de, #0x0026
	add	hl, de
	ld	a, (hl)
	or	a, a
	jp	Z, 00129$
;pocket_platformer.c:1999: unsigned char sv = res_header->spike_vram_idx;
	ld	-24 (ix), a
;pocket_platformer.c:2000: long px = player.x >> 8, py = player.y >> 8;
	ld	de, (#_player + 0)
	ld	hl, (#_player + 2)
	ld	b, #0x08
00314$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00314$
	ld	-4 (ix), e
	ld	-3 (ix), d
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	de, (#(_player + 4) + 0)
	ld	hl, (#(_player + 4) + 2)
	ld	b, #0x08
00316$:
	sra	h
	rr	l
	rr	d
	rr	e
	djnz	00316$
	ld	-14 (ix), e
	ld	-13 (ix), d
	ld	-12 (ix), l
	ld	-11 (ix), h
;pocket_platformer.c:2001: map_res_bank();
	ld	hl, #_ROM_bank_to_be_mapped_on_slot2
	ld	(hl), #0x02
;pocket_platformer.c:2002: if (get_tile((unsigned char)((px+1)/TILE_SIZE),             (unsigned char)(py/TILE_SIZE))           == sv ||
	ld	hl, #20
	add	hl, sp
	ex	de, hl
	ld	hl, #14
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -11 (ix)
	rlca
	and	a,#0x01
	ld	-10 (ix), a
	ld	a, -14 (ix)
	add	a, #0x07
	ld	-23 (ix), a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	-22 (ix), a
	ld	a, -12 (ix)
	adc	a, #0x00
	ld	-21 (ix), a
	ld	a, -11 (ix)
	adc	a, #0x00
	ld	-20 (ix), a
	ld	a, -10 (ix)
	or	a, a
	jr	Z, 00145$
	ld	hl, #20
	add	hl, sp
	ex	de, hl
	ld	hl, #5
	add	hl, sp
	ld	bc, #4
	ldir
00145$:
	ld	c, -8 (ix)
	ld	b, -7 (ix)
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	-9 (ix), c
	ld	a, -4 (ix)
	add	a, #0x01
	ld	c, a
	ld	a, -3 (ix)
	adc	a, #0x00
	ld	b, a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	e, a
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	d, a
	ld	-8 (ix), c
	ld	-7 (ix), b
	ld	-6 (ix), e
	ld	-5 (ix), d
	ld	a, d
	rlca
	and	a,#0x01
	ld	-19 (ix), a
	ld	a, c
	add	a, #0x07
	ld	-18 (ix), a
	ld	a, b
	adc	a, #0x00
	ld	-17 (ix), a
	ld	a, e
	adc	a, #0x00
	ld	-16 (ix), a
	ld	a, d
	adc	a, #0x00
	ld	-15 (ix), a
	ld	a, -19 (ix)
	or	a, a
	jr	Z, 00146$
	ld	a, -18 (ix)
	ld	-8 (ix), a
	ld	a, -17 (ix)
	ld	-7 (ix), a
	ld	a, -16 (ix)
	ld	-6 (ix), a
	ld	a, -15 (ix)
	ld	-5 (ix), a
00146$:
	ld	h, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	l, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	srl	l
	rr	h
	srl	l
	rr	h
	srl	l
	rr	h
	push	bc
	push	de
	ld	l, -9 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, h
	call	_get_tile
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	pop	de
	pop	bc
	ld	a, -24 (ix)
	sub	a, l
	jp	Z,00123$
;pocket_platformer.c:2003: get_tile((unsigned char)((px+PLAYER_W-2)/TILE_SIZE),    (unsigned char)(py/TILE_SIZE))           == sv ||
	ld	a, -14 (ix)
	ld	-8 (ix), a
	ld	a, -13 (ix)
	ld	-7 (ix), a
	ld	a, -12 (ix)
	ld	-6 (ix), a
	ld	a, -11 (ix)
	ld	-5 (ix), a
	ld	a, -10 (ix)
	or	a, a
	jr	Z, 00147$
	ld	a, -23 (ix)
	ld	-8 (ix), a
	ld	a, -22 (ix)
	ld	-7 (ix), a
	ld	a, -21 (ix)
	ld	-6 (ix), a
	ld	a, -20 (ix)
	ld	-5 (ix), a
00147$:
	ld	l, -8 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -7 (ix)
;	spillPairReg hl
;	spillPairReg hl
	srl	h
	rr	l
	srl	h
	rr	l
	srl	h
	rr	l
	ld	-5 (ix), l
	ld	a, -4 (ix)
	add	a, #0x04
	ld	-14 (ix), a
	ld	a, -3 (ix)
	adc	a, #0x00
	ld	-13 (ix), a
	ld	a, -2 (ix)
	adc	a, #0x00
	ld	-12 (ix), a
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	-11 (ix), a
	ld	a, -14 (ix)
	ld	-4 (ix), a
	ld	a, -13 (ix)
	ld	-3 (ix), a
	ld	a, -12 (ix)
	ld	-2 (ix), a
	ld	a, -11 (ix)
	ld	-1 (ix), a
	ld	a, -11 (ix)
	rlca
	and	a,#0x01
	ld	-10 (ix), a
	ld	a, -14 (ix)
	add	a, #0x07
	ld	-9 (ix), a
	ld	a, -13 (ix)
	adc	a, #0x00
	ld	-8 (ix), a
	ld	a, -12 (ix)
	adc	a, #0x00
	ld	-7 (ix), a
	ld	a, -11 (ix)
	adc	a, #0x00
	ld	-6 (ix), a
	ld	a, -10 (ix)
	or	a, a
	jr	Z, 00148$
	ld	a, -9 (ix)
	ld	-4 (ix), a
	ld	a, -8 (ix)
	ld	-3 (ix), a
	ld	a, -7 (ix)
	ld	-2 (ix), a
	ld	a, -6 (ix)
	ld	-1 (ix), a
00148$:
	ld	h, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	l, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	srl	l
	rr	h
	srl	l
	rr	h
	srl	l
	rr	h
	push	bc
	push	de
	ld	l, -5 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	a, h
	call	_get_tile
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	pop	de
	pop	bc
	ld	a, -24 (ix)
	sub	a, l
	jp	Z,00123$
;pocket_platformer.c:2004: get_tile((unsigned char)((px+1)/TILE_SIZE),             (unsigned char)((py+PLAYER_H-1)/TILE_SIZE)) == sv ||
	ld	l, -23 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -22 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	iy
	ex	(sp), hl
	ld	l, -21 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	ex	(sp), hl
	ld	h, -20 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	pop	iy
	ld	a, -20 (ix)
	rlca
	and	a,#0x01
	ld	-5 (ix), a
	ld	a, -23 (ix)
	add	a, #0x07
	ld	-4 (ix), a
	ld	a, -22 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	a, -21 (ix)
	adc	a, #0x00
	ld	-2 (ix), a
	ld	a, -20 (ix)
	adc	a, #0x00
	ld	-1 (ix), a
	ld	a, -5 (ix)
	or	a, a
	jr	Z, 00149$
	ld	l, -4 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -3 (ix)
;	spillPairReg hl
;	spillPairReg hl
	push	iy
	ex	(sp), hl
	ld	l, -2 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	ex	(sp), hl
	ld	h, -1 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ex	(sp), hl
	pop	iy
00149$:
	srl	h
	rr	l
	srl	h
	rr	l
	srl	h
	rr	l
	ld	a, -19 (ix)
	or	a, a
	jr	Z, 00150$
	ld	c, -18 (ix)
	ld	b, -17 (ix)
00150$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	a, c
	call	_get_tile
	ld	c, a
	ld	a, -24 (ix)
	sub	a, c
	jr	Z, 00123$
;pocket_platformer.c:2005: get_tile((unsigned char)((px+PLAYER_W-2)/TILE_SIZE),    (unsigned char)((py+PLAYER_H-1)/TILE_SIZE)) == sv)
	ld	hl, #10
	add	hl, sp
	ex	de, hl
	ld	hl, #5
	add	hl, sp
	ld	bc, #4
	ldir
	ld	a, -5 (ix)
	or	a, a
	jr	Z, 00151$
	ld	hl, #10
	add	hl, sp
	ex	de, hl
	ld	hl, #24
	add	hl, sp
	ld	bc, #4
	ldir
00151$:
	ld	l, -18 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -17 (ix)
;	spillPairReg hl
;	spillPairReg hl
	srl	h
	rr	l
	srl	h
	rr	l
	srl	h
	rr	l
	ld	c, -14 (ix)
	ld	b, -13 (ix)
	ld	a, -10 (ix)
	or	a, a
	jr	Z, 00152$
	ld	c, -9 (ix)
	ld	b, -8 (ix)
00152$:
	srl	b
	rr	c
	srl	b
	rr	c
	srl	b
	rr	c
	ld	a, c
	call	_get_tile
	ld	c, a
	ld	a, -24 (ix)
	sub	a, c
	jr	NZ, 00129$
00123$:
;pocket_platformer.c:2006: player_died = 1;
	ld	hl, #_player_died
	ld	(hl), #0x01
00129$:
;pocket_platformer.c:2008: check_rb_switch();
	call	_check_rb_switch
;pocket_platformer.c:2009: update_disappearing_blocks();
	call	_update_disappearing_blocks
;pocket_platformer.c:2010: update_camera();
	call	_update_camera
;pocket_platformer.c:2011: update_anim();
	call	_update_anim
;pocket_platformer.c:2013: SMS_initSprites();
	call	_SMS_initSprites
;pocket_platformer.c:2014: draw_objects();
	call	_draw_objects
;pocket_platformer.c:2015: draw_barrels();
	call	_draw_barrels
;pocket_platformer.c:2016: draw_tp();
	call	_draw_tp
;pocket_platformer.c:2017: draw_rfball();
	call	_draw_rfball
;pocket_platformer.c:2018: draw_npcs();
	call	_draw_npcs
;pocket_platformer.c:2019: draw_player();
	call	_draw_player
;pocket_platformer.c:2020: SMS_finalizeSprites();
	call	_SMS_finalizeSprites
;pocket_platformer.c:2021: SMS_copySpritestoSAT();
	call	_SMS_copySpritestoSAT
;pocket_platformer.c:2023: if (player_died) {
	ld	a, (_player_died+0)
	or	a, a
	jr	Z, 00135$
;pocket_platformer.c:2024: death_sequence(level_n);
	ld	a, -26 (ix)
	call	_death_sequence
	jp	00138$
00135$:
;pocket_platformer.c:2025: } else if (level_complete) {
	ld	a, (_level_complete+0)
	or	a, a
	jp	Z, 00138$
;pocket_platformer.c:2027: for (i = 0; i < 60; i++) SMS_waitForVBlank();
	ld	c, #0x3c
00142$:
	push	bc
	call	_SMS_waitForVBlank
	pop	bc
	dec	c
	jr	NZ, 00142$
;pocket_platformer.c:2028: level_n = (level_n + 1 < total) ? level_n + 1 : 0;
	ld	c, -26 (ix)
	ld	b, #0x00
	inc	bc
	ld	e, -25 (ix)
	ld	d, #0x00
	ld	a, c
	sub	a, e
	ld	a, b
	sbc	a, d
	jp	PO, 00323$
	xor	a, #0x80
00323$:
	jp	P, 00153$
	ld	a, -26 (ix)
	ld	-1 (ix), a
	inc	-1 (ix)
	ld	a, -1 (ix)
	ld	-2 (ix), a
	rlca
	sbc	a, a
	ld	-1 (ix), a
	jr	00154$
00153$:
	xor	a, a
	ld	-2 (ix), a
	ld	-1 (ix), a
00154$:
	ld	a, -2 (ix)
;pocket_platformer.c:2029: load_level(level_n);
	ld	-26 (ix), a
	call	_load_level
;pocket_platformer.c:2032: }
	jp	00138$
;pocket_platformer.c:2037: static void title_screen(void) {
;	---------------------------------
; Function title_screen
; ---------------------------------
_title_screen:
;pocket_platformer.c:2039: SMS_waitForVBlank();
	call	_SMS_waitForVBlank
;pocket_platformer.c:2040: SMS_displayOff();
	ld	hl, #0x0140
	call	_SMS_VDPturnOffFeature
;pocket_platformer.c:2041: SMS_VRAMmemsetW(0, 0, 16 * 1024);
	ld	hl, #0x4000
	push	hl
	ld	de, #0x0000
	ld	h, l
	call	_SMS_VRAMmemsetW
;pocket_platformer.c:2042: SMS_zeroBGPalette();
	call	_SMS_zeroBGPalette
;pocket_platformer.c:2043: SMS_zeroSpritePalette();
	call	_SMS_zeroSpritePalette
;pocket_platformer.c:2044: SMS_setBGPaletteColor(1, 0x3F);
	ld	l, #0x3f
;	spillPairReg hl
;	spillPairReg hl
	ld	a, #0x01
	call	_SMS_setBGPaletteColor
;pocket_platformer.c:2045: SMS_load1bppTiles(font_1bpp, VRAM_TILE_FONT, font_1bpp_size, 0, 1);
	ld	hl, #0x100
	push	hl
	ld	hl, (_font_1bpp_size)
	push	hl
	ld	de, #0x0160
	ld	hl, #_font_1bpp
	call	_SMS_load1bppTiles
;pocket_platformer.c:2046: SMS_configureTextRenderer(VRAM_TILE_FONT - 32);
	ld	hl, #0x0140
	call	_SMS_configureTextRenderer
;pocket_platformer.c:2047: SMS_displayOn();
	ld	hl, #0x0140
	call	_SMS_VDPturnOnFeature
;pocket_platformer.c:2048: SMS_printatXY(4,  8, "POCKET PLATFORMER");
	ld	hl, #0x7a08
	rst	#0x08
	ld	hl, #___str_2
	call	_SMS_print
;pocket_platformer.c:2049: SMS_printatXY(3, 10, "for Sega Master System");
	ld	hl, #0x7a86
	rst	#0x08
	ld	hl, #___str_3
	call	_SMS_print
;pocket_platformer.c:2050: SMS_printatXY(4, 14, "Press 1 to start");
	ld	hl, #0x7b88
	rst	#0x08
	ld	hl, #___str_4
	call	_SMS_print
;pocket_platformer.c:2051: do { SMS_waitForVBlank(); joy = SMS_getKeysStatus(); }
00110$:
	call	_SMS_waitForVBlank
	call	_SMS_getKeysStatus
	ld	a, e
;pocket_platformer.c:2052: while (!(joy & (PORT_A_KEY_1 | PORT_A_KEY_2)));
	and	a, #0x30
	jr	Z, 00110$
;pocket_platformer.c:2053: do { SMS_waitForVBlank(); joy = SMS_getKeysStatus(); }
00113$:
	call	_SMS_waitForVBlank
	call	_SMS_getKeysStatus
	ld	a, e
;pocket_platformer.c:2054: while (joy & (PORT_A_KEY_1 | PORT_A_KEY_2));
	and	a, #0x30
	jr	NZ, 00113$
;pocket_platformer.c:2055: }
	ret
___str_2:
	.ascii "POCKET PLATFORMER"
	.db 0x00
___str_3:
	.ascii "for Sega Master System"
	.db 0x00
___str_4:
	.ascii "Press 1 to start"
	.db 0x00
;pocket_platformer.c:2060: void main(void) {
;	---------------------------------
; Function main
; ---------------------------------
_main::
;pocket_platformer.c:2062: SMS_useFirstHalfTilesforSprites(0);
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_useFirstHalfTilesforSprites
;pocket_platformer.c:2063: SMS_setSpriteMode(SPRITEMODE_NORMAL);
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_setSpriteMode
;pocket_platformer.c:2064: SMS_setBackdropColor(0);
	ld	l, #0x00
;	spillPairReg hl
;	spillPairReg hl
	call	_SMS_setBackdropColor
;pocket_platformer.c:2066: while (1) {
00104$:
;pocket_platformer.c:2067: title_screen();
	call	_title_screen
;pocket_platformer.c:2068: if (!has_resource()) continue;
	call	_has_resource
	or	a, a
	jr	Z, 00104$
;pocket_platformer.c:2069: init_resources();
	call	_init_resources
;pocket_platformer.c:2070: SMS_waitForVBlank();
	call	_SMS_waitForVBlank
;pocket_platformer.c:2071: SMS_displayOff();
	ld	hl, #0x0140
	call	_SMS_VDPturnOffFeature
;pocket_platformer.c:2072: SMS_VRAMmemsetW(0, 0, 16 * 1024);
	ld	hl, #0x4000
	push	hl
	ld	de, #0x0000
	ld	h, l
	call	_SMS_VRAMmemsetW
;pocket_platformer.c:2073: load_graphics();
	call	_load_graphics
;pocket_platformer.c:2074: SMS_displayOn();
	ld	hl, #0x0140
	call	_SMS_VDPturnOnFeature
;pocket_platformer.c:2075: gameplay_loop();
	call	_gameplay_loop
;pocket_platformer.c:2077: }
	jr	00104$
	.area _CODE
__str_5:
	.ascii "pocket-platformer-sms"
	.db 0x00
__str_6:
	.ascii "Pocket Platformer SMS Engine"
	.db 0x00
__str_7:
	.ascii "Generated by pocket-platformer-to-sms web exporter."
	.db 0x00
	.area _INITIALIZER
__xinit__tp_carry_vx:
	.byte #0x00, #0x00, #0x00, #0x00	;  0
__xinit__tp_carry_vy:
	.byte #0x00, #0x00, #0x00, #0x00	;  0
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
