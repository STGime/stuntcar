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

  // Trauma-based camera shake (Squirrel Eiserloh's GDC approach).
  // `trauma` ∈ [0, 1]; per-frame offset = noise · trauma². Trauma decays
  // linearly so the shake settles in ~1 s after a big hit.
  private trauma = 0;
  private shakeTime = 0;
  private readonly shakeOffset = new THREE.Vector3();

  // Smoothed camera roll for cornering. We tilt the chase camera's `up`
  // vector slightly into the turn (proportional to lateral velocity) so
  // hard corners feel weightier. Capped at ~5.7° to keep the horizon
  // readable through banked sections.
  private roll = 0;
  private readonly rightVec = new THREE.Vector3();

  /** Player-settable behaviour. */
  rollEnabled = true;
  shakeEnabled = true;

  constructor(fovDeg = 62) {
    this.camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.1, 800);
    this.camera.position.set(0, 6, -12);
  }

  setFov(deg: number): void {
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }

  toggleView(): void {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    this.snapNextUpdate = true;
  }

  get isCockpit(): boolean {
    return this.mode === 'cockpit';
  }

  /** Add to the camera's trauma value (caps at 1). Trauma squared = shake amplitude. */
  addTrauma(amount: number): void {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Call once per rendered frame. `dt` is real frame time in seconds. */
  update(car: Car, dt: number): void {
    const carObj = car.chassisView.object;
    const carPos = carObj.position;
    const carQuat = carObj.quaternion;

    if (this.mode === 'chase') {
      // Lateral velocity from chassis = how hard we're cornering. Tilt
      // `up` slightly into the turn proportional to that, smoothed so a
      // brief wiggle doesn't shake the horizon.
      const linvel = car.chassisBody.linvel();
      this.rightVec.set(1, 0, 0).applyQuaternion(carQuat);
      const lateral =
        linvel.x * this.rightVec.x +
        linvel.y * this.rightVec.y +
        linvel.z * this.rightVec.z;
      const targetRoll = this.rollEnabled
        ? Math.max(-0.10, Math.min(0.10, -lateral * 0.012))
        : 0;
      const kRoll = 1 - Math.exp(-6 * dt);
      this.roll += (targetRoll - this.roll) * kRoll;

      // Yaw-only forward direction (flatten onto the ground plane).
      this.fwd.set(0, 0, 1).applyQuaternion(carQuat);
      this.fwd.y = 0;
      if (this.fwd.lengthSq() < 1e-5) this.fwd.set(0, 0, 1);
      this.fwd.normalize();

      // Apply the smoothed roll: rotate WORLD_UP around the (yaw-flattened)
      // forward axis. With forward flattened, this never adds pitch.
      this.camera.up.copy(WORLD_UP).applyAxisAngle(this.fwd, this.roll);

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

      // Apply trauma shake. Decay the trauma each frame so big hits fade
      // within ~1 second. Shake amplitude scales with trauma² so light
      // taps barely move the camera and big crashes really jolt it.
      if (this.trauma > 0) {
        this.shakeTime += dt;
        const t = this.trauma * this.trauma;
        const phase = this.shakeTime * 38; // ~6 Hz of jitter
        this.shakeOffset.set(
          Math.sin(phase * 1.3) * 0.45 * t,
          Math.sin(phase * 1.7 + 1.1) * 0.30 * t,
          Math.sin(phase * 1.1 + 2.4) * 0.45 * t,
        );
        this.camera.position.add(this.shakeOffset);
        this.trauma = Math.max(0, this.trauma - dt * 1.1);
      }
    } else {
      // Cockpit: rides with the car fully (rolls during loops). Camera
      // sits at driver-eye height, slightly behind centre — high enough
      // to see comfortably over the hood toward the road ahead.
      this.fwd.set(0, 0, 1).applyQuaternion(carQuat);
      this.camera.up.set(0, 1, 0).applyQuaternion(carQuat);
      this.desired.set(0, 0.85, -0.15).applyQuaternion(carQuat).add(carPos);
      this.camera.position.copy(this.desired);
      this.lookAt.copy(this.desired).addScaledVector(this.fwd, 10);
      this.camera.lookAt(this.lookAt);
      this.snapNextUpdate = true;
    }
  }
}
