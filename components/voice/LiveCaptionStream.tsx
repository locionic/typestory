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
  Activity,
  Play,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import {
  ContinuousSpeechCaptioner,
  isSpeechRecognitionSupported,
  isBraveBrowser,
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
    isMicActive: false,
    audioLevel: 0,
    engineStatus: 'idle',
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
    errorType: null,
  });

  const isBrave = useSyncExternalStore(
    () => () => {},
    () => isBraveBrowser(),
    () => false
  );
  const [showMicTester, setShowMicTester] = useState(false);
  const [hasDetectedSoundWithoutText, setHasDetectedSoundWithoutText] = useState(false);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null);
  const [testCountdown, setTestCountdown] = useState<number>(0);
  const [testStatus, setTestStatus] = useState<string | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (
      speechState.isListening &&
      (speechState.engineStatus === 'hearing-speech' || speechState.engineStatus === 'hearing-sound') &&
      !speechState.liveTranscript
    ) {
      timer = setTimeout(() => {
        setHasDetectedSoundWithoutText(true);
      }, 4500);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [speechState.isListening, speechState.engineStatus, speechState.liveTranscript]);

  const showSoundWithoutTextWarning =
    hasDetectedSoundWithoutText && speechState.isListening && !speechState.liveTranscript;

  const captionerRef = useRef<ContinuousSpeechCaptioner | null>(null);
  const onAccuracyChangeRef = useRef(onAccuracyChange);
  useEffect(() => {
    onAccuracyChangeRef.current = onAccuracyChange;
  }, [onAccuracyChange]);

  // Initialize captioner on client
  useEffect(() => {
    captionerRef.current = new ContinuousSpeechCaptioner((newState) => {
      setSpeechState(newState);
      if (onAccuracyChangeRef.current) {
        onAccuracyChangeRef.current(newState.accuracyScore);
      }
    });

    return () => {
      if (captionerRef.current) {
        captionerRef.current.stop();
      }
    };
  }, []);

  // Update target text when passage changes
  useEffect(() => {
    if (captionerRef.current) {
      captionerRef.current.setTargetText(targetText);
    }
  }, [targetText]);

  const toggleListening = async () => {
    if (!captionerRef.current) return;

    if (speechState.isListening) {
      captionerRef.current.stop();
    } else {
      await captionerRef.current.start(targetText);
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

  // Hardware Microphone Self-Test
  const runMicHardwareTest = async () => {
    try {
      setIsTestingMic(true);
      setTestStatus('Listening to your microphone... Say a sentence out loud now!');
      setTestCountdown(3);
      setTestAudioUrl(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setTestAudioUrl(url);
        setIsTestingMic(false);
        setTestStatus('Audio captured! Click "Play My Voice" below to verify your physical microphone.');
      };

      mediaRecorder.start();

      let cd = 3;
      const timer = setInterval(() => {
        cd -= 1;
        setTestCountdown(cd);
        if (cd <= 0) {
          clearInterval(timer);
          if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
        }
      }, 1000);
    } catch (err: unknown) {
      setIsTestingMic(false);
      const msg = err instanceof Error ? err.message : String(err);
      setTestStatus(`Microphone access blocked or failed: ${msg}. Check browser address bar permissions.`);
    }
  };

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
            normalized: w.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’“”]/g, ''),
            status: 'pending',
          }));

  const evaluatedWordsCount = speechState.correctCount + speechState.incorrectCount;

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/20 p-5 shadow-sm dark:border-indigo-950/50 dark:from-gray-900 dark:to-indigo-950/10 sm:p-6">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-500/20">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Live Speech Recognition &amp; Spoken Word Evaluation
              </h3>
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                Live Engine
              </span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Speak the text into your microphone to verify each word in real-time
            </p>
          </div>
        </div>

        {/* Live Accuracy Meter & Controls */}
        <div className="flex flex-wrap items-center gap-2">
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

          {/* Start/Stop Live Microphone Button */}
          <button
            type="button"
            onClick={toggleListening}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shadow-sm ${
              speechState.isListening
                ? 'animate-pulse bg-rose-600 text-white shadow-rose-500/30 ring-2 ring-rose-400 hover:bg-rose-500'
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

          {/* Hardware Mic Tester Toggle */}
          <button
            type="button"
            onClick={() => setShowMicTester((prev) => !prev)}
            title="Test your physical microphone hardware"
            className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300"
          >
            <Activity className="h-3.5 w-3.5 text-emerald-500" />
            <span className="hidden sm:inline">Test Mic</span>
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

      {/* Real-time Speech Volume & Acoustic Monitor */}
      {speechState.isListening && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200/60 bg-emerald-50/60 px-4 py-2.5 text-xs text-emerald-950 dark:border-emerald-950/60 dark:bg-emerald-950/20 dark:text-emerald-200 animate-fadeIn">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="font-bold text-[11px]">Speech Monitor:</span>
            </div>
            {/* 8-segment dynamic VU meter */}
            <div className="flex items-end gap-[3px] h-4 w-20">
              {[8, 20, 32, 45, 58, 70, 82, 92].map((threshold, idx) => (
                <span
                  key={idx}
                  className={`w-2 rounded-xs transition-all duration-75 ${
                    speechState.audioLevel >= threshold
                      ? speechState.audioLevel >= 75
                        ? 'bg-rose-500 h-full'
                        : speechState.audioLevel >= 45
                        ? 'bg-amber-500 h-full'
                        : 'bg-emerald-500 h-full'
                      : 'bg-emerald-200 dark:bg-emerald-900/60 h-1.5'
                  }`}
                />
              ))}
            </div>
            <span className="font-mono text-[11px] font-bold">
              {speechState.audioLevel}%
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            {speechState.engineStatus === 'hearing-speech' ? (
              <span className="font-semibold text-emerald-700 dark:text-emerald-300 animate-pulse">
                🎙️ Voice detected! Transcribing and calculating words...
              </span>
            ) : speechState.engineStatus === 'hearing-sound' ? (
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                🔊 Sound detected! Say the words above into your mic...
              </span>
            ) : speechState.engineStatus === 'transcribed' ? (
              <span className="font-bold text-emerald-700 dark:text-emerald-300">
                ✨ Spoken words evaluated live!
              </span>
            ) : (
              <span className="text-emerald-600/80 dark:text-emerald-400/80 italic">
                Listening... Read the sentence above into your microphone.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Hardware Mic Tester Accordion Box */}
      {showMicTester && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 text-xs dark:border-indigo-900 dark:bg-indigo-950/20 animate-fadeIn">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-indigo-600" />
              Microphone Hardware &amp; Audio Input Diagnostics
            </span>
            <button
              type="button"
              onClick={() => setShowMicTester(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <p className="text-gray-600 dark:text-gray-300 mb-3">
            Click &quot;Record 3-Second Audio Test&quot; to test whether your physical microphone and browser permissions are picking up audio.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isTestingMic}
              onClick={runMicHardwareTest}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50"
            >
              <Mic className="h-3.5 w-3.5" />
              <span>{isTestingMic ? `Recording... (${testCountdown}s)` : 'Record 3-Second Audio Test'}</span>
            </button>

            {testAudioUrl && (
              <button
                type="button"
                onClick={() => {
                  const audio = new Audio(testAudioUrl);
                  audio.play();
                }}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 font-bold text-white shadow-xs hover:bg-emerald-500"
              >
                <Play className="h-3.5 w-3.5" />
                <span>Play Back My Recorded Voice</span>
              </button>
            )}
          </div>
          {testStatus && (
            <div className="mt-2 text-[11px] font-semibold text-indigo-800 dark:text-indigo-300">
              {testStatus}
            </div>
          )}
        </div>
      )}

      {/* Brave Browser Diagnostic Notification */}
      {isBrave && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <HelpCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <span className="font-bold">Brave Browser Notice:</span> Brave disables Google Cloud speech services by default.
            If live speech does not transcribe when speaking, open <code className="rounded bg-amber-200/60 px-1 py-0.5 font-mono text-[10px] dark:bg-amber-900/60">brave://settings/privacy</code> and toggle ON &quot;Use Google services for push messaging and speech recognition&quot;, or open TypeStory in standard Google Chrome / Microsoft Edge.
          </div>
        </div>
      )}

      {/* Browser Support Notice */}
      {!isSupported && (
        <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <MicOff className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Google Chrome Live Speech Recognition is recommended on Google Chrome, Microsoft Edge, or Safari. Your current browser may not have native Web Speech API support enabled.
          </span>
        </div>
      )}

      {/* Error Message Notice & Diagnostics */}
      {speechState.errorMessage && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <div>
              <span className="font-bold">Notice: </span>
              <span>{speechState.errorMessage}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleListening}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-rose-200/60 px-2.5 py-1 text-[11px] font-bold text-rose-900 hover:bg-rose-200 dark:bg-rose-900/60 dark:text-rose-100"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Brave Browser Google Speech Advisory Banner */}
      {isBrave && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <span className="font-bold">Notice for Brave Browser users: </span>
            <span>
              Brave disables Google Speech Recognition by default. If your spoken words do not appear, go to{' '}
              <code className="rounded bg-amber-200/60 px-1 py-0.5 font-mono text-[10px] dark:bg-amber-900/60">
                brave://settings/privacy
              </code>{' '}
              and toggle on <strong>&quot;Use Google services for speech recognition&quot;</strong>, or use Google Chrome / Microsoft Edge.
            </span>
          </div>
        </div>
      )}

      {/* Sound Detected Without Text Advisory Card */}
      {showSoundWithoutTextWarning && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 animate-fadeIn">
          <div className="flex items-start gap-2.5">
            <HelpCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <div>
              <span className="font-bold">Sound heard from microphone, but words have not transcribed yet:</span>
              <div className="mt-1 space-y-1 text-[11px] text-amber-900/90 dark:text-amber-300/90">
                <div>
                  1. <strong>Microphone Clarity:</strong> Speak clearly and at a normal conversational volume directly into your default microphone.
                </div>
                <div>
                  2. <strong>Browser Privacy:</strong> If using Brave Browser, make sure Google Speech Services are enabled in <code className="rounded bg-amber-200/60 px-1 py-0.5 font-mono text-[10px] dark:bg-amber-900/60">brave://settings/privacy</code>, or use Google Chrome.
                </div>
                <div>
                  3. <strong>Permissions:</strong> Check the lock/tune icon in your browser URL bar to ensure microphone access is set to &quot;Allow&quot;.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Google Chrome Live Streaming Caption Box */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-900 p-4 text-white shadow-inner dark:border-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
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
                ? 'Chrome Live Caption Stream'
                : 'Chrome Live Caption Stream (Idle)'}
            </span>

            {/* Live Engine Status Badge */}
            {speechState.isListening && (
              <span className="rounded-md bg-gray-800 px-2 py-0.5 text-[10px] font-semibold border border-gray-700">
                {speechState.engineStatus === 'hearing-speech' ? (
                  <span className="text-emerald-400 font-bold">🗣️ Hearing Speech! Transcribing...</span>
                ) : speechState.engineStatus === 'hearing-sound' ? (
                  <span className="text-amber-300">🔊 Sound Detected</span>
                ) : speechState.engineStatus === 'transcribed' ? (
                  <span className="text-emerald-400 font-bold">✨ Transcribed</span>
                ) : (
                  <span className="text-indigo-300">🟢 Engine Active</span>
                )}
              </span>
            )}
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
              {speechState.isListening ? (
                speechState.engineStatus === 'hearing-speech' ? (
                  <span className="text-emerald-400 not-italic font-medium">
                    🗣️ Hearing your voice... Speaking recognized! Words incoming...
                  </span>
                ) : speechState.engineStatus === 'hearing-sound' ? (
                  <span className="text-amber-300 not-italic">
                    🔊 Sound detected... Speak clearly into your microphone!
                  </span>
                ) : (
                  'Microphone active! Read the sentence aloud into your microphone...'
                )
              ) : (
                'Click "Start Live Captions" above, then read the sentence into your microphone.'
              )}
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
