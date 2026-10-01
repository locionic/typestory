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
  ai_not_configured:
    'This instance has no ANTHROPIC_API_KEY set, so there is nothing to grade with. Everything else in TypeStory works without one.',
};

export default function WritingPage() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [report, setReport] = useState<CorrectionReport | null>(null);
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
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{loadError}</p>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center px-4 py-24 sm:px-6">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" aria-label="Loading" />
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
          Get your writing corrected
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
              Every change ({report.improvements.length})
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
                    className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 dark:border-gray-800 dark:bg-gray-850/60"
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
              setReport(null);
              setText('');
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
            onChange={(event) => {
              setText(event.target.value);
              // Editing invalidates the report: feedback for text that is no longer
              // on screen is worse than no feedback at all.
              if (report) setReport(null);
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
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
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