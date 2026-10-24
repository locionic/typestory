import { describe, expect, it } from 'vitest';
import {
  STANDARD_WORD_LENGTH,
  calculateGrossWpm,
  calculateNetWpm,
  calculateCharacterAccuracy,
  calculateStreakMultiplier,
  StreakTracker,
  computeTypingMetrics,
  TypingMetricsEngine,
  DEFAULT_ERROR_WEIGHTS,
} from '../lib/typing-metrics';

describe('Real-time Words Per Minute (WPM) calculations', () => {
  it('uses standard 5-character word length definition', () => {
    expect(STANDARD_WORD_LENGTH).toBe(5);
  });

  it('calculates gross WPM correctly based on characters typed and elapsed seconds', () => {
    // 300 characters in 60 seconds = 60 words in 1 min = 60 WPM
    expect(calculateGrossWpm(300, 60)).toBe(60);

    // 150 characters in 30 seconds = 30 words in 0.5 min = 60 WPM
    expect(calculateGrossWpm(150, 30)).toBe(60);

    // 250 characters in 60 seconds = 50 words in 1 min = 50 WPM
    expect(calculateGrossWpm(250, 60)).toBe(50);
  });

  it('calculates net WPM deducting uncorrected error penalty', () => {
    // 300 characters in 60 seconds = 60 gross words.
    // 5 uncorrected errors: Net words = 60 - 5 = 55 words in 1 min = 55 WPM
    expect(calculateNetWpm(300, 5, 60)).toBe(55);

    // 300 characters in 60 seconds with 0 errors = 60 WPM
    expect(calculateNetWpm(300, 0, 60)).toBe(60);
  });

  it('ensures net WPM never drops below 0 even when errors exceed word count', () => {
    // 50 characters in 60 seconds = 10 words, but 20 uncorrected errors
    expect(calculateNetWpm(50, 20, 60)).toBe(0);
  });

  it('handles zero or negative duration gracefully by returning 0', () => {
    expect(calculateGrossWpm(100, 0)).toBe(0);
    expect(calculateGrossWpm(100, -5)).toBe(0);
    expect(calculateNetWpm(100, 2, 0)).toBe(0);
    expect(calculateNetWpm(100, 2, -10)).toBe(0);
  });

  it('handles zero characters typed by returning 0 WPM', () => {
    expect(calculateGrossWpm(0, 30)).toBe(0);
    expect(calculateNetWpm(0, 0, 30)).toBe(0);
  });

  it('respects max WPM ceiling for anomalous times', () => {
    // 1000 characters in 1 second
    expect(calculateGrossWpm(1000, 1)).toBe(350);
    expect(calculateNetWpm(1000, 0, 1)).toBe(350);
  });

  it('supports custom decimal precision', () => {
    // 123 characters in 45 seconds:
    // (123 / 5) / (45 / 60) = 24.6 / 0.75 = 32.8 WPM
    expect(calculateGrossWpm(123, 45, { precision: 2 })).toBe(32.8);
    expect(calculateNetWpm(123, 1, 45, { precision: 2 })).toBe(31.47);
  });
});

describe('Character accuracy with uncorrected vs corrected error penalties', () => {
  it('returns 100% when no characters have been typed yet', () => {
    expect(calculateCharacterAccuracy(0, 0, 0)).toBe(100);
  });

  it('returns 100% when all characters are typed correctly with 0 errors', () => {
    expect(calculateCharacterAccuracy(200, 0, 0)).toBe(100);
  });

  it('applies full penalty (1.0) to uncorrected errors', () => {
    // 100 characters, 5 uncorrected errors, 0 corrected:
    // Penalty = 5 * 1.0 = 5. Accuracy = (95 / 100) * 100 = 95%
    expect(calculateCharacterAccuracy(100, 5, 0)).toBe(95);
  });

  it('applies half penalty (0.5) to corrected errors', () => {
    // 100 characters, 0 uncorrected errors, 6 corrected errors:
    // Penalty = 6 * 0.5 = 3. Accuracy = (97 / 100) * 100 = 97%
    expect(calculateCharacterAccuracy(100, 0, 6)).toBe(97);
  });

  it('differentiates penalization between corrected and uncorrected errors', () => {
    const uncorrectedResult = calculateCharacterAccuracy(100, 10, 0); // 10 uncorrected
    const correctedResult = calculateCharacterAccuracy(100, 0, 10);   // 10 corrected

    // Correcting mistakes yields higher accuracy than leaving them unresolved
    expect(correctedResult).toBe(95);
    expect(uncorrectedResult).toBe(90);
    expect(correctedResult).toBeGreaterThan(uncorrectedResult);
  });

  it('combines both uncorrected and corrected penalties accurately', () => {
    // 200 characters, 4 uncorrected (4 * 1 = 4), 6 corrected (6 * 0.5 = 3)
    // Total penalty = 7. Correct = 193. Accuracy = (193 / 200) * 100 = 96.5%
    expect(calculateCharacterAccuracy(200, 4, 6)).toBe(96.5);
  });

  it('allows custom penalty weights', () => {
    // Uncorrected weight 2.0, corrected weight 0.25
    // 100 characters, 2 uncorrected (4), 4 corrected (1) -> penalty = 5 -> 95%
    expect(
      calculateCharacterAccuracy(100, 2, 4, {
        uncorrectedWeight: 2.0,
        correctedWeight: 0.25,
      }),
    ).toBe(95);
  });

  it('clamps accuracy between 0% and 100%', () => {
    expect(calculateCharacterAccuracy(50, 100, 50)).toBe(0);
    expect(calculateCharacterAccuracy(100, -5, -2)).toBe(100);
  });
});

describe('Streak bonus multiplier tracking for consecutive error-free words', () => {
  it('provides base 1.0x multiplier for streaks below 5 words', () => {
    expect(calculateStreakMultiplier(0)).toBe(1.0);
    expect(calculateStreakMultiplier(1)).toBe(1.0);
    expect(calculateStreakMultiplier(4)).toBe(1.0);
  });

  it('increases multiplier at progression tiers (5, 10, 20, 30 words)', () => {
    expect(calculateStreakMultiplier(5)).toBe(1.25);
    expect(calculateStreakMultiplier(9)).toBe(1.25);
    expect(calculateStreakMultiplier(10)).toBe(1.5);
    expect(calculateStreakMultiplier(19)).toBe(1.5);
    expect(calculateStreakMultiplier(20)).toBe(1.75);
    expect(calculateStreakMultiplier(29)).toBe(1.75);
    expect(calculateStreakMultiplier(30)).toBe(2.0);
    expect(calculateStreakMultiplier(100)).toBe(2.0);
  });

  it('tracks streak state and handles word completions via StreakTracker', () => {
    const tracker = new StreakTracker();
    expect(tracker.streak).toBe(0);
    expect(tracker.multiplier).toBe(1.0);

    // Complete 4 clean words
    for (let i = 0; i < 4; i += 1) {
      const res = tracker.recordWord(true);
      expect(res.streak).toBe(i + 1);
      expect(res.multiplier).toBe(1.0);
      expect(res.isBonusActive).toBe(false);
    }

    // 5th clean word triggers 1.25x bonus
    const fifth = tracker.recordWord(true);
    expect(fifth.streak).toBe(5);
    expect(fifth.multiplier).toBe(1.25);
    expect(fifth.isBonusActive).toBe(true);
    expect(tracker.highestStreak).toBe(5);

    // Error on 6th word resets streak and multiplier
    const errorWord = tracker.recordWord(false);
    expect(errorWord.streak).toBe(0);
    expect(errorWord.multiplier).toBe(1.0);
    expect(errorWord.isBonusActive).toBe(false);
    // Highest streak is retained
    expect(tracker.highestStreak).toBe(5);
  });

  it('resets streak tracker cleanly', () => {
    const tracker = new StreakTracker(15);
    expect(tracker.streak).toBe(15);
    expect(tracker.multiplier).toBe(1.5);

    tracker.reset();
    expect(tracker.streak).toBe(0);
    expect(tracker.multiplier).toBe(1.0);
  });
});

describe('Unified TypingMetricsEngine and snapshot computation', () => {
  it('computes complete metrics snapshot from raw inputs', () => {
    const metrics = computeTypingMetrics({
      totalCharacters: 300,
      timeSeconds: 60,
      uncorrectedErrors: 2,
      correctedErrors: 4,
      consecutiveErrorFreeWords: 12,
    });

    expect(metrics.grossWpm).toBe(60);
    expect(metrics.netWpm).toBe(58);
    // 300 chars, penalty: 2*1 + 4*0.5 = 4 -> 296/300 * 100 = 98.7%
    expect(metrics.accuracy).toBe(98.7);
    expect(metrics.consecutiveErrorFreeWords).toBe(12);
    expect(metrics.streakMultiplier).toBe(1.5);
    expect(metrics.isBonusActive).toBe(true);
  });

  it('drives real-time session updates via TypingMetricsEngine', () => {
    const engine = new TypingMetricsEngine();
    const startTime = 1000000;
    engine.start(startTime);

    engine.recordKeystroke(150, 1, 2);
    engine.recordCorrectedError();

    // 3 clean words
    engine.completeWord(true);
    engine.completeWord(true);
    const mult = engine.completeWord(true);
    expect(mult).toBe(1.0);

    const snapshot = engine.getSnapshot(startTime + 30000); // 30 seconds later
    expect(snapshot.grossWpm).toBe(60);
    expect(snapshot.timeSeconds).toBe(30);
    expect(snapshot.uncorrectedErrors).toBe(1);
    expect(snapshot.correctedErrors).toBe(3); // 2 + 1
    expect(snapshot.consecutiveErrorFreeWords).toBe(3);

    engine.reset();
    const resetSnapshot = engine.getSnapshot();
    expect(resetSnapshot.totalCharacters).toBe(0);
    expect(resetSnapshot.streakMultiplier).toBe(1.0);
  });
});
