import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiRefusalError,
  AiUnusableOutputError,
  aiFailureCode,
  createModelClient,
} from '../lib/ai';

// lib/ai.ts is the only module that touches the SDK, and every other suite mocks
// this seam away — so the request it actually builds was untested. The route tests
// assert on what they hand `generate()`, not on the messages that come out of it.
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { parse } };
  },
}));

const SCHEMA = { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] };

const sentMessages = () => parse.mock.calls[0][0].messages as { role: string; content: string }[];

beforeEach(() => {
  parse.mockReset();
  parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: { reply: 'Present perfect.' } });
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
});

describe('createModelClient', () => {
  it('does not require an API key to be built', () => {
    // This replaced a guard that threw `AiNotConfiguredError` right here, and that
    // three routes also ran as a pre-check before calling in. The SDK never needed
    // the key: `new Anthropic()` resolves an `ant auth login` credential chain on
    // first use. So the guard could not have prevented a call that was going to
    // fail — it could only have refused machines whose credential was not an env
    // var, which is the one case that would have worked. A machine that truly
    // cannot authenticate fails at `generate()`, where the routes already handle
    // it, so the capability lost nothing that the guard was protecting.
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(() => createModelClient()).not.toThrow();
  });
});

describe('ModelClient.generate', () => {
  it('sends a single-turn request as exactly one message', async () => {
    // Placement and writing pass no history. If the default ever became something
    // other than "one user turn", every existing feature would silently change.
    await createModelClient().generate({ system: 'sys', user: 'text', schema: SCHEMA });
    expect(sentMessages()).toEqual([{ role: 'user', content: 'text' }]);
  });

  it('puts prior turns before the current one, oldest first', async () => {
    await createModelClient().generate({
      system: 'sys',
      user: 'and here?',
      history: [
        { role: 'user', content: 'What is a dangling participle?' },
        { role: 'assistant', content: 'A split verb.' },
      ],
      schema: SCHEMA,
    });

    // The API rejects a conversation whose last turn is not the new question, so
    // order is the contract, not a formatting detail.
    expect(sentMessages()).toEqual([
      { role: 'user', content: 'What is a dangling participle?' },
      { role: 'assistant', content: 'A split verb.' },
      { role: 'user', content: 'and here?' },
    ]);
  });

  it('defaults to the low-effort, capped setting placement relies on', async () => {
    await createModelClient().generate({ system: 'sys', user: 'text', schema: SCHEMA });
    const request = parse.mock.calls[0][0];

    expect(request.output_config.effort).toBe('low');
    expect(request.max_tokens).toBeGreaterThanOrEqual(2000);
  });

  it('returns the decoded output', async () => {
    await expect(
      createModelClient().generate({ system: 'sys', user: 'text', schema: SCHEMA }),
    ).resolves.toEqual({ reply: 'Present perfect.' });
  });

  it('turns a safety refusal into its own error type', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal', stop_details: { explanation: 'declined' } });
    // The route maps this to `ai_refusal` rather than a generic outage.
    await expect(
      createModelClient().generate({ system: 'sys', user: 'text', schema: SCHEMA }),
    ).rejects.toBeInstanceOf(AiRefusalError);
  });

  it('throws rather than handing back null', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: null });
    await expect(
      createModelClient().generate({ system: 'sys', user: 'text', schema: SCHEMA }),
    ).rejects.toThrow(/no parsable output/);

    // A well-formed response the SDK could not turn into the requested schema is the
    // same "the model answered, the answer is unusable" as a truncation, and the
    // placement route degrades on it for the same reason. Asserted here because this
    // is the only suite that sees what `lib/ai.ts` throws — the route suites mock
    // this module and hand the route a constructed error, so a regression to a bare
    // Error would 502 a placement again with the whole suite still green.
    await expect(
      createModelClient().generate({ system: 'sys', user: 'text', schema: SCHEMA }),
    ).rejects.toBeInstanceOf(AiUnusableOutputError);
  });

  /**
   * The one stop reason that hands back usable-looking output.
   *
   * `refusal` and `end_turn` with no parse are both caught by the checks around
   * this one. A response cut off at `max_tokens` is not: the model was mid-JSON when
   * it ran out, so what comes back can still be schema-shaped enough to satisfy the
   * caller's validator — a tutor reply that stops after "Present perfect is used
   * when you" is a non-empty string inside `MAX_REPLY_CHARS`, so `parseTutorReply`
   * admits it and the page renders half a lesson as though it were the whole thing.
   * The learner is told an answer they can act on is the answer, and nothing on
   * screen says otherwise.
   *
   * This is reachable rather than theoretical: `lib/ai.ts` sends no `thinking`
   * field because this model always thinks, thinking "counts towards your
   * `max_tokens` limit", and adaptive thinking carries no budget of its own to bound
   * it. So the reply competes with the reasoning for the same 2000-4000 tokens, and
   * the learner controls how much history the tutor reasons over.
   *
   * `AiUnusableOutputError`, not `AiRefusalError`: the refusal code tells the learner
   * the model declined their question, which is a different and untrue thing to say
   * about a reply that ran out of room. Routes branch on the type, and the tutor and
   * writing routes — which have no partial result to fall back on — map anything that
   * is not a refusal to `ai_unavailable`, which the client already renders as "try
   * again". The placement route uses it to keep the placement its quiz already
   * decided, instead of discarding a scored test over an optional writing sample.
   *
   * The class is asserted here, not just the message, because this is the only place
   * that sees what `lib/ai.ts` actually throws. The route suites mock this module
   * wholesale and hand the route a constructed error, so nothing else would notice
   * this going back to a bare `Error` — the placement route would silently 502 a
   * truncated grade again and the whole suite would stay green.
   */
  it('refuses a reply cut off at max_tokens rather than serving half of it', async () => {
    parse.mockResolvedValue({
      stop_reason: 'max_tokens',
      parsed_output: { reply: 'Present perfect is used when you' },
    });

    const failure = createModelClient().generate({ system: 'sys', user: 'text', schema: SCHEMA });

    await expect(failure).rejects.toBeInstanceOf(AiUnusableOutputError);
    await expect(failure).rejects.toThrow(/truncated/);
    // It must not borrow the refusal's error type: that code tells the learner the
    // model declined their question, which is a different and untrue thing to say.
    await expect(failure).rejects.not.toBeInstanceOf(AiRefusalError);
  });
});

describe('aiFailureCode', () => {
  /**
   * The mapper is the only place the three outcomes become three different sentences
   * on the page, and every route suite mocks this module wholesale — so `lib/ai.ts` is
   * the *only* place its behaviour is observable. Tested here for the same reason the
   * class is asserted above: a regression here would leave all four route suites green
   * while a truncated correction told the learner the service was unreachable.
   *
   * The middle case is the one that was wrong. `ai_unavailable` is a claim about the
   * world — the page renders it as "not reachable right now. Please try again." — and
   * an answer cut off at `max_tokens` is not that: the service answered and the reply
   * was cut short. `invalid_model_output` already exists on both pages and is already
   * worded correctly ("The correction came back unusable.").
   */
  it('tells an unusable answer apart from a refusal and from an outage', () => {
    expect(aiFailureCode(new AiRefusalError('declined'))).toBe('ai_refusal');
    expect(aiFailureCode(new AiUnusableOutputError('truncated at max_tokens'))).toBe(
      'invalid_model_output',
    );
  });

  it.each([
    ['a transport failure', new Error('socket hang up')],
    // What a keyless machine produces now that the guard no longer short-circuits:
    // the SDK's own credential-chain failure, raised on first use rather than here.
    ['an unresolvable credential', new Error('Could not resolve auth credentials')],
    ['a non-Error throw', 'nope'],
    ['undefined', undefined],
  ])('reports %s as an outage, since nothing about it is a model answer', (_label, thrown) => {
    expect(aiFailureCode(thrown)).toBe('ai_unavailable');
  });

  it('orders the check so a refusal is never mistaken for unusable output', () => {
    // The order is load-bearing: a class that subclassed the other would make the two
    // codes swap. Neither does today, and this is the assertion that keeps it true.
    expect(aiFailureCode(new AiUnusableOutputError('x'))).not.toBe('ai_refusal');
    expect(aiFailureCode(new AiRefusalError('x'))).not.toBe('invalid_model_output');
  });
});