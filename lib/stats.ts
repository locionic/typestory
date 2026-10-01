import { useSyncExternalStore } from 'react';
import { SourceType, TypingSessionRecord, UserStats } from './types';
import { pushProgress } from './progress-client';
import {
  MAX_SESSIONS,
  MAX_TITLE_LENGTH,
  MAX_WPM,
  SOURCE_TYPES,
  isCount,
  isDateStr,
  isPercent,
  isWpm,
} from './progress-schema';

const STORAGE_KEY = 'typestory_user_stats_v1';
export const STATS_CHANGE_EVENT = 'typestory:stats-updated';

const DEFAULT_STATS: UserStats = {
  sessions: [],
  dailyStreak: {
    currentStreak: 0,
    bestStreak: 0,
    lastActiveDate: '',
  },
  totalWordsTyped: 0,
  totalTimeSpentSeconds: 0,
  bestWpm: 0,
  averageWpm: 0,
  averageAccuracy: 100,
};

/**
 * Standard 5-characters-per-word convention, shared by the live readout and the
 * session record so the two can never disagree.
 *
 * Capped at MAX_WPM, imported from the module that refuses anything above it. A passage
 * finished inside a single whole second divides by 1s and reports a speed no human
 * produced, and that value is written to storage *and* uploaded — so without the cap a
 * legitimate run is stored fine but silently refused by the sync API, and the learner
 * loses the backup without ever being told.
 */
export function wpmFrom(correctKeystrokes: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.min(MAX_WPM, Math.round((correctKeystrokes / 5) / (seconds / 60)));
}

/**
 * How long a run counts, in whole seconds.
 *
 * Read from the run's own start/end stamps rather than from the 250ms display tick.
 * `tick()` floors, and it stops the instant the passage completes, so a 3.6s run
 * reports 3 there and 4 here — the tick is both a second low and up to a tick stale.
 *
 * One caller needs it, and it is shared by two consumers inside that caller (the
 * number on the completion card and the number written to the history). They used to
 * read the two clocks separately, so the WPM the learner read off the card was not
 * the WPM recorded against the session — and since floor is never above round, the
 * card always flattered. One function so that cannot drift.
 *
 * Falls back to `tickSeconds` when the run has not been stamped, which is the live
 * readout's only clock mid-passage.
 */
export function finishedSeconds(
  startTime: number | null,
  endTime: number | null,
  tickSeconds: number,
): number {
  if (startTime === null || endTime === null) return tickSeconds;
  return Math.max(1, Math.round((endTime - startTime) / 1000));
}

export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getYesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A stored field is only trusted if it is one the sync API will accept.
 *
 * localStorage is shared with every other script on the origin, survives
 * upgrades, and can be hand-edited in devtools. Spreading a payload with a
 * string in `totalWordsTyped` gives the Stats modal a `.toLocaleString is not a
 * function` crash that unmounts the whole app — so every field is checked at
 * the boundary and falls back to the default rather than reaching a component.
 *
 * "Accept" is deliberately not "is a finite number". These are the same predicates
 * `parseProgressBody` applies, imported rather than restated, and the difference is
 * the whole cost of getting it wrong: finiteness admits a negative duration and a
 * 5000 WPM, both of which render perfectly and are refused by the push. Because a
 * push is a whole-record overwrite, one such field takes the entire backup down —
 * silently, since a 400 is a resolved fetch and `pushProgress` only catches a
 * rejection. The learner's history keeps growing on screen and stops appearing on
 * every other browser, with nothing anywhere to say so.
 */
const num = (value: unknown, fallback: number, isValid: (v: unknown) => boolean = isCount): number =>
  isValid(value) ? (value as number) : fallback;

/**
 * The sessions as the app will use them.
 *
 * Rebuilt field by field rather than filtered in place. Filtering kept each caller's
 * own object, so anything the two checks did not name rode along into the returned
 * stats, into the Stats modal, and back into storage on the next session — which is
 * why the note in lib/progress-client.ts, that a restored backup is "safe to keep only
 * because loadUserStats() validates every field", was true of the fields this file
 * knows and silent about the ones it does not.
 *
 * A session is admitted whole or not at all. Repairing one field and keeping the rest
 * would not help: the server rejects the entire record over any single out-of-range
 * value, so a session with its accuracy fixed but a 200-character title still takes
 * the whole push down with it. And there is nothing honest to patch these to — a speed
 * of 5000 or a day of "yesterday" is not a slightly wrong reading of a real session,
 * it is not a reading of one at all. The checks are the server's, so what survives
 * here is exactly what `parseProgressBody` would have kept.
 */
function sanitizeSessions(value: unknown): TypingSessionRecord[] {
  if (!Array.isArray(value)) return [];

  const sessions: TypingSessionRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const session = entry as Partial<TypingSessionRecord>;

    const usable =
      typeof session.id === 'string' &&
      session.id.length > 0 &&
      session.id.length <= 64 &&
      isCount(session.timestamp) &&
      isDateStr(session.dateStr) &&
      typeof session.title === 'string' &&
      session.title.length <= MAX_TITLE_LENGTH &&
      SOURCE_TYPES.includes(session.sourceType as SourceType) &&
      isWpm(session.wpm) &&
      isPercent(session.accuracy) &&
      isCount(session.durationSeconds) &&
      isCount(session.wordsCount) &&
      isCount(session.keystrokes);

    if (!usable) continue;

    sessions.push({
      id: session.id as string,
      timestamp: session.timestamp as number,
      dateStr: session.dateStr as string,
      title: session.title as string,
      sourceType: session.sourceType as SourceType,
      wpm: session.wpm as number,
      accuracy: session.accuracy as number,
      durationSeconds: session.durationSeconds as number,
      wordsCount: session.wordsCount as number,
      keystrokes: session.keystrokes as number,
    });
  }
  return sessions;
}

/**
 * Any object to the stats this app will actually use. Split out of `loadUserStats` so
 * the write path shares it: sanitising on read is only a guarantee about what is
 * *displayed*, and `saveUserStats` is what decides what is *kept* and what is uploaded.
 */
function sanitiseUserStats(parsed: unknown): UserStats {
  const value = (parsed ?? {}) as Partial<UserStats>;
  const streak: Partial<UserStats['dailyStreak']> = value.dailyStreak || {};
  // Every key named explicitly and none spread in. `...parsed` used to sit above the
  // overrides, so the sanitising below covered the fields this file lists and let the
  // rest of the stored object through untouched — the same gap lib/progress-schema.ts
  // had on the way in, and a stowaway field survives the round trip because of it.
  return {
    dailyStreak: {
      currentStreak: num(streak.currentStreak, DEFAULT_STATS.dailyStreak.currentStreak),
      bestStreak: num(streak.bestStreak, DEFAULT_STATS.dailyStreak.bestStreak),
      // "" means "never practised" (see DEFAULT_STATS), so it is the fallback here.
      lastActiveDate: isDateStr(streak.lastActiveDate) ? streak.lastActiveDate : '',
    },
    sessions: sanitizeSessions(value.sessions),
    totalWordsTyped: num(value.totalWordsTyped, DEFAULT_STATS.totalWordsTyped),
    totalTimeSpentSeconds: num(
      value.totalTimeSpentSeconds,
      DEFAULT_STATS.totalTimeSpentSeconds,
    ),
    // Speeds and percentages, with the bounds the server enforces rather than a
    // finiteness check. A poisoned best falls back to 0, which the next completed
    // session rebuilds with `Math.max`, so nothing here is unrecoverable — and the
    // record stays uploadable, which is the point.
    bestWpm: num(value.bestWpm, DEFAULT_STATS.bestWpm, isWpm),
    averageWpm: num(value.averageWpm, DEFAULT_STATS.averageWpm, isWpm),
    averageAccuracy: num(value.averageAccuracy, DEFAULT_STATS.averageAccuracy, isPercent),
  };
}

export function loadUserStats(): UserStats {
  if (typeof window === 'undefined') return DEFAULT_STATS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATS;
    return sanitiseUserStats(JSON.parse(raw));
  } catch {
    return DEFAULT_STATS;
  }
}

export function saveUserStats(stats: UserStats): void {
  if (typeof window === 'undefined') return;
  // Sanitised on the way out as well as in. The restore path is the one caller that
  // passes a record this app did not build — fetchBackup reads it off a response body
  // with a cast, and documents it as unsanitised — and this function is what turns it
  // into stored bytes and an uploaded body. Anything it did not strip was being kept
  // and re-pushed, which is the opposite of what the read path promises.
  const clean = sanitiseUserStats(stats);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent(STATS_CHANGE_EVENT, { detail: clean }));
  } catch {
    // Ignore storage quota errors
  }
  // Every local write is also a backup write, so a session that was never uploaded
  // cannot exist. No-op unless the learner turned a backup on.
  pushProgress(clean);
}

export function recordCompletedSession(params: {
  title: string;
  sourceType: SourceType;
  wpm: number;
  accuracy: number;
  durationSeconds: number;
  wordsCount: number;
  keystrokes: number;
}): UserStats {
  const current = loadUserStats();
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();

  // Streak calculation
  let newCurrentStreak = current.dailyStreak.currentStreak;
  const lastActive = current.dailyStreak.lastActiveDate;

  if (!lastActive) {
    newCurrentStreak = 1;
  } else if (lastActive === today) {
    // Already practiced today, keep streak
    newCurrentStreak = Math.max(1, newCurrentStreak);
  } else if (lastActive === yesterday) {
    // Practiced yesterday, streak grows
    newCurrentStreak += 1;
  } else {
    // Broken streak
    newCurrentStreak = 1;
  }

  const newBestStreak = Math.max(current.dailyStreak.bestStreak, newCurrentStreak);

  const newSession: TypingSessionRecord = {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    dateStr: today,
    title: params.title,
    sourceType: params.sourceType,
    wpm: params.wpm,
    accuracy: params.accuracy,
    durationSeconds: params.durationSeconds,
    wordsCount: params.wordsCount,
    keystrokes: params.keystrokes,
  };

  // The shared constant, not a literal 100. This file and the sync schema have to
  // agree, and if the client ever held more sessions than the server accepts the
  // learner stores a run fine and is then silently refused by the API — the backup
  // stops without a word, which is what MAX_WPM above already guards against.
  const updatedSessions = [newSession, ...current.sessions].slice(0, MAX_SESSIONS);

  // Aggregates
  const totalWords = current.totalWordsTyped + params.wordsCount;
  const totalTime = current.totalTimeSpentSeconds + params.durationSeconds;
  const bestWpm = Math.max(current.bestWpm, params.wpm);

  // Rolling averages
  const totalAccSum = updatedSessions.reduce((acc, s) => acc + s.accuracy, 0);
  const totalWpmSum = updatedSessions.reduce((acc, s) => acc + s.wpm, 0);
  const averageAccuracy = Math.round(totalAccSum / updatedSessions.length);
  const averageWpm = Math.round(totalWpmSum / updatedSessions.length);

  const updatedStats: UserStats = {
    sessions: updatedSessions,
    dailyStreak: {
      currentStreak: newCurrentStreak,
      bestStreak: newBestStreak,
      lastActiveDate: today,
    },
    totalWordsTyped: totalWords,
    totalTimeSpentSeconds: totalTime,
    bestWpm,
    averageWpm,
    averageAccuracy,
  };

  saveUserStats(updatedStats);
  return updatedStats;
}

let memoryCache: UserStats = DEFAULT_STATS;
let isCacheInitialized = false;

function getStatsSnapshot(): UserStats {
  if (typeof window === 'undefined') return DEFAULT_STATS;
  if (!isCacheInitialized) {
    memoryCache = loadUserStats();
    isCacheInitialized = true;
  }
  return memoryCache;
}

export function clearUserStats(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    memoryCache = DEFAULT_STATS;
    window.dispatchEvent(new CustomEvent(STATS_CHANGE_EVENT, { detail: DEFAULT_STATS }));
  } catch {
    // Ignore
  }
  // Otherwise a reset leaves the full history sitting in the backup, which is the
  // opposite of what the button the learner just pressed promised.
  pushProgress(DEFAULT_STATS);
}

export function useUserStats(): UserStats {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => {};
      const handler = () => {
        memoryCache = loadUserStats();
        onStoreChange();
      };
      window.addEventListener(STATS_CHANGE_EVENT, handler);
      window.addEventListener('storage', handler);
      return () => {
        window.removeEventListener(STATS_CHANGE_EVENT, handler);
        window.removeEventListener('storage', handler);
      };
    },
    getStatsSnapshot,
    () => DEFAULT_STATS
  );
}
