// Stand-in map for headless development of game.js while js/map.js is not ready.
// Follows CONTRACT.md: a Dock, a west corridor, a Main Hall, a Stockroom behind a door
// and a Decon Hallway (VINYL past its door). One mover and a few pickups.
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var AGV = root.AGV = root.AGV || {};
  var TS = 16;
  AGV.TILE = TS;
  AGV.VIEW_W = 320;
  AGV.VIEW_H = 180;
  var T = AGV.T = { FLOOR: 0, SCUFF: 1, VINYL: 2, WALL: 3, RACK: 4, ROOM: 5, DOCKDOOR: 6, WINDOW: 7, OUTSIDE: 8, TAPE: 9, DOCKPLATE: 10, CURB: 11 };
  AGV.isSolid = function (id) { return !(id === T.FLOOR || id === T.SCUFF || id === T.VINYL || id === T.TAPE || id === T.DOCKPLATE); };

  var W = 64, H = 60;
  var tiles = new Uint8Array(W * H).fill(T.WALL);
  function fill(x, y, w, h, id) {
    for (var ty = y; ty < y + h; ty++) for (var tx = x; tx < x + w; tx++) tiles[ty * W + tx] = id;
  }
  fill(2, 40, 14, 15, T.FLOOR);   // Dock
  fill(5, 18, 8, 23, T.FLOOR);    // west corridor
  fill(5, 18, 52, 8, T.FLOOR);    // Main Hall
  fill(44, 2, 17, 15, T.FLOOR);   // Stockroom
  fill(48, 17, 8, 1, T.FLOOR);    // Stockroom door opening
  fill(49, 26, 6, 27, T.FLOOR);   // Decon Hallway
  fill(49, 41, 6, 12, T.VINYL);   // Decon zone
  fill(58, 4, 2, 10, T.RACK);     // a rack row

  function c(t) { return t * TS + TS / 2; }
  function wp(tx, ty, label) { var o = { x: tx * TS, y: ty * TS, r: 44 }; if (label) o.label = label; return o; }
  var common = [wp(8.5, 42), wp(8.5, 34), wp(8.5, 27), wp(9.5, 22), wp(16, 22), wp(24, 22), wp(32, 22), wp(40, 22)];
  var toStock = [wp(46, 22), wp(52, 21), wp(52, 15), wp(52, 9), wp(52, 4, 'STOCKROOM DROP-OFF')];
  var toDecon = [wp(48, 22), wp(52, 26), wp(52, 32), wp(52, 38), wp(52, 44), wp(52, 50, 'DECON DOORS')];
  var back = [wp(52, 10), wp(52, 17), wp(52, 23), wp(52, 30), wp(52, 37), wp(52, 44), wp(52, 50, 'DECON DOORS')];
  var grid = [
    { x: 6.5 * TS, y: 49 * TS, angle: -Math.PI / 2 }, { x: 10.5 * TS, y: 49 * TS, angle: -Math.PI / 2 },
    { x: 6.5 * TS, y: 52 * TS, angle: -Math.PI / 2 }, { x: 10.5 * TS, y: 52 * TS, angle: -Math.PI / 2 }
  ];
  function run(key, name, color, wps) {
    var last = wps[wps.length - 1];
    return { key: key, name: name, color: color, grid: grid, waypoints: wps,
      finish: { x: last.x - 48, y: last.y - 4, w: 96, h: 8 } };
  }

  AGV.map = {
    W: W, H: H, tiles: tiles,
    at: function (tx, ty) { return (tx < 0 || ty < 0 || tx >= W || ty >= H) ? T.OUTSIDE : tiles[ty * W + tx]; },
    rooms: [{ name: 'QI PROCESSING', num: '119', x: 14, y: 27, w: 30, h: 12 }],
    areas: [
      { name: 'DOCK', x: 2, y: 40, w: 14, h: 15 }, { name: 'MAIN HALL', x: 5, y: 18, w: 52, h: 8 },
      { name: 'STOCKROOM', x: 44, y: 2, w: 17, h: 16 }, { name: 'DECON HALLWAY', x: 49, y: 26, w: 6, h: 27 }
    ],
    props: [
      { type: 'column', x: c(13), y: c(44), w: 10, h: 10, solid: true },
      { type: 'bollard', x: c(3), y: c(41), w: 8, h: 8, solid: true },
      { type: 'extinguisher', x: c(20), y: 18 * TS + 2, w: 6, h: 6, solid: false }
    ],
    doors: [
      { id: 'stock', x: 48, y: 17, len: 8, axis: 'h', period: 6, phase: 0 },
      { id: 'decon', x: 49, y: 40, len: 6, axis: 'h', period: 5.5, phase: 2.5 }
    ],
    movers: [{ id: 'm1', x: 44, y: 6, w: 3, h: 4, dx: 3, dy: 0, period: 8, phase: 0 }],
    pickups: [{ x: c(8), y: c(36) }, { x: c(28), y: c(21) }, { x: c(52), y: c(12) }, { x: c(51), y: c(33) }],
    runs: {
      stockroom: run('stockroom', 'STOCKROOM RUN', '#e04040', common.concat(toStock)),
      decon: run('decon', 'DECON RUN', '#3a7bff', common.concat(toDecon)),
      double: run('double', 'DOUBLE DELIVERY', '#c060ff', common.concat(toStock).concat(back))
    }
  };

  AGV.doorOpen = function (door, t) {
    var p = door.period || 6, s = (((t + (door.phase || 0)) % p) + p) % p;
    var cs = p * 0.6, ramp = 0.4, closed = 1.2;
    if (s < cs - ramp) return 1;
    if (s < cs) return 1 - (s - (cs - ramp)) / ramp;
    if (s < cs + closed) return 0;
    if (s < cs + closed + ramp) return (s - cs - closed) / ramp;
    return 1;
  };
  AGV.doorLeaves = function (door, f) {
    var maxLeaf = (door.len * TS - 2 * TS) / 2, l = maxLeaf * (1 - f), th = 6;
    if (l <= 0.5) return [];
    if (door.axis === 'h') {
      var x0 = door.x * TS, x1 = (door.x + door.len) * TS, y = door.y * TS + 5;
      return [{ x: x0, y: y, w: l, h: th }, { x: x1 - l, y: y, w: l, h: th }];
    }
    var y0 = door.y * TS, y1 = (door.y + door.len) * TS, x = door.x * TS + 5;
    return [{ x: x, y: y0, w: th, h: l }, { x: x, y: y1 - l, w: th, h: l }];
  };
  AGV.moverRect = function (m, t) {
    var s = 0.5 - 0.5 * Math.cos(2 * Math.PI * ((t + (m.phase || 0)) / m.period));
    return { x: (m.x + m.dx * s) * TS, y: (m.y + m.dy * s) * TS, w: m.w * TS, h: m.h * TS };
  };
  AGV.areaAt = function (x, y) {
    var tx = x / TS, ty = y / TS, a = AGV.map.areas;
    for (var i = 0; i < a.length; i++) {
      if (tx >= a[i].x && tx < a[i].x + a[i].w && ty >= a[i].y && ty < a[i].y + a[i].h) return a[i].name;
    }
    return '';
  };
})();
