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

/** iOS Safari/Chrome quirk: a new AudioContext is "unlocked" only after
 *  a buffer-source has been played from inside a user gesture. Without
 *  this, the context resumes but outputs silence. */
export function iosUnlock(ctx: AudioContext): void {
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* nothing we can do */
  }
}

export class Sfx {
  private ctx: AudioContext | null = null;
  // Sustained tire-screech graph (built once on `start`).
  private screechGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;

  start(): void {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);
      this.buildScreech();
      iosUnlock(this.ctx);
    }
    // Always try to resume — modern browsers create contexts in 'suspended'
    // state when not under an interactive gesture chain.
    this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : 1,
        this.ctx.currentTime,
        0.04,
      );
    }
  }

  private output(): AudioNode {
    return this.masterGain ?? this.ctx!.destination;
  }

  /** Build the persistent tire-screech graph: bandpass-filtered noise mixed
   *  with a high-pitched sawtooth, all gated by a master `screechGain` so
   *  the FX loop can fade in/out smoothly. */
  private buildScreech(): void {
    if (!this.ctx) return;
    // White-noise buffer (2 s).
    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseBp = this.ctx.createBiquadFilter();
    noiseBp.type = 'bandpass';
    noiseBp.frequency.value = 2100;
    noiseBp.Q.value = 2.0; // wider band so more of the screech energy passes

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 740;
    const oscBp = this.ctx.createBiquadFilter();
    oscBp.type = 'bandpass';
    oscBp.frequency.value = 760;
    oscBp.Q.value = 2.0;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 1.0;
    const oscGain = this.ctx.createGain();
    oscGain.gain.value = 0.45;

    const master = this.ctx.createGain();
    master.gain.value = 0;

    noise.connect(noiseBp).connect(noiseGain).connect(master);
    osc.connect(oscBp).connect(oscGain).connect(master);
    master.connect(this.output());

    noise.start();
    osc.start();
    this.screechGain = master;
  }

  /**
   * Drive the sustained tire-screech volume. `t` ∈ [0, 1]: 0 = silent,
   * 1 = full screech. Caller should pass slip intensity (matching the FX
   * trigger) once per render frame. Internal smoothing avoids clicks.
   */
  setScreech(t: number): void {
    if (!this.ctx || !this.screechGain) return;
    const target = Math.max(0, Math.min(1, t)) * 0.55;
    // 50 ms time-constant on the gain ramp → no audible clicks but quick
    // enough to track a brief slip.
    this.screechGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
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

  /** Quick ascending arpeggio — collected a pickup. */
  pickup(): void {
    const now = this.ctx?.currentTime ?? 0;
    this.tone(880, 0.10, 0.18, now);
    this.tone(1175, 0.10, 0.18, now + 0.05);
    this.tone(1568, 0.14, 0.22, now + 0.10);
  }

  /** Bandpass noise burst — drove over a hazard. */
  hazard(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.3, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.32, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    noise.connect(bp).connect(g).connect(this.output());
    noise.start(now);
    noise.stop(now + 0.32);
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
    osc.connect(gain).connect(this.output());
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
    osc.connect(g).connect(this.output());
    osc.start(now);
    osc.stop(now + durSec + 0.02);
  }
}
