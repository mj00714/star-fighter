// ──────────────────────────────────────────────────────────────────────────
//  missions.js — objective mission framework + the mission list.
//  A mission def is data + hooks (start/tick/onKill); the runtime here owns
//  objective tracking, success/fail, waypoint markers, the HUD panel, and the
//  debrief screen. Free flight is the null mission (rt = null).
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.Missions = (function () {
  const GREEN = '#7dffb0', AMBER = '#ffcf5a', RED = '#ff6a6a', DIM = '#5a7a92';
  const WP_COLOR = 0x66e0ff;

  let rt = null;          // active mission runtime (null = free flight)
  const blips = [];       // nav-bubble waypoint markers (plotted by navmap.js)
  let wpMesh = null;      // 3D marker for the current waypoint

  // ── helpers available to mission defs ──
  const randDir = () => new THREE.Vector3(SF.U.rand(-1, 1), SF.U.rand(-1, 1),
                                          SF.U.rand(-1, 1)).normalize();
  const fmt = t => (t / 60 | 0) + ':' + ('0' + (t % 60 | 0)).slice(-2);

  function obj(label, need) { return { label, need, got: 0, done: false, note: '' }; }

  // spawn an enemy at a mission-chosen spot, optionally tagged/modified
  // (tags let objectives count specific kills; mods make aces/elites)
  function spawnAt(type, pos, tag, mods) {
    const e = SF.World.spawn(type);
    e.pos.copy(pos);
    if (tag) e.tag = tag;
    if (mods) {
      if (mods.hpMult) e.hp = e.maxhp = Math.round(e.maxhp * mods.hpMult);
      if (mods.scale)  { e.obj.scale.setScalar(mods.scale); e.radius *= mods.scale; }
      if (mods.cfg)    e.cfg = Object.assign({}, e.cfg, mods.cfg);
    }
    return e;
  }
  function aliveTagged(tag) {
    let n = 0;
    for (const d of SF.World.drones) if (d.tag === tag) n++;
    return n;
  }

  // ── waypoint marker: a big square gate + glow in the world, cyan blip on
  //    the nav. Square (vs the resupply rings' toruses) and ~4x their size so
  //    the two never read alike at a distance. ──
  function squareFrame(half, bar, mat) {
    const g = new THREE.Group();
    const h = new THREE.BoxGeometry(half * 2 + bar, bar, bar);
    const v = new THREE.BoxGeometry(bar, half * 2 + bar, bar);
    const top = new THREE.Mesh(h, mat); top.position.y = half;
    const bot = new THREE.Mesh(h, mat); bot.position.y = -half;
    const lft = new THREE.Mesh(v, mat); lft.position.x = -half;
    const rgt = new THREE.Mesh(v, mat); rgt.position.x = half;
    g.add(top, bot, lft, rgt);
    return g;
  }
  function setWaypoint(pos) {
    clearWaypoint();
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: WP_COLOR });
    const outer = squareFrame(240, 16, m);          // ~480 across (rings are ~120)
    const inner = squareFrame(150, 9, m);
    inner.rotation.z = Math.PI / 4;                 // nested diamond
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: SF.World.glowTexture(), color: WP_COLOR, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.setScalar(620);
    g.add(outer, inner, glow);
    g.position.copy(pos);
    SF.refs.scene.add(g);
    wpMesh = g;
    blips.push({ pos: g.position, navColor: '#66e0ff' });
  }
  function clearWaypoint() {
    if (wpMesh) { SF.refs.scene.remove(wpMesh); wpMesh = null; }
    blips.length = 0;
  }

  // ── the mission list (index 0 = free flight, the current endless mode) ──
  const list = [
    { id: 'free', name: 'FREE FLIGHT', free: true,
      brief: ['Open skirmish. Endless mixed enemies, no objectives.'] },

    { id: 'strike', name: 'OP 1 · CONVOY STRIKE',
      brief: ['A gunship convoy is transiting the asteroid field.',
              'Destroy all three gunships. Escort fighters are optional.'],
      start(rt) {
        const c = randDir().multiplyScalar(SF.U.rand(5200, 7000));
        for (let i = 0; i < 3; i++)
          spawnAt('gunship', c.clone().add(randDir().multiplyScalar(520)), 'convoy');
        for (let i = 0; i < 3; i++)
          spawnAt('interceptor', c.clone().add(randDir().multiplyScalar(1000)));
        rt.objectives = [obj('DESTROY CONVOY GUNSHIPS', 3)];
        setWaypoint(c);                      // convoy's last known position
      },
      onKill(rt, e) {
        if (e.tag !== 'convoy') return;
        const o = rt.objectives[0];
        o.got++; o.done = o.got >= o.need;
        if (o.done) clearWaypoint();
      } },

    { id: 'patrol', name: 'OP 2 · PICKET SWEEP',
      brief: ['Sweep three picket waypoints along the perimeter.',
              'Hostiles are staging at each one — clear every ambush.'],
      start(rt) {
        rt.c = { wps: [], i: 0, phase: 'travel' };
        for (let i = 0; i < 3; i++)
          rt.c.wps.push(randDir().multiplyScalar(SF.U.rand(4500, 8000)));
        rt.objectives = [obj('SWEEP PICKET WAYPOINTS', 3)];
        setWaypoint(rt.c.wps[0]);
      },
      tick(rt) {
        const c = rt.c, o = rt.objectives[0];
        if (o.done) return;
        const wp = c.wps[c.i];
        if (c.phase === 'travel') {
          o.note = (SF.Ship.pos.distanceTo(wp) / 1000).toFixed(1) + 'km';
          if (SF.Ship.pos.distanceTo(wp) < 420) {
            c.phase = 'clear';
            const n = 2 + c.i;                              // escalates: 2, 3, 4
            for (let k = 0; k < n; k++)
              spawnAt(k % 2 ? 'drone' : 'interceptor',
                      wp.clone().add(randDir().multiplyScalar(SF.U.rand(900, 1500))),
                      'ambush');
          }
        } else {
          const left = aliveTagged('ambush');
          o.note = left + ' HOSTILE' + (left === 1 ? '' : 'S');
          if (left === 0) {
            o.got++; c.i++; c.phase = 'travel';
            if (o.got >= o.need) { o.done = true; o.note = ''; clearWaypoint(); }
            else setWaypoint(c.wps[c.i]);
          }
        }
      } },

    { id: 'ace', name: 'OP 3 · ACE HUNT',
      brief: ['An enemy ace is flying patrol with a wing of escorts.',
              'The ace is fast and heavily armored. Kill it — escorts are optional.'],
      start(rt) {
        const c = randDir().multiplyScalar(SF.U.rand(5200, 7000));
        // hpMult sized for the 3.2× hitbox — big target eats far more plasma,
        // so raw HP is what keeps the time-to-kill boss-like
        spawnAt('interceptor', c, 'ace', { hpMult: 16, scale: 3.2,
          cfg: { speed: SF.CFG.enemies.interceptor.speed * 1.2, boltDmg: 8 } });
        for (let i = 0; i < 4; i++)
          spawnAt('interceptor', c.clone().add(randDir().multiplyScalar(800)));
        rt.objectives = [obj('DESTROY THE ACE', 1)];
        setWaypoint(c);
      },
      onKill(rt, e) {
        if (e.tag !== 'ace') return;
        const o = rt.objectives[0];
        o.got = 1; o.done = true;
        clearWaypoint();
      } },
  ];

  // ── runtime ──
  function start(def) {
    clearWaypoint();
    SF.Ship.reset();
    ['m1', 'm2', 'm3'].forEach(t => SF.Weapons.resupply(t));
    SF.S.score = 0; SF.S.lock = null;
    if (def.free) { rt = null; SF.World.repopulate(); return; }
    SF.World.clearEnemies();
    rt = { def, t: 0, kills: 0, objectives: [], state: 'active', reason: '',
           endT: 0, c: null };
    def.start(rt);
  }

  // back to free-flight ambience (menu backdrop); clears any mission state
  function stop() {
    clearWaypoint();
    rt = null;
    SF.World.repopulate();
    SF.Ship.reset();
    ['m1', 'm2', 'm3'].forEach(t => SF.Weapons.resupply(t));
    SF.S.score = 0; SF.S.lock = null;
  }

  function update(dt) {
    if (wpMesh) { wpMesh.rotation.y += dt * 0.8; wpMesh.rotation.x += dt * 0.5; }
    if (!rt) return;
    rt.t += dt;
    if (rt.state === 'active') {
      if (SF.Ship.dead) {
        rt.state = 'fail'; rt.reason = 'SHIP LOST'; rt.endT = 2.0;
      } else {
        rt.def.tick && rt.def.tick(rt, dt);
        if (rt.objectives.length && rt.objectives.every(o => o.done)) {
          rt.state = 'success'; rt.endT = 2.2;
          SF.Sound && SF.Sound.pickup();
        }
      }
    } else {
      rt.endT -= dt;
    }
  }

  // world.js asks this before scheduling a kill-respawn (endless mode only)
  const allowRespawn = () => !rt;
  const finished = () => !!rt && rt.state !== 'active' && rt.endT <= 0;

  function onKill(e) {
    if (!rt) return;
    rt.kills++;
    rt.def.onKill && rt.def.onKill(rt, e);
  }

  // ── HUD: objectives panel (top-left) + end-state banner ──
  function drawHUD(ctx) {
    if (!rt) return;
    const W = SF.refs.W, H = SF.refs.H;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillStyle = DIM;
    ctx.fillText(rt.def.name + '   T+' + fmt(rt.t), 18, 30);
    ctx.font = '12px "Courier New", monospace';
    let y = 48;
    for (const o of rt.objectives) {
      ctx.fillStyle = o.done ? GREEN : AMBER;
      const prog = o.need > 1 ? '  ' + o.got + '/' + o.need : '';
      ctx.fillText((o.done ? '■ ' : '□ ') + o.label + prog +
                   (o.note ? '  ·  ' + o.note : ''), 18, y);
      y += 16;
    }
    if (rt.state !== 'active') {
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px "Courier New", monospace';
      ctx.fillStyle = rt.state === 'success' ? GREEN : RED;
      ctx.fillText(rt.state === 'success' ? 'MISSION COMPLETE' : 'MISSION FAILED',
                   W / 2, H / 2 - 110);
    }
    ctx.restore();
  }

  // ── debrief screen (game.js switches to mode 'debrief' when finished) ──
  function drawDebrief(ctx) {
    const W = SF.refs.W, H = SF.refs.H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(2,4,9,0.72)'; ctx.fillRect(0, 0, W, H);
    if (!rt) return;
    const ok = rt.state === 'success';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = ok ? GREEN : RED;
    ctx.font = 'bold 34px "Courier New", monospace';
    ctx.fillText(ok ? 'MISSION COMPLETE' : 'MISSION FAILED', W / 2, H / 2 - 96);
    ctx.font = '13px "Courier New", monospace';
    ctx.fillStyle = '#bfe8d4';
    ctx.fillText(rt.def.name + (ok ? '' : '   ·   ' + rt.reason), W / 2, H / 2 - 66);
    let y = H / 2 - 24;
    for (const o of rt.objectives) {
      ctx.fillStyle = o.done ? GREEN : RED;
      ctx.fillText((o.done ? '■' : '□') + '  ' + o.label +
                   (o.need > 1 ? '  ' + o.got + '/' + o.need : ''), W / 2, y);
      y += 20;
    }
    ctx.fillStyle = '#8fa8b8';
    ctx.fillText('KILLS ' + rt.kills + '      TIME ' + fmt(rt.t), W / 2, y + 16);
    ctx.fillStyle = AMBER;
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.fillText('PRESS START / ENTER FOR MISSION SELECT', W / 2, y + 58);
    ctx.restore();
  }

  return { list, blips, start, stop, update, finished, onKill, allowRespawn,
           drawHUD, drawDebrief, isActive: () => !!rt };
})();
