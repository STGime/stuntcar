import * as THREE from 'three';
import { PostFX } from './PostFX';

/**
 * Owns the renderer, scene, active camera and the main loop.
 *
 * The loop runs physics on a FIXED timestep (decoupled from frame rate) using
 * an accumulator, and renders with an interpolation factor `alpha` so motion
 * stays smooth regardless of display refresh rate.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | null = null;
  private postFX: PostFX | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // ACES filmic tonemap pulls highlights and gives the scene a cinematic
    // contrast curve. Exposure nudged slightly above neutral so warm sunlit
    // surfaces still pop after the curve squeezes them.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Warmer late-afternoon sky. Fog matches so distant fade reads as haze
    // rather than a wall — the circuit's far side blends into the horizon.
    // Range tightened (120-480 vs 180-500) for more atmospheric depth.
    const skyColor = 0xc8b491;
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.Fog(skyColor, 120, 480);

    window.addEventListener('resize', () => this.handleResize());
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    if (this.postFX) this.postFX.setCamera(camera);
    this.handleResize();
  }

  /** Install an UnrealBloom-based post-FX pipeline. Call after `setCamera`. */
  enablePostFX(): void {
    if (this.postFX || !this.camera) return;
    this.postFX = new PostFX(this.renderer, this.scene, this.camera);
  }

  /** Drive the speed-blur amount (0..1). Safe no-op if PostFX is disabled. */
  setSpeedFx(t: number): void {
    this.postFX?.setSpeedFx(t);
  }

  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.postFX?.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Starts the loop.
   * @param fixedDt        fixed physics step in seconds (e.g. 1/60)
   * @param onFixedStep    called 0..N times per frame; advance physics here
   * @param onRender       called once per frame; sync visuals + camera here.
   *                       `alpha` in [0,1) is the interpolation factor between
   *                       the previous and current physics state.
   */
  start(
    fixedDt: number,
    onFixedStep: (dt: number) => void,
    onRender: (alpha: number, frameDt: number) => void,
  ): void {
    let last = performance.now();
    let accumulator = 0;
    const MAX_STEPS = 5; // guard against the "spiral of death" after a stall

    const loop = (now: number): void => {
      requestAnimationFrame(loop);

      let frameDt = (now - last) / 1000;
      last = now;
      if (frameDt > 0.25) frameDt = 0.25; // clamp huge gaps (tab was hidden)

      accumulator += frameDt;
      let steps = 0;
      while (accumulator >= fixedDt && steps < MAX_STEPS) {
        onFixedStep(fixedDt);
        accumulator -= fixedDt;
        steps++;
      }
      if (steps === MAX_STEPS) accumulator = 0;

      const alpha = accumulator / fixedDt;
      onRender(alpha, frameDt);

      if (this.postFX) {
        this.postFX.render();
      } else if (this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };

    requestAnimationFrame(loop);
  }
}
