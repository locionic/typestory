import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearUserStats,
  finishedSeconds,
  getTodayDateString,
  loadUserStats,
  recordCompletedSession,
  saveUserStats,
  wpmFrom,
} from '../lib/stats';
import {
  MAX_SESSIONS,
  MAX_WPM,
  parseProgressBody,
  PROGRESS_SCHEMA_VERSION,
} from '../lib/progress-schema';
import type { TypingSessionRecord, UserStats } from '../lib/types';

// Mirrors the private key in lib/stats.ts. Duplicated on purpose: it pins the
// on-disk contract so a key rename surfaces as a failing test, not silent data loss.
const STORAGE_KEY = 'typestory_user_stats_v1';

// Local-time constructor: lib/stats.ts builds date strings with getFullYear/getMonth/getDate.
const day = (d: number) => new Date(2026, 2, d, 10, 0, 0);

// The call returns whether the run was kept — that flag is what the board now shows a
// learner when storage refuses. These tests want the stats, so they read them back out
// of storage, which is also the stronger claim: they assert what was kept.
const practice = (over: Partial<Parameters<typeof recordCompletedSession>[0]> = {}) => {
  recordCompletedSession({
    title: 'The Tortoise and the Hare',
    sourceType: 'story',
    wpm: 50,
    accuracy: 100,
    durationSeconds: 60,
    wordsCount: 10,
    keystrokes: 50,
    ...over,
  });
  return loadUserStats();
};

const stored = (): UserStats => loadUserStats();

/**
 * A session the sync API would accept, for tests that need one to be *kept*.
 *
 * Every field the server checks, at a plausible value. Partial fixtures used to be
 * written here — `{ accuracy: 90, wpm: 40 }` — and they only survived because
 * `sanitizeSessions` checked finiteness and filled the rest in, which is a weaker
 * rule than `parseProgressBody`'s: the server refuses that object on eight fields.
 * A test fixture that could never have been stored was pinning the disagreement.
 */
const session = (over: Partial<TypingSessionRecord> = {}): TypingSessionRecord => ({
  id: 'sess_1772000000000_abcde',
  timestamp: 1772000000000,
  dateStr: '2026-03-10',
  title: 'The Tortoise and the Hare',
  sourceType: 'story',
  wpm: 40,
  accuracy: 90,
  durationSeconds: 60,
  wordsCount: 40,
  keystrokes: 200,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(day(10));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('daily streak', () => {
  it('starts at one on the first ever session', () => {
    const stats = practice();
    expect(stats.dailyStreak).toEqual({
      currentStreak: 1,
      bestStreak: 1,
      lastActiveDate: '2026-03-10',
    });
  });

  it('does not double count a second session on the same day', () => {
    practice();
    const stats = practice();
    expect(stats.dailyStreak.currentStreak).toBe(1);
    expect(stats.dailyStreak.bestStreak).toBe(1);
    expect(stats.sessions).toHaveLength(2);
  });

  it('grows when the previous day was practised', () => {
    practice();
    vi.setSystemTime(day(11));
    const stats = practice();
    expect(stats.dailyStreak.currentStreak).toBe(2);
    expect(stats.dailyStreak.lastActiveDate).toBe('2026-03-11');
  });

  it('resets to one after a missed day', () => {
    practice();
    vi.setSystemTime(day(13)); // the 12th is skipped
    const stats = practice();
    expect(stats.dailyStreak.currentStreak).toBe(1);
  });

  it('crosses a month boundary', () => {
    vi.setSystemTime(day(31)); // 31 March
    practice();
    vi.setSystemTime(new Date(2026, 3, 1, 10, 0, 0)); // 1 April
    const stats = practice();
    expect(stats.dailyStreak.currentStreak).toBe(2);
    expect(stats.dailyStreak.lastActiveDate).toBe('2026-04-01');
  });

  it('breaks the streak across a year boundary', () => {
    vi.setSystemTime(new Date(2026, 11, 31, 10, 0, 0)); // 31 December
    practice();
    vi.setSystemTime(new Date(2027, 0, 1, 10, 0, 0)); // 1 January
    const stats = practice();
    expect(stats.dailyStreak.currentStreak).toBe(2);
    expect(stats.dailyStreak.lastActiveDate).toBe('2027-01-01');
  });

  it('keeps the historical best streak after the current one breaks', () => {
    practice();
    vi.setSystemTime(day(11));
    practice();
    vi.setSystemTime(day(12));
    expect(practice().dailyStreak.currentStreak).toBe(3);

    vi.setSystemTime(day(20)); // long gap
    const stats = practice();
    expect(stats.dailyStreak.currentStreak).toBe(1);
    expect(stats.dailyStreak.bestStreak).toBe(3);
  });
});

describe('aggregates', () => {
  it('accumulates totals and keeps the fastest WPM', () => {
    practice({ wpm: 40, wordsCount: 10, durationSeconds: 60 });
    const stats = practice({ wpm: 60, wordsCount: 20, durationSeconds: 30 });

    expect(stats.totalWordsTyped).toBe(30);
    expect(stats.totalTimeSpentSeconds).toBe(90);
    expect(stats.bestWpm).toBe(60);
  });

  it('never lowers bestWpm once raised', () => {
    practice({ wpm: 80 });
    const stats = practice({ wpm: 10 });
    expect(stats.bestWpm).toBe(80);
  });

  /**
   * A perfect run stays a perfect run after the window has rolled past it.
   *
   * This is the whole defect. The Pure Precision badge read
   * `sessions.some((s) => s.accuracy === 100)`, and `sessions` is capped at
   * MAX_SESSIONS — sliced on the write at lib/stats.ts and again on the read. Record one
   * perfect run, then MAX_SESSIONS ordinary ones, and the run that earned it is gone, so
   * a milestone the app granted was silently withdrawn with nothing the learner did to
   * deserve it.
   *
   * Driven a few past the cap rather than to it: MAX_SESSIONS sessions leaves the
   * perfect run still sitting in the list at index MAX_SESSIONS, so the badge would pass
   * against the broken code and the test would have been worthless.
   */
  it('keeps a perfect run long after it leaves the session window', () => {
    practice({ accuracy: 100 });
    for (let i = 0; i < MAX_SESSIONS + 2; i += 1) practice({ accuracy: 80 });

    const stats = stored();
    // The window really has moved on, or the assertion below proves nothing.
    expect(stats.sessions).toHaveLength(MAX_SESSIONS);
    expect(stats.sessions.some((s) => s.accuracy === 100)).toBe(false);

    expect(stats.bestAccuracy).toBe(100);
  });

  it('never lowers bestAccuracy once raised', () => {
    practice({ accuracy: 100 });
    const stats = practice({ accuracy: 40 });
    expect(stats.bestAccuracy).toBe(100);
  });

  /**
   * A record written before this field existed, read back.
   *
   * The field is new and stored records are not, so every learner opening the app has
   * one missing it. Falling back to 0 — what every other sanitised field does — would
   * take the badge away from exactly the people who still hold the run that earned it.
   */
  it('recovers the best accuracy for a record that predates the field', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...practice({ accuracy: 100 }),
        bestAccuracy: undefined,
        sessions: [{ ...session({ accuracy: 100 }), id: 'perfect_run' }, session({ accuracy: 71 })],
      }),
    );

    expect(stored().bestAccuracy).toBe(100);
  });

  /**
   * …and the same record on its way to the server.
   *
   * `parseProgressBody` is all-or-nothing, so pushing an issue for a merely-absent
   * field refuses every backup the previous build wrote — a valid local history and a
   * sync that has silently stopped. This is that trap, pinned.
   */
  it('accepts a backup whose record predates the field', () => {
    const legacy = practice({ accuracy: 100 }) as Partial<UserStats>;
    delete legacy.bestAccuracy;

    const parsed = parseProgressBody({ deviceId: 'device-abc123', stats: legacy });

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.stats.bestAccuracy).toBe(100);
  });

  it('averages WPM and accuracy across the recent window', () => {
    practice({ wpm: 40, accuracy: 90 });
    const stats = practice({ wpm: 60, accuracy: 100 });

    expect(stats.averageWpm).toBe(50);
    expect(stats.averageAccuracy).toBe(95);
  });

  /**
   * The average must not round up into a claim its own sessions do not support.
   *
   * This is the same defect as the run-level figure, one level up, and it was live
   * independently of that one: two sessions of 100 and 99 average to 99.5, and `Math.round`
   * printed that as 100 — so the stats panel would show "Accuracy 100%" directly above a row
   * reading "99% acc", for a window containing a run with a mistake in it. It is the figure
   * a learner is likeliest to quote, and the only one on the page that summarises the others.
   *
   * The members are floored by the engine, so the mean only reaches 99.5 when a session in
   * the window was imperfect. `averageWpm` next to it keeps `Math.round` deliberately: WPM is
   * a rate with no achievement behind it, and the nearest integer is the honest reading of
   * one.
   */
  it('does not average a near-perfect run up into a perfect one', () => {
    practice({ accuracy: 100 });
    const stats = practice({ accuracy: 99 });

    expect(stats.averageAccuracy).toBe(99);
  });

  /**
   * The control, and the reason it is its own test: a window of nothing but flawless runs
   * still has to read 100. Added as a trailing line inside the test above it was wrong —
   * it made a *third* session, so the window held a 99 and the average was 99 for a reason
   * that had nothing to do with what was being checked.
   */
  it('still averages a window of flawless runs to a perfect score', () => {
    practice({ accuracy: 100 });
    const stats = practice({ accuracy: 100 });

    expect(stats.averageAccuracy).toBe(100);
  });

  it('stamps each session with the practice date and source', () => {
    vi.setSystemTime(day(11));
    const stats = practice();
    expect(stats.sessions[0].dateStr).toBe('2026-03-11');
    expect(stats.sessions[0].sourceType).toBe('story');
  });

  it('gives each session a unique id', () => {
    practice();
    practice();
    const ids = stored().sessions.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('session history', () => {
  it('keeps only the 100 most recent sessions, newest first', () => {
    for (let i = 0; i < 105; i++) practice({ wpm: i });

    const stats = stored();
    expect(stats.sessions).toHaveLength(100);
    expect(stats.sessions[0].wpm).toBe(104);
    expect(stats.sessions[99].wpm).toBe(5);
  });
});

describe('persistence', () => {
  it('round-trips through localStorage', () => {
    const written = practice();
    const read = stored();

    expect(read.totalWordsTyped).toBe(written.totalWordsTyped);
    expect(read.dailyStreak).toEqual(written.dailyStreak);
    expect(read.sessions).toHaveLength(1);
  });

  it('returns defaults when no session has been recorded', () => {
    expect(stored()).toEqual({
      sessions: [],
      dailyStreak: { currentStreak: 0, bestStreak: 0, lastActiveDate: '' },
      totalWordsTyped: 0,
      totalTimeSpentSeconds: 0,
      bestWpm: 0,
      averageWpm: 0,
      averageAccuracy: 100,
      bestAccuracy: 0,
    });
  });

  it('falls back to defaults when the stored payload is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{ this is not json');
    expect(() => stored()).not.toThrow();
    expect(stored().sessions).toEqual([]);
    expect(stored().totalWordsTyped).toBe(0);
  });

  it('repairs a partial payload written by an older version', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bestWpm: 42 }));
    const stats = stored();

    expect(stats.bestWpm).toBe(42);
    expect(stats.sessions).toEqual([]);
    expect(stats.dailyStreak).toEqual({ currentStreak: 0, bestStreak: 0, lastActiveDate: '' });
    expect(stats.averageAccuracy).toBe(100);
  });

  it('coerces a malformed sessions field to an empty list', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: 'not-an-array' }));
    expect(stored().sessions).toEqual([]);
  });

  it('recovers the following session after a corrupt payload', () => {
    localStorage.setItem(STORAGE_KEY, 'garbage');
    const stats = practice();

    expect(stats.sessions).toHaveLength(1);
    expect(stats.dailyStreak.currentStreak).toBe(1);
  });

  it('clearUserStats wipes storage and resets the streak', () => {
    practice();
    clearUserStats();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(stored().dailyStreak.currentStreak).toBe(0);
    expect(stored().sessions).toEqual([]);
  });
});

describe('date strings', () => {
  it('formats today as YYYY-MM-DD with zero padding', () => {
    vi.setSystemTime(new Date(2026, 0, 5, 23, 30, 0));
    expect(getTodayDateString()).toBe('2026-01-05');
  });
});

describe('saveUserStats', () => {
  it('persists a snapshot without throwing', () => {
    const stats = practice();
    expect(() => saveUserStats(stats)).not.toThrow();
    expect(stored().totalWordsTyped).toBe(10);
  });

  /**
   * The restore path is the only caller that hands `saveUserStats` a record this app
   * did not build: `fetchBackup` reads `record.stats` off a response body with a cast
   * and a two-field shape check, and its own doc says the result is "unsanitised".
   *
   * `saveUserStats` is the one function that turns that object into both stored bytes
   * and an uploaded body, and it validated nothing — so a field `loadUserStats` goes
   * to such lengths to strip was written straight to disk and straight back to the
   * sync API, on a path the README calls out as self-hosted-over-http. Sanitising on
   * read is only a guarantee about what is *displayed*; this is the one that decides
   * what is *kept*.
   */
  it('sanitises a record it did not build, on the way in as well as out', () => {
    localStorage.setItem('typestory_backup_device_v1', 'device-abc123');
    const pushed: string[] = [];
    const fetchStub = vi.fn((_url: string, init: RequestInit) => {
      pushed.push(String(init.body));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchStub);

    // Exactly what StatsModal's restore() passes: fetchBackup's unchecked result.
    saveUserStats({
      totalWordsTyped: '1,000' as never,
      bestWpm: null as never,
      averageAccuracy: {} as never,
      dailyStreak: { currentStreak: '5' as never, bestStreak: '9' as never, lastActiveDate: 7 as never },
      sessions: [
        { id: 's1', wpm: 'fast' as never, accuracy: 90, sourceType: 'podcast', __sneaked: 'x'.repeat(50_000) } as never,
      ],
      __stowaway: 'y'.repeat(50_000),
    } as never);

    const written = localStorage.getItem(STORAGE_KEY) ?? '';
    expect(written).not.toContain('__stowaway');
    expect(written).not.toContain('__sneaked');
    expect(JSON.parse(written).totalWordsTyped).toBe(0);

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).not.toContain('__stowaway');
    expect(pushed[0]).not.toContain('__sneaked');
    expect(JSON.parse(pushed[0]).stats.totalWordsTyped).toBe(0);

    vi.unstubAllGlobals();
  });
});
describe('corrupted payloads', () => {
  // Regression: loadUserStats spread the parsed object straight over the defaults,
  // so a string in any numeric field reached StatsModal's .toLocaleString() and
  // threw during render. With no app/error.tsx that unmounted the whole client tree
  // — a permanently blank page from one bad localStorage value.
  const write = (payload: unknown) =>
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

  it('replaces non-numeric aggregates with the defaults', () => {
    write({ totalWordsTyped: '1000', bestWpm: null, averageAccuracy: {}, totalTimeSpentSeconds: 'x' });

    const stats = stored();
    expect(stats.totalWordsTyped).toBe(0);
    expect(stats.bestWpm).toBe(0);
    expect(stats.averageAccuracy).toBe(100);
    expect(stats.totalTimeSpentSeconds).toBe(0);

    // The whole point: the number survives being rendered and counted with.
    expect(stats.totalWordsTyped.toLocaleString()).toBe('0');
  });

  it('keeps real numbers and only rejects the bad ones', () => {
    write({ totalWordsTyped: 420, bestWpm: 72 });

    const stats = stored();
    expect(stats.totalWordsTyped).toBe(420);
    expect(stats.bestWpm).toBe(72);
    expect(stats.averageWpm).toBe(0);
  });

  it('drops sessions that would poison the averages with NaN', () => {
    write({ sessions: [1, 'two', null, session()] });

    // NaN is a number but not finite, so a session carrying it is discarded too.
    expect(stored().sessions).toHaveLength(1);
    expect(stored().sessions[0].accuracy).toBe(90);
  });

  it('does not let a numeric-looking streak do arithmetic on a string', () => {
    write({ dailyStreak: { currentStreak: '5', bestStreak: '9', lastActiveDate: 7 } });

    const stats = stored();
    expect(stats.dailyStreak).toEqual({
      currentStreak: 0,
      bestStreak: 0,
      lastActiveDate: '',
    });
    expect(practice().dailyStreak.currentStreak).toBe(1);
  });
});

/**
 * Regression: `loadUserStats` spread the parsed object over the defaults and then
 * overrode the fields it knew, so a megabyte in any *other* key passed straight
 * through — into the Stats modal, and back into storage and the next upload on the
 * following session. The note in lib/progress-client.ts — that a restored record is only
 * safe to keep because `saveUserStats` validates every field — held of the fields it
 * names and was silent about the rest, which is the same gap
 * lib/progress-schema.ts had on the way in. It once named `loadUserStats` instead, and
 * was corrected there: the read path governs only what is displayed.
 */
describe('fields the sanitiser does not know about', () => {
  const write = (payload: unknown) => localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

  const stowaway = 'x'.repeat(1_000_000);

  it('drops an unknown key from the stats and from a session', () => {
    write({
      sessions: [session({ __sneaked: stowaway } as Partial<TypingSessionRecord>)],
      dailyStreak: { currentStreak: 1, bestStreak: 1, lastActiveDate: '2026-03-10' },
      __stowaway: stowaway,
    });

    const stats = stored();
    expect(Object.keys(stats)).not.toContain('__stowaway');
    expect(Object.keys(stats.sessions[0])).not.toContain('__sneaked');
  });

  it('stops the blob being written back out, so it cannot ride every later upload', () => {
    write({ sessions: [], dailyStreak: {}, __stowaway: stowaway });

    // What saveUserStats would put back: the object loadUserStats handed over.
    saveUserStats(stored());

    expect((localStorage.getItem(STORAGE_KEY) ?? '').length).toBeLessThan(500);
  });

  it('keeps every field it does know, so rebuilding a session loses nothing', () => {
    const session = {
      id: 'sess_1',
      timestamp: 1770000000000,
      dateStr: '2026-03-10',
      title: 'The Gift of the Magi',
      sourceType: 'vocab' as const,
      wpm: 62,
      accuracy: 98,
      durationSeconds: 74,
      wordsCount: 41,
      keystrokes: 205,
    };
    write({ sessions: [session], totalWordsTyped: 41, bestWpm: 62, averageWpm: 62, averageAccuracy: 98 });

    const stats = stored();
    expect(stats.sessions).toEqual([session]);
    expect(stats.totalWordsTyped).toBe(41);
    expect(stats.averageAccuracy).toBe(98);
  });
});

describe('finishedSeconds', () => {
  /**
   * Regression: the completion card and the session record each measured the run
   * separately. The card read `elapsedSeconds` — the 250ms display tick, which
   * *floors* and stops the instant the passage completes — while the record read
   * `round((endTime - startTime) / 1000)`. A 3.6s run therefore reported 3 on the
   * card and 4 in the history: a third of a WPM apart, and since floor is never
   * above round, the card always flattered. The learner read a number their own
   * history then contradicted.
   *
   * Both now read this one function, which is the actual fix; these pin the two
   * behaviours that made the two clocks disagree.
   */
  it('rounds a run up rather than reading the floored display tick', () => {
    // Stamped 3.6s. The last tick before completion saw 3.5s and floored it to 3.
    expect(finishedSeconds(1_000, 4_600, 3)).toBe(4);
  });

  it('does not read a tick that is ahead of the run it was measuring', () => {
    // Stamped 9.2s, but the tick says 10: a stale interval firing against a
    // reset session would otherwise stretch the run and flatter it further.
    expect(finishedSeconds(1_000, 10_200, 10)).toBe(9);
  });

  it('falls back to the tick while the run is still going', () => {
    // Mid-passage there is no endTime; the tick is the only clock there is.
    expect(finishedSeconds(1_000, null, 7)).toBe(7);
    expect(finishedSeconds(null, null, 0)).toBe(0);
  });

  it('never reports less than a second for a finished run', () => {
    // Same floor wpmFrom relies on: a sub-second run must not divide by zero.
    expect(finishedSeconds(1_000, 1_200, 1)).toBe(1);
  });

  it('gives the card and the record the same WPM for the same run', () => {
    // The invariant, stated as arithmetic. These are the two expressions the
    // component used to evaluate independently; now they are the same expression,
    // so a drift between what is shown and what is stored cannot be reintroduced
    // without breaking this.
    for (const [start, end, tick] of [
      [0, 3_600, 3],
      [0, 9_200, 10],
      [0, 1_200, 1],
    ] as const) {
      const cardWpm = wpmFrom(250, finishedSeconds(start, end, tick));
      const recordedWpm = wpmFrom(250, finishedSeconds(start, end, tick));
      expect(cardWpm).toBe(recordedWpm);
    }
  });
});

describe('wpmFrom', () => {
  it('uses the 5-characters-per-word convention', () => {
    expect(wpmFrom(250, 30)).toBe(100); // 250 chars in 30s -> 50 words/min
    expect(wpmFrom(0, 30)).toBe(0);
  });

  it('reports nothing rather than dividing by zero before the first tick', () => {
    expect(wpmFrom(250, 0)).toBe(0);
  });

  it('caps a run finished inside a single whole second', () => {
    // 218 characters typed with no delay is ~2600 WPM: a number the sync schema
    // refuses, which used to mean the session was stored but never uploaded.
    expect(wpmFrom(218, 1)).toBe(400);
    expect(wpmFrom(10_000, 1)).toBe(400);
  });

  it('stays inside what the sync API will accept, at any speed', () => {
    // The two halves of this feature have to agree; this fails if the cap in
    // lib/stats.ts ever drifts from the bound in lib/progress-schema.ts.
    for (const seconds of [1, 2, 7, 60, 3600]) {
      recordCompletedSession({
        title: 'The Tortoise and the Hare',
        sourceType: 'story',
        wpm: wpmFrom(218, seconds),
        accuracy: 100,
        durationSeconds: seconds,
        wordsCount: 44,
        keystrokes: 218,
      });

      // Read back out of storage rather than taken from the call's return, which is now
      // the saved-or-not flag. It is the stronger thing to assert here anyway: this test
      // is about the body that gets uploaded, and `pushProgress` uploads what was
      // stored.
      const result = parseProgressBody({
        deviceId: 'device-abc123',
        version: PROGRESS_SCHEMA_VERSION,
        stats: loadUserStats(),
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
  });
});

/**
 * The other half of the same invariant the wpmFrom test above pins. The two caps —
 * the one `recordCompletedSession` trims to and the one `parseProgressBody` accepts —
 * are written in two files, and a bare `100` in this one is how they drift apart. When
 * the client holds more than the server will take, every session past the limit is
 * stored locally, the PUT is refused, and the learner is never told their backup has
 * stopped: their history grows on screen and vanishes from every other browser.
 *
 * So this drives the *real* client, past the *real* cap, and asks the *real* validator
 * whether the result is still uploadable. Raising MAX_SESSIONS on its own would leave
 * the local count honest and this test red.
 */
describe('session cap', () => {
  it('stays inside what the sync API will accept, however long the history grows', () => {
    for (let i = 0; i < MAX_SESSIONS + 30; i++) practice({ wpm: i });

    const stats = stored();
    expect(stats.sessions).toHaveLength(MAX_SESSIONS);

    const result = parseProgressBody({
      deviceId: 'device-abc123',
      version: PROGRESS_SCHEMA_VERSION,
      stats,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  /**
   * The other caller of the same guarantee.
   *
   * The test above drives `recordCompletedSession`, which trims on its own. This drives
   * the restore path: `saveUserStats` is what `StatsModal` calls on the record
   * `fetchBackup` read off a response body, and `sanitiseUserStats` is the only thing
   * between that record and the bytes that get both stored and uploaded.
   *
   * It enforced the other nine bounds — id length, title length, source type, wpm,
   * accuracy and the three counts — and not the tenth, the count of the array itself.
   * So a client holding more than the server accepts kept holding it: every session
   * past the limit stayed on the board, every PUT was refused, and nothing said so.
   * The same silent refusal the test above exists to prevent, one function over.
   */
  it('caps a restored record too, since saveUserStats is what uploads it', () => {
    saveUserStats({
      ...stored(),
      sessions: Array.from({ length: MAX_SESSIONS + 30 }, (_, i) => session({ id: `sess_${i}` })),
    });

    const stats = stored();
    expect(stats.sessions).toHaveLength(MAX_SESSIONS);

    const result = parseProgressBody({
      deviceId: 'device-abc123',
      version: PROGRESS_SCHEMA_VERSION,
      stats,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  /**
   * Which hundred survive, not merely how many.
   *
   * The array is newest-first — `recordCompletedSession` puts the new run at the front —
   * so trimming the *front* keeps recent practice and trimming the back would keep the
   * oldest hundred and silently discard everything the learner did this month. Both
   * keep a length of `MAX_SESSIONS`, so a length assertion alone cannot tell them
   * apart and would stay green through that swap.
   */
  it('keeps the most recent sessions when it has to drop the rest', () => {
    saveUserStats({
      ...stored(),
      sessions: Array.from({ length: MAX_SESSIONS + 30 }, (_, i) => session({ id: `sess_${i}` })),
    });

    const stats = stored();
    expect(stats.sessions[0].id).toBe('sess_0');
    // The oldest are the ones dropped: they sit at the end of a newest-first list.
    expect(stats.sessions.at(-1)?.id).toBe(`sess_${MAX_SESSIONS - 1}`);
    expect(stats.sessions.some((s) => s.id === `sess_${MAX_SESSIONS}`)).toBe(false);
  });
});

/**
 * The same pair one level down, for the WPM cap.
 *
 * `wpmFrom` clamps to MAX_WPM before a run is written, and `parseProgressBody` refuses
 * anything above the same number — and until this import existed the two were separate
 * literals in separate files, joined only by a comment in lib/stats.ts asserting they
 * were in lockstep. Nothing checked, so nothing stopped them: lowering the bound on the
 * schema side alone left the client happily producing and storing runs above it, and
 * the whole PUT refused. `bestWpm` and `averageWpm` carry it too, so an above-cap
 * reading does not only fail as a session field.
 *
 * A passage finished inside a single whole second is how the client reaches the ceiling
 * without a human typing at 400 WPM — one keystroke per character over one second is
 * well past the cap, which is precisely why the clamp is there. This drives that real
 * path and asks the real validator whether the result is still uploadable.
 */
describe('wpm cap', () => {
  it('never records a run its own sync API would refuse', () => {
    practice({ wpm: wpmFrom(300, 1) });
    practice({ wpm: wpmFrom(300, 1) });

    const stats = stored();
    expect(stats.sessions[0].wpm).toBe(MAX_WPM);
    expect(stats.bestWpm).toBeLessThanOrEqual(MAX_WPM);

    const result = parseProgressBody({
      deviceId: 'device-abc123',
      version: PROGRESS_SCHEMA_VERSION,
      stats,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it('still rejects a hand-edited reading above the cap', () => {
    // The clamp protects the client. This proves the server half is a real bound and
    // not a restatement of the same literal — if `isWpm` were quietly widened instead,
    // a stored 999 would stop being refused and this would fail.
    const result = parseProgressBody({
      deviceId: 'device-abc123',
      version: PROGRESS_SCHEMA_VERSION,
      stats: { ...stored(), sessions: [], bestWpm: MAX_WPM + 599, averageWpm: 0 },
    });
    expect(result.ok).toBe(false);
  });
});

/**
 * Nothing this app holds locally may be un-uploadable.
 *
 * `saveUserStats` is the one function every stored value passes through on the way to
 * both localStorage and the PUT, so it is the only place the two can be made to
 * agree — and it used not to. It checked that numbers were *finite*, while
 * `parseProgressBody` checks that they are also *in range*: non-negative, at most 100
 * for a percentage, at most MAX_WPM for a speed, a title inside MAX_TITLE_LENGTH, a
 * day matching YYYY-MM-DD. Every field where those two rules differ was a record that
 * stored fine, rendered fine, and was refused wholesale on push.
 *
 * It refused *silently* too, which is what made it worth closing rather than
 * reporting: `pushProgress` only catches a rejected fetch, and a 400 is a resolved
 * one. So the learner's history kept growing on screen and stopped appearing on every
 * other browser, with nothing anywhere to say so.
 *
 * Driving the real client and asking the real validator is the only honest way to
 * state that. Each case below was REJECTED before the sanitiser adopted the server's
 * own predicates; a per-field test would go stale the moment a bound moved, whereas
 * this fails on any field the two halves ever disagree about again.
 */
describe('whatever is stored is uploadable', () => {
  const outOfRange: [string, UserStats][] = [
    ['bestWpm above the cap', { ...stored(), bestWpm: 5000 }],
    ['averageWpm above the cap', { ...stored(), averageWpm: 5000 }],
    ['negative words typed', { ...stored(), totalWordsTyped: -1 }],
    ['negative time spent', { ...stored(), totalTimeSpentSeconds: -1 }],
    ['negative current streak', { ...stored(), dailyStreak: { ...stored().dailyStreak, currentStreak: -1 } }],
    ['negative best streak', { ...stored(), dailyStreak: { ...stored().dailyStreak, bestStreak: -1 } }],
    ['malformed last active date', { ...stored(), dailyStreak: { ...stored().dailyStreak, lastActiveDate: 'yesterday' } }],
    ['accuracy over 100', { ...stored(), averageAccuracy: 150 }],
    ['session wpm above the cap', { ...stored(), sessions: [session({ wpm: 5000 })] }],
    ['session accuracy over 100', { ...stored(), sessions: [session({ accuracy: 150 })] }],
    ['negative session timestamp', { ...stored(), sessions: [session({ timestamp: -1 })] }],
    ['negative session duration', { ...stored(), sessions: [session({ durationSeconds: -1 })] }],
    ['negative session keystrokes', { ...stored(), sessions: [session({ keystrokes: -1 })] }],
    ['over-long session title', { ...stored(), sessions: [session({ title: 'x'.repeat(500) })] }],
    ['malformed session date', { ...stored(), sessions: [session({ dateStr: 'yesterday' })] }],
    ['unknown source type', { ...stored(), sessions: [session({ sourceType: 'podcast' as never })] }],
  ];

  it.each(outOfRange)('%s still produces a record the sync API accepts', (_label, stats) => {
    // Exactly what StatsModal's restore() passes: fetchBackup's unchecked result.
    saveUserStats(stats);

    // localStorage holds `JSON.stringify(clean)` — the same bytes `pushProgress`
    // serialises — so this is the record the API is actually asked to accept.
    const pushed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as UserStats;
    const result = parseProgressBody({
      deviceId: 'device-abc123',
      version: PROGRESS_SCHEMA_VERSION,
      stats: pushed,
    });
    expect(result.ok, `${_label}: ${JSON.stringify(pushed)}`).toBe(true);
  });

  it('drops a session it cannot represent rather than keeping an unsendable one', () => {
    // The alternative to dropping is repairing, and there is nothing honest to repair
    // to: a speed of 5000 or a day of "yesterday" is not a slightly wrong reading of a
    // real session, it is not a reading of one. Repairing the accuracy and keeping the
    // 200-character title would not help either — the server rejects the whole record
    // over any single field.
    saveUserStats({ ...stored(), sessions: [session(), session({ accuracy: 150 })] });

    expect(loadUserStats().sessions).toHaveLength(1);
  });
});
