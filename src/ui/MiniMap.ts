import type { CenterlineSample } from '../track/TrackBuilder';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Top-right SVG mini-map.
 *
 * Draws the track centerline as a single polyline, with a green dot for the
 * spawn / finish line and a yellow dot that follows the car. Coordinates are
 * computed once at construction time (fitting the centerline's XZ bounds
 * into the SVG viewbox with a tiny margin); only the car dot moves per frame.
 */
export class MiniMap {
  private readonly carDot: SVGCircleElement;
  private readonly mapMinX: number;
  private readonly mapMinZ: number;
  private readonly mapScale: number;
  private readonly svgSize = 160;

  constructor(
    container: HTMLElement,
    centerline: CenterlineSample[],
    spawn: { x: number; z: number },
    visible: boolean = true,
  ) {
    if (centerline.length === 0) {
      this.carDot = document.createElementNS(SVG_NS, 'circle');
      this.mapMinX = 0;
      this.mapMinZ = 0;
      this.mapScale = 1;
      return;
    }

    // Bounds of the track centerline.
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const s of centerline) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
    }
    const margin = 10;
    const w = maxX - minX || 1;
    const h = maxZ - minZ || 1;
    const inner = this.svgSize - margin * 2;
    this.mapScale = Math.min(inner / w, inner / h);
    const mapW = w * this.mapScale;
    const mapH = h * this.mapScale;
    this.mapMinX = minX - (inner - mapW) / 2 / this.mapScale;
    this.mapMinZ = minZ - (inner - mapH) / 2 / this.mapScale;

    injectStyles();
    const root = document.createElement('div');
    root.id = 'minimap';
    if (!visible) root.style.display = 'none';
    container.appendChild(root);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(this.svgSize));
    svg.setAttribute('height', String(this.svgSize));
    svg.setAttribute('viewBox', `0 0 ${this.svgSize} ${this.svgSize}`);
    root.appendChild(svg);

    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(this.svgSize));
    bg.setAttribute('height', String(this.svgSize));
    bg.setAttribute('class', 'mm-bg');
    svg.appendChild(bg);

    // Track polyline.
    const pts = centerline
      .map((s) => `${this.toSvgX(s.x).toFixed(1)},${this.toSvgY(s.z).toFixed(1)}`)
      .join(' ');
    const polyOuter = document.createElementNS(SVG_NS, 'polyline');
    polyOuter.setAttribute('points', pts);
    polyOuter.setAttribute('class', 'mm-track-shadow');
    svg.appendChild(polyOuter);
    const poly = document.createElementNS(SVG_NS, 'polyline');
    poly.setAttribute('points', pts);
    poly.setAttribute('class', 'mm-track');
    svg.appendChild(poly);

    // Spawn / finish marker.
    const spawnDot = document.createElementNS(SVG_NS, 'circle');
    spawnDot.setAttribute('cx', String(this.toSvgX(spawn.x)));
    spawnDot.setAttribute('cy', String(this.toSvgY(spawn.z)));
    spawnDot.setAttribute('r', '3');
    spawnDot.setAttribute('class', 'mm-spawn');
    svg.appendChild(spawnDot);

    // Car dot (updated per frame).
    this.carDot = document.createElementNS(SVG_NS, 'circle');
    this.carDot.setAttribute('cx', String(this.toSvgX(spawn.x)));
    this.carDot.setAttribute('cy', String(this.toSvgY(spawn.z)));
    this.carDot.setAttribute('r', '4');
    this.carDot.setAttribute('class', 'mm-car');
    svg.appendChild(this.carDot);
  }

  private toSvgX(worldX: number): number {
    return (worldX - this.mapMinX) * this.mapScale + 10;
  }
  private toSvgY(worldZ: number): number {
    return (worldZ - this.mapMinZ) * this.mapScale + 10;
  }

  /** Per render frame: update the car dot. */
  update(carX: number, carZ: number): void {
    this.carDot.setAttribute('cx', this.toSvgX(carX).toFixed(1));
    this.carDot.setAttribute('cy', this.toSvgY(carZ).toFixed(1));
  }
}

let injected = false;
function injectStyles(): void {
  if (injected) return;
  injected = true;
  const css = `
    #minimap {
      position: fixed;
      top: 16px;
      right: 16px;
      pointer-events: none;
      user-select: none;
      z-index: 11;
      background: rgba(12, 16, 24, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    }
    .mm-bg { fill: rgba(255, 255, 255, 0.02); }
    .mm-track-shadow {
      fill: none;
      stroke: rgba(0, 0, 0, 0.6);
      stroke-width: 6;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .mm-track {
      fill: none;
      stroke: #c7d0e0;
      stroke-width: 3;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .mm-spawn {
      fill: #4fff8a;
      stroke: rgba(0,0,0,0.55);
      stroke-width: 1;
    }
    .mm-car {
      fill: #ffd166;
      stroke: rgba(0,0,0,0.6);
      stroke-width: 1.4;
      filter: drop-shadow(0 0 6px rgba(255, 209, 102, 0.55));
    }
  `;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}
