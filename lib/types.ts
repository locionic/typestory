export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface VocabItem {
  word: string;
  phonetic?: string;
  pos?: string; // part of speech
  definition: string;
  translation?: string; // e.g. Vietnamese or second language
  example?: string;
}

export interface StoryItem {
  id: string;
  slug: string;
  title: string;
  author: string;
  category: 'classic' | 'fable' | 'tech' | 'dialogue' | 'essay';
  level: CefrLevel;
  difficultyLabel: string;
  summary: string;
  wordCount: number;
  readingTimeMinutes: number;
  coverEmoji: string;
  paragraphs: string[];
  keyVocabulary: VocabItem[];
}

export interface SpeechEvaluationResult {
  spokenText: string;
  targetText: string;
  accuracyScore: number; // 0 to 100
  matchedWords: string[];
  missedWords: string[];
  feedback: 'perfect' | 'great' | 'needs-practice' | 'unclear';
}

export type SwitchSound = 'blue' | 'brown' | 'bubble' | 'mute';

export interface TypingSessionRecord {
  id: string;
  timestamp: number;
  dateStr: string; // YYYY-MM-DD
  title: string;
  sourceType: 'story' | 'vocab' | 'custom';
  wpm: number;
  accuracy: number;
  durationSeconds: number;
  wordsCount: number;
  keystrokes: number;
}

export interface UserStats {
  sessions: TypingSessionRecord[];
  dailyStreak: {
    currentStreak: number;
    bestStreak: number;
    lastActiveDate: string; // YYYY-MM-DD
  };
  totalWordsTyped: number;
  totalTimeSpentSeconds: number;
  bestWpm: number;
  averageWpm: number;
  averageAccuracy: number;
}
