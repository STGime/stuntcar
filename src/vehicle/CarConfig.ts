/**
 * All tunable car constants live here. Expect heavy iteration on these values.
 *
 * Units: forces are Newton-ish, lengths metres, angles radians, torque N·m.
 */
export const CarConfig = {
  // --- Chassis -------------------------------------------------------------
  mass: 1100,
  chassisHalfExtents: { x: 0.9, y: 0.5, z: 2.0 },
  spawn: { x: 0, y: 1.6, z: 0 },
  linearDamping: 0.05,
  angularDamping: 0.3,

  // --- Wheels --------------------------------------------------------------
  wheelRadius: 0.35,
  wheelWidth: 0.3,
  suspensionRestLength: 0.4,
  suspensionStiffness: 28,
  suspensionCompression: 0.85,
  suspensionRelaxation: 0.9,
  maxSuspensionTravel: 0.5,
  maxSuspensionForce: 30000,
  frictionSlip: 2.5,

  /**
   * Wheel connection points relative to the chassis centre.
   * +z is the front of the car. Indices 0,1 = front; 2,3 = rear.
   */
  wheels: [
    { x: 0.8, y: -0.3, z: 1.4, front: true, driven: false },
    { x: -0.8, y: -0.3, z: 1.4, front: true, driven: false },
    { x: 0.8, y: -0.3, z: -1.4, front: false, driven: true },
    { x: -0.8, y: -0.3, z: -1.4, front: false, driven: true },
  ],

  // --- Steering ------------------------------------------------------------
  steeringMax: 0.55,
  steeringRate: 4.0,
  steeringSpeedFalloff: 0.45,
  highSpeedKmh: 130,

  // --- Braking -------------------------------------------------------------
  // Per-wheel brake force fed to Rapier's vehicle controller. Sweet spot:
  // strong enough to actually stop you, low enough that the chassis pitch
  // from deceleration doesn't lift the rear wheels off the ground.
  brakeForce: 45,

  // --- Drivetrain ----------------------------------------------------------
  idleRpm: 900,
  redlineRpm: 7000,
  /**
   * Engine torque (N·m) sampled across RPM. Linear interpolation between
   * points. We have no clutch model — RPM is locked to wheel speed — so a
   * stopped car only ever sees the idle-RPM torque value. Idle is tuned to
   * the sweet spot: enough wheel force to start on a steep hill, not so much
   * that a full-throttle launch on flat ground wheelies the chassis backward.
   */
  torqueCurve: [
    { rpm: 900, nm: 195 },
    { rpm: 2000, nm: 340 },
    { rpm: 3500, nm: 410 },
    { rpm: 4500, nm: 430 },
    { rpm: 5500, nm: 380 },
    { rpm: 6500, nm: 290 },
    { rpm: 7000, nm: 200 },
  ],
  /**
   * Gear ratios. Index 0 = reverse (negative), 1 = 1st, ..., 5 = 5th.
   */
  gearRatios: [-3.4, 3.3, 2.1, 1.5, 1.15, 0.92],
  finalDrive: 3.6,
  /**
   * Per-gear automatic-shift speed bands, in km/h.
   * Index = current gear (0 = reverse, unused; 1..5 = forward gears).
   * [upshiftAboveKmh, downshiftBelowKmh].
   *
   * Hysteresis rule: gear N+1's downshift must be well below gear N's
   * upshift to avoid oscillation across the boundary.
   */
  autoShiftBands: [
    [0, 0], // R — unused (reverse engagement is handled separately)
    [38, 0], // 1st  — up at 38, can't drop below 1 (R handled separately)
    [62, 22], // 2nd — back to 1st under 22
    [95, 46], // 3rd — back to 2nd under 46
    [135, 78], // 4th — back to 3rd under 78
    [9999, 112], // 5th — never upshift, back to 4th under 112
  ],
  /** Brief torque interrupt on each shift (seconds). */
  shiftInterruptSec: 0.15,
  /** Drivetrain efficiency: 0..1 multiplier on engine torque reaching wheels. */
  drivetrainEfficiency: 0.92,
  /** How quickly engine revs respond when wheels aren't driving (RPM/sec). */
  engineFreeRevRpmPerSec: 9000,
  /** Below this forward speed (km/h), automatic engages reverse when braking. */
  autoReverseThresholdKmh: 2,
} as const;

export type CarConfigType = typeof CarConfig;
