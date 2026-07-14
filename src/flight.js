// ──────────────────────────────────────────────────────────────────────────
//  flight.js — the ship + the arcade-hybrid flight model.
//
//  Model: rate-based control (stick = rotation RATE), and the velocity vector
//  chases wherever the nose points. The chase speed scales with `flightAssist`:
//    assist = 1  → velocity locks to the nose almost instantly (pure arcade)
//    assist → 0  → momentum is conserved, the ship drifts (toward Newtonian)
//  That single knob lets us slide the whole feel without rearchitecting.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

SF.Ship = (function () {
  const F = () => SF.CFG.flight;
  const S = () => SF.CFG.ship;

  const ship = {
    pos:  new THREE.Vector3(0, 0, 0),
    quat: new THREE.Quaternion(),
    vel:  new THREE.Vector3(),
    rate: new THREE.Vector3(),   // current angular rate (pitch, yaw, roll) rad/s
    throttle: 0.30,
    speed: 0,
    boosting: false,
    shield: 100, hull: 100, shieldTimer: 0,
    dead: false, respawnT: 0,

    // local basis vectors (recomputed each update)
    fwd: new THREE.Vector3(0, 0, -1),
    up:  new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),

    reset() {
      this.pos.set(0, 0, 0); this.quat.identity(); this.vel.set(0, 0, 0);
      this.rate.set(0, 0, 0); this.throttle = 0.30; this.speed = 0;
      this.shield = S().shieldMax; this.hull = S().hullMax; this.shieldTimer = 0;
      this.dead = false; this.respawnT = 0;
    },

    damage(amt) {
      this.shieldTimer = S().shieldDelay;
      if (this.shield > 0) {
        this.shield -= amt;
        if (this.shield < 0) { this.hull += this.shield; this.shield = 0; }
      } else {
        this.hull -= amt;
      }
      if (this.hull <= 0 && !this.dead) {
        this.hull = 0; this.dead = true; this.respawnT = 2.2;
        SF.FX && SF.FX.explode(this.pos, 120, 0x88ccff);
        SF.Sound && SF.Sound.explosion(1.6);
        SF.Input.rumble(1.0, 1.0, 550, 0);      // big jolt on destruction
        SF.refs.shake = 1.0;
      }
    },

    update(dt, cmd) {
      const f = F();

      if (this.dead) {
        this.respawnT -= dt;
        if (this.respawnT <= 0) this.reset();
        return;
      }

      // ── throttle (incremental — fits the SN30's digital triggers) ──
      if (cmd.throttleUp)   this.throttle += f.throttleRate * dt;
      if (cmd.throttleDown) this.throttle -= f.throttleRate * dt;
      if (cmd.brake)        this.throttle -= f.brakePower * dt;
      this.throttle = SF.U.clamp(this.throttle, 0, 1);
      this.boosting = cmd.boost;

      // ── rotation: stick → commanded rate, smoothed toward by rotDamp ──
      const pIn = (f.invertPitch ? 1 : -1) * cmd.pitch;   // stick up = nose up
      const cmdP =  pIn      * f.pitchRate;
      const cmdY = -cmd.yaw  * f.yawRate;                  // stick right = nose right
      const cmdR = -cmd.roll * f.rollRate;                 // stick left  = bank left
      this.rate.x = SF.U.approach(this.rate.x, cmdP, f.rotDamp, dt);
      this.rate.y = SF.U.approach(this.rate.y, cmdY, f.rotDamp, dt);
      this.rate.z = SF.U.approach(this.rate.z, cmdR, f.rotDamp, dt);

      // integrate orientation in the ship's local frame
      const dq = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.rate.x * dt, this.rate.y * dt, this.rate.z * dt, 'XYZ'));
      this.quat.multiply(dq).normalize();

      // refresh basis vectors
      this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
      this.up.set(0, 1, 0).applyQuaternion(this.quat);
      this.right.set(1, 0, 0).applyQuaternion(this.quat);

      // ── velocity: chase nose * targetSpeed, rate scaled by flight assist ──
      const targetSpeed = this.throttle * f.maxSpeed * (this.boosting ? f.boostMult : 1);
      const desired = this.fwd.clone().multiplyScalar(targetSpeed);
      const k = f.assistLerp * f.flightAssist;
      this.vel.lerp(desired, 1 - Math.exp(-k * dt));

      this.pos.addScaledVector(this.vel, dt);
      this.speed = this.vel.length();

      // ── soft arena boundary: gentle pull back in + warn ──
      const b = SF.CFG.world.boundary;
      const d = this.pos.length();
      SF.S.outOfBounds = d > b;
      if (d > b) {
        const pull = this.pos.clone().multiplyScalar(-1 / d);
        this.vel.addScaledVector(pull, (d - b) * 0.9 * dt);
      }

      // ── shield regen after a quiet period — but NOT while boosting ──
      // (boosting diverts power, so you can't recharge while fleeing on the burn)
      if (this.shieldTimer > 0) this.shieldTimer -= dt;
      else if (!this.boosting && this.shield < S().shieldMax)
        this.shield = Math.min(S().shieldMax, this.shield + S().shieldRegen * dt);
    },
  };

  return ship;
})();
