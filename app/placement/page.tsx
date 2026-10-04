'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, GraduationCap, AlertCircle, Loader2 } from 'lucide-react';
// `import type` is erased at compile time, so the question bank and its answer key
// never reach the browser. The questions arrive from GET /api/placement instead.
import type { Placement, PlacementLevel, PublicQuestion } from '../../lib/placement';

interface PlacementBundle {
  questions: PublicQuestion[];
  writingTask: { prompt: string };
  /** Served by GET so the cap lives beside the answer key, not in this bundle. */
  maxWritingChars: number;
  /**
   * The scoring rule, for the same reason. Declared here but deliberately not read:
   * this card no longer re-derives whether a level was passed, because that is the one
   * thing it got wrong. It compared each level's own rate to this number independently,
   * while `cascade` in lib/placement.ts breaks at the first level that misses — so a
   * learner scoring 2/4 on A1 and 4/4 on both A2 and B1 was placed at A1 and shown a
   * green tick on A2 and B1, with nothing on screen reconciling the two.
   *
   * `result.objective.level` is that cascade's own answer, computed by the same code that
   * scored the answers. A card that reads the decision instead of repeating the rule
   * cannot disagree with it. The one thing still worth the rate is the sentence under the
   * grid, which exists to explain a result this rule produces.
   */
  passRate: number;
  levels: PlacementLevel[];
}

/**
 * The route answers with a code, not a sentence. Show the learner a sentence.
 *
 * No writing-failure code appears here because the route no longer sends one. Every way
 * the optional writing half fails — refused, unreachable, truncated, over a cap — now
 * returns a real placement with `writing: null`, and the result card says so in the
 * panel that already existed for an ungraded essay.
 *
 * `ai_refusal` and `ai_unavailable` used to sit here, both promising "your quiz score is
 * unaffected" — over a 502 that had thrown the quiz away with the reply. That promise
 * was the worst of it: the learner believed twelve answered questions were safe, had no
 * way back to the form's results, and re-submitted into the same failure. The route
 * decides that now, so a code here cannot outlive the behaviour behind it.
 *
 * The route does still say *which* of those it was — see `writingOutcome` — because
 * degrading without saying so left this card asserting that a refusal was "normal".
 */
const ERROR_TEXT: Record<string, string> = {
  invalid_json: 'The server could not read that submission.',
  invalid_payload: 'Please answer every question before submitting.',
};

/**
 * The placement, plus why the writing half is missing when it is.
 *
 * `writingOutcome` is optional so a response served from a cache written by the previous
 * build degrades to the sentence below rather than rendering `undefined` at a learner.
 */
type PlacementResult = Placement & {
  writingOutcome?: 'graded' | 'skipped' | 'failed';
};

/**
 * The page's name, in both of the states the page has.
 *
 * One constant rather than the same string written twice, because the two must not drift:
 * the loading state exists to name the page, and it stops doing that the moment the two
 * copies disagree.
 */
const HEADING = 'Placement Test';

/** Where the last result waits out a reload. Per device: never in the backup payload. */
const RESULT_KEY = 'typestory:placement';

/**
 * The result outlives the visit, which it used not to.
 *
 * It lived in component state and nowhere else, so a learner who refreshed — or closed the
 * tab and came back next week — lost a level that had cost twelve answers and a graded
 * essay to earn, and the only way back to it was to answer all twelve again, for a fresh
 * model call that need not return the same band. `restart` below already called that out
 * to anyone about to press the button; nothing stopped the browser doing it unasked.
 *
 * Guarded rather than trusted, because localStorage is shared with every other script on
 * the origin and this value is re-read on every visit rather than once. Same field
 * `submit` trusts, one notch stricter: `byLevel` must be an object, because the card does
 * `byLevel[level].rate` and a foreign blob storing a string there throws *inside* a render,
 * which tears the document down. Anything unreadable reads as "no result" instead.
 */
function loadResult(): PlacementResult | null {
  try {
    const raw = localStorage.getItem(RESULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlacementResult | null;
    const byLevel = parsed?.objective?.byLevel;
    return typeof byLevel === 'object' && byLevel !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** `null` forgets the result, which is what makes `restart`'s confirmation true. */
function storeResult(value: PlacementResult | null): void {
  try {
    if (value) localStorage.setItem(RESULT_KEY, JSON.stringify(value));
    else localStorage.removeItem(RESULT_KEY);
  } catch {
    // A browser that refuses the write still has the result on screen; it just will not
    // survive a reload. There is nothing to report and nothing to retry.
  }
}

export default function PlacementPage() {
  const [bundle, setBundle] = useState<PlacementBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [writing, setWriting] = useState('');
  // Restored synchronously rather than in a `useState` effect, which `set-state-in-effect`
  // rightly objects to: reading a stored value into state on every visit costs a render
  // pass to deliver nothing the first render did not already have.
  //
  // The obvious objection is hydration — the server has no localStorage, so it starts from
  // `null` and the client would begin from a result. That is safe here only because of the
  // order of the branches below: `!bundle` returns first, so neither the server nor the
  // first client render ever reaches the card, and the bundle only arrives in an effect
  // afterwards. Hoisting `if (result)` above `if (!bundle)` is what would break it, and it
  // is a one-line edit that looks like tidying.
  const [result, setResult] = useState<PlacementResult | null>(() => loadResult());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/placement')
      .then((res) => {
        if (!res.ok) throw new Error('load');
        return res.json();
      })
      .then((data: PlacementBundle) => {
        if (cancelled) return;
        setBundle(data);
        setAnswers(new Array<number | null>(data.questions.length).fill(null));
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the placement test. Please refresh.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const answered = answers.filter((answer) => answer !== null).length;
  const complete = bundle !== null && answered === bundle.questions.length;

  const restart = () => {
    // The one destructive control in the app with nothing standing in front of it.
    //
    // Every result this page produces is kept in localStorage and nowhere else — there is
    // no `placementLevel` on `UserStats` and no field on the progress record, so it is not
    // backed up either — so this is not "start again", it is the only copy of twelve
    // answers, a level, a per-level breakdown and a writing grade going away, with the
    // learner's next way of getting them back being to answer all twelve again. And it is
    // a fresh model call each time, so the same twelve answers do not have to produce the
    // same level.
    //
    // Nothing about the click said so. The button reads "Retake the test", which describes
    // what happens next and is silent about what is being given up, and it sits directly
    // under the result it destroys — the one place a mis-click is most likely, and the one
    // where it costs the most. `StatsModal` confirms on all three of its irreversible
    // actions, and this is the fourth; the sentence it needs is the one that was missing.
    if (
      result &&
      !confirm(
        'Start the test again? This result will be discarded — the level, the per-level ' +
          'breakdown and the writing grade. There is no way to get this one back except ' +
          'by answering every question again.',
      )
    ) {
      return;
    }

    setAnswers(new Array<number | null>(bundle?.questions.length ?? 0).fill(null));
    setWriting('');
    // Forget the stored copy too, or the confirmation above stops being true: `setResult`
    // empties the screen and the next reload would put the card straight back.
    storeResult(null);
    setResult(null);
    setSubmitError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bundle || !complete || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/placement', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers, writing }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'unknown');
      // The other two AI-backed pages guard this body — `!data.report`, `!data.reply` —
      // and this one trusted it whole. `result.objective.byLevel[level]` is dereferenced
      // during the next render, so a 200 carrying anything unexpected threw *inside* that
      // render: React tore the document down, and a learner who had just answered twelve
      // questions was left with a blank page and no sentence at all. The fallback is this
      // page's own, so an unusable reply reads like any other failure.
      //
      // `byLevel` alone, because it is the only field whose absence crashes: `objective.level`
      // merely falls out of `indexOf` as -1, and the headline renders whatever is there.
      if (!data?.objective?.byLevel) throw new Error('unknown');
      storeResult(data as PlacementResult);
      setResult(data as PlacementResult);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setSubmitError(ERROR_TEXT[code] ?? 'The placement test failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
        {/* `role="alert"`, for the same reason as the placement's own failure below: this
            is the whole result of arriving here, and nothing else renders. It is the worse
            of the two, because this branch replaces the page rather than joining it — a
            screen reader user is left in silence on a page they cannot start, with no way
            to tell it from one that never loaded. Pinned in test/loadErrors.test.ts. */}
        <p
          role="alert"
          className="mt-3 text-sm text-gray-600 dark:text-gray-400"
        >
          {loadError}
        </p>
      </div>
    );
  }

  if (!bundle) {
    // The heading belongs to the page, not to the bundle, so it does not wait for it —
    // see the same note on the tutor page. Before this the whole document was a spinner.
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-center sm:px-6 sm:py-12">
        <h1 className="text-3xl font-black text-gray-900 dark:text-white sm:text-4xl">
          {HEADING}
        </h1>
        <div className="mt-8 flex justify-center">
          <Loader2
            className="h-6 w-6 animate-spin text-indigo-500"
            role="status"
            aria-label="Loading the placement test"
          />
        </div>
      </div>
    );
  }

  if (result) {
    const passedRank = bundle.levels.indexOf(result.objective.level);
    // Whether the conjunction cost the learner something they can see: a level they scored
    // well on that the cascade could not reach. Only then is the sentence under the grid
    // explaining anything, so it is the condition for printing it.
    const outranked = bundle.levels.some(
      (level, index) =>
        index > passedRank && result.objective.byLevel[level].rate >= bundle.passRate,
    );
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
          <div className="text-center">
            <GraduationCap className="mx-auto h-9 w-9 text-indigo-600 dark:text-indigo-400" />
            <p className="mt-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Your English level
            </p>
            <p className="mt-1 text-6xl font-black text-gray-900 dark:text-white">{result.level}</p>
            {result.cappedByWriting && result.writing && (
              // The two levels, not the distance between them. `cappedByWriting` is set
              // whenever the writing band ranks below the quiz's, and PLACEMENT_LEVELS has
              // three entries — so the gap is one level *or* two, and this sentence used to
              // call it "a level below" either way. A learner who aces the grammar quiz and
              // writes at A1 is capped from B1 to A1, and is told they lost one level.
              //
              // Neither number was otherwise reachable: the headline is the level that was
              // used, and the feedback card below names the writing band, so the quiz's own
              // result appeared nowhere. Reading them off the result is also what keeps this
              // sentence true — a written magnitude is one more thing to fall out of step.
              <p className="mx-auto mt-3 max-w-md text-xs text-amber-700 dark:text-amber-400">
                Your quiz placed you at {result.objective.level}, but your written answer was
                graded {result.writing.band}, so the lower of the two was used. Both matter.
              </p>
            )}
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {bundle.levels.map((level) => {
              const bucket = result.objective.byLevel[level];
              // The cascade's own verdict, not this card's. `cascade` stops at the first
              // level below the mark, so exactly the levels at or below the one it reached
              // were both passed themselves and reachable — which is the conjunction the
              // rule is written as, and which a per-level rate check is not. Ranking also
              // uses `objective.level` rather than the headline: when the writing grade
              // pulled the result down, the grid is still showing how the quiz went, and
              // unticking a level the quiz genuinely held would trade one wrong tick for
              // another.
              const held = bundle.levels.indexOf(level) <= passedRank;
              return (
                <div
                  key={level}
                  className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-gray-900 dark:text-white">{level}</span>
                    {held && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {bucket.correct}/{bucket.total} correct
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${Math.round(bucket.rate * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {outranked && (
            // Without this the fix is honest but puzzling rather than honest and clear: a
            // full bar and no tick reads as a broken card, and the learner has no way to
            // know the level above was strong and simply had nothing under it to stand on.
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Each level stands on the one below it, so a strong score higher up does not carry
              past a level that was not passed.
            </p>
          )}

          {result.writing ? (
            <div className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-900/60 dark:bg-indigo-950/30">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Writing feedback · {result.writing.band}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {result.writing.rationale}
              </p>
              {result.writing.corrections.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {result.writing.corrections.map((correction, index) => (
                    <li
                      key={index}
                      className="rounded-lg bg-white/70 px-3 py-1.5 font-mono text-xs text-gray-700 dark:bg-gray-900/60 dark:text-gray-300"
                    >
                      {correction}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-6 rounded-2xl border border-gray-200 p-4 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              {/* The two sentences differ on whether anything went wrong, because they
                  used to be one. A learner whose essay was refused or never reached a
                  model was told "that is normal — the writing check is optional", which is
                  a claim about the world that was simply untrue, and the only thing on
                  screen that could have contradicted it. The level above is unaffected
                  either way, so this changes what they are told, not what they are given. */}
              {result.writingOutcome === 'failed'
                ? 'Your writing could not be graded just now, so this result comes from the quiz alone. The level above is unaffected, and you can retake the test with a new essay.'
                : 'Your writing was not graded, so this result comes from the quiz alone. That is normal — the writing check is optional.'}
            </p>
          )}

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={restart}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            >
              Retake the test
            </button>
            <a
              href="/vocab"
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Practise vocabulary
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
          <GraduationCap className="h-3.5 w-3.5" />
          <span>CEFR A1&ndash;B1</span>
        </div>
        <h1 className="text-3xl font-black text-gray-900 dark:text-white sm:text-4xl">
          {HEADING}
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          {bundle.questions.length} questions plus a short piece of writing. Answer the questions
          first, then write &mdash; your final level is the lower of the two scores.
        </p>
      </div>

      <form onSubmit={submit}>
        <div className="space-y-3">
          {bundle.questions.map((question, index) => (
            <fieldset
              key={question.id}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            >
              <legend className="sr-only">{question.prompt}</legend>
              <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                <span className="mr-2 font-black text-indigo-600 dark:text-indigo-400">
                  {index + 1}.
                </span>
                {question.prompt}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {question.options.map((option, optionIndex) => (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition ${
                      answers[index] === optionIndex
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 dark:border-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-100'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q-${question.id}`}
                      className="accent-indigo-600"
                      checked={answers[index] === optionIndex}
                      onChange={() =>
                        setAnswers((prev) =>
                          prev.map((answer, i) => (i === index ? optionIndex : answer)),
                        )
                      }
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <label
            htmlFor="placement-writing"
            className="text-sm font-bold text-gray-900 dark:text-white"
          >
            Writing
          </label>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{bundle.writingTask.prompt}</p>
          <textarea
            id="placement-writing"
            rows={7}
            value={writing}
            // The cap is enforced here, not diagnosed on submit. An over-long
            // essay is `invalid_payload` server-side, and that one code also
            // means "you left a question blank" — so without this the learner
            // is told to answer questions they already answered.
            maxLength={bundle.maxWritingChars}
            onChange={(event) => setWriting(event.target.value)}
            placeholder="I really enjoy visiting…"
            className="mt-3 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 outline-none transition focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
          />
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            Optional. {bundle.maxWritingChars.toLocaleString()} characters maximum.
          </p>
        </div>

        {submitError && (
          // `role="alert"`, for the same reason as the tutor's and the writer's: this is
          // the whole result of the action and nothing else on the page moves to say so.
          // Nothing is rolled back on a failure — the answers and the writing stay exactly
          // as they were, so the DOM is identical apart from this paragraph — and this is
          // the longest flow in the app. A learner who answered every question and wrote a
          // paragraph was told nothing at all when the submission did not come back.
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
          >
            {submitError}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            {answered} of {bundle.questions.length} answered
          </p>
          <button
            type="submit"
            disabled={!complete || submitting}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Grading…' : 'See my level'}
          </button>
        </div>
      </form>
    </div>
  );
}
