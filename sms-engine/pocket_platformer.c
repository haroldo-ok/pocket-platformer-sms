/*
 * Pocket Platformer - Sega Master System Engine  v1.3
 *
 * FIX LOG v1.3:
 *   - BUG: player looked like it was hovering 8px above floor.
 *     CAUSE: SPRITEMODE_TALL was set, which doubles the sprite height to 16px
 *     and reads from a consecutive tile pair. But pocket-platformer's player
 *     art is 8x8 pixels (one tile). The bottom tile was blank, so the player
 *     appeared as an 8px sprite with 8px of blank below it, floating above ground.
 *     FIX: removed SPRITEMODE_TALL. Now using normal 8x8 sprites.
 *          PLAYER_H = 8 (matches actual sprite size).
 *          Sprite sheet uses 1 tile per sprite (9 tiles total, not 18).
 *
 * v1.2 fixes (previous):
 *   - int16 overflow on y coords → changed x/y/vx/vy to long (32-bit).
 *   - Nametable tile 0 = blank (SMS_useFirstHalfTilesforSprites(0),
 *     sprite tiles at 256+, BG tiles at 1+).
 *
 * v1.1 fixes:
 *   - SMS_setBGScrollX formula, SMS_print(), title before init_resources().
 */

#include <stdlib.h>
#include <string.h>
#include "lib/SMSlib.h"
#include "lib/PSGlib.h"
#include "data.h"
#include "actor.h"

/* ── Screen ─────────────────────────────────────────────── */
#define TILE_SIZE       8
#define SCREEN_TILES_W  32
#define SCREEN_TILES_H  24
#define SCREEN_PX_W     256
#define SCREEN_PX_H     192

/* ── Resource bank ──────────────────────────────────────── */
#define RESOURCE_BANK       2
#define RESOURCE_BASE_ADDR  0x8000
#define map_res_bank()      SMS_mapROMBank(RESOURCE_BANK)

/* ── VRAM layout ────────────────────────────────────────── */
/* SMS_useFirstHalfTilesforSprites(0): sprite engine uses tiles 256-511.
   BG tiles at 0-255. Tile 0 = blank (nametable default). No conflict.
   Sprite sheet: 9 sprites × 1 tile each (8x8, SPRITEMODE_NORMAL). */
#define VRAM_BG_BLANK         0
#define VRAM_BG_BASE          1    /* BG tiles start at VRAM tile 1 */
#define VRAM_SPR_START_FLAG 256
#define VRAM_SPR_FINISH_FLAG 257
#define VRAM_SPR_SPIKE       258
#define VRAM_SPR_TRAMPOLINE  259
#define VRAM_SPR_COIN        260
#define VRAM_SPR_PLAYER_IDLE 261
#define VRAM_SPR_PLAYER_WALK0 262
#define VRAM_SPR_PLAYER_WALK1 263
#define VRAM_SPR_PLAYER_JUMP  264
#define VRAM_TILE_FONT        352

/* ── Object types (must match SmsExporter.js) ───────────── */
#define OBJ_START_FLAG  1
#define OBJ_FINISH_FLAG 2
#define OBJ_SPIKE       3
#define OBJ_TRAMPOLINE  4
#define OBJ_COIN        5

/* ── Fixed-point 8.8 using long (32-bit) ────────────────── */
/* Max velocity per frame must stay < TILE_SIZE to prevent tunneling */
#define MAX_VY  ((TILE_SIZE - 1) * FP_ONE)
#define FP_ONE      256L
#define FP(x)       ((long)((x) * FP_ONE))
#define FP_MUL(a,b) (((long)(a) * (long)(b)) >> 8)
#define GRAVITY     FP(0.5)

/* ── Player collision box (8x8 sprite, slightly narrower) ── */
#define PLAYER_W   6
#define PLAYER_H   8
#define MAX_OBJECTS 32

/* ──────────────────────────────────────────────────────────
 * Structs
 * ──────────────────────────────────────────────────────────*/
typedef struct {
    unsigned char signature[4];
    unsigned char level_count;
    unsigned char num_tiles;
    unsigned char one_way_vram_idx; /* VRAM tile index of the one-way block (0=none) */
} resource_header;

typedef struct {
    int  max_speed;
    int  ground_accel;
    int  ground_friction;
    int  air_accel;
    int  air_friction;
    int  jump_speed;
    unsigned char max_jump_frames;
    int  max_fall_speed;
    unsigned char has_double_jump;
    unsigned char has_wall_jump;
} physics_config;

typedef struct {
    unsigned char map_w, map_h, obj_count, reserved;
} level_header;

typedef struct {
    unsigned char x, y, type;
} level_object;

typedef struct {
    long          x, y, vx, vy;
    unsigned char on_ground;
    unsigned char jump_frames;
    unsigned char facing_left;
    unsigned char double_jump_used;
    unsigned char anim_frame;
    unsigned char anim_timer;
} player_state;

/* ──────────────────────────────────────────────────────────
 * Globals
 * ──────────────────────────────────────────────────────────*/
static resource_header *res_header;
static physics_config  *res_physics;
static unsigned char   *res_palette;
static unsigned char   *res_tileset;
static unsigned char   *res_sprites;
static level_header    *res_levels;

static player_state     player;
static unsigned int     camera_x, prev_cam_x;
static unsigned char    coin_collected[MAX_OBJECTS];
static unsigned char    level_complete, player_died;
static level_header    *cur_level;
static unsigned char   *cur_map;
static level_object    *cur_objects;

/* ──────────────────────────────────────────────────────────
 * Resource helpers
 * ──────────────────────────────────────────────────────────*/
static unsigned char has_resource(void) {
    volatile unsigned char *p = (unsigned char *)RESOURCE_BASE_ADDR;
    map_res_bank();
    return (p[0]=='P' && p[1]=='P' && p[2]=='L' && p[3]=='T');
}

static void init_resources(void) {
    map_res_bank();
    res_header  = (resource_header *)RESOURCE_BASE_ADDR;
    res_physics = (physics_config  *)(RESOURCE_BASE_ADDR + sizeof(resource_header));
    res_palette = (unsigned char   *)res_physics + sizeof(physics_config);
    res_tileset = res_palette + 16;
    /* Sprite sheet: 9 tiles × 32 bytes (8x8 sprites, SPRITEMODE_NORMAL) */
    res_sprites = res_tileset + (unsigned int)res_header->num_tiles * 32u;
    res_levels  = (level_header *)(res_sprites + 9u * 32u);
}

static level_header *get_level(unsigned char n) {
    level_header *lh = res_levels;
    unsigned char i;
    map_res_bank();
    for (i = 0; i < n; i++) {
        unsigned int sz = sizeof(level_header)
            + (unsigned int)lh->map_w * lh->map_h
            + (unsigned int)lh->obj_count * 3u;
        lh = (level_header *)((unsigned char *)lh + sz);
    }
    return lh;
}

/* ──────────────────────────────────────────────────────────
 * Tile / collision helpers
 * ──────────────────────────────────────────────────────────*/
static unsigned char get_tile(unsigned char tx, unsigned char ty) {
    if (tx >= cur_level->map_w || ty >= cur_level->map_h) return 0;
    return cur_map[(unsigned int)tx * cur_level->map_h + ty];
}

/* Fully solid: returns 1 for any non-zero tile.
   Used for horizontal movement and jumping up. */
static unsigned char is_solid_px(long fpx, long fpy) {
    unsigned char t;
    long px = fpx >> 8, py = fpy >> 8;
    if (px < 0 || py < 0) return 1;
    t = get_tile((unsigned char)(px / TILE_SIZE),
                 (unsigned char)(py / TILE_SIZE));
    if (t == 0) return 0;
    /* One-way tiles are NOT solid from sides or below */
    if (res_header->one_way_vram_idx && t == res_header->one_way_vram_idx) return 0;
    return 1;
}

/* One-way aware: solid for all tiles PLUS one-way top surface when falling.
   Used only for the downward collision check. */
static unsigned char is_solid_falling_px(long fpx, long fpy) {
    unsigned char t;
    long px = fpx >> 8, py = fpy >> 8;
    if (px < 0 || py < 0) return 1;
    t = get_tile((unsigned char)(px / TILE_SIZE),
                 (unsigned char)(py / TILE_SIZE));
    return t != 0;
}

/* ──────────────────────────────────────────────────────────
 * Graphics
 * ──────────────────────────────────────────────────────────*/
static void load_graphics(void) {
    unsigned char i;
    map_res_bank();
    SMS_loadBGPalette(res_palette);
    SMS_setSpritePaletteColor(0, 0);
    for (i = 1; i < 16; i++)
        SMS_setSpritePaletteColor(i, res_palette[i]);
    /* BG tiles at VRAM 1..N */
    SMS_loadTiles(res_tileset, VRAM_BG_BASE,
                  (unsigned int)res_header->num_tiles * 32u);
    /* Sprite sheet at VRAM 256..264 (9 × 8x8 tiles) */
    SMS_loadTiles(res_sprites, 256u, 9u * 32u);
    SMS_load1bppTiles(font_1bpp, VRAM_TILE_FONT, font_1bpp_size, 0, 1);
    SMS_configureTextRenderer(VRAM_TILE_FONT - 32);
}

static void draw_tilemap_full(void) {
    unsigned char x, y;
    map_res_bank();
    for (y = 0; y < SCREEN_TILES_H; y++) {
        SMS_setNextTileatXY(0, y);
        for (x = 0; x < SCREEN_TILES_W; x++) {
            unsigned char t = (y < cur_level->map_h) ? get_tile(x, y) : 0;
            SMS_setTile(t ? (unsigned int)(VRAM_BG_BASE + t - 1) : 0u);
        }
    }
}

static void draw_tile_column(unsigned char scr_col, unsigned char map_col) {
    unsigned char y;
    map_res_bank();
    SMS_setNextTileatXY(scr_col, 0);
    for (y = 0; y < SCREEN_TILES_H; y++) {
        unsigned char t = (y < cur_level->map_h) ? get_tile(map_col, y) : 0;
        SMS_setTile(t ? (unsigned int)(VRAM_BG_BASE + t - 1) : 0u);
    }
}

/* ──────────────────────────────────────────────────────────
 * Sprite draw  (8x8 normal sprites)
 * ──────────────────────────────────────────────────────────*/
static unsigned int obj_sprite_tile(unsigned char type) {
    switch (type) {
        case OBJ_FINISH_FLAG: return VRAM_SPR_FINISH_FLAG;
        case OBJ_SPIKE:       return VRAM_SPR_SPIKE;
        case OBJ_TRAMPOLINE:  return VRAM_SPR_TRAMPOLINE;
        case OBJ_COIN:        return VRAM_SPR_COIN;
        default:              return VRAM_SPR_FINISH_FLAG;
    }
}

static void draw_objects(void) {
    unsigned char i;
    map_res_bank();
    for (i = 0; i < cur_level->obj_count; i++) {
        level_object *obj = &cur_objects[i];
        int sx, sy;
        if (obj->type == OBJ_START_FLAG) continue;
        if (obj->type == OBJ_COIN && coin_collected[i]) continue;
        sx = (int)obj->x * TILE_SIZE - (int)camera_x;
        sy = (int)obj->y * TILE_SIZE;
        if (sx < -8 || sx > SCREEN_PX_W) continue;
        if (sy < 0  || sy > SCREEN_PX_H) continue;
        SMS_addSprite((unsigned char)sx, (unsigned char)sy,
                      (unsigned char)obj_sprite_tile(obj->type));
    }
}

static void draw_player(void) {
    int sx = (int)(player.x >> 8) - (int)camera_x;
    int sy = (int)(player.y >> 8);
    unsigned int tile;
    if (sx < -8 || sx > SCREEN_PX_W) return;
    if (!player.on_ground)
        tile = VRAM_SPR_PLAYER_JUMP;
    else if (player.vx != 0)
        tile = (player.anim_frame & 2) ? VRAM_SPR_PLAYER_WALK1 : VRAM_SPR_PLAYER_WALK0;
    else
        tile = VRAM_SPR_PLAYER_IDLE;
    SMS_addSprite((unsigned char)sx, (unsigned char)sy, (unsigned char)tile);
}

/* ──────────────────────────────────────────────────────────
 * Physics
 * ──────────────────────────────────────────────────────────*/
static void apply_gravity(void) {
    if (!player.on_ground) {
        player.vy += GRAVITY;
        if (player.vy > MAX_VY)
            player.vy = MAX_VY;
    }
}

static void handle_input(unsigned int joy, unsigned int joy_pressed) {
    long max_spd = (long)res_physics->max_speed;
    long accel   = player.on_ground ? (long)res_physics->ground_accel
                                    : (long)res_physics->air_accel;
    if (joy & PORT_A_KEY_LEFT) {
        player.vx -= accel;
        if (player.vx < -max_spd) player.vx = -max_spd;
        player.facing_left = 1;
    } else if (joy & PORT_A_KEY_RIGHT) {
        player.vx += accel;
        if (player.vx > max_spd) player.vx = max_spd;
        player.facing_left = 0;
    } else {
        long fr = player.on_ground ? (long)res_physics->ground_friction
                                   : (long)res_physics->air_friction;
        player.vx = FP_MUL(player.vx, fr);
        if (player.vx > -FP(0.2) && player.vx < FP(0.2)) player.vx = 0;
    }
    if (joy_pressed & PORT_A_KEY_1) {
        if (player.on_ground) {
            player.vy = -(long)res_physics->jump_speed;
            player.jump_frames = res_physics->max_jump_frames;
            player.on_ground = 0;
        } else if (res_physics->has_double_jump && !player.double_jump_used) {
            player.vy = -(long)res_physics->jump_speed;
            player.jump_frames = res_physics->max_jump_frames >> 1;
            player.double_jump_used = 1;
        }
    }
    if (player.jump_frames) {
        if (joy & PORT_A_KEY_1) { player.vy -= FP(0.04); player.jump_frames--; }
        else                      player.jump_frames = 0;
    }
}

static void move_player_x(void) {
    long new_x = player.x + player.vx;
    long px    = new_x >> 8;
    if (player.vx > 0) {
        long r = new_x + FP(PLAYER_W);
        if (is_solid_px(r, player.y + FP(1)) ||
            is_solid_px(r, player.y + FP(PLAYER_H - 2))) {
            long tile_r = (px + PLAYER_W) / TILE_SIZE;
            new_x = (tile_r * TILE_SIZE - PLAYER_W - 1) * FP_ONE;
            player.vx = 0;
        }
    } else if (player.vx < 0) {
        if (is_solid_px(new_x, player.y + FP(1)) ||
            is_solid_px(new_x, player.y + FP(PLAYER_H - 2))) {
            long tile_l = px / TILE_SIZE + 1;
            new_x = tile_l * TILE_SIZE * FP_ONE;
            player.vx = 0;
        }
    }
    player.x = new_x;
}

static void move_player_y(void) {
    long new_y = player.y + player.vy;
    long py    = new_y >> 8;
    if (player.vy >= 0) {
        long b = new_y + FP(PLAYER_H);
        if (is_solid_falling_px(player.x + FP(1),            b) ||
            is_solid_falling_px(player.x + FP(PLAYER_W - 2), b)) {
            long tile_b = (py + PLAYER_H) / TILE_SIZE;
            /* For one-way tiles: only land if player's feet were ABOVE the
               tile top last frame (i.e. player.y >> 8 + PLAYER_H <= tile top). */
            if (res_header->one_way_vram_idx) {
                unsigned char t1 = get_tile(
                    (unsigned char)((player.x >> 8) / TILE_SIZE + 0),
                    (unsigned char)tile_b);
                unsigned char t2 = get_tile(
                    (unsigned char)((player.x >> 8) / TILE_SIZE + 1),
                    (unsigned char)tile_b);
                unsigned char is_one_way =
                    (t1 == res_header->one_way_vram_idx) ||
                    (t2 == res_header->one_way_vram_idx);
                if (is_one_way) {
                    long prev_feet = player.y + FP(PLAYER_H);
                    long tile_top  = tile_b * TILE_SIZE * FP_ONE;
                    if (prev_feet > tile_top) goto skip_land;
                }
            }
            new_y = (tile_b * TILE_SIZE - PLAYER_H) * FP_ONE;
            player.vy = 0;
            player.on_ground = 1;
            player.double_jump_used = 0;
            skip_land:;
        }
    } else {
        if (is_solid_px(player.x + FP(1),            new_y) ||
            is_solid_px(player.x + FP(PLAYER_W - 2), new_y)) {
            long tile_t = py / TILE_SIZE + 1;
            new_y = tile_t * TILE_SIZE * FP_ONE;
            player.vy = 0;
            player.jump_frames = 0;
        }
    }
    player.y = new_y;
}

/* ──────────────────────────────────────────────────────────
 * Object collision
 * ──────────────────────────────────────────────────────────*/
static void check_object_collisions(void) {
    long px = player.x >> 8, py = player.y >> 8;
    unsigned char i;
    map_res_bank();
    for (i = 0; i < cur_level->obj_count; i++) {
        level_object *obj = &cur_objects[i];
        long ox = (long)obj->x * TILE_SIZE, oy = (long)obj->y * TILE_SIZE;
        if (px + PLAYER_W <= ox || px >= ox + TILE_SIZE) continue;
        if (py + PLAYER_H <= oy || py >= oy + TILE_SIZE) continue;
        switch (obj->type) {
            case OBJ_FINISH_FLAG: level_complete = 1; break;
            case OBJ_SPIKE:       player_died = 1; break;
            case OBJ_TRAMPOLINE:
                player.vy = -((long)res_physics->jump_speed + FP(1.5));
                player.jump_frames = 0; player.on_ground = 0; break;
            case OBJ_COIN:
                if (!coin_collected[i]) coin_collected[i] = 1; break;
        }
    }
}

/* ──────────────────────────────────────────────────────────
 * Camera
 * ──────────────────────────────────────────────────────────*/
static void update_camera(void) {
    /* Scrolling temporarily disabled - camera locked at x=0. */
    camera_x = 0;
    SMS_setBGScrollX(0);
}

/* ──────────────────────────────────────────────────────────
 * Animation, level, death
 * ──────────────────────────────────────────────────────────*/
static void update_anim(void) {
    if (player.anim_timer) { player.anim_timer--; }
    else { player.anim_timer = 5; player.anim_frame = (player.anim_frame + 1) & 3; }
}

static void load_level(unsigned char n) {
    unsigned char i;
    map_res_bank();
    cur_level   = get_level(n);
    cur_map     = (unsigned char *)cur_level + sizeof(level_header);
    cur_objects = (level_object *)(cur_map +
                  (unsigned int)cur_level->map_w * cur_level->map_h);

    for (i = 0; i < MAX_OBJECTS; i++) coin_collected[i] = 0;
    level_complete = player_died = 0;
    camera_x = prev_cam_x = 0;

    /* Default spawn in case no start flag found */
    player.x  = FP(2 * TILE_SIZE);
    player.y  = FP(4 * TILE_SIZE);
    player.vx = player.vy = 0;
    player.on_ground = player.jump_frames = player.double_jump_used = 0;
    player.facing_left = player.anim_frame = player.anim_timer = 0;

    for (i = 0; i < cur_level->obj_count; i++) {
        if (cur_objects[i].type == OBJ_START_FLAG) {
            player.x = (long)cur_objects[i].x * TILE_SIZE * FP_ONE;
            /* Spawn one tile above the flag position */
            player.y = (long)(cur_objects[i].y - 1) * TILE_SIZE * FP_ONE;
            break;
        }
    }

    SMS_waitForVBlank();
    SMS_displayOff();
    SMS_VRAMmemsetW(0x3800, 0, 0x700);
    draw_tilemap_full();
    SMS_displayOn();
}

static void death_sequence(unsigned char n) {
    unsigned char i;
    for (i = 0; i < 8; i++) {
        SMS_waitForVBlank();
        SMS_setBackdropColor(i & 1 ? 0x3F : 0);
    }
    SMS_setBackdropColor(0);
    load_level(n);
}

/* ──────────────────────────────────────────────────────────
 * Game loop
 * ──────────────────────────────────────────────────────────*/
static void gameplay_loop(void) {
    unsigned int joy = 0, joy_prev = 0, joy_pressed;
    unsigned char level_n = 0, total;

    map_res_bank();
    total = res_header->level_count;
    load_level(0);

    while (1) {
        SMS_waitForVBlank();
        joy_prev    = joy;
        joy         = SMS_getKeysStatus();
        joy_pressed = joy & ~joy_prev;

        handle_input(joy, joy_pressed);
        apply_gravity();
        player.on_ground = 0;
        move_player_x();
        move_player_y();
        check_object_collisions();
        update_camera();
        update_anim();

        SMS_initSprites();
        draw_objects();
        draw_player();
        SMS_finalizeSprites();
        SMS_copySpritestoSAT();

        if (player_died) {
            death_sequence(level_n);
        } else if (level_complete) {
            unsigned char i;
            for (i = 0; i < 60; i++) SMS_waitForVBlank();
            level_n = (level_n + 1 < total) ? level_n + 1 : 0;
            load_level(level_n);
        }
    }
}

/* ──────────────────────────────────────────────────────────
 * Title screen
 * ──────────────────────────────────────────────────────────*/
static void title_screen(void) {
    unsigned int joy;
    SMS_waitForVBlank();
    SMS_displayOff();
    SMS_VRAMmemsetW(0, 0, 16 * 1024);
    SMS_zeroBGPalette();
    SMS_zeroSpritePalette();
    SMS_setBGPaletteColor(1, 0x3F);
    SMS_load1bppTiles(font_1bpp, VRAM_TILE_FONT, font_1bpp_size, 0, 1);
    SMS_configureTextRenderer(VRAM_TILE_FONT - 32);
    SMS_displayOn();
    SMS_printatXY(4,  8, "POCKET PLATFORMER");
    SMS_printatXY(3, 10, "for Sega Master System");
    SMS_printatXY(4, 14, "Press 1 to start");
    do { SMS_waitForVBlank(); joy = SMS_getKeysStatus(); }
    while (!(joy & (PORT_A_KEY_1 | PORT_A_KEY_2)));
    do { SMS_waitForVBlank(); joy = SMS_getKeysStatus(); }
    while (joy & (PORT_A_KEY_1 | PORT_A_KEY_2));
}

/* ──────────────────────────────────────────────────────────
 * Entry point
 * ──────────────────────────────────────────────────────────*/
void main(void) {
    /* 8x8 normal sprites; sprite engine uses tiles 256-511 */
    SMS_useFirstHalfTilesforSprites(0);
    SMS_setSpriteMode(SPRITEMODE_NORMAL);
    SMS_setBackdropColor(0);

    while (1) {
        title_screen();
        if (!has_resource()) continue;
        init_resources();
        SMS_waitForVBlank();
        SMS_displayOff();
        SMS_VRAMmemsetW(0, 0, 16 * 1024);
        load_graphics();
        SMS_displayOn();
        gameplay_loop();
    }
}

SMS_EMBED_SEGA_ROM_HEADER(9999, 0);
SMS_EMBED_SDSC_HEADER(1, 3, 2025, 1, 1,
    "pocket-platformer-sms",
    "Pocket Platformer SMS Engine",
    "Generated by pocket-platformer-to-sms web exporter.");
