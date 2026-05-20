/**
 * Keyboard input.
 *
 * - `isDown(...codes)` reports continuously-held keys (used by per-step driving).
 * - `onPress(code, cb)` fires once on key-down (used by edge actions like the
 *   camera toggle and reset).
 *
 * Key codes are `KeyboardEvent.code` values, e.g. "KeyW", "ArrowUp".
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressCallbacks = new Map<string, Array<() => void>>();
  /** Optional analog steering channel fed by the touch joystick. While
   *  non-null it OVERRIDES the keyboard A/D / ←→ digital steering input.
   *  Range: [-1, +1] where positive = left turn (matching the keyboard's
   *  `KeyA / ArrowLeft` sign convention). */
  private analogSteer: number | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.held.add(e.code);
      const cbs = this.pressCallbacks.get(e.code);
      if (cbs) for (const cb of cbs) cb();
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    // Release everything if the window loses focus, so keys don't "stick".
    window.addEventListener('blur', () => this.held.clear());
  }

  /** True if any of the given key codes is currently held. */
  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** Register a callback fired once each time `code` is pressed. */
  onPress(code: string, cb: () => void): void {
    const arr = this.pressCallbacks.get(code) ?? [];
    arr.push(cb);
    this.pressCallbacks.set(code, arr);
  }

  // ── Touch-controls bridge ─────────────────────────────────────────────
  /** Programmatically "press" a key code (used by touch UI buttons). Fires
   *  any `onPress` callbacks registered for the code, exactly as if a real
   *  keystroke had happened. */
  virtualPress(code: string): void {
    if (this.held.has(code)) return;
    this.held.add(code);
    const cbs = this.pressCallbacks.get(code);
    if (cbs) for (const cb of cbs) cb();
  }

  virtualRelease(code: string): void {
    this.held.delete(code);
  }

  /** Set or clear the analog steering value. `null` returns control to the
   *  keyboard's digital A/D / ←→ steering. */
  setAnalogSteer(v: number | null): void {
    this.analogSteer = v === null ? null : Math.max(-1, Math.min(1, v));
  }

  /** Combined steering input in [-1, +1] — analog if a touch joystick is
   *  active, otherwise the keyboard's digital left/right. */
  steerAxis(): number {
    if (this.analogSteer !== null) return this.analogSteer;
    return (
      (this.isDown('ArrowLeft', 'KeyA') ? 1 : 0) -
      (this.isDown('ArrowRight', 'KeyD') ? 1 : 0)
    );
  }
}
