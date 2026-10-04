import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileProgressStore, UnsafeDeviceIdError } from '../lib/progress-store';
import type { ProgressRecord } from '../lib/progress-schema';
import type { UserStats } from '../lib/types';

const CODE = 'device-abc123';

const stats = (bestWpm: number): UserStats => ({
  sessions: [],
  dailyStreak: { currentStreak: 1, bestStreak: 1, lastActiveDate: '2026-03-10' },
  totalWordsTyped: 0,
  totalTimeSpentSeconds: 0,
  bestWpm,
  averageWpm: bestWpm,
  averageAccuracy: 100,
  bestAccuracy: 100,
});

const record = (bestWpm: number): ProgressRecord => ({
  version: 1,
  deviceId: CODE,
  updatedAt: '2026-03-10T10:00:00.000Z',
  stats: stats(bestWpm),
});

let dir: string;
let store: FileProgressStore;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'typestory-store-'));
  process.env.TYPE_STORY_DATA_DIR = dir;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.TYPE_STORY_DATA_DIR;
});

beforeEach(() => {
  store = new FileProgressStore();
});

describe('round-tripping a record', () => {
  it('stores what it is given and reads it back', async () => {
    await store.put(record(51));
    expect((await store.get(CODE))?.stats.bestWpm).toBe(51);
  });

  it('reports a device it has never seen as absent rather than failing', async () => {
    expect(await store.get('device-neverseen')).toBeNull();
  });

  it('overwrites rather than accumulating', async () => {
    await store.put(record(51));
    await store.put(record(72));
    expect((await store.get(CODE))?.stats.bestWpm).toBe(72);
  });

  it('treats a truncated or hand-edited file as absent so the next write repairs it', async () => {
    await store.put(record(51));
    await writeFile(path.join(dir, 'progress', `${CODE}.json`), '{"version":1,"stat', 'utf8');
    expect(await store.get(CODE)).toBeNull();

    await store.put(record(72));
    expect((await store.get(CODE))?.stats.bestWpm).toBe(72);
  });
});

describe('remove', () => {
  it('deletes a record and reports that it did', async () => {
    await store.put(record(51));
    expect(await store.remove(CODE)).toBe(true);
    expect(await store.get(CODE)).toBeNull();
  });

  it('reports false for a device that was never stored', async () => {
    expect(await store.remove('device-neverseen')).toBe(false);
  });
});

/**
 * Regression: the temp file was named for the *process*, so two in-flight writes of
 * the same device shared one temp path. The likeliest way to get two is one learner
 * with the app open in two tabs finishing a passage in each — exactly the multi-tab
 * case the store exists to make safe.
 *
 * The first `rename` then moved the *second* write's bytes into place while reporting
 * success for its own, and the second rename failed ENOENT. Both writes were lost: the
 * caller of the successful one had its record replaced by someone else's, and the other
 * was told the server had failed. In a store whose whole job is "progress survives a
 * cleared browser", that is a silently wrong backup.
 */
describe('two writes of the same device at once', () => {
  it('both succeed, and neither reports a success it did not have', async () => {
    const results = await Promise.allSettled([store.put(record(11)), store.put(record(99))]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    // Whichever landed last is a legitimate outcome — a last-writer-wins backup. What
    // must not happen is a *failed* write, or a success that stored someone else's bytes
    // while reporting its own.
    const stored = await store.get(CODE);
    expect([11, 99]).toContain(stored?.stats.bestWpm);
  });

  it('leaves no half-written temp file behind on the happy path', async () => {
    await store.put(record(11));
    const files = await readdir(path.join(dir, 'progress'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('the device id becomes a filename, so it is re-checked here', () => {
  it.each([
    ['a path traversal', '../../etc/passwd'],
    ['a separator', 'abc/def'],
    ['a dot segment', '..'],
    ['an absolute path', '/etc/passwd'],
    ['too short to be a code', 'a'],
    ['not a string', 42],
  ])('refuses %s', async (_label, deviceId) => {
    // The route validates first. This is the layer that joins the value onto a path,
    // so it must hold even if a caller forgets — traversal here is arbitrary write.
    // Both methods are async, so the guard surfaces as a rejection, not a throw.
    await expect(
      store.put({ ...record(51), deviceId: deviceId as string }),
    ).rejects.toBeInstanceOf(UnsafeDeviceIdError);
    await expect(store.get(deviceId as string)).rejects.toBeInstanceOf(UnsafeDeviceIdError);
    // All three, and `remove` was the one that was missing. It goes through the same
    // `fileFor`, so it does hold — but nothing said so, and it is the one to say it for:
    // the other two lose a read or overwrite a record, and this one deletes whatever the
    // path names, which is the strictly worse outcome for the guard to have lost.
    await expect(store.remove(deviceId as string)).rejects.toBeInstanceOf(UnsafeDeviceIdError);
  });

  /**
   * The structural version, and the reason the three above are not just an enumeration
   * that stops where the last one did.
   *
   * The guard lives in `fileFor`, which every method that touches the filesystem routes
   * through — so it cannot be forgotten without bypassing that helper outright. This
   * asserts the helper is still the only path: a fourth public method added later has to
   * appear in this list, which is what stops it appearing here without the guard.
   *
   * `fileFor` itself is named in the exclusion because it is `private` in TypeScript and
   * present at runtime — it throws synchronously rather than rejecting, so folding it
   * into the three above would assert a contract none of them have.
   */
  it('holds on every method that turns an id into a path', () => {
    const declared = Object.getOwnPropertyNames(FileProgressStore.prototype)
      .filter((name) => name !== 'constructor' && name !== 'fileFor')
      .sort();

    expect(declared).toEqual(['get', 'put', 'remove']);
  });
});