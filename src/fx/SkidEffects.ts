import * as THREE from 'three';

/**
 * Tire skid marks + smoke puffs.
 *
 * Both effects share the same trigger: a wheel is in contact with the ground
 * AND the chassis is sliding hard enough that the tire would lose grip
 * (heavy braking or aggressive cornering). For each qualifying wheel each
 * physics step we:
 *
 *   - Stamp a small dark quad (≈ 30 cm × 14 cm) on the ground at the wheel
 *     contact, oriented along the chassis forward axis. Skid marks fade out
 *     linearly over `MARK_LIFETIME_SEC`.
 *   - Emit a soft grey puff sprite slightly above the contact, expanding +
 *     fading via Points + custom ShaderMaterial.
 *
 * Implementation is a fixed-size ring buffer per effect — when the buffer
 * wraps, the oldest slot is silently overwritten. Mesh + Points are added
 * to the scene once at construction and never created/destroyed afterward,
 * so there's no GC churn during a race.
 */

const MARK_CAPACITY = 600;
const MARK_LIFETIME_SEC = 6.0;
const MARK_HALF_LEN = 0.18;
const MARK_HALF_WID = 0.075;

const SMOKE_CAPACITY = 240;
const SMOKE_LIFETIME_SEC = 1.4;
const SMOKE_BASE_PIXEL_SIZE = 38;

export class SkidEffects {
  private elapsed = 0;

  // ---- Skid marks ---------------------------------------------------------
  private readonly markGeo: THREE.BufferGeometry;
  private readonly markPosAttr: THREE.Float32BufferAttribute;
  private readonly markSpawnAttr: THREE.Float32BufferAttribute;
  private markIndex = 0;
  private readonly markTimeUniform = { value: 0 };

  // ---- Smoke puffs --------------------------------------------------------
  private readonly smokeGeo: THREE.BufferGeometry;
  private readonly smokePosAttr: THREE.Float32BufferAttribute;
  private readonly smokeSpawnAttr: THREE.Float32BufferAttribute;
  private readonly smokeSizeAttr: THREE.Float32BufferAttribute;
  private readonly smokeColorAttr: THREE.Float32BufferAttribute;
  private smokeIndex = 0;
  private readonly smokeTimeUniform = { value: 0 };
  // Tint constants for the two surface types. Values are mild HDR so they
  // stay readable against both bright day and dark night backgrounds when
  // composited additively.
  private static readonly RUBBER_COLOR: [number, number, number] = [1.05, 1.0, 0.95];
  private static readonly DIRT_COLOR: [number, number, number] = [1.1, 0.78, 0.45];

  // Scratch vectors so we don't allocate per emit.
  private readonly tmpFwd = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // -------- Skid marks: one mesh with N*4 verts, written as a ring -----
    const markPos = new Float32Array(MARK_CAPACITY * 4 * 3);
    const markSpawn = new Float32Array(MARK_CAPACITY * 4);
    const markIdx = new Uint32Array(MARK_CAPACITY * 6);
    // Pre-fill spawn times to a large negative so unwritten slots are fully
    // faded out from the very first frame.
    for (let i = 0; i < markSpawn.length; i++) markSpawn[i] = -1000;
    // Build the index buffer once; each quad is two triangles.
    for (let i = 0; i < MARK_CAPACITY; i++) {
      const v = i * 4;
      const o = i * 6;
      markIdx[o + 0] = v + 0;
      markIdx[o + 1] = v + 1;
      markIdx[o + 2] = v + 2;
      markIdx[o + 3] = v + 0;
      markIdx[o + 4] = v + 2;
      markIdx[o + 5] = v + 3;
    }
    this.markPosAttr = new THREE.Float32BufferAttribute(markPos, 3);
    this.markPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.markSpawnAttr = new THREE.Float32BufferAttribute(markSpawn, 1);
    this.markSpawnAttr.setUsage(THREE.DynamicDrawUsage);

    this.markGeo = new THREE.BufferGeometry();
    this.markGeo.setAttribute('position', this.markPosAttr);
    this.markGeo.setAttribute('aSpawn', this.markSpawnAttr);
    this.markGeo.setIndex(new THREE.BufferAttribute(markIdx, 1));

    const markMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.markTimeUniform,
        uLifetime: { value: MARK_LIFETIME_SEC },
      },
      vertexShader: `
        attribute float aSpawn;
        varying float vAge;
        void main() {
          vAge = aSpawn;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uLifetime;
        varying float vAge;
        void main() {
          float age = uTime - vAge;
          if (age < 0.0 || age > uLifetime) discard;
          float a = 1.0 - age / uLifetime;
          gl_FragColor = vec4(0.05, 0.05, 0.06, a * 0.72);
        }
      `,
    });

    const markMesh = new THREE.Mesh(this.markGeo, markMat);
    markMesh.frustumCulled = false;
    markMesh.renderOrder = 0.5; // above ground, below props
    scene.add(markMesh);

    // -------- Smoke puffs: a Points cloud with per-point spawn + size ----
    const smokePos = new Float32Array(SMOKE_CAPACITY * 3);
    const smokeSpawn = new Float32Array(SMOKE_CAPACITY);
    const smokeSize = new Float32Array(SMOKE_CAPACITY);
    const smokeColor = new Float32Array(SMOKE_CAPACITY * 3);
    for (let i = 0; i < SMOKE_CAPACITY; i++) smokeSpawn[i] = -1000;

    this.smokePosAttr = new THREE.Float32BufferAttribute(smokePos, 3);
    this.smokePosAttr.setUsage(THREE.DynamicDrawUsage);
    this.smokeSpawnAttr = new THREE.Float32BufferAttribute(smokeSpawn, 1);
    this.smokeSpawnAttr.setUsage(THREE.DynamicDrawUsage);
    this.smokeSizeAttr = new THREE.Float32BufferAttribute(smokeSize, 1);
    this.smokeSizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.smokeColorAttr = new THREE.Float32BufferAttribute(smokeColor, 3);
    this.smokeColorAttr.setUsage(THREE.DynamicDrawUsage);

    this.smokeGeo = new THREE.BufferGeometry();
    this.smokeGeo.setAttribute('position', this.smokePosAttr);
    this.smokeGeo.setAttribute('aSpawn', this.smokeSpawnAttr);
    this.smokeGeo.setAttribute('aSize', this.smokeSizeAttr);
    this.smokeGeo.setAttribute('aColor', this.smokeColorAttr);
    this.smokeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const smokeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Additive so puffs always brighten the framebuffer — guarantees
      // visibility under the night preset's dark exposure.
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.smokeTimeUniform,
        uLifetime: { value: SMOKE_LIFETIME_SEC },
        uPixelScale: { value: SMOKE_BASE_PIXEL_SIZE },
      },
      vertexShader: `
        attribute float aSpawn;
        attribute float aSize;
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uLifetime;
        uniform float uPixelScale;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float age = uTime - aSpawn;
          float t = clamp(age / uLifetime, 0.0, 1.0);
          // Expand + decay quickly.
          float growth = 1.0 + t * 2.4;
          float alpha = (1.0 - t) * (1.0 - t);
          vAlpha = alpha * step(0.0, age);
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Size shrinks with depth so distant puffs don't dominate.
          gl_PointSize = uPixelScale * aSize * growth * (50.0 / max(-mv.z, 1.0));
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          // Soft radial falloff for the puff.
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(uv, uv);
          if (r2 > 1.0) discard;
          float soft = smoothstep(1.0, 0.0, r2);
          gl_FragColor = vec4(vColor, vAlpha * soft * 0.55);
        }
      `,
    });

    const smokePoints = new THREE.Points(this.smokeGeo, smokeMat);
    smokePoints.frustumCulled = false;
    smokePoints.renderOrder = 1.2;
    scene.add(smokePoints);
  }

  /** Per-render frame: advance shader time so the fades animate. */
  update(dt: number): void {
    this.elapsed += dt;
    this.markTimeUniform.value = this.elapsed;
    this.smokeTimeUniform.value = this.elapsed;
  }

  /**
   * Stamp a skid mark + spawn a smoke puff at a wheel's contact point.
   *
   * @param contact World-space position of the wheel's ground contact.
   * @param chassisQuat World rotation of the chassis (forward axis defines mark direction).
   * @param intensity 0..1 — scales smoke opacity / puff size.
   */
  private readonly tmpQuat = new THREE.Quaternion();

  emit(
    contact: { x: number; y: number; z: number },
    chassisQuat: { x: number; y: number; z: number; w: number },
    intensity: number,
  ): void {
    // --- Lay down a skid mark quad on the ground -------------------------
    this.tmpQuat.set(chassisQuat.x, chassisQuat.y, chassisQuat.z, chassisQuat.w);
    this.tmpFwd.set(0, 0, 1).applyQuaternion(this.tmpQuat);
    // Flatten to ground plane so the mark stays horizontal even when the
    // chassis is pitched up a ramp.
    this.tmpFwd.y = 0;
    if (this.tmpFwd.lengthSq() < 1e-5) this.tmpFwd.set(0, 0, 1);
    this.tmpFwd.normalize();

    this.tmpUp.set(0, 1, 0);
    this.tmpRight.copy(this.tmpFwd).cross(this.tmpUp).normalize();

    // 0.02 m lift to dodge z-fighting with the ribbon top.
    const cx = contact.x + this.tmpUp.x * 0.02;
    const cy = contact.y + this.tmpUp.y * 0.02;
    const cz = contact.z + this.tmpUp.z * 0.02;

    const fx = this.tmpFwd.x * MARK_HALF_LEN;
    const fz = this.tmpFwd.z * MARK_HALF_LEN;
    const rx = this.tmpRight.x * MARK_HALF_WID;
    const rz = this.tmpRight.z * MARK_HALF_WID;

    const slot = this.markIndex;
    this.markIndex = (this.markIndex + 1) % MARK_CAPACITY;
    const baseVert = slot * 4;
    const posArr = this.markPosAttr.array as Float32Array;
    const spawnArr = this.markSpawnAttr.array as Float32Array;

    // 4 corners: back-left, back-right, front-right, front-left
    const v0 = baseVert * 3;
    posArr[v0 + 0] = cx - fx - rx;
    posArr[v0 + 1] = cy;
    posArr[v0 + 2] = cz - fz - rz;
    posArr[v0 + 3] = cx - fx + rx;
    posArr[v0 + 4] = cy;
    posArr[v0 + 5] = cz - fz + rz;
    posArr[v0 + 6] = cx + fx + rx;
    posArr[v0 + 7] = cy;
    posArr[v0 + 8] = cz + fz + rz;
    posArr[v0 + 9] = cx + fx - rx;
    posArr[v0 + 10] = cy;
    posArr[v0 + 11] = cz + fz - rz;

    spawnArr[baseVert + 0] = this.elapsed;
    spawnArr[baseVert + 1] = this.elapsed;
    spawnArr[baseVert + 2] = this.elapsed;
    spawnArr[baseVert + 3] = this.elapsed;

    // updateRange would let us upload only the dirty span, but the buffers
    // are small enough that full re-upload each frame is fine.
    this.markPosAttr.needsUpdate = true;
    this.markSpawnAttr.needsUpdate = true;

    // --- Spawn a tire-smoke puff ----------------------------------------
    this.spawnPuff(contact, 0.25, 0.6 + intensity * 0.9, SkidEffects.RUBBER_COLOR);
  }

  /**
   * Brown dust puff at a wheel contact — emitted when the wheel is touching
   * dirt/grass rather than tarmac. No skid mark (rubber wouldn't streak on
   * dirt the same way), just a kicked-up cloud.
   */
  emitDust(
    contact: { x: number; y: number; z: number },
    intensity: number,
  ): void {
    this.spawnPuff(
      contact,
      0.18,
      0.55 + Math.min(1, intensity) * 0.7,
      SkidEffects.DIRT_COLOR,
    );
  }

  private spawnPuff(
    contact: { x: number; y: number; z: number },
    yOffset: number,
    size: number,
    color: readonly [number, number, number],
  ): void {
    const slot = this.smokeIndex;
    this.smokeIndex = (this.smokeIndex + 1) % SMOKE_CAPACITY;
    const sp = this.smokePosAttr.array as Float32Array;
    const ss = this.smokeSpawnAttr.array as Float32Array;
    const sz = this.smokeSizeAttr.array as Float32Array;
    const sc = this.smokeColorAttr.array as Float32Array;
    sp[slot * 3 + 0] = contact.x;
    sp[slot * 3 + 1] = contact.y + yOffset;
    sp[slot * 3 + 2] = contact.z;
    ss[slot] = this.elapsed;
    sz[slot] = size;
    sc[slot * 3 + 0] = color[0];
    sc[slot * 3 + 1] = color[1];
    sc[slot * 3 + 2] = color[2];
    this.smokePosAttr.needsUpdate = true;
    this.smokeSpawnAttr.needsUpdate = true;
    this.smokeSizeAttr.needsUpdate = true;
    this.smokeColorAttr.needsUpdate = true;
  }
}
