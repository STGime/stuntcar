# STUNTLINE — MVP Specification

**Working title:** STUNTLINE *(rename freely — must NOT use "Stunt Car Racer" or any Geoff Crammond / MicroProse / Amiga-era branding, logos, track names, or car names)*

**Type:** Browser-based 3D arcade stunt racing game
**Audience:** Single player, desktop browser, keyboard only
**Status:** Greenfield. This document is the build brief.

---

## 1. Purpose of this document

This is a spec for an autonomous coding agent (Claude Code). It defines the MVP scope, the tech stack, the architecture, the data formats, and an ordered milestone plan with acceptance criteria. Build the milestones **in order**. After every milestone the game must still run in the browser with no console errors. Use placeholder geometry and placeholder/CC0 audio until M10 — do not block progress waiting on art.

The game is *inspired by* the classic elevated-track stunt racer genre (one car, a timed run against checkpoint gates, jumps and loops, the car falls and wrecks if it leaves an elevated track). It must be an **original work**: original name, original track layouts, original or CC0-licensed assets, a generic non-branded car, no real manufacturer names or logos.

---

## 2. Game design summary

The player drives a single car along an elevated stunt track from start to finish. The track has ramps, gaps, vertical loops, banked corners and narrow elevated sections. The run is governed by **checkpoint gates**: each gate must be reached before a countdown timer expires; passing a gate adds time. Run out of time → run fails. Reach the finish → run completes and a time is recorded.

There are **3 tracks**, Easy → Medium → Hard. The player picks transmission (manual or automatic) before a run. Default camera is an in-car cockpit view with a working dashboard (analogue rev counter + speedometer); a chase/outside camera is toggleable. The engine emits a looping sound whose pitch tracks engine RPM.

If the car leaves an **elevated** section of track it falls, wrecks, and the run resets to the last passed checkpoint. If it leaves the track where there is **flat ground beside the track**, it stays drivable and the player can steer back. Crashes and notable jumps trigger an automatic cinematic **replay**.

---

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript | Strict mode on. |
| Build / dev server | Vite | `npm create vite@latest` (vanilla-ts template). |
| Rendering | Three.js (latest stable, r17x) | WebGL renderer for MVP; keep renderer abstraction thin so WebGPU is a later swap. |
| Physics | `@dimforge/rapier3d` (WASM) | Loaded via `await import('@dimforge/rapier3d')` / `RAPIER.init()` before the game starts. |
| Vehicle | Rapier `DynamicRayCastVehicleController` | Raycast-car model: chassis rigid body + 4 wheel rays. This is the core of the driving feel. |
| Audio | Web Audio API | No library. Looping engine sample with `playbackRate` tied to RPM. |
| UI / HUD | HTML + CSS overlay on top of the canvas | Dashboard gauges as SVG/canvas, menus as DOM. No UI framework. |
| Models | glTF via `GLTFLoader` | MVP uses primitive placeholder meshes; glTF loading path should exist but be optional. |

No React, no game-engine framework. Plain TypeScript modules plus a small explicit state machine.

**Physics/render loop rule:** fixed physics timestep (1/60 s) with an accumulator; interpolate render transforms between physics steps. Never step Rapier a variable dt.

---

## 4. Project structure

```
stuntline/
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.ts                 # entry: bootstraps engine, owns the game-state machine
    core/
      Engine.ts             # render loop, fixed-step accumulator, RAF
      PhysicsWorld.ts        # Rapier world wrapper, fixed step
      Input.ts              # keyboard state, edge detection (pressed/released)
      AssetLoader.ts        # glTF + audio buffer loading
      GameState.ts          # state machine: Menu -> TrackSelect -> Countdown -> Racing -> Replay -> Result
    vehicle/
      Car.ts                # chassis + Rapier vehicle controller + visual sync
      Drivetrain.ts         # RPM model, gears, manual/automatic transmission
      CarConfig.ts          # tunable car constants (one place)
    track/
      TrackTypes.ts         # TrackDef / Segment / Checkpoint type definitions
      TrackBuilder.ts       # TrackDef -> meshes + Rapier trimesh colliders + triggers + spawn
      tracks/
        track01_easy.ts
        track02_medium.ts
        track03_hard.ts
    race/
      Checkpoints.ts        # gate detection, ordered progression
      RaceTimer.ts          # countdown, per-gate time bonus, fail/finish
      CrashSystem.ts        # fall/wreck detection, reset to last checkpoint
    camera/
      CameraRig.ts          # cockpit / chase / replay cameras, toggle
    replay/
      ReplayRecorder.ts     # ring buffer of frames
      ReplayPlayer.ts       # plays a frozen buffer with a cinematic camera
    audio/
      EngineSound.ts        # looping engine audio, playbackRate from RPM
      Sfx.ts                # one-shots: gate, crash, countdown beeps
    ui/
      Hud.ts                # dashboard (tach + speedo), timer, gear, checkpoint info
      Menus.ts              # main menu, track + transmission select, result screen
  public/
    audio/                  # CC0 placeholder loops/one-shots
    models/                 # placeholder/original glTF
```

---

## 5. Core systems — detailed spec

### 5.1 Game state machine (`GameState.ts`)

States: `Menu → TrackSelect → Countdown → Racing → Replay → Result → (back to TrackSelect or Menu)`.

- **Menu** — title, "Start".
- **TrackSelect** — pick one of 3 tracks; pick transmission (Manual / Automatic). Show best time per track (persist best times in `localStorage`).
- **Countdown** — 3-2-1-GO overlay; car frozen; physics paused; cockpit camera; beeps via `Sfx`.
- **Racing** — main gameplay loop.
- **Replay** — entered automatically on crash and on a "highlight" jump; gameplay timer is paused while a replay plays; auto-exits back to Racing (or to Result if it was the finishing crash/jump).
- **Result** — finish time or "TIME UP" failure; offer Retry / Track Select / Menu.

### 5.2 Input (`Input.ts`)

Track held keys plus per-frame edge events (`justPressed`). Default bindings (make them a config map):

| Action | Keys |
|---|---|
| Accelerator | `ArrowUp` / `W` |
| Brake / Reverse | `ArrowDown` / `S` |
| Steer left | `ArrowLeft` / `A` |
| Steer right | `ArrowRight` / `D` |
| Shift up (manual) | `E` |
| Shift down (manual) | `Q` |
| Toggle camera | `C` |
| Reset to last checkpoint | `R` |
| Skip replay | `Space` |
| Pause | `Escape` |

### 5.3 Vehicle (`Car.ts`, `Drivetrain.ts`, `CarConfig.ts`)

Use Rapier's `DynamicRayCastVehicleController`. The chassis is a dynamic rigid body with a box (or compound) collider; the 4 wheels are rays — they are **not** rigid bodies, only visual meshes synced from wheel state each frame.

**Setup sketch (illustrative, not final):**

```ts
const chassis = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
);
world.createCollider(
  RAPIER.ColliderDesc.cuboid(0.9, 0.5, 2.0).setMass(CarConfig.mass),
  chassis
);
const vehicle = world.createVehicleController(chassis);

for (const w of CarConfig.wheels) {        // 4 wheels
  vehicle.addWheel(
    w.position,                            // relative to chassis
    new RAPIER.Vector3(0, -1, 0),          // suspension direction (down)
    new RAPIER.Vector3(-1, 0, 0),          // axle axis
    CarConfig.suspensionRestLength,
    CarConfig.wheelRadius
  );
}
```

Per physics step, before `world.step()`:
- compute steering, engine force, brake from input + drivetrain;
- `vehicle.setWheelSteering(i, steer)` on front wheels;
- `vehicle.setWheelEngineForce(i, force)` on driven wheels;
- `vehicle.setWheelBrake(i, brake)` on all wheels;
- `vehicle.updateVehicle(dt)`.

After the step, read `vehicle.wheelRotation(i)`, contact info, and chassis transform to update visuals.

**Starting tuning values** (put in `CarConfig.ts`, expect to tweak):

```
mass                    = 1100
wheelRadius             = 0.35
suspensionRestLength    = 0.4
suspensionStiffness     = 28
suspensionCompression   = 0.85
suspensionRelaxation    = 0.9
maxSuspensionTravel     = 0.5
frictionSlip            = 2.5      # tire grip
sideFrictionStiffness   = 0.8
wheel layout (rel. chassis): front ±0.8 x, -0.3 y, +1.4 z ; rear ±0.8 x, -0.3 y, -1.4 z
driven wheels           = rear (RWD) for MVP
steeringMax             = 0.5 rad, speed-sensitive (less lock at high speed)
```

Add light **anti-flip stability**: steering authority falls off with speed; optionally damp angular velocity around the roll axis slightly. Arcade feel over realism.

**Drivetrain (`Drivetrain.ts`):**

- Engine RPM range: idle `≈ 900`, redline `≈ 7000`.
- Gears: Reverse + 5 forward. Example ratios `[R -3.4, 1st 3.3, 2nd 2.1, 3rd 1.5, 4th 1.15, 5th 0.92]`, final drive `≈ 3.6`.
- `engineRPM = clamp(|wheelAngularSpeed| × gearRatio × finalDrive × k, idle, redline)`.
- Engine force to wheels `= torqueCurve(rpm) × gearRatio × finalDrive × throttle`. `torqueCurve` may be a simple piecewise/curve function — flat-ish midrange, falloff near redline. Tunable.
- **Rev limiter:** above redline, cut engine force (sound should "bounce" on the limiter).
- **Automatic transmission:** upshift when `rpm > 6000`, downshift when `rpm < 2500`; small hysteresis to avoid hunting.
- **Manual transmission:** player shifts via `Q`/`E`. If a shift would exceed redline, refuse the downshift / clamp; if it drops below idle, clamp to idle (no stalling required for MVP). Brief torque interrupt (~150 ms) on each shift.

`Drivetrain` exposes `{ rpm, gear, speedKmh }` for the HUD and `EngineSound`.

### 5.4 Track system (`TrackTypes.ts`, `TrackBuilder.ts`, `tracks/*`)

Tracks are **data-driven**. A `TrackBuilder` consumes a `TrackDef` and produces: a track mesh, a Rapier fixed-body **trimesh collider**, ordered checkpoint trigger volumes, a spawn transform, and optional flat ground patches.

```ts
// TrackTypes.ts
type SegmentKind =
  | 'straight' | 'rampUp' | 'rampDown' | 'gap'
  | 'loop' | 'bankedCurve' | 'corkscrew' | 'narrow';

interface Segment {
  kind: SegmentKind;
  length: number;          // metres along the path
  width: number;           // track width
  turn?: number;           // heading change (rad), for curves
  pitch?: number;          // grade change (rad), for ramps
  elevated: boolean;       // true => leaving the side = fall + wreck
  groundBeside?: boolean;  // true => flat drivable ground next to track; off-track is recoverable
}

interface Checkpoint {
  afterSegmentIndex: number; // gate sits at the end of this segment
  timeBonusSec: number;      // time added to the countdown when passed
}

interface TrackDef {
  id: string;
  name: string;              // original name, e.g. "Skyline Run"
  difficulty: 'easy' | 'medium' | 'hard';
  startCountdownSec: number; // initial timer value
  segments: Segment[];
  checkpoints: Checkpoint[];
  finishAfterSegmentIndex: number;
}
```

`TrackBuilder` walks the segment list, advancing a transform frame (position + heading + pitch) to lay out a continuous ribbon. `gap` segments produce empty space (a jump). `loop` produces a full vertical circle. `bankedCurve` rolls the ribbon into the turn. `narrow` reduces width. Where `groundBeside` is true, emit a wide flat ground collider beside the track at that segment's base height.

**Off-track / fall logic depends on this data:**
- On an `elevated` segment with no `groundBeside`: leaving the ribbon → nothing to drive on → the car falls → `CrashSystem` wrecks it.
- Where `groundBeside` is true: the flat ground collider catches the car; it stays drivable and can steer back onto the ribbon.

**Three tracks (designs are original — do not copy any existing layout):**

1. **`track01_easy.ts` — "Skyline Run"** — short. Mostly `straight` + gentle `bankedCurve`, one small `rampUp`/`rampDown` jump over a short `gap`. Wide track. Generous `startCountdownSec`. Several segments have `groundBeside: true` so early mistakes are forgiving. 3–4 checkpoints.

2. **`track02_medium.ts` — "Loopback"** — one full vertical `loop`, one real `gap` jump (ramp → gap → landing ramp), `narrow` elevated sections, banked corners. Fewer `groundBeside` segments. Tighter timer. 4–5 checkpoints.

3. **`track03_hard.ts` — "The Gauntlet"** — multiple `gap` jumps, a `loop`, a `corkscrew`, long `narrow` elevated runs, almost no `groundBeside`. Tight checkpoint timing demanding clean lines. 5–6 checkpoints.

### 5.5 Checkpoints & timer (`Checkpoints.ts`, `RaceTimer.ts`)

- Checkpoints are ordered trigger volumes spanning the track. The car must pass them **in order**; an out-of-order or skipped gate does not count.
- `RaceTimer` runs a countdown starting at `startCountdownSec`. Passing checkpoint *n* adds `timeBonusSec`. Timer reaching 0 → run fails → `Result` ("TIME UP").
- Passing the finish gate → run completes → `Result` shows the elapsed time; update `localStorage` best time if beaten.
- Timer is **paused** during `Countdown` and during `Replay`.

### 5.6 Crash system (`CrashSystem.ts`)

Crash (wreck) triggers:
1. Chassis falls below a per-track **kill-plane Y** (fell off an elevated section).
2. Very hard impact: chassis contact with relative velocity above a threshold while heavily inverted.

On crash:
- Detach the vehicle controller (stop applying engine/steer/brake); the chassis stays a free rigid body so it tumbles naturally.
- Optionally spawn 4 detached wheel meshes for visual "breakage" — keep minimal for MVP (tumbling chassis + crash sound is acceptable).
- Play crash SFX, enter `Replay` (crash replay).
- After the replay: reset car to the **last passed checkpoint** (or spawn) — re-enable controller, zero velocities, restore upright transform. The countdown timer keeps whatever value it had (the time already lost is the penalty); it does **not** tick during the replay.

Off-track but on flat ground (`groundBeside`) is **not** a crash — the car simply drives on the ground and can steer back.

Manual reset (`R`) reuses the same reset-to-last-checkpoint path without a replay.

### 5.7 Cameras (`CameraRig.ts`)

- **Cockpit (default):** camera inside the car at driver eye position, looking forward; subtle lag/shake under acceleration and impact. The HUD dashboard is shown in this view.
- **Chase:** spring-arm camera behind and above the car; smoothed follow.
- **Replay:** cinematic camera (orbit / tracking shots) — owned by `ReplayPlayer`.
- `C` toggles cockpit ↔ chase during racing.

### 5.8 Replay system (`ReplayRecorder.ts`, `ReplayPlayer.ts`)

- `ReplayRecorder` keeps a **ring buffer** of frames captured every physics step, ~12 s deep (~720 frames). Each frame: `{ chassisPos, chassisQuat, wheelRot[4], steerAngle, rpm, gear, speedKmh, throttle }`.
- **Highlight (jump) detection:** track airtime (all 4 wheel rays lose contact). If a single airborne stretch exceeds ~1.2 s, flag a highlight; on landing, play that segment as a replay.
- **Crash:** always replays the seconds leading up to the wreck.
- `ReplayPlayer` freezes a copy of the buffer, sets `GameState` to `Replay`, plays frames back driving the car's visual transforms (no physics) with the cinematic camera, shows a `REPLAY` overlay, then returns to `Racing` (or `Result`). `Space` skips.
- Recording transforms (not re-simulating) is the required approach — robust and simple.

### 5.9 Audio (`EngineSound.ts`, `Sfx.ts`)

- `EngineSound`: one looping engine buffer via Web Audio. `playbackRate = lerp(0.55, 2.6, rpm / redline)`. Gain blends an idle floor with a throttle-driven component. On the rev limiter, briefly oscillate playbackRate for the "bouncing" effect. Audio context must start on a user gesture (the menu Start button).
- *Stretch (not MVP-blocking):* crossfade an idle loop and an on-power loop for richer sound.
- `Sfx`: one-shots — countdown beeps, checkpoint-pass chime, crash impact, finish jingle.
- All audio files CC0 or original.

### 5.10 HUD & menus (`Hud.ts`, `Menus.ts`)

- **HUD (dashboard):** HTML/CSS overlay anchored bottom-centre. Analogue **rev counter** and **speedometer** drawn as SVG (or canvas 2D) with rotating needles — tach from `Drivetrain.rpm`, speedo from `Drivetrain.speedKmh`. Also show current **gear**, the **countdown timer**, and **next-checkpoint** info ("CP 2/5"). Shown in cockpit view; in chase view show a reduced HUD (timer + speed only).
- **Menus:** main menu, track-select + transmission-select screen (with best times), result screen (time or "TIME UP", Retry / Track Select / Menu). Plain DOM + CSS.

---

## 6. Milestone plan (build in this order)

Each milestone ends in a running build with no console errors. Commit per milestone.

| # | Milestone | Done when |
|---|---|---|
| **M0** | Project scaffold | Vite + TS + Three.js render a lit scene with a ground plane; fixed-step loop runs; no errors. |
| **M1** | Physics integration | Rapier initialised; a dynamic box falls onto a static ground collider and rests; render interpolation works. |
| **M2** | Drivable car | Raycast-vehicle car drives on flat ground — accelerate, brake, steer, reverse. Chase camera. Tuning feels controllable. |
| **M3** | Drivetrain + dashboard + sound | RPM model + manual/automatic transmission; SVG tach + speedo update live; looping engine sound tracks RPM. |
| **M4** | Track system + Track 1 | `TrackBuilder` builds "Skyline Run" from data with trimesh colliders; car drives it including the small jump; cockpit camera + `C` toggle. |
| **M5** | Checkpoints + timer | Ordered gates, countdown with per-gate bonus, finish detection, fail on timeout; Result screen; best time in `localStorage`. |
| **M6** | Crash & recovery | Fall off elevated track → wreck → reset to last checkpoint; flat `groundBeside` areas remain drivable; `R` reset. |
| **M7** | Replay system | Ring-buffer recording; auto crash replays and big-jump highlight replays; cinematic camera; `Space` skips. |
| **M8** | Tracks 2 & 3 | "Loopback" (loop + gap jump) and "The Gauntlet" (multi-jump, loop, corkscrew) built and completable. |
| **M9** | Menus & flow | Full state machine: Menu → TrackSelect (track + transmission) → Countdown → Racing → Result, with retry/navigation. |
| **M10** | Polish | Placeholder art replaced with original/CC0 assets; audio mix; camera shake/feel pass; physics tuning pass; perf check. |

---

## 7. Acceptance criteria (MVP is "done" when all true)

1. Three completable tracks, clearly escalating in difficulty.
2. Each track has ordered checkpoint gates; reaching a gate adds time; running out of time fails the run; reaching the finish records a time.
3. Car has accelerator, brake/reverse, and keyboard steering with believable arcade feel.
4. Player can choose **manual** or **automatic** transmission before a run; both work.
5. Cockpit view is default and shows a working analogue rev counter and speedometer; chase view toggles with `C`.
6. Engine emits a looping sound whose pitch tracks RPM, including a rev-limiter effect.
7. Leaving an **elevated** track section makes the car fall and wreck, then reset to the last checkpoint.
8. Leaving the track where flat ground is beside it keeps the car drivable and the player can steer back.
9. Crashes and notable jumps trigger automatic cinematic replays; replays can be skipped.
10. Best time per track persists across sessions (`localStorage`).
11. Runs at a stable 60 FPS on a mid-range laptop; no console errors; fixed-step physics.
12. No copyrighted or trademarked names, assets, audio, or track layouts anywhere in the project.

---

## 8. Out of scope for MVP

Multiplayer; AI opponents; touch/mobile/gamepad input; car customisation or multiple cars; progressive visible damage modelling beyond the wreck-and-reset; an in-game track editor; online leaderboards or accounts; WebGPU renderer (keep the renderer wrapper thin so it can be swapped later); a clutch / stalling simulation.

---

## 9. Copyright & assets

- **Name:** do not ship as "Stunt Car Racer" or use its track names, car names, or any associated branding. "STUNTLINE" and all track names here are placeholders the owner may change.
- **Car:** a generic, original low-poly car. Not modelled on, named after, or badged as any real manufacturer or real vehicle.
- **Track layouts:** designed from the segment primitives in this spec — do not reproduce any existing game's track.
- **Audio:** CC0 or original only (e.g. CC0 sources for an engine loop and one-shots). Record the source/licence of every asset in `public/CREDITS.md`.
- **Models/textures:** original or CC0; credited in `public/CREDITS.md`.

---

## 10. Notes for the agent

- Build milestones strictly in order; keep the game runnable after each.
- Centralise tunable constants (`CarConfig.ts`, per-track `TrackDef`s) — expect heavy iteration on feel.
- Use placeholder primitives (boxes, cylinders) for the car and tracks until M10; do not stall on art.
- Rapier is WASM and async — initialise it before constructing any physics objects.
- Keep physics at a fixed 1/60 s step with an accumulator; interpolate visuals between steps.
- After M2 and again after M4, pause and sanity-check driving feel before moving on — the raycast-vehicle tuning is the highest-risk part of the project.
- If a design detail here is ambiguous, prefer the simplest interpretation that satisfies Section 7, and leave a `// SPEC:` comment noting the decision.
