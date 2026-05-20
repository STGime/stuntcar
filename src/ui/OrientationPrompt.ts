/**
 * Full-screen overlay that nags the player to rotate to landscape on touch
 * devices. Visible only while `window.matchMedia('(orientation: portrait)')`
 * matches AND the device looks like a touchscreen. The 3D scene keeps
 * rendering behind so the engine doesn't pause; the overlay just blocks
 * pointer events so the player can't accidentally drive.
 */
export class OrientationPrompt {
  private readonly root: HTMLElement;
  private readonly query: MediaQueryList;

  constructor(container: HTMLElement) {
    injectStyles();
    this.root = document.createElement('div');
    this.root.id = 'orient-prompt';
    this.root.innerHTML = `
      <div class="orient-card">
        <svg class="orient-icon" viewBox="0 0 64 64" width="96" height="96"
             xmlns="http://www.w3.org/2000/svg">
          <rect x="14" y="6" width="36" height="52" rx="6" ry="6"
                fill="none" stroke="#ffd166" stroke-width="3"/>
          <circle cx="32" cy="52" r="2.4" fill="#ffd166"/>
          <path d="M 8 32 q 8 -14 24 -14 q 16 0 24 14"
                fill="none" stroke="#4fd1c5" stroke-width="2.5"
                stroke-linecap="round" stroke-dasharray="4 4"/>
          <path d="M 50 26 l 8 6 l -10 4 z" fill="#4fd1c5"/>
        </svg>
        <div class="orient-title">ROTATE YOUR DEVICE</div>
        <div class="orient-sub">STUNTLINE plays in landscape</div>
      </div>
    `;
    container.appendChild(this.root);

    this.query = window.matchMedia('(orientation: portrait)');
    this.update();
    this.query.addEventListener('change', this.update);
  }

  private update = (): void => {
    this.root.style.display = this.query.matches ? '' : 'none';
  };
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
    #orient-prompt {
      position: fixed;
      inset: 0;
      background: rgba(8, 11, 18, 0.96);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 300;
      pointer-events: auto;
      user-select: none;
      color: #e8edf6;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }
    .orient-card {
      text-align: center;
      padding: 36px 44px;
    }
    .orient-icon {
      display: inline-block;
      margin-bottom: 18px;
      animation: orient-spin 2.6s ease-in-out infinite;
      transform-origin: center;
    }
    @keyframes orient-spin {
      0%, 100% { transform: rotate(0deg); }
      45%, 55% { transform: rotate(-90deg); }
    }
    .orient-title {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 5px;
      color: #ffd166;
      margin-bottom: 8px;
    }
    .orient-sub {
      font-size: 11px;
      letter-spacing: 2px;
      color: #8892a8;
    }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

export function isTouchDevice(): boolean {
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 0)
  );
}
