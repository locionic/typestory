import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/placement/route';
import { createModelClient } from '../lib/ai';
import { PLACEMENT_QUESTIONS, MAX_RATIONALE_LENGTH, MAX_WRITING_CHARS, PASS_RATE, PLACEMENT_LEVELS } from '../lib/placement';
import { STORIES } from '../data/stories';
import { VOCAB_BANKS } from '../data/vocab';

// lib/ai is mocked at the module boundary, so the Anthropic SDK is never loaded
// and this suite needs no API key and makes no network call.
vi.mock('../lib/ai', () => ({
  AiRefusalError: class AiRefusalError extends Error {},
  AiUnusableOutputError: class AiUnusableOutputError extends Error {},

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

/** A response body as the client reads it: the placement, plus why writing is missing. */
type PlacementBody = {
  level: string;
  writing: unknown;
  cappedByWriting: boolean;
  writingOutcome: 'graded' | 'skipped' | 'failed';
};

beforeEach(() => {
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

  /**
   * The catalog the result card recommends from, and why it is four fields and not a
   * corpus import.
   *
   * `data/stories.ts` carries every paragraph, so a page importing it would put 32K of
   * prose in the bundle to render three links. The projection is the fix — and until now
   * the *only* thing pinning it was the client fixture in test/placementPage.test.ts,
   * which is a hand-written object, not this response. Delete `catalog` from the GET and
   * every test in that file still passes: the page guards on `bundle.catalog ?` and
   * renders no recommendations at all, so the whole feature disappears with the suite
   * green. A consumer's own tests cannot see its producer break.
   *
   * Asserted as the exact projected objects rather than a length, because a fifth field is
   * the regression this exists for and a `toHaveLength` would wave it through. `toEqual` is
   * key-exact, so an added field fails here — and it is what the response carries after
   * `json()` has dropped anything undefined, which is why an undefined-valued extra key
   * would not have cost the bundle anything in the first place.
   *
   * Canaried both ways in app/api/placement/route.ts, each on its own and each failing
   * this assertion alone at 1 of 22 with the other 21 green: `catalog` dropped from the
   * GET body, and `wordCount` added to the projection. The first is the defect this
   * exists for and the second is the one the `toEqual` is there for, so both halves of the
   * assertion are load-bearing and neither is decoration.
   */
  it('serves a four-field catalog of every story, holding the corpus values', async () => {
    const body = (await (await GET()).json()) as { catalog: unknown[] };

    // The slugs alone, in corpus order: this is what names the failure when a story is
    // added to data/stories.ts and not projected here, which is a link no learner is ever
    // offered. It also keeps the assertion below from being satisfiable by an empty array.
    expect(body.catalog.map((s) => (s as { slug: string }).slug)).toEqual(
      STORIES.map((s) => s.slug),
    );

    expect(body.catalog).toEqual(
      STORIES.map(({ slug, title, level, readingTimeMinutes }) => ({
        slug,
        title,
        level,
        readingTimeMinutes,
      })),
    );

    // And the projection is what makes the response small: nothing here carries a
    // paragraph, keyVocabulary, or the word count the story page publishes.
    for (const served of body.catalog as Record<string, unknown>[]) {
      expect(Object.keys(served)).not.toContain('paragraphs');
      expect(Object.keys(served)).not.toContain('keyVocabulary');
    }
  });

  /**
   * The banks, on the same terms as the catalog.
   *
   * The projection half is mechanical and the same argument as the stories. The half that
   * is not is the level map below: every entry in it is a judgement about how much English
   * a bank's words demand, made once and written down in `data/vocab.ts`, and a judgement
   * is exactly the kind of thing that gets quietly edited. Spelling it out here means
   * retagging a bank is a test failure with a diff to argue about, rather than a number
   * that moves and a recommendation no longer offered, for a reason nobody wrote down.
   */
  it('serves every bank, four fields, at the levels the data carries', async () => {
    const body = (await (await GET()).json()) as { banks: Record<string, unknown>[] };

    expect(body.banks.map((b) => b.slug)).toEqual(VOCAB_BANKS.map((b) => b.slug));

    expect(body.banks).toEqual(
      VOCAB_BANKS.map(({ slug, title, level, words }) => ({
        slug,
        title,
        level,
        wordCount: words.length,
      })),
    );

    expect(Object.fromEntries(body.banks.map((b) => [b.slug as string, b.level]))).toEqual({
      'oxford-essential': 'A1',
      'ielts-academic': 'B2',
      'tech-developer': 'B2',
      'fullstack-cloud-engineering': 'B2',
    });

    // `words` is the field the projection exists to withhold: 11K of definitions, phonetics
    // and translations, none of which a card reads, and all of it reachable by one import.
    for (const served of body.banks) {
      expect(Object.keys(served)).not.toContain('words');
      expect(Object.keys(served)).not.toContain('description');
    }
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

  it('scores the quiz and grades the writing even when no key is in the environment', async () => {
    mockModel({ band: 'A2', rationale: 'Fine.', corrections: [] });

    const response = await post({ answers: answersUpTo('A2'), writing: 'I like Ha Long Bay.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as PlacementBody;
    expect(body.level).toBe('A2');
    expect(body.writing).not.toBeNull();

    // The whole point. This used to short-circuit on a missing ANTHROPIC_API_KEY and
    // report 'skipped' — which the page renders as "That is normal — the writing check
    // is optional", to a learner who had written something and asked for it to be
    // graded. The SDK resolves an `ant auth login` credential chain when the env var
    // is absent, so that check discarded essays on machines that could have graded
    // them. An empty box is now the only thing that skips.
    expect(body.writingOutcome).toBe('graded');
  });

  it('reports an unresolvable credential as a failure, not a silent skip', async () => {
    // The companion to the test above: when the writing really cannot be graded, the
    // learner is told it failed rather than that it was skipped — the same lesson the
    // result card already learned for a refusal and an outage.
    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new Error('Could not resolve auth credentials')),
    });

    const response = await post({ answers: answersUpTo('A2'), writing: 'I like Ha Long Bay.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as PlacementBody;
    expect(body.level).toBe('A2');
    expect(body.writing).toBeNull();
    expect(body.writingOutcome).toBe('failed');
  });

  it('skips the writing when the learner left the box empty', async () => {
    expect((await post({ answers: answersUpTo('A1'), writing: '   ' })).status).toBe(200);
    expect(createModelClient).not.toHaveBeenCalled();
  });

  /**
   * Why the result card can tell the learner the truth about a missing writing grade.
   *
   * `writing: null` used to mean four materially different things — an empty box, no key
   * on this instance, a refusal, an unreachable model, a truncated answer, a schema the
   * validator refused — and the page rendered all of them as "Your writing was not
   * graded… That is normal — the writing check is optional". For a refusal or an outage
   * that sentence is false: the learner chose to write something, something went wrong,
   * and they are walked away from it with an assurance that nothing did.
   *
   * lib/ai.ts states the rule for the codes that did reach the page — a claim about the
   * world "must mean exactly that" — and the route obeyed it so thoroughly it ended up
   * making a claim about the world itself. Degrading was right; degrading *silently*
   * was not, and this field is what lets the card stay accurate without a failure
   * taking a scored quiz down with it.
   *
   * Every branch is asserted separately below rather than in a table, because the bug
   * was precisely that they were indistinguishable — so each one has to be shown to
   * say which side of the line it is on.
   */
  it('reports the writing outcome for a grade that arrives intact', async () => {
    mockModel({ band: 'A2', rationale: 'Fine.', corrections: [] });

    const body = (await (
      await post({ answers: answersUpTo('A1'), writing: 'Hello there friend.' })
    ).json()) as PlacementBody;

    expect(body.writingOutcome).toBe('graded');
  });

  it('reports the writing outcome for a refused grade', async () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { AiRefusalError } = await import('../lib/ai');
    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new AiRefusalError('no reason given')),
    });

    const body = (await (
      await post({ answers: answersUpTo('A1'), writing: 'Hello there friend.' })
    ).json()) as PlacementBody;

    expect(body.writing).toBeNull();
    expect(body.writingOutcome).toBe('failed');
    silenced.mockRestore();
  });

  it('reports the writing outcome for an unreachable model', async () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });

    const body = (await (
      await post({ answers: answersUpTo('A1'), writing: 'Hello there friend.' })
    ).json()) as PlacementBody;

    expect(body.writing).toBeNull();
    expect(body.writingOutcome).toBe('failed');
    silenced.mockRestore();
  });

  it('reports the writing outcome for a grade the validator refused', async () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockModel({ band: 'C1', rationale: 'x', corrections: [] });

    const body = (await (
      await post({ answers: answersUpTo('A1'), writing: 'Hello there friend.' })
    ).json()) as PlacementBody;

    expect(body.writing).toBeNull();
    expect(body.writingOutcome).toBe('failed');
    silenced.mockRestore();
  });

  it('grades the writing and returns the model band', async () => {
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
   * This used to be the degradation test for an over-long field, and it no longer is:
   * an 800-character rationale against a 400 cap is an ordinary reply that overshot
   * one field, not a model that failed, so `parseWritingGrade` clips it and the grade
   * is used. That is the better answer on both counts — the learner keeps the feedback,
   * and `decideLevel` caps their B1 quiz to the A1 the model actually graded, which the
   * old path hid by discarding the grade and reporting B1 outright.
   *
   * The degradation this test used to guard is still guarded, by the four beside it:
   * a band that is not a band, a reply cut off mid-grade, a refusal, and an unreachable
   * model — all shapes with nothing to clip.
   */
  it('clips an over-long rationale and still grades the writing', async () => {
    mockModel({
      band: 'A1',
      rationale: 'You use present simple well throughout. '.repeat(20),
      corrections: [],
    });

    const response = await post({ answers: answersUpTo('B1'), writing: 'I go to the market yesterday.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      level: string;
      writing: { band: string; rationale: string } | null;
      cappedByWriting: boolean;
    };
    expect(body.writing?.band).toBe('A1');
    expect(body.writing?.rationale).toHaveLength(MAX_RATIONALE_LENGTH);
    expect(body.writing?.rationale.endsWith('…')).toBe(true);
    expect(body.cappedByWriting).toBe(true);
    expect(body.level).toBe('A1');
  });

  it('keeps the quiz result when the writing band is not a band at all', async () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockModel({ band: 'C1', rationale: 'x', corrections: [] });

    const response = await post({ answers: answersUpTo('A2'), writing: 'Hello there friend.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { level: string; writing: unknown };
    expect(body.level).toBe('A2');
    expect(body.writing).toBeNull();
    silenced.mockRestore();
  });

  /**
   * The same rule, reached the other way round — and until now the two paths
   * disagreed.
   *
   * The two tests above cover a grade that *arrives* and fails `parseWritingGrade`.
   * A grade that never arrives is a different failure with the same cause: the model
   * was cut off mid-JSON and `lib/ai.ts` throws before the grade is ever parsed. That
   * is the likeliest unusable grade of all, because thinking counts against
   * `max_tokens` and the writing grade is a few hundred tokens of JSON competing with
   * the reasoning for the same budget.
   *
   * Both were throwing the scored quiz away, but only for the second one was that
   * still true: the throw landed in the route's catch-all, which had no way to tell
   * "the model could not answer" from "the model answered with something unusable" —
   * both were a bare `Error` — so it reported an outage and discarded twelve
   * correctly-answered questions. The learner saw the page's "your quiz score is
   * unaffected" over a body with no level in it.
   *
   * So the error carries the distinction the route needs — though with every writing
   * failure now degrading alike, the route no longer needs to tell them apart to answer
   * the learner correctly. What it still needs is to log them apart: a model that never
   * finishes grading and a model that is merely unreachable are different problems for
   * whoever is running this, and both are silent to a client that gets a result either
   * way. It is deliberately NOT an `AiRefusalError`, because nothing declined anything.
   */
  it('keeps the quiz result when the model is cut off before it finishes grading', async () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { AiUnusableOutputError } = await import('../lib/ai');

    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(
        new AiUnusableOutputError('Model output was truncated at max_tokens.'),
      ),
    });

    const response = await post({ answers: answersUpTo('B1'), writing: 'I go to the market yesterday.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { level: string; writing: unknown; cappedByWriting: boolean };
    expect(body.level).toBe('B1');
    // Placed by the quiz alone — the same thing an unconfigured key and an empty box
    // both produce, and the same thing the parse-failure path above produces.
    expect(body.writing).toBeNull();
    expect(body.cappedByWriting).toBe(false);
    // Still logged, so an operator sees a model that never finishes grading.
    expect(silenced).toHaveBeenCalled();
    silenced.mockRestore();
  });

  /**
   * A refusal and a transport failure are the optional half failing, not the test failing.
   *
   * Three failure modes already degrade: no key, an empty box, and an unusable grade.
   * A fourth — truncation — was added to that group because it "disagreed about one
   * policy" with the grade that survives validation. A refusal and a transport failure
   * were the two left behind, and 502ing them is the one outcome with no way forward.
   *
   * A 502 here does not just lose the writing. The page renders the result card, and the
   * card is the only thing carrying "Retake the test" — so a learner whose model call
   * timed out kept a filled-in form, an error, and no exit, retrying into the same 502.
   * And the sentence they were shown said the opposite: "Your quiz score is unaffected",
   * over a body with no level in it. Twelve correct answers were simply gone, and the
   * one screen promising they were safe was what told them so.
   *
   * So every writing failure degrades to what an unconfigured key and an empty box both
   * produce: `writing: null`, quiz decides, and the page's existing "your writing was not
   * graded" panel says what happened. The reason is still logged, so an operator sees a
   * model that is refusing or unreachable — the learner gains an exit, and loses nothing
   * they had, because the writing half was labelled optional on the way in.
   */
  it('keeps the quiz result when the model refuses to grade', async () => {
    const { AiRefusalError } = await import('../lib/ai');
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new AiRefusalError('no reason given')),
    });

    const response = await post({ answers: answersUpTo('B1'), writing: 'Hello there friend.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { level: string; writing: unknown; cappedByWriting: boolean };
    expect(body.level).toBe('B1');
    expect(body.writing).toBeNull();
    expect(body.cappedByWriting).toBe(false);
    expect(silenced).toHaveBeenCalled();
    silenced.mockRestore();
  });

  it('keeps the quiz result when the model cannot be reached at all', async () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443')),
    });

    const response = await post({ answers: answersUpTo('B1'), writing: 'Hello there friend.' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { level: string; writing: unknown };
    expect(body.level).toBe('B1');
    expect(body.writing).toBeNull();
    // The transport detail reaches the operator's log and nobody else.
    expect(silenced.mock.calls.flat().join(' ')).toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    silenced.mockRestore();
  });
});
