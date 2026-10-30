// Peabody AGV Rally: map.js
// Tile map of the Peabody warehouse, the three delivery runs, and the shared
// geometry helpers (doors, mobile racks, areas). See CONTRACT.md.
//
// Layout (north up; 1 tile = 16 world px ~ 2 ft), traced from the floor plan:
//
//   +--------------------------------------------+---------------------------+
//   | PICK TO ORDER 127 (big ROOM block)         | STOCKROOM 126             |
//   |    +-------------------+                   |  N-S rack rows, main      |
//   |    | FINISHED GOODS 128|                   |  aisle (red route) and an |
//   |    +-------------------+                   |  east return aisle        |
//   +============ MAIN HALL (137 ft) ===[CORNER]=+-[doors]-------------------+
//   | DOCK 121 |chem| stairs | QI PROC 119 |PARTS|DECON |DECON| FIELD SERVICE |
//   | dock     |122 |        |   windows   | 117 |HALL  | 116 | & PME 115     |
//   | doors    +----+ QI STAGING 120        |     |[doors]    |               |
//   | (west)   |                MRB 114           |vinyl|     |               |
//   +----------+----- lobby, breakroom, etc. ------------------+--------------+
//
// The tile grid is built by a small rect-based generator (rooms, then carved
// drivable spaces, then an auto-wall pass, then details), which keeps the
// coordinates readable and easy to tweak against the plan.

var AGV = (typeof window !== 'undefined' ? window : globalThis).AGV =
  (typeof window !== 'undefined' ? window : globalThis).AGV || {};

(function () {
  'use strict';

  var TILE = AGV.TILE = AGV.TILE || 16;

  var T = AGV.T = {
    FLOOR: 0, SCUFF: 1, VINYL: 2, WALL: 3, RACK: 4, ROOM: 5, DOCKDOOR: 6,
    WINDOW: 7, OUTSIDE: 8, TAPE: 9, DOCKPLATE: 10, CURB: 11
  };

  var SOLID = [];
  [T.WALL, T.RACK, T.ROOM, T.DOCKDOOR, T.WINDOW, T.OUTSIDE, T.CURB].forEach(function (id) {
    SOLID[id] = true;
  });

  AGV.isSolid = function (id) { return SOLID[id] === true; };

  // ---------------------------------------------------------------------------
  // Tile grid generator
  // ---------------------------------------------------------------------------
  var W = 160, H = 150;
  var tiles = new Uint8Array(W * H);

  function inB(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  function get(x, y) { return inB(x, y) ? tiles[y * W + x] : T.OUTSIDE; }
  function set(x, y, id) { if (inB(x, y)) tiles[y * W + x] = id; }

  // Fill a rect given by INCLUSIVE tile corners (x0,y0)-(x1,y1).
  function fill(x0, y0, x1, y1, id) {
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) set(x, y, id);
  }
  // Same, but only overwrite tiles that currently have type `only`.
  function fillIf(x0, y0, x1, y1, id, only) {
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      if (get(x, y) === only) set(x, y, id);
    }
  }
  // Wall outline of an inclusive rect (interior untouched).
  function outline(x0, y0, x1, y1) {
    for (var x = x0; x <= x1; x++) { set(x, y0, T.WALL); set(x, y1, T.WALL); }
    for (var y = y0; y <= y1; y++) { set(x0, y, T.WALL); set(x1, y, T.WALL); }
  }
  function drivable(id) { return !SOLID[id]; }

  // Building shell: 2-tile OUTSIDE margin, exterior wall at x=2/157, y=2/147.
  var BX0 = 2, BY0 = 2, BX1 = 157, BY1 = 147;
  fill(0, 0, W - 1, H - 1, T.OUTSIDE);
  fill(BX0, BY0, BX1, BY1, T.ROOM);

  // Non-drivable rooms (inclusive wall rects, shared walls overlap by 1 tile).
  // [name, num, x0, y0, x1, y1]; name '' = unlabeled block (outline only).
  var ROOMS = [
    ['PICK TO ORDER', '127', 2, 2, 99, 79],
    ['FINISHED GOODS', '128', 6, 49, 52, 75],
    ['', '', 28, 88, 53, 105],                 // back room under the stair landing
    ['QI PROCESSING', '119', 53, 88, 86, 105],
    ['PARTS CLEANING', '117', 86, 88, 102, 105],
    ['DECON', '116', 111, 88, 119, 107],
    ['', '', 112, 79, 119, 88],                // stub east of the Corner
    ['FIELD SVC / PME', '115', 119, 79, 157, 134],
    ['QI STAGING', '120', 28, 105, 68, 126],
    ['MRB', '114', 68, 108, 102, 131],
    ['JAN', '113', 102, 117, 111, 124],
    ['CORRIDOR', '112', 102, 124, 119, 131],
    ['BREAKROOM', '108', 79, 131, 104, 147],
    ['STORAGE', '109', 104, 131, 112, 147],
    ['FACILITIES', '110', 128, 134, 157, 142],
    ['ELEC', '111', 128, 142, 140, 147],
    ['LOBBY', '101', 30, 131, 52, 147],
    ['MTG RM', '102', 44, 126, 52, 131],
    ['107', '107', 52, 126, 62, 132],
    ["WOMEN'S", '106', 52, 132, 62, 138],
    ['CORR', '103', 52, 138, 60, 142],
    ['SPRINKLER', '104', 52, 142, 60, 147],
    ['FIRE PUMP', '131', 6, 140, 24, 147]
  ];
  ROOMS.forEach(function (r) { outline(r[2], r[3], r[4], r[5]); });
  outline(BX0, BY0, BX1, BY1);        // exterior wall all the way round

  // Drivable spaces (inclusive FLOOR rects). These cut through room walls.
  var DOCK = [3, 89, 27, 139];        // Inbound / Outbound 121 (65 ft deep)
  var HALL = [3, 80, 111, 87];        // Main Hall + Corner at the east end, 8 wide
  var STOCK = [100, 3, 156, 78];      // Stockroom 126
  var DHALL = [103, 88, 110, 105];    // Decon Hallway (curbs at x=103/110 -> 6 clear)
  var DVEST = [103, 107, 110, 116];   // Decon Doors vestibule (vinyl)
  [DOCK, HALL, STOCK, DHALL, DVEST].forEach(function (r) { fill(r[0], r[1], r[2], r[3], T.FLOOR); });

  // Openings between spaces.
  fill(11, 88, 18, 88, T.FLOOR);      // Dock -> Main Hall doorway (66 in, widened to 8)
  fill(104, 79, 109, 79, T.FLOOR);    // Corner -> Stockroom double doors
  fill(104, 106, 109, 106, T.FLOOR);  // Decon Doors

  // Chemical Storage 122 sits inside the Dock's NE corner, east of the doorway.
  var CHEM = [19, 88, 28, 97];
  fill(CHEM[0], CHEM[1], CHEM[2], CHEM[3], T.ROOM);
  outline(CHEM[0], CHEM[1], CHEM[2], CHEM[3]);

  // Auto-wall: any ROOM tile touching (8-neighbour) a drivable tile becomes WALL.
  (function () {
    var mark = [];
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (get(x, y) !== T.ROOM) continue;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && inB(x + dx, y + dy) && drivable(get(x + dx, y + dy))) {
          mark.push(y * W + x); dy = dx = 2;
        }
      }
    }
    mark.forEach(function (i) { tiles[i] = T.WALL; });
  })();

  // --- Dock details: six roll-up dock doors in the west wall, plates in front.
  var DOCK_DOORS = [93, 101, 109, 117, 125, 133];   // top tile row of each 3-tile door
  DOCK_DOORS.forEach(function (y) {
    fill(BX0, y, BX0, y + 2, T.DOCKDOOR);
    fill(3, y, 4, y + 2, T.DOCKPLATE);
  });

  // --- Main Hall: windows into QI Processing / Parts Cleaning on the south wall.
  for (var wx = 55; wx <= 100; wx++) {
    if (wx >= 84 && wx <= 88) continue;            // partition between 119 and 117
    if ((wx - 55) % 5 < 3 && get(wx, 88) === T.WALL) set(wx, 88, T.WINDOW);
  }

  // --- Decon Hallway: yellow kick-curbs both sides, vinyl near the doors.
  fill(103, 89, 103, 105, T.CURB);
  fill(110, 89, 110, 105, T.CURB);
  fillIf(104, 101, 109, 106, T.VINYL, T.FLOOR);
  fillIf(DVEST[0], DVEST[1], DVEST[2], DVEST[3], T.VINYL, T.FLOOR);

  // --- Stockroom racking. Long N-S rows between y=RY0..RY1, cross aisles at
  // both ends. Main aisle x=119..126 (8 wide), return aisle x=137..142 (6 wide).
  var RY0 = 12, RY1 = 68;
  var RACK_ROWS = [  // inclusive x ranges
    [100, 101], [105, 106], [110, 112], [116, 118],          // west of main aisle
    [127, 129], [133, 136], [143, 145], [149, 151], [155, 156] // east
  ];
  RACK_ROWS.forEach(function (r) {
    fill(r[0], RY0, r[1], RY1, T.RACK);
    // hazard tape across the floor at both rack ends
    fillIf(r[0], RY0 - 1, r[1], RY0 - 1, T.TAPE, T.FLOOR);
    fillIf(r[0], RY1 + 1, r[1], RY1 + 1, T.TAPE, T.FLOOR);
  });

  // Mobile racks: they rest inside the rows next to the main aisle and slide
  // sideways into it, leaving 5 of its 8 tiles clear. Their rest slots are FLOOR,
  // and a tape line marks how far into the aisle each one reaches.
  var MOVERS = [
    { id: 'rackA', x: 116, y: 56, w: 3, h: 7, dx: 3, dy: 0, period: 6, phase: 0 },
    { id: 'rackB', x: 127, y: 40, w: 3, h: 7, dx: -3, dy: 0, period: 5, phase: 2 },
    { id: 'rackC', x: 116, y: 24, w: 3, h: 7, dx: 3, dy: 0, period: 7, phase: 4.5 }
  ];
  MOVERS.forEach(function (m) {
    fill(m.x, m.y, m.x + m.w - 1, m.y + m.h - 1, T.FLOOR);
    var edge = m.dx > 0 ? m.x + m.w - 1 + m.dx : m.x + m.dx;  // furthest tile column reached
    fill(edge, m.y, edge, m.y + m.h - 1, T.TAPE);
  });

  // Stockroom entrance: tape band on both sides of the double doors.
  fill(104, 77, 109, 78, T.TAPE);
  fillIf(104, 80, 109, 80, T.TAPE, T.FLOOR);

  // --- Scuff patches (deterministic PRNG so the map is identical every load).
  (function () {
    var s = 0x5eab0d1;
    function rnd() {  // mulberry32
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    var zones = [DOCK, DOCK, HALL, HALL, STOCK, STOCK, STOCK];
    for (var i = 0; i < 70; i++) {
      var z = zones[i % zones.length];
      var cx = z[0] + Math.floor(rnd() * (z[2] - z[0] + 1));
      var cy = z[1] + Math.floor(rnd() * (z[3] - z[1] + 1));
      var n = 2 + Math.floor(rnd() * 5);
      for (var k = 0; k < n; k++) {
        var x = cx + Math.floor(rnd() * 3) - 1, y = cy + Math.floor(rnd() * 3) - 1;
        if (get(x, y) === T.FLOOR) set(x, y, T.SCUFF);
      }
    }
  })();

  // ---------------------------------------------------------------------------
  // Rooms (labels) and areas (HUD location text), in tiles.
  // ---------------------------------------------------------------------------
  var rooms = [];
  ROOMS.forEach(function (r) {
    if (r[0]) rooms.push({ name: r[0], num: r[1], x: r[2], y: r[3], w: r[4] - r[2] + 1, h: r[5] - r[3] + 1 });
  });
  rooms.push({ name: 'CHEMICAL STORAGE', num: '122', x: CHEM[0], y: CHEM[1], w: CHEM[2] - CHEM[0] + 1, h: CHEM[3] - CHEM[1] + 1 });

  // First match wins, so the small zones come first.
  var areas = [
    { name: 'DECON DOORS', x: 103, y: 101, w: 8, h: 16 },
    { name: 'DECON HALLWAY', x: 103, y: 88, w: 8, h: 13 },
    { name: 'CORNER', x: 100, y: 79, w: 12, h: 9 },
    { name: 'MAIN HALL', x: 3, y: 80, w: 97, h: 8 },
    { name: 'DOCK', x: 3, y: 88, w: 25, h: 52 },
    { name: 'STOCKROOM', x: 100, y: 3, w: 57, h: 76 }
  ];

  // ---------------------------------------------------------------------------
  // Props (world px, x/y = CENTER).
  // ---------------------------------------------------------------------------
  var props = [];
  function prop(type, tx, ty, w, h, solid) {
    props.push({ type: type, x: Math.round(tx * TILE), y: Math.round(ty * TILE), w: w, h: h, solid: solid });
  }

  // Dock (photo p3): bin stack, red crates, white column, pallet jack, canvas cart,
  // yellow bollards beside each roll-up door.
  DOCK_DOORS.forEach(function (y) {
    prop('bollard', 3.5, y - 0.5, 8, 8, true);
    prop('bollard', 3.5, y + 3.5, 8, 8, true);
  });
  prop('bins', 25.5, 101, 28, 24, true);
  prop('bins', 25.5, 104.5, 28, 22, true);
  prop('crates', 25.5, 109, 26, 24, true);
  prop('column', 22, 118, 10, 10, true);
  prop('column', 22, 132, 10, 10, true);
  prop('palletjack', 7, 114, 14, 28, true);
  prop('cart', 7.5, 129.5, 22, 28, true);
  prop('exitsign', 15, 88.5, 14, 6, false);
  prop('extinguisher', 27.6, 112, 6, 10, false);

  // Main Hall (photo p4): stair landing on the south side near the west end.
  prop('stairs', 38, 90, 18 * TILE, 3 * TILE, false);
  prop('extinguisher', 45, 79.6, 6, 10, false);
  prop('extinguisher', 80, 79.6, 6, 10, false);
  prop('exitsign', 3.4, 84, 6, 14, false);

  // Corner (photo p6): steel corner guards, exit sign over the Stockroom doors.
  prop('cornerguard', 103, 87.8, 6, 6, false);
  prop('cornerguard', 111, 87.8, 6, 6, false);
  prop('cornerguard', 104, 79.5, 6, 16, false);
  prop('cornerguard', 110, 79.5, 6, 16, false);
  prop('exitsign', 107, 79.2, 14, 6, false);
  prop('extinguisher', 102.4, 96, 6, 10, false);
  prop('exitsign', 107, 106.2, 14, 6, false);

  // Stockroom (photo p7): bollards at the ends of the rack rows, control panels
  // on the row ends that face the cross aisles.
  RACK_ROWS.forEach(function (r) {
    var cx = (r[0] + r[1] + 1) / 2;
    prop('panel', cx, RY1 + 0.7, 10, 8, false);
    if (r[1] - r[0] >= 2) {  // 3+ wide rows get a bollard at each corner of the south end
      prop('bollard', r[0] + 0.5, RY1 + 1.5, 8, 8, true);
      prop('bollard', r[1] + 0.5, RY1 + 1.5, 8, 8, true);
      prop('bollard', r[0] + 0.5, RY0 - 1.5, 8, 8, true);
      prop('bollard', r[1] + 0.5, RY0 - 1.5, 8, 8, true);
    } else {
      prop('bollard', cx, RY1 + 1.5, 8, 8, true);
      prop('bollard', cx, RY0 - 1.5, 8, 8, true);
    }
  });
  MOVERS.forEach(function (m) {  // the mobile racks' own control boxes, at the south end
    prop('panel', m.x + m.w / 2, m.y + m.h + 0.3, 10, 8, false);
  });
  prop('extinguisher', 100.4, 40, 6, 10, false);

  // ---------------------------------------------------------------------------
  // Doors, movers, pickups
  // ---------------------------------------------------------------------------
  var doors = [
    { id: 'stockroom', x: 104, y: 79, len: 6, axis: 'h', period: 6, phase: 3.0 },
    { id: 'decon', x: 104, y: 106, len: 6, axis: 'h', period: 5.5, phase: 4.6 }
  ];

  var pickups = [
    [13, 100], [17, 100],               // Dock exit
    [40, 82], [40, 86], [68, 84],       // Main Hall
    [92, 82], [92, 86],
    [109, 86],                          // Corner
    [121.5, 35], [124.5, 35], [123, 51], // Stockroom main aisle
    [140, 40],                          // Stockroom return aisle (double run)
    [105.5, 96], [108.5, 96]            // Decon Hallway
  ].map(function (p) { return { x: p[0] * TILE, y: p[1] * TILE }; });

  // ---------------------------------------------------------------------------
  // Runs. Key points are in tile units (px = t * 16) and are subdivided so that
  // consecutive waypoints are 3-7 tiles apart.
  // ---------------------------------------------------------------------------
  var GRID = [[12.5, 124], [17.5, 125.5], [12.5, 128.5], [17.5, 130]];  // facing north

  // Shared opening: north out of the Dock, through the doorway, east down the hall.
  var COMMON = [
    { x: 15, y: 116 }, { x: 15, y: 92 }, { x: 19, y: 84, r: 56 }, { x: 101, y: 84, r: 56 }
  ];
  // Corner -> through the double doors -> into the Stockroom main aisle.
  var TO_STOCK = [
    { x: 107, y: 81 }, { x: 107, y: 76, r: 56 }, { x: 123, y: 69, r: 56 }
  ];
  var TO_DECON_FROM_HALL = [{ x: 107, y: 90, r: 56 }];
  var DECON_TAIL = [{ x: 107, y: 113 }];

  function buildRun(key, name, color, keys, finish) {
    var wps = [];
    var MAX = 7;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (i > 0) {
        var p = keys[i - 1];
        var len = Math.hypot(k.x - p.x, k.y - p.y);
        var n = Math.ceil(len / MAX);
        for (var j = 1; j < n; j++) {
          wps.push({ x: Math.round((p.x + (k.x - p.x) * j / n) * TILE),
                     y: Math.round((p.y + (k.y - p.y) * j / n) * TILE), r: 48 });
        }
      }
      var w = { x: Math.round(k.x * TILE), y: Math.round(k.y * TILE), r: k.r || 48 };
      if (k.label) w.label = k.label;
      wps.push(w);
    }
    return {
      key: key, name: name, color: color,
      grid: GRID.map(function (g) {
        return { x: g[0] * TILE, y: g[1] * TILE, angle: -Math.PI / 2 };
      }),
      waypoints: wps,
      // finish = top-left world-px rect of the checkered line through the last waypoint
      finish: { x: finish[0] * TILE, y: finish[1] * TILE - 8, w: (finish[2] - finish[0] + 1) * TILE, h: 16 }
    };
  }

  var runs = {
    stockroom: buildRun('stockroom', 'STOCKROOM RUN', '#e04040',
      COMMON.concat(TO_STOCK, [{ x: 123, y: 17, label: 'STOCKROOM' }]),
      [119, 17, 126]),
    decon: buildRun('decon', 'DECON RUN', '#3a7bff',
      COMMON.concat(TO_DECON_FROM_HALL, DECON_TAIL),
      [103, 113, 110]),
    double: buildRun('double', 'DOUBLE RUN', '#c060ff',
      COMMON.concat(TO_STOCK, [
        { x: 123, y: 17, r: 56, label: 'STOCKROOM DROP-OFF' },
        { x: 127, y: 8.5, r: 56 },      // out into the north cross aisle
        { x: 136, y: 8.5 },
        { x: 140, y: 13, r: 56 },       // down the east return aisle
        { x: 140, y: 68, r: 56 },
        { x: 136, y: 74 },              // west along the south cross aisle
        { x: 112, y: 74, r: 56 },
        { x: 107, y: 78 },              // back through the double doors
        { x: 107, y: 84, label: 'CORNER' },
        { x: 107, y: 90 }
      ], DECON_TAIL),
      [103, 113, 110])
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  AGV.map = {
    W: W, H: H, tiles: tiles,
    at: function (tx, ty) {
      tx = Math.floor(tx); ty = Math.floor(ty);
      return (tx < 0 || ty < 0 || tx >= W || ty >= H) ? T.OUTSIDE : tiles[ty * W + tx];
    },
    rooms: rooms, areas: areas, props: props,
    doors: doors, movers: MOVERS, pickups: pickups, runs: runs
  };

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------
  function smooth(u) { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); }

  // 1 = fully open. Each period: swing shut (0.5 s), stay shut 1.2 s, swing open (0.5 s).
  var SWING = 0.5, SHUT = 1.2;
  AGV.doorOpen = function (door, t) {
    var p = door.period || 6;
    var u = (((t + (door.phase || 0)) % p) + p) % p;
    if (u < SWING) return 1 - smooth(u / SWING);
    if (u < SWING + SHUT) return 0;
    if (u < 2 * SWING + SHUT) return smooth((u - SWING - SHUT) / SWING);
    return 1;
  };

  // Two leaves growing from the jambs toward the middle; a 2-tile gap always stays.
  var LEAF_T = 4;  // leaf thickness, px
  AGV.doorLeaves = function (door, openFrac) {
    var f = openFrac < 0 ? 0 : openFrac > 1 ? 1 : openFrac;
    var reach = (door.len - 2) * TILE / 2;
    var l = reach * (1 - f);
    var off = (TILE - LEAF_T) / 2;
    var a0 = (door.axis === 'h' ? door.x : door.y) * TILE;   // jamb at the start
    var a1 = a0 + door.len * TILE;                           // jamb at the end
    if (door.axis === 'h') {
      var y = door.y * TILE + off;
      return [{ x: a0, y: y, w: l, h: LEAF_T }, { x: a1 - l, y: y, w: l, h: LEAF_T }];
    }
    var x = door.x * TILE + off;
    return [{ x: x, y: a0, w: LEAF_T, h: l }, { x: x, y: a1 - l, w: LEAF_T, h: l }];
  };

  // Mobile racks ease out by (dx,dy) tiles and back once per period.
  AGV.moverRect = function (m, t) {
    var u = ((((t + (m.phase || 0)) % m.period) + m.period) % m.period) / m.period;
    var f = (1 - Math.cos(u * Math.PI * 2)) / 2;
    return { x: (m.x + m.dx * f) * TILE, y: (m.y + m.dy * f) * TILE, w: m.w * TILE, h: m.h * TILE };
  };

  AGV.areaAt = function (x, y) {
    var tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    for (var i = 0; i < areas.length; i++) {
      var a = areas[i];
      if (tx >= a.x && ty >= a.y && tx < a.x + a.w && ty < a.y + a.h) return a.name;
    }
    return '';
  };
})();
