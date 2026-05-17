import { CarConfig } from './CarConfig';

export type TransmissionMode = 'automatic' | 'manual';

/** Gear index conventions: 0 = Reverse, 1..5 = forward gears. */
const REVERSE = 0;
const FIRST = 1;
const TOP_GEAR = 5;

const RAD_PER_SEC_TO_RPM = 60 / (2 * Math.PI);

interface DrivetrainInput {
  /** 0..1 accelerator. */
  throttle: number;
  /** True if the brake key is held. */
  brake: boolean;
  /** Forward velocity (m/s) along the car's local +z. */
  forwardVel: number;
}

/**
 * RPM-based drivetrain. Converts pedal/gear state into the per-step engine
 * force the vehicle controller applies to its driven wheels.
 *
 * Engine RPM derives from wheel angular speed via the current gear ratio
 * (or free-revs toward throttle target when the wheels aren't driving).
 *
 * Both `automatic` and `manual` modes are implemented; the caller flips via
 * `setMode()` and shifts via `shiftUp()`/`shiftDown()` in manual.
 */
export class Drivetrain {
  rpm: number;
  gear: number = FIRST;
  mode: TransmissionMode = 'automatic';

  /** Last computed total engine force to apply across driven wheels (Newtons). */
  engineForce = 0;
  /** True while the rev limiter is cutting fuel. */
  onLimiter = false;

  private shiftCooldown = 0;

  constructor() {
    this.rpm = CarConfig.idleRpm;
  }

  /** Restore a clean drivetrain state (1st gear, idle RPM). Used on respawn. */
  reset(): void {
    this.gear = FIRST;
    this.rpm = CarConfig.idleRpm;
    this.engineForce = 0;
    this.onLimiter = false;
    this.shiftCooldown = 0;
  }

  setMode(mode: TransmissionMode): void {
    this.mode = mode;
  }

  toggleMode(): void {
    this.mode = this.mode === 'automatic' ? 'manual' : 'automatic';
  }

  /** Manual upshift. Refused mid-shift or already at top. */
  shiftUp(): void {
    if (this.mode !== 'manual') return;
    if (this.shiftCooldown > 0) return;
    if (this.gear >= TOP_GEAR) return;
    // From R, an upshift goes to 1st.
    this.gear = this.gear === REVERSE ? FIRST : this.gear + 1;
    this.shiftCooldown = CarConfig.shiftInterruptSec;
  }

  /** Manual downshift. From 1st, drops to Reverse only at low speed. */
  shiftDown(speedKmh: number): void {
    if (this.mode !== 'manual') return;
    if (this.shiftCooldown > 0) return;
    if (this.gear === REVERSE) return;
    if (this.gear === FIRST) {
      if (speedKmh < 3) {
        this.gear = REVERSE;
        this.shiftCooldown = CarConfig.shiftInterruptSec;
      }
      return;
    }
    this.gear = this.gear - 1;
    this.shiftCooldown = CarConfig.shiftInterruptSec;
  }

  gearLabel(): string {
    if (this.gear === REVERSE) return 'R';
    return String(this.gear);
  }

  /**
   * Advance the drivetrain one physics step. Caller passes the current
   * driver inputs and the car's forward velocity; we return nothing — read
   * `engineForce`, `rpm`, `gear`, `onLimiter` afterwards.
   */
  update(dt: number, input: DrivetrainInput): void {
    const c = CarConfig;
    if (this.shiftCooldown > 0) this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);

    // --- Automatic upshift/downshift between forward gears -----------------
    // Speed-banded: each forward gear has [upshiftAboveKmh, downshiftBelowKmh].
    // Driving speed (not RPM) is the input, so the shift point doesn't drift
    // when gear ratios change. Reverse engagement (forward↔reverse) is handled
    // by the Car layer where the key bindings live.
    if (this.mode === 'automatic' && this.gear !== REVERSE && this.shiftCooldown === 0) {
      const band = c.autoShiftBands[this.gear];
      const speedKmh = Math.abs(input.forwardVel) * 3.6;
      if (speedKmh > band[0] && this.gear < TOP_GEAR) {
        this.gear += 1;
        this.shiftCooldown = c.shiftInterruptSec;
      } else if (speedKmh < band[1] && this.gear > FIRST) {
        this.gear -= 1;
        this.shiftCooldown = c.shiftInterruptSec;
      }
    }

    const ratio = c.gearRatios[this.gear];
    const totalRatio = ratio * c.finalDrive;

    // --- Engine RPM ---------------------------------------------------------
    // Wheel angular speed in rad/s, derived from forward velocity. Negative
    // when reversing.
    const wheelAngVel = input.forwardVel / c.wheelRadius;
    // RPM the wheels demand of the engine through the current gear.
    // |ratio| because reverse just runs the engine forward through a negative
    // gear; the *direction* of the wheels handles reverse motion.
    const wheelDrivenRpm =
      Math.abs(wheelAngVel * totalRatio) * RAD_PER_SEC_TO_RPM;

    if (this.shiftCooldown > 0) {
      // Clutch effectively open during the shift — engine free-revs toward
      // throttle target so the sound responds and the gauge dips/rises.
      const target = c.idleRpm + input.throttle * (c.redlineRpm - c.idleRpm);
      this.rpm = approach(this.rpm, target, c.engineFreeRevRpmPerSec * dt);
    } else {
      this.rpm = clamp(wheelDrivenRpm, c.idleRpm, c.redlineRpm + 200);
    }

    // --- Rev limiter --------------------------------------------------------
    this.onLimiter = this.rpm >= c.redlineRpm;

    // --- Engine force at the wheel contact ---------------------------------
    let force = 0;
    if (this.shiftCooldown > 0 || this.onLimiter) {
      force = 0;
    } else if (input.throttle > 0) {
      const torque = torqueAt(this.rpm) * input.throttle;
      // F_wheel = torque * totalRatio * efficiency / wheelRadius.
      // Sign comes from the gear ratio (negative in reverse) so the controller
      // pushes the car backward in R.
      force =
        (torque * totalRatio * c.drivetrainEfficiency) / c.wheelRadius;
    }

    // Engine braking when coasting (no throttle, not braking, in a forward
    // gear and moving forward). Small drag so lifting off slows you.
    if (
      input.throttle === 0 &&
      !input.brake &&
      this.gear !== REVERSE &&
      input.forwardVel > 1.0 &&
      this.shiftCooldown === 0
    ) {
      const drag = 60 * Math.min(1, this.rpm / 3000);
      force -= drag;
    }

    this.engineForce = force;
  }

  /** Force a specific gear (used by Car layer to flip between R and 1 in auto). */
  forceGear(gear: number): void {
    if (gear === this.gear) return;
    this.gear = gear;
    this.shiftCooldown = CarConfig.shiftInterruptSec;
  }
}

function torqueAt(rpm: number): number {
  const curve = CarConfig.torqueCurve;
  if (rpm <= curve[0].rpm) return curve[0].nm;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (rpm <= b.rpm) {
      const t = (rpm - a.rpm) / (b.rpm - a.rpm);
      return a.nm + (b.nm - a.nm) * t;
    }
  }
  return curve[curve.length - 1].nm;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function approach(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}
