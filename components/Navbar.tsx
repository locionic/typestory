'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Volume2, BarChart3, Flame } from 'lucide-react';
import { useTypingStore, useSwitchSound } from '../store/useTypingStore';
import { SwitchSound } from '../lib/types';
import { useUserStats, liveStreak } from '../lib/stats';
import { useBackupCode, useBackupPushFailed } from '../lib/progress-client';
import { NAV_ROUTES } from '../lib/routes';
import { TAGLINE } from '../lib/site';
import StatsModal from './stats/StatsModal';

/**
 * The header's routes.
 *
 * The list lives in `lib/routes` because the layout's footer reads it too — see its note
 * for the two-lists-drifted bug this replaced.
 */

/** What all six share. The current one adds to this rather than replacing it. */
const NAV_LINK =
  'flex items-center gap-1.5 transition hover:text-indigo-600 dark:hover:text-indigo-400';
/**
 * Bold as well as indigo, because indigo is the half a learner in a monochrome or
 * high-contrast rendering does not get. Weight is the cue that survives it.
 */
const NAV_LINK_CURRENT = 'font-bold text-indigo-600 dark:text-indigo-400';

export default function Navbar() {
  // useSwitchSound rather than the raw selector: see its comment — a plain read leaves
  // the dropdown showing Blue while a persisted Mute is what is actually playing.
  const switchSound = useSwitchSound();
  // The action selected rather than destructured. `useTypingStore()` alone resolves to
  // the identity selector, so this header re-rendered on every keystroke and every
  // clock tick — rebuilding the nav, and the stats modal mounted behind it, eight times
  // a second for a header that displays none of it. Actions are created once, so
  // selecting one compares equal forever and React stops.
  const setSound = useTypingStore((s) => s.setSound);
  const stats = useUserStats();
  // Read once: the pill's label and the number on it have to be the same day's streak, and
  // a second `liveStreak` call would be a second chance for them not to be.
  const streak = liveStreak(stats.dailyStreak);
  /* A backup that has stopped, on a page the learner is already on.
   *
   * `pushProgress` reports nothing — it is fire-and-forget so a dead network cannot interrupt
   * a typing session — and `StatsModal` is the only thing that said so. So the one signal that
   * weeks of practice were not reaching the server lived inside a panel, on a button that is
   * icon-only under 640px, and every learner who did not think to open it found out by
   * switching devices with nothing to restore. Both hooks are called unconditionally and
   * combined afterwards: a push settles long after `disableBackup` clears the verdict, so
   * `pushFailed` on its own can describe a backup that no longer exists. `StatsModal` gates
   * the same way, for the same reason. */
  const backupCode = useBackupCode();
  const pushFailed = useBackupPushFailed();
  const backupStopped = backupCode !== null && pushFailed;
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  // Read from the URL rather than passed down, so the eleven story pages — which are one
  // level below `/stories` and share this layout — are described by the same rule as the
  // five top-level routes. Deliberately not `useSearchParams`: that is the one hook that
  // opts a client component out of static rendering (it is why `/vocab` needs a Suspense
  // boundary), and this header is on every prerendered page in the app.
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-gray-200 bg-white/90 backdrop-blur-md dark:border-gray-800 dark:bg-gray-950/90">
        {/* Wraps to a second row on phones. The nav used to be `hidden md:flex`, which
            left every route below 768px unreachable — a bad trade in an app whose
            primary device is a phone. `order-last` puts that row under the controls
            and `md:order-none` puts it back in line once there is room beside them. */}
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-4 px-4 py-2 sm:px-6 md:py-0">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-2.5 transition hover:opacity-90">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-white">
                TypeStory
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                {TAGLINE}
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="order-last flex w-full items-center gap-5 overflow-x-auto whitespace-nowrap text-sm font-medium text-gray-600 md:order-none md:w-auto md:gap-6 dark:text-gray-300">
            {NAV_ROUTES.map(({ href, label, Icon }) => {
              // The route itself, or anything under it: the eleven story pages are one
              // level below `/stories`, and a strict equality test would leave every one
              // of them with a header claiming none of them is current. The separator is
              // what keeps `/vocabulary` from counting as `/vocab`. `usePathname` returns
              // no query string, so `/vocab?bank=…` arrives here as plain `/vocab` and
              // the word banks do not need the parameter parsed out of anything.
              const current = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={`${NAV_LINK}${current ? ` ${NAV_LINK_CURRENT}` : ''}`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Action controls (Keyboard Sound, Streak, Stats & Start Practice) */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Daily Streak Pill */}
            <button
              type="button"
              onClick={() => setIsStatsOpen(true)}
              title="Daily Practice Streak"
              /* `aria-label`, and it carries the count as well as the thing. The visible
               * content is `{n}d`, and that was the accessible name: a `title` never wins
               * against real content in the name algorithm, so this announced itself as
               * "1d" — a bare number, with nothing to say it was a streak or that it
               * opens the analytics panel — on every page of the app. Labelling it without
               * the number would name it and still leave a screen reader user unable to
               * tell one day from nine, which is the number's whole reason for being up
               * here. Same fix, for the same reason, as the Stats button below. */
              aria-label={`Daily practice streak: ${streak} day${streak === 1 ? '' : 's'}`}
              className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1 text-xs font-bold text-amber-700 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300"
            >
              <Flame className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
              {/* Lapsed streaks read zero — see `liveStreak`. This number sits on every
                  page of the app, so a learner who had not practised for a week was
                  looking at a month-old streak on every single one of them. */}
              <span>{streak}d</span>
            </button>

            {/* Stats Modal Trigger */}
            <button
              type="button"
              onClick={() => setIsStatsOpen(true)}
              /* Both names say the same extra thing, because both are half-invisible: `title`
               * never wins against content, and a phone shows this button as a bare icon.
               * The dot carries neither — `aria-hidden`, since the name already says it — so
               * the warning is not "seen" and then announced a second time as an unnamed dot. */
              title={
                backupStopped
                  ? 'Your last backup upload did not reach the server — open this to see what that means'
                  : 'View your learning progress and statistics'
              }
              /* `aria-label`, not just the `title`: the visible "Stats" label below is
               * `hidden sm:inline`, so below 640px this button is an icon with nothing
               * beside it — and content in `display: none` is left out of the accessible
               * name. A tooltip is not a name either, so on a phone this announced
               * nothing. Same fix as the keyboard toggle on the board. */
              aria-label={
                backupStopped
                  ? 'View your learning progress and statistics. Warning: the last backup upload did not reach the server.'
                  : 'View your learning progress and statistics'
              }
              className="relative flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <BarChart3 className="h-3.5 w-3.5 text-indigo-500" />
              <span className="hidden sm:inline">Stats</span>
              {/* The ring matches the header behind it, so the dot reads as sitting on the
                  * button rather than punched through it. */}
              {backupStopped && (
                <span
                  aria-hidden="true"
                  data-testid="backup-stopped"
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-gray-950"
                />
              )}
            </button>

            {/* Sound Selector. Not `hidden lg:flex` as it was: that made this the only
                control for the switch sound, and hid it on every screen under
                1024px — including the phone this header's own comment calls the
                primary device. Someone practising on a train had no way to reach
                "Mute" at all, and the clicky default came back on every visit. */}
            <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <Volume2 className="h-3.5 w-3.5 text-indigo-500" />
              <select
                aria-label="Select keyboard sound effect"
                value={switchSound}
                onChange={(e) => setSound(e.target.value as SwitchSound)}
                className="bg-transparent font-medium"
              >
                <option value="blue">Blue Switch</option>
                <option value="brown">Brown Switch</option>
                <option value="bubble">Bubble Pop</option>
                <option value="mute">Mute</option>
              </select>
            </div>

            <Link
              href="/stories"
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            >
              Start Practice
            </Link>
          </div>
        </div>
      </header>

      {/* Analytics Modal */}
      <StatsModal isOpen={isStatsOpen} onClose={() => setIsStatsOpen(false)} />
    </>
  );
}
