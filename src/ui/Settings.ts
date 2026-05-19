/**
 * Persistent user settings + a small modal UI to edit them.
 *
 * Stored as a single JSON blob in localStorage. The modal can be opened
 * from the Main Menu; clicking outside the card or pressing the Close
 * button dismisses it. The setting consumers (CameraRig, Sfx, MiniMap,
 * CameraConfig FOV) read the current value at startup; in-race live edits
 * are not supported in v1 — change a setting, then click a track to apply.
 */

export interface Settings {
  /** Camera vertical FOV, degrees. */
  fov: number;
  /** Tilt the chase camera into corners. */
  cameraRoll: boolean;
  /** Crash / landing screen shake. */
  cameraShake: boolean;
  /** Master audio mute (engine + SFX). */
  audioMuted: boolean;
  /** Show the mini-map overlay. */
  miniMap: boolean;
  /** Show the speed-driven radial-blur post pass. */
  speedBlur: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fov: 62,
  cameraRoll: true,
  cameraShake: true,
  audioMuted: false,
  miniMap: true,
  speedBlur: true,
};

const STORAGE_KEY = 'stuntline:settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/** Mount the modal under `container`. Resolves when the modal is closed. */
export function openSettingsModal(container: HTMLElement): Promise<void> {
  injectStyles();
  return new Promise((resolve) => {
    const settings = loadSettings();

    const root = document.createElement('div');
    root.id = 'settings-modal';
    container.appendChild(root);

    const close = (): void => {
      root.remove();
      resolve();
    };

    const card = document.createElement('div');
    card.className = 'settings-card';
    card.onclick = (e) => e.stopPropagation();
    root.appendChild(card);
    root.onclick = close;

    card.innerHTML = `
      <div class="settings-title">SETTINGS</div>
      <div class="settings-row">
        <label>FOV
          <span class="settings-value" data-bind="fov">${settings.fov}</span>°
        </label>
        <input type="range" min="45" max="90" step="1" data-key="fov" value="${settings.fov}" />
      </div>
      ${toggleRow('Camera roll into corners', 'cameraRoll', settings.cameraRoll)}
      ${toggleRow('Camera shake on impact', 'cameraShake', settings.cameraShake)}
      ${toggleRow('Speed-driven motion blur', 'speedBlur', settings.speedBlur)}
      ${toggleRow('Mini-map', 'miniMap', settings.miniMap)}
      ${toggleRow('Mute audio', 'audioMuted', settings.audioMuted)}
      <div class="settings-btn-row">
        <button class="settings-btn primary" data-action="close">Close</button>
        <button class="settings-btn" data-action="reset">Reset to defaults</button>
      </div>
      <div class="settings-hint">Changes apply on the next race.</div>
    `;

    const apply = (next: Settings): void => {
      saveSettings(next);
    };

    card.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.key as keyof Settings;
        if (key === 'fov') {
          settings.fov = Number(input.value);
          const out = card.querySelector('[data-bind="fov"]');
          if (out) out.textContent = String(settings.fov);
          apply(settings);
        }
      });
    });

    card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.key as keyof Settings;
        if (
          key === 'cameraRoll' ||
          key === 'cameraShake' ||
          key === 'speedBlur' ||
          key === 'miniMap' ||
          key === 'audioMuted'
        ) {
          (settings[key] as boolean) = input.checked;
          apply(settings);
        }
      });
    });

    card.querySelector<HTMLButtonElement>('[data-action="close"]')?.addEventListener('click', close);
    card.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener('click', () => {
      Object.assign(settings, DEFAULT_SETTINGS);
      saveSettings(settings);
      close();
      // Re-open so the new values render — the simplest way to refresh inputs.
      void openSettingsModal(container);
    });
  });
}

function toggleRow(label: string, key: keyof Settings, value: boolean): string {
  return `
    <label class="settings-toggle-row">
      <span>${label}</span>
      <input type="checkbox" data-key="${key}" ${value ? 'checked' : ''} />
    </label>
  `;
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
    #settings-modal {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(8, 11, 18, 0.6);
      backdrop-filter: blur(3px);
      z-index: 200;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      color: #e8edf6;
    }
    .settings-card {
      background: rgba(12, 16, 24, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      padding: 28px 36px;
      min-width: 360px;
      max-width: 440px;
    }
    .settings-title {
      font-size: 14px;
      letter-spacing: 4px;
      color: #ffd166;
      text-align: center;
      margin-bottom: 18px;
      font-weight: 800;
    }
    .settings-row { margin: 14px 0; }
    .settings-row label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      letter-spacing: 1.5px;
      color: #c7d0e0;
      margin-bottom: 6px;
    }
    .settings-row input[type="range"] {
      width: 100%;
      accent-color: #ffd166;
    }
    .settings-value { color: #ffd166; font-weight: 700; }
    .settings-toggle-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 12px 0;
      font-size: 12px;
      letter-spacing: 1.5px;
      color: #c7d0e0;
    }
    .settings-toggle-row input { accent-color: #ffd166; transform: scale(1.25); }
    .settings-btn-row {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin: 22px 0 8px;
    }
    .settings-btn {
      padding: 10px 20px;
      font-family: inherit;
      font-size: 11px;
      letter-spacing: 2px;
      font-weight: 700;
      color: #8892a8;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      cursor: pointer;
    }
    .settings-btn:hover { color: #ffd166; border-color: #ffd166; }
    .settings-btn.primary {
      background: #ffd166;
      color: #1a2030;
      border-color: #ffd166;
    }
    .settings-btn.primary:hover { background: #ffdf8f; }
    .settings-hint {
      font-size: 10px;
      letter-spacing: 1.5px;
      color: #6b7689;
      text-align: center;
    }
  `;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}
