#!/usr/bin/env node
// Headless race simulator: runs CPU-only races on every run and several seeds.
// Usage: node tools/sim.js [--seeds N] [--verbose] [--stub]
// Exits non-zero if any CPU fails to finish within 240 s or any racer centre is ever inside a solid tile.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var rootDir = path.join(__dirname, '..');
function load(file) {
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}
var mapFile = path.join(rootDir, 'js', 'map.js');
var usingStub = process.argv.indexOf('--stub') >= 0 || !fs.existsSync(mapFile);
load(usingStub ? path.join(__dirname, 'sim-stub-map.js') : mapFile);
load(path.join(rootDir, 'js', 'game.js'));

var AGV = globalThis.AGV;
var args = process.argv.slice(2);
var nSeeds = 5, verbose = args.indexOf('--verbose') >= 0;
var si = args.indexOf('--seeds');
if (si >= 0) nSeeds = parseInt(args[si + 1], 10) || 5;
var runs = ['stockroom', 'decon', 'double'];
var LIMIT = 240, DT = 1 / 60;
var T = AGV.TILE || 16;

function insideSolid(r) {
  return AGV.isSolid(AGV.map.at(Math.floor(r.x / T), Math.floor(r.y / T)));
}
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

console.log('map: ' + (usingStub ? 'tools/sim-stub-map.js (STUB)' : 'js/map.js') + '  ' + AGV.map.W + 'x' + AGV.map.H + ' tiles');
var failures = [], tunnels = [];
var summary = {};
runs.forEach(function (runKey) {
  var times = [], estops = 0, lost = 0, stuck = 0;
  console.log('\n' + runKey.toUpperCase() + '  (' + AGV.map.runs[runKey].waypoints.length + ' waypoints)');
  for (var seed = 1; seed <= nSeeds; seed++) {
    var race = AGV.game.createRace(runKey, '1p', { humans: 0, seed: seed, audio: false });
    var tunnelSeen = {};
    while (!race.done && race.t < LIMIT) {
      AGV.game.step(race, DT, []);
      race.racers.forEach(function (r, i) {
        if (!tunnelSeen[i] && insideSolid(r)) {
          tunnelSeen[i] = true;
          tunnels.push(runKey + ' seed ' + seed + ' ' + r.name + ' at (' + r.x.toFixed(1) + ',' + r.y.toFixed(1) + ') t=' + race.t.toFixed(2));
        }
      });
    }
    var cells = race.racers.map(function (r) {
      estops += r.estops; lost += 4 - r.boxes; stuck = Math.max(stuck, r.stuckMax);
      if (r.finished) times.push(r.finishTime);
      else failures.push(runKey + ' seed ' + seed + ' ' + r.name + ' stuck at wp ' + r.wp + '/' + race.run.waypoints.length +
        ' (' + r.x.toFixed(0) + ',' + r.y.toFixed(0) + ') tile (' + Math.floor(r.x / T) + ',' + Math.floor(r.y / T) + ')');
      return pad((r.finished ? r.finishTime.toFixed(1) + 's' : 'DNF@' + r.wp) + ' b' + r.boxes + ' e' + r.estops + ' s' + r.stuckMax.toFixed(1), 22);
    });
    console.log('  seed ' + seed + ': ' + cells.join(' '));
    if (verbose) {
      race.racers.forEach(function (r) { console.log('    ' + r.name + ' skill ' + r.skill + ' off ' + r.ai.offset); });
    }
  }
  if (times.length) {
    var mn = Math.min.apply(null, times), mx = Math.max.apply(null, times), avg = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
    summary[runKey] = 'finish ' + mn.toFixed(1) + '-' + mx.toFixed(1) + 's (avg ' + avg.toFixed(1) + ')  estops ' + estops + '  boxes lost ' + lost + '  max stuck ' + stuck.toFixed(1) + 's';
  } else summary[runKey] = 'no finishers';
  console.log('  => ' + summary[runKey]);
});
console.log('\n(cell = finish time, b = boxes left, e = E-STOPs, s = longest no-progress stretch)');
if (tunnels.length) { console.log('\nTUNNELLING (racer centre inside a solid tile):'); tunnels.forEach(function (s) { console.log('  ' + s); }); }
if (failures.length) { console.log('\nDNF:'); failures.forEach(function (s) { console.log('  ' + s); }); }
var ok = !tunnels.length && !failures.length;
console.log('\n' + (ok ? 'OK: all CPUs finished, no tunnelling.' : 'FAIL'));
process.exit(ok ? 0 : 1);
