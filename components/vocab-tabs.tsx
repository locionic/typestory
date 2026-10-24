'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { VOCAB_BANKS, VocabCategory } from '../data/vocab';

export interface VocabTabsProps {
  bank?: VocabCategory;
  activeBank?: VocabCategory;
  currentBank?: VocabCategory;
  selectedSlug?: string;
  onSelect?: (slug: string) => void;
  onSelectBank?: (slug: string) => void;
}

export default function VocabTabs({
  bank,
  activeBank,
  currentBank,
  selectedSlug,
  onSelect,
  onSelectBank,
}: VocabTabsProps) {
  const router = useRouter();
  const selected = activeBank ?? currentBank ?? bank;
  const currentSlug = selected?.slug ?? selectedSlug ?? VOCAB_BANKS[0].slug;

  const handleSelect = (slug: string) => {
    if (onSelect) {
      onSelect(slug);
    } else if (onSelectBank) {
      onSelectBank(slug);
    } else {
      router.replace(`/vocab?bank=${slug}`);
    }
  };

  return (
    <div className="mb-8 flex flex-wrap gap-2 justify-center">
      {VOCAB_BANKS.map((option) => {
        const isActive = currentSlug === option.slug;
        return (
          <button
            key={option.slug}
            type="button"
            onClick={() => handleSelect(option.slug)}
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

export { VocabTabs };
