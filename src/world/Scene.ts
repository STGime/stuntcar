import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildMountains } from './Mountains';
import { buildCitySkyline } from './CitySkyline';
import { type WeatherPreset, WEATHER_PRESETS } from './Weather';
import type { TrackTheme } from '../track/TrackTypes';

/**
 * Direction vector from the sun's target to its position (i.e. where sunlight
 * comes from). Filled in by `buildScene` from the active weather preset so
 * `main.ts` can keep the shadow camera offset stable while panning its target.
 */
export const SUN_OFFSET = new THREE.Vector3(60, 75, 35);

export interface SceneRefs {
  /** Directional sun light — caller moves its target each frame to keep the
   *  shadow camera focused on the car. */
  sun: THREE.DirectionalLight;
}

/**
 * Builds the ambient world: lighting + a flat ground plane.
 *
 * The track itself is laid out by `TrackBuilder` and added separately —
 * this module just owns lights and the ground beneath/around it.
 *
 * `weather` selects a complete lighting + atmosphere preset; defaults to
 * `day` (current golden-hour look).
 */
export function buildScene(
  scene: THREE.Scene,
  world: RAPIER.World,
  weather: WeatherPreset = WEATHER_PRESETS.day,
  theme: TrackTheme = 'forest',
): SceneRefs {
  // Mirror the preset's sun offset into the exported scratch vector so
  // `main.ts` can use it without knowing which preset is active.
  SUN_OFFSET.copy(weather.sunOffset);
  // --- Sky dome (vertical gradient + sun disc) ------------------------------
  // Inverted-normals sphere with a shader that lerps a horizon tone into a
  // sky tone, plus a soft sun disc + halo in the same direction as the
  // directional sun light. Sun colour is > 1 so the bloom pass picks it up.
  const skyTop = new THREE.Color(weather.skyTop);
  const skyHorizon = new THREE.Color(weather.skyHorizon);
  const skyGeo = new THREE.SphereGeometry(450, 32, 16);
  const sunDir = SUN_OFFSET.clone().normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: skyTop },
      uHorizon: { value: skyHorizon },
      uSunDir: { value: sunDir },
      uSunColor: { value: weather.skySunColor.clone() }, // > 1 to drive bloom
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      varying vec3 vWorldPos;
      void main() {
        vec3 dir = normalize(vWorldPos);
        float h = clamp(dir.y * 0.6 + 0.5, 0.0, 1.0);
        vec3 base = mix(uHorizon, uTop, smoothstep(0.0, 0.85, h));

        // Sun: tight disc + wide soft halo.
        float ang = max(dot(dir, normalize(uSunDir)), 0.0);
        float disc = smoothstep(0.9985, 0.99965, ang);
        float halo = pow(ang, 32.0) * 0.45;
        vec3 col = base + uSunColor * (disc + halo);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // Distant horizon decoration — mountains in 'forest' themes, a city
  // silhouette in 'city' themes. Either way it's a single draw call.
  if (theme === 'city') {
    buildCitySkyline(scene);
  } else {
    buildMountains(scene);
  }

  // Atmosphere — fog tint matches the preset's horizon haze so the far
  // edge of the world blends in naturally.
  const fogCol = new THREE.Color(weather.fogColor);
  scene.background = fogCol;
  scene.fog = new THREE.Fog(fogCol, weather.fogNear, weather.fogFar);

  // --- Lighting --------------------------------------------------------------
  // Hemisphere split (sky-fill above + bounce below) tuned per preset.
  const hemi = new THREE.HemisphereLight(
    weather.hemiSky,
    weather.hemiGround,
    weather.hemiIntensity,
  );
  scene.add(hemi);

  // Directional sun (warm at day, low + orange at sunset, dim moonlight at
  // night). Shadow camera is tight so a 2048² shadow map gives ~7 cm/texel;
  // `main.ts` slides `sun.target` each frame so the high-res box rides
  // with the car instead of staying pinned at the origin.
  const sun = new THREE.DirectionalLight(weather.sunColor, weather.sunIntensity);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.2;
  const extent = 70;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  // --- Ground ----------------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshStandardMaterial({ color: 0x4a5e3f, roughness: 1.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(400, 80, 0x6b7956, 0x4a5e3f);
  const gridMat = grid.material as THREE.Material;
  gridMat.transparent = true;
  gridMat.opacity = 0.22;
  scene.add(grid);

  // Ground collider: thick fixed slab whose top surface sits at y = 0.
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(300, 0.5, 300).setFriction(1.0),
    groundBody,
  );

  return { sun };
}
