'use client';

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { Mic, MicOff, Volume2, AlertCircle } from 'lucide-react';
import {
  SpeechRecorder,
  isSpeechRecognitionSupported,
  evaluatePronunciation,
} from '../../lib/speech';
import { soundEngine } from '../../lib/audio';
import { SpeechEvaluationResult } from '../../lib/types';
import { useTypingStore } from '../../store/useTypingStore';

interface MicAssessmentProps {
  targetText: string;
  onEvaluated?: (result: SpeechEvaluationResult) => void;
}

export default function MicAssessment({ targetText, onEvaluated }: MicAssessmentProps) {
  const isSupported = useSyncExternalStore(
    () => () => {},
    () => isSpeechRecognitionSupported(),
    () => true
  );
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [result, setResult] = useState<SpeechEvaluationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prevTargetText, setPrevTargetText] = useState<string>(targetText);

  // Reset state during render if targetText changes
  if (targetText !== prevTargetText) {
    setPrevTargetText(targetText);
    setTranscript('');
    setResult(null);
    setErrorMessage(null);
  }

  const recorderRef = useRef<SpeechRecorder | null>(null);
  const { setSpeechResult } = useTypingStore();

  const handleResult = useCallback(
    (spokenText: string) => {
      setTranscript(spokenText);
      setIsListening(false);

      // Evaluate pronunciation against current target text
      const evalResult = evaluatePronunciation(targetText, spokenText);
      setResult(evalResult);
      setSpeechResult(evalResult);
      if (onEvaluated) onEvaluated(evalResult);
    },
    [targetText, onEvaluated, setSpeechResult]
  );

  const handleError = useCallback((err: string) => {
    setIsListening(false);
    setErrorMessage(err);
  }, []);

  const handleEnd = useCallback(() => {
    setIsListening(false);
  }, []);

  // Initialize recorder
  useEffect(() => {
    recorderRef.current = new SpeechRecorder(handleResult, handleError, handleEnd);
    return () => {
      if (recorderRef.current) {
        recorderRef.current.stop();
      }
    };
  }, [handleResult, handleError, handleEnd]);

  const toggleListening = () => {
    if (!recorderRef.current) return;
    setErrorMessage(null);

    if (isListening) {
      recorderRef.current.stop();
      setIsListening(false);
    } else {
      setResult(null);
      setTranscript('');
      setIsListening(true);
      recorderRef.current.start();
    }
  };

  const handleListenNative = () => {
    soundEngine.speak(targetText);
  };

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
        <MicOff className="h-4 w-4 text-gray-400" />
        <span>Voice assessment is supported on Chrome, Edge, and Safari browsers.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleListening}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shadow-sm ${
              isListening
                ? 'animate-pulse bg-rose-600 text-white shadow-rose-500/30'
                : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-indigo-500/20'
            }`}
          >
            {isListening ? <MicOff className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            <span>{isListening ? 'Listening: Speak Now...' : 'Test Pronunciation (Mic)'}</span>
          </button>

          <button
            type="button"
            onClick={handleListenNative}
            title="Listen to native pronunciation"
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200"
          >
            <Volume2 className="h-4 w-4 text-indigo-500" />
            <span>Hear Native Voice</span>
          </button>
        </div>

        {/* Pronunciation Score Badge */}
        {result && (
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                result.accuracyScore >= 80
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : result.accuracyScore >= 50
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
              }`}
            >
              Pronunciation: {result.accuracyScore}% Match
            </span>
          </div>
        )}
      </div>

      {/* Error Notice */}
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage} (Please allow microphone access in your browser).</span>
        </div>
      )}

      {/* Spoken transcript breakdown */}
      {transcript && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs dark:border-gray-800/80 dark:bg-gray-800/40">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            What the microphone heard:
          </div>
          <p className="font-mono text-sm text-gray-800 dark:text-gray-200">
            &quot;{transcript}&quot;
          </p>

          {result && (
            <div className="mt-2 flex flex-wrap gap-1">
              {targetText.split(' ').map((word, i) => {
                const clean = word.toLowerCase().replace(/[.,!?"']/g, '');
                const matched = result.matchedWords.includes(clean);
                return (
                  <span
                    key={i}
                    className={`rounded px-1.5 py-0.5 text-xs font-mono font-medium ${
                      matched
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-rose-100 text-rose-800 line-through dark:bg-rose-900/40 dark:text-rose-300'
                    }`}
                  >
                    {word}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
