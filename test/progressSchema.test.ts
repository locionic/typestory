import { describe, expect, it } from 'vitest';
import {
  DEVICE_ID_PATTERN,
  MAX_SESSIONS,
  MAX_TITLE_LENGTH,
  PROGRESS_SCHEMA_VERSION,
  isValidDeviceId,
  parseProgressBody,
} from '../lib/progress-schema';
import type { UserStats } from '../lib/types';

const NOW = new Date('2026-03-10T12:00:00.000Z');

const stats = (over: Partial<UserStats> = {}): UserStats => ({
  sessions: [
    {
      id: 'sess_1',
      timestamp: 1770000000000,
      dateStr: '2026-03-10',
      title: 'The Gift of the Magi (Part 1/4)',
      sourceType: 'story',
      wpm: 62,
      accuracy: 98,
      durationSeconds: 74,
      wordsCount: 41,
      keystrokes: 205,
    },
  ],
  dailyStreak: { currentStreak: 3, bestStreak: 5, lastActiveDate: '2026-03-10' },
  totalWordsTyped: 41,
  totalTimeSpentSeconds: 74,
  bestWpm: 62,
  averageWpm: 62,
  averageAccuracy: 98,
  bestAccuracy: 98,
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({ deviceId: 'device-abc123', stats: stats(), ...over });

/** Assert the payload was rejected and that a specific field was named. */
const expectRejected = (candidate: unknown, pathFragment: string) => {
  const parsed = parseProgressBody(candidate, NOW);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error('unreachable');
  expect(parsed.issues.some((issue) => issue.path.includes(pathFragment))).toBe(true);
};

describe('device id', () => {
  it('accepts a uuid', () => {
    expect(isValidDeviceId('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it.each([
    ['too short', 'abc'],
    ['path traversal', '../../../etc/passwd'],
    ['slash', 'abc/def'],
    ['backslash', 'abc\\def'],
    ['dot', 'abc.def'],
    ['too long', 'a'.repeat(65)],
    ['empty', ''],
    ['not a string', 42],
  ])('rejects %s', (_label, value) => {
    expect(isValidDeviceId(value)).toBe(false);
  });

  it('never lets a device id escape its directory', () => {
    // The pattern is a filesystem safety property, not a format preference.
    expect(DEVICE_ID_PATTERN.test('../../../../etc/passwd')).toBe(false);
  });
});

describe('parseProgressBody', () => {
  it('accepts a well-formed payload', () => {
    const parsed = parseProgressBody(body(), NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');

    expect(parsed.value).toEqual({
      version: PROGRESS_SCHEMA_VERSION,
      deviceId: 'device-abc123',
      updatedAt: '2026-03-10T12:00:00.000Z',
      stats: stats(),
    });
  });

  it('stamps updatedAt from the server clock, not the payload', () => {
    const parsed = parseProgressBody(body({ updatedAt: '1999-01-01T00:00:00.000Z' }), NOW);
    expect(parsed.ok && parsed.value.updatedAt).toBe('2026-03-10T12:00:00.000Z');
  });

  it('accepts a record with no sessions yet', () => {
    const parsed = parseProgressBody(
      body({
        stats: stats({
          sessions: [],
          dailyStreak: { currentStreak: 0, bestStreak: 0, lastActiveDate: '' },
        }),
      }),
      NOW,
    );
    expect(parsed.ok).toBe(true);
  });

  it('accepts an explicit version equal to the server version', () => {
    const parsed = parseProgressBody(body({ version: PROGRESS_SCHEMA_VERSION }), NOW);
    expect(parsed.ok && parsed.value.version).toBe(PROGRESS_SCHEMA_VERSION);
  });

  it('refuses a version from the future rather than dropping unknown fields', () => {
    expectRejected(body({ version: PROGRESS_SCHEMA_VERSION + 1 }), 'version');
  });

  it('refuses a non-integer version', () => {
    expectRejected(body({ version: 1.5 }), 'version');
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'hello'],
    ['a number', 7],
  ])('refuses %s at the top level', (_label, value) => {
    expect(parseProgressBody(value, NOW).ok).toBe(false);
  });

  it('refuses a payload with no deviceId', () => {
    expectRejected({ stats: stats() }, 'deviceId');
  });

  it('refuses a payload with no stats', () => {
    expectRejected({ deviceId: 'device-abc123' }, 'stats');
  });
});

describe('session validation', () => {
  const withSession = (over: Record<string, unknown>) =>
    body({ stats: stats({ sessions: [{ ...stats().sessions[0], ...over } as never] }) });

  it('refuses an unknown sourceType', () => {
    expectRejected(withSession({ sourceType: 'podcast' }), 'sourceType');
  });

  it.each(['story', 'vocab', 'custom'])('accepts sourceType %s', (sourceType) => {
    expect(parseProgressBody(withSession({ sourceType }), NOW).ok).toBe(true);
  });

  it('refuses a negative wpm', () => {
    expectRejected(withSession({ wpm: -5 }), 'wpm');
  });

  it('refuses an implausible wpm', () => {
    expectRejected(withSession({ wpm: 5000 }), 'wpm');
  });

  it('refuses accuracy above 100', () => {
    expectRejected(withSession({ accuracy: 140 }), 'accuracy');
  });

  /**
   * The other half of the same bound, which the two `wpm` tests directly above already ask.
   *
   * `isPercent` is `value >= 0 && value <= 100` — written identically to `isWpm`, two lines
   * down in `lib/progress-schema.ts`, and `wpm` is pinned from both sides while `accuracy`
   * was pinned only from above. That asymmetry is what makes the lower bound look like dead
   * code: a reader of this file sees `refuses accuracy above 100` and no reason to believe
   * anything below it was ever checked.
   *
   * It is not redundant with the load-time filter, which is the obvious objection — every
   * numeric field is re-checked by `lib/stats.ts:234-238` on the way out of storage. Both
   * call sites are the *same* `isPercent`, so they are one predicate evaluated twice, not
   * two defences: deleting `value >= 0` disables the wire check and the load check in the
   * same edit, and the negative value survives both. From there it is rendered, not merely
   * stored — `StatsModal.tsx:671` prints `{session.accuracy}% acc` with no clamp, so the
   * history row reads "-40% acc", and `lib/stats.ts:443` folds it into `averageAccuracy`
   * where a single bad session drags the headline percentage down to something plausible
   * rather than obviously false.
   *
   * Canaried by deleting `value >= 0` from `isPercent` and running the whole suite: 761
   * passed, 51 files, no failure. That is what made this pin worth writing.
   */
  it('refuses a negative accuracy', () => {
    expectRejected(withSession({ accuracy: -5 }), 'accuracy');
  });

  it('refuses a malformed dateStr', () => {
    expectRejected(withSession({ dateStr: '10/03/2026' }), 'dateStr');
  });

  it('refuses a negative word count', () => {
    expectRejected(withSession({ wordsCount: -1 }), 'wordsCount');
  });

  it(`refuses a title longer than ${MAX_TITLE_LENGTH} characters`, () => {
    expectRejected(withSession({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }), 'title');
  });

  it('refuses NaN and Infinity smuggled in as numbers', () => {
    expectRejected(withSession({ wpm: Number.NaN }), 'wpm');
    expectRejected(withSession({ wpm: Number.POSITIVE_INFINITY }), 'wpm');
  });

  it('names the index of the offending session', () => {
    const parsed = parseProgressBody(
      body({
        stats: stats({
          sessions: [
            stats().sessions[0],
            { ...stats().sessions[0], id: 'sess_2', sourceType: 'nope' } as never,
          ],
        }),
      }),
      NOW,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.issues[0].path).toBe('stats.sessions[1].sourceType');
  });

  it('refuses more sessions than a client is allowed to hold', () => {
    const many = Array.from({ length: MAX_SESSIONS + 1 }, (_, i) => ({
      ...stats().sessions[0],
      id: `sess_${i}`,
    }));
    expectRejected(body({ stats: stats({ sessions: many as never }) }), 'stats.sessions');
  });

  it('caps how many issues it reports back', () => {
    const parsed = parseProgressBody(
      body({ stats: { ...stats({ sessions: [] }), dailyStreak: null, totalWordsTyped: 'lots' } }),
      NOW,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.issues.length).toBeLessThanOrEqual(20);
  });
});

describe('streak validation', () => {
  it('rejects a negative streak', () => {
    expectRejected(
      body({ stats: stats({ dailyStreak: { currentStreak: -1, bestStreak: 0, lastActiveDate: '' } }) }),
      'currentStreak',
    );
  });

  it('rejects a missing streak object', () => {
    expectRejected(body({ stats: stats({ dailyStreak: undefined as never }) }), 'dailyStreak');
  });

  it('accepts the empty lastActiveDate that a never-practised client sends', () => {
    const parsed = parseProgressBody(
      body({ stats: stats({ dailyStreak: { currentStreak: 0, bestStreak: 0, lastActiveDate: '' } }) }),
      NOW,
    );
    expect(parsed.ok).toBe(true);
  });

  it('rejects a malformed lastActiveDate', () => {
    expectRejected(
      body({ stats: stats({ dailyStreak: { currentStreak: 1, bestStreak: 1, lastActiveDate: 'yesterday' } }) }),
      'lastActiveDate',
    );
  });
});

/**
 * Regression: every cap in this file — MAX_SESSIONS, MAX_TITLE_LENGTH — describes a
 * *known* field, and the parsed record used to be the request's own object rather than
 * a copy built from what was checked. Nothing constrained anything else, so a PUT could
 * carry a megabyte in `stats.anythingElse` and have all of it written to the data
 * directory, while the header comment claimed a record "can never grow unbounded".
 *
 * The endpoint is auth-less by design, so the device id is not a barrier to this.
 */
describe('fields the schema does not know about', () => {
  const withExtras = () => {
    const base = stats();
    return body({
      stats: {
        ...base,
        __stowaway: 'x'.repeat(1_000_000),
        sessions: [{ ...base.sessions[0], __sneaked: 'y'.repeat(1_000_000) }],
      },
    });
  };

  it('does not let an unknown field reach the record', () => {
    const parsed = parseProgressBody(withExtras(), NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');

    expect(Object.keys(parsed.value.stats)).not.toContain('__stowaway');
    expect(Object.keys(parsed.value.stats.sessions[0])).not.toContain('__sneaked');
  });

  it('keeps the stored record within what the caps allow', () => {
    const parsed = parseProgressBody(withExtras(), NOW);
    if (!parsed.ok) throw new Error('unreachable');

    // A megabyte in, a megabyte out — which is what a stowaway field used to cost.
    expect(JSON.stringify(parsed.value).length).toBeLessThan(2_000);
  });

  it('keeps every field it does know, so constructing the record loses nothing', () => {
    // The guard on the fix itself: a field added to UserStats that is not copied here
    // would silently vanish from every synced backup, and only this would notice.
    const parsed = parseProgressBody(body(), NOW);
    if (!parsed.ok) throw new Error('unreachable');

    expect(parsed.value.stats).toEqual(stats());
  });
});
