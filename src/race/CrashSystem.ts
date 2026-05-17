import * as THREE from 'three';
import type { Car } from '../vehicle/Car';
import type { Race } from './Race';

/** Buffer below the track's lowest ribbon point before the kill plane fires. */
const KILL_PLANE_PAD = 8;
/** chassis_up · world_up below this counts as "tipped over" — covers being
 *  on the side (≳ 73°), on the roof corner, or fully inverted. Track banks
 *  are gentle (≤ 20°), so normal driving never gets near this threshold. */
const INVERTED_THRESHOLD = 0.3;
/** Sustained tipped time before triggering a wreck. Short enough that you
 *  can't sit stranded but long enough to ride out a brief lean in a corner
 *  or mid-air flip. */
const INVERTED_TRIGGER_SEC = 1.0;

export type CrashReason = 'killplane' | 'inverted';

/**
 * Pure crash detector. Fires `onCrash(reason)` once per wreck.
 *
 * It does NOT manage the wait-and-reset timing — that's the replay system's
 * job (the chassis tumble we see during a wreck IS the crash replay).
 * After the orchestrator finishes handling the crash (replay completes,
 * car teleported back), it must call `resolve()` to re-arm the detector.
 */
export class CrashSystem {
  state: 'normal' | 'wrecking' = 'normal';
  private invertedTimer = 0;
  private readonly killPlaneY: number;

  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(
    private readonly car: Car,
    private readonly race: Race,
    trackMinY: number,
    private readonly onCrash: (reason: CrashReason) => void,
  ) {
    this.killPlaneY = trackMinY - KILL_PLANE_PAD;
  }

  /** Per physics step. */
  update(dt: number): void {
    if (this.state !== 'normal') return;
    if (this.race.state !== 'racing') return;

    const t = this.car.chassisBody.translation();
    if (t.y < this.killPlaneY) {
      this.fire('killplane');
      return;
    }

    const r = this.car.chassisBody.rotation();
    this.tmpQuat.set(r.x, r.y, r.z, r.w);
    this.tmpUp.set(0, 1, 0).applyQuaternion(this.tmpQuat);
    if (this.tmpUp.y < INVERTED_THRESHOLD) {
      this.invertedTimer += dt;
      if (this.invertedTimer >= INVERTED_TRIGGER_SEC) {
        this.fire('inverted');
      }
    } else {
      this.invertedTimer = 0;
    }
  }

  /** Re-arm after the orchestrator has finished handling the crash. */
  resolve(): void {
    this.state = 'normal';
    this.invertedTimer = 0;
  }

  private fire(reason: CrashReason): void {
    this.state = 'wrecking';
    this.onCrash(reason);
  }
}
