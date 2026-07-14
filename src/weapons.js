// ──────────────────────────────────────────────────────────────────────────
//  weapons.js — plasma blaster + two missile types, targeting lock, and the
//  shared FX (explosions / impacts) used by the whole game.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

// ── FX: explosions and impact sparks ────────────────────────────────────────
SF.FX = (function () {
  const live = [];
  let scene = null;
  const sphereGeo = new THREE.IcosahedronGeometry(1, 1);

  function init(s) { scene = s; }

  function explode(pos, size, color) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true,
      opacity: 0.95, wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true,
      opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const shell = new THREE.Mesh(sphereGeo, mat);
    const flash = new THREE.Mesh(sphereGeo, core);
    shell.position.copy(pos); flash.position.copy(pos);
    shell.scale.setScalar(size * 0.3); flash.scale.setScalar(size * 0.18);
    scene.add(shell); scene.add(flash);
    live.push({ shell, flash, mat, core, life: 0.5, max: 0.5, size });
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i]; e.life -= dt;
      const k = 1 - e.life / e.max;
      e.shell.scale.setScalar(e.size * (0.3 + k * 1.4));
      e.flash.scale.setScalar(e.size * (0.18 + k * 0.3));
      e.mat.opacity = Math.max(0, 0.95 * (1 - k));
      e.core.opacity = Math.max(0, 0.9 * (1 - k * 1.8));
      if (e.life <= 0) {
        scene.remove(e.shell); scene.remove(e.flash);
        e.mat.dispose(); e.core.dispose();
        live.splice(i, 1);
      }
    }
  }
  return { init, explode, update };
})();

// ── Weapons system ──────────────────────────────────────────────────────────
SF.Weapons = (function () {
  let scene = null;
  const bolts = [];
  const missiles = [];
  let plasmaCd = 0;
  let curMissile = 'm1';
  let port = 1;                 // alternates -1 / +1 between the twin cannons
  const MISSILES = ['m1', 'm2', 'm3'];

  const ammo = {};
  let boltGeo, missileGeo;
  const boltMat = {};   // cached by color

  function init(s) {
    scene = s;
    MISSILES.forEach(k => (ammo[k] = SF.CFG.weapons[k].ammo));
    boltGeo = new THREE.CylinderGeometry(1.1, 1.1, 14, 6);
    boltGeo.rotateX(Math.PI / 2);            // lie along local -Z (travel axis)
    missileGeo = new THREE.ConeGeometry(2.6, 12, 6);
    missileGeo.rotateX(Math.PI / 2);          // tip points +Z (lookAt faces +Z to travel)
  }

  function mat(color) {
    return boltMat[color] || (boltMat[color] = new THREE.MeshBasicMaterial({
      color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  }

  function selectMissile(which) { curMissile = which; }

  // fire a single bolt from whichever cannon is next (alternating L/R)
  function fireOneBolt() {
    const cfg = SF.CFG.weapons.plasma, sh = SF.Ship;
    port = -port;
    // ports sit at the wingtip cannons — keep in sync with playerMesh (game.js).
    // Fire converges on the sight line (X-wing style) so centered aim still hits.
    const origin = sh.pos.clone()
      .addScaledVector(sh.right, port * 24)
      .addScaledVector(sh.up, -3)
      .addScaledVector(sh.fwd, 12);
    const aim = sh.pos.clone().addScaledVector(sh.fwd, cfg.converge);
    const vel = aim.sub(origin).normalize().multiplyScalar(cfg.speed).add(sh.vel);
    const m = new THREE.Mesh(boltGeo, mat(cfg.color));
    m.position.copy(origin); m.lookAt(origin.clone().add(vel));
    scene.add(m);
    bolts.push({ obj: m, pos: m.position, vel, life: cfg.life, dmg: cfg.dmg });
    plasmaCd = cfg.cd;
    SF.refs.shake = Math.max(SF.refs.shake, 0.04);
    SF.Sound && SF.Sound.plasma();
    SF.Input.rumble(0.35, 0.6, 80, 0);         // per-bolt buzz (wired — no throttle)
  }

  // called every frame with the trigger's held state — plasma is full-auto
  function tickPlasma(held, dt) {
    if (plasmaCd > 0) plasmaCd -= dt;
    if (held && plasmaCd <= 0) fireOneBolt();
  }

  function cycleMissile(dir) {
    let i = MISSILES.indexOf(curMissile);
    curMissile = MISSILES[(i + dir + MISSILES.length) % MISSILES.length];
  }

  // refill ONE missile type to its cap; returns true if anything was added
  function resupply(type) {
    const cap = SF.CFG.weapons[type].ammo;
    if (ammo[type] >= cap) return false;
    ammo[type] = cap;
    return true;
  }

  function fireMissile() {
    const key = curMissile;
    if (ammo[key] <= 0) return;
    ammo[key]--;
    const cfg = SF.CFG.weapons[key];
    const count = cfg.count || 1;
    const targets = cfg.homing ? nearestDrones(SF.Ship.pos, count) : [];
    for (let i = 0; i < count; i++) {
      const dir = SF.Ship.fwd.clone();
      if (cfg.spread) {                          // fan a salvo out
        dir.x += SF.U.rand(-cfg.spread, cfg.spread);
        dir.y += SF.U.rand(-cfg.spread, cfg.spread);
        dir.z += SF.U.rand(-cfg.spread, cfg.spread);
        dir.normalize();
      }
      const target = cfg.homing
        ? (targets[i % Math.max(1, targets.length)] || SF.S.lock || null) : null;
      spawnMissile(cfg, dir, target);
    }
    SF.Sound && SF.Sound.missile();
    SF.Input.rumble(0.85, 0.55, 220, 0);         // launch punch
  }

  function spawnMissile(cfg, dir, target) {
    const sh = SF.Ship;
    const origin = sh.pos.clone().addScaledVector(sh.up, -6).addScaledVector(sh.fwd, 8);
    const m = new THREE.Mesh(missileGeo, mat(cfg.color));
    m.position.copy(origin);
    const vel = dir.clone().multiplyScalar(cfg.speed).add(sh.vel);
    scene.add(m);
    missiles.push({ obj: m, pos: m.position, vel, dir, life: cfg.life, cfg,
                    homing: cfg.homing, target, trailT: 0 });
  }

  // up to n nearest enemies (within lock range) — for swarm target spreading
  function nearestDrones(pos, n) {
    return SF.World.drones
      .map(d => ({ d, dist: d.pos.distanceTo(pos) }))
      .filter(o => o.dist < SF.CFG.weapons.lockRange)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, Math.max(1, n))
      .map(o => o.d);
  }

  // keep the lock until the target dies / leaves range; auto-acquire when empty
  function updateLock() {
    const sh = SF.Ship, cfg = SF.CFG.weapons;
    if (SF.S.lock && (!SF.World.drones.includes(SF.S.lock) ||
        SF.S.lock.pos.distanceTo(sh.pos) > cfg.lockRange)) SF.S.lock = null;
    if (!SF.S.lock) {                          // nearest enemy in the forward cone
      const cosCone = Math.cos((cfg.lockConeDeg * Math.PI) / 180);
      let best = null, bestD = Infinity;
      for (const d of SF.World.drones) {
        const to = d.pos.clone().sub(sh.pos);
        const dist = to.length();
        if (dist > cfg.lockRange) continue;
        if (to.normalize().dot(sh.fwd) < cosCone) continue;
        if (dist < bestD) { bestD = dist; best = d; }
      }
      SF.S.lock = best;
    }
    SF.S.lockDist = SF.S.lock ? SF.S.lock.pos.distanceTo(sh.pos) : 0;
  }

  // manually cycle the lock through all in-range enemies (D-pad ◀ ▶)
  function cycleLock(dir) {
    const sh = SF.Ship;
    const list = SF.World.drones
      .map(d => ({ d, dist: d.pos.distanceTo(sh.pos) }))
      .filter(o => o.dist <= SF.CFG.weapons.lockRange)
      .sort((a, b) => a.dist - b.dist)
      .map(o => o.d);
    if (!list.length) { SF.S.lock = null; return; }
    let i = list.indexOf(SF.S.lock);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    SF.S.lock = list[i];
  }

  function hitDrones(pos, dmg, blast) {
    let any = false;
    for (let i = SF.World.drones.length - 1; i >= 0; i--) {
      const d = SF.World.drones[i];
      const dist = d.pos.distanceTo(pos);
      if (dist <= (blast || d.radius)) {
        const dealt = blast ? dmg * Math.max(0.3, 1 - dist / blast) : dmg;
        d.hp -= dealt; any = true;
        if (d.hp <= 0) SF.World.killDrone(d);
      }
    }
    return any;
  }

  function hitsAsteroid(pos, r) {
    for (const a of SF.World.asteroids)
      if (a.pos.distanceTo(pos) <= a.radius + (r || 0)) return a;
    return null;
  }

  // nearest drone to a point, within lock range — for missile re-acquisition
  function reacquire(pos) {
    let best = null, bd = Infinity;
    for (const d of SF.World.drones) {
      const dd = d.pos.distanceTo(pos);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best && bd < SF.CFG.weapons.lockRange ? best : null;
  }

  function update(dt) {
    updateLock();

    // plasma bolts
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.pos.addScaledVector(b.vel, dt); b.life -= dt;
      let gone = b.life <= 0;
      if (!gone && hitsAsteroid(b.pos, 2)) { SF.FX.explode(b.pos, 22, 0xffd28a); gone = true; }
      if (!gone) {
        for (const d of SF.World.drones) {
          if (b.pos.distanceTo(d.pos) <= d.radius) {
            d.hp -= b.dmg; SF.FX.explode(b.pos, 20, 0x9fe6ff);
            if (d.hp <= 0) SF.World.killDrone(d);
            gone = true; break;
          }
        }
      }
      if (gone) { scene.remove(b.obj); bolts.splice(i, 1); }
    }

    // missiles
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.life -= dt;
      // re-acquire a dead/lost target with the nearest drone (not just the lock)
      if (m.homing && (!m.target || !SF.World.drones.includes(m.target)))
        m.target = reacquire(m.pos);
      // homing steer toward an INTERCEPT point (lead the target's motion)
      if (m.homing && m.target) {
        const rel = m.target.pos.clone().sub(m.pos);
        const tLead = Math.min(rel.length() / Math.max(1, m.vel.length()), 1.2);
        const aim = m.target.pos.clone().addScaledVector(m.target.vel, tLead)
          .sub(m.pos).normalize();
        m.dir.lerp(aim, 1 - Math.exp(-m.cfg.turn * dt)).normalize();
      }
      // accelerate along heading (homing missiles stay slower → tighter turns)
      const cap = m.cfg.speed + (m.homing ? 240 : 620);
      const sp = Math.min(m.cfg.speed + m.cfg.accel * (m.cfg.life - m.life), cap);
      m.vel.copy(m.dir).multiplyScalar(sp);
      m.pos.addScaledVector(m.vel, dt);
      m.obj.lookAt(m.pos.clone().add(m.dir));

      // smoke trail
      m.trailT -= dt;
      if (m.trailT <= 0) { m.trailT = 0.03; SF.FX.explode(m.pos, 8, m.cfg.color); }

      let det = m.life <= 0;
      if (!det && hitsAsteroid(m.pos, 3)) det = true;
      const fuse = m.homing ? 34 : 8;          // proximity fuse (homing forgives near-misses)
      if (!det) for (const d of SF.World.drones)
        if (m.pos.distanceTo(d.pos) <= d.radius + fuse) { det = true; break; }

      if (det) {
        SF.FX.explode(m.pos, m.cfg.blast * 0.9, m.cfg.color);
        hitDrones(m.pos, m.cfg.dmg, m.cfg.blast);
        SF.Sound && SF.Sound.explosion(0.7, m.pos);
        SF.refs.shake = Math.max(SF.refs.shake, 0.15);
        scene.remove(m.obj); missiles.splice(i, 1);
      }
    }
  }

  return { init, update, tickPlasma, fireMissile, selectMissile, cycleMissile,
           cycleLock, resupply, getAmmo: () => ammo, getCurrent: () => curMissile,
           getMissileTypes: () => MISSILES };
})();
