'use client';

import React from 'react';
import Link from 'next/link';
import { VOCAB_BANKS, VocabCategory } from '../data/vocab';
import { useRouter } from 'next/navigation';

interface VocabTabsProps {
  bank: VocabCategory;
}

/**
 * Tab component for vocabulary banks with CEFR level badges.
 *
 * Renders a tab for each vocabulary bank, showing the icon, title, and level.
 * Uses aria-pressed for accessibility.
 */
export default function VocabTabs({ bank }: VocabTabsProps) {
  const router = useRouter();

  return (
    <div className="mb-8 flex flex-wrap gap-2 justify-center">
      {VOCAB_BANKS.map((option) => {
        const isActive = bank.slug === option.slug;
        return (
          <button
            key={option.slug}
            type="button"
            onClick={() => router.replace(`/vocab?bank=${option.slug}`)}
            /* `aria-pressed`. The URL carries which bank is open — see `useLinkedBank` —
              * and this carries what a screen reader hears, which is the half that was
              * missing: the tab swapped `bg-indigo-600` for `bg-gray-200` and announced
              * itself as a plain button either way. Same fix as the category pills on the
              * story catalog, and `test/selectionState.test.ts` is what stops a third
              * one appearing. */
            aria-pressed={isActive}
            className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold transition shadow-sm ${
              isActive
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
            }`}
          >
            <span>{option.iconEmoji}</span>
            <span>{option.title}</span>
            {/* The level, on the tab, in the same place the story catalog puts it on a
              * card. It is a judgement about the words (see `VocabCategory.level`), so it
              * is printed where a learner chooses rather than inferred from the title —
              * "Core Foundation" is a bank name, not a difficulty claim. */}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                isActive
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {option.level}
            </span>
          </button>
        );
      })}
    </div>
  );
}