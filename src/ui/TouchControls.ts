import type { Input } from '../core/Input';

/**
 * On-screen controls for touch devices:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │                                             │
 *   │   steer (left half — free-floating          │
 *   │   joystick that drops where the player      │
 *   │   touches)                            GAS   │
 *   │                                       ───   │
 *   │                                       BRK   │
 *   │                                             │
 *   └─────────────────────────────────────────────┘
 *
 * The steering pad covers the LEFT half of the screen but is INVISIBLE
 * until the player puts a finger down — at which point it pops up where
 * the touch landed and follows the finger horizontally. Drag distance
 * (clamped to the pad radius) becomes the analog steer value [-1..+1].
 *
 * The right side has two big rounded touch zones, GAS on top and BRAKE
 * below. They drive `input.virtualPress('KeyW' / 'KeyS')` so the rest of
 * the game treats them exactly like the keyboard equivalents — including
 * the "hold brake at standstill → auto-engage reverse" auto-shift.
 *
 * Two small HUD buttons (CAM / RST) at the bottom of the right column
 * replace the keyboard `C` and `R` shortcuts.
 */

const PAD_RADIUS = 70;
const PAD_DEAD_ZONE = 10;
/** Fixed centre of the always-visible steering pad, from the bottom-left
 *  corner of the viewport. The touch zone is still the whole left half, but
 *  drags are measured from this point rather than the touch-down location. */
const PAD_CENTER_X = 110;
const PAD_CENTER_BOTTOM = 110;

export interface TouchControlsCallbacks {
  /** Toggle chase ↔ cockpit camera (mirrors keyboard `C`). */
  onToggleCamera: () => void;
  /** Reset to last checkpoint (mirrors keyboard `R`). */
  onReset: () => void;
}

export class TouchControls {
  private readonly steerZone: HTMLElement;
  private readonly steerKnob: HTMLElement;
  private readonly steerBase: HTMLElement;
  private steerTouchId: number | null = null;
  private steerOriginX = 0;

  /** Central map: pointerId → key code currently held by a pedal. A
   *  document-level pointerup / pointercancel handler releases through
   *  this map regardless of which element the up event actually fires on,
   *  which avoids the iOS Safari "missed pointerup → key stays held"
   *  failure mode. */
  private readonly pedalPointers = new Map<number, string>();
  private readonly pedalEls = new Map<string, HTMLElement>();

  constructor(
    container: HTMLElement,
    private readonly input: Input,
    cb: TouchControlsCallbacks,
  ) {
    injectStyles();

    // ── Left half — steering zone ─────────────────────────────────────
    this.steerZone = document.createElement('div');
    this.steerZone.id = 'touch-steer-zone';
    container.appendChild(this.steerZone);

    this.steerBase = document.createElement('div');
    this.steerBase.className = 'touch-steer-base';
    // Fixed position bottom-left, always visible so the player knows
    // where to put their thumb.
    this.steerBase.style.left = `${PAD_CENTER_X - PAD_RADIUS}px`;
    this.steerBase.style.bottom = `${PAD_CENTER_BOTTOM - PAD_RADIUS}px`;
    this.steerZone.appendChild(this.steerBase);

    this.steerKnob = document.createElement('div');
    this.steerKnob.className = 'touch-steer-knob';
    this.steerBase.appendChild(this.steerKnob);

    this.steerZone.addEventListener('pointerdown', this.onSteerDown, {
      passive: false,
    });
    this.steerZone.addEventListener('pointermove', this.onSteerMove, {
      passive: false,
    });
    this.steerZone.addEventListener('pointerup', this.onSteerUp, {
      passive: false,
    });
    this.steerZone.addEventListener('pointercancel', this.onSteerUp, {
      passive: false,
    });

    // ── Right column — pedals + HUD buttons ────────────────────────────
    const column = document.createElement('div');
    column.id = 'touch-right-column';
    container.appendChild(column);

    const buildPedal = (label: string, code: 'KeyW' | 'KeyS', cls: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = `touch-pedal ${cls}`;
      el.textContent = label;
      this.pedalEls.set(code, el);
      el.addEventListener(
        'pointerdown',
        (e) => {
          // One pedal can only be held by one pointer at a time. If the
          // code is already in the map under another id, ignore.
          for (const c of this.pedalPointers.values()) if (c === code) return;
          this.pedalPointers.set(e.pointerId, code);
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* Some browsers reject capture for non-primary pointers */
          }
          el.classList.add('active');
          input.virtualPress(code);
          e.preventDefault();
        },
        { passive: false },
      );
      return el;
    };

    // Multiple redundant release paths because some environments
    // (notably Chrome's desktop mobile-emulation mode + iOS Safari with
    // revoked pointer capture) deliver up events unreliably:
    //
    //   1. document `pointerup` / `pointercancel` — per-pointer release.
    //   2. window     `pointerup` / `pointercancel` — second chance if
    //                  the document handler somehow doesn't fire.
    //   3. document `mouseup`  — fallback for desktop mobile emulation
    //                  (synthesised pointer events can fail, but the real
    //                  mouseup always fires).
    //   4. document `touchend` / `touchcancel` — fallback for real touch.
    //   5. window `blur` — tab switch / OS interrupt safety net.
    //
    // Each handler is registered in CAPTURE phase too, so a third-party
    // `stopPropagation` upstream can't suppress us.
    const releaseByPointer = (e: PointerEvent): void => {
      const code = this.pedalPointers.get(e.pointerId);
      if (!code) return;
      this.pedalPointers.delete(e.pointerId);
      const el = this.pedalEls.get(code);
      if (el) el.classList.remove('active');
      input.virtualRelease(code);
    };
    const releaseAll = (): void => {
      if (this.pedalPointers.size === 0) return;
      for (const [, code] of this.pedalPointers) {
        const el = this.pedalEls.get(code);
        if (el) el.classList.remove('active');
        input.virtualRelease(code);
      }
      this.pedalPointers.clear();
    };
    const opts = { capture: true, passive: true } as const;
    document.addEventListener('pointerup', releaseByPointer, opts);
    document.addEventListener('pointercancel', releaseByPointer, opts);
    window.addEventListener('pointerup', releaseByPointer, opts);
    window.addEventListener('pointercancel', releaseByPointer, opts);
    document.addEventListener('mouseup', releaseAll, opts);
    document.addEventListener('touchend', releaseAll, opts);
    document.addEventListener('touchcancel', releaseAll, opts);
    window.addEventListener('blur', releaseAll);
    // Watchdog: if a pedal is still flagged held but the browser thinks
    // no pointer is hovering inside the pedal element, release it. Catches
    // the very rare case where every up-event path fails silently.
    setInterval(() => {
      for (const [pointerId, code] of [...this.pedalPointers]) {
        const el = this.pedalEls.get(code);
        if (!el) continue;
        // hasPointerCapture() returns false the instant capture is lost.
        if (!el.hasPointerCapture(pointerId)) {
          this.pedalPointers.delete(pointerId);
          el.classList.remove('active');
          input.virtualRelease(code);
        }
      }
    }, 250);

    const pedalRow = document.createElement('div');
    pedalRow.className = 'touch-pedal-row';
    pedalRow.appendChild(buildPedal('▲', 'KeyW', 'gas'));
    pedalRow.appendChild(buildPedal('▼', 'KeyS', 'brake'));
    column.appendChild(pedalRow);

    // Camera / reset chips
    const chipRow = document.createElement('div');
    chipRow.className = 'touch-chip-row';
    const camChip = document.createElement('button');
    camChip.className = 'touch-chip';
    camChip.textContent = 'CAM';
    camChip.addEventListener('click', cb.onToggleCamera);
    const rstChip = document.createElement('button');
    rstChip.className = 'touch-chip';
    rstChip.textContent = 'RST';
    rstChip.addEventListener('click', cb.onReset);
    chipRow.appendChild(camChip);
    chipRow.appendChild(rstChip);
    column.appendChild(chipRow);
  }

  private onSteerDown = (e: PointerEvent): void => {
    if (this.steerTouchId !== null) return;
    this.steerTouchId = e.pointerId;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // Origin is the fixed pad centre — drag distance is measured from
    // there regardless of where on the left half the player touched.
    const rect = this.steerBase.getBoundingClientRect();
    this.steerOriginX = rect.left + rect.width / 2;
    // Compute initial knob offset from the touch position so it doesn't
    // snap to centre as soon as the player touches off-centre.
    this.applySteerForX(e.clientX);
    e.preventDefault();
  };

  private applySteerForX(clientX: number): void {
    const dxRaw = clientX - this.steerOriginX;
    const dx = Math.max(-PAD_RADIUS, Math.min(PAD_RADIUS, dxRaw));
    const dead = PAD_DEAD_ZONE;
    let v = 0;
    if (Math.abs(dx) > dead) {
      const signed = dx > 0 ? dx - dead : dx + dead;
      v = signed / (PAD_RADIUS - dead);
    }
    // Drag-right (positive dx) → negative steer = turn right.
    this.input.setAnalogSteer(-v);
    this.steerKnob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
  }

  private onSteerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.steerTouchId) return;
    this.applySteerForX(e.clientX);
    e.preventDefault();
  };

  private onSteerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.steerTouchId) return;
    this.steerTouchId = null;
    // Snap knob back to centre but keep the pad visible.
    this.steerKnob.style.transform = 'translate(-50%, -50%)';
    this.input.setAnalogSteer(null);
    e.preventDefault();
  };
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
    #touch-steer-zone {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: 50vw;
      /* z-index below all HUD overlays (MENU button is z 12, mini-map is
         z 11) so a tap on a chrome element registers as a button press,
         not a phantom steering input. Still above the canvas, so empty
         space anywhere on the left half is steering territory. */
      z-index: 5;
      touch-action: none;
    }
    .touch-steer-base {
      position: fixed;
      width: ${PAD_RADIUS * 2}px;
      height: ${PAD_RADIUS * 2}px;
      border-radius: 50%;
      background: rgba(12, 16, 24, 0.45);
      border: 2px solid rgba(255, 209, 102, 0.55);
      box-shadow: 0 0 18px rgba(255, 209, 102, 0.25);
      pointer-events: none;
      z-index: 15;
    }
    .touch-steer-knob {
      position: absolute;
      left: 50%;
      top: 50%;
      width: ${PAD_RADIUS}px;
      height: ${PAD_RADIUS}px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: radial-gradient(circle at 50% 35%, #ffe7a0, #ffd166 60%, #c89a2e 100%);
      box-shadow: 0 0 12px rgba(255, 209, 102, 0.55);
      pointer-events: none;
    }

    #touch-right-column {
      position: fixed;
      right: 18px;
      bottom: 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 14;
      pointer-events: none;
    }
    .touch-pedal-row {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .touch-pedal {
      width: 140px;
      height: 110px;
      border-radius: 16px;
      background: rgba(12, 16, 24, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #e8edf6;
      font-size: 44px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
      transition: transform 0.04s, background 0.06s, border-color 0.06s;
    }
    .touch-pedal.gas {
      color: #4fff8a;
      border-color: rgba(79, 255, 138, 0.45);
    }
    .touch-pedal.brake {
      color: #ff8a4a;
      border-color: rgba(255, 138, 74, 0.45);
    }
    .touch-pedal.active {
      transform: scale(0.96);
      background: rgba(255, 255, 255, 0.10);
    }
    .touch-pedal.gas.active { box-shadow: 0 0 18px rgba(79, 255, 138, 0.5); }
    .touch-pedal.brake.active { box-shadow: 0 0 18px rgba(255, 138, 74, 0.5); }
    .touch-chip-row {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .touch-chip {
      pointer-events: auto;
      touch-action: manipulation;
      padding: 8px 14px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2px;
      color: #c7d0e0;
      background: rgba(12, 16, 24, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      cursor: pointer;
    }
    .touch-chip:active {
      background: rgba(255, 255, 255, 0.10);
      color: #ffd166;
    }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
