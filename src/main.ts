import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Engine } from './core/Engine';
import { PhysicsWorld } from './core/PhysicsWorld';
import { Input } from './core/Input';
import { buildScene, SUN_OFFSET } from './world/Scene';
import { scatterRoadsideProps } from './world/Props';
import { scatterCityProps } from './world/CityProps';
import { House } from './world/HouseDecoration';
import {
  WEATHER_PRESETS,
  loadWeatherChoice,
  resolveWeatherChoice,
  type WeatherChoice,
} from './world/Weather';
import { Rain } from './world/Rain';
import { Snow } from './world/Snow';
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
import { MiniMap } from './ui/MiniMap';
import { loadSettings } from './ui/Settings';
import { SkidEffects } from './fx/SkidEffects';
import { BonusFloaters } from './fx/BonusFloaters';

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
  const weatherParam = params.get('weather') as WeatherChoice | null;
  const validParam = weatherParam === 'random' || (weatherParam && weatherParam in WEATHER_PRESETS);
  const weatherChoice: WeatherChoice = validParam ? (weatherParam as WeatherChoice) : loadWeatherChoice();
  const weather = WEATHER_PRESETS[resolveWeatherChoice(weatherChoice)];

  const settings = loadSettings();

  const engine = new Engine(container);
  engine.setExposure(weather.exposure);
  const physics = await PhysicsWorld.create();
  const input = new Input();

  const theme = trackDef.theme ?? 'forest';
  const { sun } = buildScene(engine.scene, physics.world, weather, theme);
  const track = buildTrack(engine.scene, physics.world, trackDef, {
    wet: !!weather.wet,
    trackFriction: weather.trackFriction,
    urban: theme === 'city',
  });
  if (theme === 'city') {
    scatterCityProps(engine.scene, track, trackDef.id);
  } else {
    scatterRoadsideProps(engine.scene, physics.world, track, trackDef.id);
  }
  const rain = weather.rain ? new Rain(engine.scene) : null;
  const snow = weather.snow ? new Snow(engine.scene, track.centerline) : null;
  document.title = 'STUNTLINE';

  // Track 1 Easter-egg house at the circuit's centroid.
  let easterEggHouse: House | null = null;
  if (trackDef.id === 'skyline-run' && track.centerline.length > 0) {
    let sumX = 0;
    let sumZ = 0;
    for (const c of track.centerline) {
      sumX += c.x;
      sumZ += c.z;
    }
    const cx = sumX / track.centerline.length;
    const cz = sumZ / track.centerline.length;
    easterEggHouse = new House(
      engine.scene,
      new THREE.Vector3(cx, 0, cz),
      'CringeDad72 is the best!',
    );
  }

  const car = new Car(engine.scene, physics.world);
  car.drivetrain.setMode(transmission);
  car.setHeadlights(weather.id === 'night');
  if (weather.slipFactor !== undefined) car.setGripFactor(weather.slipFactor);

  const camera = new CameraRig(settings.fov);
  camera.rollEnabled = settings.cameraRoll;
  camera.shakeEnabled = settings.cameraShake;
  engine.setCamera(camera.camera);
  engine.enablePostFX();

  // One-shot cube probe at the car's spawn so the metallic body paint picks
  // up sky + horizon reflections. The car is hidden during the render so it
  // doesn't see itself. Sky / mountains are static so a single probe is
  // enough — no per-frame cost.
  {
    const cubeRT = new THREE.WebGLCubeRenderTarget(256, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCam = new THREE.CubeCamera(0.5, 1000, cubeRT);
    cubeCam.position.copy(track.spawn.position);
    cubeCam.position.y += 1.2;
    car.setVisible(false);
    cubeCam.update(engine.renderer, engine.scene);
    car.setVisible(true);
    car.applyEnvMap(cubeRT.texture, 0.7);
  }

  const hud = new Hud(document.body);
  hud.setResultCallbacks({ onRetry: gotoRetry, onTrackSelect: gotoTracks, onMenu: gotoMenu });
  const miniMap = new MiniMap(
    document.body,
    track.centerline,
    { x: track.spawn.position.x, z: track.spawn.position.z },
    settings.miniMap,
  );

  const engineSound = new EngineSound();
  if (settings.audioMuted) engineSound.setMuted(true);
  const sfx = new Sfx();
  if (settings.audioMuted) sfx.setMuted(true);
  const skidFx = new SkidEffects(engine.scene);
  const bonusFloaters = new BonusFloaters(engine.scene);

  const race = new Race(trackDef, track, car, engine.scene);
  race.onCountdownTick = (phase) => {
    if (phase === 'GO') sfx.longBeep();
    else if (phase !== null) sfx.shortBeep();
  };
  race.onLapComplete = () => sfx.longBeep();
  race.onCheckpoint = (bonusSec, pos) => bonusFloaters.spawn(pos, bonusSec);
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

  // Reusable scratch for slip-vector math in the fixed step.
  const tmpFwd = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpLinvel = new THREE.Vector3();
  const wheelRayOrigin = { x: 0, y: 0, z: 0 };
  const wheelRayDir = { x: 0, y: -1, z: 0 };
  let dustFrame = 0;

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
    if (replayPlayer.active) return;
    camera.toggleView();
    car.setCockpitView(camera.isCockpit);
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
  input.onPress('Digit4', () => gotoTrack(4));

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

      // Tire skid marks + smoke + off-road dust. Per wheel:
      //   - on-track + slipping (lateral or hard brake)  → skid mark + grey smoke
      //   - off-track at speed                            → brown dust puff
      // Airborne wheels stay clean.
      let screechT = 0;
      if (race.state === 'racing' && crashSystem.state === 'normal') {
        const linvel = car.chassisBody.linvel();
        const rotR = car.chassisBody.rotation();
        tmpQuat.set(rotR.x, rotR.y, rotR.z, rotR.w);
        tmpFwd.set(0, 0, 1).applyQuaternion(tmpQuat);
        tmpRight.set(1, 0, 0).applyQuaternion(tmpQuat);
        tmpLinvel.set(linvel.x, linvel.y, linvel.z);
        const lateral = Math.abs(tmpLinvel.dot(tmpRight));
        const forward = tmpLinvel.dot(tmpFwd);
        const speed = tmpLinvel.length();
        const heavyBrake =
          input.isDown('ArrowDown', 'KeyS') && Math.abs(forward) > 11;
        const cornering = lateral > 4.2;
        const slipIntensity = Math.min(
          1,
          Math.max((lateral - 3) / 6, heavyBrake ? speed / 35 : 0),
        );
        // Dust is emitted every other physics tick per wheel to keep the
        // ring buffer from churning when all four wheels are off track.
        dustFrame++;
        for (let i = 0; i < car.wheelCount; i++) {
          const c = car.wheelContact(i);
          if (!c) continue;
          // Is THIS wheel on the track? A short ray from just above the
          // contact looks for the track collider. Excluding the chassis
          // ensures the ray doesn't bounce off the car itself.
          let onTrack = true;
          if (track.collider) {
            wheelRayOrigin.x = c.x;
            wheelRayOrigin.y = c.y + 0.12;
            wheelRayOrigin.z = c.z;
            const ray = new RAPIER.Ray(wheelRayOrigin, wheelRayDir);
            const hit = physics.world.castRay(
              ray,
              0.4,
              true,
              undefined,
              undefined,
              car.chassisCollider,
              car.chassisBody,
            );
            onTrack = !!hit && hit.collider.handle === track.collider.handle;
          }
          if (onTrack) {
            if (heavyBrake || cornering) {
              skidFx.emit(c, rotR, slipIntensity);
              if (slipIntensity > screechT) screechT = slipIntensity;
            }
          } else if (speed > 4 && (dustFrame + i) % 2 === 0) {
            skidFx.emitDust(c, Math.min(1, speed / 22));
          }
        }
      }
      sfx.setScreech(screechT);

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
        hud.updateRace({
          ...race.snapshot(),
          wrecked: false,
          offTrackSecondsLeft: 0,
          trackId: trackDef.id,
        });
        engineSound.update(frameDt, frame.rpm, frame.throttle, false, frame.speedKmh);
        return;
      }

      car.render(alpha);
      camera.update(car, frameDt);
      skidFx.update(frameDt);
      bonusFloaters.update(frameDt, camera.camera.position);
      race.checkpoints.animate(performance.now() / 1000);
      easterEggHouse?.update(performance.now() / 1000, camera.camera.position);
      if (rain || snow) {
        const cp = car.chassisView.object.position;
        rain?.update(frameDt, cp.x, cp.z);
        snow?.update(frameDt, cp.x, cp.z);
      }
      // Drive the speed-blur post pass. Ramps in past 120 km/h, full by 220.
      const speedT = settings.speedBlur
        ? Math.max(0, Math.min(1, (car.speedKmh - 120) / 100))
        : 0;
      engine.setSpeedFx(speedT);

      const carPos = car.chassisView.object.position;

      // Mini-map dot follows the chassis.
      miniMap.update(carPos.x, carPos.z);

      // Slide the shadow camera along with the car so its tight frustum
      // always covers the area the player can see. The sun keeps its
      // world-space direction; only the focus point moves.
      sun.target.position.set(carPos.x, 0, carPos.z);
      sun.position.set(carPos.x + SUN_OFFSET.x, SUN_OFFSET.y, carPos.z + SUN_OFFSET.z);

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
        trackId: trackDef.id,
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
