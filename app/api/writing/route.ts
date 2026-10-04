import { aiFailureCode, createModelClient } from '../../../lib/ai';
import { rateLimited } from '../../../lib/rate-limit';
import {
  CORRECTION_SCHEMA,
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
  buildCorrectionRequest,
  parseCorrectionReport,
  parseWritingRequest,
} from '../../../lib/writing';

/**
 * English writing correction.
 *
 *   GET  /api/writing              -> 200 { minTextChars, maxTextChars }
 *   POST /api/writing { text }     -> 200 { report }
 *                                      400 | 415 | 502
 *
 * The caps travel in the GET body rather than being imported by the page:
 * `MAX_TEXT_CHARS` lives beside the system prompt, and a value import would pull
 * the whole module — prompt included — into the browser bundle. The page takes
 * the *type* it needs with `import type`, which the compiler erases.
 *
 * TypeStory is client-side-first and free, so a feature that cannot reach the model
 * is reported as a code the page can explain — never a 500, and never a gate on
 * anything else in the app.
 */

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function GET() {
  return json({ minTextChars: MIN_TEXT_CHARS, maxTextChars: MAX_TEXT_CHARS }, 200);
}

export async function POST(request: Request) {
  // Ahead of everything else here, the content-type check included: the whole cost of
  // this handler is the `generate` call below, and there is no account in front of it.
  // See lib/rate-limit.ts for why the ceiling is the only thing there is.
  const throttled = rateLimited(request);
  if (throttled) return throttled;

  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Malformed JSON is the client's fault, not a server error.
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseWritingRequest(body);
  if (!parsed.ok) {
    return json({ error: 'invalid_payload', issues: parsed.issues }, 400);
  }

  try {
    const client = createModelClient();
    const output = await client.generate({
      ...buildCorrectionRequest(parsed.value.text),
      schema: CORRECTION_SCHEMA,
      // Open-ended prose rather than a classification, so it gets the depth and
      // the token budget to produce a full rewrite and several notes.
      effort: 'high',
      maxTokens: 4000,
    });

    const checked = parseCorrectionReport(output);
    if (!checked.ok) {
      return json({ error: 'invalid_model_output', issues: checked.issues }, 502);
    }
    return json({ report: checked.value }, 200);
  } catch (error) {
    // Log server-side so the failure is not silent; the client gets a code, never
    // the message, which would carry request detail.
    console.error('[writing] correction failed:', error);
    return json({ error: aiFailureCode(error) }, 502);
  }
}