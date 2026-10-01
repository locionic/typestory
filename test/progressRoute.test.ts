import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, PUT } from '../app/api/progress/route';
import { PROGRESS_SCHEMA_VERSION } from '../lib/progress-schema';
import type { UserStats } from '../lib/types';

const DEVICE = 'device-abc123';
const BASE = 'http://localhost:3000/api/progress';

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
  ...over,
});

let dataDir = '';

const url = (deviceId: string) => `${BASE}?deviceId=${encodeURIComponent(deviceId)}`;

const put = (payload: unknown, contentType = 'application/json') =>
  PUT(
    new Request(BASE, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
  );

beforeEach(async () => {
  // lib/progress-store.ts reads this per call, so redirecting it here is enough.
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'typestory-progress-'));
  process.env.TYPE_STORY_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.TYPE_STORY_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('PUT /api/progress', () => {
  it('stores a record and echoes it back', async () => {
    const response = await put({ deviceId: DEVICE, stats: stats() });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const payload = (await response.json()) as { record: { version: number; stats: UserStats } };
    expect(payload.record.version).toBe(PROGRESS_SCHEMA_VERSION);
    expect(payload.record.stats.totalWordsTyped).toBe(41);
  });

  it('makes the record readable on the next GET', async () => {
    await put({ deviceId: DEVICE, stats: stats() });

    const response = await GET(new Request(url(DEVICE)));
    expect(response.status).toBe(200);

    const { record } = (await response.json()) as { record: { deviceId: string; stats: UserStats } };
    expect(record.deviceId).toBe(DEVICE);
    expect(record.stats.sessions[0].sourceType).toBe('story');
  });

  it('overwrites on a second sync rather than duplicating', async () => {
    await put({ deviceId: DEVICE, stats: stats() });
    await put({ deviceId: DEVICE, stats: stats({ totalWordsTyped: 999, bestWpm: 71 }) });

    const { record } = (await (await GET(new Request(url(DEVICE)))).json()) as {
      record: { stats: UserStats };
    };
    expect(record.stats.totalWordsTyped).toBe(999);
    expect(record.stats.bestWpm).toBe(71);
  });

  it('returns 400 with field paths for an invalid payload', async () => {
    const response = await put({ deviceId: DEVICE, stats: stats({ bestWpm: 9999 }) });
    expect(response.status).toBe(400);

    const payload = (await response.json()) as { error: string; issues: { path: string }[] };
    expect(payload.error).toBe('invalid_payload');
    expect(payload.issues.some((issue) => issue.path === 'stats.bestWpm')).toBe(true);
  });

  it('returns 400 for malformed JSON instead of a 500', async () => {
    const response = await put('{ not json');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('invalid_json');
  });

  it('returns 415 when the content type is not JSON', async () => {
    const response = await put({ deviceId: DEVICE, stats: stats() }, 'text/plain');
    expect(response.status).toBe(415);
  });

  it('accepts a charset-qualified JSON content type', async () => {
    const response = await put({ deviceId: DEVICE, stats: stats() }, 'application/json; charset=utf-8');
    expect(response.status).toBe(200);
  });

  it('refuses a path-traversal device id and writes nothing', async () => {
    const response = await put({ deviceId: '../../../etc/passwd', stats: stats() });
    expect(response.status).toBe(400);

    // Nothing may have been created outside dataDir.
    const entries = await fs.readdir(dataDir).catch(() => [] as string[]);
    expect(entries).not.toContain('progress');
  });
});

describe('GET /api/progress', () => {
  it('returns 404 for a device that has never synced', async () => {
    const response = await GET(new Request(url('device-never-seen')));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('not_found');
  });

  it('returns 400 when deviceId is missing', async () => {
    expect((await GET(new Request(BASE))).status).toBe(400);
  });

  it.each(['short', '../../etc/passwd', 'has space', 'a'.repeat(65)])(
    'returns 400 for the unsafe device id %j',
    async (deviceId) => {
      expect((await GET(new Request(url(deviceId)))).status).toBe(400);
    },
  );

  it('survives a corrupted record instead of 500ing', async () => {
    await put({ deviceId: DEVICE, stats: stats() });
    await fs.writeFile(path.join(dataDir, 'progress', `${DEVICE}.json`), '{ truncated', 'utf8');

    expect((await GET(new Request(url(DEVICE)))).status).toBe(404);
  });
});

describe('DELETE /api/progress', () => {
  it('returns 204 and removes the record', async () => {
    await put({ deviceId: DEVICE, stats: stats() });

    const response = await DELETE(new Request(url(DEVICE)));
    expect(response.status).toBe(204);
    expect((await GET(new Request(url(DEVICE)))).status).toBe(404);
  });

  it('returns 404 when there is nothing to delete', async () => {
    expect((await DELETE(new Request(url(DEVICE)))).status).toBe(404);
  });

  it('returns 400 for an unsafe device id', async () => {
    expect((await DELETE(new Request(url('../escape')))).status).toBe(400);
  });
});

describe('device isolation', () => {
  it('never returns one device the record of another', async () => {
    await put({ deviceId: DEVICE, stats: stats() });
    await put({ deviceId: 'device-zzz999', stats: stats({ totalWordsTyped: 7 }) });

    const { record } = (await (await GET(new Request(url(DEVICE)))).json()) as {
      record: { stats: UserStats };
    };
    expect(record.stats.totalWordsTyped).toBe(41);
  });

  it('keeps concurrent writes to different devices separate', async () => {
    await Promise.all([
      put({ deviceId: DEVICE, stats: stats({ totalWordsTyped: 1 }) }),
      put({ deviceId: 'device-zzz999', stats: stats({ totalWordsTyped: 2 }) }),
    ]);

    const read = async (id: string) => {
      const { record } = (await (await GET(new Request(url(id)))).json()) as {
        record: { stats: UserStats };
      };
      return record.stats.totalWordsTyped;
    };
    expect(await read(DEVICE)).toBe(1);
    expect(await read('device-zzz999')).toBe(2);
  });
});