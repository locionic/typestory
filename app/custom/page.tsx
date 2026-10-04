'use client';

import React, { useState } from 'react';
import { normalizeTypableText, useTypingStore } from '../../store/useTypingStore';
import TypingEngine from '../../components/typing/TypingEngine';
import { untypeableIn } from '../../components/typing/VirtualKeyboard';
import { FileText, Play } from 'lucide-react';

export const SAMPLES = [
  {
    title: 'Technology & AI Impact',
    text: 'Artificial intelligence is reshaping software engineering by automating boilerplate code and accelerating debugging workflows. Developers who master problem decomposition and prompt architecture will achieve unprecedented leverage.',
  },
  {
    title: 'Mindset & Daily Habits',
    text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit. Small daily improvements over time lead to stunning results. Focus on consistency rather than occasional bursts of effort.',
  },
  {
    title: 'Professional Email Communication',
    text: 'Dear Team, I hope you are having a productive week. Please review the attached quarterly metrics report prior to our synchronisation meeting on Thursday morning. Let me know if you have any questions.',
  },
];

/** Where the draft waits out a refresh. Per device: never in the backup payload. */
const DRAFT_KEY = 'typestory:custom-draft';

/**
 * The passage the learner pasted, which a refresh used to take with it.
 *
 * The store below is what made this page survive *navigation*: it is a module singleton, so
 * clicking "Stories" and coming back left the passage and the board alone. A refresh is the
 * other half of the same journey and got none of it — the store is rebuilt from nothing, so a
 * chapter pasted out of a PDF and drilled for ten minutes was gone at F5, with the only copy
 * in the learner's clipboard and the file they had it in. `/placement` and `/writing` now keep
 * their work across a reload; this page is the one that holds the learner's own text and
 * does not, which is the same defect with none of the arguments against it.
 *
 * `null` means "never stored", which is not the same as "stored empty". A learner who
 * clears the box to type a fresh paste must not find Sample 1 back in it on reload, and
 * `null` is what lets the two be told apart.
 */
function loadDraft(): string | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function saveDraft(text: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(text));
  } catch {
    // A browser that refuses the write still shows the passage and still drills it; it just
    // will not survive a refresh. Nothing to report, nothing to retry.
  }
}

export default function CustomTextPage() {
  /**
   * What the store already holds, read once at mount.
   *
   * All three of these were `useState` seeded from `SAMPLES`, which made this page hold two
   * answers to "what am I typing?". The store is a module singleton and outlives the
   * component; `useState` does not. So one click of "Stories" in the header — this route is
   * in `NAV_ROUTES`, so it is one click from anywhere, and the footer repeats it — unmounted
   * the page and left the store holding the pasted passage and every keystroke of a run in
   * progress, while the textarea came back showing the opening sample and the board did not
   * come back at all. The first press of "Load & Start Practice" then overwrote the store's
   * copy with the sample, so the work went in one click that looked like a resume.
   *
   * Read rather than subscribed, because nothing here should rebuild when the session moves
   * on — the comment on `loadCustomText` below is still the right one. What this restores is
   * the passage and the board the learner left, not a live view of the run; a run in progress
   * keeps its state in the store either way.
   */
  const [held] = useState(() => useTypingStore.getState());

  /**
   * What the textarea opens on, decided once and read by both initialisers below.
   *
   * Three sources, in order of how deliberate each one is: a run in the store is what the
   * learner is *currently* drilling, a stored draft is what they were writing for the next
   * one, and neither means this is a first visit and the opening sample is the answer.
   *
   * This is the fix for the two initialisers disagreeing, described at length in the comment
   * that used to sit here: `presetIndex` read the store while `inputText` was gated on
   * `sourceType`, so a store holding Sample 2 opened the page with the sample in the box and
   * a different sample marked as loaded, and the mismatch was recorded as "Custom Text" for a
   * passage nobody had pasted. The disagreement is now impossible rather than avoided — both
   * read one value — and a third source could not reintroduce it.
   */
  const [draft] = useState(loadDraft);
  const restored = held.sourceType === 'custom';
  const [initialText] = useState(restored ? held.targetText : (draft ?? SAMPLES[0].text));
  const [inputText, setInputText] = useState(initialText);

  /**
   * Which sample the opening text is, so a restored draft keeps its preset's name.
   *
   * `findIndex` answers -1 for a real paste, and -1 indexes `SAMPLES` to `undefined`, so the
   * fallback is written here rather than left to the `isPresetText` comparison below — which
   * would be reading `undefined.text` and throwing on the first render.
   */
  const [presetIndex, setPresetIndex] = useState(() => {
    const found = SAMPLES.findIndex((s) => s.text === initialText);
    return found === -1 ? 0 : found;
  });

  /**
   * The passage the board is running on, or `null` while there is no board.
   *
   * It was a boolean, and the board was handed `inputText` — the live textarea — which is the
   * right arrangement until there is a run and wrong from the moment there is one. The
   * textarea is this page's one control for changing what you are typing, and the board was
   * reading it: so any edit changed the passage the board was handed, and the board re-seeded
   * the store with it, and `loadCustomText` answered `typedText: ''` with every counter at
   * zero. Correcting one word in the passage threw away the run in progress and swapped the
   * text under the caret while doing it, with nothing on screen to say so.
   *
   * So a run's text is written down once, when Start is pressed, and the textarea is the
   * draft for the next one. The two then show different text, which is right — a draft and a
   * run are different things, and this page has always shown both — and pressing Start is
   * what makes them the same text again. It was always the page's one explicit way to start
   * over, and it is now the only one.
   */
  const [active, setActive] = useState<{ text: string; title: string } | null>(
    restored ? { text: held.targetText, title: held.title } : null,
  );
  // Selected, not destructured — see the Navbar. Nothing this page renders reads the
  // typing session, so it should not rebuild when the session changes.
  const loadCustomText = useTypingStore((s) => s.loadCustomText);

  // What the board will actually be asked to type, not what the textarea holds.
  //
  // `inputText.trim()` was the gate, and it answers a different question from the one
  // the board asks: trim() removes whitespace, while normalizeTypableText also deletes
  // the zero-width and bidi characters a Google Docs or PDF paste arrives with — the
  // store's own comment names both. So a paste made only of those passed the gate,
  // normalised to an empty string, and opened a fully rendered typing arena with a
  // blank board: every keystroke was swallowed by handleKeyInput's empty-target guard,
  // `isCompleted` never became true, and no session was ever recorded. Nothing on
  // screen said why. Asking the same question the board answers fixes it at the gate,
  // and the disabled button is the honest explanation.
  const typable = normalizeTypableText(inputText);

  // Singular at one, because one is a length this page reaches constantly: a term to
  // drill, a single line. It is also the shortest session the page will start at all, the
  // gate above passing on any non-empty result, so the sentence was wrong for the whole
  // of the shortest thing it will let you do.
  const wordCount = typable ? typable.split(/\s+/).length : 0;

  /**
   * What the board would ask for and no key can produce.
   *
   * The gate above answers "is there anything to type?", which is the easy half of what
   * this page has to know. The other half is whether there is a key for every character
   * of it, and nothing asked that: the corpus tests keep every *shipped* passage clean of
   * these, and this is the one input nothing can check ahead of time.
   *
   * So a learner pasted an English chapter — the thing the page asks for — with one `é`
   * in it, and got a run that could not be typed. `handleKeyInput` advances the caret on
   * every keystroke whether or not it matched, so that character parks the caret on a
   * position that never turns green: it cannot be repaired mid-passage, it does not block
   * completion, and it drags the WPM and the accuracy the session is *recorded* with.
   * One character, in a four-thousand-word chapter, silently taxing every number on the
   * completion card and every row it ever writes to the history.
   *
   * Named rather than swallowed, because the alternative — rewriting them the way
   * `normalizeTypableText` rewrites curly quotes and em dashes — changes the passage the
   * learner asked for, and `normalizeTypableText`'s own comment is explicit that visible
   * characters are left alone on purpose. So the text is left alone and the passage is
   * refused, which is what the button below is already for.
   */
  const unreachable = untypeableIn(typable);

  /**
   * The title follows the text, rather than living in state of its own.
   *
   * `customTitle` was initialised to `SAMPLES[0].title` and written only by the three
   * preset buttons, so it never changed when the learner did the one thing this page is
   * for: replace the text. Every pasted passage was recorded in the session history as
   * "Technology & AI Impact" — or whichever preset they had clicked last — beside a
   * `sourceType: 'custom'` that said otherwise, and that wrong row went into the backup.
   * The `customTitle || 'Custom Text'` guard beneath the call was unreachable, which is
   * what says the intended default was the empty title the store already defaults to.
   *
   * Comparing the whole text to the loaded preset answers both directions at once: the
   * name while the preset is what is loaded, 'Custom Text' once it is not. A dirty flag
   * would lose the second case, where someone tries a sample and fixes a typo in it.
   */
  const isPresetText = inputText === SAMPLES[presetIndex].text;

  /**
   * What this session is called, in both of the places it has to be written.
   *
   * The recording call and the board's own heading, which is the same name the completion
   * card reads. Two copies of a rule like this drift the first time either side needs a
   * third case, and this one already has three: a preset's name, a paste, and a preset with
   * a typo fixed in it.
   */
  const sessionTitle = isPresetText ? SAMPLES[presetIndex].title : 'Custom Text';

  const handleStart = () => {
    if (!typable || unreachable.length > 0) return;
    loadCustomText(inputText, sessionTitle);
    setActive({ text: inputText, title: sessionTitle });
  };

  /**
   * The one way the draft changes, so that it is persisted by construction.
   *
   * Two call sites write it — the textarea and the three preset buttons — and a save
   * remembered at one and forgotten at the other is exactly the kind of drift this page has
   * spent its history being bitten by. `Start` is deliberately *not* one of them: it does not
   * change the draft, and the note on `active` above is the reason the two are allowed to
   * hold different text.
   */
  const editDraft = (value: string) => {
    setInputText(value);
    saveDraft(value);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 mb-3">
          <FileText className="h-3.5 w-3.5" />
          <span>Paste Any Text or Article</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white">
          Custom Touch Typing Practice
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Paste your own English reading assignment, novel chapter, or study notes. Practice touch typing it with real-time WPM, accuracy tracking, and mechanical keyboard audio.
        </p>
      </div>

      {/* Input Form */}
      <div className="mb-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="custom-input" className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Paste Your English Text Here
          </label>
          {/* Quick preset samples */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-gray-400">Presets:</span>
            {SAMPLES.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  editDraft(s.text);
                  setPresetIndex(idx);
                }}
                className="rounded-lg bg-gray-100 px-2 py-1 font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Sample {idx + 1}
              </button>
            ))}
          </div>
        </div>

        <textarea
          id="custom-input"
          rows={5}
          value={inputText}
          onChange={(e) => editDraft(e.target.value)}
          placeholder="Paste any article, sentence, or dialogue..."
          className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 font-mono text-sm leading-relaxed text-gray-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
        />

        {unreachable.length > 0 && (
          <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-950/40 dark:text-amber-200">
            <span className="font-mono">
              {unreachable.map((char) => `“${char}”`).join(unreachable.length === 1 ? ' or ' : ' and ')}
            </span>{' '}
            {unreachable.length === 1 ? 'has' : 'have'} no key on a US keyboard, so the
            caret would stop there and the run would be recorded with{' '}
            {unreachable.length === 1 ? 'it' : 'them'} wrong. Remove{' '}
            {unreachable.length === 1 ? 'it' : 'them'} to start.
          </p>
        )}

        <div className="mt-4 flex justify-between items-center">
          <span className="text-xs text-gray-400">
            {wordCount} {wordCount === 1 ? 'word' : 'words'}
          </span>
          <button
            type="button"
            onClick={handleStart}
            disabled={!typable || unreachable.length > 0}
            className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-500/20 transition hover:bg-indigo-500 disabled:opacity-40"
          >
            <Play className="h-4 w-4" />
            <span>Load &amp; Start Practice</span>
          </button>
        </div>
      </div>

      {/* Typing Arena */}
      {active && (
        <TypingEngine passage={{ text: active.text, title: active.title, sourceType: 'custom' }} />
      )}
    </div>
  );
}
