import type { TrackDef } from '../TrackTypes';
import { trackSkylineRun } from './track01_easy';
import { trackLoopback } from './track02_medium';
import { trackGauntlet } from './track03_hard';

/**
 * Ordered list of available tracks. Index here doubles as the URL/key id
 * for the M8 dev switcher (`?track=1`/`2`/`3`) and will back M9's menu.
 */
export const TRACKS: readonly TrackDef[] = [
  trackSkylineRun,
  trackLoopback,
  trackGauntlet,
] as const;

export function trackByDevIndex(idx: number): TrackDef {
  const i = Math.min(TRACKS.length - 1, Math.max(0, idx));
  return TRACKS[i];
}
