import type { ValidationIssue } from './progress-schema';
import type { Turn } from './ai';

/**
 * English tutor chat.
 *
 * The third feature on the `lib/ai.ts` seam and the first with history. Placement
 * and writing correction are single-turn by nature — a graded quiz and a piece of
 * corrected text both stand alone — but "why did it say that?" and "and here?" only
 * mean something against the turn before them.
 *
 * What history does *not* buy is safety. A prior user turn is untrusted input and a
 * prior assistant turn is model output re-fed as if the model had written it, so a
 * learner can put something in an earlier turn that reads as an instruction later.
 * The caps below bound that; they do not remove it, and the system prompt — not the
 * validator — is what keeps the tutor talking about English.
 */

/** Trust boundary: every turn in a submitted history is untrusted. */
export const MAX_TURNS = 12;
export const MAX_MESSAGE_CHARS = 2000;

/**
 * Deliberately above the ceiling the system prompt states.
 *
 * The learner drives this over on their own: the tutor answers at `effort: 'high'`
 * a question they may have written 2000 characters of, and a thorough explanation
 * of something like the tenses is exactly the kind of reply that runs long. The
 * schema cannot help — structured outputs support neither array nor string
 * constraints, so `maxLength` would be stripped by the SDK and constrain nothing
 * while looking like it did. That leaves the prompt as the only thing telling the
 * model a ceiling exists, and tripping this cap costs the learner twice over: the
 * route 502s and the page says "The reply came back unusable. Please try again."
 * over prose that reads perfectly well, and the same over-length reply would then
 * 400 their next question when it is re-posted as history. So the stated ceiling
 * sits below the cap, and the gap is where an imprecise count lands instead of
 * the answer being discarded.
 */
export const MAX_REPLY_CHARS = 2000;
/** A blank message is a stray Enter, not a question worth a model call. */
export const MIN_MESSAGE_CHARS = 1;

export interface TutorMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TutorReply {
  reply: string;
}

export const TUTOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
  },
  required: ['reply'],
  additionalProperties: false,
};

export const TUTOR_SYSTEM_PROMPT = `You are a patient English tutor talking with a learner who is learning English, and you return one JSON object.

- reply: your actual answer, in plain English the learner can read. Markdown, lists and
  short worked examples are fine when they teach something. No preamble about being an AI.

You are here to help with English. If asked to do something else, say briefly that this is
an English tutor and offer the English angle on it, then answer that.

- Answer the question actually asked. If the learner is mid-error, correct the English
  rather than the meaning, and say what the fix is.
- Keep replies short. A few sentences beats a wall of text; the learner is here to type,
  not to read an essay. Keep the whole reply under 1500 characters.
- Give examples at the learner's level. Do not use a harder word than the one being taught
  without showing it in a sentence they can read.
- Use the earlier turns to stay consistent, but never repeat yourself — if you have
  already explained a point, do not explain it again in longer words.
- Never correct a contraction, a proper noun, or a deliberate technical term.

Rules:
- Do not invent facts about the world, and do not speculate about the learner.
- Return the JSON object only, with no surrounding prose.`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type TutorRequestResult =
  | { ok: true; value: { history: Turn[]; user: string } }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Split out from `parseTutorRequest` so the same rules cover the live history and a
 * restored one: an assistant turn is model output, and re-posting it must not be the
 * easiest way around the cap.
 */
const checkTurn = (turn: unknown, path: string, issues: ValidationIssue[]): void => {
  if (!isObject(turn)) {
    issues.push({ path, message: 'expected an object' });
    return;
  }
  if (turn.role !== 'user' && turn.role !== 'assistant') {
    issues.push({ path: `${path}.role`, message: 'expected one of user, assistant' });
  }
  if (typeof turn.content !== 'string') {
    issues.push({ path: `${path}.content`, message: 'expected a string' });
  } else if (turn.content.trim().length < MIN_MESSAGE_CHARS) {
    issues.push({ path: `${path}.content`, message: 'expected a non-empty message' });
  } else if (turn.content.length > MAX_MESSAGE_CHARS) {
    issues.push({
      path: `${path}.content`,
      message: `expected at most ${MAX_MESSAGE_CHARS} characters`,
    });
  }
};

export function parseTutorRequest(body: unknown): TutorRequestResult {
  const issues: ValidationIssue[] = [];

  if (!isObject(body)) {
    return { ok: false, issues: [{ path: '', message: 'expected a JSON object' }] };
  }

  const history: Turn[] = [];
  if (body.history !== undefined) {
    if (!Array.isArray(body.history)) {
      issues.push({ path: 'history', message: 'expected an array' });
    } else if (body.history.length > MAX_TURNS) {
      issues.push({ path: 'history', message: `expected at most ${MAX_TURNS} turns` });
    } else {
      body.history.forEach((turn, index) => {
        checkTurn(turn, `history[${index}]`, issues);
      });
      // Only build the array once every turn passed, so a rejected body never
      // reaches generate() half-validated.
      if (issues.length === 0) {
        body.history.forEach((turn) => {
          const { role, content } = turn as TutorMessage;
          history.push({ role, content });
        });
      }
    }
  }

  // A history that does not open with a user turn is a client that lost its start,
  // and the API rejects the whole call for it — so say so here, where the page can.
  if (history.length > 0 && history[0].role !== 'user') {
    issues.push({ path: 'history', message: 'expected the history to start with a user turn' });
  }

  // ...and it must therefore close on an assistant turn, which the loop below never gets
  // to check. `generate()` appends the current turn to the history rather than replacing
  // it — `[...history, { role: 'user' }]` — so the array the API sees is one turn longer
  // than this one and always ends on the learner. The loop compares `history[i]` with
  // `history[i - 1]` from index 1, which checks every pair *inside* the history and stops
  // one pair short of the seam: an odd length ending on `user` passed every rule above,
  // reached generate(), and went to the provider as two learner turns running. That comes
  // back a 400, falls through the route's catch-all, and is answered `502 ai_unavailable`
  // — a caller's malformed history reported as our outage, which is precisely what the
  // in-history check below was added for, one turn further on than where it stops.
  const lastTurn = history[history.length - 1];
  if (lastTurn && lastTurn.role !== 'assistant') {
    issues.push({
      path: `history[${history.length - 1}]`,
      message: 'expected the history to end with an assistant turn',
    });
  }

  // The API rejects a conversation that does not alternate either, and that check was
  // missing here — so such a history passed validation, reached generate(), came back
  // from the provider as a 400, and fell into the route's catch-all as
  // `502 ai_unavailable`. The learner's own malformed history, reported as our outage.
  // This is the other half of the rule the starts-with-a-user check already enforces, in the same
  // place, for the same reason: lib/ai.ts states both constraints and enforces neither.
  history.forEach((turn, index) => {
    if (index > 0 && turn.role === history[index - 1].role) {
      issues.push({
        path: `history[${index}]`,
        message: `expected a role change from history[${index - 1}], got another ${turn.role} turn`,
      });
    }
  });

  if (typeof body.message !== 'string') {
    issues.push({ path: 'message', message: 'expected a string' });
  } else if (body.message.trim().length < MIN_MESSAGE_CHARS) {
    issues.push({ path: 'message', message: 'expected a non-empty message' });
  } else if (body.message.length > MAX_MESSAGE_CHARS) {
    issues.push({
      path: 'message',
      message: `expected at most ${MAX_MESSAGE_CHARS} characters`,
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { history, user: body.message as string } };
}

export type TutorReplyResult =
  | { ok: true; value: TutorReply }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Clip an over-long model string to its cap, marked as clipped.
 *
 * A copy of `clip` in lib/writing.ts rather than an import. This used to send the reader
 * there for the reason and find none — lib/writing.ts notes only that the three clip the
 * same way, which is why clipping, not why copying. The reason is in lib/placement.ts:
 * the three model-output parsers each carry their own `isObject`, and a shared module for
 * a two-line pure function is not worth the coupling.
 *
 * It keeps the property the docstring on `parseTutorReply` depends on — nothing longer
 * than MAX_REPLY_CHARS reaches the transcript or the next request's history — while
 * letting the learner keep the first two thousand characters of an answer that had
 * something useful in it. Rejecting instead discarded the whole reply.
 */
const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/**
 * Model output is untrusted input. output_config.format makes it schema-shaped, not
 * correct, and this string is rendered straight into the transcript and re-posted as
 * history on the next turn — so the cap is the only thing standing between a rambling
 * model answer and an ever-growing request.
 */
export function parseTutorReply(raw: unknown): TutorReplyResult {
  const issues: ValidationIssue[] = [];

  if (!isObject(raw)) {
    return { ok: false, issues: [{ path: '', message: 'expected a JSON object' }] };
  }

  if (typeof raw.reply !== 'string' || raw.reply.trim().length === 0) {
    issues.push({ path: 'reply', message: 'expected a non-empty string' });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { reply: clip(raw.reply as string, MAX_REPLY_CHARS) } };
}
