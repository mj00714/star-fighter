// ──────────────────────────────────────────────────────────────────────────
//  cockpit.js — first-person canopy frame + HUD instruments, drawn as a crisp
//  2D vector overlay on top of the (chunky, upscaled) 3D scene.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.Cockpit = (function () {
  const GREEN = '#7dffb0', DIM = '#2f6f4f', AMBER = '#ffcf5a', RED = '#ff5a5a';
  const PXDEG = 4.2;

  function project(v) {
    const cam = SF.refs.camera, W = SF.refs.W, H = SF.refs.H;
    const cs = v.clone().applyMatrix4(cam.matrixWorldInverse);
    if (cs.z >= -1) return { vis: false };           // behind / on the lens
    const p = v.clone().project(cam);
    return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H,
             vis: Math.abs(p.x) < 1.3 && Math.abs(p.y) < 1.3 };
  }

  function draw(ctx) {
    const W = SF.refs.W, H = SF.refs.H, cx = W / 2, cy = H / 2, sh = SF.Ship;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1.5; ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    if (SF.S.view === 0)            // canopy only in cockpit view; HUD stays in chase
      drawCanopy(ctx, W, H);        // frame first, so instruments read on top of it
    drawAttitude(ctx, cx, cy, sh);
    drawCompass(ctx, W, sh);
    drawTargets(ctx);
    drawReticle(ctx, cx, cy);
    drawSpeedThrottle(ctx, H, sh);
    drawStatus(ctx, H, sh);
    drawWeapons(ctx, W, H);

    if (SF.S.outOfBounds && Math.floor(Date.now() / 250) % 2)
      banner(ctx, cx, cy - 120, 'RETURN TO COMBAT ZONE', AMBER);
    if (sh.dead) banner(ctx, cx, cy, 'HULL BREACH — REINITIALIZING', RED);
  }

  function banner(ctx, x, y, txt, col) {
    ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = col;
    ctx.font = 'bold 22px "Courier New", monospace'; ctx.fillText(txt, x, y);
    ctx.restore();
  }

  // ── artificial horizon + pitch ladder (rotates w/ roll, slides w/ pitch) ──
  function drawAttitude(ctx, cx, cy, sh) {
    const pitch = Math.asin(SF.U.clamp(sh.fwd.y, -1, 1));
    const roll = Math.atan2(sh.right.y, sh.up.y);
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - 150, cy - 110, 300, 220); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(-roll);
    ctx.strokeStyle = DIM; ctx.fillStyle = GREEN;
    ctx.textAlign = 'center';
    for (let a = -60; a <= 60; a += 10) {
      const y = (pitch - a * Math.PI / 180) * PXDEG * 180 / Math.PI;
      if (Math.abs(y) > 150) continue;
      const w = a === 0 ? 150 : 46;
      ctx.strokeStyle = a === 0 ? GREEN : DIM;
      ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(-22, y);
      ctx.moveTo(22, y); ctx.lineTo(w, y); ctx.stroke();
      if (a !== 0) {                              // labels at the rung ends
        ctx.fillStyle = DIM; const lbl = (a > 0 ? '+' : '') + a;
        ctx.textAlign = 'right'; ctx.fillText(lbl, -w - 4, y + 4);
        ctx.textAlign = 'left';  ctx.fillText(lbl, w + 4, y + 4);
        ctx.textAlign = 'center';
      }
    }
    ctx.restore();
  }

  // ── heading strip across the top ──
  function drawCompass(ctx, W, sh) {
    const cx = W / 2;
    let hdg = Math.atan2(sh.fwd.x, -sh.fwd.z) * 180 / Math.PI;
    if (hdg < 0) hdg += 360;
    ctx.save(); ctx.strokeStyle = DIM; ctx.fillStyle = GREEN;
    ctx.textAlign = 'center';
    ctx.beginPath(); ctx.moveTo(cx - 150, 30); ctx.lineTo(cx + 150, 30); ctx.stroke();
    for (let d = -60; d <= 60; d += 15) {
      const h = ((Math.round(hdg / 15) * 15) + d + 360) % 360;
      const x = cx + (d - (hdg - Math.round(hdg / 15) * 15)) * 2.2;
      ctx.strokeStyle = DIM;
      ctx.beginPath(); ctx.moveTo(x, 24); ctx.lineTo(x, 30); ctx.stroke();
      ctx.fillStyle = DIM; ctx.fillText(('00' + h).slice(-3), x, 20);
    }
    ctx.fillStyle = GREEN;
    ctx.beginPath(); ctx.moveTo(cx, 33); ctx.lineTo(cx - 5, 26); ctx.lineTo(cx + 5, 26);
    ctx.closePath(); ctx.fill();
    ctx.fillText(('00' + Math.round(hdg)).slice(-3), cx, 50);
    ctx.restore();
  }

  // ── target markers, lock box, plasma lead pip ──
  function drawTargets(ctx) {
    ctx.save(); ctx.textAlign = 'left';
    for (const d of SF.World.drones) {
      const s = project(d.pos);
      if (!s.vis) continue;
      const locked = d === SF.S.lock;
      ctx.strokeStyle = locked ? RED : '#5a8fd0';
      ctx.lineWidth = locked ? 2 : 1;
      const r = locked ? 16 : 9;
      ctx.strokeRect(s.x - r, s.y - r, r * 2, r * 2);

      // enemy health bar above the box
      const f = SF.U.clamp(d.hp / d.maxhp, 0, 1);
      const bw = Math.max(24, r * 2), bx = s.x - bw / 2, by = s.y - r - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, by, bw, 4);
      ctx.fillStyle = f > 0.5 ? '#5dff8b' : f > 0.25 ? '#ffcf5a' : '#ff5a5a';
      ctx.fillRect(bx, by, bw * f, 4);
      ctx.strokeStyle = locked ? RED : 'rgba(120,150,190,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, 4);

      if (locked) {
        const dist = Math.round(SF.S.lockDist);
        ctx.fillStyle = RED; ctx.fillText('LOCK ' + dist + 'm', s.x + r + 4, s.y);
        // plasma lead indicator
        const rel = d.pos.clone().sub(SF.Ship.pos);
        const t = rel.length() / SF.CFG.weapons.plasma.speed;
        const lead = d.pos.clone().addScaledVector(
          d.vel.clone().sub(SF.Ship.vel), t);
        const ls = project(lead);
        if (ls.vis) {
          ctx.strokeStyle = GREEN;
          ctx.beginPath(); ctx.arc(ls.x, ls.y, 4, 0, 6.28); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function drawReticle(ctx, cx, cy) {
    ctx.save(); ctx.strokeStyle = GREEN; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 6, cy);
    ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy - 6);
    ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + 18);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 6.28); ctx.fillStyle = GREEN; ctx.fill();
    ctx.restore();
  }

  // ── left: airspeed readout, right: throttle bar ──
  function drawSpeedThrottle(ctx, H, sh) {
    const x = 64, y0 = H / 2 - 80, hgt = 160;
    ctx.save(); ctx.strokeStyle = DIM; ctx.fillStyle = GREEN; ctx.textAlign = 'right';
    ctx.strokeRect(x - 44, y0, 6, hgt);
    const f = SF.U.clamp(sh.speed / (SF.CFG.flight.maxSpeed * SF.CFG.flight.boostMult), 0, 1);
    ctx.fillStyle = sh.boosting ? AMBER : GREEN;
    ctx.fillRect(x - 44, y0 + hgt * (1 - f), 6, hgt * f);
    ctx.fillStyle = GREEN; ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillText(Math.round(sh.speed), x, y0 - 8);
    ctx.font = '10px "Courier New", monospace'; ctx.fillStyle = DIM;
    ctx.fillText('SPD m/s', x, y0 + hgt + 16);

    // throttle (right)
    const tx = SF.refs.W - 64;
    ctx.textAlign = 'left';
    ctx.strokeStyle = DIM; ctx.strokeRect(tx + 38, y0, 6, hgt);
    ctx.fillStyle = GREEN; ctx.fillRect(tx + 38, y0 + hgt * (1 - sh.throttle), 6, hgt * sh.throttle);
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillText(Math.round(sh.throttle * 100) + '%', tx, y0 - 8);
    ctx.font = '10px "Courier New", monospace'; ctx.fillStyle = DIM;
    ctx.fillText('THR' + (sh.boosting ? ' ▲BST' : ''), tx, y0 + hgt + 16);
    ctx.restore();
  }

  // ── shields + hull, bottom-left ──
  function drawStatus(ctx, H, sh) {
    const x = 30, y = H - 64;
    ctx.save(); ctx.font = '11px "Courier New", monospace'; ctx.textAlign = 'left';
    const noRegen = sh.boosting && sh.shield < SF.CFG.ship.shieldMax;
    bar(ctx, x, y, 150, 10, sh.shield / SF.CFG.ship.shieldMax,
        noRegen ? '#ff9a3a' : '#49c0ff', noRegen ? 'SHIELD  NO REGEN' : 'SHIELD');
    bar(ctx, x, y + 22, 150, 10, sh.hull / SF.CFG.ship.hullMax,
        sh.hull < 30 ? RED : GREEN, 'HULL');
    ctx.restore();
  }
  function bar(ctx, x, y, w, h, f, col, label) {
    f = SF.U.clamp(f, 0, 1);
    ctx.strokeStyle = DIM; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, (w - 2) * f, h - 2);
    ctx.fillStyle = '#bfe8d4'; ctx.fillText(label, x, y - 3);
  }

  // ── weapon select + ammo, bottom-right ──
  function drawWeapons(ctx, W, H) {
    const ammo = SF.Weapons.getAmmo(), cur = SF.Weapons.getCurrent();
    const types = SF.Weapons.getMissileTypes();
    const x = W - 30, base = H - 24 - types.length * 18;
    ctx.save(); ctx.textAlign = 'right'; ctx.font = '12px "Courier New", monospace';
    ctx.fillStyle = GREEN; ctx.fillText('PLASMA ∞', x, base);
    types.forEach((k, i) => {
      const cfg = SF.CFG.weapons[k];
      const css = '#' + cfg.color.toString(16).padStart(6, '0');  // match the portal color
      ctx.globalAlpha = cur === k ? 1 : 0.5;
      ctx.fillStyle = css;
      ctx.fillText((cur === k ? '▸ ' : '  ') + cfg.name + '  ' + ammo[k] + '/' + cfg.ammo,
                   x, base + 18 + i * 18);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left'; ctx.fillStyle = '#6fd0a0';
    ctx.fillText('KILLS ' + SF.S.score, 30, 28);
    ctx.restore();
  }

  // ── simple, coherent canopy frame to sell the cockpit ──
  function drawCanopy(ctx, W, H) {
    ctx.save();
    const strut = 'rgba(18,22,30,0.92)', edge = 'rgba(70,86,110,0.9)';
    // top canopy bow
    ctx.fillStyle = strut;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, 16);
    ctx.quadraticCurveTo(W / 2, 44, 0, 16); ctx.closePath(); ctx.fill();
    // side pillars
    ctx.fillStyle = strut;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(28, 0);
    ctx.quadraticCurveTo(14, H * 0.5, 40, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W - 28, 0);
    ctx.quadraticCurveTo(W - 14, H * 0.5, W - 40, H); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    // bottom dashboard
    const g = ctx.createLinearGradient(0, H - 92, 0, H);
    g.addColorStop(0, 'rgba(16,20,28,0)'); g.addColorStop(0.5, 'rgba(16,20,28,0.96)');
    g.addColorStop(1, 'rgba(8,10,16,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(0, H - 70);
    ctx.quadraticCurveTo(W / 2, H - 130, W, H - 70); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    // dash highlight + a couple of console lights
    ctx.strokeStyle = edge; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H - 70);
    ctx.quadraticCurveTo(W / 2, H - 130, W, H - 70); ctx.stroke();
    const blink = Math.floor(Date.now() / 500) % 2;
    ctx.fillStyle = blink ? '#3affa0' : '#176b46';
    ctx.fillRect(W / 2 - 70, H - 26, 5, 5);
    ctx.fillStyle = SF.Ship.hull < 30 ? RED : '#176b46';
    ctx.fillRect(W / 2 + 64, H - 26, 5, 5);
    ctx.fillStyle = SF.S.usingPad ? '#3affa0' : '#5a6a55';
    ctx.fillRect(W / 2 - 2, H - 22, 5, 5);
    ctx.restore();
  }

  return { draw };
})();
