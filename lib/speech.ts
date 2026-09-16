import { SpeechEvaluationResult } from './types';

// Web Speech API interface definitions
interface SpeechRecognitionResultItem {
  readonly transcript: string;
}

interface ISpeechRecognitionEvent {
  results: {
    [index: number]: {
      [index: number]: SpeechRecognitionResultItem;
    };
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

// Evaluate pronunciation accuracy between target and spoken transcript
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
