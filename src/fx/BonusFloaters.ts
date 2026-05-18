import * as THREE from 'three';

/**
 * Arcade-style "+X.Xs" bonus floaters that pop up at a gate when the player
 * crosses it. Each floater is a billboarded canvas-texture plane that:
 *
 *   - spawns at the gate centre, slightly above the beam,
 *   - rises ~4.5 m over its lifetime,
 *   - fades out (quadratic alpha curve so it lingers then drops off),
 *   - turns to face the camera every frame.
 *
 * A small ring buffer of meshes is recycled to avoid GC churn.
 */

const CAPACITY = 8;
const LIFETIME_SEC = 1.7;
const RISE_DISTANCE = 4.5;

interface Floater {
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  spawnTime: number;
  startY: number;
  active: boolean;
}

export class BonusFloaters {
  private readonly floaters: Floater[] = [];
  private elapsed = 0;
  private nextSlot = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < CAPACITY; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 96;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.1), mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.floaters.push({
        mesh,
        texture: tex,
        canvas,
        spawnTime: -1000,
        startY: 0,
        active: false,
      });
    }
  }

  /**
   * Spawn a `+X.Xs` floater at the given world position.
   * `label` overrides the default `+N.Ns` rendering (used for the lap bonus).
   */
  spawn(
    position: { x: number; y: number; z: number },
    bonusSec: number,
    label?: string,
  ): void {
    if (bonusSec <= 0 && !label) return;
    const f = this.floaters[this.nextSlot];
    this.nextSlot = (this.nextSlot + 1) % CAPACITY;

    const ctx = f.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, f.canvas.width, f.canvas.height);
    ctx.font = 'bold 64px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = label ?? `+${bonusSec.toFixed(1)}s`;
    // Heavy black stroke + bright green fill so the floater reads against
    // any sky / track background.
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.strokeText(text, f.canvas.width / 2, f.canvas.height / 2 + 4);
    ctx.fillStyle = '#4fff8a';
    ctx.fillText(text, f.canvas.width / 2, f.canvas.height / 2 + 4);
    f.texture.needsUpdate = true;

    f.mesh.position.set(position.x, position.y + 2.5, position.z);
    f.startY = f.mesh.position.y;
    f.spawnTime = this.elapsed;
    f.active = true;
    f.mesh.visible = true;
    (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  /** Per render frame: rise, fade, billboard. */
  update(dt: number, cameraPos: THREE.Vector3): void {
    this.elapsed += dt;
    for (const f of this.floaters) {
      if (!f.active) continue;
      const age = this.elapsed - f.spawnTime;
      if (age >= LIFETIME_SEC) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }
      const t = age / LIFETIME_SEC;
      f.mesh.position.y = f.startY + t * RISE_DISTANCE;
      // Quadratic fade — lingers, then drops off.
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t * t;
      f.mesh.lookAt(cameraPos);
    }
  }
}
