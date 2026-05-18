import type * as THREE from 'three';
import { Checkpoints } from './Checkpoints';
import { RaceTimer } from './RaceTimer';
import type { BuiltTrack } from '../track/TrackBuilder';
import type { TrackDef } from '../track/TrackTypes';
import type { Car } from '../vehicle/Car';

export type RaceState = 'countdown' | 'racing' | 'timeup' | 'finished';

/** What the countdown is currently showing: 3, 2, 1, GO, or null when not in countdown. */
export type CountdownPhase = 3 | 2 | 1 | 'GO' | null;

export interface RaceSnapshot {
  state: RaceState;
  remainingSec: number;
  elapsedSec: number;
  passed: number;
  total: number;
  /** Current lap (1..totalLaps). */
  currentLap: number;
  /** Laps required to finish. */
  totalLaps: number;
  bestTimeSec: number | null;
  /** Finish result (only set in `finished`). */
  finishTimeSec: number | null;
  /** True if `finishTimeSec` beat the previous best on this track. */
  newBest: boolean;
  /** Current countdown digit (null when not counting down). */
  countdownPhase: CountdownPhase;
}

const DEFAULT_TOTAL_LAPS = 3;

/** Total countdown duration: 3, 2, 1, GO at 1s each. */
const COUNTDOWN_PHASE_SEC = 1.0;
const COUNTDOWN_TOTAL_SEC = COUNTDOWN_PHASE_SEC * 4; // 3, 2, 1, GO

/** Wraps `RaceTimer` + `Checkpoints` for a single track run. Owns run state. */
export class Race {
  state: RaceState = 'countdown';
  readonly checkpoints: Checkpoints;
  readonly timer: RaceTimer;
  readonly totalLaps: number;
  readonly lapBonusSec: number;
  currentLap = 1;
  private finishTimeSec: number | null = null;
  private newBest = false;
  private bestTimeSec: number | null;
  private countdownElapsed = 0;
  private lastCountdownPhase: CountdownPhase = null;
  /** Fired when the countdown digit changes (caller plays beep / GO sfx). */
  onCountdownTick: (phase: CountdownPhase) => void = () => {};
  /** Fired when a lap is completed (i.e. finish line crossed before the
   *  final lap). Argument is the new lap number (2..totalLaps). */
  onLapComplete: (newLap: number) => void = () => {};

  constructor(
    private readonly def: TrackDef,
    private readonly track: BuiltTrack,
    private readonly car: Car,
    scene: THREE.Scene,
  ) {
    this.checkpoints = new Checkpoints(scene, track.checkpoints);
    this.timer = new RaceTimer(def.startCountdownSec);
    this.bestTimeSec = loadBestTime(def.id);
    this.totalLaps = def.totalLaps ?? DEFAULT_TOTAL_LAPS;
    this.lapBonusSec = def.lapBonusSec ?? 0;
  }

  /** Reset and begin a fresh run (in countdown state). */
  start(): void {
    this.timer.reset();
    this.checkpoints.reset();
    this.finishTimeSec = null;
    this.newBest = false;
    this.state = 'countdown';
    this.currentLap = 1;
    this.countdownElapsed = 0;
    this.lastCountdownPhase = null;

    this.car.setSpawn(this.track.spawn.position, this.track.spawn.quaternion);
    this.car.resetToSpawn();
    this.timer.setPaused(true);
  }

  /** True while the countdown is showing — caller should skip physics + input. */
  get isCountdown(): boolean {
    return this.state === 'countdown';
  }

  countdownPhase(): CountdownPhase {
    if (this.state !== 'countdown') return null;
    // Phases 3, 2, 1 each take COUNTDOWN_PHASE_SEC, then GO takes another.
    if (this.countdownElapsed < COUNTDOWN_PHASE_SEC) return 3;
    if (this.countdownElapsed < COUNTDOWN_PHASE_SEC * 2) return 2;
    if (this.countdownElapsed < COUNTDOWN_PHASE_SEC * 3) return 1;
    return 'GO';
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
    if (this.state === 'countdown') {
      this.countdownElapsed += dt;
      const phase = this.countdownPhase();
      if (phase !== this.lastCountdownPhase) {
        this.lastCountdownPhase = phase;
        this.onCountdownTick(phase);
      }
      if (this.countdownElapsed >= COUNTDOWN_TOTAL_SEC) {
        this.state = 'racing';
        this.timer.setPaused(false);
      }
      return;
    }
    if (this.state !== 'racing') return;

    this.timer.update(dt);

    const event = this.checkpoints.update(this.car.chassisBody);
    if (event) {
      this.timer.addBonus(event.timeBonusSec);
      if (event.isFinish) {
        if (this.currentLap < this.totalLaps) {
          // Lap completed but the race continues — wrap the gate cursor and
          // top up the timer with the lap bonus.
          this.currentLap += 1;
          this.timer.addBonus(this.lapBonusSec);
          this.checkpoints.resetForNextLap();
          this.onLapComplete(this.currentLap);
        } else {
          // Final lap finished — record the result.
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
      currentLap: this.currentLap,
      totalLaps: this.totalLaps,
      bestTimeSec: this.bestTimeSec,
      finishTimeSec: this.finishTimeSec,
      newBest: this.newBest,
      countdownPhase: this.countdownPhase(),
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
