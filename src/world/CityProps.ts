import * as THREE from 'three';
import type { BuiltTrack } from '../track/TrackBuilder';

/**
 * City-themed roadside props: a row of tall buildings on either side of the
 * track, plus streetlight poles every ~30 m along the inside edge of the
 * ribbon.
 *
 * Buildings are batched into three `InstancedMesh`es (one per colour pool)
 * so the entire skyline costs three draw calls. Heights vary via a seeded
 * sum-of-sines so the silhouette reads natural.
 */

const PROPS_PER_SIDE = 90;
const OFFSET_MIN = 9;
const OFFSET_MAX = 22;
const BUILDING_BASE_H = 8;
const BUILDING_VAR_H = 24;
const STREETLIGHT_STEP = 30;

interface Pool {
  color: number;
  count: number;
}

const POOLS: Pool[] = [
  { color: 0x4f5660, count: 0 }, // cool concrete
  { color: 0x645149, count: 0 }, // warm brick
  { color: 0x2a313c, count: 0 }, // dark glass
];

function makeWindowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  // Wall base.
  ctx.fillStyle = '#1a1f28';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Window grid: 6 columns × 16 rows. ~30% lit, rest dark.
  const cols = 6;
  const rows = 16;
  const cw = canvas.width / cols;
  const rh = canvas.height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = Math.random() < 0.32;
      ctx.fillStyle = lit ? '#ffe7a0' : '#0d1218';
      ctx.fillRect(
        c * cw + cw * 0.18,
        r * rh + rh * 0.18,
        cw * 0.64,
        rh * 0.45,
      );
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
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
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 0xffffff) / 0xffffff;
  };
}

export function scatterCityProps(
  scene: THREE.Scene,
  track: BuiltTrack,
  trackId: string,
): void {
  const rand = makePrng(hashStr(`${trackId}:city`));
  const centerline = track.centerline;
  if (centerline.length < 2) return;

  // First pass: pick raw building placements (xz + height + offset side)
  // by walking the centerline with PRNG-driven spacing.
  interface Place {
    x: number;
    z: number;
    halfWidth: number;
    halfDepth: number;
    height: number;
    yaw: number;
    pool: number;
  }
  const placements: Place[] = [];
  for (let side = 0; side < 2; side++) {
    let cursor = 0;
    const stride = (centerline.length - 1) / PROPS_PER_SIDE;
    while (cursor < centerline.length - 1) {
      cursor += stride * (0.7 + rand() * 0.7);
      const idx = Math.min(centerline.length - 1, Math.floor(cursor));
      const next = Math.min(centerline.length - 1, idx + 1);
      const cs = centerline[idx];
      const nx = centerline[next].x - cs.x;
      const nz = centerline[next].z - cs.z;
      const len = Math.hypot(nx, nz);
      if (len < 1e-3) continue;
      // Outward perpendicular (in the XZ plane).
      const px = -nz / len;
      const pz = nx / len;
      const sideSign = side === 0 ? 1 : -1;
      const dist = OFFSET_MIN + rand() * (OFFSET_MAX - OFFSET_MIN);
      const halfW = 3 + rand() * 4;
      const halfD = 3 + rand() * 4;
      const x = cs.x + sideSign * px * (cs.halfWidth + dist + halfW);
      const z = cs.z + sideSign * pz * (cs.halfWidth + dist + halfD);
      const height = BUILDING_BASE_H + rand() * BUILDING_VAR_H;
      const yaw = Math.atan2(nx, nz);
      placements.push({
        x,
        z,
        halfWidth: halfW,
        halfDepth: halfD,
        height,
        yaw,
        pool: Math.floor(rand() * POOLS.length),
      });
    }
  }

  // Second pass: tally per-pool counts, build InstancedMeshes, fill them.
  for (const p of POOLS) p.count = 0;
  for (const pl of placements) POOLS[pl.pool].count += 1;

  const windowTex = makeWindowTexture();
  const meshes: THREE.InstancedMesh[] = [];
  for (const pool of POOLS) {
    if (pool.count === 0) {
      meshes.push(null as unknown as THREE.InstancedMesh);
      continue;
    }
    // Use a unit BoxGeometry centred at origin — instance matrix supplies
    // both position and per-building scale. UVs map to the window canvas;
    // we'll let it wrap so different buildings get different lit windows.
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const mat = new THREE.MeshStandardMaterial({
      color: pool.color,
      roughness: 0.85,
      metalness: 0.05,
      map: windowTex,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, pool.count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }

  const used = [0, 0, 0];
  const tmpMat = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  for (const pl of placements) {
    const mesh = meshes[pl.pool];
    if (!mesh) continue;
    tmpPos.set(pl.x, pl.height / 2, pl.z);
    tmpQuat.setFromAxisAngle(UP, pl.yaw);
    tmpScale.set(pl.halfWidth, pl.height / 2, pl.halfDepth);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    mesh.setMatrixAt(used[pl.pool]++, tmpMat);
  }
  for (const mesh of meshes) if (mesh) mesh.instanceMatrix.needsUpdate = true;

  // --- Streetlights along the inside edge of the ribbon -------------------
  buildStreetlights(scene, centerline);

  // --- Ceiling lights inside any tunnel sections --------------------------
  buildTunnelCeilingLights(scene, centerline);
}

/**
 * Warm yellow ceiling lights for tunnel-flagged sections — a flat bulb disc
 * mounted on the tunnel ceiling every ~12 m, with a soft PointLight that
 * fills the surrounding tunnel volume. Almost invisible in day exposure but
 * clearly illuminates the tunnel walls at night.
 */
function buildTunnelCeilingLights(
  scene: THREE.Scene,
  centerline: Array<{ x: number; z: number; halfWidth: number; tunnel: boolean; topY: number }>,
): void {
  const TUNNEL_HEIGHT_M = 5.5; // must match TrackBuilder.buildTunnelGeometry
  const STEP_M = 12;
  const HANG_DOWN = 0.4; // bulb sits just below the ceiling
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff1c0,
    emissive: 0xffd58a,
    emissiveIntensity: 3.0,
    roughness: 0.35,
    toneMapped: true,
  });
  const bulbGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 12);
  let accum = STEP_M; // place first light a step in
  for (let i = 1; i < centerline.length; i++) {
    const a = centerline[i - 1];
    const b = centerline[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segLen = Math.hypot(dx, dz);
    if (segLen < 1e-3) continue;
    if (!(a.tunnel && b.tunnel)) {
      // Reset accumulator at tunnel boundaries so we don't drop a light
      // partly outside the tunnel.
      accum = STEP_M;
      continue;
    }
    accum += segLen;
    if (accum < STEP_M) continue;
    accum = 0;

    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const ceilingY = ((a.topY + b.topY) / 2) + TUNNEL_HEIGHT_M - HANG_DOWN;

    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(cx, ceilingY, cz);
    scene.add(bulb);

    const light = new THREE.PointLight(0xffd58a, 35, 18, 1.8);
    light.position.set(cx, ceilingY - 0.2, cz);
    scene.add(light);
  }
}

function buildStreetlights(
  scene: THREE.Scene,
  centerline: Array<{ x: number; z: number; halfWidth: number }>,
): void {
  if (centerline.length < 2) return;
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x202229,
    roughness: 0.55,
    metalness: 0.5,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe7a0,
    emissive: 0xffd58a,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  const POLE_HEIGHT = 5.2;
  const POLE_R = 0.09;
  let distance = 0;
  let nextDist = STREETLIGHT_STEP;
  let side: 1 | -1 = 1;
  for (let i = 1; i < centerline.length; i++) {
    const a = centerline[i - 1];
    const b = centerline[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segLen = Math.hypot(dx, dz);
    distance += segLen;
    if (distance < nextDist) continue;
    nextDist += STREETLIGHT_STEP;
    side = side === 1 ? -1 : 1;
    if (segLen < 1e-3) continue;
    const px = -dz / segLen;
    const pz = dx / segLen;
    const offset = a.halfWidth + 1.2;
    const baseX = a.x + side * px * offset;
    const baseZ = a.z + side * pz * offset;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(POLE_R, POLE_R, POLE_HEIGHT, 8),
      poleMat,
    );
    pole.position.set(baseX, POLE_HEIGHT / 2, baseZ);
    pole.castShadow = true;
    scene.add(pole);
    // Horizontal arm + bulb pointing toward the track.
    const armLen = 0.9;
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(armLen, 0.08, 0.08),
      poleMat,
    );
    arm.position.set(baseX - side * px * armLen * 0.5, POLE_HEIGHT - 0.15, baseZ - side * pz * armLen * 0.5);
    arm.rotation.y = Math.atan2(-side * px, -side * pz);
    scene.add(arm);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), bulbMat);
    bulb.position.set(baseX - side * px * armLen, POLE_HEIGHT - 0.25, baseZ - side * pz * armLen);
    scene.add(bulb);
  }
}
