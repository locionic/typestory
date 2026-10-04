import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import TypingEngine from '../components/typing/TypingEngine';
import { useTypingStore } from '../store/useTypingStore';

// Confetti draws to a canvas jsdom does not implement, and the engine fires it the
// moment a passage completes.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

// Same requirement as test/storeSubscription.test.ts, and for the same reason: React
// refuses to drive an `act` scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

function renderEngine(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(TypingEngine)));
  return host;
}

/** What the live region holds, present or not — never a query that throws when empty. */
function liveRegion(host: HTMLElement): string {
  return host.querySelector('[role="status"]')?.textContent ?? '';
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
 * What a screen reader is told about the keystroke that just happened.
 *
 * The board is the app's whole feedback loop: it shows the passage, and it shows what
 * the learner got wrong by turning that character rose and underlining it. Position
 * tells them how far they have got, and the VirtualKeyboard reads out the next target
 * and the finger for it, so those two needs are met by text already in the DOM.
 *
 * "Did I get this one right" was not. Correctness was carried by colour and by an
 * underline — two visual signals on the same characters — and by nothing else, so a
 * learner who cannot see either has no way to find a typo short of re-reading the
 * passage against the highlight and working out what the colour meant. WPM, accuracy
 * and progress are all live text a screen reader can read; the one piece of feedback
 * that fires per keystroke was the one thing on the page it could not.
 */
describe('what the typing board says to a screen reader', () => {
  it('names the expected and the typed character on a mistyped one', () => {
    const host = renderEngine();
    load('The quick brown fox');
    expect(liveRegion(host)).toBe('');

    press('X');

    const said = liveRegion(host);
    expect(said).toContain('T');
    expect(said).toContain('X');
    expect(said).toContain('1');
  });

  /**
   * The other half, and the reason this is a status region rather than a log.
   *
   * Announcing every keystroke would be unusable: a hundred words a minute is a
   * hundred interruptions a minute, and a screen-reader user would spend the session
   * being told the passage back to them. Errors are the events worth a sentence —
   * rare, and the thing they came here to find.
   *
   * Clearing on a correct keystroke is also what makes a *repeat* of the same mistake
   * announce. If the text stayed put, hitting "X" where the passage wants "T" twice
   * would leave the region holding an identical string, and a live region only speaks
   * when its content changes — so the second one, which is the one the learner has
   * just corrected and would most want to hear about again, would be silent.
   */
  it('says nothing on a correct keystroke, so a repeat mistake is heard again', () => {
    const host = renderEngine();
    load('Tab');

    press('X');
    const firstTime = liveRegion(host);
    expect(firstTime).not.toBe('');

    // Typed on, and this one is right — the passage's second character is "a".
    press('a');
    expect(useTypingStore.getState().typedText).toBe('Xa');
    expect(liveRegion(host)).toBe('');

    // Back to where it was, and the same mistake again. The text going back to exactly
    // `firstTime` is the point: without the clearing above, this would be an unchanged
    // live region and the correction the learner just made would be silent.
    act(() => {
      useTypingStore.getState().handleBackspace();
    });
    act(() => {
      useTypingStore.getState().handleBackspace();
    });
    press('X');
    expect(liveRegion(host)).toBe(firstTime);
  });

  /**
   * The virtual keyboard reads "Space ␣" for exactly this reason — a bare space in a
   * sentence a screen reader is speaking is silence, so the error would name nothing.
   */
  it('names a mistyped space rather than speaking one', () => {
    const host = renderEngine();
    load('a b');
    press('a');

    press('x');

    const said = liveRegion(host);
    expect(said.toLowerCase()).toContain('space');
    expect(said).not.toContain('" "');
  });

  /**
   * The control. The empty assertions above would also pass against a harness whose
   * keystrokes never reached the store, because a region that is always empty is
   * trivially empty — and the first test would fail loudly while the rest passed,
   * which is exactly the shape a broken harness produces.
   */
  it('really moves the typed text, so the empty cases above mean something', () => {
    renderEngine();
    load('The quick brown fox');

    press('X');

    const state = useTypingStore.getState();
    expect(state.typedText).toBe('X');
    expect(state.totalKeystrokes).toBe(1);
    expect(state.correctKeystrokes).toBe(0);
  });
});

describe('a passage typed correctly', () => {
  it('is announced not at all', () => {
    const host = renderEngine();
    load('The');

    for (const char of 'The') press(char);

    expect(useTypingStore.getState().correctKeystrokes).toBe(3);
    expect(liveRegion(host)).toBe('');
  });
});
/**
 * Wrong is not wrong because it is red.
 *
 * WCAG 2.2 SC 1.4.1, Use of Color: colour must not be the only visual means of conveying
 * information. The board gets this right — a mistyped character is drawn rose *and*
 * underlined — and the underline is load-bearing rather than decorative. It survives
 * greyscale, a colour-vision deficiency, a dark theme and any future palette, which the
 * rose does not. Without it, a learner who cannot separate those two shades has no way to
 * find a typo at all, and the two classes would look identical: correct characters are
 * tinted, untyped ones are faint gray, and the wrong pair is the only one needing a second
 * channel, because position already separates the other two.
 *
 * The reason this is asserted in jsdom rather than left to the browser is that
 * `test/e2e/app-flows.e2e.ts` is the only other place covering it, and it cannot currently
 * be run. A refactor that trimmed the class string back to colour alone would keep every
 * number in this file green.
 */
describe('a mistyped character', () => {
  /** The per-character spans, in passage order. The caret is absolutely positioned, not one. */
  function characters(host: HTMLElement): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('span.relative.inline-block')];
  }

  /** Type `The` as `Xhe` — the first character wrong, the rest right. */
  function mistype(): HTMLElement {
    const host = renderEngine();
    load('The');
    press('X');
    press('h');
    press('e');
    return host;
  }

  it('is marked by something other than its colour', () => {
    const host = mistype();

    expect(characters(host)[0].className).toContain('underline');
  });

  /**
   * The control, and the reason the assertion above means anything.
   *
   * An underline on every character would satisfy "is not colour alone" just as well as
   * the wrong one, while telling the learner nothing — so what has to be pinned is that
   * the shape marks *wrong specifically*. These two are correct.
   */
  it('is the only character carrying that mark', () => {
    const host = mistype();
    const [wrong, first, second] = characters(host);

    expect(useTypingStore.getState().correctKeystrokes).toBe(2);
    expect(first.className).not.toContain('underline');
    expect(second.className).not.toContain('underline');
    expect(wrong.className).toContain('underline');
  });
});
