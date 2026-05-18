import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Vignette + speed-driven radial blur. Single fullscreen pass.
 *
 * - Vignette is a soft, fixed-strength radial darkening at the edges so the
 *   image reads with more weight without obscuring detail.
 * - Radial blur samples a few extra texels along the vector from screen
 *   centre outward. Its amount scales with `uSpeed` (0..1) — at low speed
 *   the pass is essentially a no-op; at high speed the edges of the screen
 *   smear outward, conveying motion.
 */
const SpeedFxShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSpeed: { value: 0 },
    uVignette: { value: 0.42 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - vec2(0.5);
      float dist = length(dir);
      // Radial blur: take 5 samples spread along the radial direction.
      float blurAmt = uSpeed * 0.06 * smoothstep(0.10, 0.55, dist);
      vec4 col = vec4(0.0);
      float w = 0.0;
      for (int i = 0; i < 5; i++) {
        float t = float(i) / 4.0; // 0..1
        vec2 sampleUv = vUv - dir * blurAmt * t;
        col += texture2D(tDiffuse, sampleUv);
        w += 1.0;
      }
      col /= w;
      // Vignette: smoothstep from radius 0.45 outward.
      float v = smoothstep(0.85, 0.40, dist);
      col.rgb *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = col;
    }
  `,
};

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
  private readonly speedPass: ShaderPass;

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

    this.speedPass = new ShaderPass(SpeedFxShader);
    this.composer.addPass(this.speedPass);

    this.composer.addPass(new OutputPass());
  }

  /** 0..1 — drives the radial blur amount. */
  setSpeedFx(t: number): void {
    this.speedPass.uniforms.uSpeed.value = Math.max(0, Math.min(1, t));
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
