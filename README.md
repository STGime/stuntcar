# STUNTLINE — M0–M2 scaffold

A browser-based 3D stunt racing game. This repository is the **M0–M2 starter
scaffold** from the MVP spec — a running Vite + TypeScript + Three.js + Rapier
project with a fixed-step game loop, physics integration, and a drivable
raycast-vehicle car. Everything from M3 onward (drivetrain, tracks, checkpoints,
crashes, replays, audio, menus) is still to be built — see `STUNTLINE_MVP.md`.

> Working title only. Do not ship as "Stunt Car Racer" or use any of that
> game's branding, track names, or car names.

## Requirements

- Node.js 18+ (developed on Node 22)

## Run it

```bash
npm install
npm run dev      # starts Vite, opens http://localhost:5173
```

Other scripts:

```bash
npm run build    # type-check (tsc --noEmit) + production build into dist/
npm run preview  # serve the production build
```

## Controls

| Action | Keys |
|---|---|
| Accelerate | `W` / `↑` |
| Brake · reverse | `S` / `↓` |
| Steer | `A` `D` / `← →` |
| Toggle camera (chase ↔ cockpit) | `C` |
| Reset car to spawn | `R` |

## What's implemented (M0–M2)

- **M0 — scaffold & render loop.** Vite + strict TypeScript. `Engine` runs a
  fixed-timestep loop (1/60 s) with an accumulator and renders with an
  interpolation factor, so motion is smooth at any refresh rate. Lit scene,
  ground, grid.
- **M1 — physics.** `PhysicsWorld` initialises Rapier (WASM) and owns the world.
  `BodyView` binds a rigid body to a Three.js object and interpolates its
  transform between physics steps. Demo crates fall and rest on the ground.
- **M2 — drivable car.** `Car` is a Rapier `DynamicRayCastVehicleController`
  (chassis rigid body + 4 suspension rays). Accelerate, brake, reverse,
  speed-sensitive steering. Chase camera follows yaw only (stays readable
  through loops); a basic cockpit camera is included as a bonus.

A test ramp and six dynamic crates are in the scene so collisions and jumps are
easy to sanity-check. They are placeholder sandbox objects — the real
data-driven track system replaces them at M4.

## Project layout

```
src/
  main.ts              bootstraps everything, owns the loop wiring
  core/
    Engine.ts          renderer + fixed-step loop + interpolation
    PhysicsWorld.ts    async Rapier init + world wrapper
    Input.ts           keyboard: held state + key-press callbacks
    BodyView.ts        rigid body <-> Three.js object, transform interpolation
  world/
    Scene.ts           lights, ground, ramp, demo crates (placeholder sandbox)
    DemoProp.ts         throwaway dynamic crate
  vehicle/
    Car.ts             raycast-vehicle car + driving + visual sync
    CarConfig.ts       all tunable car constants
  camera/
    CameraRig.ts       chase + cockpit cameras
```

## Tuning notes — read before you complain about the driving

The driving **will not feel finished yet** — that is expected. Per the MVP spec,
M2 ends with a hands-on tuning pass, and the raycast-vehicle is the highest-risk
part of the project.

- All tunable values are in `src/vehicle/CarConfig.ts`. Start there.
- The `maxEngineForce` / `maxReverseForce` / `brakeForce` values are provisional
  starting points. If acceleration feels too weak or too strong, scale them.
- **If a sign is reversed:** if `W` drives the car backwards, flip the sign of
  the engine force (or the forward axis in `Car.ts`). If steering is mirrored,
  negate `steerInput`. These are quick one-line fixes.
- If the car flips easily, lower `frictionSlip`, raise `angularDamping`
  slightly, or lower the chassis centre of mass (not yet exposed — would be a
  small `Car.ts` change).
- Suspension feel: `suspensionStiffness`, `suspensionCompression`,
  `suspensionRelaxation`, `maxSuspensionTravel`.

Other known scaffold simplifications:

- The cockpit camera is intentionally basic (rolls fully with the car). The
  polished cockpit + dashboard arrives with M3/M4.
- The production bundle is large because `@dimforge/rapier3d-compat` inlines its
  WebAssembly as base64. Harmless for now; can be optimised later by switching
  to the non-compat Rapier package with a Vite WASM plugin.

## Next steps

Continue with the milestones in `STUNTLINE_MVP.md`:

- **M3** — RPM drivetrain (manual + automatic transmission), dashboard gauges,
  engine sound. The placeholder direct-force driving in `Car.ts` gets replaced
  by a proper `Drivetrain`.
- **M4** — data-driven track system (`TrackBuilder` + `TrackDef`) and Track 1;
  this removes the placeholder ramp and crates.
- **M5+** — checkpoints & timer, crash/recovery, replays, remaining tracks,
  menus, polish.
