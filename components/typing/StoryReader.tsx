'use client';

import React, { useState } from 'react';
import { StoryItem } from '../../lib/types';
import TypingEngine from './TypingEngine';
import { Volume2, BookOpen, ChevronRight, ChevronLeft, Award } from 'lucide-react';
import { soundEngine } from '../../lib/audio';

interface StoryReaderProps {
  story: StoryItem;
}

export default function StoryReader({ story }: StoryReaderProps) {
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
  // No subscription to the typing store at all, and that is deliberate on two counts.
  // A whole-store subscription — what this used — made the most expensive thing in the
  // app, a panel with one button per paragraph plus the glossary, rebuild on every
  // keystroke typed into the board directly above it. Selecting `loadCustomText` fixed
  // that, and then the render below reached for it instead of `getState()`, so the
  // subscription went too: nothing here is rendered from the session.

  const paragraphs = story.paragraphs;
  const currentParagraph = paragraphs[currentParagraphIndex] || '';

  // The board loads this into the typing store itself, and the guard that makes that write
  // safe in a render lives there. What it used to be doing here — the same write, in the
  // same render, with the same title-equality guard — meant every page with a passage of its
  // own had to remember to also do it. Two did; the landing page could not, being a server
  // component. One place now, so the fourth board gets it by rendering.
  const passageTitle = `${story.title} (Part ${currentParagraphIndex + 1}/${paragraphs.length})`;

  const handleNext = () => {
    if (currentParagraphIndex < paragraphs.length - 1) {
      setCurrentParagraphIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentParagraphIndex > 0) {
      setCurrentParagraphIndex((prev) => prev - 1);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Story Meta Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-6 dark:border-gray-800">
        <div>
          <div className="flex items-center gap-2 mb-2">
            {/* The level on its own. The subject used to sit in parentheses inside this
                pill, where it read as a gloss on the level — "Level B2 (DevOps & Cloud
                Q&A)" states as though the B2 were made of the topic. It is not: for nine
                of the eleven stories it names a subject rather than a difficulty, and the
                catalog card one page earlier already had this right, with the level in a
                pill and the subject as its own eyebrow above the title. Same two facts,
                same order, one page apart. */}
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              Level {story.level}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              {story.difficultyLabel}
            </span>
            <span className="text-xs text-gray-500">
              {story.wordCount} words • ~{story.readingTimeMinutes} min
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white">
            {story.title}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {/* "By" for a person, and nothing for a series or collection — see `authorIsPerson`. */}
            {story.authorIsPerson && 'By '}
            <span className="font-semibold text-gray-700 dark:text-gray-300">{story.author}</span>
          </p>
        </div>

        {/* Listen Full Story */}
        <button
          type="button"
          onClick={() => soundEngine.speak(paragraphs.join(' '))}
          className="flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-2.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
        >
          <Volume2 className="h-4 w-4" />
          <span>Listen Full Story</span>
        </button>
      </div>

      {/* Paragraph / Question Progress Tracker */}
      <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3 text-xs dark:bg-gray-900">
        <div className="font-semibold text-gray-700 dark:text-gray-300">
          {story.isQA ? 'Question' : 'Paragraph'} {currentParagraphIndex + 1} of {paragraphs.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentParagraphIndex === 0}
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-gray-800 dark:bg-gray-800"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Prev</span>
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={currentParagraphIndex === paragraphs.length - 1}
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-gray-800 dark:bg-gray-800"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Active Typing Engine for this Paragraph */}
      <TypingEngine
        passage={{ text: currentParagraph, title: passageTitle, sourceType: 'story' }}
        onNext={currentParagraphIndex < paragraphs.length - 1 ? handleNext : undefined}
        nextLabel={story.isQA ? 'Next Question' : 'Next Paragraph'}
      />

      {/* Story Overview & Reading Panel */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
        <div className="flex items-center gap-2 mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">
          <BookOpen className="h-4 w-4 text-indigo-500" />
          <span>{story.isQA ? 'Technical Interview Questions & Model Answers' : 'Full Story Reading Context'}</span>
        </div>
        <div className="space-y-4 text-base leading-relaxed text-gray-600 dark:text-gray-300">
          {paragraphs.map((p, idx) => {
            const isQA = p.startsWith('Q:') && p.includes(' A:');
            const [qPart, aPart] = isQA ? p.split(' A:') : [p, ''];

            // A button, not a div with an onClick: this panel is how a learner jumps
            // the typing board to any paragraph, and it was the only interactive
            // element in the app that could not be reached or activated from the
            // keyboard — in an app about the keyboard. The rest of the codebase
            // already uses `<button type="button">` for this; this one had drifted.
            // `font-[inherit]` and `text-left` are needed because a button inherits
            // neither the body's font nor its text alignment.
            return (
              <button
                type="button"
                key={idx}
                onClick={() => setCurrentParagraphIndex(idx)}
                aria-current={idx === currentParagraphIndex}
                // No `opacity-75` on the branch below. It dimmed the six paragraphs you are
                // *not* on to 3.01:1 against this panel's white — under the 4.5:1 that body
                // text owes — by compositing over the `text-gray-600` inherited from line
                // 149. They are the reading, not the chrome, and it was never the current
                // paragraph that needed fading: the current one is already set apart by the
                // indigo background, the ring, and the weight above.
                className={`block w-full cursor-pointer rounded-2xl p-4 text-left font-[inherit] transition-all ${
                  idx === currentParagraphIndex
                    ? 'bg-indigo-50/90 font-medium text-gray-900 shadow-sm ring-2 ring-indigo-400 dark:bg-indigo-950/40 dark:text-white dark:ring-indigo-600'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                }`}
              >
                {isQA ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-black text-white uppercase">
                        Q{idx + 1}
                      </span>
                      <span className="font-bold text-gray-900 dark:text-white text-sm sm:text-base">
                        {qPart.replace(/^Q:\s*/, '')}
                      </span>
                    </div>
                    <div className="flex items-start gap-2 text-xs sm:text-sm leading-relaxed text-gray-700 dark:text-gray-300 pl-2 sm:pl-4">
                      <span className="shrink-0 font-extrabold text-emerald-600 dark:text-emerald-400">
                        Answer:
                      </span>
                      <span>{aPart}</span>
                    </div>
                  </div>
                ) : (
                  <p>{p}</p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Key Vocabulary & Pronunciation Glossary */}
      {story.keyVocabulary.length > 0 && (
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
          <div className="flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-wider text-gray-400">
            <Award className="h-4 w-4 text-indigo-500" />
            <span>Key Vocabulary in this Story</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {story.keyVocabulary.map((v) => (
              <div
                key={v.word}
                className="flex flex-col gap-1.5 rounded-2xl border border-gray-100 bg-gray-50 p-4 transition hover:border-indigo-200 dark:border-gray-800 dark:bg-gray-800"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-gray-900 dark:text-white">
                      {v.word}
                    </span>
                    {v.phonetic && (
                      <span className="font-mono text-xs text-gray-400">{v.phonetic}</span>
                    )}
                    {v.pos && (
                      <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {v.pos}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => soundEngine.speak(v.word)}
                    // `aria-label`, and no `title`. The tooltip read "Pronounce word" on
                    // all four entries, so a learner tabbing through heard the same four
                    // times with nothing to tell them apart — and a tooltip is not a name
                    // in the first place, nor is it shown on a touch screen. The word is
                    // printed directly above this button and is what names it.
                    aria-label={`Pronounce ${v.word}`}
                    className="rounded-full p-1.5 text-gray-400 hover:bg-white hover:text-indigo-600 dark:hover:bg-gray-800"
                  >
                    <Volume2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300">{v.definition}</p>
                {v.translation && (
                  <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    {v.translation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
