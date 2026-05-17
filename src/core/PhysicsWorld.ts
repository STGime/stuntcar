import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Thin wrapper around the Rapier physics world.
 *
 * Rapier ships as WebAssembly and must be initialised asynchronously before
 * any physics object is created — hence the static async `create()`.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    const world = new RAPIER.World(gravity);
    return new PhysicsWorld(world);
  }

  /** Advance the simulation by one fixed step. */
  step(): void {
    this.world.step();
  }
}
