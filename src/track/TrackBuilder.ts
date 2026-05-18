import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { TrackDef, Segment } from './TrackTypes';

const UP_LOCAL = new THREE.Vector3(0, 1, 0);
const RIGHT_LOCAL = new THREE.Vector3(1, 0, 0);
const FORWARD_LOCAL = new THREE.Vector3(0, 0, 1);

/** Approx max distance between ribbon cross-sections, in metres. Smaller →
 *  smoother curves (especially loop apex), at the cost of more vertices. */
const SAMPLE_STEP = 0.8;
/** How far past the ribbon's leading edge the car spawns. Needs to be enough
 *  that the chase camera (~8.5 m behind the chassis) is also past the start
 *  line — otherwise the start/finish gate on a closed-loop circuit sits
 *  between the camera and the car and fills the screen. */
const SPAWN_OFFSET_FORWARD = 14;
/** Vertical thickness of the extruded ribbon slab (metres). Gives the track
 *  a real bottom surface and side walls so the chassis cuboid can't punch
 *  through the ribbon edge from below or the side. */
const RIBBON_THICKNESS = 0.35;

export interface CheckpointMarker {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  width: number;
  timeBonusSec: number;
  isFinish: boolean;
}

/** Cross-section centerline sample used by Props.ts to keep scenery off the
 *  ribbon's XZ footprint without going through the physics engine. */
export interface CenterlineSample {
  x: number;
  z: number;
  /** Half the ribbon width at this sample, metres. */
  halfWidth: number;
}

export interface BuiltTrack {
  spawn: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  checkpoints: CheckpointMarker[];
  finish: CheckpointMarker;
  /** Lowest Y on the entire ribbon — used to size the kill plane in M6. */
  minY: number;
  /** Trimesh collider for the whole track — null only if there's no geometry.
   *  Used by the off-track detector to tell "wheels on track" from "wheels on
   *  the ambient ground beside it" via a downward raycast. */
  collider: RAPIER.Collider | null;
  /** XZ centerline samples + per-sample half-width along the whole ribbon. */
  centerline: CenterlineSample[];
}

/** A ribbon cross-section: four corners in world space (top + bottom × L/R). */
interface CrossSection {
  tl: THREE.Vector3;
  tr: THREE.Vector3;
  bl: THREE.Vector3;
  br: THREE.Vector3;
}

/**
 * Walks a TrackDef along an orthonormal frame (position + orientation), per
 * segment splits the path into sample steps, and emits an extruded ribbon
 * slab (top + bottom + side walls + end caps). Strips break across `gap`
 * segments. Builds a Three.js mesh for each strip and one Rapier `trimesh`
 * fixed-body collider for the whole track.
 */
export function buildTrack(
  scene: THREE.Scene,
  world: RAPIER.World,
  def: TrackDef,
): BuiltTrack {
  const pos = new THREE.Vector3(0, def.spawnY ?? 1, 0);
  const quat = new THREE.Quaternion();

  // Spawn the car several metres into the first segment so the chassis sits
  // fully on the ribbon (the ribbon's first cross-section is at `pos`).
  const spawnPosition = pos
    .clone()
    .addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(quat), SPAWN_OFFSET_FORWARD);
  const spawn = {
    position: spawnPosition,
    quaternion: quat.clone(),
  };

  const strips: CrossSection[][] = [[]];

  // Scratch vectors reused across the walk.
  const yawQ = new THREE.Quaternion();
  const pitchQ = new THREE.Quaternion();
  const rollQ = new THREE.Quaternion();
  const forwardVec = new THREE.Vector3();
  const rightVec = new THREE.Vector3();
  const downVec = new THREE.Vector3();

  let minY = pos.y - RIBBON_THICKNESS;
  const centerline: CenterlineSample[] = [];

  const emitCrossSection = (width: number): void => {
    rightVec.copy(RIGHT_LOCAL).applyQuaternion(quat).multiplyScalar(width / 2);
    downVec.copy(UP_LOCAL).applyQuaternion(quat).multiplyScalar(-RIBBON_THICKNESS);
    const tl = pos.clone().sub(rightVec);
    const tr = pos.clone().add(rightVec);
    const bl = tl.clone().add(downVec);
    const br = tr.clone().add(downVec);
    strips[strips.length - 1].push({ tl, tr, bl, br });
    for (const v of [tl, tr, bl, br]) if (v.y < minY) minY = v.y;
    centerline.push({ x: pos.x, z: pos.z, halfWidth: width / 2 });
  };

  const breakStrip = (): void => {
    if (strips[strips.length - 1].length > 0) strips.push([]);
  };

  const checkpoints: CheckpointMarker[] = [];

  for (let segIdx = 0; segIdx < def.segments.length; segIdx++) {
    const seg = def.segments[segIdx];

    // Gap: emit nothing, advance the frame, start a new strip after.
    //
    // Advance along the HORIZONTAL projection of forward, not along the full
    // pitched forward. Otherwise the landing pad's start sits at
    // gap·sin(launchPitch) above the launch end — but a ballistic projectile
    // launched at angle θ always falls below the straight-line continuation
    // of that direction (it only matches it at v → ∞). With the gap
    // horizontal, the landing pad is at the same world Y as the launch end
    // and any reasonable launch speed clears it.
    if (seg.kind === 'gap') {
      forwardVec.copy(FORWARD_LOCAL).applyQuaternion(quat);
      forwardVec.y = 0;
      if (forwardVec.lengthSq() > 1e-6) {
        forwardVec.normalize();
      } else {
        // Frame pointing essentially straight up/down — fall back to plain
        // forward (degenerate case, e.g. mid-loop gap, which we don't use).
        forwardVec.copy(FORWARD_LOCAL).applyQuaternion(quat);
      }
      pos.addScaledVector(forwardVec, seg.length);
      breakStrip();
      maybeRecordCheckpoint(def, segIdx, pos, quat, seg, checkpoints);
      continue;
    }

    // First emission of a new strip happens here so the ribbon starts at the
    // current pos (without this, the strip would lose its leading cross-section).
    if (strips[strips.length - 1].length === 0) emitCrossSection(seg.width);

    const subSteps = Math.max(2, Math.ceil(seg.length / SAMPLE_STEP));

    // ---- Loop kind: tangent-aligned forward helix --------------------------
    // The loop traces an arch in the loop's local y-z plane:
    //   y(t) = R·(1 - cos t),  z(t) = R·sin t + a·t,  t ∈ [0, 2π]
    // where R = length/(2π) and a = forwardAdvance/(2π).
    //
    // The chassis is oriented along the trajectory's TANGENT at every sample
    // (not a constant 360° pitch sweep). With `forwardAdvance >= length`,
    // dz/dt > 0 everywhere — the path is monotonically forward, the chassis
    // pitches up at most ~atan2(R, a) (so it never inverts), and the player
    // can actually drive through it. A pure closed-circle loop would invert
    // the chassis at the top and the raycast-vehicle's suspension pushes
    // the chassis AWAY from the ribbon there — unenterable in practice.
    if (seg.kind === 'loop') {
      const R = seg.length / (2 * Math.PI);
      const totalAdvance = seg.forwardAdvance ?? seg.length * 1.5;
      const a = totalAdvance / (2 * Math.PI);

      const entryPos = pos.clone();
      const entryQuat = quat.clone();
      const localOffset = new THREE.Vector3();

      for (let i = 1; i <= subSteps; i++) {
        const t = (2 * Math.PI * i) / subSteps;
        const localY = R * (1 - Math.cos(t));
        const localZ = R * Math.sin(t) + a * t;
        localOffset.set(0, localY, localZ).applyQuaternion(entryQuat);
        pos.copy(entryPos).add(localOffset);

        // Tangent in loop-local frame: (0, R·sin t, R·cos t + a)
        const tangentY = R * Math.sin(t);
        const tangentZ = R * Math.cos(t) + a;
        const pitchTheta = Math.atan2(tangentY, tangentZ);
        // Pitch sign-flipped per the global convention (positive = nose up).
        pitchQ.setFromAxisAngle(RIGHT_LOCAL, -pitchTheta);
        quat.copy(entryQuat).multiply(pitchQ);

        emitCrossSection(seg.width);
      }
    } else {
      const ds = seg.length / subSteps;
      const dYaw = (seg.turn ?? 0) / subSteps;
      const dPitch = (seg.pitch ?? 0) / subSteps;
      // `bank` is the PEAK roll at the midpoint — apply a sine profile so the
      // chassis tips in then back to zero by the end of the segment. Net roll
      // change is 0, so banks don't accumulate across consecutive turns and
      // closed-loop circuits stay flat. Without this, four right-bank turns
      // would leave the cross-sections rolled by 4·bank — the outer edge of
      // the ribbon sinks below the ground and most of the track vanishes
      // under the ground plane.
      const bankAmp = seg.bank ?? 0;
      const dRollCorkscrew =
        seg.kind === 'corkscrew' ? (Math.PI * 2) / subSteps : 0;

      for (let i = 0; i < subSteps; i++) {
        if (dYaw !== 0) {
          yawQ.setFromAxisAngle(UP_LOCAL, dYaw);
          quat.multiply(yawQ);
        }
        if (dPitch !== 0) {
          // Negate so positive `pitch` means "nose up".
          pitchQ.setFromAxisAngle(RIGHT_LOCAL, -dPitch);
          quat.multiply(pitchQ);
        }
        let dRoll = dRollCorkscrew;
        if (bankAmp !== 0) {
          const t = (i + 1) / subSteps;
          const tPrev = i / subSteps;
          dRoll +=
            bankAmp * (Math.sin(t * Math.PI) - Math.sin(tPrev * Math.PI));
        }
        if (dRoll !== 0) {
          rollQ.setFromAxisAngle(FORWARD_LOCAL, dRoll);
          quat.multiply(rollQ);
        }
        forwardVec.copy(FORWARD_LOCAL).applyQuaternion(quat);
        pos.addScaledVector(forwardVec, ds);
        emitCrossSection(seg.width);
      }
    }

    maybeRecordCheckpoint(def, segIdx, pos, quat, seg, checkpoints);
  }

  if (checkpoints.length === 0) {
    throw new Error(`Track ${def.id} has no checkpoints`);
  }

  // Mark the finish: prefer a checkpoint at finishAfterSegmentIndex, else
  // fall back to the last recorded checkpoint.
  const finish =
    checkpoints.find(
      (cp, idx) =>
        def.checkpoints[idx]?.afterSegmentIndex === def.finishAfterSegmentIndex,
    ) ?? checkpoints[checkpoints.length - 1];
  finish.isFinish = true;

  // Force the lowest point of the entire ribbon to sit `TRACK_FLOOR_Y` above
  // the ground plane (y=0). Without this, banking dips and natural pitch
  // descents can put parts of the track below the ground plane, which
  // visually disappears (occluded) and physically traps the chassis under
  // ground. Shift everything — strips, checkpoints, spawn — by the same
  // amount so the layout is unchanged, just elevated as a whole.
  const TRACK_FLOOR_Y = 1.0;
  const shift = TRACK_FLOOR_Y - minY;
  if (Math.abs(shift) > 1e-6) {
    for (const xs of strips) {
      for (const cs of xs) {
        cs.tl.y += shift;
        cs.tr.y += shift;
        cs.bl.y += shift;
        cs.br.y += shift;
      }
    }
    for (const cp of checkpoints) cp.position.y += shift;
    spawn.position.y += shift;
    minY += shift;
  }

  // For closed loops, snap the LAST cross-section of the final strip to
  // exactly match the FIRST cross-section of the first strip. Any closure
  // error (in xz or y) gets absorbed into the slope of the very last
  // triangle pair — a small ramp on the final ~0.8 m of track — instead of
  // appearing as a vertical wall at the seam. With this snap the seam is
  // geometrically exact: ribbon end and start occupy the same vertices.
  if (def.closedLoop) {
    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < strips.length; i++) {
      if (strips[i].length >= 2) {
        if (firstIdx === -1) firstIdx = i;
        lastIdx = i;
      }
    }
    if (firstIdx !== -1 && lastIdx !== -1) {
      const firstCs = strips[firstIdx][0];
      const lastCs = strips[lastIdx][strips[lastIdx].length - 1];
      lastCs.tl.copy(firstCs.tl);
      lastCs.tr.copy(firstCs.tr);
      lastCs.bl.copy(firstCs.bl);
      lastCs.br.copy(firstCs.br);
    }
  }

  const collider = buildStripMeshes(scene, world, strips, def.closedLoop ?? false);

  return { spawn, checkpoints, finish, minY, collider, centerline };
}

function maybeRecordCheckpoint(
  def: TrackDef,
  segIdx: number,
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  seg: Segment,
  out: CheckpointMarker[],
): void {
  const cp = def.checkpoints.find((c) => c.afterSegmentIndex === segIdx);
  if (!cp) return;
  out.push({
    position: pos.clone(),
    quaternion: quat.clone(),
    width: seg.width,
    timeBonusSec: cp.timeBonusSec,
    isFinish: false,
  });
}

function buildStripMeshes(
  scene: THREE.Scene,
  world: RAPIER.World,
  strips: CrossSection[][],
  closedLoop: boolean,
): RAPIER.Collider | null {
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x5a6680,
    roughness: 0.7,
    metalness: 0.05,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x2c3340,
    roughness: 0.9,
    metalness: 0.0,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.55,
  });
  // Earth/dirt skirt extending from the ribbon down to the ground plane,
  // tapered outward at the base so the track reads as sitting on hills
  // rather than floating on stilts. Uses vertex colours (top = full
  // material colour, base = darkened) to fake ambient occlusion where the
  // hill meets the ground — gives hills visible 3D depth instead of
  // reading as flat-shaded slabs.
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x6b5235,
    roughness: 0.98,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  const SKIRT_TAPER = 0.3; // base spread per unit height (~17° slope)
  const SKIRT_BASE_DARKEN = 0.35; // vertex colour multiplier at the ground
  // Centre lane stripe — yellow line painted just above the track top so
  // it's easy to see where the lane curves over bumps and hills.
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  const STRIPE_WIDTH = 0.35;
  const STRIPE_RAISE = 0.02;

  // Combine all strips into a single trimesh collider — cheaper than one per strip.
  const allPositions: number[] = [];
  const allIndices: number[] = [];

  // For closed loops we skip the cap at the start/finish seam (first strip's
  // start and last strip's end) and add wrap-around triangles instead, so
  // the ribbon visually forms a continuous circuit.
  const validStripIndices: number[] = [];
  for (let i = 0; i < strips.length; i++) if (strips[i].length >= 2) validStripIndices.push(i);
  const firstValidStripIdx = validStripIndices[0] ?? -1;
  const lastValidStripIdx = validStripIndices[validStripIndices.length - 1] ?? -1;

  for (let stripIdx = 0; stripIdx < strips.length; stripIdx++) {
    const xs = strips[stripIdx];
    if (xs.length < 2) continue;
    const isFirstStrip = stripIdx === firstValidStripIdx;
    const isLastStrip = stripIdx === lastValidStripIdx;
    const skipStartCap = closedLoop && isFirstStrip;
    const skipEndCap = closedLoop && isLastStrip;

    // Each cross-section contributes 4 vertices in order: tl, tr, bl, br.
    // For sample i (0-indexed): tl = i*4, tr = i*4+1, bl = i*4+2, br = i*4+3.
    const topPositions: number[] = [];
    const topIndices: number[] = [];
    const bottomPositions: number[] = [];
    const bottomIndices: number[] = [];
    const sidePositions: number[] = [];
    const sideIndices: number[] = [];

    // Top + bottom share their vertex arrays separately for clean normals.
    for (const cs of xs) {
      topPositions.push(cs.tl.x, cs.tl.y, cs.tl.z, cs.tr.x, cs.tr.y, cs.tr.z);
      bottomPositions.push(cs.bl.x, cs.bl.y, cs.bl.z, cs.br.x, cs.br.y, cs.br.z);
    }
    for (let i = 0; i < xs.length - 1; i++) {
      const a = i * 2;     // tl[i] in top  (or bl[i] in bottom)
      const b = a + 1;     // tr[i]         (br[i])
      const c = a + 2;     // tl[i+1]       (bl[i+1])
      const d = a + 3;     // tr[i+1]       (br[i+1])
      topIndices.push(a, c, d, a, d, b);
      // Bottom: opposite winding so the outward normal points down.
      bottomIndices.push(a, d, c, a, b, d);
    }

    // Side walls: emit per-edge vertex pairs (top + bottom of the side
    // surface) so vertex normals on the wall don't blend with the top/bottom.
    for (const cs of xs) {
      // Left wall: top-left then bottom-left
      sidePositions.push(cs.tl.x, cs.tl.y, cs.tl.z, cs.bl.x, cs.bl.y, cs.bl.z);
    }
    const leftStart = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      const a = leftStart + i * 2;     // tl[i]
      const b = a + 1;                  // bl[i]
      const c = a + 2;                  // tl[i+1]
      const d = a + 3;                  // bl[i+1]
      // Outward (left) normal: (right axis) × (down) points left.
      // Winding chosen so the front face is the outward side.
      sideIndices.push(a, b, d, a, d, c);
    }
    const rightStart = sidePositions.length / 3;
    for (const cs of xs) {
      sidePositions.push(cs.tr.x, cs.tr.y, cs.tr.z, cs.br.x, cs.br.y, cs.br.z);
    }
    for (let i = 0; i < xs.length - 1; i++) {
      const a = rightStart + i * 2;     // tr[i]
      const b = a + 1;                   // br[i]
      const c = a + 2;                   // tr[i+1]
      const d = a + 3;                   // br[i+1]
      // Opposite winding from the left wall so the outward face points right.
      sideIndices.push(a, d, b, a, c, d);
    }

    // End caps (closes off the strip's ends so a gap looks like a real
    // ledge rather than an open slab). One cap at the first cross-section,
    // one at the last — except the seam-side caps on a closed loop, which
    // would otherwise look like walls at the start/finish line.
    const capPositions: number[] = [];
    const capIndices: number[] = [];
    if (!skipStartCap) pushCap(xs[0], capPositions, capIndices, /* isStart */ true);
    if (!skipEndCap) pushCap(xs[xs.length - 1], capPositions, capIndices, /* isStart */ false);

    // ---- Earth skirt: from the slab's bottom edges down to the ground ---
    // Two vertex pairs per cross-section: bl (top) → bl_ground (taper-out)
    // for the LEFT wall, br (top) → br_ground for the RIGHT wall. Plus an
    // end-cap quad at each strip end (except seam ends on closed loops).
    // Top vertices get colour (1,1,1); base vertices get (k,k,k) where k =
    // SKIRT_BASE_DARKEN so the material colour is darkened at the ground —
    // gives a fake AO gradient that reads as 3D depth on hills.
    const leftSkirtPos: number[] = [];
    const leftSkirtColors: number[] = [];
    const leftSkirtIdx: number[] = [];
    const rightSkirtPos: number[] = [];
    const rightSkirtColors: number[] = [];
    const rightSkirtIdx: number[] = [];
    const k = SKIRT_BASE_DARKEN;

    type GroundPoint = { lx: number; lz: number; rx: number; rz: number };
    const groundPoints: GroundPoint[] = [];

    for (const cs of xs) {
      // Outward-perpendicular direction in xz (right axis projected to ground).
      const dx = cs.tr.x - cs.tl.x;
      const dz = cs.tr.z - cs.tl.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const rx = len > 1e-6 ? dx / len : 1;
      const rz = len > 1e-6 ? dz / len : 0;

      const lHeight = Math.max(0, cs.bl.y);
      const rHeight = Math.max(0, cs.br.y);
      const lgx = cs.bl.x - rx * SKIRT_TAPER * lHeight;
      const lgz = cs.bl.z - rz * SKIRT_TAPER * lHeight;
      const rgx = cs.br.x + rx * SKIRT_TAPER * rHeight;
      const rgz = cs.br.z + rz * SKIRT_TAPER * rHeight;
      groundPoints.push({ lx: lgx, lz: lgz, rx: rgx, rz: rgz });

      leftSkirtPos.push(cs.bl.x, cs.bl.y, cs.bl.z, lgx, 0, lgz);
      leftSkirtColors.push(1, 1, 1, k, k, k);
      rightSkirtPos.push(cs.br.x, cs.br.y, cs.br.z, rgx, 0, rgz);
      rightSkirtColors.push(1, 1, 1, k, k, k);
    }
    for (let i = 0; i < xs.length - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      leftSkirtIdx.push(a, b, d, a, d, c);
      rightSkirtIdx.push(a, d, b, a, c, d);
    }

    // Skirt end caps at the non-seam ends of each strip.
    const skirtCapPos: number[] = [];
    const skirtCapColors: number[] = [];
    const skirtCapIdx: number[] = [];
    if (!skipStartCap) {
      const cs = xs[0];
      const gp = groundPoints[0];
      const base = skirtCapPos.length / 3;
      skirtCapPos.push(cs.bl.x, cs.bl.y, cs.bl.z);
      skirtCapPos.push(cs.br.x, cs.br.y, cs.br.z);
      skirtCapPos.push(gp.rx, 0, gp.rz);
      skirtCapPos.push(gp.lx, 0, gp.lz);
      skirtCapColors.push(1, 1, 1, 1, 1, 1, k, k, k, k, k, k);
      skirtCapIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (!skipEndCap) {
      const cs = xs[xs.length - 1];
      const gp = groundPoints[groundPoints.length - 1];
      const base = skirtCapPos.length / 3;
      skirtCapPos.push(cs.bl.x, cs.bl.y, cs.bl.z);
      skirtCapPos.push(cs.br.x, cs.br.y, cs.br.z);
      skirtCapPos.push(gp.rx, 0, gp.rz);
      skirtCapPos.push(gp.lx, 0, gp.lz);
      skirtCapColors.push(1, 1, 1, 1, 1, 1, k, k, k, k, k, k);
      skirtCapIdx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    // ---- Centre lane stripe (painted on the track top) ------------------
    const stripePos: number[] = [];
    const stripeIdx: number[] = [];
    for (const cs of xs) {
      const cx = (cs.tl.x + cs.tr.x) / 2;
      const cy = (cs.tl.y + cs.tr.y) / 2 + STRIPE_RAISE;
      const cz = (cs.tl.z + cs.tr.z) / 2;
      const dx = cs.tr.x - cs.tl.x;
      const dz = cs.tr.z - cs.tl.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const rx = len > 1e-6 ? dx / len : 1;
      const rz = len > 1e-6 ? dz / len : 0;
      stripePos.push(cx - rx * (STRIPE_WIDTH / 2), cy, cz - rz * (STRIPE_WIDTH / 2));
      stripePos.push(cx + rx * (STRIPE_WIDTH / 2), cy, cz + rz * (STRIPE_WIDTH / 2));
    }
    for (let i = 0; i < xs.length - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      stripeIdx.push(a, c, d, a, d, b);
    }

    // ---- Three.js meshes -------------------------------------------------
    addStripMesh(scene, topPositions, topIndices, topMat, true);
    addStripMesh(scene, bottomPositions, bottomIndices, sideMat, false);
    addStripMesh(scene, sidePositions, sideIndices, sideMat, false);
    addStripMesh(scene, capPositions, capIndices, sideMat, false);
    addColoredStripMesh(scene, leftSkirtPos, leftSkirtColors, leftSkirtIdx, skirtMat);
    addColoredStripMesh(scene, rightSkirtPos, rightSkirtColors, rightSkirtIdx, skirtMat);
    addColoredStripMesh(scene, skirtCapPos, skirtCapColors, skirtCapIdx, skirtMat);
    addStripMesh(scene, stripePos, stripeIdx, stripeMat, false);

    // Edge highlights along the top corners.
    addEdgeLine(scene, xs.map((cs) => cs.tl), edgeMat);
    addEdgeLine(scene, xs.map((cs) => cs.tr), edgeMat);

    // ---- Accumulate into the shared collider buffer ----------------------
    appendToCollider(allPositions, allIndices, topPositions, topIndices);
    appendToCollider(allPositions, allIndices, bottomPositions, bottomIndices);
    appendToCollider(allPositions, allIndices, sidePositions, sideIndices);
    appendToCollider(allPositions, allIndices, capPositions, capIndices);
  }

  // No wrap-around triangles needed — the closed-loop snap (done in
  // buildTrack before this is called) made the last cross-section coincide
  // with the first, so the strip end vertices and start vertices already
  // share the same world positions. The seam looks like a clean continuation.

  if (allPositions.length === 0) return null;

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  return world.createCollider(
    RAPIER.ColliderDesc.trimesh(
      new Float32Array(allPositions),
      new Uint32Array(allIndices),
    ).setFriction(1.1),
    body,
  );
}

function pushCap(
  cs: CrossSection,
  positions: number[],
  indices: number[],
  isStart: boolean,
): void {
  const base = positions.length / 3;
  positions.push(cs.tl.x, cs.tl.y, cs.tl.z);
  positions.push(cs.tr.x, cs.tr.y, cs.tr.z);
  positions.push(cs.br.x, cs.br.y, cs.br.z);
  positions.push(cs.bl.x, cs.bl.y, cs.bl.z);
  if (isStart) {
    // Start cap: outward face points back along the ribbon's local -forward.
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  } else {
    // End cap: outward face points forward, reversed winding.
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

function addStripMesh(
  scene: THREE.Scene,
  positions: number[],
  indices: number[],
  mat: THREE.Material,
  receiveShadow: boolean,
): void {
  if (positions.length === 0 || indices.length === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = receiveShadow;
  scene.add(mesh);
}

function addColoredStripMesh(
  scene: THREE.Scene,
  positions: number[],
  colors: number[],
  indices: number[],
  mat: THREE.Material,
): void {
  if (positions.length === 0 || indices.length === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function appendToCollider(
  outPositions: number[],
  outIndices: number[],
  positions: number[],
  indices: number[],
): void {
  const indexOffset = outPositions.length / 3;
  for (const v of positions) outPositions.push(v);
  for (const idx of indices) outIndices.push(idx + indexOffset);
}

function addEdgeLine(
  scene: THREE.Scene,
  points: THREE.Vector3[],
  mat: THREE.LineBasicMaterial,
): void {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  scene.add(new THREE.Line(geo, mat));
}
