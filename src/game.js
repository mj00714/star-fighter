// ──────────────────────────────────────────────────────────────────────────
//  game.js — bootstrap, main loop, camera, collisions, mode/UI wiring.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.refs = { scene: null, camera: null, renderer: null, hud: null,
            W: 0, H: 0, shake: 0 };
SF.S = { mode: 'start', score: 0, lock: null, lockDist: 0, view: 0,
         usingPad: false, outOfBounds: false, diag: false, lastCmd: null };

(function () {
  const D = SF.CFG.display;
  const W = D.width, H = D.height;
  SF.refs.W = W; SF.refs.H = H;

  // ── DOM: 3D canvas + HUD overlay, both matched to true on-screen pixels ──
  const stage = document.getElementById('stage');
  const gl = document.getElementById('gl');
  const hud = document.getElementById('hud');
  SF.refs.hud = hud.getContext('2d');

  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
  renderer.setPixelRatio(1);                             // sizes managed in sharpen()
  renderer.outputEncoding = THREE.sRGBEncoding;          // correct color
  renderer.toneMapping = THREE.ACESFilmicToneMapping;    // filmic highlights
  renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, W / H, 1, SF.CFG.world.boundary * 3);
  SF.refs.renderer = renderer; SF.refs.scene = scene; SF.refs.camera = camera;

  // size both backing stores to the stage's device-pixel footprint
  // (CSS scale × devicePixelRatio) so nothing is blurred by upscaling
  function sharpen() {
    const s = Math.min(innerWidth / W, innerHeight / H);
    const k = Math.min(s * (window.devicePixelRatio || 1), D.maxPixelScale);
    const glK = Math.min(k * D.renderScale, D.maxPixelScale);
    renderer.setSize(Math.round(W * glK), Math.round(H * glK), false);
    // resizing the HUD store resets its state — restore the 960×540 draw space
    hud.width = Math.round(W * k); hud.height = Math.round(H * k);
    SF.refs.hud.setTransform(k, 0, 0, k, 0, 0);
  }

  // scale the whole stage to fill the window, preserving aspect; debounce the
  // (expensive) buffer reallocation so live window-dragging stays smooth
  let fitT = 0;
  function fit() {
    const s = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = `translate(-50%,-50%) scale(${s})`;
    clearTimeout(fitT); fitT = setTimeout(sharpen, 120);
  }
  addEventListener('resize', fit); fit(); sharpen();

  // ── build world + systems ──
  SF.FX.init(scene);
  SF.Weapons.init(scene);
  SF.AI.init(scene);
  SF.World.build(scene);
  SF.Ship.reset();

  // ── the player's fighter (Arwing-flavored) — visible only in chase views.
  //    Wingtip cannon positions must stay in sync with the plasma port
  //    offsets in weapons.js (±24 lateral, -3 vertical). ──
  const playerMesh = (function () {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xdde3ec, metalness: 0.45,
      roughness: 0.4, emissive: 0x141a24, flatShading: true });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x4a68b8, metalness: 0.55,
      roughness: 0.45, emissive: 0x0c1430, flatShading: true,
      side: THREE.DoubleSide });                         // left wing is mirrored
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c2632, metalness: 0.9,
      roughness: 0.25 });
    // fuselage: long 4-sided pyramid, diamond cross-section, nose -Z (= ship fwd)
    const noseGeo = new THREE.ConeGeometry(6.5, 46, 4);
    noseGeo.rotateY(Math.PI / 4); noseGeo.rotateX(-Math.PI / 2);
    const body = new THREE.Mesh(noseGeo, hullMat);
    // canopy bubble behind the nose
    const canopy = new THREE.Mesh(new THREE.OctahedronGeometry(4, 0), darkMat);
    canopy.scale.set(1, 0.75, 1.7); canopy.position.set(0, 4.2, -1);
    // swept delta wings (extruded planform) with a slight downward cant
    const wingGeoR = (function () {
      const s = new THREE.Shape();
      s.moveTo(0, -5); s.lineTo(22, 5); s.lineTo(22, 10); s.lineTo(0, 11);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);                          // planform flat, sweep aft
      return geo;
    })();
    function wing(side) {                                // +1 right, -1 left
      const geo = side > 0 ? wingGeoR : wingGeoR.clone().scale(-1, 1, 1);
      const m = new THREE.Mesh(geo, wingMat);
      m.position.set(side * 3.5, 0, -2);
      m.rotation.z = -side * 0.14;                       // anhedral: tips dip down
      return m;
    }
    // wingtip cannons — plasma bolts originate here
    function cannon(side) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 15, 6), darkMat);
      c.rotation.x = Math.PI / 2;
      c.position.set(side * 24, -3.2, -3);
      return c;
    }
    // twin engines + glow in the own-ship accent green
    const engMat = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });
    function engine(side) {
      const e = new THREE.Group();
      const shroud = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.9, 8, 8), wingMat);
      shroud.rotation.x = Math.PI / 2;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(2.9, 8, 8), engMat);
      glow.position.z = 4.4;
      e.add(shroud, glow);
      e.position.set(side * 6, 0.5, 20);
      return e;
    }
    g.add(body, canopy, wing(1), wing(-1), cannon(1), cannon(-1),
          engine(1), engine(-1));
    g.visible = false;
    scene.add(g);
    return g;
  })();

  // ── collisions: ship vs asteroids + drones ──
  function collide(dt) {
    const sh = SF.Ship, sr = SF.CFG.ship.radius;
    for (const a of SF.World.asteroids) {
      const to = sh.pos.clone().sub(a.pos);
      const d = to.length(), min = a.radius + sr;
      if (d < min) {
        const n = to.multiplyScalar(1 / (d || 1));
        sh.pos.copy(a.pos).addScaledVector(n, min + 0.5);    // push out
        const into = sh.vel.dot(n);
        if (into < 0) {
          sh.damage(Math.min(40, -into * 0.06));             // impact damage
          sh.vel.addScaledVector(n, -into * 1.4);            // bounce
          sh.vel.multiplyScalar(0.55);
          SF.refs.shake = Math.max(SF.refs.shake, 0.4);
        }
      }
    }
    for (const dr of SF.World.drones) {
      const d = sh.pos.distanceTo(dr.pos), min = dr.radius + sr;
      if (d < min) {
        sh.damage(14 * dt + 0.2);
        const n = sh.pos.clone().sub(dr.pos).normalize();
        sh.pos.addScaledVector(n, (min - d));
        sh.vel.addScaledVector(n, 30);
      }
    }
  }

  // ── camera: cockpit, or chase from behind at two distances (SELECT / C);
  //    boost kicks the FOV in every view. The chase cam's orientation lags the
  //    ship (slerp toward it), so rolls/yaws visibly bank the ship in-frame
  //    before the camera catches up — the Star Fox / Rogue Squadron feel. ──
  let fov = 75;
  const chaseQ = new THREE.Quaternion();     // lagged chase-camera orientation
  function placeCamera(dt) {
    fov = SF.U.approach(fov, SF.Ship.boosting ? 88 : 75, 5, dt);
    camera.fov = fov; camera.updateProjectionMatrix();
    if (SF.S.view === 0) {
      camera.position.copy(SF.Ship.pos);
      camera.quaternion.copy(SF.Ship.quat);
      chaseQ.copy(SF.Ship.quat);             // stay synced for a clean cut to chase
    } else {
      const c = SF.S.view === 1 ? SF.CFG.camera.chaseNear : SF.CFG.camera.chaseFar;
      chaseQ.slerp(SF.Ship.quat, 1 - Math.exp(-SF.CFG.camera.lag * dt));
      camera.quaternion.copy(chaseQ);
      // offset rides the LAGGED frame, so position swings behind the maneuver too
      camera.position.copy(SF.Ship.pos)
        .add(new THREE.Vector3(0, c.up, c.back).applyQuaternion(chaseQ));
    }
    if (SF.refs.shake > 0) {
      const k = SF.refs.shake * 2.2;
      camera.position.x += (Math.random() - 0.5) * k;
      camera.position.y += (Math.random() - 0.5) * k;
      SF.refs.shake = Math.max(0, SF.refs.shake - dt * 2.2);
    }
  }

  // ── main loop ──
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const cmd = SF.Input.poll();
    SF.S.lastCmd = cmd;

    // menu music: plays on start/pause screens, silent in combat
    if (SF.S.mode === 'play') SF.Sound.musicStop(); else SF.Sound.musicStart();
    // boost swell, only while actively boosting in combat; pitch rises with speed
    const boostLvl = SF.U.clamp(
      SF.Ship.speed / (SF.CFG.flight.maxSpeed * SF.CFG.flight.boostMult), 0, 1);
    SF.Sound.boost(SF.S.mode === 'play' && !SF.Ship.dead && SF.Ship.boosting, boostLvl);

    // view cycle + diagnostic overlay + live scheme swap (work in any mode)
    if (cmd.viewCycle) SF.S.view = (SF.S.view + 1) % 3;  // cockpit → chase → far
    if (cmd.toggleDiag) SF.S.diag = !SF.S.diag;
    if (SF.S.diag && cmd.swapScheme)
      SF.BIND.scheme = SF.BIND.scheme === 'twinstick' ? 'classic' : 'twinstick';

    if (SF.S.mode === 'start') {
      menuTick(cmd);
      render(); drawStart(); if (SF.S.diag) SF.Diag.draw(SF.refs.hud); return;
    }
    if (SF.S.mode === 'debrief') {
      if (cmd.pause) { SF.Missions.stop(); SF.S.mode = 'start'; }
      render(); SF.Missions.drawDebrief(SF.refs.hud);
      if (SF.S.diag) SF.Diag.draw(SF.refs.hud); return;
    }
    if (cmd.pause) SF.S.mode = SF.S.mode === 'play' ? 'paused' : 'play';
    if (SF.S.mode === 'paused') {
      if (cmd.brake) { SF.Missions.stop(); SF.S.mode = 'start'; return; }
      render(); drawPaused(); if (SF.S.diag) SF.Diag.draw(SF.refs.hud); return;
    }

    // ── play ──
    SF.Ship.update(dt, cmd);
    if (!SF.Ship.dead) {
      SF.Weapons.tickPlasma(cmd.firePlasma, dt);
      if (cmd.fireMissile) SF.Weapons.fireMissile();
      if (cmd.selM1) SF.Weapons.selectMissile('m1');
      if (cmd.selM2) SF.Weapons.selectMissile('m2');
      if (cmd.selM3) SF.Weapons.selectMissile('m3');
      if (cmd.cycleNext) SF.Weapons.cycleMissile(1);
      if (cmd.cyclePrev) SF.Weapons.cycleMissile(-1);
      if (cmd.targetNext) SF.Weapons.cycleLock(1);
      if (cmd.targetPrev) SF.Weapons.cycleLock(-1);
      collide(dt);
    }
    SF.Weapons.update(dt);
    SF.AI.update(dt);
    SF.World.update(dt, clock.elapsedTime);
    SF.FX.update(dt);
    SF.Missions.update(dt);
    if (SF.Missions.finished()) SF.S.mode = 'debrief';
    placeCamera(dt);

    render();
    SF.Cockpit.draw(SF.refs.hud);
    SF.Nav.draw(SF.refs.hud);
    SF.Missions.drawHUD(SF.refs.hud);
    if (SF.S.diag) SF.Diag.draw(SF.refs.hud);
  }

  function render() {
    // sync the external-view fighter (render runs in every mode)
    playerMesh.visible = SF.S.view !== 0 && !SF.Ship.dead;
    playerMesh.position.copy(SF.Ship.pos);
    playerMesh.quaternion.copy(SF.Ship.quat);
    renderer.render(scene, camera);
  }

  // ── overlays ──
  function dimHud() {
    const c = SF.refs.hud; c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(2,4,9,0.62)'; c.fillRect(0, 0, W, H);
  }
  // ── mission select menu ──
  let menuSel = 0, menuPrevUp = false, menuPrevDn = false;
  function menuTick(cmd) {
    const N = SF.Missions.list.length;
    // D-pad ▲▼ / W/S / stick — edge-detected here since those binds are "held"
    const up = cmd.throttleUp || cmd.pitch < -0.6;
    const dn = cmd.throttleDown || cmd.pitch > 0.6;
    if (up && !menuPrevUp) menuSel = (menuSel + N - 1) % N;
    if (dn && !menuPrevDn) menuSel = (menuSel + 1) % N;
    menuPrevUp = up; menuPrevDn = dn;
    if (cmd.pause || cmd.firePlasma) {
      SF.Missions.start(SF.Missions.list[menuSel]);
      SF.S.mode = 'play'; SF.Sound.resume();
    }
  }

  function drawStart() {
    const c = SF.refs.hud; dimHud();
    c.textAlign = 'center'; c.fillStyle = '#7dffb0';
    c.font = 'bold 44px "Courier New", monospace';
    c.fillText('STAR  FIGHTER', W / 2, 96);

    // mission list
    const L = SF.Missions.list;
    c.font = 'bold 16px "Courier New", monospace';
    L.forEach((m, i) => {
      const sel = i === menuSel;
      c.fillStyle = sel ? '#ffcf5a' : '#6b8ba4';
      c.fillText((sel ? '▶  ' : '') + m.name + (sel ? '  ◀' : ''), W / 2, 168 + i * 28);
    });
    // briefing for the highlighted mission
    c.font = '12px "Courier New", monospace'; c.fillStyle = '#bfe8d4';
    const by = 168 + L.length * 28 + 18;
    L[menuSel].brief.forEach((l, i) => c.fillText(l, W / 2, by + i * 18));

    c.fillStyle = '#ffcf5a'; c.font = 'bold 14px "Courier New", monospace';
    const pad = SF.Input.isUsingPad();
    c.fillText(pad ? 'D-PAD ▲▼ SELECT  ·  START LAUNCH' : 'W/S SELECT  ·  ENTER LAUNCH',
               W / 2, by + L[menuSel].brief.length * 18 + 30);
    // condensed controls (full table in README)
    c.fillStyle = '#54707f'; c.font = '11px "Courier New", monospace';
    const lines = pad ? [
      'sticks fly (' + SF.BIND.scheme + ')  ·  R2 plasma  ·  L2/Y missile  ·  ' +
      'L1/R1 weapon  ·  A boost  ·  X brake  ·  SELECT view  ·  R3 diag',
    ] : [
      'no controller — pair SN30 Pro in X-input (Start+X), then click the page',
      '↑/↓ pitch  ←/→ roll  Q/E yaw  ·  W/S throttle  ·  SHIFT boost  ·  X brake  ·  ' +
      'SPACE plasma  ·  F missile  ·  C view  ·  ` diag',
    ];
    lines.forEach((l, i) => c.fillText(l, W / 2, H - 46 + i * 16));
    c.textAlign = 'left';
  }
  function drawPaused() {
    const c = SF.refs.hud; dimHud();
    c.textAlign = 'center'; c.fillStyle = '#7dffb0';
    c.font = 'bold 34px "Courier New", monospace';
    c.fillText('PAUSED', W / 2, H / 2);
    c.font = '13px "Courier New", monospace'; c.fillStyle = '#bfe8d4';
    c.fillText('kills: ' + SF.S.score, W / 2, H / 2 + 30);
    c.fillStyle = '#8fa8b8';
    c.fillText('START/ENTER resume   ·   X abort to mission select', W / 2, H / 2 + 54);
    c.textAlign = 'left';
  }

  frame();
  console.log('[star-fighter] iteration 1 online — flight assist',
              SF.CFG.flight.flightAssist);
})();
