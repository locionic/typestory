'use client';

import React, { useState } from 'react';
import {
  X,
  Flame,
  Zap,
  Target,
  BookOpen,
  Clock,
  Trash2,
  Award,
  CheckCircle2,
  CloudUpload,
  CloudOff,
  Copy,
  Download,
} from 'lucide-react';
import { useUserStats, clearUserStats, saveUserStats } from '../../lib/stats';
import {
  useBackupCode,
  enableBackup,
  disableBackup,
  adoptBackupCode,
  fetchBackup,
  pushProgress,
} from '../../lib/progress-client';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function StatsModal({ isOpen, onClose }: StatsModalProps) {
  const stats = useUserStats();
  const backupCode = useBackupCode();
  const [codeInput, setCodeInput] = useState('');
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const startBackup = () => {
    if (!enableBackup()) {
      setBackupMessage('This browser will not let the app store a backup code.');
      return;
    }
    // Upload what is already here rather than making the first backup wait for the
    // next finished passage.
    pushProgress(stats);
    setBackupMessage('Backup is on. Keep this code — it is the only way back in.');
  };

  const stopBackup = () => {
    const ok = confirm(
      'Stop backing up and delete the stored copy? Your progress stays in this browser, ' +
        'but there will be nothing left to restore from.',
    );
    if (!ok) return;
    disableBackup();
    setCodeInput('');
    setBackupMessage('Backup is off, and the stored copy was deleted.');
  };

  const copyCode = async () => {
    if (!backupCode) return;
    if (!navigator.clipboard) {
      setBackupMessage('Clipboard access is blocked here — select the code and copy it.');
      return;
    }
    try {
      await navigator.clipboard.writeText(backupCode);
      setBackupMessage('Code copied.');
    } catch {
      setBackupMessage('Could not copy — select the code and copy it by hand.');
    }
  };

  const restore = async () => {
    const wanted = codeInput.trim();
    setRestoring(true);
    const found = await fetchBackup(wanted);

    if (!found.ok) {
      setBackupMessage(found.error);
      setRestoring(false);
      return;
    }

    // Confirm only now: there is nothing to warn about until a backup has been
    // found. Without one of its own, this device's copy cannot be recovered.
    const ok = confirm(
      backupCode
        ? 'Replace the progress on this device with that backup? What is here now ' +
            'stays recoverable under this device’s own code.'
        : 'Replace the progress on this device with that backup? This device has no ' +
            'backup of its own, so what is here now cannot be recovered.',
    );
    if (!ok) {
      setRestoring(false);
      return;
    }

    adoptBackupCode(wanted);
    saveUserStats(found.stats);
    setCodeInput('');
    setBackupMessage('Restored. This device backs up to that code from now on.');
    setRestoring(false);
  };

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
                Last 100 sessions
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

          {/* Progress Backup */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50/40 p-4 dark:border-gray-800 dark:bg-gray-850/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
                {backupCode ? (
                  <CloudUpload className="h-4 w-4 text-indigo-500" />
                ) : (
                  <CloudOff className="h-4 w-4 text-gray-400" />
                )}
                Progress Backup
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  backupCode
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                {backupCode ? 'On' : 'Off'}
              </span>
            </div>

            {!backupCode ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-sm text-xs leading-snug text-gray-500 dark:text-gray-400">
                  Your history lives in this browser only. A backup keeps a copy on the
                  server you can restore after clearing site data or switching machines.
                </p>
                <button
                  type="button"
                  onClick={startBackup}
                  className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-bold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70"
                >
                  <CloudUpload className="h-3.5 w-3.5" />
                  <span>Back up my progress</span>
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="select-all break-all rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                    {backupCode}
                  </code>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={stopBackup}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 transition hover:text-rose-600"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Stop and delete</span>
                  </button>
                </div>
              </div>
            )}

            {/* Available in both states: restoring onto a device that has lost its
                data is exactly the case where no code exists here yet. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label="Backup code to restore from"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Paste a backup code"
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 font-mono text-xs text-gray-700 placeholder:font-sans focus:border-indigo-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
              <button
                type="button"
                onClick={restore}
                disabled={restoring || !codeInput.trim()}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Download className="h-3.5 w-3.5 text-indigo-500" />
                <span>{restoring ? 'Restoring…' : 'Restore'}</span>
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-gray-400">
              Restoring replaces everything on this device and points it at that code.
            </p>

            {backupMessage && (
              <p role="status" className="mt-3 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                {backupMessage}
              </p>
            )}
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
