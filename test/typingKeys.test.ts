import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import TypingEngine from '../components/typing/TypingEngine';
import { clearUserStats } from '../lib/stats';
import { useTypingStore } from '../store/useTypingStore';

// Confetti draws to a canvas jsdom does not implement, and the engine fires it the
// moment a passage completes.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

// React refuses to drive an `act` scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  useTypingStore.getState().resetSession();
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

const board = () => useTypingStore.getState();

/**
 * A keystroke, pressed for real.
 *
 * Every other board test calls `handleKeyInput` directly, which skips the window
 * listener entirely — so nothing in the suite could see what that listener does with a
 * key it should not have taken. This dispatches through it, and hands back the event so
 * a test can ask whether the engine cancelled it: `preventDefault` is the whole of the
 * claim under test, and it is invisible from the store alone.
 */
function pressOn(target: EventTarget, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event;
}

/** The control, found by the text it shows rather than by position. */
function control(host: HTMLElement, label: string): HTMLElement {
  const found = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  );
  if (!found) throw new Error(`no control labelled "${label}"`);
  return found;
}

/**
 * What the keyboard does to the board.
 *
 * The engine listens on `window` so a learner can type without clicking anything first,
 * and that is what puts it in the way of every control on the page. The listener stood
 * down for form fields — a textarea, an input — because those own their keystrokes, but
 * not for the buttons and links around them, and Space is both a printable character
 * and the key every button on the web is activated with.
 */
describe('the keyboard on a page with a typing board', () => {
  /**
   * The wiring, and the reason a null result below means something. Nothing is focused
   * and a letter arrives; the board takes it.
   */
  it('types what the learner presses', () => {
    renderEngine();

    pressOn(document.body, 'a');

    expect(board().totalKeystrokes).toBe(1);
  });

  /**
   * The defect. Space focused on Restart was swallowed by the board: filed as a typed
   * space and `preventDefault`ed, which is what stops the browser ever turning the
   * keypress into a click. So the control sat there doing nothing on the one key that
   * activates it — and it is the button *on the board*, so it is not a corner of the app
   * but the control a learner presses to undo a mistake.
   *
   * Space is also the most-typed character in any passage, so this is the one key where
   * the two claims — "type this" and "activate that" — are genuinely in conflict, which
   * is why it needs a rule rather than a shrug.
   */
  it('leaves Space to a control that owns it', () => {
    const host = renderEngine();
    const restart = control(host, 'Restart');
    restart.focus();

    const event = pressOn(restart, ' ');

    expect(event.defaultPrevented).toBe(false);
    expect(board().totalKeystrokes).toBe(0);
  });

  /**
   * The control, and the reason the fix is two lines rather than a guard on every key.
   * Space belongs to whichever thing owns it: with nothing focused the board owns it, and
   * standing down for a focused control must not stop the learner typing spaces — which
   * would break the passage they are halfway through.
   */
  it('still types Space when the learner is just typing', () => {
    renderEngine();

    pressOn(document.body, ' ');

    expect(board().totalKeystrokes).toBe(1);
    expect(board().typedText).toBe(' ');
  });

  /**
   * The case the listener already handled, pinned because the fix above widens what it
   * stands down for and this is the part that must not regress: `/custom` types a
   * passage into a textarea on the same page as the board.
   */
  it('does not type into a field that owns its own keys', () => {
    renderEngine();
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    field.focus();

    pressOn(field, 'a');

    expect(board().totalKeystrokes).toBe(0);
  });

  /**
   * The other side of standing down for Space, and the half that guard alone got wrong.
   *
   * A button clicked with the mouse keeps focus — in Chrome and Firefox, unlike Safari,
   * `click` does not move focus off it. So after clicking a button the learner types
   * into a page whose focused element is still that button, and the first space they
   * type is the key that button is activated by.
   *
   * On `/custom` that button is Load & Start Practice. Its handler reloads the passage,
   * which zeroes `typedText` and the counters — so every single custom session, on a
   * browser that behaves this way, lost everything typed before the first space. The
   * engine's own Restart button does the same thing to a run in progress.
   *
   * It is read as "does the button still hold focus" rather than "does the run survive",
   * because jsdom does not implement Space-key activation on a button: the click that
   * does the damage cannot be produced here, but the focus that causes it can.
   */
  it('hands the keyboard back once the learner starts typing again', () => {
    const host = renderEngine();
    const restart = control(host, 'Restart');
    restart.focus();

    pressOn(restart, 'a');

    expect(document.activeElement).not.toBe(restart);
  });
});