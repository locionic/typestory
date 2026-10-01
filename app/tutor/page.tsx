'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, MessageCircle, SendHorizonal, Trash2 } from 'lucide-react';
// Type-only: erased at compile time, so the system prompt in lib/tutor.ts never
// reaches the browser bundle. A value import here would ship it.
import type { TutorMessage } from '../../lib/tutor';

interface Bundle {
  maxMessageChars: number;
  maxTurns: number;
}

const ERROR_TEXT: Record<string, string> = {
  invalid_json: 'The server could not read that message.',
  invalid_payload: 'That message could not be sent. Try a shorter one.',
  invalid_model_output: 'The reply came back unusable. Please try again.',
  ai_refusal: 'The model declined to answer that. Try asking about English instead.',
  ai_unavailable: 'The tutor is not reachable right now. Please try again.',
  ai_not_configured:
    'This instance has no ANTHROPIC_API_KEY set, so there is no tutor to talk to. Everything else in TypeStory works without one.',
};

const STARTERS = [
  'What is the difference between "since" and "for"?',
  'Why do we say "I have been" and not "I am been"?',
  'Is "I go to the market yesterday" wrong?',
];

/**
 * The history to post, trimmed to the server's own turn budget.
 *
 * The transcript grows by one user→assistant pair per question and every question
 * re-posts all of it, so the eighth question carried a 14-turn history against a
 * 12-turn cap and was rejected. The failure path rolls the transcript back to what it
 * was, so the ninth question posted the same 14 turns and was rejected identically:
 * the tutor was unusable for the rest of the session, and the learner was told to
 * "try a shorter one" about a message ten characters long.
 *
 * Whole pairs are dropped from the front, which preserves the two things the server
 * checks — an even count, and a slice that opens on a user turn. `send` is the only
 * writer of `transcript` and it appends user-then-assistant to an array that already
 * alternated, so the transcript does too.
 *
 * Only the posted history is trimmed. The transcript on screen is the learner's record
 * of the conversation and is never shortened.
 */
export function trimHistory(turns: TutorMessage[], maxTurns: number): TutorMessage[] {
  const keep = maxTurns - (maxTurns % 2);
  return turns.length <= keep ? turns : turns.slice(turns.length - keep);
}

export default function TutorPage() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TutorMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The transcript grows without bound, and a keyboard user sending a question
  // should land on their own reply rather than have to scroll back up for it.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [transcript, submitting]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/tutor');
        if (!res.ok) throw new Error('load');
        const data = (await res.json()) as Bundle;
        if (!cancelled) setBundle(data);
      } catch {
        if (!cancelled) setLoadError('Could not reach the tutor.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const overCap = bundle !== null && draft.length > bundle.maxMessageChars;

  const send = async (text: string) => {
    if (!bundle || submitting) return;

    // The turn is appended locally and sent as the new current message, so the
    // history the server sees is everything already said minus the current turn.
    // The whole transcript is kept for the display and for rolling back a failed
    // send; only what goes on the wire is trimmed — see trimHistory.
    const soFar = transcript;
    const history = trimHistory(soFar, bundle.maxTurns);
    setTranscript([...soFar, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ history, message: text }),
      });

      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || !data.reply) throw new Error(data.error ?? 'unknown');

      setTranscript((current) => {
        // The last entry is the placeholder the user is looking at; fill it rather
        // than append, or a failed send would leave a second empty bubble.
        const next = [...current];
        next[next.length - 1] = { role: 'assistant', content: data.reply as string };
        return next;
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setSubmitError(ERROR_TEXT[code] ?? 'The tutor could not answer. Please try again.');
      // Drop the placeholder and the turn that triggered it: keeping them would
      // re-post an empty assistant turn as history on the next question.
      setTranscript(soFar);
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
      <div className="mb-6 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
          <MessageCircle className="h-3.5 w-3.5" />
          <span>English Tutor</span>
        </div>
        <h1 className="text-3xl font-black text-gray-900 sm:text-4xl dark:text-white">
          Ask about anything in English
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">
          Ask about grammar, a phrase that did not sound right, or why something is wrong. The
          tutor keeps the conversation, so follow-ups work.
        </p>
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7 dark:border-gray-800 dark:bg-gray-900">
        {transcript.length === 0 ? (
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Try asking</p>
            <ul className="mt-2 space-y-2">
              {STARTERS.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => void send(starter)}
                    className="w-full rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-2.5 text-left text-sm text-gray-700 transition hover:border-indigo-200 hover:bg-indigo-50/60 dark:border-gray-800 dark:bg-gray-950/50 dark:text-gray-300 dark:hover:bg-indigo-950/30"
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="mb-5 space-y-3">
            {transcript.map((message, index) => {
              const isUser = message.role === 'user';
              // The trailing placeholder is the only entry allowed to be empty.
              const isPending = !isUser && message.content === '';
              return (
                <li
                  // Transcript entries are append-only and never reordered or edited,
                  // so the index is a stable identity here.
                  key={index}
                  className={isUser ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={
                      isUser
                        ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-sm leading-relaxed text-white'
                        : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                    }
                  >
                    {isPending ? (
                      <span className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Tutor is replying" />
                        <span className="text-xs">thinking…</span>
                      </span>
                    ) : (
                      message.content
                    )}
                  </div>
                </li>
              );
            })}
            <div ref={endRef} />
          </ul>
        )}

        {submitError && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {submitError}
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text || overCap) return;
            setDraft('');
            void send(text);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="tutor-message" className="sr-only">
            Your question
          </label>
          <textarea
            id="tutor-message"
            rows={2}
            value={draft}
            maxLength={bundle.maxMessageChars}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line. A typing app cannot take
              // Enter away entirely: this is a multi-line box, not a single field.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                const text = draft.trim();
                if (!text || overCap) return;
                setDraft('');
                void send(text);
              }
            }}
            placeholder="Why is it 'I have been' and not 'I am been'?"
            className="flex-1 resize-none rounded-xl border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-800 outline-none transition focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200"
          />
          <div className="flex gap-2 sm:flex-col-reverse sm:justify-end">
            <button
              type="submit"
              disabled={submitting || draft.trim().length === 0 || overCap}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-label="Sending" />
              ) : (
                <SendHorizonal className="h-4 w-4" />
              )}
              Ask
            </button>
            {transcript.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setTranscript([]);
                  setSubmitError(null);
                }}
                disabled={submitting}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
          </div>
        </form>

        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          {overCap
            ? `That is over the ${bundle.maxMessageChars.toLocaleString()} character limit.`
            : 'Enter to send · Shift+Enter for a new line'}
        </p>
      </div>
    </div>
  );
}
