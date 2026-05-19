import * as THREE from 'three';

/**
 * Falling snow effect: a `Points` cloud of ~2500 round flakes around the car.
 * Each flake has its own slow drift velocity in X and Z so the whole cloud
 * doesn't tip in a single direction, plus a small per-flake Y fall speed.
 * The mesh re-anchors to the car's XZ each frame.
 *
 * Visuals: a generated circular alpha-disc point texture; `NormalBlending`
 * so the white flakes stand out against either dark night-style backdrops
 * or pale winter skies without saturating to bloom.
 */

const COUNT = 2500;
const RANGE_XZ = 30;
const TOP_Y = 28;
const BOTTOM_Y = -2;
const FALL_SPEED_MIN = 1.8;
const FALL_SPEED_MAX = 3.6;
const DRIFT_AMP = 0.9; // m/s side-to-side max drift

export class Snow {
  private readonly mesh: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  /** Per-flake (fallSpeed, driftX, driftZ). */
  private readonly velocities: Float32Array;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(COUNT * 3);
    this.velocities = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      this.spawnFlake(i, true);
    }
    this.geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr);

    const tex = makeFlakeTexture();
    const mat = new THREE.PointsMaterial({
      map: tex,
      color: 0xf5f8ff,
      size: 0.32,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      alphaTest: 0.01,
      fog: true,
      toneMapped: false,
    });

    this.mesh = new THREE.Points(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** Reinitialise a flake. `freshSpawn` distributes Y across the full
   *  column on first frame; otherwise it puts the flake at the top so it
   *  falls fresh after going below ground. */
  private spawnFlake(i: number, freshSpawn: boolean): void {
    const o = i * 3;
    const x = (Math.random() - 0.5) * 2 * RANGE_XZ;
    const z = (Math.random() - 0.5) * 2 * RANGE_XZ;
    const y = freshSpawn
      ? BOTTOM_Y + Math.random() * (TOP_Y - BOTTOM_Y)
      : TOP_Y + Math.random() * 2;
    this.positions[o + 0] = x;
    this.positions[o + 1] = y;
    this.positions[o + 2] = z;
    this.velocities[o + 0] =
      FALL_SPEED_MIN + Math.random() * (FALL_SPEED_MAX - FALL_SPEED_MIN);
    this.velocities[o + 1] = (Math.random() - 0.5) * 2 * DRIFT_AMP;
    this.velocities[o + 2] = (Math.random() - 0.5) * 2 * DRIFT_AMP;
  }

  /** Per render frame: drift + fall + respawn + recenter on the car. */
  update(dt: number, carX: number, carZ: number): void {
    this.mesh.position.set(carX, 0, carZ);
    const pos = this.positions;
    const vel = this.velocities;
    for (let i = 0; i < COUNT; i++) {
      const o = i * 3;
      pos[o + 0] += vel[o + 1] * dt;
      pos[o + 1] -= vel[o + 0] * dt;
      pos[o + 2] += vel[o + 2] * dt;
      if (
        pos[o + 1] < BOTTOM_Y ||
        Math.abs(pos[o + 0]) > RANGE_XZ + 2 ||
        Math.abs(pos[o + 2]) > RANGE_XZ + 2
      ) {
        this.spawnFlake(i, false);
      }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

function makeFlakeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}
