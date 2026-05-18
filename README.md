# STUNTLINE

A browser-based 3D stunt racing game. Pure TypeScript, no game engine
framework. Drive a single car around three closed-loop circuits — banked
corners, jumps, forward-helix loops, hills and valleys — against a
countdown timer that's topped up at each checkpoint.

Built incrementally from the spec in [STUNTLINE_MVP.md](./STUNTLINE_MVP.md).
Milestones M0 through M11 are complete; see [Status](#status) below.
Post-MVP work added 3-lap races, an arcade-style high-score table, and
a visual polish pass (shadows, bloom, layered mountains, roadside props,
skid marks + dust, curbs, etc.).

> Working title. The repository does **not** ship as "Stunt Car Racer" and
> uses none of that game's branding, track names, vehicle names, or assets.
> See [public/CREDITS.md](./public/CREDITS.md).

---

## Run it

```bash
npm install
npm run dev      # Vite serves on http://localhost:5173
```

Other scripts:

```bash
npm run build    # tsc --noEmit + Vite production build → dist/
npm run preview  # serve the production build
```

Requirements: **Node 18+** (developed on Node 22).

---

## How to play

Land on the page → **Main Menu** → **Start** → **Track Select** (3 tracks
+ Automatic/Manual transmission toggle + Weather selector) → 3-2-1-GO
**countdown** → **Racing**. Reach each checkpoint in order before the
timer hits zero; each gate adds time. Each race is **3 laps**; crossing
the finish line on the final lap records your total time. Beat the
leaderboard's worst time and you enter a 3-letter arcade name; the
per-track top 10 is persisted in `localStorage`. A `← MENU` button
sits in the top-left during a race to quit back to the main menu.

### Controls

| Action | Keys |
|---|---|
| Accelerate | `W` / `↑` |
| Brake · reverse | `S` / `↓` |
| Steer | `A D` / `← →` |
| Shift up · down (manual) | `E` · `Q` |
| Camera (chase ↔ cockpit) | `C` |
| Reset to last checkpoint | `R` |
| Skip replay | `Space` |
| Toggle Automatic ↔ Manual | `T` |
| Mute engine | `M` |
| Back to Track Select / Menu | `Esc` |
| Switch tracks during a run | `1` `2` `3` |

### What you'll see

- **Cockpit dashboard**: analogue rev counter + speedometer (SVG), gear
  letter, transmission mode, `LIMIT` warning at the redline, plus a
  steering wheel that turns with input (cockpit view only).
- **Race bar** (top): timer in `M:SS.s`, `LAP X/3`, CP counter,
  `WRECKED` badge during crash tumbles. A "LAP 2" / "FINAL LAP" banner
  flashes mid-screen on each lap change.
- **Forward-helix loops** on Tracks 2 and 3: tangent-aligned so the
  chassis stays upright through the apex (no Rapier raycast-suspension
  upside-down issues).
- **Cinematic replays** on crashes and on long-airtime jumps (>1.2 s).
- **Off-track countdown**: drive off the ribbon and you've got 5 s to
  return before you're respawned at the last checkpoint.
- **Arcade high-score table**: top 10 per track, 3-letter names,
  surfaced on the result screen + on each Track Select card.
- **Driving feedback**: rubber skid marks + grey tire smoke on
  hard cornering / heavy braking on tarmac; warm dust puffs from
  wheels touching grass off-track.
- **Polished world**: tight-frustum dynamic shadow that follows the
  car, ACES-tonemapped lighting, a layered hazy mountain ridge ring,
  ~220 seeded roadside props (pines / boulders / bushes), red-white
  curbs on turns and banked corners, gate banners labelled `CP N` /
  `FINISH`, two waving checkered flags at the finish line, sponsor
  billboards alongside each checkpoint, env-mapped reflective body
  paint, door-number decal + yellow side stripe, a `+X.Xs` bonus
  floater on every gate pass, vignette + speed-driven radial blur,
  chase-camera roll into corners, sustained tire screech audio, and
  an UnrealBloom-driven sun disc + emissive halo.
- **Mini-map** in the top-right showing the track centerline + a
  yellow dot for the car.
- **Weather presets** (selected on Track Select):
  - **Day** — warm golden-hour.
  - **Overcast** — soft grey-blue diffuse, dim sun.
  - **Sunset** — low orange sun, purple sky top, fiery horizon.
  - **Night** — black sky, moonlight, dashboard / brake lights bloom
    hard, two `SpotLight` headlight beams illuminate the road ahead.
  - **Rain** — grey overcast, slow falling rain, glossy wet ribbon,
    ~30 % less wheel grip so corners drift.
  - **Random** — picks a fresh preset each load.
- **Easter egg on Track 1**: a small cottage inside the closed loop
  with a blinking neon sign on its roof.

---

## Tracks

| # | Name | Difficulty | Highlights |
|---|---|---|---|
| 1 | Skyline Run | easy | Closed loop. 4 straights + 4 corners; symmetric hill on each side straight; jump + valley on the back straight. |
| 2 | Loopback | medium | Closed loop. Jump + valley, forward-helix loop, narrow section. |
| 3 | The Gauntlet | hard | Closed loop. Two jumps with valleys, narrow + banked S-curve, forward-helix loop. |

Each track is a closed circuit: cross the start line, drive a lap, cross
the finish line (= start line). Each race is **3 laps**. Per-track
best times AND the top-10 arcade leaderboard live in `localStorage`.

---

## Architecture

Plain TypeScript modules orchestrated from `src/main.ts`. The game is a
single page; menus and the result modal are HTML overlays driven by URL
parameters so each "screen transition" is a normal navigation.

```
src/
  main.ts                    URL routing + game loop wiring
  core/
    Engine.ts                Three.js renderer + fixed-step accumulator + RAF
    PhysicsWorld.ts          Rapier WASM init + world wrapper
    Input.ts                 keyboard: held state + edge-press callbacks
    BodyView.ts              rigid body ↔ Three.js, transform interpolation
    PostFX.ts                EffectComposer (Render → UnrealBloom → SpeedFx → Output)
  world/
    Scene.ts                 sky dome (with sun disc), lighting, ground + grid
    Mountains.ts             three layered ridge silhouette rings on the horizon
    Props.ts                 seeded instanced trees / boulders / bushes scatter
    Weather.ts               Day / Overcast / Sunset / Night / Rain presets + Random
    Rain.ts                  LineSegments rain cloud that follows the car
    HouseDecoration.ts       Track-1 Easter-egg cottage + blinking sign
  vehicle/
    Car.ts                   chassis + DynamicRayCastVehicleController + visuals
                             (incl. steering wheel that rotates with input)
    CarConfig.ts             tunable constants (mass, torque, suspension, gears…)
    Drivetrain.ts            RPM model, torque curve, manual/automatic transmission
  track/
    TrackTypes.ts            Segment / Checkpoint / TrackDef
    TrackBuilder.ts          walks the segment list → ribbon + skirts + curbs
                             + centre stripe + Rapier trimesh + centerline samples
    tracks/                  track01_easy.ts, track02_medium.ts, track03_hard.ts
  race/
    Race.ts                  state machine + 3-lap wrap (countdown / racing / timeup / finished)
    RaceTimer.ts             countdown + per-gate bonus + lap bonus
    Checkpoints.ts           ordered gate detection, banner labels, finish flags
    CrashSystem.ts           kill-plane + tipped-stuck triggers, fires onCrash
    OffTrackDetector.ts      5 s grace countdown when wheels leave the ribbon
    Leaderboard.ts           per-track top-10 (name + time) in localStorage
  replay/
    ReplayRecorder.ts        12 s ring buffer (per fixed step)
    ReplayPlayer.ts          real-time playback with onComplete callback
    ReplayCamera.ts          slow orbit cinematic camera
  fx/
    SkidEffects.ts           skid-mark + smoke/dust ring buffers (GPU-resident)
    BonusFloaters.ts         "+X.Xs" billboards spawned on gate passes
  camera/
    CameraRig.ts             chase + cockpit + trauma-based shake
  audio/
    EngineSound.ts           procedural engine drone + wind whoosh (Web Audio)
    Sfx.ts                   procedural one-shots: beep / chime / thud
  ui/
    Hud.ts                   SVG dashboard + race bar + result modal + name entry + quit btn
    Menus.ts                 Main Menu + Track Select (transmission + weather + leaderboard)
    MiniMap.ts               Top-right SVG mini-map of the track centerline
```

### Notable design decisions

- **Fixed 1/60 s physics with render interpolation.** Rapier is never
  stepped with a variable dt; visuals are smoothed by `BodyView`
  interpolating between the previous and current physics transforms.
- **Track is data.** A `TrackDef` is a list of segments
  (`straight | rampUp | rampDown | gap | loop | bankedCurve | narrow`).
  `TrackBuilder` walks an orthonormal frame along the list and emits a
  ribbon of cross-sections + a single Rapier `trimesh` collider.
- **Forward-helix loops** instead of closed vertical circles. A true
  closed loop would invert the chassis at the top, and Rapier's
  raycast-suspension pushes wheels *away* from the surface (so the car
  falls off). The tangent-aligned helix keeps the chassis upright,
  pitching at most ~22°.
- **Position-based gate detection.** Checkpoints have no Rapier
  colliders — too easy to accidentally apply contact forces. The
  detector transforms the chassis position into each gate's local
  frame and checks an AABB.
- **closedLoop snap.** For circuit tracks, the last cross-section of
  the final strip is snapped onto the first cross-section so the
  ribbon visually closes with no seam.
- **minY normalisation.** TrackBuilder shifts the whole track so its
  lowest point sits 1 m above the ground plane, regardless of how
  high the loop apex gets — no track ever dips through the ground
  and disappears.
- **Procedural audio.** Engine = two detuned saw/square oscillators
  through a lowpass, frequency = rpm/30 (4-stroke firing rate). Wind
  = looped noise buffer scaled by speed². SFX = sine bursts with
  attack-decay envelopes. No external samples.

---

## Status

All MVP milestones from the spec (M0–M10) plus the visual-polish pass
(M11) are complete:

| # | What |
|---|---|
| M0  | Vite + TS + Three.js scaffold, fixed-step game loop |
| M1  | Rapier physics with render interpolation |
| M2  | Drivable raycast-vehicle car |
| M3  | RPM drivetrain + transmission + SVG dashboard + engine sound |
| M4  | Data-driven TrackBuilder + Track 1 |
| M5  | Checkpoints + race timer + result modal + best-time persistence |
| M6  | Crash detection + recovery |
| M7  | Replay system (crash + highlight) |
| M8  | Tracks 2 & 3 (loop + corkscrew vocabulary) |
| M9  | Main Menu / Track Select / Countdown / Result flow |
| M10 | Better chassis model, camera shake, atmospheric sky, wind sound, CREDITS.md |
| M11 | Visual polish: shadows, color grade, mountains, props, skid + dust, bloom, banners + flags, curbs, steering wheel |

Post-MVP additions:
- All three tracks reworked into **closed-loop circuits** with start =
  finish line, distinguished features (hills/jumps/valleys/loops/narrows)
  per side, and seamless ribbon closure.
- **3-lap races**: each race is now 3 laps with a `LAP X/3` indicator,
  a mid-screen "LAP 2" / "FINAL LAP" banner, and a per-lap timer
  bonus on each finish-line crossing.
- **Arcade high-score table**: per-track top 10, 3-letter names
  (A-Z 0-9), surfaced on the result modal + Track Select cards.
- **Earth skirts**: dirt walls extending from the slab's bottom edges
  down to the ground with a vertex-colour gradient (fakes ambient
  occlusion at the hill/ground crease) and an outward taper.
- **Yellow centre stripe** along each track for depth cues over bumps.
- **Off-track 5 s auto-respawn** with red-border flash + per-second beep.
- **Tipped-over wreck** triggers at any tilt past ~73° (so chassis on
  its side, not just upside-down, gets the crash + reset).

### M11 polish pass

- **Dynamic shadow mapping** — tight 70 m frustum on a 2048² shadow
  map; the camera + target slide with the car each frame so shadows
  stay sharp wherever you're driving.
- **ACES filmic tonemapping** + golden-hour palette (cool sky-fill /
  warm sun + dirt bounce); fog tightened to 120–480 m for depth.
- **UnrealBloom** post-FX on emissive geometry (brake lights, sun
  disc, gauges) — gentle (strength 0.25 / threshold 0.85) so the
  scene stays crisp.
- **Sun disc + halo** baked into the sky shader, aligned with the
  directional sun.
- **Three-layer mountain ridge ring** (270 / 360 / 440 m radii) with
  seeded sum-of-sines profile and fog-driven atmospheric perspective.
- **Roadside props**: ~220 instanced pines / boulders / bushes per
  track, seeded per `trackDef.id`, rejected via centerline-distance
  check so nothing pokes through the ribbon.
- **Tire skid marks + tire smoke** on hard cornering / heavy braking,
  per-wheel GPU ring buffer (600 marks, 240 puffs) with shader-driven
  fades.
- **Off-road dust**: warm brown puffs from each wheel touching grass.
- **Per-gate banner**: canvas-textured "CP N" / "FINISH" label under
  every beam, oriented toward oncoming traffic.
- **Waving checkered flags** at the finish line — two cloth panels on
  metal poles, vertex-deformed each frame with stacked sines.
- **Red/white curbs** painted on the inside edge of every turn or
  banked corner.
- **Steering wheel** mesh inside the cockpit that rotates with input.

### Post-M11 polish

- **Weather presets** (Day / Overcast / Sunset / Night / Rain) with a
  `Random` option that re-rolls each load. Each preset retunes sun
  direction + colour, hemisphere bounce, sky shader uniforms, fog
  tint + range and tonemap exposure. Choice persists via
  `localStorage` + `?weather=...` URL param.
- **Rain**: a `LineSegments` cloud of ~2000 falling streaks anchored
  to the car, plus a glossy wet ribbon (darker + low-roughness +
  metalness up) and ~30 % less wheel grip so corners drift.
- **Night headlights** — two `SpotLight` cones mounted at the front
  of the chassis, lit only under the Night preset.
- **Sponsor billboards** beside every non-finish gate cycling through
  8 procedural brands (TURBO+, APEX FUEL, VELOCITY, …).
- **Env-mapped car paint** — one-shot 256² cube probe at scene-build
  time gives the metallic body real sky / horizon reflections.
- **Door-number decal + side stripe** on each flank of the car.
- **Bonus floaters**: a "+X.Xs" green sprite pops at every gate as
  you cross, rises, billboards, fades.
- **Mini-map** in the top-right with the centerline + spawn dot + a
  glowing yellow car dot.
- **Vignette + radial blur at speed** — custom ShaderPass slotted
  between bloom and OutputPass.
- **Chase camera roll** — horizon tilts slightly into corners,
  smoothed from chassis lateral velocity, capped at ±5.7°.
- **Sustained tire screech** audio: bandpass-noise + bandpass-saw
  graph gated by `setScreech(t)` from the slip threshold.
- **Solid earth skirts**: dirt walls under the ribbon are now a
  separate trimesh collider (distinct handle from the ribbon) so the
  car can't drive through them, and the off-track detector still
  treats riding them as off-road.
- **Quit-to-menu button** in the HUD top-left.
- **Easter egg on Track 1** — a tiny cottage at the centroid of the
  closed loop with a blinking neon sign on its roof.
- **Favicon + tab title** — `STUNTLINE` only, with a custom SVG icon
  matching the brand palette.

---

## Stack

- **TypeScript** (strict)
- **Vite** (dev server + build)
- **Three.js** r169 (WebGL renderer)
- **@dimforge/rapier3d-compat** 0.14 (physics, loaded as WASM via the
  compat package's base64 bundle)
- **Web Audio API** (no library)

No game engine, no React, no shaders beyond the sky-dome gradient.

---

## Spec acceptance criteria (§7)

1. ✅ Three completable tracks of escalating difficulty.
2. ✅ Ordered gates, per-gate bonuses, fail on timeout, finish records a time.
3. ✅ Accelerator / brake / reverse / keyboard steering, arcade feel.
4. ✅ Manual / Automatic transmission chosen before a run.
5. ✅ Cockpit default with analog tach + speedo; chase via `C`.
6. ✅ Looping engine sound tracks RPM with rev-limiter effect.
7. ✅ Elevated track + ground-beside recovery behaviour.
8. ✅ Crashes + notable jumps trigger cinematic replays, `Space` skips.
9. ✅ Best time per track persists across sessions (`localStorage`).
10. ✅ Stable 60 FPS on a mid-range laptop, no console errors, fixed-step physics.
11. ✅ Original / procedural assets only.

---

## Credits

All visual and audio assets are original or procedurally generated at
runtime. See [public/CREDITS.md](./public/CREDITS.md) for the full
inventory.
