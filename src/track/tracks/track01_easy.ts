import type { TrackDef } from '../TrackTypes';

/**
 * Skyline Run — easy circuit (closed loop) with variety.
 *
 * A rectangular oval with four 90° right turns (sum = 2π, closes). Each of
 * the two side straights has a symmetric HILL (climb-peak-descend, net 0 m
 * y change so closure isn't broken). The back straight has a JUMP (rampUp +
 * gap + rampDown) followed by a VALLEY (rampDown + rampUp). Jump + valley
 * also net to 0 m so the loop closes vertically.
 *
 * Layout (top-down):
 *
 *       turn3 ──────── side D (hill) ──────── turn2
 *         │                                     │
 *         │                                     │
 *         │  side C (jump + valley, the back   │
 *         │  straight that crosses a gap)       │
 *         │                                     │
 *       turn4 ───── side A (spawn straight) ──── turn1
 *                       ↑ FINISH/START
 *
 * Closure: net pitch change = 0. Net y change = 0. Sides A and C match
 * within ~0.7 m horizontally (small visual seam at start/finish, but
 * physics + gates work fine).
 */
const W = 12;
const TURN_LEN = 28;          // arc length per 90° turn (radius ≈ 17.8 m)
const SIDE_A_LEN = 50;        // long spawn straight — plenty of runway
const SIDE_B_TAIL = 5;        // straight before & after each hill
const HILL_RAMP_LEN = 5;      // each of the 3 hill ramps
const HILL_PITCH = Math.PI / 10; // 18°
const JUMP_RAMP_LEN = 5;
const JUMP_PITCH = Math.PI / 10;
const GAP_LEN = 4;
const TRANSITION = 8;         // straight between jump-landing and valley
const C_TAIL = 11;            // straight at the end of side C (after valley)
const TIME_BONUS = 6.0;

export const trackSkylineRun: TrackDef = {
  id: 'skyline-run',
  name: 'Skyline Run',
  difficulty: 'easy',
  startCountdownSec: 30,
  spawnY: 1.0, // TrackBuilder pins the lowest point 1 m above the ground anyway
  closedLoop: true,
  segments: [
    // ─── Side A: long spawn straight ──────────────────────────────────────
    { kind: 'straight', length: SIDE_A_LEN, width: W, elevated: true, groundBeside: true }, // 0

    // ─── Turn 1 ────────────────────────────────────────────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, elevated: true, groundBeside: true }, // 1 — CP1

    // ─── Side B: symmetric hill on the side straight ──────────────────────
    { kind: 'straight', length: SIDE_B_TAIL, width: W, elevated: true, groundBeside: true }, // 2
    { kind: 'rampUp',  length: HILL_RAMP_LEN, width: W, pitch: HILL_PITCH,      elevated: true }, // 3  hill climb
    { kind: 'rampDown', length: HILL_RAMP_LEN * 2, width: W, pitch: -2 * HILL_PITCH, elevated: true }, // 4  hill peak (passes through level to descent)
    { kind: 'rampUp',  length: HILL_RAMP_LEN, width: W, pitch: HILL_PITCH,      elevated: true }, // 5  hill descent (pitch back to 0)
    { kind: 'straight', length: SIDE_B_TAIL, width: W, elevated: true, groundBeside: true }, // 6

    // ─── Turn 2 ────────────────────────────────────────────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, elevated: true, groundBeside: true }, // 7 — CP2

    // ─── Side C: jump + valley on the back straight ───────────────────────
    { kind: 'straight', length: 8, width: W, elevated: true },                                            // 8   pre-launch
    { kind: 'rampUp',  length: JUMP_RAMP_LEN, width: W, pitch: JUMP_PITCH,  elevated: true },             // 9   launch
    { kind: 'gap',     length: GAP_LEN, width: W, elevated: true },                                       // 10  the missing segment
    { kind: 'rampDown', length: JUMP_RAMP_LEN, width: W, pitch: -JUMP_PITCH, elevated: true },            // 11  landing (pitch back to 0)
    { kind: 'straight', length: TRANSITION, width: W, elevated: true },                                   // 12  transition
    { kind: 'rampDown', length: JUMP_RAMP_LEN, width: W, pitch: -JUMP_PITCH, elevated: true },            // 13  valley descent
    { kind: 'rampUp',  length: JUMP_RAMP_LEN, width: W, pitch: JUMP_PITCH,   elevated: true },            // 14  valley climb back
    { kind: 'straight', length: C_TAIL, width: W, elevated: true },                                       // 15  pre-turn

    // ─── Turn 3 ────────────────────────────────────────────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, elevated: true, groundBeside: true }, // 16 — CP3

    // ─── Side D: symmetric hill (mirrors side B) ──────────────────────────
    { kind: 'straight', length: SIDE_B_TAIL, width: W, elevated: true, groundBeside: true }, // 17
    { kind: 'rampUp',  length: HILL_RAMP_LEN, width: W, pitch: HILL_PITCH,      elevated: true }, // 18
    { kind: 'rampDown', length: HILL_RAMP_LEN * 2, width: W, pitch: -2 * HILL_PITCH, elevated: true }, // 19
    { kind: 'rampUp',  length: HILL_RAMP_LEN, width: W, pitch: HILL_PITCH,      elevated: true }, // 20
    { kind: 'straight', length: SIDE_B_TAIL, width: W, elevated: true, groundBeside: true }, // 21

    // ─── Turn 4: reconnects to start; FINISH at end ───────────────────────
    { kind: 'bankedCurve', length: TURN_LEN, width: W, turn: Math.PI / 2, elevated: true, groundBeside: true }, // 22 — FINISH
  ],
  checkpoints: [
    { afterSegmentIndex: 1,  timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 7,  timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 16, timeBonusSec: TIME_BONUS },
    { afterSegmentIndex: 22, timeBonusSec: 0 }, // finish
  ],
  finishAfterSegmentIndex: 22,
};
