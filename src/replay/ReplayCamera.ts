import * as THREE from 'three';

/**
 * Cinematic camera for `ReplayPlayer`. Slow horizontal orbit around the
 * target with a slight rise — readable for crash + jump replays without
 * any extra plumbing. M10 can swap in tracking / chase / dolly shots.
 */
export class ReplayCamera {
  readonly camera: THREE.PerspectiveCamera;
  private angle = 0;

  private readonly tmpLook = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 800);
  }

  /** Reset orbit phase. Slight randomisation gives crash replays variety. */
  reset(initialAngleRad: number = Math.PI * (0.4 + Math.random() * 0.5)): void {
    this.angle = initialAngleRad;
  }

  /** Per render frame. `targetPos` is the (already-replayed) chassis position. */
  update(targetPos: THREE.Vector3, frameDt: number): void {
    this.angle += frameDt * 0.35; // ≈ 20°/s
    const dist = 16;
    const height = 5.5;
    const cx = targetPos.x + Math.cos(this.angle) * dist;
    const cz = targetPos.z + Math.sin(this.angle) * dist;
    this.camera.position.set(cx, targetPos.y + height, cz);
    this.tmpLook.set(targetPos.x, targetPos.y + 0.8, targetPos.z);
    this.camera.lookAt(this.tmpLook);
  }
}
