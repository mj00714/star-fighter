// ──────────────────────────────────────────────────────────────────────────
//  navmap.js — the 3D nav bubble in the corner. Contacts are transformed into
//  the ship's local frame and plotted on a sphere: position on the disc =
//  bearing, a vertical stalk = elevation above/below your plane of flight.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.Nav = (function () {
  const RANGE = SF.CFG.world.boundary;   // scan the whole arena
  const DIM = '#2f6f4f', GREEN = '#7dffb0', RED = '#ff6a6a', GREY = '#6b7790';

  function draw(ctx) {
    const W = SF.refs.W;
    const cxp = W - 92, cyp = 96, R = 60;
    const inv = SF.Ship.quat.clone().invert();

    ctx.save();
    // bubble shell + equatorial plane + axes
    ctx.lineWidth = 1;
    ctx.strokeStyle = DIM;
    ctx.beginPath(); ctx.arc(cxp, cyp, R, 0, 6.28); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cxp, cyp, R, R * 0.34, 0, 0, 6.28); ctx.stroke();
    ctx.strokeStyle = 'rgba(47,111,79,0.5)';
    ctx.beginPath(); ctx.moveTo(cxp - R, cyp); ctx.lineTo(cxp + R, cyp);
    ctx.moveTo(cxp, cyp - R); ctx.lineTo(cxp, cyp + R); ctx.stroke();

    plot(ctx, SF.World.asteroids, inv, cxp, cyp, R, GREY, 1.5, false);
    plot(ctx, SF.World.pickups, inv, cxp, cyp, R, null, 2.4, false);   // per-ring color
    plot(ctx, SF.World.drones, inv, cxp, cyp, R, RED, 2.6, true);
    plot(ctx, SF.Missions.blips, inv, cxp, cyp, R, null, 3.4, false);  // waypoints (cyan)

    // own-ship forward indicator (top of bubble = your nose)
    ctx.fillStyle = GREEN;
    ctx.beginPath(); ctx.moveTo(cxp, cyp - R - 2);
    ctx.lineTo(cxp - 4, cyp - R + 6); ctx.lineTo(cxp + 4, cyp - R + 6);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = DIM; ctx.font = '9px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NAV  ' + (RANGE / 100 | 0) + 'km', cxp, cyp + R + 12);
    ctx.restore();
  }

  function plot(ctx, list, inv, cxp, cyp, R, color, size, isDrone) {
    for (const o of list) {
      const rel = o.pos.clone().sub(SF.Ship.pos);
      if (rel.length() > RANGE) continue;
      rel.applyQuaternion(inv).multiplyScalar(1 / RANGE);
      const nx = rel.x, ny = rel.y, nz = -rel.z;          // nz>0 = ahead
      const horiz = Math.hypot(nx, nz);
      if (horiz > 1) continue;
      const px = cxp + nx * R, py = cyp - nz * R;
      const by = py - ny * R * 0.55;                       // elevation stalk
      const locked = isDrone && o === SF.S.lock;
      ctx.strokeStyle = 'rgba(120,140,170,0.45)';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, by); ctx.stroke();
      ctx.fillStyle = locked ? '#ffd23a' : (color || o.navColor);
      const s = (locked ? size + 1.5 : size) * (nz > 0 ? 1 : 0.7);
      ctx.beginPath(); ctx.arc(px, by, s, 0, 6.28); ctx.fill();
    }
  }

  return { draw };
})();
