import { CarConfig } from '../vehicle/CarConfig';
import {
  loadLeaderboard,
  projectedRank,
  submitScore,
  NAME_LEN,
  type LeaderboardEntry,
} from '../race/Leaderboard';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Range of needle travel for both gauges, in degrees, with 0° pointing
 * straight down. The needle rotates from -ARC/2 (left limit) to +ARC/2.
 */
const GAUGE_ARC_DEG = 240;

interface GaugeOpts {
  label: string;
  /** Tick values to draw (numbers). The first/last become the angular limits. */
  ticks: number[];
  /** Optional value where the redline band starts (drawn on the arc). */
  redlineAt?: number;
  /** How a tick value is rendered (default: integer string). */
  formatTick?: (v: number) => string;
}

interface Gauge {
  needle: SVGElement;
  digital: SVGTextElement;
  min: number;
  max: number;
  cx: number;
  cy: number;
}

interface HudState {
  rpm: number;
  speedKmh: number;
  gear: string;
  mode: 'A' | 'M';
  onLimiter: boolean;
}

export interface HudRaceState {
  state: 'countdown' | 'racing' | 'timeup' | 'finished';
  remainingSec: number;
  elapsedSec: number;
  passed: number;
  total: number;
  currentLap: number;
  totalLaps: number;
  bestTimeSec: number | null;
  finishTimeSec: number | null;
  newBest: boolean;
  wrecked: boolean;
  countdownPhase: 3 | 2 | 1 | 'GO' | null;
  /** Off-track countdown: integer seconds left, or 0 when on-track. */
  offTrackSecondsLeft: number;
  /** Track id — used to look up the leaderboard on the result screen. */
  trackId: string;
}

export interface HudCallbacks {
  onRetry: () => void;
  onTrackSelect: () => void;
  onMenu: () => void;
}

/**
 * SVG dashboard: analogue tach + speedo, with a digital readout in the middle
 * of each gauge, plus a gear letter and transmission-mode badge.
 *
 * Mounts itself into the provided container. Call `update()` each rendered
 * frame with the latest drivetrain state.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly tach: Gauge;
  private readonly speedo: Gauge;
  private readonly gearEl: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly limiterEl: HTMLElement;

  // Race HUD (top-center).
  private readonly raceBar: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly lapEl: HTMLElement;
  private readonly cpEl: HTMLElement;
  private readonly wreckEl: HTMLElement;
  private readonly replayEl: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly offTrackEl: HTMLElement;
  private readonly lapBannerEl: HTMLElement;
  private readonly quitBtn: HTMLButtonElement;
  private readonly resultBtnRetry: HTMLButtonElement;
  private readonly resultBtnTracks: HTMLButtonElement;
  private readonly resultBtnMenu: HTMLButtonElement;

  // Result modal (centered when shown).
  private readonly modal: HTMLElement;
  private readonly modalTitle: HTMLElement;
  private readonly modalTime: HTMLElement;
  private readonly modalSub: HTMLElement;
  private readonly modalNameRow: HTMLElement;
  private readonly modalNameInput: HTMLInputElement;
  private readonly modalNameSubmit: HTMLButtonElement;
  private readonly modalBoard: HTMLElement;

  // Result-screen leaderboard / name-entry local state.
  private resultShown = false;
  private nameEntryActive = false;
  private nameSubmitted = false;
  private newEntryIndex: number | null = null;
  private currentTrackId: string | null = null;
  private pendingFinishTimeSec: number | null = null;
  private pendingRank: number | null = null;
  private lastBannerLap = 1;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    container.appendChild(this.root);
    injectStyles();

    // --- Top-center race bar (timer + checkpoint counter) ----------------
    this.raceBar = document.createElement('div');
    this.raceBar.id = 'race-bar';
    container.appendChild(this.raceBar);

    this.timerEl = document.createElement('div');
    this.timerEl.className = 'race-timer';
    this.timerEl.textContent = '00.0';
    this.raceBar.appendChild(this.timerEl);

    this.lapEl = document.createElement('div');
    this.lapEl.className = 'race-lap';
    this.lapEl.textContent = 'LAP 1/3';
    this.raceBar.appendChild(this.lapEl);

    this.cpEl = document.createElement('div');
    this.cpEl.className = 'race-cp';
    this.cpEl.textContent = 'CP 0/0';
    this.raceBar.appendChild(this.cpEl);

    this.wreckEl = document.createElement('div');
    this.wreckEl.className = 'race-wreck';
    this.wreckEl.textContent = 'WRECKED';
    this.wreckEl.style.display = 'none';
    this.raceBar.appendChild(this.wreckEl);

    this.replayEl = document.createElement('div');
    this.replayEl.id = 'replay-overlay';
    this.replayEl.style.display = 'none';
    this.replayEl.innerHTML =
      '<div class="replay-label">REPLAY</div>' +
      '<div class="replay-hint">SPACE to skip</div>';
    container.appendChild(this.replayEl);

    // --- Result modal (hidden until time-up or finish) -------------------
    this.modal = document.createElement('div');
    this.modal.id = 'race-modal';
    this.modal.style.display = 'none';
    container.appendChild(this.modal);

    const card = document.createElement('div');
    card.className = 'race-modal-card';
    this.modal.appendChild(card);

    this.modalTitle = document.createElement('div');
    this.modalTitle.className = 'race-modal-title';
    card.appendChild(this.modalTitle);

    this.modalTime = document.createElement('div');
    this.modalTime.className = 'race-modal-time';
    card.appendChild(this.modalTime);

    this.modalSub = document.createElement('div');
    this.modalSub.className = 'race-modal-sub';
    card.appendChild(this.modalSub);

    // Name-entry row: shown when the finish time qualifies for the top 10.
    this.modalNameRow = document.createElement('div');
    this.modalNameRow.className = 'race-modal-name-row';
    this.modalNameRow.style.display = 'none';
    card.appendChild(this.modalNameRow);

    const nameLabel = document.createElement('div');
    nameLabel.className = 'race-modal-name-label';
    nameLabel.textContent = 'ENTER YOUR NAME';
    this.modalNameRow.appendChild(nameLabel);

    const nameInputRow = document.createElement('div');
    nameInputRow.className = 'race-modal-name-input-row';
    this.modalNameRow.appendChild(nameInputRow);

    this.modalNameInput = document.createElement('input');
    this.modalNameInput.className = 'race-modal-name-input';
    this.modalNameInput.maxLength = NAME_LEN;
    this.modalNameInput.autocomplete = 'off';
    this.modalNameInput.spellcheck = false;
    this.modalNameInput.placeholder = 'AAA';
    this.modalNameInput.style.pointerEvents = 'auto';
    this.modalNameInput.addEventListener('input', () => {
      const sanitised = this.modalNameInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, NAME_LEN);
      if (this.modalNameInput.value !== sanitised) {
        this.modalNameInput.value = sanitised;
      }
    });
    this.modalNameInput.addEventListener('keydown', (e) => {
      // Eat keys so global game shortcuts (R, T, M, etc.) don't fire.
      e.stopPropagation();
      if (e.key === 'Enter') this.submitName();
    });
    nameInputRow.appendChild(this.modalNameInput);

    this.modalNameSubmit = document.createElement('button');
    this.modalNameSubmit.className = 'race-modal-btn primary';
    this.modalNameSubmit.textContent = 'Save';
    this.modalNameSubmit.style.pointerEvents = 'auto';
    this.modalNameSubmit.onclick = () => this.submitName();
    nameInputRow.appendChild(this.modalNameSubmit);

    // Leaderboard list (top 10).
    this.modalBoard = document.createElement('div');
    this.modalBoard.className = 'race-modal-board';
    card.appendChild(this.modalBoard);

    const btnRow = document.createElement('div');
    btnRow.className = 'race-modal-btns';
    card.appendChild(btnRow);

    this.resultBtnRetry = document.createElement('button');
    this.resultBtnRetry.className = 'race-modal-btn primary';
    this.resultBtnRetry.textContent = 'Retry';
    this.resultBtnRetry.style.pointerEvents = 'auto';
    btnRow.appendChild(this.resultBtnRetry);

    this.resultBtnTracks = document.createElement('button');
    this.resultBtnTracks.className = 'race-modal-btn';
    this.resultBtnTracks.textContent = 'Tracks';
    this.resultBtnTracks.style.pointerEvents = 'auto';
    btnRow.appendChild(this.resultBtnTracks);

    this.resultBtnMenu = document.createElement('button');
    this.resultBtnMenu.className = 'race-modal-btn';
    this.resultBtnMenu.textContent = 'Menu';
    this.resultBtnMenu.style.pointerEvents = 'auto';
    btnRow.appendChild(this.resultBtnMenu);

    const hint = document.createElement('div');
    hint.className = 'race-modal-hint';
    hint.textContent = 'R retry · Esc menu';
    card.appendChild(hint);

    // ── Countdown overlay (3-2-1-GO) ────────────────────────────────────
    this.countdownEl = document.createElement('div');
    this.countdownEl.id = 'countdown-overlay';
    this.countdownEl.style.display = 'none';
    container.appendChild(this.countdownEl);

    this.offTrackEl = document.createElement('div');
    this.offTrackEl.id = 'offtrack-overlay';
    this.offTrackEl.style.display = 'none';
    this.offTrackEl.innerHTML =
      '<div class="offtrack-label">OFF TRACK</div><div class="offtrack-num">5</div>';
    container.appendChild(this.offTrackEl);

    // Lap-change banner (briefly flashes "LAP 2" / "LAP 3" / "FINAL LAP").
    this.lapBannerEl = document.createElement('div');
    this.lapBannerEl.id = 'lap-banner';
    this.lapBannerEl.style.display = 'none';
    container.appendChild(this.lapBannerEl);

    // Always-visible Quit button (top-left). Hooks up via setResultCallbacks.
    this.quitBtn = document.createElement('button');
    this.quitBtn.id = 'quit-btn';
    this.quitBtn.textContent = '← MENU';
    this.quitBtn.style.pointerEvents = 'auto';
    container.appendChild(this.quitBtn);

    const gauges = document.createElement('div');
    gauges.className = 'hud-gauges';
    this.root.appendChild(gauges);

    const redline = CarConfig.redlineRpm;
    const tachMax = Math.ceil((redline + 500) / 1000) * 1000;
    this.tach = makeGauge(gauges, {
      label: 'RPM ×1000',
      ticks: arange(0, tachMax, 1000),
      redlineAt: redline,
      formatTick: (v) => String(v / 1000),
    });

    const speedMax = 260;
    this.speedo = makeGauge(gauges, {
      label: 'km/h',
      ticks: arange(0, speedMax, 40),
    });

    const status = document.createElement('div');
    status.className = 'hud-status';
    this.root.appendChild(status);

    this.gearEl = document.createElement('div');
    this.gearEl.className = 'hud-gear';
    this.gearEl.textContent = '1';
    status.appendChild(this.gearEl);

    this.modeEl = document.createElement('div');
    this.modeEl.className = 'hud-mode';
    this.modeEl.textContent = 'AUTO';
    status.appendChild(this.modeEl);

    this.limiterEl = document.createElement('div');
    this.limiterEl.className = 'hud-limiter';
    this.limiterEl.textContent = 'LIMIT';
    status.appendChild(this.limiterEl);
  }

  update(s: HudState): void {
    setNeedle(this.tach, s.rpm);
    this.tach.digital.textContent = Math.round(s.rpm).toString();

    setNeedle(this.speedo, s.speedKmh);
    this.speedo.digital.textContent = Math.round(s.speedKmh).toString();

    if (this.gearEl.textContent !== s.gear) this.gearEl.textContent = s.gear;
    const modeLabel = s.mode === 'A' ? 'AUTO' : 'MANUAL';
    if (this.modeEl.textContent !== modeLabel) this.modeEl.textContent = modeLabel;

    this.limiterEl.classList.toggle('on', s.onLimiter);
  }

  setReplayActive(active: boolean): void {
    this.replayEl.style.display = active ? '' : 'none';
  }

  setResultCallbacks(cb: HudCallbacks): void {
    this.resultBtnRetry.onclick = cb.onRetry;
    this.resultBtnTracks.onclick = cb.onTrackSelect;
    this.resultBtnMenu.onclick = cb.onMenu;
    this.quitBtn.onclick = cb.onMenu;
  }

  updateRace(r: HudRaceState): void {
    this.currentTrackId = r.trackId;

    this.timerEl.textContent = formatTime(r.remainingSec);
    this.timerEl.classList.toggle('warn', r.remainingSec < 5 && r.state === 'racing');
    this.cpEl.textContent = `CP ${Math.min(r.passed, r.total)}/${r.total}`;
    this.lapEl.textContent = `LAP ${r.currentLap}/${r.totalLaps}`;
    this.wreckEl.style.display = r.wrecked ? '' : 'none';

    // Briefly flash a banner when the lap number changes mid-race.
    if (r.state === 'racing' && r.currentLap !== this.lastBannerLap) {
      this.lastBannerLap = r.currentLap;
      this.flashLapBanner(r.currentLap, r.totalLaps);
    } else if (r.state === 'countdown') {
      // Reset banner tracking on a fresh run so lap 1 → 2 fires correctly later.
      this.lastBannerLap = r.currentLap;
    }

    // Countdown overlay
    if (r.countdownPhase !== null) {
      this.countdownEl.style.display = '';
      const label = String(r.countdownPhase);
      if (this.countdownEl.textContent !== label) this.countdownEl.textContent = label;
      this.countdownEl.classList.toggle('go', r.countdownPhase === 'GO');
    } else {
      this.countdownEl.style.display = 'none';
    }

    // Off-track warning + countdown
    if (r.offTrackSecondsLeft > 0) {
      this.offTrackEl.style.display = '';
      const num = this.offTrackEl.querySelector('.offtrack-num');
      const label = String(r.offTrackSecondsLeft);
      if (num && num.textContent !== label) num.textContent = label;
    } else {
      this.offTrackEl.style.display = 'none';
    }

    if (r.state === 'racing' || r.state === 'countdown') {
      this.modal.style.display = 'none';
      this.resetResultState();
      return;
    }

    this.modal.style.display = 'flex';

    // First render at this result state: decide whether to show name entry.
    if (!this.resultShown) {
      this.resultShown = true;
      if (r.state === 'finished' && r.finishTimeSec !== null) {
        const rank = projectedRank(r.trackId, r.finishTimeSec);
        if (rank !== null) {
          this.nameEntryActive = true;
          this.pendingFinishTimeSec = r.finishTimeSec;
          this.pendingRank = rank;
          // Auto-focus so the player can type immediately. Defer until the
          // modal is in the DOM with display:flex.
          queueMicrotask(() => {
            this.modalNameInput.value = '';
            this.modalNameInput.focus();
          });
        }
      }
    }

    if (r.state === 'finished') {
      this.modalTitle.textContent = 'FINISH';
      this.modalTitle.className = 'race-modal-title finish';
      this.modalTime.textContent = formatTime(r.finishTimeSec ?? r.elapsedSec);
      if (this.nameEntryActive && !this.nameSubmitted && this.pendingRank !== null) {
        this.modalSub.textContent = `${ordinal(this.pendingRank)} BEST TIME!`;
        this.modalSub.className = 'race-modal-sub best';
      } else if (this.nameSubmitted) {
        // Post-submit text was set in submitName() — leave it.
      } else if (r.newBest) {
        this.modalSub.textContent = 'NEW BEST TIME!';
        this.modalSub.className = 'race-modal-sub best';
      } else if (r.bestTimeSec !== null) {
        this.modalSub.textContent = `Best: ${formatTime(r.bestTimeSec)}`;
        this.modalSub.className = 'race-modal-sub';
      } else {
        this.modalSub.textContent = '';
        this.modalSub.className = 'race-modal-sub';
      }
    } else {
      // timeup
      this.modalTitle.textContent = 'TIME UP';
      this.modalTitle.className = 'race-modal-title timeup';
      this.modalTime.textContent = '';
      this.modalSub.textContent =
        r.bestTimeSec !== null ? `Best: ${formatTime(r.bestTimeSec)}` : '';
      this.modalSub.className = 'race-modal-sub';
    }

    this.modalNameRow.style.display =
      this.nameEntryActive && !this.nameSubmitted ? '' : 'none';

    this.renderLeaderboard(r.trackId);
  }

  private submitName(): void {
    if (!this.nameEntryActive || this.nameSubmitted) return;
    if (this.currentTrackId === null) return;
    if (this.pendingFinishTimeSec === null) return;
    const raw = this.modalNameInput.value.trim() || 'AAA';
    const { newIndex } = submitScore(
      this.currentTrackId,
      raw,
      this.pendingFinishTimeSec,
    );
    this.newEntryIndex = newIndex;
    this.nameSubmitted = true;
    this.modalNameRow.style.display = 'none';
    const finalRank = newIndex + 1;
    this.modalSub.textContent = `${ordinal(finalRank)} BEST TIME — SAVED`;
    this.modalSub.className = 'race-modal-sub best';
    this.renderLeaderboard(this.currentTrackId);
  }

  private renderLeaderboard(trackId: string): void {
    const entries = loadLeaderboard(trackId);
    if (entries.length === 0) {
      this.modalBoard.innerHTML =
        '<div class="race-modal-board-empty">no times yet — be the first</div>';
      return;
    }
    const rows = entries
      .map((e, i) => {
        const isNew = this.nameSubmitted && i === this.newEntryIndex;
        return `<div class="race-board-row${isNew ? ' new' : ''}">` +
          `<div class="race-board-rank">${String(i + 1).padStart(2, '0')}</div>` +
          `<div class="race-board-name">${escapeHtml(e.name)}</div>` +
          `<div class="race-board-time">${formatTime(e.timeSec)}</div>` +
          `</div>`;
      })
      .join('');
    this.modalBoard.innerHTML =
      '<div class="race-modal-board-title">TOP TIMES</div>' + rows;
  }

  private resetResultState(): void {
    if (this.resultShown || this.nameEntryActive || this.nameSubmitted) {
      this.resultShown = false;
      this.nameEntryActive = false;
      this.nameSubmitted = false;
      this.newEntryIndex = null;
      this.pendingFinishTimeSec = null;
      this.pendingRank = null;
      this.modalNameRow.style.display = 'none';
      this.modalNameInput.value = '';
    }
  }

  private flashLapBanner(currentLap: number, totalLaps: number): void {
    if (currentLap <= 1) return;
    const isFinal = currentLap === totalLaps;
    this.lapBannerEl.textContent = isFinal ? 'FINAL LAP' : `LAP ${currentLap}`;
    this.lapBannerEl.classList.toggle('final', isFinal);
    this.lapBannerEl.style.display = '';
    // Re-trigger the CSS animation by stripping/re-adding the class.
    this.lapBannerEl.classList.remove('show');
    void this.lapBannerEl.offsetWidth;
    this.lapBannerEl.classList.add('show');
    window.setTimeout(() => {
      this.lapBannerEl.style.display = 'none';
    }, 1800);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}TH`;
  switch (n % 10) {
    case 1: return `${n}ST`;
    case 2: return `${n}ND`;
    case 3: return `${n}RD`;
    default: return `${n}TH`;
  }
}

function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function makeGauge(parent: HTMLElement, opts: GaugeOpts): Gauge {
  const wrap = document.createElement('div');
  wrap.className = 'hud-gauge';
  parent.appendChild(wrap);

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 12;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  wrap.appendChild(svg);

  // Outer ring.
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', String(cx));
  ring.setAttribute('cy', String(cy));
  ring.setAttribute('r', String(r + 6));
  ring.setAttribute('class', 'gauge-ring');
  svg.appendChild(ring);

  const min = opts.ticks[0];
  const max = opts.ticks[opts.ticks.length - 1];

  // Redline arc (drawn under the ticks).
  if (opts.redlineAt !== undefined) {
    const a0 = valueToAngle(opts.redlineAt, min, max);
    const a1 = valueToAngle(max, min, max);
    const arc = document.createElementNS(SVG_NS, 'path');
    arc.setAttribute('d', arcPath(cx, cy, r + 1, a0, a1));
    arc.setAttribute('class', 'gauge-redline');
    svg.appendChild(arc);
  }

  // Ticks + labels.
  for (const t of opts.ticks) {
    const a = valueToAngle(t, min, max);
    const ang = toSvgRad(a);
    const x1 = cx + Math.cos(ang) * (r - 8);
    const y1 = cy + Math.sin(ang) * (r - 8);
    const x2 = cx + Math.cos(ang) * r;
    const y2 = cy + Math.sin(ang) * r;
    const tick = document.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', String(x1));
    tick.setAttribute('y1', String(y1));
    tick.setAttribute('x2', String(x2));
    tick.setAttribute('y2', String(y2));
    tick.setAttribute('class', 'gauge-tick');
    svg.appendChild(tick);

    const lx = cx + Math.cos(ang) * (r - 22);
    const ly = cy + Math.sin(ang) * (r - 22);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(lx));
    label.setAttribute('y', String(ly));
    label.setAttribute('class', 'gauge-label');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.textContent = (opts.formatTick ?? defaultFormatTick)(t);
    svg.appendChild(label);
  }

  // Needle.
  const needle = document.createElementNS(SVG_NS, 'g');
  needle.setAttribute('class', 'gauge-needle');
  needle.setAttribute('transform', `rotate(${valueToAngle(min, min, max)} ${cx} ${cy})`);
  const needleLine = document.createElementNS(SVG_NS, 'line');
  needleLine.setAttribute('x1', String(cx));
  needleLine.setAttribute('y1', String(cy + 12));
  needleLine.setAttribute('x2', String(cx));
  needleLine.setAttribute('y2', String(cy - (r - 14)));
  needle.appendChild(needleLine);
  const hub = document.createElementNS(SVG_NS, 'circle');
  hub.setAttribute('cx', String(cx));
  hub.setAttribute('cy', String(cy));
  hub.setAttribute('r', '6');
  hub.setAttribute('class', 'gauge-hub');
  svg.appendChild(needle);
  svg.appendChild(hub);

  // Digital readout in the lower half of the gauge.
  const digital = document.createElementNS(SVG_NS, 'text');
  digital.setAttribute('x', String(cx));
  digital.setAttribute('y', String(cy + r - 28));
  digital.setAttribute('class', 'gauge-digital');
  digital.setAttribute('text-anchor', 'middle');
  digital.textContent = '0';
  svg.appendChild(digital);

  const caption = document.createElementNS(SVG_NS, 'text');
  caption.setAttribute('x', String(cx));
  caption.setAttribute('y', String(cy + r - 14));
  caption.setAttribute('class', 'gauge-caption');
  caption.setAttribute('text-anchor', 'middle');
  caption.textContent = opts.label;
  svg.appendChild(caption);

  return { needle, digital, min, max, cx, cy };
}

function setNeedle(g: Gauge, value: number): void {
  const clamped = Math.max(g.min, Math.min(g.max, value));
  const angle = valueToAngle(clamped, g.min, g.max);
  g.needle.setAttribute('transform', `rotate(${angle.toFixed(2)} ${g.cx} ${g.cy})`);
}

/**
 * Returns the gauge angle for `value`, measured from straight up with
 * clockwise positive. Range: [-ARC/2, +ARC/2]. Min sits lower-left, max
 * sits lower-right, midrange points up — standard automotive layout.
 */
function valueToAngle(value: number, min: number, max: number): number {
  const t = (value - min) / (max - min);
  return -GAUGE_ARC_DEG / 2 + t * GAUGE_ARC_DEG;
}

/** Convert a "from-top, clockwise" angle (degrees) to SVG math radians. */
function toSvgRad(angleFromTopDeg: number): number {
  return (angleFromTopDeg - 90) * (Math.PI / 180);
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const startA = toSvgRad(a0);
  const endA = toSvgRad(a1);
  const x0 = cx + Math.cos(startA) * r;
  const y0 = cy + Math.sin(startA) * r;
  const x1 = cx + Math.cos(endA) * r;
  const y1 = cy + Math.sin(endA) * r;
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

function arange(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let v = start; v <= end + 1e-6; v += step) out.push(Math.round(v));
  return out;
}

function defaultFormatTick(v: number): string {
  return String(v);
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
    #hud {
      position: fixed;
      left: 50%;
      bottom: 16px;
      transform: translateX(-50%);
      display: flex;
      align-items: flex-end;
      gap: 14px;
      pointer-events: none;
      user-select: none;
      color: #e8edf6;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }
    .hud-gauges { display: flex; gap: 12px; }
    .hud-gauge {
      background: rgba(12, 16, 24, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 6px;
    }
    .gauge-ring {
      fill: none;
      stroke: rgba(255, 255, 255, 0.08);
      stroke-width: 2;
    }
    .gauge-redline {
      fill: none;
      stroke: #ff4f4f;
      stroke-width: 4;
      stroke-linecap: round;
    }
    .gauge-tick {
      stroke: rgba(255, 255, 255, 0.55);
      stroke-width: 2;
      stroke-linecap: round;
    }
    .gauge-label {
      font-size: 10px;
      fill: #c7d0e0;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }
    .gauge-needle line {
      stroke: #ffd166;
      stroke-width: 3;
      stroke-linecap: round;
      filter: drop-shadow(0 0 4px rgba(255, 209, 102, 0.55));
    }
    .gauge-hub {
      fill: #1a2030;
      stroke: rgba(255, 255, 255, 0.5);
      stroke-width: 2;
    }
    .gauge-digital {
      font-size: 18px;
      font-weight: 700;
      fill: #4fd1c5;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }
    .gauge-caption {
      font-size: 9px;
      fill: #8892a8;
      letter-spacing: 1.5px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }
    .hud-status {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      background: rgba(12, 16, 24, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 10px 14px;
      min-width: 88px;
    }
    .hud-gear {
      font-size: 42px;
      font-weight: 800;
      line-height: 1;
      color: #ffd166;
    }
    .hud-mode {
      font-size: 11px;
      letter-spacing: 2px;
      color: #8892a8;
    }
    .hud-limiter {
      font-size: 10px;
      letter-spacing: 2px;
      color: rgba(255, 79, 79, 0.25);
      transition: color 0.08s linear;
    }
    .hud-limiter.on {
      color: #ff4f4f;
      text-shadow: 0 0 8px rgba(255, 79, 79, 0.7);
    }

    #race-bar {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 18px;
      align-items: center;
      padding: 10px 20px;
      background: rgba(12, 16, 24, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      pointer-events: none;
      user-select: none;
      color: #e8edf6;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }
    .race-timer {
      font-size: 26px;
      font-weight: 800;
      color: #4fd1c5;
      letter-spacing: 1px;
      min-width: 110px;
      text-align: center;
      transition: color 0.1s linear;
    }
    .race-timer.warn {
      color: #ff4f4f;
      text-shadow: 0 0 10px rgba(255, 79, 79, 0.7);
    }
    .race-cp {
      font-size: 13px;
      letter-spacing: 2px;
      color: #8892a8;
    }
    .race-lap {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2px;
      color: #ffd166;
      padding: 2px 10px;
      border-radius: 6px;
      background: rgba(255, 209, 102, 0.10);
    }
    .race-wreck {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 3px;
      padding: 2px 10px;
      border-radius: 6px;
      background: rgba(255, 79, 79, 0.18);
      color: #ff4f4f;
      text-shadow: 0 0 8px rgba(255, 79, 79, 0.6);
    }

    #replay-overlay {
      position: fixed;
      left: 50%;
      top: 26%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      pointer-events: none;
      user-select: none;
      color: #e8edf6;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      text-shadow: 0 0 14px rgba(0, 0, 0, 0.75);
    }
    .replay-label {
      font-size: 38px;
      font-weight: 900;
      letter-spacing: 10px;
      color: #ff4f4f;
      animation: replay-pulse 1.4s infinite ease-in-out;
    }
    .replay-hint {
      font-size: 11px;
      letter-spacing: 3px;
      color: #c7d0e0;
    }
    @keyframes replay-pulse {
      0%, 100% { opacity: 0.65; }
      50% { opacity: 1; text-shadow: 0 0 22px rgba(255, 79, 79, 0.8); }
    }

    #race-modal {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(8, 11, 18, 0.55);
      backdrop-filter: blur(3px);
      pointer-events: none;
      user-select: none;
      z-index: 10;
    }
    .race-modal-card {
      padding: 28px 44px;
      background: rgba(12, 16, 24, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      text-align: center;
      color: #e8edf6;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      min-width: 260px;
    }
    .race-modal-title {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: 4px;
      margin-bottom: 8px;
    }
    .race-modal-title.finish { color: #4fff8a; text-shadow: 0 0 14px rgba(79, 255, 138, 0.45); }
    .race-modal-title.timeup { color: #ff4f4f; text-shadow: 0 0 14px rgba(255, 79, 79, 0.45); }
    .race-modal-time {
      font-size: 42px;
      font-weight: 800;
      color: #ffd166;
      margin-bottom: 6px;
    }
    .race-modal-sub {
      font-size: 13px;
      letter-spacing: 1.5px;
      color: #8892a8;
      margin-bottom: 16px;
    }
    .race-modal-sub.best {
      color: #4fff8a;
    }
    .race-modal-btns {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin: 6px 0 14px;
    }
    .race-modal-btn {
      padding: 10px 22px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 2px;
      color: #8892a8;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      cursor: pointer;
      transition: transform 0.08s, border-color 0.08s, color 0.08s;
    }
    .race-modal-btn:hover {
      border-color: #ffd166;
      color: #ffd166;
      transform: translateY(-1px);
    }
    .race-modal-btn.primary {
      background: #ffd166;
      color: #1a2030;
      border-color: #ffd166;
    }
    .race-modal-btn.primary:hover { background: #ffdf8f; }
    .race-modal-hint {
      font-size: 10px;
      letter-spacing: 2px;
      color: #6b7689;
    }
    .race-modal-name-row {
      margin: 8px 0 12px;
      padding: 12px 14px;
      background: rgba(255, 209, 102, 0.10);
      border: 1px dashed rgba(255, 209, 102, 0.5);
      border-radius: 10px;
    }
    .race-modal-name-label {
      font-size: 11px;
      letter-spacing: 3px;
      color: #ffd166;
      margin-bottom: 8px;
    }
    .race-modal-name-input-row {
      display: flex;
      gap: 8px;
      justify-content: center;
      align-items: center;
    }
    .race-modal-name-input {
      width: 110px;
      padding: 10px 12px;
      font-family: inherit;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: 8px;
      text-align: center;
      color: #ffd166;
      background: rgba(12, 16, 24, 0.85);
      border: 1px solid rgba(255, 209, 102, 0.4);
      border-radius: 8px;
      text-transform: uppercase;
      caret-color: #4fff8a;
    }
    .race-modal-name-input:focus {
      outline: none;
      border-color: #4fff8a;
      box-shadow: 0 0 12px rgba(79, 255, 138, 0.35);
    }
    .race-modal-board {
      margin: 4px 0 14px;
      max-height: 240px;
      overflow-y: auto;
      text-align: left;
    }
    .race-modal-board-title {
      font-size: 10px;
      letter-spacing: 3px;
      color: #6b7689;
      margin-bottom: 6px;
      text-align: center;
    }
    .race-modal-board-empty {
      font-size: 11px;
      letter-spacing: 1.5px;
      color: #6b7689;
      text-align: center;
      padding: 12px 0;
    }
    .race-board-row {
      display: grid;
      grid-template-columns: 30px 60px 1fr;
      align-items: center;
      gap: 10px;
      padding: 4px 8px;
      font-size: 13px;
      letter-spacing: 1px;
      color: #c7d0e0;
      border-radius: 4px;
    }
    .race-board-row.new {
      background: rgba(79, 255, 138, 0.14);
      color: #4fff8a;
      animation: row-pulse 1.2s ease-in-out 3;
    }
    .race-board-rank {
      color: #6b7689;
      font-size: 11px;
      letter-spacing: 0;
    }
    .race-board-name {
      font-weight: 800;
      letter-spacing: 3px;
    }
    .race-board-time {
      font-family: inherit;
      text-align: right;
      color: #ffd166;
      font-weight: 700;
    }
    .race-board-row.new .race-board-time { color: #4fff8a; }
    @keyframes row-pulse {
      0%, 100% { background: rgba(79, 255, 138, 0.14); }
      50%      { background: rgba(79, 255, 138, 0.32); }
    }

    #quit-btn {
      position: fixed;
      top: 16px;
      left: 16px;
      padding: 8px 14px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2.5px;
      color: #c7d0e0;
      background: rgba(12, 16, 24, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      cursor: pointer;
      pointer-events: auto;
      user-select: none;
      transition: color 0.08s, border-color 0.08s, background 0.08s;
      z-index: 12;
    }
    #quit-btn:hover {
      color: #ffd166;
      border-color: #ffd166;
      background: rgba(255, 209, 102, 0.10);
    }

    #lap-banner {
      position: fixed;
      top: 22%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 56px;
      font-weight: 900;
      letter-spacing: 8px;
      color: #4fff8a;
      text-shadow: 0 0 22px rgba(79, 255, 138, 0.55);
      pointer-events: none;
      user-select: none;
      z-index: 9;
      opacity: 0;
    }
    #lap-banner.final {
      color: #ff4f4f;
      text-shadow: 0 0 22px rgba(255, 79, 79, 0.6);
    }
    #lap-banner.show {
      animation: lap-banner-pop 1.7s ease-out forwards;
    }
    @keyframes lap-banner-pop {
      0%   { transform: translate(-50%, -50%) scale(1.4); opacity: 0; }
      15%  { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
      75%  { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(0.95); opacity: 0; }
    }

    #countdown-overlay {
      position: fixed;
      top: 38%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 140px;
      font-weight: 900;
      color: #ffd166;
      text-shadow: 0 0 36px rgba(255, 209, 102, 0.55);
      pointer-events: none;
      user-select: none;
      animation: cd-pop 0.9s ease-out;
      z-index: 9;
    }
    #countdown-overlay.go {
      color: #4fff8a;
      text-shadow: 0 0 48px rgba(79, 255, 138, 0.65);
      font-size: 120px;
    }
    @keyframes cd-pop {
      0% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
      30% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(0.92); opacity: 1; }
    }

    #offtrack-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      user-select: none;
      box-shadow: inset 0 0 0 6px rgba(255, 79, 79, 0.55);
      animation: offtrack-flash 0.8s ease-in-out infinite;
      z-index: 8;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }
    @keyframes offtrack-flash {
      0%, 100% { box-shadow: inset 0 0 0 6px rgba(255, 79, 79, 0.25); }
      50%      { box-shadow: inset 0 0 0 6px rgba(255, 79, 79, 0.85); }
    }
    .offtrack-label {
      position: absolute;
      top: 90px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 22px;
      font-weight: 900;
      letter-spacing: 8px;
      color: #ff4f4f;
      text-shadow: 0 0 14px rgba(255, 79, 79, 0.6);
    }
    .offtrack-num {
      position: absolute;
      top: 130px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 84px;
      font-weight: 900;
      color: #ff4f4f;
      text-shadow: 0 0 18px rgba(255, 79, 79, 0.55);
    }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
