import { AiRefusalError, createModelClient, isAiConfigured } from '../../../lib/ai';
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
 *                                           400 | 415 | 502 | 503
 *
 * The caps travel in the GET body for the same reason as /api/writing: the system
 * prompt lives in `lib/tutor.ts`, and a value import would pull all of it into the
 * browser bundle. The page takes the *type* it needs with `import type`.
 *
 * The request is validated before the key is checked, so a malformed history is
 * reported as the client's fault (400) rather than as a missing-key outage (503) —
 * the learner gets "that message was too long" instead of "no AI configured".
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

  if (!isAiConfigured()) {
    return json({ error: 'ai_not_configured' }, 503);
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
      maxTokens: 2000,
    });

    const checked = parseTutorReply(output);
    if (!checked.ok) {
      return json({ error: 'invalid_model_output', issues: checked.issues }, 502);
    }
    return json({ reply: checked.value.reply }, 200);
  } catch (error) {
    console.error('[tutor] reply failed:', error);
    return json({ error: error instanceof AiRefusalError ? 'ai_refusal' : 'ai_unavailable' }, 502);
  }
}
