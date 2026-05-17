import type { TrackDef } from '../TrackTypes';

/**
 * The Gauntlet — hard circuit (closed loop).
 *
 * Rectangular oval with four banked 90° right turns. Every side has a
 * challenge — no recovery breathers between features:
 *
 *   Side A (spawn): long straight + jump 1 + valley
 *   Side B: narrow section + banked S-curve (right-slant → left-slant)
 *   Side C: forward-helix loop (apex ~9.5 m above entry)
 *   Side D: jump 2 (wider gap) + valley
 *
 * Each jump's lift is balanced by the following valley → loop closes
 * vertically. The loop and S-curve are y-neutral. xz closure within
 * ~0.3 m on both axes.
 */
const W = 9;
const NW = 5;
const TURN_LEN = 25;             // banked corner arc (radius ≈ 15.9 m)
// No bank on turn segments — bank-during-yaw causes cumulative world-frame
// roll drift that becomes a visible y mismatch at the start/finish seam.
// The S-curve banks (turn = 0) are fine because their forward axis is
// constant during the roll.
const BANK = 0;
const JUMP_PITCH = Math.PI / 10; // 18°
const RAMP_L = 5;
const GAP_SHORT = 4;             // first jump
const GAP_LONG = 7;              // second jump (harder)
const SLANT = Math.PI / 9;       // 20° peak roll on each S-curve half
const LOOP_LEN = 30;
const LOOP_ADVANCE = 75;         // length/advance = 0.4 → max pitch ≈ 22°
const TIME_BONUS = 4.5;

export const trackGauntlet: TrackDef = {
  id: 'gauntlet',
  name: 'The Gauntlet',
  difficulty: 'hard',
  startCountdownSec: 36,
  spawnY: 1.0, // TrackBuilder normalises
  closedLoop: true,
  segments: [
    // ─── Side A: spawn straight + jump 1 + valley ────────────────────────
    { kind: 'straight', length: 30, width: W, elevated: true, groundBeside: true }, // 0  spawn runway
    { kind: 'straight', length: 5, width: W, elevated: true },                       // 1  pre-launch
    { kind: 'rampUp',  length: RAMP_L, width: W, pitch: JUMP_PITCH,  elevated: true },// 2  jump 1 launch
    { kind: 'gap',     length: GAP_SHORT, width: W, elevated: true },                // 3  jump 1
    { kind: 'rampDown', length: RAMP_L, width: W, pitch: -JUMP_PITCH, elevated: true }, // 4  jump 1 landing
    { kind: 'straight', length: 8, width: W, elevated: true },                       // 5  transition
    { kind: 'rampDown', length: RAMP_L, width: W, pitch: -JUMP_PITCH, elevated: true }, // 6  valley descent
    { kind: 'rampUp',  length: RAMP_L, width: W, pitch: JUMP_PITCH,  elevated: true },// 7  valley climb
    { kind: 'straight', length: 23, width: W, elevated: true },                      // 8  pre-turn

    // ─── Turn 1 ───────────────────────────────────────────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, bank: BANK, elevated: true }, // 9 — CP1

    // ─── Side B: narrow section + banked S-curve ─────────────────────────
    { kind: 'straight', length: 8, width: W, elevated: true },               // 10
    { kind: 'narrow',   length: 25, width: NW, elevated: true },             // 11  narrow
    { kind: 'straight', length: 8, width: W, elevated: true },               // 12
    { kind: 'bankedCurve', length: 22, width: W, turn: 0, bank: SLANT, elevated: true },  // 13  slant right
    { kind: 'bankedCurve', length: 22, width: W, turn: 0, bank: -SLANT, elevated: true }, // 14  slant left

    // ─── Turn 2 ───────────────────────────────────────────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, bank: BANK, elevated: true }, // 15 — CP2

    // ─── Side C: forward-helix loop ──────────────────────────────────────
    { kind: 'straight', length: 10, width: W, elevated: true },                                                 // 16
    { kind: 'loop', length: LOOP_LEN, width: W, forwardAdvance: LOOP_ADVANCE, elevated: true },                 // 17 — CP3
    { kind: 'straight', length: 5, width: W, elevated: true },                                                  // 18

    // ─── Turn 3 ───────────────────────────────────────────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, bank: BANK, elevated: true }, // 19

    // ─── Side D: jump 2 (longer gap) + valley ────────────────────────────
    { kind: 'straight', length: 8, width: W, elevated: true },                       // 20
    { kind: 'straight', length: 5, width: W, elevated: true },                       // 21  pre-launch
    { kind: 'rampUp',  length: RAMP_L, width: W, pitch: JUMP_PITCH,  elevated: true },// 22  jump 2 launch
    { kind: 'gap',     length: GAP_LONG, width: W, elevated: true },                 // 23  jump 2 (wider)
    { kind: 'rampDown', length: RAMP_L, width: W, pitch: -JUMP_PITCH, elevated: true }, // 24  jump 2 landing — CP4
    { kind: 'straight', length: 8, width: W, elevated: true },                       // 25  transition
    { kind: 'rampDown', length: RAMP_L, width: W, pitch: -JUMP_PITCH, elevated: true }, // 26  valley descent
    { kind: 'rampUp',  length: RAMP_L, width: W, pitch: JUMP_PITCH,  elevated: true },// 27  valley climb
    { kind: 'straight', length: 37, width: W, elevated: true },                      // 28  pre-turn

    // ─── Turn 4: reconnects to start; FINISH at end ──────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, bank: BANK, elevated: true }, // 29 — FINISH
  ],
  checkpoints: [
    { afterSegmentIndex: 9,  timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 15, timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 17, timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 24, timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 29, timeBonusSec: 0 }, // finish
  ],
  finishAfterSegmentIndex: 29,
};
