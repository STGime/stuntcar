import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Builds the ambient world: lighting + a flat ground plane.
 *
 * The track itself is laid out by `TrackBuilder` and added separately —
 * this module just owns lights and the ground beneath/around it.
 */
export function buildScene(scene: THREE.Scene, world: RAPIER.World): void {
  // --- Lighting --------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x2a2f25, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(45, 90, 25);
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
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0x3a4a3f, roughness: 1.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(400, 160, 0x55607a, 0x333a4a);
  const gridMat = grid.material as THREE.Material;
  gridMat.transparent = true;
  gridMat.opacity = 0.32;
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
