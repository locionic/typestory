import Anthropic from '@anthropic-ai/sdk';

/**
 * The single seam every AI feature in TypeStory goes through.
 *
 * The placement test, writing correction and tutor chat are the same primitive:
 * send a system prompt, a user message and a JSON schema, get typed JSON back.
 * Routes depend on `ModelClient` rather than on Anthropic, so the test suite
 * runs with no API key and no network.
 *
 * Deliberately not streaming: a graded placement result is a few hundred tokens
 * the UI renders as one card, so there is nothing to stream progressively. The
 * writing correction and the tutor chat that followed are the same shape — one
 * reply of a few hundred tokens — so neither streams either. A learner waiting
 * on a tutor *can* read prose while it arrives, so streaming is the right call if
 * the tutor is ever widened into long-form mode; that is then a swap of `parse`
 * for `stream` + `finalMessage()` here, and nothing else in this file changes.
 */

export const AI_MODEL = 'claude-opus-5-5';

/**
 * A graded answer is a short structured classification, not an essay, so this
 * sits far below the 16k non-streaming default. Prose-feedback callers pass
 * their own figure through `StructuredRequest.maxTokens`.
 */
const MAX_TOKENS = 2000;

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StructuredRequest {
  system: string;
  /** The current turn. Always last, and always from the learner. */
  user: string;
  /**
   * Earlier turns, oldest first, for a multi-turn caller. Omitted by the two
   * single-turn features. Callers validate this: prior assistant turns are model
   * output and prior user turns are untrusted input, so history is untrusted in
   * both directions and must be capped before it reaches the API.
   */
  history?: Turn[];
  /** JSON Schema for the reply. Sent as output_config.format, not as a tool. */
  schema: Record<string, unknown>;
  /** Reasoning depth. Only the two values this app has evidence for are exposed. */
  effort?: 'low' | 'high';
  /** Raise alongside `effort` for features returning long prose. */
  maxTokens?: number;
}

export interface ModelClient {
  /** Resolves to the decoded JSON, or rejects. Unvalidated — the caller owns the contract. */
  generate(request: StructuredRequest): Promise<unknown>;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set, so the AI half of this feature is unavailable.');
    this.name = 'AiNotConfiguredError';
  }
}

export class AiRefusalError extends Error {
  constructor(detail: string) {
    super(`The model declined to answer: ${detail}`);
    this.name = 'AiRefusalError';
  }
}

/** Read per call, not at module load, so a key set after boot is still picked up. */
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function createModelClient(): ModelClient {
  if (!isAiConfigured()) throw new AiNotConfiguredError();

  // Zero-arg: the SDK also resolves an `ant auth login` profile, so a deploy
  // without ANTHROPIC_API_KEY is not automatically a broken deploy.
  const anthropic = new Anthropic();

  return {
    async generate({ system, user, schema, history = [], effort = 'low', maxTokens = MAX_TOKENS }) {
      // No `thinking` field: Claude Opus 5.5 always thinks and rejects an
      // explicit disable, so depth is controlled by output_config.effort below.
      const message = await anthropic.beta.messages.parse({
        model: AI_MODEL,
        max_tokens: maxTokens,
        // A safety classifier can decline a request outright and still return
        // HTTP 200. Fall back to another model inside the same call so a
        // learner grading a paragraph does not hit a dead end.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        // The current turn last. The API rejects a conversation that does not start
        // with a user turn and does not alternate — both rules are the *caller's* to
        // satisfy, and nothing here reorders or repairs what it is handed. The one
        // multi-turn caller checks both in parseTutorRequest, where a bad history is
        // still the client's fault and is reported as 400 rather than swallowed by the
        // catch-all below, which turns any provider error into an apparent outage.
        messages: [...history.map(({ role, content }) => ({ role, content })), { role: 'user' as const, content: user }],
        output_config: {
          // Grading is latency-sensitive classification, the workload that does
          // best at the cheap end of the range. The prose-feedback callers ask
          // for `high` explicitly.
          effort,
          format: { type: 'json_schema', schema },
        },
      });

      if (message.stop_reason === 'refusal') {
        throw new AiRefusalError(message.stop_details?.explanation ?? 'no reason given');
      }
      // The only stop reason that can return output which *looks* usable. The model
      // was mid-JSON when it ran out, so what comes back may still be schema-shaped
      // enough to pass the caller's validator — a tutor reply stopping after
      // "Present perfect is used when you" is a non-empty string within
      // MAX_REPLY_CHARS, and the page would render half a lesson as the whole of one.
      //
      // Reachable, not theoretical: no `thinking` field is sent because this model
      // always thinks, and thinking counts against `max_tokens` while adaptive
      // thinking carries no budget of its own. The reply competes with the reasoning
      // for the same 2000-4000 tokens, and the tutor's own history — up to 12 turns of
      // 2000 characters — is what the reasoning spends them on. The learner controls
      // both, so they can drive this without doing anything wrong.
      //
      // Deliberately a plain Error rather than an AiRefusalError, so it maps to
      // `ai_unavailable` and the client says "try again" — the honest advice, since
      // the learner's own text was fine and a retry may well fit.
      if (message.stop_reason === 'max_tokens') {
        throw new Error('Model output was truncated at max_tokens.');
      }
      if (message.parsed_output === null) {
        throw new Error('Model returned no parsable output for the requested schema.');
      }
      return message.parsed_output;
    },
  };
}
