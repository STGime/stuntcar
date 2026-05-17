# STUNTLINE — Credits

Per the spec (§9 Copyright & assets): the project ships with **no third-party
assets**. Every visible/audible thing in the build is original or procedurally
generated at runtime.

## Visuals

| Asset | Source |
|---|---|
| Car chassis, cabin, hood, spoiler, head/tail lights | **Original** — `src/vehicle/Car.ts`, composed from Three.js BoxGeometry primitives. |
| Track ribbon, side walls, end caps, earth skirt | **Original procedural mesh** — `src/track/TrackBuilder.ts`, generated from `TrackDef` segment lists. |
| Sky gradient | **Original shader** — `src/world/Scene.ts`, GLSL vertex+fragment material on a Three.js sphere. |
| Ground plane + grid | **Three.js built-ins** (PlaneGeometry, GridHelper). |
| Checkpoint gates (pylons + beam) | **Original primitives** — `src/race/Checkpoints.ts`. |
| HUD (gauges, dashboard) | **Original SVG**, generated at runtime — `src/ui/Hud.ts`. |
| Menus (Main, Track Select) | **Original HTML/CSS** — `src/ui/Menus.ts`. |

## Audio

| Asset | Source |
|---|---|
| Engine drone (idle through redline + limiter bounce) | **Procedural Web Audio** — `src/audio/EngineSound.ts`. Two detuned oscillators (sawtooth + square) through a lowpass; frequency tracks RPM/30. |
| Wind whoosh (speed-scaled) | **Procedural noise** — 2 s white-noise buffer looped through a lowpass in `EngineSound`, volume ∝ speed². |
| Countdown beeps (3 / 2 / 1 / GO) | **Procedural** — `src/audio/Sfx.ts`, sine bursts with attack/decay envelope. |
| Checkpoint chime | **Procedural** — two-tone sine chime in `Sfx`. |
| Crash thud | **Procedural** — sawtooth downward sweep in `Sfx`. |

## Names & branding

- **STUNTLINE** is a working title. The repository does **not** ship as
  "Stunt Car Racer" and does not use any branding, track names, vehicle
  names, or assets associated with that game.
- Track names (*Skyline Run*, *Loopback*, *The Gauntlet*) are original.
- The car is a generic low-poly racing-style chassis; it is not modelled
  on, named after, or badged as any real-world manufacturer or vehicle.

## Licence

Source code: see repository root.

If/when CC0 or original art and audio are introduced in a future M10+
polish round, they will be listed here with their source URLs and
licence text.
