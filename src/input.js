// ──────────────────────────────────────────────────────────────────────────
//  input.js — reads the SN30 Pro (Gamepad API, standard mapping) with a full
//  keyboard fallback, and emits a single normalized command object per frame.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.Input = (function () {
  const keys = new Set();      // currently held key codes
  const tapped = new Set();    // keys pressed since last poll (edge)
  const padPrev = {};          // previous gamepad button states (edge detect)
  let usingPad = false;

  // Don't let game keys scroll/activate the page
  const PREVENT = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab',
                   'KeyW','KeyS','KeyQ','KeyE','KeyX','KeyF','Digit1','Digit2'];
  window.addEventListener('keydown', e => {
    if (PREVENT.includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) tapped.add(e.code);
    keys.add(e.code);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('gamepadconnected',    () => { usingPad = true;  });
  window.addEventListener('gamepaddisconnected', () => { usingPad = false; });

  const dz = v => (Math.abs(v) < SF.CFG.flight.deadzone ? 0
                   : (v - Math.sign(v) * SF.CFG.flight.deadzone) /
                     (1 - SF.CFG.flight.deadzone));

  function getPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // edge helper for gamepad buttons (idx may be a single index or an array)
  function oneEdge(pad, idx) {
    const now = pad.buttons[idx] && pad.buttons[idx].pressed;
    const was = padPrev[idx];
    padPrev[idx] = now;
    return now && !was;
  }
  function padEdge(pad, idx) {
    if (Array.isArray(idx)) {            // any of several buttons triggers it
      let any = false;
      for (const i of idx) if (oneEdge(pad, i)) any = true;
      return any;
    }
    return oneEdge(pad, idx);
  }
  const padHeld = (pad, idx) => !!(pad.buttons[idx] && pad.buttons[idx].pressed);

  // Build a fresh, zeroed command
  function blank() {
    return { pitch: 0, yaw: 0, roll: 0, look: 0,
             throttleUp: false, throttleDown: false, boost: false, brake: false,
             firePlasma: false, fireMissile: false,
             selM1: false, selM2: false, selM3: false,
             cycleNext: false, cyclePrev: false,
             targetPrev: false, targetNext: false, viewCycle: false,
             pause: false, toggleDiag: false, swapScheme: false, usingPad: false };
  }

  function poll() {
    const c = blank();
    const pad = getPad();
    const B = SF.BIND;

    if (pad) {
      usingPad = true;
      c.usingPad = true;
      const AX = SF.activeAxes();
      c.roll  = dz(pad.axes[AX.roll]  || 0);
      c.pitch = dz(pad.axes[AX.pitch] || 0);
      c.yaw   = dz(pad.axes[AX.yaw]   || 0);
      c.look  = dz(pad.axes[AX.look]  || 0);
      c.throttleUp   = padHeld(pad, B.pad.held.throttleUp);
      c.throttleDown = padHeld(pad, B.pad.held.throttleDown);
      c.firePlasma   = padHeld(pad, B.pad.held.firePlasma);
      c.boost        = padHeld(pad, B.pad.held.boost);
      c.brake        = padHeld(pad, B.pad.held.brake);
      c.fireMissile  = padEdge(pad, B.pad.edge.fireMissile);
      c.cycleNext    = padEdge(pad, B.pad.edge.cycleNext);
      c.cyclePrev    = padEdge(pad, B.pad.edge.cyclePrev);
      c.targetPrev   = padEdge(pad, B.pad.edge.targetPrev);
      c.targetNext   = padEdge(pad, B.pad.edge.targetNext);
      c.pause        = padEdge(pad, B.pad.edge.pause);
      c.viewCycle    = padEdge(pad, B.pad.edge.viewCycle);
      c.toggleDiag   = padEdge(pad, B.pad.edge.diag);
      c.swapScheme   = padEdge(pad, B.pad.edge.swapScheme);
    }

    // Keyboard is additive — it works alongside (or instead of) the pad.
    const k = B.key, kd = code => keys.has(code), kt = code => tapped.has(code);
    if (!pad) {
      c.pitch += (kd(k.pitchDown) ? 1 : 0) + (kd(k.pitchUp) ? -1 : 0);
      c.roll  += (kd(k.rollRight) ? 1 : 0) + (kd(k.rollLeft) ? -1 : 0);
      c.yaw   += (kd(k.yawRight) ? 1 : 0) + (kd(k.yawLeft) ? -1 : 0);
    }
    c.throttleUp   = c.throttleUp   || kd(k.throttleUp);
    c.throttleDown = c.throttleDown || kd(k.throttleDown);
    c.boost        = c.boost        || kd(k.boost);
    c.brake        = c.brake        || kd(k.brake);
    c.firePlasma   = c.firePlasma   || kd(k.firePlasma);
    c.fireMissile  = c.fireMissile  || kt(k.fireMissile);
    c.selM1        = c.selM1        || kt(k.selM1);
    c.selM2        = c.selM2        || kt(k.selM2);
    c.selM3        = c.selM3        || kt(k.selM3);
    c.cycleNext    = c.cycleNext    || kt(k.cycleNext);
    c.targetPrev   = c.targetPrev   || kt(k.targetPrev);
    c.targetNext   = c.targetNext   || kt(k.targetNext);
    c.pause        = c.pause        || kt(k.pause);
    c.viewCycle    = c.viewCycle    || kt(k.viewCycle);
    c.toggleDiag   = c.toggleDiag   || kt(k.diag);
    c.swapScheme   = c.swapScheme   || kt(k.swapScheme);

    c.pitch = SF.U.clamp(c.pitch, -1, 1);
    c.roll  = SF.U.clamp(c.roll, -1, 1);
    c.yaw   = SF.U.clamp(c.yaw, -1, 1);

    tapped.clear();
    SF.S && (SF.S.usingPad = c.usingPad);
    return c;
  }

  // ── haptics: dual-rumble where supported, silent no-op otherwise ──
  let lastRumble = 0, rumbleOn = true;
  // V toggles rumble off entirely (safety valve — heavy BT haptics can lag input)
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyV') { rumbleOn = !rumbleOn; console.log('[rumble] ' + (rumbleOn ? 'on' : 'off')); }
  });
  function hasRumble(pad) {
    return !!(pad && ((pad.vibrationActuator && pad.vibrationActuator.playEffect) ||
                      (pad.hapticActuators && pad.hapticActuators.length)));
  }
  // minGap throttles spammy sources; 0 = always fire
  function rumble(strong, weak, dur, minGap) {
    if (!rumbleOn) return;
    const pad = getPad();
    if (!pad) return;
    const now = performance.now();
    if (minGap && now - lastRumble < minGap) return;
    lastRumble = now;
    try {
      if (pad.vibrationActuator && pad.vibrationActuator.playEffect) {
        pad.vibrationActuator.playEffect('dual-rumble',
          { startDelay: 0, duration: dur, strongMagnitude: strong, weakMagnitude: weak });
      } else if (pad.hapticActuators && pad.hapticActuators[0] &&
                 pad.hapticActuators[0].pulse) {
        pad.hapticActuators[0].pulse(Math.max(strong, weak), dur);
      }
    } catch (e) { /* actuator busy or unsupported — ignore */ }
  }

  // raw snapshot for the diagnostic overlay
  function debug() {
    const pad = getPad();
    if (!pad) return { connected: false };
    return { connected: true, id: pad.id, mapping: pad.mapping || '(non-standard)',
             rumble: hasRumble(pad), rumbleOn,
             axes: Array.from(pad.axes),
             buttons: pad.buttons.map(b => b.pressed),
             values: pad.buttons.map(b => b.value) };
  }

  return { poll, debug, rumble, isUsingPad: () => usingPad };
})();
