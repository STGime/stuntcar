import type { Car, ReplayCarFrame, WheelSnapshot } from '../vehicle/Car';

/** A single recorded frame. Carries everything needed to drive visuals + HUD. */
export interface ReplayFrame extends ReplayCarFrame {
  rpm: number;
  speedKmh: number;
  gear: string;
  throttle: number;
}

/**
 * Ring buffer of car snapshots, one per fixed physics step.
 *
 * Spec §5.8: ~12 seconds deep at 60 Hz = 720 frames. `capture(car)` records;
 * `snapshotLast(seconds)` returns a frozen copy of the tail (used to seed the
 * `ReplayPlayer` when a crash or a long-airtime jump fires).
 */
export class ReplayRecorder {
  private readonly buffer: ReplayFrame[] = [];
  private readonly maxFrames: number;

  constructor(maxSeconds = 12, fixedDt = 1 / 60) {
    this.maxFrames = Math.ceil(maxSeconds / fixedDt);
  }

  capture(car: Car, throttle: number): void {
    const pos = car.chassisBody.translation();
    const rot = car.chassisBody.rotation();
    const wheels: WheelSnapshot[] = car.wheelSnapshot();

    const frame: ReplayFrame = {
      chassisPos: { x: pos.x, y: pos.y, z: pos.z },
      chassisQuat: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      wheels,
      rpm: car.drivetrain.rpm,
      speedKmh: car.speedKmh,
      gear: car.drivetrain.gearLabel(),
      throttle,
    };

    if (this.buffer.length >= this.maxFrames) this.buffer.shift();
    this.buffer.push(frame);
  }

  clear(): void {
    this.buffer.length = 0;
  }

  /** Frozen copy of the most recent `seconds` worth of frames. */
  snapshotLast(seconds: number, fixedDt = 1 / 60): ReplayFrame[] {
    const wanted = Math.min(this.buffer.length, Math.ceil(seconds / fixedDt));
    return this.buffer.slice(this.buffer.length - wanted);
  }

  get length(): number {
    return this.buffer.length;
  }
}
