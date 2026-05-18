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

  // Scratch values reused per step.
  private readonly tmpDelta = new THREE.Vector3();
  private readonly tmpInvQuat = new THREE.Quaternion();

  constructor(scene: THREE.Scene, markers: CheckpointMarker[]) {
    this.markers = markers;
    this.total = markers.length;

    for (const m of markers) {
      // --- Visual gate: two pylons + a banner across the top --------------
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

      scene.add(group);
      this.gates.push({ group, parts });
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
}
