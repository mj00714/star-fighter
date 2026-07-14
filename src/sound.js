// ──────────────────────────────────────────────────────────────────────────
//  sound.js — light, fully procedural SFX via the Web Audio API. No audio
//  files (stays offline / double-click). Browsers require a user gesture before
//  audio can start, so the context is created on the first input. Press N to mute.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.Sound = (function () {
  let ctx = null, master = null, sfx = null, muted = false, lastHit = 0;
  const VOL = 0.3;   // overall "light" level

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOL;
    master.connect(ctx.destination);
    // SFX bus with a low-shelf boost for body (music bypasses this)
    sfx = ctx.createGain();
    const ls = ctx.createBiquadFilter();
    ls.type = 'lowshelf'; ls.frequency.value = 180; ls.gain.value = 5;
    sfx.connect(ls).connect(master);
  }
  // wake audio on the first gesture; toggle mute on N
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, ensure, { passive: true }));
  window.addEventListener('keydown', e => { if (e.code === 'KeyN') toggleMute(); });

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : VOL;
    console.log('[sound] ' + (muted ? 'muted' : 'on'));
  }

  // a pitched tone with a fast attack + exponential decay (out defaults to SFX bus)
  function blip(type, f0, f1, dur, gain, attack, out) {
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + (attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfx); o.start(t); o.stop(t + dur + 0.03);
  }

  // a low sine "thump" layered under action sounds for weight
  function sub(f0, f1, dur, gain, out) {
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfx); o.start(t); o.stop(t + dur + 0.02);
  }

  // build an HRTF 3D panner at a world position (binaural — shines on headphones).
  // Coords are transformed into the ship's frame so the default listener works.
  function panAt(world) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = 700; p.rolloffFactor = 0.55; p.maxDistance = 16000;
    const rel = world.clone().sub(SF.Ship.pos);
    const x = rel.dot(SF.Ship.right), y = rel.dot(SF.Ship.up), z = rel.dot(SF.Ship.fwd);
    // listener faces -Z, so "in front" (z>0) maps to negative panner Z
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = -z; }
    else p.setPosition(x, y, -z);
    p.connect(sfx);
    return p;
  }

  function noiseSrc(dur) {
    const n = Math.max(1, (ctx.sampleRate * dur) | 0);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = buf; return s;
  }

  function boom(size, out) {
    if (!ctx) return;
    const t = ctx.currentTime, dur = 0.35 + size * 0.45;
    const s = noiseSrc(dur), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700 + size * 500, t);
    lp.frequency.exponentialRampToValueAtTime(110, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5 * size, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(lp).connect(g).connect(out || sfx); s.start(t); s.stop(t + dur);
    blip('sine', 150, 40, 0.28, 0.45 * size, 0.005, out);   // low thump
    sub(78, 30, 0.4 + size * 0.4, 0.6 * size, out);          // deep chest-thump
  }

  // ── music: a slow, tense procedural loop for the menus ──
  //  Progression Am · F · Dm · E — minor for the menace, the E-major dominant
  //  for drama. Uses a lookahead scheduler so timing stays tight.
  let musicGain = null, musicOn = false, schedTimer = null, mstep = 0, mnext = 0;
  const M_VOL = 0.6, BPM = 90, SPB = 60 / BPM, MSTEP = SPB / 2;
  const PROG = [
    { bass: 45, notes: [57, 60, 64] },   // Am
    { bass: 41, notes: [53, 57, 60] },   // F
    { bass: 38, notes: [50, 53, 57] },   // Dm
    { bass: 40, notes: [52, 56, 59] },   // E  (dominant)
  ];
  const ARP = [0, 1, 2, 1];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function mPad(notes, dur, t) {
    notes.forEach(n => {
      for (const det of [-6, 6]) {       // two detuned saws per note = warmth
        const o = ctx.createOscillator(), g = ctx.createGain(),
              lp = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
        lp.type = 'lowpass'; lp.frequency.value = 850;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.9);          // slow swell
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const pan = ctx.createStereoPanner(); pan.pan.value = det < 0 ? -0.4 : 0.4;
        o.connect(lp).connect(g).connect(pan).connect(musicGain);   // stereo width
        o.start(t); o.stop(t + dur + 0.05);
      }
    });
  }
  function mBass(n, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(n);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + SPB * 0.95);
    o.connect(g).connect(musicGain); o.start(t); o.stop(t + SPB);
  }
  function mPluck(n, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(n);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(musicGain); o.start(t); o.stop(t + 0.5);
  }
  function mSchedule(s, t) {
    const chord = PROG[Math.floor((s % 32) / 8)], beat = s % 8;
    if (beat === 0) mPad(chord.notes, SPB * 4, t);            // chord every bar
    if (beat === 0 || beat === 4) mBass(chord.bass, t);       // bass on 1 & 3
    if (s % 2 === 0)                                          // quarter-note arp
      mPluck(chord.notes[ARP[s % ARP.length] % chord.notes.length] + 12, t);
  }
  function mTick() {
    if (!musicOn || !ctx) return;
    while (mnext < ctx.currentTime + 0.2) { mSchedule(mstep, mnext); mnext += MSTEP; mstep++; }
  }
  function musicStart() {
    ensure(); if (!ctx || musicOn) return;
    if (!musicGain) { musicGain = ctx.createGain(); musicGain.connect(master); }
    musicOn = true; mstep = 0; mnext = ctx.currentTime + 0.12;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(M_VOL, ctx.currentTime + 0.6);
    schedTimer = setInterval(mTick, 25);
  }
  function musicStop() {
    if (!musicOn) return;
    musicOn = false; clearInterval(schedTimer); schedTimer = null;
    if (musicGain) {                                          // fade the tail out
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    }
  }

  // ── boost: a harmonic, electric "IconicSounds"-style swell (no noise).
  //  A tonal chord stack — fundamental + fifth + octave + shimmer — that glides
  //  up in pitch & brightness with speed, with a slow LFO for a living shimmer.
  let boostNodes = null, boostState = false;
  const BOOST_RATIOS = [1, 1.5, 2, 3];                  // fundamental, 5th, 8ve, +5th
  function buildBoost() {
    const out = ctx.createGain(); out.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = 1400; lp.Q.value = 0.6;
    lp.connect(out).connect(sfx);
    const types = ['triangle', 'sine', 'sine', 'triangle'];
    const vol = [0.5, 0.32, 0.34, 0.12];
    const osc = [];
    BOOST_RATIOS.forEach((r, i) => {
      const o = ctx.createOscillator(); o.type = types[i];
      o.frequency.value = 92 * r; o.detune.value = i % 2 ? 6 : -6;   // chorus width
      const g = ctx.createGain(); g.gain.value = vol[i];
      o.connect(g).connect(lp); o.start(); osc.push(o);
    });
    // slow shimmer on the filter cutoff = subtle movement
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.55;
    const lfoG = ctx.createGain(); lfoG.gain.value = 320;
    lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    boostNodes = { gain: out, lp, osc };
  }
  // active: boosting now?  level: 0..1 speed (drives pitch/brightness)
  function boost(active, level) {
    ensure(); if (!ctx) return;
    level = level || 0;
    if (active && !boostNodes) buildBoost();
    if (active) {
      const t = ctx.currentTime, n = boostNodes;
      if (!boostState) {                         // engage
        boostState = true;
        n.gain.gain.cancelScheduledValues(t);
        n.gain.gain.setValueAtTime(Math.max(0.0001, n.gain.gain.value), t);
        n.gain.gain.linearRampToValueAtTime(0.17, t + 0.25);
        blip('sine', 320, 1500, 0.55, 0.07, 0.06);   // airy rising ignition swell
      }
      const base = 92 + level * 78;              // glides up with speed
      n.osc.forEach((o, i) => o.frequency.setTargetAtTime(base * BOOST_RATIOS[i], t, 0.15));
      n.lp.frequency.setTargetAtTime(1300 + level * 2800, t, 0.2);
    } else if (boostState) {                      // disengage
      boostState = false;
      const t = ctx.currentTime;
      boostNodes.gain.gain.cancelScheduledValues(t);
      boostNodes.gain.gain.setValueAtTime(boostNodes.gain.gain.value, t);
      boostNodes.gain.gain.linearRampToValueAtTime(0.0001, t + 0.45);
    }
  }

  return {
    resume: ensure,
    toggleMute, boost,
    musicStart, musicStop,
    plasma()  { blip('square', 1500, 420, 0.085, 0.10, 0.002);
                sub(140, 62, 0.05, 0.09); },          // tight low punch per bolt
    missile() {
      if (!ctx) return;
      const t = ctx.currentTime, dur = 0.5;
      const s = noiseSrc(dur), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(1600, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.26, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(bp).connect(g).connect(sfx); s.start(t); s.stop(t + dur);
      blip('sawtooth', 180, 520, 0.4, 0.12, 0.01);
      sub(95, 46, 0.45, 0.3);                          // launch whump
    },
    // pos (THREE.Vector3) optional — when given, the boom is positioned in 3D
    explosion(size, pos) { if (!ctx) return; boom(size || 1, pos ? panAt(pos) : null); },
    // a short, directional cue for an enemy shot fired from `pos`
    enemyFire(pos) {
      if (!ctx) return;
      const out = panAt(pos);
      blip('square', 520, 190, 0.09, 0.13, 0.002, out);
      sub(150, 70, 0.06, 0.1, out);
    },
    pickup() {                                    // resupply ring chime (rising)
      blip('triangle', 540, 760, 0.12, 0.14, 0.005);
      blip('triangle', 810, 1180, 0.18, 0.12, 0.03);
      sub(160, 220, 0.1, 0.12);
    },
    hit() {
      const now = performance.now();
      if (now - lastHit < 90) return;                  // throttle bursts
      lastHit = now;
      blip('sawtooth', 360, 80, 0.18, 0.3, 0.003);
      if (!ctx) return;
      const t = ctx.currentTime, s = noiseSrc(0.12), g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      s.connect(g).connect(sfx); s.start(t); s.stop(t + 0.12);
      sub(120, 44, 0.2, 0.34);                         // impact thud
    },
  };
})();
