import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/placement/route';
import { createModelClient, isAiConfigured } from '../lib/ai';
import { PLACEMENT_QUESTIONS, MAX_WRITING_CHARS, PASS_RATE, PLACEMENT_LEVELS } from '../lib/placement';

// lib/ai is mocked at the module boundary, so the Anthropic SDK is never loaded
// and this suite needs no API key and makes no network call.
vi.mock('../lib/ai', () => ({
  AiRefusalError: class AiRefusalError extends Error {},
  isAiConfigured: vi.fn(() => false),
  createModelClient: vi.fn(),
}));

const BASE = 'http://localhost:3000/api/placement';

const post = (payload: unknown, contentType = 'application/json') =>
  POST(
    new Request(BASE, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
  );

const allCorrect = () => PLACEMENT_QUESTIONS.map((q) => q.correct);

const rank = (level: string) => ['A1', 'A2', 'B1'].indexOf(level);

/** Every question correct up to and including `top`, every question above it wrong. */
const answersUpTo = (top: 'A1' | 'A2' | 'B1') =>
  PLACEMENT_QUESTIONS.map((q) =>
    rank(q.level) <= rank(top) ? q.correct : (q.correct + 1) % q.options.length,
  );

const mockModel = (output: unknown) => {
  const generate = vi.fn().mockResolvedValue(output);
  vi.mocked(createModelClient).mockReturnValue({ generate });
  return generate;
};

beforeEach(() => {
  vi.mocked(isAiConfigured).mockReturnValue(false);
  vi.mocked(createModelClient).mockReset();
});

describe('GET /api/placement', () => {
  it('serves the bank without the answer key', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as { questions: Record<string, unknown>[] };
    expect(body.questions).toHaveLength(PLACEMENT_QUESTIONS.length);
    for (const question of body.questions) {
      expect(Object.keys(question)).not.toContain('correct');
    }
    expect(JSON.stringify(body)).not.toContain('correct');
  });

  it('includes the writing task so the client can prompt for it', async () => {
    const body = (await (await GET()).json()) as { writingTask: { prompt: string } };
    expect(body.writingTask.prompt).toContain('Write 60');
  });

  // The cap has to reach the page without a value import of lib/placement, which
  // would drag the answer key into the browser bundle. It ships in the GET body.
  it('ships the writing cap rather than letting the page import it', async () => {
    const body = (await (await GET()).json()) as { maxWritingChars: number };
    expect(body.maxWritingChars).toBe(MAX_WRITING_CHARS);
  });

  /**
   * The same trap, twice over. The result card held its own `0.6` and its own
   * `['A1', 'A2', 'B1']` — a value import of either is barred by the answer key, so
   * the page re-declared both as literals and nothing held them equal to the rule
   * this file actually scores with. Raise PASS_RATE to 0.8 and a learner scoring
   * 3/4 at every level is awarded A1 here, while the card still ticks off A2 and B1
   * directly beneath that A1: the only explanation on screen of the result, and it
   * contradicts the result.
   */
  it('ships the scoring rule rather than letting the page re-declare it', async () => {
    const body = (await (await GET()).json()) as { passRate: number; levels: string[] };
    expect(body.passRate).toBe(PASS_RATE);
    expect(body.levels).toEqual([...PLACEMENT_LEVELS]);
  });
});

describe('POST /api/placement', () => {
  it('returns 415 when the content type is not JSON', async () => {
    expect((await post({ answers: allCorrect() }, 'text/plain')).status).toBe(415);
  });

  it('returns 400 for malformed JSON instead of a 500', async () => {
    const response = await post('{ not json');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('invalid_json');
  });

  it('returns 400 with field paths for a short answer list', async () => {
    const response = await post({ answers: [0, 1] });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string; issues: { path: string }[] };
    expect(body.error).toBe('invalid_payload');
    expect(body.issues.some((issue) => issue.path === 'answers')).toBe(true);
  });

  it('scores the quiz and skips the writing when no API key is set', async () => {
    const response = await post({ answers: answersUpTo('A2'), writing: 'I like Ha Long Bay.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { level: string; writing: unknown };
    expect(body.level).toBe('A2');
    expect(body.writing).toBeNull();
    // The whole point: an unconfigured key degrades instead of failing.
    expect(createModelClient).not.toHaveBeenCalled();
  });

  it('skips the writing when the learner left the box empty', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    expect((await post({ answers: answersUpTo('A1'), writing: '   ' })).status).toBe(200);
    expect(createModelClient).not.toHaveBeenCalled();
  });

  it('grades the writing and returns the model band', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    const generate = mockModel({ band: 'A1', rationale: 'Very short.', corrections: [] });

    const body = (await (
      await post({ answers: answersUpTo('B1'), writing: 'I go park.' })
    ).json()) as {
      level: string;
      cappedByWriting: boolean;
      writing: { band: string };
    };

    expect(body.level).toBe('A1');
    expect(body.cappedByWriting).toBe(true);
    expect(body.writing.band).toBe('A1');

    const sent = generate.mock.calls[0][0];
    expect(sent.user).toContain('I go park.');
    expect(sent.schema).toMatchObject({ required: ['band', 'rationale', 'corrections'] });
  });

  it('does not let a strong writing band raise the quiz result', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    mockModel({ band: 'B1', rationale: 'Rich and varied.', corrections: [] });

    const failingA1 = answersUpTo('B1').map((answer, index) =>
      PLACEMENT_QUESTIONS[index].level === 'A1' ? (answer + 1) % 4 : answer,
    );
    const body = (await (
      await post({ answers: failingA1, writing: 'A long essay.' })
    ).json()) as { level: string; cappedByWriting: boolean };

    expect(body.level).toBe('A1');
    expect(body.cappedByWriting).toBe(false);
  });

  /**
   * The quiz is scored before the model is ever called, and `decideLevel` already
   * knows how to place someone with no writing grade — that is what an unconfigured
   * key and an empty box both do. Returning 502 for an unusable writing grade threw
   * the scored quiz away with it: twelve correct answers came back as
   * `{"error":"invalid_model_output"}` with no level anywhere in the body, while the
   * page told the learner their "quiz score is unaffected".
   *
   * An optional half must not gate the whole test. The rationale here is 800
   * characters against a 400 cap — an ordinary reply that overshot one field, not a
   * model that failed.
   */
  it('keeps the quiz result when the writing grade overshoots a cap', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockModel({
      band: 'A1',
      rationale: 'You use present simple well throughout. '.repeat(20),
      corrections: [],
    });

    const response = await post({ answers: answersUpTo('B1'), writing: 'I go to the market yesterday.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { level: string; writing: unknown; cappedByWriting: boolean };
    expect(body.level).toBe('B1');
    expect(body.writing).toBeNull();
    expect(body.cappedByWriting).toBe(false);
    // The operator still gets a line, so a model that never complies is visible
    // in the server log even though the learner got a result.
    expect(silenced).toHaveBeenCalled();
    silenced.mockRestore();
  });

  it('keeps the quiz result when the writing band is not a band at all', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockModel({ band: 'C1', rationale: 'x', corrections: [] });

    const response = await post({ answers: answersUpTo('A2'), writing: 'Hello there friend.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { level: string; writing: unknown };
    expect(body.level).toBe('A2');
    expect(body.writing).toBeNull();
    silenced.mockRestore();
  });

  it('maps a refusal and a transport failure to distinct codes', async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    const { AiRefusalError } = await import('../lib/ai');
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new AiRefusalError('no reason given')),
    });
    const refused = await post({ answers: answersUpTo('A1'), writing: 'Hello there friend.' });
    expect(refused.status).toBe(502);
    expect(((await refused.json()) as { error: string }).error).toBe('ai_refusal');

    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443')),
    });
    const failed = await post({ answers: answersUpTo('A1'), writing: 'Hello there friend.' });
    const raw = await failed.text();
    expect((JSON.parse(raw) as { error: string }).error).toBe('ai_unavailable');
    // The transport detail must not reach the client.
    expect(raw).not.toContain('ECONNREFUSED');
    expect(silenced).toHaveBeenCalled();
    silenced.mockRestore();
  });
});
