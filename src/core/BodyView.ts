import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * Binds a Rapier rigid body to a Three.js object and smooths rendering.
 *
 * Physics runs on a fixed step that rarely matches the display refresh rate,
 * so we keep the previous and current physics transforms and `slerp`/`lerp`
 * between them by the render `alpha`. Without this, motion visibly stutters.
 *
 * Usage per frame:
 *   - after `world.step()`  -> `capture()`
 *   - on render             -> `apply(alpha)`
 */
export class BodyView {
  readonly object: THREE.Object3D;
  private readonly body: RAPIER.RigidBody;

  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly currRot = new THREE.Quaternion();

  constructor(body: RAPIER.RigidBody, object: THREE.Object3D) {
    this.body = body;
    this.object = object;

    const t = body.translation();
    const r = body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);

    this.object.position.copy(this.currPos);
    this.object.quaternion.copy(this.currRot);
  }

  /** Snapshot the latest physics transform. Call once after each physics step. */
  capture(): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);

    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }

  /** Write the interpolated transform onto the Three.js object. */
  apply(alpha: number): void {
    this.object.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.object.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
  }

  get rigidBody(): RAPIER.RigidBody {
    return this.body;
  }
}
