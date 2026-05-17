import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Car } from '../vehicle/Car';
import type { Race } from './Race';

/** Seconds the chassis can stay off the track before auto-respawn. */
const OFFTRACK_GRACE_SEC = 5;
/** How far below the chassis to look for ground (max ray distance). */
const RAY_LENGTH = 25;

export type OffTrackState = 'on' | 'warning';

/**
 * Off-track countdown.
 *
 * Each physics step the detector casts a ray straight down from the chassis
 * and looks at the first collider it hits:
 *
 *   - Track collider → on-track, reset.
 *   - Anything else (or no hit at all) → off-track, accumulate countdown.
 *
 * When the countdown reaches `OFFTRACK_GRACE_SEC` the detector fires
 * `onTimeout()` so the orchestrator can respawn the car at the last passed
 * checkpoint. The countdown cancels if the player returns to the track.
 *
 * Skipped entirely outside `racing` state and when the chassis is wrecked —
 * those are CrashSystem's domain.
 */
export class OffTrackDetector {
  state: OffTrackState = 'on';
  countdownSec = 0;
  /** Fires when the integer seconds-left ticks down (5, 4, 3, 2, 1). */
  onTick: (secondsLeft: number) => void = () => {};
  private lastTickedSeconds = -1;

  constructor(
    private readonly car: Car,
    private readonly race: Race,
    private readonly world: RAPIER.World,
    private readonly trackCollider: RAPIER.Collider | null,
    private readonly isSuspended: () => boolean,
    private readonly onTimeout: () => void,
  ) {}

  /** Per fixed physics step. */
  update(dt: number): void {
    if (this.race.state !== 'racing' || this.isSuspended()) {
      this.reset();
      return;
    }

    if (this.isOnTrack()) {
      this.reset();
      return;
    }

    // Mid-jump over a gap: the ray finds no track below, but the chassis
    // is on a valid trajectory toward the landing ramp. Don't START a new
    // countdown until the wheels touch SOMETHING. (An already-running
    // countdown keeps ticking — if you were off-track before take-off,
    // you're not magically forgiven.)
    if (this.state === 'on' && this.car.airborne) {
      return;
    }

    if (this.state !== 'warning') {
      this.state = 'warning';
      this.countdownSec = 0;
      this.lastTickedSeconds = -1;
    }
    this.countdownSec += dt;

    const secondsLeft = Math.max(0, Math.ceil(OFFTRACK_GRACE_SEC - this.countdownSec));
    if (secondsLeft !== this.lastTickedSeconds) {
      this.lastTickedSeconds = secondsLeft;
      if (secondsLeft > 0) this.onTick(secondsLeft);
    }

    if (this.countdownSec >= OFFTRACK_GRACE_SEC) {
      this.onTimeout();
      this.reset();
    }
  }

  /** Seconds remaining (rounded up). Returns 0 when not in warning state. */
  secondsLeft(): number {
    if (this.state !== 'warning') return 0;
    return Math.max(0, Math.ceil(OFFTRACK_GRACE_SEC - this.countdownSec));
  }

  reset(): void {
    this.state = 'on';
    this.countdownSec = 0;
    this.lastTickedSeconds = -1;
  }

  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpFwd = new THREE.Vector3();
  private readonly tmpStart = { x: 0, y: 0, z: 0 };
  private readonly tmpDir = { x: 0, y: -1, z: 0 };

  private isOnTrack(): boolean {
    if (!this.trackCollider) return true; // nothing built — never warn

    const t = this.car.chassisBody.translation();
    const r = this.car.chassisBody.rotation();
    this.tmpQuat.set(r.x, r.y, r.z, r.w);
    this.tmpFwd.set(0, 0, 1).applyQuaternion(this.tmpQuat);

    // Cast three rays — chassis FRONT, CENTER, and REAR. If ANY finds the
    // track collider below, the chassis is at least partially on the
    // ribbon and we treat the whole car as on-track. This handles
    // straddling: when the chassis is over a 4-5 m gap, the chassis
    // center has no track below but the front (over the landing ramp)
    // and the rear (over the launch ramp) do.
    const half = 1.8; // a hair less than chassis half-length so the rays sit on the ramps, not over them
    for (const offset of [+half, 0, -half]) {
      this.tmpStart.x = t.x + this.tmpFwd.x * offset;
      this.tmpStart.y = t.y + this.tmpFwd.y * offset;
      this.tmpStart.z = t.z + this.tmpFwd.z * offset;
      const ray = new RAPIER.Ray(this.tmpStart, this.tmpDir);
      const hit = this.world.castRay(
        ray,
        RAY_LENGTH,
        true,
        undefined,
        undefined,
        this.car.chassisCollider,
        this.car.chassisBody,
      );
      if (hit && hit.collider.handle === this.trackCollider.handle) return true;
    }
    return false;
  }
}
