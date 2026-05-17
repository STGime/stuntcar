/**
 * Race timer for one run.
 *
 * Holds a downward-counting `remaining` (seconds) — passing a checkpoint adds
 * `timeBonusSec` to it. `elapsed` tracks total wall-clock from the start of
 * the run and is the figure shown on the result screen / written to best-time.
 *
 * `paused` is honoured by `update(dt)`. Countdown (3-2-1-GO) and Replay (M7)
 * will both set this flag while the run is on hold.
 */
export class RaceTimer {
  remaining: number;
  elapsed = 0;
  paused = true;
  readonly startSeconds: number;

  constructor(startSeconds: number) {
    this.startSeconds = startSeconds;
    this.remaining = startSeconds;
  }

  /** Resume / pause the countdown. */
  setPaused(p: boolean): void {
    this.paused = p;
  }

  /** Reset to the starting countdown value with no elapsed time. */
  reset(): void {
    this.remaining = this.startSeconds;
    this.elapsed = 0;
    this.paused = true;
  }

  /** Advance the timer one physics step. */
  update(dt: number): void {
    if (this.paused) return;
    this.remaining = Math.max(0, this.remaining - dt);
    this.elapsed += dt;
  }

  addBonus(seconds: number): void {
    this.remaining += seconds;
  }

  /** True the moment the countdown hits zero (caller decides what happens). */
  isTimeUp(): boolean {
    return this.remaining <= 0;
  }
}
