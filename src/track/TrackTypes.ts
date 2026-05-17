/**
 * Tracks are data: a TrackDef is a list of `Segment`s that TrackBuilder walks
 * to lay out a continuous ribbon (with optional gaps and orientation changes).
 * Checkpoints reference segment indices.
 */
export type SegmentKind =
  | 'straight'
  | 'rampUp'
  | 'rampDown'
  | 'gap'
  | 'loop'
  | 'bankedCurve'
  | 'corkscrew'
  | 'narrow';

export interface Segment {
  kind: SegmentKind;
  /** Distance the path advances over this segment (metres). */
  length: number;
  /** Track width at this segment (metres). */
  width: number;
  /** Total heading change over the segment (radians). +Y is up; +turn rotates left. */
  turn?: number;
  /** Total pitch change over the segment (radians). +pitch tilts the nose up. */
  pitch?: number;
  /** Banking roll for banked curves (radians). +bank rolls the track to the right. */
  bank?: number;
  /**
   * For `loop` segments: how far (metres) the loop's exit is from its entry
   * along the entry-forward axis. Turns a closed vertical circle into a
   * forward-leaning helix so the car can actually enter/exit the loop.
   * Defaults to ~15 % of `length` if omitted.
   */
  forwardAdvance?: number;
  /** True if this section is elevated — leaving it sideways = fall (M6). */
  elevated: boolean;
  /** True if drivable ground sits beside the track here (used by M6). */
  groundBeside?: boolean;
}

export interface Checkpoint {
  /** Gate sits at the end of this segment. */
  afterSegmentIndex: number;
  /** Seconds added to the countdown when the gate is passed. */
  timeBonusSec: number;
}

export interface TrackDef {
  id: string;
  /** Original (non-branded) name, e.g. "Skyline Run". */
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Initial countdown value (seconds). */
  startCountdownSec: number;
  /** Spawn elevation (metres). Defaults to 1. */
  spawnY?: number;
  segments: Segment[];
  checkpoints: Checkpoint[];
  /** Segment index whose end is the finish line. */
  finishAfterSegmentIndex: number;
  /**
   * If true, the track is a closed circuit — TrackBuilder skips the end
   * caps at the start/finish seam and adds wrap-around triangles connecting
   * the last cross-section of the final strip back to the first
   * cross-section of the first strip, so the ribbon visually closes.
   */
  closedLoop?: boolean;
}
