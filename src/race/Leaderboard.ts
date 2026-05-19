/**
 * Arcade-style per-track high-score table. Stored in localStorage.
 *
 * Top-10 per track. Each entry has a 3-character name (A-Z 0-9), the
 * finish time in seconds, and an ISO date for tie-breaking display.
 * The list is kept sorted by `timeSec` ascending — index 0 is the best.
 */

export const MAX_ENTRIES = 10;
export const NAME_LEN = 3;

export interface LeaderboardEntry {
  name: string;
  timeSec: number;
  date: string;
}

export interface SubmitResult {
  entries: LeaderboardEntry[];
  newIndex: number;
}

function key(trackId: string): string {
  return `stuntline:leaderboard:${trackId}`;
}

function sanitiseName(name: string): string {
  const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper.length === 0) return 'AAA';
  return upper.slice(0, NAME_LEN).padEnd(NAME_LEN, ' ').slice(0, NAME_LEN);
}

export function loadLeaderboard(trackId: string): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(key(trackId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is LeaderboardEntry =>
          e &&
          typeof e.name === 'string' &&
          typeof e.timeSec === 'number' &&
          Number.isFinite(e.timeSec) &&
          typeof e.date === 'string',
      )
      .map((e) => ({ name: sanitiseName(e.name), timeSec: e.timeSec, date: e.date }))
      .sort((a, b) => a.timeSec - b.timeSec)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** True if `timeSec` would land in the top 10 for this track. */
export function qualifies(trackId: string, timeSec: number): boolean {
  return projectedRank(trackId, timeSec) !== null;
}

/** Returns the 1-based position `timeSec` WOULD occupy if submitted now,
 *  or `null` if it falls outside the top `MAX_ENTRIES`. */
export function projectedRank(trackId: string, timeSec: number): number | null {
  const list = loadLeaderboard(trackId);
  let rank = 1;
  for (const e of list) {
    if (e.timeSec < timeSec) rank += 1;
  }
  return rank <= MAX_ENTRIES ? rank : null;
}

/** Insert a new entry and persist. Returns the updated list + new entry's index. */
export function submitScore(
  trackId: string,
  name: string,
  timeSec: number,
): SubmitResult {
  const safeName = sanitiseName(name);
  const entry: LeaderboardEntry = {
    name: safeName,
    timeSec,
    date: new Date().toISOString(),
  };
  const list = loadLeaderboard(trackId);
  list.push(entry);
  list.sort((a, b) => a.timeSec - b.timeSec);
  const trimmed = list.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(key(trackId), JSON.stringify(trimmed));
  } catch {
    /* ignore quota / private-mode errors */
  }
  const newIndex = trimmed.findIndex((e) => e === entry);
  return { entries: trimmed, newIndex };
}
