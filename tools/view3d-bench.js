// Node benchmark / smoke test for js/view3d.js (no DOM).
// Usage: node tools/view3d-bench.js
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'js/map.js'));
try { require(path.join(root, 'js/tex.js')); } catch (e) { console.log('tex.js not loaded:', e.message); }
require(path.join(root, 'js/view3d.js'));
var AGV = globalThis.AGV;
if (AGV.tex && AGV.tex.init) { try { AGV.tex.init(); } catch (e) { console.log('tex.init threw (no DOM?)', e.message); } }
AGV.view3d.init();
var T = 16;
var ctx = { putImageData: function () {} };
var cams = {
  hall: { x: 30 * T, y: 84 * T, angle: 0 },
  dock: { x: 15 * T, y: 128 * T, angle: -Math.PI / 2 },
  stockroom: { x: 123 * T, y: 72 * T, angle: -Math.PI / 2 },
  decon: { x: 107 * T, y: 89 * T, angle: Math.PI / 2 },
  corner: { x: 107 * T, y: 86 * T, angle: -Math.PI / 2 }
};
function scene(cam, t) {
  var fx = Math.cos(cam.angle), fy = Math.sin(cam.angle);
  var racers = [0, 1, 2, 3].map(function (i) {
    return { x: cam.x + fx * (44 + i * 30) + (i - 1.5) * 12 * -fy, y: cam.y + fy * (44 + i * 30) + (i - 1.5) * 12 * fx,
      angle: cam.angle + i * 0.8, color: ['#e04040', '#3a7bff', '#c060ff', '#3ccf5a'][i], boxes: 4 - i, estop: i === 2 };
  });
  return { t: t, runKey: 'stockroom', racers: racers, pickups: AGV.map.pickups, drops: [],
    doors: AGV.map.doors.map(function (d) { return { door: d, openFrac: AGV.doorOpen(d, t) }; }),
    movers: AGV.map.movers.map(function (m) { return { mover: m, rect: AGV.moverRect(m, t) }; }),
    particles: [{ x: cam.x + fx * 60, y: cam.y + fy * 60, z: 5, color: '#ffcc00', size: 2 }] };
}
Object.keys(cams).forEach(function (k) {
  var c = cams[k]; c.z = 30; c.fov = 1.15; c.pitch = 0;
  for (var w = 0; w < 50; w++) AGV.view3d.render(ctx, 0, 0, 320, 180, c, scene(c, w / 60));
  var N = 400, t0 = process.hrtime.bigint();
  for (var i = 0; i < N; i++) AGV.view3d.render(ctx, 0, 0, 320, 180, c, scene(c, i / 60));
  var ms1 = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  t0 = process.hrtime.bigint();
  for (i = 0; i < N; i++) {
    AGV.view3d.render(ctx, 0, 0, 160, 180, c, scene(c, i / 60));
    AGV.view3d.render(ctx, 160, 0, 160, 180, c, scene(c, i / 60));
  }
  var ms2 = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(k.padEnd(10), '320x180:', ms1.toFixed(2), 'ms   2x160x180:', ms2.toFixed(2), 'ms');
});
// Robustness: nonsense input must not throw.
AGV.view3d.render(ctx, 0, 0, 320, 180, { x: NaN, y: 1e9, angle: Infinity }, null);
AGV.view3d.render(ctx, 0, 0, 320, 180, { x: 3 * T, y: 3 * T, z: 0, angle: 1 }, { racers: [null, {}], doors: [{}], movers: [{}] });
console.log('project:', JSON.stringify(AGV.view3d.project(cams.hall, 320, 180, cams.hall.x + 100, cams.hall.y, 0)));
console.log('behind:', AGV.view3d.project(cams.hall, 320, 180, cams.hall.x - 100, cams.hall.y, 0));
