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
  start: () => void;
  stop: () => void;
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

// Clean text for speech matching (lowercase, no punctuation)
export function normalizeForSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, '')
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
    '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
    '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
  };
  if (numMap[t] === s || numMap[s] === t) return true;

  // Common homophones / contractions
  const homophones: Record<string, string[]> = {
    there: ['their', 'theyre'],
    their: ['there', 'theyre'],
    to: ['too', 'two'],
    too: ['to', 'two'],
    two: ['to', 'too'],
    hear: ['here'],
    here: ['hear'],
    hare: ['hair'],
    hair: ['hare'],
    its: ['it', "it's"],
    dont: ['do not'],
    wont: ['will not'],
    cant: ['cannot'],
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
        // User uttered a filler word, match next
        resultWords.push({
          word: rawWord,
          normalized: normTarget,
          status: 'correct',
          matchedSpokenWord: nextSpoken,
        });
        correctCount++;
        spokenPtr += 2;
      } else {
        // Check if user skipped ahead to the next target word
        const nextTarget = rawTargetWords[i + 1] ? normalizeForSpeech(rawTargetWords[i + 1]) : null;
        if (nextTarget && isWordMatch(nextTarget, currentSpoken)) {
          // Current target word was skipped or mispronounced
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

// Continuous Streaming Speech Recognition & Real-Time Captioner
export class ContinuousSpeechCaptioner {
  private recognition: ISpeechRecognitionInstance | null = null;
  private isListening: boolean = false;
  private targetText: string = '';
  private finalTranscript: string = '';
  private interimTranscript: string = '';
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private onStateChange: (state: LiveSpeechState) => void) {
    this.initRecognition();
  }

  private initRecognition() {
    if (typeof window === 'undefined') return;
    const win = window as unknown as IWindowSpeech;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) return;

    this.recognition = new SpeechRec();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event: ISpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = 0; i < event.results.length; i++) {
        const item = event.results[i];
        if (item.isFinal) {
          final += item[0].transcript + ' ';
        } else {
          interim += item[0].transcript + ' ';
        }
      }

      this.finalTranscript = final.trim();
      this.interimTranscript = interim.trim();

      const liveTranscript = (this.finalTranscript + ' ' + this.interimTranscript).trim();
      const alignment = alignSpokenWordsWithTarget(
        this.targetText,
        this.finalTranscript,
        this.interimTranscript
      );

      this.onStateChange({
        isListening: this.isListening,
        liveTranscript,
        interimTranscript: this.interimTranscript,
        finalTranscript: this.finalTranscript,
        words: alignment.words,
        accuracyScore: alignment.accuracyScore,
        correctCount: alignment.correctCount,
        incorrectCount: alignment.incorrectCount,
        totalWordsCount: alignment.totalWordsCount,
        isAllMatched: alignment.isAllMatched,
        errorMessage: null,
      });
    };

    this.recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech') {
        // Benign silence event in Chrome, keep listening
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'audio-capture') {
        this.isListening = false;
        this.emitState({
          isListening: false,
          errorMessage: 'Microphone permission denied. Please allow microphone access in your browser.',
        });
        return;
      }
      if (this.isListening) {
        this.scheduleRestart();
      }
    };

    this.recognition.onend = () => {
      // Seamlessly restart if still in listening mode
      if (this.isListening) {
        this.scheduleRestart();
      }
    };
  }

  private scheduleRestart() {
    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    this.restartTimeout = setTimeout(() => {
      if (this.isListening && this.recognition) {
        try {
          this.recognition.start();
        } catch {
          // Already running
        }
      }
    }, 150);
  }

  public setTargetText(text: string) {
    this.targetText = text;
    this.finalTranscript = '';
    this.interimTranscript = '';
    const alignment = alignSpokenWordsWithTarget(this.targetText, '', '');
    this.onStateChange({
      isListening: this.isListening,
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
    });
  }

  public start(targetText: string) {
    this.targetText = targetText;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.isListening = true;

    if (!this.recognition) {
      this.initRecognition();
      if (!this.recognition) {
        this.emitState({
          isListening: false,
          errorMessage: 'Speech recognition is not supported in this browser. Please use Google Chrome or Edge.',
        });
        return;
      }
    }

    try {
      this.recognition.start();
    } catch {
      // Already running
    }

    const alignment = alignSpokenWordsWithTarget(this.targetText, '', '');
    this.onStateChange({
      isListening: true,
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
    });
  }

  public stop() {
    this.isListening = false;
    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
    }
    const liveTranscript = (this.finalTranscript + ' ' + this.interimTranscript).trim();
    const alignment = alignSpokenWordsWithTarget(
      this.targetText,
      this.finalTranscript,
      this.interimTranscript
    );
    this.onStateChange({
      isListening: false,
      liveTranscript,
      interimTranscript: this.interimTranscript,
      finalTranscript: this.finalTranscript,
      words: alignment.words,
      accuracyScore: alignment.accuracyScore,
      correctCount: alignment.correctCount,
      incorrectCount: alignment.incorrectCount,
      totalWordsCount: alignment.totalWordsCount,
      isAllMatched: alignment.isAllMatched,
      errorMessage: null,
    });
  }

  public reset() {
    this.finalTranscript = '';
    this.interimTranscript = '';
    const alignment = alignSpokenWordsWithTarget(this.targetText, '', '');
    this.onStateChange({
      isListening: this.isListening,
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
    });
  }

  private emitState(partial: Partial<LiveSpeechState>) {
    const alignment = alignSpokenWordsWithTarget(
      this.targetText,
      this.finalTranscript,
      this.interimTranscript
    );
    this.onStateChange({
      isListening: this.isListening,
      liveTranscript: (this.finalTranscript + ' ' + this.interimTranscript).trim(),
      interimTranscript: this.interimTranscript,
      finalTranscript: this.finalTranscript,
      words: alignment.words,
      accuracyScore: alignment.accuracyScore,
      correctCount: alignment.correctCount,
      incorrectCount: alignment.incorrectCount,
      totalWordsCount: alignment.totalWordsCount,
      isAllMatched: alignment.isAllMatched,
      errorMessage: null,
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

  constructor(
    private onResult: (transcript: string) => void,
    private onError: (error: string) => void,
    private onEnd: () => void
  ) {
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
