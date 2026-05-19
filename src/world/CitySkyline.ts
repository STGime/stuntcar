import * as THREE from 'three';

/**
 * Distant city silhouette — a single ring of tall rectangular blocks at
 * ~420 m radius, rendered after the sky so it paints over the skybox.
 * Used in place of the mountain ridge on `theme: 'city'` tracks.
 *
 * Like the mountains, it relies on scene fog for atmospheric perspective
 * (skyline at the fog's far edge fades naturally toward the haze).
 */

const RING_RADIUS = 420;
const COUNT = 90;
const BASE_HEIGHT = 8;
const VAR_HEIGHT = 80;
const SEED = 7.42;

function silhouetteHeight(theta: number): number {
  const t = theta + SEED;
  const n =
    0.5 * Math.sin(t * 1.9) +
    0.32 * Math.sin(t * 3.7 + 0.6) +
    0.22 * Math.sin(t * 7.5 + 1.3) +
    0.14 * Math.sin(t * 13.1 + 2.1);
  return Math.max(0, Math.min(1, n * 0.5 + 0.5));
}

export function buildCitySkyline(scene: THREE.Scene): void {
  // We build the whole ring as ONE BufferGeometry with N rectangular block
  // silhouettes (each = 4 verts + 2 triangles), so it ships as a single
  // draw call. The block widths vary slightly with the noise so the
  // silhouette doesn't look like uniformly spaced teeth.
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < COUNT; i++) {
    const t0 = i / COUNT;
    const t1 = (i + 1) / COUNT;
    const a0 = t0 * Math.PI * 2;
    const a1 = t1 * Math.PI * 2;
    const x0 = Math.cos(a0) * RING_RADIUS;
    const z0 = Math.sin(a0) * RING_RADIUS;
    const x1 = Math.cos(a1) * RING_RADIUS;
    const z1 = Math.sin(a1) * RING_RADIUS;
    const peak = BASE_HEIGHT + silhouetteHeight(a0) * VAR_HEIGHT;
    const base = positions.length / 3;
    positions.push(x0, 0, z0, x0, peak, z0, x1, peak, z1, x1, 0, z1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color: 0x2a323d,
    fog: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
}
