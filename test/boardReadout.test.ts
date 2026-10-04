import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import TypingEngine from '../components/typing/TypingEngine';
import { clearUserStats, loadUserStats } from '../lib/stats';
import { MAX_WPM } from '../lib/progress-schema';
import { useTypingStore } from '../store/useTypingStore';

/**
 * The passage every learner meets first, captured at import.
 *
 * The tests below type *this* one rather than a fixture, because the defect they pin is
 * about reachability: it only shows itself on a passage long enough for a beginner's one
 * ordinary mistype to land under half a percent. A three-letter fixture hides it, and so
 * does a hand-built string of the right length — that would be me choosing the number the
 * bug needs. This length is the app's own.
 */
const LANDING = useTypingStore.getState().targetText;
const LANDING_TITLE = useTypingStore.getState().title;

// Confetti draws to a canvas jsdom does not implement, and the engine fires it the
// moment a passage completes.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  useTypingStore.getState().resetSession();
  // `resetSession` deliberately keeps the passage, and the block at the end of this file
  // loads passages of its own, so without this the next test inherits one.
  useTypingStore.setState({ title: LANDING_TITLE, targetText: LANDING });
  clearUserStats();
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

const press = (key: string) =>
  act(() => {
    useTypingStore.getState().handleKeyInput(key);
  });

/**
 * The header's accuracy figure, on its own.
 *
 * Found by walking up from that card's own label. A text search over the whole board
 * cannot do this: once the passage finishes, the completion card reads "…with 100% typing
 * accuracy", which is a real measurement of a real run, and it is not the figure at issue.
 */
function accuracyReadout(host: HTMLElement): string {
  const label = [...host.querySelectorAll('div')].find((el) => el.textContent === 'Accuracy');
  return label?.parentElement?.querySelector('.text-2xl')?.textContent ?? '';
}

/**
 * The header's progress figure, by the same walk — see `accuracyReadout`.
 *
 * The card carries `hidden sm:flex`, so it is absent below the `sm` breakpoint and a test
 * asserting on it has to know it is a DOM question and not a visibility one: jsdom applies
 * no CSS, and `hidden` is a class name here rather than a computed property.
 */
function progressReadout(host: HTMLElement): string {
  const label = [...host.querySelectorAll('div')].find((el) => el.textContent === 'Progress');
  return label?.parentElement?.querySelector('.text-2xl')?.textContent ?? '';
}

/** The header's speed figure, by the same walk — see `accuracyReadout`. */
function wpmReadout(host: HTMLElement): string {
  const label = [...host.querySelectorAll('div')].find((el) => el.textContent === 'Speed');
  return label?.parentElement?.querySelector('.text-2xl')?.textContent ?? '';
}

/**
 * The board's headline figures before anything has been typed.
 *
 * Three numbers sit side by side at the top of every typing surface in the app — the
 * home page, a story, a vocabulary word, a pasted passage — and they are the first thing a
 * learner sees of their own results. Two of the three were honest about having nothing to
 * report: `wpmFrom` returns 0 when there are no correct keystrokes and no elapsed
 * seconds, and progress divides a zero by the passage length.
 *
 * Accuracy was the third, and it read 100. Not because anything was correct — there were
 * no keystrokes — but because `totalKeystrokes > 0 ? … : 100` had to return something,
 * and 100 is the best number the field can hold. So every board in the app opened on
 *
 *     Speed 0 WPM   Accuracy 100%   Progress 0%
 *
 * three figures, of which two said "nothing yet" and the third said "flawless". It is the
 * same sentinel that sat in `DEFAULT_STATS.averageAccuracy` and rendered 100% in the stats
 * panel; this is the copy the learner meets first, on the board itself, and it was the
 * original.
 */
describe('the live readout before the first keystroke', () => {
  it('does not claim a perfect score for a run that has not started', () => {
    const host = renderEngine();
    load('The quick brown fox');

    expect(accuracyReadout(host)).not.toBe('100%');
  });

  /**
   * The control. A dash where a measurement belongs is not a fix either — the figure has
   * to appear the moment there are keystrokes to score, and has to be their real ratio.
   */
  it('reports the real score once there are keystrokes to score', () => {
    const host = renderEngine();
    load('Tab');

    press('T'); // right
    press('X'); // wrong — the passage wants "a"

    expect(accuracyReadout(host)).toBe('50%');
  });

  /**
   * The other end: a run that earns the figure. Reading "100%" out of the board wholesale
   * would pass both tests above, and would leave a perfect run reporting nothing.
   */
  it('still reports 100% for a run that earns it', () => {
    const host = renderEngine();
    load('Tab');

    for (const char of 'Tab') press(char);

    expect(accuracyReadout(host)).toBe('100%');
  });
});

/**
 * A run that is not perfect must not be able to call itself perfect.
 *
 * The figure above was `Math.round`, and rounding is the wrong direction for a number that
 * gates an achievement: it carries anything under half a percent of errors up to 100. The
 * landing passage is 281 characters, so one mistyped character — the kind a beginner makes
 * constantly, and the kind the board has just drawn in rose with a double underline — put
 * `280/281` on the completion card as "100% typing accuracy" and `100% acc` in the history.
 *
 * Then `bestAccuracy` recorded 100, and StatsModal's "Pure Precision" unlocked. Its own
 * description to the learner is "Complete a session with 100% accuracy", and it is a
 * lifetime field taken with `Math.max`, so it is the one claim in the app that gets granted
 * rather than withdrawn when the data does not support it — and once granted, no later run
 * can take it back. A beginner could not have earned it and could not lose it.
 *
 * Flooring the ratio fixes the whole chain at once: a stored 100 now means exactly zero
 * errors, which is the only thing that makes the badge's wording true, and the average in
 * lib/stats.ts is floored for the same reason (see `averageAccuracy` there).
 */
describe('a run that is not perfect', () => {
  /** Type the whole landing passage, mistyping exactly one character. */
  const typeLandingWithOneError = () => {
    const store = useTypingStore.getState();
    act(() => {
      LANDING.split('').forEach((char, index) => store.handleKeyInput(index === 0 ? 'X' : char));
    });
  };

  it('is reported as short of 100%, on a passage long enough to reach the defect', () => {
    const host = renderEngine();
    load(LANDING);

    typeLandingWithOneError();

    // The control the defect needs: enough characters that one error is under half a
    // percent, so `Math.round` would have printed 100 here.
    expect(LANDING.length).toBeGreaterThanOrEqual(200);
    expect(accuracyReadout(host)).toBe('99%');
  });

  /**
   * The half that cannot be taken back.
   *
   * The readout above is a number on a screen; this is the number the badge reads, reached
   * by finishing the run — the engine's completion effect records the session on its own, so
   * this needs no call the real app does not make.
   */
  it('is not recorded as perfect, so it cannot unlock an achievement', () => {
    renderEngine();
    load(LANDING);

    typeLandingWithOneError();

    // Exactly the predicate StatsModal uses for "Pure Precision".
    expect(loadUserStats().bestAccuracy).toBeLessThan(100);
  });

  /**
   * The control. Reading "short of 100" everywhere would pass both tests above and leave a
   * genuinely flawless run unable to earn the badge it exists for.
   */
  it('still records 100% for a run that types the passage cleanly', () => {
    renderEngine();
    load(LANDING);

    const store = useTypingStore.getState();
    act(() => {
      for (const char of LANDING) store.handleKeyInput(char);
    });

    expect(loadUserStats().bestAccuracy).toBe(100);
  });
});

/**
 * The third of those three figures, rounding the other way.
 *
 * Fifteen lines above where progress is computed, this file's other subject floors its ratio
 * because rounding carries anything under half a percent of errors up to 100. Progress sits
 * in the same header, on the same board, at the same moment:
 *
 *     Math.min(100, Math.round((typedText.length / text.length) * 100))
 *
 * So it makes the same over-claim in the mirror direction — a figure claiming more than the
 * data supports — which the comment beside Accuracy already lists as the reason for its own
 * fix. On the landing passage's 281 characters, `280/281` rounds to 100, and the board reads
 *
 *     Progress 100%
 *
 * with a character still to type. The learner's only evidence of the keystroke left is the
 * accuracy figure beside it. There is no completion card at that moment and nothing else on
 * the page moves, so nothing contradicts it.
 *
 * `Math.min(100, …)` is not a defence here. It bounds the error from above, which is the one
 * direction a `Math.round` cannot reach on its own, and leaves the over-claim — understating
 * it by under a percent — untouched.
 */
describe('the progress figure before the passage is finished', () => {
  it('is reported as short of 100%, with a character still to type', () => {
    const host = renderEngine();
    load(LANDING);

    const store = useTypingStore.getState();
    act(() => {
      for (const char of LANDING.slice(0, -1)) store.handleKeyInput(char);
    });

    // The precondition the rounding needs. On a short passage one character short is more
    // than half a percent, and `Math.round` correctly printed 99 — which is why the fixture
    // has to be the app's own passage and not a string chosen to be the right length.
    expect(LANDING.length).toBeGreaterThanOrEqual(200);
    expect(progressReadout(host)).toBe('99%');
  });

  /**
   * The control. Flooring must not cost the figure its top value: a finished passage is
   * exactly `text.length / text.length`, and there is no character left after that one to
   * round short.
   */
  it('reads 100% once the passage really is typed', () => {
    const host = renderEngine();
    load(LANDING);

    const store = useTypingStore.getState();
    act(() => {
      for (const char of LANDING) store.handleKeyInput(char);
    });

    expect(progressReadout(host)).toBe('100%');
  });
});
/**
 * The speed figure in the window before the clock has run at all.
 *
 * `finishedSeconds` returns the live tick's own count while a run is unfinished, and that
 * count is zero until `tick` fires for the first time — on a 250ms interval set up in an
 * effect after `startTime` appears. Every keystroke re-renders the board, so this is a state
 * every single run passes through: a learner types their first word and the speed reads 0.
 *
 * What that state must not become is the cap. `(5 / 5) / (0 / 60)` is Infinity, and
 * `Math.min(MAX_WPM, …)` would faithfully report it as the maximum — a 400 WPM reading in
 * the first quarter second of every run. `wpmFrom` answers `0` for `seconds <= 0` instead,
 * which is the honest figure for a rate nothing has measured yet, and nothing on the board
 * side held that in place: the guard is a line inside a helper whose unit tests call it
 * with sensible arguments.
 *
 * `test/typingStore.test.ts` already pins the precondition from the other side — a tick
 * with no session running leaves `elapsedSeconds` at zero — and `resetSession` and
 * `loadCustomText` reset the same field, so the state is reachable on every load and not
 * only on a slow one.
 */
describe('the speed figure before the clock has run', () => {
  it('is not the cap that dividing by no elapsed time produces', () => {
    const host = renderEngine();
    load('The quick brown fox');

    for (const char of 'The q') press(char);

    // The precondition, and the reason a fixture cannot supply it: `elapsedSeconds` is 0
    // because no tick has fired, which is a fact about time rather than about the text.
    expect(useTypingStore.getState().elapsedSeconds).toBe(0);
    expect(useTypingStore.getState().correctKeystrokes).toBe(5);

    expect(wpmReadout(host)).not.toContain(`${MAX_WPM} WPM`);
  });

  /**
   * The control, and the half that makes the test above mean something: the zero has to be
   * the *unmeasured clock*, not a figure that is stuck. Five keystrokes are one word, so
   * once a second has elapsed the board owes the learner 60 and not another zero — a fix
   * that simply returned 0 for anything it had not timed would pass the test above.
   */
  it('reports the real rate as soon as there is a second to measure over', () => {
    const host = renderEngine();
    load('The quick brown fox');

    for (const char of 'The q') press(char);
    expect(wpmReadout(host)).toBe('0 WPM');

    // Inside `act`, because `tick` is a store write the board subscribes to — the same
    // shape as the keystrokes above, which `press` wraps for this reason. Called bare, the
    // state advances and the readout still shows the pre-tick render.
    act(() => useTypingStore.getState().tick());

    // `tick` floors at 1 rather than at 0.9, so the divisor is a whole second either way
    // and the arithmetic here is the same one the board does.
    expect(useTypingStore.getState().elapsedSeconds).toBe(1);
    expect(wpmReadout(host)).toBe('60 WPM');
  });
});

/**
 * The board loading the passage it was handed into the store.
 *
 * `handleKeyInput` compares every keystroke against the store, so the two must be the same
 * passage or the learner is typing one thing and being scored on another — the WPM, the
 * accuracy and the recorded row all come off the store. What is *shown* comes from the
 * prop, so a board that fails to load its passage still looks right, which is why this is
 * asserted against the store and never against the markup.
 *
 * The case below is one no page produces today, and that is the point of it. The guard the
 * board uses to decide it has nothing to do reads the passage's *title*, on the reasoning
 * that every page's title carries its position — "(Part 2/6)", "(3/40)" — so no title can
 * stay put while its passage moves. That reasoning holds, and it held by accident in a
 * canary written for a different defect last turn: a pasted passage is "Custom Text"
 * before an edit and after it, so a title-only guard skipped a re-seed it should have
 * made. A board handed a new passage under an unchanged heading is the state that guard
 * cannot see, and the board is the one component every page's passage goes through.
 */
describe('a board handed a passage that moves while its heading does not', () => {
  const passage = { title: 'A Run In Progress', sourceType: 'story' as const };
  const FIRST = 'The first passage.';
  const SECOND = 'The second passage.';

  /** Renders the board over one passage, and can hand it another to render again. */
  function renderPassage(text: string): { show: (next: string) => void; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    const show = (next: string) =>
      act(() =>
        root.render(createElement(TypingEngine, { passage: { ...passage, text: next } })),
      );
    show(text);
    return { show, host };
  }

  it('loads it, so the keyboard is scoring the passage it is showing', () => {
    const { show } = renderPassage(FIRST);

    show(SECOND);

    expect(useTypingStore.getState().targetText).toBe(SECOND);
  });

  it('carries the run in progress across with it, rather than restarting at zero', () => {
    const { show } = renderPassage(FIRST);
    load(FIRST);
    press('T');

    show(SECOND);

    expect(useTypingStore.getState().typedText).toBe('');
  });

  /**
   * The control, and the reason the first is not satisfied by a board that simply never
   * re-renders: `show` is called with a new passage and nothing else, so if the render were
   * a no-op the store would hold the first passage and the assertion would pass over a
   * board showing something the store has never heard of.
   */
  it('is really showing the new passage', () => {
    const { show, host } = renderPassage(FIRST);

    show(SECOND);

    // The board draws a space as U+00A0 so a run of them keeps its width; the passage is
    // the same string with ordinary ones. Same reading as `boardText`, home page.
    expect((host.textContent ?? '').replace(/\u00a0/g, ' ')).toContain(SECOND);
  });
});
