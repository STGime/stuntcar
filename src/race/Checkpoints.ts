import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CheckpointMarker } from '../track/TrackBuilder';

const PENDING_HEX = 0xffd166;
const PASSED_HEX = 0x4fff8a;
const FINISH_HEX = 0x4fd1c5;

const PYLON_HEIGHT = 4.5;
const PYLON_SIZE = 0.35;

/** Half-extents of the gate detection box in the gate's local frame. */
const GATE_HALF_WIDTH_PAD = 0.5;
const GATE_HALF_HEIGHT = 2.5;
const GATE_HALF_DEPTH = 0.6;

export interface CheckpointPassEvent {
  index: number;
  isFinish: boolean;
  timeBonusSec: number;
}

interface GateVisual {
  group: THREE.Group;
  parts: THREE.Mesh[];
}

/** Per-finish-gate flag mesh + its rest-position vertex buffer. */
interface FlagState {
  mesh: THREE.Mesh;
  basePositions: Float32Array;
  poleSide: 1 | -1;
}

/**
 * Ordered checkpoint gates. Each gate is purely visual (pylon meshes + a
 * banner across the top) — there is NO Rapier collider for the gate. The
 * pass test is a cheap per-step AABB check in the gate's local frame: take
 * the chassis position, transform it into gate-local coords, compare against
 * `[±halfWidth, ±halfHeight, ±halfDepth]`.
 *
 * Detection is "in-order only": the only gate being checked each step is the
 * next-expected one. Touching gate N+2 before N+1 does not count.
 *
 * `lastPassedSpawn()` returns the reset pose for `R` (or fall-and-wreck in M6).
 */
export class Checkpoints {
  readonly total: number;
  private nextIndex = 0;
  private readonly gates: GateVisual[] = [];
  private readonly markers: CheckpointMarker[];
  private readonly flags: FlagState[] = [];

  // Scratch values reused per step.
  private readonly tmpDelta = new THREE.Vector3();
  private readonly tmpInvQuat = new THREE.Quaternion();

  constructor(scene: THREE.Scene, markers: CheckpointMarker[]) {
    this.markers = markers;
    this.total = markers.length;

    for (let idx = 0; idx < markers.length; idx++) {
      const m = markers[idx];
      // --- Visual gate: two pylons + a beam + a labelled banner ----------
      const group = new THREE.Group();
      group.position.copy(m.position);
      group.quaternion.copy(m.quaternion);

      const baseColor = m.isFinish ? FINISH_HEX : PENDING_HEX;
      const pylonMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: baseColor,
        emissiveIntensity: 0.45,
        roughness: 0.5,
      });
      const pylonGeo = new THREE.BoxGeometry(PYLON_SIZE, PYLON_HEIGHT, PYLON_SIZE);

      const halfW = m.width / 2 + 0.35;
      const yMid = PYLON_HEIGHT / 2 + 0.2;
      const parts: THREE.Mesh[] = [];

      const left = new THREE.Mesh(pylonGeo, pylonMat.clone());
      left.position.set(-halfW, yMid, 0);
      left.castShadow = true;
      group.add(left);
      parts.push(left);

      const right = new THREE.Mesh(pylonGeo, pylonMat.clone());
      right.position.set(+halfW, yMid, 0);
      right.castShadow = true;
      group.add(right);
      parts.push(right);

      const beamGeo = new THREE.BoxGeometry(m.width + 1, 0.3, 0.3);
      const beam = new THREE.Mesh(beamGeo, pylonMat.clone());
      beam.position.set(0, PYLON_HEIGHT + 0.2, 0);
      beam.castShadow = true;
      group.add(beam);
      parts.push(beam);

      // Hanging label banner under the beam.
      const labelText = m.isFinish ? 'FINISH' : `CP ${idx + 1}`;
      const labelTex = makeLabelTexture(labelText, m.isFinish);
      const labelW = Math.min(m.width + 0.4, 6.5);
      const labelH = 1.05;
      const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
      const labelMat = new THREE.MeshBasicMaterial({
        map: labelTex,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const label = new THREE.Mesh(labelGeo, labelMat);
      label.position.set(0, PYLON_HEIGHT - 0.45, 0);
      // The gate's local +Z is the direction the car drives — so a
      // default-oriented plane shows its readable face to traffic that has
      // already passed. Flip 180° so the text faces oncoming cars.
      label.rotation.y = Math.PI;
      group.add(label);

      // Finish-line marshals: two waving checkered flags on poles, mounted
      // just outside the pylons. Vertices animate per render frame.
      if (m.isFinish) {
        this.addFinishFlags(group, halfW);
      } else {
        // Sponsor billboard beside non-finish gates.
        this.addSponsorBillboard(group, halfW, idx);
      }

      scene.add(group);
      this.gates.push({ group, parts });
    }
  }

  /** Mount a sponsor billboard on a thin post, just outside one of the
   *  pylons. The sponsor name + colour are picked deterministically from
   *  the gate index so each track's sequence is stable across reloads. */
  private addSponsorBillboard(
    group: THREE.Group,
    halfW: number,
    idx: number,
  ): void {
    const sponsor = SPONSORS[idx % SPONSORS.length];
    const side: 1 | -1 = idx % 2 === 0 ? 1 : -1;

    const POST_HEIGHT = 3.6;
    const PANEL_W = 3.2;
    const PANEL_H = 1.5;
    const offsetX = side * (halfW + 1.6);

    const postMat = new THREE.MeshStandardMaterial({
      color: 0x2a2f38,
      metalness: 0.6,
      roughness: 0.5,
    });
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, POST_HEIGHT, 8),
      postMat,
    );
    post.position.set(offsetX, POST_HEIGHT / 2, 0);
    post.castShadow = true;
    group.add(post);

    const panelTex = makeSponsorTexture(sponsor);
    const panelMat = new THREE.MeshBasicMaterial({
      map: panelTex,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      panelMat,
    );
    panel.position.set(offsetX, POST_HEIGHT + PANEL_H / 2 - 0.1, 0);
    // Same orientation trick as the gate label — face oncoming traffic.
    panel.rotation.y = Math.PI;
    panel.castShadow = true;
    group.add(panel);

    // Painted backing so the rear of the panel doesn't look like a TV.
    const backingMat = new THREE.MeshStandardMaterial({
      color: 0x1c2028,
      roughness: 0.7,
    });
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(PANEL_W * 1.02, PANEL_H * 1.05, 0.06),
      backingMat,
    );
    backing.position.copy(panel.position);
    backing.position.z -= 0.04 * (Math.cos(panel.rotation.y));
    group.add(backing);
  }

  /** Mount a flag pole + waving checker flag on each side of the finish gate. */
  private addFinishFlags(group: THREE.Group, halfW: number): void {
    const POLE_HEIGHT = 6.0;
    const POLE_RADIUS = 0.07;
    const FLAG_W = 1.6;
    const FLAG_H = 0.9;
    const offset = halfW + 1.1;

    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xd9d9d9,
      metalness: 0.7,
      roughness: 0.35,
    });
    const checkerTex = makeCheckerTexture();
    const flagMat = new THREE.MeshBasicMaterial({
      map: checkerTex,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    for (const side of [-1, 1] as const) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 8),
        poleMat,
      );
      pole.position.set(side * offset, POLE_HEIGHT / 2, 0);
      pole.castShadow = true;
      group.add(pole);

      const flagGeo = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 16, 4);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      // Anchor the flag's pole edge at the pole top. The flag's local origin
      // is at its centre, so shift the mesh by half its width along the
      // outward (-side) axis so the inner edge sits on the pole.
      flag.position.set(side * (offset + FLAG_W / 2), POLE_HEIGHT - FLAG_H / 2 - 0.1, 0);
      // Cache rest positions for the wave animation.
      const basePos = flagGeo.getAttribute('position').array as Float32Array;
      const baseClone = new Float32Array(basePos.length);
      baseClone.set(basePos);
      this.flags.push({ mesh: flag, basePositions: baseClone, poleSide: side });
      group.add(flag);
    }
  }

  /** Resets all gates to pending; called when starting / restarting a run. */
  reset(): void {
    this.nextIndex = 0;
    for (let i = 0; i < this.gates.length; i++) {
      const hex = this.markers[i].isFinish ? FINISH_HEX : PENDING_HEX;
      this.setGateColor(i, hex);
    }
  }

  /** Re-arm the gate sequence for the next lap. Same effect as `reset()` but
   *  semantically distinct — the run continues, only the gate cursor wraps. */
  resetForNextLap(): void {
    this.reset();
  }

  /** Number of gates already passed (0..total). */
  get passed(): number {
    return this.nextIndex;
  }

  /** True after the finish gate has been crossed. */
  get isComplete(): boolean {
    return this.nextIndex >= this.total;
  }

  /** The next-expected gate's marker, or `null` if the run is complete. */
  nextMarker(): CheckpointMarker | null {
    return this.nextIndex < this.total ? this.markers[this.nextIndex] : null;
  }

  /** Marker by index — used by FX systems that need a gate's world position. */
  markerAt(index: number): CheckpointMarker | null {
    return this.markers[index] ?? null;
  }

  /**
   * Spawn pose to teleport the car to on reset. If no gates have been passed
   * yet, returns null (caller falls back to the track's start pose).
   */
  lastPassedSpawn(): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
    if (this.nextIndex === 0) return null;
    const m = this.markers[this.nextIndex - 1];
    return { position: m.position.clone(), quaternion: m.quaternion.clone() };
  }

  /**
   * Per physics step: returns the pass event if the chassis just crossed the
   * next-expected gate, else null. Updates internal state + gate colors.
   *
   * Pass test: transform the chassis world position into the gate's local
   * frame and check it against the gate's local AABB. No physics colliders
   * involved — gates apply zero force on the car at any speed.
   */
  update(chassisBody: RAPIER.RigidBody): CheckpointPassEvent | null {
    if (this.nextIndex >= this.total) return null;
    const m = this.markers[this.nextIndex];

    const t = chassisBody.translation();
    this.tmpDelta.set(t.x - m.position.x, t.y - m.position.y, t.z - m.position.z);
    this.tmpInvQuat.copy(m.quaternion).invert();
    this.tmpDelta.applyQuaternion(this.tmpInvQuat);

    const halfW = m.width / 2 + GATE_HALF_WIDTH_PAD;
    if (
      Math.abs(this.tmpDelta.x) > halfW ||
      Math.abs(this.tmpDelta.y) > GATE_HALF_HEIGHT ||
      Math.abs(this.tmpDelta.z) > GATE_HALF_DEPTH
    ) {
      return null;
    }

    const event: CheckpointPassEvent = {
      index: this.nextIndex,
      isFinish: m.isFinish,
      timeBonusSec: m.timeBonusSec,
    };
    this.setGateColor(this.nextIndex, PASSED_HEX);
    this.nextIndex += 1;
    return event;
  }

  private setGateColor(idx: number, hex: number): void {
    const gate = this.gates[idx];
    for (const part of gate.parts) {
      const mat = part.material as THREE.MeshStandardMaterial;
      mat.color.setHex(hex);
      mat.emissive.setHex(hex);
    }
  }

  /** Per render frame: wave the finish-line flags. */
  animate(elapsedSec: number): void {
    for (const f of this.flags) {
      const attr = f.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const base = f.basePositions;
      const FLAG_W = 1.6;
      // The flag's inner (pole) edge is at xLocal = -FLAG_W/2 on the +side
      // flag and at xLocal = +FLAG_W/2 on the -side flag. Compute distance
      // along the flag from the pole edge so the tip waves more than the
      // root.
      const innerEdge = f.poleSide === 1 ? -FLAG_W / 2 : +FLAG_W / 2;
      for (let i = 0; i < base.length; i += 3) {
        const x = base[i];
        const fromPole = Math.abs(x - innerEdge) / FLAG_W; // 0 at pole, 1 at tip
        const wave =
          Math.sin(elapsedSec * 6.0 + fromPole * 6.5) * 0.16 * fromPole +
          Math.sin(elapsedSec * 3.3 + fromPole * 2.1) * 0.08 * fromPole;
        arr[i + 0] = x;
        arr[i + 1] = base[i + 1] - 0.05 * fromPole; // slight droop at the tip
        arr[i + 2] = wave;
      }
      attr.needsUpdate = true;
    }
  }
}

function makeLabelTexture(text: string, finish: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Background card.
  ctx.fillStyle = '#0c1018';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Coloured border (yellow for normal gates, teal for finish).
  const accent = finish ? '#4fd1c5' : '#ffd166';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  // Text.
  ctx.fillStyle = accent;
  ctx.font = 'bold 78px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface Sponsor {
  name: string;
  /** Background colour. */
  bg: string;
  /** Foreground (text) colour. */
  fg: string;
  /** Optional accent stripe colour painted across the top. */
  accent?: string;
}

const SPONSORS: Sponsor[] = [
  { name: 'TURBO+',     bg: '#0f1a2e', fg: '#ffd166', accent: '#ff4f4f' },
  { name: 'APEX FUEL',  bg: '#1a0d18', fg: '#ff6f4f', accent: '#ffd166' },
  { name: 'VELOCITY',   bg: '#03222c', fg: '#4fd1c5', accent: '#ffffff' },
  { name: 'IGNITE',     bg: '#2d1212', fg: '#ffb13a', accent: '#ffffff' },
  { name: 'NIMBUS',     bg: '#0e1f1a', fg: '#9be15d', accent: '#4fd1c5' },
  { name: 'VOLT RACE',  bg: '#16142e', fg: '#a98aff', accent: '#4fff8a' },
  { name: 'HORIZON',    bg: '#241408', fg: '#ffe7b3', accent: '#ff6f4f' },
  { name: 'STUNTLINE',  bg: '#1a2030', fg: '#ffd166', accent: '#4fd1c5' },
];

function makeSponsorTexture(s: Sponsor): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Background.
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Diagonal accent band for graphic flair.
  if (s.accent) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-0.18);
    ctx.fillStyle = s.accent;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(-canvas.width, -40, canvas.width * 2, 80);
    ctx.restore();
  }

  // Outer frame.
  ctx.strokeStyle = s.fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

  // Sponsor name.
  ctx.fillStyle = s.fg;
  ctx.font = 'bold 96px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s.name, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeCheckerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const cols = 8;
  const rows = 4;
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#0a0e16' : '#f4f4ee';
      ctx.fillRect(x * cw, y * ch, cw + 1, ch + 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
