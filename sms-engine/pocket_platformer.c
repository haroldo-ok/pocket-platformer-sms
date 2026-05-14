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
#define VRAM_SPR_TRAMPOLINE  259
#define VRAM_SPR_COIN         260
#define VRAM_SPR_PLAYER_IDLE  261
#define VRAM_SPR_PLAYER_WALK0 262
#define VRAM_SPR_PLAYER_WALK1 263
#define VRAM_SPR_PLAYER_JUMP  264
#define VRAM_SPR_FLAG_CLOSED  265
#define VRAM_TILE_FONT        352

/* ── Object types (must match SmsExporter.js) ───────────── */
#define OBJ_START_FLAG  1
#define OBJ_FINISH_FLAG 2
#define OBJ_SPIKE       3
#define OBJ_TRAMPOLINE  4
#define OBJ_COIN             5
#define OBJ_FINISH_FLAG_LOCKED 12
#define OBJ_NPC          13
#define OBJ_BARREL       14
#define VRAM_SPR_BARREL_RIGHT  267
#define VRAM_SPR_BARREL_LEFT   268
#define VRAM_SPR_BARREL_TOP    269
#define VRAM_SPR_BARREL_BOTTOM 270
#define BARREL_DIR_RIGHT 0
#define BARREL_DIR_TOP   1
#define BARREL_DIR_LEFT  2
#define BARREL_DIR_BOTTOM 3
#define BARREL_LAUNCH_SPEED_H FP(2.0) /* horizontal: constant until wall */
#define BARREL_LAUNCH_SPEED_V FP(6.0) /* vertical: strong cannon launch */

/* ── Fixed-point 8.8 using long (32-bit) ────────────────── */
/* Max velocity per frame must stay < TILE_SIZE to prevent tunneling */
#define MAX_VY  ((TILE_SIZE - 1) * FP_ONE)
#define FP_ONE      256L
#define FP(x)       ((long)((x) * FP_ONE))
#define FP_MUL(a,b) (((long)(a) * (long)(b)) >> 8)
#define GRAVITY     FP(0.1667)  /* scaled: JS tileSize(24) / SMS tileSize(8) = 3 */

/* ── Player collision box (8x8 sprite, slightly narrower) ── */
#define PLAYER_W   6
#define PLAYER_H   8
#define MAX_OBJECTS 128

/* ──────────────────────────────────────────────────────────
 * Structs
 * ──────────────────────────────────────────────────────────*/
typedef struct {
    unsigned char signature[4];
    unsigned char level_count;
    unsigned char num_tiles;
    unsigned char one_way_vram_idx; /* VRAM tile index of the one-way block (0=none) */
    unsigned char disp_vram_idx;     /* VRAM tile index of the disappearing block (0=none) */
    unsigned char conn_vram_idx;     /* VRAM tile index of the connected disappearing block (0=none) */
    unsigned char red_solid_vram_idx;  /* red block solid   */
    unsigned char red_ghost_vram_idx;  /* red block ghost   */
    unsigned char blue_solid_vram_idx; /* blue block solid  */
    unsigned char blue_ghost_vram_idx; /* blue block ghost  */
    unsigned char switch_vram_idx;     /* red/blue switch (red frame)  */
    unsigned char switch_blue_vram_idx; /* red/blue switch (blue frame) */
    unsigned char vio_solid_vram_idx;   /* violet block solid  */
    unsigned char vio_ghost_vram_idx;   /* violet block ghost  */
    unsigned char pink_solid_vram_idx;  /* pink block solid    */
    unsigned char pink_ghost_vram_idx;  /* pink block ghost    */
    unsigned char deko_vram_idx[18];    /* decorative tile VRAM indices (0=unused) */
    unsigned char fg_disp_vram_idx;     /* VRAM tile index of the disappearing foreground tile (0=none) */
    unsigned char spike_vram_idx;        /* VRAM tile index of spike BG tile (0=none) */
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
    unsigned char falling;        /* 1 = in air without active jump ramp */
    unsigned char jumping;        /* 1 = jump ramp active */
    unsigned char wall_jumping;   /* 1 = wall jump ramp active */
    unsigned char wall_jump_dir;  /* 1 = jumped off left wall, -1 = right wall (as signed) */
    unsigned char wall_push_frames; /* counts horizontal push frames */
    unsigned char jump_frames;    /* counts up during ramp */
    unsigned char facing_left;
    unsigned char double_jump_used;
    unsigned char anim_frame;
    unsigned char anim_timer;
    long          forced_jump_speed; /* 0=normal, >0=trampoline boost */
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
static unsigned char    level_n_global; /* current level number, set by load_level */

/* ── NPC Dialogue ─────────────────────────────────────── */
#define DIALOGUE_BOX_ROW   18      /* top row of dialogue box (0-based) */
#define DIALOGUE_ROWS       5      /* rows 18-22 */
#define DIALOGUE_TEXT_W    28      /* chars per line */
#define DIALOGUE_MAX_LINES 32      /* max total lines per NPC */
static unsigned char  dialogue_active;   /* 1 = dialogue open */
static unsigned char  dialogue_line;     /* current first visible line */
static unsigned char  dialogue_total;    /* total lines for this NPC */
static unsigned char  dialogue_buf[DIALOGUE_MAX_LINES][DIALOGUE_TEXT_W + 1];
static unsigned int   saved_nametable[DIALOGUE_ROWS * 32]; /* saved BG rows */
static unsigned char  dialogue_btn_prev; /* previous button state */
static unsigned char  npc_contact_idx;   /* 0xFF = no NPC contact this frame */
static unsigned char  npc_contact_level; /* level of contacted NPC */
static unsigned char  npc_contact_auto;  /* play_automatically flag */

/* ── Barrel Cannon state ───────────────────────────────── */
static unsigned char  barrel_active;     /* 1 = player inside a barrel */
static unsigned char  barrel_dir;        /* BARREL_DIR_* */
static long           barrel_cx;         /* barrel center x (FP) */
static long           barrel_cy;         /* barrel center y (FP) */
static unsigned char  barrel_btn_released; /* 1 = jump released since entry */
static unsigned char  barrel_launched;     /* 1 = in flight (suppress friction) */
static unsigned char  barrel_launched_h;   /* 1 = horizontal launch (suppress gravity too) */


/* ── Violet/Pink block system (jump-toggle) ─────────────── */
#define MAX_VP_BLOCKS   48
typedef struct { unsigned char tx, ty, is_violet; } vp_block;
static vp_block  vp_blocks[MAX_VP_BLOCKS];
static unsigned char vp_block_count;
static unsigned char vp_violet_active;  /* 1 = violet solid, pink passable */

/* ── Red/Blue block system ──────────────────────────────── */
#define MAX_RB_BLOCKS   48
#define MAX_RB_SWITCHES  8
typedef struct { unsigned char tx, ty, is_red; } rb_block;
typedef struct { unsigned char tx, ty; } rb_switch;
static rb_block  rb_blocks[MAX_RB_BLOCKS];
static rb_switch rb_switches[MAX_RB_SWITCHES];
static unsigned char rb_block_count;
static unsigned char rb_switch_count;
static unsigned char rb_red_active;   /* 1 = red solid, 0 = blue solid */
static unsigned char rb_switch_locked; /* prevent re-trigger while held */
static long          prev_player_y;    /* player y before physics, for switch crossing */
/* Disappearing block: tileData value 11 tiles tracked by position.
   Up to MAX_DISP tiles tracked simultaneously. */
#define DISP_GONE_AT    40    /* frames until passable */
#define DISP_RESET_AT   200   /* frames until reappear */
#define MAX_DISP        16
typedef struct {
    unsigned char tx, ty;      /* tile coords */
    unsigned char frame;       /* 1..DISP_RESET_AT; 0=unused slot */
    unsigned char is_connected; /* 1 = connected disappearing block */
} disp_entry;
static disp_entry disp_blocks[MAX_DISP];
#define DISP_TILE_VALUE  11   /* tileData value for disappearing block */
/* Disappearing foreground tile: same timer logic but priority bit set in nametable;
   always passable (bit 7 already handled in is_solid_px). */
#define FG_DISP_GONE_AT   5
#define FG_DISP_RESET_AT  120
#define MAX_FG_DISP       16
typedef struct {
    unsigned char tx, ty;
    unsigned char frame; /* 1..FG_DISP_RESET_AT; 0=unused */
} fg_disp_entry;
static fg_disp_entry fg_disp_blocks[MAX_FG_DISP];
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
    res_levels  = (level_header *)(res_sprites + 15u * 32u); /* 10 std + NPC + 4 barrel */
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

/* Disappearing block helpers */
static disp_entry *disp_find(unsigned char tx, unsigned char ty) {
    unsigned char i;
    for (i = 0; i < MAX_DISP; i++)
        if (disp_blocks[i].frame && disp_blocks[i].tx == tx && disp_blocks[i].ty == ty)
            return &disp_blocks[i];
    return 0;
}

static void disp_touch(unsigned char tx, unsigned char ty) {
    unsigned char i;
    if (disp_find(tx, ty)) return; /* already active */
    for (i = 0; i < MAX_DISP; i++) {
        if (!disp_blocks[i].frame) {
            disp_blocks[i].tx = tx;
            disp_blocks[i].ty = ty;
            disp_blocks[i].frame = 1;
            disp_blocks[i].is_connected = 0;
            return;
        }
    }
}

/* Recursively touch all orthogonally-adjacent connected disappearing blocks */
static void disp_touch_connected(unsigned char tx, unsigned char ty) {
    signed char dx, dy;
    if (disp_find(tx, ty)) return; /* already triggered */
    disp_touch(tx, ty);
    /* Mark as connected */
    {
        disp_entry *e = disp_find(tx, ty);
        if (e) e->is_connected = 1;
    }
    /* Check 4 neighbours */
    for (dx = -1; dx <= 1; dx++) {
        for (dy = -1; dy <= 1; dy++) {
            unsigned char nx, ny;
            if (dx == 0 && dy == 0) continue;
            if (dx != 0 && dy != 0) continue; /* diagonal - skip */
            nx = (unsigned char)((int)tx + dx);
            ny = (unsigned char)((int)ty + dy);
            if (get_tile(nx, ny) == res_header->conn_vram_idx && res_header->conn_vram_idx)
                disp_touch_connected(nx, ny);
        }
    }
}

/* Returns 1 if tile (tx,ty) is a disappearing block currently in the "gone" state */
static unsigned char disp_is_gone(unsigned char tx, unsigned char ty) {
    disp_entry *e = disp_find(tx, ty);
    return (e && e->frame >= DISP_GONE_AT) ? 1 : 0;
}

/* ── Disappearing foreground helpers ───────────────────── */
static fg_disp_entry *fg_disp_find(unsigned char tx, unsigned char ty) {
    unsigned char i;
    for (i = 0; i < MAX_FG_DISP; i++)
        if (fg_disp_blocks[i].frame && fg_disp_blocks[i].tx == tx && fg_disp_blocks[i].ty == ty)
            return &fg_disp_blocks[i];
    return 0;
}

static void fg_disp_touch(unsigned char tx, unsigned char ty);

/* Flood-fill: touch all orthogonally adjacent fg_disp tiles */
static void fg_disp_touch_connected(unsigned char tx, unsigned char ty) {
    static const signed char dx[4] = {1,-1,0,0};
    static const signed char dy[4] = {0,0,1,-1};
    unsigned char d;
    if (fg_disp_find(tx, ty)) return;
    fg_disp_touch(tx, ty);
    for (d = 0; d < 4; d++) {
        unsigned char nx = (unsigned char)(tx + dx[d]);
        unsigned char ny = (unsigned char)(ty + dy[d]);
        unsigned char t = get_tile(nx, ny);
        /* neighbour is a fg_disp tile if it has priority bit and same vram index */
        if (res_header->fg_disp_vram_idx &&
            t == (res_header->fg_disp_vram_idx | 0x80) &&
            !fg_disp_find(nx, ny))
            fg_disp_touch_connected(nx, ny);
    }
}

static void fg_disp_touch(unsigned char tx, unsigned char ty) {
    unsigned char i;
    if (fg_disp_find(tx, ty)) return;
    for (i = 0; i < MAX_FG_DISP; i++) {
        if (!fg_disp_blocks[i].frame) {
            fg_disp_blocks[i].tx = tx;
            fg_disp_blocks[i].ty = ty;
            fg_disp_blocks[i].frame = 1;
            return;
        }
    }
}

/* Forward declarations — vp and rb functions defined later */
static unsigned char vp_is_passable(unsigned char tx, unsigned char ty);
static void          vp_toggle(void);
static unsigned char rb_is_passable(unsigned char tx, unsigned char ty);
static void rb_redraw_all(void);

/* Fully solid: returns 1 for any non-zero tile.
   Used for horizontal movement and jumping up. */
static unsigned char is_solid_px(long fpx, long fpy) {
    unsigned char t;
    long px = fpx >> 8, py = fpy >> 8;
    if (px < 0 || py < 0) return 1;
    t = get_tile((unsigned char)(px / TILE_SIZE),
                 (unsigned char)(py / TILE_SIZE));
    if (t == 0) return 0;
    /* Foreground (priority) tiles are always passable */
    if (t & 0x80) return 0;
    /* One-way tiles are NOT solid from sides or below */
    if (res_header->one_way_vram_idx && t == res_header->one_way_vram_idx) return 0;
    /* Deko tiles are always passable (decorative only) */
    {
        unsigned char di;
        for (di = 0; di < 18; di++) {
            if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
        }
    }
    /* Violet/pink blocks: passable when that type is inactive */
    if (vp_block_count) {
        unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
        unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
        if (vp_is_passable(dtx, dty)) return 0;
    }
    /* Red/blue blocks: treat as empty when that colour is inactive */
    if (rb_block_count) {
        unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
        unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
        if (rb_is_passable(dtx, dty)) return 0;
    }
    /* Disappearing blocks (both kinds): treat as empty when gone */
    {
        unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
        unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
        if ((res_header->disp_vram_idx && t == res_header->disp_vram_idx &&
             disp_is_gone(dtx, dty)) ||
            (res_header->conn_vram_idx && t == res_header->conn_vram_idx &&
             disp_is_gone(dtx, dty))) return 0;
    }
    /* Spike tile: passable (death via tile probe) */
    if (res_header->spike_vram_idx && t == res_header->spike_vram_idx) return 0;
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
    if (t == 0) return 0;
    /* Foreground (priority) tiles are always passable */
    if (t & 0x80) return 0;
    /* Deko tiles are always passable */
    {
        unsigned char di;
        for (di = 0; di < 18; di++) {
            if (res_header->deko_vram_idx[di] && t == res_header->deko_vram_idx[di]) return 0;
        }
    }
    /* Violet/pink blocks passable when inactive */
    if (vp_block_count) {
        unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
        unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
        if (vp_is_passable(dtx, dty)) return 0;
    }
    /* Red/blue blocks passable when inactive */
    if (rb_block_count) {
        unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
        unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
        if (rb_is_passable(dtx, dty)) return 0;
    }
    {
        unsigned char dtx = (unsigned char)((fpx>>8)/TILE_SIZE);
        unsigned char dty = (unsigned char)((fpy>>8)/TILE_SIZE);
        if ((res_header->disp_vram_idx && t == res_header->disp_vram_idx &&
             disp_is_gone(dtx, dty)) ||
            (res_header->conn_vram_idx && t == res_header->conn_vram_idx &&
             disp_is_gone(dtx, dty))) return 0;
    }
    /* Spike tile: passable (death via tile probe) */
    if (res_header->spike_vram_idx && t == res_header->spike_vram_idx) return 0;
    return 1;
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
    /* Sprite sheet at VRAM 256..270 (15 × 8x8 tiles: 10 standard + NPC + 4 barrel) */
    SMS_loadTiles(res_sprites, 256u, 15u * 32u);
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
            if (t & 0x80)
                SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
            else
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
        if (t & 0x80)
            SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
        else
            SMS_setTile(t ? (unsigned int)(VRAM_BG_BASE + t - 1) : 0u);
    }
}

/* ──────────────────────────────────────────────────────────
 * Sprite draw  (8x8 normal sprites)
 * ──────────────────────────────────────────────────────────*/
static unsigned char coins_remaining(void) {
    unsigned char i, count = 0;
    unsigned char n = cur_level->obj_count < MAX_OBJECTS ? cur_level->obj_count : MAX_OBJECTS;
    for (i = 0; i < n; i++)
        if (cur_objects[i].type == OBJ_COIN && !coin_collected[i]) count++;
    return count;
}

static unsigned int obj_sprite_tile(unsigned char type) {
    switch (type) {
        case OBJ_FINISH_FLAG:        return VRAM_SPR_FINISH_FLAG;
        case OBJ_FINISH_FLAG_LOCKED: return coins_remaining() ? VRAM_SPR_FLAG_CLOSED : VRAM_SPR_FINISH_FLAG;
        case OBJ_TRAMPOLINE:         return VRAM_SPR_TRAMPOLINE;
        case OBJ_COIN:               return VRAM_SPR_COIN;
        default:                     return VRAM_SPR_FINISH_FLAG;
    }
}

static void draw_objects(void) {
    unsigned char i;
    map_res_bank();
    for (i = 0; i < cur_level->obj_count; i++) {
        level_object *obj = &cur_objects[i];
        int sx, sy;
        if (obj->type == OBJ_START_FLAG) continue;
        if (obj->type == OBJ_SPIKE) continue;  /* spike is a BG tile */
        if (obj->type == OBJ_NPC) continue;    /* NPC sprite handled separately */
        if (obj->type == OBJ_BARREL) continue; /* drawn by draw_barrels() */
        if (obj->type == OBJ_COIN && coin_collected[i]) continue;
        /* Red/blue blocks, switch, and violet/pink blocks are BG tiles, not sprites */
        if (obj->type == 7 || obj->type == 8 || obj->type == 9) continue;
        if (obj->type == 10 || obj->type == 11) continue;
        sx = (int)obj->x * TILE_SIZE - (int)camera_x;
        sy = (int)obj->y * TILE_SIZE;
        if (sx < -8 || sx > SCREEN_PX_W) continue;
        if (sy < 0  || sy > SCREEN_PX_H) continue;
        SMS_addSprite((unsigned char)sx, (unsigned char)sy,
                      (unsigned char)obj_sprite_tile(obj->type));
    }
}


/* Draw all NPC objects as sprites (using NPC_SPRITE tile) */
#define VRAM_SPR_NPC  266   /* tile 266, just after the 10 standard sprite sheet tiles */


static void draw_barrels(void) {
    unsigned char i;
    unsigned char n;
    map_res_bank();
    n = cur_level->obj_count < MAX_OBJECTS ? cur_level->obj_count : MAX_OBJECTS;
    for (i = 0; i < n; i++) {
        level_object *obj = &cur_objects[i];
        int sx, sy;
        unsigned char raw_y;
        if (obj->type != OBJ_BARREL) continue;
        raw_y = obj->y & 0x3F;
        sx = (int)obj->x * TILE_SIZE - (int)camera_x;
        sy = (int)raw_y  * TILE_SIZE;
        if (sx < -8 || sx > SCREEN_PX_W) continue;
        if (sy < 0  || sy > SCREEN_PX_H) continue;
        {
            unsigned char dir = obj->y >> 6;
            unsigned int btile;
            switch (dir) {
                case BARREL_DIR_LEFT:   btile = VRAM_SPR_BARREL_LEFT;   break;
                case BARREL_DIR_TOP:    btile = VRAM_SPR_BARREL_TOP;    break;
                case BARREL_DIR_BOTTOM: btile = VRAM_SPR_BARREL_BOTTOM; break;
                default:                btile = VRAM_SPR_BARREL_RIGHT;  break;
            }
            SMS_addSprite((unsigned char)sx, (unsigned char)sy,
                          (unsigned char)(btile & 0xFF));
        }
    }
}

static void draw_npcs(void) {
    unsigned char i;
    unsigned char n;
    map_res_bank();
    n = cur_level->obj_count < MAX_OBJECTS
                    ? cur_level->obj_count : MAX_OBJECTS;
    for (i = 0; i < n; i++) {
        level_object *obj = &cur_objects[i];
        int sx, sy;
        if (obj->type != OBJ_NPC) continue;
        sx = (int)obj->x * TILE_SIZE - (int)camera_x;
        sy = (int)obj->y * TILE_SIZE;
        if (sx < -8 || sx > SCREEN_PX_W) continue;
        if (sy < 0  || sy > SCREEN_PX_H) continue;
        SMS_addSprite((unsigned char)sx, (unsigned char)sy,
                      (unsigned char)(VRAM_SPR_NPC & 0xFF));
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
 * NPC Dialogue system
 * ──────────────────────────────────────────────────────────*/

/* Find pointer to the NPC string table (after all level data) */
static unsigned char *get_npc_table(void) {
    level_header *lh = res_levels;
    unsigned char i;
    for (i = 0; i < res_header->level_count; i++) {
        unsigned int sz = sizeof(level_header)
            + (unsigned int)lh->map_w * lh->map_h
            + (unsigned int)lh->obj_count * 3u;
        lh = (level_header *)((unsigned char *)lh + sz);
    }
    return (unsigned char *)lh;
}

/* Load dialogue lines for a given NPC (npc_idx in current level) into dialogue_buf */
static void load_npc_dialogue(unsigned char level_n, unsigned char npc_idx) {
    unsigned char *p = get_npc_table();
    unsigned char li, ni, ch;
    /* skip to current level's NPC block */
    for (li = 0; li < level_n; li++) {
        unsigned char cnt = *p++;
        for (ni = 0; ni < cnt; ni++) {
            unsigned char lines, ll, k;
            p++;            /* play_automatically */
            lines = *p++;
            for (ll = 0; ll < lines; ll++) {
                unsigned char ln = *p++;
                p += ln;
            }
        }
    }
    /* skip to this npc */
    {
        unsigned char cnt = *p++;
        for (ni = 0; ni < cnt && ni < npc_idx; ni++) {
            unsigned char lines, ll;
            p++;
            lines = *p++;
            for (ll = 0; ll < lines; ll++) {
                unsigned char ln = *p++;
                p += ln;
            }
        }
    }
    /* now p points to this NPC's entry: play_auto, line_count, lines... */
    p++; /* skip play_automatically (already used to decide when to trigger) */
    {
        unsigned char line_count = *p++;
        unsigned char ll;
        if (line_count > DIALOGUE_MAX_LINES) line_count = DIALOGUE_MAX_LINES;
        dialogue_total = line_count;
        for (ll = 0; ll < line_count; ll++) {
            unsigned char ln = *p++;
            unsigned char cc;
            if (ln > DIALOGUE_TEXT_W) ln = DIALOGUE_TEXT_W;
            for (cc = 0; cc < ln; cc++)
                dialogue_buf[ll][cc] = *p++;
            dialogue_buf[ll][ln] = '\0';
            if (ln < *p && ll < line_count - 1) {} /* already advanced */
        }
    }
}

/* Save nametable rows 18-22 to buffer */
static void save_dialogue_rows(void) {
    unsigned int vram_addr;
    unsigned char row, col;
    unsigned int idx = 0;
    for (row = DIALOGUE_BOX_ROW; row < DIALOGUE_BOX_ROW + DIALOGUE_ROWS; row++) {
        for (col = 0; col < 32; col++) {
            /* SMSlib nametable: row*32 + col, each entry 2 bytes at VRAM 0x3800 */
            /* We read via SMS_getNextTile by positioning cursor */
            saved_nametable[idx++] = 0; /* can't easily read back; we'll redraw instead */
        }
    }
}

/* Redraw dialogue box rows from level map data */
static void restore_dialogue_rows(void) {
    unsigned char row, col;
    map_res_bank();
    for (row = DIALOGUE_BOX_ROW; row < DIALOGUE_BOX_ROW + DIALOGUE_ROWS; row++) {
        SMS_setNextTileatXY(0, row);
        for (col = 0; col < 32; col++) {
            unsigned char map_x = (unsigned char)(camera_x / TILE_SIZE + col);
            unsigned char map_y = row;
            unsigned char t = get_tile(map_x, map_y);
            if (t & 0x80)
                SMS_setTile((unsigned int)(VRAM_BG_BASE + (t & 0x7F) - 1) | TILE_PRIORITY);
            else
                SMS_setTile(t ? (unsigned int)(VRAM_BG_BASE + t - 1) : 0u);
        }
    }
}

/* Draw the dialogue box on-screen (without using the font's BG palette) */
static void draw_dialogue_box(void) {
    unsigned char col;
    unsigned int blank = 0; /* tile 0 = blank */

    /* rows 18-22: clear to blank BG tile */
    for (unsigned char row = DIALOGUE_BOX_ROW; row < DIALOGUE_BOX_ROW + DIALOGUE_ROWS; row++) {
        SMS_setNextTileatXY(0, row);
        for (col = 0; col < 32; col++) SMS_setTile(blank);
    }
}

/* Open dialogue for a specific NPC */
static void open_dialogue(unsigned char level_n, unsigned char npc_idx) {
    map_res_bank();
    load_npc_dialogue(level_n, npc_idx);
    dialogue_active = 1;
    dialogue_line   = 0;
    dialogue_btn_prev = 0xFF; /* force release required first */

    /* Setup font palette (color 1 = white text on black) */
    SMS_setBGPaletteColor(1, 0x3F);
    draw_dialogue_box();
    render_dialogue();
}

/* Render current dialogue page (2 lines at rows 19-20, prompt at row 21) */
static void render_dialogue(void) {
    unsigned char l;
    /* Clear text rows */
    for (l = 0; l < 3; l++) {
        unsigned char row = DIALOGUE_BOX_ROW + 1 + l;
        SMS_setNextTileatXY(0, row);
        unsigned char c;
        for (c = 0; c < 32; c++) SMS_setTile(0);
    }
    /* Print up to 2 lines */
    for (l = 0; l < 2; l++) {
        unsigned char li = dialogue_line + l;
        if (li < dialogue_total)
            SMS_printatXY(2, DIALOGUE_BOX_ROW + 1 + l, dialogue_buf[li]);
    }
    /* Prompt on row 21 */
    if (dialogue_line + 2 < dialogue_total)
        SMS_printatXY(2, DIALOGUE_BOX_ROW + 3, "1: next page");
    else
        SMS_printatXY(2, DIALOGUE_BOX_ROW + 3, "1: close");
}

/* Close dialogue and restore the level tilemap rows */
static void close_dialogue(void) {
    dialogue_active = 0;
    npc_contact_idx = 0xFF;
    restore_dialogue_rows();
    /* Restore tile palette */
    map_res_bank();
    SMS_loadBGPalette(res_palette);
}


/* ──────────────────────────────────────────────────────────
 * Barrel Cannon
 * ──────────────────────────────────────────────────────────*/
static void barrel_enter(level_object *obj) {
    unsigned char raw_y = obj->y & 0x3F;
    barrel_dir  = obj->y >> 6;
    barrel_cx   = (long)obj->x * TILE_SIZE * FP_ONE + FP(TILE_SIZE / 2) - FP(PLAYER_W / 2);
    barrel_cy   = (long)raw_y  * TILE_SIZE * FP_ONE + FP(TILE_SIZE / 2) - FP(PLAYER_H / 2);
    barrel_active        = 1;
    barrel_btn_released  = 0;
    player.vx = player.vy = 0;
    player.jumping = player.falling = player.on_ground = 0;
    player.wall_jumping = 0;
}

static void barrel_update(unsigned char joy) {
    /* Keep player centered in barrel */
    player.x  = barrel_cx;
    player.y  = barrel_cy;
    player.vx = player.vy = 0;
    player.jumping = player.falling = 0;

    if (!(joy & PORT_A_KEY_1))
        barrel_btn_released = 1;

    if (barrel_btn_released && (joy & PORT_A_KEY_1)) {
        /* Launch! */
        barrel_active = 0;
        switch (barrel_dir) {
            case BARREL_DIR_RIGHT:
                player.x  = barrel_cx + FP(TILE_SIZE);
                player.vx = BARREL_LAUNCH_SPEED_H;
                player.vy = 0;
                player.falling = 1;
                barrel_launched_h = 1;
                break;
            case BARREL_DIR_LEFT:
                player.x  = barrel_cx - FP(TILE_SIZE);
                player.vx = -BARREL_LAUNCH_SPEED_H;
                player.vy = 0;
                player.falling = 1;
                barrel_launched_h = 1;
                break;
            case BARREL_DIR_TOP:
                player.y    = barrel_cy - FP(TILE_SIZE);
                player.vy   = -BARREL_LAUNCH_SPEED_V;
                player.vx   = 0;
                player.jumping = 0;
                player.falling = 1;
                break;
            case BARREL_DIR_BOTTOM:
                player.y    = barrel_cy + FP(TILE_SIZE);
                player.vy   = BARREL_LAUNCH_SPEED_V;
                player.vx   = 0;
                player.falling = 1;
                break;
        }
        barrel_launched = 1;
    }
}

/* ──────────────────────────────────────────────────────────
 * Physics
 * ──────────────────────────────────────────────────────────*/


static void apply_gravity(void) {
    /* Gravity only while falling (not during active jump ramp or barrel launch) */
    if (player.falling && !barrel_launched_h) {
        player.vy += GRAVITY;
        if (player.vy > MAX_VY)
            player.vy = MAX_VY;
    }
}

static void handle_input(unsigned int joy, unsigned int joy_pressed) {
    long max_spd = (long)res_physics->max_speed;
    long accel = player.on_ground ? (long)res_physics->ground_accel : (long)res_physics->air_accel;
    long fric  = player.on_ground ? (long)res_physics->ground_friction : (long)res_physics->air_friction;

    /* Horizontal */
    if (joy & PORT_A_KEY_LEFT) {
        player.vx -= accel;
        if (player.vx < -max_spd) player.vx = -max_spd;
        player.facing_left = 1;
    } else if (joy & PORT_A_KEY_RIGHT) {
        player.vx += accel;
        if (player.vx > max_spd) player.vx = max_spd;
        player.facing_left = 0;
    } else if (!barrel_launched) {
        player.vx = FP_MUL(player.vx, fric);
        if (player.vx > -FP(0.5) && player.vx < FP(0.5)) player.vx = 0;
    }

    /* Wall detection: check 1 pixel beyond each horizontal edge of the player.
       tilesWithNoWallJump = [0, 5] in JS — empty and one-way don't count.
       Also skip rb/vp passable tiles. */
    {
        long px_l = (player.x >> 8) - 1;           /* 1px left of player */
        long px_r = (player.x >> 8) + PLAYER_W + 1; /* 1px beyond right edge */
        unsigned char px8_l = (unsigned char)(px_l >= 0 ? px_l / TILE_SIZE : 255);
        unsigned char px8_r = (unsigned char)(px_r / TILE_SIZE);
        unsigned char py8   = (unsigned char)((player.y >> 8) / TILE_SIZE);
        unsigned char pb8   = (unsigned char)(((player.y >> 8) + PLAYER_H - 1) / TILE_SIZE);
        /* Helper: returns 1 if tile is a valid wall (not empty, not one-way, not passable rb/vp) */
        #define IS_WALL_TILE(tx,ty) (             get_tile(tx,ty) != 0 &&             !(res_header->one_way_vram_idx && get_tile(tx,ty)==res_header->one_way_vram_idx) &&             !rb_is_passable(tx,ty) && !vp_is_passable(tx,ty) )
        unsigned char wall_left  = (px_l >= 0) &&
            (IS_WALL_TILE(px8_l, py8) || IS_WALL_TILE(px8_l, pb8));
        unsigned char wall_right =
            (IS_WALL_TILE(px8_r, py8) || IS_WALL_TILE(px8_r, pb8));
        #undef IS_WALL_TILE

        /* Jump initiation */
        if (joy_pressed & PORT_A_KEY_1) {
            if (player.on_ground) {
                player.jumping = 1;
                player.wall_jumping = 0;
                player.jump_frames = 0;
                player.falling = 0;
                player.on_ground = 0;
                if (vp_block_count) vp_toggle();
            } else if (res_physics->has_wall_jump && !player.on_ground &&
                       (wall_left || wall_right)) {
                /* Wall jump: same ramp, push away from wall */
                player.jumping = 0;
                player.wall_jumping = 1;
                player.jump_frames = 0;
                player.falling = 0;
                player.double_jump_used = 0;
                /* wall_jump_dir stored as 1=pushed right (off left wall),
                   255=pushed left (off right wall, treated as -1 in signed math) */
                player.wall_jump_dir = wall_left ? 1 : 255;
                player.wall_push_frames = 0;
                if (vp_block_count) vp_toggle();
            } else if (res_physics->has_double_jump && !player.double_jump_used) {
                player.jumping = 1;
                player.wall_jumping = 0;
                player.jump_frames = 0;
                player.double_jump_used = 1;
                if (vp_block_count) vp_toggle();
            }
        }
    }

    /* Jump ramp (normal + double jump): vy SET each frame, gravity overridden.
       forced_jump_speed > 0 means trampoline boost (auto-fires without button). */
    if (player.jumping) {
        if (joy & PORT_A_KEY_1 || player.forced_jump_speed > 0) {
            long js = player.forced_jump_speed > 0 ? player.forced_jump_speed : (long)res_physics->jump_speed;
            player.jump_frames++;
            long remaining = (long)(res_physics->max_jump_frames - player.jump_frames);
            player.vy = -(remaining * js);
            if (player.jump_frames >= res_physics->max_jump_frames) {
                player.jumping = 0;
                player.falling = 1;
                player.forced_jump_speed = 0;
            }
        } else if (player.forced_jump_speed == 0) {
            /* Only cancel on button release if NOT a forced (trampoline) jump */
            player.jumping = 0;
            player.jump_frames = res_physics->max_jump_frames;
            player.falling = 1;
        }
    }

    /* Wall jump ramp: same formula + horizontal push away from wall
       pushToSideWhileWallJumpingFrames = maxJumpFrames/2 - 4 */
    if (player.wall_jumping) {
        if (joy & PORT_A_KEY_1) {
            player.jump_frames++;
            long remaining = (long)(res_physics->max_jump_frames - player.jump_frames);
            player.vy = -(remaining * (long)res_physics->jump_speed);
            /* Horizontal push for first (maxJumpFrames/2 - 4) frames */
            if (player.wall_push_frames < (res_physics->max_jump_frames / 2 - 4)) {
                /* currentJumpSpeed magnitude = remaining * jumpSpeed */
                long push = remaining * (long)res_physics->jump_speed;
                if (player.wall_jump_dir == 1) {   /* off left wall → push right */
                    player.vx += push >> 4;         /* scale down push */
                    if (player.vx > (long)res_physics->max_speed)
                        player.vx = (long)res_physics->max_speed;
                } else {                            /* off right wall → push left */
                    player.vx -= push >> 4;
                    if (player.vx < -(long)res_physics->max_speed)
                        player.vx = -(long)res_physics->max_speed;
                }
                player.wall_push_frames++;
            }
            if (player.jump_frames >= res_physics->max_jump_frames) {
                player.wall_jumping = 0;
                player.falling = 1;
            }
        } else {
            player.wall_jumping = 0;
            player.jump_frames = res_physics->max_jump_frames;
            player.falling = 1;
        }
    }

    /* Release decel: vy *= 0.75 per frame while vy < 0 and not in any jump ramp.
       Suppressed during barrel launch so the cannon speed isn't killed on release. */
    if (!player.jumping && !player.wall_jumping && player.vy < 0 && !barrel_launched) {
        player.vy = FP_MUL(player.vy, FP(0.75));
        if (player.vy > -FP(0.5)) player.vy = 0;
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
            barrel_launched = 0;
            barrel_launched_h = 0;
        }
    } else if (player.vx < 0) {
        if (is_solid_px(new_x, player.y + FP(1)) ||
            is_solid_px(new_x, player.y + FP(PLAYER_H - 2))) {
            long tile_l = px / TILE_SIZE + 1;
            new_x = tile_l * TILE_SIZE * FP_ONE;
            player.vx = 0;
            barrel_launched = 0;
            barrel_launched_h = 0;
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
            player.falling = 0;
            player.jumping = 0;
            player.wall_jumping = 0;
            player.double_jump_used = 0;
            barrel_launched = 0;
            barrel_launched_h = 0;
            skip_land:;
        }
    } else {
        if (is_solid_px(player.x + FP(1),            new_y) ||
            is_solid_px(player.x + FP(PLAYER_W - 2), new_y)) {
            long tile_t = py / TILE_SIZE + 1;
            /* Check if the ceiling tile is a switch before snapping.
               The blocking tile is at row (tile_t - 1) = py/TILE_SIZE. */
            if (!rb_switch_locked && res_header->switch_vram_idx) {
                unsigned char htx_l = (unsigned char)((player.x >> 8) / TILE_SIZE);
                unsigned char htx_r = (unsigned char)(((player.x >> 8) + PLAYER_W) / TILE_SIZE);
                unsigned char hty   = (unsigned char)(tile_t - 1);  /* ceiling row */
                unsigned char tl = get_tile(htx_l, hty);
                unsigned char tr = get_tile(htx_r, hty);
                if ((tl == res_header->switch_vram_idx || tl == res_header->switch_blue_vram_idx ||
                     tr == res_header->switch_vram_idx || tr == res_header->switch_blue_vram_idx)) {
                    /* Hit a switch from below — fire the trigger */
                    rb_red_active = !rb_red_active;
                    rb_redraw_all();
                    {
                        unsigned char si;
                        unsigned char sw_idx = rb_red_active
                            ? res_header->switch_vram_idx
                            : res_header->switch_blue_vram_idx;
                        unsigned int sw_vt = sw_idx
                            ? (unsigned int)(VRAM_BG_BASE + sw_idx - 1) : 0u;
                        for (si = 0; si < rb_switch_count; si++) {
                            SMS_setNextTileatXY(rb_switches[si].tx % SCREEN_TILES_W,
                                               rb_switches[si].ty);
                            SMS_setTile(sw_vt);
                        }
                    }
                    /* Kill player if now inside a solid block */
                    {
                        unsigned char b;
                        long ppx = player.x >> 8, ppy = new_y >> 8;
                        for (b = 0; b < rb_block_count; b++) {
                            long bx = (long)rb_blocks[b].tx * TILE_SIZE;
                            long by = (long)rb_blocks[b].ty * TILE_SIZE;
                            unsigned char solid = rb_blocks[b].is_red ? rb_red_active : !rb_red_active;
                            if (solid &&
                                ppx + PLAYER_W > bx && ppx < bx + TILE_SIZE &&
                                ppy + PLAYER_H > by && ppy < by + TILE_SIZE)
                                player_died = 1;
                        }
                    }
                    rb_switch_locked = 1;
                }
            }
            new_y = tile_t * TILE_SIZE * FP_ONE;
            player.vy = 0;
            player.jumping = 0;
            player.wall_jumping = 0;
            player.jump_frames = res_physics->max_jump_frames;
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
    unsigned char obj_count = cur_level->obj_count < MAX_OBJECTS
        ? cur_level->obj_count : MAX_OBJECTS;
    map_res_bank();
    for (i = 0; i < obj_count; i++) {
        level_object *obj = &cur_objects[i];
        long ox = (long)obj->x * TILE_SIZE;
        long oy = (long)(obj->type == OBJ_BARREL ? (obj->y & 0x3F) : obj->y) * TILE_SIZE;
        if (px + PLAYER_W <= ox || px >= ox + TILE_SIZE) continue;
        if (py + PLAYER_H <= oy || py >= oy + TILE_SIZE) continue;
        switch (obj->type) {
            case OBJ_FINISH_FLAG: level_complete = 1; break;
            case OBJ_FINISH_FLAG_LOCKED:
                if (!coins_remaining()) level_complete = 1;
                break;
            case OBJ_SPIKE: /* handled via tile probe below */ break;
            case OBJ_BARREL:
                if (!barrel_active && !barrel_launched) barrel_enter(obj);
                break;
            case OBJ_NPC:
                if (!dialogue_active) {
                    /* Record contact; dialogue opens on button press (or auto) */
                    unsigned char ni = 0, k;
                    unsigned char *p;
                    for (k = 0; k < i; k++)
                        if (cur_objects[k].type == OBJ_NPC) ni++;
                    npc_contact_idx   = ni;
                    npc_contact_level = level_n_global;
                    /* Read play_automatically from string table */
                    p = get_npc_table();
                    /* skip to current level */
                    { unsigned char li;
                      for (li = 0; li < level_n_global; li++) {
                          unsigned char cnt = *p++;
                          unsigned char nj;
                          for (nj = 0; nj < cnt; nj++) {
                              unsigned char lines, ll;
                              p++;
                              lines = *p++;
                              for (ll = 0; ll < lines; ll++) { unsigned char ln = *p++; p += ln; }
                          }
                      }
                    }
                    { unsigned char cnt = *p++;
                      unsigned char nj;
                      for (nj = 0; nj < cnt && nj < ni; nj++) {
                          unsigned char lines, ll;
                          p++;
                          lines = *p++;
                          for (ll = 0; ll < lines; ll++) { unsigned char ln = *p++; p += ln; }
                      }
                    }
                    npc_contact_auto = *p; /* play_automatically byte */
                }
                break;
            case OBJ_TRAMPOLINE:
                if (player.vy >= 0) {
                    long tramp_mid = (long)obj->y * TILE_SIZE + TILE_SIZE / 2;
                    if ((player.y >> 8) + PLAYER_H <= tramp_mid + 2) {
                        long base = (long)res_physics->jump_speed;
                        player.forced_jump_speed = base + base * 4 / 15;
                        player.jumping = 1;
                        player.jump_frames = 0;
                        player.falling = 0;
                        player.on_ground = 0;
                        player.double_jump_used = 0;
                        if (vp_block_count) vp_toggle();
                    }
                }
                break;
            case OBJ_COIN:
                if (!coin_collected[i]) coin_collected[i] = 1; break;
        }
    }
}

/* ──────────────────────────────────────────────────────────
 * Disappearing block update — called once per frame
 * Tile value 11 in tileData = disappearing block.
 * When player touches it, we start a timer. At DISP_GONE_AT
 * frames the nametable cell is blanked (passable). At
 * DISP_RESET_AT frames it is restored.
 * ──────────────────────────────────────────────────────────*/
/* ──────────────────────────────────────────────────────────
 * Red/Blue block system
 * ──────────────────────────────────────────────────────────*/

/* ── Violet/Pink block functions ──────────────────────── */
/* Returns 1 if (tx,ty) is a violet/pink block that is currently PASSABLE */
static unsigned char vp_is_passable(unsigned char tx, unsigned char ty) {
    unsigned char i;
    for (i = 0; i < vp_block_count; i++) {
        if (vp_blocks[i].tx == tx && vp_blocks[i].ty == ty) {
            /* violet_active=0: violet passable, pink solid
               violet_active=1: violet solid, pink passable */
            return vp_blocks[i].is_violet ? !vp_violet_active : vp_violet_active;
        }
    }
    return 0;
}

/* Toggle violet/pink state and redraw all their nametable cells */
static void vp_toggle(void) {
    unsigned char i;
    vp_violet_active = !vp_violet_active;
    for (i = 0; i < vp_block_count; i++) {
        unsigned char tx    = vp_blocks[i].tx;
        unsigned char ty    = vp_blocks[i].ty;
        unsigned char solid = vp_blocks[i].is_violet ? vp_violet_active : !vp_violet_active;
        unsigned char idx;
        unsigned int vt;
        if (vp_blocks[i].is_violet)
            idx = solid ? res_header->vio_solid_vram_idx : res_header->vio_ghost_vram_idx;
        else
            idx = solid ? res_header->pink_solid_vram_idx : res_header->pink_ghost_vram_idx;
        vt = idx ? (unsigned int)(VRAM_BG_BASE + idx - 1) : 0u;
        SMS_setNextTileatXY(tx % SCREEN_TILES_W, ty);
        SMS_setTile(vt);
        /* Kill player if now inside a newly-solid block */
        if (solid) {
            long px = player.x >> 8, py = player.y >> 8;
            long bx = (long)tx * TILE_SIZE, by = (long)ty * TILE_SIZE;
            if (px + PLAYER_W > bx && px < bx + TILE_SIZE &&
                py + PLAYER_H > by && py < by + TILE_SIZE)
                player_died = 1;
        }
    }
}

/* Returns 1 if position (tx,ty) is a red or blue block that is currently PASSABLE */
static unsigned char rb_is_passable(unsigned char tx, unsigned char ty) {
    unsigned char i;
    for (i = 0; i < rb_block_count; i++) {
        if (rb_blocks[i].tx == tx && rb_blocks[i].ty == ty) {
            /* Solid when its colour matches the active colour */
            return rb_blocks[i].is_red ? !rb_red_active : rb_red_active;
        }
    }
    return 0;
}

static unsigned int rb_vram_for_block(unsigned char is_red, unsigned char solid) {
    unsigned char idx;
    if (is_red)
        idx = solid ? res_header->red_solid_vram_idx  : res_header->red_ghost_vram_idx;
    else
        idx = solid ? res_header->blue_solid_vram_idx : res_header->blue_ghost_vram_idx;
    return idx ? (unsigned int)(VRAM_BG_BASE + idx - 1) : 0u;
}

/* Redraw all red/blue block nametable cells after a switch toggle */
static void rb_redraw_all(void) {
    unsigned char i;
    for (i = 0; i < rb_block_count; i++) {
        unsigned char tx = rb_blocks[i].tx;
        unsigned char ty = rb_blocks[i].ty;
        unsigned char solid = rb_blocks[i].is_red ? rb_red_active : !rb_red_active;
        unsigned int vt = rb_vram_for_block(rb_blocks[i].is_red, solid);
        SMS_setNextTileatXY(tx % SCREEN_TILES_W, ty);
        SMS_setTile(vt);
    }
}

static void check_rb_switch(void) {
    /* Unlock once player falls away from switch (trigger is in move_player_y) */
    if (rb_switch_locked && player.vy > 0) rb_switch_locked = 0;
}

static void check_disp_touch(void) {
    /* Check the tile the player is standing on (one row below feet),
       and the tile their body occupies on the left and right sides.
       The snap places player.y+PLAYER_H exactly at the tile top, so
       py+PLAYER_H-1 is still in the row above — we must probe py+PLAYER_H. */
    long px = player.x >> 8, py = player.y >> 8;
    unsigned char tx_l = (unsigned char)(px / TILE_SIZE);
    unsigned char tx_r = (unsigned char)((px + PLAYER_W - 1) / TILE_SIZE);
    unsigned char ty_body  = (unsigned char)(py / TILE_SIZE);
    unsigned char ty_feet  = (unsigned char)((py + PLAYER_H) / TILE_SIZE); /* tile below feet */
    unsigned char probes[3][2] = {
        {tx_l, ty_feet},   /* left foot on block below */
        {tx_r, ty_feet},   /* right foot on block below */
        {tx_l, ty_body},   /* body inside a block (e.g. jumping up through) */
    };
    unsigned char c;
    for (c = 0; c < 3; c++) {
        unsigned char tx = probes[c][0], ty = probes[c][1];
        unsigned char t = get_tile(tx, ty);
        if (res_header->disp_vram_idx && t == res_header->disp_vram_idx)
            disp_touch(tx, ty);
        else if (res_header->conn_vram_idx && t == res_header->conn_vram_idx)
            disp_touch_connected(tx, ty);
        /* Disappearing foreground: tile byte = vram_idx | 0x80 */
        else if (res_header->fg_disp_vram_idx &&
                 t == (res_header->fg_disp_vram_idx | 0x80))
            fg_disp_touch_connected(tx, ty);
    }
    /* Also check the tile at the player's BODY position for fg_disp
       (the player passes through them — not just when standing on them) */
    if (res_header->fg_disp_vram_idx) {
        unsigned char tx_l = (unsigned char)((player.x >> 8) / TILE_SIZE);
        unsigned char tx_r = (unsigned char)(((player.x >> 8) + PLAYER_W - 1) / TILE_SIZE);
        unsigned char ty_t = (unsigned char)((player.y >> 8) / TILE_SIZE);
        unsigned char ty_b = (unsigned char)(((player.y >> 8) + PLAYER_H - 1) / TILE_SIZE);
        unsigned char bx, by;
        for (bx = tx_l; bx <= tx_r; bx++) {
            for (by = ty_t; by <= ty_b; by++) {
                unsigned char bt = get_tile(bx, by);
                if (bt == (res_header->fg_disp_vram_idx | 0x80))
                    fg_disp_touch_connected(bx, by);
            }
        }
    }
}

static void update_disappearing_blocks(void) {
    unsigned char i;
    check_disp_touch();
    for (i = 0; i < MAX_DISP; i++) {
        unsigned char tx, ty, scr_x, scr_y;
        unsigned int vt;
        disp_entry *e = &disp_blocks[i];
        if (!e->frame) continue;

        e->frame++;
        tx = e->tx; ty = e->ty;
        scr_x = tx % SCREEN_TILES_W;
        scr_y = ty;

        if (e->frame == DISP_GONE_AT) {
            /* Blank the nametable cell */
            SMS_setNextTileatXY(scr_x, scr_y);
            SMS_setTile(0);
        }
        else if (e->frame >= DISP_RESET_AT) {
            /* Reappear if player not standing on this tile.
               For connected blocks, also check all neighbours are clear. */
            long bx = (long)tx * TILE_SIZE, by = (long)ty * TILE_SIZE;
            long ppx = player.x >> 8, ppy = player.y >> 8;
            unsigned char on_top =
                (ppx + PLAYER_W > bx && ppx < bx + TILE_SIZE &&
                 ppy + PLAYER_H >= by && ppy + PLAYER_H <= by + 2);
            if (!on_top) {
                unsigned char orig_vram = e->is_connected
                    ? res_header->conn_vram_idx
                    : res_header->disp_vram_idx;
                vt = orig_vram ? (unsigned int)(VRAM_BG_BASE + orig_vram - 1) : 0u;
                SMS_setNextTileatXY(scr_x, scr_y);
                SMS_setTile(vt);
                e->frame = 0;
            }
        }
    }
    /* Disappearing foreground tiles */
    if (res_header->fg_disp_vram_idx) {
        unsigned char j;
        for (j = 0; j < MAX_FG_DISP; j++) {
            unsigned char tx, ty, scr_x, scr_y;
            fg_disp_entry *e = &fg_disp_blocks[j];
            if (!e->frame) continue;
            e->frame++;
            tx = e->tx; ty = e->ty;
            scr_x = tx % SCREEN_TILES_W;
            scr_y = ty;
            if (e->frame == FG_DISP_GONE_AT) {
                /* Blank the nametable cell */
                SMS_setNextTileatXY(scr_x, scr_y);
                SMS_setTile(0);
            } else if (e->frame >= FG_DISP_RESET_AT) {
                /* Reappear when player no longer overlaps */
                long bx = (long)tx * TILE_SIZE, by = (long)ty * TILE_SIZE;
                long ppx = player.x >> 8, ppy = player.y >> 8;
                unsigned char overlap =
                    (ppx + PLAYER_W > bx && ppx < bx + TILE_SIZE &&
                     ppy + PLAYER_H > by && ppy < by + TILE_SIZE);
                if (!overlap) {
                    unsigned int vt = (unsigned int)(VRAM_BG_BASE + res_header->fg_disp_vram_idx - 1) | TILE_PRIORITY;
                    SMS_setNextTileatXY(scr_x, scr_y);
                    SMS_setTile(vt);
                    e->frame = 0;
                }
            }
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
    level_n_global = n;
    cur_level   = get_level(n);
    cur_map     = (unsigned char *)cur_level + sizeof(level_header);
    cur_objects = (level_object *)(cur_map +
                  (unsigned int)cur_level->map_w * cur_level->map_h);

    for (i = 0; i < MAX_OBJECTS; i++) coin_collected[i] = 0;
    dialogue_active = 0;
    for (i = 0; i < MAX_DISP; i++) disp_blocks[i].frame = 0;

    /* Build red/blue block tables from levelObjects */
    rb_block_count  = 0;
    rb_switch_count = 0;
    rb_red_active   = 1;   /* red starts solid per pocket-platformer default */
    rb_switch_locked = 0;
    /* Violet/pink: violet starts PASSABLE, pink starts SOLID (violet_active=0) */
    vp_block_count  = 0;
    vp_violet_active = 0;  /* state = "violet turn" (violet passable, pink solid) */
    map_res_bank();
    for (i = 0; i < cur_level->obj_count; i++) {
        level_object *obj = &cur_objects[i];
        if ((obj->type == 7 || obj->type == 8) && rb_block_count < MAX_RB_BLOCKS) {
            rb_blocks[rb_block_count].tx     = obj->x;
            rb_blocks[rb_block_count].ty     = obj->y;
            rb_blocks[rb_block_count].is_red = (obj->type == 7);
            rb_block_count++;
        }
        if ((obj->type == 10 || obj->type == 11) && vp_block_count < MAX_VP_BLOCKS) {
            vp_blocks[vp_block_count].tx        = obj->x;
            vp_blocks[vp_block_count].ty        = obj->y;
            vp_blocks[vp_block_count].is_violet = (obj->type == 10);
            vp_block_count++;
        }
        if (obj->type == 9 && rb_switch_count < MAX_RB_SWITCHES) {
            rb_switches[rb_switch_count].tx = obj->x;
            rb_switches[rb_switch_count].ty = obj->y;
            rb_switch_count++;
        }
    }
    level_complete = player_died = 0;
    camera_x = prev_cam_x = 0;

    /* Default spawn in case no start flag found */
    player.x  = FP(2 * TILE_SIZE);
    player.y  = FP(4 * TILE_SIZE);
    player.vx = player.vy = 0;
    player.on_ground = player.jump_frames = player.double_jump_used = 0;
    player.falling = 1; player.jumping = 0; player.wall_jumping = 0; player.wall_push_frames = 0;
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

        /* ── NPC Dialogue: handle input & render, skip physics ── */
        if (dialogue_active) {
            unsigned char btn = (unsigned char)(joy & (PORT_A_KEY_1 | PORT_A_KEY_2));
            if (!dialogue_btn_prev && btn) {
                /* button pressed: advance or close */
                if (dialogue_line + 2 < dialogue_total) {
                    dialogue_line += 2;
                    render_dialogue();
                } else {
                    close_dialogue();
                }
            }
            dialogue_btn_prev = btn;
            SMS_waitForVBlank();
            SMS_initSprites();
            draw_objects();
            draw_player();
            SMS_finalizeSprites();
            SMS_copySpritestoSAT();
            joy_prev = joy;
            joy      = SMS_getKeysStatus();
            joy_pressed = joy & ~joy_prev;
            continue;
        }

        prev_player_y = player.y;
        handle_input(joy, joy_pressed);
        /* Mark falling before move — landing in move_player_y clears it */
        if (!player.on_ground && !player.jumping && !player.wall_jumping) player.falling = 1;
        player.on_ground = 0;
        apply_gravity();
        move_player_x();
        move_player_y();
        /* Barrel cannon: override physics when player is inside */
        if (barrel_active) {
            barrel_update(joy);
            SMS_initSprites();
            draw_objects();
            draw_barrels();
            draw_npcs();
            draw_player();
            SMS_finalizeSprites();
            SMS_copySpritestoSAT();
            continue;
        }
        npc_contact_idx = 0xFF; /* reset each frame */
        check_object_collisions();
        /* NPC dialogue trigger */
        if (!dialogue_active && npc_contact_idx != 0xFF) {
            if (npc_contact_auto) {
                open_dialogue(npc_contact_level, npc_contact_idx);
            } else if (joy_pressed & PORT_A_KEY_1) {
                open_dialogue(npc_contact_level, npc_contact_idx);
            }
        }
        /* Spike tile probe: check all four player corners */
        if (!player_died && res_header->spike_vram_idx) {
            unsigned char sv = res_header->spike_vram_idx;
            long px = player.x >> 8, py = player.y >> 8;
            map_res_bank();
            if (get_tile((unsigned char)((px+1)/TILE_SIZE),             (unsigned char)(py/TILE_SIZE))           == sv ||
                get_tile((unsigned char)((px+PLAYER_W-2)/TILE_SIZE),    (unsigned char)(py/TILE_SIZE))           == sv ||
                get_tile((unsigned char)((px+1)/TILE_SIZE),             (unsigned char)((py+PLAYER_H-1)/TILE_SIZE)) == sv ||
                get_tile((unsigned char)((px+PLAYER_W-2)/TILE_SIZE),    (unsigned char)((py+PLAYER_H-1)/TILE_SIZE)) == sv)
                player_died = 1;
        }
        check_rb_switch();
        update_disappearing_blocks();
        update_camera();
        update_anim();

        SMS_initSprites();
        draw_objects();
        draw_barrels();
        draw_npcs();
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
