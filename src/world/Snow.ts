import * as THREE from 'three';
import type { CenterlineSample } from '../track/TrackBuilder';

/**
 * Falling snow effect: a `Points` cloud of ~2500 round flakes around the car.
 * Each flake has its own slow drift velocity in X and Z so the whole cloud
 * doesn't tip in a single direction, plus a small per-flake Y fall speed.
 * The mesh re-anchors to the car's XZ each frame.
 *
 * The cloud is a low-altitude band in WORLD space (TOP_Y…BOTTOM_Y) — drive
 * up onto a high section of track or a jump apex and the snow stays below
 * you, like a real weather layer.
 *
 * Falling flakes are also culled by a tunnel mask built from the track's
 * tunnel-flagged centerline samples: a flake that drops into a tunnel's XZ
 * footprint AND is below its ceiling Y is respawned at the top, so the
 * tunnel interior stays dry.
 *
 * Visuals: a generated circular alpha-disc point texture; `NormalBlending`
 * so the white flakes stand out against either dark night-style backdrops
 * or pale winter skies without saturating to bloom.
 */

const COUNT = 2500;
const RANGE_XZ = 30;
const TOP_Y = 8;     // cloud top in WORLD Y — high track sections poke above
const BOTTOM_Y = -1; // cloud floor (just below the ground plane)
const FALL_SPEED_MIN = 1.8;
const FALL_SPEED_MAX = 3.6;
const DRIFT_AMP = 0.9; // m/s side-to-side max drift
/** Tunnel ceiling height above the ribbon top. Must match the value in
 *  TrackBuilder.buildTunnelGeometry. */
const TUNNEL_HEIGHT_M = 5.5;

interface TunnelSample {
  x: number;
  z: number;
  ceilingY: number;
  /** Squared half-width of the tunnel at this sample (with a small margin). */
  r2: number;
}

export class Snow {
  private readonly mesh: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  /** Per-flake (fallSpeed, driftX, driftZ). */
  private readonly velocities: Float32Array;
  private readonly tunnels: TunnelSample[] = [];
  /** Cheap AABB cull before the per-sample tunnel test. */
  private readonly tunnelAabb: { minX: number; maxX: number; minZ: number; maxZ: number } | null;

  constructor(scene: THREE.Scene, centerline: readonly CenterlineSample[] = []) {
    this.positions = new Float32Array(COUNT * 3);
    this.velocities = new Float32Array(COUNT * 3);
    // Build the tunnel mask from any centerline samples flagged tunnel.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of centerline) {
      if (!s.tunnel) continue;
      const r = s.halfWidth + 1.0; // small margin so tunnel walls feel solid
      this.tunnels.push({
        x: s.x,
        z: s.z,
        ceilingY: s.topY + TUNNEL_HEIGHT_M,
        r2: r * r,
      });
      if (s.x - r < minX) minX = s.x - r;
      if (s.x + r > maxX) maxX = s.x + r;
      if (s.z - r < minZ) minZ = s.z - r;
      if (s.z + r > maxZ) maxZ = s.z + r;
    }
    this.tunnelAabb =
      this.tunnels.length > 0 ? { minX, maxX, minZ, maxZ } : null;

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
      : TOP_Y + Math.random() * 1.5;
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
    const aabb = this.tunnelAabb;
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
        continue;
      }
      // Tunnel mask: if this flake's WORLD xz is inside a tunnel footprint
      // AND its Y is below the tunnel ceiling, the tunnel roof is blocking
      // it — respawn at the top. Cheap AABB cull first.
      if (aabb !== null) {
        const wx = carX + pos[o + 0];
        const wz = carZ + pos[o + 2];
        if (wx >= aabb.minX && wx <= aabb.maxX && wz >= aabb.minZ && wz <= aabb.maxZ) {
          const wy = pos[o + 1]; // mesh.position.y is 0 → world Y = local Y
          for (const t of this.tunnels) {
            if (wy >= t.ceilingY) continue;
            const dx = wx - t.x;
            const dz = wz - t.z;
            if (dx * dx + dz * dz < t.r2) {
              this.spawnFlake(i, false);
              break;
            }
          }
        }
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
