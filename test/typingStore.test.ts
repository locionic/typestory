import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTypableText, useTypingStore } from '../store/useTypingStore';

const state = () => useTypingStore.getState();
const type = (text: string) => {
  for (const ch of text) state().handleKeyInput(ch);
};

// 'abc' keeps the assertions short; every case below builds on a known passage.
beforeEach(() => {
  state().loadCustomText('abc');
});

describe('loadCustomText', () => {
  it('flattens newlines into single spaces and trims the edges', () => {
    state().loadCustomText('  line one\nline two\r\nline three  ');
    expect(state().targetText).toBe('line one line two line three');
  });

  it('switches the source type and clears the previous session', () => {
    type('ab');
    state().loadCustomText('fresh passage', 'My Notes');

    expect(state().title).toBe('My Notes');
    expect(state().sourceType).toBe('custom');
    expect(state().typedText).toBe('');
    expect(state().totalKeystrokes).toBe(0);
    expect(state().isCompleted).toBe(false);
    expect(state().startTime).toBeNull();
  });
});

describe('source provenance', () => {
  // Regression: StoryReader and /vocab both load through loadCustomText because they
  // advance one paragraph/word at a time. Without the third argument every session was
  // recorded as 'custom' and StatsModal badged stories and drills identically.
  it('defaults to custom so pasted text keeps its own label', () => {
    state().loadCustomText('some pasted article');
    expect(state().sourceType).toBe('custom');
  });

  it('records a story paragraph as story', () => {
    state().loadCustomText('It was the best of times...', 'A Tale of Two Cities (Part 1/3)', 'story');
    expect(state().sourceType).toBe('story');
  });

  it('records a vocabulary word as vocab', () => {
    state().loadCustomText('ephemeral', 'Oxford 3000 (1/40)', 'vocab');
    expect(state().sourceType).toBe('vocab');
  });

  it('resets provenance when switching back to custom text', () => {
    state().loadCustomText('a story paragraph', 'Story (Part 1/3)', 'story');
    state().loadCustomText('pasted text');
    expect(state().sourceType).toBe('custom');
  });
});

describe('normalizeTypableText', () => {
  // Regression: the store advances the caret on every keystroke whether or not it
  // matched, so one character with no key of its own parked the caret on a target
  // the learner could never hit. That error could never turn green and it deflated
  // the WPM and accuracy the session was recorded with.
  it.each([
    ['curly apostrophes', "don’t it’s", "don't it's"],
    ['curly double quotes', '“hello”', '"hello"'],
    ['single opening quote', '‘quoted’', "'quoted'"],
    ['em and en dashes', 'a—b–c', 'a-b-c'],
    ['ellipsis', 'wait…', 'wait...'],
    ['non-breaking space', 'a b', 'a b'],
    ['narrow no-break space', 'a b', 'a b'],
    ['tabs', 'a\tb', 'a b'],
    ['runs left behind by wrapping', 'a\n\nb', 'a b'],
  ])('rewrites %s to plain ASCII', (_label, input, expected) => {
    expect(normalizeTypableText(input)).toBe(expected);
  });

  it('normalizes on load, so the board never shows an unmatchable target', () => {
    state().loadCustomText('It’s a test — really.');
    expect(state().targetText).toBe("It's a test - really.");

    // Every target character must be reachable: type the whole thing and finish.
    type(state().targetText);
    expect(state().isCompleted).toBe(true);
    expect(state().correctKeystrokes).toBe(state().targetText.length);
  });

  it('leaves accented characters alone rather than silently rewriting the text', () => {
    expect(normalizeTypableText('café naïve')).toBe('café naïve');
  });

  /**
   * Regression: the table above enumerated three examples of a larger class. These
   * reach a paste routinely — CMS output, Google Docs and PDF extractors all emit
   * them — and `trim()` removes one only at the *ends* of a string, so `/custom`'s
   * `disabled={!inputText.trim()}` guard passes them straight through. Each one has
   * no key on a US keyboard and, being invisible, gives the learner no way to tell
   * why the caret is stuck: the keystroke can never turn green, so it deflates WPM
   * and the recorded accuracy for the whole passage.
   */
  it.each([
    ['zero-width space', 'ab', 'ab'],
    ['zero-width non-joiner', 'a‌b', 'ab'],
    ['zero-width joiner', 'a‍b', 'ab'],
    ['left-to-right mark', 'a‎b', 'ab'],
    ['right-to-left override', 'a‮b', 'ab'],
    ['byte-order mark', 'a﻿b', 'ab'],
    ['soft hyphen', 'a­b', 'ab'],
    ['word joiner', 'a⁠b', 'ab'],
  ])('strips the invisible %s rather than parking the caret on it', (_l, input, expected) => {
    expect(normalizeTypableText(input)).toBe(expected);
  });

  /**
   * U+2060 joins two words, so replacing it with a space would insert a break the
   * author never wrote — a silent rewrite rather than a cleanup.
   */
  it('deletes the word joiner instead of spacing it', () => {
    expect(normalizeTypableText('one⁠two')).toBe('onetwo');
  });

  it.each([
    ['ideographic space', 'a　b', 'a b'],
    ['hair space', 'a b', 'a b'],
    ['ogham space', 'a b', 'a b'],
    ['line separator', 'a b', 'a b'],
    ['paragraph separator', 'a b', 'a b'],
  ])('spaces the %s, because it does separate two words', (_l, input, expected) => {
    expect(normalizeTypableText(input)).toBe(expected);
  });

  it('still collapses the space an invisible character was sitting between', () => {
    // Deleting the zero-width space before the run-collapse is the whole ordering:
    // collapse first would leave "a  b" with a double space.
    expect(normalizeTypableText('a  b')).toBe('a b');
  });
});

describe('empty target', () => {
  // A paragraph of only invisible characters normalizes away to nothing, and
  // `typedText.length >= targetText.length` is true on the very first keystroke.
  it('records nothing when there is no text to type', () => {
    state().loadCustomText('‌');
    expect(state().targetText).toBe('');

    type('a');
    expect(state().isCompleted).toBe(false);
    expect(state().totalKeystrokes).toBe(0);
  });
});

describe('session recording guard', () => {
  // Regression: this guard was a useRef in TypingEngine while isCompleted lives in
  // the module-level store. A ref re-arms on every remount, so navigating away
  // after completing a passage re-recorded it — inflating session count, word
  // volume, time spent and both averages, once per page visited.
  it('survives a remount, because it lives in the store and not in a component', () => {
    type('abc');
    state().markSessionRecorded();

    // A fresh TypingEngine mounts on the next page and reads the same store.
    expect(state().isCompleted).toBe(true);
    expect(state().hasRecordedSession).toBe(true);
  });

  it('is cleared by loading a new passage', () => {
    type('abc');
    state().markSessionRecorded();

    state().loadCustomText('the next paragraph');
    expect(state().hasRecordedSession).toBe(false);
  });

  it('is cleared by a restart, so a genuine second attempt records again', () => {
    type('abc');
    state().markSessionRecorded();
    state().resetSession();

    expect(state().hasRecordedSession).toBe(false);

    type('abc');
    expect(state().isCompleted).toBe(true);
  });
});

describe('keystroke accounting', () => {
  it('separates correct from incorrect keys', () => {
    type('axc');
    expect(state().typedText).toBe('axc');
    expect(state().correctKeystrokes).toBe(2);
    expect(state().incorrectKeystrokes).toBe(1);
    expect(state().totalKeystrokes).toBe(3);
  });

  it('starts the timer on the first keystroke only', () => {
    expect(state().startTime).toBeNull();
    type('a');
    const first = state().startTime;
    expect(first).not.toBeNull();

    type('b');
    expect(state().startTime).toBe(first);
  });

  it('keeps keystroke totals when backspacing, so accuracy stays honest', () => {
    type('ax');
    state().handleBackspace();

    expect(state().typedText).toBe('a');
    expect(state().totalKeystrokes).toBe(2);
    expect(state().incorrectKeystrokes).toBe(1);
  });
});

describe('backspace', () => {
  it('is a no-op at the start of the passage', () => {
    state().handleBackspace();
    expect(state().typedText).toBe('');
    expect(state().totalKeystrokes).toBe(0);
  });

  it('is a no-op once the passage is complete', () => {
    type('abc');
    state().handleBackspace();
    expect(state().typedText).toBe('abc');
  });
});

describe('completion', () => {
  it('flags completion and stamps an end time', () => {
    type('abc');

    expect(state().isCompleted).toBe(true);
    expect(state().endTime).not.toBeNull();
  });

  it('leaves the end time unset while still typing', () => {
    type('ab');
    expect(state().isCompleted).toBe(false);
    expect(state().endTime).toBeNull();
  });

  it('freezes input after completion', () => {
    type('abc');
    type('xyz');

    expect(state().typedText).toBe('abc');
    expect(state().totalKeystrokes).toBe(3);
  });
});

describe('resetSession', () => {
  it('clears progress but keeps the passage loaded', () => {
    type('ax');
    state().resetSession();

    expect(state().targetText).toBe('abc');
    expect(state().typedText).toBe('');
    expect(state().correctKeystrokes).toBe(0);
    expect(state().incorrectKeystrokes).toBe(0);
    expect(state().totalKeystrokes).toBe(0);
    expect(state().startTime).toBeNull();
    expect(state().isCompleted).toBe(false);
  });

  it('allows the passage to be typed again', () => {
    type('abc');
    state().resetSession();
    type('abc');

    expect(state().isCompleted).toBe(true);
    // resetSession zeroes the counters, so the retry is scored on its own.
    expect(state().totalKeystrokes).toBe(3);
    expect(state().correctKeystrokes).toBe(3);
  });
});

describe('preferences', () => {
  beforeEach(() => localStorage.clear());

  it('mirrors the selected switch sound into state', () => {
    state().setSound('brown');
    expect(state().switchSound).toBe('brown');
  });

  /**
   * Regression: the switch sound was never written anywhere, so the store's initial
   * 'blue' came back on every page load and a learner had to re-pick their setting
   * each visit. 'Mute' is the one that costs something to lose — someone practising
   * in a library or on a train got the clicky default back with no way to stop it.
   */
  it('survives a page reload', async () => {
    state().setSound('mute');
    vi.resetModules();

    const reloaded = (await import('../store/useTypingStore')).useTypingStore;
    expect(reloaded.getState().switchSound).toBe('mute');
  });

  it('persists to storage, not just to this page', () => {
    state().setSound('bubble');
    expect(localStorage.getItem('typestory_switch_sound_v1')).toBe('bubble');
  });

  /**
   * The saved value is read straight into the audio engine, so an entry the engine
   * does not accept has to be refused on the way in rather than handed over — a
   * hand-edited or stale value would otherwise put the dropdown and the sound out
   * of step with no way to tell which is lying.
   */
  it('falls back to the default for a value the engine does not accept', async () => {
    localStorage.setItem('typestory_switch_sound_v1', 'mechanical');
    vi.resetModules();

    const reloaded = (await import('../store/useTypingStore')).useTypingStore;
    expect(reloaded.getState().switchSound).toBe('blue');
  });
});
describe('the session clock', () => {
  // Regression: elapsedSeconds was component-local state that no reset touched, so
  // the first 250ms of a retried passage reported the previous attempt's clock, and
  // a passage finished inside that window was recorded with the previous duration.
  it('is cleared by a restart rather than carried into the next attempt', () => {
    type('a');
    state().tick();
    expect(state().elapsedSeconds).toBeGreaterThanOrEqual(1);

    state().resetSession();
    expect(state().elapsedSeconds).toBe(0);
    expect(state().startTime).toBeNull();
  });

  it('is cleared when a new passage is loaded', () => {
    type('a');
    state().tick();
    state().loadCustomText('the next paragraph');

    expect(state().elapsedSeconds).toBe(0);
  });

  it('ignores ticks with no session running', () => {
    state().tick();
    expect(state().elapsedSeconds).toBe(0);
  });

  it('measures the finished run from its own first keystroke', () => {
    type('abc');
    // Both stamps come from the same keystroke pair, so the recorded duration is
    // this run's regardless of when the 250ms display tick happened to land.
    expect(state().endTime).not.toBeNull();
    expect(state().startTime).not.toBeNull();
    expect(state().endTime! - state().startTime!).toBeLessThanOrEqual(1000);
  });
});
