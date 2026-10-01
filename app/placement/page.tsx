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
   * The scoring rule, for the same reason. Re-declared here as a literal it had
   * nothing keeping it equal to the one the route scored with, and the two drifted
   * apart silently: the card ticked off A2 and B1 for a learner the same response
   * had just placed at A1, with nothing on screen to reconcile the two.
   */
  passRate: number;
  levels: PlacementLevel[];
}

/** The route answers with a code, not a sentence. Show the learner a sentence. */
const ERROR_TEXT: Record<string, string> = {
  invalid_json: 'The server could not read that submission.',
  invalid_payload: 'Please answer every question before submitting.',
  ai_refusal: 'The writing could not be graded right now. Your quiz score is unaffected.',
  ai_unavailable: 'The writing could not be graded right now. Your quiz score is unaffected.',
};

export default function PlacementPage() {
  const [bundle, setBundle] = useState<PlacementBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [writing, setWriting] = useState('');
  const [result, setResult] = useState<Placement | null>(null);
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
    setAnswers(new Array<number | null>(bundle?.questions.length ?? 0).fill(null));
    setWriting('');
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
      setResult(data as Placement);
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
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{loadError}</p>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center px-4 py-24 sm:px-6">
        <Loader2
          className="h-6 w-6 animate-spin text-indigo-500"
          aria-label="Loading the placement test"
        />
      </div>
    );
  }

  if (result) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
          <div className="text-center">
            <GraduationCap className="mx-auto h-9 w-9 text-indigo-600 dark:text-indigo-400" />
            <p className="mt-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Your English level
            </p>
            <p className="mt-1 text-6xl font-black text-gray-900 dark:text-white">{result.level}</p>
            {result.cappedByWriting && (
              <p className="mx-auto mt-3 max-w-md text-xs text-amber-700 dark:text-amber-400">
                Your written answer was graded a level below your quiz score, so the lower of the
                two was used. Both matter.
              </p>
            )}
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {bundle.levels.map((level) => {
              const bucket = result.objective.byLevel[level];
              const held = bucket.rate >= bundle.passRate;
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
              Your writing was not graded, so this result comes from the quiz alone. That is
              normal — the writing check is optional.
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
          Placement Test
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
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
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
