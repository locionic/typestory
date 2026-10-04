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
  // The one code here that is the app's doing rather than an outage, and the only one
  // where waiting is the whole remedy — so it says so, and says what is kept. Without
  // it the fallback two lines down reports the tutor as unable to answer, which is a
  // claim about the world: the tutor is answering fine, just not twenty times a minute.
  // See lib/rate-limit.ts.
  rate_limited: 'Too many messages in a row. Wait a moment and send yours again.',
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

/**
 * The page's name, in both of the states the page has.
 *
 * One constant rather than the same string written twice, because the two must not drift:
 * the loading state exists to name the page, and it stops doing that the moment the two
 * copies disagree.
 */
const HEADING = 'Ask about anything in English';

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
        {/* `role="alert"`, for the same reason as the question's own failure below: this is
            the whole result of arriving here, and nothing else renders. It is the worse of
            the two, because this branch replaces the page rather than joining it — a screen
            reader user is left in silence on a page with no question box to try again on,
            with no way to tell it from one that never loaded. Pinned in
            test/loadErrors.test.ts. */}
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
    // The heading belongs to the page, not to the bundle, so it does not wait for it.
    //
    // This used to return the spinner and nothing else, which made the entire document a
    // picture: no heading, no landmark, no text. That is what a screen reader arrives on,
    // so the learner was told neither that the tutor was loading nor what page they were
    // on, and a keyboard user tabbing straight away landed on nothing. It also meant the
    // heading appeared from nowhere once the fetch landed.
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

  // The window the tutor actually has, for the sentence under the heading.
  //
  // The copy said "the tutor keeps the conversation", which is true of the transcript on
  // screen and false of the one the model reads: `trimHistory` keeps the most recent
  // `maxTurns` turns, so from the seventh question on the tutor has forgotten the first.
  // A learner scrolling back through their own record, asking a follow-up to something at
  // the top, was told their follow-ups worked.
  //
  // A question is a user→assistant pair, so the turns divide by two — the same pairing
  // `trimHistory` drops whole. Understated by one on the turn a question is asked, since
  // the question in hand is answered rather than remembered, which is the safe direction.
  //
  // The sentence above now says "in this session", which is the other half of what this
  // number is. The transcript is `useState([])` and is written nowhere else — no store, no
  // localStorage, no backup — so this window ends at the page: a reload or a return
  // tomorrow, and the tutor remembers none of it. It said the same thing either way, which
  // is a promise to exactly the learner who had already been taught to expect persistence
  // by the stats, the streak, the placement result and the backup. Stating the scope is
  // cheaper than persisting the conversation and does not pretend to; that would be a
  // feature, not a sentence.
  const rememberedQuestions = Math.floor(bundle.maxTurns / 2);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
          <MessageCircle className="h-3.5 w-3.5" />
          <span>English Tutor</span>
        </div>
        <h1 className="text-3xl font-black text-gray-900 sm:text-4xl dark:text-white">
          {HEADING}
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">
          Ask about grammar, a phrase that did not sound right, or why something is wrong. The
          tutor remembers your last {rememberedQuestions} questions in this session, so
          follow-ups work; anything older stays on screen but is no longer part of the
          conversation.
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
          // `role="alert"`, because this is the whole result of the action and nothing
          // else moves to say so. On a failure the transcript is reverted too, so the DOM
          // around the form is unchanged — a screen reader user pressing Enter was told
          // nothing at all, for the three distinct sentences the route went to the trouble
          // of writing. Assertive rather than polite, which is what `role="status"` would
          // give: the learner asked a question and is waiting on the answer to that.
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
          >
            {submitError}
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            // `submitting` in the same condition as the empty check, because clearing the
            // box is what this handler does before it hands the question over — and `send`
            // returns immediately when a request is already open. Clearing it anyway
            // destroyed a question the learner had finished composing, with nothing sent
            // and nothing said. The Ask button beside the box is `disabled={submitting}`,
            // which is why the form was thought covered; the box is not disabled, because
            // composing the next question while the tutor answers is worth allowing.
            if (!text || submitting) return;
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
            // The character cap is enforced here and nowhere else on this side. The page
            // also computed `draft.length > maxMessageChars` and used it to block both
            // send paths, grey out the button and print "That is over the N character
            // limit" — none of which could ever run, because `maxlength` stops the
            // keystroke and `setDraft` has no other caller. A guard that cannot fail reads
            // as one that holds, and the string is the kind of thing a maintainer keeps
            // rather than re-derives. The server still refuses an over-long turn for any
            // other client.
            maxLength={bundle.maxMessageChars}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line. A typing app cannot take
              // Enter away entirely: this is a multi-line box, not a single field.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                const text = draft.trim();
                // The form above, and for the same reason — see there. This is the path that
                // mattered: Enter is how the box is submitted, and the box is not disabled
                // while the tutor answers, so a learner who pressed it a moment too early
                // watched their question vanish rather than queue.
                if (!text || submitting) return;
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
              disabled={submitting || draft.trim().length === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" role="status" aria-label="Sending" />
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
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
