/* Peabody AGV Rally - audio.js
 * WebAudio-only chiptune: synthesized SFX, per-player engine hum and a looping tune.
 * Owner: ART agent. Every call is a safe no-op when audio is unavailable, locked or muted.
 */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var AGV = G.AGV = G.AGV || {};

  var AC = G.AudioContext || G.webkitAudioContext || null;
  var ctx = null, master = null, sfxBus = null, musBus = null, engBus = null;
  var noiseBuf = null, pulse25 = null, pulse12 = null;
  var muted = false, musicWanted = false, musicOn = false;
  var MASTER_VOL = 0.5;

  function now() { return ctx ? ctx.currentTime : 0; }
  function ready() { return !!(ctx && ctx.state !== 'closed'); }

  function setup() {
    if (ctx || !AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOL;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
      musBus = ctx.createGain(); musBus.gain.value = 0.32; musBus.connect(master);
      engBus = ctx.createGain(); engBus.gain.value = 0.5; engBus.connect(master);
      // 1 s of white noise, shared by all noise voices
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      pulse25 = makePulse(0.25);
      pulse12 = makePulse(0.125);
    } catch (e) {
      ctx = null;
    }
  }

  // NES-style pulse waves with a given duty cycle.
  function makePulse(duty) {
    var n = 32, re = new Float32Array(n), im = new Float32Array(n);
    for (var k = 1; k < n; k++) {
      re[k] = 0;
      im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    }
    try { return ctx.createPeriodicWave(re, im); } catch (e) { return null; }
  }

  function setWave(o, type) {
    if (type === 'pulse25' && pulse25) o.setPeriodicWave(pulse25);
    else if (type === 'pulse12' && pulse12) o.setPeriodicWave(pulse12);
    else o.type = (type === 'pulse25' || type === 'pulse12') ? 'square' : type;
  }

  // One tone: type, start time, duration, freq (and optional slide target), volume.
  function tone(bus, type, t0, dur, f0, f1, vol, attack) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    setWave(o, type);
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    var a = attack || 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + a);
    g.gain.setValueAtTime(vol, t0 + Math.max(a, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(bus, t0, dur, vol, filt, f0, f1) {
    var s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = noiseBuf;
    s.loop = true;
    f.type = filt || 'lowpass';
    f.frequency.setValueAtTime(f0 || 2000, t0);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  }

  function hz(n) { return 440 * Math.pow(2, (n - 69) / 12); } // MIDI note -> Hz

  // ---------------------------------------------------------------------------
  // SFX
  // ---------------------------------------------------------------------------
  var SFX = {
    menu: function (t) { tone(sfxBus, 'pulse25', t, 0.05, hz(84), 0, 0.18); },
    select: function (t) {
      tone(sfxBus, 'pulse25', t, 0.06, hz(79), 0, 0.2);
      tone(sfxBus, 'pulse25', t + 0.06, 0.1, hz(91), 0, 0.2);
    },
    count: function (t) { tone(sfxBus, 'square', t, 0.22, hz(69), 0, 0.2); },
    go: function (t) {
      tone(sfxBus, 'square', t, 0.45, hz(81), 0, 0.22);
      tone(sfxBus, 'pulse25', t, 0.45, hz(93), 0, 0.12);
    },
    bump: function (t) {
      noise(sfxBus, t, 0.12, 0.35, 'lowpass', 900, 200);
      tone(sfxBus, 'square', t, 0.1, 140, 60, 0.18);
    },
    estop: function (t) {
      for (var i = 0; i < 4; i++) tone(sfxBus, 'pulse25', t + i * 0.09, 0.08, i & 1 ? 784 : 1175, 0, 0.16);
    },
    pickup: function (t) {
      [72, 76, 79, 84, 88].forEach(function (n, i) { tone(sfxBus, 'pulse25', t + i * 0.04, 0.06, hz(n), 0, 0.17); });
    },
    boost: function (t) {
      tone(sfxBus, 'sawtooth', t, 0.35, 180, 1100, 0.12);
      tone(sfxBus, 'square', t, 0.3, 90, 400, 0.08);
      noise(sfxBus, t, 0.4, 0.18, 'bandpass', 800, 4000);
    },
    drop: function (t) { tone(sfxBus, 'square', t, 0.14, 520, 140, 0.18); },
    ping: function (t) {
      for (var i = 0; i < 3; i++) tone(sfxBus, 'triangle', t + i * 0.16, 0.18, 1568, 1480, 0.3 / (i + 1), 0.002);
    },
    boxlost: function (t) {
      [67, 63, 58].forEach(function (n, i) {
        tone(sfxBus, 'triangle', t + i * 0.12, 0.14, hz(n), hz(n - 1), 0.32);
        tone(sfxBus, 'pulse12', t + i * 0.12, 0.12, hz(n + 12), 0, 0.06);
      });
      noise(sfxBus, t + 0.02, 0.15, 0.15, 'lowpass', 600, 150);
    },
    finish: function (t) {
      var seq = [[72, 0.1], [76, 0.1], [79, 0.1], [84, 0.2], [79, 0.1], [84, 0.5]];
      var tt = t;
      seq.forEach(function (s) {
        tone(sfxBus, 'pulse25', tt, s[1] * 0.95, hz(s[0]), 0, 0.2);
        tone(sfxBus, 'triangle', tt, s[1] * 0.95, hz(s[0] - 24), 0, 0.3);
        tt += s[1];
      });
    },
    checkpoint: function (t) {
      tone(sfxBus, 'pulse25', t, 0.05, hz(88), 0, 0.14);
      tone(sfxBus, 'pulse25', t + 0.05, 0.08, hz(95), 0, 0.14);
    }
  };

  function play(name) {
    try {
      if (!ready() || ctx.state !== 'running' || muted) return;
      var f = SFX[name];
      if (f) f(now() + 0.005);
    } catch (e) { /* never throw from audio */ }
  }

  // ---------------------------------------------------------------------------
  // Engine hum: an electric-motor whine per human player
  // ---------------------------------------------------------------------------
  var engines = [];
  function makeEngine() {
    var e = {};
    e.o1 = ctx.createOscillator(); setWave(e.o1, 'pulse25');
    e.o2 = ctx.createOscillator(); e.o2.type = 'sawtooth';
    e.f = ctx.createBiquadFilter(); e.f.type = 'lowpass'; e.f.frequency.value = 600; e.f.Q.value = 2;
    e.g = ctx.createGain(); e.g.gain.value = 0;
    e.o1.connect(e.f); e.o2.connect(e.f); e.f.connect(e.g); e.g.connect(engBus);
    e.o1.frequency.value = 60; e.o2.frequency.value = 60.7;
    e.o1.start(); e.o2.start();
    return e;
  }
  function engine(i, speedFrac) {
    try {
      if (!ready()) return;
      i = i ? 1 : 0;
      var e = engines[i];
      if (speedFrac === undefined || speedFrac === null || speedFrac < 0) {
        if (e) e.g.gain.setTargetAtTime(0, now(), 0.05);
        return;
      }
      if (!e) e = engines[i] = makeEngine();
      var s = Math.max(0, Math.min(1, speedFrac));
      var t = now();
      var base = (i ? 62 : 55) + s * 150;
      e.o1.frequency.setTargetAtTime(base, t, 0.06);
      e.o2.frequency.setTargetAtTime(base * 2.003, t, 0.06);
      e.f.frequency.setTargetAtTime(400 + s * 1600, t, 0.08);
      e.g.gain.setTargetAtTime(0.035 + s * 0.05, t, 0.06);
    } catch (err) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Music: 8-bar loop, 16th-note steps, scheduled with lookahead.
  // Notes are MIDI numbers, 0 = rest. Lead / bass per step; drums by pattern.
  // ---------------------------------------------------------------------------
  var BPM = 144, STEP = 60 / BPM / 4;
  var _ = 0;
  var LEAD = [
    // bar 1-2 (Am)
    69, _, 72, _, 76, _, 72, 74, 76, _, 79, _, 76, _, 74, 72,
    74, _, 77, _, 81, _, 77, 76, 74, _, 72, _, 71, _, 67, _,
    // bar 3-4 (F -> G)
    69, _, 72, _, 77, _, 76, 74, 72, _, 74, _, 76, _, 79, _,
    81, _, 79, _, 76, _, 74, _, 76, 76, _, 74, 71, _, _, _,
    // bar 5-6 (variation, up an octave feel)
    81, _, 79, 81, 84, _, 81, _, 79, _, 76, _, 79, _, 81, _,
    77, _, 76, 77, 81, _, 77, _, 76, _, 74, _, 72, _, 74, _,
    // bar 7-8 (turnaround)
    76, _, 72, _, 69, _, 72, 76, 79, _, 77, _, 76, _, 74, _,
    72, _, 71, _, 69, _, _, _, 71, _, 72, _, 74, _, 76, _
  ];
  var BASSROOT = [45, 45, 41, 43, 45, 41, 45, 40]; // per bar: A A F G A F A E
  var BASSPAT = [0, _, 12, _, 0, _, 12, 0, 0, _, 12, _, 7, _, 12, _];
  var KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0];
  var SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
  var HAT = [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1];
  var stepIdx = 0, nextTime = 0, timer = null;

  function schedStep(n, t) {
    var bar = Math.floor(n / 16) % 8, s = n % 16;
    var lead = LEAD[(bar * 16 + s) % LEAD.length];
    if (lead) {
      var len = 1;
      while (len < 4 && !LEAD[(bar * 16 + s + len) % LEAD.length] && s + len < 16 && (s + len) % 4 !== 0) len++;
      tone(musBus, 'pulse25', t, STEP * len * 0.9, hz(lead), 0, 0.13);
      tone(musBus, 'pulse12', t + STEP * 0.5, STEP * len * 0.8, hz(lead), 0, 0.035); // echo
    }
    var b = BASSPAT[s];
    if (b !== _ || s === 0) tone(musBus, 'triangle', t, STEP * 0.95, hz(BASSROOT[bar] + (b || 0)), 0, 0.42);
    if (KICK[s]) { tone(musBus, 'sine', t, 0.12, 150, 45, 0.5, 0.002); }
    if (SNARE[s]) noise(musBus, t, 0.12, 0.22, 'highpass', 1200);
    if (HAT[s]) noise(musBus, t, 0.03, 0.08, 'highpass', 7000);
  }

  function pump() {
    if (!ready() || !musicOn) return;
    try {
      var horizon = now() + 0.12;
      if (nextTime < now() - 0.2) nextTime = now() + 0.03; // recover after a stall (background tab)
      while (nextTime < horizon) {
        schedStep(stepIdx, nextTime);
        stepIdx = (stepIdx + 1) % (16 * 8);
        nextTime += STEP;
      }
    } catch (e) { /* ignore */ }
  }

  function startMusic() {
    if (!ready() || musicOn) return;
    musicOn = true;
    stepIdx = 0;
    nextTime = now() + 0.06;
    pump();
    timer = setInterval(pump, 25);
  }
  function stopMusic() {
    musicOn = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  function music(on) {
    try {
      musicWanted = !!on;
      if (!ready() || ctx.state !== 'running') return;
      if (musicWanted) startMusic(); else stopMusic();
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  function unlock() {
    try {
      setup();
      if (!ctx) return;
      var after = function () { if (musicWanted && !musicOn) startMusic(); };
      if (ctx.state === 'suspended' && ctx.resume) {
        var p = ctx.resume();
        if (p && p.then) p.then(after, function () {}); else after();
      } else {
        after();
      }
    } catch (e) { /* ignore */ }
  }

  function applyMute() {
    try {
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, ctx.currentTime, 0.02);
    } catch (e) { /* ignore */ }
  }

  var sfx = {
    unlock: unlock,
    play: play,
    engine: engine,
    music: music,
    toggleMute: function () { sfx.muted = !muted; return muted; }
  };
  Object.defineProperty(sfx, 'muted', {
    enumerable: true,
    get: function () { return muted; },
    set: function (v) { muted = !!v; applyMute(); }
  });
  AGV.sfx = sfx;
})();
