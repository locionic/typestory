import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Navbar from '../components/Navbar';
import {
  getTodayDateString,
  getYesterdayDateString,
  loadUserStats,
  recordCompletedSession,
  saveUserStats,
} from '../lib/stats';
import type { UserStats } from '../lib/types';

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The Navbar is nothing but links; this keeps the import from dragging the router in.
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => createElement('a', null, children),
}));

// And now it reads the pathname to say which of its links is the current page, which
// needs the router the same way. Neither hook touches the typing store, which is what
// the header's re-render count is about — stubbing the URL must not change it.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const roots: { unmount: () => void }[] = [];

/**
 * A learner mid-streak, as of some other day.
 *
 * `lastActiveDate` is the only field that says whether `currentStreak` still holds, and
 * the point of every case below is that it is set to a day the test chose. `bestStreak`
 * is 12 throughout so "12 days" can never be mistaken for the number the Streak card is
 * supposed to be showing.
 */
const streak = (lastActiveDate: string, currentStreak = 5): UserStats => ({
  sessions: [],
  dailyStreak: { currentStreak, bestStreak: 12, lastActiveDate },
  totalWordsTyped: 0,
  totalTimeSpentSeconds: 0,
  bestWpm: 0,
  averageWpm: 0,
  averageAccuracy: 100,
  bestAccuracy: 100,
});

function renderNavbar(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(Navbar)));
  return host;
}

/** The header's streak pill — the number, on every page of the app. */
const pill = (host: HTMLElement) =>
  host.querySelector('button[title="Daily Practice Streak"] span')?.textContent ?? '';

/** Open the panel the pill leads to, and hand back its text. */
async function openPanel(host: HTMLElement): Promise<string> {
  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[title="Daily Practice Streak"]')!.click();
  });
  return host.textContent ?? '';
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

/**
 * A streak that ended, still being counted.
 *
 * `currentStreak` is written once, when a passage completes, and `recordCompletedSession`
 * is the only thing that rewrites it — so the moment it stops matching, it does not
 * change again until the learner practises once more. A learner who ran a five-day
 * streak and then closed the tab for a fortnight kept seeing `5d` in the header of every
 * page, and `5 days` on the card behind it, while the app's own record said plainly when
 * they were last there: `lastActiveDate`, stored, validated against `DATE_PATTERN`,
 * uploaded to the backup, and read by exactly one line of code — the branch inside
 * `recordCompletedSession` that has not run yet.
 *
 * The tooltip says "Daily Practice Streak" and the field is called `currentStreak`.
 * Both are claims about now, and both were answered with a number about the past. This
 * is the field the whole record is shaped around, rendered by the two places that should
 * have consulted its companion and did not.
 *
 * Nothing else is affected: the stored value is still right *as of the last session*,
 * which is what resuming a streak has to build on, and `bestStreak` — the lifetime
 * figure, which is not a claim about today — is left alone.
 */
describe('the streak on screen', () => {
  it('stops counting a streak that ended before today', () => {
    saveUserStats(streak('2026-01-01', 5));

    expect(pill(renderNavbar())).toBe('0d');
  });

  /**
   * The controls, and the reason the test above is about a streak that ended rather
   * than about arithmetic. A streak is not dead the moment yesterday passes: yesterday
   * is the last day it can be extended, and only the day after does it lapse. Both
   * boundaries have to leave the number alone or the fix is its own lie — and a learner
   * opening the app on the evening of day five must still see 5, not 0, or the pill
   * stops meaning anything at all.
   */
  it('keeps counting one practised today or yesterday', () => {
    saveUserStats(streak(getTodayDateString()));
    expect(pill(renderNavbar())).toBe('5d');

    for (const root of roots.splice(0)) act(() => root.unmount());

    saveUserStats(streak(getYesterdayDateString()));
    expect(pill(renderNavbar())).toBe('5d');
  });

  it('reads zero for someone who has never practised', () => {
    saveUserStats(streak(''));

    expect(pill(renderNavbar())).toBe('0d');
  });

  /**
   * The same number, on the panel the pill opens.
   *
   * The header and the Streak card are two renderings of one claim about today, and the
   * card is where a learner goes looking: it is the one with `Best: 12 days` under it,
   * so a dead 5 beside a live best of 12 reads as a standing achievement rather than
   * something that lapsed. Fixing the pill alone would leave the panel claiming the
   * number the header had just corrected.
   */
  it('shows the panel the same number the header does', async () => {
    saveUserStats(streak('2026-01-01', 5));
    const host = renderNavbar();

    expect(await openPanel(host)).toContain('0 days');
    // The lifetime figure is not a claim about today, so it stays.
    expect(host.textContent ?? '').toContain('Best: 12 days');
  });

  /**
   * Yesterday is the only case where the two can disagree, and it is the one that
   * matters.
   *
   * The number on screen is 5, and the next finished passage has to build on 5 rather
   * than start again. A fix that decayed the stored streak — in the reader, or on the
   * way through `saveUserStats` — would satisfy every assertion above and quietly turn
   * a five-day run into a one-day one for anyone who practised on consecutive days
   * without necessarily opening the app between them.
   */
  it('leaves the stored streak alone, so the next day extends it', () => {
    saveUserStats(streak(getYesterdayDateString(), 5));
    expect(pill(renderNavbar())).toBe('5d');

    recordCompletedSession({
      title: 'Practice',
      sourceType: 'custom',
      wpm: 40,
      accuracy: 95,
      durationSeconds: 30,
      wordsCount: 5,
      keystrokes: 200,
    });

    expect(loadUserStats().dailyStreak.currentStreak).toBe(6);
  });
});