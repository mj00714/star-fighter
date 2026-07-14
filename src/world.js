// ──────────────────────────────────────────────────────────────────────────
//  world.js — builds the arena: lights, starfield, asteroids, target drones.
//  Flat-shaded low-poly geometry + a clamped palette for the 16/32-bit look.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.World = (function () {
  const asteroids = [];
  const drones = [];
  const pickups = [];
  const pickupMats = {};                 // ring material cached by color
  let scene = null;
  let droneMat, droneCoreMat, rockTex, glowTex, gunMat, gunTrimMat, gunCoreMat,
      intMat, intCoreMat;

  const ROCK_COLORS = [0x6b6256, 0x575061, 0x6d5a48, 0x4f5a55, 0x7a6f63];

  // ── procedural textures (canvas → no external assets, stays offline) ──
  function makeRockTexture() {
    const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const c = cv.getContext('2d');
    c.fillStyle = '#8c8378'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {                 // speckle grain
      const v = 90 + Math.random() * 110, a = 0.05 + Math.random() * 0.12;
      c.fillStyle = `rgba(${v},${v * 0.94},${v * 0.85},${a})`;
      c.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
    }
    for (let i = 0; i < 26; i++) {                    // craters
      const x = Math.random() * s, y = Math.random() * s, r = 4 + Math.random() * 18;
      const g = c.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(20,18,16,0.5)'); g.addColorStop(0.7, 'rgba(40,36,32,0.15)');
      g.addColorStop(1, 'rgba(255,250,240,0.08)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function makeGlowTexture() {
    const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(cv);
  }

  function build(s) {
    scene = s;
    const W = SF.CFG.world;

    scene.background = new THREE.Color(W.bg);
    scene.fog = new THREE.FogExp2(W.bg, W.fogDensity);
    rockTex = makeRockTexture();
    glowTex = makeGlowTexture();

    // lights: cold ambient + a warm key "sun" + a cool rim
    scene.add(new THREE.AmbientLight(0x3a4060, 0.9));
    const sunDir = new THREE.Vector3(0.6, 0.8, 0.4).normalize();
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.5);
    sun.position.copy(sunDir); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x5577ff, 0.6);
    rim.position.set(-0.5, -0.3, -0.6); scene.add(rim);

    // visible sun glow far down the key-light axis
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffe9b0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sunSprite.position.copy(sunDir.clone().multiplyScalar(W.boundary * 2.2));
    sunSprite.scale.setScalar(W.boundary * 0.55); scene.add(sunSprite);

    buildStars();
    buildAsteroids();
    // enemy materials
    droneMat = new THREE.MeshStandardMaterial({ color: 0xaab4d6, metalness: 0.7,
                                                roughness: 0.32, emissive: 0x16263c });
    droneCoreMat = new THREE.MeshBasicMaterial({ color: 0xff6a52 });
    gunMat = new THREE.MeshStandardMaterial({ color: 0x7c5238, metalness: 0.55,
                                              roughness: 0.55, emissive: 0x2a1606,
                                              flatShading: true });
    gunTrimMat = new THREE.MeshStandardMaterial({ color: 0xc7a052, metalness: 0.85,
                                                  roughness: 0.3, emissive: 0x3a2600 });
    gunCoreMat = new THREE.MeshBasicMaterial({ color: 0xffd24a });
    intMat = new THREE.MeshStandardMaterial({ color: 0x6a8296, metalness: 0.75,
                                              roughness: 0.3, emissive: 0x0e2230,
                                              flatShading: true });
    intCoreMat = new THREE.MeshBasicMaterial({ color: 0x66e0ff });
    // populate from the spawn list
    for (const [type, n] of W.population) for (let i = 0; i < n; i++) spawn(type);
    // resupply rings — cycle the missile types so all are represented
    const ptypes = ['m1', 'm2', 'm3'];
    for (let i = 0; i < W.pickups; i++) spawnPickup(ptypes[i % ptypes.length]);
  }

  function buildStars() {
    const N = 1400, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const c = new THREE.Color();
    const R0 = SF.CFG.world.boundary * 2;     // star shell sits well outside the arena
    for (let i = 0; i < N; i++) {
      // scatter on a big shell so they read as distant
      const v = new THREE.Vector3(SF.U.rand(-1, 1), SF.U.rand(-1, 1), SF.U.rand(-1, 1))
        .normalize().multiplyScalar(SF.U.rand(R0 * 0.9, R0 * 1.2));
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      const t = Math.random();
      c.setHSL(t < 0.7 ? 0.6 : SF.U.rand(0.05, 0.12), 0.4, SF.U.rand(0.5, 0.95));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // soft additive glow points so stars read crisply at full resolution
    const m = new THREE.PointsMaterial({ size: 7, map: glowTex, sizeAttenuation: false,
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false });
    const stars = new THREE.Points(g, m);
    stars.frustumCulled = false;
    scene.add(stars);
  }

  function buildAsteroids() {
    const W = SF.CFG.world;
    for (let i = 0; i < W.asteroids; i++) {
      const r = SF.U.rand(40, 170);
      const geo = new THREE.IcosahedronGeometry(r, 2);
      // jitter vertices so each rock is lumpy and unique
      const p = geo.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const j = 1 + SF.U.rand(-0.20, 0.20);
        p.setXYZ(v, p.getX(v) * j, p.getY(v) * j, p.getZ(v) * j);
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: ROCK_COLORS[i % ROCK_COLORS.length], map: rockTex,
        roughness: 0.95, metalness: 0.05 });
      const m = new THREE.Mesh(geo, mat);
      // place in a cube but never right on top of the spawn point
      let pos;
      do { pos = new THREE.Vector3(SF.U.rand(-1, 1), SF.U.rand(-1, 1), SF.U.rand(-1, 1))
              .multiplyScalar(W.asteroidField); } while (pos.length() < 450);
      m.position.copy(pos);
      m.rotation.set(SF.U.rand(0, 6.28), SF.U.rand(0, 6.28), SF.U.rand(0, 6.28));
      scene.add(m);
      asteroids.push({ obj: m, pos: m.position, radius: r * 1.18,
                       spin: new THREE.Vector3(SF.U.rand(-0.2, 0.2),
                                               SF.U.rand(-0.2, 0.2),
                                               SF.U.rand(-0.2, 0.2)) });
    }
  }

  // ── enemy meshes (forward = +Z, the axis lookAt points at the target) ──
  function makeDroneMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(16, 0), droneMat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(20, 2.4, 6, 12), droneMat);
    const core = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), droneCoreMat);
    ring.rotation.x = Math.PI / 2;
    g.add(body, ring, core);
    g.userData.core = core; g.userData.ring = ring;
    return g;
  }
  function makeGunshipMesh() {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(46, 22, 36), gunMat);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(14, 26, 6), gunTrimMat);
    nose.rotation.x = Math.PI / 2; nose.position.z = 26;          // points forward (+Z)
    const podL = new THREE.Mesh(new THREE.BoxGeometry(11, 13, 30), gunMat);
    podL.position.set(-30, 0, 0);
    const podR = podL.clone(); podR.position.x = 30;
    const barL = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 22, 6), gunTrimMat);
    barL.rotation.x = Math.PI / 2; barL.position.set(-13, -3, 24);
    const barR = barL.clone(); barR.position.x = 13;
    const core = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 10), gunCoreMat);
    core.position.set(0, 8, -4);
    g.add(hull, nose, podL, podR, barL, barR, core);
    g.userData.core = core;
    return g;
  }

  function makeInterceptorMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(7, 34, 6), intMat);
    body.rotation.x = Math.PI / 2;                                // nose points +Z
    const wing = new THREE.Mesh(new THREE.BoxGeometry(36, 1.8, 9), intMat);
    wing.position.z = -3; wing.rotation.y = 0.18;                 // slight forward sweep
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 11, 9), intMat);
    fin.position.set(0, 5, -8);
    const core = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), intCoreMat);
    core.position.z = -16;                                        // engine glow at tail
    g.add(body, wing, fin, core);
    g.userData.core = core;
    return g;
  }

  function spawn(type) {
    const cfg = SF.CFG.enemies[type];
    const g = type === 'gunship' ? makeGunshipMesh()
            : type === 'interceptor' ? makeInterceptorMesh()
            : makeDroneMesh();

    let pos;
    do { pos = new THREE.Vector3(SF.U.rand(-1, 1), SF.U.rand(-1, 1), SF.U.rand(-1, 1))
            .multiplyScalar(SF.U.rand(900, SF.CFG.world.asteroidField * 0.9)); }
    while (pos.distanceTo(SF.Ship.pos) < 900);
    g.position.copy(pos);
    scene.add(g);

    const e = { obj: g, pos: g.position, type, cfg,
                radius: cfg.radius, hp: cfg.hp, maxhp: cfg.hp,
                core: g.userData.core, ring: g.userData.ring,
                // AI state (movement owned by ai.js)
                vel: new THREE.Vector3(),
                state: 'patrol', fireCd: SF.U.rand(0.5, 2), evadeT: 0,
                volleyLeft: 0, volleyTimer: 0,
                wander: new THREE.Vector3(SF.U.rand(-1, 1), SF.U.rand(-1, 1),
                                          SF.U.rand(-1, 1)).normalize(),
                wanderT: SF.U.rand(2, 5) };
    drones.push(e);
    return e;
  }

  // ── missile resupply rings (fly through to rearm one weapon type) ──
  function pmat(color) {
    return pickupMats[color] || (pickupMats[color] = new THREE.MeshBasicMaterial({ color }));
  }
  function makePickupMesh(color) {
    const g = new THREE.Group();
    const m = pmat(color);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(60, 6, 8, 22), m);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(40, 3, 6, 18), m);
    ring2.rotation.x = Math.PI / 2;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.setScalar(150);
    g.add(ring, ring2, glow);
    return g;
  }
  function spawnPickup(type) {
    const color = SF.CFG.weapons[type].color;
    const g = makePickupMesh(color);
    let pos;
    do { pos = new THREE.Vector3(SF.U.rand(-1, 1), SF.U.rand(-1, 1), SF.U.rand(-1, 1))
            .multiplyScalar(SF.U.rand(1500, SF.CFG.world.asteroidField * 0.9)); }
    while (pos.distanceTo(SF.Ship.pos) < 1500);
    g.position.copy(pos);
    g.rotation.set(SF.U.rand(0, 6.28), SF.U.rand(0, 6.28), 0);
    scene.add(g);
    pickups.push({ obj: g, pos: g.position, radius: 85, type, color,
                   navColor: '#' + color.toString(16).padStart(6, '0'),
                   spin: new THREE.Vector3(SF.U.rand(-0.4, 0.4), SF.U.rand(-0.4, 0.4), 0.6) });
  }

  function killDrone(d) {
    const col = d.type === 'gunship' ? 0xffc24a
              : d.type === 'interceptor' ? 0x66e0ff : 0xff7a3a;
    SF.FX.explode(d.pos, d.radius * 2.6, col);
    SF.Sound && SF.Sound.explosion(d.type === 'gunship' ? 1.5 : 1.0, d.pos);
    scene.remove(d.obj);
    const i = drones.indexOf(d);
    if (i >= 0) drones.splice(i, 1);
    SF.S.score += 1;
    SF.refs.shake = Math.max(SF.refs.shake, d.type === 'gunship' ? 0.45 : 0.25);
    SF.Missions && SF.Missions.onKill(d);
    // free flight keeps the arena populated — respawn the same type.
    // epoch guards against a stale timer spawning into a cleared/mission world.
    if (!SF.Missions || SF.Missions.allowRespawn()) {
      const type = d.type, ep = epoch;
      setTimeout(() => { if (scene && ep === epoch) spawn(type); }, 1800);
    }
  }

  // ── mission support: wipe / rebuild the enemy population ──
  let epoch = 0;                    // bumped on clear → invalidates respawn timers
  function clearEnemies() {
    epoch++;
    for (const d of drones) scene.remove(d.obj);
    drones.length = 0;
  }
  function repopulate() {
    clearEnemies();
    for (const [type, n] of SF.CFG.world.population)
      for (let i = 0; i < n; i++) spawn(type);
  }

  function update(dt, t) {
    for (const a of asteroids) {
      a.obj.rotation.x += a.spin.x * dt;
      a.obj.rotation.y += a.spin.y * dt;
      a.obj.rotation.z += a.spin.z * dt;
    }
    // movement is owned by ai.js — here we only do cosmetics
    for (const d of drones) {
      if (d.ring) d.ring.rotation.z += 1.4 * dt;
      if (d.core) d.core.scale.setScalar(1 + Math.sin(t * 4 + d.pos.x) * 0.25);
    }
    // resupply rings: spin, and rearm when the ship flies through one
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.obj.rotation.x += p.spin.x * dt;
      p.obj.rotation.y += p.spin.y * dt;
      p.obj.rotation.z += p.spin.z * dt;
      if (SF.Ship.pos.distanceTo(p.pos) < p.radius && SF.Weapons.resupply(p.type)) {
        SF.FX.explode(p.pos, 60, p.color);
        SF.Sound && SF.Sound.pickup();
        const type = p.type;
        scene.remove(p.obj); pickups.splice(i, 1);
        setTimeout(() => { if (scene) spawnPickup(type); }, 6000);
      }
    }
  }

  return { build, update, asteroids, drones, pickups, spawn, killDrone,
           clearEnemies, repopulate, glowTexture: () => glowTex };
})();
