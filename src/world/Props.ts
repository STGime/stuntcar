import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { BuiltTrack } from '../track/TrackBuilder';

/**
 * Roadside props (low-poly pines, boulders, bushes) scattered around each
 * track to fill the empty grass beside the ribbon.
 *
 * The scatter is **seeded by track id** so the layout is stable per-track
 * across reloads. Each candidate XZ is rejected if it sits within
 * `TRACK_CLEARANCE` of any ribbon centerline sample (accounting for the
 * per-sample half-width). The pickup pass also keeps a clear ring around
 * the spawn so the 3-2-1-GO view isn't obstructed.
 *
 * Performance: a few hundred props share four InstancedMeshes total, so
 * draw-call cost is negligible. Props are visual-only — no colliders, so
 * the car will pass through them harmlessly.
 */

const PROP_COUNT = 220;
const SCATTER_MIN_R = 18;     // metres from spawn — keep a clear ring
const SCATTER_MAX_R = 230;    // outer fall-off
const TRACK_CLEARANCE = 5.5;  // min XZ distance from the ribbon edge

interface SceneRand {
  rand: () => number;
  /** Place a candidate that has been verified clear of the track. */
  candidates: THREE.Vector3[];
}

function hashStr(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function makePrng(seed: number): () => number {
  let s = seed === 0 ? 1 : seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0xffffff) / 0xffffff;
  };
}

export function scatterRoadsideProps(
  scene: THREE.Scene,
  _world: RAPIER.World,
  track: BuiltTrack,
  trackId: string,
): void {
  const rand = makePrng(hashStr(trackId));
  const spawn = track.spawn.position;
  const candidates: THREE.Vector3[] = [];
  const centerline = track.centerline;
  if (centerline.length === 0) return;

  /** Returns the squared XZ distance from (x, z) to the ribbon surface
   *  (closest centerline sample, minus per-sample half-width). Negative
   *  means the point is over the ribbon. */
  const distToRibbonSurface = (x: number, z: number): number => {
    let best = Infinity;
    let bestHalf = 0;
    for (let i = 0; i < centerline.length; i++) {
      const s = centerline[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < best) {
        best = dSq;
        bestHalf = s.halfWidth;
      }
    }
    return Math.sqrt(best) - bestHalf;
  };

  let attempts = 0;
  const maxAttempts = PROP_COUNT * 12;
  while (candidates.length < PROP_COUNT && attempts < maxAttempts) {
    attempts++;
    const angle = rand() * Math.PI * 2;
    // Bias slightly outward so the ring near the track has some breathing room.
    const r = SCATTER_MIN_R + Math.sqrt(rand()) * (SCATTER_MAX_R - SCATTER_MIN_R);
    const x = spawn.x + Math.cos(angle) * r;
    const z = spawn.z + Math.sin(angle) * r;

    if (distToRibbonSurface(x, z) < TRACK_CLEARANCE) continue;

    candidates.push(new THREE.Vector3(x, 0, z));
  }

  if (candidates.length === 0) return;

  // Mix: ~55 % pines, ~22 % boulders, ~23 % bushes.
  const treeN = Math.floor(candidates.length * 0.55);
  const boulderN = Math.floor(candidates.length * 0.22);
  const ctx: SceneRand = { rand, candidates };
  buildPines(scene, ctx, 0, treeN);
  buildBoulders(scene, ctx, treeN, treeN + boulderN);
  buildBushes(scene, ctx, treeN + boulderN, candidates.length);
}

function buildPines(
  scene: THREE.Scene,
  ctx: SceneRand,
  fromIdx: number,
  toIdx: number,
): void {
  const count = toIdx - fromIdx;
  if (count <= 0) return;

  // Trunk: short tapered cylinder, low segments. Centred so y=0 sits at base.
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.5, 6);
  trunkGeo.translate(0, 0.75, 0);
  // Canopy: cone above trunk top. A pair of stacked cones reads as more
  // organic than a single tall cone, but for instancing simplicity we use one.
  const canopyGeo = new THREE.ConeGeometry(1.05, 2.6, 7);
  canopyGeo.translate(0, 0.75 + 0.75 + 1.3, 0);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4a3320,
    roughness: 0.95,
    flatShading: true,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x2c5e2e,
    roughness: 0.85,
    flatShading: true,
  });

  const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, count);
  trunk.castShadow = true;
  canopy.castShadow = true;
  trunk.receiveShadow = true;
  canopy.receiveShadow = true;

  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < count; i++) {
    const p = ctx.candidates[fromIdx + i];
    const scale = 0.85 + ctx.rand() * 0.7; // 0.85..1.55 — canopy stays inside the clearance budget
    const yaw = ctx.rand() * Math.PI * 2;
    pos.set(p.x, p.y, p.z);
    quat.setFromAxisAngle(UP, yaw);
    scl.set(scale, scale, scale);
    mat.compose(pos, quat, scl);
    trunk.setMatrixAt(i, mat);
    canopy.setMatrixAt(i, mat);
  }
  trunk.instanceMatrix.needsUpdate = true;
  canopy.instanceMatrix.needsUpdate = true;
  scene.add(trunk);
  scene.add(canopy);
}

function buildBoulders(
  scene: THREE.Scene,
  ctx: SceneRand,
  fromIdx: number,
  toIdx: number,
): void {
  const count = toIdx - fromIdx;
  if (count <= 0) return;

  // Icosahedron with detail 0 — 20 chunky triangles, perfect low-poly rock.
  const geo = new THREE.IcosahedronGeometry(0.6, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x77716a,
    roughness: 0.95,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const p = ctx.candidates[fromIdx + i];
    // Boulders sit half-buried for that "always been there" feel.
    const scale = 0.5 + ctx.rand() * 1.4; // 0.5..1.9
    const flatten = 0.55 + ctx.rand() * 0.35;
    const yaw = ctx.rand() * Math.PI * 2;
    const tilt = (ctx.rand() - 0.5) * 0.6;
    pos.set(p.x, p.y + scale * 0.18, p.z);
    quat.setFromEuler(new THREE.Euler(tilt, yaw, tilt * 0.4));
    scl.set(scale, scale * flatten, scale);
    m.compose(pos, quat, scl);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

function buildBushes(
  scene: THREE.Scene,
  ctx: SceneRand,
  fromIdx: number,
  toIdx: number,
): void {
  const count = toIdx - fromIdx;
  if (count <= 0) return;

  // Low-poly icosahedron with slight subdivision so the silhouette reads as
  // "round shrub" rather than "rock pile".
  const geo = new THREE.IcosahedronGeometry(0.7, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3c6f33,
    roughness: 0.9,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const p = ctx.candidates[fromIdx + i];
    const scale = 0.6 + ctx.rand() * 0.7; // 0.6..1.3
    const yaw = ctx.rand() * Math.PI * 2;
    pos.set(p.x, p.y + scale * 0.25, p.z);
    quat.setFromAxisAngle(UP, yaw);
    scl.set(scale, scale * 0.75, scale);
    m.compose(pos, quat, scl);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}
