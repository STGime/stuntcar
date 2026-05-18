import * as THREE from 'three';

/**
 * Falling rain effect: a `LineSegments` cloud of ~2000 short vertical streaks
 * around the car. Each drop is two vertices (top + bottom) drawn as a thin
 * line. Each render frame we advance both vertices downward; drops that
 * fall below the floor are respawned with a fresh XZ at the top of the
 * cloud.
 *
 * The whole mesh is re-anchored to the car's XZ each frame so the rain
 * volume always wraps the player. Sketchy in spirit but matches what every
 * arcade racer ships.
 */

const COUNT = 2000;
const RANGE_XZ = 30;
const TOP_Y = 28;
const BOTTOM_Y = -2;
const DROP_LEN = 0.55;
const FALL_SPEED = 16; // m/s

export class Rain {
  private readonly mesh: THREE.LineSegments;
  private readonly geo: THREE.BufferGeometry;
  private readonly positions: Float32Array;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) {
      const x = (Math.random() - 0.5) * 2 * RANGE_XZ;
      const z = (Math.random() - 0.5) * 2 * RANGE_XZ;
      const y = BOTTOM_Y + Math.random() * (TOP_Y - BOTTOM_Y);
      const o = i * 6;
      // Top of streak.
      this.positions[o + 0] = x;
      this.positions[o + 1] = y + DROP_LEN;
      this.positions[o + 2] = z;
      // Bottom of streak.
      this.positions[o + 3] = x;
      this.positions[o + 4] = y;
      this.positions[o + 5] = z;
    }
    this.geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr);

    const mat = new THREE.LineBasicMaterial({
      color: 0xb6c4d6,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    });

    this.mesh = new THREE.LineSegments(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** Per render frame: fall + respawn + recenter on the car. */
  update(dt: number, carX: number, carZ: number): void {
    this.mesh.position.set(carX, 0, carZ);
    const fall = FALL_SPEED * dt;
    const arr = this.positions;
    for (let i = 0; i < COUNT; i++) {
      const o = i * 6;
      arr[o + 1] -= fall;
      arr[o + 4] -= fall;
      if (arr[o + 4] < BOTTOM_Y) {
        const x = (Math.random() - 0.5) * 2 * RANGE_XZ;
        const z = (Math.random() - 0.5) * 2 * RANGE_XZ;
        arr[o + 0] = x;
        arr[o + 1] = TOP_Y + DROP_LEN;
        arr[o + 2] = z;
        arr[o + 3] = x;
        arr[o + 4] = TOP_Y;
        arr[o + 5] = z;
      }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
