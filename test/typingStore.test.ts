import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORIES } from '../data/stories';
import { normalizeTypableText, useTypingStore } from '../store/useTypingStore';

const state = () => useTypingStore.getState();

/**
 * The store's opening passage, captured at import.
 *
 * Nothing else in this file can see it: every case below calls `loadCustomText` first,
 * so the only surface that ever reads these three values is the landing page's typing
 * board — and `beforeEach` has already overwritten them by the time a test body runs.
 */
const OPENING = (({ title, sourceType, targetText }) => ({ title, sourceType, targetText }))(
  useTypingStore.getState(),
);
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

  /**
   * The landing page's passage is recorded exactly like a story's is.
   *
   * Whoever arrives at `/` gets a typing board already loaded, and finishing it writes a
   * session through the same `recordCompletedSession` every other finish goes through.
   * So the three values in the store's initial state are not decoration — they are the
   * title and the source badge a first-time learner's very first history row will carry,
   * and they get pushed to the backup with it.
   *
   * They described a story that does not exist. `title` was "Full-Stack Architecture:
   * Interview Q&A" beside a `sourceType: 'story'`, but the nearest real story is "Full-Stack
   * & Next.js: Technical Interview Q&A" and the passage itself — a Q&A about the "core
   * pillars" of full-stack architecture — appears in none of them. The badge said a
   * library item the learner had practised; the catalog has no such item, the passage is
   * not findable anywhere in the app afterwards, and the row is permanent because
   * nothing recomputes history.
   *
   * The fix is not to relabel it "custom" either: `/custom` passes its own title and
   * `sourceType` explicitly, and the claim on screen is a claim about where the words came
   * from, not about who owns them. Naming a real story and typing one of its paragraphs
   * makes every part of the row true, and makes the landing board behave like the real
   * thing — which is what the badge already claims.
   *
   * Asserted against `STORIES` rather than as a literal pair, so renaming a story or
   * re-editing its paragraph fails here instead of quietly resurrecting the fiction.
   */
  it('opens on a paragraph of the story it names', () => {
    const story = STORIES.find((s) => s.title === OPENING.title);

    expect(story, `no story is titled ${JSON.stringify(OPENING.title)}`).toBeDefined();
    expect(OPENING.sourceType).toBe('story');
    expect(story!.paragraphs).toContain(OPENING.targetText);
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
    ['byte-order mark', 'a\uFEFFb', 'a b'],
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

    // And the claim is refused, which is the half that actually stops a re-record.
    // The flag being true is not the protection on its own: the component used to
    // read the flag from the value its render captured, which is a different thing
    // from the value in the store.
    expect(state().markSessionRecorded()).toBe(false);
  });

  /**
   * The check and the write were in two places, so neither could see the other.
   *
   * TypingEngine read `hasRecordedSession` from the value its render captured, then
   * called `markSessionRecorded()` to set it. Between those two lines the render had
   * not changed, so anything running the same effect again from the same closure read
   * the stale `false` and recorded a second time.
   *
   * React 19 in development runs that effect twice — StrictMode's double-invoke — and
   * does both invocations before re-rendering, which is exactly the window. A learner
   * running `next dev` finished one passage and got two sessions: count, word volume,
   * time spent and both averages all inflated. Production React ships no StrictMode, so
   * this never reached a learner, but the guard is now correct in both.
   *
   * The claim lives in the store because that is the only place that can be atomic
   * here. A `useRef` would fix the double-invoke and reintroduce the remount bug the
   * regression above documents, because a ref re-arms on every mount; the store does
   * not, so it cannot.
   */
  it('lets exactly one caller claim a run, even with no re-render between calls', () => {
    type('abc');

    // No re-render in between — which is what makes this the case that used to fail.
    expect(state().markSessionRecorded()).toBe(true);
    expect(state().markSessionRecorded()).toBe(false);
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

  /**
   * A finished run, whose numbers cannot still be moving.
   *
   * Not a bug report: `handleKeyInput` opens with `if (state.isCompleted) return`, so
   * this already holds. It is pinned because the guard is the whole of what "finished"
   * means for the counters, and it is easy to lose. Moving that check below the
   * accounting — where the empty-target check sits, two lines down, and looks like the
   * more natural place for a precondition — would let the board keep accepting keys after
   * the card had reported a result.
   *
   * The failure mode is specific. Past the end of the passage `targetText[typedText.length]`
   * is `undefined`, so every further key is `undefined !== char` and lands in
   * `incorrectKeystrokes`; `endTime` is re-stamped to `now`, so the duration grows while
   * the correct count stands still. `handleBackspace` has refused to touch a finished run
   * all along, so keys could be added but never taken back.
   *
   * Moved into `completion > freezes input after completion`, which already pinned
   * `typedText` and `totalKeystrokes`; only `endTime` is new here.
   */
  it('counts nothing further once the passage is finished', () => {
    type('abc');
    const finished = state();

    type('xyz');

    const after = state();
    expect(after.isCompleted).toBe(true);
    expect(after.correctKeystrokes).toBe(finished.correctKeystrokes);
    expect(after.incorrectKeystrokes).toBe(finished.incorrectKeystrokes);
  });

  /**
   * The control, and the reason the test above is not vacuous: the counters really do
   * move on a run in progress. `'ax'` on a passage of `'abc'` is one key right and one
   * wrong — which is also why a passing version of this that typed `'ab'` would have
   * asserted the wrong thing about a matching prefix.
   */
  it('still counts every keystroke of a run in progress', () => {
    type('ax');
    expect(state().totalKeystrokes).toBe(2);
    expect(state().correctKeystrokes).toBe(1);
    expect(state().incorrectKeystrokes).toBe(1);
    expect(state().isCompleted).toBe(false);
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
    const finished = state();
    type('xyz');

    expect(state().typedText).toBe('abc');
    expect(state().totalKeystrokes).toBe(3);
    // The clock the completion card's WPM divides by, so a later stamp here is a
    // longer run than the one already recorded. The guard above `handleKeyInput`'s
    // accounting is what stops it — moving it below the `set` breaks this.
    expect(state().endTime).toBe(finished.endTime);
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

  /**
   * The other half of what the reload above checks, and the half that was untested.
   *
   * `switchSound` is what the `<select>` shows; `soundEngine` is what is actually heard.
   * They are separate pieces of state, and the module reaches both on purpose —
   * `soundEngine.setSoundType(startingSound)` at evaluation time, above the store. So a
   * persisted 'mute' can satisfy the dropdown and never reach the audio: the learner sees
   * Mute selected and hears every keystroke of a run in a library. Removing that one line
   * breaks the promise the dropdown makes and leaves every other assertion here green,
   * because the store's own field would still read 'mute'.
   *
   * The engine has to be re-imported after `vi.resetModules()` rather than reached
   * through a top-level import. It is a singleton, so the instance this file holds is the
   * one `setSound` just wrote to — asserting that one would pass with the wiring deleted,
   * and prove nothing.
   */
  it('reaches the audio engine on reload, not only the dropdown', async () => {
    state().setSound('mute');
    vi.resetModules();

    const reloaded = (await import('../store/useTypingStore')).useTypingStore;
    const engine = (await import('../lib/audio')).soundEngine;

    expect(reloaded.getState().switchSound).toBe('mute');
    expect(engine.getSoundType()).toBe('mute');
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

/**
 * A keystroke on a machine that cannot make a noise.
 *
 * `handleKeyInput` calls `soundEngine.playKeyClick` partway through, before the pressed
 * character is compared and recorded, and nothing guarded it. A browser with no usable audio
 * device throws `NotSupportedError` from the `AudioContext` constructor, so the exception
 * unwound out of the keystroke and the character was never counted — then threw again on the
 * next one, and the next, so the board looked live for the rest of the session and recorded
 * nothing at all.
 *
 * Pinned on the keystroke rather than on `playKeyClick` not throwing, because the outcome is
 * the thing worth keeping: a guard anywhere between the two satisfies this, and a fix that
 * only silenced the engine's own exception path would not.
 */
describe('a browser with no audio device', () => {
  /**
   * Sound on, which is the state these two tests are about and not the state this file ends
   * in. `describe('preferences')` above sets the switch to 'mute' on the shared
   * `soundEngine` singleton and never puts it back, and `playKeyClick` returns at its first
   * line when the sound is muted — so without this the audio path is never reached at all.
   *
   * That is not a hypothetical: it is why the first version of the test below passed against
   * the unguarded constructor, having verified nothing. A test that cannot reach the code it
   * names is worse than no test, because it is counted.
   */
  beforeEach(() => state().setSound('blue'));

  afterEach(() => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it('records the keystroke anyway', () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        throw new DOMException('No audio device available', 'NotSupportedError');
      }
    };

    type('abc');

    expect(state().typedText).toBe('abc');
    expect(state().totalKeystrokes).toBe(3);
  });

  /**
   * The control, and the reason the one above is not vacuous: a store that dropped keystrokes
   * for any reason at all would satisfy it. Same three keys, no audio failure installed, and
   * they land — so what the test above isolates is the audio, not the typing.
   */
  it('records the same keystrokes with audio available', () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = class {};

    type('abc');

    expect(state().typedText).toBe('abc');
  });
});
