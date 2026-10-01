import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveUserStats, clearUserStats } from '../lib/stats';
import {
  adoptBackupCode,
  disableBackup,
  enableBackup,
  fetchBackup,
  getBackupCode,
  pushProgress,
} from '../lib/progress-client';
import { isValidDeviceId } from '../lib/progress-schema';
import type { UserStats } from '../lib/types';

// The code has to survive a server that would rather it did not, so the tests lean
// on the server's own predicate rather than re-stating the pattern.
const CODE = 'device-abc123';

const stats = (words = 42): UserStats => ({
  sessions: [
    {
      id: 'sess_1',
      timestamp: Date.UTC(2026, 2, 10),
      dateStr: '2026-03-10',
      title: 'The Tortoise and the Hare',
      sourceType: 'story',
      wpm: 51,
      accuracy: 98,
      durationSeconds: 42,
      wordsCount: words,
      keystrokes: 210,
    },
  ],
  dailyStreak: { currentStreak: 1, bestStreak: 1, lastActiveDate: '2026-03-10' },
  totalWordsTyped: words,
  totalTimeSpentSeconds: 42,
  bestWpm: 51,
  averageWpm: 51,
  averageAccuracy: 98,
});

/** Minimal Response stand-in: constructing a real one drags in undici per test. */
const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const fetchMock = vi.fn();

/** The PUT issued so far, so a test can inspect the options rather than the body. */
const lastPutCall = () => {
  const call = fetchMock.mock.calls.filter(([url]) => url === '/api/progress').pop() as
    | [string, RequestInit]
    | undefined;
  return (call ?? ['', {}]) as [string, RequestInit];
};

/** The single PUT issued so far, as the body the server would parse. */
const lastPut = () => {
  const [, init] = lastPutCall();
  return JSON.parse(String(init.body)) as { deviceId: string; stats: UserStats; version: number };
};

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(reply(200, { record: {} }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('opting in', () => {
  it('uploads nothing while backup is off', () => {
    saveUserStats(stats());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getBackupCode()).toBeNull();
  });

  it('mints a code the server would accept, and keeps it', () => {
    const minted = enableBackup();

    expect(isValidDeviceId(minted)).toBe(true);
    expect(enableBackup()).toBe(minted);
    expect(getBackupCode()).toBe(minted);
  });

  it('still mints one without crypto.randomUUID, which a plain-http host lacks', () => {
    // The insecure-context case: no randomUUID, so the fallback has to carry it.
    vi.stubGlobal('crypto', {});

    const minted = enableBackup();

    expect(isValidDeviceId(minted)).toBe(true);
  });

  it('refuses a code the server would reject, so nothing bad is stored as identity', () => {
    expect(adoptBackupCode('../../etc/passwd')).toBe(false);
    expect(getBackupCode()).toBeNull();
  });
});

describe('mirroring local writes', () => {
  it('uploads every save once a code exists', () => {
    const deviceId = enableBackup();
    saveUserStats(stats(99));

    const body = lastPut();
    expect(body.deviceId).toBe(deviceId);
    expect(body.stats.totalWordsTyped).toBe(99);
    expect(body.stats.sessions[0].title).toBe('The Tortoise and the Hare');
  });

  it('empties the mirror after a reset, rather than leaving history on the server', () => {
    enableBackup();
    saveUserStats(stats());
    clearUserStats();

    expect(lastPut().stats.sessions).toEqual([]);
  });

  it('sends the version so an old client cannot be silently accepted', () => {
    enableBackup();
    saveUserStats(stats());

    expect(lastPut().version).toBe(1);
  });

  it('survives an upload that fails, because the local copy is the real one', () => {
    enableBackup();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(() => saveUserStats(stats())).not.toThrow();
    expect(getBackupCode()).not.toBeNull();
  });

  it('follows an adopted code so a restored device keeps syncing where its backup lives', () => {
    enableBackup();
    adoptBackupCode(CODE);
    saveUserStats(stats());

    expect(lastPut().deviceId).toBe(CODE);
  });

  it('does nothing at all without a code', () => {
    pushProgress(stats());

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('turning it off', () => {
  it('forgets the code and deletes what the server is holding', () => {
    const deviceId = enableBackup();
    disableBackup();

    expect(getBackupCode()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/progress?deviceId=${encodeURIComponent(deviceId as string)}`,
      { method: 'DELETE', keepalive: true },
    );
  });

  /**
   * Regression: the delete was an ordinary fetch, which the browser cancels when the
   * page unloads — and turning backup off is exactly what someone does at the end of
   * a session, so closing the tab is the next click. The learner was told their
   * history was gone while it stayed on the server, reachable by anyone holding the
   * code they had just been shown. `keepalive` is what makes the request survive.
   *
   * Asserted on the delete and *only* on the delete: a push carries a whole stats
   * record against a 64KB keepalive budget, and is meant to be droppable anyway.
   */
  it('keeps the delete alive past the page that asked for it', () => {
    enableBackup();
    disableBackup();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/progress?deviceId=');
    expect(init.method).toBe('DELETE');
    expect(init.keepalive).toBe(true);
  });

  it('leaves the push droppable, because the local copy is the real one', () => {
    enableBackup();
    pushProgress(stats());

    const [, init] = lastPutCall();
    expect(init.keepalive).toBeUndefined();
  });

  it('has nothing to delete when backup never ran', () => {
    disableBackup();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('restoring', () => {
  it('returns the stored stats', async () => {
    fetchMock.mockResolvedValue(reply(200, { record: { stats: stats(7) } }));

    const found = await fetchBackup(CODE);

    expect(found).toEqual({ ok: true, stats: stats(7) });
  });

  it('rejects a malformed code without troubling the network', async () => {
    const found = await fetchBackup('nope');

    expect(found.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says so when the code simply has no backup', async () => {
    fetchMock.mockResolvedValue(reply(404, { error: 'not_found' }));

    expect((await fetchBackup(CODE)).ok).toBe(false);
  });

  it('surfaces an unreachable server instead of hanging the button', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect((await fetchBackup(CODE)).ok).toBe(false);
  });

  it('refuses a response whose body is not a record', async () => {
    fetchMock.mockResolvedValue(reply(200, { record: { stats: null } }));

    expect((await fetchBackup(CODE)).ok).toBe(false);
  });
});
