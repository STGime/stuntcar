import { TRACKS } from '../track/tracks';
import { previewCenterline } from '../track/previewCenterline';
import type { TrackDef } from '../track/TrackTypes';
import { loadLeaderboard } from '../race/Leaderboard';
import {
  WEATHER_PRESETS,
  loadWeatherChoice,
  saveWeatherChoice,
  type WeatherChoice,
} from '../world/Weather';
import { openSettingsModal } from './Settings';
import {
  VEHICLES,
  loadVehicleId,
  saveVehicleId,
  type VehicleId,
} from '../vehicle/VehicleConfigs';

const TRANSMISSION_STORAGE_KEY = 'stuntline:transmission';

export type Transmission = 'automatic' | 'manual';

/** Read the player's stored transmission preference (default automatic). */
export function loadTransmission(): Transmission {
  try {
    const v = localStorage.getItem(TRANSMISSION_STORAGE_KEY);
    return v === 'manual' ? 'manual' : 'automatic';
  } catch {
    return 'automatic';
  }
}

function saveTransmission(t: Transmission): void {
  try {
    localStorage.setItem(TRANSMISSION_STORAGE_KEY, t);
  } catch {
    /* ignore */
  }
}

function loadBestTimeSec(trackId: string): number | null {
  try {
    const raw = localStorage.getItem(`stuntline:bestTime:${trackId}`);
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function fmt(seconds: number | null): string {
  if (seconds === null) return '— —';
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Pre-game UI screen: Main menu or Track Select, decided from the URL. */
export class Menus {
  private readonly root: HTMLElement;

  constructor(container: HTMLElement, screen: 'menu' | 'tracks') {
    this.root = document.createElement('div');
    this.root.id = 'menu-screen';
    container.appendChild(this.root);
    injectStyles();
    if (screen === 'menu') this.renderMenu();
    else this.renderTrackSelect();
  }

  private renderMenu(): void {
    this.root.innerHTML = `
      <div class="menu-card">
        <div class="menu-eyebrow">PROTOTYPE</div>
        <div class="menu-title">STUNTLINE</div>
        <div class="menu-subtitle">stunt circuit racing in your browser</div>
        <div class="menu-btn-row">
          <button class="menu-btn primary" data-action="start">Start</button>
          <button class="menu-btn secondary" data-action="settings">Settings</button>
        </div>
        <div class="menu-hint">arrows / W A S D drive · C camera · M mute</div>
      </div>
    `;
    this.root
      .querySelector<HTMLButtonElement>('[data-action="start"]')
      ?.addEventListener('click', () => navigate('?screen=tracks'));
    this.root
      .querySelector<HTMLButtonElement>('[data-action="settings"]')
      ?.addEventListener('click', () => {
        void openSettingsModal(document.body);
      });
  }

  private renderTrackSelect(): void {
    const trans = loadTransmission();
    const weather = loadWeatherChoice();
    const vehicle = loadVehicleId();
    const cards = TRACKS.map((track, idx) => {
      const best = loadBestTimeSec(track.id);
      const top = loadLeaderboard(track.id).slice(0, 3);
      const topRows = top.length === 0
        ? '<div class="track-card-board-empty">no scores yet</div>'
        : top
            .map(
              (e, i) =>
                `<div class="track-card-board-row">` +
                `<span class="tcb-rank">${i + 1}</span>` +
                `<span class="tcb-name">${escapeHtml(e.name)}</span>` +
                `<span class="tcb-time">${fmt(e.timeSec)}</span>` +
                `</div>`,
            )
            .join('');
      const previewSvg = renderTrackPreview(track);
      return `
        <button class="track-card" data-track="${idx + 1}" data-difficulty="${track.difficulty}">
          <div class="track-card-num">${idx + 1}</div>
          <div class="track-card-name">${track.name}</div>
          <div class="track-card-preview">${previewSvg}</div>
          <div class="track-card-meta">
            <span class="track-card-diff diff-${track.difficulty}">${track.difficulty}</span>
            <span class="track-card-best">${best === null ? 'no time yet' : `best ${fmt(best)}s`}</span>
          </div>
          <div class="track-card-board">
            <div class="track-card-board-title">TOP TIMES</div>
            ${topRows}
          </div>
        </button>
      `;
    }).join('');

    this.root.innerHTML = `
      <div class="menu-card wide">
        <div class="menu-eyebrow">SELECT TRACK</div>
        <div class="track-cards">${cards}</div>
        <div class="trans-row">
          <span class="trans-label">VEHICLE</span>
          <div class="trans-toggle" role="radiogroup">
            ${Object.values(VEHICLES)
              .map(
                (v) =>
                  `<button class="trans-opt ${vehicle === v.id ? 'active' : ''}" data-vehicle="${v.id}">${v.label}</button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="trans-row trans-row-transmission" ${vehicle === 'ev' ? 'style="opacity:0.45;pointer-events:none"' : ''}>
          <span class="trans-label">TRANSMISSION</span>
          <div class="trans-toggle" role="radiogroup">
            <button class="trans-opt ${trans === 'automatic' ? 'active' : ''}" data-trans="automatic">Automatic</button>
            <button class="trans-opt ${trans === 'manual' ? 'active' : ''}" data-trans="manual">Manual</button>
          </div>
        </div>
        <div class="trans-row">
          <span class="trans-label">WEATHER</span>
          <div class="trans-toggle" role="radiogroup">
            ${(Object.values(WEATHER_PRESETS))
              .map(
                (w) =>
                  `<button class="trans-opt ${weather === w.id ? 'active' : ''}" data-weather="${w.id}">${w.label}</button>`,
              )
              .join('')}
            <button class="trans-opt ${weather === 'random' ? 'active' : ''}" data-weather="random">Random</button>
          </div>
        </div>
        <button class="menu-btn secondary" data-action="back">Back</button>
      </div>
    `;

    let selectedTrans: Transmission = trans;
    const transButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-trans]');
    transButtons.forEach((btn) =>
      btn.addEventListener('click', () => {
        selectedTrans = (btn.dataset.trans as Transmission) ?? 'automatic';
        transButtons.forEach((b) => b.classList.toggle('active', b === btn));
        saveTransmission(selectedTrans);
      }),
    );

    let selectedWeather: WeatherChoice = weather;
    const wxButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-weather]');
    wxButtons.forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.weather as WeatherChoice | undefined;
        if (id && (id === 'random' || id in WEATHER_PRESETS)) {
          selectedWeather = id;
          wxButtons.forEach((b) => b.classList.toggle('active', b === btn));
          saveWeatherChoice(selectedWeather);
        }
      }),
    );

    let selectedVehicle: VehicleId = vehicle;
    const vehicleButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-vehicle]');
    const transRow = this.root.querySelector<HTMLElement>('.trans-row-transmission');
    vehicleButtons.forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.vehicle as VehicleId | undefined;
        if (id && id in VEHICLES) {
          selectedVehicle = id;
          vehicleButtons.forEach((b) => b.classList.toggle('active', b === btn));
          saveVehicleId(selectedVehicle);
          // EV is always automatic — dim the transmission row.
          if (transRow) {
            const off = selectedVehicle === 'ev';
            transRow.style.opacity = off ? '0.45' : '';
            transRow.style.pointerEvents = off ? 'none' : '';
          }
        }
      }),
    );

    this.root.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((card) => {
      card.addEventListener('click', () => {
        saveTransmission(selectedTrans);
        saveWeatherChoice(selectedWeather);
        saveVehicleId(selectedVehicle);
        navigate(
          `?track=${card.dataset.track}&trans=${selectedTrans}&weather=${selectedWeather}&vehicle=${selectedVehicle}`,
        );
      });
    });
    this.root
      .querySelector<HTMLButtonElement>('[data-action="back"]')
      ?.addEventListener('click', () => navigate(''));
  }

  destroy(): void {
    this.root.remove();
  }
}

function navigate(query: string): void {
  const url = new URL(location.href);
  url.search = query;
  location.assign(url.toString());
}

function renderTrackPreview(track: TrackDef): string {
  const pts = previewCenterline(track);
  if (pts.length < 2) return '';
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const size = 130;
  const margin = 10;
  const w = maxX - minX || 1;
  const h = maxZ - minZ || 1;
  const inner = size - margin * 2;
  const scale = Math.min(inner / w, inner / h);
  const mapW = w * scale;
  const mapH = h * scale;
  const offX = (size - mapW) / 2 - minX * scale;
  const offZ = (size - mapH) / 2 - minZ * scale;
  const d = pts
    .map((p, i) => {
      const x = (p.x * scale + offX).toFixed(1);
      const y = (p.z * scale + offZ).toFixed(1);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
  const spawnX = (pts[0].x * scale + offX).toFixed(1);
  const spawnY = (pts[0].z * scale + offZ).toFixed(1);
  return `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="tp-svg">
      <path d="${d}" class="tp-shadow" />
      <path d="${d}" class="tp-line" />
      <circle cx="${spawnX}" cy="${spawnY}" r="3" class="tp-spawn" />
    </svg>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
    #menu-screen {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: safe center;
      justify-content: center;
      padding: 24px 16px;
      box-sizing: border-box;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
      overscroll-behavior: contain;
      background: linear-gradient(135deg, #1a2030 0%, #232b3f 100%);
      color: #e8edf6;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      z-index: 100;
      user-select: none;
    }
    .menu-card {
      background: rgba(12, 16, 24, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 40px 48px;
      min-width: 320px;
      text-align: center;
    }
    .menu-card.wide { min-width: 540px; }
    .menu-eyebrow {
      font-size: 11px;
      letter-spacing: 4px;
      color: #6b7689;
      margin-bottom: 12px;
    }
    .menu-title {
      font-size: 48px;
      font-weight: 900;
      letter-spacing: 8px;
      color: #ffd166;
      text-shadow: 0 0 24px rgba(255, 209, 102, 0.35);
      margin-bottom: 8px;
    }
    .menu-subtitle {
      font-size: 13px;
      color: #8892a8;
      letter-spacing: 1.5px;
      margin-bottom: 32px;
    }
    .menu-btn {
      display: inline-block;
      padding: 14px 36px;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 3px;
      color: #1a2030;
      background: #ffd166;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-family: inherit;
      transition: transform 0.08s, box-shadow 0.08s;
    }
    .menu-btn.secondary {
      background: transparent;
      color: #8892a8;
      border: 1px solid rgba(255, 255, 255, 0.12);
      margin-top: 20px;
    }
    .menu-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    .menu-btn:active { transform: translateY(0); }
    .menu-btn-row {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .menu-btn-row .menu-btn.secondary { margin-top: 0; }
    .menu-hint {
      font-size: 11px;
      letter-spacing: 1.5px;
      color: #6b7689;
      margin-top: 24px;
    }

    .track-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin: 0 0 24px;
    }
    .track-card {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 16px;
      text-align: left;
      cursor: pointer;
      font-family: inherit;
      color: #e8edf6;
      transition: transform 0.08s, border-color 0.08s, background 0.08s;
    }
    .track-card:hover {
      transform: translateY(-2px);
      border-color: #ffd166;
      background: rgba(255, 209, 102, 0.06);
    }
    .track-card-num {
      font-size: 11px;
      color: #6b7689;
      letter-spacing: 2px;
      margin-bottom: 4px;
    }
    .track-card-name {
      font-size: 16px;
      font-weight: 700;
      color: #ffd166;
      margin-bottom: 12px;
    }
    .track-card-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      letter-spacing: 1px;
    }
    .track-card-diff {
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .diff-easy { background: rgba(79, 255, 138, 0.18); color: #4fff8a; }
    .diff-medium { background: rgba(255, 209, 102, 0.18); color: #ffd166; }
    .diff-hard { background: rgba(255, 79, 79, 0.18); color: #ff4f4f; }
    .track-card-best { color: #8892a8; }

    .track-card-board {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px dashed rgba(255, 255, 255, 0.08);
    }
    .track-card-board-title {
      font-size: 9px;
      letter-spacing: 2px;
      color: #6b7689;
      margin-bottom: 6px;
    }
    .track-card-board-row {
      display: grid;
      grid-template-columns: 14px 36px 1fr;
      gap: 6px;
      font-size: 11px;
      letter-spacing: 1px;
      color: #c7d0e0;
      padding: 1px 0;
    }
    .tcb-rank { color: #6b7689; }
    .tcb-name { font-weight: 800; letter-spacing: 2px; color: #ffd166; }
    .tcb-time { text-align: right; color: #c7d0e0; }
    .track-card-board-empty {
      font-size: 10px;
      letter-spacing: 1.5px;
      color: #6b7689;
      font-style: italic;
    }

    .track-card-preview {
      display: flex;
      justify-content: center;
      margin: 6px 0 10px;
    }
    .tp-svg {
      background: rgba(0, 0, 0, 0.25);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .tp-shadow {
      fill: none;
      stroke: rgba(0, 0, 0, 0.6);
      stroke-width: 5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .tp-line {
      fill: none;
      stroke: #ffd166;
      stroke-width: 2.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .track-card:hover .tp-line { stroke: #4fff8a; }
    .tp-spawn {
      fill: #4fff8a;
      stroke: rgba(0,0,0,0.6);
      stroke-width: 1;
    }

    .trans-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-bottom: 8px;
    }
    .trans-label { font-size: 11px; letter-spacing: 2px; color: #8892a8; }
    .trans-toggle {
      display: inline-flex;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      overflow: hidden;
    }
    .trans-opt {
      padding: 8px 16px;
      font-size: 12px;
      letter-spacing: 2px;
      background: transparent;
      color: #8892a8;
      border: none;
      cursor: pointer;
      font-family: inherit;
    }
    .trans-opt.active {
      background: #ffd166;
      color: #1a2030;
      font-weight: 700;
    }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
