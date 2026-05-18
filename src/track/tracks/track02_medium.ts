import type { TrackDef } from '../TrackTypes';

/**
 * Loopback — medium circuit (closed loop).
 *
 * Rectangular oval, four 90° right turns. Each side has a different
 * challenge:
 *   - Side A (spawn): long open straight to build speed.
 *   - Side B: jump (rampUp + 5 m gap + rampDown) followed by a valley
 *             (rampDown + rampUp). Jump's lift is balanced by the valley.
 *   - Side C: forward-helix LOOP — chassis stays upright, climbs over a
 *             ~9.5 m arch and back down to the entry y.
 *   - Side D: narrow section in the middle — forces a clean line.
 *
 * Loop, hill, and valley each net to 0 y change, and the jump's lift is
 * cancelled by the valley → loop closes vertically. Banks are sin-profile
 * peaks that return to zero by end of each turn → no roll accumulation.
 *
 * Closure: pitch = 0 net, y = 0 net, xz within ~0.3 m. TrackBuilder pins
 * the lowest point (valley bottom) to 1 m above the ground.
 */
const W = 10;
const NW = 6;
const TURN_LEN = 25;            // arc length per turn (radius ≈ 15.9 m)
// No bank on the turn segments — a bank applied during a yaw causes a
// cumulative world-frame roll drift (each small roll is around the body
// forward, which moves during the turn), and 4 turns/lap accumulate that
// drift into a visible y mismatch at the start/finish seam.
const BANK = 0;
const HILL_PITCH = Math.PI / 10; // 18°
const RAMP_L = 5;
const GAP_L = 5;
const LOOP_LEN = 30;            // loop circumference (radius ≈ 4.77 m, apex 9.55 m)
const LOOP_ADVANCE = 60;        // length/advance = 0.5 → max pitch ≈ 26.6°
const TIME_BONUS = 6.0;

export const trackLoopback: TrackDef = {
  id: 'loopback',
  name: 'Loopback',
  difficulty: 'medium',
  startCountdownSec: 45,
  totalLaps: 3,
  lapBonusSec: 14,
  spawnY: 1.0, // TrackBuilder normalises anyway
  closedLoop: true,
  segments: [
    // ─── Side A: long open spawn straight ────────────────────────────────
    { kind: 'straight', length: 80, width: W, elevated: true, groundBeside: true }, // 0

    // ─── Turn 1 ───────────────────────────────────────────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, bank: BANK, elevated: true }, // 1 — CP1

    // ─── Side B: jump + valley ────────────────────────────────────────────
    { kind: 'straight', length: 8, width: W, elevated: true },                                      // 2  pre-launch
    { kind: 'rampUp',  length: RAMP_L, width: W, pitch: HILL_PITCH,      elevated: true },         // 3  launch
    { kind: 'gap',     length: GAP_L, width: W, elevated: true },                                  // 4  the missing segment
    { kind: 'rampDown', length: RAMP_L, width: W, pitch: -HILL_PITCH,     elevated: true },        // 5  landing (pitch back to 0)
    { kind: 'straight', length: 8, width: W, elevated: true },                                     // 6  transition
    { kind: 'rampDown', length: RAMP_L, width: W, pitch: -HILL_PITCH,     elevated: true },        // 7  valley descent
    { kind: 'rampUp',  length: RAMP_L, width: W, pitch: HILL_PITCH,      elevated: true },         // 8  valley climb back
    { kind: 'straight', length: 9, width: W, elevated: true },                                     // 9  pre-turn — CP2 at end

    // ─── Turn 2 ───────────────────────────────────────────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, bank: BANK, elevated: true }, // 10

    // ─── Side C: forward-helix loop ──────────────────────────────────────
    { kind: 'straight', length: 10, width: W, elevated: true },                                                       // 11  loop approach
    { kind: 'loop', length: LOOP_LEN, width: W, forwardAdvance: LOOP_ADVANCE, elevated: true },                       // 12 — CP3
    { kind: 'straight', length: 10, width: W, elevated: true },                                                       // 13  loop runout

    // ─── Turn 3 ───────────────────────────────────────────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, bank: BANK, elevated: true }, // 14 — CP4

    // ─── Side D: narrow section ──────────────────────────────────────────
    { kind: 'straight', length: 12, width: W, elevated: true },  // 15
    { kind: 'narrow',   length: 25, width: NW, elevated: true }, // 16  narrow section
    { kind: 'straight', length: 13, width: W, elevated: true },  // 17

    // ─── Turn 4: reconnects to start; FINISH at end ──────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, bank: BANK, elevated: true }, // 18 — FINISH
  ],
  checkpoints: [
    { afterSegmentIndex: 1,  timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 9,  timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 12, timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 14, timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 18, timeBonusSec: 0 }, // finish — same line as start
  ],
  finishAfterSegmentIndex: 18,
};
