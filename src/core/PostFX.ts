import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Post-processing pipeline owned by Engine.
 *
 * Pass order:
 *   1. RenderPass renders the scene to a HalfFloat HDR render target.
 *   2. UnrealBloomPass extracts bright pixels (emissive headlights, brake
 *      lights, dashboard gauges, sun disc) and bleeds them softly.
 *   3. OutputPass reads the renderer's `toneMapping` + `outputColorSpace`
 *      settings (ACES filmic + sRGB) and writes to the canvas. Render
 *      tonemapping is left ON the renderer because OutputPass picks it up.
 *
 * `setCamera` swaps the RenderPass camera so the chase ↔ cockpit toggle
 * works without rebuilding the composer.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(w, h);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // strength, radius, threshold. Threshold 0.85 keeps the bloom restricted
    // to clearly-emissive pixels (brake lights mid-press, sun disc) so the
    // scene reads crisp instead of hazy. Strength dialled back so the glow
    // is a kiss rather than a flare.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      /* strength */ 0.25,
      /* radius */ 0.32,
      /* threshold */ 0.85,
    );
    this.composer.addPass(this.bloomPass);

    this.composer.addPass(new OutputPass());
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }
}
