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
}
