import { type TrackDef } from '../TrackTypes';

/**
 * Crosstown — a night-city circuit, roughly twice the length of the other
 * three. Laid out as a rectangle with rounded banked corners (4 × −π/2 =
 * −2π → heading closes) and mirrored features on opposite sides so the
 * lap closes positionally too:
 *
 *   Side A:        tunnel section + long straight  → forward
 *   Corner 1:      banked right
 *   Side B:        chicane (right→left) embedded in straights
 *   Corner 2:      banked right
 *   Side A rev:    long straight with a jump-and-valley
 *   Corner 3:      banked right
 *   Side B rev:    mirrored chicane (left→right) so the lateral offset
 *                  introduced by the forward chicane cancels exactly
 *   Corner 4:      banked right — closes back onto the spawn line
 *
 * 8 named turns (4 banked corners + 4 chicane micro-arcs), 4 surface
 * features (tunnel, chicane, jump, reverse chicane). ~960 m around.
 */

const W = 12;          // ribbon width
const W_NARROW = 7;    // chicane / narrow sections
const TIME_BONUS = 6.0;

// Banked-corner constants — kept consistent so opposite sides match.
const CORNER_LEN = 55;
const CORNER_TURN = -Math.PI / 2;
const CORNER_BANK = -Math.PI / 10;

// Chicane sub-arc constants — equal lengths in both directions so the
// two chicanes cancel laterally.
const CHIC_LEN = 25;
const CHIC_TURN = Math.PI / 4;

export const trackCrosstown: TrackDef = {
  id: 'crosstown',
  name: 'Crosstown',
  difficulty: 'hard',
  startCountdownSec: 75,
  totalLaps: 3,
  lapBonusSec: 22,
  spawnY: 1.0,
  closedLoop: true,
  theme: 'city',
  segments: [
    // ───── Side A (forward, +Z) — tunnel + long straight, total 200 m ─────
    { kind: 'straight', length: 60, width: W, elevated: true },                       // 0  spawn
    { kind: 'straight', length: 80, width: W, elevated: true, tunnel: true },         // 1  tunnel
    { kind: 'straight', length: 60, width: W, elevated: true },                       // 2

    // Corner 1 — banked right.
    {
      kind: 'bankedCurve',
      length: CORNER_LEN,
      width: W,
      turn: CORNER_TURN,
      bank: CORNER_BANK,
      elevated: true,
    },                                                                                 // 3

    // ───── Side B (right-hand, +X) — chicane embedded, total 170 m ───────
    { kind: 'straight', length: 60, width: W, elevated: true },                       // 4
    { kind: 'narrow', length: CHIC_LEN, width: W_NARROW, turn: -CHIC_TURN, elevated: true }, // 5  chic right
    { kind: 'narrow', length: CHIC_LEN, width: W_NARROW, turn:  CHIC_TURN, elevated: true }, // 6  chic left
    { kind: 'straight', length: 60, width: W, elevated: true },                       // 7

    // Corner 2 — banked right.
    {
      kind: 'bankedCurve',
      length: CORNER_LEN,
      width: W,
      turn: CORNER_TURN,
      bank: CORNER_BANK,
      elevated: true,
    },                                                                                 // 8

    // ───── Side A reverse (−Z) — long straight with the jump, total 200 m ─
    // Y-balanced jump: a climb up, a gap at the apex, then a single
    // pitch-arc that swings the road past flat to a downslope (no net Y
    // change through the arc itself), then a final rampUp that flattens
    // the descent and lowers the road back to the spawn elevation. Net
    // Δy across the whole jump = 0, so the closedLoop seam doesn't need
    // to "patch" a leftover height difference with a near-vertical wall.
    { kind: 'straight', length: 60, width: W, elevated: true },                        // 9
    { kind: 'rampUp', length: 12, width: W, pitch: Math.PI / 14, elevated: true },     // 10 launch
    { kind: 'gap', length: 8, width: W, elevated: true },                              // 11 gap
    { kind: 'rampDown', length: 16, width: W, pitch: -Math.PI / 7, elevated: true },   // 12 apex → downslope (pitch +π/14 → −π/14)
    { kind: 'rampUp', length: 12, width: W, pitch: Math.PI / 14, elevated: true },     // 13 flatten landing (pitch −π/14 → 0)
    // Length picked so Side A reverse covers EXACTLY the same XZ projection
    // (≈ 195 m) as Side A forward. Pitched ramps shorten their XZ advance
    // by a `cos(pitch)` factor — over 40 m of ramps that's a ~0.36 m loss
    // per ramp, ~4.64 m total — so the post-jump straight is trimmed by
    // the same amount instead of leaving a snap-induced wall.
    { kind: 'straight', length: 87.4, width: W, elevated: true },                      // 14

    // Corner 3 — banked right.
    {
      kind: 'bankedCurve',
      length: CORNER_LEN,
      width: W,
      turn: CORNER_TURN,
      bank: CORNER_BANK,
      elevated: true,
    },                                                                                 // 15

    // ───── Side B reverse (+X) — same turn sequence as forward chicane ──
    // Identical (-π/4, +π/4) turns at opposite headings produce opposite
    // world drifts, which is what actually cancels the lateral offset.
    // Mirroring (+π/4, -π/4) leaves both legs drifting in the same world
    // direction and the loop fails to close by ≈37 m.
    { kind: 'straight', length: 60, width: W, elevated: true },                       // 16
    { kind: 'narrow', length: CHIC_LEN, width: W_NARROW, turn: -CHIC_TURN, elevated: true }, // 17
    { kind: 'narrow', length: CHIC_LEN, width: W_NARROW, turn:  CHIC_TURN, elevated: true }, // 18
    { kind: 'straight', length: 60, width: W, elevated: true },                       // 19

    // Corner 4 — banked right, brings us back onto the spawn line.
    {
      kind: 'bankedCurve',
      length: CORNER_LEN,
      width: W,
      turn: CORNER_TURN,
      bank: CORNER_BANK,
      elevated: true,
    },                                                                                 // 20
  ],
  checkpoints: [
    { afterSegmentIndex: 1, timeBonusSec: TIME_BONUS },   // CP 1 — tunnel cleared
    { afterSegmentIndex: 3, timeBonusSec: TIME_BONUS },   // CP 2 — corner 1 done
    { afterSegmentIndex: 6, timeBonusSec: TIME_BONUS },   // CP 3 — first chicane cleared
    { afterSegmentIndex: 8, timeBonusSec: TIME_BONUS },   // CP 4 — corner 2 done
    { afterSegmentIndex: 13, timeBonusSec: TIME_BONUS },  // CP 5 — jump + landing done
    { afterSegmentIndex: 15, timeBonusSec: TIME_BONUS },  // CP 6 — corner 3 done
    { afterSegmentIndex: 18, timeBonusSec: TIME_BONUS },  // CP 7 — reverse chicane cleared
    { afterSegmentIndex: 20, timeBonusSec: 0 },           // finish — same line as start
  ],
  finishAfterSegmentIndex: 20,
};
