import { CarConfig } from './CarConfig';
import type { VehicleProfile } from './VehicleConfigs';

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
 * Drivetrain with two modes:
 *
 * - **combustion**: RPM-based with discrete gears, torque curve, automatic /
 *   manual transmission, rev limiter. Lifts off coasting produces a small
 *   drag. The original gas-car behaviour.
 * - **electric**: single-speed reduction, continuous torque map (flat peak
 *   torque up to a knee speed, then constant power up to a top-speed
 *   limiter). One-pedal feel via strong regen drag when off-throttle that
 *   feathers out below ~5 km/h. No gear shifts; gear is always `D` or `R`.
 *
 * `engineForce` (Newtons at the wheel contact) and `gearLabel()` are the
 * same outputs in both modes; the Car layer doesn't need to know which
 * drivetrain it has.
 */
export class Drivetrain {
  rpm: number;
  gear: number = FIRST;
  mode: TransmissionMode = 'automatic';

  /** Last computed total engine force to apply across driven wheels (Newtons). */
  engineForce = 0;
  /** True while the rev limiter is cutting fuel (combustion only). */
  onLimiter = false;
  /** -1..1 normalised power output (positive = drive, negative = regen).
   *  Used by the EV HUD's power bar. Always 0 for combustion. */
  powerT = 0;

  private shiftCooldown = 0;
  private readonly profile: VehicleProfile;

  constructor(profile: VehicleProfile) {
    this.profile = profile;
    this.rpm = profile.idleRpm ?? 0;
  }

  /** Restore a clean drivetrain state. Used on respawn. */
  reset(): void {
    this.gear = FIRST;
    this.rpm = this.profile.idleRpm ?? 0;
    this.engineForce = 0;
    this.onLimiter = false;
    this.shiftCooldown = 0;
    this.powerT = 0;
  }

  setMode(mode: TransmissionMode): void {
    // EVs are always automatic — they have no gears to shift.
    this.mode = this.profile.drivetrain === 'electric' ? 'automatic' : mode;
  }

  toggleMode(): void {
    if (this.profile.drivetrain === 'electric') return;
    this.mode = this.mode === 'automatic' ? 'manual' : 'automatic';
  }

  shiftUp(): void {
    if (this.profile.drivetrain === 'electric') return;
    if (this.mode !== 'manual') return;
    if (this.shiftCooldown > 0) return;
    if (this.gear >= TOP_GEAR) return;
    this.gear = this.gear === REVERSE ? FIRST : this.gear + 1;
    this.shiftCooldown = this.profile.shiftInterruptSec ?? 0.15;
  }

  shiftDown(speedKmh: number): void {
    if (this.profile.drivetrain === 'electric') return;
    if (this.mode !== 'manual') return;
    if (this.shiftCooldown > 0) return;
    if (this.gear === REVERSE) return;
    if (this.gear === FIRST) {
      if (speedKmh < 3) {
        this.gear = REVERSE;
        this.shiftCooldown = this.profile.shiftInterruptSec ?? 0.15;
      }
      return;
    }
    this.gear = this.gear - 1;
    this.shiftCooldown = this.profile.shiftInterruptSec ?? 0.15;
  }

  gearLabel(): string {
    if (this.profile.drivetrain === 'electric') {
      return this.gear === REVERSE ? 'R' : 'D';
    }
    if (this.gear === REVERSE) return 'R';
    return String(this.gear);
  }

  /** Advance the drivetrain one physics step. */
  update(dt: number, input: DrivetrainInput): void {
    if (this.profile.drivetrain === 'electric') {
      this.updateElectric(dt, input);
    } else {
      this.updateCombustion(dt, input);
    }
  }

  // ════════════ Combustion ════════════
  private updateCombustion(dt: number, input: DrivetrainInput): void {
    const p = this.profile;
    if (this.shiftCooldown > 0) this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);

    if (this.mode === 'automatic' && this.gear !== REVERSE && this.shiftCooldown === 0) {
      const band = p.autoShiftBands![this.gear];
      const speedKmh = Math.abs(input.forwardVel) * 3.6;
      if (speedKmh > band[0] && this.gear < TOP_GEAR) {
        this.gear += 1;
        this.shiftCooldown = p.shiftInterruptSec ?? 0.15;
      } else if (speedKmh < band[1] && this.gear > FIRST) {
        this.gear -= 1;
        this.shiftCooldown = p.shiftInterruptSec ?? 0.15;
      }
    }

    const ratio = p.gearRatios![this.gear];
    const totalRatio = ratio * (p.finalDrive ?? 1);

    const wheelAngVel = input.forwardVel / CarConfig.wheelRadius;
    const wheelDrivenRpm = Math.abs(wheelAngVel * totalRatio) * RAD_PER_SEC_TO_RPM;

    if (this.shiftCooldown > 0) {
      const target = (p.idleRpm ?? 900) + input.throttle * ((p.redlineRpm ?? 7000) - (p.idleRpm ?? 900));
      this.rpm = approach(this.rpm, target, (p.engineFreeRevRpmPerSec ?? 9000) * dt);
    } else {
      this.rpm = clamp(wheelDrivenRpm, p.idleRpm ?? 900, (p.redlineRpm ?? 7000) + 200);
    }

    this.onLimiter = this.rpm >= (p.redlineRpm ?? 7000);

    let force = 0;
    if (this.shiftCooldown > 0 || this.onLimiter) {
      force = 0;
    } else if (input.throttle > 0) {
      const torque = torqueAt(p.torqueCurve!, this.rpm) * input.throttle;
      force = (torque * totalRatio * (p.drivetrainEfficiency ?? 0.92)) / CarConfig.wheelRadius;
    }

    // Engine braking when coasting.
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
    this.powerT = 0; // not used for combustion
  }

  // ════════════ Electric ════════════
  private updateElectric(_dt: number, input: DrivetrainInput): void {
    const p = this.profile;
    const speedKmh = Math.abs(input.forwardVel) * 3.6;
    const peakT = p.evPeakTorqueNm ?? 500;
    const peakP = p.evPeakPowerW ?? 250_000;
    const knee = p.evKneeKmh ?? 60;
    const topSpeed = p.evMaxSpeedKmh ?? 220;
    const ratio = p.evFixedRatio ?? 9;
    const regenK = p.evRegenFactor ?? 14;
    const featherKmh = p.evRegenFeatherKmh ?? 5;
    const autoReverseKmh = p.autoReverseThresholdKmh ?? 2;

    // Direction selection (D / R). Pressing brake at near-zero speed flips
    // to reverse; throttle at near-zero in reverse flips back to D. This
    // mirrors the combustion automatic behaviour.
    const stopped = speedKmh < autoReverseKmh;
    if (input.brake && stopped && this.gear !== REVERSE && input.throttle === 0) {
      this.gear = REVERSE;
    } else if (input.throttle > 0 && stopped && this.gear === REVERSE) {
      this.gear = FIRST;
    }

    // Continuous torque curve: flat T below knee, then constant-power above.
    // Convert peak torque to wheel force (T * ratio / radius).
    const peakWheelForce = (peakT * ratio) / CarConfig.wheelRadius;
    let driveForce = 0;
    if (input.throttle > 0) {
      let force = peakWheelForce;
      if (speedKmh > knee) {
        // Constant power region: P = F · v → F = P/v.
        const vMs = Math.max(1, Math.abs(input.forwardVel));
        const powerLimited = peakP / vMs;
        force = Math.min(force, powerLimited);
      }
      // Top-speed cut: ramp down over the last 10 km/h.
      const cut = Math.max(0, Math.min(1, (topSpeed - speedKmh) / 10));
      force *= cut;
      driveForce = this.gear === REVERSE ? -force : force;
      driveForce *= input.throttle;
    }

    // Regen: drag proportional to speed, feathered below `featherKmh` so
    // the last few km/h don't feel like the car hits a wall. Layered on
    // top of the friction brake when the brake key is held — real EVs
    // blend regen and friction braking, and the brake regen is the
    // strongest deceleration force you can ask for.
    let regenForce = 0;
    if (input.throttle === 0 && Math.abs(input.forwardVel) > 0.05) {
      const feather = Math.min(1, speedKmh / featherKmh);
      const brakeRegenK = p.evBrakeRegenFactor ?? regenK * 3;
      const k = input.brake ? regenK + brakeRegenK : regenK;
      regenForce = -Math.sign(input.forwardVel) * k * speedKmh * feather;
    }

    this.engineForce = driveForce + regenForce;
    this.rpm = 0;
    this.onLimiter = false;

    // Normalised -1..1 power for the HUD bar. Positive when driving forward,
    // negative when regen is pulling.
    const normDrive = peakWheelForce > 0 ? driveForce / peakWheelForce : 0;
    const normRegen = peakWheelForce > 0 ? regenForce / peakWheelForce : 0;
    this.powerT = Math.max(-1, Math.min(1, normDrive + normRegen));
  }

  forceGear(gear: number): void {
    if (gear === this.gear) return;
    this.gear = gear;
    this.shiftCooldown = this.profile.shiftInterruptSec ?? 0.15;
  }
}

function torqueAt(curve: ReadonlyArray<{ rpm: number; nm: number }>, rpm: number): number {
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
