import { CarConfig } from '../vehicle/CarConfig';

export type SoundProfile = 'combustion' | 'electric';

/**
 * Procedural drivetrain sound. Two parallel graphs are built once on
 * `start()`:
 *
 *   - **combustion**: two detuned saw/square oscillators → lowpass filter,
 *     pitched by RPM (rpm/30 = 4-stroke firing rate). Wobbles on the rev
 *     limiter. The original gas-car drone.
 *   - **electric**: two detuned saws → tight bandpass filter, pitched
 *     `220 + speedKmh * 8` Hz so the whine rises with road speed. Idle is
 *     silent (no whine at standstill, like a real EV).
 *
 * Both share the wind/road-rumble layer below. `setProfile('electric')`
 * mutes one graph's master and unmutes the other.
 *
 * The browser requires a user gesture to start audio, so call `start()` from
 * a key/click handler.
 */
export class EngineSound {
  private ctx: AudioContext | null = null;
  // ── Combustion graph ──────────────────────────────────────────────────
  private oscPrimary: OscillatorNode | null = null;
  private oscOctave: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  // ── Electric graph ────────────────────────────────────────────────────
  private evOsc1: OscillatorNode | null = null;
  private evOsc2: OscillatorNode | null = null;
  private evFilter: BiquadFilterNode | null = null;
  private evGain: GainNode | null = null;
  private currentEvGain = 0.001;
  private profile: SoundProfile = 'combustion';
  // Wind layer — pink-ish noise buffer through a lowpass, volume scales
  // with speed² so it's silent at idle and a clear whoosh above ~60 km/h.
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private currentWindGain = 0.001;
  private started = false;
  private muted = false;

  private currentRpm: number = CarConfig.idleRpm;
  private targetThrottleGain = 0.0;
  // Seeded to combustion idle (matches `0.18 + 0*0.55` in update()) so the
  // gain AudioParam can start at a real audible value at gesture time,
  // without being immediately yanked back down by JS-side smoothing on the
  // first update() call. iOS WebKit only keeps a continuous audio path
  // alive if it produced non-zero samples inside the user-gesture window.
  private currentGain = 0.18;
  private limiterPhase = 0;
  private currentSpeedKmh = 0;

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

    // Seed JS-side smoothed gains to match the initial AudioParam values
    // we're about to set on the graph, so the first update() doesn't drag
    // the gain back toward zero on the next frame (which would cause an
    // audible dip-and-rise in combustion, or a stray combustion blip on
    // EV start).
    this.currentGain = this.profile === 'combustion' ? 0.18 : 0;
    this.currentEvGain = 0;
    this.currentWindGain = 0;

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
    // Start at the combustion idle target IF this is a combustion car —
    // gives the engine path real audible samples during the user-gesture
    // window so iOS WebKit commits the audio path. For an EV, keep it
    // sub-audible (we don't want a 100 ms combustion blip on EV start).
    this.gain.gain.value = this.profile === 'combustion' ? 0.18 : 0.001;

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
    this.evOsc2.frequency.value = 220 * 2.02; // detuned octave
    const evG1 = this.ctx.createGain();
    evG1.gain.value = 0.42;
    const evG2 = this.ctx.createGain();
    evG2.gain.value = 0.22;
    this.evFilter = this.ctx.createBiquadFilter();
    this.evFilter.type = 'bandpass';
    this.evFilter.frequency.value = 240;
    this.evFilter.Q.value = 3.5;
    this.evGain = this.ctx.createGain();
    // Same idea as the combustion gain — give the EV path real samples at
    // gesture time when an EV is selected. Briefly audible whine, then
    // update()'s speedGate ramps it to 0 over ~80 ms at standstill.
    this.evGain.gain.value = this.profile === 'electric' ? 0.05 : 0.001;
    this.evOsc1.connect(evG1).connect(this.evFilter);
    this.evOsc2.connect(evG2).connect(this.evFilter);
    this.evFilter.connect(this.evGain).connect(this.ctx.destination);
    this.evOsc1.start();
    this.evOsc2.start();

    // ── Wind layer ──────────────────────────────────────────────────────
    // 2 s buffer of white noise looped. The lowpass shapes it toward a
    // wind/rumble timbre; gain follows speed (set per frame in update()).
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
    this.windGain.gain.value = 0.001;
    this.windSource.connect(this.windFilter).connect(this.windGain).connect(this.ctx.destination);
    this.windSource.start();

    // Diagnostic hook for Safari Web Inspector over USB on iOS — lets the
    // remote console read ctx.state / currentTime / gain values if the
    // engine ever goes silent again.
    (window as unknown as { __engineCtx?: AudioContext }).__engineCtx = this.ctx;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /** Switch between combustion and electric sound. The unused graph's
   *  master gain ramps to zero so we don't hear two engines at once. */
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

    // Smooth master gain toward target. The INACTIVE profile's gain ramps
    // toward zero, the ACTIVE one toward its throttle-weighted target.
    const combustionTarget =
      this.muted || this.profile !== 'combustion' ? 0 : this.targetThrottleGain;
    this.currentGain += (combustionTarget - this.currentGain) * Math.min(1, dt * 6);
    this.gain.gain.setTargetAtTime(this.currentGain, now, 0.03);

    // EV motor whine: pitch = 220 + speedKmh*8, gain swells with throttle
    // but stays audible while coasting. Silent at standstill.
    if (this.evOsc1 && this.evOsc2 && this.evFilter && this.evGain) {
      const evHz = 220 + Math.max(0, this.currentSpeedKmh) * 8;
      this.evOsc1.frequency.setTargetAtTime(evHz, now, 0.04);
      this.evOsc2.frequency.setTargetAtTime(evHz * 2.02, now, 0.04);
      this.evFilter.frequency.setTargetAtTime(evHz, now, 0.04);
      // Throttle-weighted; speed-gated so the whine starts only once the
      // car is moving (real EVs are silent at standstill).
      const speedGate = Math.min(1, Math.max(0, this.currentSpeedKmh - 2) / 30);
      const evTarget =
        this.muted || this.profile !== 'electric'
          ? 0
          : (0.10 + throttle * 0.32) * speedGate;
      this.currentEvGain += (evTarget - this.currentEvGain) * Math.min(1, dt * 5);
      this.evGain.gain.setTargetAtTime(this.currentEvGain, now, 0.04);
    }

    // Wind layer — silent at idle, audible ~60 km/h, loud past ~150 km/h.
    if (this.windGain && this.windFilter) {
      const speedRef = Math.max(0, this.currentSpeedKmh) / 100;
      const windTarget = this.muted ? 0 : Math.min(0.32, speedRef * speedRef * 0.45);
      this.currentWindGain += (windTarget - this.currentWindGain) * Math.min(1, dt * 4);
      this.windGain.gain.setTargetAtTime(this.currentWindGain, now, 0.05);
      // Cutoff opens a bit with speed for a brighter rush of air.
      const windCutoff = 300 + Math.min(900, speedRef * 600);
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
