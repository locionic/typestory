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
  bestAccuracy: 98,
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

/** Every DELETE issued so far, oldest first. */
const deleteCalls = () =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'DELETE') as [
    string,
    RequestInit,
  ][];

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(reply(200, { record: {} }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // The reset canary below spies on Storage.prototype, and nothing here restores it.
  vi.restoreAllMocks();
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

  /**
   * A reset this browser refuses must not take the backup down with it.
   *
   * `clearUserStats` catches the refused `removeItem` with `// Ignore` and uploads
   * anyway, so the two halves of one button part company. `memoryCache` is left alone
   * and no event fires, so the panel still shows the entire history; the PUT that
   * follows overwrites the server record with `DEFAULT_STATS`, and a push is a
   * whole-record overwrite. The learner pressed "Reset Stats", confirmed, and saw
   * nothing happen — while the one copy that survives a cleared browser, the reason the
   * backup exists, was destroyed with no word anywhere on screen.
   *
   * No sibling writer has this shape. `saveUserStats` returns false and skips its
   * upload on a refused `setItem` — "a failed save is a failed save on both sides" —
   * and `enableBackup`, `adoptBackupCode` and `disableBackup` each report a refused
   * write rather than continuing past it. This is the last one still swallowing.
   *
   * Reachable without anything exotic: the same quota, blocked-storage or private-mode
   * refusal every one of those already treats as ordinary.
   */
  it('sends nothing when this browser refuses to remove the stats', () => {
    enableBackup();
    saveUserStats(stats());
    const real = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key === 'typestory_user_stats_v1') throw new DOMException('full', 'QuotaExceededError');
      real.call(this, key);
    });

    clearUserStats();

    // The save above is the only request ever made, so this says the reset sent
    // nothing at all rather than reading a stale body. The test above is the control:
    // a reset that lands does reach the server.
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/progress')).toHaveLength(1);
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

  /**
   * The delete cannot be trusted to be the last word, because it is not the only
   * request in flight.
   *
   * `pushProgress` runs on every local write, so finishing a typing session puts a PUT
   * on the wire. Turning backup off is what someone does straight afterwards. Both go
   * to the same host, and they are wildly different sizes — a bodyless DELETE against a
   * whole stats record — so the server is free to finish the delete while the upload is
   * still streaming, and the PUT then re-creates the record it was meant to be
   * mirroring. Nothing server-side tells the two apart: PUT is `progressStore.put`,
   * DELETE is `progressStore.remove`, and a put after a remove is an ordinary write.
   *
   * That is the outcome the keepalive test above exists to prevent, reached a second way:
   * the learner is told their history is deleted and a fresh copy of it is sitting on
   * the server, reachable by anyone holding the code they had just been shown.
   *
   * Both requests are issued here exactly as the app issues them — a push already on
   * the wire, then the learner turning it off — and only the ordering is controlled,
   * because the ordering is the defect. The first delete still has to go out
   * immediately, or the page unload the keepalive comment describes would beat it.
   */
  it('deletes again after an upload that was already on the wire', async () => {
    enableBackup();
    let landPut!: () => void;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Promise((resolve) => {
          landPut = () => resolve(reply(200, { record: {} }));
        });
      }
      return Promise.resolve(reply(204, null));
    });

    pushProgress(stats());
    disableBackup();

    // Immediate, for the page that is about to close.
    expect(deleteCalls()).toHaveLength(1);

    // ...and the upload lands after it.
    landPut();
    await vi.waitFor(() => expect(deleteCalls()).toHaveLength(2));
  });

  it('does not delete twice when nothing was in flight to resurrect the record', async () => {
    enableBackup();
    disableBackup();
    await vi.waitFor(() => expect(deleteCalls()).toHaveLength(1));
    // A second pass over an empty in-flight set is a wasted request, and this is the
    // ordinary case: the learner idles for a moment before turning backup off.
    await Promise.resolve();
    expect(deleteCalls()).toHaveLength(1);
  });

  it('has nothing to delete when backup never ran', async () => {
    disableBackup();

    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing was uploaded under a code, so there is nothing left on the server — the
    // end state the delete exists to reach was already true.
    await expect(disableBackup()).resolves.toBe(true);
  });
});

/**
 * Whether the stored copy is actually gone.
 *
 * `StatsModal` told the learner "Backup is off, and the stored copy was deleted" the
 * moment `disableBackup` returned, and that function returned void: the request was
 * fire-and-forget with its rejection swallowed, no response status was read, and
 * `progressStore.remove` re-throws any non-ENOENT filesystem error as a 500 the client
 * never looked at. So clicking this while offline, behind a proxy, or against a
 * container with an unwritable data directory left `.data/progress/<code>.json` in place
 * — every passage, timestamp and duration — and the message asserted it had not.
 *
 * That is a privacy claim made by a best-effort request, and it was the only unchecked
 * claim in this flow. The confirm dialog above it promises deletion as the reason for
 * stopping, and the code has just been thrown away, so the learner cannot check it
 * themselves afterwards either. `disableBackup` resolves to the truth instead, and
 * `StatsModal` prints a different sentence when it is false.
 */
describe('reporting whether the record is gone', () => {
  it('says so when the server deleted it', async () => {
    fetchMock.mockResolvedValue(reply(204, null));
    enableBackup();

    await expect(disableBackup()).resolves.toBe(true);
  });

  it('says so when there was nothing left to delete', async () => {
    // A second delete after the first already succeeded — the route answers 404, and 404
    // is the state being asked for, not a failure.
    fetchMock.mockResolvedValue(reply(404, { error: 'not_found' }));
    enableBackup();

    await expect(disableBackup()).resolves.toBe(true);
  });

  it('says no when the request never reached the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    enableBackup();

    await expect(disableBackup()).resolves.toBe(false);
  });

  it('says no when the server could not delete it', async () => {
    // What an unwritable data directory looks like from here: the route's own throw.
    fetchMock.mockResolvedValue(reply(500, { error: 'delete_failed' }));
    enableBackup();

    await expect(disableBackup()).resolves.toBe(false);
  });

  /**
   * Which delete answers is not cosmetic. With an upload still on the wire, the first
   * delete can land while that upload is streaming and be undone by it — so the record
   * only counts as gone once the *second* delete has come back. A resolver wired to the
   * first one would report the outcome before the resurrection it exists to clean up had
   * even happened, which is the same lie with extra steps.
   */
  it('answers on the delete that settles a resurrected record', async () => {
    let landPut!: () => void;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Promise((resolve) => {
          landPut = () => resolve(reply(200, { record: {} }));
        });
      }
      // The first delete succeeds; the one after the upload settles is what fails.
      return fetchMock.mock.calls.filter(([, i]) => i?.method === 'DELETE').length === 1
        ? Promise.resolve(reply(204, null))
        : Promise.resolve(reply(500, { error: 'delete_failed' }));
    });
    enableBackup();
    pushProgress(stats());

    const settled = disableBackup();
    landPut();

    await expect(settled).resolves.toBe(false);
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
