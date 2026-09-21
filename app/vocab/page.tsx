'use client';

import React, { useState, useEffect } from 'react';
import { VOCAB_BANKS, VocabCategory } from '../../data/vocab';
import { useTypingStore } from '../../store/useTypingStore';
import TypingEngine from '../../components/typing/TypingEngine';
import { Bookmark, Volume2, ChevronRight, ChevronLeft } from 'lucide-react';
import { soundEngine } from '../../lib/audio';

export default function VocabPage() {
  const [selectedBank, setSelectedBank] = useState<VocabCategory>(VOCAB_BANKS[0]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const { loadCustomText } = useTypingStore();

  const words = selectedBank.words;
  const currentItem = words[currentWordIndex] || words[0];

  // Load active word into typing store
  useEffect(() => {
    if (currentItem) {
      loadCustomText(currentItem.word, `${selectedBank.title} (${currentWordIndex + 1}/${words.length})`);
    }
  }, [selectedBank, currentWordIndex, currentItem, loadCustomText, words.length]);

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
          English Word Banks
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Build spatial keyboard memory for essential English terms. Type each word, listen to native phonetics, and master accurate spelling.
        </p>
      </div>

      {/* Word Bank Category Selector Tabs */}
      <div className="mb-8 flex flex-wrap gap-2 justify-center">
        {VOCAB_BANKS.map((bank) => {
          const isActive = selectedBank.id === bank.id;
          return (
            <button
              key={bank.id}
              type="button"
              onClick={() => {
                setSelectedBank(bank);
                setCurrentWordIndex(0);
              }}
              className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold transition shadow-sm ${
                isActive
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
              }`}
            >
              <span>{bank.iconEmoji}</span>
              <span>{bank.title}</span>
            </button>
          );
        })}
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
                title="Hear word pronunciation"
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
        onNext={currentWordIndex < words.length - 1 ? handleNext : undefined}
        nextLabel="Next Word"
      />
    </div>
  );
}
