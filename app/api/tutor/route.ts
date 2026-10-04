import { aiFailureCode, createModelClient } from '../../../lib/ai';
import { rateLimited } from '../../../lib/rate-limit';
import {
  MAX_MESSAGE_CHARS,
  MAX_TURNS,
  TUTOR_SCHEMA,
  TUTOR_SYSTEM_PROMPT,
  parseTutorReply,
  parseTutorRequest,
} from '../../../lib/tutor';

/**
 * English tutor chat.
 *
 *   GET  /api/tutor                      -> 200 { maxMessageChars, maxTurns }
 *   POST /api/tutor { history, message } -> 200 { reply }
 *                                           400 | 415 | 502
 *
 * The caps travel in the GET body for the same reason as /api/writing: the system
 * prompt lives in `lib/tutor.ts`, and a value import would pull all of it into the
 * browser bundle. The page takes the *type* it needs with `import type`.
 *
 * The request is validated before the model is called, so a malformed history is
 * reported as the client's fault (400, naming the offending turn) rather than as our
 * outage. It has to be checked here and not left to the provider: every error that
 * escapes `generate()` reaches the catch-all below, and `aiFailureCode` maps all of
 * them to a 502 `ai_unavailable` — a claim about the world, which has to mean the model
 * could not be reached. The learner would be told the tutor is down over a message
 * they simply typed too long.
 */

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function GET() {
  return json({ maxMessageChars: MAX_MESSAGE_CHARS, maxTurns: MAX_TURNS }, 200);
}

export async function POST(request: Request) {
  // Ahead of the content-type check, which is the cheaper thing to lose: a chat turn is
  // the most expensive request this app serves — twelve turns of history to think over
  // at the highest effort — and it is reachable in a loop by anything with a fetch.
  // See lib/rate-limit.ts.
  const throttled = rateLimited(request);
  if (throttled) return throttled;

  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseTutorRequest(body);
  if (!parsed.ok) {
    return json({ error: 'invalid_payload', issues: parsed.issues }, 400);
  }

  try {
    const client = createModelClient();
    const output = await client.generate({
      system: TUTOR_SYSTEM_PROMPT,
      user: parsed.value.user,
      history: parsed.value.history,
      schema: TUTOR_SCHEMA,
      // A chat reply is prose, and unlike placement there is no short answer to
      // grade — so it asks for the same depth as writing correction.
      effort: 'high',
      // And the same ceiling, which is the half of that sentence this route was not
      // honouring: it passed the classification default of 2000, leaving the caller
      // with the most context on the smallest budget. At `effort: 'high'` the
      // reasoning draws on the same allowance as the reply — see the `max_tokens`
      // branch in lib/ai.ts, which names the tutor as the reachable case — and the
      // learner supplies both halves of it, since twelve turns of up to 2000
      // characters each is a great deal to think over.
      maxTokens: 4000,
    });

    const checked = parseTutorReply(output);
    if (!checked.ok) {
      return json({ error: 'invalid_model_output', issues: checked.issues }, 502);
    }
    return json({ reply: checked.value.reply }, 200);
  } catch (error) {
    console.error('[tutor] reply failed:', error);
    return json({ error: aiFailureCode(error) }, 502);
  }
}
