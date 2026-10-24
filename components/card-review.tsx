'use client';

import React from 'react';
import { CefrLevel, VocabItem } from '../lib/types';
import { VocabCategory } from '../data/vocab';

export type CefrDifficultyTier = 'Easy' | 'Medium' | 'Hard';
export type RepetitionRating = 'again' | 'hard' | 'good' | 'easy';

/**
 * Spaced-repetition difficulty scoring for CEFR levels:
 * - A1 / A2: Easy (Score 1-2)
 * - B1: Medium (Score 3)
 * - B2 / C1 / C2: Hard (Score 4-5)
 */
export function getCefrDifficultyScore(level: CefrLevel): number {
  switch (level) {
    case 'A1':
      return 1;
    case 'A2':
      return 2;
    case 'B1':
      return 3;
    case 'B2':
      return 4;
    case 'C1':
    case 'C2':
      return 5;
    default:
      return 3;
  }
}

export function getDifficultyTier(level: CefrLevel): CefrDifficultyTier {
  const score = getCefrDifficultyScore(level);
  if (score <= 2) return 'Easy';
  if (score === 3) return 'Medium';
  return 'Hard';
}

export function isHardCefrTier(level: CefrLevel): boolean {
  return level === 'B2' || level === 'C1' || level === 'C2';
}

export function getEffectiveItemLevel(item: VocabItem, defaultLevel: CefrLevel = 'B2'): CefrLevel {
  return item.level ?? defaultLevel;
}

export function getEffectiveItemScore(item: VocabItem, defaultLevel: CefrLevel = 'B2'): number {
  if (typeof item.difficultyScore === 'number') {
    return item.difficultyScore;
  }
  return getCefrDifficultyScore(getEffectiveItemLevel(item, defaultLevel));
}

/**
 * Spaced-repetition interval calculation for review scheduling.
 */
export function calculateNextReviewInterval(
  rating: RepetitionRating,
  currentIntervalDays = 1,
): { intervalDays: number; easeDelta: number } {
  switch (rating) {
    case 'again':
      return { intervalDays: 1, easeDelta: -0.2 };
    case 'hard':
      return { intervalDays: Math.max(1, Math.round(currentIntervalDays * 1.2)), easeDelta: -0.15 };
    case 'good':
      return { intervalDays: Math.max(2, Math.round(currentIntervalDays * 1.8)), easeDelta: 0 };
    case 'easy':
      return { intervalDays: Math.max(4, Math.round(currentIntervalDays * 2.5)), easeDelta: 0.15 };
  }
}

/**
 * Filters or prioritizes cards for review.
 * When quickReview is enabled:
 * Cleanly prioritizes harder CEFR tier items (B2/C1) before easier items.
 */
export function prioritizeCardsForReview<T extends { word: string; level?: CefrLevel; difficultyScore?: number }>(
  items: T[],
  bankLevel: CefrLevel = 'B2',
  quickReview = false,
): T[] {
  if (!quickReview) {
    return [...items];
  }

  return [...items].sort((a, b) => {
    const scoreA = getEffectiveItemScore(a, bankLevel);
    const scoreB = getEffectiveItemScore(b, bankLevel);
    // Harder items (higher difficulty score, B2/C1/C2) come first
    return scoreB - scoreA;
  });
}

/**
 * Filters cards to strictly hard tier (B2/C1/C2) items.
 */
export function filterHardCefrCards<T extends { level?: CefrLevel }>(
  items: T[],
  bankLevel: CefrLevel = 'B2',
): T[] {
  return items.filter((item) => isHardCefrTier(item.level ?? bankLevel));
}

interface DifficultyBadgeProps {
  level: CefrLevel;
  score?: number;
}

export function DifficultyScoreBadge({ level, score }: DifficultyBadgeProps) {
  const tier = getDifficultyTier(level);
  const difficultyScore = score ?? getCefrDifficultyScore(level);

  const tierColors = {
    Easy: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    Medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    Hard: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  }[tier];

  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${tierColors}`}
        data-testid="difficulty-tier-badge"
      >
        <span>Tier {level}</span>
        <span>•</span>
        <span>{tier}</span>
        <span className="font-mono">({difficultyScore}/5)</span>
      </span>
    </div>
  );
}

interface QuickReviewToggleProps {
  isQuickReview: boolean;
  onToggle: () => void;
  hardItemCount?: number;
}

export function QuickReviewToggle({ isQuickReview, onToggle, hardItemCount }: QuickReviewToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isQuickReview}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition shadow-sm ${
        isQuickReview
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
      }`}
    >
      <span>⚡ Quick Review</span>
      <span
        className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
          isQuickReview
            ? 'bg-indigo-500 text-white'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
        }`}
      >
        {isQuickReview ? 'B2/C1 Priority Active' : 'Prioritize B2/C1'}
      </span>
      {typeof hardItemCount === 'number' && (
        <span className="text-[10px] opacity-80">({hardItemCount} items)</span>
      )}
    </button>
  );
}

interface SpacedRepetitionScoringProps {
  currentRating?: RepetitionRating;
  onRate: (rating: RepetitionRating) => void;
}

export function SpacedRepetitionScoring({ currentRating, onRate }: SpacedRepetitionScoringProps) {
  const ratingOptions: { key: RepetitionRating; label: string; sublabel: string; color: string }[] = [
    { key: 'again', label: 'Rate: Again', sublabel: 'Score 5 (Hardest)', color: 'rose' },
    { key: 'hard', label: 'Rate: Hard', sublabel: 'Score 4 (Difficult)', color: 'amber' },
    { key: 'good', label: 'Rate: Good', sublabel: 'Score 3 (Moderate)', color: 'indigo' },
    { key: 'easy', label: 'Rate: Easy', sublabel: 'Score 1 (Familiar)', color: 'emerald' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mr-1">
        Spaced Repetition:
      </span>
      {ratingOptions.map((opt) => {
        const isSelected = currentRating === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onRate(opt.key)}
            aria-pressed={isSelected}
            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
              isSelected
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
            }`}
          >
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface CardReviewProps {
  bank: VocabCategory;
  currentItem: VocabItem;
  currentWordIndex: number;
  totalWords: number;
  isQuickReview: boolean;
  onToggleQuickReview: () => void;
  currentRating?: RepetitionRating;
  onRate: (rating: RepetitionRating) => void;
}

export default function CardReview({
  bank,
  currentItem,
  currentWordIndex,
  totalWords,
  isQuickReview,
  onToggleQuickReview,
  currentRating,
  onRate,
}: CardReviewProps) {
  const itemLevel = getEffectiveItemLevel(currentItem, bank.level);
  const itemScore = getEffectiveItemScore(currentItem, bank.level);

  return (
    <div className="flex flex-col gap-3">
      {/* Review controls header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          <DifficultyScoreBadge level={itemLevel} score={itemScore} />
          {isHardCefrTier(itemLevel) && (
            <span className="rounded bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              High Priority Item
            </span>
          )}
        </div>
        <QuickReviewToggle isQuickReview={isQuickReview} onToggle={onToggleQuickReview} />
      </div>

      {/* Spaced repetition difficulty feedback buttons */}
      <div className="pt-1">
        <SpacedRepetitionScoring currentRating={currentRating} onRate={onRate} />
      </div>
    </div>
  );
}

export { CardReview };
