import type { ReplayFrame } from './ReplayRecorder';

export type ReplayKind = 'crash' | 'highlight';

/**
 * Plays back a frozen list of `ReplayFrame`s at real-time speed.
 *
 * The player itself is just a clock + frame-index advancer. The caller hands
 * the current frame to the car (`car.renderReplay(frame)`) and the cinematic
 * camera each render tick. On completion, `onDone()` fires once.
 *
 * Spec §5.8: Recording transforms (not re-simulating) is the required
 * approach — the player never touches physics.
 */
export class ReplayPlayer {
  active = false;
  kind: ReplayKind = 'crash';

  private frames: ReplayFrame[] = [];
  private elapsedSec = 0;
  private frameIndex = 0;
  private onDone: () => void = noop;
  private readonly fixedDt: number;

  constructor(fixedDt = 1 / 60) {
    this.fixedDt = fixedDt;
  }

  /** Start playback. `frames` must be the frozen tail of the ring buffer. */
  play(frames: ReplayFrame[], kind: ReplayKind, onDone: () => void): void {
    if (frames.length < 2) {
      // Nothing meaningful to play — fire the callback immediately.
      onDone();
      return;
    }
    this.frames = frames;
    this.kind = kind;
    this.elapsedSec = 0;
    this.frameIndex = 0;
    this.onDone = onDone;
    this.active = true;
  }

  /** Skip to the end immediately. */
  skip(): void {
    if (!this.active) return;
    this.complete();
  }

  /** Per render frame; advances the playback clock. Returns true if it ended. */
  update(frameDt: number): boolean {
    if (!this.active) return false;
    this.elapsedSec += frameDt;
    const max = this.frames.length - 1;
    const idx = Math.min(max, Math.floor(this.elapsedSec / this.fixedDt));
    this.frameIndex = idx;
    if (idx >= max) {
      this.complete();
      return true;
    }
    return false;
  }

  /** Current frame to render. Caller passes this to `car.renderReplay(...)`. */
  currentFrame(): ReplayFrame {
    return this.frames[this.frameIndex];
  }

  private complete(): void {
    const cb = this.onDone;
    this.active = false;
    this.frames = [];
    this.elapsedSec = 0;
    this.frameIndex = 0;
    this.onDone = noop;
    cb();
  }
}

function noop(): void {
  /* no-op */
}
