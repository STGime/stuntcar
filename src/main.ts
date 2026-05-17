import * as THREE from 'three';
import { Engine } from './core/Engine';
import { PhysicsWorld } from './core/PhysicsWorld';
import { Input } from './core/Input';
import { buildScene } from './world/Scene';
import { Car } from './vehicle/Car';
import { CameraRig } from './camera/CameraRig';
import { Hud } from './ui/Hud';
import { EngineSound } from './audio/EngineSound';
import { Sfx } from './audio/Sfx';
import { buildTrack } from './track/TrackBuilder';
import { TRACKS, trackByDevIndex } from './track/tracks';
import { Race } from './race/Race';
import { CrashSystem } from './race/CrashSystem';
import { OffTrackDetector } from './race/OffTrackDetector';
import { ReplayRecorder } from './replay/ReplayRecorder';
import { ReplayPlayer } from './replay/ReplayPlayer';
import { ReplayCamera } from './replay/ReplayCamera';
import { Menus, loadTransmission } from './ui/Menus';

const FIXED_DT = 1 / 60;
const CRASH_REPLAY_SEC = 3.0;
const HIGHLIGHT_MIN_AIRTIME_SEC = 1.2;
const HIGHLIGHT_PAD_SEC = 0.6;

function gotoMenu(): void {
  const url = new URL(location.href);
  url.search = '';
  location.assign(url.toString());
}
function gotoTracks(): void {
  const url = new URL(location.href);
  url.search = '?screen=tracks';
  location.assign(url.toString());
}
function gotoRetry(): void {
  location.reload();
}

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app in index.html');

  const params = new URLSearchParams(location.search);
  const screen = params.get('screen');
  const trackParam = params.get('track');

  // Screen routing: no ?track param → show menu/track-select screen.
  if (!trackParam) {
    new Menus(document.body, screen === 'tracks' ? 'tracks' : 'menu');
    return;
  }

  // --- Otherwise: build the game ----------------------------------------
  const trackIdx = Math.max(1, Math.min(TRACKS.length, parseInt(trackParam, 10) || 1)) - 1;
  const trackDef = trackByDevIndex(trackIdx);
  const transmission = params.get('trans') === 'manual' ? 'manual' : loadTransmission();

  const engine = new Engine(container);
  const physics = await PhysicsWorld.create();
  const input = new Input();

  buildScene(engine.scene, physics.world);
  const track = buildTrack(engine.scene, physics.world, trackDef);
  document.title = `STUNTLINE — ${trackDef.name}`;

  const car = new Car(engine.scene, physics.world);
  car.drivetrain.setMode(transmission);

  const camera = new CameraRig();
  engine.setCamera(camera.camera);

  const hud = new Hud(document.body);
  hud.setResultCallbacks({ onRetry: gotoRetry, onTrackSelect: gotoTracks, onMenu: gotoMenu });

  const engineSound = new EngineSound();
  const sfx = new Sfx();

  const race = new Race(trackDef, track, car, engine.scene);
  race.onCountdownTick = (phase) => {
    if (phase === 'GO') sfx.longBeep();
    else if (phase !== null) sfx.shortBeep();
  };
  race.start();

  // --- Replay plumbing -----------------------------------------------------
  const recorder = new ReplayRecorder(12, FIXED_DT);
  const replayPlayer = new ReplayPlayer(FIXED_DT);
  const replayCamera = new ReplayCamera();
  const tmpReplayPos = new THREE.Vector3();

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
      recorder.clear();
      race.resumeTimer();
      after();
    });
  };

  const crashSystem = new CrashSystem(car, race, track.minY, () => {
    car.setCrashed(true);
    sfx.crashThud();
    camera.addTrauma(1.0);
    triggerReplay(CRASH_REPLAY_SEC, 'crash', () => {
      car.setCrashed(false);
      race.resetToLastCheckpoint();
      crashSystem.resolve();
    });
  });

  // Off-track 5-second auto-respawn. Suspended while wrecked or replaying.
  const offTrack = new OffTrackDetector(
    car,
    race,
    physics.world,
    track.collider,
    () => crashSystem.state !== 'normal' || replayPlayer.active || race.isCountdown,
    () => race.resetToLastCheckpoint(),
  );
  offTrack.onTick = () => sfx.shortBeep();

  let airtimeSec = 0;
  let wasAirborne = false;

  // --- Audio start gesture -------------------------------------------------
  const startAudioOnce = (): void => {
    engineSound.start();
    sfx.start();
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
    if (replayPlayer.active) return;
    if (race.state === 'racing') race.resetToLastCheckpoint();
    else if (race.state === 'finished' || race.state === 'timeup') gotoRetry();
  });
  input.onPress('Escape', () => {
    if (race.state === 'finished' || race.state === 'timeup') gotoMenu();
    else gotoTracks();
  });
  input.onPress('KeyT', () => car.drivetrain.toggleMode());
  input.onPress('KeyE', () => car.drivetrain.shiftUp());
  input.onPress('KeyQ', () => car.drivetrain.shiftDown(car.speedKmh));
  input.onPress('KeyM', () => engineSound.toggleMute());
  input.onPress('Space', () => replayPlayer.skip());

  // Quick-switch tracks during a session.
  const gotoTrack = (n: number): void => {
    const url = new URL(location.href);
    url.searchParams.set('track', String(n));
    location.assign(url.toString());
  };
  input.onPress('Digit1', () => gotoTrack(1));
  input.onPress('Digit2', () => gotoTrack(2));
  input.onPress('Digit3', () => gotoTrack(3));

  const currentThrottle = (): number => {
    const accel = input.isDown('ArrowUp', 'KeyW');
    const brake = input.isDown('ArrowDown', 'KeyS');
    if (car.drivetrain.mode === 'automatic' && car.drivetrain.gear === 0) {
      return brake ? 1 : 0;
    }
    return accel ? 1 : 0;
  };

  console.log(
    `[STUNTLINE] Loaded "${trackDef.name}" (${trackDef.difficulty}, ${transmission}) — ${track.checkpoints.length} checkpoints.`,
  );

  // Track checkpoint count for chime SFX.
  let lastPassedCount = 0;

  engine.start(
    FIXED_DT,
    // --- fixed physics step ---------------------------------------------
    (dt) => {
      if (replayPlayer.active) return;

      // During countdown the world is frozen — no input, no physics step.
      if (race.isCountdown) {
        race.update(dt);
        return;
      }

      car.update(dt, input);
      physics.step();
      car.postStep();
      recorder.capture(car, currentThrottle());
      race.update(dt);
      crashSystem.update(dt);
      offTrack.update(dt);

      // Checkpoint chime on each gate pass.
      if (race.checkpoints.passed !== lastPassedCount) {
        if (race.checkpoints.passed > lastPassedCount) sfx.chime();
        lastPassedCount = race.checkpoints.passed;
      }

      // Airtime → highlight replay + landing camera shake
      if (race.state === 'racing' && crashSystem.state === 'normal') {
        if (car.airborne) {
          airtimeSec += dt;
          wasAirborne = true;
        } else if (wasAirborne) {
          const flight = airtimeSec;
          airtimeSec = 0;
          wasAirborne = false;
          // Landing shake — scales with airtime so a long flight thumps hard.
          camera.addTrauma(Math.min(0.7, flight * 0.4));
          if (flight >= HIGHLIGHT_MIN_AIRTIME_SEC) {
            triggerReplay(flight + HIGHLIGHT_PAD_SEC, 'highlight', () => {});
          }
        }
      } else {
        airtimeSec = 0;
        wasAirborne = false;
      }
    },
    // --- render ----------------------------------------------------------
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
        hud.updateRace({ ...race.snapshot(), wrecked: false, offTrackSecondsLeft: 0 });
        engineSound.update(frameDt, frame.rpm, frame.throttle, false, frame.speedKmh);
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
      hud.updateRace({
        ...race.snapshot(),
        wrecked: crashSystem.state === 'wrecking',
        offTrackSecondsLeft: offTrack.secondsLeft(),
      });
      engineSound.update(frameDt, dt.rpm, currentThrottle(), dt.onLimiter, car.speedKmh);
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
