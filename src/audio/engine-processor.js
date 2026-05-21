// AudioWorklet processor that synthesises the engine drone entirely
// in the audio thread. Runs in AudioWorkletGlobalScope — no imports,
// no DOM, no `window`.
//
// Why this exists: the OscillatorNode-based graph stays silent on iOS
// Safari/Chrome — its master gain starts at 0 and iOS's renderer
// appears to park audio paths that haven't emitted non-zero samples.
// `process()` here runs every render block regardless, AND we add a
// permanent low-amplitude noise floor below so the output is never
// exactly zero even when every gain is 0 (mute, or EV at standstill).
//
// Signal graph (all in one processor):
//
//   combustion saw  ─┐
//   combustion sqr  ─┴─► biquad LP (Q≈1.2) ─► × combGain ─┐
//   EV saw 1        ─┐                                    │
//   EV saw 2        ─┴─► biquad BP (Q≈3.5) ─► × evGain   ─┼─► + ε noise ─► tanh ─► out
//   white noise      ─► biquad LP (Q≈0.4) ─► × windGain  ─┘
//
// All eight params are k-rate: smoothing is done on the main side via
// setTargetAtTime so values change once per 128-sample block, which is
// plenty for the per-frame update() cadence and keeps the worklet's
// inner loop cheap.

// Noise-floor amplitude. -100 dB (1e-5) — well below audibility,
// well above any plausible "is this silence" threshold the audio
// renderer might apply when deciding whether to park the path.
const NOISE_FLOOR = 1e-5;

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'combGain',   defaultValue: 0,    automationRate: 'k-rate' },
      { name: 'evGain',     defaultValue: 0,    automationRate: 'k-rate' },
      { name: 'windGain',   defaultValue: 0,    automationRate: 'k-rate' },
      { name: 'combHz',     defaultValue: 30,   automationRate: 'k-rate' },
      { name: 'combCutoff', defaultValue: 700,  automationRate: 'k-rate' },
      { name: 'evHz',       defaultValue: 220,  automationRate: 'k-rate' },
      { name: 'evCutoff',   defaultValue: 240,  automationRate: 'k-rate' },
      { name: 'windCutoff', defaultValue: 380,  automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // Oscillator phase accumulators (0..1)
    this.sawPhase = 0;
    this.sqPhase = 0;
    this.evP1 = 0;
    this.evP2 = 0;
    // Biquad state (Direct Form II Transposed) — two state vars per filter.
    this.cz1 = 0; this.cz2 = 0;   // combustion lowpass
    this.ez1 = 0; this.ez2 = 0;   // EV bandpass
    this.wz1 = 0; this.wz2 = 0;   // wind lowpass
  }

  // RBJ Cookbook lowpass coefficients, normalised by a0.
  _lp(cutoff, Q) {
    const w0 = 2 * Math.PI * cutoff / sampleRate;
    const c = Math.cos(w0);
    const a = Math.sin(w0) / (2 * Q);
    const a0 = 1 + a;
    return {
      b0: (1 - c) / 2 / a0,
      b1: (1 - c) / a0,
      b2: (1 - c) / 2 / a0,
      a1: -2 * c / a0,
      a2: (1 - a) / a0,
    };
  }

  // RBJ Cookbook constant-skirt bandpass coefficients, normalised by a0.
  _bp(cutoff, Q) {
    const w0 = 2 * Math.PI * cutoff / sampleRate;
    const c = Math.cos(w0);
    const s = Math.sin(w0);
    const a = s / (2 * Q);
    const a0 = 1 + a;
    return {
      b0: a / a0,
      b1: 0,
      b2: -a / a0,
      a1: -2 * c / a0,
      a2: (1 - a) / a0,
    };
  }

  process(_inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const N = out.length;
    const sr = sampleRate;

    // k-rate params: single value per block (array length 1).
    const combGain = params.combGain[0];
    const evGain = params.evGain[0];
    const windGain = params.windGain[0];
    const combHz = params.combHz[0];
    const combCutoff = params.combCutoff[0];
    const evHz = params.evHz[0];
    const evCutoff = params.evCutoff[0];
    const windCutoff = params.windCutoff[0];

    // Biquad coefficients computed once per block (cutoffs are smoothed
    // on the main side so this is plenty of resolution).
    const cLP = this._lp(combCutoff, 1.2);
    const eBP = this._bp(evCutoff, 3.5);
    const wLP = this._lp(windCutoff, 0.4);

    // Per-sample phase increments.
    const sawDt = combHz / sr;
    const sqDt = (combHz * 2) / sr;
    const evDt1 = evHz / sr;
    const evDt2 = (evHz * 2.02) / sr;

    for (let i = 0; i < N; i++) {
      // ── Combustion: naive saw + naive square ──────────────────────
      this.sawPhase += sawDt;
      if (this.sawPhase >= 1) this.sawPhase -= 1;
      const saw = (this.sawPhase * 2 - 1) * 0.5;       // × primaryGain 0.5

      this.sqPhase += sqDt;
      if (this.sqPhase >= 1) this.sqPhase -= 1;
      const sq = (this.sqPhase < 0.5 ? 1 : -1) * 0.18; // × octaveGain 0.18

      const cIn = saw + sq;
      // DF2T biquad lowpass
      const cOut = cLP.b0 * cIn + this.cz1;
      this.cz1 = cLP.b1 * cIn - cLP.a1 * cOut + this.cz2;
      this.cz2 = cLP.b2 * cIn - cLP.a2 * cOut;

      // ── EV: two detuned saws into a tight bandpass ────────────────
      this.evP1 += evDt1;
      if (this.evP1 >= 1) this.evP1 -= 1;
      const evSaw1 = (this.evP1 * 2 - 1) * 0.42;

      this.evP2 += evDt2;
      if (this.evP2 >= 1) this.evP2 -= 1;
      const evSaw2 = (this.evP2 * 2 - 1) * 0.22;

      const eIn = evSaw1 + evSaw2;
      const eOut = eBP.b0 * eIn + this.ez1;
      this.ez1 = eBP.b1 * eIn - eBP.a1 * eOut + this.ez2;
      this.ez2 = eBP.b2 * eIn - eBP.a2 * eOut;

      // ── Wind: white noise through lowpass ─────────────────────────
      const noise = Math.random() * 2 - 1;
      const wOut = wLP.b0 * noise + this.wz1;
      this.wz1 = wLP.b1 * noise - wLP.a1 * wOut + this.wz2;
      this.wz2 = wLP.b2 * noise - wLP.a2 * wOut;

      // Mix, add inaudible noise floor (ensures non-zero output even when
      // every gain is 0 — covers mute, and EV-at-standstill), and soft-clip
      // through tanh so peak sums (combGain≤0.73 + evGain≤0.42 + windGain≤0.32
      // ≈ 1.47) compress gracefully instead of hard-clipping at destination.
      const mix =
        cOut * combGain +
        eOut * evGain +
        wOut * windGain +
        (Math.random() * 2 - 1) * NOISE_FLOOR;
      out[i] = Math.tanh(mix);
    }
    return true;
  }
}

registerProcessor('engine-processor', EngineProcessor);
