/* Peabody AGV Rally - gfx.js
 * All pixel art, drawn in code: tiles, props, AGVs, UI, bitmap font, minimap, title screen.
 * Owner: ART agent. See CONTRACT.md for the AGV.gfx interface.
 */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var AGV = G.AGV = G.AGV || {};

  // ---------------------------------------------------------------------------
  // Palette (32 colours, sampled from the reference photos)
  // ---------------------------------------------------------------------------
  var PAL = {
    black: '#0d0f14', ink: '#1c1f27', charcoal: '#2d3139', dkgrey: '#474c56',
    grey: '#6b717b', concreteDk: '#80858d', concrete: '#9298a0', concreteLt: '#a9aeb4',
    steelDk: '#7d8692', steel: '#b6bec7', wallShade: '#c8ccd1', wallTop: '#dde0e3',
    white: '#f4f4f0', yellow: '#f3c22c', yellowDk: '#b5850e', red: '#d83a34',
    redDk: '#8a1f1d', blue: '#2f6fd6', blueDk: '#1d418c', navy: '#1d2a5e',
    teal: '#2a8c83', tealDk: '#1a5753', orange: '#d9722b', orangeDk: '#8c4419',
    brown: '#a67647', brownDk: '#6b4a2b', green: '#3ccf5a', glass: '#22313f',
    glassLt: '#5b7d94', roof: '#383d48', outside: '#14171d', canvas: '#cdbb8f'
  };
  // Descriptive aliases (same colours, not extra palette entries).
  PAL.wall = PAL.white; PAL.scuff = PAL.grey; PAL.vinyl = PAL.wallTop; PAL.vinylDk = PAL.wallShade;
  PAL.rackTeal = PAL.teal; PAL.rackOrange = PAL.orange; PAL.box = PAL.white; PAL.boxStripe = PAL.navy;
  PAL.shadow = 'rgba(8,10,16,0.32)';
  PAL.racerRed = '#e04040'; PAL.racerBlue = '#3a7bff'; PAL.racerPurple = '#c060ff'; PAL.racerGreen = '#3ccf5a';

  var RGB = {};
  function hexRgb(h) {
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }
  Object.keys(PAL).forEach(function (k) { if (PAL[k].charAt(0) === '#') RGB[k] = hexRgb(PAL[k]); });

  var DEF_T = { FLOOR: 0, SCUFF: 1, VINYL: 2, WALL: 3, RACK: 4, ROOM: 5, DOCKDOOR: 6, WINDOW: 7, OUTSIDE: 8,
    TAPE: 9, DOCKPLATE: 10, CURB: 11 };
  var T = DEF_T;
  var TILE = 16;
  var SHADOW = PAL.shadow;
  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    c._x = x;
    return c;
  }
  function R(c, col, x, y, w, h) {
    c.fillStyle = col;
    c.fillRect(x, y, w, h);
  }
  function P(c, col, x, y) { c.fillStyle = col; c.fillRect(x, y, 1, 1); }
  function fl(v) { return Math.floor(v); }
  function rnd(v) { return Math.round(v); }

  function hash2(x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  // Value noise; optional integer period (in lattice cells) makes it tileable.
  function vnoise(x, y, s, per) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    var x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
    if (per) {
      x0 = ((x0 % per) + per) % per; x1 = ((x1 % per) + per) % per;
      y0 = ((y0 % per) + per) % per; y1 = ((y1 % per) + per) % per;
    }
    var a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(function (v) { return v / 16 - 0.47; });

  function disk(c, col, cx, cy, r) {
    c.fillStyle = col;
    for (var dy = -r; dy < r; dy++) {
      var half = Math.round(Math.sqrt(r * r - (dy + 0.5) * (dy + 0.5)));
      if (half > 0) c.fillRect(cx - half, cy + dy, half * 2, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Map access
  // ---------------------------------------------------------------------------
  function map() { return AGV.map; }
  function tileAt(tx, ty) {
    var m = AGV.map;
    if (!m || tx < 0 || ty < 0 || tx >= m.W || ty >= m.H) return T.OUTSIDE;
    return m.tiles[ty * m.W + tx];
  }
  function isTall(id) { return id === T.WALL || id === T.WINDOW || id === T.DOCKDOOR || id === T.ROOM; }
  function isDrive(id) {
    return id === T.FLOOR || id === T.SCUFF || id === T.VINYL || id === T.TAPE || id === T.DOCKPLATE;
  }
  function isWallType(id) { return id === T.WALL || id === T.WINDOW || id === T.DOCKDOOR; }

  // ---------------------------------------------------------------------------
  // Bitmap font: 5x7 glyphs on a 6 px advance, 9 px line height.
  // ---------------------------------------------------------------------------
  var GLYPHS = {
    'A': '01110 10001 10001 11111 10001 10001 10001', 'B': '11110 10001 10001 11110 10001 10001 11110',
    'C': '01110 10001 10000 10000 10000 10001 01110', 'D': '11110 10001 10001 10001 10001 10001 11110',
    'E': '11111 10000 10000 11110 10000 10000 11111', 'F': '11111 10000 10000 11110 10000 10000 10000',
    'G': '01110 10001 10000 10111 10001 10001 01111', 'H': '10001 10001 10001 11111 10001 10001 10001',
    'I': '01110 00100 00100 00100 00100 00100 01110', 'J': '00111 00010 00010 00010 00010 10010 01100',
    'K': '10001 10010 10100 11000 10100 10010 10001', 'L': '10000 10000 10000 10000 10000 10000 11111',
    'M': '10001 11011 10101 10101 10001 10001 10001', 'N': '10001 10001 11001 10101 10011 10001 10001',
    'O': '01110 10001 10001 10001 10001 10001 01110', 'P': '11110 10001 10001 11110 10000 10000 10000',
    'Q': '01110 10001 10001 10001 10101 10010 01101', 'R': '11110 10001 10001 11110 10100 10010 10001',
    'S': '01111 10000 10000 01110 00001 00001 11110', 'T': '11111 00100 00100 00100 00100 00100 00100',
    'U': '10001 10001 10001 10001 10001 10001 01110', 'V': '10001 10001 10001 10001 10001 01010 00100',
    'W': '10001 10001 10001 10101 10101 10101 01010', 'X': '10001 10001 01010 00100 01010 10001 10001',
    'Y': '10001 10001 01010 00100 00100 00100 00100', 'Z': '11111 00001 00010 00100 01000 10000 11111',
    '0': '01110 10001 10011 10101 11001 10001 01110', '1': '00100 01100 00100 00100 00100 00100 01110',
    '2': '01110 10001 00001 00010 00100 01000 11111', '3': '11111 00010 00100 00010 00001 10001 01110',
    '4': '00010 00110 01010 10010 11111 00010 00010', '5': '11111 10000 11110 00001 00001 10001 01110',
    '6': '00110 01000 10000 11110 10001 10001 01110', '7': '11111 00001 00010 00100 01000 01000 01000',
    '8': '01110 10001 10001 01110 10001 10001 01110', '9': '01110 10001 10001 01111 00001 00010 01100',
    '.': '00000 00000 00000 00000 00000 01100 01100', ':': '00000 01100 01100 00000 01100 01100 00000',
    '-': '00000 00000 00000 01110 00000 00000 00000', '!': '00100 00100 00100 00100 00100 00000 00100',
    '?': '01110 10001 00001 00010 00100 00000 00100', '/': '00001 00001 00010 00100 01000 10000 10000',
    "'": '00100 00100 01000 00000 00000 00000 00000', '+': '00000 00100 00100 11111 00100 00100 00000',
    '×': '00000 00000 10001 01010 00100 01010 10001', ',': '00000 00000 00000 00000 01100 00100 01000',
    '(': '00010 00100 01000 01000 01000 00100 00010', ')': '01000 00100 00010 00010 00010 00100 01000',
    '#': '01010 01010 11111 01010 11111 01010 01010', '%': '11000 11001 00010 00100 01000 10011 00011',
    '<': '00010 00100 01000 10000 01000 00100 00010', '>': '01000 00100 00010 00001 00010 00100 01000',
    '=': '00000 00000 11111 00000 11111 00000 00000', '*': '00000 00100 10101 01110 10101 00100 00000',
    '"': '01010 01010 01010 00000 00000 00000 00000', '_': '00000 00000 00000 00000 00000 00000 11111',
    ';': '00000 01100 01100 00000 01100 00100 01000', '&': '01100 10010 10100 01000 10101 10010 01101',
    '@': '01110 10001 10111 10101 10111 10000 01110', '^': '00100 01110 10101 00100 00100 00100 00100',
    '[': '01110 01000 01000 01000 01000 01000 01110', ']': '01110 00010 00010 00010 00010 00010 01110',
    '$': '00100 01111 10100 01110 00101 11110 00100'
  };
  var GKEYS = Object.keys(GLYPHS);
  var GIDX = {};
  GKEYS.forEach(function (k, i) { GIDX[k] = i; });
  var ADV = 6, GW = 5, GH = 7, LINE_H = 9;
  var fontBase = null, fontTint = {};

  function fontAtlas(color) {
    if (!fontBase) {
      fontBase = mk(GKEYS.length * ADV, GH);
      var x = fontBase._x;
      x.fillStyle = '#fff';
      GKEYS.forEach(function (k, i) {
        var rows = GLYPHS[k].split(' ');
        for (var r = 0; r < GH; r++) {
          for (var col = 0; col < GW; col++) if (rows[r].charAt(col) === '1') x.fillRect(i * ADV + col, r, 1, 1);
        }
      });
    }
    var a = fontTint[color];
    if (!a) {
      a = mk(fontBase.width, GH);
      a._x.drawImage(fontBase, 0, 0);
      a._x.globalCompositeOperation = 'source-in';
      a._x.fillStyle = color;
      a._x.fillRect(0, 0, a.width, a.height);
      fontTint[color] = a;
    }
    return a;
  }
  function isDigit(ch) { return ch >= '0' && ch <= '9'; }
  function glyphIndex(line, i) {
    var ch = line.charAt(i);
    if (ch === 'x' && (isDigit(line.charAt(i - 1)) || isDigit(line.charAt(i + 1)))) ch = '×';
    else ch = ch.toUpperCase();
    var g = GIDX[ch];
    return g === undefined ? -1 : g;
  }
  function lineWidth(line, scale) { return line.length ? (line.length * ADV - 1) * scale : 0; }
  function textWidth(str, scale) {
    scale = Math.max(1, Math.round(scale || 1));
    var lines = String(str).split('\n'), w = 0;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, lineWidth(lines[i], scale));
    return w;
  }
  function text(ctx, str, x, y, color, scale, align) {
    if (str === undefined || str === null) return;
    scale = Math.max(1, Math.round(scale || 1));
    var atlas = fontAtlas(color || PAL.white);
    var lines = String(str).split('\n');
    var prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li], w = lineWidth(line, scale);
      var sx = align === 'center' ? x - fl(w / 2) : align === 'right' ? x - w : x;
      sx = fl(sx);
      var sy = fl(y) + li * LINE_H * scale;
      for (var i = 0; i < line.length; i++) {
        var g = glyphIndex(line, i);
        if (g < 0) continue;
        ctx.drawImage(atlas, g * ADV, 0, GW, GH, sx + i * ADV * scale, sy, GW * scale, GH * scale);
      }
    }
    ctx.imageSmoothingEnabled = prev;
  }
  // Text with a 1 px dark drop shadow (used internally).
  function textS(ctx, str, x, y, color, scale, align, shade) {
    var s = Math.max(1, Math.round(scale || 1));
    text(ctx, str, x + s, y + s, shade || PAL.black, s, align);
    text(ctx, str, x, y, color, s, align);
  }

  // ---------------------------------------------------------------------------
  // Pre-rendered textures
  // ---------------------------------------------------------------------------
  var CONC_N = 512, concIdx = null; // tileable concrete, palette indices 0..4
  var CONC_COLS = ['concreteDk', 'concrete', 'concreteLt', 'grey', 'steel'];
  function buildConcrete() {
    concIdx = new Uint8Array(CONC_N * CONC_N);
    for (var y = 0; y < CONC_N; y++) {
      for (var x = 0; x < CONC_N; x++) {
        var n = vnoise(x / 32, y / 32, 1, CONC_N / 32) * 0.62 + vnoise(x / 8, y / 8, 2, CONC_N / 8) * 0.38;
        var v = n + BAYER[(y & 3) * 4 + (x & 3)] * 0.12;
        var k = v < 0.21 ? 0 : v > 0.8 ? 2 : 1;
        var h = hash2(x, y, 3);
        if (h < 0.006) k = 3; else if (h > 0.997) k = 2;
        concIdx[y * CONC_N + x] = k;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tile sprites (walls, curbs, racks) - cached by neighbour mask
  // ---------------------------------------------------------------------------
  var spriteCache = {};
  // mask bits: tall neighbour N1 E2 S4 W8, face 16, drive E32 W64, same-type N128 E256 S512 W1024
  function wallMask(tx, ty, id) {
    var n = tileAt(tx, ty - 1), e = tileAt(tx + 1, ty), s = tileAt(tx, ty + 1), w = tileAt(tx - 1, ty);
    var m = 0;
    if (isTall(n)) m |= 1;
    if (isTall(e)) m |= 2;
    if (isTall(s)) m |= 4;
    if (isTall(w)) m |= 8;
    if (!isTall(s) && s !== T.OUTSIDE) m |= 16;
    if (isDrive(e)) m |= 32;
    if (isDrive(w)) m |= 64;
    if (n === id) m |= 128;
    if (e === id) m |= 256;
    if (s === id) m |= 512;
    if (w === id) m |= 1024;
    return m;
  }

  function wallSprite(id, m) {
    var key = 'w' + id + '_' + m;
    if (spriteCache[key]) return spriteCache[key];
    var c = mk(16, 16), x = c._x;
    var n = m & 1, e = m & 2, s = m & 4, w = m & 8, face = m & 16;
    var capH = face ? 7 : 16;
    R(x, PAL.wallShade, 0, 0, 16, capH);
    if (!n) { R(x, PAL.dkgrey, 0, 0, 16, 1); R(x, PAL.wallTop, 0, 1, 16, 1); }
    if (!w) R(x, PAL.dkgrey, 0, 0, 1, capH);
    if (!e) R(x, PAL.dkgrey, 15, 0, 1, capH);
    if (!face && !s) R(x, PAL.dkgrey, 0, 15, 16, 1);
    // Curb on the floor-facing side of a vertical wall.
    if (!face) {
      if (m & 32) { R(x, PAL.black, 14, 0, 1, 16); R(x, PAL.yellow, 15, 0, 1, 16); }
      if (m & 64) { R(x, PAL.black, 1, 0, 1, 16); R(x, PAL.yellowDk, 0, 0, 1, 16); }
    }
    if (face) {
      R(x, PAL.grey, 0, 6, 16, 1);
      R(x, PAL.white, 0, 7, 16, 6);
      R(x, PAL.wallTop, 0, 11, 16, 1);
      R(x, PAL.black, 0, 13, 16, 1);
      R(x, PAL.yellow, 0, 14, 16, 1);
      R(x, PAL.yellowDk, 0, 15, 16, 1);
      if (!w) R(x, PAL.wallShade, 0, 7, 1, 6);
      if (!e) R(x, PAL.wallShade, 15, 7, 1, 6);
    }
    var vert = !(e || w);
    if (id === T.WINDOW) {
      if (face) {
        R(x, PAL.wallShade, 1, 7, 14, 5);
        R(x, PAL.glass, 2, 8, 12, 3);
        P(x, PAL.glassLt, 4, 8); P(x, PAL.glassLt, 3, 9); P(x, PAL.glassLt, 10, 8); P(x, PAL.glassLt, 9, 9);
        R(x, PAL.white, 1, 11, 14, 1);
      } else if (vert) {
        R(x, PAL.wallTop, 5, 1, 6, 14);
        R(x, PAL.glass, 6, 1, 4, 14);
        P(x, PAL.glassLt, 7, 3); P(x, PAL.glassLt, 8, 4); P(x, PAL.glassLt, 7, 10);
        if (!(m & 128)) R(x, PAL.dkgrey, 5, 1, 6, 1);
        if (!(m & 512)) R(x, PAL.dkgrey, 5, 14, 6, 1);
      } else {
        R(x, PAL.wallTop, 1, 5, 14, 6);
        R(x, PAL.glass, 1, 6, 14, 4);
        P(x, PAL.glassLt, 3, 7); P(x, PAL.glassLt, 4, 6); P(x, PAL.glassLt, 10, 7);
      }
    } else if (id === T.DOCKDOOR) {
      if (face) {
        R(x, PAL.white, 0, 7, 16, 9);
        for (var ry = 8; ry < 15; ry += 2) R(x, PAL.wallShade, 0, ry, 16, 1);
        R(x, PAL.glass, 3, 9, 3, 2); R(x, PAL.glass, 10, 9, 3, 2);
        P(x, PAL.glassLt, 3, 9); P(x, PAL.glassLt, 10, 9);
        R(x, PAL.ink, 0, 15, 16, 1);
        if (!(m & 1024)) R(x, PAL.steelDk, 0, 6, 1, 10);
        if (!(m & 256)) R(x, PAL.steelDk, 15, 6, 1, 10);
      } else if (vert || !face) {
        // Roll-up door in a N-S wall, seen from above: ribbed slab with track rails.
        var floorE = m & 32, floorW = m & 64;
        R(x, PAL.white, 2, 0, 12, 16);
        for (var rx = 3; rx < 14; rx += 2) R(x, PAL.wallShade, rx, 0, 1, 16);
        R(x, PAL.steelDk, 1, 0, 1, 16); R(x, PAL.steelDk, 14, 0, 1, 16);
        if (!(m & 128)) { R(x, PAL.dkgrey, 0, 0, 16, 2); R(x, PAL.red, floorW ? 1 : 13, 2, 2, 2); }
        if (!(m & 512)) R(x, PAL.dkgrey, 0, 14, 16, 2);
        R(x, PAL.glass, 6, 6, 4, 2); P(x, PAL.glassLt, 6, 6);
        if (floorE) { R(x, PAL.black, 15, 0, 1, 16); }
        if (floorW) { R(x, PAL.black, 0, 0, 1, 16); }
      }
    }
    spriteCache[key] = c;
    return c;
  }

  function roomFaceSprite(m) {
    var key = 'rf' + m;
    if (spriteCache[key]) return spriteCache[key];
    var c = mk(16, 16), x = c._x;
    R(x, PAL.grey, 0, 6, 16, 1);
    R(x, PAL.white, 0, 7, 16, 6);
    R(x, PAL.wallTop, 0, 11, 16, 1);
    R(x, PAL.black, 0, 13, 16, 1);
    R(x, PAL.yellow, 0, 14, 16, 1);
    R(x, PAL.yellowDk, 0, 15, 16, 1);
    if (!(m & 8)) R(x, PAL.wallShade, 0, 7, 1, 6);
    if (!(m & 2)) R(x, PAL.wallShade, 15, 7, 1, 6);
    spriteCache[key] = c;
    return c;
  }

  function curbSprite(m) {
    var key = 'c' + m;
    if (spriteCache[key]) return spriteCache[key];
    var c = mk(16, 16), x = c._x;
    // Low wall foot (white) with a narrow yellow kick-curb on each side that faces open floor.
    var openE = m & 32, openW = m & 64;
    var openN = !(m & 1) && !(m & 128), openS = (m & 16) && !(m & 512);
    R(x, PAL.wallTop, 0, 0, 16, 16);
    R(x, PAL.wallShade, 0, 0, 16, 1);
    if (openW) { R(x, PAL.yellow, 0, 0, 5, 16); R(x, PAL.yellowDk, 4, 0, 1, 16); R(x, PAL.black, 0, 0, 1, 16); }
    if (openE) { R(x, PAL.yellow, 11, 0, 5, 16); R(x, PAL.yellowDk, 11, 0, 1, 16); R(x, PAL.black, 15, 0, 1, 16); }
    if (openN) { R(x, PAL.yellow, 0, 0, 16, 5); R(x, PAL.yellowDk, 0, 4, 16, 1); }
    if (openS) { R(x, PAL.yellow, 0, 11, 16, 5); R(x, PAL.yellowDk, 0, 11, 16, 1); R(x, PAL.black, 0, 15, 16, 1); }
    spriteCache[key] = c;
    return c;
  }

  // Rack (pallet racking from above). mask: same-type N1 E2 S4 W8. variant 0..15, parity 0/1.
  function rackSprite(m, variant, parity) {
    var key = 'r' + m + '_' + variant + '_' + parity;
    if (spriteCache[key]) return spriteCache[key];
    var c = mk(16, 16), x = c._x;
    var n = m & 1, e = m & 2, s = m & 4, w = m & 8;
    var vertical = (n || s) || !(e || w);
    // Transposing rect helper: draw in "vertical row" space (beams on left/right).
    function r(col, a, b, cw, ch) { if (vertical) R(x, col, a, b, cw, ch); else R(x, col, b, a, ch, cw); }
    var sideA = vertical ? w : n, sideB = vertical ? e : s; // across-row neighbours
    // wire deck
    r(PAL.charcoal, 0, 0, 16, 16);
    for (var i = 1; i < 16; i += 3) { r(PAL.dkgrey, i, 0, 1, 16); r(PAL.dkgrey, 0, i, 16, 1); }
    // cartons on the top shelf
    var v = variant;
    if (v % 4 !== 0) {
      var bw = 6 + (v % 3) * 2, bh = 5 + ((v >> 2) % 3);
      var bx = 3 + (v * 7) % Math.max(1, 12 - bw), by = 2 + (v * 5) % Math.max(1, 13 - bh);
      var white = v === 7 || v === 13;
      r(PAL.ink, bx + 1, by + 1, bw, bh);
      r(white ? PAL.white : PAL.brown, bx, by, bw, bh);
      r(white ? PAL.wallShade : PAL.brownDk, bx + bw - 1, by, 1, bh);
      r(white ? PAL.wallShade : PAL.brownDk, bx, by + bh - 1, bw, 1);
      if (white) r(PAL.navy, bx, by + 1, 1, 2);
      else r(PAL.canvas, bx + fl(bw / 2) - 1, by, 1, bh - 1);
      if (v > 9 && bw <= 8) {
        var b2y = by + bh + 1;
        if (b2y + 4 < 15) {
          r(PAL.ink, bx + 2, b2y + 1, 5, 4);
          r(PAL.brown, bx + 1, b2y, 5, 4);
          r(PAL.brownDk, bx + 1, b2y + 3, 5, 1);
        }
      }
    }
    // beams on the aisle sides, flue line on shared sides
    if (!sideA) { r(PAL.orange, 0, 0, 2, 16); r(PAL.orangeDk, 2, 0, 1, 16); } else r(PAL.ink, 0, 0, 1, 16);
    if (!sideB) { r(PAL.orange, 14, 0, 2, 16); r(PAL.orangeDk, 13, 0, 1, 16); }
    // bay division (upright frame) every second tile
    var endA = vertical ? !n : !w, endB = vertical ? !s : !e;
    if (parity === 0 || endA) {
      r(PAL.tealDk, 0, 0, 16, 1);
      if (!sideA) { r(PAL.teal, 0, 0, 3, 3); r(PAL.tealDk, 2, 2, 1, 1); }
      if (!sideB) { r(PAL.teal, 13, 0, 3, 3); r(PAL.tealDk, 13, 2, 1, 1); }
    }
    if (endB) {
      r(PAL.tealDk, 0, 15, 16, 1);
      if (!sideA) r(PAL.teal, 0, 13, 3, 3);
      if (!sideB) r(PAL.teal, 13, 13, 3, 3);
    }
    if (endA) r(PAL.orange, 3, 0, 10, 1);
    if (endB) r(PAL.orange, 3, 15, 10, 1);
    spriteCache[key] = c;
    return c;
  }

  // Floor shadow overlays (cast by tall neighbours to the west / north)
  var shadowW = null, shadowN = null;
  function buildShadows() {
    shadowW = mk(16, 16); shadowN = mk(16, 16);
    var a = shadowW._x, b = shadowN._x;
    R(a, SHADOW, 0, 0, 2, 16);
    R(b, SHADOW, 0, 0, 16, 2);
    for (var i = 0; i < 16; i += 2) { R(a, SHADOW, 2, i, 1, 1); R(b, SHADOW, i, 2, 1, 1); }
  }

  // ---------------------------------------------------------------------------
  // World chunks
  // ---------------------------------------------------------------------------
  var CS = 256, CT = CS / 16;
  var chunks = {}, prewarm = [];
  function chunkKey(i, j) { return i + ',' + j; }

  function getChunk(i, j) {
    var k = chunkKey(i, j);
    var c = chunks[k];
    if (!c) { c = buildChunk(i, j); chunks[k] = c; }
    return c;
  }

  function buildChunk(ci, cj) {
    var c = mk(CS, CS), x = c._x;
    var ox = ci * CS, oy = cj * CS;
    var img = x.createImageData(CS, CS), d = img.data;
    var conc = RGB.concrete;
    var ccols = CONC_COLS.map(function (k) { return RGB[k]; });
    var tx0 = ci * CT, ty0 = cj * CT;
    for (var ty = 0; ty < CT; ty++) {
      for (var tx = 0; tx < CT; tx++) {
        var gtx = tx0 + tx, gty = ty0 + ty;
        var id = tileAt(gtx, gty);
        var roomRim = 0, plateRim = 0;
        if (id === T.ROOM) {
          if (tileAt(gtx, gty - 1) !== T.ROOM) roomRim |= 1;
          if (tileAt(gtx + 1, gty) !== T.ROOM) roomRim |= 2;
          if (tileAt(gtx, gty + 1) !== T.ROOM) roomRim |= 4;
          if (tileAt(gtx - 1, gty) !== T.ROOM) roomRim |= 8;
        } else if (id === T.DOCKPLATE) {
          if (tileAt(gtx, gty - 1) !== id) plateRim |= 1;
          if (tileAt(gtx + 1, gty) !== id) plateRim |= 2;
          if (tileAt(gtx, gty + 1) !== id) plateRim |= 4;
          if (tileAt(gtx - 1, gty) !== id) plateRim |= 8;
        }
        var scuffSeed = hash2(gtx, gty, 9) * 1000;
        for (var py = 0; py < 16; py++) {
          var wy = gty * 16 + py;
          var row = ((ty * 16 + py) * CS + tx * 16) * 4;
          for (var px = 0; px < 16; px++) {
            var wx = gtx * 16 + px;
            var col = conc, h;
            if (id === T.FLOOR || id === T.SCUFF) {
              col = ccols[concIdx[(wy & (CONC_N - 1)) * CONC_N + (wx & (CONC_N - 1))]];
              if (id === T.SCUFF) {
                var ddx = (px - 7.5) / 8, ddy = (py - 7.5) / 8;
                var st = vnoise(wx / 5, wy / 5, 7) * 0.9 + vnoise(wx / 13 + scuffSeed, wy / 13, 8) * 0.5 -
                  Math.sqrt(ddx * ddx + ddy * ddy) * 0.55 + BAYER[(wy & 3) * 4 + (wx & 3)] * 0.18;
                if (st > 0.62) col = RGB.dkgrey; else if (st > 0.44) col = RGB.grey;
                else if (st > 0.36) col = RGB.concreteDk;
              } else if ((wx % 160) === 0 || (wy % 160) === 0) {
                col = RGB.concreteDk;
              }
            } else if (id === T.VINYL) {
              h = hash2(wx, wy, 11);
              col = h < 0.09 ? RGB.wallShade : h < 0.105 ? RGB.steel : h < 0.11 ? RGB.grey : RGB.wallTop;
              if ((wy % 96) === 0) col = RGB.wallShade;
            } else if (id === T.TAPE) {
              var on = ((wx + wy) & 7) < 4;
              h = hash2(wx, wy, 12);
              col = on ? (h < 0.05 ? RGB.yellowDk : RGB.yellow) : (h < 0.05 ? RGB.charcoal : RGB.ink);
            } else if (id === T.DOCKPLATE) {
              var cx = wx & 3, cy = wy & 3, par = ((wx >> 2) + (wy >> 2)) & 1;
              col = RGB.steelDk;
              if (par === 0) {
                if (cx + cy === 3 && cx > 0 && cx < 3) col = RGB.steel;
                else if (cx + cy === 4 && cx > 1) col = RGB.grey;
              } else {
                if (cx === cy && cx > 0 && cx < 3) col = RGB.steel;
                else if (cx === cy + 1 && cx > 1) col = RGB.grey;
              }
              if (((plateRim & 1) && py === 0) || ((plateRim & 4) && py === 15) ||
                ((plateRim & 8) && px === 0) || ((plateRim & 2) && px === 15)) col = RGB.dkgrey;
              else if (((plateRim & 1) && py === 1) || ((plateRim & 8) && px === 1)) col = RGB.steel;
            } else if (id === T.OUTSIDE) {
              h = hash2(wx, wy, 13);
              col = h < 0.05 ? RGB.ink : h > 0.985 ? RGB.charcoal : RGB.outside;
            } else if (id === T.ROOM) {
              h = hash2(wx, wy, 14);
              col = RGB.roof;
              if ((wx & 15) === 0 || (wy & 15) === 0) col = RGB.charcoal;
              else if (h < 0.04) col = RGB.charcoal;
              if (((roomRim & 1) && py === 0) || ((roomRim & 8) && px === 0)) col = RGB.dkgrey;
              else if (((roomRim & 4) && py === 15) || ((roomRim & 2) && px === 15)) col = RGB.ink;
            } else {
              col = RGB.ink;
            }
            var o = row + px * 4;
            d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
          }
        }
      }
    }
    x.putImageData(img, 0, 0);

    // Sprites and shadows
    for (ty = 0; ty < CT; ty++) {
      for (tx = 0; tx < CT; tx++) {
        gtx = tx0 + tx; gty = ty0 + ty;
        id = tileAt(gtx, gty);
        var dx = tx * 16, dy = ty * 16;
        if (isWallType(id)) {
          x.drawImage(wallSprite(id, wallMask(gtx, gty, id)), dx, dy);
        } else if (id === T.CURB) {
          x.drawImage(curbSprite(wallMask(gtx, gty, id)), dx, dy);
        } else if (id === T.RACK) {
          var rm = 0;
          if (tileAt(gtx, gty - 1) === T.RACK) rm |= 1;
          if (tileAt(gtx + 1, gty) === T.RACK) rm |= 2;
          if (tileAt(gtx, gty + 1) === T.RACK) rm |= 4;
          if (tileAt(gtx - 1, gty) === T.RACK) rm |= 8;
          var vert = (rm & 5) || !(rm & 10);
          var parity = (vert ? gty : gtx) & 1;
          x.drawImage(rackSprite(rm, fl(hash2(gtx, gty, 21) * 16), parity), dx, dy);
        } else if (id === T.ROOM) {
          var sb = tileAt(gtx, gty + 1);
          if (!isTall(sb) && sb !== T.OUTSIDE) {
            var fm = (isTall(tileAt(gtx + 1, gty)) ? 2 : 0) | (isTall(tileAt(gtx - 1, gty)) ? 8 : 0);
            x.drawImage(roomFaceSprite(fm), dx, dy);
          }
        } else if (isDrive(id)) {
          var wn = tileAt(gtx - 1, gty), nn = tileAt(gtx, gty - 1);
          if (isTall(wn) || wn === T.RACK) x.drawImage(shadowW, dx, dy);
          if (nn === T.RACK || (isTall(nn) && nn !== T.ROOM)) x.drawImage(shadowN, dx, dy);
          else if (nn === T.ROOM) x.drawImage(shadowN, dx, dy);
        }
      }
    }

    // Room name plates and static props
    var m = map();
    x.save();
    x.translate(-ox, -oy);
    if (m && m.props) {
      for (var pi = 0; pi < m.props.length; pi++) {
        var p = m.props[pi];
        var pw = (p.w || 16) / 2 + 8, ph = (p.h || 16) / 2 + 8;
        if (p.x + pw < ox || p.x - pw > ox + CS || p.y + ph < oy || p.y - ph > oy + CS) continue;
        drawProp(x, p);
      }
    }
    if (m && m.rooms) {
      for (var ri = 0; ri < m.rooms.length; ri++) {
        var rm2 = m.rooms[ri];
        var rx = rm2.x * TILE, ry = rm2.y * TILE, rw = rm2.w * TILE, rh = rm2.h * TILE;
        if (rx + rw < ox || rx > ox + CS || ry + rh < oy || ry > oy + CS) continue;
        drawRoomPlate(x, rm2);
      }
    }
    x.restore();
    return c;
  }

  function wrapWords(str, maxW) {
    var words = String(str).toUpperCase().split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var tryL = cur ? cur + ' ' + words[i] : words[i];
      if (textWidth(tryL) <= maxW) cur = tryL;
      else {
        if (!cur) return null;
        lines.push(cur);
        cur = words[i];
        if (textWidth(cur) > maxW) return null;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function drawRoomPlate(c, room) {
    var px = room.x * TILE, py = room.y * TILE, pw = room.w * TILE, ph = room.h * TILE;
    var num = room.num ? String(room.num) : '';
    var lines = wrapWords(room.name || '', pw - 12) || [];
    var contentH = function () { return (lines.length + (num ? 1 : 0)) * 9 - 2; };
    while (lines.length && contentH() + 10 > ph) lines = lines.length > 1 ? [] : [];
    if (!lines.length && !num) return;
    if (!lines.length && (textWidth(num) + 8 > pw || 17 > ph)) return;
    var tw = 0;
    lines.forEach(function (l) { tw = Math.max(tw, textWidth(l)); });
    if (num) tw = Math.max(tw, textWidth(num));
    var bw = tw + 8, bh = contentH() + 8;
    var bx = fl(px + (pw - bw) / 2), by = fl(py + (ph - bh) / 2);
    R(c, PAL.black, bx + 1, by + 2, bw, bh);
    R(c, PAL.steel, bx, by, bw, bh);
    R(c, PAL.navy, bx + 1, by + 1, bw - 2, bh - 2);
    R(c, PAL.blueDk, bx + 1, by + 1, bw - 2, 1);
    var cy = by + 4;
    for (var i = 0; i < lines.length; i++) { text(c, lines[i], bx + fl(bw / 2), cy, PAL.white, 1, 'center'); cy += 9; }
    if (num) text(c, num, bx + fl(bw / 2), cy, PAL.yellow, 1, 'center');
  }

  // ---------------------------------------------------------------------------
  // Props (drawn in world coordinates)
  // ---------------------------------------------------------------------------
  function drawProp(c, p) {
    var f = PROPS[p.type] || PROPS._unknown;
    f(c, p);
  }
  function box(p, dw, dh) {
    var w = rnd(p.w || dw), h = rnd(p.h || dh);
    return { x: rnd(p.x - w / 2), y: rnd(p.y - h / 2), w: w, h: h };
  }
  var PROPS = {
    bollard: function (c, p) {
      var cx = rnd(p.x), cy = rnd(p.y);
      disk(c, SHADOW, cx + 1, cy + 2, 4);
      disk(c, PAL.ink, cx, cy, 4);
      disk(c, PAL.yellow, cx, cy, 3);
      R(c, PAL.yellowDk, cx + 1, cy + 1, 2, 1); R(c, PAL.yellowDk, cx + 2, cy - 1, 1, 2);
      R(c, PAL.yellowDk, cx - 1, cy + 2, 2, 1);
      P(c, PAL.white, cx - 2, cy - 2); P(c, PAL.white, cx - 1, cy - 2);
    },
    column: function (c, p) {
      var b = box(p, 10, 10);
      R(c, SHADOW, b.x + 2, b.y + 3, b.w + 1, b.h);
      R(c, PAL.dkgrey, b.x, b.y, b.w, b.h);
      R(c, PAL.white, b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      R(c, PAL.wallShade, b.x + b.w - 3, b.y + 1, 2, b.h - 2);
      R(c, PAL.wallShade, b.x + 1, b.y + b.h - 2, b.w - 2, 1);
      R(c, PAL.wallTop, b.x + 1, b.y + 1, 1, b.h - 3);
    },
    palletjack: function (c, p) {
      var b = box(p, 10, 22);
      var horiz = b.w > b.h;
      var L = horiz ? b.w : b.h, W = horiz ? b.h : b.w;
      function r(col, a, bb, aw, bh) { // a = along length (0 = handle end), bb = across
        if (horiz) R(c, col, b.x + a, b.y + bb, aw, bh); else R(c, col, b.x + bb, b.y + a, bh, aw);
      }
      var bodyL = Math.max(5, fl(L * 0.3)), fw = Math.max(2, fl((W - 2) / 3));
      r(SHADOW, 2, 2, L, W);
      r(PAL.dkgrey, bodyL, 0, L - bodyL, fw);
      r(PAL.dkgrey, bodyL, W - fw, L - bodyL, fw);
      r(PAL.steel, bodyL, 0, L - bodyL - 1, 1);
      r(PAL.steel, bodyL, W - fw, L - bodyL - 1, 1);
      r(PAL.ink, 1, 0, bodyL, W);
      r(PAL.charcoal, 2, 1, bodyL - 2, W - 2);
      r(PAL.red, 3, fl(W / 2) - 1, 2, 2);
      r(PAL.ink, 0, fl(W / 2) - 2, 1, 4);
      r(PAL.black, 0, fl(W / 2) - 2, 3, 1);
    },
    bins: function (c, p) {
      var b = box(p, 24, 18);
      R(c, SHADOW, b.x + 2, b.y + 3, b.w, b.h);
      var cw = b.w >= 20 ? fl(b.w / Math.round(b.w / 12)) : b.w, ch = b.h >= 16 ? fl(b.h / Math.round(b.h / 9)) : b.h;
      for (var y = b.y; y + ch <= b.y + b.h + 1; y += ch) {
        for (var x = b.x; x + cw <= b.x + b.w + 1; x += cw) {
          R(c, PAL.blueDk, x, y, cw, ch);
          R(c, PAL.blue, x + 1, y + 1, cw - 2, ch - 2);
          R(c, PAL.blueDk, x + 2, y + 2, cw - 4, ch - 4);
          R(c, PAL.navy, x + 3, y + 3, cw - 6, ch - 5);
          R(c, '#5d93e6', x + 1, y + 1, cw - 2, 1);
        }
      }
    },
    crates: function (c, p) {
      var b = box(p, 20, 18);
      R(c, SHADOW, b.x + 2, b.y + 3, b.w, b.h);
      var cw = b.w >= 18 ? fl(b.w / Math.round(b.w / 10)) : b.w, ch = b.h >= 16 ? fl(b.h / Math.round(b.h / 9)) : b.h;
      for (var y = b.y; y + ch <= b.y + b.h + 1; y += ch) {
        for (var x = b.x; x + cw <= b.x + b.w + 1; x += cw) {
          R(c, PAL.redDk, x, y, cw, ch);
          R(c, PAL.red, x + 1, y + 1, cw - 2, ch - 2);
          for (var sx = x + 3; sx < x + cw - 2; sx += 3) R(c, PAL.redDk, sx, y + 2, 1, ch - 4);
          R(c, '#ee6a5e', x + 1, y + 1, cw - 2, 1);
        }
      }
    },
    cart: function (c, p) {
      var b = box(p, 14, 20);
      R(c, SHADOW, b.x + 2, b.y + 3, b.w, b.h);
      R(c, PAL.ink, b.x - 1, b.y + 1, 1, 2); R(c, PAL.ink, b.x + b.w, b.y + 1, 1, 2);
      R(c, PAL.ink, b.x - 1, b.y + b.h - 3, 1, 2); R(c, PAL.ink, b.x + b.w, b.y + b.h - 3, 1, 2);
      R(c, PAL.dkgrey, b.x, b.y, b.w, b.h);
      R(c, PAL.canvas, b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      R(c, PAL.brown, b.x + 3, b.y + 3, b.w - 6, b.h - 6);
      for (var i = 0; i < 6; i++) {
        P(c, PAL.brownDk, b.x + 3 + fl(hash2(i, b.x, 31) * (b.w - 6)), b.y + 3 + fl(hash2(b.y, i, 32) * (b.h - 6)));
      }
      R(c, PAL.white, b.x + 1, b.y + 1, b.w - 2, 1);
    },
    extinguisher: function (c, p) {
      var cx = rnd(p.x), cy = rnd(p.y);
      R(c, PAL.white, cx - 3, cy - 6, 6, 3);
      R(c, PAL.red, cx - 2, cy - 5, 4, 1);
      R(c, PAL.redDk, cx - 2, cy - 2, 4, 7);
      R(c, PAL.red, cx - 2, cy - 2, 3, 6);
      R(c, PAL.ink, cx - 1, cy - 3, 2, 1);
      R(c, PAL.ink, cx + 2, cy - 2, 1, 4);
      P(c, PAL.white, cx - 1, cy - 1);
    },
    stairs: function (c, p) {
      var b = box(p, 32, 48);
      var horiz = b.w > b.h;
      R(c, SHADOW, b.x + 2, b.y + 2, b.w, b.h);
      R(c, PAL.dkgrey, b.x, b.y, b.w, b.h);
      if (horiz) {
        for (var x = b.x + 1; x < b.x + b.w - 1; x += 4) {
          R(c, PAL.white, x, b.y + 2, 3, b.h - 4);
          R(c, PAL.wallShade, x + 3, b.y + 2, 1, b.h - 4);
        }
        R(c, PAL.white, b.x, b.y, b.w, 2); R(c, PAL.white, b.x, b.y + b.h - 2, b.w, 2);
        R(c, PAL.steel, b.x, b.y + 1, b.w, 1); R(c, PAL.steel, b.x, b.y + b.h - 2, b.w, 1);
      } else {
        for (var y = b.y + 1; y < b.y + b.h - 1; y += 4) {
          R(c, PAL.white, b.x + 2, y, b.w - 4, 3);
          R(c, PAL.wallShade, b.x + 2, y + 3, b.w - 4, 1);
        }
        R(c, PAL.white, b.x, b.y, 2, b.h); R(c, PAL.white, b.x + b.w - 2, b.y, 2, b.h);
        R(c, PAL.steel, b.x + 1, b.y, 1, b.h); R(c, PAL.steel, b.x + b.w - 2, b.y, 1, b.h);
      }
    },
    panel: function (c, p) {
      var b = box(p, 6, 8);
      R(c, SHADOW, b.x + 1, b.y + 1, b.w, b.h);
      R(c, PAL.black, b.x, b.y, b.w, b.h);
      R(c, PAL.charcoal, b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      R(c, PAL.glassLt, b.x + 1, b.y + 1, b.w - 2, Math.max(1, fl(b.h / 3)));
      P(c, PAL.teal, b.x + 1, b.y + 1);
    },
    exitsign: function (c, p) {
      var cx = rnd(p.x), cy = rnd(p.y);
      if ((p.h || 0) > (p.w || 0)) {
        // sign mounted on a N-S wall, seen edge-on from above: red bar with lit face
        R(c, PAL.black, cx - 3, cy - 8, 7, 17);
        R(c, PAL.red, cx - 2, cy - 7, 5, 15);
        R(c, PAL.white, cx, cy - 5, 1, 11);
        P(c, PAL.white, cx - 1, cy - 5); P(c, PAL.white, cx + 1, cy - 5);
        P(c, PAL.white, cx - 1, cy + 5); P(c, PAL.white, cx + 1, cy + 5);
        return;
      }
      var x = cx - 8, y = cy - 4;
      R(c, PAL.black, x, y, 17, 9);
      R(c, PAL.red, x + 1, y + 1, 15, 7);
      // micro "EXIT"
      var W = PAL.white, X = x + 2, Y = y + 2;
      R(c, W, X, Y, 1, 5); R(c, W, X + 1, Y, 2, 1); R(c, W, X + 1, Y + 2, 1, 1); R(c, W, X + 1, Y + 4, 2, 1);
      X += 4;
      P(c, W, X, Y); P(c, W, X + 2, Y); P(c, W, X, Y + 1); P(c, W, X + 2, Y + 1); P(c, W, X + 1, Y + 2);
      P(c, W, X, Y + 3); P(c, W, X + 2, Y + 3); P(c, W, X, Y + 4); P(c, W, X + 2, Y + 4);
      X += 4;
      R(c, W, X, Y, 1, 5);
      X += 2;
      R(c, W, X, Y, 3, 1); R(c, W, X + 1, Y + 1, 1, 4);
    },
    cornerguard: function (c, p) {
      var b = box(p, 4, 4);
      R(c, PAL.dkgrey, b.x, b.y, b.w, b.h);
      R(c, PAL.steel, b.x, b.y, b.w - 1, b.h - 1);
      R(c, PAL.white, b.x, b.y, 1, b.h - 1);
      R(c, PAL.steelDk, b.x + b.w - 2, b.y + 1, 1, b.h - 2);
    },
    _unknown: function (c, p) {
      var b = box(p, 12, 12);
      R(c, SHADOW, b.x + 2, b.y + 2, b.w, b.h);
      R(c, PAL.dkgrey, b.x, b.y, b.w, b.h);
      R(c, PAL.grey, b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    }
  };

  // ---------------------------------------------------------------------------
  // AGV sprites: source drawn facing east in a 36x36 cell, then rotated with
  // nearest-neighbour sampling into 32 cached frames.
  // ---------------------------------------------------------------------------
  var AS = 36, AC = 18, NROT = 32;
  var platCache = {}, boxCache = {};
  var BOX_CELLS = [[8, 12, -1], [8, 18, 1], [17, 12, -1], [17, 18, 1]]; // rear-left, rear-right, front-left, front-right

  function agvBaseSource(color, light) {
    var c = mk(AS, AS), x = c._x;
    // wheels
    R(x, PAL.black, 8, 8, 5, 2); R(x, PAL.black, 23, 8, 5, 2);
    R(x, PAL.black, 8, 26, 5, 2); R(x, PAL.black, 23, 26, 5, 2);
    // body
    R(x, PAL.black, 6, 11, 24, 14); R(x, PAL.black, 7, 10, 22, 16);
    R(x, PAL.charcoal, 7, 11, 22, 14);
    // deck (visible when no boxes)
    R(x, PAL.dkgrey, 9, 13, 15, 10);
    R(x, PAL.charcoal, 10, 14, 13, 8);
    for (var i = 11; i < 23; i += 3) R(x, PAL.dkgrey, i, 15, 1, 6);
    // LED strip in racer colour (sides + rear) and front fascia
    R(x, color, 8, 11, 18, 1); R(x, color, 8, 24, 18, 1);
    R(x, color, 7, 12, 1, 12);
    R(x, color, 26, 11, 3, 14);
    // headlights
    R(x, PAL.white, 28, 12, 1, 2); R(x, PAL.white, 28, 22, 1, 2);
    // lidar puck at the front
    R(x, PAL.black, 24, 16, 4, 4); R(x, PAL.black, 25, 15, 2, 6); R(x, PAL.black, 23, 17, 6, 2);
    R(x, PAL.dkgrey, 25, 16, 2, 4); R(x, PAL.dkgrey, 24, 17, 4, 2);
    P(x, PAL.steel, 25, 17);
    // status light (rear centre)
    var lc = light === 'g' ? PAL.green : light === 'r' ? PAL.red : PAL.redDk;
    R(x, PAL.black, 6, 16, 2, 4);
    R(x, lc, 7, 17, 1, 2);
    return c;
  }

  function agvBoxSource(n) {
    var c = mk(AS, AS), x = c._x;
    for (var i = 0; i < n && i < 4; i++) {
      var bx = BOX_CELLS[i][0], by = BOX_CELLS[i][1], side = BOX_CELLS[i][2];
      R(x, PAL.white, bx, by, 8, 6);
      R(x, PAL.wallShade, bx, by + 5, 8, 1);
      R(x, PAL.wallShade, bx + 7, by, 1, 6);
      P(x, PAL.steelDk, bx + 7, by + 5);
      R(x, PAL.wallTop, bx + 1, by + 3 - (side < 0 ? 1 : 0), 6, 1);
      // navy side stripe on the outer edge + tiny pale label
      R(x, PAL.navy, bx + 5, side < 0 ? by : by + 5, 2, 1);
      R(x, PAL.canvas, bx + 2, side < 0 ? by + 3 : by + 1, 2, 1);
    }
    return c;
  }

  function rotateInto(src, angle, shadow) {
    var sx = src._x.getImageData(0, 0, AS, AS).data;
    var out = mk(AS, AS);
    var img = out._x.createImageData(AS, AS), d = img.data;
    var cs = Math.cos(angle), sn = Math.sin(angle);
    var x, y, o, vx, vy, u, v;
    for (y = 0; y < AS; y++) {
      for (x = 0; x < AS; x++) {
        vx = x + 0.5 - AC; vy = y + 0.5 - AC;
        u = Math.floor(vx * cs + vy * sn + AC + 1e-6);
        v = Math.floor(-vx * sn + vy * cs + AC + 1e-6);
        if (u < 0 || v < 0 || u >= AS || v >= AS) continue;
        var si = (v * AS + u) * 4;
        if (sx[si + 3] < 128) continue;
        o = (y * AS + x) * 4;
        d[o] = sx[si]; d[o + 1] = sx[si + 1]; d[o + 2] = sx[si + 2]; d[o + 3] = 255;
      }
    }
    // shadow pass: ground shadow (+1,+2) for the platform, 1 px (+1,+1) for boxes
    var offX = 1, offY = shadow === 'ground' ? 2 : 1, alpha = shadow === 'ground' ? 95 : 120;
    var copy = new Uint8ClampedArray(d);
    for (y = 0; y < AS; y++) {
      for (x = 0; x < AS; x++) {
        o = (y * AS + x) * 4;
        if (copy[o + 3]) continue;
        var px = x - offX, py = y - offY;
        if (px < 0 || py < 0) continue;
        var so = (py * AS + px) * 4;
        var hit = copy[so + 3] > 0;
        if (!hit && shadow === 'ground' && py + 1 < AS) hit = copy[so + AS * 4 + 3] > 0;
        if (hit) { d[o] = 8; d[o + 1] = 10; d[o + 2] = 16; d[o + 3] = alpha; }
      }
    }
    out._x.putImageData(img, 0, 0);
    return out;
  }

  function rotIndex(angle) {
    var i = Math.round(angle / (TAU / NROT)) % NROT;
    return i < 0 ? i + NROT : i;
  }
  function platFrame(color, light, idx) {
    var key = color + '|' + light;
    var e = platCache[key];
    if (!e) e = platCache[key] = { src: agvBaseSource(color, light), frames: [] };
    if (!e.frames[idx]) e.frames[idx] = rotateInto(e.src, idx * TAU / NROT, 'ground');
    return e.frames[idx];
  }
  function boxFrame(n, idx) {
    var e = boxCache[n];
    if (!e) e = boxCache[n] = { src: agvBoxSource(n), frames: [] };
    if (!e.frames[idx]) e.frames[idx] = rotateInto(e.src, idx * TAU / NROT, 'box');
    return e.frames[idx];
  }

  function drawBoost(ctx, bx, by, a, t) {
    var bxv = -Math.cos(a), byv = -Math.sin(a), pxv = -byv, pyv = bxv;
    var cols = [PAL.white, PAL.white, PAL.yellow, PAL.yellow, PAL.orange, PAL.orange, PAL.red, PAL.redDk];
    var lanes = [-5, 0, 5];
    for (var k = 0; k < 3; k++) {
      var off = lanes[k];
      var len = 4 + ((fl(t * 30) + k * 3) % 5);
      var start = 13 + (k === 1 ? 1 : 0);
      for (var s = 0; s < len; s++) {
        var d = start + s;
        R(ctx, cols[Math.min(cols.length - 1, s)], rnd(bx + bxv * d + pxv * off), rnd(by + byv * d + pyv * off), 1, 1);
      }
    }
    var f = fl(t * 24);
    for (var i = 0; i < 4; i++) {
      var h1 = hash2(f, i, 41), h2 = hash2(i, f, 42);
      var dd = 15 + h1 * 10, sp = (h2 - 0.5) * 14;
      R(ctx, i & 1 ? PAL.yellow : PAL.orange, rnd(bx + bxv * dd + pxv * sp), rnd(by + byv * dd + pyv * sp), 1, 1);
    }
  }

  function drawAGV(ctx, x, y, angle, o) {
    o = o || {};
    var t = o.t || 0;
    var color = o.color || PAL.racerRed;
    var boxes = o.boxes === undefined || o.boxes === null ? 4 : Math.max(0, Math.min(4, Math.round(o.boxes)));
    var a = angle || 0;
    var idx = rotIndex(a);
    var light = o.estop ? (fl(t * 8) % 2 ? 'r' : 'o') : 'g';
    var bx = rnd(x), by = rnd(y);
    if (o.boost) drawBoost(ctx, bx, by, a, t);
    ctx.drawImage(platFrame(color, light, idx), bx - AC, by - AC);
    if (boxes > 0) {
      var wob = Math.max(-1, Math.min(1, o.wobble || 0)) * 2;
      var qa = idx * TAU / NROT;
      ctx.drawImage(boxFrame(boxes, idx), bx - AC + rnd(-Math.sin(qa) * wob), by - AC + rnd(Math.cos(qa) * wob));
    }
    if (o.estop && fl(t * 8) % 2) {
      var e = 14, L = 4;
      var corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (var k = 0; k < 4; k++) {
        var cx = bx + corners[k][0] * e, cy = by + corners[k][1] * e;
        R(ctx, PAL.red, corners[k][0] < 0 ? cx : cx - L + 1, cy, L, 1);
        R(ctx, PAL.red, cx, corners[k][1] < 0 ? cy : cy - L + 1, 1, L);
      }
    }
    if (o.tag) {
      var ty = by - 27;
      textS(ctx, o.tag, bx, ty, color, 1, 'center');
      R(ctx, PAL.black, bx - 2, ty + 9, 5, 1);
      R(ctx, color, bx - 1, ty + 8, 3, 1); P(ctx, color, bx, ty + 9);
    }
  }

  // ---------------------------------------------------------------------------
  // Item icons, drops and pickups (pre-rendered on first use)
  // ---------------------------------------------------------------------------
  var iconCache = {}, dropCache = {};

  function buildIcon(item) {
    var c = mk(16, 16), x = c._x;
    var i;
    if (item === 'boost') {
      // lightning bolt
      var rows = [
        '.......#####....', '......#yyyy#....', '.....#yyyy#.....', '....#yyyy#......',
        '...#yyyyy####...', '..#yyyyyyyyy#...', '..#####yyyyy#...', '.....#yyyy#.....',
        '....#yyyy#......', '....#yyy#.......', '...#yyy#........', '...#yy#.........',
        '..#yy#..........', '..#y#...........', '..##............', '................'];
      for (var r = 0; r < 16; r++) {
        for (var col = 0; col < 16; col++) {
          var ch = rows[r].charAt(col);
          if (ch === '#') P(x, PAL.black, col, r);
          else if (ch === 'y') P(x, (col + r) < 12 ? PAL.white : r > 7 ? PAL.orange : PAL.yellow, col, r);
        }
      }
    } else if (item === 'wrap') {
      // shrink-wrap roll on its side
      R(x, PAL.black, 2, 3, 12, 10);
      R(x, PAL.wallTop, 3, 4, 10, 8);
      R(x, PAL.white, 3, 4, 10, 2);
      R(x, PAL.steel, 3, 10, 10, 2);
      for (i = 5; i < 13; i += 3) R(x, PAL.glassLt, i, 6, 1, 4);
      R(x, PAL.black, 1, 5, 2, 6); R(x, PAL.brownDk, 1, 6, 1, 4); P(x, PAL.brown, 1, 7);
      R(x, PAL.black, 13, 5, 2, 6); R(x, PAL.brown, 14, 6, 1, 4);
      // trailing film
      R(x, PAL.wallTop, 6, 12, 7, 2); R(x, PAL.steel, 7, 14, 6, 1); P(x, PAL.white, 8, 12);
    } else if (item === 'peanuts') {
      var nuts = [[3, 9], [7, 7], [10, 10], [5, 12], [9, 4], [12, 6], [2, 5], [6, 3]];
      for (i = 0; i < nuts.length; i++) {
        var nx = nuts[i][0], ny = nuts[i][1];
        R(x, PAL.black, nx - 1, ny - 1, 5, 4);
        R(x, PAL.white, nx, ny, 3, 2);
        P(x, PAL.canvas, nx + (i & 1 ? 2 : 0), ny + 1);
        P(x, PAL.wallShade, nx + 1, ny + 1);
      }
    } else if (item === 'box') {
      R(x, PAL.black, 1, 3, 14, 12);
      R(x, PAL.wallTop, 2, 4, 12, 4);
      R(x, PAL.white, 2, 8, 9, 6);
      R(x, PAL.wallShade, 11, 8, 3, 6);
      R(x, PAL.navy, 9, 8, 2, 6);
      R(x, PAL.wallShade, 2, 6, 12, 1);
      R(x, PAL.canvas, 4, 10, 3, 2);
      R(x, PAL.grey, 2, 8, 12, 1);
    } else if (item === 'ping') {
      disk(x, PAL.black, 8, 8, 8);
      disk(x, PAL.tealDk, 8, 8, 7);
      x.fillStyle = PAL.green;
      for (var rr = 3; rr <= 6; rr += 3) {
        for (var aa = 0; aa < 64; aa++) {
          var an = aa / 64 * TAU;
          x.fillRect(rnd(8 + Math.cos(an) * rr - 0.5), rnd(8 + Math.sin(an) * rr - 0.5), 1, 1);
        }
      }
      R(x, PAL.black, 6, 6, 4, 4); R(x, PAL.dkgrey, 7, 7, 2, 2); P(x, PAL.white, 7, 7);
      R(x, PAL.white, 11, 3, 2, 2);
    } else {
      R(x, PAL.dkgrey, 2, 2, 12, 12);
      text(x, '?', 5, 4, PAL.white);
    }
    return c;
  }

  function itemIcon(ctx, item, x, y) {
    if (!item) return;
    var c = iconCache[item] || (iconCache[item] = buildIcon(item));
    ctx.drawImage(c, rnd(x), rnd(y));
  }

  function buildDrop(kind) {
    var c = mk(20, 20), x = c._x;
    var i;
    if (kind === 'wrap') {
      // translucent shrink-wrap patch: dithered pale blob with creases
      for (var y = 0; y < 20; y++) {
        for (var xx = 0; xx < 20; xx++) {
          var dx = (xx - 9.5) / 8.5, dy = (y - 10) / 6.5;
          var r = dx * dx + dy * dy + (vnoise(xx / 3, y / 3, 51) - 0.5) * 0.7;
          if (r < 1) {
            if (r > 0.75) { if ((xx + y) & 1) P(x, PAL.steel, xx, y); }
            else if ((xx + y) & 1) P(x, PAL.white, xx, y);
            else if (hash2(xx, y, 52) < 0.35) P(x, PAL.wallTop, xx, y);
          }
        }
      }
      R(x, PAL.white, 5, 8, 6, 1); R(x, PAL.white, 9, 11, 5, 1); R(x, PAL.glassLt, 7, 13, 4, 1);
      P(x, PAL.glassLt, 12, 7);
    } else if (kind === 'peanuts') {
      for (i = 0; i < 16; i++) {
        var a = hash2(i, 1, 61) * TAU, d = Math.sqrt(hash2(i, 2, 62)) * 8;
        var px = rnd(10 + Math.cos(a) * d), py = rnd(10 + Math.sin(a) * d * 0.8);
        var horiz = hash2(i, 3, 63) < 0.5;
        R(x, SHADOW, px + 1, py + 1, horiz ? 3 : 2, horiz ? 2 : 3);
        R(x, i % 5 === 0 ? PAL.canvas : PAL.white, px, py, horiz ? 3 : 2, horiz ? 2 : 3);
        P(x, PAL.wallShade, px + (horiz ? 1 : 0), py + (horiz ? 0 : 1));
      }
    } else if (kind === 'box') {
      R(x, SHADOW, 6, 7, 12, 10);
      R(x, PAL.dkgrey, 4, 5, 12, 10);
      R(x, PAL.white, 5, 6, 10, 8);
      R(x, PAL.wallShade, 14, 6, 1, 8);
      R(x, PAL.wallShade, 5, 13, 10, 1);
      R(x, PAL.wallTop, 5, 9, 9, 1);
      R(x, PAL.navy, 5, 6, 1, 4);
      R(x, PAL.canvas, 10, 11, 3, 2);
    }
    return c;
  }

  function drawDrop(ctx, kind, x, y, t) {
    var c = dropCache[kind] || (dropCache[kind] = buildDrop(kind));
    var bx = rnd(x) - 10, by = rnd(y) - 10;
    ctx.drawImage(c, bx, by);
    if (kind === 'wrap') {
      var f = fl((t || 0) * 3) % 6;
      var sp = [[4, 9], [8, 6], [13, 8], [15, 12], [10, 14], [6, 12]][f];
      P(ctx, PAL.white, bx + sp[0], by + sp[1] - 1); P(ctx, PAL.white, bx + sp[0], by + sp[1] + 1);
      P(ctx, PAL.white, bx + sp[0] - 1, by + sp[1]); P(ctx, PAL.white, bx + sp[0] + 1, by + sp[1]);
    }
  }

  var pickupBase = null;
  function drawPickup(ctx, x, y, t) {
    t = t || 0;
    if (!pickupBase) {
      pickupBase = mk(18, 18);
      var px = pickupBase._x;
      // wooden pallet: three boards over stringers
      R(px, PAL.black, 1, 2, 16, 14);
      R(px, PAL.brownDk, 2, 3, 14, 12);
      for (var b = 0; b < 3; b++) { R(px, PAL.brown, 2, 3 + b * 5, 14, 3); R(px, PAL.canvas, 2, 3 + b * 5, 14, 1); }
    }
    var bx = rnd(x), by = rnd(y);
    var bob = Math.sin(t * 5) > 0.3 ? -1 : 0;
    R(ctx, SHADOW, bx - 7, by - 5, 17, 14);
    ctx.drawImage(pickupBase, bx - 9, by - 9);
    var cyc = [PAL.yellow, PAL.orange, PAL.white, PAL.orange];
    var gc = cyc[fl(t * 8) % 4];
    // glow ring
    R(ctx, gc, bx - 7, by - 9 + bob, 14, 1); R(ctx, gc, bx - 7, by + 4 + bob, 14, 1);
    R(ctx, gc, bx - 8, by - 8 + bob, 1, 12); R(ctx, gc, bx + 7, by - 8 + bob, 1, 12);
    // box with "?"
    R(ctx, PAL.black, bx - 7, by - 8 + bob, 14, 12);
    R(ctx, PAL.yellow, bx - 6, by - 7 + bob, 12, 10);
    R(ctx, PAL.yellowDk, bx - 6, by + 2 + bob, 12, 1);
    R(ctx, PAL.white, bx - 6, by - 7 + bob, 12, 1);
    text(ctx, '?', bx - 2, by - 6 + bob, PAL.black);
    // orbiting sparkle
    var a = t * 4;
    P(ctx, PAL.white, rnd(bx + Math.cos(a) * 11), rnd(by - 2 + Math.sin(a) * 9));
    P(ctx, gc, rnd(bx + Math.cos(a + Math.PI) * 11), rnd(by - 2 + Math.sin(a + Math.PI) * 9));
  }

  // ---------------------------------------------------------------------------
  // Guide line and finish
  // ---------------------------------------------------------------------------
  function drawGuide(ctx, run, camX, camY, t) {
    if (!run || !run.waypoints || !run.waypoints.length) return;
    var pts = [];
    if (run.grid && run.grid.length) {
      var gx = 0, gy = 0;
      run.grid.forEach(function (g) { gx += g.x; gy += g.y; });
      pts.push({ x: gx / run.grid.length, y: gy / run.grid.length });
    }
    run.waypoints.forEach(function (w) { pts.push(w); });
    var cx = rnd(camX), cy = rnd(camY);
    var minX = cx - 8, maxX = cx + 330, minY = cy - 8, maxY = cy + 196;
    var dist = 0, phase = (t || 0) * 24;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = run.color || PAL.yellow;
    for (var i = 0; i + 1 < pts.length; i++) {
      var a = pts[i], b = pts[i + 1];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      var visible = !(Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX ||
        Math.max(a.y, b.y) < minY || Math.min(a.y, b.y) > maxY);
      if (visible) {
        var ux = dx / len, uy = dy / len;
        for (var s = 0; s < len; s += 1) {
          var dd = dist + s;
          var m = ((dd - phase) % 12 + 12) % 12;
          if (m < 3) ctx.fillRect(rnd(a.x + ux * s - cx) - 1, rnd(a.y + uy * s - cy) - 1, 2, 2);
        }
        // chevrons every 64 px of path
        var first = Math.ceil((dist + 20) / 64) * 64 - dist;
        for (var c = first; c < len - 8; c += 64) {
          var tipx = a.x + ux * c - cx, tipy = a.y + uy * c - cy;
          for (var k = 1; k <= 5; k++) {
            var bxv = -ux * k, byv = -uy * k;
            ctx.fillRect(rnd(tipx + bxv - uy * k), rnd(tipy + byv + ux * k), 2, 2);
            ctx.fillRect(rnd(tipx + bxv + uy * k), rnd(tipy + byv - ux * k), 2, 2);
          }
        }
      }
      dist += len;
    }
    ctx.restore();
  }

  function drawFinish(ctx, run, camX, camY, t) {
    if (!run || !run.finish) return;
    var f = run.finish;
    var x = rnd(f.x - camX), y = rnd(f.y - camY), w = rnd(f.w), h = rnd(f.h);
    if (x > 2000 || y > 2000 || x + w < -2000 || y + h < -2000) return;
    R(ctx, PAL.black, x - 1, y - 1, w + 2, h + 2);
    var sq = 4;
    ctx.fillStyle = PAL.white;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PAL.black;
    for (var yy = 0; yy < h; yy += sq) {
      for (var xx = 0; xx < w; xx += sq) {
        if (((xx / sq) + (yy / sq)) & 1) ctx.fillRect(x + xx, y + yy, Math.min(sq, w - xx), Math.min(sq, h - yy));
      }
    }
    // posts at both ends of the long axis, with blinking lamps
    var on = fl((t || 0) * 3) % 2;
    var posts = w >= h ? [[x - 4, y + fl(h / 2) - 3], [x + w, y + fl(h / 2) - 3]] :
      [[x + fl(w / 2) - 2, y - 4], [x + fl(w / 2) - 2, y + h]];
    for (var i = 0; i < 2; i++) {
      R(ctx, PAL.black, posts[i][0], posts[i][1], 5, 6);
      R(ctx, PAL.yellow, posts[i][0] + 1, posts[i][1] + 1, 3, 4);
      P(ctx, on ? PAL.green : PAL.white, posts[i][0] + 2, posts[i][1] + 2);
    }
  }

  // ---------------------------------------------------------------------------
  // Doors and mobile racks
  // ---------------------------------------------------------------------------
  function fallbackLeaves(door, f) {
    var L = door.len * TILE, gap = 2 * TILE, maxL = Math.max(0, (L - gap) / 2), l = (1 - f) * maxL;
    var x0 = door.x * TILE, y0 = door.y * TILE;
    if (door.axis === 'v') {
      return [{ x: x0 + 5, y: y0, w: 6, h: l }, { x: x0 + 5, y: y0 + L - l, w: 6, h: l }];
    }
    return [{ x: x0, y: y0 + 5, w: l, h: 6 }, { x: x0 + L - l, y: y0 + 5, w: l, h: 6 }];
  }

  function drawLeaf(ctx, x, y, w, h, horiz, fromStart) {
    if (w <= 0 || h <= 0) return;
    R(ctx, SHADOW, x + 1, y + 2, w, h);
    R(ctx, PAL.dkgrey, x, y, w, h);
    if (w < 3 || h < 3) { R(ctx, PAL.white, x, y, w, h); return; }
    if (Math.min(w, h) < 8) {
      // thin leaf seen from above: white top, steel kick-plate edge, dark seal at the leading edge
      if (horiz) {
        R(ctx, PAL.white, x, y, w, h - 1);
        R(ctx, PAL.steel, x, y + h - 2, w, 1);
        R(ctx, PAL.black, x, y + h - 1, w, 1);
        R(ctx, PAL.black, fromStart ? x + w - 1 : x, y, 1, h);
        if (w > 12) R(ctx, PAL.glass, fromStart ? x + w - 9 : x + 5, y + 1, 4, 1);
      } else {
        R(ctx, PAL.white, x, y, w - 1, h);
        R(ctx, PAL.steel, x + w - 2, y, 1, h);
        R(ctx, PAL.black, x + w - 1, y, 1, h);
        R(ctx, PAL.black, x, fromStart ? y + h - 1 : y, w, 1);
        if (h > 12) R(ctx, PAL.glass, x + 1, fromStart ? y + h - 9 : y + 5, 1, 4);
      }
      return;
    }
    if (horiz) {
      var cap = h >= 10 ? 3 : 1;
      R(ctx, PAL.wallShade, x + 1, y + 1, w - 2, cap);
      R(ctx, PAL.white, x + 1, y + 1 + cap, w - 2, h - 2 - cap);
      var kp = Math.max(1, fl(h / 4));
      R(ctx, PAL.steel, x + 1, y + h - 1 - kp, w - 2, kp);
      R(ctx, PAL.steelDk, x + 1, y + h - 1 - kp, w - 2, 1);
      if (h >= 10 && w >= 10) {
        var gx = fromStart ? x + 3 : x + w - 7;
        R(ctx, PAL.glass, gx, y + cap + 2, 4, Math.max(2, h - cap - kp - 5));
        P(ctx, PAL.glassLt, gx, y + cap + 2);
      }
      // leading edge seal
      R(ctx, PAL.black, fromStart ? x + w - 1 : x, y, 1, h);
    } else {
      R(ctx, PAL.white, x + 1, y + 1, w - 2, h - 2);
      R(ctx, PAL.wallShade, x + w - 2, y + 1, 1, h - 2);
      R(ctx, PAL.steel, x + 1, y + 1, 1, h - 2);
      if (w >= 6 && h >= 10) {
        var gy = fromStart ? y + 3 : y + h - 7;
        R(ctx, PAL.glass, x + 2, gy, w - 4, 4);
      }
      R(ctx, PAL.black, x, fromStart ? y + h - 1 : y, w, 1);
    }
  }

  function drawDoor(ctx, door, openFrac, camX, camY, t) {
    if (!door) return;
    var leaves = AGV.doorLeaves ? AGV.doorLeaves(door, openFrac) : fallbackLeaves(door, openFrac);
    var cx = rnd(camX), cy = rnd(camY);
    var horiz = door.axis !== 'v';
    for (var i = 0; i < leaves.length; i++) {
      var L = leaves[i];
      drawLeaf(ctx, rnd(L.x) - cx, rnd(L.y) - cy, rnd(L.w), rnd(L.h), horiz, i === 0);
    }
    // status lamps on the jambs
    var x0 = door.x * TILE - cx, y0 = door.y * TILE - cy, len = door.len * TILE;
    var lamp = openFrac > 0.9 ? PAL.green : (fl((t || 0) * 6) % 2 ? PAL.red : PAL.redDk);
    var lamps = horiz ? [[x0 - 4, y0 + 3], [x0 + len + 1, y0 + 3]] : [[x0 + 3, y0 - 4], [x0 + 3, y0 + len + 1]];
    for (var k = 0; k < 2; k++) {
      R(ctx, PAL.black, lamps[k][0], lamps[k][1], 3, 3);
      P(ctx, lamp, lamps[k][0] + 1, lamps[k][1] + 1);
    }
  }

  function stripes(ctx, x, y, w, h, ph) {
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        P(ctx, ((xx + yy + ph) & 3) < 2 ? PAL.yellow : PAL.black, x + xx, y + yy);
      }
    }
  }

  function drawMover(ctx, mover, rect, camX, camY, t) {
    if (!rect) return;
    var x = rnd(rect.x - camX), y = rnd(rect.y - camY), w = rnd(rect.w), h = rnd(rect.h);
    if (x > 2000 || y > 2000 || x + w < -2000 || y + h < -2000) return;
    var slideX = (mover && mover.dx) ? 1 : 0;
    var longV = h >= w;
    R(ctx, SHADOW, x + 2, y + 3, w, h);
    // racking body, tile by tile
    var nx = Math.max(1, Math.round(w / TILE)), ny = Math.max(1, Math.round(h / TILE));
    var seed = mover && mover.id !== undefined ? String(mover.id).length * 7 + (mover.x | 0) : 0;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var m = (j > 0 ? 1 : 0) | (i < nx - 1 ? 2 : 0) | (j < ny - 1 ? 4 : 0) | (i > 0 ? 8 : 0);
        var vert = longV;
        var parity = (vert ? j : i) & 1;
        ctx.drawImage(rackSprite(m, fl(hash2(i + seed, j, 71) * 16), parity), x + i * TILE, y + j * TILE);
      }
    }
    ctx.restore();
    // grey end panels with a black control box
    var ep = 5;
    if (longV) {
      R(ctx, PAL.dkgrey, x, y, w, ep); R(ctx, PAL.steel, x + 1, y + 1, w - 2, ep - 2);
      R(ctx, PAL.dkgrey, x, y + h - ep, w, ep); R(ctx, PAL.steel, x + 1, y + h - ep + 1, w - 2, ep - 2);
      R(ctx, PAL.black, x + fl(w / 2) - 3, y + h - ep - 1, 6, ep + 1);
      R(ctx, PAL.glassLt, x + fl(w / 2) - 2, y + h - ep, 4, 2);
    } else {
      R(ctx, PAL.dkgrey, x, y, ep, h); R(ctx, PAL.steel, x + 1, y + 1, ep - 2, h - 2);
      R(ctx, PAL.dkgrey, x + w - ep, y, ep, h); R(ctx, PAL.steel, x + w - ep + 1, y + 1, ep - 2, h - 2);
      R(ctx, PAL.black, x + w - ep - 1, y + fl(h / 2) - 3, ep + 1, 6);
      R(ctx, PAL.glassLt, x + w - ep, y + fl(h / 2) - 2, 2, 4);
    }
    // yellow/black stripes on the leading edges
    if (slideX || (mover && !mover.dy && longV)) {
      stripes(ctx, x, y, 2, h, 0); stripes(ctx, x + w - 2, y, 2, h, 0);
    } else {
      stripes(ctx, x, y, w, 2, 0); stripes(ctx, x, y + h - 2, w, 2, 0);
    }
    // amber beacon while moving
    var moving = false;
    if (AGV.moverRect && mover) {
      var r2 = AGV.moverRect(mover, (t || 0) + 0.05);
      moving = r2 && (Math.abs(r2.x - rect.x) + Math.abs(r2.y - rect.y)) > 0.05;
    }
    var bxp = longV ? x + fl(w / 2) - 1 : x + 1, byp = longV ? y + 1 : y + fl(h / 2) - 1;
    R(ctx, PAL.black, bxp - 1, byp - 1, 4, 4);
    R(ctx, moving && fl((t || 0) * 6) % 2 ? PAL.orange : (moving ? PAL.yellow : PAL.orangeDk), bxp, byp, 2, 2);
  }

  // ---------------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------------
  function drawParticles(ctx, parts, camX, camY) {
    if (!parts || !parts.length) return;
    var cx = rnd(camX), cy = rnd(camY);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.life !== undefined && p.life <= 0) continue;
      var s = Math.max(1, rnd(p.size || 1));
      ctx.fillStyle = p.color || PAL.white;
      ctx.fillRect(rnd(p.x) - cx - (s >> 1), rnd(p.y) - cy - (s >> 1), s, s);
    }
  }

  // ---------------------------------------------------------------------------
  // World drawing
  // ---------------------------------------------------------------------------
  var inited = false, initMap = null;
  function ensureInit() {
    if (!inited || initMap !== AGV.map) init();
  }

  function init() {
    if (typeof document === 'undefined') return;
    T = AGV.T || DEF_T;
    TILE = AGV.TILE || 16;
    chunks = {}; spriteCache = {}; minimapBase = null; prewarm = [];
    if (!concIdx) buildConcrete();
    if (!shadowW) buildShadows();
    fontAtlas(PAL.white);
    var m = AGV.map;
    if (m) {
      var ni = Math.ceil(m.W * TILE / CS), nj = Math.ceil(m.H * TILE / CS);
      for (var j = 0; j < nj; j++) for (var i = 0; i < ni; i++) prewarm.push([i, j]);
    }
    inited = true;
    initMap = AGV.map;
  }

  function drawWorld(ctx, camX, camY, vw, vh, t) {
    ensureInit();
    ctx.imageSmoothingEnabled = false;
    vw = vw || 320; vh = vh || 180;
    var m = AGV.map;
    if (!m) { R(ctx, PAL.outside, 0, 0, vw, vh); return; }
    var cx = rnd(camX), cy = rnd(camY);
    var i0 = Math.floor(cx / CS), i1 = Math.floor((cx + vw - 1) / CS);
    var j0 = Math.floor(cy / CS), j1 = Math.floor((cy + vh - 1) / CS);
    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) ctx.drawImage(getChunk(i, j), i * CS - cx, j * CS - cy);
    }
    // animated decals: control-box LEDs blink
    if (m.props) {
      var blink = fl((t || 0) * 2) % 2;
      for (var k = 0; k < m.props.length; k++) {
        var p = m.props[k];
        if (p.type !== 'panel') continue;
        var px = rnd(p.x) - cx, py = rnd(p.y) - cy;
        if (px < -8 || py < -8 || px > vw + 8 || py > vh + 8) continue;
        var b = box(p, 6, 8);
        P(ctx, blink ? PAL.green : PAL.tealDk, b.x - cx + b.w - 2, b.y - cy + b.h - 2);
      }
    }
    // build one off-screen chunk per call so later scrolling never hitches
    while (prewarm.length) {
      var pw = prewarm.shift();
      if (!chunks[chunkKey(pw[0], pw[1])]) { getChunk(pw[0], pw[1]); break; }
    }
  }

  // ---------------------------------------------------------------------------
  // UI: panel and minimap
  // ---------------------------------------------------------------------------
  function panel(ctx, x, y, w, h) {
    x = rnd(x); y = rnd(y); w = rnd(w); h = rnd(h);
    if (w < 4 || h < 4) { R(ctx, PAL.ink, x, y, w, h); return; }
    R(ctx, PAL.black, x + 1, y, w - 2, h); R(ctx, PAL.black, x, y + 1, w, h - 2);
    R(ctx, PAL.steel, x + 1, y + 1, w - 2, h - 2);
    R(ctx, PAL.white, x + 2, y + 1, w - 4, 1);
    R(ctx, PAL.black, x + 2, y + 2, w - 4, h - 4);
    R(ctx, PAL.ink, x + 3, y + 3, w - 6, h - 6);
    R(ctx, PAL.charcoal, x + 3, y + 3, w - 6, 1);
  }

  var minimapBase = null;
  function miniColor(id) {
    switch (id) {
      case T.FLOOR: case T.SCUFF: return RGB.concreteDk;
      case T.VINYL: return RGB.wallShade;
      case T.TAPE: return RGB.yellowDk;
      case T.DOCKPLATE: return RGB.steelDk;
      case T.WALL: case T.WINDOW: case T.DOCKDOOR: return RGB.white;
      case T.CURB: return RGB.yellow;
      case T.RACK: return RGB.teal;
      case T.ROOM: return RGB.roof;
      default: return RGB.black;
    }
  }
  function buildMinimap() {
    var m = AGV.map;
    var c = mk(m.W, m.H), x = c._x;
    var img = x.createImageData(m.W, m.H), d = img.data;
    for (var i = 0; i < m.W * m.H; i++) {
      var col = miniColor(m.tiles[i]);
      d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    minimapBase = c;
  }

  function line(ctx, x0, y0, x1, y1, s) {
    x0 = rnd(x0); y0 = rnd(y0); x1 = rnd(x1); y1 = rnd(y1);
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (var n = 0; n < 4000; n++) {
      ctx.fillRect(x0, y0, s, s);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function minimap(ctx, x, y, w, h, run, dots) {
    ensureInit();
    var m = AGV.map;
    x = rnd(x); y = rnd(y); w = rnd(w); h = rnd(h);
    R(ctx, PAL.black, x, y, w, h);
    if (!m) return;
    if (!minimapBase) buildMinimap();
    var s = Math.min((w - 2) / m.W, (h - 2) / m.H);
    var mw = rnd(m.W * s), mh = rnd(m.H * s);
    var ox = x + fl((w - mw) / 2), oy = y + fl((h - mh) / 2);
    var prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(minimapBase, ox, oy, mw, mh);
    ctx.imageSmoothingEnabled = prev;
    var k = s / TILE;
    if (run && run.waypoints && run.waypoints.length) {
      ctx.fillStyle = run.color || PAL.yellow;
      var pts = run.waypoints;
      var start = run.grid && run.grid[0] ? run.grid[0] : pts[0];
      var px = start.x, py = start.y;
      for (var i = 0; i < pts.length; i++) {
        line(ctx, ox + px * k, oy + py * k, ox + pts[i].x * k, oy + pts[i].y * k, 1);
        px = pts[i].x; py = pts[i].y;
      }
      var fx = rnd(ox + px * k), fy = rnd(oy + py * k);
      R(ctx, PAL.black, fx - 2, fy - 2, 5, 5);
      R(ctx, PAL.white, fx - 1, fy - 1, 3, 3);
      P(ctx, PAL.black, fx, fy - 1); P(ctx, PAL.black, fx - 1, fy); P(ctx, PAL.black, fx + 1, fy); P(ctx, PAL.black, fx, fy + 1);
    }
    if (dots) {
      for (var d = dots.length - 1; d >= 0; d--) {
        var dt = dots[d];
        var dx = rnd(ox + dt.x * k), dy = rnd(oy + dt.y * k);
        R(ctx, PAL.black, dx - 2, dy - 2, 4, 4);
        R(ctx, dt.color || PAL.white, dx - 1, dy - 1, 2, 2);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Title screen
  // ---------------------------------------------------------------------------
  var titleBg = null, titleLogo = null;
  var TB_W = 512;

  function buildTitleBg() {
    var c = mk(TB_W, 180), x = c._x;
    var img = x.createImageData(TB_W, 180), d = img.data;
    var ccols = CONC_COLS.map(function (k) { return RGB[k]; });
    for (var y = 0; y < 180; y++) {
      for (var xx = 0; xx < TB_W; xx++) {
        var col = ccols[concIdx[(y & (CONC_N - 1)) * CONC_N + xx]];
        var o = (y * TB_W + xx) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    var n = TB_W / 16;
    // top rack row (2 tiles deep), bottom rack row (1 tile)
    for (var i = 0; i < n; i++) {
      var bayEnd = i % 8 === 7, bayStart = i % 8 === 0;
      var mTop = (bayStart ? 0 : 8) | (bayEnd ? 0 : 2);
      x.drawImage(rackSprite(mTop | 4, fl(hash2(i, 0, 81) * 16), i & 1), i * 16, 0);
      x.drawImage(rackSprite(mTop | 1, fl(hash2(i, 1, 81) * 16), i & 1), i * 16, 16);
      x.drawImage(rackSprite(mTop, fl(hash2(i, 2, 81) * 16), i & 1), i * 16, 164);
    }
    // gaps between rack bays with bollards
    for (i = 0; i < n; i += 8) {
      R(x, SHADOW, i * 16 + 16 * 7 + 6, 0, 4, 32);
    }
    // hazard tape lanes
    for (y = 34; y < 38; y++) {
      for (xx = 0; xx < TB_W; xx++) P(x, ((xx + y) & 7) < 4 ? PAL.yellow : PAL.ink, xx, y);
    }
    for (y = 158; y < 162; y++) {
      for (xx = 0; xx < TB_W; xx++) P(x, ((xx + y) & 7) < 4 ? PAL.yellow : PAL.ink, xx, y);
    }
    R(x, SHADOW, 0, 32, TB_W, 2);
    // dashed AGV lane markings
    for (xx = 0; xx < TB_W; xx += 16) R(x, PAL.wallTop, xx, 134, 8, 1);
    // scuffs
    for (i = 0; i < 18; i++) {
      var sx = fl(hash2(i, 5, 82) * (TB_W - 20)), sy = 44 + fl(hash2(i, 6, 83) * 100);
      for (var k = 0; k < 14; k++) {
        P(x, k & 1 ? PAL.grey : PAL.concreteDk, sx + fl(hash2(i, k, 84) * 14), sy + fl(hash2(k, i, 85) * 5));
      }
    }
    // dock props sprinkled along the floor
    var props = [
      { type: 'bollard', x: 40, y: 46 }, { type: 'bollard', x: 168, y: 46 }, { type: 'bollard', x: 296, y: 46 },
      { type: 'bollard', x: 424, y: 46 }, { type: 'bins', x: 230, y: 58, w: 24, h: 18 },
      { type: 'crates', x: 470, y: 58, w: 20, h: 18 }, { type: 'column', x: 360, y: 100, w: 10, h: 10 },
      { type: 'cart', x: 100, y: 112, w: 14, h: 20 }, { type: 'palletjack', x: 160, y: 104, w: 22, h: 10 }
    ];
    props.forEach(function (p) { drawProp(x, p); });
    titleBg = c;
  }

  function buildTitleLogo() {
    var big = 'AGV RALLY', small = 'PEABODY';
    var S = 4, s2 = 2;
    var bw = textWidth(big, S), sw = textWidth(small, s2);
    var W = Math.max(bw, sw) + 12, H = 7 * s2 + 7 * S + 18;
    var c = mk(W, H), x = c._x;
    var bx = fl((W - bw) / 2), by = 7 * s2 + 8;
    var sx = fl((W - sw) / 2), sy = 2;
    // big word: outline + extrude
    var dx, dy;
    for (dy = -2; dy <= 5; dy++) for (dx = -2; dx <= 2; dx++) text(x, big, bx + dx, by + dy, PAL.black, S);
    for (dy = 1; dy <= 3; dy++) text(x, big, bx, by + dy, dy === 3 ? PAL.redDk : PAL.orangeDk, S);
    var tmp = mk(W, H), tx = tmp._x;
    text(tx, big, bx, by, '#fff', S);
    tx.globalCompositeOperation = 'source-atop';
    var bands = [[0, 4, PAL.white], [4, 12, PAL.yellow], [16, 8, PAL.orange], [24, 4, PAL.red]];
    bands.forEach(function (b) { R(tx, b[2], 0, by + b[0], W, b[1]); });
    // pixel highlight on the left of each block column
    x.drawImage(tmp, 0, 0);
    // small word: blue extruded
    for (dy = -1; dy <= 3; dy++) for (dx = -1; dx <= 1; dx++) text(x, small, sx + dx, sy + dy, PAL.black, s2);
    text(x, small, sx, sy + 2, PAL.blueDk, s2);
    text(x, small, sx, sy + 1, PAL.blue, s2);
    var tmp2 = mk(W, H), t2 = tmp2._x;
    text(t2, small, sx, sy, '#fff', s2);
    t2.globalCompositeOperation = 'source-atop';
    R(t2, PAL.white, 0, sy, W, 6); R(t2, PAL.steel, 0, sy + 6, W, 8);
    x.drawImage(tmp2, 0, 0);
    titleLogo = c;
  }

  function title(ctx, t) {
    ensureInit();
    t = t || 0;
    ctx.imageSmoothingEnabled = false;
    if (!titleBg) buildTitleBg();
    if (!titleLogo) buildTitleLogo();
    var off = fl(t * 32) % TB_W;
    ctx.drawImage(titleBg, -off, 0);
    ctx.drawImage(titleBg, TB_W - off, 0);
    ctx.fillStyle = 'rgba(13,15,20,0.42)';
    ctx.fillRect(0, 0, 320, 180);
    // AGVs driving across (floor scrolls left, AGVs overtake to the right)
    var racers = [
      { c: PAL.racerRed, sp: 70, y: 146, ph: 0, boost: true },
      { c: PAL.racerBlue, sp: 52, y: 120, ph: 170, boost: false },
      { c: PAL.racerPurple, sp: 44, y: 146, ph: 300, boost: false }
    ];
    var span = 400;
    racers.forEach(function (r, i) {
      var x = ((t * r.sp + r.ph) % span) - 40;
      var wob = Math.sin(t * 9 + i) * 0.6;
      drawAGV(ctx, x, r.y + (Math.sin(t * 3 + i * 2) > 0.8 ? 1 : 0), 0,
        { color: r.c, boxes: 4, wobble: wob, boost: r.boost && Math.sin(t * 1.3) > -0.2, t: t });
    });
    // logo drops in during the first half second
    var drop = t < 0.6 ? fl((1 - t / 0.6) * (1 - t / 0.6) * -80) : 0;
    var lx = fl((320 - titleLogo.width) / 2), ly = 8 + drop + (fl(t * 2) % 2 && t > 0.6 ? 0 : 0);
    ctx.drawImage(titleLogo, lx, ly);
    // hazard bar under the logo with a running sheen
    var barY = ly + titleLogo.height + 1, barX = 60, barW = 200;
    R(ctx, PAL.black, barX - 1, barY - 1, barW + 2, 6);
    for (var xx = 0; xx < barW; xx++) {
      for (var yy = 0; yy < 4; yy++) {
        P(ctx, ((xx + yy + fl(t * 12)) & 7) < 4 ? PAL.yellow : PAL.ink, barX + xx, barY + yy);
      }
    }
    textS(ctx, 'WAREHOUSE DELIVERY RACING', 160, barY + 8, PAL.wallTop, 1, 'center');
  }

  // ---------------------------------------------------------------------------
  AGV.gfx = {
    PAL: PAL,
    init: init,
    drawWorld: drawWorld,
    drawGuide: drawGuide,
    drawFinish: drawFinish,
    drawDoor: drawDoor,
    drawMover: drawMover,
    drawPickup: drawPickup,
    drawDrop: drawDrop,
    drawAGV: drawAGV,
    drawParticles: drawParticles,
    text: text,
    textWidth: textWidth,
    itemIcon: itemIcon,
    minimap: minimap,
    panel: panel,
    title: title,
    // extras (not in the contract, safe to ignore)
    textShadow: textS,
    drawProp: function (ctx, p, camX, camY) {
      ctx.save(); ctx.translate(-rnd(camX || 0), -rnd(camY || 0)); drawProp(ctx, p); ctx.restore();
    },
    LINE_H: LINE_H
  };
})();
