import * as THREE from 'three';
import type { TrackDef } from './TrackTypes';

/**
 * Side-effect-free walk of a TrackDef that returns just the XZ centerline
 * samples. Mirrors the position/orientation chain in TrackBuilder but skips
 * everything mesh/collider related — used by the Menus track preview.
 *
 * Yaw / pitch / loop forward-helix all advance the position; bank + roll
 * + corkscrew only rotate around the forward axis, leaving XZ unchanged.
 */

const SAMPLE_STEP = 2.0;

const FORWARD_LOCAL = new THREE.Vector3(0, 0, 1);
const RIGHT_LOCAL = new THREE.Vector3(1, 0, 0);
const UP_LOCAL = new THREE.Vector3(0, 1, 0);

export function previewCenterline(def: TrackDef): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  const pos = new THREE.Vector3(0, 0, 0);
  const quat = new THREE.Quaternion();
  const yawQ = new THREE.Quaternion();
  const pitchQ = new THREE.Quaternion();
  const forward = new THREE.Vector3();

  pts.push({ x: pos.x, z: pos.z });

  for (const seg of def.segments) {
    if (seg.kind === 'gap') {
      forward.copy(FORWARD_LOCAL).applyQuaternion(quat);
      forward.y = 0;
      if (forward.lengthSq() > 1e-6) forward.normalize();
      else forward.set(0, 0, 1);
      pos.addScaledVector(forward, seg.length);
      pts.push({ x: pos.x, z: pos.z });
      continue;
    }

    if (seg.kind === 'loop') {
      const advance = seg.forwardAdvance ?? seg.length * 1.5;
      forward.copy(FORWARD_LOCAL).applyQuaternion(quat);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
      forward.normalize();
      const sub = Math.max(2, Math.ceil(advance / SAMPLE_STEP));
      const startX = pos.x;
      const startZ = pos.z;
      for (let i = 1; i <= sub; i++) {
        const t = i / sub;
        pts.push({
          x: startX + forward.x * advance * t,
          z: startZ + forward.z * advance * t,
        });
      }
      pos.x = startX + forward.x * advance;
      pos.z = startZ + forward.z * advance;
      continue;
    }

    const sub = Math.max(2, Math.ceil(seg.length / SAMPLE_STEP));
    const ds = seg.length / sub;
    const dYaw = (seg.turn ?? 0) / sub;
    const dPitch = (seg.pitch ?? 0) / sub;
    for (let i = 0; i < sub; i++) {
      if (dYaw !== 0) {
        yawQ.setFromAxisAngle(UP_LOCAL, dYaw);
        quat.multiply(yawQ);
      }
      if (dPitch !== 0) {
        pitchQ.setFromAxisAngle(RIGHT_LOCAL, -dPitch);
        quat.multiply(pitchQ);
      }
      forward.copy(FORWARD_LOCAL).applyQuaternion(quat);
      pos.addScaledVector(forward, ds);
      pts.push({ x: pos.x, z: pos.z });
    }
  }

  return pts;
}
