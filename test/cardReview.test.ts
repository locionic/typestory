import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import CardReview, {
  DifficultyScoreBadge,
  QuickReviewToggle,
  SpacedRepetitionScoring,
  getCefrDifficultyScore,
  getDifficultyTier,
  isHardCefrTier,
  prioritizeCardsForReview,
  filterHardCefrCards,
  calculateNextReviewInterval,
  RepetitionRating,
} from '../components/card-review';
import { VOCAB_BANKS } from '../data/vocab';
import { VocabItem } from '../lib/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Spaced-repetition difficulty scoring', () => {
  it('maps each CEFR tier to its correct numerical difficulty score', () => {
    expect(getCefrDifficultyScore('A1')).toBe(1);
    expect(getCefrDifficultyScore('A2')).toBe(2);
    expect(getCefrDifficultyScore('B1')).toBe(3);
    expect(getCefrDifficultyScore('B2')).toBe(4);
    expect(getCefrDifficultyScore('C1')).toBe(5);
    expect(getCefrDifficultyScore('C2')).toBe(5);
  });

  it('classifies CEFR levels into Easy, Medium, and Hard tiers', () => {
    expect(getDifficultyTier('A1')).toBe('Easy');
    expect(getDifficultyTier('A2')).toBe('Easy');
    expect(getDifficultyTier('B1')).toBe('Medium');
    expect(getDifficultyTier('B2')).toBe('Hard');
    expect(getDifficultyTier('C1')).toBe('Hard');
    expect(getDifficultyTier('C2')).toBe('Hard');
  });

  it('identifies harder CEFR tiers (B2, C1, C2)', () => {
    expect(isHardCefrTier('B2')).toBe(true);
    expect(isHardCefrTier('C1')).toBe(true);
    expect(isHardCefrTier('C2')).toBe(true);
    expect(isHardCefrTier('B1')).toBe(false);
    expect(isHardCefrTier('A2')).toBe(false);
    expect(isHardCefrTier('A1')).toBe(false);
  });

  it('calculates spaced repetition intervals based on rating', () => {
    expect(calculateNextReviewInterval('again', 5).intervalDays).toBe(1);
    expect(calculateNextReviewInterval('hard', 5).intervalDays).toBeGreaterThanOrEqual(5);
    expect(calculateNextReviewInterval('good', 5).intervalDays).toBeGreaterThanOrEqual(8);
    expect(calculateNextReviewInterval('easy', 5).intervalDays).toBeGreaterThanOrEqual(12);
  });
});

describe('Quick-review mode filtering and prioritization', () => {
  const mixedItems: VocabItem[] = [
    { word: 'basic-a1', definition: 'A1 word', level: 'A1' },
    { word: 'intermediate-b1', definition: 'B1 word', level: 'B1' },
    { word: 'advanced-c1', definition: 'C1 word', level: 'C1' },
    { word: 'elementary-a2', definition: 'A2 word', level: 'A2' },
    { word: 'hard-b2', definition: 'B2 word', level: 'B2' },
  ];

  it('leaves order unchanged when quick-review mode is disabled', () => {
    const result = prioritizeCardsForReview(mixedItems, 'B2', false);
    expect(result.map((item) => item.word)).toEqual([
      'basic-a1',
      'intermediate-b1',
      'advanced-c1',
      'elementary-a2',
      'hard-b2',
    ]);
  });

  it('cleanly prioritizes harder CEFR tier items (B2/C1) when quick-review is enabled', () => {
    const result = prioritizeCardsForReview(mixedItems, 'A1', true);
    // Hard items (C1 score 5, B2 score 4) must appear before B1 (score 3), A2 (score 2), A1 (score 1)
    const words = result.map((item) => item.word);
    const topTwo = words.slice(0, 2);
    expect(topTwo).toContain('advanced-c1');
    expect(topTwo).toContain('hard-b2');

    // B1 must appear before A2 and A1
    expect(words.indexOf('intermediate-b1')).toBeLessThan(words.indexOf('elementary-a2'));
    expect(words.indexOf('elementary-a2')).toBeLessThan(words.indexOf('basic-a1'));
  });

  it('filters strictly to hard CEFR items using filterHardCefrCards', () => {
    const hardOnly = filterHardCefrCards(mixedItems, 'A1');
    expect(hardOnly.map((i) => i.word)).toEqual(['advanced-c1', 'hard-b2']);
  });
});

describe('CardReview Component UI and Interactions', () => {
  const sampleBank = VOCAB_BANKS[0]; // Full-Stack B2
  const sampleItem = sampleBank.words[0];

  it('renders difficulty score badge with correct CEFR tier indicator', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(DifficultyScoreBadge, { level: 'B2' })));

    expect(host.textContent).toContain('Tier B2');
    expect(host.textContent).toContain('Hard');
    expect(host.textContent).toContain('(4/5)');
  });

  it('renders quick-review toggle with accessible aria-pressed state', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onToggle = vi.fn();

    act(() =>
      root.render(
        createElement(QuickReviewToggle, {
          isQuickReview: false,
          onToggle,
          hardItemCount: 5,
        }),
      ),
    );

    const button = host.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toContain('Quick Review');

    act(() => button.click());
    expect(onToggle).toHaveBeenCalledTimes(1);

    // When active
    act(() =>
      root.render(
        createElement(QuickReviewToggle, {
          isQuickReview: true,
          onToggle,
          hardItemCount: 5,
        }),
      ),
    );
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('B2/C1 Priority Active');
  });

  it('renders spaced-repetition difficulty scoring buttons and dispatches ratings', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    let selectedRating: RepetitionRating | undefined;
    const onRate = vi.fn((r: RepetitionRating) => {
      selectedRating = r;
    });

    act(() =>
      root.render(
        createElement(SpacedRepetitionScoring, {
          currentRating: selectedRating,
          onRate,
        }),
      ),
    );

    const buttons = [...host.querySelectorAll('button')];
    expect(buttons).toHaveLength(4);

    const hardBtn = buttons.find((b) => b.textContent?.includes('Hard'))!;
    expect(hardBtn).toBeDefined();

    act(() => hardBtn.click());
    expect(onRate).toHaveBeenCalledWith('hard');
  });

  it('integrates full CardReview container cleanly', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onToggle = vi.fn();
    const onRate = vi.fn();

    act(() =>
      root.render(
        createElement(CardReview, {
          bank: sampleBank,
          currentItem: sampleItem,
          currentWordIndex: 0,
          totalWords: sampleBank.words.length,
          isQuickReview: false,
          onToggleQuickReview: onToggle,
          onRate,
        }),
      ),
    );

    expect(host.textContent).toContain('Tier B2');
    expect(host.textContent).toContain('High Priority Item');
    expect(host.textContent).toContain('Quick Review');
    expect(host.textContent).toContain('Spaced Repetition:');
  });
});
