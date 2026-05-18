import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Direction vector from the sun's target to its position (i.e. where sunlight
 * comes from). Kept module-scoped so `main.ts` can follow the car by moving
 * `sun.target` while preserving this offset for `sun.position`.
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
 */
export function buildScene(scene: THREE.Scene, world: RAPIER.World): SceneRefs {
  // --- Sky dome (vertical gradient) -----------------------------------------
  // Inverted-normals sphere with a shader that lerps a horizon tone into a
  // sky tone. Gives the scene a believable atmosphere without a skybox asset.
  const skyTop = new THREE.Color(0x6b88c4);
  const skyHorizon = new THREE.Color(0xe5cda3);
  const skyGeo = new THREE.SphereGeometry(450, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: skyTop },
      uHorizon: { value: skyHorizon },
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
      varying vec3 vWorldPos;
      void main() {
        float h = clamp(normalize(vWorldPos).y * 0.6 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(0.0, 0.85, h)), 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // --- Lighting --------------------------------------------------------------
  // Cinematic split: cool blue sky-fill from above plays against the warm
  // directional sun. Slight warm dirt bounce from below keeps shadowed
  // undersides from going muddy green. ACES tonemap in Engine.ts pulls
  // the highlights, so we run a bit hotter than a linear pipeline.
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6a5436, 0.85);
  scene.add(hemi);

  // Warm directional sun (late-afternoon). Higher intensity to bring out
  // the chassis paint metalness and the centre stripe.
  //
  // Shadow camera is tight (extent ≈ 70) so a 2048² shadow map gives ~7 cm
  // per texel — sharp under the car. `main.ts` translates `sun.target` to
  // follow the chassis each frame so the high-resolution box rides with the
  // car instead of staying pinned at the world origin.
  const sun = new THREE.DirectionalLight(0xffe1b0, 2.7);
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
