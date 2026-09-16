import { create } from 'zustand';
import { SwitchSound, SpeechEvaluationResult, StoryItem, VocabItem } from '../lib/types';
import { soundEngine } from '../lib/audio';

interface TypingState {
  // Active text session
  title: string;
  sourceType: 'story' | 'vocab' | 'custom';
  targetText: string;
  typedText: string;
  activeStory: StoryItem | null;
  activeVocabList: VocabItem[] | null;
  currentVocabIndex: number;

  // Real-time statistics
  startTime: number | null;
  endTime: number | null;
  totalKeystrokes: number;
  correctKeystrokes: number;
  incorrectKeystrokes: number;
  isCompleted: boolean;

  // Preferences
  switchSound: SwitchSound;
  autoVoicePlayback: boolean;

  // Speech Recognition ("Micro Function")
  latestSpeechResult: SpeechEvaluationResult | null;

  // Actions
  handleKeyInput: (key: string) => void;
  handleBackspace: () => void;
  setSound: (sound: SwitchSound) => void;
  toggleAutoVoice: () => void;
  setSpeechResult: (result: SpeechEvaluationResult | null) => void;
  loadStory: (story: StoryItem) => void;
  loadVocabList: (list: VocabItem[], title?: string) => void;
  loadCustomText: (text: string, title?: string) => void;
  resetSession: () => void;
}

export const useTypingStore = create<TypingState>((set, get) => ({
  title: 'The Tortoise and the Hare',
  sourceType: 'story',
  targetText:
    'A Hare was once making fun of the Tortoise for his slow and steady pace. "Do you ever get anywhere?" he asked with a mocking laugh. "Yes," replied the Tortoise, "and I get there sooner than you think."',
  typedText: '',
  activeStory: null,
  activeVocabList: null,
  currentVocabIndex: 0,

  startTime: null,
  endTime: null,
  totalKeystrokes: 0,
  correctKeystrokes: 0,
  incorrectKeystrokes: 0,
  isCompleted: false,

  switchSound: 'blue',
  autoVoicePlayback: true,
  latestSpeechResult: null,

  handleKeyInput: (key: string) => {
    const state = get();
    if (state.isCompleted) return;

    // Start timer on first keystroke
    const now = Date.now();
    const startTime = state.startTime || now;

    // Play tactile mechanical switch sound
    soundEngine.playKeyClick();

    const expectedChar = state.targetText[state.typedText.length];
    const isCorrect = key === expectedChar;

    const newTypedText = state.typedText + key;
    const newTotal = state.totalKeystrokes + 1;
    const newCorrect = state.correctKeystrokes + (isCorrect ? 1 : 0);
    const newIncorrect = state.incorrectKeystrokes + (isCorrect ? 0 : 1);

    // Check if target text reached completion
    const isFinished = newTypedText.length >= state.targetText.length;

    if (isFinished) {
      soundEngine.playSuccessChime();
    }

    set({
      typedText: newTypedText,
      startTime,
      endTime: isFinished ? now : null,
      totalKeystrokes: newTotal,
      correctKeystrokes: newCorrect,
      incorrectKeystrokes: newIncorrect,
      isCompleted: isFinished,
    });
  },

  handleBackspace: () => {
    const state = get();
    if (state.isCompleted || state.typedText.length === 0) return;

    soundEngine.playKeyClick();
    set({
      typedText: state.typedText.slice(0, -1),
    });
  },

  setSound: (sound: SwitchSound) => {
    soundEngine.setSoundType(sound);
    set({ switchSound: sound });
  },

  toggleAutoVoice: () => {
    set((s) => ({ autoVoicePlayback: !s.autoVoicePlayback }));
  },

  setSpeechResult: (result: SpeechEvaluationResult | null) => {
    set({ latestSpeechResult: result });
  },

  loadStory: (story: StoryItem) => {
    const fullText = story.paragraphs.join(' ');
    set({
      title: story.title,
      sourceType: 'story',
      targetText: fullText,
      typedText: '',
      activeStory: story,
      activeVocabList: null,
      currentVocabIndex: 0,
      startTime: null,
      endTime: null,
      totalKeystrokes: 0,
      correctKeystrokes: 0,
      incorrectKeystrokes: 0,
      isCompleted: false,
      latestSpeechResult: null,
    });
  },

  loadVocabList: (list: VocabItem[], title: string = 'Vocabulary Drill') => {
    if (list.length === 0) return;
    const firstWord = list[0].word;
    set({
      title,
      sourceType: 'vocab',
      targetText: firstWord,
      typedText: '',
      activeStory: null,
      activeVocabList: list,
      currentVocabIndex: 0,
      startTime: null,
      endTime: null,
      totalKeystrokes: 0,
      correctKeystrokes: 0,
      incorrectKeystrokes: 0,
      isCompleted: false,
      latestSpeechResult: null,
    });
  },

  loadCustomText: (text: string, title: string = 'Custom Text') => {
    const cleanText = text.replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
    set({
      title,
      sourceType: 'custom',
      targetText: cleanText,
      typedText: '',
      activeStory: null,
      activeVocabList: null,
      currentVocabIndex: 0,
      startTime: null,
      endTime: null,
      totalKeystrokes: 0,
      correctKeystrokes: 0,
      incorrectKeystrokes: 0,
      isCompleted: false,
      latestSpeechResult: null,
    });
  },

  resetSession: () => {
    set({
      typedText: '',
      startTime: null,
      endTime: null,
      totalKeystrokes: 0,
      correctKeystrokes: 0,
      incorrectKeystrokes: 0,
      isCompleted: false,
      latestSpeechResult: null,
    });
  },
}));
