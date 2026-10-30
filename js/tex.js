/* Peabody AGV Rally - tex.js
 * Procedural pixel-art textures for the pseudo-3D chase-cam view (see CONTRACT.md, "v2").
 * Owner: TEX agent.
 *
 * Every texture is { w, h, data } where data is a Uint32Array(w*h) of ABGR little-endian pixels
 * (the layout of new Uint32Array(imageData.data.buffer)), row-major, alpha 0 = transparent.
 * No DOM and no canvas: pixels are written straight into the typed arrays, so this file also
 * loads (and builds) in Node.
 *
 * Wall texture convention: 32 x 96. v = 0 is the top (z = WALL_H), v = 95 the floor row (z = 0).
 * u runs across one tile face (32 texels per 16 world px), left -> right as the viewer sees it
 * (view3d's convention). Only the dock-door tracks are directional; everything else is symmetric.
 * Floor textures: 16 x 16, u = x & 15 (east), v = y & 15 (south). Ceiling: 64 x 64, same axes.
 */
var AGV = (typeof window !== 'undefined' ? window : globalThis).AGV =
  (typeof window !== 'undefined' ? window : globalThis).AGV || {};

(function () {
  'use strict';

  var TILE = AGV.TILE || 16;
  var WALL_H = AGV.WALL_H = AGV.WALL_H || 96;
  AGV.DOOR_H = AGV.DOOR_H || 56;
  var DEF_T = { FLOOR: 0, SCUFF: 1, VINYL: 2, WALL: 3, RACK: 4, ROOM: 5, DOCKDOOR: 6, WINDOW: 7, OUTSIDE: 8,
    TAPE: 9, DOCKPLATE: 10, CURB: 11 };
  function T() { return AGV.T || DEF_T; }

  // ---------------------------------------------------------------------------
  // Palette: AGV.gfx.PAL when present (same 32 colours as menus / minimap), plus a
  // few in-between shades for lighting ramps.
  // ---------------------------------------------------------------------------
  var FALLBACK_PAL = {
    black: '#0d0f14', ink: '#1c1f27', charcoal: '#2d3139', dkgrey: '#474c56',
    grey: '#6b717b', concreteDk: '#80858d', concrete: '#9298a0', concreteLt: '#a9aeb4',
    steelDk: '#7d8692', steel: '#b6bec7', wallShade: '#c8ccd1', wallTop: '#dde0e3',
    white: '#f4f4f0', yellow: '#f3c22c', yellowDk: '#b5850e', red: '#d83a34',
    redDk: '#8a1f1d', blue: '#2f6fd6', blueDk: '#1d418c', navy: '#1d2a5e',
    teal: '#2a8c83', tealDk: '#1a5753', orange: '#d9722b', orangeDk: '#8c4419',
    brown: '#a67647', brownDk: '#6b4a2b', green: '#3ccf5a', glass: '#22313f',
    glassLt: '#5b7d94', roof: '#383d48', outside: '#14171d', canvas: '#cdbb8f'
  };
  var EXTRA = {
    yellowLt: '#ffe27a', blueLt: '#5a95f0', tealLt: '#45ada2', orangeLt: '#f0954e',
    navyLt: '#2c3c78', navyDk: '#141c42', redLt: '#ef6a5e', greenLt: '#8af59c', bright: '#fffdf0',
    brownLt: '#c39463', wallDim: '#b9bec5'
  };
  var P = {};

  function hexRgb(h) {
    if (typeof h !== 'string' || h.charAt(0) !== '#') return [255, 0, 255];
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    return [parseInt(h.substr(1, 2), 16) || 0, parseInt(h.substr(3, 2), 16) || 0, parseInt(h.substr(5, 2), 16) || 0];
  }
  function pack(r, g, b) {
    r = r < 0 ? 0 : r > 255 ? 255 : r | 0; g = g < 0 ? 0 : g > 255 ? 255 : g | 0; b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
  function hex(h) { var c = hexRgb(h); return pack(c[0], c[1], c[2]); }
  function mix(a, b, f) {
    var ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255;
    var br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255;
    return pack(ar + (br - ar) * f, ag + (bg - ag) * f, ab + (bb - ab) * f);
  }
  function mul(a, f) { return pack((a & 255) * f, ((a >>> 8) & 255) * f, ((a >>> 16) & 255) * f); }

  function loadPalette() {
    var src = (AGV.gfx && AGV.gfx.PAL) || FALLBACK_PAL;
    Object.keys(FALLBACK_PAL).forEach(function (k) {
      var v = src[k];
      P[k] = hex(typeof v === 'string' && v.charAt(0) === '#' ? v : FALLBACK_PAL[k]);
    });
    Object.keys(EXTRA).forEach(function (k) { P[k] = hex(EXTRA[k]); });
  }
  loadPalette();

  // ---------------------------------------------------------------------------
  // Small helpers: hashing, dithering, texture drawing
  // ---------------------------------------------------------------------------
  function hash2(x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  // Deterministic PRNG (mulberry32) for per-variant layouts.
  function rng(seed) {
    var s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function bayer(x, y) { return (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16; }

  function newTex(w, h, fill) {
    var t = { w: w, h: h, data: new Uint32Array(w * h) };
    if (fill) t.data.fill(fill);
    return t;
  }
  function px(t, x, y, c) {
    if (x >= 0 && y >= 0 && x < t.w && y < t.h) t.data[y * t.w + x] = c;
  }
  function getp(t, x, y) {
    return (x >= 0 && y >= 0 && x < t.w && y < t.h) ? t.data[y * t.w + x] : 0;
  }
  function rect(t, x, y, w, h, c) {
    var x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    var x1 = Math.min(t.w, (x + w) | 0), y1 = Math.min(t.h, (y + h) | 0);
    for (var yy = y0; yy < y1; yy++) {
      var o = yy * t.w;
      for (var xx = x0; xx < x1; xx++) t.data[o + xx] = c;
    }
  }
  // Ordered-dither a rect toward colour c with coverage f (0..1).
  function drect(t, x, y, w, h, c, f) {
    for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) {
      if (bayer(xx, yy) < f) px(t, xx, yy, c);
    }
  }
  function frame(t, x, y, w, h, c) {
    rect(t, x, y, w, 1, c); rect(t, x, y + h - 1, w, 1, c);
    rect(t, x, y, 1, h, c); rect(t, x + w - 1, y, 1, h, c);
  }
  function ellipse(t, cx, cy, rx, ry, c) {
    for (var y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (var x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        var dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) px(t, x, y, c);
      }
    }
  }
  // Paint a 1 px outline of colour c on transparent pixels next to opaque ones.
  function outline(t, c, skipBottom) {
    var d = t.data, w = t.w, h = t.h, add = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (d[y * w + x]) continue;
      if ((x > 0 && d[y * w + x - 1]) || (x < w - 1 && d[y * w + x + 1]) ||
          (y > 0 && d[(y - 1) * w + x]) || (!skipBottom && y < h - 1 && d[(y + 1) * w + x])) add.push(y * w + x);
    }
    for (var i = 0; i < add.length; i++) d[add[i]] = c;
  }

  // Tiny 3x5 pixel font for signs.
  var F3 = {
    'A': '010101111101101', 'C': '011100100100011', 'E': '111100110100111', 'H': '101101111101101',
    'I': '111010010010111', 'L': '100100100100111', 'S': '011100111001110', 'T': '111010010010010',
    'X': '101101010101101', '!': '1110', '?': '110001010000010', ' ': ''
  };
  function text3w(str) {
    var w = 0;
    for (var i = 0; i < str.length; i++) w += str[i] === ' ' ? 3 : str[i] === '!' ? 2 : 4;
    return w - 1;
  }
  function text3(t, str, x, y, c) {
    for (var i = 0; i < str.length; i++) {
      var ch = str[i], g = F3[ch];
      if (ch === ' ') { x += 3; continue; }
      if (ch === '!') { rect(t, x, y, 1, 3, c); px(t, x, y + 4, c); x += 2; continue; }
      if (!g) { x += 4; continue; }
      for (var k = 0; k < 15; k++) if (g[k] === '1') px(t, x + (k % 3), y + ((k / 3) | 0), c);
      x += 4;
    }
  }
  // 5x7 "?" (same glyph as the gfx.js font).
  var Q57 = ['01110', '10001', '00001', '00010', '00100', '00000', '00100'];
  function glyphQ(t, x, y, c, s) {
    s = s || 1;
    for (var r = 0; r < 7; r++) for (var k = 0; k < 5; k++) {
      if (Q57[r][k] === '1') rect(t, x + k * s, y + r * s, s, s, c);
    }
  }

  // Map helpers.
  function M() { return AGV.map || null; }
  function tileAt(tx, ty) {
    var m = AGV.map;
    if (!m || tx < 0 || ty < 0 || tx >= m.W || ty >= m.H) return T().OUTSIDE;
    return m.tiles[ty * m.W + tx];
  }
  function solid(id) {
    if (AGV.isSolid) return AGV.isSolid(id);
    var t = T();
    return id === t.WALL || id === t.RACK || id === t.ROOM || id === t.DOCKDOOR || id === t.WINDOW ||
      id === t.OUTSIDE || id === t.CURB;
  }
  // Drivable (or rendered-as-floor) tile.
  function floorLike(id) { return !solid(id) || id === T().CURB; }

  // ===========================================================================
  // WALLS (32 x 96)
  // ===========================================================================
  var WT = 32, WHT = 96;

  // Plain white wall body with the ceiling-shadow gradient at the top and the base
  // treatment at the bottom. style: 'curb' (black base + yellow kick-curb, photos p5/p6/p8),
  // 'base' (black cove base only, Main Hall p4), 'dock' (ribbed insulated panels, Dock p3).
  function wallBody(style, seed) {
    var t = newTex(WT, WHT, P.white);
    var x, y;
    for (y = 0; y < WHT; y++) for (x = 0; x < WT; x++) {
      var h = hash2(x, y, 11 + seed);
      if (h < 0.045) px(t, x, y, P.wallTop);
      else if (h < 0.05) px(t, x, y, P.wallShade);
    }
    // ceiling line + soft shadow under the dark ceiling
    rect(t, 0, 0, WT, 1, P.black);
    rect(t, 0, 1, WT, 1, P.dkgrey);
    rect(t, 0, 2, WT, 1, P.wallDim);
    for (y = 3; y < 14; y++) {
      var f = 1 - (y - 3) / 11;
      for (x = 0; x < WT; x++) {
        var b = bayer(x, y);
        if (b < f * 0.55) px(t, x, y, P.wallShade);
        else if (b < f) px(t, x, y, P.wallTop);
      }
    }
    if (style === 'dock') {
      // insulated metal panels: horizontal ribs every 8 rows, vertical seams at the tile edges
      for (y = 16; y < 90; y += 8) {
        rect(t, 0, y, WT, 1, P.wallShade);
        rect(t, 0, y + 1, WT, 1, P.bright);
      }
      rect(t, 0, 3, 1, 87, P.wallShade);
      rect(t, WT - 1, 3, 1, 87, P.wallTop);
    }
    // base
    if (style === 'curb') {
      rect(t, 0, 87, WT, 1, P.charcoal);
      rect(t, 0, 88, WT, 3, P.black);
      rect(t, 0, 91, WT, 1, P.yellowLt);
      rect(t, 0, 92, WT, 3, P.yellow);
      rect(t, 0, 95, WT, 1, P.yellowDk);
      for (x = 0; x < WT; x++) {
        if (hash2(x, 3, seed + 7) < 0.12) px(t, x, 92 + ((hash2(x, 4, seed) * 3) | 0), P.yellowDk);
        if (hash2(x, 5, seed + 7) < 0.04) px(t, x, 93, P.charcoal);
      }
    } else {
      rect(t, 0, 92, WT, 1, P.charcoal);
      rect(t, 0, 93, WT, 3, P.black);
      for (x = 0; x < WT; x += 2) px(t, x + ((hash2(x, 9, seed) * 2) | 0), 93, P.ink);
    }
    return t;
  }

  function decoLight(t) {
    // wall-mounted fluorescent strip near the top
    rect(t, 0, 9, WT, 1, P.dkgrey);
    rect(t, 0, 10, WT, 2, P.bright);
    rect(t, 0, 12, WT, 1, P.steelDk);
    for (var x = 0; x < WT; x++) {
      if (bayer(x, 13) < 0.5) px(t, x, 13, P.wallTop);
      if (bayer(x, 8) < 0.35) px(t, x, 8, P.white);
    }
  }
  function decoExtinguisher(t) {
    // red "fire extinguisher" sign
    rect(t, 12, 38, 8, 7, P.red);
    rect(t, 12, 44, 8, 1, P.redDk);
    rect(t, 15, 39, 2, 4, P.white);
    px(t, 14, 40, P.white);
    // bracket + extinguisher (about 5 in wide x 18 in tall)
    rect(t, 12, 58, 8, 1, P.steelDk);
    rect(t, 14, 53, 4, 2, P.black);              // valve / handle
    rect(t, 15, 52, 3, 1, P.charcoal);
    rect(t, 13, 55, 6, 2, P.redDk);              // shoulder
    rect(t, 13, 57, 6, 15, P.red);
    rect(t, 13, 57, 1, 15, P.redDk);
    rect(t, 15, 57, 1, 14, P.redLt);
    rect(t, 18, 57, 1, 15, P.redDk);
    rect(t, 14, 62, 4, 4, P.white);              // label
    rect(t, 14, 64, 4, 1, P.dkgrey);
    rect(t, 13, 72, 6, 1, P.redDk);
    rect(t, 19, 54, 1, 9, P.black);              // hose
    rect(t, 19, 63, 2, 1, P.black);
  }
  function decoPull(t) {
    // red fire-alarm pull station (photo p4)
    rect(t, 13, 44, 7, 9, P.red);
    frame(t, 13, 44, 7, 9, P.redDk);
    rect(t, 14, 47, 5, 2, P.white);
    px(t, 16, 50, P.yellowLt);
  }
  function decoSwitch(t) {
    rect(t, 15, 48, 3, 5, P.wallShade);
    px(t, 16, 50, P.grey);
    rect(t, 15, 52, 3, 1, P.wallDim);
  }
  function decoBoard(t) {
    // dark bulletin board / smart panel (photo p4)
    rect(t, 3, 34, 26, 22, P.steelDk);
    rect(t, 4, 35, 24, 20, P.charcoal);
    rect(t, 4, 35, 24, 1, P.ink);
    rect(t, 6, 38, 6, 7, P.white); rect(t, 7, 40, 4, 1, P.wallShade); rect(t, 7, 42, 3, 1, P.wallShade);
    rect(t, 14, 37, 5, 6, P.yellowLt);
    rect(t, 20, 39, 6, 8, P.white); rect(t, 21, 41, 4, 1, P.wallShade);
    rect(t, 9, 47, 7, 5, P.wallTop);
    rect(t, 3, 56, 26, 1, P.wallShade);
  }
  function decoVent(t) {
    rect(t, 8, 16, 16, 9, P.steelDk);
    rect(t, 9, 17, 14, 7, P.steel);
    for (var y = 18; y < 24; y += 2) rect(t, 9, y, 14, 1, P.dkgrey);
    rect(t, 8, 25, 16, 1, P.wallShade);
  }
  function decoExit(t) {
    // door-frame-height steel corner protector at both edges (photo p5/p6)
    rect(t, 0, 50, 2, 38, P.steel);
    rect(t, 1, 50, 1, 38, P.wallTop);
    rect(t, WT - 2, 50, 2, 38, P.steel);
    rect(t, WT - 2, 50, 1, 38, P.steelDk);
  }

  function makeWall(style, deco, light, seed) {
    var t = wallBody(style, seed);
    if (light) decoLight(t);
    if (deco === 'ext') decoExtinguisher(t);
    else if (deco === 'pull') decoPull(t);
    else if (deco === 'switch') decoSwitch(t);
    else if (deco === 'board') decoBoard(t);
    else if (deco === 'vent') decoVent(t);
    else if (deco === 'guard') decoExit(t);
    return t;
  }

  // WINDOW: wall with a deep white-framed window of dark glass (photo p4).
  function makeWindow(style, seed) {
    var t = wallBody(style, seed);
    var x0 = 2, x1 = 29, y0 = 30, y1 = 64;
    rect(t, x0, y0, x1 - x0 + 1, y1 - y0 + 1, P.white);
    frame(t, x0, y0, x1 - x0 + 1, y1 - y0 + 1, P.wallShade);
    // reveal (inner jamb, shaded on the top and the left)
    rect(t, x0 + 2, y0 + 2, x1 - x0 - 3, 2, P.steel);
    rect(t, x0 + 2, y0 + 2, 2, y1 - y0 - 3, P.wallDim);
    rect(t, x1 - 3, y0 + 2, 2, y1 - y0 - 3, P.wallTop);
    // glass
    var gx = x0 + 4, gy = y0 + 4, gw = x1 - x0 - 7, gh = y1 - y0 - 7;
    rect(t, gx, gy, gw, gh, P.glass);
    // hint of the room behind: a lighter band and some shapes low down
    for (var y = gy; y < gy + gh; y++) for (var x = gx; x < gx + gw; x++) {
      var u = (y - gy) / gh;
      if (u > 0.55 && bayer(x, y) < (u - 0.55) * 1.2) px(t, x, y, P.ink);
      if (u < 0.35 && bayer(x, y) < 0.12) px(t, x, y, P.roof);
    }
    var r = rng(seed * 31 + 5);
    rect(t, gx + 2 + ((r() * 8) | 0), gy + gh - 9, 6, 5, P.dkgrey);
    rect(t, gx + 12 + ((r() * 6) | 0), gy + 6, 4, 3, P.glassLt);
    // glints
    for (var k = 0; k < 9; k++) {
      px(t, gx + 3 + k, gy + 1 + k, P.glassLt);
      px(t, gx + 4 + k, gy + 1 + k, P.glassLt);
      if (k < 5) px(t, gx + 10 + k, gy + 1 + k, P.glassLt);
    }
    // sill
    rect(t, x0 - 1, y1 + 1, x1 - x0 + 3, 1, P.bright);
    rect(t, x0 - 1, y1 + 2, x1 - x0 + 3, 1, P.wallShade);
    return t;
  }

  // DOCKDOOR: white roll-up door with ribs and small windows (photo p3).
  // trackLo / trackHi: draw the steel guide track at u = 0 / u = 31 (ends of the door run).
  function makeDockDoor(trackLo, trackHi, seed) {
    var t = wallBody('dock', seed);
    var top = 22, x, y;
    // header hood
    rect(t, 0, top - 4, WT, 3, P.wallShade);
    rect(t, 0, top - 1, WT, 1, P.dkgrey);
    // curtain
    rect(t, 0, top, WT, WHT - top, P.white);
    for (y = top; y < 93; y++) {
      var k = (y - top) % 12;
      if (k === 11) rect(t, 0, y, WT, 1, P.steelDk);           // section joint
      else if (k === 0) rect(t, 0, y, WT, 1, P.bright);
      else if (k % 3 === 2) rect(t, 0, y, WT, 1, P.wallTop);   // ribs
      else if (k % 3 === 0) rect(t, 0, y, WT, 1, P.wallShade);
    }
    // window row (one small window per tile, ~4 ft up)
    var wy = top + 37;
    rect(t, 8, wy, 16, 7, P.black);
    rect(t, 9, wy + 1, 14, 5, P.glass);
    px(t, 10, wy + 1, P.glassLt); px(t, 11, wy + 1, P.glassLt); px(t, 10, wy + 2, P.glassLt);
    rect(t, 9, wy + 5, 14, 1, P.glassLt);
    // bottom astragal (rubber seal) + floor
    rect(t, 0, 92, WT, 1, P.steel);
    rect(t, 0, 93, WT, 3, P.black);
    // lift handle on the middle section
    rect(t, 14, 84, 4, 1, P.steelDk);
    // steel tracks at the ends of the door
    function track(xx, dir) {
      rect(t, xx, top - 4, 3, WHT - top + 4, P.steelDk);
      rect(t, xx + (dir > 0 ? 0 : 2), top - 4, 1, WHT - top + 4, P.grey);
      for (y = top; y < 92; y += 6) px(t, xx + 1, y, P.dkgrey);
    }
    if (trackLo) track(0, 1);
    if (trackHi) track(WT - 3, -1);
    // red / green dock signal on the header of the first section
    if (trackLo) { rect(t, 5, 10, 4, 5, P.black); px(t, 6, 11, P.red); px(t, 7, 11, P.red); px(t, 6, 13, P.green); }
    return t;
  }

  // ---------------------------------------------------------------------------
  // Pallet racking (photo p7): teal uprights, orange beams, wire decks, cartons.
  // ---------------------------------------------------------------------------
  var BEAMS = [17, 36, 55, 74, 93];   // top row of each beam level (93 = floor-level deck)

  function carton(t, x, y, w, h, kind, r) {
    // x,y = top-left; drawn sitting on row y+h-1
    var c0, c1, c2, c3;   // fill, highlight, shade, dark
    if (kind === 'kraft') { c0 = P.brown; c1 = P.brownLt; c2 = mix(P.brown, P.brownDk, 0.5); c3 = P.brownDk; }
    else if (kind === 'white') { c0 = P.white; c1 = P.bright; c2 = P.wallShade; c3 = P.steelDk; }
    else if (kind === 'bin') { c0 = P.blue; c1 = P.blueLt; c2 = P.blueDk; c3 = P.navy; }
    else { c0 = P.wallTop; c1 = P.white; c2 = P.steel; c3 = P.steelDk; }  // shrink-wrapped
    rect(t, x, y, w, h, c0);
    rect(t, x, y, w, 1, c1);
    rect(t, x, y, 1, h, c1);
    rect(t, x + w - 1, y, 1, h, c2);
    rect(t, x, y + h - 1, w, 1, c3);
    if (kind === 'kraft') {
      rect(t, x + 1, y + ((h / 2) | 0), w - 2, 1, mix(P.brown, P.canvas, 0.5));  // tape
      if (r() < 0.5) rect(t, x + 3, y + 2, Math.min(6, w - 5), 3, P.white);          // label
    } else if (kind === 'white') {
      var sx = r() < 0.5 ? x + 2 : x + w - 5;
      rect(t, sx, y + 1, 2, h - 2, P.navy);                                         // navy side stripe
      if (w > 10) rect(t, x + ((w / 2) | 0) - 1, y + 3, 3, 1, P.dkgrey);             // hand hole
    } else if (kind === 'bin') {
      rect(t, x, y + 1, w, 1, P.blueDk);
      for (var k = x + 3; k < x + w - 2; k += 4) rect(t, k, y + 2, 1, h - 3, P.blueDk);
    } else {
      for (var j = 0; j < 3; j++) px(t, x + 2 + j * 3, y + 2 + j, P.bright);
    }
  }

  function makeRack(seed, upright, hazard) {
    var t = newTex(WT, WHT, P.ink);
    var r = rng(seed * 7919 + 13), x, y, i;
    // inside of the rack: dark, with the wire-mesh back panel
    for (y = 0; y < WHT; y++) for (x = 0; x < WT; x++) {
      if ((x & 3) === 1 || (y & 3) === 2) { if (bayer(x, y) < 0.5) px(t, x, y, P.charcoal); }
      else if (hash2(x, y, 41) < 0.05) px(t, x, y, P.black);
    }
    // far-side beams (darker, offset up a little: depth cue)
    for (i = 0; i < BEAMS.length; i++) drect(t, 0, BEAMS[i] - 5, WT, 2, P.orangeDk, 0.6);
    // contents of each level
    for (i = 0; i < BEAMS.length; i++) {
      var floorY = BEAMS[i] - 1;          // row the cartons stand on (the wire deck)
      var room = i === 0 ? 15 : BEAMS[i] - BEAMS[i - 1] - 4;
      var xx = 1 + ((r() * 4) | 0);
      while (xx < WT - 6) {
        if (r() < 0.38) { xx += 6 + ((r() * 8) | 0); continue; }
        var w = 9 + ((r() * 16) | 0);
        if (xx + w > WT - 1) w = WT - 1 - xx;
        if (w < 7) break;
        var h = Math.min(room, 6 + ((r() * 9) | 0));
        var kr = r();
        var kind = kr < 0.5 ? 'kraft' : kr < 0.75 ? 'white' : kr < 0.88 ? 'bin' : 'wrap';
        carton(t, xx, floorY - h, w, h, kind, r);
        // sometimes a second, smaller carton on top
        if (room - h >= 6 && r() < 0.35) {
          var w2 = Math.max(6, w - 4 - ((r() * 4) | 0)), h2 = Math.min(room - h, 4 + ((r() * 5) | 0));
          carton(t, xx + 1 + ((r() * (w - w2)) | 0), floorY - h - h2, w2, h2, r() < 0.6 ? 'kraft' : 'white', r);
        }
        xx += w + 1 + ((r() * 3) | 0);
      }
      // wire deck front edge
      for (x = 0; x < WT; x++) px(t, x, floorY, (x & 1) ? P.steel : P.steelDk);
    }
    // front beams
    for (i = 0; i < BEAMS.length; i++) {
      var by = BEAMS[i];
      rect(t, 0, by, WT, 1, P.orangeLt);
      rect(t, 0, by + 1, WT, 1, P.orange);
      if (by + 2 < WHT) rect(t, 0, by + 2, WT, 1, P.orangeDk);
    }
    // uprights (paired frame posts at both tile edges)
    if (upright) {
      [[0, 1], [WT - 3, -1]].forEach(function (u) {
        var ux = u[0];
        rect(t, ux, 0, 3, WHT, P.teal);
        rect(t, ux + (u[1] > 0 ? 0 : 2), 0, 1, WHT, P.tealDk);
        rect(t, ux + 1, 0, 1, WHT, P.tealLt);
        for (y = 2; y < WHT; y += 4) px(t, ux + 1, y, P.tealDk);
        for (var b = 0; b < BEAMS.length; b++) rect(t, ux, BEAMS[b] - 1, 3, 5, P.tealDk);  // beam connectors
      });
      rect(t, 0, 94, WT, 2, P.grey);   // base plates
    }
    if (hazard) {
      for (y = 90; y < WHT; y++) for (x = 0; x < WT; x++) {
        px(t, x, y, ((x + y) & 7) < 4 ? P.yellow : P.black);
      }
      rect(t, 0, 89, WT, 1, P.dkgrey);
    }
    return t;
  }

  // Grey mobile-rack end panel with an optional black control box (photo p7).
  function makeEndPanel(box, seed) {
    var t = newTex(WT, WHT, P.steel);
    var x, y;
    for (y = 0; y < WHT; y++) for (x = 0; x < WT; x++) {
      var c = P.steel;
      if (x % 8 === 3) c = P.wallShade;
      else if (x % 8 === 4) c = P.steelDk;
      if (hash2(x, y, 77 + seed) < 0.04) c = P.wallShade;
      px(t, x, y, c);
    }
    // top: darker (ceiling shadow), with the racking poking out above the panel
    for (y = 0; y < 10; y++) for (x = 0; x < WT; x++) {
      if (bayer(x, y) < 1 - y / 10) px(t, x, y, P.steelDk);
    }
    rect(t, 0, 0, WT, 2, P.dkgrey);
    // panel seams at the tile edges
    rect(t, 0, 2, 1, 86, P.steelDk);
    rect(t, WT - 1, 2, 1, 86, P.wallShade);
    // bottom: kick plate with hazard stripes + blue status light
    rect(t, 0, 86, WT, 1, P.dkgrey);
    for (y = 87; y < WHT; y++) for (x = 0; x < WT; x++) px(t, x, y, ((x - y) & 7) < 4 ? P.yellow : P.black);
    if (box) {
      // black control box with a small touch screen
      rect(t, 8, 38, 17, 22, P.black);
      rect(t, 9, 39, 15, 20, P.ink);
      rect(t, 10, 41, 11, 7, P.glass);
      rect(t, 11, 42, 9, 5, P.glassLt);
      rect(t, 11, 42, 9, 1, P.blueLt);
      px(t, 12, 51, P.green); px(t, 15, 51, P.red); px(t, 18, 51, P.yellow);
      rect(t, 11, 54, 9, 2, P.charcoal);
      rect(t, 25, 40, 1, 20, P.dkgrey);           // shadow on the panel
      rect(t, 15, 60, 2, 26, P.charcoal);         // conduit down to the base
      rect(t, 14, 84, 4, 2, P.blueLt);            // blue drive light
    }
    return t;
  }

  // ===========================================================================
  // Wall lookup tables, built in init()
  // ===========================================================================
  var wallCache = {};          // key -> texture
  var wallList = [];           // index -> texture
  var wallKeyIdx = {};         // key -> index
  var wallIdx = null;          // Uint16Array(W*H*2): per tile & face -> wallList index
  var wallW = 0, wallH = 0;

  function wallByKey(key) {
    var t = wallCache[key];
    if (t) return t;
    var p = key.split('|');
    switch (p[0]) {
      case 'w': t = makeWall(p[1], p[2], p[3] === '1', +p[4]); break;
      case 'win': t = makeWindow(p[1], +p[2]); break;
      case 'dd': t = makeDockDoor(p[1] === '1', p[2] === '1', +p[3]); break;
      case 'rack': t = makeRack(+p[1], p[2] === '1', p[3] === '1'); break;
      case 'end': t = makeEndPanel(p[1] === '1', +p[2]); break;
      default: t = makeWall('curb', '', false, 0);
    }
    wallCache[key] = t;
    return t;
  }
  function keyIndex(key) {
    var i = wallKeyIdx[key];
    if (i === undefined) {
      i = wallList.length;
      wallList.push(wallByKey(key));
      wallKeyIdx[key] = i;
    }
    return i;
  }

  // Which side of this wall tile the player sees: the area of a floor neighbour.
  function wallStyle(tx, ty, face) {
    var d = face === 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    for (var k = 0; k < 2; k++) {
      var nx = tx + d[k][0], ny = ty + d[k][1];
      if (floorLike(tileAt(nx, ny))) {
        var area = AGV.areaAt ? AGV.areaAt((nx + 0.5) * TILE, (ny + 0.5) * TILE) : '';
        if (area === 'DOCK') return (face === 1 && tx <= 4) ? 'dock' : 'base';
        if (area === 'MAIN HALL') return 'base';
        return 'curb';
      }
    }
    return 'curb';
  }

  function wallKey(id, tx, ty, face) {
    var t = T();
    var h = hash2(tx, ty, 3 + face);
    var along = face === 0 ? tx : ty;
    if (id === t.RACK) {
      if (face === 0) {
        // rack row end: control box on the middle tile of the row
        var x0 = tx, x1 = tx;
        while (tileAt(x0 - 1, ty) === t.RACK) x0--;
        while (tileAt(x1 + 1, ty) === t.RACK) x1++;
        return 'end|' + (tx === x0 + ((x1 - x0) >> 1) ? 1 : 0) + '|' + (tx & 1);
      }
      return 'rack|' + ((h * 24) | 0) + '|' + (ty % 3 === 0 ? 1 : 0) + '|0';
    }
    var style = wallStyle(tx, ty, face);
    var seed = (hash2(tx, ty, 17) * 3) | 0;
    if (id === t.WINDOW) return 'win|' + style + '|' + seed;
    if (id === t.DOCKDOOR) {
      var dx = face === 0 ? 1 : 0, dy = face === 0 ? 0 : 1;
      var lo = tileAt(tx - dx, ty - dy) !== t.DOCKDOOR, hi = tileAt(tx + dx, ty + dy) !== t.DOCKDOOR;
      // view3d mirrors u so it always runs left -> right as seen by the viewer: u = 0 is the
      // +y edge when seen from the east and the +x edge when seen from the north.
      var flip = face === 1 ? floorLike(tileAt(tx + 1, ty)) : floorLike(tileAt(tx, ty - 1));
      if (flip) { var tmp = lo; lo = hi; hi = tmp; }
      return 'dd|' + (lo ? 1 : 0) + '|' + (hi ? 1 : 0) + '|' + seed;
    }
    var light = (((along % 6) + 6) % 6) < 3 && style !== 'dock' ? 1 : 0;
    var deco = '';
    if (id === t.WALL) {
      if (h < 0.035) deco = 'ext';
      else if (h < 0.055) deco = 'pull';
      else if (h < 0.12) deco = 'switch';
      else if (h < 0.15 && style === 'base') deco = 'board';
      else if (h < 0.19 && !light) deco = 'vent';
      // steel corner guards where the wall turns a corner next to a doorway
      if (!deco && cornerish(tx, ty, face)) deco = 'guard';
    }
    return 'w|' + style + '|' + deco + '|' + light + '|' + seed;
  }
  // A wall tile at the end of a wall run (doorway jamb / outside corner): one along-neighbour is floor.
  function cornerish(tx, ty, face) {
    var dx = face === 0 ? 1 : 0, dy = face === 0 ? 0 : 1;
    return floorLike(tileAt(tx - dx, ty - dy)) || floorLike(tileAt(tx + dx, ty + dy));
  }

  function buildWallIndex() {
    var m = M();
    wallW = m ? m.W : 0; wallH = m ? m.H : 0;
    wallIdx = new Uint16Array(wallW * wallH * 2);
    var dflt = keyIndex('w|curb||0|0');
    if (!m) return;
    for (var ty = 0; ty < wallH; ty++) for (var tx = 0; tx < wallW; tx++) {
      var id = m.tiles[ty * wallW + tx], i = (ty * wallW + tx) * 2;
      if (!solid(id) || id === T().CURB) { wallIdx[i] = wallIdx[i + 1] = dflt; continue; }
      // only tiles that can actually be seen need a specific texture
      var seen0 = floorLike(tileAt(tx, ty - 1)) || floorLike(tileAt(tx, ty + 1));
      var seen1 = floorLike(tileAt(tx - 1, ty)) || floorLike(tileAt(tx + 1, ty));
      wallIdx[i] = seen0 ? keyIndex(wallKey(id, tx, ty, 0)) : dflt;
      wallIdx[i + 1] = seen1 ? keyIndex(wallKey(id, tx, ty, 1)) : dflt;
    }
  }

  function wall(tileId, tx, ty, face) {
    if (!inited) init();
    face = face ? 1 : 0;
    if (wallIdx && tx >= 0 && ty >= 0 && tx < wallW && ty < wallH && AGV.map.tiles[ty * wallW + tx] === tileId) {
      return wallList[wallIdx[(ty * wallW + tx) * 2 + face]];
    }
    var t = T();
    if (tileId === t.RACK) return wallByKey(face === 0 ? 'end|0|0' : 'rack|' + ((hash2(tx, ty, 3) * 24) | 0) + '|0|0');
    if (tileId === t.WINDOW) return wallByKey('win|base|0');
    if (tileId === t.DOCKDOOR) return wallByKey('dd|0|0|0');
    return wallByKey('w|curb||0|0');
  }

  // ===========================================================================
  // FLOORS (16 x 16)
  // ===========================================================================
  var FT = 16;
  var floorCache = {}, floorKeyIdx = {};

  function concrete(seed, kind) {
    var t = newTex(FT, FT, P.concrete);
    var x, y, r = rng(seed * 97 + 3);
    for (y = 0; y < FT; y++) for (x = 0; x < FT; x++) {
      var h = hash2(x, y, 200 + seed);
      if (h < 0.10) px(t, x, y, P.concreteLt);
      else if (h < 0.17) px(t, x, y, P.concreteDk);
      else if (h < 0.175) px(t, x, y, P.grey);
    }
    if (seed % 4 >= 2) {
      // soft mottled patch (polished-floor sheen or a faint stain), kept inside the tile
      var cx = 4 + r() * 8, cy = 4 + r() * 8, rad = 2.5 + r() * 2.5, light = seed % 4 === 2;
      for (y = 1; y < FT - 1; y++) for (x = 1; x < FT - 1; x++) {
        var d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.3) / rad;
        if (d < 1 && bayer(x, y) < (1 - d) * 0.9) px(t, x, y, light ? P.concreteLt : P.concreteDk);
      }
    }
    return t;
  }
  function scuff(seed) {
    var t = concrete(seed + 11);
    var r = rng(seed * 131 + 7);
    for (var k = 0; k < 2; k++) {
      var y0 = 3 + r() * 10, amp = 1 + r() * 2.5, fr = 0.2 + r() * 0.3, ph = r() * 6, vert = r() < 0.5;
      for (var s = 1; s < FT - 1; s++) {
        var o = Math.round(y0 + Math.sin(s * fr + ph) * amp);
        var c = bayer(s, o) < 0.6 ? P.grey : P.dkgrey;
        if (vert) { px(t, o, s, c); if (r() < 0.4) px(t, o + 1, s, P.concreteDk); }
        else { px(t, s, o, c); if (r() < 0.4) px(t, s, o + 1, P.concreteDk); }
      }
    }
    for (var i = 0; i < 6; i++) px(t, 1 + ((r() * 14) | 0), 1 + ((r() * 14) | 0), P.dkgrey);
    return t;
  }
  function vinyl(seed) {
    var t = newTex(FT, FT, P.wallTop);
    for (var y = 0; y < FT; y++) for (var x = 0; x < FT; x++) {
      var h = hash2(x, y, 300 + seed);
      if (h < 0.12) px(t, x, y, P.wallShade);
      else if (h < 0.17) px(t, x, y, P.white);
      else if (h < 0.20) px(t, x, y, P.steel);
      else if (h < 0.207) px(t, x, y, P.steelDk);
    }
    return t;
  }
  function tape() {
    var t = newTex(FT, FT);
    for (var y = 0; y < FT; y++) for (var x = 0; x < FT; x++) {
      var c = ((x + y) & 7) < 4 ? P.yellow : P.ink;
      var h = hash2(x, y, 400);
      if (h < 0.05) c = P.concrete;
      else if (h < 0.09 && c === P.yellow) c = P.yellowDk;
      px(t, x, y, c);
    }
    return t;
  }
  function dockplate() {
    var t = newTex(FT, FT, P.steelDk);
    for (var y = 0; y < FT; y++) for (var x = 0; x < FT; x++) {
      if (hash2(x, y, 500) < 0.08) px(t, x, y, P.grey);
    }
    // raised diamond lugs, alternating direction
    for (var gy = 0; gy < 4; gy++) for (var gx = 0; gx < 4; gx++) {
      var x0 = gx * 4 + 1, y0 = gy * 4 + 1;
      if ((gx + gy) & 1) {
        px(t, x0, y0 + 1, P.steel); px(t, x0 + 1, y0, P.wallShade); px(t, x0 + 1, y0 + 1, P.dkgrey);
      } else {
        px(t, x0, y0, P.wallShade); px(t, x0 + 1, y0 + 1, P.steel); px(t, x0 + 1, y0 + 2, P.dkgrey);
      }
    }
    return t;
  }
  // CURB: yellow top; fs = bitmask of sides that face the drivable floor (N1 E2 S4 W8).
  function curb(fs, ws) {
    var t = newTex(FT, FT, P.yellow);
    var x, y;
    for (y = 0; y < FT; y++) for (x = 0; x < FT; x++) {
      var h = hash2(x, y, 600);
      if (h < 0.08) px(t, x, y, P.yellowDk);
      else if (h < 0.1) px(t, x, y, P.charcoal);
      else if (h < 0.16) px(t, x, y, P.yellowLt);
    }
    function edge(side, dist, c) {
      for (var k = 0; k < FT; k++) {
        if (side === 1) px(t, k, dist, c);
        else if (side === 2) px(t, FT - 1 - dist, k, c);
        else if (side === 4) px(t, k, FT - 1 - dist, c);
        else px(t, dist, k, c);
      }
    }
    [1, 2, 4, 8].forEach(function (s) {
      if (fs & s) { edge(s, 0, P.black); edge(s, 1, P.yellowDk); edge(s, 2, P.yellowDk); edge(s, 3, P.yellowLt); }
      else if (ws & s) { edge(s, 0, P.charcoal); }
    });
    return t;
  }
  function addJoints(t, jx, jy) {
    for (var k = 0; k < FT; k++) {
      if (jx) { px(t, 0, k, (k & 3) === 3 ? P.concreteDk : P.grey); }
      if (jy) { px(t, k, 0, (k & 3) === 1 ? P.concreteDk : P.grey); }
    }
  }
  // Darken the floor along walls (ambient occlusion). ao = N1 E2 S4 W8.
  function addAO(t, ao) {
    for (var y = 0; y < FT; y++) for (var x = 0; x < FT; x++) {
      var d = 9;
      if (ao & 1) d = Math.min(d, y);
      if (ao & 2) d = Math.min(d, FT - 1 - x);
      if (ao & 4) d = Math.min(d, FT - 1 - y);
      if (ao & 8) d = Math.min(d, x);
      var i = y * FT + x;
      if (d === 0) t.data[i] = mul(t.data[i], 0.62);
      else if (d === 1) t.data[i] = mul(t.data[i], 0.76);
      else if (d === 2) t.data[i] = mul(t.data[i], 0.88);
      else if (d === 3 && ((x + y) & 1)) t.data[i] = mul(t.data[i], 0.92);
    }
  }
  function floorByKey(key) {
    var p = key.split('|'), t;
    switch (p[0]) {
      case 'c': t = concrete(+p[1]); break;
      case 's': t = scuff(+p[1]); break;
      case 'v': t = vinyl(+p[1]); break;
      case 't': t = tape(); break;
      case 'd': t = dockplate(); break;
      case 'k': t = curb(+p[1], +p[2]); break;
      default: t = concrete(0);
    }
    if (p[0] === 'c' || p[0] === 's') addJoints(t, p[2] === '1', p[3] === '1');
    var ao = +p[p.length - 1];
    if (p[0] !== 'k' && ao) addAO(t, ao);
    return t;
  }
  function floorIndexOf(key) {
    var i = floorKeyIdx[key];
    if (i === undefined) {
      i = tex.floorTextures.length;
      tex.floorTextures.push(floorCache[key] || (floorCache[key] = floorByKey(key)));
      floorKeyIdx[key] = i;
    }
    return i;
  }
  function buildFloors() {
    tex.floorTextures = [];
    floorKeyIdx = {};
    var t = T();
    // a stable set first, so index 0.. are always the plain variants
    var base = ['c|0|0|0|0', 'c|1|0|0|0', 'c|2|0|0|0', 'c|3|0|0|0', 's|0|0|0|0', 's|1|0|0|0', 's|2|0|0|0',
      'v|0|0', 'v|1|0', 't|0', 'd|0', 'k|0|0'];
    base.forEach(floorIndexOf);
    var m = M();
    if (!m) { tex.floorIndex = new Uint16Array(0); return; }
    var W = m.W, H = m.H, idx = new Uint16Array(W * H);
    function wallAt(x, y) { var n = tileAt(x, y); return solid(n) && n !== t.CURB; }
    for (var ty = 0; ty < H; ty++) for (var tx = 0; tx < W; tx++) {
      var id = m.tiles[ty * W + tx];
      if (solid(id) && id !== t.CURB) { idx[ty * W + tx] = 0; continue; }
      var ao = 0;
      if (wallAt(tx, ty - 1)) ao |= 1;
      if (wallAt(tx + 1, ty)) ao |= 2;
      if (wallAt(tx, ty + 1)) ao |= 4;
      if (wallAt(tx - 1, ty)) ao |= 8;
      var h = hash2(tx, ty, 900);
      var jx = tx % 6 === 0 ? 1 : 0, jy = ty % 6 === 0 ? 1 : 0;
      var key;
      if (id === t.SCUFF) key = 's|' + ((h * 3) | 0) + '|' + jx + '|' + jy + '|' + ao;
      else if (id === t.VINYL) key = 'v|' + ((h * 2) | 0) + '|' + ao;
      else if (id === t.TAPE) key = 't|' + ao;
      else if (id === t.DOCKPLATE) key = 'd|' + ao;
      else if (id === t.CURB) {
        var fs = 0;
        if (!solid(tileAt(tx, ty - 1))) fs |= 1;
        if (!solid(tileAt(tx + 1, ty))) fs |= 2;
        if (!solid(tileAt(tx, ty + 1))) fs |= 4;
        if (!solid(tileAt(tx - 1, ty))) fs |= 8;
        var ws = 0;
        if (wallAt(tx, ty - 1)) ws |= 1;
        if (wallAt(tx + 1, ty)) ws |= 2;
        if (wallAt(tx, ty + 1)) ws |= 4;
        if (wallAt(tx - 1, ty)) ws |= 8;
        key = 'k|' + fs + '|' + ws;
      } else key = 'c|' + ((h * 4) | 0) + '|' + jx + '|' + jy + '|' + ao;
      idx[ty * W + tx] = floorIndexOf(key);
    }
    tex.floorIndex = idx;
  }

  // ===========================================================================
  // CEILING (64 x 64): black deck, bar joists, fluorescent strips, a duct (p3)
  // ===========================================================================
  function makeCeiling() {
    var S = 64, t = newTex(S, S, P.ink), x, y;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      if ((x & 3) === 0) px(t, x, y, P.black);                 // corrugated deck flutes
      else if (hash2(x, y, 700) < 0.04) px(t, x, y, P.charcoal);
    }
    // bar joists (run along u), with zig-zag web lacing below the top chord
    [6, 38].forEach(function (jy) {
      rect(t, 0, jy, S, 1, P.dkgrey);
      rect(t, 0, jy + 1, S, 1, P.charcoal);
      for (x = 0; x < S; x++) {
        var k = x % 8, wy = jy + 2 + (k < 4 ? k : 7 - k);
        px(t, x, wy, P.charcoal);
      }
      rect(t, 0, jy + 6, S, 1, P.charcoal);
    });
    // long fluorescent strip (one per 64 px, short gap so they read as rows of fixtures)
    var ly = 22;
    for (x = 0; x < S; x++) {
      if (bayer(x, ly - 2) < 0.45) px(t, x, ly - 2, P.dkgrey);
      if (bayer(x, ly + 3) < 0.45) px(t, x, ly + 3, P.dkgrey);
    }
    rect(t, 2, ly - 1, S - 4, 1, P.steelDk);
    rect(t, 2, ly, S - 4, 2, P.bright);
    rect(t, 3, ly, S - 6, 1, P.white === P.bright ? P.white : hex('#ffffff'));
    rect(t, 2, ly + 2, S - 4, 1, P.steel);
    px(t, 2, ly - 3, P.grey); px(t, S - 3, ly - 3, P.grey);       // hangers
    // sprinkler main with heads
    rect(t, 0, 53, S, 1, P.charcoal);
    rect(t, 0, 54, S, 1, P.black);
    for (x = 7; x < S; x += 16) px(t, x, 55, P.dkgrey);
    // round duct running along v
    var ramp = [P.black, P.dkgrey, P.grey, P.steelDk, P.grey, P.dkgrey, P.charcoal, P.black];
    for (y = 0; y < S; y++) for (x = 0; x < 8; x++) {
      var c = ramp[x];
      if ((y & 15) === 0) c = x === 0 || x === 7 ? P.black : P.charcoal;      // seams
      px(t, 44 + x, y, c);
    }
    return t;
  }

  // ===========================================================================
  // DECALS: route guide + finish, 2 world px per cell, per run
  // ===========================================================================
  var decalCache = {}, emptyDecal = null;

  function buildDecal(run) {
    var m = M();
    var Wc = m.W * 8, Hc = m.H * 8, d = new Uint32Array(Wc * Hc);
    var body = hex(run.color || '#ffffff'), edgeC = mul(body, 0.42), white = P.white, black = P.ink;
    function put(x, y, c) { if (x >= 0 && y >= 0 && x < Wc && y < Hc) d[y * Wc + x] = c; }
    function stamp(cx, cy, size, c) {
      var x0 = Math.floor(cx - size / 2 + 0.5), y0 = Math.floor(cy - size / 2 + 0.5);
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) put(x0 + x, y0 + y, c);
    }
    var pts = [];
    if (run.grid && run.grid[0]) pts.push({ x: run.grid[0].x / 2, y: run.grid[0].y / 2 });
    (run.waypoints || []).forEach(function (w) { pts.push({ x: w.x / 2, y: w.y / 2 }); });

    var DASH = 14, ON = 8, CH_PER = 56, CH_OFF = 30;
    var dots = [], chev = [];
    var s = 0, nextCh = CH_OFF;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.01) continue;
      var ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      for (var tt = 0; tt < len; tt += 0.5) {
        var ss = s + tt, x = a.x + ux * tt, y = a.y + uy * tt;
        if (ss >= nextCh) { chev.push({ x: x, y: y, ux: ux, uy: uy }); nextCh += CH_PER; }
        var dc = Math.min(Math.abs(ss - (nextCh - CH_PER)), Math.abs(ss - nextCh));
        if (dc < 8) continue;
        if ((ss % DASH) < ON) dots.push(x, y);
      }
      s += len;
    }
    // chevrons: two thick strokes from the arm ends to the tip
    var cdots = [];
    chev.forEach(function (c) {
      var px_ = -c.uy, py_ = c.ux;
      var tipx = c.x + c.ux * 3.5, tipy = c.y + c.uy * 3.5;
      [-1, 1].forEach(function (sd) {
        var ax = c.x - c.ux * 2.5 + px_ * 5 * sd, ay = c.y - c.uy * 2.5 + py_ * 5 * sd;
        var L = Math.hypot(tipx - ax, tipy - ay);
        for (var k = 0; k <= L; k += 0.5) cdots.push(ax + (tipx - ax) * k / L, ay + (tipy - ay) * k / L);
      });
    });
    var k2;
    for (k2 = 0; k2 < dots.length; k2 += 2) stamp(dots[k2], dots[k2 + 1], 4, edgeC);
    for (k2 = 0; k2 < cdots.length; k2 += 2) stamp(cdots[k2], cdots[k2 + 1], 4, edgeC);
    for (k2 = 0; k2 < dots.length; k2 += 2) stamp(dots[k2], dots[k2 + 1], 2, body);
    for (k2 = 0; k2 < cdots.length; k2 += 2) stamp(cdots[k2], cdots[k2 + 1], 2, body);

    // start slots: white painted brackets behind each grid position (open toward the front)
    (run.grid || []).forEach(function (g) {
      var cx = g.x / 2, cy = g.y / 2, ang = g.angle || 0;
      var fx = Math.cos(ang), fy = Math.sin(ang), sx = -fy, sy = fx;
      function line(f0, s0, f1, s1) {
        var L = Math.max(Math.abs(f1 - f0), Math.abs(s1 - s0)) * 2;
        for (var k = 0; k <= L; k++) {
          var f = f0 + (f1 - f0) * k / L, q = s0 + (s1 - s0) * k / L;
          put(Math.floor(cx + fx * f + sx * q), Math.floor(cy + fy * f + sy * q), white);
        }
      }
      line(-8, -6, -8, 6);           // rear bar
      line(-8, -6, -2, -6);          // side ticks
      line(-8, 6, -2, 6);
    });

    // checkered finish line
    var f = run.finish;
    if (f) {
      var x0 = Math.round(f.x / 2), y0 = Math.round(f.y / 2), w = Math.round(f.w / 2), h = Math.round(f.h / 2);
      for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
        put(x0 + xx, y0 + yy, (((xx >> 2) + (yy >> 2)) & 1) ? black : white);
      }
    }
    return { scale: 2, w: Wc, h: Hc, data: d };
  }

  function decal(runKey) {
    if (decalCache[runKey]) return decalCache[runKey];
    var m = M();
    var run = m && m.runs && m.runs[runKey];
    if (!run) {
      if (!emptyDecal) {
        var W = m ? m.W * 8 : 8, H = m ? m.H * 8 : 8;
        emptyDecal = { scale: 2, w: W, h: H, data: new Uint32Array(W * H) };
      }
      return emptyDecal;
    }
    return (decalCache[runKey] = buildDecal(run));
  }

  // ===========================================================================
  // SPRITES (billboards). Texel density 2 per world px unless noted.
  // ===========================================================================
  var spriteCache = {};

  function cylRamp(w, ramp) {
    // per-column colour index for a lit cylinder (light from the left)
    var out = [];
    for (var x = 0; x < w; x++) {
      var u = (x + 0.5) / w * 2 - 1;                 // -1..1
      var l = Math.sqrt(Math.max(0, 1 - u * u)) * 0.75 - u * 0.45;
      var k = Math.round((1 - (l + 0.45) / 1.2) * (ramp.length - 1));
      out.push(ramp[Math.max(0, Math.min(ramp.length - 1, k))]);
    }
    return out;
  }

  function spBollard() {
    var t = newTex(12, 48), x, y;
    var ramp = cylRamp(10, [P.yellowLt, P.yellow, P.yellow, P.yellowDk, mul(P.yellowDk, 0.6)]);
    for (y = 3; y < 45; y++) for (x = 0; x < 10; x++) px(t, x + 1, y, ramp[x]);
    // domed top
    rect(t, 2, 1, 8, 2, P.yellow); rect(t, 3, 0, 6, 1, P.yellowDk);
    px(t, 3, 1, P.yellowLt); px(t, 4, 1, P.yellowLt);
    rect(t, 1, 3, 10, 1, P.yellowDk);
    // a scuffed band where carts hit it
    for (x = 1; x < 11; x++) if (hash2(x, 1, 801) < 0.4) px(t, x, 30 + ((hash2(x, 2, 801) * 4) | 0), P.yellowDk);
    // base plate + anchor bolts
    rect(t, 0, 45, 12, 3, P.dkgrey);
    rect(t, 0, 45, 12, 1, P.grey);
    px(t, 1, 46, P.steel); px(t, 10, 46, P.steel);
    rect(t, 1, 44, 10, 1, P.yellowDk);
    return { tex: t, worldW: 6, worldH: 24, z: 0 };
  }

  function spColumn() {
    // white steel column, floor to ceiling. 16 x 96 (2 texels/px across, 1 down).
    var t = newTex(16, 96), x, y;
    var ramp = cylRamp(10, [P.bright, P.white, P.wallTop, P.wallShade, P.steel, P.steelDk]);
    for (y = 0; y < 96; y++) for (x = 0; x < 10; x++) px(t, x + 3, y, ramp[x]);
    rect(t, 3, 0, 10, 2, P.dkgrey);
    rect(t, 1, 2, 14, 2, P.charcoal);        // cap plate into the ceiling
    rect(t, 1, 92, 14, 1, P.wallTop);        // base plate
    rect(t, 1, 93, 14, 3, P.steelDk);
    rect(t, 0, 95, 16, 1, P.dkgrey);
    // scuffs at bumper height
    for (y = 80; y < 92; y++) for (x = 3; x < 13; x++) if (hash2(x, y, 802) < 0.05) px(t, x, y, P.grey);
    return { tex: t, worldW: 8, worldH: 96, z: 0 };
  }

  function spPalletJack() {
    var t = newTex(36, 52), x, y;
    // forks (two, the far one darker and higher), with load rollers
    rect(t, 10, 42, 25, 3, P.charcoal); rect(t, 10, 42, 25, 1, P.dkgrey);
    rect(t, 6, 46, 29, 3, P.dkgrey); rect(t, 6, 46, 29, 1, P.grey);
    rect(t, 32, 49, 3, 2, P.black); rect(t, 31, 45, 3, 1, P.black);
    // pump body
    rect(t, 3, 32, 10, 15, P.redDk);
    rect(t, 4, 32, 7, 14, P.red);
    rect(t, 5, 33, 2, 12, P.redLt);
    rect(t, 3, 30, 10, 2, P.dkgrey);
    // steer wheels
    ellipse(t, 6, 49, 3, 3, P.black); px(t, 6, 48, P.grey);
    ellipse(t, 11, 49, 2.5, 2.5, P.ink);
    // handle shaft leaning back, with the loop grip at the top
    for (y = 4; y < 31; y++) {
      x = Math.round(8 - (31 - y) * 0.18);
      px(t, x, y, P.black); px(t, x + 1, y, P.dkgrey);
    }
    rect(t, 0, 2, 7, 1, P.black); rect(t, 0, 2, 1, 6, P.black); rect(t, 6, 2, 1, 4, P.black);
    rect(t, 0, 7, 4, 1, P.black);
    rect(t, 1, 3, 5, 1, P.dkgrey);
    outline(t, P.black, true);
    return { tex: t, worldW: 18, worldH: 26, z: 0 };
  }

  function spBins() {
    var t = newTex(52, 60), x, y, i;
    // black plastic pallet
    rect(t, 1, 53, 50, 6, P.ink);
    rect(t, 1, 53, 50, 1, P.charcoal);
    for (x = 4; x < 48; x += 16) rect(t, x + 3, 55, 8, 4, P.black);
    // two stacks of blue bins with rims and ribs (left stack taller)
    function bin(bx, by, w, h, wrapped) {
      var base = wrapped ? mix(P.blue, P.blueLt, 0.45) : P.blue;
      rect(t, bx, by, w, h, base);
      rect(t, bx, by, w, 2, P.blueLt);
      rect(t, bx, by + 2, w, 1, P.blueDk);
      for (var k = bx + 3; k < bx + w - 2; k += 4) rect(t, k, by + 3, 1, h - 4, mix(base, P.blueDk, 0.6));
      rect(t, bx, by + h - 1, w, 1, P.navy);
      rect(t, bx + w - 2, by + 1, 2, h - 1, P.blueDk);
      rect(t, bx + ((w / 2) | 0) - 3, by + 4, 6, 2, P.navy);          // handle slot
      if (wrapped) for (var j = 0; j < 4; j++) px(t, bx + 3 + j * 2, by + 3 + j, P.bright);
    }
    for (i = 0; i < 4; i++) bin(2, 43 - i * 10, 24, 10, false);
    for (i = 0; i < 3; i++) bin(26, 43 - i * 10, 24, 10, i === 2);
    // lid on the right stack
    rect(t, 25, 21, 26, 2, P.blueDk); rect(t, 25, 21, 26, 1, P.blueLt);
    outline(t, P.black);
    return { tex: t, worldW: 26, worldH: 30, z: 0 };
  }

  function spCrates() {
    var t = newTex(48, 56), i, j;
    // wooden pallet
    rect(t, 1, 49, 46, 6, P.brownDk);
    rect(t, 1, 49, 46, 2, P.brown);
    rect(t, 1, 49, 46, 1, P.brownLt);
    for (i = 0; i < 3; i++) rect(t, 5 + i * 16, 52, 8, 3, P.ink);
    // red stacking crates, 2 columns x 4 high
    function crate(x, y, w, h, lbl) {
      rect(t, x, y, w, h, P.red);
      rect(t, x, y, w, 1, P.redLt);
      rect(t, x, y + h - 1, w, 1, P.redDk);
      rect(t, x + w - 1, y, 1, h, P.redDk);
      for (var k = x + 3; k < x + w - 2; k += 3) rect(t, k, y + 3, 1, h - 5, P.redDk);
      rect(t, x + ((w / 2) | 0) - 3, y + 2, 6, 2, P.ink);              // hand hole
      if (lbl) { rect(t, x + 3, y + h - 6, 6, 4, P.white); rect(t, x + 4, y + h - 5, 4, 1, P.grey); }
    }
    for (j = 0; j < 4; j++) {
      crate(2, 38 - j * 11, 22, 11, j === 1);
      crate(24, 38 - j * 11, 22, 11, j === 2);
    }
    // strap
    rect(t, 1, 5, 46, 1, P.wallShade);
    outline(t, P.black);
    return { tex: t, worldW: 24, worldH: 28, z: 0 };
  }

  function spCart() {
    var t = newTex(44, 44), x, y;
    // canvas bag hanging in a steel frame (photo p3)
    for (y = 7; y < 34; y++) for (x = 3; x < 41; x++) {
      var c = P.canvas;
      var sag = Math.sin((x - 3) / 38 * Math.PI);
      if (y > 30 - sag * 2) c = mix(P.canvas, P.brown, 0.35);
      if (x > 36) c = mix(P.canvas, P.brown, 0.3);
      if (x < 6) c = mix(P.canvas, P.white, 0.3);
      if (hash2(x, y, 803) < 0.06) c = mix(P.canvas, P.brown, 0.2);
      px(t, x, y, c);
    }
    rect(t, 3, 6, 38, 2, P.steel);                  // top rail
    rect(t, 3, 6, 38, 1, P.wallTop);
    rect(t, 3, 6, 2, 30, P.steelDk); rect(t, 39, 6, 2, 30, P.steelDk);
    rect(t, 2, 34, 40, 2, P.steelDk);               // chassis
    rect(t, 8, 15, 10, 4, P.white);                 // stencilled tag
    rect(t, 9, 16, 8, 1, P.dkgrey); rect(t, 9, 18, 5, 1, P.dkgrey);
    // casters
    [5, 36].forEach(function (cx) {
      rect(t, cx, 36, 3, 2, P.grey);
      ellipse(t, cx + 1.5, 40, 2.5, 2.5, P.black);
      px(t, cx + 1, 39, P.dkgrey);
    });
    outline(t, P.black);
    return { tex: t, worldW: 22, worldH: 22, z: 0 };
  }

  function spExit() {
    var t = newTex(24, 12);
    rect(t, 0, 0, 24, 12, P.charcoal);
    rect(t, 1, 1, 22, 10, P.red);
    rect(t, 1, 1, 22, 1, P.redLt);
    rect(t, 1, 10, 22, 1, P.redDk);
    var w = text3w('EXIT');
    text3(t, 'EXIT', ((24 - w) / 2) | 0, 4, P.bright);
    rect(t, 2, 3, 1, 1, P.white);
    return { tex: t, worldW: 12, worldH: 6, z: 64 };
  }

  function spPickup(frame) {
    var t = newTex(28, 32);
    var bob = [0, -1, -2, -1][frame & 3];
    var glow = [P.yellow, P.orange, P.bright, P.orange][frame & 3];
    // wooden pallet
    rect(t, 1, 26, 26, 5, P.brownDk);
    rect(t, 1, 26, 26, 2, P.brown);
    rect(t, 1, 26, 26, 1, P.brownLt);
    rect(t, 4, 29, 5, 2, P.ink); rect(t, 19, 29, 5, 2, P.ink);
    // floating "?" box with a glow ring
    var bx = 4, by = 6 + bob;
    rect(t, bx - 2, by - 2, 24, 20, glow);
    rect(t, bx - 1, by - 1, 22, 18, P.black);
    rect(t, bx, by, 20, 16, P.yellow);
    rect(t, bx, by, 20, 1, P.yellowLt);
    rect(t, bx, by, 1, 16, P.yellowLt);
    rect(t, bx, by + 15, 20, 1, P.yellowDk);
    rect(t, bx + 19, by, 1, 16, P.yellowDk);
    // 2x "?" with a drop shadow
    for (var r = 0; r < 7; r++) for (var k = 0; k < 5; k++) {
      if (Q57[r][k] === '1') {
        rect(t, bx + 5 + k * 2, by + 1 + r * 2, 2, 2, P.ink);
      }
    }
    // sparkle orbiting the box
    var sp = [[1, 3], [25, 8], [24, 22], [2, 18]][frame & 3];
    px(t, sp[0], sp[1] + bob, P.bright);
    px(t, sp[0] - 1, sp[1] + bob, P.yellowLt); px(t, sp[0] + 1, sp[1] + bob, P.yellowLt);
    px(t, sp[0], sp[1] + bob - 1, P.yellowLt); px(t, sp[0], sp[1] + bob + 1, P.yellowLt);
    // gap under the floating box is transparent; shadow on the pallet
    rect(t, 6, 25, 16, 1, P.brownDk);
    return { tex: t, worldW: 14, worldH: 16, z: 0 };
  }

  function spWrap() {
    var t = newTex(28, 10), x, y;
    for (y = 0; y < 10; y++) for (x = 0; x < 28; x++) {
      var dx = (x + 0.5 - 14) / 13.5, dy = (y + 0.5 - 10) / 9;
      var rr = dx * dx + dy * dy + (hash2(x >> 1, y >> 1, 804) - 0.5) * 0.35;
      if (rr < 1) {
        var c = ((x + y) & 1) ? P.white : P.wallTop;
        if (hash2(x, y, 805) < 0.25) c = P.steel;
        if (rr > 0.8) c = P.steelDk;
        px(t, x, y, c);
      }
    }
    for (x = 5; x < 12; x++) px(t, x, 4 + ((x * 3) % 2), P.bright);
    for (x = 15; x < 22; x++) px(t, x, 6, P.glassLt);
    px(t, 9, 2, P.bright); px(t, 18, 3, P.bright);
    return { tex: t, worldW: 14, worldH: 5, z: 0 };
  }

  function spPeanuts() {
    var t = newTex(28, 10), i;
    for (i = 0; i < 46; i++) {
      var a = hash2(i, 1, 806), b = hash2(i, 2, 807);
      var x = Math.round(2 + a * 23), hmax = 9 * Math.sin((x + 1) / 28 * Math.PI);
      var y = Math.round(9 - b * hmax);
      var c = (i % 7 === 0) ? P.canvas : (i % 3 === 0 ? P.wallTop : P.white);
      var hz = hash2(i, 3, 808) < 0.5;
      rect(t, x, y - 1, hz ? 3 : 2, hz ? 2 : 3, c);
      px(t, x + (hz ? 2 : 1), y + (hz ? 0 : 1), P.wallShade);
    }
    outline(t, P.steelDk, true);
    return { tex: t, worldW: 14, worldH: 5, z: 0 };
  }

  function spDropBox() {
    // a white box lying on its side, seen 3/4
    var t = newTex(22, 18);
    rect(t, 2, 6, 15, 11, P.white);            // front face
    rect(t, 2, 16, 15, 1, P.wallShade);
    for (var y = 0; y < 5; y++) rect(t, 3 + (4 - y), 1 + y, 15, 1, y === 0 ? P.bright : P.white);  // top (slanted)
    for (var j = 0; j < 4; j++) rect(t, 17 + j, 5 - j, 1, 11, j === 0 ? P.steel : P.wallShade);  // side
    rect(t, 4, 7, 2, 9, P.navy);               // navy side stripe
    rect(t, 9, 10, 4, 1, P.dkgrey);            // hand hole
    rect(t, 3, 4, 13, 1, P.wallTop);           // tape seam on top
    outline(t, P.black, true);
    return { tex: t, worldW: 11, worldH: 9, z: 0 };
  }

  function spEHS(frame) {
    // "CALL EHS!" safety sign with a flashing red beacon on top. 46 x 22.
    var on = (frame & 1) === 0;
    var SW = 46, t = newTex(SW, 22), cx = SW / 2;
    // beacon
    var bc = on ? P.red : P.redDk;
    rect(t, cx - 4, 6, 8, 2, P.dkgrey);
    rect(t, cx - 3, 1, 6, 5, bc);
    rect(t, cx - 2, 0, 4, 1, bc);
    if (on) {
      rect(t, cx - 2, 2, 2, 2, P.redLt); px(t, cx - 2, 1, P.bright);
      px(t, cx - 7, 2, P.redLt); px(t, cx + 6, 2, P.redLt); px(t, cx - 6, 4, P.red); px(t, cx + 5, 4, P.red);
      px(t, cx - 8, 1, P.red); px(t, cx + 7, 1, P.red);
    }
    // sign body
    var y0 = 8;
    rect(t, 0, y0, SW, 14, P.black);
    rect(t, 1, y0 + 1, SW - 2, 12, P.yellow);
    rect(t, 1, y0 + 1, SW - 2, 1, P.yellowLt);
    // hazard stripes at both ends
    for (var y = y0 + 1; y < y0 + 13; y++) for (var x = 1; x < 4; x++) {
      if (((x + y) & 3) < 2) { px(t, x, y, P.black); px(t, SW - 1 - x, y, P.black); }
    }
    var w = text3w('CALL EHS!');
    text3(t, 'CALL EHS!', Math.round((SW - w) / 2), y0 + 4, on ? P.black : P.redDk);
    rect(t, 1, y0 + 12, SW - 2, 1, P.yellowDk);
    return { tex: t, worldW: SW / 2, worldH: 11, z: 20 };
  }

  var SPRITES = {
    bollard: [spBollard], column: [spColumn], palletjack: [spPalletJack], bins: [spBins],
    crates: [spCrates], cart: [spCart], exitsign: [spExit],
    pickup: [0, 1, 2, 3].map(function (f) { return function () { return spPickup(f); }; }),
    drop_wrap: [spWrap], drop_peanuts: [spPeanuts], drop_box: [spDropBox],
    ehs: [0, 1].map(function (f) { return function () { return spEHS(f); }; })
  };

  function sprite(name, frame) {
    var list = SPRITES[name];
    if (!list) return null;
    var n = list.length;
    var f = ((frame | 0) % n + n) % n;
    var key = name + '#' + f;
    return spriteCache[key] || (spriteCache[key] = list[f]());
  }

  // ===========================================================================
  // AGV BILLBOARDS: tiny software rasterizer of the 3D model
  // ===========================================================================
  // Model space: f = forward (nose +f), s = to the AGV's right, z = up (world px).
  // Orthographic camera at ELEV degrees above horizontal. view v (0..15): heading is
  // v*22.5 deg clockwise (seen from above) from the camera's line of sight, so
  // view 0 shows the rear, 4 has the nose to screen right, 8 shows the front.
  var AW = 48, AH = 42, AK = 1.4;                       // texture size, texels per world px
  var ELEV = 30 * Math.PI / 180, SE = Math.sin(ELEV), CE = Math.cos(ELEV);
  var SHADOW_R = 10;                                    // ground shadow radius (world px)
  var AOX = AW / 2, AOY = AH - 0.5 - SHADOW_R * SE * AK; // texture position of the ground origin
  var LX = -0.55, LD = -0.835;                          // horizontal light dir (camera space)
  var agvCache = {};

  function ramp4(top, lit, mid, dark) { return [top, lit, mid, dark]; }
  function emissive(c) { return [mix(c, P.bright, 0.35), mix(c, P.bright, 0.12), c, mul(c, 0.8)]; }

  function renderAGV(color, boxes, view, lightRed) {
    var N = AW * AH;
    var cbuf = new Uint32Array(N), zb = new Float32Array(N), mask = new Uint8Array(N);
    zb.fill(1e9);
    var phi = view * Math.PI / 8, sp = Math.sin(phi), cp = Math.cos(phi);

    function proj(p) {
      var X = p[0] * sp + p[1] * cp, D = p[0] * cp - p[1] * sp, Z = p[2];
      return [AOX + X * AK, AOY - (D * SE + Z * CE) * AK, D * CE - Z * SE];
    }
    function tri(a, b, c, col) {
      var area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) return;
      var x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(AW - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      var y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(AH - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (var y = y0; y <= y1; y++) {
        var py = y + 0.5;
        for (var x = x0; x <= x1; x++) {
          var pxx = x + 0.5;
          var w0 = ((b[0] - pxx) * (c[1] - py) - (b[1] - py) * (c[0] - pxx)) / area;
          var w1 = ((c[0] - pxx) * (a[1] - py) - (c[1] - py) * (a[0] - pxx)) / area;
          var w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          var d = w0 * a[2] + w1 * b[2] + w2 * c[2], i = y * AW + x;
          if (d < zb[i]) { zb[i] = d; cbuf[i] = col; mask[i] = 1; }
        }
      }
    }
    // Draw a planar convex polygon (model-space points) with outward normal n and a 4-step ramp.
    function poly(pts, nf, ns, nz, ramp) {
      var nX = nf * sp + ns * cp, nD = nf * cp - ns * sp;
      if (nD * CE - nz * SE >= -1e-4) return;          // facing away from the camera
      var col;
      if (nz > 0.5) col = ramp[0];
      else {
        var lam = nX * LX + nD * LD;
        col = lam > 0.35 ? ramp[1] : lam > -0.35 ? ramp[2] : ramp[3];
      }
      var q = pts.map(proj);
      for (var k = 1; k < q.length - 1; k++) tri(q[0], q[k], q[k + 1], col);
    }
    // Axis-aligned box. o.sideBands: [[fa, fb, ramp], ...] recolours strips of the +-s faces.
    // o.topBand: [sa, sb, ramp] recolours a strip of the top face.
    function box(f0, f1, s0, s1, z0, z1, ramp, o) {
      o = o || {};
      if (o.topBand) {
        var b = o.topBand;
        poly([[f0, s0, z1], [f1, s0, z1], [f1, b[0], z1], [f0, b[0], z1]], 0, 0, 1, ramp);
        poly([[f0, b[0], z1], [f1, b[0], z1], [f1, b[1], z1], [f0, b[1], z1]], 0, 0, 1, b[2]);
        poly([[f0, b[1], z1], [f1, b[1], z1], [f1, s1, z1], [f0, s1, z1]], 0, 0, 1, ramp);
      } else {
        poly([[f0, s0, z1], [f1, s0, z1], [f1, s1, z1], [f0, s1, z1]], 0, 0, 1, o.top || ramp);
      }
      // o.endBand: [sa, sb, ramp] recolours a vertical strip of the +-f (front/rear) faces.
      var ends = o.endBand ? [[s0, o.endBand[0], o.end || ramp], o.endBand, [o.endBand[1], s1, o.end || ramp]]
                           : [[s0, s1, o.end || ramp]];
      ends.forEach(function (e) {
        poly([[f1, e[0], z0], [f1, e[1], z0], [f1, e[1], z1], [f1, e[0], z1]], 1, 0, 0, e[2]);
        poly([[f0, e[0], z0], [f0, e[1], z0], [f0, e[1], z1], [f0, e[0], z1]], -1, 0, 0, e[2]);
      });
      var cuts = [[f0, f1, ramp]];
      if (o.sideBands) {
        cuts = [];
        var fa = f0;
        o.sideBands.forEach(function (sb) {
          if (sb[0] > fa) cuts.push([fa, sb[0], ramp]);
          cuts.push(sb);
          fa = sb[1];
        });
        if (fa < f1) cuts.push([fa, f1, ramp]);
      }
      cuts.forEach(function (c) {
        poly([[c[0], s1, z0], [c[1], s1, z0], [c[1], s1, z1], [c[0], s1, z1]], 0, 1, 0, c[2]);
        poly([[c[0], s0, z0], [c[1], s0, z0], [c[1], s0, z1], [c[0], s0, z1]], 0, -1, 0, c[2]);
      });
    }
    function cyl(cf, cs, r, z0, z1, ramp, n) {
      n = n || 10;
      var top = [];
      for (var k = 0; k < n; k++) {
        var a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
        var p0 = [cf + Math.cos(a0) * r, cs + Math.sin(a0) * r], p1 = [cf + Math.cos(a1) * r, cs + Math.sin(a1) * r];
        poly([[p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1]],
          Math.cos(am), Math.sin(am), 0, ramp);
        top.push([p0[0], p0[1], z1]);
      }
      poly(top, 0, 0, 1, ramp);
    }

    // --- materials
    var plat = ramp4(P.dkgrey, mix(P.charcoal, P.dkgrey, 0.45), P.charcoal, P.ink);
    var under = ramp4(P.charcoal, P.ink, P.ink, P.black);
    var wheel = ramp4(P.dkgrey, P.ink, P.black, P.black);
    var led = emissive(hex(color || '#e04040'));
    var beacon = emissive(lightRed ? P.red : P.green);
    var boxW = ramp4(P.bright, P.white, P.wallTop, P.wallShade);
    var stripe = ramp4(P.navyLt, P.navyLt, P.navy, P.navyDk);
    var tapeR = ramp4(P.wallShade, P.wallShade, P.steel, P.steel);
    var puckR = ramp4(P.charcoal, P.ink, P.black, P.black);
    var lensR = ramp4(P.dkgrey, P.glassLt, P.glass, P.ink);

    // --- chassis
    box(-10.5, 10.5, -6.2, 6.2, 0.6, 3.2, under);
    [[6, 10], [-10, -6]].forEach(function (fr) {
      box(fr[0], fr[1], 5.4, 7.8, 0, 3.2, wheel);
      box(fr[0], fr[1], -7.8, -5.4, 0, 3.2, wheel);
    });
    box(-12, 12, -8, 8, 3, 7, plat);
    box(-12.15, 12.15, -8.15, 8.15, 3.9, 5.4, led, { top: plat });
    // lidar puck at the front
    cyl(10.2, 0, 1.7, 7, 8.3, puckR, 10);
    cyl(10.2, 0, 1.6, 8.3, 9.3, lensR, 10);
    cyl(10.2, 0, 1.9, 9.3, 10.1, puckR, 10);
    // status beacon at the rear centre
    box(-11.9, -10.7, -1.3, 1.3, 7, 9.8, beacon);

    // --- boxes: rear-left, rear-right, front-left, front-right (lost in reverse order)
    var BX = [[-10.6, -1.6, -7.6, -0.9], [-10.6, -1.6, 0.9, 7.6], [-0.6, 8.4, -7.6, -0.9], [-0.6, 8.4, 0.9, 7.6]];
    var nb = Math.max(0, Math.min(4, boxes | 0));
    for (var i = 0; i < nb; i++) {
      var b = BX[i], sm = (b[2] + b[3]) / 2;
      // navy stripe near the outer edge of each end face, so the stack reads as separate boxes from behind
      var eb = b[2] < 0 ? [b[2] + 1.2, b[2] + 2.8] : [b[3] - 2.8, b[3] - 1.2];
      box(b[0], b[1], b[2], b[3], 7, 16, boxW, {
        sideBands: [[b[1] - 2.8, b[1] - 1.0, stripe]],
        endBand: [eb[0], eb[1], stripe],
        topBand: [sm - 0.45, sm + 0.45, tapeR]
      });
    }

    // --- post: outline the silhouette, then a dithered ground shadow
    var out = newTex(AW, AH), d = out.data, x, y;
    for (i = 0; i < N; i++) if (mask[i]) d[i] = cbuf[i];
    for (y = 0; y < AH; y++) for (x = 0; x < AW; x++) {
      i = y * AW + x;
      if (mask[i]) continue;
      if ((x > 0 && mask[i - 1] === 1) || (x < AW - 1 && mask[i + 1] === 1) || (y > 0 && mask[i - AW] === 1) ||
          (y < AH - 1 && mask[i + AW] === 1)) {
        d[i] = P.black; mask[i] = 2;
      }
    }
    for (y = 0; y < AH; y++) for (x = 0; x < AW; x++) {
      i = y * AW + x;
      if (mask[i] || ((x + y) & 1)) continue;
      var gX = (x + 0.5 - AOX) / AK, gD = (AOY - (y + 0.5)) / (AK * SE);
      if (gX * gX + gD * gD <= SHADOW_R * SHADOW_R) d[i] = P.ink;
    }
    // z < 0 drops the billboard so the model's ground point (AOY), not the texture's bottom edge, sits on the floor
    return { tex: out, worldW: AW / AK, worldH: AH / AK, z: -(AH - AOY) / AK };
  }

  function agv(color, boxes, view, lightRed) {
    if (!inited) init();
    var v = (((view | 0) % 16) + 16) % 16;
    var b = Math.max(0, Math.min(4, boxes | 0));
    var key = (color || '') + '|' + b + '|' + v + '|' + (lightRed ? 1 : 0);
    return agvCache[key] || (agvCache[key] = renderAGV(color, b, v, !!lightRed));
  }

  // ===========================================================================
  // BOX FACES: door leaves and mobile racks
  // ===========================================================================
  var boxCache = {};
  function makeDoorLeaf() {
    // white double-door leaf with a steel kick plate and a narrow vision panel (p6/p9). 16 x 56.
    var t = newTex(16, 56, P.white), x, y;
    for (y = 0; y < 56; y++) for (x = 0; x < 16; x++) if (hash2(x, y, 901) < 0.05) px(t, x, y, P.wallTop);
    rect(t, 0, 0, 16, 1, P.steelDk);
    rect(t, 0, 0, 1, 56, P.wallShade);
    rect(t, 15, 0, 1, 56, P.wallShade);
    // vision panel
    rect(t, 9, 7, 4, 20, P.steelDk);
    rect(t, 10, 8, 2, 18, P.glass);
    px(t, 10, 9, P.glassLt); px(t, 10, 10, P.glassLt); px(t, 11, 15, P.glassLt);
    // push plate + lever
    rect(t, 2, 27, 3, 6, P.steel);
    rect(t, 2, 27, 1, 6, P.wallTop);
    rect(t, 2, 31, 5, 1, P.steelDk);
    // stainless kick plate (bottom ~10 px)
    for (y = 44; y < 56; y++) for (x = 0; x < 16; x++) {
      var c = (x + (y >> 1)) % 7 === 0 ? P.wallShade : ((x * 3 + y) % 11 === 0 ? P.steelDk : P.steel);
      px(t, x, y, c);
    }
    rect(t, 0, 44, 16, 1, P.wallTop);
    rect(t, 0, 55, 16, 1, P.grey);
    return t;
  }
  function makeDoorEdge() {
    var t = newTex(16, 56, P.wallShade);
    rect(t, 0, 0, 16, 56, P.wallShade);
    rect(t, 0, 0, 1, 56, P.wallTop);
    rect(t, 15, 0, 1, 56, P.steel);
    rect(t, 0, 44, 16, 12, P.steelDk);
    return t;
  }
  function boxFace(kind, face) {
    if (!inited) init();
    face = face ? 1 : 0;
    var key = kind + face;
    if (boxCache[key]) return boxCache[key];
    var t;
    if (kind === 'door') t = face ? makeDoorEdge() : makeDoorLeaf();
    else t = face ? makeEndPanel(true, 0) : makeRack(37, true, true);
    return (boxCache[key] = t);
  }

  // ===========================================================================
  // init / export
  // ===========================================================================
  var inited = false;
  var tex = AGV.tex = {
    init: init,
    wall: wall,
    floorIndex: new Uint16Array(0),
    floorTextures: [],
    ceiling: null,
    decal: decal,
    sprite: sprite,
    agv: agv,
    boxFace: boxFace,
    // extras (not in the contract)
    AGV_ELEV: ELEV
  };

  function init() {
    inited = true;
    loadPalette();
    wallCache = {}; wallList = []; wallKeyIdx = {};
    floorCache = {}; decalCache = {}; emptyDecal = null;
    spriteCache = {}; agvCache = {}; boxCache = {};
    tex.ceiling = makeCeiling();
    buildFloors();
    buildWallIndex();
    // warm the small caches
    Object.keys(SPRITES).forEach(function (n) { for (var f = 0; f < SPRITES[n].length; f++) sprite(n, f); });
    boxFace('door', 0); boxFace('door', 1); boxFace('mover', 0); boxFace('mover', 1);
    return tex;
  }
})();
