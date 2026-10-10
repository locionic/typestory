'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { VOCAB_BANKS, VocabCategory } from '../../data/vocab';
import { CefrLevel } from '../../lib/types';
import TypingEngine from '../../components/typing/TypingEngine';
import { Bookmark, Volume2, ChevronRight, ChevronLeft, Filter } from 'lucide-react';
import { soundEngine } from '../../lib/audio';

/**
 * The page's name, in both of the states the page has.
 *
 * One constant rather than the same string written twice, because the two must not drift:
 * the fallback exists to name the page, and it stops doing that the moment the two copies
 * disagree.
 */
const HEADING = 'English Word Banks';

/**
 * The three proficiency bands, in the order a learner reads them.
 *
 * Same bands and same option text as `StoriesCatalog`'s `LEVELS`, because they are the
 * same judgement about the same scale: a learner who has been filtered out of every story
 * at one level on the catalog has not been offered a different meaning of it here.
 */
const LEVELS = [
  { id: 'all', label: 'All Levels', cefs: [] as CefrLevel[] },
  { id: 'beginner', label: 'Beginner (A1–A2)', cefs: ['A1', 'A2'] },
  { id: 'intermediate', label: 'Intermediate (B1–B2)', cefs: ['B1', 'B2'] },
  { id: 'advanced', label: 'Advanced (C1–C2)', cefs: ['C1', 'C2'] },
];

/** The band a filter value selects, for the two places that need it by name. */
function levelById(id: string) {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}

/**
 * The bank this link asks for, falling back to the first.
 *
 * The landing page's four bank cards are the only deep links into this page, so this is
 * the half of the route that makes them work: the card naming IELTS opens IELTS.
 *
 * The URL is the whole of the state, not a starting value for it. It used to be read once
 * into a `useState`, which made the address bar a snapshot of the moment the page mounted:
 * click a different tab and the screen changed while `?bank=` stayed on the old slug, so
 * the link became a bookmark to the wrong bank — and reloading it, which is what a
 * bookmark does, reopened IELTS. A tab now navigates instead of assigning, so there is one
 * source of truth and the copyable URL always describes what is on screen.
 */
function useLinkedBank(): VocabCategory {
  const wanted = useSearchParams().get('bank');
  return VOCAB_BANKS.find((bank) => bank.slug === wanted) ?? VOCAB_BANKS[0];
}

function VocabDrill({ bank }: { bank: VocabCategory }) {
  const router = useRouter();
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  // The tabs are the only way onto a bank, so narrowing them is filtering the page: this is
  // state rather than part of `?bank=` because, unlike the open bank, this is a lens over the
  // list and not a destination — nothing links to "the vocab page, filtered to B2", and
  // putting it in the URL would mean every tab click also rewrote it.
  const [selectedLevel, setSelectedLevel] = useState('all');
  const words = bank.words;
  const currentItem = words[currentWordIndex] || words[0];

  const band = levelById(selectedLevel);
  const visibleBanks = band.cefs.length
    ? VOCAB_BANKS.filter((option) => band.cefs.includes(option.level))
    : VOCAB_BANKS;

  // The board loads this into the typing store itself, and the guard that makes that write
  // safe in a render lives there. The card above is rendered from `currentItem` directly, so
  // it was right from the first commit either way.
  const wordTitle = `${bank.title} (${currentWordIndex + 1}/${words.length})`;

  const handleNext = () => {
    if (currentWordIndex < words.length - 1) {
      setCurrentWordIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentWordIndex > 0) {
      setCurrentWordIndex((prev) => prev - 1);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 mb-3">
          <Bookmark className="h-3.5 w-3.5" />
          <span>Flashcard Typing &amp; Phonetics</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white">
          {HEADING}
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Build spatial keyboard memory for essential English terms. Type each word, listen to native phonetics, and master accurate spelling.
        </p>
      </div>

      {/* Word Bank Category Selector Tabs */}
      <div className="mb-8 flex flex-col items-center gap-3">
        {/* The level filter, the story catalog's control for the same judgement — and the
          * same `aria-label` wording, since the two answers mean the same thing. Default
          * `all`, so the page opens with every bank on it as it always has. No
          * `focus:outline-none`, and no border-colour replacement either: on a `<select>`
          * neither leaves any indication of where the keyboard is. See
          * test/focusVisible.test.ts. */}
        <div className="flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300">
          <Filter className="h-3.5 w-3.5 text-indigo-500" />
          <select
            aria-label="Filter word banks by proficiency level"
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="bg-transparent font-medium"
          >
            {LEVELS.map((lvl) => (
              <option key={lvl.id} value={lvl.id}>
                {lvl.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          {visibleBanks.map((option) => {
            const isActive = bank.slug === option.slug;
            return (
              <button
                key={option.slug}
                type="button"
                onClick={() => router.replace(`/vocab?bank=${option.slug}`)}
                /* `aria-pressed`. The URL carries which bank is open — see `useLinkedBank` —
                  * and this carries what a screen reader hears, which is the half that was
                  * missing: the tab swapped `bg-indigo-600` for `bg-gray-200` and announced
                  * itself as a plain button either way. Same fix as the category pills on the
                  * story catalog, and `test/selectionState.test.ts` is what stops a third
                  * one appearing. */
                aria-pressed={isActive}
                className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold transition shadow-sm ${
                  isActive
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
                }`}
              >
                <span>{option.iconEmoji}</span>
                <span>{option.title}</span>
                {/* The level, on the tab, in the same place the story catalog puts it on a
                  * card. It is a judgement about the words (see `VocabCategory.level`), so it
                  * is printed where a learner chooses rather than inferred from the title —
                  * "Core Foundation" is a bank name, not a difficulty claim. */}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    isActive
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  {option.level}
                </span>
              </button>
            );
          })}
        </div>

        {/* A band with no bank in it is reachable — no bank is tagged C1 or C2 — and the
          * tab bar is how a learner picks a bank, so an empty one leaves the drill below
          * with no way to reach it and no word saying why. The levels are read off
          * `VOCAB_BANKS` rather than written here, so the line answers the question that
          * was actually asked: which band do these banks belong to. */}
        {visibleBanks.length === 0 && (
          <p role="status" className="text-sm text-gray-500 dark:text-gray-400">
            No word banks are tagged {band.label}. The banks on this page are{' '}
            {[...new Set(VOCAB_BANKS.map((option) => option.level))].sort().join(', ')}.
          </p>
        )}
      </div>

      {/* Active Word Card & Phonetic Card */}
      <div className="mb-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Word {currentWordIndex + 1} of {words.length}
              </span>
              {currentItem.pos && (
                <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {currentItem.pos}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white">
                {currentItem.word}
              </h2>
              {currentItem.phonetic && (
                <span className="font-mono text-sm text-gray-400">
                  {currentItem.phonetic}
                </span>
              )}
              <button
                type="button"
                onClick={() => soundEngine.speak(currentItem.word)}
                // `aria-label`, and no `title`. This button is nothing but an icon, so the
                // tooltip was its only text and it was not a name: a screen reader
                // announced a bare "button" for the one control the page exists to offer.
                // And it named the action rather than the word, so even where a tooltip
                // does surface, all eight words in a bank read the same. The word is
                // printed beside this button and is what names it. Same fix, and same
                // wording, as the story glossary in `StoryReader`.
                aria-label={`Pronounce ${currentItem.word}`}
                className="rounded-full p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-gray-800"
              >
                <Volume2 className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {currentItem.definition}
            </p>
            {currentItem.translation && (
              <p className="mt-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                Meaning: {currentItem.translation}
              </p>
            )}
            {currentItem.example && (
              <p className="mt-2 text-xs italic text-gray-500 border-l-2 border-indigo-200 pl-2 dark:border-indigo-800">
                &quot;{currentItem.example}&quot;
              </p>
            )}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={currentWordIndex === 0}
              className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 dark:border-gray-800"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Prev</span>
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={currentWordIndex === words.length - 1}
              className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 dark:border-gray-800"
            >
              <span>Next</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Typing Engine */}
      <TypingEngine
        passage={{ text: currentItem.word, title: wordTitle, sourceType: 'vocab' }}
        onNext={currentWordIndex < words.length - 1 ? handleNext : undefined}
        nextLabel="Next Word"
      />
    </div>
  );
}

/**
 * The URL, resolved into the bank to drill.
 *
 * `key` is what starts a newly chosen bank at its first word. The index lives in state
 * inside `VocabDrill`, and switching banks has always meant resetting it — the tab handler
 * used to do that by hand alongside `setSelectedBank`. Keying on the slug throws the state
 * away instead, so the reset cannot be left behind if a second path into a bank is ever
 * added. It also renders nothing twice: the key changes in the same commit that changes the
 * prop, so there is no frame showing the new bank at the old bank's word index.
 */
function VocabBank() {
  const bank = useLinkedBank();
  return <VocabDrill key={bank.slug} bank={bank} />;
}

/**
 * The Suspense boundary is load-bearing, not decoration.
 *
 * `/vocab` is prerendered, and `useSearchParams` is the one hook that opts a client
 * component out of static rendering — node_modules/next/dist/docs puts it at line 181:
 * "During production builds, a static page that calls useSearchParams from a Client
 * Component must be wrapped in a Suspense boundary, otherwise the build fails." The
 * fallback is the same spinner the page already showed while it had no bank to show,
 * and it lasts one frame on a client-side click from the landing page.
 */
export default function VocabPage() {
  return (
    <Suspense
      fallback={
        /* The heading belongs to the page, not to the drill, so it does not wait for it —
         * see the same note on the tutor page. This fallback *is* the prerendered document
         * (see the note above), so a lone spinner meant the HTML a learner received before
         * the drill existed had no heading, no landmark and no text at all. */
        <div className="mx-auto max-w-4xl px-4 py-8 text-center sm:px-6 sm:py-12">
          <h1 className="text-3xl font-black text-gray-900 sm:text-4xl dark:text-white">
            {HEADING}
          </h1>
          <div className="mt-8 flex justify-center">
            <Bookmark className="h-6 w-6 animate-pulse text-indigo-400" role="status" aria-label="Loading" />
          </div>
        </div>
      }
    >
      <VocabBank />
    </Suspense>
  );
}
