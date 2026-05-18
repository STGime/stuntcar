import * as THREE from 'three';

/**
 * Distant mountain silhouette rings.
 *
 * Three concentric ridge ribbons at different radii. Each uses its own
 * seed + noise frequency so peaks don't align, and scene fog (120 → 480 m)
 * naturally hazes the farther ribbons more — giving real atmospheric
 * perspective for free. The result is a layered silhouette with depth
 * instead of one flat painted backdrop.
 *
 * Decoration only: no collider, no per-frame work.
 */

interface RingSpec {
  radius: number;
  baseHeight: number;
  peakAmp: number;
  /** Phase shift fed into the sum-of-sines so each ring has its own peaks. */
  seed: number;
  /** Hex tint. Closer rings darker, farther rings lighter so they read
   *  cleanly even before fog has had a chance to blend. */
  color: number;
  /** Front-most rings paint over the rings behind them. */
  renderOrder: number;
}

const RINGS: RingSpec[] = [
  // Furthest ridge: pale, low amplitude, smoothest profile.
  {
    radius: 440,
    baseHeight: 22,
    peakAmp: 52,
    seed: 0.31,
    color: 0x6b7787,
    renderOrder: 1,
  },
  // Mid ridge: medium amplitude, rougher silhouette.
  {
    radius: 360,
    baseHeight: 14,
    peakAmp: 48,
    seed: 2.73,
    color: 0x4f5b6a,
    renderOrder: 2,
  },
  // Near ridge: tallest individual spikes but lowest baseline so valleys
  // dip toward the ground and let the back layers peek through.
  {
    radius: 270,
    baseHeight: 4,
    peakAmp: 42,
    seed: 5.11,
    color: 0x39424f,
    renderOrder: 3,
  },
];

const ANGULAR_STEPS = 192;

/** Sum-of-sines pseudo-noise — perlin-ish ridge without bringing in a noise lib. */
function ridgeHeight(theta: number, seed: number): number {
  const t = theta + seed;
  const n =
    0.55 * Math.sin(t * 1.7) +
    0.35 * Math.sin(t * 3.1 + 1.7) +
    0.20 * Math.sin(t * 6.3 + 0.9) +
    0.12 * Math.sin(t * 11.9 + 2.3);
  // Map roughly [-1.2, 1.2] → [0, 1]
  return Math.max(0, Math.min(1, n * 0.5 + 0.5));
}

function buildRing(scene: THREE.Scene, spec: RingSpec): void {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2;
    const x = Math.cos(angle) * spec.radius;
    const z = Math.sin(angle) * spec.radius;
    const peak = spec.baseHeight + ridgeHeight(angle, spec.seed) * spec.peakAmp;
    positions.push(x, 0, z);     // base
    positions.push(x, peak, z);  // crest
  }

  for (let i = 0; i < ANGULAR_STEPS; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, d, a, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color: spec.color,
    fog: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // Render after the sky dome; near rings render after far rings so they
  // can paint over them where they overlap.
  mesh.renderOrder = spec.renderOrder;
  scene.add(mesh);
}

export function buildMountains(scene: THREE.Scene): void {
  for (const ring of RINGS) buildRing(scene, ring);
}
