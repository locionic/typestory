import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DELETE, GET, PUT } from '../app/api/progress/route';
import { disableBackup, enableBackup, getBackupCode, pushProgress } from '../lib/progress-client';
import { PROGRESS_SCHEMA_VERSION } from '../lib/progress-schema';
import { clearUserStats, loadUserStats, recordCompletedSession } from '../lib/stats';
import type { UserStats } from '../lib/types';

/**
 * The seam where a backup is actually lost.
 *
 * `pushProgress` serialises a whole `UserStats` and PUTs it; `/api/progress` validates
 * every field of that record and refuses the request whole if one of them fails a check.
 * So the two halves have to agree exactly — on the envelope, on `version`, and on every
 * field inside `stats` — and nothing in the repository runs them against each other.
 * `test/progressClient.test.ts` stubs the network and asserts on what went out.
 * `test/progressRoute.test.ts` hand-writes a payload and asserts on what came back. A
 * field the route adds to its accept-set, or a value the client can produce that the
 * route's validator rejects, passes both suites and refuses every push forever.
 *
 * That failure is the one `lib/stats.ts` calls out as silent: a push is a whole-record
 * overwrite, so one bad field takes the entire backup down — "The learner's history keeps
 * growing on screen and stops appearing on every other browser, with nothing anywhere to
 * say so." And it is silent because a 400 is a *resolved* fetch, which `pushProgress`
 * only catches for a rejection. Nothing on any screen is ever told.
 *
 * So: the client writes the body, the route reads it, and the record comes back out of
 * the route the way it went in.
 */

const BASE = 'http://localhost:3000/api/progress';

let dataDir: string;
let pushed: Request | null = null;

beforeEach(async () => {
  // lib/progress-store.ts reads this per call, so redirecting it here is enough —
  // same mechanism as test/progressRoute.test.ts.
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'typestory-roundtrip-'));
  process.env.TYPE_STORY_DATA_DIR = dataDir;

  pushed = null;
  localStorage.clear();
});

afterEach(async () => {
  clearUserStats();
  delete process.env.TYPE_STORY_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

/**
 * A record written by the app's own recorder.
 *
 * `recordCompletedSession` is the single function that builds the stored record, so going
 * through it means the fields below are the ones the app actually produces — including
 * `bestAccuracy` and the daily streak, which a hand-written payload would leave at their
 * defaults and so never exercise the route's checks on them.
 */
function recordOneSession(): UserStats {
  const saved = recordCompletedSession({
    title: 'Round Trip Passage',
    sourceType: 'story',
    wpm: 62,
    accuracy: 97,
    durationSeconds: 41,
    wordsCount: 42,
    keystrokes: 190,
  });
  if (!saved) throw new Error('the session was not recorded');
  return loadUserStats();
}

/**
 * Capture the exact request `pushProgress` makes, without letting it reach a network.
 *
 * The client's `ENDPOINT` is the relative `/api/progress`, which `new Request` rejects —
 * so it is resolved against an absolute base here. Worth noting how that failure arrives:
 * the stub throws inside an async function, the promise rejects, and `pushProgress`'s
 * `.catch` swallows it exactly as it swallows a real outage. A harness bug in here is
 * therefore indistinguishable from the product bug this file is about, which is why the
 * capture throws loudly instead of returning null.
 */
function capturePush(): Request {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      pushed = new Request(new URL(url, BASE), init);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }),
  );
  pushProgress(recordOneSession());
  vi.unstubAllGlobals();
  if (!pushed) {
    throw new Error(
      `pushProgress sent nothing — code=${String(getBackupCode())} fetch=${typeof fetch}`,
    );
  }
  return pushed;
}

describe('a backup the app wrote, read by the app that serves it', () => {
  it('is accepted and comes back whole', async () => {
    const code = enableBackup();
    if (!code) throw new Error('no backup code was issued');

    const written = await PUT(capturePush());
    expect(written.status).toBe(200);

    // And the reverse direction, which is the one a learner on a new machine depends on:
    // what the server hands back has to be the record that went in, not a lossy version
    // of it that merely happens to satisfy the schema.
    const read = await GET(new Request(`${BASE}?deviceId=${encodeURIComponent(code)}`));
    expect(read.status).toBe(200);

    const { record } = (await read.json()) as { record: { version: number; stats: UserStats } };
    expect(record.version).toBe(PROGRESS_SCHEMA_VERSION);
    expect(record.stats).toEqual(loadUserStats());
    // The fields that only exist because a session was recorded. Asserted by name so a
    // silently-defaulted one is a failure rather than a match: the record carries a
    // session, so `bestWpm` cannot legitimately have come back as its 0 fallback.
    expect(record.stats.sessions).toHaveLength(1);
    expect(record.stats.bestWpm).toBe(62);
    expect(record.stats.bestAccuracy).toBe(97);
  });

  /**
   * The control, and the reason the assertion above means anything.
   *
   * A route that accepted everything and returned a padded default would also answer 200.
   * The value chosen is one the store's own `loadUserStats` refuses but renders fine —
   * a negative duration is finite, so a finiteness check admits it — which is exactly the
   * class of field `lib/stats.ts` warns takes the whole backup down. It has to turn this
   * route red, or the round-trip above proves only that two halves are wired together.
   */
  it('is refused whole when one field of it fails the server check', async () => {
    if (!enableBackup()) throw new Error('no backup code was issued');
    const request = capturePush();
    const payload = JSON.parse(await request.clone().text()) as {
      deviceId: string;
      stats: UserStats;
    };
    payload.stats.sessions[0].durationSeconds = -5;

    const refused = await PUT(
      new Request(BASE, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );

    expect(refused.status).toBe(400);
  });
});
/**
 * The same seam, on the one request that takes data back off the server.
 *
 * `disableBackup` is the app's only deletion, and the panel reports it in one of two
 * sentences depending on whether it worked. Neither half of that pair was ever checked
 * against the route: `test/progressClient.test.ts` asserts the client sends
 * `{ method: 'DELETE', keepalive: true }` against a stubbed fetch — which says nothing
 * about the query string that identifies *whose* record to delete — and
 * `test/progressRoute.test.ts` builds its DELETE from a device id it typed itself.
 *
 * So the two ends of the query string were never in the same test. A rename on either
 * side, or a code that stopped being passed, leaves both suites green and produces a
 * deletion that removes nothing, while the panel tells the learner their history is off
 * their server and gone. `keepalive` means it is also the request least likely to be
 * retried, since it is fired on the way out of the page.
 */
describe('a learner turning backup off', () => {
  /** Capture the exact request `disableBackup` makes, for the same reason as above. */
  async function captureDelete(): Promise<Request> {
    let seen: Request | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        seen = new Request(new URL(url, BASE), init);
        return new Response('{}', { headers: { 'content-type': 'application/json' } });
      }),
    );
    await disableBackup();
    vi.unstubAllGlobals();
    if (!seen) throw new Error('disableBackup sent nothing');
    return seen;
  }

  /**
   * Checked by looking for the record rather than by the status code.
   *
   * A DELETE against a device id that does not exist answers 404, and the client counts
   * that as success — so a status assertion here would pass on a deletion that deleted
   * nothing at all. The premise below is what makes the 404 afterwards mean something:
   * the record was there a moment ago, and the only thing between those two observations
   * is the request the client built.
   */
  it('actually takes the record off the server', async () => {
    const code = enableBackup();
    if (!code) throw new Error('no backup code was issued');
    expect((await PUT(capturePush())).status).toBe(200);

    const before = await GET(new Request(`${BASE}?deviceId=${encodeURIComponent(code)}`));
    expect(before.status).toBe(200);

    const deleted = await DELETE(await captureDelete());
    // 204, not 200: the record is gone and there is nothing left to describe, which
    // `response.ok` covers — the same branch `deleteRemote` relies on.
    expect(deleted.status).toBe(204);

    const after = await GET(new Request(`${BASE}?deviceId=${encodeURIComponent(code)}`));
    expect(after.status).toBe(404);
  });
});
