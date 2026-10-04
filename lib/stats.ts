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
  bestAccuracy: 0,
};

/**
 * The best accuracy among a set of sessions, or 0 when there are none.
 *
 * The fallback for a record written before `bestAccuracy` existed. Deriving it beats
 * defaulting to 0, which is what every other sanitised field does: a learner whose only
 * perfect run is still inside their 100 keeps the badge they earned instead of losing it
 * the moment this version ships. Records whose perfect run has *already* aged out are the
 * ones 0 would be right for, and nothing here can tell those two apart — which is the
 * reason the badge has to be stored rather than reconstructed.
 */
function bestAccuracyOf(sessions: TypingSessionRecord[]): number {
  return sessions.reduce((best, session) => Math.max(best, session.accuracy), 0);
}

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

/**
 * How many words a finished run is worth: the ones the learner actually typed correctly.
 *
 * A run completes on character count alone — `handleKeyInput` finishes when
 * `typedText.length >= targetText.length`, with no correctness requirement, and
 * test/typingStore.test.ts pins that deliberately. What the run was then *paid* for was
 * not measured at all: the engine sent the passage's own word count with every finish, so
 * holding one key down to the end of a long article ended with 0% accuracy on screen and
 * the whole article added to `totalWordsTyped`. That total only ever grows and is never
 * recomputed from the sessions, so it can be lifted without typing anything correct — and
 * enough of it unlocks a badge that reads "Type over 1,000 words total".
 *
 * Measured on the longest correct prefix, which is what keeps this the *same* number for a
 * clean run and a repaired one: someone who mistyped, saw it and fixed it is credited for
 * the text they ended with, not penalised for the key they had to backspace over. A clean
 * run is unchanged — its correct prefix is the whole passage.
 */
export function wordsTyped(typedText: string, targetText: string): number {
  let correct = 0;
  while (
    correct < typedText.length &&
    correct < targetText.length &&
    typedText[correct] === targetText[correct]
  ) {
    correct += 1;
  }

  const prefix = targetText.slice(0, correct);
  const count = prefix.split(/\s+/).filter(Boolean).length;

  // A prefix that stops part-way through a word has not typed one yet, and `count` counts
  // that fragment. This can only happen where the run went wrong: a prefix that ends on a
  // word boundary, or that reaches the end of the passage, is whole words already.
  const endsMidWord =
    correct > 0 &&
    correct < targetText.length &&
    !/\s/.test(targetText[correct]) &&
    !/\s/.test(targetText[correct - 1]);

  return count - (endsMidWord ? 1 : 0);
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
 * The streak as of today, rather than as of the last finished passage.
 *
 * `currentStreak` is written once, when a passage completes, and
 * `recordCompletedSession` is the only thing that rewrites it. So the moment it stops
 * describing today it does not change again until the learner practises once more, and
 * both places that show it — the header pill, on every page, and the Streak card behind
 * it — were answering a question about now with a number about the past. A learner who
 * ran a five-day streak and then closed the tab for a fortnight still read `5d`.
 *
 * `lastActiveDate` is the other half of the same record and is what says which of those
 * two states applies, so this reads it rather than guessing. Yesterday counts: that is
 * the last day the streak can still be extended on, so it has not lapsed yet, and a
 * learner opening the app on the evening of day five has to still see five. Only the
 * day after does it read zero.
 *
 * The stored number is deliberately not rewritten. It is still correct as of the last
 * session, which is what `recordCompletedSession` needs in order to extend a streak
 * rather than restart it — a learner who practised yesterday and today must land on six
 * whether or not they opened the app in between. This is a reader: it derives a number
 * from the record and leaves the record alone.
 */
export function liveStreak(streak: UserStats['dailyStreak']): number {
  const last = streak.lastActiveDate;
  return last === getTodayDateString() || last === getYesterdayDateString()
    ? streak.currentStreak
    : 0;
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
 * why the note in lib/progress-client.ts — that a restored record is only safe to keep
 * because the function that stores it validates every field — held of the fields this
 * file knows and said nothing of the ones it does not. That note names `saveUserStats`
 * now. It once named `loadUserStats`, the read path, which would have put the guarantee
 * where only what is displayed passes through; quoting it is how this comment came to
 * cite a sentence the file no longer contains.
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
  // The one bound in this function the server also enforces, and the only one that was
  // missing: every session field above is capped to what `parseProgressBody` accepts,
  // but the count of the array itself was not, so a client holding more than the limit
  // kept holding it. `recordCompletedSession` trims on its own, so this only bites the
  // restore path — and there it is the whole difference between a backup that works
  // and one the API refuses with a 400, silently, forever.
  return sessions.slice(0, MAX_SESSIONS);
}

/**
 * Any object to the stats this app will actually use. Split out of `loadUserStats` so
 * the write path shares it: sanitising on read is only a guarantee about what is
 * *displayed*, and `saveUserStats` is what decides what is *kept* and what is uploaded.
 */
function sanitiseUserStats(parsed: unknown): UserStats {
  const value = (parsed ?? {}) as Partial<UserStats>;
  const streak: Partial<UserStats['dailyStreak']> = value.dailyStreak || {};
  // Hoisted because `bestAccuracy` falls back to what these hold: the sessions are
  // sanitised once and both fields read the one result.
  const sessions = sanitizeSessions(value.sessions);
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
    sessions,
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
    // The one field whose fallback is not 0, because 0 here would quietly take a badge
    // away from someone who still has the run that earned it in the list below.
    bestAccuracy: num(value.bestAccuracy, bestAccuracyOf(sessions), isPercent),
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

/**
 * Store `stats`, and say whether it was stored.
 *
 * The boolean is what the restore path needs and did not have. `restore` in
 * components/stats/StatsModal.tsx tells the learner their progress came back, and that
 * sentence is only true when this wrote. A browser refusing the write — a quota, storage
 * turned off, Safari's private mode — used to reach nothing: `setItem` threw, the catch
 * swallowed it, and the panel said "Restored." anyway, leaving the pre-restore copy in
 * place under a claim that it had been replaced.
 *
 * Returns false, and does not upload, when the local write is refused. Skipping the
 * upload is what makes "nothing changed" true: `pushProgress` used to run either way, so
 * the server took the restored record while the device kept the old one, and the two
 * disagreed with the panel siding with neither. A failed save is now a failed save on
 * both sides, and the caller is free to say so.
 *
 * `upload` is false for exactly one caller, and it is the one that gets the record from
 * the server rather than making a new one. Restore fetches the record off `WANTED` and
 * then switches the device to `WANTED`, so the code it is about to adopt already holds
 * exactly what is being stored — and any upload in between is not that. It goes to
 * whichever code is live at the time, which is the *old* one, overwriting on the server
 * the copy of the learner's own history that the restore's own confirmation promised to
 * keep. A whole-record PUT, so it is not an addition: it is the only copy, gone.
 */
export function saveUserStats(stats: UserStats, upload = true): boolean {
  if (typeof window === 'undefined') return false;
  // Sanitised on the way out as well as in. The restore path is the one caller that
  // passes a record this app did not build — fetchBackup reads it off a response body
  // with a cast, and documents it as unsanitised — and this function is what turns it
  // into stored bytes and an uploaded body. Anything it did not strip was being kept
  // and re-pushed, which is the opposite of what the read path promises.
  const clean = sanitiseUserStats(stats);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    // The cache `getStatsSnapshot` serves, updated here because this is where every write
    // in the app ends up. It was not: the event below reached live subscribers, but the
    // cache only followed when `clearUserStats` ran or a snapshot listener was mounted,
    // and `StatsModal` is mounted only while it is open. So a learner who opened the
    // panel, closed it, finished two passages and opened it again was shown the panel as
    // it stood the first time — old sessions, old volume, old badges, no indication any
    // of it was stale.
    //
    // Inside the try, so a quota failure leaves the cache describing what is still
    // stored rather than something that failed to be.
    memoryCache = clean;
    window.dispatchEvent(new CustomEvent(STATS_CHANGE_EVENT, { detail: clean }));
  } catch {
    // Storage quota errors, and storage being switched off entirely. Nothing was stored,
    // so nothing is uploaded either — see the note above.
    return false;
  }
  // Every local write is also a backup write, so a session that was never uploaded
  // cannot exist. No-op unless the learner turned a backup on — and skipped outright by
  // restore, which read the record off the code it is about to adopt and so has nothing
  // to send it.
  if (upload) pushProgress(clean);
  return true;
}

export function recordCompletedSession(params: {
  title: string;
  sourceType: SourceType;
  wpm: number;
  accuracy: number;
  durationSeconds: number;
  wordsCount: number;
  keystrokes: number;
}): boolean {
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
  // Lifetime, for the same reason `bestWpm` is: one perfect run is a thing that happened,
  // and the window below is about what to show, not about what is true.
  const bestAccuracy = Math.max(current.bestAccuracy, params.accuracy);

  // Rolling averages
  const totalAccSum = updatedSessions.reduce((acc, s) => acc + s.accuracy, 0);
  const totalWpmSum = updatedSessions.reduce((acc, s) => acc + s.wpm, 0);
  // Floored for the same reason TypingEngine floors the individual run: an average that
  // rounds up reads 100% while a session in the window was not perfect. Two runs of 100 and
  // 99 average to 99.5, and `Math.round` sent that to 100 — the same false claim as the row
  // it sits above, on the figure a learner is likeliest to quote. It is also the reason the
  // floor costs nothing here: the members are already floored, so the mean reaches 99.5
  // only when a run was imperfect, and reaches 100 only when every one of them was not.
  const averageAccuracy = Math.floor(totalAccSum / updatedSessions.length);
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
    bestAccuracy,
  };

  // Whether it was kept, rather than the stats themselves — `saveUserStats` already
  // answers that and the answer was being dropped on the floor here. The one caller in
  // the app discarded this return entirely, so a run the browser refused to store was
  // announced as a finished one and counted by nobody: not in the history, not toward
  // the streak, not in the backup, and nothing on screen said so. The restore path in
  // StatsModal checks this same value and tells the learner plainly.
  return saveUserStats(updatedStats);
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
    // Nothing was removed, so nothing may be uploaded as though it had been.
    //
    // The upload used to sit outside this try and ran either way, which is the one
    // shape none of the other storage writers in this codebase has: `saveUserStats`
    // returns false and skips its push on a refused `setItem` — a failed save is a
    // failed save on both sides — and `enableBackup`, `adoptBackupCode` and
    // `disableBackup` all report a refused write rather than carrying on past it.
    //
    // Carrying on past it here split the button in two. `memoryCache` was left alone
    // and no event fired, so the panel went on showing the entire history, while the
    // PUT that followed overwrote the server record with `DEFAULT_STATS` — a push is a
    // whole-record overwrite, so the one copy that survives a cleared browser, the
    // reason the backup exists, was gone. The learner confirmed a reset, watched
    // nothing happen, and had no way to tell.
    return;
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
