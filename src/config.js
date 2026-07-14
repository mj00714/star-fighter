// ──────────────────────────────────────────────────────────────────────────
//  config.js — all tunables + the SN30 Pro control map, in one place.
//  Iteration 1. Everything here is meant to be edited freely between passes.
// ──────────────────────────────────────────────────────────────────────────
'use strict';
window.SF = window.SF || {};

// small shared math helpers
SF.U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp:  (a, b, t) => a + (b - a) * t,
  rand:  (a, b) => a + Math.random() * (b - a),
  // approach `cur` toward `tgt` at rate k (frame-rate independent)
  approach: (cur, tgt, k, dt) => cur + (tgt - cur) * (1 - Math.exp(-k * dt)),
  deg: r => (r * 180) / Math.PI,
};

SF.CFG = {
  // render: both canvases are sized to the stage's true on-screen pixels
  // (CSS scale × devicePixelRatio) so nothing is blurred by upscaling.
  // renderScale is an extra 3D supersample on top of that:
  //   1.0 = pixel-perfect + MSAA · >1 = extra AA · <1 = chunky retro
  // maxPixelScale caps backing-store size (device px per stage px) for perf.
  display: { width: 960, height: 540, renderScale: 1.0, maxPixelScale: 3.0 },

  flight: {
    maxSpeed:     440,    // world units/sec at full throttle
    boostMult:    1.85,   // throttle multiplier while boosting
    throttleRate: 0.85,   // throttle sweep speed (full travel ≈ 1.2s)
    pitchRate:    1.45,   // max rad/s
    yawRate:      1.10,   // bumped: in twin-stick, yaw is your primary left/right turn
    rollRate:     2.50,
    rotDamp:      7.0,    // how fast actual turn rate chases the stick (snappiness)
    flightAssist: 0.90,   // 0..1 — THE knob. 1 = velocity locks to nose (arcade),
                          //                  low = momentum is kept (drift / Newtonian)
    assistLerp:   3.0,    // base rate velocity chases the nose (scaled by assist)
    brakePower:   1.9,    // how hard the air-brake bleeds throttle
    invertPitch:  true,   // inverted: pull stick DOWN = nose up (flight-sim style)
    deadzone:     0.12,
  },

  weapons: {
    // cd is the per-bolt interval; ports alternate, so overall rate of fire is
    // unchanged from the old "both barrels every 0.11s" (≈18 bolts/sec).
    // converge = distance where wingtip fire crosses the sight line (X-wing style)
    plasma: { speed: 1725, cd: 0.055, life: 1.5, dmg: 1, color: 0x66ddff,
              converge: 600 },
    // missile types: heavy dumbfire · single homing · homing swarm salvo.
    // `ammo` is the carry CAP (you start full; resupply rings top up to it).
    m1: { name: 'HAMMER', ammo: 4,  speed: 620, accel: 1500, life: 4.0,
          dmg: 60, blast: 175, homing: false, color: 0xffb23a },
    m2: { name: 'SEEKER', ammo: 6,  speed: 480, accel: 1000, life: 6.0,
          dmg: 18, blast: 95,  homing: true,  turn: 5.0, color: 0xff4d88 },
    m3: { name: 'SWARM',  ammo: 5,  count: 6, spread: 0.42, speed: 430, accel: 900,
          life: 5.0, dmg: 8, blast: 55, homing: true, turn: 5.5, color: 0x66ff9a },
    lockRange: 4800, lockConeDeg: 24,
  },

  world: {
    asteroids: 130, asteroidField: 12000,  // half-extent of the spawn cube
    boundary: 15000,                       // soft arena radius (~3x larger)
    population: [['gunship', 3], ['interceptor', 5], ['drone', 6]],   // mixed encounter
    pickups: 5,                            // missile resupply rings in the zone
    fogDensity: 0.00007,                   // see further across the bigger space
    bg: 0x05060f,
  },

  ship: {
    radius: 14, shieldMax: 100, hullMax: 100,
    shieldRegen: 9, shieldDelay: 4.0,     // sec after a hit before shields regen
  },

  // external chase views (SELECT / C cycles cockpit → chase → far chase).
  // lag = how fast the chase cam catches the ship's orientation (per sec);
  // lower = floatier, more visible banking. At 6, a full-rate roll holds the
  // ship ~24° rotated in-frame; yaw ~10°.
  camera: { chaseNear: { back: 95, up: 26 }, chaseFar: { back: 230, up: 64 },
            lag: 6 },

  // enemy archetypes — which ones spawn (and how many) is world.population
  enemies: {
    // nimble circle-strafer (kept for later; not spawned right now)
    drone: {
      hp: 12, radius: 22, speed: 165, accel: 1.6, orbitMix: 0.5,
      detectRange: 3200, attackRange: 1550, tooClose: 520,
      fireCdMin: 1.1, fireCdMax: 2.3, volley: 1, volleyGap: 0.12, spread: 0.05,
      boltSpeed: 720, boltDmg: 7, boltLife: 3.0, boltColor: 0xff5a3a, boltSize: 1,
    },
    // slow, heavily-armored standoff gunship — fires 3-round volleys, hits hard
    gunship: {
      hp: 48, radius: 40, speed: 80, accel: 0.9, orbitMix: 0.18,
      detectRange: 3600, attackRange: 2000, tooClose: 700,
      fireCdMin: 2.4, fireCdMax: 3.4, volley: 3, volleyGap: 0.14, spread: 0.055,
      boltSpeed: 640, boltDmg: 11, boltLife: 3.5, boltColor: 0xffd24a, boltSize: 1.7,
    },
    // fast, fragile, aggressive — charges in close and double-taps rapidly
    interceptor: {
      hp: 8, radius: 18, speed: 280, accel: 2.6, orbitMix: 0.35,
      detectRange: 3800, attackRange: 1200, tooClose: 320,
      fireCdMin: 0.7, fireCdMax: 1.4, volley: 2, volleyGap: 0.1, spread: 0.045,
      boltSpeed: 820, boltDmg: 5, boltLife: 2.5, boltColor: 0x55ddff, boltSize: 0.9,
    },
  },
};

// ── Control bindings ────────────────────────────────────────────────────────
// Gamepad indices assume the SN30 Pro paired in X-INPUT mode (hold Start+X
// when powering on). That's what gives the browser the "standard" mapping.
SF.BIND = {
  // Which stick layout is live. Swap on the fly with [M] / L3 (in the
  // diagnostic overlay), or just change this default.
  scheme: 'twinstick',
  padSchemes: {
    // classic   — left = pitch/roll, right = yaw/look (real flight-stick feel)
    classic:   { pitch: 1, roll: 0, yaw: 2, look: 3 },
    // twinstick — left = pitch/yaw (point the nose), right = roll/look ("spin")
    twinstick: { pitch: 1, yaw: 0, roll: 2, look: 3 },
  },
  pad: {
    // D-pad ▲▼ throttle · R2 plasma · L2/Y missile · L1/R1 select · A boost · X brake
    // NOTE: SN30 Pro labels are Nintendo-style → printed Y = index 2, printed X = index 3
    held:   { throttleUp: 12, throttleDown: 13, firePlasma: 7, boost: 0, brake: 3 },
    edge:   { fireMissile: [6, 2], cyclePrev: 4, cycleNext: 5,
              targetPrev: 14, targetNext: 15,            // D-pad ◀ ▶ = cycle target
              pause: 9, viewCycle: 8, diag: 11,          // SELECT = view, R3 = diag
              swapScheme: 10 },
  },
  // Keyboard fallback (works with no controller attached)
  key: {
    pitchUp: 'ArrowUp', pitchDown: 'ArrowDown',
    rollLeft: 'ArrowLeft', rollRight: 'ArrowRight',
    yawLeft: 'KeyQ', yawRight: 'KeyE',
    throttleUp: 'KeyW', throttleDown: 'KeyS',
    boost: 'ShiftLeft', brake: 'KeyX',
    firePlasma: 'Space', fireMissile: 'KeyF',
    selM1: 'Digit1', selM2: 'Digit2', selM3: 'Digit3',
    cycleNext: 'Tab', pause: 'Enter',
    targetPrev: 'BracketLeft', targetNext: 'BracketRight',
    viewCycle: 'KeyC', diag: 'Backquote', swapScheme: 'KeyM',
  },
};

// active axis map + a human label for the current scheme
SF.activeAxes = () => SF.BIND.padSchemes[SF.BIND.scheme];
SF.schemeDesc = () => SF.BIND.scheme === 'twinstick'
  ? 'L-STICK pitch / yaw     R-STICK roll / look'
  : 'L-STICK pitch / roll    R-STICK yaw / look';
