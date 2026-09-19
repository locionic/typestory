import { SpeechEvaluationResult, LiveSpeechState, SpokenWordStatus } from './types';

// Web Speech API interface definitions
interface SpeechRecognitionResultItem {
  readonly transcript: string;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionResultItem;
}

interface ISpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResult;
  };
}

interface ISpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface ISpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onerror: ((event: ISpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onsoundend?: (() => void) | null;
  onaudioend?: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => ISpeechRecognitionInstance;

interface IWindowSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as IWindowSpeech;
  return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
}

export function isBraveBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } }).brave;
}

// Clean text for speech matching (lowercase, strip punctuation and smart quotes)
export function normalizeForSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein distance for fuzzy speech alignment
export function getLevenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// Check if a spoken word matches the target word phonetically or via edit distance
export function isWordMatch(target: string, spoken: string): boolean {
  const t = normalizeForSpeech(target);
  const s = normalizeForSpeech(spoken);
  if (!t || !s) return false;
  if (t === s) return true;

  // Numbers to words mapping
  const numMap: Record<string, string> = {
    '1': 'one', '1st': 'first',
    '2': 'two', '2nd': 'second',
    '3': 'three', '3rd': 'third',
    '4': 'four', '4th': 'fourth',
    '5': 'five', '5th': 'fifth',
    '6': 'six', '6th': 'sixth',
    '7': 'seven', '7th': 'seventh',
    '8': 'eight', '8th': 'eighth',
    '9': 'nine', '9th': 'ninth',
    '10': 'ten', '10th': 'tenth',
  };
  if (numMap[t] === s || numMap[s] === t) return true;

  // Common homophones & contractions
  const homophones: Record<string, string[]> = {
    there: ['their', 'theyre'],
    their: ['there', 'theyre'],
    theyre: ['there', 'their'],
    to: ['too', 'two'],
    too: ['to', 'two'],
    two: ['to', 'too'],
    hear: ['here'],
    here: ['hear'],
    hare: ['hair'],
    hair: ['hare'],
    its: ['it', 'tis'],
    dont: ['do not'],
    wont: ['will not'],
    cant: ['cannot'],
    im: ['i am'],
    youre: ['you are'],
    were: ['we are'],
    sun: ['son'],
    son: ['sun'],
    right: ['write'],
    write: ['right'],
    no: ['know'],
    know: ['no'],
    new: ['knew'],
    knew: ['new'],
  };
  if (homophones[t] && homophones[t].includes(s)) return true;
  if (homophones[s] && homophones[s].includes(t)) return true;

  const maxLen = Math.max(t.length, s.length);
  const dist = getLevenshteinDistance(t, s);
  if (maxLen <= 3) return dist === 0;
  if (maxLen <= 6) return dist <= 1;
  return dist <= 2;
}

// Align incoming live spoken stream against target words in real-time
export function alignSpokenWordsWithTarget(
  targetText: string,
  spokenFinalText: string,
  interimText: string = ''
): {
  words: SpokenWordStatus[];
  accuracyScore: number;
  correctCount: number;
  incorrectCount: number;
  totalWordsCount: number;
  isAllMatched: boolean;
} {
  const rawTargetWords = targetText.trim().split(/\s+/).filter(Boolean);
  if (rawTargetWords.length === 0) {
    return {
      words: [],
      accuracyScore: 0,
      correctCount: 0,
      incorrectCount: 0,
      totalWordsCount: 0,
      isAllMatched: false,
    };
  }

  // Parse spoken words
  const finalWords = spokenFinalText.trim().split(/\s+/).filter(Boolean);
  const interimWords = interimText.trim().split(/\s+/).filter(Boolean);

  let spokenPtr = 0;
  let correctCount = 0;
  let incorrectCount = 0;

  const resultWords: SpokenWordStatus[] = [];

  for (let i = 0; i < rawTargetWords.length; i++) {
    const rawWord = rawTargetWords[i];
    const normTarget = normalizeForSpeech(rawWord);

    if (spokenPtr < finalWords.length) {
      const currentSpoken = finalWords[spokenPtr];
      const nextSpoken = finalWords[spokenPtr + 1];
      const nextAfterSpoken = finalWords[spokenPtr + 2];

      if (isWordMatch(normTarget, currentSpoken)) {
        // Direct match with settled spoken word
        resultWords.push({
          word: rawWord,
          normalized: normTarget,
          status: 'correct',
          matchedSpokenWord: currentSpoken,
        });
        correctCount++;
        spokenPtr++;
      } else if (nextSpoken && isWordMatch(normTarget, nextSpoken)) {
        // User uttered a filler word (e.g. "uh", "um"), match next
        resultWords.push({
          word: rawWord,
          normalized: normTarget,
          status: 'correct',
          matchedSpokenWord: nextSpoken,
        });
        correctCount++;
        spokenPtr += 2;
      } else if (nextAfterSpoken && isWordMatch(normTarget, nextAfterSpoken)) {
        // User uttered 2 filler words or repeated
        resultWords.push({
          word: rawWord,
          normalized: normTarget,
          status: 'correct',
          matchedSpokenWord: nextAfterSpoken,
        });
        correctCount++;
        spokenPtr += 3;
      } else {
        // Check if user skipped ahead to the next target word
        const nextTarget = rawTargetWords[i + 1] ? normalizeForSpeech(rawTargetWords[i + 1]) : null;
        if (nextTarget && isWordMatch(nextTarget, currentSpoken)) {
          // Current target word was skipped or mispronounced; do not advance spokenPtr so nextTarget can claim it
          resultWords.push({
            word: rawWord,
            normalized: normTarget,
            status: 'incorrect',
          });
          incorrectCount++;
        } else {
          // Word was attempted but mispronounced
          resultWords.push({
            word: rawWord,
            normalized: normTarget,
            status: 'incorrect',
            matchedSpokenWord: currentSpoken,
          });
          incorrectCount++;
          spokenPtr++;
        }
      }
    } else if (interimWords.length > 0) {
      // Check interim words currently in flight
      const currentInterim = interimWords[0];
      if (isWordMatch(normTarget, currentInterim)) {
        resultWords.push({
          word: rawWord,
          normalized: normTarget,
          status: 'correct',
          matchedSpokenWord: currentInterim,
        });
        correctCount++;
      } else {
        resultWords.push({
          word: rawWord,
          normalized: normTarget,
          status: 'speaking',
          matchedSpokenWord: currentInterim,
        });
      }
      interimWords.shift();
    } else {
      // Not reached yet
      resultWords.push({
        word: rawWord,
        normalized: normTarget,
        status: 'pending',
      });
    }
  }

  const evaluatedWords = correctCount + incorrectCount;
  const accuracyScore =
    evaluatedWords > 0 ? Math.round((correctCount / evaluatedWords) * 100) : 0;
  const isAllMatched = correctCount === rawTargetWords.length;

  return {
    words: resultWords,
    accuracyScore,
    correctCount,
    incorrectCount,
    totalWordsCount: rawTargetWords.length,
    isAllMatched,
  };
}

// Hardware Audio Stream & Real-Time VU Volume Monitor
export class AudioLevelMonitor {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private animationId: number | null = null;
  private isMonitoring: boolean = false;
  private onLevel: (level: number) => void;

  constructor(onLevel: (level: number) => void) {
    this.onLevel = onLevel;
  }

  public async start(): Promise<MediaStream> {
    this.stop();
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not supported in this browser environment.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.mediaStream = stream;

    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (AudioCtxClass) {
        this.audioContext = new AudioCtxClass();
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }

        this.source = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.4;
        this.source.connect(this.analyser);

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.isMonitoring = true;

        const update = () => {
          if (!this.isMonitoring || !this.analyser) return;
          this.analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const avg = sum / bufferLength;
          // Scale non-linearly to 0-100% for voice speech responsiveness
          const level = Math.min(100, Math.round((avg / 64) * 100));
          this.onLevel(level);

          this.animationId = requestAnimationFrame(update);
        };

        update();
      }
    } catch {
      // AudioContext failure should not crash stream usage
    }

    return stream;
  }

  public stop() {
    this.isMonitoring = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // Ignore disconnect error
      }
      this.source = null;
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // Ignore close error
      }
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.onLevel(0);
  }

  public getActiveStream(): MediaStream | null {
    return this.mediaStream;
  }
}

// Continuous Streaming Speech Recognition & Real-Time Captioner
export class ContinuousSpeechCaptioner {
  private recognition: ISpeechRecognitionInstance | null = null;
  private audioMonitor: AudioLevelMonitor;
  private isListening: boolean = false;
  private isMicActive: boolean = false;
  private currentAudioLevel: number = 0;
  private targetText: string = '';
  private engineStatus: LiveSpeechState['engineStatus'] = 'idle';
  private exclusiveMicMode: boolean = false;

  // Persisted across session restarts so speech is never wiped out
  private persistedFinal: string = '';
  private currentSessionFinal: string = '';
  private currentSessionInterim: string = '';
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;
  private hasFatalError: boolean = false;
  private onStateChange: (state: LiveSpeechState) => void;

  constructor(onStateChange: (state: LiveSpeechState) => void) {
    this.onStateChange = onStateChange;
    this.audioMonitor = new AudioLevelMonitor((level) => {
      this.currentAudioLevel = level;
      this.emitState({
        audioLevel: level,
      });
    });
  }

  private initRecognition() {
    if (typeof window === 'undefined') return;
    const win = window as unknown as IWindowSpeech;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) return;

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Ignore abort error
      }
    }

    this.recognition = new SpeechRec();
    const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    this.recognition.continuous = !isSafari;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.hasFatalError = false;
      this.engineStatus = 'ready';
      this.emitState({
        isListening: true,
        engineStatus: 'ready',
        errorMessage: null,
        errorType: null,
      });
    };

    if ('onaudiostart' in this.recognition) {
      this.recognition.onaudiostart = () => {
        this.engineStatus = 'ready';
        this.emitState({ engineStatus: 'ready' });
      };
    }

    if ('onsoundstart' in this.recognition) {
      this.recognition.onsoundstart = () => {
        this.engineStatus = 'hearing-sound';
        this.emitState({ engineStatus: 'hearing-sound' });
      };
    }

    if ('onspeechstart' in this.recognition) {
      this.recognition.onspeechstart = () => {
        this.engineStatus = 'hearing-speech';
        this.emitState({ engineStatus: 'hearing-speech' });
      };
    }

    if ('onspeechend' in this.recognition) {
      this.recognition.onspeechend = () => {
        this.engineStatus = 'ready';
        this.emitState({ engineStatus: 'ready' });
      };
    }

    this.recognition.onresult = (event: ISpeechRecognitionEvent) => {
      try {
        let sFinal = '';
        let sInterim = '';

        for (let i = 0; i < event.results.length; i++) {
          const item = event.results[i];
          const text = item?.[0]?.transcript || '';
          if (item?.isFinal) {
            sFinal += text + ' ';
          } else {
            sInterim += text + ' ';
          }
        }

        this.currentSessionFinal = sFinal.trim();
        this.currentSessionInterim = sInterim.trim();

        const totalFinal = (this.persistedFinal + ' ' + this.currentSessionFinal).trim();
        const liveTranscript = (totalFinal + ' ' + this.currentSessionInterim).trim();

        const alignment = alignSpokenWordsWithTarget(
          this.targetText,
          totalFinal,
          this.currentSessionInterim
        );

        this.engineStatus = 'transcribed';

        this.emitState({
          isListening: true,
          engineStatus: 'transcribed',
          liveTranscript,
          interimTranscript: this.currentSessionInterim,
          finalTranscript: totalFinal,
          words: alignment.words,
          accuracyScore: alignment.accuracyScore,
          correctCount: alignment.correctCount,
          incorrectCount: alignment.incorrectCount,
          totalWordsCount: alignment.totalWordsCount,
          isAllMatched: alignment.isAllMatched,
          errorMessage: null,
          errorType: null,
        });
      } catch (err) {
        console.error('Error handling speech recognition result:', err);
      }
    };

    this.recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
      const err = event.error;

      // Benign silence in Chrome; ignore and continue listening
      if (err === 'no-speech') {
        return;
      }

      // Aborted when stopping or cycling
      if (err === 'aborted') {
        return;
      }

      this.hasFatalError = true;
      this.isListening = false;
      this.audioMonitor.stop();
      this.isMicActive = false;
      this.engineStatus = 'error';

      let msg = `Speech recognition error: ${err}`;
      let type: LiveSpeechState['errorType'] = 'unknown';

      if (err === 'not-allowed') {
        msg = 'Microphone permission blocked in browser settings. Please click the lock or camera icon in your address bar to allow microphone access.';
        type = 'permission';
      } else if (err === 'network') {
        msg = 'Speech recognition network error: Google Speech servers could not be reached. If you are using Brave, enable Google Services in brave://settings/privacy, or use Google Chrome / Microsoft Edge.';
        type = 'network';
      } else if (err === 'audio-capture') {
        msg = 'Microphone hardware capture failed. Try clicking "Exclusive Mic Mode" below to free the microphone.';
        type = 'no-mic';
      } else if (err === 'service-not-allowed') {
        msg = 'Speech recognition service is not allowed by this browser or network configuration.';
        type = 'browser-unsupported';
      }

      this.emitState({
        isListening: false,
        isMicActive: false,
        engineStatus: 'error',
        audioLevel: 0,
        errorMessage: msg,
        errorType: type,
      });
    };

    this.recognition.onend = () => {
      // Save any finalized words from this session into persisted accumulator
      if (this.currentSessionFinal.trim()) {
        this.persistedFinal = (this.persistedFinal + ' ' + this.currentSessionFinal).trim();
        this.currentSessionFinal = '';
      }
      this.currentSessionInterim = '';

      // If user is still listening and no fatal error occurred, restart seamlessly
      if (this.isListening && !this.hasFatalError) {
        this.scheduleRestart();
      } else {
        this.isListening = false;
        this.engineStatus = 'idle';
        this.emitState({
          isListening: false,
          engineStatus: 'idle',
        });
      }
    };
  }

  private scheduleRestart() {
    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    this.restartTimeout = setTimeout(() => {
      if (this.isListening && !this.hasFatalError) {
        try {
          this.initRecognition();
          this.recognition?.start();
        } catch {
          // Already active
        }
      }
    }, 150);
  }

  public setExclusiveMicMode(enabled: boolean) {
    this.exclusiveMicMode = enabled;
    if (enabled) {
      this.audioMonitor.stop();
      this.isMicActive = false;
      this.currentAudioLevel = 0;
      this.emitState({
        isMicActive: false,
        audioLevel: 0,
      });
      if (this.isListening) {
        this.scheduleRestart();
      }
    } else if (this.isListening) {
      this.audioMonitor.start().then(() => {
        this.isMicActive = true;
        this.emitState({ isMicActive: true });
      }).catch(() => {});
    }
  }

  public setTargetText(text: string) {
    if (this.targetText === text) return;
    this.targetText = text;
    this.persistedFinal = '';
    this.currentSessionFinal = '';
    this.currentSessionInterim = '';
    const alignment = alignSpokenWordsWithTarget(this.targetText, '', '');
    this.emitState({
      liveTranscript: '',
      interimTranscript: '',
      finalTranscript: '',
      words: alignment.words,
      accuracyScore: 0,
      correctCount: 0,
      incorrectCount: 0,
      totalWordsCount: alignment.totalWordsCount,
      isAllMatched: false,
      errorMessage: null,
      errorType: null,
    });
  }

  public async start(targetText: string): Promise<void> {
    this.targetText = targetText;
    this.hasFatalError = false;
    this.engineStatus = 'connecting';

    if (!isSpeechRecognitionSupported()) {
      this.emitState({
        isListening: false,
        isMicActive: false,
        engineStatus: 'error',
        audioLevel: 0,
        errorMessage: 'Speech recognition is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Safari.',
        errorType: 'browser-unsupported',
      });
      return;
    }

    // 1. Start hardware monitor if not in exclusive mode
    if (!this.exclusiveMicMode) {
      try {
        await this.audioMonitor.start();
        this.isMicActive = true;
      } catch (err: unknown) {
        const errorName = err instanceof Error ? err.name : String(err);
        if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
          this.emitState({
            isListening: false,
            isMicActive: false,
            engineStatus: 'error',
            audioLevel: 0,
            errorMessage: 'Microphone permission denied. Please allow microphone access in your browser address bar.',
            errorType: 'permission',
          });
          return;
        }
        // AudioContext failure should not block speech recognition
        this.isMicActive = false;
      }
    }

    // 2. Initialize fresh recognition engine
    this.initRecognition();
    this.isListening = true;

    try {
      this.recognition?.start();
    } catch {
      // If already started, ignore
    }

    const alignment = alignSpokenWordsWithTarget(
      this.targetText,
      this.persistedFinal,
      this.currentSessionInterim
    );

    this.emitState({
      isListening: true,
      isMicActive: this.isMicActive,
      engineStatus: 'connecting',
      words: alignment.words,
      accuracyScore: alignment.accuracyScore,
      correctCount: alignment.correctCount,
      incorrectCount: alignment.incorrectCount,
      totalWordsCount: alignment.totalWordsCount,
      isAllMatched: alignment.isAllMatched,
      errorMessage: null,
      errorType: null,
    });
  }

  public stop() {
    this.isListening = false;
    this.hasFatalError = false;

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop error
      }
    }

    this.audioMonitor.stop();
    this.isMicActive = false;
    this.currentAudioLevel = 0;

    // Persist any final segment
    if (this.currentSessionFinal.trim()) {
      this.persistedFinal = (this.persistedFinal + ' ' + this.currentSessionFinal).trim();
      this.currentSessionFinal = '';
    }
    this.currentSessionInterim = '';

    const totalFinal = this.persistedFinal.trim();
    const alignment = alignSpokenWordsWithTarget(this.targetText, totalFinal, '');

    this.emitState({
      isListening: false,
      isMicActive: false,
      audioLevel: 0,
      liveTranscript: totalFinal,
      interimTranscript: '',
      finalTranscript: totalFinal,
      words: alignment.words,
      accuracyScore: alignment.accuracyScore,
      correctCount: alignment.correctCount,
      incorrectCount: alignment.incorrectCount,
      totalWordsCount: alignment.totalWordsCount,
      isAllMatched: alignment.isAllMatched,
      errorMessage: null,
      errorType: null,
    });
  }

  public reset() {
    this.persistedFinal = '';
    this.currentSessionFinal = '';
    this.currentSessionInterim = '';
    const alignment = alignSpokenWordsWithTarget(this.targetText, '', '');
    this.emitState({
      liveTranscript: '',
      interimTranscript: '',
      finalTranscript: '',
      words: alignment.words,
      accuracyScore: 0,
      correctCount: 0,
      incorrectCount: 0,
      totalWordsCount: alignment.totalWordsCount,
      isAllMatched: false,
      errorMessage: null,
      errorType: null,
    });
  }

  private emitState(partial: Partial<LiveSpeechState>) {
    const totalFinal = (this.persistedFinal + ' ' + this.currentSessionFinal).trim();
    const liveTranscript = (totalFinal + ' ' + this.currentSessionInterim).trim();
    const alignment = alignSpokenWordsWithTarget(
      this.targetText,
      totalFinal,
      this.currentSessionInterim
    );

    this.onStateChange({
      isListening: this.isListening,
      isMicActive: this.isMicActive,
      audioLevel: this.currentAudioLevel,
      engineStatus: this.engineStatus,
      liveTranscript,
      interimTranscript: this.currentSessionInterim,
      finalTranscript: totalFinal,
      words: alignment.words,
      accuracyScore: alignment.accuracyScore,
      correctCount: alignment.correctCount,
      incorrectCount: alignment.incorrectCount,
      totalWordsCount: alignment.totalWordsCount,
      isAllMatched: alignment.isAllMatched,
      errorMessage: null,
      errorType: null,
      ...partial,
    });
  }
}

// Single-shot evaluation for backwards compatibility
export function evaluatePronunciation(
  targetText: string,
  spokenText: string
): SpeechEvaluationResult {
  const normTarget = normalizeForSpeech(targetText);
  const normSpoken = normalizeForSpeech(spokenText);

  const targetWords = normTarget.split(' ').filter(Boolean);
  const spokenWords = normSpoken.split(' ').filter(Boolean);

  if (targetWords.length === 0) {
    return {
      spokenText,
      targetText,
      accuracyScore: 0,
      matchedWords: [],
      missedWords: [],
      feedback: 'unclear',
    };
  }

  const matchedWords: string[] = [];
  const missedWords: string[] = [];

  targetWords.forEach((word) => {
    if (spokenWords.includes(word)) {
      matchedWords.push(word);
    } else {
      missedWords.push(word);
    }
  });

  const accuracyScore = Math.round((matchedWords.length / targetWords.length) * 100);

  let feedback: 'perfect' | 'great' | 'needs-practice' | 'unclear' = 'unclear';
  if (accuracyScore === 100) {
    feedback = 'perfect';
  } else if (accuracyScore >= 75) {
    feedback = 'great';
  } else if (accuracyScore >= 40) {
    feedback = 'needs-practice';
  }

  return {
    spokenText,
    targetText,
    accuracyScore,
    matchedWords,
    missedWords,
    feedback,
  };
}

export class SpeechRecorder {
  private recognition: ISpeechRecognitionInstance | null = null;
  private isListening: boolean = false;
  private onResult: (transcript: string) => void;
  private onError: (error: string) => void;
  private onEnd: () => void;

  constructor(
    onResult: (transcript: string) => void,
    onError: (error: string) => void,
    onEnd: () => void
  ) {
    this.onResult = onResult;
    this.onError = onError;
    this.onEnd = onEnd;
    if (typeof window !== 'undefined') {
      const win = window as unknown as IWindowSpeech;
      const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (SpeechRec) {
        this.recognition = new SpeechRec();
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event: ISpeechRecognitionEvent) => {
          const transcript = event.results[0][0].transcript;
          this.onResult(transcript);
        };

        this.recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
          this.isListening = false;
          this.onError(event.error || 'Speech recognition failed');
        };

        this.recognition.onend = () => {
          this.isListening = false;
          this.onEnd();
        };
      }
    }
  }

  public start() {
    if (!this.recognition) {
      this.onError('Speech recognition not supported in this browser.');
      return;
    }
    if (this.isListening) return;

    try {
      this.isListening = true;
      this.recognition.start();
    } catch {
      this.isListening = false;
    }
  }

  public stop() {
    if (!this.recognition || !this.isListening) return;
    try {
      this.recognition.stop();
    } catch {
      // Ignore stop error
    }
    this.isListening = false;
  }

  public getActive(): boolean {
    return this.isListening;
  }
}

