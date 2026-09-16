'use client';

import React, { useState } from 'react';
import { useTypingStore } from '../../store/useTypingStore';
import TypingEngine from '../../components/typing/TypingEngine';
import { FileText, Play } from 'lucide-react';

const SAMPLES = [
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

export default function CustomTextPage() {
  const [inputText, setInputText] = useState(SAMPLES[0].text);
  const [customTitle, setCustomTitle] = useState(SAMPLES[0].title);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const { loadCustomText } = useTypingStore();

  const handleStart = () => {
    if (!inputText.trim()) return;
    loadCustomText(inputText, customTitle || 'Custom Text');
    setIsSessionActive(true);
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
          Custom Type &amp; Speak Practice
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Paste your own English reading assignment, novel chapter, or study notes. Practice typing it and test your pronunciation with the microphone.
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
                  setInputText(s.text);
                  setCustomTitle(s.title);
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
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Paste any article, sentence, or dialogue..."
          className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 font-mono text-sm leading-relaxed text-gray-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-gray-800 dark:bg-gray-850 dark:text-gray-100"
        />

        <div className="mt-4 flex justify-between items-center">
          <span className="text-xs text-gray-400">
            {inputText.trim() ? inputText.trim().split(/\s+/).length : 0} words
          </span>
          <button
            type="button"
            onClick={handleStart}
            disabled={!inputText.trim()}
            className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-500/20 transition hover:bg-indigo-500 disabled:opacity-40"
          >
            <Play className="h-4 w-4" />
            <span>Load &amp; Start Practice</span>
          </button>
        </div>
      </div>

      {/* Typing & Microphone Arena */}
      {isSessionActive && <TypingEngine />}
    </div>
  );
}
