import { useSyncExternalStore } from 'react';
import { TypingSessionRecord, UserStats } from './types';

const STORAGE_KEY = 'typestory_user_stats_v1';
export const STATS_CHANGE_EVENT = 'typestory:stats-updated';

const DEFAULT_STATS: UserStats = {
  sessions: [],
  dailyStreak: {
    currentStreak: 0,
    bestStreak: 0,
    lastActiveDate: '',
  },
  totalWordsTyped: 0,
  totalTimeSpentSeconds: 0,
  bestWpm: 0,
  averageWpm: 0,
  averageAccuracy: 100,
};

export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getYesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function loadUserStats(): UserStats {
  if (typeof window === 'undefined') return DEFAULT_STATS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATS;
    const parsed = JSON.parse(raw) as UserStats;
    return {
      ...DEFAULT_STATS,
      ...parsed,
      dailyStreak: {
        ...DEFAULT_STATS.dailyStreak,
        ...(parsed.dailyStreak || {}),
      },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return DEFAULT_STATS;
  }
}

export function saveUserStats(stats: UserStats): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    window.dispatchEvent(new CustomEvent(STATS_CHANGE_EVENT, { detail: stats }));
  } catch {
    // Ignore storage quota errors
  }
}

export function recordCompletedSession(params: {
  title: string;
  sourceType: 'story' | 'vocab' | 'custom';
  wpm: number;
  accuracy: number;
  durationSeconds: number;
  wordsCount: number;
  keystrokes: number;
}): UserStats {
  const current = loadUserStats();
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();

  // Streak calculation
  let newCurrentStreak = current.dailyStreak.currentStreak;
  const lastActive = current.dailyStreak.lastActiveDate;

  if (!lastActive) {
    newCurrentStreak = 1;
  } else if (lastActive === today) {
    // Already practiced today, keep streak
    newCurrentStreak = Math.max(1, newCurrentStreak);
  } else if (lastActive === yesterday) {
    // Practiced yesterday, streak grows
    newCurrentStreak += 1;
  } else {
    // Broken streak
    newCurrentStreak = 1;
  }

  const newBestStreak = Math.max(current.dailyStreak.bestStreak, newCurrentStreak);

  const newSession: TypingSessionRecord = {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    dateStr: today,
    title: params.title,
    sourceType: params.sourceType,
    wpm: params.wpm,
    accuracy: params.accuracy,
    durationSeconds: params.durationSeconds,
    wordsCount: params.wordsCount,
    keystrokes: params.keystrokes,
  };

  const updatedSessions = [newSession, ...current.sessions].slice(0, 100);

  // Aggregates
  const totalWords = current.totalWordsTyped + params.wordsCount;
  const totalTime = current.totalTimeSpentSeconds + params.durationSeconds;
  const bestWpm = Math.max(current.bestWpm, params.wpm);

  // Rolling averages
  const totalAccSum = updatedSessions.reduce((acc, s) => acc + s.accuracy, 0);
  const totalWpmSum = updatedSessions.reduce((acc, s) => acc + s.wpm, 0);
  const averageAccuracy = Math.round(totalAccSum / updatedSessions.length);
  const averageWpm = Math.round(totalWpmSum / updatedSessions.length);

  const updatedStats: UserStats = {
    sessions: updatedSessions,
    dailyStreak: {
      currentStreak: newCurrentStreak,
      bestStreak: newBestStreak,
      lastActiveDate: today,
    },
    totalWordsTyped: totalWords,
    totalTimeSpentSeconds: totalTime,
    bestWpm,
    averageWpm,
    averageAccuracy,
  };

  saveUserStats(updatedStats);
  return updatedStats;
}

let memoryCache: UserStats = DEFAULT_STATS;
let isCacheInitialized = false;

function getStatsSnapshot(): UserStats {
  if (typeof window === 'undefined') return DEFAULT_STATS;
  if (!isCacheInitialized) {
    memoryCache = loadUserStats();
    isCacheInitialized = true;
  }
  return memoryCache;
}

export function clearUserStats(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    memoryCache = DEFAULT_STATS;
    window.dispatchEvent(new CustomEvent(STATS_CHANGE_EVENT, { detail: DEFAULT_STATS }));
  } catch {
    // Ignore
  }
}

export function useUserStats(): UserStats {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => {};
      const handler = () => {
        memoryCache = loadUserStats();
        onStoreChange();
      };
      window.addEventListener(STATS_CHANGE_EVENT, handler);
      window.addEventListener('storage', handler);
      return () => {
        window.removeEventListener(STATS_CHANGE_EVENT, handler);
        window.removeEventListener('storage', handler);
      };
    },
    getStatsSnapshot,
    () => DEFAULT_STATS
  );
}
