import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as placementPost } from '../app/api/placement/route';
import { POST as tutorPost } from '../app/api/tutor/route';
import { POST as writingPost } from '../app/api/writing/route';
import { createModelClient } from '../lib/ai';
import { AI_CALL_LIMIT } from '../lib/rate-limit';
import { PLACEMENT_QUESTIONS } from '../lib/placement';

// lib/ai is mocked at the module boundary, so the Anthropic SDK is never loaded and
// this suite needs no API key and makes no network call. All three routes are imported
// into one file because the claim under test is that *every* route that spends money is
// guarded — testing one of them and calling the other two copies of it is the wrong test.
vi.mock('../lib/ai', () => ({
  AiRefusalError: class AiRefusalError extends Error {},
  AiUnusableOutputError: class AiUnusableOutputError extends Error {},
  aiFailureCode: () => 'ai_unavailable',
  createModelClient: vi.fn(),
}));

const WRITING = 'http://localhost:3000/api/writing';
const TUTOR = 'http://localhost:3000/api/tutor';
const PLACEMENT = 'http://localhost:3000/api/placement';

const TEXT = 'Yesterday I go to the market with my sister and we come back very late.';
const QUESTION = 'When do I use the present perfect, and when the past simple?';

const report = {
  summary: 'Third person -s is the habit to build here.',
  corrected: 'Yesterday I went to the market with my sister, and we came back very late.',
  improvements: [{ original: 'I go', corrected: 'I went', note: 'Past tense needs -ed.' }],
};

/**
 * A proxy header only when the caller is identified; `undefined` means "no proxy".
 *
 * Annotated rather than inferred: the ternary otherwise widens to a union carrying an
 * optional-undefined key, which `HeadersInit` does not accept.
 */
const from = (ip?: string): Record<string, string> => (ip ? { 'x-forwarded-for': ip } : {});

const postWriting = (ip?: string) =>
  writingPost(
    new Request(WRITING, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...from(ip) },
      body: JSON.stringify({ text: TEXT }),
    }),
  );

const postTutor = (ip?: string) =>
  tutorPost(
    new Request(TUTOR, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...from(ip) },
      body: JSON.stringify({ message: QUESTION }),
    }),
  );

const postPlacement = (ip?: string) =>
  placementPost(
    new Request(PLACEMENT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...from(ip) },
      body: JSON.stringify({
        answers: PLACEMENT_QUESTIONS.map((q) => q.correct),
        writing: TEXT,
      }),
    }),
  );

const mockModel = (output: unknown) => {
  const generate = vi.fn().mockResolvedValue(output);
  vi.mocked(createModelClient).mockReturnValue({ generate });
  return generate;
};

const grade = {
  band: 'A2',
  rationale: 'Past tense is inconsistent but the meaning is clear throughout.',
  corrections: ['I go -> I went'],
};

beforeEach(() => {
  vi.mocked(createModelClient).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the ceiling on spending', () => {
  /**
   * The claim itself, and the reason this module exists: the twenty-first request from
   * one caller is answered with a 429 rather than with an Opus call.
   *
   * Asserted on the *model* as well as the status, because a guard that ran after
   * `createModelClient` would leave the status correct and the bill untouched.
   */
  it('stops spending the twenty-first time one caller asks', async () => {
    const generate = mockModel(report);

    for (let n = 0; n < AI_CALL_LIMIT; n += 1) {
      expect((await postWriting('203.0.113.1')).status).toBe(200);
    }
    expect(generate).toHaveBeenCalledTimes(AI_CALL_LIMIT);

    const refused = await postWriting('203.0.113.1');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'rate_limited' });
    expect(refused.headers.get('retry-after')).toBe('60');
    // The whole point: the refused request is the call that was not made.
    expect(generate).toHaveBeenCalledTimes(AI_CALL_LIMIT);
  });

  it('counts the first address in a forwarding chain, not the proxy that added its own', async () => {
    mockModel(report);

    for (let n = 0; n < AI_CALL_LIMIT; n += 1) {
      await writingPost(
        new Request(WRITING, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `198.51.100.7, 10.0.0.${n}`,
          },
          body: JSON.stringify({ text: TEXT }),
        }),
      );
    }

    // A different downstream proxy is not a different caller, so this must not be let in.
    const refused = await writingPost(
      new Request(WRITING, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '198.51.100.7, 10.0.0.99',
        },
        body: JSON.stringify({ text: TEXT }),
      }),
    );
    expect(refused.status).toBe(429);
  });

  it("keeps one caller's traffic out of another's window", async () => {
    const generate = mockModel(report);

    for (let n = 0; n < AI_CALL_LIMIT; n += 1) {
      await postWriting('203.0.113.11');
    }

    expect((await postWriting('203.0.113.12')).status).toBe(200);
    expect((await postWriting('203.0.113.12')).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(AI_CALL_LIMIT + 2);
  });

  /**
   * The window has to close, or a learner who crosses it is locked out until they
   * change address. `Date.now` is the only clock the module reads.
   */
  it('lets the caller back in once the window has passed', async () => {
    mockModel(report);
    vi.useFakeTimers();

    for (let n = 0; n < AI_CALL_LIMIT; n += 1) {
      await postWriting('203.0.113.9');
    }
    expect((await postWriting('203.0.113.9')).status).toBe(429);

    vi.setSystemTime(Date.now() + 61_000);

    expect((await postWriting('203.0.113.9')).status).toBe(200);
  });

  /**
   * Unidentifiable means *answered*, not bucketed.
   *
   * The reason is the developer's own machine. A local `next dev` has no proxy in front
   * of it, so every request from the one person using it arrives with neither header —
   * and a single shared bucket would lock that learner out of their own app after twenty
   * corrections, with nothing on screen but a "wait a moment" that never ends. Keying
   * them separately would make the local app unmockable and the deployed one strict.
   *
   * This does *not* make the existing route suites any less honest: each file gets its
   * own module instance and stays under the ceiling anyway, which was checked rather
   * than assumed. Canaried by failing closed instead, which is the direction that would
   * have bitten.
   */
  it('answers a request it cannot identify rather than counting it', async () => {
    const generate = mockModel(report);

    for (let n = 0; n < AI_CALL_LIMIT + 5; n += 1) {
      expect((await postWriting()).status).toBe(200);
    }
    expect(generate).toHaveBeenCalledTimes(AI_CALL_LIMIT + 5);
  });

  it('guards the tutor too, which is the most expensive call here', async () => {
    mockModel({ reply: 'Present perfect: a past action with a present relevance.' });

    for (let n = 0; n < AI_CALL_LIMIT; n += 1) {
      expect((await postTutor('203.0.113.20')).status).toBe(200);
    }
    expect((await postTutor('203.0.113.20')).status).toBe(429);
  });

  /**
   * The one route where the ceiling cannot refuse the request, because most of what it
   * does is free: the quiz is scored in code and reaches no model at all.
   *
   * So the guard sits at the model call rather than at the door, and a throttled grade
   * degrades to exactly what an unreachable model degrades to — the learner is still
   * placed. This is the test that fails if the guard is hoisted to the top of the
   * handler, where it would refuse the whole test.
   */
  it('still places a learner whose essay is throttled, and says the essay was not graded', async () => {
    // The degrade path logs, which is what makes it observable in production. Silence it
    // here rather than in the route: a real failure reaching a real log is the point.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const generate = mockModel(grade);

    const first = (await (await postPlacement('203.0.113.30')).json()) as { writingOutcome: string };
    expect(first.writingOutcome).toBe('graded');

    for (let n = 1; n < AI_CALL_LIMIT; n += 1) {
      await postPlacement('203.0.113.30');
    }
    expect(generate).toHaveBeenCalledTimes(AI_CALL_LIMIT);

    const throttled = await postPlacement('203.0.113.30');
    // Not a 429: the quiz answered, which is the whole claim.
    expect(throttled.status).toBe(200);
    const placed = (await throttled.json()) as {
      level: string;
      writing: unknown;
      writingOutcome: string;
    };
    expect(placed.level).toBeTruthy();
    expect(placed.writing).toBeNull();
    // 'failed' rather than 'skipped', because they did write an essay and it did not
    // come back — the page's copy tells those two apart.
    expect(placed.writingOutcome).toBe('failed');
    expect(generate).toHaveBeenCalledTimes(AI_CALL_LIMIT);
    expect(logged).toHaveBeenCalled();
  });
});