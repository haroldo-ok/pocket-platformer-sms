;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module actor
	.optsdcc -mz80
	
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl _SMS_copySpritestoSAT
	.globl _SMS_finalizeSprites
	.globl _SMS_addSprite_f
	.globl _SMS_initSprites
	.globl _SMS_waitForVBlank
	.globl _SMS_SRAM
	.globl _SRAM_bank_to_be_mapped_on_slot2
	.globl _ROM_bank_to_be_mapped_on_slot0
	.globl _ROM_bank_to_be_mapped_on_slot1
	.globl _ROM_bank_to_be_mapped_on_slot2
	.globl _draw_meta_sprite
	.globl _init_actor
	.globl _move_actor
	.globl _draw_actor
	.globl _wait_frames
	.globl _clear_sprites
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
_draw_meta_sprite_i_65536_170:
	.ds 1
_draw_meta_sprite_j_65536_170:
	.ds 1
_draw_meta_sprite_sx_65536_170:
	.ds 2
_draw_meta_sprite_sy_65536_170:
	.ds 2
_draw_meta_sprite_st_65536_170:
	.ds 1
_init_actor_sa_65536_178:
	.ds 2
_move_actor_act_65536_180:
	.ds 2
_move_actor_step_65536_180:
	.ds 2
_move_actor_curr_step_65536_180:
	.ds 2
_move_actor_path_flags_65536_180:
	.ds 1
_draw_actor__act_65536_188:
	.ds 2
_draw_actor_frame_tile_65536_188:
	.ds 1
_draw_actor_frame_65536_188:
	.ds 1
;--------------------------------------------------------
; ram data
;--------------------------------------------------------
	.area _INITIALIZED
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
;actor.c:9: void draw_meta_sprite(int x, int y, int w, int h, unsigned char tile) {
;	---------------------------------
; Function draw_meta_sprite
; ---------------------------------
_draw_meta_sprite::
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	ld	c, l
	ld	b, h
;actor.c:14: sy = y;
	ld	(_draw_meta_sprite_sy_65536_170), de
;actor.c:15: st = tile;
	ld	a, 8 (ix)
	ld	(_draw_meta_sprite_st_65536_170+0), a
;actor.c:16: for (i = h; i; i--) {
	ld	a, 6 (ix)
	ld	(_draw_meta_sprite_i_65536_170+0), a
	ld	a, e
	sub	a, #0xc0
	ld	a, d
	rla
	ccf
	rra
	sbc	a, #0x80
	ld	a, #0x00
	rla
	ld	-2 (ix), a
	ld	a, d
	rlca
	and	a,#0x01
	ld	-1 (ix), a
00113$:
	ld	a, (_draw_meta_sprite_i_65536_170+0)
	or	a, a
	jr	Z, 00115$
;actor.c:17: if (y >= 0 && y < SCREEN_H) {
	bit	0, -1 (ix)
	jr	NZ, 00106$
	ld	a, -2 (ix)
	or	a, a
	jr	Z, 00106$
;actor.c:18: sx = x;
	ld	(_draw_meta_sprite_sx_65536_170), bc
;actor.c:19: for (j = w; j; j--) {
	ld	a, 4 (ix)
	ld	(_draw_meta_sprite_j_65536_170+0), a
00110$:
	ld	a, (_draw_meta_sprite_j_65536_170+0)
	or	a, a
	jr	Z, 00106$
;actor.c:20: if (sx >= 0 && sx < SCREEN_W) {
	ld	a, (_draw_meta_sprite_sx_65536_170+1)
	bit	7, a
	jr	NZ, 00102$
	ld	a, (_draw_meta_sprite_sx_65536_170+1)
	xor	a, #0x80
	sub	a, #0x81
	jr	NC, 00102$
;actor.c:21: SMS_addSprite(sx, sy, tile);
	ld	hl, (_draw_meta_sprite_sx_65536_170)
;	spillPairReg hl
;	spillPairReg hl
	ld	d, l
	ld	e, #0x00
	ld	l, 8 (ix)
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	ld	a, e
	or	a, l
	ld	e, a
	ld	a, d
	or	a, h
	ld	d, a
	push	bc
	ld	hl, (_draw_meta_sprite_sy_65536_170)
	call	_SMS_addSprite_f
	pop	bc
00102$:
;actor.c:23: sx += 8;
	ld	hl, #_draw_meta_sprite_sx_65536_170
	ld	a, (hl)
	add	a, #0x08
	ld	(hl), a
	jr	NC, 00157$
	inc	hl
	inc	(hl)
00157$:
;actor.c:24: tile += 2;
	ld	a, 8 (ix)
	add	a, #0x02
	ld	8 (ix), a
;actor.c:19: for (j = w; j; j--) {
	ld	hl, #_draw_meta_sprite_j_65536_170
	dec	(hl)
	jr	00110$
00106$:
;actor.c:27: sy += 16;
	ld	hl, #_draw_meta_sprite_sy_65536_170
	ld	a, (hl)
	add	a, #0x10
	ld	(hl), a
	jr	NC, 00158$
	inc	hl
	inc	(hl)
00158$:
;actor.c:16: for (i = h; i; i--) {
	ld	iy, #_draw_meta_sprite_i_65536_170
	dec	0 (iy)
	jr	00113$
00115$:
;actor.c:29: }
	ld	sp, ix
	pop	ix
	pop	hl
	pop	af
	pop	af
	inc	sp
	jp	(hl)
;actor.c:31: void init_actor(actor *act, int x, int y, int char_w, int char_h, unsigned char base_tile, unsigned char frame_count) {
;	---------------------------------
; Function init_actor
; ---------------------------------
_init_actor::
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
;actor.c:35: sa->active = 1;
	ld	(_init_actor_sa_65536_178), hl
	ld	(hl), #0x01
;actor.c:37: sa->x = x;
	ld	hl, (_init_actor_sa_65536_178)
	inc	hl
	ld	(hl), e
	inc	hl
	ld	(hl), d
;actor.c:38: sa->y = y;
	ld	hl, (_init_actor_sa_65536_178)
	inc	hl
	inc	hl
	inc	hl
	ld	a, 4 (ix)
	ld	(hl), a
	inc	hl
	ld	a, 5 (ix)
	ld	(hl), a
;actor.c:39: sa->facing_left = 1;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x000f
	add	hl, bc
	ld	(hl), #0x01
;actor.c:41: sa->char_w = char_w;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0010
	add	hl, bc
	ld	e, 6 (ix)
	ld	(hl), e
;actor.c:42: sa->char_h = char_h;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0011
	add	hl, bc
	ld	a, 8 (ix)
	ld	(hl), a
;actor.c:43: sa->pixel_w = char_w << 3;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0012
	add	hl, bc
	ld	a, 6 (ix)
	add	a, a
	add	a, a
	add	a, a
	ld	(hl), a
;actor.c:44: sa->pixel_h = char_h << 4;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0013
	add	hl, bc
	ld	d, 8 (ix)
	ld	a, d
	add	a, a
	add	a, a
	add	a, a
	add	a, a
	ld	(hl), a
;actor.c:46: sa->animation_delay = 0;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0014
	add	hl, bc
	ld	(hl), #0x00
;actor.c:47: sa->animation_delay_max = 2;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0015
	add	hl, bc
	ld	(hl), #0x02
;actor.c:49: sa->base_tile = base_tile;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0016
	add	hl, bc
	ld	a, 10 (ix)
	ld	(hl), a
;actor.c:50: sa->frame_count = frame_count;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0017
	add	hl, bc
	ld	a, 11 (ix)
	ld	(hl), a
;actor.c:51: sa->frame = 0;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0018
	add	hl, bc
	ld	(hl), #0x00
;actor.c:52: sa->frame_increment = char_w * (char_h << 1);
	ld	bc, (_init_actor_sa_65536_178)
	ld	hl, #0x0019
	add	hl, bc
	ld	c, l
	ld	b, h
	ld	a, d
	add	a, a
	push	bc
	ld	h, a
;	spillPairReg hl
;	spillPairReg hl
	ld	l, #0x00
	ld	d, l
	ld	b, #0x08
00103$:
	add	hl, hl
	jr	NC, 00104$
	add	hl, de
00104$:
	djnz	00103$
	pop	bc
	ld	e, l
	ld	a, e
	ld	(bc), a
;actor.c:35: sa->active = 1;
	ld	bc, (_init_actor_sa_65536_178)
;actor.c:53: sa->frame_max = sa->frame_increment * frame_count;
	ld	hl, #0x001a
	add	hl, bc
	ex	de, hl
	ld	hl, #25
	add	hl, bc
	ld	h, (hl)
;	spillPairReg hl
	push	de
	ld	e, 11 (ix)
	ld	l, #0x00
	ld	d, l
	ld	b, #0x08
00105$:
	add	hl, hl
	jr	NC, 00106$
	add	hl, de
00106$:
	djnz	00105$
	pop	de
	ld	a, l
	ld	(de), a
;actor.c:55: sa->path_flags = 0;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x001b
	add	hl, bc
	ld	(hl), #0x00
;actor.c:56: sa->path = 0;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x001c
	add	hl, bc
	xor	a, a
	ld	(hl), a
	inc	hl
	ld	(hl), a
;actor.c:57: sa->curr_step = 0;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x001e
	add	hl, bc
	xor	a, a
	ld	(hl), a
	inc	hl
	ld	(hl), a
;actor.c:35: sa->active = 1;
	ld	bc, (_init_actor_sa_65536_178)
;actor.c:59: sa->col_w = sa->pixel_w - 4;
	ld	hl, #0x0026
	add	hl, bc
	ex	de, hl
	ld	hl, #18
	add	hl, bc
	ld	a, (hl)
	add	a, #0xfc
	ld	(de), a
;actor.c:35: sa->active = 1;
	ld	bc, (_init_actor_sa_65536_178)
;actor.c:60: sa->col_h = sa->pixel_h - 4;
	ld	hl, #0x0027
	add	hl, bc
	ex	de, hl
	ld	hl, #19
	add	hl, bc
	ld	a, (hl)
	add	a, #0xfc
	ld	(de), a
;actor.c:35: sa->active = 1;
	ld	bc, (_init_actor_sa_65536_178)
;actor.c:61: sa->col_x = (sa->pixel_w - sa->col_w) >> 1;
	ld	hl, #0x0024
	add	hl, bc
	push	bc
	ex	de, hl
	pop	iy
	ld	a, 18 (iy)
	ld	-2 (ix), a
	ld	-1 (ix), #0x00
	ld	hl, #38
	add	hl, bc
	ld	c, (hl)
	ld	b, #0x00
	ld	a, -2 (ix)
	sub	a, c
	ld	c, a
	ld	a, -1 (ix)
	sbc	a, b
	ld	b, a
	sra	b
	rr	c
	ld	a, c
	ld	(de), a
;actor.c:35: sa->active = 1;
	ld	bc, (_init_actor_sa_65536_178)
;actor.c:62: sa->col_y = (sa->pixel_h - sa->col_h) >> 1;
	ld	hl, #0x0025
	add	hl, bc
	push	bc
	ex	de, hl
	pop	iy
	ld	a, 19 (iy)
	ld	-2 (ix), a
	ld	-1 (ix), #0x00
	ld	hl, #39
	add	hl, bc
	ld	c, (hl)
	ld	b, #0x00
	ld	a, -2 (ix)
	sub	a, c
	ld	c, a
	ld	a, -1 (ix)
	sbc	a, b
	ld	b, a
	sra	b
	rr	c
	ld	a, c
	ld	(de), a
;actor.c:64: sa->state = 0;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0020
	add	hl, bc
	ld	(hl), #0x00
;actor.c:65: sa->state_timer = 256;
	ld	hl, (_init_actor_sa_65536_178)
	ld	bc, #0x0021
	add	hl, bc
	ld	(hl), #0x00
	inc	hl
	ld	(hl), #0x01
;actor.c:66: }
	ld	sp, ix
	pop	ix
	pop	hl
	pop	af
	pop	af
	pop	af
	pop	af
	jp	(hl)
;actor.c:68: void move_actor(actor *_act) {
;	---------------------------------
; Function move_actor
; ---------------------------------
_move_actor::
	push	ix
	ld	ix,#0
	add	ix,sp
	ld	iy, #-10
	add	iy, sp
	ld	sp, iy
;actor.c:73: if (!_act->active) {
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	c, (hl)
	ld	a, c
	or	a, a
;actor.c:74: return;
	jp	Z,00124$
;actor.c:77: act = _act;
	ld	l, -2 (ix)
	ld	h, -1 (ix)
;actor.c:79: if (act->path) {
	ld	(_move_actor_act_65536_180), hl
	ld	-6 (ix), l
	ld	-5 (ix), h
	ld	a, -6 (ix)
	add	a, #0x1c
	ld	-4 (ix), a
	ld	a, -5 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	e, (hl)
	inc	hl
	ld	a, (hl)
	or	a, e
	jp	Z, 00112$
;actor.c:80: curr_step = act->curr_step;
	ld	c, -6 (ix)
	ld	b, -5 (ix)
	ld	hl, #30
	add	hl, bc
	ld	a, (hl)
	inc	hl
	ld	(_move_actor_curr_step_65536_180+0), a
	ld	a, (hl)
;actor.c:82: if (!curr_step) curr_step = act->path;
	ld	(_move_actor_curr_step_65536_180+1), a
	ld	hl, #_move_actor_curr_step_65536_180
	or	a, (hl)
	jr	NZ, 00104$
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	inc	hl
	ld	(_move_actor_curr_step_65536_180+0), a
	ld	a, (hl)
	ld	(_move_actor_curr_step_65536_180+1), a
00104$:
;actor.c:83: step = curr_step++;
	ld	hl, (_move_actor_curr_step_65536_180)
	ld	(_move_actor_step_65536_180), hl
	ld	hl, (_move_actor_curr_step_65536_180)
	inc	hl
	inc	hl
	ld	(_move_actor_curr_step_65536_180), hl
;actor.c:84: if (step->x == -128) step = curr_step = act->path;
	ld	hl, (_move_actor_step_65536_180)
	ld	a, (hl)
	sub	a, #0x80
	jr	NZ, 00106$
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	inc	hl
	ld	h, (hl)
;	spillPairReg hl
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	(_move_actor_curr_step_65536_180), hl
	ld	(_move_actor_step_65536_180), hl
00106$:
;actor.c:86: path_flags = act->path_flags;
	ld	c, -6 (ix)
	ld	b, -5 (ix)
	ld	hl, #27
	add	hl, bc
	ld	a, (hl)
	ld	(_move_actor_path_flags_65536_180+0), a
;actor.c:87: act->x += (path_flags & PATH_FLIP_X) ? -step->x : step->x;
	ld	c, -6 (ix)
	ld	b, -5 (ix)
	inc	bc
	ld	a, (bc)
	ld	-4 (ix), a
	inc	bc
	ld	a, (bc)
	ld	-3 (ix), a
	dec	bc
	ld	a, (_move_actor_path_flags_65536_180+0)
;actor.c:84: if (step->x == -128) step = curr_step = act->path;
	ld	hl, (_move_actor_step_65536_180)
;actor.c:87: act->x += (path_flags & PATH_FLIP_X) ? -step->x : step->x;
	ld	e, (hl)
	push	af
	ld	a, e
	rlca
	sbc	a, a
	ld	d, a
	pop	af
	rrca
	jr	NC, 00126$
	ld	hl, #0x0000
	cp	a, a
	sbc	hl, de
	ex	de, hl
00126$:
	ld	a, -4 (ix)
	add	a, e
	ld	e, a
	ld	a, -3 (ix)
	adc	a, d
	ld	d, a
	ld	a, e
	ld	(bc), a
	inc	bc
	ld	a, d
	ld	(bc), a
;actor.c:79: if (act->path) {
	ld	bc, (_move_actor_act_65536_180)
;actor.c:88: act->y += (path_flags & PATH_FLIP_Y) ? -step->y : step->y;
	inc	bc
	inc	bc
	inc	bc
	ld	a, (bc)
	ld	-8 (ix), a
	inc	bc
	ld	a, (bc)
	ld	-7 (ix), a
	dec	bc
	ld	a, (_move_actor_path_flags_65536_180+0)
	ld	e, a
;actor.c:84: if (step->x == -128) step = curr_step = act->path;
	ld	hl, (_move_actor_step_65536_180)
;actor.c:88: act->y += (path_flags & PATH_FLIP_Y) ? -step->y : step->y;
	inc	hl
	ld	a, (hl)
	ld	-6 (ix), a
	rlca
	sbc	a, a
	ld	-5 (ix), a
	bit	1, e
	jr	Z, 00128$
	xor	a, a
	sub	a, -6 (ix)
	ld	-4 (ix), a
	sbc	a, a
	sub	a, -5 (ix)
	ld	-3 (ix), a
	jr	00129$
00128$:
	ld	a, -6 (ix)
	ld	-4 (ix), a
	ld	a, -5 (ix)
	ld	-3 (ix), a
00129$:
	ld	a, -4 (ix)
	add	a, -8 (ix)
	ld	e, a
	ld	a, -3 (ix)
	adc	a, -7 (ix)
	ld	d, a
	ld	a, e
	ld	(bc), a
	inc	bc
	ld	a, d
	ld	(bc), a
;actor.c:90: if (path_flags & PATH_2X_SPEED) {
	ld	a, (_move_actor_path_flags_65536_180+0)
	bit	2, a
	jp	Z,00110$
;actor.c:91: step = curr_step++;
	ld	hl, (_move_actor_curr_step_65536_180)
	ld	(_move_actor_step_65536_180), hl
	ld	hl, (_move_actor_curr_step_65536_180)
	inc	hl
	inc	hl
	ld	(_move_actor_curr_step_65536_180), hl
;actor.c:92: if (step->x == -128) step = curr_step = act->path;
	ld	hl, (_move_actor_step_65536_180)
	ld	a, (hl)
;actor.c:79: if (act->path) {
	ld	bc, (_move_actor_act_65536_180)
;actor.c:92: if (step->x == -128) step = curr_step = act->path;
	sub	a, #0x80
	jr	NZ, 00108$
	ld	e, c
	ld	d, b
	ld	hl, #28
	add	hl, de
	ld	a, (hl)
	inc	hl
	ld	h, (hl)
;	spillPairReg hl
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	ld	(_move_actor_curr_step_65536_180), hl
	ld	(_move_actor_step_65536_180), hl
00108$:
;actor.c:94: path_flags = act->path_flags;
	ld	e, c
	ld	d, b
	ld	hl, #27
	add	hl, de
	ld	a, (hl)
	ld	(_move_actor_path_flags_65536_180+0), a
;actor.c:87: act->x += (path_flags & PATH_FLIP_X) ? -step->x : step->x;
	inc	bc
	inc	sp
	inc	sp
;actor.c:95: act->x += (path_flags & PATH_FLIP_X) ? -step->x : step->x;
	ld	l, c
	ld	h, b
	push	hl
	ld	a, (hl)
	ld	-8 (ix), a
	inc	hl
	ld	a, (hl)
	ld	-7 (ix), a
	ld	a, (_move_actor_path_flags_65536_180+0)
	ld	c, a
;actor.c:84: if (step->x == -128) step = curr_step = act->path;
	ld	hl, (_move_actor_step_65536_180)
;actor.c:87: act->x += (path_flags & PATH_FLIP_X) ? -step->x : step->x;
	ld	a, (hl)
	ld	-6 (ix), a
	rlca
	sbc	a, a
	ld	-5 (ix), a
;actor.c:95: act->x += (path_flags & PATH_FLIP_X) ? -step->x : step->x;
	bit	0, c
	jr	Z, 00130$
	xor	a, a
	sub	a, -6 (ix)
	ld	-4 (ix), a
	sbc	a, a
	sub	a, -5 (ix)
	ld	-3 (ix), a
	jr	00131$
00130$:
	ld	a, -6 (ix)
	ld	-4 (ix), a
	ld	a, -5 (ix)
	ld	-3 (ix), a
00131$:
	ld	a, -8 (ix)
	add	a, -4 (ix)
	ld	c, a
	ld	a, -7 (ix)
	adc	a, -3 (ix)
	ld	b, a
	pop	hl
	push	hl
	ld	(hl), c
	inc	hl
	ld	(hl), b
;actor.c:79: if (act->path) {
	ld	bc, (_move_actor_act_65536_180)
;actor.c:88: act->y += (path_flags & PATH_FLIP_Y) ? -step->y : step->y;
	inc	bc
	inc	bc
	inc	bc
;actor.c:96: act->y += (path_flags & PATH_FLIP_Y) ? -step->y : step->y;
	ld	a, (bc)
	ld	-8 (ix), a
	inc	bc
	ld	a, (bc)
	ld	-7 (ix), a
	dec	bc
	ld	a, (_move_actor_path_flags_65536_180+0)
	ld	e, a
;actor.c:84: if (step->x == -128) step = curr_step = act->path;
	ld	hl, (_move_actor_step_65536_180)
;actor.c:88: act->y += (path_flags & PATH_FLIP_Y) ? -step->y : step->y;
	inc	hl
	ld	a, (hl)
	ld	-6 (ix), a
	rlca
	sbc	a, a
	ld	-5 (ix), a
;actor.c:96: act->y += (path_flags & PATH_FLIP_Y) ? -step->y : step->y;
	bit	1, e
	jr	Z, 00132$
	xor	a, a
	sub	a, -6 (ix)
	ld	-4 (ix), a
	sbc	a, a
	sub	a, -5 (ix)
	ld	-3 (ix), a
	jr	00133$
00132$:
	ld	a, -6 (ix)
	ld	-4 (ix), a
	ld	a, -5 (ix)
	ld	-3 (ix), a
00133$:
	ld	a, -4 (ix)
	add	a, -8 (ix)
	ld	e, a
	ld	a, -3 (ix)
	adc	a, -7 (ix)
	ld	d, a
	ld	a, e
	ld	(bc), a
	inc	bc
	ld	a, d
	ld	(bc), a
00110$:
;actor.c:99: act->curr_step = curr_step;
	ld	hl, (_move_actor_act_65536_180)
	ld	bc, #0x001e
	add	hl, bc
	ld	a, (_move_actor_curr_step_65536_180+0)
	ld	(hl), a
	inc	hl
	ld	a, (_move_actor_curr_step_65536_180+1)
	ld	(hl), a
00112$:
;actor.c:102: if (_act->spd_x) {
	ld	a, -2 (ix)
	add	a, #0x0d
	ld	c, a
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	b, a
	ld	l, c
	ld	h, b
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	ld	a, d
	or	a, e
	jr	Z, 00121$
;actor.c:103: _act->x += _act->spd_x;
	ld	a, -2 (ix)
	add	a, #0x01
	ld	-4 (ix), a
	ld	a, -1 (ix)
	adc	a, #0x00
	ld	-3 (ix), a
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	a, (hl)
	inc	hl
	ld	h, (hl)
;	spillPairReg hl
	ld	l, a
;	spillPairReg hl
;	spillPairReg hl
	add	hl, de
	ex	de, hl
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	(hl), e
	inc	hl
	ld	(hl), d
;actor.c:105: if (_act->spd_x < 0) {
	ld	l, c
	ld	h, b
	inc	hl
	ld	b, (hl)
;actor.c:103: _act->x += _act->spd_x;
	ld	l, -4 (ix)
	ld	h, -3 (ix)
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
;actor.c:105: if (_act->spd_x < 0) {
	bit	7, b
	jr	Z, 00118$
;actor.c:106: if (_act->x + _act->pixel_w < 0) _act->active = 0;
	ld	c, -2 (ix)
	ld	b, -1 (ix)
	ld	hl, #18
	add	hl, bc
	ld	l, (hl)
;	spillPairReg hl
	ld	h, #0x00
;	spillPairReg hl
;	spillPairReg hl
	add	hl, de
	bit	7, h
	jr	Z, 00121$
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	(hl), #0x00
	jr	00121$
00118$:
;actor.c:108: if (_act->x >= SCREEN_W) _act->active = 0;
	ld	a, d
	xor	a, #0x80
	sub	a, #0x81
	jr	C, 00121$
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	(hl), #0x00
00121$:
;actor.c:79: if (act->path) {
	ld	hl, (_move_actor_act_65536_180)
;actor.c:112: if (act->state_timer) act->state_timer--;
	ld	bc, #0x0021
	add	hl, bc
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
	dec	hl
	ld	a, b
	or	a, c
	jr	Z, 00124$
	dec	bc
	ld	(hl), c
	inc	hl
	ld	(hl), b
00124$:
;actor.c:113: }
	ld	sp, ix
	pop	ix
	ret
;actor.c:115: void draw_actor(actor *act) {
;	---------------------------------
; Function draw_actor
; ---------------------------------
_draw_actor::
	push	ix
	ld	ix,#0
	add	ix,sp
	push	af
	push	af
	push	af
;actor.c:120: if (!act->active) {
	ld	-2 (ix), l
	ld	-1 (ix), h
	ld	c, (hl)
	ld	a, c
	or	a, a
;actor.c:121: return;
	jp	Z,00110$
;actor.c:124: _act = act;
	ld	l, -2 (ix)
	ld	h, -1 (ix)
	ld	(_draw_actor__act_65536_188), hl
;actor.c:126: frame_tile = _act->base_tile + _act->frame;
	ld	bc, (_draw_actor__act_65536_188)
	push	bc
	pop	iy
	ld	e, 22 (iy)
	push	bc
	pop	iy
	ld	a, 24 (iy)
	add	a, e
	ld	(_draw_actor_frame_tile_65536_188+0), a
;actor.c:127: if (!_act->facing_left) {
	push	bc
	pop	iy
	ld	a, 15 (iy)
	or	a, a
	jr	NZ, 00104$
;actor.c:128: frame_tile += _act->frame_max;
	ld	e, c
	ld	d, b
	ld	hl, #26
	add	hl, de
	ld	a, (hl)
	ld	hl, #_draw_actor_frame_tile_65536_188
	add	a, (hl)
	ld	(hl), a
00104$:
;actor.c:131: draw_meta_sprite(_act->x, _act->y, _act->char_w, _act->char_h, frame_tile);	
	ld	e, c
	ld	d, b
	ld	hl, #17
	add	hl, de
	ld	a, (hl)
	ld	-6 (ix), a
	ld	-5 (ix), #0x00
	ld	e, c
	ld	d, b
	ld	hl, #16
	add	hl, de
	ld	a, (hl)
	ld	-4 (ix), a
	ld	-3 (ix), #0x00
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	inc	hl
	inc	hl
	inc	hl
	ld	e, (hl)
	inc	hl
	ld	d, (hl)
	ld	l, c
	ld	h, b
	inc	hl
	ld	c, (hl)
	inc	hl
	ld	b, (hl)
	ld	a, (_draw_actor_frame_tile_65536_188+0)
	push	af
	inc	sp
	ld	l, -6 (ix)
;	spillPairReg hl
;	spillPairReg hl
	ld	h, -5 (ix)
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
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	call	_draw_meta_sprite
;actor.c:126: frame_tile = _act->base_tile + _act->frame;
	ld	bc, (_draw_actor__act_65536_188)
;actor.c:133: if (_act->animation_delay) {
	ld	hl, #0x0014
	add	hl, bc
	ld	a, (hl)
	or	a, a
	jr	Z, 00108$
;actor.c:134: _act->animation_delay--;
	dec	a
	ld	(hl), a
	jr	00110$
00108$:
;actor.c:126: frame_tile = _act->base_tile + _act->frame;
	ld	hl, #0x0018
	add	hl, bc
	ex	de, hl
;actor.c:136: frame = _act->frame;		
	ld	a, (de)
	ld	(_draw_actor_frame_65536_188+0), a
;actor.c:137: frame += _act->frame_increment;
	ld	l, c
;	spillPairReg hl
;	spillPairReg hl
	ld	h, b
;	spillPairReg hl
;	spillPairReg hl
	push	bc
	ld	bc, #0x0019
	add	hl, bc
	pop	bc
	ld	a, (hl)
	ld	hl, #_draw_actor_frame_65536_188
	add	a, (hl)
	ld	(hl), a
;actor.c:138: if (frame >= _act->frame_max) frame = 0;		
	ld	hl, #26
	add	hl, bc
	ld	c, (hl)
	ld	a, (_draw_actor_frame_65536_188+0)
	sub	a, c
	jr	C, 00106$
	ld	hl, #_draw_actor_frame_65536_188
	ld	(hl), #0x00
00106$:
;actor.c:139: _act->frame = frame;
	ld	a, (_draw_actor_frame_65536_188+0)
	ld	(de), a
;actor.c:126: frame_tile = _act->base_tile + _act->frame;
	ld	bc, (_draw_actor__act_65536_188)
;actor.c:141: _act->animation_delay = _act->animation_delay_max;
	ld	hl, #0x0014
	add	hl, bc
	ex	de, hl
	ld	hl, #21
	add	hl, bc
	ld	a, (hl)
	ld	(de), a
00110$:
;actor.c:143: }
	ld	sp, ix
	pop	ix
	ret
;actor.c:145: void wait_frames(int wait_time) {
;	---------------------------------
; Function wait_frames
; ---------------------------------
_wait_frames::
00103$:
;actor.c:146: for (; wait_time; wait_time--) SMS_waitForVBlank();
	ld	a, h
	or	a, l
	ret	Z
	push	hl
	call	_SMS_waitForVBlank
	pop	hl
	dec	hl
;actor.c:147: }
	jr	00103$
;actor.c:149: void clear_sprites() {
;	---------------------------------
; Function clear_sprites
; ---------------------------------
_clear_sprites::
;actor.c:150: SMS_initSprites();	
	call	_SMS_initSprites
;actor.c:151: SMS_finalizeSprites();
	call	_SMS_finalizeSprites
;actor.c:152: SMS_copySpritestoSAT();
;actor.c:153: }
	jp	_SMS_copySpritestoSAT
	.area _CODE
	.area _INITIALIZER
	.area _CABS (ABS)
