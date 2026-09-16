'use client';

import React from 'react';
import { X, Flame, Zap, Target, BookOpen, Clock, Trash2, Award, CheckCircle2 } from 'lucide-react';
import { useUserStats, clearUserStats } from '../../lib/stats';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function StatsModal({ isOpen, onClose }: StatsModalProps) {
  const stats = useUserStats();

  if (!isOpen) return null;

  const totalMinutes = Math.round(stats.totalTimeSpentSeconds / 60);

  // Achievement logic
  const achievements = [
    {
      id: 'first_step',
      title: 'First Flight',
      desc: 'Complete your first practice session',
      unlocked: stats.sessions.length >= 1,
      icon: '🌱',
    },
    {
      id: 'speed_50',
      title: 'Speed Sprinter',
      desc: 'Achieve 50+ WPM in any session',
      unlocked: stats.bestWpm >= 50,
      icon: '⚡',
    },
    {
      id: 'speed_75',
      title: 'Typing Virtuoso',
      desc: 'Achieve 75+ WPM in any session',
      unlocked: stats.bestWpm >= 75,
      icon: '🚀',
    },
    {
      id: 'perfectionist',
      title: 'Pure Precision',
      desc: 'Complete a session with 100% accuracy',
      unlocked: stats.sessions.some((s) => s.accuracy === 100),
      icon: '🎯',
    },
    {
      id: 'streak_3',
      title: 'Consistency King',
      desc: 'Maintain a 3-day typing streak',
      unlocked: stats.dailyStreak.bestStreak >= 3,
      icon: '🔥',
    },
    {
      id: 'words_1000',
      title: 'Vocabulary Scholar',
      desc: 'Type over 1,000 words total',
      unlocked: stats.totalWordsTyped >= 1000,
      icon: '📖',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
              <Award className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Typing &amp; Learning Analytics
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Your personal muscle memory and language milestones
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Daily Streak */}
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3.5 dark:border-amber-900/30 dark:bg-amber-950/20">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                <Flame className="h-4 w-4 text-amber-500 fill-amber-500" />
                <span>Streak</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-amber-900 dark:text-amber-200">
                {stats.dailyStreak.currentStreak}{' '}
                <span className="text-xs font-normal">days</span>
              </div>
              <div className="text-[10px] text-amber-700/80 dark:text-amber-400/70">
                Best: {stats.dailyStreak.bestStreak} days
              </div>
            </div>

            {/* Peak Speed */}
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3.5 dark:border-indigo-900/30 dark:bg-indigo-950/20">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-400">
                <Zap className="h-4 w-4 text-indigo-500 fill-indigo-500" />
                <span>Peak Speed</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-indigo-900 dark:text-indigo-200">
                {stats.bestWpm}{' '}
                <span className="text-xs font-normal">WPM</span>
              </div>
              <div className="text-[10px] text-indigo-700/80 dark:text-indigo-400/70">
                Avg: {stats.averageWpm} WPM
              </div>
            </div>

            {/* Accuracy */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3.5 dark:border-emerald-900/30 dark:bg-emerald-950/20">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <Target className="h-4 w-4 text-emerald-500" />
                <span>Accuracy</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-emerald-900 dark:text-emerald-200">
                {stats.averageAccuracy}%
              </div>
              <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/70">
                Lifetime average
              </div>
            </div>

            {/* Practice Volume */}
            <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-3.5 dark:border-purple-900/30 dark:bg-purple-950/20">
              <div className="flex items-center gap-1.5 text-xs font-bold text-purple-700 dark:text-purple-400">
                <BookOpen className="h-4 w-4 text-purple-500" />
                <span>Volume</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-black text-purple-900 dark:text-purple-200">
                {stats.totalWordsTyped.toLocaleString()}
              </div>
              <div className="text-[10px] text-purple-700/80 dark:text-purple-400/70">
                words (~{totalMinutes} min)
              </div>
            </div>
          </div>

          {/* Achievement Badges */}
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
              Milestone Badges ({achievements.filter((a) => a.unlocked).length}/{achievements.length})
            </h3>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {achievements.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-2.5 rounded-2xl border p-3 transition ${
                    item.unlocked
                      ? 'border-indigo-200 bg-indigo-50/60 dark:border-indigo-900/40 dark:bg-indigo-950/20'
                      : 'border-gray-200 bg-gray-50/40 opacity-50 dark:border-gray-800 dark:bg-gray-850'
                  }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">
                        {item.title}
                      </span>
                      {item.unlocked && (
                        <CheckCircle2 className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Practice Log */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Recent Sessions ({stats.sessions.length})
              </h3>
              {stats.sessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Reset your typing stats and session history?')) {
                      clearUserStats();
                    }
                  }}
                  className="flex items-center gap-1 text-[11px] font-semibold text-rose-500 hover:text-rose-600"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Reset Stats</span>
                </button>
              )}
            </div>

            {stats.sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center text-xs text-gray-400 dark:border-gray-800">
                No typing sessions recorded yet. Complete any story or vocabulary drill to see your stats here!
              </div>
            ) : (
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {stats.sessions.slice(0, 15).map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/70 p-3 text-xs dark:border-gray-800 dark:bg-gray-850/60"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-gray-800 dark:text-gray-200">
                          {session.title}
                        </span>
                        <span className="rounded bg-gray-200 px-1.5 py-0.2 text-[9px] font-bold uppercase text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {session.sourceType}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400">
                        <Clock className="h-2.5 w-2.5" />
                        <span>{session.dateStr}</span>
                        <span>•</span>
                        <span>{session.wordsCount} words in {session.durationSeconds}s</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="font-mono font-black text-indigo-600 dark:text-indigo-400">
                          {session.wpm} WPM
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {session.accuracy}% acc
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
