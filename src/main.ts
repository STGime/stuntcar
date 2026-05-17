import * as THREE from 'three';
import { Engine } from './core/Engine';
import { PhysicsWorld } from './core/PhysicsWorld';
import { Input } from './core/Input';
import { buildScene } from './world/Scene';
import { Car } from './vehicle/Car';
import { CameraRig } from './camera/CameraRig';
import { Hud } from './ui/Hud';
import { EngineSound } from './audio/EngineSound';
import { buildTrack } from './track/TrackBuilder';
import { TRACKS, trackByDevIndex } from './track/tracks';
import { Race } from './race/Race';
import { CrashSystem } from './race/CrashSystem';
import { ReplayRecorder } from './replay/ReplayRecorder';
import { ReplayPlayer } from './replay/ReplayPlayer';
import { ReplayCamera } from './replay/ReplayCamera';

const FIXED_DT = 1 / 60;
/** Seconds of buffer to play back on a crash. */
const CRASH_REPLAY_SEC = 3.0;
/** Airborne duration above which a landing triggers a highlight replay. */
const HIGHLIGHT_MIN_AIRTIME_SEC = 1.2;
/** Padding around the airborne stretch when slicing the highlight replay. */
const HIGHLIGHT_PAD_SEC = 0.6;

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app in index.html');

  const engine = new Engine(container);
  const physics = await PhysicsWorld.create(); // Rapier WASM init
  const input = new Input();

  buildScene(engine.scene, physics.world);

  // M8 dev switcher: ?track=1|2|3 (defaults to 1). M9 will replace this
  // with a real menu screen.
  const trackParam = new URLSearchParams(location.search).get('track');
  const trackIdx = trackParam ? Math.max(1, Math.min(TRACKS.length, parseInt(trackParam, 10) || 1)) - 1 : 0;
  const trackDef = trackByDevIndex(trackIdx);
  const track = buildTrack(engine.scene, physics.world, trackDef);
  document.title = `STUNTLINE — ${trackDef.name}`;

  const car = new Car(engine.scene, physics.world);

  const camera = new CameraRig();
  engine.setCamera(camera.camera);

  const hud = new Hud(document.body);
  const engineSound = new EngineSound();

  const race = new Race(trackDef, track, car, engine.scene);
  race.start();

  // --- Replay plumbing -----------------------------------------------------
  const recorder = new ReplayRecorder(12, FIXED_DT);
  const replayPlayer = new ReplayPlayer(FIXED_DT);
  const replayCamera = new ReplayCamera();
  const tmpReplayPos = new THREE.Vector3();

  /** Pause physics + race; play `seconds` of buffer; on completion run `after`. */
  const triggerReplay = (
    seconds: number,
    kind: 'crash' | 'highlight',
    after: () => void,
  ): void => {
    const frames = recorder.snapshotLast(seconds, FIXED_DT);
    if (frames.length < 2) {
      after();
      return;
    }
    race.pauseTimer();
    replayCamera.reset();
    engine.setCamera(replayCamera.camera);
    hud.setReplayActive(true);
    replayPlayer.play(frames, kind, () => {
      hud.setReplayActive(false);
      engine.setCamera(camera.camera);
      recorder.clear(); // start fresh after the replay
      race.resumeTimer();
      after();
    });
  };

  // CrashSystem fires onCrash → trigger replay → on completion, recover.
  const crashSystem = new CrashSystem(car, race, track.minY, () => {
    car.setCrashed(true);
    triggerReplay(CRASH_REPLAY_SEC, 'crash', () => {
      car.setCrashed(false);
      race.resetToLastCheckpoint();
      crashSystem.resolve();
    });
  });

  // Airtime tracker for highlight replays.
  let airtimeSec = 0;
  let wasAirborne = false;

  // --- Audio start gesture -------------------------------------------------
  const startAudioOnce = (): void => {
    engineSound.start();
    window.removeEventListener('keydown', startAudioOnce);
    window.removeEventListener('pointerdown', startAudioOnce);
  };
  window.addEventListener('keydown', startAudioOnce);
  window.addEventListener('pointerdown', startAudioOnce);

  // --- Key bindings --------------------------------------------------------
  input.onPress('KeyC', () => {
    if (!replayPlayer.active) camera.toggleView();
  });
  input.onPress('KeyR', () => {
    if (replayPlayer.active) return; // ignore during replay
    if (race.state === 'racing') race.resetToLastCheckpoint();
    else race.start();
  });
  input.onPress('KeyT', () => car.drivetrain.toggleMode());
  input.onPress('KeyE', () => car.drivetrain.shiftUp());
  input.onPress('KeyQ', () => car.drivetrain.shiftDown(car.speedKmh));
  input.onPress('KeyM', () => engineSound.toggleMute());
  input.onPress('Space', () => replayPlayer.skip());

  // M8 dev: keys 1/2/3 switch tracks (reload with ?track=N).
  const gotoTrack = (n: number): void => {
    const url = new URL(location.href);
    url.searchParams.set('track', String(n));
    location.assign(url.toString());
  };
  input.onPress('Digit1', () => gotoTrack(1));
  input.onPress('Digit2', () => gotoTrack(2));
  input.onPress('Digit3', () => gotoTrack(3));

  // Throttle estimate for audio + recorder.
  const currentThrottle = (): number => {
    const accel = input.isDown('ArrowUp', 'KeyW');
    const brake = input.isDown('ArrowDown', 'KeyS');
    if (car.drivetrain.mode === 'automatic' && car.drivetrain.gear === 0) {
      return brake ? 1 : 0;
    }
    return accel ? 1 : 0;
  };

  console.log(
    `[STUNTLINE] Loaded "${trackDef.name}" (${trackDef.difficulty}) — ${track.checkpoints.length} checkpoints, minY = ${track.minY.toFixed(2)}. Press 1/2/3 to switch tracks.`,
  );

  engine.start(
    FIXED_DT,
    // --- fixed physics step (suspended during replay) ----------------------
    (dt) => {
      if (replayPlayer.active) return;

      car.update(dt, input);
      physics.step();
      car.postStep();
      recorder.capture(car, currentThrottle());
      race.update(dt);
      crashSystem.update(dt);

      // Airtime → highlight replay
      if (race.state === 'racing' && crashSystem.state === 'normal') {
        if (car.airborne) {
          airtimeSec += dt;
          wasAirborne = true;
        } else if (wasAirborne) {
          // Just landed.
          const flight = airtimeSec;
          airtimeSec = 0;
          wasAirborne = false;
          if (flight >= HIGHLIGHT_MIN_AIRTIME_SEC) {
            triggerReplay(flight + HIGHLIGHT_PAD_SEC, 'highlight', () => {});
          }
        }
      } else {
        airtimeSec = 0;
        wasAirborne = false;
      }
    },
    // --- render -----------------------------------------------------------
    (alpha, frameDt) => {
      if (replayPlayer.active) {
        replayPlayer.update(frameDt);
        const frame = replayPlayer.currentFrame();
        car.renderReplay(frame);
        tmpReplayPos.set(frame.chassisPos.x, frame.chassisPos.y, frame.chassisPos.z);
        replayCamera.update(tmpReplayPos, frameDt);

        hud.update({
          rpm: frame.rpm,
          speedKmh: frame.speedKmh,
          gear: frame.gear,
          mode: car.drivetrain.mode === 'automatic' ? 'A' : 'M',
          onLimiter: false,
        });
        hud.updateRace({ ...race.snapshot(), wrecked: false });
        engineSound.update(frameDt, frame.rpm, frame.throttle, false);
        return;
      }

      car.render(alpha);
      camera.update(car, frameDt);

      const dt = car.drivetrain;
      hud.update({
        rpm: dt.rpm,
        speedKmh: car.speedKmh,
        gear: dt.gearLabel(),
        mode: dt.mode === 'automatic' ? 'A' : 'M',
        onLimiter: dt.onLimiter,
      });
      hud.updateRace({ ...race.snapshot(), wrecked: crashSystem.state === 'wrecking' });
      engineSound.update(frameDt, dt.rpm, currentThrottle(), dt.onLimiter);
    },
  );
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    '<pre style="color:#ff9a9a;padding:24px;font:13px ui-monospace,monospace;white-space:pre-wrap">' +
    'STUNTLINE failed to start:\n\n' +
    String(err && (err as Error).stack ? (err as Error).stack : err) +
    '</pre>';
});
