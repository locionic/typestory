'use client';

import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  AlertCircle,
  Sparkles,
  RotateCcw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  ContinuousSpeechCaptioner,
  isSpeechRecognitionSupported,
} from '../../lib/speech';
import { soundEngine } from '../../lib/audio';
import { LiveSpeechState, SpokenWordStatus } from '../../lib/types';

interface LiveCaptionStreamProps {
  targetText: string;
  onAccuracyChange?: (accuracy: number) => void;
}

export default function LiveCaptionStream({
  targetText,
  onAccuracyChange,
}: LiveCaptionStreamProps) {
  const isSupported = useSyncExternalStore(
    () => () => {},
    () => isSpeechRecognitionSupported(),
    () => true
  );

  const [speechState, setSpeechState] = useState<LiveSpeechState>({
    isListening: false,
    liveTranscript: '',
    interimTranscript: '',
    finalTranscript: '',
    words: [],
    accuracyScore: 0,
    correctCount: 0,
    incorrectCount: 0,
    totalWordsCount: 0,
    isAllMatched: false,
    errorMessage: null,
  });

  const captionerRef = useRef<ContinuousSpeechCaptioner | null>(null);

  // Initialize captioner on client
  useEffect(() => {
    captionerRef.current = new ContinuousSpeechCaptioner((newState) => {
      setSpeechState(newState);
      if (onAccuracyChange) {
        onAccuracyChange(newState.accuracyScore);
      }
    });

    return () => {
      if (captionerRef.current) {
        captionerRef.current.stop();
      }
    };
  }, [onAccuracyChange]);

  // Update target text when passage changes
  useEffect(() => {
    if (captionerRef.current) {
      captionerRef.current.setTargetText(targetText);
    }
  }, [targetText]);

  const toggleListening = () => {
    if (!captionerRef.current) return;

    if (speechState.isListening) {
      captionerRef.current.stop();
    } else {
      captionerRef.current.start(targetText);
    }
  };

  const handleReset = () => {
    if (captionerRef.current) {
      captionerRef.current.reset();
    }
  };

  const handleSpeakWord = (word: string) => {
    soundEngine.speak(word);
  };

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
        <MicOff className="h-4 w-4 text-gray-400" />
        <span>
          Real-time Chrome Live Speech Captions are supported on Google Chrome, Microsoft Edge, and Safari browsers.
        </span>
      </div>
    );
  }

  // Pre-split words if words array is empty
  const displayWords: SpokenWordStatus[] =
    speechState.words.length > 0
      ? speechState.words
      : targetText
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => ({
            word: w,
            normalized: w.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, ''),
            status: 'pending',
          }));

  const evaluatedWordsCount = speechState.correctCount + speechState.incorrectCount;

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/20 p-5 shadow-sm dark:border-indigo-950/50 dark:from-gray-900 dark:to-indigo-950/10 sm:p-6">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-500/20">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Chrome Live Captions &amp; Spoken Word Evaluation
              </h3>
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                Live AI Engine
              </span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Speak the text into your microphone to verify each word in real-time
            </p>
          </div>
        </div>

        {/* Live Accuracy Meter & Controls */}
        <div className="flex items-center gap-2">
          {evaluatedWordsCount > 0 && (
            <div
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black shadow-xs ${
                speechState.accuracyScore >= 80
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : speechState.accuracyScore >= 50
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
              }`}
            >
              <span>Spoken Accuracy:</span>
              <span className="font-mono text-sm">{speechState.accuracyScore}%</span>
            </div>
          )}

          {/* Start/Stop Button */}
          <button
            type="button"
            onClick={toggleListening}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shadow-sm ${
              speechState.isListening
                ? 'animate-pulse bg-rose-600 text-white shadow-rose-500/30 ring-2 ring-rose-400'
                : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-indigo-500/20'
            }`}
          >
            {speechState.isListening ? (
              <>
                <MicOff className="h-4 w-4" />
                <span>Stop Captions</span>
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                <span>Start Live Captions</span>
              </>
            )}
          </button>

          {/* Hear Native Reference */}
          <button
            type="button"
            onClick={() => soundEngine.speak(targetText)}
            title="Hear native English pronunciation"
            className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200"
          >
            <Volume2 className="h-4 w-4 text-indigo-500" />
            <span className="hidden sm:inline">Hear Native</span>
          </button>

          {speechState.liveTranscript && (
            <button
              type="button"
              onClick={handleReset}
              title="Reset speech transcript"
              className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 hover:text-gray-800 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Error Message Notice */}
      {speechState.errorMessage && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{speechState.errorMessage}</span>
        </div>
      )}

      {/* Chrome Live Streaming Caption Box */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-900 p-4 text-white shadow-inner dark:border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                speechState.isListening
                  ? 'bg-rose-500 animate-ping'
                  : 'bg-gray-500'
              }`}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              {speechState.isListening
                ? 'Google Chrome Live Caption Stream (Active)'
                : 'Chrome Live Caption Stream (Idle)'}
            </span>
          </div>

          {speechState.isListening && (
            <div className="flex items-center gap-1">
              <span className="inline-block h-3 w-0.5 animate-pulse bg-emerald-400" />
              <span className="inline-block h-4 w-0.5 animate-pulse bg-emerald-400 delay-75" />
              <span className="inline-block h-2 w-0.5 animate-pulse bg-emerald-400 delay-150" />
              <span className="inline-block h-5 w-0.5 animate-pulse bg-emerald-400 delay-200" />
            </div>
          )}
        </div>

        <p className="font-mono text-sm sm:text-base leading-relaxed text-gray-100 min-h-[2.5rem] flex items-center flex-wrap gap-1">
          {speechState.liveTranscript ? (
            <>
              <span className="text-gray-200">&quot;{speechState.finalTranscript}</span>
              {speechState.interimTranscript && (
                <span className="rounded bg-indigo-500/30 px-1 text-amber-300 underline underline-offset-2">
                  {speechState.interimTranscript}
                </span>
              )}
              <span className="text-gray-200">&quot;</span>
            </>
          ) : (
            <span className="text-gray-400 italic text-xs">
              {speechState.isListening
                ? 'Listening to your microphone... start speaking the sentence above.'
                : 'Click "Start Live Captions" above, then read the sentence into your microphone.'}
            </span>
          )}
        </p>
      </div>

      {/* Target Passage Word-by-Word Live Verification Grid */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Real-time Spoken Word Calculation:
          </span>
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Correct
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> Needs Work
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Speaking
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" /> Pending
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-inner dark:border-gray-800 dark:bg-gray-900">
          {displayWords.map((item, idx) => {
            let badgeClass =
              'border border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400';
            let icon = null;

            if (item.status === 'correct') {
              badgeClass =
                'border border-emerald-300 bg-emerald-50 text-emerald-800 font-bold shadow-xs dark:border-emerald-800/80 dark:bg-emerald-950/40 dark:text-emerald-300';
              icon = <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 inline ml-0.5" />;
            } else if (item.status === 'incorrect') {
              badgeClass =
                'border border-rose-300 bg-rose-50 text-rose-800 line-through decoration-rose-500 font-bold dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300';
              icon = <XCircle className="h-3 w-3 text-rose-600 dark:text-rose-400 inline ml-0.5" />;
            } else if (item.status === 'speaking') {
              badgeClass =
                'border border-amber-400 bg-amber-100 text-amber-900 font-bold animate-pulse ring-2 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-200';
            }

            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSpeakWord(item.word)}
                title={`Click to pronounce "${item.word}" (Heard: ${item.matchedSpokenWord || 'Not yet'})`}
                className={`flex items-center gap-1 rounded-xl px-2.5 py-1 font-mono text-xs sm:text-sm transition-all hover:scale-105 ${badgeClass}`}
              >
                <span>{item.word}</span>
                {icon}
              </button>
            );
          })}
        </div>
      </div>

      {/* Completion Banner */}
      {speechState.isAllMatched && (
        <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30 animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                100% Speech Pronunciation Match!
              </div>
              <div className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                Every word in this passage was recognized and verified cleanly by Google Chrome.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
