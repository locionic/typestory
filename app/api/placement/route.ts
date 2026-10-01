import { AiRefusalError, createModelClient, isAiConfigured } from '../../../lib/ai';
import {
  MAX_WRITING_CHARS,
  PASS_RATE,
  PLACEMENT_LEVELS,
  WRITING_GRADE_SCHEMA,
  WRITING_TASK,
  buildWritingRequest,
  decideLevel,
  parsePlacementRequest,
  parseWritingGrade,
  publicQuestions,
  scoreObjective,
} from '../../../lib/placement';

/**
 * CEFR A1–B1 placement test.
 *
 *   GET  /api/placement              -> 200 { questions, writingTask, maxWritingChars,
 *                                            passRate, levels }
 *   POST /api/placement { answers, writing? }
 *                                    -> 200 { level, cappedByWriting, objective, writing }
 *                                       400 | 415 | 502
 *
 * The quiz is scored here in code; only the writing is sent to a model. With no
 * ANTHROPIC_API_KEY the writing half is skipped rather than failed — TypeStory is
 * client-side-first and free, so an AI key must never gate the core experience.
 * The same rule covers a model that answers unusably: `writing` comes back null and
 * the quiz still places the learner. Only 502s that say the tutor itself is broken
 * — a refusal or a transport failure — take the whole request down with them.
 *
 * `maxWritingChars`, `passRate` and `levels` travel in the GET response rather than
 * being imported by the page: they live beside the answer key, and a value import
 * would pull the whole module — key included — into the browser bundle. The page
 * rendered the scoring rule from its own literals, which then had nothing keeping
 * them equal to the ones used here; the result card ticked off A2 and B1 for a
 * learner the same response had just placed at A1.
 */

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function GET() {
  return json(
    {
      questions: publicQuestions(),
      writingTask: WRITING_TASK,
      maxWritingChars: MAX_WRITING_CHARS,
      passRate: PASS_RATE,
      levels: PLACEMENT_LEVELS,
    },
    200,
  );
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

  const parsed = parsePlacementRequest(body);
  if (!parsed.ok) {
    return json({ error: 'invalid_payload', issues: parsed.issues }, 400);
  }

  const { answers, writing } = parsed.value;
  const objective = scoreObjective(answers);

  let grade = null;
  // An empty box is not an error and an unconfigured key is not a failure: both
  // just mean the quiz decides the level on its own.
  if (writing && writing.trim() !== '' && isAiConfigured()) {
    try {
      const client = createModelClient();
      const output = await client.generate({
        ...buildWritingRequest(writing),
        schema: WRITING_GRADE_SCHEMA,
      });
      const checked = parseWritingGrade(output);
      if (!checked.ok) {
        // Degraded, not failed. The quiz is already scored above and decideLevel
        // places someone with no writing grade — that is what an unconfigured key
        // and an empty box both do. Returning 502 here threw the scored quiz away
        // with the reply: twelve correct answers came back as an error body with no
        // level in it, while the page was telling the learner their quiz score was
        // unaffected. An optional half must not gate the whole test, so the same
        // rule that skips the writing without a key skips it when the model
        // overran a cap.
        //
        // Logged, not returned: the learner gets a real result either way, so this
        // is the only place an operator learns their model never complies.
        console.error('[placement] writing grade rejected:', checked.issues);
      } else {
        grade = checked.value;
      }
    } catch (error) {
      // Log server-side so the failure is not silent; the client gets a code, never
      // the message, which would carry request detail.
      console.error('[placement] writing grade failed:', error);
      return json(
        { error: error instanceof AiRefusalError ? 'ai_refusal' : 'ai_unavailable' },
        502,
      );
    }
  }

  return json(decideLevel(objective, grade), 200);
}
