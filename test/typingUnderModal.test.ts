import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Navbar from '../components/Navbar';
import TypingEngine from '../components/typing/TypingEngine';
import { clearUserStats } from '../lib/stats';
import { useTypingStore } from '../store/useTypingStore';

/**
 * A modal standing on top of a typing run.
 *
 * The board listens for keys on `window`; the stats dialog listens on `document`. Both are
 * bubble-phase nodes on one chain, neither calls `stopPropagation`, and the dialog moves
 * focus into itself when it opens — so a single Escape press, the standard way anyone
 * closes a dialog, reached both. The dialog closed and `resetSession` ran behind it,
 * wiping `typedText`, every counter and the completion card.
 *
 * The rule under test is the board's own stand-down: a focused text field owns its
 * keystrokes. The dialog is where focus goes when the learner has stopped typing and
 * started reading their stats, and the selector did not know that.
 *
 * No existing test renders the Navbar and a TypingEngine in one tree — which is the whole
 * of why this survived. Every board test renders the board alone, so there was no dialog
 * above it to type at; every navbar test has no run behind it to lose.
 */

vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

const mocks = vi.hoisted(() => ({ pathname: '/stories/the-tortoise-and-the-hare' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

vi.mock('next/link', async () => {
  const { createElement: el } = await import('react');
  return {
    default: ({ href, children, ...rest }: Record<string, unknown>) =>
      el('a', { href, ...rest }, children as never),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

/**
 * The passage every test here types.
 *
 * It was the store's landing passage — 281 characters — because nothing loaded one, so
 * `typeRun` and `whole` both rode whatever the board booted with. Every keystroke is
 * wrapped in its own `act()` so the board re-renders and the store is read back, and the
 * last test types the passage twice: ~570 of them, which is what made this the slowest
 * file in the suite at 7.8s against a 5s default timeout. It then failed intermittently
 * — green alone, red under the parallel load of 50 other files — and the failure was a
 * bare `Test timed out`, with no hint that the cause was the length of the prose rather
 * than anything under test.
 *
 * Nothing here is about length. A run is finished when the passage runs out, and eleven
 * characters finish as completely as 281 do; `typeRun` takes the first `n` of whatever the
 * store holds, so the shorter passage changes the number of keystrokes and nothing else.
 */
const PASSAGE = 'Tab quietly';

beforeEach(() => {
  clearUserStats();
  // Long enough for the longest `typeRun` below, short enough to be fast.
  useTypingStore.getState().loadCustomText(PASSAGE, 'Test passage', 'custom');
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  useTypingStore.getState().resetSession();
});

/**
 * `app/layout.tsx` above `app/stories/[slug]/page.tsx`, as the real pages compose them.
 *
 * Two components because that is the finding: rendered apart, neither test can see what
 * the other does to the same keypress.
 */
function Page({ onNext }: { onNext?: () => void }) {
  return createElement(
    'div',
    null,
    createElement(Navbar),
    createElement(TypingEngine, { onNext }),
  );
}

function renderPage(props: { onNext?: () => void } = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(Page, props)));
  return host;
}

const board = () => useTypingStore.getState();

/** A keystroke, pressed where a real one lands: on whatever currently has focus. */
function pressHere(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => (document.activeElement ?? document.body).dispatchEvent(event));
  return event;
}

/**
 * The board's own window listener, which is how every real keystroke arrives.
 *
 * Dispatched on the body and allowed to bubble rather than on `window` directly: a real
 * keypress has an element for a target, and `e.target.closest` is the first thing the
 * handler does with it.
 */
function pressBoard(key: string): void {
  act(() =>
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
  );
}

const dialog = () => document.querySelector('[role="dialog"]');

function openStats(host: HTMLElement): void {
  const button = [...host.querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith('View your learning progress'),
  );
  if (!button) throw new Error('no stats button');
  act(() => button.click());
}

/** Types the first `n` characters of the store's passage, through the real listener. */
function typeRun(n: number): string {
  const typed = board().targetText.slice(0, n);
  for (const key of typed) pressBoard(key);
  return typed;
}

describe('a run underneath the stats panel', () => {
  it('survives the Escape that closes the panel', () => {
    const host = renderPage();
    const typed = typeRun(5);

    openStats(host);
    expect(dialog()).not.toBeNull();

    pressHere('Escape');

    expect(dialog()).toBeNull();
    expect(board().typedText).toBe(typed);
    expect(board().totalKeystrokes).toBe(typed.length);
  });

  it('is not typed into by the keys read while the panel is open', () => {
    const host = renderPage();
    const typed = typeRun(2);

    openStats(host);
    pressHere('x');
    pressHere(' ');

    expect(board().typedText).toBe(typed);
    expect(board().totalKeystrokes).toBe(typed.length);
  });

  /**
   * The control, and the reason the two tests above mean anything.
   *
   * "Escape never reaches the board" would pass both of them. Escape is how a learner
   * abandons a run they have restarted four times; it has to keep working when there is no
   * dialog to close, and this is what says the stand-down is scoped to the dialog rather
   * than to the key.
   */
  it('still abandons a run on Escape when no panel is open', () => {
    renderPage();
    typeRun(5);

    pressHere('Escape');

    expect(board().typedText).toBe('');
    expect(board().totalKeystrokes).toBe(0);
  });

  /**
   * The other half of the same keypress.
   *
   * Enter on a finished run advances to the next passage. Above an open panel that
   * re-seeded the store, so the learner's completed board was replaced by the next one
   * while the summary they opened the panel to read was still on screen.
   */
  it('does not advance a finished run while the panel is open', () => {
    let nexts = 0;
    const host = renderPage({ onNext: () => nexts++ });
    const whole = board().targetText;

    for (const key of whole) pressBoard(key);
    expect(board().isCompleted).toBe(true);

    openStats(host);
    pressHere('Enter');
    expect(nexts).toBe(0);

    // The control, the same key with nothing above it.
    pressHere('Escape');
    expect(dialog()).toBeNull();

    for (const key of whole) pressBoard(key);
    pressHere('Enter');
    expect(nexts).toBe(1);
  });
});