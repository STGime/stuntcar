import * as THREE from 'three';
import type { Car } from '../vehicle/Car';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

type CameraMode = 'chase' | 'cockpit';

/**
 * Camera rig for M2.
 *
 * - "chase" (default): a smoothed spring-arm behind the car. Follows the car's
 *   yaw only, so it does NOT roll/flip during loops — keeps the view readable.
 * - "cockpit": a simple in-car view (a bonus here; the polished cockpit with
 *   dashboard arrives at M3/M4).
 *
 * Toggle with the `C` key (wired up in main.ts).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'chase';
  private snapNextUpdate = true;

  // scratch objects reused each frame to avoid per-frame allocation
  private readonly fwd = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 800);
    this.camera.position.set(0, 6, -12);
  }

  toggleView(): void {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    this.snapNextUpdate = true;
  }

  /** Call once per rendered frame. `dt` is real frame time in seconds. */
  update(car: Car, dt: number): void {
    const carObj = car.chassisView.object;
    const carPos = carObj.position;
    const carQuat = carObj.quaternion;

    if (this.mode === 'chase') {
      this.camera.up.copy(WORLD_UP);

      // Yaw-only forward direction (flatten onto the ground plane).
      this.fwd.set(0, 0, 1).applyQuaternion(carQuat);
      this.fwd.y = 0;
      if (this.fwd.lengthSq() < 1e-5) this.fwd.set(0, 0, 1);
      this.fwd.normalize();

      this.desired
        .copy(carPos)
        .addScaledVector(this.fwd, -8.5)
        .addScaledVector(WORLD_UP, 4.0);

      if (this.snapNextUpdate) {
        this.camera.position.copy(this.desired);
        this.snapNextUpdate = false;
      } else {
        // Frame-rate independent smoothing.
        const k = 1 - Math.exp(-7 * dt);
        this.camera.position.lerp(this.desired, k);
      }

      this.lookAt.copy(carPos).addScaledVector(WORLD_UP, 1.1);
      this.camera.lookAt(this.lookAt);
    } else {
      // Cockpit: rides with the car fully (rolls during loops).
      this.fwd.set(0, 0, 1).applyQuaternion(carQuat);
      this.camera.up.set(0, 1, 0).applyQuaternion(carQuat);
      this.desired.set(0, 0.55, 0.1).applyQuaternion(carQuat).add(carPos);
      this.camera.position.copy(this.desired);
      this.lookAt.copy(this.desired).addScaledVector(this.fwd, 10);
      this.camera.lookAt(this.lookAt);
      this.snapNextUpdate = true;
    }
  }
}
