'use client';

import React, { useState, useEffect } from 'react';
import { StoryItem } from '../../lib/types';
import { useTypingStore } from '../../store/useTypingStore';
import TypingEngine from './TypingEngine';
import { Volume2, BookOpen, ChevronRight, ChevronLeft, Award } from 'lucide-react';
import { soundEngine } from '../../lib/audio';

interface StoryReaderProps {
  story: StoryItem;
}

export default function StoryReader({ story }: StoryReaderProps) {
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
  const { loadCustomText } = useTypingStore();

  const paragraphs = story.paragraphs;
  const currentParagraph = paragraphs[currentParagraphIndex] || '';

  // Load active paragraph into typing store
  useEffect(() => {
    loadCustomText(currentParagraph, `${story.title} (Part ${currentParagraphIndex + 1}/${paragraphs.length})`);
  }, [currentParagraphIndex, currentParagraph, story.title, loadCustomText]);

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
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              Level {story.level} ({story.difficultyLabel})
            </span>
            <span className="text-xs text-gray-500">
              {story.wordCount} words • ~{story.readingTimeMinutes} min
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white">
            {story.title}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            By <span className="font-semibold text-gray-700 dark:text-gray-300">{story.author}</span>
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

      {/* Paragraph Progress Tracker */}
      <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3 text-xs dark:bg-gray-900">
        <div className="font-semibold text-gray-700 dark:text-gray-300">
          Paragraph {currentParagraphIndex + 1} of {paragraphs.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentParagraphIndex === 0}
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-gray-800 dark:bg-gray-850"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Prev</span>
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={currentParagraphIndex === paragraphs.length - 1}
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-semibold disabled:opacity-40 dark:border-gray-800 dark:bg-gray-850"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Active Typing & Voice Engine for this Paragraph */}
      <TypingEngine />

      {/* Story Overview & Reading Panel */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
        <div className="flex items-center gap-2 mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">
          <BookOpen className="h-4 w-4 text-indigo-500" />
          <span>Full Story Reading Context</span>
        </div>
        <div className="space-y-4 text-base leading-relaxed text-gray-600 dark:text-gray-300">
          {paragraphs.map((p, idx) => (
            <p
              key={idx}
              onClick={() => setCurrentParagraphIndex(idx)}
              className={`cursor-pointer rounded-xl p-3 transition-all ${
                idx === currentParagraphIndex
                  ? 'bg-indigo-50/80 font-medium text-gray-900 shadow-sm ring-1 ring-indigo-300 dark:bg-indigo-950/30 dark:text-white dark:ring-indigo-700'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/40 opacity-75'
              }`}
            >
              {p}
            </p>
          ))}
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
                className="flex flex-col gap-1.5 rounded-2xl border border-gray-100 bg-gray-50 p-4 transition hover:border-indigo-200 dark:border-gray-800 dark:bg-gray-850"
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
                    title="Pronounce word"
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
