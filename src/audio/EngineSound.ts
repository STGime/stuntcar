import { CarConfig } from '../vehicle/CarConfig';

/**
 * Procedural engine drone driven by Web Audio. A real CC0/original engine
 * loop replaces this at M10; for M3 we just want a sound whose pitch tracks
 * RPM and that wobbles on the rev limiter, without bundling any asset.
 *
 * Signal path: two detuned sawtooth oscillators (primary + octave) → lowpass
 * filter → master gain → destination. Frequency is the engine's firing rate
 * (rpm/30, the classic 4-stroke approximation), gain is throttle-weighted.
 *
 * The browser requires a user gesture to start audio, so call `start()` from
 * a key/click handler.
 */
export class EngineSound {
  private ctx: AudioContext | null = null;
  private oscPrimary: OscillatorNode | null = null;
  private oscOctave: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private started = false;
  private muted = false;

  private currentRpm: number = CarConfig.idleRpm;
  private targetThrottleGain = 0.0;
  private currentGain = 0.0;
  private limiterPhase = 0;

  /** Resume / create the audio context. Must be called from a user gesture. */
  start(): void {
    if (this.started) {
      this.ctx?.resume();
      return;
    }
    this.started = true;

    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.oscPrimary = this.ctx.createOscillator();
    this.oscPrimary.type = 'sawtooth';
    this.oscPrimary.frequency.value = rpmToHz(CarConfig.idleRpm);

    this.oscOctave = this.ctx.createOscillator();
    this.oscOctave.type = 'square';
    this.oscOctave.frequency.value = rpmToHz(CarConfig.idleRpm) * 2;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 700;
    this.filter.Q.value = 1.2;

    const octaveGain = this.ctx.createGain();
    octaveGain.gain.value = 0.18;

    const primaryGain = this.ctx.createGain();
    primaryGain.gain.value = 0.5;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.0;

    this.oscPrimary.connect(primaryGain).connect(this.filter);
    this.oscOctave.connect(octaveGain).connect(this.filter);
    this.filter.connect(this.gain).connect(this.ctx.destination);

    this.oscPrimary.start();
    this.oscOctave.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /** Per render frame: push current rpm/throttle into the audio graph. */
  update(dt: number, rpm: number, throttle: number, onLimiter: boolean): void {
    this.currentRpm = rpm;
    // Sound louder under load, quieter while coasting; never dead silent
    // because the idle should always be audible.
    this.targetThrottleGain = 0.18 + throttle * 0.55;

    if (!this.ctx || !this.oscPrimary || !this.oscOctave || !this.filter || !this.gain) return;

    let baseHz = rpmToHz(rpm);

    // Rev-limiter wobble: oscillate the frequency by a few percent at ~14 Hz
    // for the classic "bouncing off the limiter" sound.
    if (onLimiter) {
      this.limiterPhase += dt * 14 * Math.PI * 2;
      baseHz *= 1 + Math.sin(this.limiterPhase) * 0.04;
    } else {
      this.limiterPhase = 0;
    }

    const now = this.ctx.currentTime;
    // Use setTargetAtTime for smooth (artefact-free) parameter changes.
    this.oscPrimary.frequency.setTargetAtTime(baseHz, now, 0.02);
    this.oscOctave.frequency.setTargetAtTime(baseHz * 2, now, 0.02);

    // Open the filter as revs rise — gives a brighter "high RPM" timbre.
    const cutoff = 500 + (rpm / CarConfig.redlineRpm) * 1800;
    this.filter.frequency.setTargetAtTime(cutoff, now, 0.05);

    // Smooth master gain toward target (and toward 0 if muted).
    const target = this.muted ? 0 : this.targetThrottleGain;
    this.currentGain += (target - this.currentGain) * Math.min(1, dt * 6);
    this.gain.gain.setTargetAtTime(this.currentGain, now, 0.03);
  }

  /** Current RPM the sound is rendering (mostly for debugging). */
  get rpm(): number {
    return this.currentRpm;
  }
}

/** 4-stroke firing frequency: 2 power strokes per revolution, /60 → Hz. */
function rpmToHz(rpm: number): number {
  return rpm / 30;
}
