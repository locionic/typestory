'use client';

import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { RotateCcw, Zap, Target, CheckCircle2, Play, Volume2 } from 'lucide-react';
import { useTypingStore } from '../../store/useTypingStore';
import MicAssessment from '../voice/MicAssessment';
import { soundEngine } from '../../lib/audio';

export default function TypingEngine() {
  const {
    title,
    targetText,
    typedText,
    startTime,
    totalKeystrokes,
    correctKeystrokes,
    incorrectKeystrokes,
    isCompleted,
    handleKeyInput,
    handleBackspace,
    resetSession,
  } = useTypingStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Live timer tick
  useEffect(() => {
    if (!startTime || isCompleted) return;

    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startTime) / 1000)));
    }, 250);

    return () => clearInterval(interval);
  }, [startTime, isCompleted]);

  // Reset timer on restart
  useEffect(() => {
    if (!startTime) {
      setElapsedSeconds(0);
    }
  }, [startTime]);

  // Confetti on completion
  useEffect(() => {
    if (isCompleted) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  }, [isCompleted]);

  // Global keydown listener for zero-friction typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore functional hotkeys (Cmd+R, Ctrl+Shift+I, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        return;
      }

      if (e.key === 'Escape') {
        resetSession();
        return;
      }

      // Single printable characters
      if (e.key.length === 1) {
        e.preventDefault();
        handleKeyInput(e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyInput, handleBackspace, resetSession]);

  // Calculate live metrics
  const wpm =
    elapsedSeconds > 0
      ? Math.round((correctKeystrokes / 5) / (elapsedSeconds / 60))
      : 0;

  const accuracy =
    totalKeystrokes > 0
      ? Math.round((correctKeystrokes / totalKeystrokes) * 100)
      : 100;

  const progress =
    targetText.length > 0
      ? Math.min(100, Math.round((typedText.length / targetText.length) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-6" ref={containerRef}>
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
                {accuracy}%
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
            onClick={() => soundEngine.speak(targetText)}
            title="Read text aloud"
            className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Volume2 className="h-3.5 w-3.5 text-indigo-500" />
            <span>Listen</span>
          </button>
          <button
            type="button"
            onClick={resetSession}
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
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          {title}
        </div>

        {/* Character By Character Rendering */}
        <div className="font-mono text-xl sm:text-2xl leading-relaxed tracking-wide select-none">
          {targetText.split('').map((char, index) => {
            const isTyped = index < typedText.length;
            const isCurrent = index === typedText.length;
            const isCorrect = isTyped && typedText[index] === char;
            const isWrong = isTyped && typedText[index] !== char;

            let charClass = 'text-gray-300 dark:text-gray-600';
            if (isCorrect) {
              charClass = 'text-emerald-600 dark:text-emerald-400';
            } else if (isWrong) {
              charClass = 'bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-sm';
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
          <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center animate-fadeIn dark:bg-emerald-950/20">
            <h3 className="text-xl font-bold text-emerald-900 dark:text-emerald-200">
              Passage Completed! Great Job!
            </h3>
            <p className="mt-2 text-sm text-emerald-800/80 dark:text-emerald-300/80">
              You typed at <span className="font-bold">{wpm} WPM</span> with{' '}
              <span className="font-bold">{accuracy}% accuracy</span>.
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <button
                type="button"
                onClick={resetSession}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-md transition hover:bg-emerald-500"
              >
                Practice Again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Microphone Voice Pronunciation Assessment */}
      <MicAssessment targetText={targetText} />
    </div>
  );
}
