// Peabody AGV Rally - game engine (boot, input, menus, race simulation, AI, items, cameras, HUD).
// The race simulation (createRace / step) is pure and runs headless in Node (see tools/sim.js).
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var AGV = root.AGV = root.AGV || {};

  // ===== Constants =====
  var TS = 16, VW = 320, VH = 180, DT = 1 / 60;
  var R = 9;                         // AGV collision radius
  var MAX_SPEED = 120, ACCEL = 150, BRAKE = 280, REV_MAX = 45, COAST = 70;
  var TURN = 2.9, DRIFT_TURN = 3.9;  // rad/s at full steering authority
  var HUMAN_STEER_IN = 7, HUMAN_STEER_OUT = 12, HUMAN_HISPEED_EASE = 0.12;   // human steering ramp (per s), top-speed ease
  var GRIP = 11, GRIP_VINYL = 4.5, GRIP_DRIFT = 2.4, GRIP_DRIFT_VINYL = 1.6;
  var ESTOP_V = 70, BOXLOSS_V = 95, ESTOP_T = 0.4;
  var BOX_PENALTY = 2.0, MAX_BOXES = 4;
  var COUNTDOWN = 3;
  var EHS_TEXT = 'CALL EHS!';         // player-facing name of an E-STOP
  var BOOST_T = 1.2, BOOST_MUL = 1.6, SLOW_T = 1.0, SPIN_T = 0.6, PING_T = 1.0;
  var PICKUP_RESPAWN = 6;
  var ITEMS = ['boost', 'wrap', 'peanuts', 'box', 'ping'];
  var COLORS = [
    { name: 'RED', c: '#ff4a4a' }, { name: 'BLUE', c: '#3a9bff' }, { name: 'GREEN', c: '#3ee070' },
    { name: 'YELLOW', c: '#ffd23a' }, { name: 'PINK', c: '#ff6fd2' }, { name: 'ORANGE', c: '#ff9124' }
  ];
  var CPU_NAMES = ['AGV-07', 'AGV-12', 'AGV-21', 'AGV-33'];
  var RUN_KEYS = ['stockroom', 'decon', 'double'];
  var BEST_KEY = 'agvRally.best.v1';

  // ===== Utilities =====
  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angDiff(a, b) { var d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  function ordinal(n) { return n + (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(t) {
    if (t == null || !isFinite(t)) return '--:--.--';
    var cs = Math.floor(t * 100 + 1e-6), m = Math.floor(cs / 6000), s = Math.floor(cs / 100) % 60;
    return pad2(m) + ':' + pad2(s) + '.' + pad2(cs % 100);
  }
  function fmtDiff(d) { return (d < 0 ? '-' : '+') + Math.abs(d).toFixed(2); }

  // Guarded audio: a no-op when AGV.sfx (or a function on it) is missing, e.g. in Node.
  function sfxCall(fn, a, b) {
    var s = AGV.sfx;
    if (!s || typeof s[fn] !== 'function') return;
    try { s[fn](a, b); } catch (e) { /* audio must never break the game */ }
  }
  // Race sound: only when the race has audio enabled and the event concerns a human (or r is null = global).
  function snd(race, name, r) {
    if (!race.audio) return;
    if (r && !r.human) return;
    sfxCall('play', name);
  }

  // ===== Best times (localStorage, every access guarded) =====
  function loadBest() {
    try {
      var ls = root.localStorage;
      var s = ls && ls.getItem(BEST_KEY);
      var o = s ? JSON.parse(s) : {};
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }
  function saveBest(b) {
    try { if (root.localStorage) root.localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ }
  }
  function bestKey(runKey, mode) { return runKey + ':' + mode; }

  // ===== Map helpers =====
  function T() { return AGV.T || { VINYL: 2 }; }
  function tileAt(px, py) { return AGV.map.at(Math.floor(px / TS), Math.floor(py / TS)); }
  function solidAt(px, py) { return AGV.isSolid(tileAt(px, py)); }
  function boxClear(x, y, rad) {
    return !solidAt(x - rad, y - rad) && !solidAt(x + rad, y - rad) && !solidAt(x - rad, y + rad) && !solidAt(x + rad, y + rad) && !solidAt(x, y);
  }

  // ===== Race setup =====
  function createRace(runKey, mode, opts) {
    opts = opts || {};
    mode = mode || '1p';
    var map = AGV.map, run = map.runs[runKey];
    if (!run) throw new Error('Unknown run: ' + runKey);
    var nHumans = opts.humans != null ? opts.humans : (mode === '2p' ? 2 : 1);
    var total = mode === 'tt' ? 1 : 4;
    nHumans = Math.min(nHumans, total);
    var seed = opts.seed != null ? opts.seed : ((Date.now() ^ 0x5bd1e995) >>> 0);
    var rand = mulberry32(seed);

    var race = {
      run: run, runKey: runKey, mode: mode, seed: seed, rand: rand,
      t: 0, clock: 0, phase: 'countdown', countdown: COUNTDOWN, lastCount: COUNTDOWN + 1, goT: 0,
      done: false, humansDone: false, timeLimit: opts.timeLimit || 600,
      audio: opts.audio !== undefined ? !!opts.audio : nHumans > 0,
      fx: nHumans > 0, nHumans: nHumans,
      racers: [], order: [], drops: [], particles: [], floats: [], rings: [],
      pickups: (map.pickups || []).map(function (p) { return { x: p.x, y: p.y, cool: 0 }; }),
      staticSolids: [], solids: [], doorFracs: [], moverRects: [],
      finishCount: 0, prevBest: opts.prevBest || null
    };
    (map.props || []).forEach(function (p) {
      if (p.solid) race.staticSolids.push({ x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h });
    });
    // AI line-of-sight also avoids the area mobile racks sweep through (doors are handled by the whiskers).
    var aiSolids = race.staticSolids.slice();
    (map.movers || []).forEach(function (m) {
      var x0 = Math.min(m.x, m.x + m.dx), y0 = Math.min(m.y, m.y + m.dy);
      aiSolids.push({ x: x0 * TS, y: y0 * TS, w: (m.w + Math.abs(m.dx)) * TS, h: (m.h + Math.abs(m.dy)) * TS });
    });
    race.block = buildBlockGrid(aiSolids);

    // Route geometry: start point and cumulative length to each waypoint (used for rubber-banding).
    var g = run.grid, sx = 0, sy = 0;
    g.forEach(function (s) { sx += s.x; sy += s.y; });
    race.start = { x: sx / g.length, y: sy / g.length };
    race.cum = [];
    var px = race.start.x, py = race.start.y, acc = 0;
    run.waypoints.forEach(function (w) { acc += dist(px, py, w.x, w.y); race.cum.push(acc); px = w.x; py = w.y; });

    // Slots: TT uses pole; 1P human starts at the back, 2P humans in the last row.
    var humanSlots = mode === 'tt' ? [0] : mode === '2p' ? [2, 3] : [3];
    var colors = opts.colors || [];
    var used = {};
    for (var h = 0; h < nHumans; h++) used[colors[h] != null ? colors[h] : h] = true;
    var cpuColors = [];
    for (var c = 0; c < COLORS.length; c++) if (!used[c]) cpuColors.push(c);
    var skills = shuffle([1.0, 0.96, 0.92, 0.88], rand);
    var offsets = shuffle([-12, -5, 5, 12], rand);

    var slots = [];
    if (nHumans > 0) {
      for (h = 0; h < nHumans; h++) slots.push({ human: true, hIndex: h, slot: humanSlots[h] });
    }
    var free = [];
    for (var s = 0; s < total; s++) if (!slots.some(function (o) { return o.slot === s; })) free.push(s);
    var ci = 0;
    free.forEach(function (sl) { slots.push({ human: false, slot: sl, cpu: ci++ }); });

    slots.forEach(function (o, idx) {
      var gs = g[o.slot % g.length];
      var colorIdx = o.human ? (colors[o.hIndex] != null ? colors[o.hIndex] : o.hIndex) : cpuColors[o.cpu % cpuColors.length];
      race.racers.push({
        id: idx, human: o.human, hIndex: o.human ? o.hIndex : -1,
        name: o.human ? 'P' + (o.hIndex + 1) : CPU_NAMES[o.cpu % CPU_NAMES.length],
        tag: o.human ? 'P' + (o.hIndex + 1) : '',
        color: COLORS[colorIdx].c, colorIdx: colorIdx,
        x: gs.x, y: gs.y, angle: gs.angle || 0, vx: 0, vy: 0, speed: 0,
        boxes: MAX_BOXES, boxesLost: 0, finished: false, finishTime: 0, finalTime: 0, finishOrder: 0,
        wp: 0, dnext: 0, place: idx + 1, splits: [],
        item: null, prevItem: false,
        estop: false, estopT: 0, immuneT: 0, boxCD: 0, bumpCD: 0,
        boostT: 0, slowT: 0, spinT: 0, wobble: 0, drifting: false, slip: 0, steerIn: 0,
        impact: 0, impNx: 0, impNy: 0,
        estops: 0, bestD: Infinity, noProgT: 0, stuckMax: 0, progressed: false,
        wrongT: 0, wrongWay: false, popup: null,
        skill: o.human ? 1 : skills[o.cpu % skills.length], band: 1,
        ai: { offset: o.human ? 0 : offsets[o.cpu % offsets.length], offScale: 1, stuck: 0, ax: gs.x, ay: gs.y, npNext: 4, revT: 0, revSteer: 0, fwdT: 0, recoverN: 0, itemT: 0 }
      });
    });
    race.racers.forEach(function (r) {
      var w = run.waypoints[0];
      r.bestD = dist(r.x, r.y, w.x, w.y);
      r.dnext = r.bestD;
    });
    updateDynamic(race);
    rankRacers(race);
    return race;
  }
  // Tile grid marking walls and tiles touched by solid props (conservative; used for CPU line-of-sight).
  function buildBlockGrid(solids) {
    var map = AGV.map, W = map.W, H = map.H, g = new Uint8Array(W * H), x, y;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (AGV.isSolid(map.at(x, y))) g[y * W + x] = 1;
    solids.forEach(function (q) {
      for (y = Math.floor(q.y / TS); y <= Math.floor((q.y + q.h - 0.01) / TS); y++) {
        for (x = Math.floor(q.x / TS); x <= Math.floor((q.x + q.w - 0.01) / TS); x++) {
          if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = 1;
        }
      }
    });
    return g;
  }
  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }

  // ===== Dynamic world (doors, movers) =====
  function updateDynamic(race) {
    var map = AGV.map, t = race.clock;
    race.solids = race.staticSolids.slice();
    race.doorFracs = [];
    (map.doors || []).forEach(function (d, i) {
      var f = AGV.doorOpen ? AGV.doorOpen(d, t) : 1;
      race.doorFracs[i] = f;
      var leaves = AGV.doorLeaves ? AGV.doorLeaves(d, f) : [];
      for (var k = 0; k < leaves.length; k++) if (leaves[k].w > 0.5 && leaves[k].h > 0.5) race.solids.push(leaves[k]);
    });
    race.moverRects = [];
    (map.movers || []).forEach(function (m, i) {
      var rc = AGV.moverRect ? AGV.moverRect(m, t) : null;
      race.moverRects[i] = rc;
      if (rc) race.solids.push(rc);
    });
  }

  // ===== Collision =====
  // Push circle r out of an AABB; slide along it. Records the impact (normal speed into the surface).
  function pushOutRect(r, rx, ry, rw, rh, restitution) {
    var cx = clamp(r.x, rx, rx + rw), cy = clamp(r.y, ry, ry + rh);
    var dx = r.x - cx, dy = r.y - cy, d2 = dx * dx + dy * dy;
    if (d2 >= R * R) return;
    var nx, ny, pen;
    if (d2 > 1e-8) {
      var d = Math.sqrt(d2); nx = dx / d; ny = dy / d; pen = R - d;
    } else {
      // Center inside the rect: push out along the minimum axis.
      var l = r.x - rx, rr = rx + rw - r.x, t = r.y - ry, b = ry + rh - r.y, m = Math.min(l, rr, t, b);
      if (m === l) { nx = -1; ny = 0; } else if (m === rr) { nx = 1; ny = 0; } else if (m === t) { nx = 0; ny = -1; } else { nx = 0; ny = 1; }
      pen = m + R;
    }
    r.x += nx * pen; r.y += ny * pen;
    var vn = r.vx * nx + r.vy * ny;
    if (vn < 0) {
      var e = restitution == null ? 0.15 : restitution;
      r.vx -= (1 + e) * vn * nx; r.vy -= (1 + e) * vn * ny;
      r.vx *= 0.985; r.vy *= 0.985;  // light wall friction while sliding
      if (-vn > r.impact) { r.impact = -vn; r.impNx = nx; r.impNy = ny; }
    }
  }
  function collideTiles(r) {
    var map = AGV.map, isSolid = AGV.isSolid;
    var x0 = Math.floor((r.x - R) / TS), x1 = Math.floor((r.x + R) / TS);
    var y0 = Math.floor((r.y - R) / TS), y1 = Math.floor((r.y + R) / TS);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (isSolid(map.at(tx, ty))) pushOutRect(r, tx * TS, ty * TS, TS, TS);
      }
    }
  }
  function collideWorld(race, r) {
    var s = race.solids;
    for (var i = 0; i < s.length; i++) {
      var q = s[i];
      if (r.x + R < q.x || r.x - R > q.x + q.w || r.y + R < q.y || r.y - R > q.y + q.h) continue;
      pushOutRect(r, q.x, q.y, q.w, q.h);
    }
    collideTiles(r);   // tiles last: a racer never ends up inside a wall
  }
  function moveRacer(race, r, dt) {
    var sp = Math.sqrt(r.vx * r.vx + r.vy * r.vy);
    var n = Math.max(1, Math.ceil(sp * dt / 4));   // sub-steps of at most 4 px: no tunnelling
    var h = dt / n;
    for (var k = 0; k < n; k++) {
      r.x += r.vx * h; r.y += r.vy * h;
      collideWorld(race, r);
    }
  }
  function collideRacers(race) {
    var rs = race.racers;
    for (var i = 0; i < rs.length; i++) {
      var a = rs[i];
      if (a.finished) continue;
      for (var j = i + 1; j < rs.length; j++) {
        var b = rs[j];
        if (b.finished) continue;
        var dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R) continue;
        var d = Math.sqrt(d2), nx, ny;
        if (d < 1e-4) { nx = 1; ny = 0; d = 0; } else { nx = dx / d; ny = dy / d; }
        var pen = (2 * R - d) / 2;
        a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
        var vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vrel > 0) {
          var jimp = vrel * 1.3 / 2;
          a.vx -= jimp * nx; a.vy -= jimp * ny; b.vx += jimp * nx; b.vy += jimp * ny;
          if (vrel > a.impact) { a.impact = vrel; a.impNx = -nx; a.impNy = -ny; }
          if (vrel > b.impact) { b.impact = vrel; b.impNx = nx; b.impNy = ny; }
        }
        collideTiles(a); collideTiles(b);
      }
    }
  }
  // Is a probe circle blocked by anything solid (tiles, props, doors, movers) or a floor hazard?
  function blockedAt(race, x, y, rad, self) {
    if (!boxClear(x, y, rad)) return true;
    var s = race.solids;
    for (var i = 0; i < s.length; i++) {
      var q = s[i];
      if (x + rad > q.x && x - rad < q.x + q.w && y + rad > q.y && y - rad < q.y + q.h) return true;
    }
    var dr = race.drops;
    for (i = 0; i < dr.length; i++) {
      if (dr[i].owner === self && dr[i].armT > 0) continue;
      var rr = rad + dr[i].r;
      if (Math.abs(dr[i].x - x) < rr && Math.abs(dr[i].y - y) < rr) return true;
    }
    return false;
  }

  // ===== Effects (visual only; skipped headless) =====
  function addParticles(race, x, y, color, n, spd, life, size) {
    if (!race.fx) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = spd * (0.4 + Math.random() * 0.6);
      race.particles.push({ x: x, y: y, z: 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + Math.random() * 0.4), color: color, size: size || 1 });
    }
    if (race.particles.length > 400) race.particles.splice(0, race.particles.length - 400);
  }
  // (x, y) = the AGV's position. x/y drift up the screen for the top-down fallback; wx/wy stay put as the 3D anchor.
  function addFloat(race, x, y, text, color) {
    if (!race.fx) return;
    race.floats.push({ x: x, y: y - 14, wx: x, wy: y, text: text, color: color || '#ffffff', life: 1.2 });
  }
  function setPopup(r, text, sub, color) { r.popup = { text: text, sub: sub || '', color: color || '#ffe14a', t: 2.0 }; }

  // ===== E-STOP (shown to players as "CALL EHS!"), boxes, hazards =====
  function triggerEstop(race, r, dur) {
    r.estopT = Math.max(r.estopT, dur);
    r.estop = true;
    r.estops++;
    r.vx = 0; r.vy = 0; r.speed = 0;
    r.ai.stuck = 0;
    snd(race, 'estop', r);
    addFloat(race, r.x, r.y, EHS_TEXT, '#ffd23a');   // top-down only: the 3D view shows its own EHS sign
  }
  function placeDrop(race, x, y, ax, ay, dist0) {
    // Find a clear floor spot near (x,y) along direction (ax,ay), falling back to rotations around it.
    for (var k = 0; k < 8; k++) {
      var a = Math.atan2(ay, ax) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.7;
      var px = x + Math.cos(a) * dist0, py = y + Math.sin(a) * dist0;
      if (boxClear(px, py, 6)) return { x: px, y: py };
    }
    return { x: x, y: y };
  }
  function loseBox(race, r) {
    if (r.boxes <= 0 || r.boxCD > 0) return;
    r.boxes--; r.boxesLost++;
    r.boxCD = 1.0;
    var ax = r.impNx || -Math.cos(r.angle), ay = r.impNy || -Math.sin(r.angle);
    var p = placeDrop(race, r.x, r.y, ax, ay, 16);
    race.drops.push({ kind: 'box', x: p.x, y: p.y, r: 5, owner: r, armT: 1.0, life: Infinity });
    r.wobble = clamp(r.wobble + (race.rand() < 0.5 ? -0.8 : 0.8), -1, 1);
    snd(race, 'boxlost', r);
    addFloat(race, r.x, r.y, '-1 BOX', '#ffffff');
    addParticles(race, r.x, r.y, '#f4f4f4', 6, 40, 0.5, 2);
  }
  function handleImpact(race, r) {
    if (r.impact <= 0) return;
    var imp = r.impact;
    if (r.immuneT <= 0 && r.estopT <= 0) {
      if (imp > BOXLOSS_V) loseBox(race, r);
      if (imp > ESTOP_V) { triggerEstop(race, r, ESTOP_T); addParticles(race, r.x, r.y, '#ffd23a', 8, 60, 0.4, 1); return; }
    }
    if (imp > 25 && r.bumpCD <= 0) {
      r.bumpCD = 0.3;
      snd(race, 'bump', r);
      addParticles(race, r.x - r.impNx * R, r.y - r.impNy * R, '#ffe9a0', 3, 35, 0.3, 1);
    }
    r.wobble = clamp(r.wobble + clamp(imp / 150, 0, 0.6) * (r.impNx * Math.sin(r.angle) - r.impNy * Math.cos(r.angle) >= 0 ? 1 : -1), -1, 1);
  }
  function updateDrops(race, dt) {
    var dr = race.drops, rs = race.racers;
    for (var i = dr.length - 1; i >= 0; i--) {
      var d = dr[i];
      d.armT -= dt; d.life -= dt;
      if (d.life <= 0) { dr.splice(i, 1); continue; }
      for (var k = 0; k < rs.length; k++) {
        var r = rs[k];
        if (r.finished || (d.owner === r && d.armT > 0)) continue;
        if (dist(r.x, r.y, d.x, d.y) > R + d.r) continue;
        if (d.kind === 'box') {
          r.vx *= 0.45; r.vy *= 0.45;
          snd(race, 'bump', r);
          addParticles(race, d.x, d.y, '#e8e0d0', 6, 40, 0.4, 2);
        } else if (d.kind === 'wrap') {
          r.slowT = SLOW_T; r.vx *= 0.5; r.vy *= 0.5;
          snd(race, 'bump', r);
          addFloat(race, r.x, r.y, 'STUCK!', '#bfe8ff');
        } else if (d.kind === 'peanuts') {
          r.spinT = SPIN_T; r.vx *= 0.6; r.vy *= 0.6;
          r.impNx = 0; r.impNy = 0;
          r.boxCD = 0;
          loseBox(race, r);
          addParticles(race, d.x, d.y, '#fff6d8', 10, 50, 0.5, 2);
        }
        dr.splice(i, 1);
        break;
      }
    }
  }

  // ===== Items =====
  function rollItem(race, r) {
    if (race.mode === 'tt' || race.racers.length < 2) return r.boxes < MAX_BOXES && race.rand() < 0.3 ? 'box' : 'boost';
    var n = race.racers.length, f = (r.place - 1) / (n - 1);   // 0 = leader, 1 = last
    var w = {
      boost: 2 + 3 * f, wrap: 2.5 - f, peanuts: 2.5 - f,
      box: 1 + (r.boxes < MAX_BOXES ? 1.5 : 0), ping: r.place === 1 ? 0.3 : 0.6 + 2.4 * f
    };
    var sum = 0, k;
    for (k in w) sum += w[k];
    var x = race.rand() * sum;
    for (var i = 0; i < ITEMS.length; i++) { x -= w[ITEMS[i]]; if (x <= 0) return ITEMS[i]; }
    return 'boost';
  }
  function pingTarget(race, r) {
    var order = race.order, idx = order.indexOf(r), i;
    for (i = idx - 1; i >= 0; i--) if (!order[i].finished) return order[i];
    for (i = idx + 1; i < order.length; i++) if (!order[i].finished) return order[i];
    return null;
  }
  function useItem(race, r) {
    var it = r.item;
    if (!it) return;
    r.item = null;
    var bx = -Math.cos(r.angle), by = -Math.sin(r.angle);
    if (it === 'boost') {
      r.boostT = BOOST_T;
      var fs = r.vx * Math.cos(r.angle) + r.vy * Math.sin(r.angle);
      var add = Math.max(0, 60 - Math.max(0, fs) * 0.3);
      r.vx += Math.cos(r.angle) * add; r.vy += Math.sin(r.angle) * add;
      snd(race, 'boost', r);
    } else if (it === 'wrap' || it === 'peanuts') {
      var p = placeDrop(race, r.x, r.y, bx, by, 20);
      race.drops.push({ kind: it, x: p.x, y: p.y, r: 9, owner: r, armT: 0.8, life: 30 });
      snd(race, 'drop', r);
    } else if (it === 'box') {
      r.boxes = Math.min(MAX_BOXES, r.boxes + 1);
      snd(race, 'pickup', r);
      addFloat(race, r.x, r.y, '+1 BOX', '#9fffb0');
    } else if (it === 'ping') {
      var tgt = pingTarget(race, r);
      race.rings.push({ x: r.x, y: r.y, life: 0.5, max: 0.5, rad: 60, color: '#7ff7ff' });
      snd(race, 'ping', r);
      if (tgt) {
        triggerEstop(race, tgt, PING_T);
        tgt.vx = 0; tgt.vy = 0;
        race.rings.push({ x: tgt.x, y: tgt.y, life: 0.7, max: 0.7, rad: 28, color: '#ff5050' });
        if (tgt.human) snd(race, 'ping', tgt);
      }
    }
  }
  function updatePickups(race, dt) {
    var ps = race.pickups, rs = race.racers;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p.cool > 0) { p.cool -= dt; continue; }
      for (var k = 0; k < rs.length; k++) {
        var r = rs[k];
        if (r.finished || r.item || dist(r.x, r.y, p.x, p.y) > R + 10) continue;
        r.item = rollItem(race, r);
        r.ai.itemT = 0.5 + race.rand() * 2.5;
        p.cool = PICKUP_RESPAWN;
        snd(race, 'pickup', r);
        addParticles(race, p.x, p.y, '#ffe14a', 8, 50, 0.4, 1);
        break;
      }
    }
  }

  // ===== Racer physics =====
  function controlsFromInput(inp) {
    inp = inp || {};
    return {
      throttle: inp.up ? 1 : 0, brake: inp.down ? 1 : 0,
      steer: (inp.right ? 1 : 0) - (inp.left ? 1 : 0),
      drift: !!inp.drift, item: !!inp.item
    };
  }
  function updateRacer(race, r, c, dt) {
    r.immuneT = Math.max(0, r.immuneT - dt);
    r.boxCD = Math.max(0, r.boxCD - dt);
    r.bumpCD = Math.max(0, r.bumpCD - dt);
    r.boostT = Math.max(0, r.boostT - dt);
    r.slowT = Math.max(0, r.slowT - dt);
    r.impact = 0;
    if (r.estopT > 0) {
      r.estopT -= dt;
      if (r.estopT <= 0) { r.estopT = 0; r.estop = false; r.immuneT = 0.8; }
    }
    if (race.phase !== 'race' || r.estopT > 0) {
      r.vx = 0; r.vy = 0; r.speed = 0; r.drifting = false; r.steerIn = 0;
      r.wobble *= Math.exp(-3 * dt);
      collideWorld(race, r);      // doors/movers can still push a stopped AGV
      r.impact = 0;
      return;
    }
    if (r.finished) c = { throttle: 0, brake: 0, steer: 0, drift: false, item: false };

    var vinyl = tileAt(r.x, r.y) === T().VINYL;
    var maxSp = MAX_SPEED * (r.human ? 1 : r.skill * r.band);
    if (r.boostT > 0) maxSp *= BOOST_MUL;
    if (r.slowT > 0) maxSp *= 0.3;

    // Steering (scaled by speed, reversed when backing up)
    var fs0 = r.vx * Math.cos(r.angle) + r.vy * Math.sin(r.angle);
    var steerIn = clamp(c.steer, -1, 1);
    if (r.human) {
      // Keyboard steering ramps in over ~0.15 s (and out faster) so taps make small corrections in the chase cam,
      // and full lock is eased off a little at top speed. CPUs steer directly.
      var rate = steerIn === 0 || sign(steerIn) !== sign(r.steerIn) ? HUMAN_STEER_OUT : HUMAN_STEER_IN;
      r.steerIn += clamp(steerIn - r.steerIn, -rate * dt, rate * dt);
      steerIn = r.steerIn * (1 - HUMAN_HISPEED_EASE * clamp((Math.abs(fs0) - 60) / 60, 0, 1));
    }
    var steer = r.spinT > 0 ? 0 : steerIn;
    var drift = c.drift && fs0 > 40 && Math.abs(steer) > 0.2;
    var scale = clamp(Math.abs(fs0) / 45, 0, 1), dir = fs0 >= 0 ? 1 : -1;
    r.angle += steer * (drift ? DRIFT_TURN : TURN) * scale * dir * dt;
    if (r.spinT > 0) { r.spinT -= dt; r.angle += 13 * dt; }
    r.angle = angDiff(r.angle, 0);

    // Re-project velocity on the new heading: forward speed + lateral slip
    var cs = Math.cos(r.angle), sn = Math.sin(r.angle);
    var fs = r.vx * cs + r.vy * sn, ls = -r.vx * sn + r.vy * cs;
    if (r.finished) {
      fs = fs > 0 ? Math.max(0, fs - BRAKE * 0.5 * dt) : Math.min(0, fs + BRAKE * 0.5 * dt);
    } else if (c.throttle > 0) {
      if (fs < 0) fs += BRAKE * dt;
      else if (fs < maxSp) fs = Math.min(maxSp, fs + ACCEL * c.throttle * (r.boostT > 0 ? 2.2 : 1) * dt);
    } else if (c.brake > 0) {
      if (fs > 3) fs = Math.max(0, fs - BRAKE * dt);
      else fs = Math.max(-REV_MAX, fs - ACCEL * 0.6 * dt);
    } else {
      fs = fs > 0 ? Math.max(0, fs - COAST * dt) : Math.min(0, fs + COAST * dt);
    }
    if (fs > maxSp) fs = Math.max(maxSp, fs - 220 * dt);
    if (drift) fs -= 22 * dt;
    var grip = vinyl ? (drift ? GRIP_DRIFT_VINYL : GRIP_VINYL) : (drift ? GRIP_DRIFT : GRIP);
    ls *= Math.exp(-grip * dt);
    r.vx = cs * fs - sn * ls; r.vy = sn * fs + cs * ls;
    r.speed = fs; r.drifting = drift; r.slip = ls;

    // Box wobble: rises with sharp steering / drifting, decays otherwise
    r.wobble += steer * scale * (drift ? 3.2 : 1.0) * dt;
    if (r.spinT > 0) r.wobble += 4 * dt;
    r.wobble = clamp(r.wobble * Math.exp(-2.5 * dt), -1, 1);

    if (race.fx) {
      if (drift && Math.abs(ls) > 8 && Math.random() < 0.6) {
        addParticles(race, r.x - cs * 10 + sn * 6 * sign(ls), r.y - sn * 10 - cs * 6 * sign(ls), Math.random() < 0.5 ? '#ffd23a' : '#ff8a2a', 1, 30, 0.25, 1);
      }
      if (r.boostT > 0 && Math.random() < 0.7) addParticles(race, r.x - cs * 12, r.y - sn * 12, '#7fd8ff', 1, 20, 0.3, 1);
    }

    // Items (edge-triggered)
    if (c.item && !r.prevItem && !r.finished) useItem(race, r);
    r.prevItem = c.item;

    moveRacer(race, r, dt);
  }

  // ===== Progress, wrong-way, ranking =====
  function advanceWaypoint(race, r) {
    var wps = race.run.waypoints, w = wps[r.wp];
    r.splits[r.wp] = race.t;
    if (r.human) {
      if (w.label && r.wp < wps.length - 1) {
        snd(race, 'checkpoint', r);
        var text = /!$/.test(w.label) ? w.label : w.label + '!';
        var sub = '';
        var pb = race.prevBest;
        if (race.mode === 'tt' && pb && pb.splits && pb.splits[r.wp] != null) sub = 'SPLIT ' + fmtDiff(race.t - pb.splits[r.wp]);
        setPopup(r, text, sub);
      }
    }
    r.wp++;
    r.progressed = true;
    if (r.wp >= wps.length) {
      r.finished = true;
      r.finishTime = race.t;
      r.finishOrder = ++race.finishCount;
      r.finalTime = r.finishTime + BOX_PENALTY * (MAX_BOXES - r.boxes);
      r.estop = false; r.estopT = 0; r.wrongWay = false;
      if (r.human) {
        snd(race, 'finish', r);
        setPopup(r, 'FINISH!', race.mode === 'tt' ? '' : ordinal(r.finishOrder) + ' PLACE', '#ffffff');
      }
    } else {
      var n = wps[r.wp];
      r.bestD = dist(r.x, r.y, n.x, n.y);
    }
  }
  function updateProgress(race, r, dt) {
    r.progressed = false;
    if (r.finished) return;
    var wps = race.run.waypoints, n = wps.length;
    for (var guard = 0; guard < 4 && !r.finished; guard++) {
      var w = wps[r.wp];
      if (dist(r.x, r.y, w.x, w.y) <= w.r) { advanceWaypoint(race, r); continue; }
      // Lenient skip: inside the NEXT waypoint's radius while the current (unlabelled) one was missed.
      var w2 = wps[r.wp + 1];
      if (w2 && !w.label && dist(r.x, r.y, w2.x, w2.y) <= w2.r) { advanceWaypoint(race, r); continue; }
      break;
    }
    if (r.finished) return;
    var nw = wps[r.wp];
    var d = dist(r.x, r.y, nw.x, nw.y);
    r.dnext = d;
    if (race.phase !== 'race') return;
    if (d < r.bestD - 4) { r.bestD = d; r.progressed = true; }
    if (r.progressed) r.noProgT = 0;
    else { r.noProgT += dt; if (r.noProgT > r.stuckMax) r.stuckMax = r.noProgT; }

    if (r.human) {
      var hx = Math.cos(r.angle), hy = Math.sin(r.angle);
      var dot = (hx * (nw.x - r.x) + hy * (nw.y - r.y)) / (d || 1);
      if (dot < -0.25 && Math.abs(r.speed) > 15) r.wrongT += dt;
      else r.wrongT = Math.max(0, r.wrongT - 2 * dt);
      r.wrongWay = r.wrongT > 1.5;
    }
  }
  function rankRacers(race) {
    var arr = race.racers.slice();
    arr.sort(function (a, b) {
      if (a.finished || b.finished) {
        if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
        return a.finished ? -1 : 1;
      }
      if (a.wp !== b.wp) return b.wp - a.wp;
      return a.dnext - b.dnext || a.id - b.id;
    });
    for (var i = 0; i < arr.length; i++) arr[i].place = i + 1;
    race.order = arr;
  }
  function routeProgress(race, r) {
    if (r.finished) return race.cum[race.cum.length - 1] + 1000 - r.finishOrder;
    return race.cum[Math.min(r.wp, race.cum.length - 1)] - r.dnext;
  }

  // ===== CPU AI =====
  function probe(race, r, ang, len) {
    var cx = Math.cos(ang), cy = Math.sin(ang);
    for (var t = 8; t <= len; t += 7) {
      if (blockedAt(race, r.x + cx * t, r.y + cy * t, 6, r)) return t / len;
    }
    return 1;
  }
  function blockPt(race, x, y) {
    var W = AGV.map.W, tx = Math.floor(x / TS), ty = Math.floor(y / TS);
    if (tx < 0 || ty < 0 || tx >= W || ty >= AGV.map.H) return true;
    return race.block[ty * W + tx] === 1;
  }
  function losClear(race, x0, y0, x1, y1, rad) {
    var dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1) return true;
    dx /= L; dy /= L;
    for (var t = Math.min(8, L); t <= L; t += 6) {
      var x = x0 + dx * t, y = y0 + dy * t;
      if (blockPt(race, x - rad, y - rad) || blockPt(race, x + rad, y - rad) ||
          blockPt(race, x - rad, y + rad) || blockPt(race, x + rad, y + rad)) return false;
    }
    return true;
  }
  // BFS distance field (in tiles) toward waypoint wi over unblocked tiles; built lazily, cached per race.
  function flowField(race, wi) {
    var cache = race.flow || (race.flow = {});
    if (cache[wi]) return cache[wi];
    var map = AGV.map, W = map.W, H = map.H, blk = race.block;
    var d = new Int16Array(W * H).fill(-1), q = new Int32Array(W * H), qh = 0, qt = 0;
    var w = race.run.waypoints[wi], sx = Math.floor(w.x / TS), sy = Math.floor(w.y / TS);
    for (var oy = -2; oy <= 2; oy++) for (var ox = -2; ox <= 2; ox++) {
      var tx = sx + ox, ty = sy + oy;
      if (tx >= 0 && ty >= 0 && tx < W && ty < H && !blk[ty * W + tx] && Math.abs(ox) + Math.abs(oy) <= 2) { d[ty * W + tx] = 0; q[qt++] = ty * W + tx; }
    }
    while (qh < qt) {
      var c = q[qh++], cx = c % W, cy = (c - cx) / W, nd = d[c] + 1;
      if (cx > 0 && d[c - 1] < 0 && !blk[c - 1]) { d[c - 1] = nd; q[qt++] = c - 1; }
      if (cx < W - 1 && d[c + 1] < 0 && !blk[c + 1]) { d[c + 1] = nd; q[qt++] = c + 1; }
      if (cy > 0 && d[c - W] < 0 && !blk[c - W]) { d[c - W] = nd; q[qt++] = c - W; }
      if (cy < H - 1 && d[c + W] < 0 && !blk[c + W]) { d[c + W] = nd; q[qt++] = c + W; }
    }
    cache[wi] = d;
    return d;
  }
  // Follow the flow field downhill a few tiles; return the furthest point still in line of sight.
  function flowTarget(race, r, wi) {
    var d = flowField(race, wi), W = AGV.map.W, H = AGV.map.H;
    var tx = Math.floor(r.x / TS), ty = Math.floor(r.y / TS), c = ty * W + tx;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
    if (d[c] < 0) {   // standing on a blocked tile (e.g. a mover lane): start from the best neighbour
      var best = -1;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        var nc = (ty + oy) * W + tx + ox;
        if (ty + oy >= 0 && ty + oy < H && tx + ox >= 0 && tx + ox < W && d[nc] >= 0 && (best < 0 || d[nc] < d[best])) best = nc;
      }
      if (best < 0) return null;
      c = best;
    }
    var out = { x: (c % W + 0.5) * TS, y: (Math.floor(c / W) + 0.5) * TS };
    for (var k = 0; k < 8 && d[c] > 0; k++) {
      var cx = c % W, nbrs = [c - 1, c + 1, c - W, c + W], nxt = -1;
      for (var j = 0; j < 4; j++) {
        var n2 = nbrs[j];
        if ((j === 0 && cx === 0) || (j === 1 && cx === W - 1) || n2 < 0 || n2 >= W * H) continue;
        if (d[n2] >= 0 && d[n2] < d[c] && (nxt < 0 || d[n2] < d[nxt])) nxt = n2;
      }
      if (nxt < 0) break;
      c = nxt;
      var px = (c % W + 0.5) * TS, py = (Math.floor(c / W) + 0.5) * TS;
      if (k > 0 && !losClear(race, r.x, r.y, px, py, 6)) break;
      out.x = px; out.y = py;
    }
    return out;
  }
  // When a door on the way is not fully open, line up on the centre gap and slow down.
  function doorAssist(race, r, w) {
    var ds = AGV.map.doors || [];
    for (var k = 0; k < ds.length; k++) {
      var f = race.doorFracs[k];
      if (f == null || f > 0.95) continue;
      var d = ds[k], h = d.axis === 'h', half = d.len * TS / 2;
      var cx = h ? (d.x * TS + half) : (d.x + 0.5) * TS, cy = h ? (d.y + 0.5) * TS : (d.y * TS + half);
      var along = h ? r.y - cy : r.x - cx, across = h ? r.x - cx : r.y - cy;
      var wAlong = h ? w.y - cy : w.x - cx;
      if (Math.abs(along) > 96 || Math.abs(along) < 4 || Math.abs(across) > half + 40) continue;
      if (sign(wAlong) === sign(along)) continue;     // next waypoint is on this side: not crossing
      var beyond = -sign(along) * 24;
      var aligned = Math.abs(across) < 6;
      return { x: h ? cx : cx + beyond, y: h ? cy + beyond : cy, speed: aligned ? 85 : 45 + Math.abs(along) * 0.4 };
    }
    return null;
  }
  function cpuControl(race, r, dt) {
    var ai = r.ai, c = { throttle: 0, brake: 0, steer: 0, drift: false, item: false };
    if (race.phase !== 'race' || r.finished || r.estopT > 0) return c;
    var wps = race.run.waypoints, n = wps.length, i = Math.min(r.wp, n - 1);
    var w = wps[i], wn = wps[Math.min(i + 1, n - 1)];
    var pv = i > 0 ? wps[i - 1] : race.start;

    // Look-ahead target: waypoint (+ lateral offset), blended toward the following one when close.
    var sx = w.x - pv.x, sy = w.y - pv.y, sl = Math.sqrt(sx * sx + sy * sy) || 1;
    // Keep right when another AGV is coming head-on (the Double run uses the Stockroom door both ways).
    // Also brake for a slower AGV directly ahead.
    var ch = Math.cos(r.angle), shd = Math.sin(r.angle), oncoming = false, follow = Infinity;
    for (var k = 0; k < race.racers.length; k++) {
      var o = race.racers[k];
      if (o === r || o.finished) continue;
      var ex = o.x - r.x, ey = o.y - r.y, ahead = ex * ch + ey * shd, lat = -ex * shd + ey * ch;
      var same = Math.cos(o.angle) * ch + Math.sin(o.angle) * shd;
      if (ahead > 0 && ahead < 110 && Math.abs(lat) < 28 && same < -0.5) oncoming = true;
      if (ahead > 0 && ahead < 64 && Math.abs(lat) < 20 && o.speed < r.speed - 8) {
        follow = Math.min(follow, Math.max(0, o.speed * same) + 15 + (ahead - 2 * R) * 1.6);
      }
    }
    ai.dodge = oncoming ? 0.6 : Math.max(0, (ai.dodge || 0) - dt);
    var off = ai.dodge > 0 ? 18 : ai.offset * ai.offScale * (i === n - 1 ? 0.3 : 1);
    var tx = w.x - (sy / sl) * off, ty = w.y + (sx / sl) * off;
    var ox = tx, oy = ty;
    var d = dist(r.x, r.y, w.x, w.y);
    if (i < n - 1) {
      var bl = clamp(1 - d / (w.r * 2.2), 0, 1) * 0.65;
      tx = lerp(tx, wn.x, bl); ty = lerp(ty, wn.y, bl);
    }
    // Line-of-sight fallback: blended point -> offset waypoint -> waypoint centre -> previous waypoint.
    if (!losClear(race, r.x, r.y, tx, ty, 7)) {
      if (losClear(race, r.x, r.y, ox, oy, 7)) { tx = ox; ty = oy; }
      else if (losClear(race, r.x, r.y, w.x, w.y, 7)) { tx = w.x; ty = w.y; }
      else {
        var ft = flowTarget(race, r, i);
        if (ft) { tx = ft.x; ty = ft.y; } else { tx = w.x; ty = w.y; }
      }
    }
    var door = doorAssist(race, r, w);
    if (door) { tx = door.x; ty = door.y; }
    var desired = Math.atan2(ty - r.y, tx - r.x);
    var diff = angDiff(desired, r.angle);
    var top = MAX_SPEED * r.skill * r.band;

    // Recovery manoeuvres when stuck
    if (ai.revT > 0) {
      ai.revT -= dt;
      c.brake = 1; c.steer = ai.revSteer;
      return c;
    }
    if (ai.fwdT > 0) {
      ai.fwdT -= dt;
      c.throttle = 0.6; c.steer = sign(diff) || 1;
      return c;
    }
    // Stuck = barely moved for 1.5 s, or no route progress for 4 s (orbiting / wedged).
    if (dist(r.x, r.y, ai.ax, ai.ay) > 14) { ai.ax = r.x; ai.ay = r.y; ai.stuck = 0; }
    else if (r.spinT <= 0) ai.stuck += dt;
    if (r.progressed) ai.npNext = 4;
    if (ai.stuck > 1.5 || r.noProgT > ai.npNext) {
      ai.stuck = 0; ai.ax = r.x; ai.ay = r.y;
      ai.npNext = r.noProgT + 2.5;
      ai.recoverN++;
      ai.recoverN++;
      var hc0 = probe(race, r, r.angle, 26);
      if (hc0 < 1 || ai.recoverN % 2 === 1) { ai.revT = 0.7; ai.revSteer = -(sign(diff) || 1); }
      else ai.fwdT = 0.6;
      return c;
    }

    var steer = clamp(diff * 2.6, -1, 1);
    // Corner anticipation: slow for sharp turns ahead and big heading errors.
    var turnAhead = 0;
    if (i < n - 1) {
      var a1 = Math.atan2(w.y - r.y, w.x - r.x), a2 = Math.atan2(wn.y - w.y, wn.x - w.x);
      turnAhead = Math.abs(angDiff(a2, a1)) * clamp(1 - (d - w.r) / 110, 0, 1);
    }
    var sharp = Math.max(Math.abs(diff), turnAhead * 0.8);
    var tgt = top * (1 - clamp((sharp - 0.35) / 1.6, 0, 0.5));
    if (oncoming) tgt = Math.min(tgt, top * 0.7);
    if (door) tgt = Math.min(tgt, door.speed);
    tgt = Math.min(tgt, follow);

    // Obstacle avoidance with three whiskers.
    var look = 22 + Math.max(0, r.speed) * 0.4;
    var hc = probe(race, r, r.angle, look);
    var hl = probe(race, r, r.angle - 0.5, look * 0.8);
    var hr = probe(race, r, r.angle + 0.5, look * 0.8);
    if (hl < 1) steer += (1 - hl) * 0.9;
    if (hr < 1) steer -= (1 - hr) * 0.9;
    if (hc < 1) {
      // The target is line-of-sight checked, so turn toward it; only use whisker clearance when it is dead ahead.
      var side = Math.abs(diff) > 0.15 ? sign(diff) : (hl > hr ? -1 : 1);
      steer += side * (1 - hc) * 1.6;
      tgt = Math.min(tgt, 35 + hc * top);
    }
    // Target behind and the way ahead blocked: three-point turn (reverse while turning).
    if (Math.abs(diff) > 2.0 && hc < 0.6 && r.speed < 40) {
      ai.revT = 0.5; ai.revSteer = -(sign(diff) || 1);
    }
    var blocked = hc < 1 || hl < 1 || hr < 1;
    ai.offScale = clamp(ai.offScale + (blocked ? -2 : 0.5) * dt, 0, 1);
    c.steer = clamp(steer, -1, 1);
    if (r.speed < tgt - 2) c.throttle = 1;
    else if (r.speed > tgt + 18) c.brake = 1;
    c.drift = Math.abs(diff) > 0.8 && r.speed > 75;

    // Items: use at sensible (randomised) moments.
    if (r.item) {
      ai.itemT -= dt;
      if (ai.itemT <= 0) {
        var use = false, it = r.item;
        if (it === 'box') use = r.boxes < MAX_BOXES || ai.itemT < -6;
        else if (it === 'boost') use = (Math.abs(diff) < 0.2 && hc >= 1 && turnAhead < 0.3) || ai.itemT < -10;
        else if (it === 'ping') use = pingTarget(race, r) !== null && (r.place > 1 || ai.itemT < -6);
        else {
          var behind = race.racers.some(function (o) {
            return o !== r && !o.finished && dist(o.x, o.y, r.x, r.y) < 90 &&
              ((o.x - r.x) * Math.cos(r.angle) + (o.y - r.y) * Math.sin(r.angle)) < 0;
          });
          use = behind || ai.itemT < -5;
        }
        if (use) c.item = true;
      }
    }
    return c;
  }
  function updateRubberBand(race) {
    if (race.nHumans <= 0) return;
    var lead = -Infinity;
    race.racers.forEach(function (r) { if (r.human) lead = Math.max(lead, routeProgress(race, r)); });
    race.racers.forEach(function (r) {
      if (r.human) return;
      var delta = routeProgress(race, r) - lead;
      r.band = clamp(1 - delta / 2500, 0.92, 1.05);
    });
  }

  // ===== Simulation step =====
  function step(race, dt, inputs) {
    dt = dt || DT;
    inputs = inputs || [];
    race.clock += dt;
    if (race.phase === 'countdown') {
      race.countdown -= dt;
      var nc = Math.ceil(race.countdown);
      if (nc < race.lastCount && nc > 0) { race.lastCount = nc; snd(race, 'count'); }
      if (race.countdown <= 0) { race.phase = 'race'; race.goT = 1.0; snd(race, 'go'); }
    } else if (!race.done) {
      race.t += dt;
    }
    race.goT = Math.max(0, race.goT - dt);
    updateDynamic(race);
    updateRubberBand(race);

    var rs = race.racers, i;
    for (i = 0; i < rs.length; i++) {
      var r = rs[i];
      var c = r.human ? controlsFromInput(inputs[r.hIndex]) : cpuControl(race, r, dt);
      updateRacer(race, r, c, dt);
    }
    collideRacers(race);
    for (i = 0; i < rs.length; i++) {
      if (race.phase === 'race' && !rs[i].finished) handleImpact(race, rs[i]);
      rs[i].impact = 0;
    }
    if (race.phase === 'race') {
      updateDrops(race, dt);
      updatePickups(race, dt);
    }
    for (i = 0; i < rs.length; i++) {
      updateProgress(race, rs[i], dt);
      if (rs[i].popup) { rs[i].popup.t -= dt; if (rs[i].popup.t <= 0) rs[i].popup = null; }
    }
    rankRacers(race);

    // Visual effects state
    var ps = race.particles;
    for (i = ps.length - 1; i >= 0; i--) {
      var p = ps[i];
      p.life -= dt; if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
    }
    for (i = race.floats.length - 1; i >= 0; i--) {
      var f = race.floats[i];
      f.life -= dt; f.y -= 14 * dt;
      if (f.life <= 0) race.floats.splice(i, 1);
    }
    for (i = race.rings.length - 1; i >= 0; i--) {
      race.rings[i].life -= dt;
      if (race.rings[i].life <= 0) race.rings.splice(i, 1);
    }

    var allDone = true, humansDone = race.nHumans > 0;
    for (i = 0; i < rs.length; i++) {
      if (!rs[i].finished) { allDone = false; if (rs[i].human) humansDone = false; }
    }
    race.humansDone = humansDone;
    if (allDone || race.t >= race.timeLimit) race.done = true;
    return race;
  }

  // ======================================================================
  // ===== Runtime (browser only below this line) =====
  // ======================================================================
  var S = null;         // runtime state, created in boot()
  var keys = {}, pressed = {};
  var GAME_KEYS = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, Enter: 1, NumpadEnter: 1,
    ShiftLeft: 1, ShiftRight: 1, Escape: 1, Tab: 1
  };
  var WASD = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1 };

  function hit(codes) { for (var i = 0; i < codes.length; i++) if (pressed[codes[i]]) return true; return false; }
  var K_UP = ['ArrowUp', 'KeyW'], K_DOWN = ['ArrowDown', 'KeyS'], K_LEFT = ['ArrowLeft', 'KeyA'], K_RIGHT = ['ArrowRight', 'KeyD'];
  var K_OK = ['Enter', 'NumpadEnter', 'Space'], K_BACK = ['Escape'];

  function onKeyDown(e) {
    if (!S) return;
    if (!S.unlocked) {
      S.unlocked = true;
      sfxCall('unlock');
      sfxCall('music', true);
    }
    if (GAME_KEYS[e.code] || (WASD[e.code] && (S.state === 'race' || S.state === 'pause'))) e.preventDefault();
    if (!e.repeat) pressed[e.code] = true;
    keys[e.code] = true;
    if (e.code === 'KeyM' && !e.repeat) sfxCall('toggleMute');
  }
  function onKeyUp(e) {
    keys[e.code] = false;
    if (GAME_KEYS[e.code]) e.preventDefault();
  }
  function humanInput(i) {
    var k = keys;
    if (!S.race || S.race.mode !== '2p') {
      return {
        up: k.KeyW || k.ArrowUp, down: k.KeyS || k.ArrowDown, left: k.KeyA || k.ArrowLeft, right: k.KeyD || k.ArrowRight,
        drift: k.ShiftLeft || k.ShiftRight, item: k.Space || k.Enter || k.NumpadEnter
      };
    }
    if (i === 0) return { up: k.KeyW, down: k.KeyS, left: k.KeyA, right: k.KeyD, drift: k.ShiftLeft, item: k.Space };
    return { up: k.ArrowUp, down: k.ArrowDown, left: k.ArrowLeft, right: k.ArrowRight, drift: k.ShiftRight, item: k.Enter || k.NumpadEnter };
  }

  // ----- Guarded gfx helpers (fallbacks keep the game usable if gfx.js is incomplete) -----
  var warned = {};
  function gfxFn(name) { var g = AGV.gfx; return g && typeof g[name] === 'function' ? g[name] : null; }
  function G(name) {
    var fn = gfxFn(name);
    if (!fn) return false;
    try { fn.apply(AGV.gfx, Array.prototype.slice.call(arguments, 1)); return true; }
    catch (e) { if (!warned[name]) { warned[name] = true; if (root.console) console.warn('gfx.' + name + ' failed:', e); } return false; }
  }
  function text(str, x, y, color, scale, align) {
    scale = scale || 1; align = align || 'left'; color = color || '#ffffff';
    if (G('textShadow', S.ctx, str, x, y, color, scale, align)) return;
    if (G('text', S.ctx, str, x, y, color, scale, align)) return;
    var ctx = S.ctx;
    ctx.fillStyle = color; ctx.font = (7 * scale) + 'px monospace';
    ctx.textAlign = align; ctx.textBaseline = 'top';
    ctx.fillText(str, x, y);
    ctx.textAlign = 'left';
  }
  function textPlain(str, x, y, color, scale, align) { text(str, x, y, color, scale, align); }
  // Text with a 1 px black outline on all four sides (readable over the textured 3D view).
  function textOutline(str, x, y, color, scale, align) {
    if (!gfxFn('text')) { text(str, x, y, color, scale, align); return; }
    var s = Math.max(1, Math.round(scale || 1));
    G('text', S.ctx, str, x - 1, y, '#000000', s, align); G('text', S.ctx, str, x + 1, y, '#000000', s, align);
    G('text', S.ctx, str, x, y - 1, '#000000', s, align); G('text', S.ctx, str, x, y + s, '#000000', s, align);
    G('text', S.ctx, str, x + 1, y + s, '#000000', s, align);
    G('text', S.ctx, str, x, y, color || '#ffffff', s, align);
  }
  function textW(str, scale) {
    var fn = gfxFn('textWidth');
    if (fn) { try { return fn.call(AGV.gfx, str, scale || 1); } catch (e) { /* fall through */ } }
    return str.length * 6 * (scale || 1);
  }
  function panel(x, y, w, h) {
    if (G('panel', S.ctx, x, y, w, h)) return;
    var ctx = S.ctx;
    ctx.fillStyle = 'rgba(12,14,24,0.92)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#d8dee8'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  // ----- Menu state machine -----
  var MODE_LIST = [
    { key: '1p', label: '1 PLAYER VS CPU' }, { key: '2p', label: '2 PLAYER SPLIT SCREEN' }, { key: 'tt', label: 'TIME TRIAL' }
  ];
  function go(state) {
    S.state = state; S.stateT = 0;
    if (state === 'results') S.chefT = null;
    if (state !== 'race' && state !== 'results') { sfxCall('engine', 0, -1); sfxCall('engine', 1, -1); }
  }
  function menuMove(idx, n) {
    if (hit(K_UP)) { idx = (idx + n - 1) % n; sfxCall('play', 'menu'); }
    if (hit(K_DOWN)) { idx = (idx + 1) % n; sfxCall('play', 'menu'); }
    return idx;
  }
  function humansForMode(mode) { return mode === '2p' ? 2 : 1; }

  function startRace() {
    S.best = loadBest();
    var key = bestKey(S.runKey, S.mode);
    S.race = createRace(S.runKey, S.mode, {
      seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0, audio: true,
      colors: S.colorSel.slice(0, humansForMode(S.mode)), prevBest: S.best[key] || null
    });
    S.recorded = {};
    S.newBest = {};
    S.cams = [];   // updateCameras snaps a fresh chase camera onto each human's grid slot on the first frame
    S.acc = 0;
    S.resultsIdx = 0;
    go('race');
  }
  function recordFinishes() {
    var race = S.race, key = bestKey(race.runKey, race.mode), changed = false;
    race.racers.forEach(function (r) {
      if (!r.human || !r.finished || S.recorded[r.hIndex]) return;
      S.recorded[r.hIndex] = true;
      var cur = S.best[key];
      if (!cur || r.finalTime < cur.t) {
        S.best[key] = { t: r.finalTime, raw: r.finishTime, splits: r.splits.map(function (v) { return Math.round(v * 1000) / 1000; }) };
        S.newBest[r.hIndex] = true;
        changed = true;
      }
    });
    if (changed) saveBest(S.best);
  }

  function updateUI(dt) {
    S.stateT += dt;
    var st = S.state;
    if (st === 'title') {
      if (hit(K_OK)) { sfxCall('play', 'select'); go('mode'); }
    } else if (st === 'mode') {
      S.modeIdx = menuMove(S.modeIdx, MODE_LIST.length);
      if (hit(K_OK)) { S.mode = MODE_LIST[S.modeIdx].key; sfxCall('play', 'select'); S.best = loadBest(); go('run'); }
      else if (hit(K_BACK)) go('title');
    } else if (st === 'run') {
      S.runIdx = menuMove(S.runIdx, RUN_KEYS.length);
      if (hit(K_OK)) {
        S.runKey = RUN_KEYS[S.runIdx]; sfxCall('play', 'select');
        S.colorDone = [false, false];
        go('color');
      } else if (hit(K_BACK)) go('mode');
    } else if (st === 'color') {
      updateColorPick();
    } else if (st === 'race') {
      if (hit(K_BACK)) { S.pauseIdx = 0; sfxCall('play', 'menu'); go('pause'); }
    } else if (st === 'pause') {
      S.pauseIdx = menuMove(S.pauseIdx, 3);
      if (hit(K_BACK)) go('race');
      else if (hit(K_OK)) {
        sfxCall('play', 'select');
        if (S.pauseIdx === 0) go('race');
        else if (S.pauseIdx === 1) startRace();
        else { S.race = null; go('title'); }
      }
    } else if (st === 'results') {
      if (hit(K_LEFT) || hit(K_UP)) { S.resultsIdx = (S.resultsIdx + 2) % 3; sfxCall('play', 'menu'); }
      if (hit(K_RIGHT) || hit(K_DOWN)) { S.resultsIdx = (S.resultsIdx + 1) % 3; sfxCall('play', 'menu'); }
      if (S.stateT > 0.6 && hit(K_OK)) {
        sfxCall('play', 'select');
        if (S.resultsIdx === 0) startRace();
        else if (S.resultsIdx === 1) { S.race = null; S.best = loadBest(); go('run'); }
        else { S.race = null; go('title'); }
      } else if (hit(K_BACK)) { S.race = null; go('title'); }
      if (hit(['KeyC']) && S.stateT > 1.65) { S.chefT = S.stateT; sfxCall('play', 'pickup'); }
    }
  }
  function updateColorPick() {
    var n = humansForMode(S.mode), two = n === 2;
    var ctl = [
      { l: two ? ['KeyA'] : K_LEFT, r: two ? ['KeyD'] : K_RIGHT, ok: two ? ['Space'] : K_OK },
      { l: ['ArrowLeft'], r: ['ArrowRight'], ok: ['Enter', 'NumpadEnter'] }
    ];
    for (var i = 0; i < n; i++) {
      var c = ctl[i];
      if (S.colorDone[i]) continue;
      if (hit(c.l)) { S.colorSel[i] = (S.colorSel[i] + COLORS.length - 1) % COLORS.length; sfxCall('play', 'menu'); }
      if (hit(c.r)) { S.colorSel[i] = (S.colorSel[i] + 1) % COLORS.length; sfxCall('play', 'menu'); }
      if (hit(c.ok)) {
        var other = 1 - i;
        if (two && S.colorDone[other] && S.colorSel[other] === S.colorSel[i]) sfxCall('play', 'bump');
        else { S.colorDone[i] = true; sfxCall('play', 'select'); }
      }
    }
    if (hit(K_BACK)) {
      if (S.colorDone[0] || S.colorDone[1]) S.colorDone = [false, false];
      else go('run');
      return;
    }
    if (S.colorDone[0] && (n === 1 || S.colorDone[1])) {
      if (n === 2 && S.colorSel[0] === S.colorSel[1]) { S.colorDone[1] = false; return; }
      startRace();
    }
  }

  // ----- Rendering -----
  function drawMenuBG() {
    var ctx = S.ctx;
    if (!G('title', ctx, S.t)) { ctx.fillStyle = '#141824'; ctx.fillRect(0, 0, VW, VH); }
    ctx.fillStyle = 'rgba(6,8,14,0.6)'; ctx.fillRect(0, 0, VW, VH);
  }
  function drawControlsHint(y) {
    panel(16, y, 288, 34);
    text('P1: WASD MOVE  SPACE ITEM  L-SHIFT DRIFT', 22, y + 5, '#cfe3ff');
    text('P2: ARROWS  ENTER ITEM  R-SHIFT DRIFT', 22, y + 15, '#ffd0d0');
    text('ESC PAUSE / BACK    M MUTE', 22, y + 25, '#aab4c4');
  }
  function drawMenuList(title, items, idx, y0, extra) {
    var w = 220, x = (VW - w) / 2, h = 22 + items.length * 14;
    panel(x, y0, w, h);
    text(title, VW / 2, y0 + 6, '#ffe14a', 1, 'center');
    for (var i = 0; i < items.length; i++) {
      var sel = i === idx, y = y0 + 20 + i * 14;
      if (sel && Math.floor(S.t * 4) % 2 === 0) text('>', x + 8, y, '#ffe14a');
      text(items[i], x + 18, y, sel ? '#ffffff' : '#8a94a6');
      if (extra && extra[i]) text(extra[i], x + w - 8, y, sel ? '#9fffb0' : '#6f8a76', 1, 'right');
    }
  }
  function render(dt) {
    var ctx = S.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, VW, VH);
    var st = S.state;
    if (st === 'title') {
      if (!G('title', ctx, S.t)) text('PEABODY AGV RALLY', VW / 2, 60, '#ffe14a', 2, 'center');
      if (Math.floor(S.t * 2) % 2 === 0) text('PRESS ENTER', VW / 2, 150, '#ffffff', 1, 'center');
    } else if (st === 'mode') {
      drawMenuBG();
      drawMenuList('SELECT MODE', MODE_LIST.map(function (m) { return m.label; }), S.modeIdx, 30);
      drawControlsHint(120);
    } else if (st === 'run') {
      drawMenuBG();
      var labels = [], bests = [];
      RUN_KEYS.forEach(function (k) {
        var run = AGV.map.runs[k];
        labels.push(run ? run.name : k.toUpperCase());
        var b = S.best[bestKey(k, S.mode)];
        bests.push('BEST ' + (b ? fmtTime(b.t) : '--:--.--'));
      });
      drawMenuList('SELECT RUN', labels, S.runIdx, 30, bests);
      var modeLabel = MODE_LIST.filter(function (m) { return m.key === S.mode; })[0].label;
      text(modeLabel, VW / 2, 98, '#aab4c4', 1, 'center');
      drawControlsHint(120);
    } else if (st === 'color') {
      drawColorPick();
    } else {
      if (S.race) { updateCameras(dt); drawRace(); }
      if (st === 'pause') {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, VW, VH);
        drawMenuList('PAUSED', ['RESUME', 'RESTART', 'QUIT TO TITLE'], S.pauseIdx, 50);
      } else if (st === 'results') {
        drawResults();
      }
    }
    var snd0 = AGV.sfx;
    if (snd0 && snd0.muted) text('MUTED', VW - 3, VH - 9, '#ff8080', 1, 'right');
  }
  function drawColorPick() {
    var ctx = S.ctx, n = humansForMode(S.mode);
    drawMenuBG();
    panel(30, 14, 260, n === 2 ? 98 : 62);
    text('PICK YOUR AGV COLOUR', VW / 2, 20, '#ffe14a', 1, 'center');
    for (var i = 0; i < n; i++) {
      var y = 36 + i * 38;
      text('P' + (i + 1), 40, y + 8, i ? '#ffd0d0' : '#cfe3ff');
      for (var k = 0; k < COLORS.length; k++) {
        var x = 70 + k * 34, sel = S.colorSel[i] === k;
        ctx.fillStyle = COLORS[k].c; ctx.fillRect(x, y + 4, 22, 14);
        if (sel) { ctx.strokeStyle = S.colorDone[i] ? '#9fffb0' : '#ffffff'; ctx.lineWidth = 1; ctx.strokeRect(x - 2.5, y + 1.5, 27, 19); }
      }
      var name = COLORS[S.colorSel[i]].name;
      text(S.colorDone[i] ? name + ' - READY!' : name, 70, y + 24, S.colorDone[i] ? '#9fffb0' : '#ffffff');
    }
    drawControlsHint(130);
    text(n === 2 ? 'P1: A/D + SPACE    P2: ARROWS + ENTER' : 'LEFT/RIGHT + ENTER', VW / 2, 117, '#aab4c4', 1, 'center');
  }
  // ===== Chase camera (pseudo-3D race view) =====
  // One camera per human: { x, y, z, angle, pitch, fov } for AGV.view3d, plus smoothing state.
  // cam.angle trails the racer's heading through a critically damped spring; the eye sits profile.dist px behind the racer
  // along cam.angle, pulled in so it never ends up inside or right against anything solid.
  // Two framings: 44 px behind suits a 160x180 split-screen viewport. On the full 320x180 view the same horizontal FOV
  // doubles the focal length, and at 44 px the floor only shows from ~68 px ahead, so the AGV would sit below the screen;
  // 1P/TT therefore chase from ~70 px back.
  var CAM_PROFILES = {
    split: { dist: 44, z: 30, fov: 1.15, pitch: -8, dBoost: 8, fBoost: 0.12 },
    full: { dist: 70, z: 30, fov: 1.15, pitch: -14, dBoost: 10, fBoost: 0.12 }
  };
  var CAM_OMEGA = 9, CAM_MAX_LAG = 0.36;           // heading spring (rad/s) and the most the view may trail the AGV
  var CAM_MARGIN = 6, CAM_STEP = 2;                // keep-out distance from solids, march step (px)
  var CAM_NEAR_HIDE = 14;                          // closer than this, the player's own AGV is left out of the scene
  var SWEEP_DIST = 118, SWEEP_Z = 72, SWEEP_YAW = 1.0, SWEEP_PITCH = -24;   // countdown fly-in start
  var PITCH_K = 140, PITCH_C = 11;                 // brake-dip / bump-bob spring

  function has3D() {
    var v = AGV.view3d;
    return !!(v && typeof v.render === 'function' && !S.v3dBroken);
  }
  // Solid for the camera: walls (CURB is drawn as a floor strip, so it doesn't count), props, door leaves, movers.
  function camBlocked(race, x, y) {
    var m = CAM_MARGIN, map = AGV.map, curb = T().CURB;
    var x0 = Math.floor((x - m) / TS), x1 = Math.floor((x + m) / TS), y0 = Math.floor((y - m) / TS), y1 = Math.floor((y + m) / TS);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var id = map.at(tx, ty);
        if (id !== curb && AGV.isSolid(id)) return true;
      }
    }
    var s = race.solids;
    for (var i = 0; i < s.length; i++) {
      var q = s[i];
      if (x + m > q.x && x - m < q.x + q.w && y + m > q.y && y - m < q.y + q.h) return true;
    }
    return false;
  }
  // March from (x, y) along (dx, dy) in CAM_STEP px steps; return the furthest clear distance up to `want`.
  function camClearDist(race, x, y, dx, dy, want) {
    var t = 0;
    while (t + CAM_STEP <= want) {
      if (camBlocked(race, x + dx * (t + CAM_STEP), y + dy * (t + CAM_STEP))) return t;
      t += CAM_STEP;
    }
    if (t < want && !camBlocked(race, x + dx * want, y + dy * want)) t = want;
    return t;
  }
  // Critically damped spring on an angle (wraps correctly across +-PI).
  function dampAngle(cam, target, omega, dt) {
    var x = omega * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var ch = angDiff(cam.heading, target), tmp = (cam.hv + omega * ch) * dt;
    cam.hv = (cam.hv - omega * tmp) * ex;
    cam.heading = angDiff(target + (ch + tmp) * ex, 0);
  }
  function newCam(r) {
    return {
      x: r.x, y: r.y, z: CAM_PROFILES.split.z, angle: r.angle, pitch: 0, fov: CAM_PROFILES.split.fov,
      heading: r.angle, hv: 0, tgt: r.angle, dist: null, bk: 0, p: 0, pv: 0, lastSp: 0,
      td: { x: r.x, y: r.y }, lastItem: null, itemMsg: null, itemMsgT: 0
    };
  }
  function updateChaseCam(cam, r, race, dt, snap, pr) {
    // Heading: hold the pre-spin heading while a peanut spill spins the AGV, so the view doesn't whirl.
    if (r.spinT <= 0 || cam.tgt == null) cam.tgt = r.angle;
    if (snap) { cam.heading = cam.tgt; cam.hv = 0; }
    else if (dt > 0) dampAngle(cam, cam.tgt, CAM_OMEGA, dt);
    var lag = angDiff(cam.heading, cam.tgt);
    if (Math.abs(lag) > CAM_MAX_LAG) cam.heading = angDiff(cam.tgt + sign(lag) * CAM_MAX_LAG, 0);

    // Boost: pull back and widen the FOV a little.
    var boosting = r.boostT > 0 ? 1 : 0;
    cam.bk = snap ? boosting : cam.bk + (boosting - cam.bk) * (1 - Math.exp(-4 * dt));
    var want = pr.dist + pr.dBoost * cam.bk, fov = pr.fov + pr.fBoost * cam.bk;
    var z = pr.z, yaw = 0, pitch0 = pr.pitch;

    // Countdown: fly in from higher, further back and off to one side, down to the chase position.
    if (race.phase === 'countdown') {
      var s = clamp((race.countdown - 0.5) / (COUNTDOWN - 0.5), 0, 1), e = s * s * (3 - 2 * s);
      want = lerp(want, SWEEP_DIST, e); z = lerp(z, SWEEP_Z, e);
      yaw = SWEEP_YAW * e * (r.hIndex === 1 ? -1 : 1); pitch0 = lerp(pitch0, SWEEP_PITCH, e);
    }

    var ang = angDiff(cam.heading + yaw, 0), dx = -Math.cos(ang), dy = -Math.sin(ang);
    var clear = camClearDist(race, r.x, r.y, dx, dy, want);
    if (snap || cam.dist == null || clear < cam.dist) cam.dist = clear;
    else cam.dist += (clear - cam.dist) * (1 - Math.exp(-5 * dt));
    // Squeezed in close (backed against a wall): lift the eye a little so the view isn't buried in the AGV.
    var squeeze = clamp(1 - cam.dist / pr.dist, 0, 1);
    z += squeeze * 10;

    // Pitch: small dip under hard braking, a damped bob on sudden stops (bumps, E-STOP).
    var sp = r.speed, decel = dt > 0 && !snap ? (cam.lastSp - sp) / dt : 0;
    cam.lastSp = sp;
    var ptgt = sp > 10 && decel > 120 ? -3 * clamp((decel - 120) / 160, 0, 1) : 0;
    if (snap) { cam.p = 0; cam.pv = 0; }
    else {
      if (decel > 500) cam.pv += clamp(decel / 25, 0, 30);
      for (var left = Math.min(dt, 0.25); left > 1e-6; left -= 1 / 60) {
        var h = Math.min(left, 1 / 60);
        cam.pv += (-PITCH_K * (cam.p - ptgt) - PITCH_C * cam.pv) * h;
        cam.p += cam.pv * h;
      }
      cam.p = clamp(cam.p, -5, 5);
    }

    cam.x = r.x + dx * cam.dist; cam.y = r.y + dy * cam.dist; cam.z = z;
    cam.angle = ang; cam.fov = fov;
    cam.pitch = Math.round(pitch0 + cam.p - squeeze * 6);
  }
  function updateCameras(dt) {
    var race = S.race;
    var humans = race.racers.filter(function (r) { return r.human; });
    if (!humans.length) humans = [race.order[0]];
    var k = 1 - Math.exp(-6 * Math.min(dt, 0.1));
    var pr = humans.length > 1 ? CAM_PROFILES.split : CAM_PROFILES.full;
    humans.forEach(function (r, i) {
      var snap = !S.cams[i];
      var cam = S.cams[i] || (S.cams[i] = newCam(r));
      updateChaseCam(cam, r, race, Math.min(dt, 0.25), snap, pr);
      // Top-down focus point, only used by the fallback view.
      var lx = r.vx * 0.35, ly = r.vy * 0.35, ll = Math.sqrt(lx * lx + ly * ly);
      if (ll > 48) { lx *= 48 / ll; ly *= 48 / ll; }
      cam.td.x += (r.x + lx - cam.td.x) * k;
      cam.td.y += (r.y + ly - cam.td.y) * k;
      // Item toast: name + what it does, shown for a moment after a pickup.
      if (r.item && r.item !== cam.lastItem) { cam.itemMsg = r.item; cam.itemMsgT = 2.4; }
      cam.lastItem = r.item;
      cam.itemMsgT = Math.max(0, cam.itemMsgT - dt);
    });
  }
  function camOrigin(cam, vw, vh) {
    var mw = AGV.map.W * TS, mh = AGV.map.H * TS;
    var cx = mw <= vw ? (mw - vw) / 2 : clamp(cam.x - vw / 2, 0, mw - vw);
    var cy = mh <= vh ? (mh - vh) / 2 : clamp(cam.y - vh / 2, 0, mh - vh);
    return { x: Math.round(cx), y: Math.round(cy) };
  }
  function drawRace() {
    var race = S.race, ctx = S.ctx;
    var humans = race.racers.filter(function (r) { return r.human; });
    if (humans.length === 2) {
      drawViewport(humans[0], S.cams[0], 0, 160, VH, true);
      drawViewport(humans[1], S.cams[1], 160, 160, VH, true);
      ctx.fillStyle = '#000000'; ctx.fillRect(159, 0, 2, VH);
    } else {
      drawViewport(humans[0] || race.order[0], S.cams[0], 0, VW, VH, false);
    }
  }
  function drawViewport(r, cam, vx, vw, vh, small) {
    if (has3D() && drawViewport3D(r, cam, vx, vw, vh, small)) return;
    drawViewportTop(r, cam, vx, vw, vh, small);
  }

  // ----- 3D viewport -----
  function buildScene(race, me, cam) {
    var map = AGV.map, i;
    var scene = { t: race.clock, runKey: race.runKey, racers: [], pickups: [], drops: race.drops, doors: [], movers: [], particles: race.particles };
    for (i = 0; i < race.racers.length; i++) {
      var a = race.racers[i];
      if (a === me && cam.dist < CAM_NEAR_HIDE) continue;
      scene.racers.push({
        x: a.x, y: a.y, angle: a.angle, color: a.color, boxes: a.boxes, estop: a.estop, boost: a.boostT > 0,
        finished: a.finished, tag: a.human && a !== me && race.nHumans > 1 ? a.tag : '', wobble: a.wobble, id: a.id
      });
    }
    for (i = 0; i < race.pickups.length; i++) if (race.pickups[i].cool <= 0) scene.pickups.push(race.pickups[i]);
    (map.doors || []).forEach(function (d, k) { scene.doors.push({ door: d, openFrac: race.doorFracs[k] == null ? 1 : race.doorFracs[k] }); });
    (map.movers || []).forEach(function (m, k) { if (race.moverRects[k]) scene.movers.push({ mover: m, rect: race.moverRects[k] }); });
    // Lidar ping rings become a ring of floor-level sparks.
    if (race.rings.length) {
      scene.particles = race.particles.slice();
      race.rings.forEach(function (g) {
        var f = 1 - g.life / g.max, rad = 4 + f * g.rad;
        for (var k = 0; k < 18; k++) {
          var an = k / 18 * Math.PI * 2;
          scene.particles.push({ x: g.x + Math.cos(an) * rad, y: g.y + Math.sin(an) * rad, z: 5, color: g.color, size: 2 });
        }
      });
    }
    return scene;
  }
  // Returns false if the 3D renderer failed (the caller then draws the top-down fallback).
  function drawViewport3D(r, cam, vx, vw, vh, small) {
    var race = S.race, ctx = S.ctx, v3 = AGV.view3d;
    try {
      ctx.save();
      v3.render(ctx, vx, 0, vw, vh, cam, buildScene(race, r, cam));
      ctx.restore();
    } catch (e) {
      ctx.restore();
      S.v3dBroken = true;
      if (root.console) console.warn('view3d.render failed, using the top-down view:', e);
      return false;
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(vx, 0, vw, vh); ctx.clip();
    ctx.translate(vx, 0);
    if (typeof v3.project === 'function') {
      race.floats.forEach(function (f) {
        if (f.text === EHS_TEXT) return;   // view3d already floats a CALL EHS! sign over the AGV
        var p = null;
        try { p = v3.project(cam, vw, vh, f.wx, f.wy, 28 + (1.2 - f.life) * 14); } catch (e) { p = null; }
        if (!p || p.sx < -40 || p.sx > vw + 40 || p.sy < -10 || p.sy > vh) return;
        textOutline(f.text, Math.round(p.sx), Math.round(p.sy) - 4, f.color, 1, 'center');
      });
    }
    drawHUD(r, cam, vw, vh, small);
    ctx.restore();
    return true;
  }

  // ----- Top-down fallback viewport (used when js/view3d.js is missing or fails) -----
  function inView(x, y, cx, cy, vw, vh, m) { return x > cx - m && x < cx + vw + m && y > cy - m && y < cy + vh + m; }
  function drawViewportTop(r, cam, vx, vw, vh, small) {
    var race = S.race, ctx = S.ctx, run = race.run, t = race.clock, map = AGV.map;
    var o = camOrigin(cam.td || cam, vw, vh), cx = o.x, cy = o.y, i;
    ctx.save();
    ctx.beginPath(); ctx.rect(vx, 0, vw, vh); ctx.clip();
    ctx.translate(vx, 0);
    if (!G('drawWorld', ctx, cx, cy, vw, vh, t)) drawWorldFallback(cx, cy, vw, vh);
    G('drawGuide', ctx, run, cx, cy, t);
    G('drawFinish', ctx, run, cx, cy, t);

    // World-px sprites (drops, pickups): translate so world coords land in the viewport.
    ctx.save(); ctx.translate(-cx, -cy);
    race.drops.forEach(function (d) { if (inView(d.x, d.y, cx, cy, vw, vh, 20)) G('drawDrop', ctx, d.kind, d.x, d.y, t); });
    race.pickups.forEach(function (p) { if (p.cool <= 0 && inView(p.x, p.y, cx, cy, vw, vh, 20)) G('drawPickup', ctx, p.x, p.y, t); });
    ctx.restore();

    (map.doors || []).forEach(function (d, k) { G('drawDoor', ctx, d, race.doorFracs[k] == null ? 1 : race.doorFracs[k], cx, cy, t); });
    (map.movers || []).forEach(function (m, k) { if (race.moverRects[k]) G('drawMover', ctx, m, race.moverRects[k], cx, cy, t); });

    ctx.save(); ctx.translate(-cx, -cy);
    var sorted = race.racers.slice().sort(function (a, b) { return a.y - b.y; });
    for (i = 0; i < sorted.length; i++) {
      var a = sorted[i];
      if (!inView(a.x, a.y, cx, cy, vw, vh, 30)) continue;
      ctx.globalAlpha = a.finished ? 0.55 : 1;
      var opt = { color: a.color, boxes: a.boxes, wobble: a.wobble, estop: a.estop, boost: a.boostT > 0, t: t, tag: a.human && race.nHumans > 1 ? a.tag : (a.human ? 'P1' : '') };
      if (!G('drawAGV', ctx, a.x, a.y, a.angle, opt)) {
        ctx.fillStyle = a.color; ctx.fillRect(Math.round(a.x - 8), Math.round(a.y - 8), 16, 16);
      }
    }
    ctx.globalAlpha = 1;
    race.rings.forEach(function (g) {
      var f = 1 - g.life / g.max;
      ctx.strokeStyle = g.color; ctx.globalAlpha = 1 - f; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(Math.round(g.x), Math.round(g.y), 4 + f * g.rad, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
    ctx.restore();

    G('drawParticles', ctx, race.particles, cx, cy);
    race.floats.forEach(function (f) {
      if (inView(f.x, f.y, cx, cy, vw, vh, 30)) text(f.text, Math.round(f.x - cx), Math.round(f.y - cy), f.color, 1, 'center');
    });
    drawHUD(r, null, vw, vh, small);
    ctx.restore();
  }
  function drawWorldFallback(cx, cy, vw, vh) {
    var ctx = S.ctx, map = AGV.map;
    var x0 = Math.floor(cx / TS), y0 = Math.floor(cy / TS), x1 = Math.ceil((cx + vw) / TS), y1 = Math.ceil((cy + vh) / TS);
    for (var ty = y0; ty <= y1; ty++) for (var tx = x0; tx <= x1; tx++) {
      var id = map.at(tx, ty);
      ctx.fillStyle = AGV.isSolid(id) ? '#3a3f4a' : id === T().VINYL ? '#9fb7b0' : '#8d8d88';
      ctx.fillRect(tx * TS - cx, ty * TS - cy, TS, TS);
    }
  }

  // ===== HUD =====
  var ITEM_INFO = {
    boost: ['PRIORITY LABEL', 'SPEED BOOST!', 'SPEED BOOST!'],
    wrap: ['SHRINK-WRAP', 'DROP A STICKY PATCH BEHIND YOU', 'STICKY PATCH BEHIND YOU'],
    peanuts: ['PACKING PEANUTS', 'SPILL THEM BEHIND YOU', 'SPILL BEHIND YOU'],
    box: ['SPARE BOX', 'GET A LOST BOX BACK', '+1 BOX'],
    ping: ['LIDAR PING', 'THE AGV AHEAD HAS TO CALL EHS!', 'AGV AHEAD MUST CALL EHS!']
  };
  function drawBoxIcon(x, y) {
    var ctx = S.ctx;
    ctx.fillStyle = '#f4f4f0'; ctx.fillRect(x, y, 8, 7);
    ctx.fillStyle = '#23336b'; ctx.fillRect(x, y + 3, 8, 1);
    ctx.fillStyle = '#b8b8b0'; ctx.fillRect(x, y + 6, 8, 1);
  }
  // 8-bit arrow centred at (cx, cy), pointing `rel` radians clockwise from straight up; n x n px, black outline.
  var arrowMask = null;
  function drawArrow(cx, cy, rel, n, color) {
    var ctx = S.ctx, h = (n - 1) / 2, k = 7 / h, W = n + 2, i, j;
    if (!arrowMask || arrowMask.length < W * W) arrowMask = new Uint8Array(W * W);
    var m = arrowMask, fx = Math.sin(rel), fy = -Math.cos(rel);
    for (j = 0; j < W; j++) {
      for (i = 0; i < W; i++) {
        var px = (i - 1 - h) * k, py = (j - 1 - h) * k;
        var u = px * fx + py * fy, v = Math.abs(-px * fy + py * fx);   // u = along the arrow, v = across
        m[j * W + i] = (u >= -6.5 && u <= 0.5 && v <= 1.7) || (u > 0.5 && u <= 6.8 && v <= (6.8 - u) * 0.85) ? 1 : 0;
      }
    }
    var x0 = Math.round(cx - h) - 1, y0 = Math.round(cy - h) - 1;
    ctx.fillStyle = '#000000';
    for (j = 0; j < W; j++) for (i = 0; i < W; i++) {
      if (m[j * W + i]) continue;
      if ((i > 0 && m[j * W + i - 1]) || (i < W - 1 && m[j * W + i + 1]) || (j > 0 && m[(j - 1) * W + i]) || (j < W - 1 && m[(j + 1) * W + i])) ctx.fillRect(x0 + i, y0 + j, 1, 1);
    }
    ctx.fillStyle = color;
    for (j = 0; j < W; j++) for (i = 0; i < W; i++) if (m[j * W + i]) ctx.fillRect(x0 + i, y0 + j, 1, 1);
  }
  // Segmented speed bar; lit segments run green -> yellow -> red, cyan while boosting.
  function drawSpeedBar(r, x, y, small) {
    var ctx = S.ctx, n = 10, sw = small ? 2 : 4, sh = small ? 3 : 4, gap = 1;
    var frac = Math.abs(r.speed) / MAX_SPEED, lit = Math.min(n, Math.round(frac * n));
    var boost = r.boostT > 0, over = boost && frac > 1.05 && Math.floor(S.t * 10) % 2 === 0;
    ctx.fillStyle = '#000000'; ctx.fillRect(x - 1, y - 1, n * (sw + gap) + 1, sh + 2);
    for (var i = 0; i < n; i++) {
      var col = i >= lit ? '#2a2f3a' : boost ? (over ? '#ffffff' : '#7fd8ff') : i < 5 ? '#3ee070' : i < 8 ? '#ffd23a' : '#ff4a4a';
      ctx.fillStyle = col; ctx.fillRect(x + i * (sw + gap), y, sw, sh);
    }
  }
  // Yellow/black hazard-striped "CALL EHS!" plate, flashing between yellow-on-black and black-on-yellow.
  // Drawn top-left under the position readout: the 3D view already floats an EHS sign over the AGV itself.
  function drawEhsWarning(x, y, small, flash) {
    var ctx = S.ctx, sc = small ? 1 : 2, msg = EHS_TEXT, bw = small ? 2 : 3;
    var tw = textW(msg, sc), w = tw + (small ? 8 : 14) + bw * 2, h = 7 * sc + (small ? 6 : 8) + bw * 2;
    var cx = x + w / 2;
    ctx.fillStyle = '#000000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#111111';
    var sp = small ? 6 : 8, off = Math.floor(S.t * 12) % sp;
    for (var j = 0; j < h; j++) {
      for (var i = -sp - (j + off) % sp; i < w; i += sp) {
        var a = Math.max(0, i), b = Math.min(w, i + sp / 2);
        if (b > a) ctx.fillRect(x + a, y + j, b - a, 1);
      }
    }
    ctx.fillStyle = flash ? '#ffd23a' : '#111111';
    ctx.fillRect(x + bw, y + bw, w - bw * 2, h - bw * 2);
    if (!G('text', ctx, msg, Math.round(cx), y + bw + (small ? 3 : 4), flash ? '#111111' : '#ffd23a', sc, 'center')) {
      text(msg, Math.round(cx), y + bw + 3, flash ? '#111111' : '#ffd23a', sc, 'center');
    }
  }
  function drawHUD(r, cam, vw, vh, small) {
    var text = cam ? textOutline : textPlain;   // the 3D view is busy and bright: outline the HUD text
    var race = S.race, ctx = S.ctx, blink = Math.floor(S.t * 4) % 2 === 0;
    var placeCol = ['#ffe14a', '#e8eef8', '#ff9a4a', '#c8d0e0'][Math.min(3, r.place - 1)];
    if (race.mode !== 'tt') {
      text(ordinal(r.place), 4, 4, placeCol, 2);
      text('/' + race.racers.length, 4 + textW(ordinal(r.place), 2) + 1, 10, '#aab4c4');
    } else {
      text(small ? 'TT' : 'TIME TRIAL', 4, 4, '#9fffb0');
    }
    var tShown = r.finished ? r.finishTime : race.t;
    text(fmtTime(tShown), vw - 4, 4, '#ffffff', 1, 'right');
    drawBoxIcon(vw - 26, 14);
    text('x' + r.boxes, vw - 4, 14, r.boxes < MAX_BOXES ? '#ffb0b0' : '#ffffff', 1, 'right');
    if (race.mode === 'tt' && race.prevBest) text('BEST ' + fmtTime(race.prevBest.t), vw - 4, 24, '#9fffb0', 1, 'right');

    var ix = Math.round(vw / 2 - 11);
    panel(ix, 2, 22, 22);
    if (r.item) G('itemIcon', ctx, r.item, ix + 3, 5);

    // Next-waypoint arrow under the item box, relative to the view direction.
    var wps = race.run.waypoints, popY = small ? 42 : 46;
    if (cam && !r.finished && wps.length) {
      var w = wps[Math.min(r.wp, wps.length - 1)];
      var rel = angDiff(Math.atan2(w.y - r.y, w.x - r.x), cam.angle);
      var an = small ? 11 : 15, acol = r.wrongWay ? (blink ? '#ff4a4a' : '#ffffff') : (w.label ? '#9fffb0' : '#ffe14a');
      drawArrow(vw / 2, 26 + (an + 1) / 2, rel, an, acol);
    }

    var area = '';
    try { area = AGV.areaAt ? AGV.areaAt(r.x, r.y) || '' : ''; } catch (e) { area = ''; }
    if (area) text(area, 4, vh - 10, '#cfd6e0');
    if (cam) drawSpeedBar(r, 4, vh - (small ? 16 : 18), small);

    var map = AGV.map, mw = small ? 40 : 64, mh = Math.round(clamp(mw * map.H / map.W, 24, small ? 40 : 60));
    if (mh === (small ? 40 : 60)) mw = Math.round(mh * map.W / map.H);
    if (cam || !small) {
      var dots = race.racers.map(function (a) { return { x: a.x, y: a.y, color: a.color }; });
      // Own dot last so it is drawn on top.
      dots.sort(function (a, b) { return (a.color === r.color) - (b.color === r.color); });
      G('minimap', ctx, vw - mw - (small ? 3 : 4), vh - mh - (small ? 3 : 4), mw, mh, race.run, dots);
    }

    if (race.phase === 'countdown') {
      var n = Math.ceil(race.countdown);
      text(String(n), vw / 2, vh / 2 - 20, '#ffe14a', 4, 'center');
    } else if (race.goT > 0) {
      text('GO!', vw / 2, vh / 2 - 20, '#9fffb0', 4, 'center');
    }
    if (r.wrongWay && !r.finished && blink) text('WRONG WAY', vw / 2, vh / 2 + 4, '#ff4a4a', small ? 1 : 2, 'center');
    if (r.estop && !r.finished) {
      if (cam) drawEhsWarning(4, 22, small, blink);
      else drawEhsWarning(Math.round(vw / 2 - (small ? 36 : 66)), Math.round(vh / 2) + 20, small, blink);
    }
    if (r.popup) {
      var sc = small || textW(r.popup.text, 2) > vw - 8 ? 1 : 2;
      text(r.popup.text, vw / 2, popY, r.popup.color, sc, 'center');
      if (r.popup.sub) {
        var col = r.popup.sub.indexOf('-') >= 0 ? '#9fffb0' : r.popup.sub.indexOf('+') >= 0 ? '#ff9090' : '#ffffff';
        text(r.popup.sub, vw / 2, popY + 9 * sc + 3, col, 1, 'center');
      }
    } else if (cam && cam.itemMsgT > 0 && cam.itemMsg && ITEM_INFO[cam.itemMsg] && !r.finished) {
      var info = ITEM_INFO[cam.itemMsg];
      text(info[0], vw / 2, popY, '#ffe14a', 1, 'center');
      text(small ? info[2] : info[1], vw / 2, popY + 10, '#ffffff', 1, 'center');
    }
    if (r.finished && !r.popup && S.state === 'race') {
      text(race.mode === 'tt' ? 'FINISHED' : 'FINISHED ' + ordinal(r.finishOrder), vw / 2, popY, '#ffffff', 1, 'center');
    }
  }
  function resultsRows() {
    var race = S.race;
    var rows = race.racers.slice();
    rows.sort(function (a, b) {
      if (a.finished && b.finished) return a.finalTime - b.finalTime || a.finishOrder - b.finishOrder;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return a.place - b.place;
    });
    return rows;
  }
  function drawResults() {
    var race = S.race, ctx = S.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, VW, VH);
    panel(14, 8, 292, 164);
    text(race.run.name + ' - RESULTS', VW / 2, 14, '#ffe14a', 1, 'center');
    var cols = [22, 50, 96, 148, 196, 244];
    var hy = 28;
    ['POS', 'AGV', 'TIME', 'PENALTY', 'TOTAL'].forEach(function (h, i) { text(h, cols[i], hy, '#8a94a6'); });
    var rows = resultsRows();
    rows.forEach(function (r, i) {
      var y = 40 + i * 12;
      var col = r.human ? '#ffffff' : '#aab4c4';
      ctx.fillStyle = r.color; ctx.fillRect(cols[1] - 6, y + 1, 3, 6);
      text(r.finished ? ordinal(i + 1) : '-', cols[0], y, col);
      text(r.name, cols[1], y, col);
      if (r.finished) {
        var lost = MAX_BOXES - r.boxes;
        text(fmtTime(r.finishTime), cols[2], y, col);
        text(lost ? '+' + (lost * BOX_PENALTY).toFixed(1) : '-', cols[3], y, lost ? '#ff9090' : col);
        text(fmtTime(r.finalTime), cols[4], y, col);
        if (r.human && S.newBest[r.hIndex] && Math.floor(S.t * 3) % 2 === 0) text('NEW BEST!', cols[5], y, '#9fffb0');
      } else {
        text('RUNNING...', cols[2], y, '#6f7888');
      }
    });
    var y2 = 40 + rows.length * 12 + 4;
    text('LOST BOX PENALTY: +' + BOX_PENALTY.toFixed(1) + 'S PER BOX', 22, y2, '#ffb0b0');
    if (race.mode === 'tt') {
      var me = race.racers[0], pb = race.prevBest;
      if (pb && me.finished) {
        var d = me.finalTime - pb.t;
        text('BEST ' + fmtTime(pb.t) + '   YOU ' + fmtTime(me.finalTime) + '   ' + fmtDiff(d), 22, y2 + 12, d < 0 ? '#9fffb0' : '#ff9090');
        var wps = race.run.waypoints, parts = [];
        for (var k = 0; k < wps.length - 1; k++) {
          if (wps[k].label && pb.splits && pb.splits[k] != null && me.splits[k] != null) parts.push(wps[k].label.split(' ')[0] + ' ' + fmtDiff(me.splits[k] - pb.splits[k]));
        }
        if (parts.length) text('SPLITS: ' + parts.join('  '), 22, y2 + 24, '#cfd6e0');
      } else if (me.finished) {
        text('FIRST RECORDED RUN - TIME SAVED', 22, y2 + 12, '#9fffb0');
      }
    }
    var opts = ['RETRY', 'CHANGE RUN', 'TITLE'], ox = [40, 120, 220];
    opts.forEach(function (o, i) {
      var sel = i === S.resultsIdx;
      if (sel) text('>', ox[i] - 8, 156, '#ffe14a');
      text(o, ox[i], 156, sel ? '#ffffff' : '#8a94a6');
    });
    drawChef(rows);
  }

  // ----- Easter egg: the chef pops up on the results screen; C lifts his cloche -----
  var CHEF_PAL = {
    W: '#f4f4f0', w: '#c8ccd1', S: '#e8b48c', s: '#c98e68', H: '#6b4a2f', K: '#2a2420',
    R: '#d83a34', r: '#a8262a', T: '#f4f4f0', G: '#dde0e3', L: '#a6d84a', l: '#7fae2e', P: '#3a3f4a'
  };
  var CHEF_ART = [
    '....WWWWWWW.....',
    '...WWWWWWWWW....',
    '...WWwWWWWWW....',
    '...WWWWWWwWW....',
    '...WWWWWWWWW....',
    '...WwWWWWwWW....',
    '...WWWWWWWWW....',
    '...WWWwWWWWW....',
    '...WWWWWWWwW....',
    '...wwwwwwwww....',
    '...HHHHHHHHH....',
    '...HSSSSSSSH....',
    '...SSKSSSKSS....',
    '...SSSSSSSSS....',
    '....SSsssSS.....',
    '.....SSSSS......',
    '...RRRTTTRRR....',
    '..RRRLRTRLRRR...',
    '.RRRRLRRRLRRRR..',
    '.RRGRLLLLLRRRR..',
    '.RRGRLLLLLRRRR..',
    '.RrrLLLLLLLrrR..',
    '.RR.LLLLLLL.RR..',
    '.RR.LLLLLLL.RR..',
    '.Rr.LLLLLLL.rR..',
    '.SS.LLLLLLL.SS..',
    '....LLLLLLL.....',
    '....LLLLLLL.....',
    '....lLLLLLl.....',
    '....PPP.PPP.....',
    '....PPP.PPP.....',
    '...KKKK.KKKK....'
  ];
  function chefLine(rows) {
    var me = null;
    rows.forEach(function (r) { if (r.human && r.finished && (!me || r.finalTime < me.finalTime)) me = r; });
    if (!me) return 'STILL COOKING...';
    if (me.boxes === MAX_BOXES && rows[0] === me) return "CHEF'S KISS!";
    if (rows[0] === me) return 'ORDER UP!';
    if (me.boxes === MAX_BOXES) return 'NOT ONE BOX DROPPED!';
    if (me.boxes <= 1) return 'WHO DROPPED THE BOXES?';
    return 'KEEP COOKING!';
  }
  function drawChef(rows) {
    var ctx = S.ctx, t = S.stateT;
    if (t < 1.2) return;
    var rise = Math.min(1, (t - 1.2) / 0.45), ease = 1 - (1 - rise) * (1 - rise);
    var sc = 2, w = 16 * sc, h = CHEF_ART.length * sc;
    var x = 266, y = Math.round(170 - ease * (h - 6)) + (Math.floor(t * 2) % 2);
    ctx.save();
    ctx.beginPath(); ctx.rect(14, 8, 292, 162); ctx.clip();   // peeks up from behind the panel's bottom edge
    for (var j = 0; j < CHEF_ART.length; j++) {
      for (var i = 0; i < 16; i++) {
        var c = CHEF_ART[j][i];
        if (c === '.') continue;
        ctx.fillStyle = CHEF_PAL[c];
        ctx.fillRect(x + i * sc, y + j * sc, sc, sc);
      }
    }
    // silver tray and cloche held in his right hand; C lifts the lid to reveal a white delivery box
    var lift = S.chefT != null ? Math.max(0, 1.8 - (t - S.chefT)) : 0;
    var up = lift > 0 ? Math.round(Math.min(1, lift * 4, (1.8 - lift) * 6 + 0.01) * 10) : 0;
    var tx = x + 22, ty = y + (CHEF_ART.length - 7) * sc;   // tray sits at hand height
    ctx.fillStyle = '#7d8692'; ctx.fillRect(tx, ty, 22, 2);
    if (up > 0) {
      ctx.fillStyle = '#f4f4f0'; ctx.fillRect(tx + 6, ty - 8, 10, 8);
      ctx.fillStyle = '#23336b'; ctx.fillRect(tx + 13, ty - 8, 2, 8);
      ctx.fillStyle = '#ffe14a';
      if (Math.floor(t * 8) % 2) { ctx.fillRect(tx + 3, ty - 12, 1, 1); ctx.fillRect(tx + 19, ty - 10, 1, 1); ctx.fillRect(tx + 11, ty - 15, 1, 1); }
    }
    ctx.fillStyle = '#b6bec7'; ctx.fillRect(tx + 3, ty - 7 - up, 16, 7); ctx.fillRect(tx + 5, ty - 9 - up, 12, 2);
    ctx.fillStyle = '#dde0e3'; ctx.fillRect(tx + 6, ty - 7 - up, 3, 2);
    ctx.fillStyle = '#7d8692'; ctx.fillRect(tx + 10, ty - 11 - up, 2, 2);
    ctx.restore();
    // speech bubble once he's up
    if (rise >= 1) {
      var line = lift > 0 ? 'BON APPETIT!' : (t > 6 && Math.floor(t / 3) % 2 ? 'PSST... PRESS C' : chefLine(rows));
      var bw = textW(line, 1) + 8, bx = Math.min(x - 4, 300) - bw, by = y - 4;
      ctx.fillStyle = '#f4f4f0'; ctx.fillRect(bx, by, bw, 13);
      ctx.fillStyle = '#2a2420'; ctx.fillRect(bx, by - 1, bw, 1); ctx.fillRect(bx, by + 13, bw, 1);
      ctx.fillRect(bx - 1, by, 1, 13); ctx.fillRect(bx + bw, by, 1, 13);
      ctx.fillStyle = '#f4f4f0'; ctx.fillRect(bx + bw, by + 8, 3, 2);
      G('text', ctx, line, bx + 4, by + 3, '#2a2420', 1, 'left') || text(line, bx + 4, by + 3, '#2a2420');
    }
  }

  // ----- Boot and main loop -----
  function resize() {
    var c = S.canvas;
    var w = root.innerWidth || VW, h = root.innerHeight || VH;
    var sc = Math.max(1, Math.floor(Math.min(w / VW, h / VH)));
    c.width = VW; c.height = VH;
    c.style.width = (VW * sc) + 'px';
    c.style.height = (VH * sc) + 'px';
    S.ctx.imageSmoothingEnabled = false;
  }
  function frame(now) {
    var dt = S.last == null ? DT : Math.min(0.25, Math.max(0, (now - S.last) / 1000));
    S.last = now;
    S.t += dt;
    try {
      updateUI(dt);
      if (S.race && (S.state === 'race' || S.state === 'results')) {
        S.acc += dt;
        var guard = 0;
        while (S.acc >= DT && guard++ < 20) {
          var inputs = S.state === 'race' ? [humanInput(0), humanInput(1)] : [];
          step(S.race, DT, inputs);
          S.acc -= DT;
        }
        if (guard >= 20) S.acc = 0;
        recordFinishes();
        S.race.racers.forEach(function (r) {
          if (r.human) sfxCall('engine', r.hIndex, r.finished ? -1 : clamp(Math.abs(r.speed) / MAX_SPEED, 0, 1));
        });
        if (S.state === 'race' && S.race.humansDone) {
          S.doneT = (S.doneT || 0) + dt;
          if (S.doneT > 2.0) { S.doneT = 0; go('results'); }
        } else S.doneT = 0;
      }
      render(dt);
    } catch (e) {
      if (root.console) console.error(e);
    }
    pressed = {};
    root.requestAnimationFrame(frame);
  }
  function boot(canvas) {
    var ctx = canvas.getContext('2d');
    S = {
      canvas: canvas, ctx: ctx, state: 'title', stateT: 0, t: 0, last: null, acc: 0,
      modeIdx: 0, runIdx: 0, mode: '1p', runKey: 'stockroom',
      colorSel: [0, 1], colorDone: [false, false], race: null, cams: [],
      pauseIdx: 0, resultsIdx: 0, best: loadBest(), newBest: {}, recorded: {}, unlocked: false, doneT: 0
    };
    resize();
    root.addEventListener('resize', resize);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('blur', function () { keys = {}; });
    if (gfxFn('init')) { try { AGV.gfx.init(); } catch (e) { if (root.console) console.warn('gfx.init failed:', e); } }
    // 3D race view: textures first, then the renderer (both optional; without them races use the top-down view).
    ['tex', 'view3d'].forEach(function (k) {
      var m = AGV[k];
      if (m && typeof m.init === 'function') { try { m.init(); } catch (e) { if (root.console) console.warn(k + '.init failed:', e); } }
    });
    root.requestAnimationFrame(frame);
  }

  // ===== Export =====
  AGV.game = {
    boot: boot, createRace: createRace, step: step,
    MAX_SPEED: MAX_SPEED, RADIUS: R, DT: DT, COLORS: COLORS, BOX_PENALTY: BOX_PENALTY,
    fmtTime: fmtTime, loadBest: loadBest,
    _runtime: function () { return S; }   // debug/inspection hook for the browser console
  };
})();
