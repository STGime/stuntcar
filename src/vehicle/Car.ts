import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CarConfig } from './CarConfig';
import { Drivetrain } from './Drivetrain';
import { BodyView } from '../core/BodyView';
import type { Input } from '../core/Input';

const UP = new THREE.Vector3(0, 1, 0);
const AXLE = new THREE.Vector3(-1, 0, 0); // wheel spin axis (matches addWheel axleCs)
const FORWARD = new THREE.Vector3(0, 0, 1); // car-local forward (+z)

/** Move `current` toward `target` by at most `maxDelta`. */
function moveToward(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

/**
 * The player car: a Rapier `DynamicRayCastVehicleController` (raycast-car model)
 * — a dynamic chassis rigid body plus four suspension rays. The wheels are NOT
 * rigid bodies; their meshes are positioned each frame from the controller's
 * per-wheel state.
 *
 * M2 scope: accelerate / brake / reverse / steer with a simple direct-force
 * model. The real RPM-based drivetrain (manual + automatic) replaces the
 * driving block at M3.
 */
export class Car {
  readonly chassisView: BodyView;
  readonly drivetrain = new Drivetrain();
  speedKmh = 0;
  forwardVel = 0;
  /** True when at least one driven wheel is in ground contact this step. */
  drivenWheelsGrounded = true;
  /** True when all four wheels are out of ground contact. Used by the M7
   *  airtime detector to flag big jumps for highlight replays. */
  airborne = false;
  /** When true, the chassis tumbles freely — no engine/brake/steering input. */
  crashed = false;

  readonly chassisCollider: RAPIER.Collider;
  readonly chassisBody: RAPIER.RigidBody;

  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly wheelMeshes: THREE.Mesh[] = [];
  private readonly cockpitHidden: THREE.Object3D[] = [];
  private readonly cockpitOnly: THREE.Object3D[] = [];
  private readonly taillightMat: THREE.MeshStandardMaterial;
  private steeringWheelMesh: THREE.Object3D | null = null;

  private steer = 0; // current (smoothed) steering angle, radians

  // Track-provided spawn pose; defaults to CarConfig.spawn for early M-stages.
  private readonly spawnPos = new THREE.Vector3(
    CarConfig.spawn.x,
    CarConfig.spawn.y,
    CarConfig.spawn.z,
  );
  private readonly spawnQuat = new THREE.Quaternion();

  // scratch objects reused per frame
  private readonly tmpVec = new THREE.Vector3();
  private readonly steerQuat = new THREE.Quaternion();
  private readonly spinQuat = new THREE.Quaternion();

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    const c = CarConfig;

    // --- Chassis rigid body --------------------------------------------------
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(c.spawn.x, c.spawn.y, c.spawn.z)
      .setCanSleep(false) // a controlled vehicle must never sleep
      .setCcdEnabled(true) // avoid tunnelling through track at speed
      .setLinearDamping(c.linearDamping)
      .setAngularDamping(c.angularDamping);
    this.body = world.createRigidBody(bodyDesc);
    this.chassisBody = this.body;

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      c.chassisHalfExtents.x,
      c.chassisHalfExtents.y,
      c.chassisHalfExtents.z,
    )
      .setMass(c.mass)
      .setFriction(0.6);
    this.chassisCollider = world.createCollider(colliderDesc, this.body);

    // --- Chassis visuals -----------------------------------------------------
    // Low-poly car silhouette built from primitives: lower body slab + raised
    // cabin with sloped windshield + front hood + side skirts + spoiler +
    // head/tail lights. No glTF dependency.
    const group = new THREE.Group();
    const hx = c.chassisHalfExtents.x; // 0.9
    const hy = c.chassisHalfExtents.y; // 0.5
    const hz = c.chassisHalfExtents.z; // 2.0
    const bodyColor = 0xd8423a;
    const trim = 0x1a1f28;
    const glassColor = 0x131820;

    const paintMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      metalness: 0.35,
      roughness: 0.45,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: trim,
      metalness: 0.4,
      roughness: 0.55,
    });
    // Dark tinted glass for the exterior look. The windshield/rear window
    // are simply hidden when the cockpit camera is active (see
    // setCockpitView) so the player gets an unobstructed view ahead.
    const glassMat = new THREE.MeshStandardMaterial({
      color: glassColor,
      metalness: 0.6,
      roughness: 0.2,
    });

    // Main body slab (slightly narrower than the collider so the visual
    // sits inside the physics box). Lower half = darker trim, upper half
    // = paint colour.
    const lower = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2 - 0.05, hy, hz * 2 - 0.05),
      trimMat,
    );
    lower.position.set(0, -hy / 2, 0);
    lower.castShadow = true;
    group.add(lower);

    const upper = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2 - 0.1, hy * 0.95, hz * 2 - 0.5),
      paintMat,
    );
    upper.position.set(0, hy / 2, -0.05);
    upper.castShadow = true;
    group.add(upper);

    // Hood: a small painted bump at the very front. Kept compact so it
    // doesn't dominate the cockpit-camera view — the player needs to see
    // the track ahead.
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2 - 0.5, 0.18, hz * 0.32),
      paintMat,
    );
    hood.position.set(0, hy * 0.5 - 0.05, hz * 0.78);
    hood.castShadow = true;
    group.add(hood);

    // Cabin (windshield + roof). A sloped windshield is made by rotating the
    // front face — easiest is two pieces: angled windshield + flat roof.
    // The cabin sits directly on the upper body's top face (no gap):
    //   upper top = hy/2 + (hy*0.95)/2  ≈  0.4875 for hy=0.5
    //   cabin half-height = 0.225  →  cabin centre = upper top + 0.225
    const cabinHalfH = 0.225;
    const upperTopY = hy / 2 + (hy * 0.95) / 2;
    const cabinY = upperTopY + cabinHalfH;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2 - 0.35, cabinHalfH * 2, hz * 0.85),
      paintMat,
    );
    cabin.position.set(0, cabinY, -0.25);
    cabin.castShadow = true;
    group.add(cabin);

    // Windshield (dark glass), angled forward — anchored to the cabin so
    // there's no air gap between glass and body.
    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2 - 0.4, 0.6, 0.08),
      glassMat,
    );
    windshield.position.set(0, cabinY, hz * 0.2);
    windshield.rotation.x = -0.45; // tilt forward
    windshield.castShadow = true;
    group.add(windshield);
    this.cockpitHidden.push(windshield);

    // Rear window (lighter tilt back).
    const rearWindow = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2 - 0.4, 0.5, 0.06),
      glassMat,
    );
    rearWindow.position.set(0, cabinY, -hz * 0.65);
    rearWindow.rotation.x = 0.35;
    rearWindow.castShadow = true;
    group.add(rearWindow);
    this.cockpitHidden.push(rearWindow);

    // Rear spoiler — two thin posts and a wing.
    const spoilerMat = new THREE.MeshStandardMaterial({
      color: trim,
      metalness: 0.5,
      roughness: 0.4,
    });
    const spoilerLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.32, 0.1),
      spoilerMat,
    );
    spoilerLeft.position.set(-0.55, hy * 0.55 + 0.16, -hz + 0.15);
    spoilerLeft.castShadow = true;
    group.add(spoilerLeft);
    const spoilerRight = spoilerLeft.clone();
    spoilerRight.position.x = 0.55;
    group.add(spoilerRight);
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2 - 0.1, 0.06, 0.5),
      spoilerMat,
    );
    wing.position.set(0, hy * 0.55 + 0.3, -hz + 0.15);
    wing.castShadow = true;
    group.add(wing);

    // Head + tail lights (small emissive squares).
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff3c4,
      emissive: 0xfff3c4,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });
    const taillightMat = new THREE.MeshStandardMaterial({
      color: 0xff4f4f,
      emissive: 0xff4f4f,
      emissiveIntensity: 0.5,
      roughness: 0.4,
    });
    this.taillightMat = taillightMat;
    const headlightGeo = new THREE.BoxGeometry(0.45, 0.2, 0.1);
    const headlightL = new THREE.Mesh(headlightGeo, headlightMat);
    headlightL.position.set(-hx + 0.35, hy * 0.4, hz - 0.02);
    group.add(headlightL);
    const headlightR = headlightL.clone();
    headlightR.position.x = hx - 0.35;
    group.add(headlightR);

    const taillightGeo = new THREE.BoxGeometry(0.5, 0.18, 0.08);
    const taillightL = new THREE.Mesh(taillightGeo, taillightMat);
    taillightL.position.set(-hx + 0.35, hy * 0.4, -hz + 0.02);
    group.add(taillightL);
    const taillightR = taillightL.clone();
    taillightR.position.x = hx - 0.35;
    group.add(taillightR);

    // Steering wheel: visible only when the cockpit camera is active.
    // Outer ring is a torus oriented in the wheel's local XY plane; spin
    // axis is local +Z. A thin parent group adds the slight rake toward the
    // driver so steering rotation stays around the wheel's own axis.
    const wheelTilt = new THREE.Group();
    wheelTilt.position.set(0, hy + 0.05, hz * 0.05);
    wheelTilt.rotation.x = 0.6; // dashboard rake
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x1a1f28,
      roughness: 0.6,
      metalness: 0.25,
    });
    const wheel = new THREE.Group();
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.018, 8, 26),
      wheelMat,
    );
    wheel.add(rim);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.04, 12),
      wheelMat,
    );
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.018, 0.012),
        wheelMat,
      );
      const theta = (i / 3) * Math.PI * 2 - Math.PI / 2;
      spoke.position.set(Math.cos(theta) * 0.08, Math.sin(theta) * 0.08, 0);
      spoke.rotation.z = theta;
      wheel.add(spoke);
    }
    wheelTilt.add(wheel);
    group.add(wheelTilt);
    this.cockpitOnly.push(wheelTilt);
    this.steeringWheelMesh = wheel;

    // Hide cockpit-only props by default (chase is the default view).
    for (const m of this.cockpitOnly) m.visible = false;

    scene.add(group);
    this.chassisView = new BodyView(this.body, group);

    // --- Vehicle controller --------------------------------------------------
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1; // y is up
    // NOTE: Rapier 0.14's d.ts mis-names this setter as `setIndexForwardAxis`.
    this.controller.setIndexForwardAxis = 2; // z is forward

    const wheelGeo = new THREE.CylinderGeometry(
      c.wheelRadius,
      c.wheelRadius,
      c.wheelWidth,
      20,
    );
    wheelGeo.rotateZ(Math.PI / 2); // align cylinder axis with the x (axle) axis

    for (let i = 0; i < c.wheels.length; i++) {
      const w = c.wheels[i];
      this.controller.addWheel(
        { x: w.x, y: w.y, z: w.z },
        { x: 0, y: -1, z: 0 }, // suspension points down
        { x: AXLE.x, y: AXLE.y, z: AXLE.z },
        c.suspensionRestLength,
        c.wheelRadius,
      );
      this.controller.setWheelSuspensionStiffness(i, c.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, c.suspensionCompression);
      this.controller.setWheelSuspensionRelaxation(i, c.suspensionRelaxation);
      this.controller.setWheelMaxSuspensionTravel(i, c.maxSuspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, c.maxSuspensionForce);
      this.controller.setWheelFrictionSlip(i, c.frictionSlip);

      const wheelMesh = new THREE.Mesh(
        wheelGeo,
        new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.85 }),
      );
      wheelMesh.castShadow = true;
      wheelMesh.receiveShadow = true;
      scene.add(wheelMesh);
      this.wheelMeshes.push(wheelMesh);
    }
  }

  /** Toggle in-cabin visuals between chase and cockpit cameras. Windshield,
   *  rear glass and the driver helmet hide in cockpit; the steering wheel +
   *  hub appear only in cockpit. */
  setCockpitView(active: boolean): void {
    for (const m of this.cockpitHidden) m.visible = !active;
    for (const m of this.cockpitOnly) m.visible = active;
  }

  /** Per-wheel ground-contact info (world space), or `null` if airborne.
   *  Used by the skid/smoke FX system to place marks at the contact patch. */
  wheelContact(i: number): { x: number; y: number; z: number } | null {
    if (!this.controller.wheelIsInContact(i)) return null;
    const p = this.controller.wheelContactPoint(i);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  /** Number of wheels managed by the vehicle controller. */
  get wheelCount(): number {
    return CarConfig.wheels.length;
  }

  /** Toggle wrecked state. While true, `update()` applies zero driving force. */
  setCrashed(c: boolean): void {
    this.crashed = c;
    if (c) {
      this.drivetrain.engineForce = 0;
    }
  }

  /** Per fixed step: read input, apply driving forces, advance the controller. */
  update(dt: number, input: Input): void {
    const c = CarConfig;

    // While wrecked: no engine/brake/steering input, chassis tumbles freely.
    if (this.crashed) {
      for (let i = 0; i < c.wheels.length; i++) {
        this.controller.setWheelEngineForce(i, 0);
        this.controller.setWheelBrake(i, 0);
        this.controller.setWheelSteering(i, 0);
      }
      this.controller.updateVehicle(dt);
      this.steer = 0;
      const linvelW = this.body.linvel();
      this.speedKmh = Math.hypot(linvelW.x, linvelW.y, linvelW.z) * 3.6;
      return;
    }

    // --- Speed + forward direction ------------------------------------------
    const linvel = this.body.linvel();
    this.speedKmh = Math.hypot(linvel.x, linvel.y, linvel.z) * 3.6;

    const rot = this.body.rotation();
    this.tmpVec.copy(FORWARD).applyQuaternion(
      this.steerQuat.set(rot.x, rot.y, rot.z, rot.w),
    );
    this.forwardVel =
      linvel.x * this.tmpVec.x + linvel.y * this.tmpVec.y + linvel.z * this.tmpVec.z;

    // --- Steering (speed-sensitive) -----------------------------------------
    const steerInput =
      (input.isDown('ArrowLeft', 'KeyA') ? 1 : 0) -
      (input.isDown('ArrowRight', 'KeyD') ? 1 : 0);

    const speedT = Math.min(this.speedKmh / c.highSpeedKmh, 1);
    const steerLimit =
      c.steeringMax * (1 - speedT * (1 - c.steeringSpeedFalloff));
    const steerTarget = steerInput * steerLimit;
    this.steer = moveToward(this.steer, steerTarget, c.steeringRate * dt);

    this.controller.setWheelSteering(0, this.steer);
    this.controller.setWheelSteering(1, this.steer);

    // --- Throttle + brake ---------------------------------------------------
    // W/Up = accelerator, S/Down = brake (and reverse in automatic).
    const accel = input.isDown('ArrowUp', 'KeyW');
    const brakeHeld = input.isDown('ArrowDown', 'KeyS');

    // In automatic, the brake key doubles as "go backwards": when stopped
    // and braking we flip to Reverse, then the brake key feeds throttle.
    // The accelerator cancels back to first the same way.
    let throttle: number;
    let useBrake: boolean;
    if (this.drivetrain.mode === 'automatic') {
      const stopped = this.speedKmh < c.autoReverseThresholdKmh;
      if (brakeHeld && stopped && this.drivetrain.gear !== 0) {
        this.drivetrain.forceGear(0); // Reverse
      } else if (accel && stopped && this.drivetrain.gear === 0) {
        this.drivetrain.forceGear(1); // First
      }
      if (this.drivetrain.gear === 0) {
        throttle = brakeHeld ? 1 : 0;
        useBrake = accel; // tapping W while reversing acts as a brake
      } else {
        throttle = accel ? 1 : 0;
        useBrake = brakeHeld;
      }
    } else {
      // Manual: W throttles, S brakes; Q/E (wired in main) shifts gears.
      throttle = accel ? 1 : 0;
      useBrake = brakeHeld;
    }

    this.drivetrain.update(dt, {
      throttle,
      brake: useBrake,
      forwardVel: this.forwardVel,
    });

    // Split engine force across driven wheels.
    const drivenCount = c.wheels.reduce((n, w) => n + (w.driven ? 1 : 0), 0);
    const perWheelEngine =
      drivenCount > 0 ? this.drivetrain.engineForce / drivenCount : 0;
    const brakeForce = useBrake ? c.brakeForce : 0;

    let drivenGrounded = false;
    let anyContact = false;
    for (let i = 0; i < c.wheels.length; i++) {
      const driven = c.wheels[i].driven;
      this.controller.setWheelEngineForce(i, driven ? perWheelEngine : 0);
      this.controller.setWheelBrake(i, brakeForce);
      const inContact = this.controller.wheelIsInContact(i);
      if (inContact) anyContact = true;
      if (driven && inContact) drivenGrounded = true;
    }
    this.drivenWheelsGrounded = drivenGrounded;
    this.airborne = !anyContact;

    // Brake lights: pop the rear emissive when the brake key is held.
    this.taillightMat.emissiveIntensity = useBrake ? 2.6 : 0.5;

    // Advance the vehicle: updates the chassis velocity from suspension,
    // engine force and brakes. Must run BEFORE world.step().
    this.controller.updateVehicle(dt);
  }

  /** After world.step(): snapshot chassis transform for interpolation. */
  postStep(): void {
    this.chassisView.capture();
  }

  /** On render: interpolate the chassis, then place the wheels. */
  render(alpha: number): void {
    this.chassisView.apply(alpha);
    this.syncWheels();
    if (this.steeringWheelMesh) {
      // Real wheels turn ~270° each way; multiplier maps `steer`'s ±0.55 rad
      // range to about ±2.8 rad for a believable cockpit feel.
      this.steeringWheelMesh.rotation.z = this.steer * 5.0;
    }
  }

  /**
   * Snapshot the per-wheel visual state (rotation, steering, suspension
   * length). Used by `ReplayRecorder` to capture a frame.
   */
  wheelSnapshot(): WheelSnapshot[] {
    const out: WheelSnapshot[] = [];
    for (let i = 0; i < CarConfig.wheels.length; i++) {
      out.push({
        rotation: this.controller.wheelRotation(i) ?? 0,
        steering: this.controller.wheelSteering(i) ?? 0,
        suspensionLength:
          this.controller.wheelSuspensionLength(i) ?? CarConfig.suspensionRestLength,
      });
    }
    return out;
  }

  /**
   * During replay: drive the visual transforms directly from a recorded
   * frame instead of from physics + BodyView interpolation. Physics is paused
   * by the caller so the rigid body stays put.
   */
  renderReplay(frame: ReplayCarFrame): void {
    const obj = this.chassisView.object;
    obj.position.set(frame.chassisPos.x, frame.chassisPos.y, frame.chassisPos.z);
    obj.quaternion.set(
      frame.chassisQuat.x,
      frame.chassisQuat.y,
      frame.chassisQuat.z,
      frame.chassisQuat.w,
    );
    this.syncWheelsFromFrame(frame.wheels);
  }

  /**
   * Override the spawn pose. The car is placed:
   *   - `forwardOffset` metres along the ribbon's local forward axis (used
   *     to clear checkpoint sensors so the chassis isn't straddling a gate).
   *   - `lift` metres above (world Y) so it falls cleanly onto the ribbon.
   *   - oriented with only the YAW component of the marker — roll/pitch are
   *     dropped so the chassis lands flat on a level world axis, then the
   *     suspension naturally settles it onto whatever banked/pitched
   *     ribbon surface is beneath. Spawning pre-tilted on a banked ribbon
   *     lets a low corner punch into the trimesh and Rapier resolves that
   *     explosively — the car flips.
   */
  setSpawn(
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    lift = 1.6,
    forwardOffset = 0,
  ): void {
    this.spawnPos.copy(position);
    if (forwardOffset !== 0) {
      this.tmpVec.set(0, 0, 1).applyQuaternion(quaternion);
      this.spawnPos.addScaledVector(this.tmpVec, forwardOffset);
    }
    this.spawnPos.y += lift;

    // Extract yaw-only: project the marker's forward onto the horizontal
    // plane and build a y-axis rotation.
    this.tmpVec.set(0, 0, 1).applyQuaternion(quaternion);
    this.tmpVec.y = 0;
    if (this.tmpVec.lengthSq() < 1e-6) {
      this.spawnQuat.identity();
    } else {
      const yaw = Math.atan2(this.tmpVec.x, this.tmpVec.z);
      this.spawnQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    }
  }

  /** Teleport the car back to its spawn point, upright and stationary. */
  resetToSpawn(): void {
    this.body.setTranslation(
      { x: this.spawnPos.x, y: this.spawnPos.y, z: this.spawnPos.z },
      true,
    );
    this.body.setRotation(
      { x: this.spawnQuat.x, y: this.spawnQuat.y, z: this.spawnQuat.z, w: this.spawnQuat.w },
      true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.drivetrain.reset();
  }

  /** Position + orient each wheel mesh from the controller's per-wheel state. */
  private syncWheels(): void {
    const chassisObj = this.chassisView.object;
    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const conn = this.controller.wheelChassisConnectionPointCs(i);
      const dir = this.controller.wheelDirectionCs(i);
      if (!conn || !dir) continue;

      const suspLen =
        this.controller.wheelSuspensionLength(i) ?? CarConfig.suspensionRestLength;
      const steering = this.controller.wheelSteering(i) ?? 0;
      const spin = this.controller.wheelRotation(i) ?? 0;

      // wheel centre (chassis space) = connection + suspensionDir * length
      this.tmpVec.set(
        conn.x + dir.x * suspLen,
        conn.y + dir.y * suspLen,
        conn.z + dir.z * suspLen,
      );
      this.tmpVec.applyQuaternion(chassisObj.quaternion).add(chassisObj.position);

      const mesh = this.wheelMeshes[i];
      mesh.position.copy(this.tmpVec);

      // orientation = chassis * steering(up) * spin(axle)
      this.steerQuat.setFromAxisAngle(UP, steering);
      this.spinQuat.setFromAxisAngle(AXLE, spin);
      mesh.quaternion
        .copy(chassisObj.quaternion)
        .multiply(this.steerQuat)
        .multiply(this.spinQuat);
    }
  }

  /** Same as syncWheels but reads the per-wheel state from a recorded frame. */
  private syncWheelsFromFrame(wheels: WheelSnapshot[]): void {
    const chassisObj = this.chassisView.object;
    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const conn = this.controller.wheelChassisConnectionPointCs(i);
      const dir = this.controller.wheelDirectionCs(i);
      if (!conn || !dir) continue;
      const w = wheels[i];

      this.tmpVec.set(
        conn.x + dir.x * w.suspensionLength,
        conn.y + dir.y * w.suspensionLength,
        conn.z + dir.z * w.suspensionLength,
      );
      this.tmpVec.applyQuaternion(chassisObj.quaternion).add(chassisObj.position);

      const mesh = this.wheelMeshes[i];
      mesh.position.copy(this.tmpVec);

      this.steerQuat.setFromAxisAngle(UP, w.steering);
      this.spinQuat.setFromAxisAngle(AXLE, w.rotation);
      mesh.quaternion
        .copy(chassisObj.quaternion)
        .multiply(this.steerQuat)
        .multiply(this.spinQuat);
    }
  }
}

export interface WheelSnapshot {
  rotation: number;
  steering: number;
  suspensionLength: number;
}

export interface ReplayCarFrame {
  chassisPos: { x: number; y: number; z: number };
  chassisQuat: { x: number; y: number; z: number; w: number };
  wheels: WheelSnapshot[];
}
