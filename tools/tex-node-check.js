// Node check for js/tex.js: loads map.js + tex.js, calls init() and validates every API.
// Usage: node tools/tex-node-check.js
var path = require('path');
require(path.join(__dirname, '../js/map.js'));
require(path.join(__dirname, '../js/tex.js'));
var AGV = globalThis.AGV, tx = AGV.tex, errs = 0, count = 0;
function check(name, t, w, h) {
  count++;
  if (!t || !(t.data instanceof Uint32Array)) { errs++; return console.log('BAD', name, 'no data'); }
  if (t.data.length !== t.w * t.h) { errs++; console.log('BAD', name, 'len', t.data.length, t.w, t.h); }
  if (w && (t.w !== w || t.h !== h)) { errs++; console.log('BAD', name, 'size', t.w, t.h, 'want', w, h); }
  var opaque = 0;
  for (var i = 0; i < t.data.length; i++) if (t.data[i] >>> 24) opaque++;
  if (!opaque) { errs++; console.log('BAD', name, 'fully transparent'); }
}
function num(name, v) { if (typeof v !== 'number' || !isFinite(v)) { errs++; console.log('BAD', name, v); } }
var t0 = Date.now();
tx.init(); tx.init();
console.log('init x2', Date.now() - t0, 'ms');
var m = AGV.map, T = AGV.T;
if (tx.floorIndex.length !== m.W * m.H) { errs++; console.log('BAD floorIndex len'); }
for (var i = 0; i < tx.floorIndex.length; i++) if (tx.floorIndex[i] >= tx.floorTextures.length) { errs++; console.log('BAD floorIndex', i); break; }
tx.floorTextures.forEach(function (t, i) { check('floor' + i, t, 16, 16); });
check('ceiling', tx.ceiling, 64, 64);
var seen = new Set();
for (var y = 0; y < m.H; y++) for (var x = 0; x < m.W; x++) for (var f = 0; f < 2; f++) {
  var w = tx.wall(m.tiles[y * m.W + x], x, y, f); if (!seen.has(w)) { seen.add(w); check('wall', w, 32, 96); }
}
[T.WALL, T.RACK, T.ROOM, T.DOCKDOOR, T.WINDOW, T.OUTSIDE, T.CURB].forEach(function (id) {
  check('wall-oob' + id, tx.wall(id, -5, -5, 0), 32, 96); check('wall-oob' + id, tx.wall(id, 999, 3, 1), 32, 96);
});
console.log('distinct wall textures', seen.size, 'floor textures', tx.floorTextures.length);
['stockroom', 'decon', 'double', 'nope'].forEach(function (k) {
  var d = tx.decal(k);
  if (d.scale !== 2 || d.w !== m.W * 8 || d.h !== m.H * 8 || d.data.length !== d.w * d.h) { errs++; console.log('BAD decal', k); }
  var n = 0; for (var i = 0; i < d.data.length; i++) if (d.data[i]) n++;
  console.log('decal', k, 'painted cells', n);
});
['bollard', 'column', 'palletjack', 'bins', 'crates', 'cart', 'exitsign', 'pickup', 'drop_wrap', 'drop_peanuts', 'drop_box', 'ehs']
  .forEach(function (n) {
    for (var f = 0; f < 5; f++) {
      var s = tx.sprite(n, f); if (!s) { errs++; console.log('BAD sprite', n); continue; }
      check('sprite ' + n, s.tex); num(n + '.worldW', s.worldW); num(n + '.worldH', s.worldH); num(n + '.z', s.z);
    }
  });
if (tx.sprite('nope') !== null) { errs++; console.log('BAD unknown sprite should be null'); }
t0 = Date.now();
['#e04040', '#3a7bff', '#c060ff'].forEach(function (c) {
  for (var b = 0; b <= 4; b++) for (var v = -1; v < 17; v++) [false, true].forEach(function (r) {
    var a = tx.agv(c, b, v, r); check('agv', a.tex, 48, 42); num('agv.worldW', a.worldW); num('agv.worldH', a.worldH);
    if (!(a.z <= 0)) { errs++; console.log('BAD agv z'); }
  });
});
console.log('agv renders', Date.now() - t0, 'ms');
check('door0', tx.boxFace('door', 0), 16, 56); check('door1', tx.boxFace('door', 1), 16, 56);
check('mover0', tx.boxFace('mover', 0), 32, 96); check('mover1', tx.boxFace('mover', 1), 32, 96);
console.log(errs ? 'FAIL ' + errs + ' errors' : 'OK', count, 'textures checked');
process.exit(errs ? 1 : 0);
