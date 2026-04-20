/*
 * Pocket Platformer - Sega Master System Engine
 * Base ROM: receives game data appended after 0x8000 (bank 2)
 *
 * Resource layout (appended after base ROM):
 *   [header]        4 bytes  "PPLT"
 *   [level_count]   1 byte
 *   [physics]       physics_config struct
 *   [palette]       16 bytes (SMS palette, 1 byte each)
 *   [tileset]       NUM_TILES * 32 bytes (4bpp, 8x8)
 *   [levels]        level_count * level_entry structs
 *                   each level: header + columnar tile data + objects
 */

#include <stdlib.h>
#include <string.h>
#include "lib/SMSlib.h"
#include "lib/PSGlib.h"
#include "data.h"
#include "actor.h"

/* Simple string printer using the SMSlib tile text renderer */
static void print_str(const char *s) {
    while (*s) {
        SMS_setTile((unsigned int)(unsigned char)*s);
        s++;
    }
}

/* ── Screen constants ─────────────────────────────────────────── */
#define TILE_SIZE       8
#define SCREEN_TILES_W  32
#define SCREEN_TILES_H  24
#define SCREEN_PX_W     256
#define SCREEN_PX_H     192

/* ── Resource bank layout ─────────────────────────────────────── */
#define RESOURCE_BANK       2
#define RESOURCE_BASE_ADDR  0x8000

/* ── Object type IDs (must match SmsExporter.js) ─────────────── */
#define OBJ_START_FLAG  1
#define OBJ_FINISH_FLAG 2
#define OBJ_SPIKE       3
#define OBJ_TRAMPOLINE  4
#define OBJ_COIN        5

/* ── Fixed-point helpers (8.8) ────────────────────────────────── */
#define FP_ONE   0x100
#define FP(x)    ((int)((x) * FP_ONE))
#define FP_MUL(a,b)  (((int)(a) * (int)(b)) >> 8)

/* ── Gravity constant (pixels/frame^2 in 8.8) ────────────────── */
#define GRAVITY FP(0.5)

/* ── Max objects per level ────────────────────────────────────── */
#define MAX_OBJECTS  32
#define MAX_MAP_W    64
#define MAX_MAP_H    24

/* ── Tile indices in VRAM ─────────────────────────────────────── */
#define VRAM_TILE_EMPTY   0
#define VRAM_TILE_FONT    352   /* font starts here */
#define VRAM_TILE_SPRITES 256   /* sprite tiles start here */

/* ────────────────────────────────────────────────────────────────
 * Resource structures (must match JS packing)
 * ──────────────────────────────────────────────────────────────── */

typedef struct {
    unsigned char signature[4];   /* "PPLT" */
    unsigned char level_count;
    unsigned char num_tiles;      /* number of unique BG tiles */
} resource_header;

typedef struct {
    /* All values are 8.8 fixed-point, except jump_frames */
    int max_speed;
    int ground_accel;
    int ground_friction;
    int air_accel;
    int air_friction;
    int jump_speed;
    unsigned char max_jump_frames;
    int max_fall_speed;
    unsigned char has_double_jump;
    unsigned char has_wall_jump;
} physics_config;

typedef struct {
    unsigned char map_w;
    unsigned char map_h;
    unsigned char obj_count;
    unsigned char reserved;
} level_header;

typedef struct {
    unsigned char x, y;   /* tile coords */
    unsigned char type;
} level_object;

/* ────────────────────────────────────────────────────────────────
 * Player state
 * ──────────────────────────────────────────────────────────────── */
typedef struct {
    int x, y;             /* pixel position (8.8 fixed) */
    int vx, vy;           /* velocity (8.8 fixed) */
    unsigned char on_ground;
    unsigned char jump_frames;   /* remaining variable-jump frames */
    unsigned char facing_left;
    unsigned char dead;
    unsigned char double_jump_used;
    unsigned char wall_jump_dir;  /* -1 or 1 */
    unsigned char anim_frame;
    unsigned char anim_timer;
} player_state;

/* ────────────────────────────────────────────────────────────────
 * Globals
 * ──────────────────────────────────────────────────────────────── */
static resource_header  *res_header;
static physics_config   *res_physics;
static unsigned char    *res_palette;
static unsigned char    *res_tileset;
static level_header     *res_levels;  /* pointer to first level header */

static player_state player;
static unsigned char camera_x;          /* scroll offset in pixels */
static unsigned char coin_collected[MAX_OBJECTS];
static unsigned char level_complete;
static unsigned char player_died;

/* Cached pointer to current level data */
static level_header  *cur_level;
static unsigned char *cur_map;      /* columnar: col-major tile data */
static level_object  *cur_objects;

/* ────────────────────────────────────────────────────────────────
 * ROM bank switching helper
 * ──────────────────────────────────────────────────────────────── */
static void map_resource_bank(void) {
    SMS_mapROMBank(RESOURCE_BANK);
}

/* ────────────────────────────────────────────────────────────────
 * Resource navigation
 * ──────────────────────────────────────────────────────────────── */
static void init_resources(void) {
    map_resource_bank();
    res_header  = (resource_header *)RESOURCE_BASE_ADDR;
    res_physics = (physics_config *)(RESOURCE_BASE_ADDR + sizeof(resource_header));
    res_palette = (unsigned char *)res_physics + sizeof(physics_config);
    res_tileset = res_palette + 16;
    /* levels array follows tileset: num_tiles * 32 bytes per tile */
    res_levels  = (level_header *)(res_tileset + (unsigned int)res_header->num_tiles * 32);
}

/* Get pointer to level N (0-based) */
static level_header *get_level(unsigned char n) {
    map_resource_bank();
    level_header *lh = res_levels;
    unsigned char i;
    for (i = 0; i < n; i++) {
        unsigned int map_bytes = (unsigned int)lh->map_w * lh->map_h;
        unsigned int obj_bytes = (unsigned int)lh->obj_count * sizeof(level_object);
        lh = (level_header *)((unsigned char *)lh + sizeof(level_header) + map_bytes + obj_bytes);
    }
    return lh;
}

/* ────────────────────────────────────────────────────────────────
 * Tile map access (columnar storage: [x][y])
 * ──────────────────────────────────────────────────────────────── */
static unsigned char get_tile(unsigned char tx, unsigned char ty) {
    if (tx >= cur_level->map_w || ty >= cur_level->map_h) return 0;
    return cur_map[(unsigned int)tx * cur_level->map_h + ty];
}

/* Returns 1 if tile at pixel position is solid */
static unsigned char is_solid_px(int px, int py) {
    unsigned char tx = (unsigned char)((px >> 8) / TILE_SIZE);
    unsigned char ty = (unsigned char)((py >> 8) / TILE_SIZE);
    unsigned char t = get_tile(tx, ty);
    return (t != 0) ? 1 : 0;
}

/* ────────────────────────────────────────────────────────────────
 * Graphics init
 * ──────────────────────────────────────────────────────────────── */
static void load_graphics(void) {
    map_resource_bank();

    /* Load BG palette */
    SMS_loadBGPalette(res_palette);

    /* Sprite palette: color 0 = transparent, rest same as BG */
    SMS_setSpritePaletteColor(0, 0);
    unsigned char i;
    for (i = 1; i < 16; i++) {
        SMS_setSpritePaletteColor(i, res_palette[i]);
    }

    /* Load tile graphics into VRAM starting at tile 1
       (tile 0 = blank/transparent) */
    SMS_loadTiles(res_tileset, 1, (unsigned int)res_header->num_tiles * 32);

    /* Load font for HUD */
    SMS_load1bppTiles(font_1bpp, VRAM_TILE_FONT, font_1bpp_size, 0, 1);
    SMS_configureTextRenderer(VRAM_TILE_FONT - 32);
}

/* ────────────────────────────────────────────────────────────────
 * Draw the tilemap for the current level
 * ──────────────────────────────────────────────────────────────── */
static void draw_tilemap(void) {
    unsigned char x, y;
    map_resource_bank();

    /* Fill the full 32-wide nametable */
    for (x = 0; x < SCREEN_TILES_W; x++) {
        for (y = 0; y < cur_level->map_h && y < SCREEN_TILES_H; y++) {
            unsigned char tile = get_tile(x, y);
            /* VRAM tile index: tile 0 = empty, 1..N = our tiles */
            unsigned int vram_tile = tile ? (unsigned int)tile : 0;
            SMS_setTileatXY(x, y, vram_tile);
        }
        /* Clear below map */
        for (; y < SCREEN_TILES_H; y++) {
            SMS_setTileatXY(x, y, 0);
        }
    }
}

/* Redraw a single tile column (called during scroll) */
static void draw_tile_column(unsigned char screen_col, unsigned char map_col) {
    unsigned char y;
    map_resource_bank();
    SMS_setNextTileatXY(screen_col, 0);
    for (y = 0; y < SCREEN_TILES_H; y++) {
        unsigned char tile = (y < cur_level->map_h) ? get_tile(map_col, y) : 0;
        SMS_setTile((unsigned int)tile);
    }
}

/* ────────────────────────────────────────────────────────────────
 * Object sprites: draw all level objects as sprites
 * ──────────────────────────────────────────────────────────────── */

/* Sprite tile numbers for each object type (in sprite sheet).
   These must match the tile layout built by SmsExporter.js */
#define SPR_TILE_START_FLAG   0
#define SPR_TILE_FINISH_FLAG  2
#define SPR_TILE_SPIKE        4
#define SPR_TILE_TRAMPOLINE   6
#define SPR_TILE_COIN         8
#define SPR_TILE_PLAYER_IDLE  10
#define SPR_TILE_PLAYER_WALK  12
#define SPR_TILE_PLAYER_JUMP  14

static unsigned char obj_tile_for_type(unsigned char type) {
    switch (type) {
        case OBJ_START_FLAG:  return SPR_TILE_START_FLAG;
        case OBJ_FINISH_FLAG: return SPR_TILE_FINISH_FLAG;
        case OBJ_SPIKE:       return SPR_TILE_SPIKE;
        case OBJ_TRAMPOLINE:  return SPR_TILE_TRAMPOLINE;
        case OBJ_COIN:        return SPR_TILE_COIN;
        default:              return 0;
    }
}

static void draw_objects(void) {
    unsigned char i;
    map_resource_bank();
    for (i = 0; i < cur_level->obj_count; i++) {
        level_object *obj = &cur_objects[i];
        if (obj->type == OBJ_START_FLAG) continue;
        if (obj->type == OBJ_COIN && coin_collected[i]) continue;

        int world_px = (int)obj->x * TILE_SIZE;
        int screen_x = world_px - (int)camera_x;
        int screen_y = (int)obj->y * TILE_SIZE - 8; /* -8 for 8x16 tall sprite */

        if (screen_x < -8 || screen_x >= SCREEN_PX_W) continue;
        if (screen_y < -8 || screen_y >= SCREEN_PX_H) continue;

        unsigned char tile = obj_tile_for_type(obj->type) + VRAM_TILE_SPRITES;
        SMS_addSprite((unsigned char)screen_x, (unsigned char)(screen_y + 8), tile);
    }
}

/* ────────────────────────────────────────────────────────────────
 * Player sprite drawing
 * ──────────────────────────────────────────────────────────────── */
static void draw_player(void) {
    int sx = (player.x >> 8) - (int)camera_x;
    int sy = (player.y >> 8) - 8;

    if (sx < -8 || sx >= SCREEN_PX_W) return;
    if (sy < -8 || sy >= SCREEN_PX_H) return;

    unsigned char base_tile;
    if (!player.on_ground) {
        base_tile = SPR_TILE_PLAYER_JUMP;
    } else if (player.vx != 0) {
        base_tile = SPR_TILE_PLAYER_WALK + (player.anim_frame & 2);
    } else {
        base_tile = SPR_TILE_PLAYER_IDLE;
    }

    base_tile += VRAM_TILE_SPRITES;

    unsigned int tile_flags = player.facing_left ? 0 : TILE_FLIPPED_X;
    /* Top half */
    SMS_setNextTileatXY((unsigned char)sx >> 3, (unsigned char)(sy + 8) >> 3);
    SMS_setTile(base_tile | tile_flags);
    /* Bottom half handled by 8x16 sprite mode */
    SMS_addSprite((unsigned char)sx, (unsigned char)(sy + 8), base_tile);
}

/* ────────────────────────────────────────────────────────────────
 * Physics & collision
 * ──────────────────────────────────────────────────────────────── */

#define PLAYER_W  (TILE_SIZE - 2)   /* px, slightly narrower than tile */
#define PLAYER_H  (TILE_SIZE - 1)

static void move_player_x(void) {
    int new_x = player.x + player.vx;
    int px_new = new_x >> 8;
    int py     = player.y >> 8;

    if (player.vx > 0) {
        /* Moving right: check right edge */
        if (is_solid_px(new_x + FP(PLAYER_W - 1), player.y) ||
            is_solid_px(new_x + FP(PLAYER_W - 1), player.y + FP(PLAYER_H - 2))) {
            /* Snap to tile boundary */
            int right_tile = (px_new + PLAYER_W) / TILE_SIZE;
            new_x = FP(right_tile * TILE_SIZE - PLAYER_W - 1);
            player.vx = 0;
        }
    } else if (player.vx < 0) {
        /* Moving left: check left edge */
        if (is_solid_px(new_x, player.y) ||
            is_solid_px(new_x, player.y + FP(PLAYER_H - 2))) {
            int left_tile = px_new / TILE_SIZE + 1;
            new_x = FP(left_tile * TILE_SIZE);
            player.vx = 0;
        }
    }
    player.x = new_x;
}

static void move_player_y(void) {
    int new_y = player.y + player.vy;

    if (player.vy > 0) {
        /* Falling: check bottom edge */
        if (is_solid_px(player.x + FP(1), new_y + FP(PLAYER_H)) ||
            is_solid_px(player.x + FP(PLAYER_W - 2), new_y + FP(PLAYER_H))) {
            int bottom_tile = ((new_y >> 8) + PLAYER_H) / TILE_SIZE;
            new_y = FP(bottom_tile * TILE_SIZE - PLAYER_H);
            player.vy = 0;
            player.on_ground = 1;
            player.double_jump_used = 0;
        } else {
            player.on_ground = 0;
        }
    } else if (player.vy < 0) {
        /* Rising: check top edge */
        if (is_solid_px(player.x + FP(1), new_y) ||
            is_solid_px(player.x + FP(PLAYER_W - 2), new_y)) {
            int top_tile = (new_y >> 8) / TILE_SIZE + 1;
            new_y = FP(top_tile * TILE_SIZE);
            player.vy = 0;
            player.jump_frames = 0;
        }
    }
    player.y = new_y;
}

static void apply_gravity(void) {
    if (!player.on_ground) {
        player.vy += GRAVITY;
        /* Cap fall speed */
        if (player.vy > res_physics->max_fall_speed)
            player.vy = res_physics->max_fall_speed;
    }
}

static void handle_input(unsigned int joy, unsigned int joy_pressed) {
    /* Horizontal movement */
    if (joy & PORT_A_KEY_LEFT) {
        player.vx -= res_physics->ground_accel;
        if (player.vx < -res_physics->max_speed) player.vx = -res_physics->max_speed;
        player.facing_left = 1;
    } else if (joy & PORT_A_KEY_RIGHT) {
        player.vx += res_physics->ground_accel;
        if (player.vx > res_physics->max_speed) player.vx = res_physics->max_speed;
        player.facing_left = 0;
    } else {
        /* Friction */
        int friction = player.on_ground ? res_physics->ground_friction : res_physics->air_friction;
        player.vx = FP_MUL(player.vx, friction);
        if (player.vx > -FP(0.1) && player.vx < FP(0.1)) player.vx = 0;
    }

    /* Jump: button 1 */
    if (joy_pressed & PORT_A_KEY_1) {
        if (player.on_ground) {
            /* Normal jump */
            player.vy = -res_physics->jump_speed;
            player.jump_frames = res_physics->max_jump_frames;
            player.on_ground = 0;
        } else if (res_physics->has_double_jump && !player.double_jump_used) {
            /* Double jump */
            player.vy = -res_physics->jump_speed;
            player.jump_frames = res_physics->max_jump_frames / 2;
            player.double_jump_used = 1;
        }
    }

    /* Variable jump height: holding button extends jump */
    if (player.jump_frames > 0) {
        if (joy & PORT_A_KEY_1) {
            player.vy -= FP(0.05);   /* small upward boost per frame */
            player.jump_frames--;
        } else {
            player.jump_frames = 0;  /* release cancels boost */
        }
    }
}

/* ────────────────────────────────────────────────────────────────
 * Object interaction
 * ──────────────────────────────────────────────────────────────── */
static void check_object_collisions(void) {
    int px = player.x >> 8;
    int py = player.y >> 8;
    unsigned char i;

    map_resource_bank();
    for (i = 0; i < cur_level->obj_count; i++) {
        level_object *obj = &cur_objects[i];
        int ox = (int)obj->x * TILE_SIZE;
        int oy = (int)obj->y * TILE_SIZE;

        /* Simple AABB: player box overlaps tile box */
        if (px + PLAYER_W <= ox || px >= ox + TILE_SIZE) continue;
        if (py + PLAYER_H <= oy || py >= oy + TILE_SIZE) continue;

        switch (obj->type) {
            case OBJ_FINISH_FLAG:
                level_complete = 1;
                break;
            case OBJ_SPIKE:
                player_died = 1;
                break;
            case OBJ_TRAMPOLINE:
                player.vy = -(res_physics->jump_speed + FP(1.5));
                player.jump_frames = 0;
                player.on_ground = 0;
                break;
            case OBJ_COIN:
                if (!coin_collected[i]) coin_collected[i] = 1;
                break;
        }
    }
}

/* ────────────────────────────────────────────────────────────────
 * Camera update (horizontal scroll)
 * ──────────────────────────────────────────────────────────────── */
static unsigned char prev_cam_tile;

static void update_camera(void) {
    int px = player.x >> 8;
    int target_cam = px - SCREEN_PX_W / 2 + TILE_SIZE / 2;
    int map_max = (int)cur_level->map_w * TILE_SIZE - SCREEN_PX_W;

    if (target_cam < 0) target_cam = 0;
    if (target_cam > map_max) target_cam = map_max;

    camera_x = (unsigned char)target_cam;
    SMS_setBGScrollX(255 - camera_x);   /* SMS scrolls inverted */

    /* Stream in new tile columns as camera moves right */
    unsigned char cam_tile = camera_x / TILE_SIZE;
    if (cam_tile != prev_cam_tile) {
        /* Redraw the column that just entered the right edge */
        unsigned char new_col = cam_tile + SCREEN_TILES_W;
        unsigned char screen_col = new_col % SCREEN_TILES_W;
        draw_tile_column(screen_col, new_col);
        prev_cam_tile = cam_tile;
    }
}

/* ────────────────────────────────────────────────────────────────
 * Player animation
 * ──────────────────────────────────────────────────────────────── */
static void update_anim(void) {
    if (player.anim_timer) {
        player.anim_timer--;
    } else {
        player.anim_timer = 4;
        player.anim_frame = (player.anim_frame + 1) & 3;
    }
}

/* ────────────────────────────────────────────────────────────────
 * Level load
 * ──────────────────────────────────────────────────────────────── */
static void load_level(unsigned char n) {
    unsigned char i;

    map_resource_bank();
    cur_level   = get_level(n);
    cur_map     = (unsigned char *)cur_level + sizeof(level_header);
    cur_objects = (level_object *)(cur_map + (unsigned int)cur_level->map_w * cur_level->map_h);

    /* Clear coin state */
    for (i = 0; i < MAX_OBJECTS; i++) coin_collected[i] = 0;

    level_complete = 0;
    player_died    = 0;
    camera_x       = 0;
    prev_cam_tile  = 0;

    /* Find start flag */
    player.x = FP(2 * TILE_SIZE);
    player.y = FP(10 * TILE_SIZE);
    player.vx = player.vy = 0;
    player.on_ground = 0;
    player.jump_frames = 0;
    player.double_jump_used = 0;
    player.dead = 0;
    player.facing_left = 0;
    player.anim_frame = 0;
    player.anim_timer = 0;

    for (i = 0; i < cur_level->obj_count; i++) {
        if (cur_objects[i].type == OBJ_START_FLAG) {
            player.x = FP((int)cur_objects[i].x * TILE_SIZE);
            player.y = FP((int)cur_objects[i].y * TILE_SIZE - TILE_SIZE);
            break;
        }
    }

    /* Draw initial tilemap */
    SMS_waitForVBlank();
    SMS_displayOff();
    SMS_VRAMmemsetW(0x3800, 0, 0x800);  /* clear nametable */
    draw_tilemap();
    SMS_displayOn();
}

/* ────────────────────────────────────────────────────────────────
 * Death / respawn flash
 * ──────────────────────────────────────────────────────────────── */
static void death_sequence(unsigned char level_n) {
    unsigned char i;
    /* Flash screen */
    for (i = 0; i < 6; i++) {
        SMS_waitForVBlank();
        SMS_setBackdropColor(i & 1 ? 0x3F : 0);
    }
    SMS_setBackdropColor(0);
    load_level(level_n);
}

/* ────────────────────────────────────────────────────────────────
 * Main game loop
 * ──────────────────────────────────────────────────────────────── */
static void gameplay_loop(void) {
    unsigned int joy = 0, joy_prev = 0, joy_pressed = 0;
    unsigned char level_n = 0;
    unsigned char total = res_header->level_count;

    load_level(level_n);

    while (1) {
        SMS_waitForVBlank();

        joy_prev    = joy;
        joy         = SMS_getKeysStatus();
        joy_pressed = joy & ~joy_prev;

        /* ── Physics ── */
        handle_input(joy, joy_pressed);
        apply_gravity();
        player.on_ground = 0;   /* will be re-set in move_y if landing */
        move_player_x();
        move_player_y();

        /* ── Object interaction ── */
        check_object_collisions();

        /* ── Camera ── */
        update_camera();

        /* ── Animation ── */
        update_anim();

        /* ── Render ── */
        SMS_initSprites();
        draw_objects();
        draw_player();
        SMS_finalizeSprites();
        SMS_copySpritestoSAT();

        /* ── State transitions ── */
        if (player_died) {
            death_sequence(level_n);
        } else if (level_complete) {
            /* Brief pause then next level */
            unsigned char i;
            for (i = 0; i < 60; i++) SMS_waitForVBlank();
            level_n++;
            if (level_n >= total) level_n = 0;
            load_level(level_n);
        }
    }
}

/* ────────────────────────────────────────────────────────────────
 * Title screen
 * ──────────────────────────────────────────────────────────────── */
static void title_screen(void) {
    unsigned int joy;

    SMS_waitForVBlank();
    SMS_displayOff();
    SMS_VRAMmemsetW(0, 0, 16 * 1024);

    SMS_zeroBGPalette();
    SMS_zeroSpritePalette();
    SMS_setBGPaletteColor(1, 0x3F);  /* white text */

    SMS_load1bppTiles(font_1bpp, VRAM_TILE_FONT, font_1bpp_size, 0, 1);
    SMS_configureTextRenderer(VRAM_TILE_FONT - 32);

    SMS_displayOn();

    SMS_setNextTileatXY(4, 8);
    print_str("POCKET PLATFORMER");

    SMS_setNextTileatXY(4, 12);
    print_str("Press 1 to start");

    /* Wait for button press */
    do {
        SMS_waitForVBlank();
        joy = SMS_getKeysStatus();
    } while (!(joy & (PORT_A_KEY_1 | PORT_A_KEY_2)));
    do {
        SMS_waitForVBlank();
        joy = SMS_getKeysStatus();
    } while (joy & (PORT_A_KEY_1 | PORT_A_KEY_2));
}

/* ────────────────────────────────────────────────────────────────
 * Entry point
 * ──────────────────────────────────────────────────────────────── */
void main(void) {
    SMS_useFirstHalfTilesforSprites(1);
    SMS_setSpriteMode(SPRITEMODE_TALL);  /* 8x16 sprites */
    SMS_setBackdropColor(0);

    init_resources();

    while (1) {
        title_screen();

        /* Load graphics after title (needs resource bank) */
        SMS_waitForVBlank();
        SMS_displayOff();
        SMS_VRAMmemsetW(0, 0, 16 * 1024);
        load_graphics();
        SMS_displayOn();

        gameplay_loop();
    }
}

SMS_EMBED_SEGA_ROM_HEADER(9999, 0);
SMS_EMBED_SDSC_HEADER(1, 0, 2025, 1, 1,
    "pocket-platformer-sms",
    "Pocket Platformer SMS Engine",
    "Generated by pocket-platformer-to-sms web exporter.");
