'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { BookOpen, Volume2, FileText, Bookmark, BarChart3, Flame } from 'lucide-react';
import { useTypingStore } from '../store/useTypingStore';
import { SwitchSound } from '../lib/types';
import { useUserStats } from '../lib/stats';
import StatsModal from './stats/StatsModal';

export default function Navbar() {
  const { switchSound, setSound } = useTypingStore();
  const stats = useUserStats();
  const [isStatsOpen, setIsStatsOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-gray-200 bg-white/90 backdrop-blur-md dark:border-gray-800 dark:bg-gray-950/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
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
                Type &amp; Speak English
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600 dark:text-gray-300">
            <Link
              href="/stories"
              className="flex items-center gap-1.5 transition hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              <BookOpen className="h-4 w-4" />
              <span>Stories</span>
            </Link>
            <Link
              href="/vocab"
              className="flex items-center gap-1.5 transition hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              <Bookmark className="h-4 w-4" />
              <span>Word Banks</span>
            </Link>
            <Link
              href="/custom"
              className="flex items-center gap-1.5 transition hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              <FileText className="h-4 w-4" />
              <span>Paste Text</span>
            </Link>
          </nav>

          {/* Action controls (Keyboard Sound, Streak, Stats & Start Practice) */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Daily Streak Pill */}
            <button
              type="button"
              onClick={() => setIsStatsOpen(true)}
              title="Daily Practice Streak"
              className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1 text-xs font-bold text-amber-700 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300"
            >
              <Flame className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
              <span>{stats.dailyStreak.currentStreak}d</span>
            </button>

            {/* Stats Modal Trigger */}
            <button
              type="button"
              onClick={() => setIsStatsOpen(true)}
              title="View your learning progress and statistics"
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <BarChart3 className="h-3.5 w-3.5 text-indigo-500" />
              <span className="hidden sm:inline">Stats</span>
            </button>

            {/* Sound Selector */}
            <div className="hidden lg:flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <Volume2 className="h-3.5 w-3.5 text-indigo-500" />
              <select
                aria-label="Select keyboard sound effect"
                value={switchSound}
                onChange={(e) => setSound(e.target.value as SwitchSound)}
                className="bg-transparent font-medium focus:outline-none"
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
