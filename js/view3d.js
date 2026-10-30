// WaRo Kart: view3d.js
// Pseudo-3D raycast chase-camera renderer (early-90s "2.5D" style), see the
// "v2: chase-cam pseudo-3D view" section of CONTRACT.md.
//
//   AGV.view3d.init()
//   AGV.view3d.render(ctx, vx, vy, vw, vh, cam, scene)
//   AGV.view3d.project(cam, vw, vh, x, y, z) -> { sx, sy, scale, depth } | null
//
// Pipeline per viewport (all into one Uint32Array view of an ImageData):
//   1. floor + ceiling casting per row (floor textures + run decal, tiled ceiling)
//   2. walls: DDA per column, perpendicular distance, textured, fogged
//   3. thin dynamic boxes (door leaves, mobile racks): ray-vs-AABB per column
//   4. billboards (props, pickups, drops, racers, EHS signs), far to near,
//      clipped per column against the wall/box depth buffer
//   5. particles (small screen-space squares, depth tested)
//
// Camera model: eye at (cam.x, cam.y, cam.z) looking along cam.angle. A world
// point with forward depth d and lateral offset s (positive = screen right)
// lands at sx = vw/2 + s*F/d, sy = horizon + (eyeZ - z)*F/d, where
// F = (vw/2) / tan(fov/2) and horizon = vh*0.40 + pitch.
//
// Uses AGV.tex when present; any missing piece falls back to internal flat
// placeholder textures, so this file never needs tex.js to run.
// Loads in Node without touching the DOM (ImageData is created at render time).

var AGV = (typeof window !== 'undefined' ? window : globalThis).AGV =
  (typeof window !== 'undefined' ? window : globalThis).AGV || {};

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  var TILE = 16;
  if (!AGV.WALL_H) AGV.WALL_H = 96;
  if (!AGV.DOOR_H) AGV.DOOR_H = 56;
  var WALL_H = AGV.WALL_H;
  var DOOR_H = AGV.DOOR_H;

  var DEF_T = { FLOOR: 0, SCUFF: 1, VINYL: 2, WALL: 3, RACK: 4, ROOM: 5, DOCKDOOR: 6,
    WINDOW: 7, OUTSIDE: 8, TAPE: 9, DOCKPLATE: 10, CURB: 11 };

  var NEAR = 2;            // near plane, world px of forward depth
  var FAR = 1e5;           // "no hit" depth
  var MAX_STEPS = 320;     // DDA steps per ray (tiles)
  var DEF_FOV = 1.15;      // ~66 degrees
  var DEF_EYE = 30;
  var HORIZON = 0.40;

  // Fog: NL levels from clear to full fog colour, picked by distance.
  var NL = 32;
  var FOG_START = 40, FOG_END = 1150;
  var FOG_R = 16, FOG_G = 18, FOG_B = 24;
  var SIDE_BRIGHT = 0.78;  // E/W faces are a bit darker
  var MAX_BOXES = 32;
  var MAX_BB = 768;

  function rgba(r, g, b, a) {
    return (((a === undefined ? 255 : a) << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  var FOG_COL = rgba(FOG_R, FOG_G, FOG_B);

  // ---------------------------------------------------------------------------
  // Shade lookup tables: index ((side * NL + level) << 8) + channel
  // ---------------------------------------------------------------------------
  var LR = new Uint8Array(2 * NL * 256);
  var LG = new Uint8Array(2 * NL * 256);
  var LB = new Uint8Array(2 * NL * 256);
  (function () {
    for (var s = 0; s < 2; s++) {
      var br = s ? SIDE_BRIGHT : 1;
      for (var l = 0; l < NL; l++) {
        var f = l / (NL - 1);
        for (var v = 0; v < 256; v++) {
          var i = ((s * NL + l) << 8) + v;
          LR[i] = Math.round(v * br * (1 - f) + FOG_R * f);
          LG[i] = Math.round(v * br * (1 - f) + FOG_G * f);
          LB[i] = Math.round(v * br * (1 - f) + FOG_B * f);
        }
      }
    }
  })();

  // Distance -> fog level, sampled every 4 world px.
  var DL_N = 2048;
  var DIST_LVL = new Uint8Array(DL_N);
  (function () {
    for (var i = 0; i < DL_N; i++) {
      var d = i * 4;
      var f = (d - FOG_START) / (FOG_END - FOG_START);
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      f = Math.pow(f, 0.8);
      DIST_LVL[i] = Math.min(NL - 1, Math.round(f * (NL - 1)));
    }
  })();
  function levelFor(d) {
    var i = (d * 0.25) | 0;
    return (i >= DL_N || i < 0 || d !== d) ? NL - 1 : DIST_LVL[i];
  }

  // ---------------------------------------------------------------------------
  // Placeholder textures (used when AGV.tex is missing or returns null)
  // ---------------------------------------------------------------------------
  function mkTex(w, h, col) {
    var d = new Uint32Array(w * h);
    if (col) d.fill(col);
    return { w: w, h: h, data: d };
  }
  function rect(t, x, y, w, h, col) {
    for (var j = Math.max(0, y); j < Math.min(t.h, y + h); j++) {
      for (var i = Math.max(0, x); i < Math.min(t.w, x + w); i++) t.data[j * t.w + i] = col;
    }
  }
  var seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function noisy(t, r, g, b, amt) {
    for (var i = 0; i < t.data.length; i++) {
      var n = (rnd() - 0.5) * amt;
      t.data[i] = rgba(clamp8(r + n), clamp8(g + n), clamp8(b + n));
    }
    return t;
  }
  function clamp8(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }
  function parseColor(s) {
    if (typeof s !== 'string') return rgba(255, 0, 255);
    var m;
    if (s.charAt(0) === '#') {
      if (s.length === 4) {
        return rgba(parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16));
      }
      return rgba(parseInt(s.substr(1, 2), 16) | 0, parseInt(s.substr(3, 2), 16) | 0, parseInt(s.substr(5, 2), 16) | 0);
    }
    m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s);
    if (m) return rgba(+m[1] & 255, +m[2] & 255, +m[3] & 255);
    return rgba(255, 255, 255);
  }

  var FB = null;   // built lazily
  function buildFallback() {
    if (FB) return FB;
    seed = 777;
    var T = AGV.T || DEF_T;
    var WHITE = rgba(240, 240, 236), BLACK = rgba(20, 22, 28), YEL = rgba(243, 194, 44);
    var TEAL = rgba(42, 140, 131), ORANGE = rgba(217, 114, 43), BROWN = rgba(166, 118, 71);
    var GLASS = rgba(34, 49, 63), STEEL = rgba(182, 190, 199), GREY = rgba(107, 113, 123);

    // Walls: 32 x 96, v = 0 at z = WALL_H.
    function plainWall(col) {
      var t = mkTex(32, 96, col);
      rect(t, 0, 8, 32, 2, rgba(220, 224, 228));    // light strip near the top
      rect(t, 0, 82, 32, 6, BLACK);                 // black base
      rect(t, 0, 88, 32, 8, YEL);                   // yellow kick-curb
      rect(t, 0, 0, 1, 82, rgba(200, 204, 209));    // faint seam per tile
      return t;
    }
    var wall = plainWall(WHITE);
    var win = plainWall(WHITE);
    rect(win, 3, 26, 26, 38, GLASS);
    rect(win, 6, 30, 3, 10, rgba(91, 125, 148));
    var dock = mkTex(32, 96, rgba(226, 228, 230));
    for (var y = 0; y < 96; y += 6) rect(dock, 0, y, 32, 1, rgba(170, 174, 180));
    rect(dock, 4, 40, 8, 5, GLASS); rect(dock, 20, 40, 8, 5, GLASS);
    rect(dock, 0, 90, 32, 6, BLACK);
    var rack = mkTex(32, 96, rgba(40, 44, 52));
    for (var lv = 0; lv < 5; lv++) {
      var by = 4 + lv * 18;
      rect(rack, 0, by, 32, 2, ORANGE);
      rect(rack, 4, by + 4, 10, 12, lv & 1 ? WHITE : BROWN);
      rect(rack, 17, by + 6, 11, 10, lv & 1 ? BROWN : rgba(200, 170, 120));
    }
    rect(rack, 0, 0, 3, 96, TEAL); rect(rack, 29, 0, 3, 96, TEAL);
    var room = plainWall(rgba(200, 204, 209));
    var walls = [];
    walls[T.WALL] = wall; walls[T.WINDOW] = win; walls[T.DOCKDOOR] = dock;
    walls[T.RACK] = rack; walls[T.ROOM] = room; walls[T.OUTSIDE] = room;
    walls[T.CURB] = wall;

    // Floors: 16 x 16, indexed by tile id.
    var floors = [];
    var conc = noisy(mkTex(16, 16), 146, 152, 160, 14);
    floors[T.FLOOR] = conc;
    floors[T.SCUFF] = noisy(mkTex(16, 16), 118, 124, 132, 22);
    floors[T.VINYL] = noisy(mkTex(16, 16), 214, 218, 222, 6);
    var tape = noisy(mkTex(16, 16), 146, 152, 160, 14);
    for (var i = 0; i < 16; i++) for (var j = 0; j < 16; j++) {
      if (j >= 4 && j < 12) tape.data[j * 16 + i] = ((i + j) & 7) < 4 ? YEL : BLACK;
    }
    floors[T.TAPE] = tape;
    var plate = mkTex(16, 16, STEEL);
    for (i = 0; i < 16; i += 4) for (j = (i & 4) ? 2 : 0; j < 16; j += 4) plate.data[i * 16 + j] = GREY;
    floors[T.DOCKPLATE] = plate;
    floors[T.CURB] = mkTex(16, 16, YEL);
    for (i = 0; i < 16; i++) if (!floors[i]) floors[i] = noisy(mkTex(16, 16), 90, 94, 100, 10);

    // Ceiling: 64 x 64.
    var ceil = noisy(mkTex(64, 64), 44, 47, 55, 6);
    rect(ceil, 8, 28, 48, 6, rgba(150, 156, 162));
    rect(ceil, 10, 29, 44, 4, rgba(232, 238, 240));
    rect(ceil, 0, 4, 64, 2, rgba(70, 74, 82));

    // Boxes.
    var door = mkTex(16, 56, WHITE);
    rect(door, 0, 44, 16, 12, STEEL); rect(door, 0, 0, 1, 56, GREY); rect(door, 15, 0, 1, 56, GREY);
    rect(door, 5, 10, 6, 10, GLASS);
    var endp = mkTex(32, 96, rgba(150, 156, 164));
    rect(endp, 10, 50, 12, 14, BLACK);
    for (y = 84; y < 96; y++) for (i = 0; i < 32; i++) endp.data[y * 32 + i] = ((i + y) & 7) < 4 ? YEL : BLACK;

    // Sprites.
    function spr(w, h, col, ww, wh, z) { return { tex: mkTex(w, h, col), worldW: ww, worldH: wh, z: z || 0 }; }
    var sprites = {};
    sprites.bollard = spr(8, 16, YEL, 8, 30);
    rect(sprites.bollard.tex, 0, 4, 8, 2, BLACK); rect(sprites.bollard.tex, 0, 10, 8, 2, BLACK);
    sprites.column = spr(10, 96, WHITE, 10, 96);
    rect(sprites.column.tex, 0, 0, 2, 96, rgba(200, 204, 209));
    sprites.palletjack = spr(16, 10, 0, 14, 12);
    rect(sprites.palletjack.tex, 0, 7, 16, 3, ORANGE); rect(sprites.palletjack.tex, 7, 0, 2, 8, BLACK);
    sprites.bins = spr(28, 30, rgba(47, 111, 214), 28, 34);
    for (y = 0; y < 30; y += 7) rect(sprites.bins.tex, 0, y, 28, 1, rgba(29, 65, 140));
    sprites.crates = spr(26, 24, rgba(216, 58, 52), 26, 26);
    for (y = 0; y < 24; y += 8) rect(sprites.crates.tex, 0, y, 26, 1, rgba(138, 31, 29));
    sprites.cart = spr(22, 18, rgba(205, 187, 143), 22, 22);
    rect(sprites.cart.tex, 0, 16, 22, 2, BLACK);
    sprites.exitsign = spr(14, 6, rgba(216, 58, 52), 14, 6, 64);
    rect(sprites.exitsign.tex, 2, 2, 10, 2, WHITE);
    sprites.drop_wrap = spr(14, 3, rgba(210, 225, 235, 255), 14, 3);
    sprites.drop_peanuts = spr(14, 2, rgba(240, 236, 210), 14, 2);
    sprites.drop_box = spr(10, 9, WHITE, 10, 9);
    rect(sprites.drop_box.tex, 0, 3, 10, 2, rgba(29, 42, 94));
    sprites.ehs = spr(16, 10, YEL, 16, 10, 26);
    rect(sprites.ehs.tex, 0, 0, 16, 1, BLACK); rect(sprites.ehs.tex, 0, 9, 16, 1, BLACK);
    rect(sprites.ehs.tex, 3, 3, 10, 4, rgba(216, 58, 52));
    var pick = [];
    for (var f = 0; f < 4; f++) {
      var p = spr(14, 16, 0, 12, 14);
      p.tex.data.fill(0);
      rect(p.tex, 0, 12, 14, 4, BROWN);                       // pallet
      rect(p.tex, 2, 1 + (f === 1 || f === 2 ? 0 : 1), 10, 10, YEL);
      rect(p.tex, 5, 3, 4, 2, BLACK); rect(p.tex, 7, 5, 2, 2, BLACK); rect(p.tex, 6, 8, 2, 1, BLACK);
      pick.push(p);
    }
    sprites.pickup = pick;

    FB = { walls: walls, floors: floors, ceiling: ceil, door: door, rack: rack, endp: endp,
      sprites: sprites, agv: {}, decals: {} };
    return FB;
  }

  // Placeholder AGV billboard: a 32 x 20 view-dependent block so headings read.
  function fallbackAgv(color, boxes, view, red) {
    var fb = buildFallback();
    var key = color + '|' + boxes + '|' + view + '|' + (red ? 1 : 0);
    var hit = fb.agv[key];
    if (hit) return hit;
    var t = mkTex(32, 20, 0);
    var rel = view * Math.PI / 8;
    var sx = Math.sin(rel), cz = Math.cos(rel);      // nose: screen-x component, away component
    var halfW = Math.round(8 + 4 * Math.abs(sx));    // longer when seen from the side
    var c = parseColor(color);
    rect(t, 16 - halfW, 13, halfW * 2, 4, rgba(45, 49, 57));       // platform
    rect(t, 16 - halfW, 13, halfW * 2, 1, c);                       // LED strip
    rect(t, 16 - halfW + 1, 17, 3, 3, rgba(13, 15, 20));           // wheels
    rect(t, 16 + halfW - 4, 17, 3, 3, rgba(13, 15, 20));
    var nb = boxes > 4 ? 4 : boxes < 0 ? 0 : boxes | 0;
    if (nb > 0) {
      rect(t, 16 - halfW + 1, 13 - (nb > 2 ? 10 : 6), halfW * 2 - 2, nb > 2 ? 10 : 6, rgba(244, 244, 240));
      rect(t, 16 - halfW + 1, 9, halfW * 2 - 2, 1, rgba(29, 42, 94));
    }
    // Front marker: lidar puck on the side the nose points to.
    var nx = Math.round(16 + sx * (halfW - 2));
    if (cz < 0.5) rect(t, nx - 2, 11, 4, 2, rgba(13, 15, 20));
    // Rear: two red tail markers when we see its back.
    if (cz > 0.3) { rect(t, 16 - halfW + 1, 14, 2, 2, rgba(216, 58, 52)); rect(t, 16 + halfW - 3, 14, 2, 2, rgba(216, 58, 52)); }
    // Beacon.
    rect(t, 15, 0, 2, 2, red ? rgba(255, 40, 40) : rgba(60, 207, 90));
    hit = { tex: t, worldW: 30, worldH: 19, z: 0 };
    fb.agv[key] = hit;
    return hit;
  }

  // Placeholder run decal: dashed route line + checkered finish, 2 world px per cell.
  function fallbackDecal(runKey) {
    var fb = buildFallback();
    if (fb.decals[runKey] !== undefined) return fb.decals[runKey];
    var map = AGV.map, run = map && map.runs && map.runs[runKey];
    if (!run) { fb.decals[runKey] = null; return null; }
    var w = map.W * 8, h = map.H * 8, data = new Uint32Array(w * h);
    var col = parseColor(run.color);
    var wp = run.waypoints, along = 0;
    for (var i = 1; i < wp.length; i++) {
      var ax = wp[i - 1].x, ay = wp[i - 1].y, bx = wp[i].x, by = wp[i].y;
      var len = Math.hypot(bx - ax, by - ay), n = Math.ceil(len);
      for (var s = 0; s <= n; s++) {
        if (((along + s) % 32) >= 18) continue;
        var cx = ((ax + (bx - ax) * s / n) / 2) | 0, cy = ((ay + (by - ay) * s / n) / 2) | 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var x = cx + dx, y = cy + dy;
          if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = col;
        }
      }
      along += n;
    }
    var f = run.finish;
    if (f) {
      for (var yy = f.y >> 1; yy < (f.y + f.h) >> 1; yy++) {
        for (var xx = f.x >> 1; xx < (f.x + f.w) >> 1; xx++) {
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
            data[yy * w + xx] = (((xx >> 2) + (yy >> 2)) & 1) ? rgba(20, 20, 24) : rgba(240, 240, 236);
          }
        }
      }
    }
    var dec = { scale: 2, w: w, h: h, data: data };
    fb.decals[runKey] = dec;
    return dec;
  }

  // ---------------------------------------------------------------------------
  // Safe access to AGV.tex
  // ---------------------------------------------------------------------------
  function asTex(t) {
    if (!t || !(t.w > 0) || !(t.h > 0) || !t.data) return null;
    var d = t.data;
    if (d.BYTES_PER_ELEMENT !== 4) {
      if (d.length >= t.w * t.h * 4 && d.buffer && (d.byteOffset & 3) === 0) {
        return { w: t.w, h: t.h, data: new Uint32Array(d.buffer, d.byteOffset, t.w * t.h) };
      }
      return null;
    }
    return d.length >= t.w * t.h ? t : null;
  }
  function asSprite(s) {
    if (!s) return null;
    var t = asTex(s.tex);
    if (!t) return null;
    if (t !== s.tex) s = { tex: t, worldW: s.worldW, worldH: s.worldH, z: s.z };
    if (!(s.worldW > 0) || !(s.worldH > 0)) s = { tex: t, worldW: s.worldW > 0 ? s.worldW : t.w, worldH: s.worldH > 0 ? s.worldH : t.h, z: s.z };
    return s;
  }
  var warned = {};
  function warnOnce(k, e) {
    if (warned[k]) return;
    warned[k] = true;
    if (typeof console !== 'undefined') console.warn('view3d: ' + k, e);
  }
  function texWall(tile, tx, ty, face) {
    var tx_ = AGV.tex;
    if (tx_ && tx_.wall) {
      try { var t = asTex(tx_.wall(tile, tx, ty, face)); if (t) return t; } catch (e) { warnOnce('tex.wall', e); }
    }
    var fb = buildFallback();
    return fb.walls[tile] || fb.walls[(AGV.T || DEF_T).WALL];
  }
  function texSprite(name, frame) {
    var tx_ = AGV.tex;
    if (tx_ && tx_.sprite) {
      try { var s = asSprite(tx_.sprite(name, frame)); if (s) return s; } catch (e) { warnOnce('tex.sprite ' + name, e); }
    }
    var fs = buildFallback().sprites[name];
    if (fs && fs.length) fs = fs[(frame | 0) & 3];
    return fs || null;
  }
  function texAgv(color, boxes, view, red) {
    var tx_ = AGV.tex;
    if (tx_ && tx_.agv) {
      try { var s = asSprite(tx_.agv(color, boxes, view, red)); if (s) return s; } catch (e) { warnOnce('tex.agv', e); }
    }
    return fallbackAgv(color, boxes, view, red);
  }
  function texBox(kind, face) {
    var tx_ = AGV.tex;
    if (tx_ && tx_.boxFace) {
      try { var t = asTex(tx_.boxFace(kind, face)); if (t) return t; } catch (e) { warnOnce('tex.boxFace', e); }
    }
    var fb = buildFallback();
    return kind === 'door' ? fb.door : (face ? fb.endp : fb.rack);
  }
  function texDecal(runKey) {
    var tx_ = AGV.tex;
    if (tx_ && tx_.decal) {
      try {
        var d = tx_.decal(runKey);
        if (d && d.data && d.w > 0 && d.h > 0 && d.data.length >= d.w * d.h && d.data.BYTES_PER_ELEMENT === 4) return d;
      } catch (e) { warnOnce('tex.decal', e); }
      return null;   // TEX exists but has no decal for this key: draw none
    }
    return fallbackDecal(runKey);
  }

  // ---------------------------------------------------------------------------
  // World caches (rebuilt when AGV.map / AGV.tex / its floorIndex change)
  // ---------------------------------------------------------------------------
  var MAP = null, MW = 0, MH = 0, MWPX = 0, MHPX = 0, TILES = null;
  var SOLIDV = new Uint8Array(256);
  var T_OUTSIDE = 8;
  var TEXREF = undefined, FLOORREF = undefined;
  var FLOOR_ATLAS = null;          // Uint32Array(N * 256), 16x16 textures back to back
  var FLOOR_OFF = null;            // Uint32Array(W*H): atlas offset per tile
  var CEIL = null, CEIL_W = 64, CEIL_H = 64, CEIL_MX = 63, CEIL_MY = 63, CEIL_SH = 6, CEIL_POW2 = true;
  var WCACHE = null;               // per (tile, face) wall texture
  var PROPS = [];                  // [{ x, y, spr }] props that have a sprite
  var DECAL_KEY = null, DECAL = null;
  var OUT_COL = rgba(30, 33, 40);

  var PROP_SPRITES = { bollard: 1, column: 1, palletjack: 1, bins: 1, crates: 1, cart: 1, exitsign: 1 };

  function ensureWorld() {
    var map = AGV.map;
    var tex = AGV.tex || null;
    if (tex && (!tex.floorIndex || !tex.floorIndex.length) && typeof tex.init === 'function' && !tex._view3dInitTried) {
      tex._view3dInitTried = true;
      try { tex.init(); } catch (e) { warnOnce('tex.init', e); }
    }
    var floorRef = tex ? tex.floorIndex : null;
    if (map === MAP && tex === TEXREF && floorRef === FLOORREF) return;

    var mapChanged = map !== MAP;
    MAP = map; TEXREF = tex; FLOORREF = floorRef;
    DECAL_KEY = null; DECAL = null;
    var T = AGV.T || DEF_T;
    T_OUTSIDE = T.OUTSIDE;

    if (!map || !map.tiles) {
      MW = MH = 1; MWPX = MHPX = 0; TILES = new Uint8Array(1); TILES[0] = T.OUTSIDE;
    } else {
      MW = map.W; MH = map.H; TILES = map.tiles; MWPX = MW * TILE; MHPX = MH * TILE;
    }
    if (mapChanged || !WCACHE) {
      for (var i = 0; i < 256; i++) {
        var solid = false;
        try { solid = AGV.isSolid ? !!AGV.isSolid(i) : (i !== T.FLOOR && i !== T.SCUFF && i !== T.VINYL && i !== T.TAPE && i !== T.DOCKPLATE); } catch (e) { solid = false; }
        SOLIDV[i] = (solid && i !== T.CURB) ? 1 : 0;
      }
    }
    WCACHE = new Array(MW * MH * 2);

    // Floor atlas.
    var fb = buildFallback();
    var texs = null, idx = null;
    if (tex && tex.floorTextures && tex.floorTextures.length && floorRef && floorRef.length >= MW * MH) {
      texs = tex.floorTextures; idx = floorRef;
    }
    var list = texs || fb.floors;
    var n = list.length;
    FLOOR_ATLAS = new Uint32Array(Math.max(1, n) * 256);
    for (var k = 0; k < n; k++) {
      var t = asTex(list[k]) || fb.floors[0];
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        FLOOR_ATLAS[k * 256 + y * 16 + x] = t.data[((y * t.h / 16) | 0) * t.w + ((x * t.w / 16) | 0)] | 0xff000000;
      }
    }
    FLOOR_OFF = new Uint32Array(MW * MH);
    for (i = 0; i < MW * MH; i++) {
      var fi = idx ? idx[i] : TILES[i];
      if (!(fi < n)) fi = 0;
      FLOOR_OFF[i] = fi * 256;
    }

    // Ceiling.
    var c = asTex(tex && tex.ceiling) || fb.ceiling;
    CEIL = c.data; CEIL_W = c.w; CEIL_H = c.h;
    CEIL_POW2 = (c.w & (c.w - 1)) === 0 && (c.h & (c.h - 1)) === 0;
    CEIL_MX = c.w - 1; CEIL_MY = c.h - 1;
    CEIL_SH = Math.round(Math.log(c.w) / Math.LN2);

    // Props with sprites.
    PROPS = [];
    var props = (map && map.props) || [];
    for (i = 0; i < props.length; i++) {
      var p = props[i];
      if (!PROP_SPRITES[p.type]) continue;
      var s = texSprite(p.type, 0);
      if (s) PROPS.push({ x: p.x, y: p.y, spr: s });
    }
  }

  function wallTexAt(tile, mx, my, face) {
    if (mx < 0 || my < 0 || mx >= MW || my >= MH) return texWall(tile, mx, my, face);
    var key = ((my * MW + mx) << 1) | face;
    var t = WCACHE[key];
    if (t === undefined) { t = texWall(tile, mx, my, face); WCACHE[key] = t; }
    return t;
  }

  // ---------------------------------------------------------------------------
  // Per-viewport buffers
  // ---------------------------------------------------------------------------
  var BUFS = {};
  function getBuffers(ctx, vw, vh) {
    var key = vw + 'x' + vh;
    var b = BUFS[key];
    if (b) return b;
    var img = null;
    try {
      if (ctx && ctx.createImageData) img = ctx.createImageData(vw, vh);
      else if (typeof ImageData !== 'undefined') img = new ImageData(vw, vh);
    } catch (e) { img = null; }
    if (!img) img = { width: vw, height: vh, data: new Uint8ClampedArray(vw * vh * 4) };
    b = {
      img: img,
      buf: new Uint32Array(img.data.buffer),
      zWall: new Float32Array(vw),
      zBox: new Float32Array(vw),
      boxTop: new Float32Array(vw),
      kcol: new Float32Array(vw),
      kFov: -1
    };
    BUFS[key] = b;
    return b;
  }

  // ---------------------------------------------------------------------------
  // Camera state (module-level scalars, set by setupCam)
  // ---------------------------------------------------------------------------
  var CX = 0, CY = 0, EZ = DEF_EYE, FX = 1, FY = 0, RX = 0, RY = 1;
  var F = 1, HY = 0, TANH = 0.6, VW = 0, VH = 0, FOV = DEF_FOV;

  function num(v, d) { return (typeof v === 'number' && v === v && isFinite(v)) ? v : d; }
  function setupCam(cam, vw, vh) {
    cam = cam || {};
    CX = num(cam.x, 0); CY = num(cam.y, 0);
    EZ = num(cam.z, DEF_EYE);
    if (EZ < 1) EZ = 1; else if (EZ > WALL_H - 1) EZ = WALL_H - 1;
    var a = num(cam.angle, 0);
    FX = Math.cos(a); FY = Math.sin(a);
    RX = -FY; RY = FX;            // screen right (y down world: clockwise 90 deg)
    FOV = num(cam.fov, DEF_FOV);
    if (FOV < 0.2) FOV = 0.2; else if (FOV > 2.8) FOV = 2.8;
    TANH = Math.tan(FOV / 2);
    VW = vw; VH = vh;
    F = (vw / 2) / TANH;
    HY = vh * HORIZON + num(cam.pitch, 0);
  }

  // ---------------------------------------------------------------------------
  // 1. Floor + ceiling
  // ---------------------------------------------------------------------------
  function drawFloorCeil(B) {
    var buf = B.buf, vw = VW, vh = VH;
    var k0 = (1 / vw - 1) * TANH, kStep = 2 * TANH / vw;
    var dx0 = FX + RX * k0, dy0 = FY + RY * k0;
    var sdx = RX * kStep, sdy = RY * kStep;
    var atlas = FLOOR_ATLAS, foff = FLOOR_OFF, mw = MW, mwpx = MWPX, mhpx = MHPX;
    var dec = DECAL, ddata = dec ? dec.data : null, dw = dec ? dec.w : 0, dh = dec ? dec.h : 0;
    var dsh = dec ? dec.shift : 0;
    var ceil = CEIL, cmx = CEIL_MX, cmy = CEIL_MY, csh = CEIL_SH, cw = CEIL_W, ch = CEIL_H, cp2 = CEIL_POW2;
    var lr = LR, lg = LG, lb = LB;
    var fogCol = FOG_COL | 0;

    for (var y = 0; y < vh; y++) {
      var py = y + 0.5 - HY;
      var row = y * vw;
      var d, x;
      if (py > 0.01) d = EZ * F / py;
      else if (py < -0.01) d = (WALL_H - EZ) * F / -py;
      else d = FAR;
      var lvl = levelFor(d);
      if (lvl >= NL - 1) {
        for (x = 0; x < vw; x++) buf[row + x] = fogCol;
        continue;
      }
      var li = lvl << 8;
      var wx = CX + d * dx0, wy = CY + d * dy0;
      var stx = d * sdx, sty = d * sdy;
      var c, ix, iy;
      if (py > 0) {
        // Floor row.
        for (x = 0; x < vw; x++) {
          ix = Math.floor(wx); iy = Math.floor(wy);
          if (ix >= 0 && iy >= 0 && ix < mwpx && iy < mhpx) {
            c = atlas[foff[(iy >> 4) * mw + (ix >> 4)] + ((iy & 15) << 4) + (ix & 15)];
            if (ddata !== null) {
              var cx = ix >> dsh, cy = iy >> dsh;
              if (cx < dw && cy < dh) {
                var dc = ddata[cy * dw + cx];
                if (dc !== 0) {
                  if ((dc >>> 24) >= 0xc0) c = dc;
                  else c = ((c & 0xfefefe) >>> 1) + ((dc & 0xfefefe) >>> 1);
                }
              }
            }
          } else c = OUT_COL;
          buf[row + x] = 0xff000000 | (lb[li + ((c >>> 16) & 255)] << 16) | (lg[li + ((c >>> 8) & 255)] << 8) | lr[li + (c & 255)];
          wx += stx; wy += sty;
        }
      } else {
        // Ceiling row.
        for (x = 0; x < vw; x++) {
          ix = Math.floor(wx); iy = Math.floor(wy);
          if (cp2) c = ceil[((iy & cmy) << csh) + (ix & cmx)];
          else c = ceil[(((iy % ch) + ch) % ch) * cw + (((ix % cw) + cw) % cw)];
          buf[row + x] = 0xff000000 | (lb[li + ((c >>> 16) & 255)] << 16) | (lg[li + ((c >>> 8) & 255)] << 8) | lr[li + (c & 255)];
          wx += stx; wy += sty;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Walls (DDA per column)
  // ---------------------------------------------------------------------------
  function drawWalls(B) {
    var buf = B.buf, vw = VW, vh = VH, zWall = B.zWall, kcol = B.kcol;
    var px = CX / TILE, py = CY / TILE;
    var mw = MW, mh = MH, tiles = TILES, solid = SOLIDV;
    var lr = LR, lg = LG, lb = LB;
    var invF = 1 / F;

    for (var col = 0; col < vw; col++) {
      var k = kcol[col];
      var rdx = FX + RX * k, rdy = FY + RY * k;
      var mx = Math.floor(px), my = Math.floor(py);
      var ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      var ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      var stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (px - mx) * ddx; } else { stepX = 1; sdx = (mx + 1 - px) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (py - my) * ddy; } else { stepY = 1; sdy = (my + 1 - py) * ddy; }
      var side = 0, tile = -1;
      for (var n = 0; n < MAX_STEPS; n++) {
        if (sdx < sdy) { sdx += ddx; mx += stepX; side = 1; } else { sdy += ddy; my += stepY; side = 0; }
        if (mx < 0 || my < 0 || mx >= mw || my >= mh) { tile = T_OUTSIDE; break; }
        var tt = tiles[my * mw + mx];
        if (solid[tt] === 1) { tile = tt; break; }
      }
      if (tile < 0) { zWall[col] = FAR; continue; }
      var d = (side === 1 ? sdx - ddx : sdy - ddy) * TILE;   // perpendicular distance, px
      if (!(d > 0.5)) d = 0.5;
      zWall[col] = d;

      // Texture u from the exact hit point, oriented so it reads left to right.
      var u;
      if (side === 1) { u = (CY + d * rdy) / TILE; u -= Math.floor(u); if (rdx < 0) u = 1 - u; }
      else { u = (CX + d * rdx) / TILE; u -= Math.floor(u); if (rdy > 0) u = 1 - u; }
      var tex = wallTexAt(tile, mx, my, side);
      var tw = tex.w, th = tex.h, data = tex.data;
      var tu = (u * tw) | 0; if (tu >= tw) tu = tw - 1; else if (tu < 0) tu = 0;

      var scale = F / d;
      var yTop = HY + (EZ - WALL_H) * scale, yBot = HY + EZ * scale;
      var y0 = Math.ceil(yTop - 0.5), y1 = Math.ceil(yBot - 0.5);
      if (y0 < 0) y0 = 0; if (y1 > vh) y1 = vh;
      if (y1 <= y0) continue;
      var tScale = th / WALL_H;
      var vStep = d * invF * tScale;
      var v = (WALL_H - EZ + (y0 + 0.5 - HY) * d * invF) * tScale;
      var li = ((side * NL + levelFor(d)) << 8);
      var thm = th - 1;
      var idx = y0 * vw + col;
      for (var y = y0; y < y1; y++) {
        var tv = v | 0; if (tv > thm) tv = thm; else if (tv < 0) tv = 0;
        var c = data[tv * tw + tu];
        buf[idx] = 0xff000000 | (lb[li + ((c >>> 16) & 255)] << 16) | (lg[li + ((c >>> 8) & 255)] << 8) | lr[li + (c & 255)];
        idx += vw; v += vStep;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Thin dynamic boxes (door leaves, mobile racks)
  // ---------------------------------------------------------------------------
  var BX0 = new Float64Array(MAX_BOXES), BY0 = new Float64Array(MAX_BOXES);
  var BX1 = new Float64Array(MAX_BOXES), BY1 = new Float64Array(MAX_BOXES);
  var BH = new Float64Array(MAX_BOXES), BKIND = new Uint8Array(MAX_BOXES);  // 0 door, 1 mover
  var NBOX = 0;
  var HIT_T = new Float64Array(MAX_BOXES), HIT_B = new Int32Array(MAX_BOXES), HIT_S = new Uint8Array(MAX_BOXES);
  var HIT_U = new Float64Array(MAX_BOXES);
  var BOXTEX = { door0: null, door1: null, mover0: null, mover1: null };

  function addBox(r, h, kind) {
    if (NBOX >= MAX_BOXES || !r) return;
    var x = num(r.x, NaN), y = num(r.y, NaN), w = num(r.w, 0), hh = num(r.h, 0);
    if (!(w > 0.01) || !(hh > 0.01) || x !== x || y !== y) return;
    // Cull boxes fully behind the camera or beyond the fog.
    var nearest = Infinity, ahead = false;
    for (var i = 0; i < 4; i++) {
      var qx = (i & 1) ? x + w : x, qy = (i & 2) ? y + hh : y;
      var dd = (qx - CX) * FX + (qy - CY) * FY;
      if (dd > NEAR) ahead = true;
      var dist = Math.abs(dd);
      if (dist < nearest) nearest = dist;
    }
    if (!ahead || nearest > FOG_END + 64) return;
    BX0[NBOX] = x; BY0[NBOX] = y; BX1[NBOX] = x + w; BY1[NBOX] = y + hh;
    BH[NBOX] = h; BKIND[NBOX] = kind;
    NBOX++;
  }

  function gatherBoxes(scene) {
    NBOX = 0;
    var doors = scene.doors, i;
    if (doors && AGV.doorLeaves) {
      for (i = 0; i < doors.length; i++) {
        var dr = doors[i];
        if (!dr || !dr.door) continue;
        var leaves = null;
        try { leaves = AGV.doorLeaves(dr.door, num(dr.openFrac, 1)); } catch (e) { leaves = null; }
        if (!leaves) continue;
        for (var j = 0; j < leaves.length; j++) addBox(leaves[j], DOOR_H, 0);
      }
    }
    var movers = scene.movers;
    if (movers) {
      for (i = 0; i < movers.length; i++) if (movers[i]) addBox(movers[i].rect, WALL_H, 1);
    }
    if (NBOX) {
      BOXTEX.door0 = texBox('door', 0); BOXTEX.door1 = texBox('door', 1);
      BOXTEX.mover0 = texBox('mover', 0); BOXTEX.mover1 = texBox('mover', 1);
    }
  }

  function drawBoxes(B) {
    var zBox = B.zBox, boxTop = B.boxTop, zWall = B.zWall, kcol = B.kcol, buf = B.buf;
    var vw = VW, vh = VH, i, col;
    for (col = 0; col < vw; col++) { zBox[col] = FAR; boxTop[col] = vh; }
    if (!NBOX) return;
    var lr = LR, lg = LG, lb = LB, invF = 1 / F;

    for (col = 0; col < vw; col++) {
      var k = kcol[col];
      var rdx = FX + RX * k, rdy = FY + RY * k;
      var zw = zWall[col];
      var nh = 0;
      for (i = 0; i < NBOX; i++) {
        var tx0, tx1, ty0, ty1, t;
        if (rdx !== 0) {
          tx0 = (BX0[i] - CX) / rdx; tx1 = (BX1[i] - CX) / rdx;
          if (tx0 > tx1) { t = tx0; tx0 = tx1; tx1 = t; }
        } else {
          if (CX < BX0[i] || CX > BX1[i]) continue;
          tx0 = -Infinity; tx1 = Infinity;
        }
        if (rdy !== 0) {
          ty0 = (BY0[i] - CY) / rdy; ty1 = (BY1[i] - CY) / rdy;
          if (ty0 > ty1) { t = ty0; ty0 = ty1; ty1 = t; }
        } else {
          if (CY < BY0[i] || CY > BY1[i]) continue;
          ty0 = -Infinity; ty1 = Infinity;
        }
        var side = tx0 > ty0 ? 1 : 0;            // entry through an x-slab = E/W face
        var tn = side ? tx0 : ty0;
        var tf = tx1 < ty1 ? tx1 : ty1;
        if (tf < tn || tn < NEAR || tn >= zw) continue;
        // Face-local u (0..1), oriented left to right.
        var u, ext, w = BX1[i] - BX0[i], h = BY1[i] - BY0[i];
        if (side) { u = (CY + tn * rdy - BY0[i]); ext = h; if (rdx < 0) u = ext - u; }
        else { u = (CX + tn * rdx - BX0[i]); ext = w; if (rdy > 0) u = ext - u; }
        var longFace = side ? (h >= w) : (w >= h);
        if (BKIND[i] === 1 && longFace) { u = u / TILE; u -= Math.floor(u); }   // racking repeats per tile
        else u = ext > 0 ? u / ext : 0;
        // Insert sorted by distance, far first.
        var j = nh++;
        while (j > 0 && HIT_T[j - 1] < tn) {
          HIT_T[j] = HIT_T[j - 1]; HIT_B[j] = HIT_B[j - 1]; HIT_S[j] = HIT_S[j - 1]; HIT_U[j] = HIT_U[j - 1]; j--;
        }
        HIT_T[j] = tn; HIT_B[j] = i; HIT_S[j] = side | (longFace ? 0 : 2); HIT_U[j] = u;
      }
      for (var hI = 0; hI < nh; hI++) {
        var d = HIT_T[hI], b = HIT_B[hI], sd = HIT_S[hI] & 1, endFace = HIT_S[hI] >> 1;
        var tex = BKIND[b] === 0 ? (endFace ? BOXTEX.door1 : BOXTEX.door0) : (endFace ? BOXTEX.mover1 : BOXTEX.mover0);
        var bh = BH[b];
        var scale = F / d;
        var yTop = HY + (EZ - bh) * scale, yBot = HY + EZ * scale;
        if (hI === nh - 1) { zBox[col] = d; boxTop[col] = yTop; }
        var y0 = Math.ceil(yTop - 0.5), y1 = Math.ceil(yBot - 0.5);
        if (y0 < 0) y0 = 0; if (y1 > vh) y1 = vh;
        if (y1 <= y0) continue;
        var tw = tex.w, th = tex.h, data = tex.data;
        var tu = (HIT_U[hI] * tw) | 0; if (tu >= tw) tu = tw - 1; else if (tu < 0) tu = 0;
        var tScale = th / bh;
        var vStep = d * invF * tScale;
        var v = (bh - EZ + (y0 + 0.5 - HY) * d * invF) * tScale;
        var li = ((sd * NL + levelFor(d)) << 8), thm = th - 1;
        var idx = y0 * vw + col;
        for (var y = y0; y < y1; y++) {
          var tv = v | 0; if (tv > thm) tv = thm; else if (tv < 0) tv = 0;
          var c = data[tv * tw + tu];
          if ((c >>> 24) >= 128) {
            buf[idx] = 0xff000000 | (lb[li + ((c >>> 16) & 255)] << 16) | (lg[li + ((c >>> 8) & 255)] << 8) | lr[li + (c & 255)];
          }
          idx += vw; v += vStep;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Billboards
  // ---------------------------------------------------------------------------
  var BB_D = new Float64Array(MAX_BB), BB_L = new Float64Array(MAX_BB), BB_Z = new Float64Array(MAX_BB);
  var BB_S = new Array(MAX_BB), BB_ORD = new Int32Array(MAX_BB);
  var NBB = 0;

  // Queue a billboard at world (x, y), base height z, with sprite s.
  function addBB(x, y, z, s) {
    if (!s || NBB >= MAX_BB) return;
    var rx = x - CX, ry = y - CY;
    var d = rx * FX + ry * FY;
    if (!(d > NEAR) || d > FOG_END + 32) return;
    var lat = rx * RX + ry * RY;
    var halfW = s.worldW * 0.5;
    // Horizontal frustum cull (with the sprite's half width as margin).
    if (Math.abs(lat) - halfW > d * TANH + 2) return;
    BB_D[NBB] = d; BB_L[NBB] = lat; BB_Z[NBB] = z; BB_S[NBB] = s;
    NBB++;
  }

  function sortBB() {
    var i, j, v;
    for (i = 0; i < NBB; i++) BB_ORD[i] = i;
    for (i = 1; i < NBB; i++) {   // insertion sort, far to near
      v = BB_ORD[i]; var dv = BB_D[v];
      j = i - 1;
      while (j >= 0 && BB_D[BB_ORD[j]] < dv) { BB_ORD[j + 1] = BB_ORD[j]; j--; }
      BB_ORD[j + 1] = v;
    }
  }

  function drawSprite(B, d, lat, z, s) {
    var vw = VW, vh = VH, buf = B.buf, zWall = B.zWall, zBox = B.zBox, boxTop = B.boxTop;
    var tex = s.tex, tw = tex.w, th = tex.h, data = tex.data;
    var scale = F / d;
    var sw = s.worldW * scale, sh = s.worldH * scale;
    if (sw < 0.25 || sh < 0.25) return;
    var cx = vw * 0.5 + lat * scale;
    var left = cx - sw * 0.5;
    var bottom = HY + (EZ - z) * scale, top = bottom - sh;
    var x0 = Math.ceil(left - 0.5), x1 = Math.ceil(left + sw - 0.5);
    var y0 = Math.ceil(top - 0.5), y1 = Math.ceil(bottom - 0.5);
    if (x0 < 0) x0 = 0; if (x1 > vw) x1 = vw;
    if (y0 < 0) y0 = 0; if (y1 > vh) y1 = vh;
    if (x1 <= x0 || y1 <= y0) return;
    var uStep = tw / sw, vStep = th / sh;
    var v0 = (y0 + 0.5 - top) * vStep;
    var li = levelFor(d) << 8;
    var lr = LR, lg = LG, lb = LB, twm = tw - 1, thm = th - 1;
    for (var x = x0; x < x1; x++) {
      if (d >= zWall[x]) continue;
      var ye = y1;
      if (d > zBox[x]) { var bt = Math.ceil(boxTop[x] - 0.5); if (bt < ye) ye = bt; }
      if (ye <= y0) continue;
      var tu = ((x + 0.5 - left) * uStep) | 0; if (tu > twm) tu = twm; else if (tu < 0) tu = 0;
      var v = v0, idx = y0 * vw + x;
      for (var y = y0; y < ye; y++) {
        var tv = v | 0; if (tv > thm) tv = thm;
        var c = data[tv * tw + tu];
        if ((c >>> 24) >= 128) {
          buf[idx] = 0xff000000 | (lb[li + ((c >>> 16) & 255)] << 16) | (lg[li + ((c >>> 8) & 255)] << 8) | lr[li + (c & 255)];
        }
        idx += vw; v += vStep;
      }
    }
  }

  var TWO_PI = Math.PI * 2, VIEW_STEP = Math.PI / 8;

  // The AGV's heading relative to the camera -> AGV line of sight, in 16 steps,
  // positive = clockwise in world coords (y down), 0 = we see its rear.
  function agvView(rx, ry, heading) {
    var los = Math.atan2(ry - CY, rx - CX);
    var rel = heading - los;
    rel = rel - TWO_PI * Math.floor(rel / TWO_PI);
    return Math.round(rel / VIEW_STEP) & 15;
  }

  function gatherBillboards(scene) {
    NBB = 0;
    var t = num(scene.t, 0), i;
    // Static props.
    for (i = 0; i < PROPS.length; i++) {
      var p = PROPS[i];
      addBB(p.x, p.y, num(p.spr.z, 0), p.spr);
    }
    // Pickups.
    var pk = scene.pickups;
    if (pk && pk.length) {
      var ps = texSprite('pickup', Math.floor(t * 6) & 3);
      if (ps) for (i = 0; i < pk.length; i++) if (pk[i]) addBB(pk[i].x, pk[i].y, num(ps.z, 0), ps);
    }
    // Drops.
    var dr = scene.drops;
    if (dr) {
      for (i = 0; i < dr.length; i++) {
        var o = dr[i];
        if (!o) continue;
        var ds = texSprite('drop_' + o.kind, 0);
        if (ds) addBB(o.x, o.y, num(ds.z, 0), ds);
      }
    }
    // Racers (+ the CALL EHS! sign over any racer in E-STOP).
    var rc = scene.racers;
    if (rc) {
      var blink = (Math.floor(t * 5) & 1) === 0;
      var ehs = null;
      for (i = 0; i < rc.length; i++) {
        var r = rc[i];
        if (!r) continue;
        var rx = num(r.x, NaN), ry = num(r.y, NaN);
        if (rx !== rx || ry !== ry) continue;
        var view = agvView(rx, ry, num(r.angle, 0));
        var s = texAgv(r.color || '#e04040', r.boxes | 0, view, !!(r.estop && blink));
        addBB(rx, ry, num(s.z, 0), s);
        if (r.estop) {
          if (!ehs) ehs = texSprite('ehs', Math.floor(t * 4) & 3);
          if (ehs) addBB(rx, ry, 26 + Math.sin(t * 5 + i) * 2.5, ehs);
        }
      }
    }
  }

  function drawBillboards(B) {
    sortBB();
    for (var i = 0; i < NBB; i++) {
      var k = BB_ORD[i];
      drawSprite(B, BB_D[k], BB_L[k], BB_Z[k], BB_S[k]);
      BB_S[k] = null;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Particles
  // ---------------------------------------------------------------------------
  var COLCACHE = {};
  function drawParticles(B, parts) {
    if (!parts || !parts.length) return;
    var vw = VW, vh = VH, buf = B.buf, zWall = B.zWall, zBox = B.zBox, boxTop = B.boxTop;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      var rx = num(p.x, NaN) - CX, ry = num(p.y, NaN) - CY;
      var d = rx * FX + ry * FY;
      if (!(d > NEAR)) continue;
      var scale = F / d;
      var sx = vw * 0.5 + (rx * RX + ry * RY) * scale;
      var sy = HY + (EZ - num(p.z, 2)) * scale;
      var sz = num(p.size, 2) * scale * 0.5;
      sz = sz < 1 ? 1 : sz > 8 ? 8 : Math.round(sz);
      var x0 = Math.round(sx - sz / 2), y0 = Math.round(sy - sz / 2);
      if (x0 >= vw || y0 >= vh || x0 + sz <= 0 || y0 + sz <= 0) continue;
      var col = p.color;
      var c = COLCACHE[col];
      if (c === undefined) { c = parseColor(col); COLCACHE[col] = c; }
      var li = levelFor(d) << 8;
      c = 0xff000000 | (LB[li + ((c >>> 16) & 255)] << 16) | (LG[li + ((c >>> 8) & 255)] << 8) | LR[li + (c & 255)];
      for (var x = Math.max(0, x0); x < Math.min(vw, x0 + sz); x++) {
        if (d >= zWall[x]) continue;
        var ye = Math.min(vh, y0 + sz);
        if (d > zBox[x]) { var bt = Math.ceil(boxTop[x] - 0.5); if (bt < ye) ye = bt; }
        for (var y = Math.max(0, y0); y < ye; y++) buf[y * vw + x] = c;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  var EMPTY_SCENE = {};

  function init() {
    try {
      buildFallback();
      MAP = undefined;   // force a rebuild of the world caches
      ensureWorld();
      COLCACHE = {};
    } catch (e) { warnOnce('init', e); }
  }

  function render(ctx, vx, vy, vw, vh, cam, scene) {
    vw = vw | 0; vh = vh | 0;
    if (vw <= 0 || vh <= 0) return;
    scene = scene || EMPTY_SCENE;
    var B = null;
    try {
      ensureWorld();
      B = getBuffers(ctx, vw, vh);
      setupCam(cam, vw, vh);
      if (B.kFov !== FOV) {
        for (var c = 0; c < vw; c++) B.kcol[c] = (2 * (c + 0.5) / vw - 1) * TANH;
        B.kFov = FOV;
      }
      // Run decal.
      var rk = scene.runKey || null;
      if (rk !== DECAL_KEY) {
        DECAL_KEY = rk;
        var dsrc = rk ? texDecal(rk) : null;
        DECAL = null;
        if (dsrc) {
          var sc = dsrc.scale || 2, sh = Math.round(Math.log(sc) / Math.LN2);
          if ((1 << sh) === sc) DECAL = { data: dsrc.data, w: dsrc.w, h: dsrc.h, shift: sh };
        }
      }
      drawFloorCeil(B);
      drawWalls(B);
      gatherBoxes(scene);
      drawBoxes(B);
      gatherBillboards(scene);
      drawBillboards(B);
      drawParticles(B, scene.particles);
    } catch (e) {
      warnOnce('render', e);
    }
    if (B && ctx && ctx.putImageData) {
      try { ctx.putImageData(B.img, vx | 0, vy | 0); } catch (e2) { warnOnce('putImageData', e2); }
    }
  }

  function project(cam, vw, vh, x, y, z) {
    cam = cam || {};
    var cx = num(cam.x, 0), cy = num(cam.y, 0);
    var ez = num(cam.z, DEF_EYE);
    if (ez < 1) ez = 1; else if (ez > WALL_H - 1) ez = WALL_H - 1;
    var a = num(cam.angle, 0), fx = Math.cos(a), fy = Math.sin(a);
    var fov = num(cam.fov, DEF_FOV);
    if (fov < 0.2) fov = 0.2; else if (fov > 2.8) fov = 2.8;
    var f = (vw / 2) / Math.tan(fov / 2);
    var hy = vh * HORIZON + num(cam.pitch, 0);
    var rx = num(x, 0) - cx, ry = num(y, 0) - cy;
    var d = rx * fx + ry * fy;
    if (!(d > NEAR)) return null;
    var scale = f / d;
    return { sx: vw / 2 + (rx * -fy + ry * fx) * scale, sy: hy + (ez - num(z, 0)) * scale, scale: scale, depth: d };
  }

  AGV.view3d = {
    init: init,
    render: render,
    project: project,
    // extras (not in the contract): handy for tools/tuning
    agvView: function (cam, x, y, heading) {
      setupCam(cam, 320, 180);
      return agvView(x, y, heading);
    }
  };
})();
