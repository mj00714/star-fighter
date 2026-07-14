// ──────────────────────────────────────────────────────────────────────────
//  diag.js — controller diagnostic overlay. Toggle with ` (Backquote) or the
//  pad's R3 button (Select now cycles the camera view). Shows live axes, button indices, mapping, and the
//  current stick scheme. While open, [M] / L3 swaps classic ⇄ twin-stick.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.Diag = (function () {
  const GREEN = '#7dffb0', DIM = '#3a6f55', AMBER = '#ffcf5a', GREY = '#8090a0';
  const AXIS_LABEL = ['L-X', 'L-Y', 'R-X', 'R-Y', 'a4', 'a5'];

  function draw(ctx) {
    const x = 22, y = 78, w = 270;
    const d = SF.Input.debug();
    const cmd = SF.S.lastCmd || {};

    ctx.save();
    ctx.font = '11px "Courier New", monospace'; ctx.textAlign = 'left';
    // backing panel
    let h = d.connected ? 366 : 150;
    ctx.fillStyle = 'rgba(4,8,12,0.85)'; ctx.fillRect(x - 8, y - 20, w, h);
    ctx.strokeStyle = DIM; ctx.strokeRect(x - 8, y - 20, w, h);

    ctx.fillStyle = AMBER; ctx.fillText('▎CONTROLLER DIAGNOSTIC  [ ` close ]', x, y - 6);
    let ly = y + 14;
    const line = (label, val, col) => {
      ctx.fillStyle = DIM; ctx.fillText(label, x, ly);
      ctx.fillStyle = col || GREEN; ctx.fillText(val, x + 92, ly); ly += 16;
    };

    line('SCHEME', SF.BIND.scheme.toUpperCase(), AMBER);
    ctx.fillStyle = GREY; ctx.fillText(SF.schemeDesc(), x, ly); ly += 14;
    ctx.fillStyle = GREY; ctx.fillText('[M] or L3 to swap sticks', x, ly); ly += 18;

    if (!d.connected) {
      ctx.fillStyle = AMBER;
      ctx.fillText('no pad — keyboard active.', x, ly); ly += 16;
      ctx.fillStyle = GREY;
      ctx.fillText('click page; pair SN30 in X-input', x, ly);
      ctx.restore(); return;
    }

    line('PAD', (d.id || '').slice(0, 22));
    line('MAPPING', d.mapping, d.mapping === 'standard' ? GREEN : AMBER);
    line('RUMBLE', d.rumble ? (d.rumbleOn ? 'on  [V]' : 'OFF [V]') : 'none',
         d.rumble ? (d.rumbleOn ? GREEN : AMBER) : GREY);
    if (d.mapping !== 'standard') {
      ctx.fillStyle = AMBER; ctx.fillText('⚠ not standard — bindings may shift', x, ly); ly += 16;
    }

    // axes as centered bars
    ctx.fillStyle = DIM; ctx.fillText('AXES', x, ly); ly += 14;
    const bw = 150, bx = x + 56;
    for (let i = 0; i < d.axes.length && i < 6; i++) {
      const v = d.axes[i];
      ctx.fillStyle = GREY; ctx.fillText(AXIS_LABEL[i] || ('a' + i), x, ly + 4);
      ctx.strokeStyle = DIM; ctx.strokeRect(bx, ly - 6, bw, 9);
      ctx.strokeStyle = '#1f3b2c';
      ctx.beginPath(); ctx.moveTo(bx + bw / 2, ly - 6); ctx.lineTo(bx + bw / 2, ly + 3); ctx.stroke();
      ctx.fillStyle = GREEN;
      const px = bx + bw / 2 + (v * bw / 2);
      ctx.fillRect(Math.min(px, bx + bw / 2), ly - 5, Math.abs(v * bw / 2), 7);
      ctx.fillStyle = GREY; ctx.textAlign = 'right';
      ctx.fillText(v.toFixed(2), bx + bw + 44, ly + 4); ctx.textAlign = 'left';
      ly += 14;
    }

    // buttons as an index grid
    ly += 6; ctx.fillStyle = DIM; ctx.fillText('BUTTONS', x, ly); ly += 12;
    const cols = 9, cell = 26;
    for (let i = 0; i < d.buttons.length; i++) {
      const cx = x + (i % cols) * cell, cyy = ly + Math.floor(i / cols) * 22;
      const on = d.buttons[i];
      ctx.fillStyle = on ? GREEN : 'rgba(255,255,255,0.05)';
      ctx.fillRect(cx, cyy, 22, 18);
      ctx.strokeStyle = DIM; ctx.strokeRect(cx, cyy, 22, 18);
      ctx.fillStyle = on ? '#04140c' : GREY; ctx.textAlign = 'center';
      ctx.fillText(i, cx + 11, cyy + 13); ctx.textAlign = 'left';
    }

    // derived flight commands (works for pad or keyboard)
    ly += 2 + Math.ceil(d.buttons.length / cols) * 22 + 8;
    ctx.fillStyle = DIM; ctx.fillText('OUT', x, ly);
    ctx.fillStyle = GREEN;
    ctx.fillText('P ' + (cmd.pitch || 0).toFixed(2) +
                 '  Y ' + (cmd.yaw || 0).toFixed(2) +
                 '  R ' + (cmd.roll || 0).toFixed(2), x + 36, ly);

    ctx.restore();
  }

  return { draw };
})();
