// ──────────────────────────────────────────────────────────────────────────
//  ai.js — enemy behavior + enemy fire, driven per-type by each enemy's `cfg`
//  (SF.CFG.enemies[type]). State machine:
//    patrol — out of range: lazy wander
//    pursue — detected but too far: close in
//    attack — in range: strafe (orbitMix) and fire volleys with lead
//    evade  — too close / on its tail: jink away, then re-engage
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.AI = (function () {
  let scene = null;
  const bolts = [];
  let boltGeo;
  const boltMats = {};                 // cached enemy-bolt material by color

  function init(s) {
    scene = s;
    boltGeo = new THREE.CylinderGeometry(1.6, 1.6, 16, 6);
    boltGeo.rotateX(Math.PI / 2);
  }
  function bmat(color) {
    return boltMats[color] || (boltMats[color] = new THREE.MeshBasicMaterial({
      color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  }

  const tmp = new THREE.Vector3(), desired = new THREE.Vector3(),
        tang = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  function update(dt) {
    const sh = SF.Ship;

    for (const e of SF.World.drones) {
      const cfg = e.cfg;
      tmp.copy(sh.pos).sub(e.pos);              // enemy → player
      const dist = tmp.length();
      const toPlayer = tmp.clone().multiplyScalar(1 / (dist || 1));
      tang.crossVectors(toPlayer, up);
      if (tang.lengthSq() < 1e-6) tang.set(1, 0, 0); else tang.normalize();
      if (e.jink === undefined) e.jink = Math.random() < 0.5 ? 1 : -1;

      // ── state ──
      if (e.evadeT > 0) { e.evadeT -= dt; e.state = 'evade'; }
      else if (dist > cfg.detectRange) e.state = 'patrol';
      else if (dist < cfg.tooClose)  { e.state = 'evade'; e.evadeT = SF.U.rand(0.8, 1.5); }
      else if (dist < cfg.attackRange) e.state = 'attack';
      else e.state = 'pursue';

      // ── desired heading ──
      if (e.state === 'patrol') {
        e.wanderT -= dt;
        if (e.wanderT <= 0) {
          e.wanderT = SF.U.rand(2, 5);
          e.wander.set(SF.U.rand(-1, 1), SF.U.rand(-1, 1), SF.U.rand(-1, 1)).normalize();
        }
        desired.copy(e.wander);
      } else if (e.state === 'evade') {
        desired.copy(toPlayer).multiplyScalar(-1).addScaledVector(tang, e.jink).normalize();
      } else {  // pursue / attack — head at player, mixed with a strafing orbit
        desired.copy(toPlayer).multiplyScalar(1 - cfg.orbitMix)
          .addScaledVector(tang, cfg.orbitMix * e.jink).normalize();
      }

      // ── steer + move ──
      const spd = e.state === 'patrol' ? cfg.speed * 0.4 : cfg.speed;
      tmp.copy(desired).multiplyScalar(spd);
      e.vel.lerp(tmp, 1 - Math.exp(-cfg.accel * dt));
      e.pos.addScaledVector(e.vel, dt);
      if (e.pos.length() > SF.CFG.world.boundary)
        e.vel.addScaledVector(e.pos.clone().normalize(), -cfg.speed * 1.5 * dt);
      e.obj.lookAt(e.state === 'patrol' ? e.pos.clone().add(e.vel) : sh.pos);

      // ── fire: volley of cfg.volley bolts, then cool down ──
      if (e.state === 'attack' && !sh.dead) {
        if (e.volleyLeft > 0) {
          e.volleyTimer -= dt;
          if (e.volleyTimer <= 0) { fire(e, dist); e.volleyLeft--; e.volleyTimer = cfg.volleyGap; }
        } else {
          e.fireCd -= dt;
          if (e.fireCd <= 0) {
            e.fireCd = SF.U.rand(cfg.fireCdMin, cfg.fireCdMax);
            e.volleyLeft = cfg.volley; e.volleyTimer = 0;
          }
        }
      }
    }

    updateBolts(dt);
  }

  function fire(e, dist) {
    const cfg = e.cfg, sh = SF.Ship;
    const t = dist / cfg.boltSpeed;                       // lead the player
    const aim = sh.pos.clone().addScaledVector(sh.vel, t).sub(e.pos);
    aim.x += SF.U.rand(-cfg.spread, cfg.spread);
    aim.y += SF.U.rand(-cfg.spread, cfg.spread);
    aim.z += SF.U.rand(-cfg.spread, cfg.spread);
    aim.normalize();
    const m = new THREE.Mesh(boltGeo, bmat(cfg.boltColor));
    m.scale.setScalar(cfg.boltSize || 1);
    const origin = e.pos.clone().addScaledVector(aim, e.radius + 6);
    m.position.copy(origin); m.lookAt(origin.clone().add(aim));
    scene.add(m);
    bolts.push({ obj: m, pos: m.position, vel: aim.multiplyScalar(cfg.boltSpeed),
                 life: cfg.boltLife, dmg: cfg.boltDmg, color: cfg.boltColor });
    SF.Sound && SF.Sound.enemyFire(origin);    // directional incoming-fire cue
  }

  function updateBolts(dt) {
    const sh = SF.Ship, sr = SF.CFG.ship.radius;
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.pos.addScaledVector(b.vel, dt); b.life -= dt;
      let gone = b.life <= 0;
      if (!gone)
        for (const a of SF.World.asteroids)
          if (b.pos.distanceTo(a.pos) <= a.radius) { SF.FX.explode(b.pos, 18, 0xffb060); gone = true; break; }
      if (!gone && !sh.dead && b.pos.distanceTo(sh.pos) <= sr + 5) {
        sh.damage(b.dmg);
        SF.FX.explode(b.pos, 26, b.color);
        SF.Sound && SF.Sound.hit();
        SF.Input.rumble(1.0, 0.85, 320, 0);   // strong jolt when hit
        SF.refs.shake = Math.max(SF.refs.shake, 0.45);
        gone = true;
      }
      if (gone) { scene.remove(b.obj); bolts.splice(i, 1); }
    }
  }

  return { init, update };
})();
