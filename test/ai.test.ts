import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiRefusalError, createModelClient, isAiConfigured } from '../lib/ai';

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

describe('isAiConfigured', () => {
  it('follows the environment rather than the module load', () => {
    // A key added after boot must still be picked up, or a deploy that injects one
    // late looks permanently unconfigured.
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(isAiConfigured()).toBe(false);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    expect(isAiConfigured()).toBe(true);
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
   * A plain Error, not `AiRefusalError`: the route maps that to `ai_unavailable`,
   * which the client already renders as "try again" — the honest advice, since
   * nothing is wrong with the learner's text and a retry may well fit.
   */
  it('refuses a reply cut off at max_tokens rather than serving half of it', async () => {
    parse.mockResolvedValue({
      stop_reason: 'max_tokens',
      parsed_output: { reply: 'Present perfect is used when you' },
    });

    const failure = createModelClient().generate({ system: 'sys', user: 'text', schema: SCHEMA });

    await expect(failure).rejects.toThrow(/truncated/);
    // It must not borrow the refusal's error type: that code tells the learner the
    // model declined their question, which is a different and untrue thing to say.
    await expect(failure).rejects.not.toBeInstanceOf(AiRefusalError);
  });
});