import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Builds the ambient world: lighting + a flat ground plane.
 *
 * The track itself is laid out by `TrackBuilder` and added separately —
 * this module just owns lights and the ground beneath/around it.
 */
export function buildScene(scene: THREE.Scene, world: RAPIER.World): void {
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
  // Warm hemisphere: sky tone overhead, slightly green earth bounce.
  const hemi = new THREE.HemisphereLight(0xd7c9a8, 0x3a4a3f, 0.95);
  scene.add(hemi);

  // Warm directional sun (late-afternoon). Higher intensity to bring out
  // the chassis paint metalness and the centre stripe.
  const sun = new THREE.DirectionalLight(0xffe1b0, 2.7);
  sun.position.set(60, 75, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  const extent = 140;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 320;
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
}
