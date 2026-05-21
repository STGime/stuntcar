import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CenterlineSample } from '../track/TrackBuilder';
import type { Car } from '../vehicle/Car';
import type { Race } from './Race';
import type { Sfx } from '../audio/Sfx';
import type { BonusFloaters } from '../fx/BonusFloaters';

/**
 * Arcade-style powerups and hazards scattered along the racing line.
 *
 * Seven kinds:
 *   - turbo        — pickup: 1.8× engine force for 2 s
 *   - stickyTires  — pickup: +60 % tire grip for 5 s
 *   - timeBonus    — pickup: +5 s on the race timer (instant, no duration)
 *   - shield       — pickup: held until the next hazard would land, then
 *                    absorbed
 *   - oilSlick     — hazard: friction × 0.35 for 1.5 s
 *   - mud          — hazard: engine × 0.5 and capped at 70 km/h for 2.5 s
 *   - smoke        — hazard: full-screen vignette for 3 s
 *
 * One timed effect is active at a time — picking up a new pickup OR driving
 * over a new hazard cancels the current effect and replaces it. The shield
 * is its own passive slot and can coexist with a timed effect.
 *
 * Spawns are seeded by (trackId, current minute) so each session has its
 * own layout but stays stable for the length of a race. Per-lap reset
 * re-arms every spawn for the next lap.
 */

export type PowerupKind =
  | 'turbo'
  | 'stickyTires'
  | 'timeBonus'
  | 'shield'
  | 'oilSlick'
  | 'mud'
  | 'smoke';

interface Spawn {
  kind: PowerupKind;
  worldPos: THREE.Vector3;
  /** Group containing the visual (so we can scale + fade on pickup). */
  visual: THREE.Group;
  pickup: boolean;
  consumed: boolean;
}

interface TimedEffect {
  kind: PowerupKind;
  remainingSec: number;
  /** Total duration when started — for HUD chip progress display. */
  totalSec: number;
}

const SPAWN_STEP_M = 70;
const PICKUP_HOVER_Y = 1.6;
const PICKUP_RADIUS_SQ = 2.5 * 2.5;
const HAZARD_RADIUS_SQ = 1.8 * 1.8;
const TURBO_FACTOR = 1.8;
const TURBO_SEC = 2.0;
const STICKY_FACTOR = 1.6;
const STICKY_SEC = 5.0;
const TIME_BONUS_SEC = 5.0;
const OIL_FACTOR = 0.35;
const OIL_SEC = 1.5;
const MUD_BOOST = 0.5;
const MUD_CAP_KMH = 70;
const MUD_SEC = 2.5;
const SMOKE_SEC = 3.0;
const COLLECT_FADE_SEC = 0.25;
const COLLECT_RESPAWN_DELAY = 0.4; // delay after lap reset before visible

export class Powerups {
  private readonly spawns: Spawn[] = [];
  private activeTimed: TimedEffect | null = null;
  private shield = false;
  private elapsed = 0;
  private smokeEl: HTMLElement | null = null;
  private readonly fading: Array<{
    visual: THREE.Group;
    t: number;
  }> = [];

  constructor(
    private readonly scene: THREE.Scene,
    centerline: readonly CenterlineSample[],
    trackId: string,
    private readonly car: Car,
    private readonly race: Race,
    private readonly sfx: Sfx,
    private readonly floaters: BonusFloaters,
  ) {
    const rand = makePrng(
      hashStr(trackId) ^ Math.floor(Date.now() / 60_000),
    );
    let cursor = SPAWN_STEP_M;
    let distance = 0;
    for (let i = 1; i < centerline.length; i++) {
      const a = centerline[i - 1];
      const b = centerline[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 1e-3) continue;
      distance += segLen;
      if (distance < cursor) continue;
      cursor = distance + SPAWN_STEP_M * (0.7 + rand() * 0.7);

      const pickup = rand() < 0.67;
      const kind = pickup ? pickRandomPickup(rand) : pickRandomHazard(rand);

      // Lateral offset: bias toward the racing line (smaller offset).
      const lateral = (rand() - 0.5) * (b.halfWidth - 1.5);
      const px = -dz / segLen;
      const pz = dx / segLen;
      const x = b.x + px * lateral;
      const z = b.z + pz * lateral;
      const y = b.topY;
      const visual = buildVisual(kind, pickup);
      visual.position.set(x, pickup ? y + PICKUP_HOVER_Y : y + 0.04, z);
      // Hazards lie flat on the road — rotate the plane 90° around X.
      if (!pickup) visual.rotation.x = -Math.PI / 2;
      scene.add(visual);

      this.spawns.push({
        kind,
        worldPos: new THREE.Vector3(x, y, z),
        visual,
        pickup,
        consumed: false,
      });
    }

    // Smoke overlay (lazy-built, owned by this instance).
    this.smokeEl = document.createElement('div');
    this.smokeEl.id = 'smoke-overlay';
    this.smokeEl.style.display = 'none';
    document.body.appendChild(this.smokeEl);
    injectStyles();
  }

  /** Returns the currently-active timed effect (for HUD display). */
  getActive(): TimedEffect | null {
    return this.activeTimed;
  }

  /** Returns whether the shield is currently held. */
  hasShield(): boolean {
    return this.shield;
  }

  /** Per fixed step: check collisions, tick the active effect, animate
   *  consumed pickups fading out. */
  update(dt: number, chassisBody: RAPIER.RigidBody, paused: boolean): void {
    this.elapsed += dt;

    // Bob + spin floating pickups.
    for (const s of this.spawns) {
      if (s.consumed || !s.pickup) continue;
      s.visual.rotation.y += dt * 1.6;
      s.visual.position.y =
        s.worldPos.y + PICKUP_HOVER_Y + Math.sin(this.elapsed * 2.4 + s.worldPos.x) * 0.18;
    }

    // Tick fade-outs.
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      f.t += dt;
      const k = f.t / COLLECT_FADE_SEC;
      if (k >= 1) {
        f.visual.visible = false;
        f.visual.scale.set(1, 1, 1);
        (f.visual as unknown as { material?: { opacity: number } }).material;
        this.fading.splice(i, 1);
      } else {
        const s = 1 + k * 1.2;
        f.visual.scale.set(s, s, s);
        setOpacity(f.visual, 1 - k);
      }
    }

    // Tick active effect.
    if (this.activeTimed && !paused) {
      this.activeTimed.remainingSec -= dt;
      if (this.activeTimed.remainingSec <= 0) {
        this.clearActiveEffect();
      }
    }

    if (paused) return;

    // Collision check. Only against UNCONSUMED spawns; AABB-style distance
    // (squared, no sqrt) for speed.
    const t = chassisBody.translation();
    for (const s of this.spawns) {
      if (s.consumed) continue;
      const dx = t.x - s.worldPos.x;
      const dz = t.z - s.worldPos.z;
      const d2 = dx * dx + dz * dz;
      const r2 = s.pickup ? PICKUP_RADIUS_SQ : HAZARD_RADIUS_SQ;
      if (d2 < r2) {
        s.consumed = true;
        this.trigger(s);
      }
    }
  }

  /** Race calls this at every lap boundary so the next lap has the full
   *  set of powerups available again. Also clears any in-flight effect. */
  resetForLap(): void {
    this.clearActiveEffect();
    this.shield = false;
    for (const s of this.spawns) {
      s.consumed = false;
      s.visual.visible = true;
      s.visual.scale.set(1, 1, 1);
      setOpacity(s.visual, 1);
    }
    this.fading.length = 0;
  }

  /** Wipe everything (used on full race start). */
  reset(): void {
    this.resetForLap();
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private trigger(s: Spawn): void {
    // Start fade-out of the visual.
    this.fading.push({ visual: s.visual, t: 0 });
    if (s.pickup) this.sfx.pickup();
    else this.sfx.hazard();

    if (s.pickup) {
      const labelMap: Record<PowerupKind, string> = {
        turbo: 'TURBO!',
        stickyTires: 'GRIP+',
        timeBonus: '+5s',
        shield: 'SHIELD',
        oilSlick: '',
        mud: '',
        smoke: '',
      };
      this.floaters.spawn(s.worldPos, 0, labelMap[s.kind]);
    }

    if (s.pickup && s.kind === 'timeBonus') {
      // Instant: top up the timer; no active effect.
      this.race.timer.addBonus(TIME_BONUS_SEC);
      return;
    }
    if (s.pickup && s.kind === 'shield') {
      this.shield = true;
      return;
    }
    if (!s.pickup && this.shield) {
      // Shield absorbs the hazard.
      this.shield = false;
      return;
    }

    // Everything else replaces any currently-active timed effect.
    this.clearActiveEffect();
    this.applyEffect(s.kind);
  }

  private applyEffect(kind: PowerupKind): void {
    switch (kind) {
      case 'turbo':
        this.car.drivetrain.boostFactor = TURBO_FACTOR;
        this.activeTimed = { kind, remainingSec: TURBO_SEC, totalSec: TURBO_SEC };
        break;
      case 'stickyTires':
        this.car.setPowerupGripFactor(STICKY_FACTOR);
        this.activeTimed = { kind, remainingSec: STICKY_SEC, totalSec: STICKY_SEC };
        break;
      case 'oilSlick':
        this.car.setPowerupGripFactor(OIL_FACTOR);
        this.activeTimed = { kind, remainingSec: OIL_SEC, totalSec: OIL_SEC };
        break;
      case 'mud':
        this.car.drivetrain.boostFactor = MUD_BOOST;
        this.car.drivetrain.speedCapKmh = MUD_CAP_KMH;
        this.activeTimed = { kind, remainingSec: MUD_SEC, totalSec: MUD_SEC };
        break;
      case 'smoke':
        if (this.smokeEl) this.smokeEl.style.display = '';
        this.activeTimed = { kind, remainingSec: SMOKE_SEC, totalSec: SMOKE_SEC };
        break;
      default:
        break;
    }
  }

  private clearActiveEffect(): void {
    if (!this.activeTimed) return;
    switch (this.activeTimed.kind) {
      case 'turbo':
        this.car.drivetrain.boostFactor = 1;
        break;
      case 'stickyTires':
      case 'oilSlick':
        this.car.setPowerupGripFactor(1);
        break;
      case 'mud':
        this.car.drivetrain.boostFactor = 1;
        this.car.drivetrain.speedCapKmh = Infinity;
        break;
      case 'smoke':
        if (this.smokeEl) this.smokeEl.style.display = 'none';
        break;
      default:
        break;
    }
    this.activeTimed = null;
  }
}

// ─────────────────────────── helpers ────────────────────────────────────

function pickRandomPickup(rand: () => number): PowerupKind {
  const r = rand();
  if (r < 0.3) return 'turbo';
  if (r < 0.6) return 'stickyTires';
  if (r < 0.85) return 'timeBonus';
  return 'shield';
}

function pickRandomHazard(rand: () => number): PowerupKind {
  const r = rand();
  if (r < 0.4) return 'oilSlick';
  if (r < 0.75) return 'mud';
  return 'smoke';
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
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

function setOpacity(group: THREE.Object3D, opacity: number): void {
  group.traverse((obj) => {
    const m = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    for (const mat of list) {
      (mat as THREE.MeshBasicMaterial).transparent = true;
      (mat as THREE.MeshBasicMaterial).opacity = opacity;
    }
  });
}

function buildVisual(kind: PowerupKind, pickup: boolean): THREE.Group {
  const g = new THREE.Group();
  if (pickup) {
    // Floating pickup: a 1.2 m square plane with a canvas-drawn icon, plus
    // a faint billboarded ring for a glow.
    const tex = makeIconTexture(kind);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), mat);
    icon.renderOrder = 2;
    g.add(icon);

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 0.92, 24),
      new THREE.MeshBasicMaterial({
        color: kindColor(kind),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    glow.rotation.z = Math.PI / 2;
    glow.renderOrder = 1;
    g.add(glow);
  } else {
    // Surface hazard: a 3 m × 2 m painted decal that lies flat on the road.
    const tex = makeHazardTexture(kind);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), mat);
    g.add(decal);
  }
  return g;
}

function kindColor(kind: PowerupKind): number {
  switch (kind) {
    case 'turbo': return 0xff8a3a;
    case 'stickyTires': return 0x4fd1c5;
    case 'timeBonus': return 0x4fff8a;
    case 'shield': return 0xa98aff;
    case 'oilSlick': return 0x222227;
    case 'mud': return 0x6b4a26;
    case 'smoke': return 0xb6b9bf;
  }
}

function makeIconTexture(kind: PowerupKind): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  // Card background.
  ctx.fillStyle = '#0c1018';
  roundRect(ctx, 8, 8, 240, 240, 32);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#' + kindColor(kind).toString(16).padStart(6, '0');
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Icon glyph.
  ctx.fillStyle = '#' + kindColor(kind).toString(16).padStart(6, '0');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (kind) {
    case 'turbo':
      ctx.font = 'bold 150px ui-monospace, monospace';
      ctx.fillText('»', 128, 140);
      break;
    case 'stickyTires':
      ctx.font = 'bold 130px ui-monospace, monospace';
      ctx.fillText('◯', 128, 134);
      break;
    case 'timeBonus':
      ctx.font = 'bold 80px ui-monospace, monospace';
      ctx.fillText('+5s', 128, 132);
      break;
    case 'shield':
      ctx.font = 'bold 140px ui-monospace, monospace';
      ctx.fillText('◆', 128, 134);
      break;
    default:
      break;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeHazardTexture(kind: PowerupKind): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  switch (kind) {
    case 'oilSlick': {
      // Glossy dark slick with rainbow sheen.
      const grad = ctx.createRadialGradient(192, 128, 0, 192, 128, 180);
      grad.addColorStop(0, 'rgba(15,18,24,0.95)');
      grad.addColorStop(0.6, 'rgba(15,18,24,0.85)');
      grad.addColorStop(1, 'rgba(15,18,24,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const sheen = ctx.createLinearGradient(60, 80, 320, 160);
      sheen.addColorStop(0, 'rgba(255,80,150,0.35)');
      sheen.addColorStop(0.5, 'rgba(80,230,255,0.35)');
      sheen.addColorStop(1, 'rgba(180,255,140,0.3)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.ellipse(192, 128, 140, 70, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'mud': {
      const grad = ctx.createRadialGradient(192, 128, 0, 192, 128, 180);
      grad.addColorStop(0, 'rgba(85,55,28,0.92)');
      grad.addColorStop(0.7, 'rgba(85,55,28,0.7)');
      grad.addColorStop(1, 'rgba(85,55,28,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Speckles for texture.
      for (let i = 0; i < 80; i++) {
        ctx.fillStyle = `rgba(40,28,14,${0.4 + Math.random() * 0.4})`;
        ctx.beginPath();
        ctx.arc(40 + Math.random() * 304, 32 + Math.random() * 192, 3 + Math.random() * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'smoke': {
      const grad = ctx.createRadialGradient(192, 128, 0, 192, 128, 180);
      grad.addColorStop(0, 'rgba(200,200,210,0.75)');
      grad.addColorStop(0.6, 'rgba(180,182,190,0.55)');
      grad.addColorStop(1, 'rgba(150,150,160,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      break;
    }
    default:
      break;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
    #smoke-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(circle at 50% 50%,
        rgba(80,80,90,0.05) 0%,
        rgba(80,80,90,0.55) 40%,
        rgba(40,40,50,0.85) 100%);
      animation: smoke-flicker 1.3s ease-in-out infinite;
      z-index: 7;
    }
    @keyframes smoke-flicker {
      0%, 100% { opacity: 0.85; }
      50%      { opacity: 1; }
    }
  `;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}
