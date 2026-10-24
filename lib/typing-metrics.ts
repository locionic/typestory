/**
 * Typing drill metrics engine.
 *
 * Computes:
 * - Real-time Gross WPM and Net WPM based on the standard 5-character word definition.
 * - Character accuracy percentage with distinct weights for uncorrected vs corrected errors.
 * - Current streak bonus multiplier for consecutive error-free words.
 */

export const STANDARD_WORD_LENGTH = 5;
export const DEFAULT_MAX_WPM = 350;

export const DEFAULT_ERROR_WEIGHTS = {
  uncorrected: 1.0, // Full penalty for unresolved errors
  corrected: 0.5,   // Reduced penalty for errors that were noticed and fixed
} as const;

export interface WpmOptions {
  wordLength?: number;
  maxWpm?: number;
  precision?: number;
}

export interface AccuracyOptions {
  uncorrectedWeight?: number;
  correctedWeight?: number;
  precision?: number;
}

export interface StreakTier {
  minWords: number;
  multiplier: number;
}

export const DEFAULT_STREAK_TIERS: readonly StreakTier[] = [
  { minWords: 30, multiplier: 2.0 },  // 2.0x Max Bonus for legendary streaks
  { minWords: 20, multiplier: 1.75 }, // 1.75x
  { minWords: 10, multiplier: 1.5 },  // 1.5x
  { minWords: 5, multiplier: 1.25 },  // 1.25x
  { minWords: 0, multiplier: 1.0 },   // 1.0x Base
];

/**
 * Calculates Gross Words Per Minute (raw speed).
 * Formula: (totalCharactersTyped / wordLength) / (timeSeconds / 60)
 */
export function calculateGrossWpm(
  totalCharacters: number,
  timeSeconds: number,
  options: WpmOptions = {},
): number {
  if (timeSeconds <= 0 || totalCharacters <= 0) return 0;

  const wordLength = options.wordLength ?? STANDARD_WORD_LENGTH;
  const maxWpm = options.maxWpm ?? DEFAULT_MAX_WPM;
  const timeMinutes = timeSeconds / 60;
  const rawWords = totalCharacters / wordLength;
  const rawWpm = rawWords / timeMinutes;

  const boundedWpm = Math.min(maxWpm, Math.max(0, rawWpm));

  if (typeof options.precision === 'number') {
    const factor = Math.pow(10, options.precision);
    return Math.round(boundedWpm * factor) / factor;
  }

  return Math.round(boundedWpm);
}

/**
 * Calculates Net Words Per Minute (accuracy-adjusted speed).
 * Formula: ((totalCharactersTyped / wordLength) - uncorrectedErrors) / (timeSeconds / 60)
 * Net WPM cannot be negative.
 */
export function calculateNetWpm(
  totalCharacters: number,
  uncorrectedErrors: number,
  timeSeconds: number,
  options: WpmOptions = {},
): number {
  if (timeSeconds <= 0 || totalCharacters <= 0) return 0;

  const wordLength = options.wordLength ?? STANDARD_WORD_LENGTH;
  const maxWpm = options.maxWpm ?? DEFAULT_MAX_WPM;
  const timeMinutes = timeSeconds / 60;
  const grossWords = totalCharacters / wordLength;
  const netWords = Math.max(0, grossWords - Math.max(0, uncorrectedErrors));
  const rawNetWpm = netWords / timeMinutes;

  const boundedWpm = Math.min(maxWpm, Math.max(0, rawNetWpm));

  if (typeof options.precision === 'number') {
    const factor = Math.pow(10, options.precision);
    return Math.round(boundedWpm * factor) / factor;
  }

  return Math.round(boundedWpm);
}

/**
 * Calculates Character Accuracy Percentage with uncorrected vs corrected error penalties.
 * Corrected errors incur a lighter penalty than uncorrected errors that remain in the text.
 */
export function calculateCharacterAccuracy(
  totalCharacters: number,
  uncorrectedErrors: number,
  correctedErrors = 0,
  options: AccuracyOptions = {},
): number {
  if (totalCharacters <= 0) return 100;

  const uncorrectedWeight = options.uncorrectedWeight ?? DEFAULT_ERROR_WEIGHTS.uncorrected;
  const correctedWeight = options.correctedWeight ?? DEFAULT_ERROR_WEIGHTS.corrected;

  const safeUncorrected = Math.max(0, uncorrectedErrors);
  const safeCorrected = Math.max(0, correctedErrors);

  const totalPenalty = (safeUncorrected * uncorrectedWeight) + (safeCorrected * correctedWeight);
  const effectiveCorrect = Math.max(0, totalCharacters - totalPenalty);
  const rawPercentage = (effectiveCorrect / totalCharacters) * 100;

  const boundedPercentage = Math.min(100, Math.max(0, rawPercentage));

  const precision = options.precision ?? 1;
  const factor = Math.pow(10, precision);
  return Math.round(boundedPercentage * factor) / factor;
}

/**
 * Calculates the current streak bonus multiplier based on consecutive error-free words.
 */
export function calculateStreakMultiplier(
  consecutiveErrorFreeWords: number,
  tiers: readonly StreakTier[] = DEFAULT_STREAK_TIERS,
): number {
  if (consecutiveErrorFreeWords <= 0) return 1.0;

  // Find the highest threshold met
  for (const tier of tiers) {
    if (consecutiveErrorFreeWords >= tier.minWords) {
      return tier.multiplier;
    }
  }

  return 1.0;
}

/**
 * Stateful streak tracker for tracking consecutive clean words and bonus multipliers during a drill.
 */
export class StreakTracker {
  private currentStreak = 0;
  private bestStreak = 0;
  private tiers: readonly StreakTier[];

  constructor(initialStreak = 0, tiers: readonly StreakTier[] = DEFAULT_STREAK_TIERS) {
    this.currentStreak = Math.max(0, initialStreak);
    this.bestStreak = this.currentStreak;
    this.tiers = tiers;
  }

  get streak(): number {
    return this.currentStreak;
  }

  get highestStreak(): number {
    return this.bestStreak;
  }

  get multiplier(): number {
    return calculateStreakMultiplier(this.currentStreak, this.tiers);
  }

  /**
   * Records a completed word.
   * If error-free, increments streak; if flawed, resets current streak back to 0.
   */
  recordWord(isErrorFree: boolean): {
    streak: number;
    multiplier: number;
    bestStreak: number;
    isBonusActive: boolean;
  } {
    if (isErrorFree) {
      this.currentStreak += 1;
      if (this.currentStreak > this.bestStreak) {
        this.bestStreak = this.currentStreak;
      }
    } else {
      this.currentStreak = 0;
    }

    const mult = this.multiplier;
    return {
      streak: this.currentStreak,
      multiplier: mult,
      bestStreak: this.bestStreak,
      isBonusActive: mult > 1.0,
    };
  }

  reset(): void {
    this.currentStreak = 0;
  }
}

export interface TypingMetricsInput {
  totalCharacters: number;
  timeSeconds: number;
  uncorrectedErrors: number;
  correctedErrors?: number;
  consecutiveErrorFreeWords?: number;
  wordLength?: number;
  maxWpm?: number;
  uncorrectedWeight?: number;
  correctedWeight?: number;
}

export interface TypingMetricsResult {
  grossWpm: number;
  netWpm: number;
  accuracy: number;
  consecutiveErrorFreeWords: number;
  streakMultiplier: number;
  totalCharacters: number;
  uncorrectedErrors: number;
  correctedErrors: number;
  timeSeconds: number;
  isBonusActive: boolean;
}

/**
 * Computes a complete typing drill metrics snapshot.
 */
export function computeTypingMetrics(input: TypingMetricsInput): TypingMetricsResult {
  const correctedErrors = input.correctedErrors ?? 0;
  const consecutiveWords = input.consecutiveErrorFreeWords ?? 0;

  const grossWpm = calculateGrossWpm(input.totalCharacters, input.timeSeconds, {
    wordLength: input.wordLength,
    maxWpm: input.maxWpm,
  });

  const netWpm = calculateNetWpm(input.totalCharacters, input.uncorrectedErrors, input.timeSeconds, {
    wordLength: input.wordLength,
    maxWpm: input.maxWpm,
  });

  const accuracy = calculateCharacterAccuracy(
    input.totalCharacters,
    input.uncorrectedErrors,
    correctedErrors,
    {
      uncorrectedWeight: input.uncorrectedWeight,
      correctedWeight: input.correctedWeight,
    },
  );

  const streakMultiplier = calculateStreakMultiplier(consecutiveWords);

  return {
    grossWpm,
    netWpm,
    accuracy,
    consecutiveErrorFreeWords: consecutiveWords,
    streakMultiplier,
    totalCharacters: input.totalCharacters,
    uncorrectedErrors: input.uncorrectedErrors,
    correctedErrors,
    timeSeconds: input.timeSeconds,
    isBonusActive: streakMultiplier > 1.0,
  };
}

/**
 * Metrics engine class managing live drill progress, backspaces, and word evaluations.
 */
export class TypingMetricsEngine {
  private streakTracker: StreakTracker;
  private totalCharacters = 0;
  private uncorrectedErrors = 0;
  private correctedErrors = 0;
  private startTime: number | null = null;
  private endTime: number | null = null;

  constructor() {
    this.streakTracker = new StreakTracker();
  }

  start(timestamp = Date.now()): void {
    this.startTime = timestamp;
    this.endTime = null;
  }

  stop(timestamp = Date.now()): void {
    if (this.startTime && !this.endTime) {
      this.endTime = timestamp;
    }
  }

  recordKeystroke(totalChars: number, uncorrectedErrors: number, correctedErrors?: number): void {
    this.totalCharacters = totalChars;
    this.uncorrectedErrors = uncorrectedErrors;
    if (typeof correctedErrors === 'number') {
      this.correctedErrors = correctedErrors;
    }
  }

  recordCorrectedError(): void {
    this.correctedErrors += 1;
  }

  completeWord(isErrorFree: boolean): number {
    const outcome = this.streakTracker.recordWord(isErrorFree);
    return outcome.multiplier;
  }

  getSnapshot(currentTime = Date.now()): TypingMetricsResult {
    let elapsedSeconds = 0;
    if (this.startTime) {
      const finish = this.endTime ?? currentTime;
      elapsedSeconds = Math.max(1, Math.round((finish - this.startTime) / 1000));
    }

    return computeTypingMetrics({
      totalCharacters: this.totalCharacters,
      timeSeconds: elapsedSeconds,
      uncorrectedErrors: this.uncorrectedErrors,
      correctedErrors: this.correctedErrors,
      consecutiveErrorFreeWords: this.streakTracker.streak,
    });
  }

  reset(): void {
    this.totalCharacters = 0;
    this.uncorrectedErrors = 0;
    this.correctedErrors = 0;
    this.startTime = null;
    this.endTime = null;
    this.streakTracker.reset();
  }
}
