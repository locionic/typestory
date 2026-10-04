import type { ValidationIssue } from './progress-schema';
import type { CefrLevel } from './types';

/**
 * CEFR A1–B1 placement test.
 *
 * The split is deliberate: the multiple-choice half is scored in code, so it is
 * reproducible and auditable, and only the free-writing half goes to a model,
 * where nothing but a judgement can do the work. The final level is the *narrower*
 * of the two — a learner who aces the quiz but writes at A1 is placed at A1.
 */

/** The posting scopes placement to A1–B1; CefrLevel in lib/types.ts is the wider CEFR set. */
export const PLACEMENT_LEVELS = ['A1', 'A2', 'B1'] as const;
export type PlacementLevel = (typeof PLACEMENT_LEVELS)[number];

/**
 * Share of a level's questions that must be right to hold that level. With four
 * questions per level this is a clean 3-of-4.
 *
 * Four questions a level means the only reachable rates are 0, ¼, ½, ¾ and 1, so
 * 0.6 is never an exact rate and every threshold in (½, ¾] behaves identically. That also
 * makes `cascade`'s `rate < PASS_RATE` indistinguishable from `rate <= PASS_RATE` — checked
 * by canary on 2026-10-04: swapping it for `<=` left all 651 tests green.
 *
 * So the comparison is right by luck rather than by care, and adding a fifth question to any
 * level puts 0.6 back in reach, at which point `<` and `<=` differ and the suite will not
 * notice. `test/placement.test.ts:81` scores 3-of-4 and 2-of-4 against `PASS_RATE` itself,
 * which is the test to extend with an exact-threshold case when that day comes.
 */
export const PASS_RATE = 0.6;

/** Trust boundary: a submission is untrusted input. */
export const MAX_WRITING_CHARS = 2000;

/**
 * The two string caps, interpolated straight into the system prompt.
 *
 * Same reasoning as lib/writing.ts: structured outputs support neither array nor string
 * constraints, so the schema cannot carry a ceiling and the prompt is the only channel
 * left. `parseWritingGrade` clips over-long output to these three and keeps the grade —
 * so a learner is told their band even when one span runs long — and writing the numbers
 * into the prompt is what keeps the number the model is given and the number the
 * validator enforces from drifting apart. MAX_CORRECTIONS is the exception: the prompt
 * states that count by hand, at five, while the cap below is eight. The gap is the point
 * — a model that answers with six or seven corrections lands inside it rather than having
 * one dropped, and `test/placement.test.ts` holds the two numbers in that relationship.
 */
export const MAX_RATIONALE_LENGTH = 400;
export const MAX_CORRECTION_LENGTH = 240;
export const MAX_CORRECTIONS = 8;

export interface PlacementQuestion {
  id: string;
  level: PlacementLevel;
  skill: string;
  prompt: string;
  options: string[];
  /** Never leaves the server. Strip it with publicQuestions() before responding to a client. */
  correct: number;
}

export const PLACEMENT_QUESTIONS: PlacementQuestion[] = [
  {
    id: 'a1-third-person',
    level: 'A1',
    skill: 'grammar',
    prompt: 'My sister ___ to the office every weekday.',
    options: ['go', 'goes', 'is going', 'gone'],
    correct: 1,
  },
  {
    id: 'a1-possessive',
    level: 'A1',
    skill: 'grammar',
    prompt: 'This is ___ umbrella, and that one is ___ too.',
    options: ['my / my', 'me / me', 'I / I', 'mine / mine'],
    correct: 0,
  },
  {
    id: 'a1-quantifier',
    level: 'A1',
    skill: 'vocabulary',
    prompt: 'There is not ___ milk left in the fridge.',
    options: ['some', 'a', 'any', 'many'],
    correct: 2,
  },
  {
    id: 'a1-past-simple',
    level: 'A1',
    skill: 'grammar',
    prompt: 'Last weekend we ___ to Da Nang by train.',
    options: ['go', 'gone', 'went', 'are going'],
    correct: 2,
  },
  {
    id: 'a2-first-conditional',
    level: 'A2',
    skill: 'grammar',
    prompt: 'If it ___ tomorrow, we will stay at home.',
    options: ['will rain', 'is raining', 'rains', 'rained'],
    correct: 2,
  },
  {
    id: 'a2-present-perfect',
    level: 'A2',
    skill: 'grammar',
    prompt: 'I ___ in this city since 2019.',
    options: ['live', 'lived', 'have lived', 'am living'],
    correct: 2,
  },
  {
    id: 'a2-comparative',
    level: 'A2',
    skill: 'grammar',
    prompt: 'The second film was ___ than the first one.',
    options: ['more interesting', 'interestinger', 'most interesting', 'the most interesting'],
    correct: 0,
  },
  {
    id: 'a2-used-to',
    level: 'A2',
    skill: 'grammar',
    prompt: 'I ___ my phone every day, but now I carry a smartwatch.',
    options: ['use to lose', 'used to lose', 'used to losing', 'was used to lose'],
    correct: 1,
  },
  {
    id: 'b1-past-perfect',
    level: 'B1',
    skill: 'grammar',
    prompt: 'By the time we arrived, the film ___ already ___.',
    options: ['has / started', 'was / starting', 'had / started', 'would / start'],
    correct: 2,
  },
  {
    id: 'b1-inversion',
    level: 'B1',
    skill: 'grammar',
    prompt: 'Not until he apologised ___ his mistake.',
    options: ['he admitted', 'did he admit', 'he did admit', 'he has admitted'],
    correct: 2,
  },
  {
    id: 'b1-third-conditional',
    level: 'B1',
    skill: 'grammar',
    prompt: 'If she ___ for the scholarship, she would have taken the course.',
    options: ['applied', 'has applied', 'would apply', 'had applied'],
    correct: 3,
  },
  {
    id: 'b1-past-simple-past-perfect',
    level: 'B1',
    skill: 'grammar',
    prompt: 'He is soaked because he ___ in the rain.',
    options: ['was caught', 'has been caught', 'had been caught', 'would be caught'],
    correct: 0,
  },
];

export type PublicQuestion = Omit<PlacementQuestion, 'correct'>;

/**
 * The bank minus the answer key. This is what GET /api/placement serves.
 *
 * A whitelist rather than a strip: adding a field to PlacementQuestion later
 * cannot leak it, because only these five are ever copied.
 */
export function publicQuestions(): PublicQuestion[] {
  return PLACEMENT_QUESTIONS.map(({ id, level, skill, prompt, options }) => ({
    id,
    level,
    skill,
    prompt,
    options,
  }));
}

export const WRITING_TASK = {
  prompt:
    'Write 60–120 words about a place you enjoy visiting. Describe what it is like and say why you like going there.',
};

export interface LevelBreakdown {
  correct: number;
  total: number;
  rate: number;
}

export interface ObjectiveScore {
  correct: number;
  total: number;
  byLevel: Record<PlacementLevel, LevelBreakdown>;
  level: PlacementLevel;
}

export interface WritingGrade {
  band: PlacementLevel;
  rationale: string;
  corrections: string[];
}

export interface Placement {
  level: CefrLevel;
  /** True when the writing band pulled the result below what the quiz alone earned. */
  cappedByWriting: boolean;
  objective: ObjectiveScore;
  writing: WritingGrade | null;
}

/**
 * Highest level passed, but only when every level below it was passed too.
 * A learner who scores 3/4 on B1 and 0/4 on A1 is not a B1.
 */
function cascade(byLevel: Record<PlacementLevel, LevelBreakdown>): PlacementLevel {
  let level: PlacementLevel = PLACEMENT_LEVELS[0];
  for (const candidate of PLACEMENT_LEVELS) {
    if (byLevel[candidate].rate < PASS_RATE) break;
    level = candidate;
  }
  return level;
}

export function scoreObjective(answers: number[]): ObjectiveScore {
  const byLevel = Object.fromEntries(
    PLACEMENT_LEVELS.map((level) => [level, { correct: 0, total: 0, rate: 0 }]),
  ) as Record<PlacementLevel, LevelBreakdown>;

  let correct = 0;
  PLACEMENT_QUESTIONS.forEach((question, index) => {
    const bucket = byLevel[question.level];
    bucket.total += 1;
    if (answers[index] === question.correct) {
      bucket.correct += 1;
      correct += 1;
    }
  });

  for (const level of PLACEMENT_LEVELS) {
    const bucket = byLevel[level];
    bucket.rate = bucket.total === 0 ? 0 : bucket.correct / bucket.total;
  }

  return { correct, total: PLACEMENT_QUESTIONS.length, byLevel, level: cascade(byLevel) };
}

export function decideLevel(objective: ObjectiveScore, writing: WritingGrade | null): Placement {
  if (!writing) {
    return { level: objective.level, cappedByWriting: false, objective, writing: null };
  }
  const quizRank = PLACEMENT_LEVELS.indexOf(objective.level);
  const writingRank = PLACEMENT_LEVELS.indexOf(writing.band);
  const capped = writingRank < quizRank;
  return {
    level: capped ? writing.band : objective.level,
    cappedByWriting: capped,
    objective,
    writing,
  };
}

export const WRITING_GRADE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    band: { type: 'string', enum: [...PLACEMENT_LEVELS] },
    rationale: { type: 'string' },
    corrections: { type: 'array', items: { type: 'string' } },
  },
  required: ['band', 'rationale', 'corrections'],
  additionalProperties: false,
};

export const WRITING_SYSTEM_PROMPT = `You assess short English writing for a CEFR placement test and return one JSON object.

Choose exactly one band: A1, A2 or B1.
- A1: short simple sentences, present and past basics, frequent errors that block meaning.
- A2: connected simple and compound sentences, past and future forms, routine errors only.
- B1: varied vocabulary, conditionals and a clear structure, with only minor slips.

Judge the band on grammar and range, not on the topic. Punctuation, capitalisation and the
spelling of proper nouns do not move the band — report those in corrections instead, so a
learner is never dropped a level over one missing comma.

Write rationale in one or two English sentences naming one specific strength and one
specific weakness. Put each correction in corrections as "original -> corrected", quoting
only the words that need to change, and return an empty array when the text needs none.
Return no more than five corrections. Never grade a text that is empty or too short to
judge.

Length limits: keep the rationale under ${MAX_RATIONALE_LENGTH} characters and each
correction under ${MAX_CORRECTION_LENGTH}. Going over one is not fatal — the field is
trimmed with an ellipsis and the band survives — but a trimmed correction ends
mid-sentence, so stay inside each limit with room to spare.`;

export function buildWritingRequest(writing: string): { system: string; user: string } {
  return {
    system: WRITING_SYSTEM_PROMPT,
    // The submission is fenced and labelled as data so text inside it cannot
    // impersonate the instructions above. The closing tag is neutralised in the
    // learner's own answer first — same defect, same fix as lib/writing.ts: a free-
    // writing answer quoting HTML ends the fence early otherwise.
    user: `Task: ${WRITING_TASK.prompt}\n\n<learner_writing>\n${writing.replaceAll(
      '</learner_writing>',
      '<\\/learner_writing>',
    )}\n</learner_writing>`,
  };
}

export type WritingGradeResult =
  | { ok: true; value: WritingGrade }
  | { ok: false; issues: ValidationIssue[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Clip an over-long model string to its cap, marked as clipped.
 *
 * The same rule and the same reason as `clip` in lib/writing.ts, which this one is a copy
 * of rather than an import: the three model-output parsers already each carry their own
 * `isObject`, and a shared module for a two-line pure function is not worth the coupling.
 *
 * Length used to reject, which made this parser all-or-nothing for the wrong reason — a
 * 401-character rationale is a real rationale, and discarding it discarded the band with
 * it, so a learner who answered the quiz well enough to sit a placement test was told the
 * grader "came back unusable" over one long sentence. `parsePlacementRequest` still
 * rejects an over-long submission, which is the opposite situation: that is the client
 * sending something wrong, and the page caps its own box at exactly MAX_WRITING_CHARS.
 */
const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/**
 * Model output is untrusted input like any other. output_config.format makes it
 * schema-shaped, not correct, so nothing downstream may read it unchecked.
 */
export function parseWritingGrade(raw: unknown): WritingGradeResult {
  const issues: ValidationIssue[] = [];
  if (!isObject(raw)) {
    return { ok: false, issues: [{ path: '', message: 'expected a JSON object' }] };
  }

  if (!PLACEMENT_LEVELS.includes(raw.band as PlacementLevel)) {
    issues.push({ path: 'band', message: `expected one of ${PLACEMENT_LEVELS.join(', ')}` });
  }
  // Trimmed, like every other "did the model actually say anything" check: the page
  // renders the rationale directly under the band, and a whitespace-only one draws a
  // blank line next to a graded level. Same reason as `isBlank` in lib/writing.ts.
  if (typeof raw.rationale !== 'string' || raw.rationale.trim().length === 0) {
    issues.push({ path: 'rationale', message: 'expected a non-empty string' });
  }
  if (!Array.isArray(raw.corrections)) {
    issues.push({ path: 'corrections', message: 'expected an array of strings' });
  } else if (raw.corrections.some((entry) => typeof entry !== 'string')) {
    // Count and length are not checked — see `clip`. Shape is: a correction the page
    // cannot render at all is a failed grade, a long one is merely long.
    issues.push({ path: 'corrections', message: 'expected an array of strings' });
  }

  if (issues.length > 0) return { ok: false, issues };

  const corrections = (raw.corrections as unknown[]).slice(0, MAX_CORRECTIONS) as string[];
  return {
    ok: true,
    value: {
      band: raw.band as PlacementLevel,
      rationale: clip(raw.rationale as string, MAX_RATIONALE_LENGTH),
      corrections: corrections.map((entry) => clip(entry, MAX_CORRECTION_LENGTH)),
    },
  };
}

export type PlacementRequest = { answers: number[]; writing: string | null };

export type PlacementRequestResult =
  | { ok: true; value: PlacementRequest }
  | { ok: false; issues: ValidationIssue[] };

export function parsePlacementRequest(body: unknown): PlacementRequestResult {
  const issues: ValidationIssue[] = [];

  if (!isObject(body)) {
    return { ok: false, issues: [{ path: '', message: 'expected a JSON object' }] };
  }

  if (!Array.isArray(body.answers) || body.answers.length !== PLACEMENT_QUESTIONS.length) {
    issues.push({
      path: 'answers',
      message: `expected exactly ${PLACEMENT_QUESTIONS.length} answers`,
    });
  } else {
    body.answers.forEach((answer, index) => {
      const choices = PLACEMENT_QUESTIONS[index].options.length;
      if (!Number.isInteger(answer) || (answer as number) < 0 || (answer as number) >= choices) {
        issues.push({ path: `answers[${index}]`, message: `expected 0 to ${choices - 1}` });
      }
    });
  }

  // Optional: the quiz alone still places someone, and a blank box is not an error.
  let writing: string | null = null;
  if (body.writing !== undefined && body.writing !== null) {
    if (typeof body.writing !== 'string') {
      issues.push({ path: 'writing', message: 'expected a string' });
    } else if (body.writing.length > MAX_WRITING_CHARS) {
      issues.push({
        path: 'writing',
        message: `expected at most ${MAX_WRITING_CHARS} characters`,
      });
    } else {
      writing = body.writing;
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { answers: body.answers as number[], writing } };
}
