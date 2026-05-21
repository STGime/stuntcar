import { CarConfig } from '../vehicle/CarConfig';
// Vite handles `?url` on a .js asset: it copies the file to the output
// directory (hashed) and gives us the resolved URL string here. This
// is what AudioWorklet.addModule needs, and crucially it is base-aware
// — no breakage if we ever deploy under a sub-path.
import engineProcessorUrl from './engine-processor.js?url';

export type SoundProfile = 'combustion' | 'electric';

/**
 * Procedural drivetrain sound.
 *
 * Two implementations live in this class, picked at start() time:
 *
 *   - **AudioWorklet path** (`public/engine-processor.js`): synthesises
 *     saw + square + bandpass + lowpass entirely inside the audio thread.
 *     Emits non-zero samples every render block, which is what keeps iOS
 *     WebKit's audio renderer engaged. Preferred whenever AudioWorklet
 *     is available and the module loads.
 *
 *   - **OscillatorNode fallback**: the original BiquadFilter +
 *     OscillatorNode graph. Used when AudioWorklet is unavailable or
 *     `addModule` fails. Known to work on every browser EXCEPT iOS
 *     Safari/Chrome, where its master-gain-of-0-at-gesture-time pattern
 *     leaves the audio path parked.
 *
 * Both paths expose the same public API (start, setMuted, toggleMute,
 * setProfile, update, rpm). The Car layer doesn't know which is running.
 *
 * The browser requires a user gesture to start audio, so call `start()`
 * from a key/click handler.
 */
export class EngineSound {
  private ctx: AudioContext | null = null;

  // ── Worklet path ──────────────────────────────────────────────────────
  // The AudioWorkletNode itself is kept alive by its connection to
  // `ctx.destination`, so we only need the params bag here.
  private workletParams: {
    combGain: AudioParam;
    evGain: AudioParam;
    windGain: AudioParam;
    combHz: AudioParam;
    combCutoff: AudioParam;
    evHz: AudioParam;
    evCutoff: AudioParam;
    windCutoff: AudioParam;
  } | null = null;

  // ── OscillatorNode fallback ──────────────────────────────────────────
  private oscPrimary: OscillatorNode | null = null;
  private oscOctave: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private evOsc1: OscillatorNode | null = null;
  private evOsc2: OscillatorNode | null = null;
  private evFilter: BiquadFilterNode | null = null;
  private evGain: GainNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private profile: SoundProfile = 'combustion';
  private started = false;
  private muted = false;

  // Per-frame smoothed state (shared between worklet + fallback paths).
  private currentRpm: number = CarConfig.idleRpm;
  private currentSpeedKmh = 0;
  private currentGain = 0.0;
  private currentEvGain = 0;
  private currentWindGain = 0;
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
    // Firefox and mobile Chrome create new contexts in 'suspended' state;
    // without an explicit resume() the oscillators never produce sound.
    this.ctx.resume();

    // Try the worklet path; fall back to oscillators if it isn't available
    // or fails to load. addModule is async, so update() will simply no-op
    // on the worklet branch until the node is ready — the JS-side smoothing
    // fields keep tracking targets in the meantime.
    void this.tryStartWorklet().catch(() => {
      this.startOscillators();
    });
  }

  private async tryStartWorklet(): Promise<void> {
    if (!this.ctx?.audioWorklet) throw new Error('AudioWorklet not supported');
    await this.ctx.audioWorklet.addModule(engineProcessorUrl);
    const node = new AudioWorkletNode(this.ctx, 'engine-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const need = (name: string): AudioParam => {
      const ap = node.parameters.get(name);
      if (!ap) throw new Error(`Missing worklet param ${name}`);
      return ap;
    };
    this.workletParams = {
      combGain: need('combGain'),
      evGain: need('evGain'),
      windGain: need('windGain'),
      combHz: need('combHz'),
      combCutoff: need('combCutoff'),
      evHz: need('evHz'),
      evCutoff: need('evCutoff'),
      windCutoff: need('windCutoff'),
    };
    node.connect(this.ctx.destination);
  }

  private startOscillators(): void {
    if (!this.ctx) return;

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

    // ── Electric graph ──────────────────────────────────────────────────
    this.evOsc1 = this.ctx.createOscillator();
    this.evOsc1.type = 'sawtooth';
    this.evOsc1.frequency.value = 220;
    this.evOsc2 = this.ctx.createOscillator();
    this.evOsc2.type = 'sawtooth';
    this.evOsc2.frequency.value = 220 * 2.02;
    const evG1 = this.ctx.createGain();
    evG1.gain.value = 0.42;
    const evG2 = this.ctx.createGain();
    evG2.gain.value = 0.22;
    this.evFilter = this.ctx.createBiquadFilter();
    this.evFilter.type = 'bandpass';
    this.evFilter.frequency.value = 240;
    this.evFilter.Q.value = 3.5;
    this.evGain = this.ctx.createGain();
    this.evGain.gain.value = 0;
    this.evOsc1.connect(evG1).connect(this.evFilter);
    this.evOsc2.connect(evG2).connect(this.evFilter);
    this.evFilter.connect(this.evGain).connect(this.ctx.destination);
    this.evOsc1.start();
    this.evOsc2.start();

    // ── Wind layer ──────────────────────────────────────────────────────
    const sampleRate = this.ctx.sampleRate;
    const windBuffer = this.ctx.createBuffer(1, sampleRate * 2, sampleRate);
    const data = windBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.windSource = this.ctx.createBufferSource();
    this.windSource.buffer = windBuffer;
    this.windSource.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.4;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSource.connect(this.windFilter).connect(this.windGain).connect(this.ctx.destination);
    this.windSource.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /** Switch between combustion and electric sound. The unused profile's
   *  gain ramps to zero so we don't hear two engines at once. */
  setProfile(profile: SoundProfile): void {
    this.profile = profile;
  }

  /** Per render frame: push current rpm/throttle into the audio graph. */
  update(
    dt: number,
    rpm: number,
    throttle: number,
    onLimiter: boolean,
    speedKmh: number = this.currentSpeedKmh,
  ): void {
    this.currentRpm = rpm;
    this.currentSpeedKmh = speedKmh;
    if (!this.ctx) return;

    // Sound louder under load, quieter while coasting; never dead silent
    // because the idle should always be audible.
    const targetThrottleGain = 0.18 + throttle * 0.55;

    let baseHz = rpmToHz(rpm);
    // Rev-limiter wobble.
    if (onLimiter) {
      this.limiterPhase += dt * 14 * Math.PI * 2;
      baseHz *= 1 + Math.sin(this.limiterPhase) * 0.04;
    } else {
      this.limiterPhase = 0;
    }
    // Open the filter as revs rise.
    const cutoff = 500 + (rpm / CarConfig.redlineRpm) * 1800;

    // Combustion master gain: JS-side smoothing.
    const combustionTarget =
      this.muted || this.profile !== 'combustion' ? 0 : targetThrottleGain;
    this.currentGain += (combustionTarget - this.currentGain) * Math.min(1, dt * 6);

    // EV motor whine: pitch = 220 + speedKmh*8.
    const evHz = 220 + Math.max(0, this.currentSpeedKmh) * 8;
    const speedGate = Math.min(1, Math.max(0, this.currentSpeedKmh - 2) / 30);
    const evTarget =
      this.muted || this.profile !== 'electric'
        ? 0
        : (0.10 + throttle * 0.32) * speedGate;
    this.currentEvGain += (evTarget - this.currentEvGain) * Math.min(1, dt * 5);

    // Wind layer — silent at idle, audible ~60 km/h, loud past ~150 km/h.
    const speedRef = Math.max(0, this.currentSpeedKmh) / 100;
    const windTarget = this.muted ? 0 : Math.min(0.32, speedRef * speedRef * 0.45);
    this.currentWindGain += (windTarget - this.currentWindGain) * Math.min(1, dt * 4);
    const windCutoff = 300 + Math.min(900, speedRef * 600);

    const now = this.ctx.currentTime;

    if (this.workletParams) {
      // Worklet path: all params live on a single AudioWorkletNode.
      const p = this.workletParams;
      p.combHz.setTargetAtTime(baseHz, now, 0.02);
      p.combCutoff.setTargetAtTime(cutoff, now, 0.05);
      p.combGain.setTargetAtTime(this.currentGain, now, 0.03);
      p.evHz.setTargetAtTime(evHz, now, 0.04);
      p.evCutoff.setTargetAtTime(evHz, now, 0.04);
      p.evGain.setTargetAtTime(this.currentEvGain, now, 0.04);
      p.windCutoff.setTargetAtTime(windCutoff, now, 0.1);
      p.windGain.setTargetAtTime(this.currentWindGain, now, 0.05);
      return;
    }

    // OscillatorNode fallback path.
    if (this.oscPrimary && this.oscOctave && this.filter && this.gain) {
      this.oscPrimary.frequency.setTargetAtTime(baseHz, now, 0.02);
      this.oscOctave.frequency.setTargetAtTime(baseHz * 2, now, 0.02);
      this.filter.frequency.setTargetAtTime(cutoff, now, 0.05);
      this.gain.gain.setTargetAtTime(this.currentGain, now, 0.03);
    }
    if (this.evOsc1 && this.evOsc2 && this.evFilter && this.evGain) {
      this.evOsc1.frequency.setTargetAtTime(evHz, now, 0.04);
      this.evOsc2.frequency.setTargetAtTime(evHz * 2.02, now, 0.04);
      this.evFilter.frequency.setTargetAtTime(evHz, now, 0.04);
      this.evGain.gain.setTargetAtTime(this.currentEvGain, now, 0.04);
    }
    if (this.windGain && this.windFilter) {
      this.windGain.gain.setTargetAtTime(this.currentWindGain, now, 0.05);
      this.windFilter.frequency.setTargetAtTime(windCutoff, now, 0.1);
    }
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
