/**
 * Procedural one-shot SFX via Web Audio. Used by the countdown (beeps),
 * checkpoint pass (chime), and finish jingle. Spec §5.9: "one-shots".
 *
 * Built procedurally (sine bursts with an attack/decay envelope) so no
 * external audio files are needed. A CC0 sample bank can replace these in
 * M10 — keep the API the same and they'll plug in.
 *
 * Audio needs a user gesture to start. The same gesture that starts
 * `EngineSound` resumes the context for Sfx too.
 */
export class Sfx {
  private ctx: AudioContext | null = null;

  start(): void {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
  }

  /** Short, low-pitched tick — used for countdown 3, 2, 1. */
  shortBeep(): void {
    this.tone(660, 0.12, 0.18);
  }

  /** Longer, higher-pitched go signal — used for countdown "GO!". */
  longBeep(): void {
    this.tone(1320, 0.4, 0.25);
  }

  /** Bright chime — used when the chassis crosses a checkpoint. */
  chime(): void {
    const now = this.ctx?.currentTime ?? 0;
    this.tone(880, 0.18, 0.18, now);
    this.tone(1320, 0.18, 0.14, now + 0.04);
  }

  /** Brief downward sweep — used on a wreck. */
  crashThud(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.35);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.45);
  }

  private tone(freq: number, durSec: number, gain: number, startAt?: number): void {
    if (!this.ctx) return;
    const now = startAt ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    // Attack-decay envelope so the tone doesn't click.
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + durSec);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + durSec + 0.02);
  }
}
