import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import TypingEngine from '../components/typing/TypingEngine';
import { useTypingStore } from '../store/useTypingStore';
import { clearUserStats, loadUserStats } from '../lib/stats';

// Confetti draws to a canvas jsdom does not implement, and the engine fires it the
// moment a passage completes — which is what most of these tests are for.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

const PASSAGE = 'The quick brown fox';

beforeEach(() => clearUserStats());

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  useTypingStore.getState().resetSession();
});

function renderEngine(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(TypingEngine)));
  return host;
}

const load = (text: string) =>
  act(() => {
    useTypingStore.getState().resetSession();
    useTypingStore.getState().loadCustomText(text, 'Test passage', 'custom');
  });

const type = (chars: string) =>
  act(() => {
    for (const char of chars) useTypingStore.getState().handleKeyInput(char);
  });

const backspace = () => act(() => void useTypingStore.getState().handleBackspace());

const totalWords = () => loadUserStats().totalWordsTyped;
const lastSession = () => loadUserStats().sessions[0];

/**
 * Words credited to a finished passage.
 *
 * Completion is deliberately length-only: `handleKeyInput` finishes the run when
 * `typedText.length >= targetText.length`, with no correctness requirement, and
 * test/typingStore.test.ts pins that. What is not deliberate is what the finished run is
 * then *worth* — `TypingEngine` credited the passage's full word count regardless of how
 * much of it was correct, and `recordCompletedSession` added it to `totalWordsTyped`.
 *
 * So a learner who mashed one key to the end of a long article saw "Passage Completed!
 * Great Job!" next to 0% accuracy, and their all-time Volume — a total that only ever
 * grows and is never recomputed — climbed by the whole article. Repeat that and
 * "Vocabulary Scholar — Type over 1,000 words total" unlocks for someone who has not
 * typed a single correct word. The accuracy on the same screen was the only thing
 * contradicting it.
 *
 * The count is now the words the learner actually reached correctly: the longest correct
 * prefix of what they typed. Unchanged for a clean run, near zero for a mash, and it
 * cannot go negative, so the badge means what it says.
 */
describe('a finished passage', () => {
  it('credits nothing when the whole thing was typed wrong', () => {
    renderEngine();
    load(PASSAGE);

    type('z'.repeat(PASSAGE.length));

    expect(useTypingStore.getState().isCompleted).toBe(true);
    expect(totalWords()).toBe(0);
    expect(lastSession().wordsCount).toBe(0);
  });

  /**
   * The control, and the reason the first test means something: a clean run must be worth
   * exactly what it was before. A fix that simply stopped crediting words would pass the
   * first test and break this one, and would have quietly broken the badge for everyone.
   */
  it('credits every word of a clean run', () => {
    renderEngine();
    load(PASSAGE);

    type(PASSAGE);

    expect(totalWords()).toBe(4);
    expect(lastSession().wordsCount).toBe(4);
  });

  /**
   * The case in between, and the one that decides where the credit stops: two words in,
   * then the rest wrong. Those two were genuinely typed, and a rule that awarded the whole
   * passage or nothing would be wrong in both directions.
   */
  it('credits only the words typed before the first mistake', () => {
    renderEngine();
    load(PASSAGE);

    type('The quick ');
    type('z'.repeat(PASSAGE.length - 'The quick '.length));

    expect(totalWords()).toBe(2);
    expect(lastSession().wordsCount).toBe(2);
  });

  /**
   * The other end of the same rule: a mistake on the very first character leaves an empty
   * correct prefix, and a partial word must not be rounded up to one. This is what turns
   * the count off entirely rather than leaving a word of credit.
   */
  it('credits nothing when the first character is wrong', () => {
    renderEngine();
    load(PASSAGE);

    type('Zhe quick brown fox');

    expect(totalWords()).toBe(0);
  });

  /**
   * A run the learner repairs. They mistyped, saw it, and fixed it before finishing, so
   * the text they ended with is right — and that is what is judged. Correctness is not
   * "every key ever pressed", and this run is worth its word.
   */
  it('credits a run whose mistake was corrected before it finished', () => {
    renderEngine();
    load('Tab');

    type('X');
    backspace();
    type('Tab');

    expect(totalWords()).toBe(1);
  });
});

/**
 * The figures on the card, read as a learner reads them.
 *
 * Matched against the sentence rather than scraped from spans, so a card that stopped
 * reporting a figure at all fails here rather than quietly reporting less — the same
 * reason test/boardReadout.test.ts pins its readout's own wording.
 */
function reported(host: HTMLElement): { wpm: number; accuracy: number } {
  const figures = host.textContent?.match(/You typed at (\d+) WPM with (\d+)% typing accuracy/);
  if (!figures) throw new Error(`the card reported no figures: ${host.textContent}`);
  return { wpm: Number(figures[1]), accuracy: Number(figures[2]) };
}

/**
 * One finished passage, one row in the history — however many boards the learner sees it on.
 *
 * The guard that stops a re-record was a `useRef` in `TypingEngine` while `isCompleted`
 * lives in the module-level store, and a ref re-arms on every mount. Navigating away after
 * finishing a passage recorded it again: session count, word volume, time spent and both
 * averages all inflated, once per page visited. The fix moved the claim into the store,
 * where it survives a remount and can be checked and set together.
 *
 * `test/typingStore.test.ts` pins that store half four times over, and every one of those
 * tests calls `state().markSessionRecorded()` itself. None of them renders the component.
 * So the whole of the regression can come back — as the same `useRef`, in the same place —
 * with that file still green, because what actually stops the second recording is a *call
 * site* in `TypingEngine`, and a call site is exactly what an edit takes apart.
 *
 * A second `renderEngine()` is the same shape as the navigation: the first board stays
 * mounted, a fresh one mounts on the same completed store, and nothing between them resets
 * anything. No router needed.
 */
describe('a finished passage, seen from a second board', () => {
  it('is recorded once, however many engines mount on it', () => {
    renderEngine();
    load(PASSAGE);
    type(PASSAGE);
    expect(loadUserStats().sessions).toHaveLength(1);

    // The precondition, and only that: the store still holds the finished run, so the
    // engine mounted next sees `isCompleted: true` and runs the record effect. Asserting
    // `hasRecordedSession` here would pin *how* the guard is done — which is the store's
    // half, already pinned four times over in test/typingStore.test.ts — and would make
    // this test fail for the wrong reason on any other correct implementation.
    expect(useTypingStore.getState().isCompleted).toBe(true);

    renderEngine();

    expect(loadUserStats().sessions).toHaveLength(1);
  });
});

/**
 * The completion card and the history row describe the same run.
 *
 * Both read one `wpm` and one `accuracy` — `TypingEngine` computes each once and passes
 * the same value to `recordCompletedSession` — and two comments in the repo stake a claim
 * on it: "the number a learner reads off the completion card is by construction the number
 * stored against the session", and `wpmFrom`'s "shared by the live readout and the session
 * record so the two can never disagree". "By construction" is a claim about a call site, and
 * a call site is exactly what an edit takes apart: a second `wpmFrom` call for the card, or
 * a record built from `elapsedSeconds` rather than `finishedRunSeconds`, and the two screens
 * disagree with nothing to notice.
 *
 * It did once. The card came off the 250ms display tick and the record off the run's own
 * stamps; the tick floors and stops on completion, so the card read a WPM the history never
 * held — always a higher one, so the number went *up* between the celebration and the
 * record of it. The only coverage of that fix was an end-to-end test, which needs a browser.
 */
describe('the completion card and the history row', () => {
  it('report the same figures', () => {
    // A real twenty-second run, so the clock decides the WPM and the figures are not two
    // coincident zeros: 18 keystrokes in 20s is 11 WPM, and 18 of 19 correct is 94%.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T09:00:00Z'));
      const host = renderEngine();
      load(PASSAGE);
      // The clock moves *between* keystrokes, not before the run: `startTime` is stamped
      // by the first one, so advancing time ahead of it and then typing the whole passage
      // measures a run of a single second and reports a WPM no human produced.
      type('T');
      vi.setSystemTime(new Date('2026-01-01T09:00:20Z'));

      type('he quick brown fo');
      type('q');

      const card = reported(host);
      const session = lastSession();

      // The literals are the control. Two surfaces that agreed on 0 WPM and 100% would
      // satisfy the comparison below while proving nothing, and 100% is precisely the
      // figure lib/stats.ts floors down for — so both ends are pinned, not just the tie.
      expect(card).toEqual({ wpm: 11, accuracy: 94 });
      expect({ wpm: session.wpm, accuracy: session.accuracy }).toEqual(card);
    } finally {
      vi.useRealTimers();
    }
  });
});
