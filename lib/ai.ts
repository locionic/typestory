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
 * their own figure through `StructuredRequest.maxTokens` — and had better pass
 * more than this, since the two callers that do carry prose are also the two that
 * ask for `effort: 'high'`, and the reasoning draws on the same allowance.
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

export class AiRefusalError extends Error {
  constructor(detail: string) {
    super(`The model declined to answer: ${detail}`);
    this.name = 'AiRefusalError';
  }
}

/**
 * The model answered; the answer is unusable.
 *
 * The third outcome, and the one callers most need to tell apart. `AiRefusalError`
 * means the model declined and a transport failure means it could not be reached —
 * both are "there was no answer", and a caller with nothing to fall back on should
 * report an outage. This is "there was an answer and it was cut short or
 * unparseable", which is a different thing: a caller holding a result the model only
 * helped with can still serve it.
 *
 * The placement route is why this class exists rather than a bare `Error`. It scores
 * the quiz before it ever calls the model, so a truncated *writing grade* has a
 * complete placement sitting right next to it. With both failures reported as a plain
 * `Error` the route could only classify by type, found no refusal, and reported an
 * outage — handing back an error body with no level in it while the page told the
 * learner their "quiz score is unaffected". One class carries the distinction.
 *
 * Deliberately not a subclass of `AiRefusalError`: routes branch on that type to
 * decide the learner-facing code, and a grade cut off at `max_tokens` was not
 * declined by anything.
 */
export class AiUnusableOutputError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'AiUnusableOutputError';
  }
}

/**
 * The three codes an AI route can return, each with a distinct meaning to a learner.
 *
 * `ai_unavailable` in particular is a claim about the world — the service could not be
 * reached — and a page that renders it sends the learner off to retry. So it must mean
 * exactly that, and never absorb an outcome that is not an outage.
 */
export type AiFailureCode = 'ai_refusal' | 'invalid_model_output' | 'ai_unavailable';

/**
 * Map a thrown error to the code a route hands the client.
 *
 * Shared because the two routes that report a bare model failure — writing and tutor —
 * must answer this identically, and because each had answered it with its own
 * two-branch ternary. Both omitted `AiUnusableOutputError`, so an answer cut off at
 * `max_tokens` was reported as an outage in one code and as a rejected schema in
 * another, depending on which half of the split it arrived by. The pages already word
 * `invalid_model_output` correctly ("The correction came back unusable"); the class
 * was simply never consulted.
 *
 * Placement does not use this: it scores the quiz before calling the model, so an
 * unusable grade is degraded away rather than reported. Only routes whose whole
 * product *is* the model output reach for a code.
 */
export function aiFailureCode(error: unknown): AiFailureCode {
  if (error instanceof AiRefusalError) return 'ai_refusal';
  if (error instanceof AiUnusableOutputError) return 'invalid_model_output';
  return 'ai_unavailable';
}

export function createModelClient(): ModelClient {
  // Zero-arg, and deliberately not guarded on ANTHROPIC_API_KEY.
  //
  // This used to open with `if (!isAiConfigured()) throw new AiNotConfiguredError()`,
  // and all three routes checked the same predicate before calling in. But the SDK
  // does not need the key: `new Anthropic()` never throws without one — it resolves
  // the `ant auth login` credential chain on first *use* and surfaces a failure
  // there. So the guard could not stop a call that was going to fail; it could only
  // stop calls that would have succeeded, on any machine whose credential came from
  // a profile. The comment it contradicted stood three lines below it the whole time.
  //
  // What that cost beyond the wasted capability is the reason it is worth recording:
  // placement reads "no key" as "nothing to grade", so it silently discards a written
  // essay and the page then tells the learner that was normal. A machine that truly
  // cannot authenticate degrades to `ai_unavailable`, which is a claim about the world
  // and has to mean it — that one is unreachable.
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
      // Deliberately not an AiRefusalError: `aiFailureCode` maps that to `ai_refusal`,
      // and nothing declined anything here. The two routes whose whole product is the
      // model output map it to `invalid_model_output` instead, which is what the pages
      // already word correctly ("came back unusable"). No route hands this to a learner
      // directly — the placement route, the only one holding a partial result, now
      // degrades on every writing failure rather than reporting a code at all.
      if (message.stop_reason === 'max_tokens') {
        throw new AiUnusableOutputError('Model output was truncated at max_tokens.');
      }
      if (message.parsed_output === null) {
        throw new AiUnusableOutputError('Model returned no parsable output for the requested schema.');
      }
      return message.parsed_output;
    },
  };
}
