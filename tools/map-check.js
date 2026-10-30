#!/usr/bin/env node
// Headless sanity checks for js/map.js, plus an ASCII preview.
// Usage: node tools/map-check.js [--run=double|stockroom|decon|all] [--no-preview]
'use strict';

var path = require('path');
require(path.join(__dirname, '..', 'js', 'map.js'));
var AGV = globalThis.AGV;
var T = AGV.T, M = AGV.map, TILE = AGV.TILE;
var R = 9;  // AGV collision radius, px

var args = process.argv.slice(2);
var runArg = (args.find(function (a) { return a.indexOf('--run=') === 0; }) || '--run=all').slice(6);
var preview = args.indexOf('--no-preview') < 0;

var fails = 0, passes = 0;
function ok(cond, msg) {
  if (cond) passes++;
  else { fails++; console.log('FAIL: ' + msg); }
}
function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
function tpos(p) { return '(' + f1(p.x / TILE) + ',' + f1(p.y / TILE) + ')'; }

// --- 0. API shape -----------------------------------------------------------
ok(typeof AGV.isSolid === 'function', 'AGV.isSolid exists');
['doorOpen', 'doorLeaves', 'moverRect', 'areaAt'].forEach(function (fn) {
  ok(typeof AGV[fn] === 'function', 'AGV.' + fn + ' exists');
});
ok(M.tiles instanceof Uint8Array && M.tiles.length === M.W * M.H, 'tiles is Uint8Array(W*H)');
ok(M.at(-1, 0) === T.OUTSIDE && M.at(M.W, 5) === T.OUTSIDE, 'at() out of bounds -> OUTSIDE');
ok(M.W >= 140 && M.W <= 180 && M.H >= 120 && M.H <= 160, 'map size ' + M.W + 'x' + M.H + ' within target');

// --- 1. tile rows -------------------------------------------------------------
// Rebuild the rows as strings from the Uint8Array and check every row's length.
var CH = {};
CH[T.FLOOR] = '.'; CH[T.SCUFF] = ','; CH[T.VINYL] = '~'; CH[T.WALL] = '#'; CH[T.RACK] = 'H';
CH[T.ROOM] = ':'; CH[T.DOCKDOOR] = 'D'; CH[T.WINDOW] = 'W'; CH[T.OUTSIDE] = ' '; CH[T.TAPE] = '=';
CH[T.DOCKPLATE] = '_'; CH[T.CURB] = 'c';
var rows = [];
for (var y = 0; y < M.H; y++) {
  var s = '';
  for (var x = 0; x < M.W; x++) {
    var id = M.tiles[y * M.W + x];
    ok(CH[id] !== undefined, 'unknown tile id ' + id + ' at ' + x + ',' + y);
    s += CH[id];
  }
  rows.push(s);
}
ok(rows.length === M.H, 'row count === H');
ok(rows.every(function (r) { return r.length === M.W; }), 'every row length === W');

// --- helpers ------------------------------------------------------------------
var solidProps = M.props.filter(function (p) { return p.solid; });
function circleHitsRect(cx, cy, r, x, y, w, h) {
  var nx = Math.max(x, Math.min(cx, x + w)), ny = Math.max(y, Math.min(cy, y + h));
  var dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}
// Returns a description of what the circle touches, or '' if clear.
function circleBlocked(cx, cy, r) {
  var x0 = Math.floor((cx - r) / TILE), x1 = Math.floor((cx + r) / TILE);
  var y0 = Math.floor((cy - r) / TILE), y1 = Math.floor((cy + r) / TILE);
  for (var ty = y0; ty <= y1; ty++) for (var tx = x0; tx <= x1; tx++) {
    if (AGV.isSolid(M.at(tx, ty)) && circleHitsRect(cx, cy, r, tx * TILE, ty * TILE, TILE, TILE)) {
      return 'tile ' + CH[M.at(tx, ty)] + ' @' + tx + ',' + ty;
    }
  }
  for (var i = 0; i < solidProps.length; i++) {
    var p = solidProps[i];
    if (circleHitsRect(cx, cy, r, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h)) {
      return 'prop ' + p.type + ' @' + tpos(p);
    }
  }
  return '';
}
function segBlocked(a, b) {
  var len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(len / 4));
  for (var i = 0; i <= n; i++) {
    var cx = a.x + (b.x - a.x) * i / n, cy = a.y + (b.y - a.y) * i / n;
    var hit = circleBlocked(cx, cy, R);
    if (hit) return hit + ' at ' + tpos({ x: cx, y: cy });
  }
  return '';
}
function moverMaxRect(m) {  // union of the rest and fully-extended rects, in tiles
  return {
    x0: Math.min(m.x, m.x + m.dx), y0: Math.min(m.y, m.y + m.dy),
    x1: Math.max(m.x, m.x + m.dx) + m.w - 1, y1: Math.max(m.y, m.y + m.dy) + m.h - 1,
    ex0: m.x + m.dx, ey0: m.y + m.dy, ex1: m.x + m.dx + m.w - 1, ey1: m.y + m.dy + m.h - 1
  };
}

// --- 2..4. runs ------------------------------------------------------------------
var RANGES = { stockroom: [170, 210], decon: [150, 180], double: [330, 400] };
['stockroom', 'decon', 'double'].forEach(function (key) {
  var run = M.runs[key];
  ok(!!run, 'run ' + key + ' exists');
  if (!run) return;
  ok(run.key === key && typeof run.name === 'string' && /^#[0-9a-f]{6}$/i.test(run.color), key + ': key/name/color');
  ok(run.grid.length === 4, key + ': 4 grid slots');
  var areaOk = run.grid.every(function (g) { return AGV.areaAt(g.x, g.y) === 'DOCK'; });
  ok(areaOk, key + ': grid slots inside the Dock');

  // 2. on non-solid tiles (and a full 9px circle fits)
  run.grid.forEach(function (g, i) {
    ok(!AGV.isSolid(M.at(g.x / TILE, g.y / TILE)), key + ' grid ' + i + ' on solid tile');
    var hit = circleBlocked(g.x, g.y, R);
    ok(!hit, key + ' grid ' + i + ' circle blocked: ' + hit);
  });
  run.waypoints.forEach(function (w, i) {
    ok(!AGV.isSolid(M.at(w.x / TILE, w.y / TILE)), key + ' wp ' + i + ' ' + tpos(w) + ' on solid tile');
    ok(w.r >= 40 && w.r <= 64, key + ' wp ' + i + ' radius ' + w.r + ' out of 40..64');
  });

  // 3. swept circle along every segment
  run.grid.forEach(function (g, i) {
    var hit = segBlocked(g, run.waypoints[0]);
    ok(!hit, key + ' grid ' + i + ' -> wp 0 blocked: ' + hit);
  });
  var len = Math.hypot(run.waypoints[0].x - run.grid[0].x, run.waypoints[0].y - run.grid[0].y) / TILE;
  for (var i = 1; i < run.waypoints.length; i++) {
    var a = run.waypoints[i - 1], b = run.waypoints[i];
    var d = Math.hypot(b.x - a.x, b.y - a.y) / TILE;
    len += d;
    ok(d >= 3 - 1e-6 && d <= 8 + 1e-6, key + ' wp ' + (i - 1) + '->' + i + ' spacing ' + f1(d) + ' tiles (want 3..8)');
    var hit2 = segBlocked(a, b);
    ok(!hit2, key + ' wp ' + (i - 1) + tpos(a) + ' -> ' + i + tpos(b) + ' blocked: ' + hit2);
  }

  // Movers: at full extension, every route segment crossing a mover's rows must keep
  // >= 4 tiles of contiguous clear floor across that row (around the route line).
  var pts = [run.grid[0]].concat(run.waypoints);
  M.movers.forEach(function (m) {
    var mr = moverMaxRect(m);
    for (var ty = mr.y0; ty <= mr.y1; ty++) {
      var cy = (ty + 0.5) * TILE;
      for (var s = 1; s < pts.length; s++) {
        var a = pts[s - 1], b = pts[s];
        if ((cy - a.y) * (cy - b.y) > 0 || a.y === b.y) continue;
        var cx = a.x + (b.x - a.x) * (cy - a.y) / (b.y - a.y);
        var rtx = Math.floor(cx / TILE);
        var blocked = function (tx) {
          return AGV.isSolid(M.at(tx, ty)) || (tx >= mr.ex0 && tx <= mr.ex1 && ty >= mr.ey0 && ty <= mr.ey1);
        };
        if (blocked(rtx)) { ok(false, key + ' route line inside mover ' + m.id + ' at row ' + ty); continue; }
        var l = rtx, r = rtx;
        while (!blocked(l - 1) && l > 0) l--;
        while (!blocked(r + 1) && r < M.W - 1) r++;
        ok(r - l + 1 >= 4, key + ' mover ' + m.id + ' leaves only ' + (r - l + 1) + ' tiles at row ' + ty);
        // also report whether the 9 px circle on the route line clears the extended rack
        var ext = { x: mr.ex0 * TILE, y: mr.ey0 * TILE, w: m.w * TILE, h: m.h * TILE };
        ok(!circleHitsRect(cx, cy, R, ext.x, ext.y, ext.w, ext.h),
          key + ' route line (x=' + f1(cx / TILE) + ') clips extended mover ' + m.id + ' at row ' + ty);
      }
    }
  });

  // 4. path length
  var rg = RANGES[key];
  console.log('path ' + key + ': ' + f1(len) + ' tiles (' + run.waypoints.length + ' waypoints; want ' + rg[0] + '-' + rg[1] + ')');
  ok(len >= rg[0] && len <= rg[1], key + ' path length ' + f1(len) + ' out of range');

  // finish rect contains the last waypoint
  var fw = run.waypoints[run.waypoints.length - 1], fr = run.finish;
  ok(fw.x >= fr.x && fw.x <= fr.x + fr.w && fw.y >= fr.y && fw.y <= fr.y + fr.h, key + ': finish rect contains last waypoint');
});
var dropoff = M.runs.double.waypoints.filter(function (w) { return w.label === 'STOCKROOM DROP-OFF'; });
ok(dropoff.length === 1, "double run has one 'STOCKROOM DROP-OFF' waypoint");

// --- 5. pickups ------------------------------------------------------------------
ok(M.pickups.length >= 10 && M.pickups.length <= 16, 'pickup count ' + M.pickups.length + ' in 10..16');
M.pickups.forEach(function (p, i) {
  ok(!AGV.isSolid(M.at(p.x / TILE, p.y / TILE)), 'pickup ' + i + ' ' + tpos(p) + ' on solid tile');
  solidProps.forEach(function (q) {
    ok(!circleHitsRect(p.x, p.y, 6, q.x - q.w / 2, q.y - q.h / 2, q.w, q.h), 'pickup ' + i + ' inside prop ' + q.type);
  });
  M.movers.forEach(function (m) {
    var mr = moverMaxRect(m);
    var tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    ok(!(tx >= mr.x0 && tx <= mr.x1 && ty >= mr.y0 && ty <= mr.y1), 'pickup ' + i + ' inside mover sweep ' + m.id);
  });
});

// --- 6. doors ------------------------------------------------------------------------
ok(M.doors.length >= 2, 'at least two doors');
M.doors.forEach(function (d) {
  ok(d.period >= 5 && d.period <= 7, 'door ' + d.id + ' period 5..7');
  for (var k = 0; k < d.len; k++) {
    var tx = d.axis === 'h' ? d.x + k : d.x, ty = d.axis === 'h' ? d.y : d.y + k;
    ok(!AGV.isSolid(M.at(tx, ty)), 'door ' + d.id + ' opening tile ' + tx + ',' + ty + ' is solid');
  }
  var span = d.len * TILE;
  var closed = AGV.doorLeaves(d, 0), open = AGV.doorLeaves(d, 1);
  ok(closed.length === 2 && open.length === 2, 'door ' + d.id + ' returns 2 leaves');
  var along = d.axis === 'h' ? 'w' : 'h';
  var gap = span - closed[0][along] - closed[1][along];
  ok(gap >= 2 * TILE - 1e-6, 'door ' + d.id + ' closed gap ' + gap + ' px < 2 tiles');
  ok(open[0][along] <= 0.5 && open[1][along] <= 0.5, 'door ' + d.id + ' open leaves not ~0');
  // timing: fraction of the period that is fully closed
  var shut = 0, steps = 600;
  for (var i = 0; i < steps; i++) if (AGV.doorOpen(d, i * d.period / steps) === 0) shut++;
  console.log('door ' + d.id + ': tiles x' + d.x + ' y' + d.y + ' len ' + d.len + ' axis ' + d.axis +
    ', closed ' + f1(shut / steps * d.period) + ' s of ' + d.period + ' s, open at t=0: ' + f1(AGV.doorOpen(d, 0)) +
    ', closed gap ' + gap + ' px');
});

// movers' rest slots must be floor so they don't overlap racks at rest
M.movers.forEach(function (m) {
  var mr = moverMaxRect(m);
  for (var ty = mr.y0; ty <= mr.y1; ty++) for (var tx = mr.x0; tx <= mr.x1; tx++) {
    ok(!AGV.isSolid(M.at(tx, ty)), 'mover ' + m.id + ' sweep covers solid tile ' + tx + ',' + ty);
  }
  var r0 = AGV.moverRect(m, -m.phase), rh = AGV.moverRect(m, -m.phase + m.period / 2);
  ok(r0.x === m.x * TILE && Math.abs(rh.x - (m.x + m.dx) * TILE) < 1e-6, 'moverRect rest/extended for ' + m.id);
});

// areaAt sanity
ok(AGV.areaAt(15 * TILE, 84 * TILE) === 'MAIN HALL', 'areaAt main hall');
ok(AGV.areaAt(123 * TILE, 40 * TILE) === 'STOCKROOM', 'areaAt stockroom');
ok(AGV.areaAt(107 * TILE, 95 * TILE) === 'DECON HALLWAY', 'areaAt decon hallway');
ok(AGV.areaAt(107 * TILE, 112 * TILE) === 'DECON DOORS', 'areaAt decon doors');
ok(AGV.areaAt(0, 0) === '', "areaAt outside -> ''");

// --- preview -----------------------------------------------------------------------
if (preview) {
  var grid = rows.map(function (r) { return r.split(''); });
  function put(px, py, c) {
    var tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (ty >= 0 && ty < M.H && tx >= 0 && tx < M.W) grid[ty][tx] = c;
  }
  M.props.forEach(function (p) {
    if (p.type === 'stairs') {
      for (var yy = p.y - p.h / 2; yy < p.y + p.h / 2; yy += TILE) for (var xx = p.x - p.w / 2; xx < p.x + p.w / 2; xx += TILE) put(xx, yy, '/');
    } else if (p.solid) put(p.x, p.y, p.type === 'bollard' ? 'o' : '*');
  });
  M.movers.forEach(function (m) {
    for (var ty = m.y; ty < m.y + m.h; ty++) for (var tx = m.x; tx < m.x + m.w; tx++) grid[ty][tx] = 'M';
  });
  M.doors.forEach(function (d) {
    for (var k = 0; k < d.len; k++) {
      if (d.axis === 'h') grid[d.y][d.x + k] = '-'; else grid[d.y + k][d.x] = '|';
    }
  });
  M.pickups.forEach(function (p) { put(p.x, p.y, '?'); });
  var DIG = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var showRuns = runArg === 'all' ? ['decon', 'stockroom', 'double'] : [runArg];
  showRuns.forEach(function (k) {
    var run = M.runs[k];
    run.waypoints.forEach(function (w, i) { put(w.x, w.y, DIG[i % DIG.length]); });
    run.grid.forEach(function (g) { put(g.x, g.y, 'G'); });
  });
  console.log('\nLegend: # wall  : room  H rack  . floor  , scuff  ~ vinyl  = tape  _ dockplate  D dockdoor  W window  c curb');
  console.log('        M mover(rest)  - door  ? pickup  o bollard  * solid prop  / stairs  G grid  0-9a-zA-Z waypoints (' + showRuns.join(', ') + ')\n');
  var ruler = '';
  for (var c = 0; c < M.W; c++) ruler += c % 10 === 0 ? String((c / 10) % 10) : ' ';
  console.log('    ' + ruler);
  grid.forEach(function (r, i) { console.log(('   ' + i).slice(-3) + ' ' + r.join('')); });
}

console.log('\n' + passes + ' checks passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
