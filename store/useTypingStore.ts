import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { SourceType, SwitchSound } from '../lib/types';
import { soundEngine } from '../lib/audio';

const SOUND_KEY = 'typestory_switch_sound_v1';
const SOUND_TYPES: readonly SwitchSound[] = ['blue', 'brown', 'bubble', 'mute'];

/**
 * The saved switch sound, validated on the way out.
 *
 * A preference that has to be re-picked on every page load is not a preference, and
 * 'mute' is the one that matters most: someone practising in a library or on a train
 * was getting the clicky default back on every visit with no way to stop it. Validated
 * against the same four values the engine accepts, so a hand-edited or stale entry
 * falls back rather than reaching the audio engine.
 */
const initialSound = (): SwitchSound => {
  if (typeof window === 'undefined') return 'blue';
  try {
    const saved = localStorage.getItem(SOUND_KEY) as SwitchSound | null;
    return saved && SOUND_TYPES.includes(saved) ? saved : 'blue';
  } catch {
    // Storage unavailable (private mode, blocked data): the default plays.
    return 'blue';
  }
};

// Read once at module load, because the engine holds its own copy: the store's
// `switchSound` drives the <select> and the engine drives what is actually heard, so
// a persisted value has to reach both or the dropdown lies about the current sound.
// setSoundType only assigns — it builds no AudioContext — so this is safe to run
// during module evaluation on the server too.
const startingSound = initialSound();
soundEngine.setSoundType(startingSound);

interface TypingState {
  // Active text session
  title: string;
  sourceType: SourceType;
  targetText: string;
  typedText: string;

  // Real-time statistics
  startTime: number | null;
  endTime: number | null;
  /**
   * Whole seconds since startTime, updated by `tick()`.
   *
   * Lives here rather than in the component because it is session state that
   * every reset must clear; as component-local state it survived a restart and
   * the next session began by reporting the previous run's clock and duration.
   */
  elapsedSeconds: number;
  totalKeystrokes: number;
  correctKeystrokes: number;
  incorrectKeystrokes: number;
  isCompleted: boolean;

  /**
   * Whether the finished passage has already been written to the stats history.
   *
   * This lives in the store, not in a component ref, because `isCompleted` does:
   * a ref is per-mount while the store is per-app, so a ref re-arms itself every
   * time the engine remounts and the previous session gets recorded again.
   */
  hasRecordedSession: boolean;

  // Preferences
  switchSound: SwitchSound;

  // Actions
  handleKeyInput: (key: string) => void;
  handleBackspace: () => void;
  tick: () => void;
  setSound: (sound: SwitchSound) => void;
  loadCustomText: (text: string, title?: string, sourceType?: SourceType) => void;
  resetSession: () => void;
  markSessionRecorded: () => void;
}

export const useTypingStore = create<TypingState>((set, get) => ({
  title: 'Full-Stack Architecture: Interview Q&A',
  sourceType: 'story',
  targetText:
    'Q: What are the core pillars of modern full-stack web architecture? A: Modern full-stack architecture combines reactive React frontends, type-safe backends, automated CI/CD pipelines, and scalable cloud infrastructure.',
  typedText: '',

  startTime: null,
  endTime: null,
  elapsedSeconds: 0,
  totalKeystrokes: 0,
  correctKeystrokes: 0,
  incorrectKeystrokes: 0,
  isCompleted: false,
  hasRecordedSession: false,

  switchSound: startingSound,

  handleKeyInput: (key: string) => {
    const state = get();
    if (state.isCompleted) return;

    // There is nothing to type. This became reachable once normalizeTypableText
    // started deleting invisible characters: a paragraph made only of them
    // normalizes to an empty string, and without this guard the first keystroke
    // would satisfy `typedText.length >= targetText.length` and record a session
    // with 0 correct keystrokes and 0% accuracy.
    if (state.targetText.length === 0) return;

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

  tick: () => {
    const { startTime } = get();
    if (!startTime) return;
    set({ elapsedSeconds: Math.max(1, Math.floor((Date.now() - startTime) / 1000)) });
  },

  setSound: (sound: SwitchSound) => {
    soundEngine.setSoundType(sound);
    try {
      localStorage.setItem(SOUND_KEY, sound);
    } catch {
      // Storage blocked: the choice still applies for as long as the tab is open.
    }
    set({ switchSound: sound });
  },

  loadCustomText: (
    text: string,
    title: string = 'Custom Text',
    sourceType: SourceType = 'custom',
  ) => {
    set({
      title,
      sourceType,
      targetText: normalizeTypableText(text),
      typedText: '',
      startTime: null,
      endTime: null,
      elapsedSeconds: 0,
      totalKeystrokes: 0,
      correctKeystrokes: 0,
      incorrectKeystrokes: 0,
      isCompleted: false,
      hasRecordedSession: false,
    });
  },

  resetSession: () => {
    set({
      typedText: '',
      startTime: null,
      endTime: null,
      elapsedSeconds: 0,
      totalKeystrokes: 0,
      correctKeystrokes: 0,
      incorrectKeystrokes: 0,
      isCompleted: false,
      hasRecordedSession: false,
    });
  },

  markSessionRecorded: () => {
    set({ hasRecordedSession: true });
  },
}));

/**
 * Reduce arbitrary pasted text to what a US-layout keyboard can actually produce.
 *
 * The store advances the caret on every keystroke regardless of correctness, so a
 * single character with no key of its own — a curly apostrophe, an em dash, the
 * non-breaking space that web pages are full of — parks the caret on a target the
 * learner can never match. That error can never turn green and it deflates both
 * WPM and the accuracy the session is recorded with, forever.
 *
 * Accented characters are deliberately left alone: they are visible, so a learner
 * can see them, and silently rewriting them would change the text they asked to
 * type. Invisible characters are the opposite case, and are removed — see below.
 */
export function normalizeTypableText(text: string): string {
  return text
    .replace(/\r\n?|\n/g, ' ')
    // Zero-width and bidi formatting characters are deleted rather than replaced.
    // They carry no word content and a US keyboard has no key for any of them, so
    // leaving one in parks the caret on something the learner can neither see nor
    // type — and because the caret advances on every keystroke, the one that
    // overshoots it can never turn green, so it deflates WPM and the recorded
    // accuracy for the whole passage. They reach a paste routinely: CMS output,
    // Google Docs and PDF extractors all emit them, and `trim()` removes one only
    // at the *ends* of a string, so /custom's `disabled={!inputText.trim()}` lets
    // them straight through. U+202E is the worst of the set — it reorders the
    // visible text, so the board and the target disagree.
    //
    // Runs before the collapse below so the space it uncovers gets folded, and
    // before the space class so a run of U+2028 still collapses.
    //   U+00AD soft hyphen, U+200B-200F, U+202A-202E bidi, U+2060 word joiner,
    //   U+2066-2069 isolates, U+FEFF BOM
    //
    // U+2060 belongs here rather than with the spaces: it *joins* two words, so
    // spacing it would insert a break the author never wrote.
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    // Exotic spaces and separators become a plain space rather than vanishing:
    // they do separate two words, so deleting them would fuse "a\u3000b" into "ab".
    //   U+00A0 NBSP, U+1680 ogham, U+2000-200A spaces, U+2028/U+2029 separators,
    //   U+202F narrow NBSP, U+3000 ideographic
    .replace(/[\u00A0\u1680\u2000-\u200A\u2028-\u2029\u202F\u3000]/g, ' ')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[ \t\f\v]+/g, ' ') // tabs, and the runs left behind by the above
    .trim();
}

/**
 * The switch sound, read in a way that survives hydration.
 *
 * Not a plain store selector, because the persisted value is unknowable on the server:
 * the server renders "Blue Switch" with `selected` on the blue option, and React's
 * production hydration leaves a `<select>`'s value exactly as the server wrote it. The
 * dropdown then showed Blue while the engine was actually muted, and only corrected
 * itself on the next re-render of the navbar — a control that lies about its own state.
 *
 * This is the same third-argument trick `useUserStats` and `useBackupCode` already use
 * for client-only values: render the server snapshot for hydration, then let React
 * re-render with the real one the moment the client has it.
 */
export function useSwitchSound(): SwitchSound {
  return useSyncExternalStore(
    useTypingStore.subscribe,
    () => useTypingStore.getState().switchSound,
    () => 'blue',
  );
}
