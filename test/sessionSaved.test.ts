import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import TypingEngine from '../components/typing/TypingEngine';
import { clearUserStats, loadUserStats } from '../lib/stats';
import { useTypingStore } from '../store/useTypingStore';

// Confetti draws to a canvas jsdom does not implement, and the engine fires it the
// moment a passage completes.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

// React refuses to drive an `act` scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

// Restored before `clearUserStats`, which writes to the very storage being blocked.
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
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

/**
 * A browser that will not keep anything.
 *
 * `saveUserStats` names this case in its own catch — "Storage quota errors, and storage
 * being switched off entirely" — so it is not hypothetical. A private window that blocks
 * site data, a device profile switched off by policy, or a quota already full all land
 * here, and the quota is not the common one: a hundred capped session records cannot
 * fill five megabytes. The ordinary cause is a browser refusing to write at all.
 */
function blockStorage() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  });
}

/** Type a passage to the end, which is what records the run. */
function finish(text = 'Tab') {
  act(() => {
    useTypingStore.getState().resetSession();
    useTypingStore.getState().loadCustomText(text, 'Test passage', 'custom');
  });
  for (const char of text) {
    act(() => {
      useTypingStore.getState().handleKeyInput(char);
    });
  }
}

/**
 * What the board said about keeping the run, if it said anything.
 *
 * `role="alert"` rather than the keystroke region above it: this is a message the learner
 * has to be able to read as well as hear, and it is about the run rather than the last
 * character. The existing `role="status"` is the only other live region on the board, so
 * the two cannot be confused by a test or by a screen reader.
 */
function saveNotice(host: HTMLElement): string | undefined {
  return host.querySelector('[role="alert"]')?.textContent?.trim() || undefined;
}

/**
 * Whether a finished passage was actually kept.
 *
 * `saveUserStats` returns whether it managed to write, and the app already knew the answer
 * mattered: the restore path in StatsModal checks it and tells the learner plainly when
 * their progress could not be replaced. The record path did not — `recordCompletedSession`
 * calls `saveUserStats` and drops the answer on the floor.
 *
 * That is the path every passage in the app takes, so a learner in a browser that refuses
 * local writes finished a run, watched confetti fire and read "Passage Completed! Great
 * Job!" over a WPM and an accuracy — and the session was gone. Not once: every run from
 * then on, silently, and none of it counted toward the streak, the history or the backup.
 */
describe('a finished passage that could not be kept', () => {
  /**
   * The premise, checked first because it is what makes the notice worth anything. If the
   * run were somehow still recorded, there would be nothing to warn about and the test
   * below would be asking for a message about a non-event.
   */
  it('is really not recorded', () => {
    blockStorage();
    renderEngine();

    finish();

    expect(loadUserStats().sessions).toHaveLength(0);
  });

  /**
   * The defect. The learner is told nothing. The card above celebrates the run with a
   * speed and an accuracy that are both real measurements of something that no longer
   * exists anywhere, which is worse than a plain error: it is a true number attached to a
   * false claim that the number was kept.
   */
  it('and says so on the board', () => {
    blockStorage();
    const host = renderEngine();

    finish();

    expect(saveNotice(host)).toMatch(/not (be )?saved|not be kept/i);
  });

  /**
   * The control. A notice that appeared unconditionally would be its own lie — telling a
   * learner their run was lost when it was recorded is not better than telling them
   * nothing, and it would train them to ignore the warning.
   */
  it('is not reported when the run was kept', () => {
    const host = renderEngine();

    finish();

    expect(loadUserStats().sessions).toHaveLength(1);
    expect(saveNotice(host)).toBeUndefined();
  });
});