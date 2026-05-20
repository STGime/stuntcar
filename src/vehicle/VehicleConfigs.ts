/**
 * Per-vehicle constants. CarConfig.ts keeps the SHARED chassis dimensions,
 * wheel layout, steering response and brake force; everything that differs
 * between the gas car and the EV (mass, drivetrain math, paint colour) lives
 * here in a `VehicleProfile`.
 */

export type VehicleId = 'ice' | 'ev';
export type DrivetrainKind = 'combustion' | 'electric';

export interface VehicleProfile {
  id: VehicleId;
  label: string;

  // ── Chassis (mass-dependent + handling feel) ───────────────────────────
  mass: number;
  linearDamping: number;
  angularDamping: number;
  suspensionStiffness: number;
  maxSuspensionForce: number;
  frictionSlip: number;

  // ── Drivetrain ─────────────────────────────────────────────────────────
  drivetrain: DrivetrainKind;

  /* Combustion-only ────────────────────── */
  idleRpm?: number;
  redlineRpm?: number;
  torqueCurve?: ReadonlyArray<{ rpm: number; nm: number }>;
  gearRatios?: ReadonlyArray<number>;
  finalDrive?: number;
  autoShiftBands?: ReadonlyArray<readonly [number, number]>;
  shiftInterruptSec?: number;
  drivetrainEfficiency?: number;
  engineFreeRevRpmPerSec?: number;
  autoReverseThresholdKmh?: number;

  /* Electric-only ──────────────────────── */
  /** Peak motor torque, applied flat from standstill up to the knee speed. */
  evPeakTorqueNm?: number;
  /** Constant-power region above the knee speed (Watts). */
  evPeakPowerW?: number;
  /** Speed (km/h) where torque transitions from flat to power-limited. */
  evKneeKmh?: number;
  /** Electronic top-speed limiter (km/h). */
  evMaxSpeedKmh?: number;
  /** Off-throttle (lift-off coast) regen drag — N per km/h of speed. */
  evRegenFactor?: number;
  /** Additional regen drag layered on top of the friction brake when the
   *  brake key is held. N per km/h of speed. */
  evBrakeRegenFactor?: number;
  /** Below this speed (km/h), regen feathers out so the car doesn't jerk to
   *  a stop in one-pedal driving. */
  evRegenFeatherKmh?: number;
  /** Single-speed reduction (final-drive equivalent). */
  evFixedRatio?: number;

  // ── Visual ─────────────────────────────────────────────────────────────
  bodyColor: number;
  trimColor: number;
  glassColor: number;
  headlightColor: number;
  taillightColor: number;
  decalNumber: string;
}

export const VEHICLES: Record<VehicleId, VehicleProfile> = {
  ice: {
    id: 'ice',
    label: 'ICE',

    mass: 1100,
    linearDamping: 0.05,
    angularDamping: 0.3,
    suspensionStiffness: 28,
    maxSuspensionForce: 30000,
    frictionSlip: 2.5,

    drivetrain: 'combustion',
    idleRpm: 900,
    redlineRpm: 7000,
    torqueCurve: [
      { rpm: 900, nm: 195 },
      { rpm: 2000, nm: 340 },
      { rpm: 3500, nm: 410 },
      { rpm: 4500, nm: 430 },
      { rpm: 5500, nm: 380 },
      { rpm: 6500, nm: 290 },
      { rpm: 7000, nm: 200 },
    ],
    gearRatios: [-3.4, 3.3, 2.1, 1.5, 1.15, 0.92],
    finalDrive: 3.6,
    autoShiftBands: [
      [0, 0],
      [38, 0],
      [62, 22],
      [95, 46],
      [135, 78],
      [9999, 112],
    ],
    shiftInterruptSec: 0.15,
    drivetrainEfficiency: 0.92,
    engineFreeRevRpmPerSec: 9000,
    autoReverseThresholdKmh: 2,

    bodyColor: 0xd8423a,
    trimColor: 0x1a1f28,
    glassColor: 0x131820,
    headlightColor: 0xfff3c4,
    taillightColor: 0xff4f4f,
    decalNumber: '67',
  },

  ev: {
    id: 'ev',
    label: 'EV',

    // Heavier than the ICE (battery pack), so the suspension is stiffer
    // and tire grip a touch lower to keep handling balanced.
    mass: 1500,
    linearDamping: 0.04,
    angularDamping: 0.3,
    suspensionStiffness: 32,
    maxSuspensionForce: 40000,
    frictionSlip: 2.45,

    drivetrain: 'electric',
    // Tesla-feel: flat 500 N·m up to ~60 km/h, then constant 280 kW power
    // up toward the 240 km/h top-speed cut. Both ends faster than the
    // ICE despite being heavier.
    evPeakTorqueNm: 500,
    evPeakPowerW: 280000,
    evKneeKmh: 60,
    evMaxSpeedKmh: 240,
    evRegenFactor: 28,
    evBrakeRegenFactor: 70,
    evRegenFeatherKmh: 5,
    evFixedRatio: 9,
    autoReverseThresholdKmh: 2,

    bodyColor: 0x4fd1c5,
    trimColor: 0x1a2030,
    glassColor: 0x0d1218,
    headlightColor: 0xd9e8ff,
    taillightColor: 0xff4f4f,
    decalNumber: 'EV',
  },
};

const STORAGE_KEY = 'stuntline:vehicle';

export function loadVehicleId(): VehicleId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ice' || v === 'ev') return v;
  } catch {
    /* ignore */
  }
  return 'ice';
}

export function saveVehicleId(id: VehicleId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
