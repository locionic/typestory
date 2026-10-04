'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, PenLine, Sparkles, ArrowLeft } from 'lucide-react';
// Type-only: erased at compile time, so the system prompt in lib/writing.ts never
// reaches the browser bundle. A value import here would ship it.
import type { CorrectionReport } from '../../lib/writing';

interface Bundle {
  minTextChars: number;
  maxTextChars: number;
}

const ERROR_TEXT: Record<string, string> = {
  invalid_json: 'The server could not read that submission.',
  invalid_payload: 'Please paste a little more writing before checking it.',
  invalid_model_output: 'The correction came back unusable. Please try again.',
  ai_refusal: 'The model declined to grade that text. Please try again.',
  ai_unavailable: 'The correction service is not reachable right now. Please try again.',
};

/**
 * The page's name, in both of the states the page has.
 *
 * One constant rather than the same string written twice, because the two must not drift:
 * the loading state exists to name the page, and it stops doing that the moment the two
 * copies disagree.
 */
const HEADING = 'Get your writing corrected';

/** Where the draft waits out a reload. Per device: never in the backup payload. */
const DRAFT_KEY = 'typestory:writing';

interface SavedDraft {
  text: string;
  report: CorrectionReport | null;
}

/**
 * The learner's own writing, and the correction of it, outlive the visit.
 *
 * Both lived in component state and nowhere else, so a refresh — or a tab closed and
 * reopened — cost the learner their essay, which is their own work and, as the comment on
 * "Check something else" below already puts it, exists nowhere else: no copy, no history,
 * no undo. The correction went with it, which is the half worth thinking about twice,
 * because it is a model call's work and the *only* way to get it back is to pay for it
 * again.
 *
 * The two halves are validated apart, because they are not worth the same. A report this
 * cannot read is dropped and the text kept: the correction is replaceable by asking again,
 * the essay is not. One invalid field costing the other half is the failure mode this
 * ordering exists to prevent.
 */
function loadDraft(): SavedDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { text: '', report: null };
    const parsed = JSON.parse(raw) as Partial<SavedDraft> | null;
    return {
      text: typeof parsed?.text === 'string' ? parsed.text : '',
      report: Array.isArray(parsed?.report?.improvements) ? parsed.report : null,
    };
  } catch {
    return { text: '', report: null };
  }
}

function saveDraft(draft: SavedDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A browser that refuses the write still has the essay on screen and still grades it;
    // it just will not survive a reload. Nothing to report, nothing to retry.
  }
}

export default function WritingPage() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Read once, on the first render, and read by both. Safe from a hydration mismatch for
  // the same reason the placement page's is: the server has no localStorage and never gets
  // past `if (!bundle)`, so neither the server nor the first client render reaches either
  // the report or the editor.
  const [draft] = useState(loadDraft);
  const [text, setText] = useState(draft.text);
  const [report, setReport] = useState(draft.report);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/writing');
        if (!res.ok) throw new Error('load');
        const data = (await res.json()) as Bundle;
        if (!cancelled) setBundle(data);
      } catch {
        if (!cancelled) setLoadError('Could not reach the correction service.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    if (!bundle) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/writing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      const data = (await res.json()) as { report?: CorrectionReport; error?: string };
      if (!res.ok || !data.report) throw new Error(data.error ?? 'unknown');
      saveDraft({ text, report: data.report });
      setReport(data.report);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setSubmitError(ERROR_TEXT[code] ?? 'The correction failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
        {/* `role="alert"`, for the same reason as the correction's own failure below: this
            is the whole result of arriving here, and nothing else renders. It is the worse
            of the two, because this branch replaces the page rather than joining it — a
            screen reader user is left in silence on a page they cannot type into, with no
            way to tell it from one that never loaded. Pinned in test/loadErrors.test.ts. */}
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
        <h1 className="text-3xl font-black text-gray-900 sm:text-4xl dark:text-white">
          {HEADING}
        </h1>
        <div className="mt-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" role="status" aria-label="Loading" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
          <PenLine className="h-3.5 w-3.5" />
          <span>Writing Correction</span>
        </div>
        <h1 className="text-3xl font-black text-gray-900 sm:text-4xl dark:text-white">
          {HEADING}
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">
          Paste something you wrote in English. You get back how a fluent speaker would
          phrase it, plus each change explained.
        </p>
      </div>

      {report ? (
        <div className="space-y-5">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
              <Sparkles className="h-4 w-4 text-indigo-500" />
              What to work on
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {report.summary}
            </p>

            <h3 className="mt-6 text-xs font-bold uppercase tracking-wider text-gray-400">
              Corrected version
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200">
              {report.corrected}
            </p>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
              {/* Not "Every change": `parseCorrectionReport` slices to MAX_IMPROVEMENTS
                  rather than discarding the report, so a model that answered with more
                  than that would otherwise be described as complete when it is not. */}
              Changes ({report.improvements.length})
            </h2>
            {report.improvements.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                Nothing needed changing. That text was already correct.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {report.improvements.map((item, index) => (
                  <li
                    key={index}
                    className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 dark:border-gray-800 dark:bg-gray-800/60"
                  >
                    <p className="flex flex-wrap items-center gap-2 font-mono text-sm">
                      <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-rose-700 line-through dark:text-rose-300">
                        {item.original}
                      </span>
                      <ArrowLeft className="h-3.5 w-3.5 text-gray-400" />
                      <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-700 dark:text-emerald-300">
                        {item.corrected}
                      </span>
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      {item.note}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              // The report goes; the writing stays.
              //
              // It used to set the text to `''` as well, on the reasoning that a learner
              // pressing this is starting something else and should not find a graded essay
              // waiting to be submitted again by muscle memory. That is true, and this is
              // the only way back off the report — so it was also the one click that
              // destroyed both halves at once: the correction *and* the essay it was
              // explaining, which is the learner's own work and exists nowhere else. There
              // is no copy, no history and no undo, and the report is gone too, so the
              // explanation of why "go" became "went" is gone with the sentence.
              //
              // Keeping the text answers the re-submission worry by making it visible rather
              // than hidden: the button this returns to reads "Check my writing", not
              // "Check something else", and the learner's own words are sitting in the box
              // being looked at. Pressing it again is then a decision rather than a
              // surprise, and it costs exactly what the first correction cost.
              // Forgetting the correction must not forget the essay with it. That was
              // already the deliberate decision above — the button clears the report and
              // leaves the words in the box — and it now has to survive a reload as well,
              // or a learner who reloads after pressing it finds the box empty too.
              saveDraft({ text, report: null });
              setReport(null);
            }}
            className="w-full rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Check something else
          </button>
        </div>
      ) : (
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
          <label htmlFor="writing-text" className="text-sm font-bold text-gray-900 dark:text-white">
            Your writing
          </label>
          <textarea
            id="writing-text"
            rows={9}
            value={text}
            // Enforced here rather than diagnosed on submit: an over-long text is
            // `invalid_payload` server-side, and the page can say so exactly.
            maxLength={bundle.maxTextChars}
            // Editing needs no invalidation, and had none: `onChange` carried
            // `if (report) setReport(null)` to satisfy "feedback for text that is no longer
            // on screen is worse than no feedback at all", inside the branch of the
            // `report ? … : …` above that renders only when `report` is falsy. The claim is
            // true and structural — this box and the report cannot both be mounted, and the
            // only route back clears the report — so the guard was a comment's worth of
            // mechanism for something the markup already guaranteed. See the same removal
            // on the tutor's `draft.length` guard, and `test/writingPage.test.ts` for the
            // invariant that now holds it instead.
            onChange={(event) => {
              setText(event.target.value);
              // Saved per keystroke, and per keystroke is the point: the loss this fixes is
              // a refresh *while writing*, which no amount of saving on submit would catch.
              // A 4KB `setItem` per character is cheap, and the alternative is a debounce
              // whose only job is to exist. `report: null` is not a guess — the editor and
              // the report cannot both be mounted, so a change here can only ever be to a
              // draft that has no correction yet. See the note above the `onChange`.
              saveDraft({ text: event.target.value, report: null });
            }}
            placeholder="Yesterday I go to the market with my sister. She buy a lot of vegetables and we come back home very late…"
            className="mt-3 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-800 outline-none transition focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
          />
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            {text.trim().length < bundle.minTextChars
              ? `At least ${bundle.minTextChars} characters so there is something to check.`
              : `${text.trim().length.toLocaleString()} characters · ${bundle.maxTextChars.toLocaleString()} maximum.`}
          </p>

          {submitError && (
            // `role="alert"`, for the same reason as the tutor's: the correction is the
            // whole result of pressing the button, focus has not moved anywhere, and
            // without this the learner is told nothing — including which of the route's
            // three failure codes they hit, which is the one thing those codes are for.
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
            >
              {submitError}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || text.trim().length < bundle.minTextChars}
            className="mt-4 w-full rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Checking your writing…' : 'Check my writing'}
          </button>
        </div>
      )}
    </div>
  );
}