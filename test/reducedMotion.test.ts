import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import TypingEngine from '../components/typing/TypingEngine';
import { clearUserStats } from '../lib/stats';
import { useTypingStore } from '../store/useTypingStore';

// `process.cwd()` rather than `import.meta.url`, which under this config is not a `file:`
// URL. Same route test/globalStyles.test.ts takes.
const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
const REDUCE = '(prefers-reduced-motion: reduce)';

const fire = vi.hoisted(() => vi.fn());
vi.mock('canvas-confetti', () => ({ default: (...args: unknown[]) => fire(...args) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The body of one `@media` rule, or `''` when the stylesheet has no such query.
 *
 * Brace-depth rather than a regex, because the rules this is looking for contain nested
 * blocks — a keyframe body inside a `prefers-reduced-motion` query is the ordinary shape
 * of that fix — and a `[^}]*` match would stop at the first inner brace and read a
 * truncated rule as the whole one.
 */
function mediaBlock(query: string): string {
  const at = CSS.indexOf(query);
  if (at === -1) return '';
  const open = CSS.indexOf('{', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(open + 1, i);
  }
  return '';
}

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  useTypingStore.getState().resetSession();
  clearUserStats();
  fire.mockClear();
  vi.unstubAllGlobals();
});

/** What a learner who has asked their OS for reduced motion is asserting to the page. */
function prefersReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches && query === REDUCE,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

/** Load a passage and type it exactly, so the run completes and the effect fires. */
function completeARun() {
  const text = 'Short run.';
  act(() => {
    const store = useTypingStore.getState();
    store.resetSession();
    store.loadCustomText(text, 'Reduced motion', 'custom');
  });
  act(() => {
    for (const char of 'Short run.') useTypingStore.getState().handleKeyInput(char);
  });
}

/** The board, mounted against whatever `matchMedia` is currently stubbed to say. */
function mountEngine(): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(TypingEngine)));
}

describe('a learner who has asked for reduced motion', () => {
  it('gets a stylesheet that stops the animations, not just a comment saying it should', () => {
    const block = mediaBlock(REDUCE);
    expect(block).not.toBe('');
    expect(block).toMatch(/animation-duration/);
    // The caret's `animate-pulse` is an infinite loop on a 2s cycle that restarts for as
    // long as the board is open. Ending a run's animation once is not enough; without
    // `animation-iteration-count` this rule would silence the completion card and leave
    // the caret pulsing forever beside every word being typed.
    expect(block).toMatch(/animation-iteration-count\s*:\s*1\b/);
    // `<html>` carries `scroll-smooth`, and the tutor page calls `scrollIntoView` on every
    // reply — so without this the viewport glides on each turn of a conversation, and on
    // every Tab that moves focus off-screen. Neither is reachable from inside the page.
    expect(block).toMatch(/scroll-behavior\s*:\s*auto\b/);
  });

  it('does not get 80 confetti particles fired at them on completion', () => {
    prefersReducedMotion(true);
    mountEngine();

    completeARun();

    // The run really did finish, or this passes for the wrong reason.
    expect(useTypingStore.getState().isCompleted).toBe(true);
    expect(fire).not.toHaveBeenCalled();
  });

  /**
   * The control, and the only thing keeping the two tests above from being vacuous.
   *
   * jsdom implements no media queries and the app consulted none, so a stub that reports
   * nothing at all — or one wired to the wrong string, or a component that never asks —
   * produces exactly the same two passes: a stylesheet that happens to contain the
   * rule, and a confetti call that never happened. Driving the identical run with the
   * opposite answer is what separates "the fix is working" from "the test cannot see".
   */
  it('still gets the celebration when they have not asked for reduced motion', () => {
    prefersReducedMotion(false);
    mountEngine();

    completeARun();

    expect(useTypingStore.getState().isCompleted).toBe(true);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('would notice a stylesheet that had lost the rule', () => {
    // The same reader, pointed at a query this stylesheet does not contain. Without this,
    // `mediaBlock` could return the whole file for any input and the first test would
    // still pass.
    expect(mediaBlock('(prefers-contrast: more)')).toBe('');
  });
});