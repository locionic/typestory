'use client';

import React, { useEffect, useLayoutEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { RotateCcw, Zap, Target, CheckCircle2, Volume2, Keyboard } from 'lucide-react';
import { useTypingStore, normalizeTypableText } from '../../store/useTypingStore';
import VirtualKeyboard from './VirtualKeyboard';
import { soundEngine } from '../../lib/audio';
import { finishedSeconds, recordCompletedSession, wpmFrom, wordsTyped } from '../../lib/stats';
import { SourceType } from '../../lib/types';

interface TypingEngineProps {
  onNext?: () => void;
  nextLabel?: string;
  /**
   * The passage and its heading, from the page that owns it.
   *
   * The store holds the *session* — what has been typed, how long it took, how many keys
   * went wrong. The passage is not a session fact; it is an input, and this is where an
   * input belongs.
   *
   * It has to be here because Zustand passes `getInitialState()` to `useSyncExternalStore`
   * as the *server* snapshot. A store read during SSR therefore returns the store exactly
   * as it was created, whatever the live store holds — and the store is created holding the
   * home page's sample passage. So `/stories/the-tortoise-and-the-hare` shipped an A2
   * fable's header — "Level A2", "Beginner Friendly", "Paragraph 1 of 6" — over a board
   * loaded with the first question of a B2 interview module. That is the crawler's copy and
   * the no-JS reader's copy, on all eleven story pages, and it does not come from timing: no
   * amount of care about *when* the store is written changes what SSR reads.
   *
   * Every other field the board reads — `typedText`, the counters, `isCompleted` — is boot
   * state that is also the correct SSR answer, since nothing has been typed yet. This pair
   * was the only part of the render the server got wrong.
   *
   * `sourceType` rides along because the board loads this passage into the store itself —
   * see the write below. It is the one field the store cannot infer, and it is what the
   * session row is filed under.
   *
   * Normalised here for the same reason `loadCustomText` normalises it: a paragraph
   * carrying an invisible character must render as the run that will be scored against it,
   * not as the characters a learner cannot see.
   */
  passage?: { text: string; title: string; sourceType: SourceType };
}

export default function TypingEngine({ onNext, nextLabel = 'Next', passage }: TypingEngineProps) {
  const {
    title,
    sourceType,
    targetText,
    typedText,
    startTime,
    endTime,
    elapsedSeconds,
    totalKeystrokes,
    correctKeystrokes,
    isCompleted,
    handleKeyInput,
    handleBackspace,
    tick,
    resetSession,
    markSessionRecorded,
    sessionSaved,
    setSessionSaved,
  } = useTypingStore();

  const [showKeyboard, setShowKeyboard] = useState(true);

  // What the board shows, and the name it shows it under — from the page that owns the
  // passage, never from the store, which is a singleton that outlives every component and
  // so is holding whatever the last page left behind.
  //
  // That was true on arrival and wrong afterwards, and it is the one board in the app with
  // content of its own that did not declare it: `/` rendered this component bare, so its
  // "What is the main architectural benefit of React Server Components" sample was only on
  // screen for as long as the store had not been written to. A learner who practised a
  // pasted chapter on `/custom` and clicked the logo came back to the front door to find
  // their own novel under a heading reading "Custom Text", mid-run, under a hero promising
  // technical Q&A and real stories. The store is still the fallback for the tests that
  // render this bare, and it stays one because `passage` is now the only route every real
  // board takes.
  const text = passage ? normalizeTypableText(passage.text) : targetText;
  const heading = passage?.title ?? title;

  // The same passage, loaded into the store, because `handleKeyInput` compares keystrokes
  // against the store and the board renders from the prop. One passage, two consumers,
  // written from one place — this used to be the third copy of this write in the app, one
  // per page, and the two pages that had one both had to remember to also do it. The
  // landing page could not: it is a server component and never got the chance.
  //
  // Deps are the three values rather than `passage`, because callers pass an inline object
  // literal — a fresh identity every render — and keying on that re-seeds on every store
  // change, including this effect's own.
  //
  // Not during render, which was tried and does not terminate. This component is a store
  // subscriber, so a write in its own render notifies it, and with more than one board on a
  // page the second one to notice the store disagree writes its own passage back: each
  // write wakes every board, and every woken board writes. `test/storyReader.test.ts`
  // renders eleven readers into one document and hangs on it. The two pages that used to
  // do this in their own render were outside the subscription, which is the only reason
  // they could.
  //
  // A layout effect rather than a passive one, so the keyboard is holding this passage
  // before the browser hands over a keystroke. Nothing is ever seen holding the wrong one:
  // what is *shown* comes from the prop above and is right on the very first commit, which
  // is what the prop is for.
  const passageText = passage?.text;
  const passageTitle = passage?.title;
  const passageSource = passage?.sourceType;
  useLayoutEffect(() => {
    if (passageText === undefined || passageTitle === undefined || passageSource === undefined) {
      return;
    }
    const session = useTypingStore.getState();
    // On the text as well as the title, because the title is the field this guard was
    // written against and it is not the field that decides what the learner types. The
    // deps say the text changed; a title-only guard says "nothing to do" and leaves the
    // board showing one passage while the keyboard compares against another. It read as
    // a non-issue because every page's title happens to carry its position — "(Part 2/6)",
    // "(3/40)" — so no title can stay put while its passage moves.
    //
    // Every page loads through `loadCustomText`, which normalises, so this comparison is
    // against the same string the store holds rather than against a near miss of it.
    if (
      session.title !== passageTitle ||
      session.targetText !== normalizeTypableText(passageText)
    ) {
      session.loadCustomText(passageText, passageTitle, passageSource);
    }
  }, [passageText, passageTitle, passageSource]);

  // Calculate live metrics
  //
  // The card below and recordCompletedSession both read `wpm`, so the number a
  // learner reads off the completion card is by construction the number stored
  // against the session. They did not always: the card came off the 250ms display
  // tick and the record off the run's own stamps, and the tick both floors and stops
  // on completion — so the card read a WPM the history never held, always a higher
  // one. See finishedSeconds.
  const finishedRunSeconds = finishedSeconds(startTime, endTime, elapsedSeconds);
  const wpm = wpmFrom(correctKeystrokes, finishedRunSeconds);

  // Floored, not rounded, and the distinction is what makes the number downstream mean
  // anything.
  //
  // `Math.round` sends any run with less than half a percent of errors to 100. The landing
  // passage is 281 characters, so one mistyped character — one the board has just shown in
  // rose with a double underline — rounds 280/281 to 100. The completion card then reads
  // "…with 100% typing accuracy", the history row reads "100% acc", and StatsModal's
  // lifetime `bestAccuracy >= 100` unlocks "Pure Precision", a badge whose own description
  // to the learner is "Complete a session with 100% accuracy". It is the one claim in the
  // app that gets *stronger* than the data behind it, and `Math.max` in lib/stats.ts makes
  // it permanent: once granted it cannot be lost by any later run.
  //
  // Floor is the honest integer — the largest whole percentage these keystrokes actually
  // support — and it is what makes a stored 100 mean exactly zero errors. Before, the stored
  // number could not tell "perfect" from "almost", so nothing downstream was entitled to
  // read it as perfect, and the badge took it at its word.
  const accuracy =
    totalKeystrokes > 0
      ? Math.floor((correctKeystrokes / totalKeystrokes) * 100)
      : 100;

  // What the finished run is worth to the lifetime total, which is the same question the
  // session row answers on the stats page. See `wordsTyped`: this used to be the whole
  // passage's word count, so a run of nothing but wrong keys still banked every word.
  const wordsCount = wordsTyped(typedText, text);

  // Floored for the same reason `accuracy` above is, and because this figure's only failure
  // mode runs the other way. `Math.round` carries `280/281` — one character from finished on
  // the landing passage — up to 100, so the board read "Progress 100%" with a keystroke still
  // to type and nothing on the page to contradict it. Flooring makes the top of the scale
  // mean the passage is done, which is the one thing 100% is supposed to say.
  //
  // `Math.min` was there to bound that from above and never did, since the ratio cannot
  // exceed 1; it stays because it costs nothing and says the same thing.
  const progress =
    text.length > 0
      ? Math.min(100, Math.floor((typedText.length / text.length) * 100))
      : 0;

  // Check if current passage is a Question & Answer drill
  const isQA = text.startsWith('Q:') && text.includes(' A:');
  const questionPrompt = isQA ? text.split(' A:')[0].replace(/^Q:\s*/, '') : '';

  /**
   * The last keystroke, in words, for a screen reader — and only when it was wrong.
   *
   * Every other signal this board gives is visual. Correct characters are emerald and
   * wrong ones are rose with an underline, which is what a colour-blind learner reads;
   * position says how far along they are; the VirtualKeyboard below reads out the next
   * target and the finger for it. A learner who cannot see any of that had no way to
   * find a typo at all, short of re-reading the passage against the highlight and
   * guessing what the colour meant — while WPM, accuracy and progress, which are one
   * character away from the feedback that matters, were all readable text.
   *
   * Derived from the store rather than accumulated in an effect, so it cannot fall a
   * keystroke behind, and empty on a correct key: a status region only speaks when its
   * content changes, so clearing it is what lets the *second* identical mistake be
   * heard. Announcing correct keystrokes would be a hundred interruptions a minute.
   */
  const lastTypedIndex = typedText.length - 1;
  const lastKeystroke =
    !isCompleted && lastTypedIndex >= 0 && typedText[lastTypedIndex] !== text[lastTypedIndex]
      ? `Character ${lastTypedIndex + 1} of ${text.length}: expected “${
          text[lastTypedIndex] === ' ' ? 'space' : text[lastTypedIndex]
        }”, you typed “${
          typedText[lastTypedIndex] === ' ' ? 'space' : typedText[lastTypedIndex]
        }”.`
      : '';

  // Live timer tick
  useEffect(() => {
    if (!startTime || isCompleted) return;

    const interval = setInterval(tick, 250);

    return () => clearInterval(interval);
  }, [startTime, isCompleted, tick]);

  // Confetti on completion & persistent stats recording
  useEffect(() => {
    if (!isCompleted) return;

    // The claim is taken first and asked about, rather than checking a flag this
    // render captured and then setting it. Those two lived in different places, and a
    // second run of this effect before a re-render — which is what StrictMode does in
    // development — saw the same stale value and recorded the passage twice. All that
    // is left here is the one call that can only be won once.
    if (!markSessionRecorded()) return;

    // The one animation in this app that no stylesheet can reach, and the largest burst of
    // movement in the product: 80 particles thrown across the screen on every completion.
    // The `prefers-reduced-motion` block in app/globals.css stops the caret and both fades
    // for free, and this is the only animation it misses, because this one is JS drawing
    // to a canvas rather than a class in the stylesheet.
    //
    // The library's own option cannot be used for this. canvas-confetti 1.9.4 ships
    // `disableForReducedMotion`, documented in its README as exactly this, and guards on
    // `matchMedia('(prefers-reduced-motion)').matches` — but that query has no value, and
    // `prefers-reduced-motion` is an enumerated feature (`no-preference` | `reduce`) rather
    // than a boolean one, so the valueless form never matches and the flag silently does
    // nothing. `matchMedia` exists and is truthy, which is exactly why the mistake is
    // invisible: the option reads as honoured in review and is honoured by nothing.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
    }

    // The same clock the card above reads, so the two cannot disagree. `heading`, not the
    // store's `title`: the recorded row is what the learner was shown, and the two only
    // agree because the page seeded both from one passage. `targetText` was a dependency
    // of this effect without being read by it.
    // Every browser that refuses local writes — a private window with site data
    // blocked, a device profile switched off by policy — takes this branch on every
    // single run, silently. The card below goes on to quote a real WPM and a real
    // accuracy for a passage that now exists nowhere, and the learner has no way to
    // know that. The restore path in StatsModal already reports the same failure; this
    // is the record path, and it runs far more often.
    const saved = recordCompletedSession({
      title: heading,
      sourceType,
      wpm,
      accuracy,
      durationSeconds: finishedRunSeconds,
      wordsCount,
      keystrokes: totalKeystrokes,
    });
    setSessionSaved(saved);
  }, [
    isCompleted,
    markSessionRecorded,
    setSessionSaved,
    heading,
    sourceType,
    wordsCount,
    wpm,
    finishedRunSeconds,
    accuracy,
    totalKeystrokes,
  ]);

  // Global keydown listener for zero-friction typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore functional hotkeys (Cmd+R, Ctrl+Shift+I, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // A focused text field owns its own keystrokes. Without this the engine
      // swallows every character typed into the /custom textarea and files it
      // against the typing board as an error, and Escape there restarts the run.
      //
      // `[role="dialog"]` is the same rule and the same reasoning. The stats panel is
      // rendered by the Navbar, above the board on every page that has one, and it moves
      // focus into itself when it opens — so a learner reading their numbers is, by the
      // focus rule above, still "at the board". The board's listener is on `window` and
      // the panel's is on `document`; both are bubble-phase nodes on one chain and neither
      // stops propagation, so one Escape reached both handlers: the panel closed and
      // `resetSession` ran behind it, wiping a run in progress along with the completion
      // card. Letters and space went the same way, onto a board hidden behind a modal, and
      // Enter on a finished run advanced the passage under it.
      //
      // Matched on the role rather than on a class or an id because the role is what makes
      // it a dialog to a screen reader too, so the two cannot disagree about which element
      // this is. The guard above needed a new element for the same reason its old four are
      // there: focus is somewhere the learner is not typing.
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;

      // Space activates a button and Enter follows a link — and both are also keystrokes
      // this board would otherwise claim. Whichever element holds focus owns those two
      // keys; every other key still types, so clicking a control mid-passage does not
      // stop the learner typing the rest of it.
      //
      // This is only Space's conflict, really, and it is unavoidable: space is the most
      // typed character in any passage, so the two readings of the key genuinely collide
      // and one of them has to lose. Enter does not — nothing types "Enter" — but it is
      // folded in here because "which keys does this control own" is one question and
      // splitting it across two rules is how the next key gets missed.
      if ((e.key === ' ' || e.key === 'Enter') && target?.closest('button, a[href]')) return;

      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        return;
      }

      if (e.key === 'Escape') {
        resetSession();
        return;
      }

      if (isCompleted && e.key === 'Enter' && onNext) {
        e.preventDefault();
        onNext();
        return;
      }

      // Single printable characters
      if (e.key.length === 1) {
        e.preventDefault();

        // Hand the keyboard back. A button clicked with the mouse keeps focus — Chrome
        // and Firefox do not move it off the control, unlike Safari — and Space is a
        // character the learner types constantly, so the first space after clicking one
        // is the key that button is activated by. On `/custom` that button is Load &
        // Start Practice, whose handler reloads the passage: every custom session, on a
        // browser that behaves this way, lost whatever had been typed before the first
        // space. The engine's own Restart does the same to a run in progress.
        //
        // Taking a printable key is the proof that the learner is typing again. Someone
        // who *tabbed* to the button keeps it focused until they press something, which
        // is what tabbing asked for.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.matches('button, a[href]')) {
          focused.blur();
        }

        handleKeyInput(e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyInput, handleBackspace, resetSession, isCompleted, onNext]);

  return (
    <div className="flex flex-col gap-6">
      {/* Live Stats Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-6">
          {/* WPM Speed */}
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            <div>
              <div className="text-xs font-semibold uppercase text-gray-400">Speed</div>
              <div className="font-mono text-2xl font-black text-gray-900 dark:text-white">
                {wpm} <span className="text-xs font-normal text-gray-400">WPM</span>
              </div>
            </div>
          </div>

          {/* Accuracy */}
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-500" />
            <div>
              <div className="text-xs font-semibold uppercase text-gray-400">Accuracy</div>
              <div className="font-mono text-2xl font-black text-gray-900 dark:text-white">
                {/* A dash until there is a keystroke to be right or wrong about, which is
                    what the other two figures beside it already do: `wpmFrom` answers 0
                    with no correct keystrokes and no elapsed seconds, and progress divides
                    a zero by the passage length. Accuracy was the odd one out, because
                    `totalKeystrokes > 0 ? … : 100` has to return something and 100 is the
                    best number the field holds — so every board in the app opened on
                    "Speed 0 WPM · Accuracy 100% · Progress 0%", two figures saying nothing
                    yet and the third saying flawless. The same sentinel rendered 100% in
                    the stats panel; test/statsModal.test.ts caught it there, this is the
                    copy the learner meets first. */}
                {totalKeystrokes === 0 ? '—' : `${accuracy}%`}
              </div>
            </div>
          </div>

          {/* Progress */}
          <div className="hidden sm:flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <div>
              <div className="text-xs font-semibold uppercase text-gray-400">Progress</div>
              <div className="font-mono text-2xl font-black text-gray-900 dark:text-white">
                {progress}%
              </div>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowKeyboard((prev) => !prev)}
            title="Toggle touch-typing virtual keyboard"
            /* `aria-label`, not just the `title`: the visible label below is
             * `hidden sm:inline`, so below 640px this button is an icon with nothing
             * beside it — and content in `display: none` is left out of the accessible
             * name. A tooltip is not a name either. Same fix as the Stats button in the
             * header, and for the same reason. */
            aria-label="Toggle touch-typing virtual keyboard"
            /* `aria-pressed` for the same reason: the button said on and off by swapping
             * `bg-indigo-50` for `bg-gray-200`, and a screen reader heard a button either
             * way with no state on it at all. The label above says what the control
             * touches; this says which side of it you are on. See
             * test/selectionState.test.ts. */
            aria-pressed={showKeyboard}
            className={`flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              showKeyboard
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300'
                : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            <Keyboard className="h-3.5 w-3.5 text-indigo-500" />
            <span className="hidden sm:inline">Keyboard</span>
          </button>
          <button
            type="button"
            onClick={() => soundEngine.speak(text)}
            title="Read text aloud"
            className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Volume2 className="h-3.5 w-3.5 text-indigo-500" />
            <span>Listen</span>
          </button>
          <button
            type="button"
            onClick={() => {
              resetSession();
            }}
            title="Restart session (Esc)"
            className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Restart</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Typing Board */}
      <div className="relative min-h-[220px] rounded-3xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900 sm:p-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            {heading}
          </div>
          {isQA && (
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider uppercase text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              Technical Q&amp;A
            </span>
          )}
        </div>

        {/* Highlighted Interview Question Card */}
        {isQA && (
          <div className="mb-5 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900/40 dark:bg-indigo-950/30">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                Interview Question
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Type question &amp; model answer below
              </span>
            </div>
            <p className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 leading-snug">
              {questionPrompt}
            </p>
          </div>
        )}

        {/* Character By Character Rendering */}
        {/*
          Always rendered, never conditionally mounted: a live region that does not
          exist cannot announce its own creation, so `lastKeystroke` is what carries
          the message and this element carries nothing else.
        */}
        <p role="status" className="sr-only">
          {lastKeystroke}
        </p>

        <div className="font-mono text-xl sm:text-2xl leading-relaxed tracking-wide select-none">
          {text.split('').map((char, index) => {
            const isTyped = index < typedText.length;
            const isCurrent = index === typedText.length;
            const isCorrect = isTyped && typedText[index] === char;
            const isWrong = isTyped && typedText[index] !== char;

            // Correct and wrong are told apart by more than hue.
            //
            // These three states were emerald / gray / rose and nothing else, so the
            // only thing distinguishing a landed keystroke from a missed one was colour
            // — which is WCAG 2.2 SC 1.4.1, and here it failed on the one piece of
            // feedback the app exists to give. The faint 20% background and the
            // rounding are not a second signal; at any real contrast they are the same
            // signal twice.
            //
            // A colour-blind learner saw two shades of gray, and could not find their
            // typos. The underline gives that same information by shape, so it survives
            // greyscale, a dark theme, and any future palette. Position already
            // separates correct from untyped — a character simply is or is not reached
            // yet — so wrong-vs-the-rest is the only pair that needed the extra channel.
            let charClass = 'text-gray-300 dark:text-gray-600';
            if (isCorrect) {
              charClass = 'text-emerald-600 dark:text-emerald-400';
            } else if (isWrong) {
              charClass =
                'bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-sm ' +
                'underline decoration-2 underline-offset-2';
            }

            return (
              <span
                key={index}
                className={`relative inline-block transition-colors ${charClass}`}
              >
                {/* Blinking Caret Cursor on Active Letter */}
                {isCurrent && (
                  <span className="absolute -left-[1px] top-0 bottom-0 w-[3px] bg-indigo-500 animate-pulse rounded-full" />
                )}
                {char === ' ' ? '\u00A0' : char}
              </span>
            );
          })}
        </div>

        {/* Completion Card Overlay */}
        {isCompleted && (
          <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center dark:bg-emerald-950/20">
            <h3 className="text-xl font-bold text-emerald-900 dark:text-emerald-200">
              Passage Completed! Great Job!
            </h3>
            <p className="mt-2 text-sm text-emerald-800/80 dark:text-emerald-300/80">
              You typed at <span className="font-bold">{wpm} WPM</span> with{' '}
              <span className="font-bold">{accuracy}% typing accuracy</span>.
            </p>
            {!sessionSaved && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              >
                This run was not saved. Your browser is refusing to store anything for
                this site, so it is not in your history and it does not count toward your
                streak. Allow site data for this page and the next run will be kept.
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  resetSession();
                }}
                className="rounded-xl border border-emerald-600/40 bg-white/80 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 dark:border-emerald-700/50 dark:bg-gray-800 dark:text-emerald-300 dark:hover:bg-gray-800"
              >
                Practice Again
              </button>
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-md transition hover:bg-emerald-500"
                >
                  <span>{nextLabel} (Enter ↵)</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Touch-typing Interactive Virtual Keyboard */}
      {showKeyboard && (
        <VirtualKeyboard expectedChar={text[typedText.length]} />
      )}
    </div>
  );
}
