import { createModelClient } from '../../../lib/ai';
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
 *                                    -> 200 { level, cappedByWriting, objective, writing,
 *                                              writingOutcome }
 *                                       400 | 415
 *
 * `writingOutcome` is `'graded' | 'skipped' | 'failed'` and is part of what the page is
 * given, not a detail of how it was produced. A `writing: null` on its own cannot say
 * whether the learner left the box empty or their essay was refused by the model, and the
 * card needs the difference: "that is normal — the writing check is optional" is false of
 * an essay that was thrown away. Listing the other four fields without it documented a
 * contract the page's own copy depends on but which the contract did not mention.
 *
 * The quiz is scored here in code; only the writing is sent to a model. Every way
 * the writing half fails leaves `writing` null and still places the learner —
 * TypeStory is client-side-first and free, so an AI key must never gate the core
 * experience. There is no request that reaches the
 * model and takes the test down with it — the writing is optional on the way in, so
 * it is optional on the way out, and a valid submission always gets a level.
 *
 * `maxWritingChars`, `passRate` and `levels` travel in the GET response rather than
 * being imported by the page: they live beside the answer key, and a value import
 * would pull the whole module — key included — into the browser bundle. The page
 * rendered the scoring rule from its own literals, which then had nothing keeping
 * them equal to the ones used here; the result card ticked off A2 and B1 for a
 * learner the same response had just placed at A1.
 */

/**
 * Why the writing half is or is not on the result, so the card can say which.
 *
 * `skipped` is the one voluntary case — an empty box — and `failed` is everything that
 * went wrong after the learner chose to write something. It used to name a second
 * skipped case, "no key on this instance", and that stopped being true when the auth
 * gate came out: `createModelClient` no longer refuses a missing key, so a machine that
 * cannot authenticate reaches `generate()` and fails there instead, which is a
 * `failed`. A learner on such a machine wrote an essay and had it dropped, and "that is
 * normal — the writing check is optional" is not what happened to them.
 *
 * These four outcomes used to arrive identically, as `writing: null`, and the page
 * rendered all of them as "Your writing was not graded… That is normal — the writing
 * check is optional". Over a refusal or an outage that sentence is false: something
 * did go wrong, the learner was told nothing did, and there was no signal anywhere that
 * would let them tell the difference. Degrading was the right call and stays; degrading
 * *silently* was not, and this is the smallest thing that fixes it — the route already
 * knew the reason in every branch and threw the knowledge away.
 *
 * A coarse field on purpose. The learner has one decision to make about this — whether
 * the level above is still worth having, which it is either way — so three states
 * answer it and a per-failure taxonomy would only be a more interesting lie.
 */
type WritingOutcome = 'graded' | 'skipped' | 'failed';

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
  // An empty box is not an error: it just means the quiz decides the level alone.
  // This used to read "and an unconfigured key is not a failure" — a clause that
  // made a working credential look like an absent one, and told the learner their
  // essay was skipped by choice when it had in fact been dropped.
  let outcome: WritingOutcome = 'skipped';
  if (writing && writing.trim() !== '') {
    // From here on anything that goes wrong is a failure, not a choice — the learner
    // wrote something and asked for it to be graded.
    outcome = 'failed';
    try {
      const client = createModelClient();
      const output = await client.generate({
        ...buildWritingRequest(writing),
        schema: WRITING_GRADE_SCHEMA,
      });
      const checked = parseWritingGrade(output);
      if (!checked.ok) {
        // Degraded, not failed. The quiz is already scored above and decideLevel
        // places someone with no writing grade — that is what an empty box does.
        // Returning 502 here threw the scored quiz away
        // with the reply: twelve correct answers came back as an error body with no
        // level in it, while the page was telling the learner their quiz score was
        // unaffected. An optional half must not gate the whole test, so the same
        // rule that skips an empty box skips it when the model
        // overran a cap.
        //
        // Logged, not returned: the learner gets a real result either way, so this
        // is the only place an operator learns their model never complies.
        console.error('[placement] writing grade rejected:', checked.issues);
      } else {
        grade = checked.value;
        outcome = 'graded';
      }
    } catch (error) {
      // Log server-side so the failure is not silent, and not returned either: the
      // detail carries request material, and the client gets a real result anyway.
      console.error('[placement] writing grade failed:', error);

      // Every way the optional half can fail ends here, and all of them degrade.
      //
      // A grade cut off at `max_tokens` arrived by throwing rather than by parsing, which
      // is why this branch existed alongside the `!checked.ok` one — and needing to tell
      // them apart was the signal that the split was itself wrong. A refusal and a
      // transport failure are the two that remained, and from the learner's side they
      // are the *same* situation: the writing could not be graded, so the quiz grades
      // alone, exactly as an empty box does.
      //
      // What they cost instead was the whole test. The 502 discarded a quiz already
      // scored above, and the page's only way out of the form is the result card, so
      // the learner re-submitted into the same failure — told on the way that "your
      // quiz score is unaffected". It was not. Every other writing failure here already
      // degrades, so this was the inconsistency rather than the policy.
      grade = null;
    }
  }

  return json({ ...decideLevel(objective, grade), writingOutcome: outcome }, 200);
}
