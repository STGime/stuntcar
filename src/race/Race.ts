import type * as THREE from 'three';
import { Checkpoints } from './Checkpoints';
import { RaceTimer } from './RaceTimer';
import type { BuiltTrack } from '../track/TrackBuilder';
import type { TrackDef } from '../track/TrackTypes';
import type { Car } from '../vehicle/Car';

export type RaceState = 'racing' | 'timeup' | 'finished';

export interface RaceSnapshot {
  state: RaceState;
  remainingSec: number;
  elapsedSec: number;
  passed: number;
  total: number;
  bestTimeSec: number | null;
  /** Finish result (only set in `finished`). */
  finishTimeSec: number | null;
  /** True if `finishTimeSec` beat the previous best on this track. */
  newBest: boolean;
}

/** Wraps `RaceTimer` + `Checkpoints` for a single track run. Owns run state. */
export class Race {
  state: RaceState = 'racing';
  readonly checkpoints: Checkpoints;
  readonly timer: RaceTimer;
  private finishTimeSec: number | null = null;
  private newBest = false;
  private bestTimeSec: number | null;

  constructor(
    private readonly def: TrackDef,
    private readonly track: BuiltTrack,
    private readonly car: Car,
    scene: THREE.Scene,
  ) {
    this.checkpoints = new Checkpoints(scene, track.checkpoints);
    this.timer = new RaceTimer(def.startCountdownSec);
    this.bestTimeSec = loadBestTime(def.id);
  }

  /** Reset and begin a fresh run. */
  start(): void {
    this.timer.reset();
    this.checkpoints.reset();
    this.finishTimeSec = null;
    this.newBest = false;
    this.state = 'racing';

    this.car.setSpawn(this.track.spawn.position, this.track.spawn.quaternion);
    this.car.resetToSpawn();

    // SPEC: M9 adds the 3-2-1-GO countdown overlay. For M5 the timer starts
    // immediately on `start()`.
    this.timer.setPaused(false);
  }

  /**
   * Reset car to the last passed checkpoint (or spawn if none). Used by
   * the manual `R` key and by the M6 crash system. Does not pause the timer.
   *
   * The forward offset clears the gate sensor so the chassis isn't
   * straddling it on respawn.
   */
  resetToLastCheckpoint(): void {
    const cp = this.checkpoints.lastPassedSpawn();
    if (cp) {
      this.car.setSpawn(cp.position, cp.quaternion, undefined, 4);
    } else {
      this.car.setSpawn(this.track.spawn.position, this.track.spawn.quaternion);
    }
    this.car.resetToSpawn();
  }

  /** Pause/resume the countdown — used by CrashSystem during a wreck. */
  pauseTimer(): void {
    this.timer.setPaused(true);
  }
  resumeTimer(): void {
    if (this.state === 'racing') this.timer.setPaused(false);
  }

  /** Per fixed physics step. */
  update(dt: number): void {
    if (this.state !== 'racing') return;

    this.timer.update(dt);

    const event = this.checkpoints.update(this.car.chassisBody);
    if (event) {
      this.timer.addBonus(event.timeBonusSec);
      if (event.isFinish) {
        this.finishTimeSec = this.timer.elapsed;
        this.newBest = this.bestTimeSec === null || this.finishTimeSec < this.bestTimeSec;
        if (this.newBest) {
          this.bestTimeSec = this.finishTimeSec;
          saveBestTime(this.def.id, this.finishTimeSec);
        }
        this.state = 'finished';
        this.timer.setPaused(true);
        return;
      }
    }

    if (this.timer.isTimeUp()) {
      this.state = 'timeup';
      this.timer.setPaused(true);
    }
  }

  snapshot(): RaceSnapshot {
    return {
      state: this.state,
      remainingSec: this.timer.remaining,
      elapsedSec: this.timer.elapsed,
      passed: this.checkpoints.passed,
      total: this.checkpoints.total,
      bestTimeSec: this.bestTimeSec,
      finishTimeSec: this.finishTimeSec,
      newBest: this.newBest,
    };
  }
}

function bestTimeKey(trackId: string): string {
  return `stuntline:bestTime:${trackId}`;
}

function loadBestTime(trackId: string): number | null {
  try {
    const raw = localStorage.getItem(bestTimeKey(trackId));
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function saveBestTime(trackId: string, time: number): void {
  try {
    localStorage.setItem(bestTimeKey(trackId), String(time));
  } catch {
    /* ignore quota / private-mode errors */
  }
}
