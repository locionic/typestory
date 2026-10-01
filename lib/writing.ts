import type { ValidationIssue } from './progress-schema';

/**
 * English writing correction.
 *
 * The same primitive as the placement test — one system prompt, one JSON schema,
 * one validated object back — pointed at a different job. Placement asks "what
 * level is this"; this asks "what would a fluent speaker have written instead,
 * and why". Keeping it in its own module is what keeps placement's answer key
 * out of this page's bundle.
 */

/** Trust boundary: a submission is untrusted input. */
export const MAX_TEXT_CHARS = 4000;
export const MAX_CORRECTED_CHARS = 6000;
export const MAX_SUMMARY_CHARS = 600;

/**
 * Deliberately above the ceiling the system prompt states.
 *
 * This is the only model-output cap the learner can drive over on their own: a longer
 * essay has more distinct problems in it, and the prompt asks for one entry per problem.
 * The schema cannot help — structured outputs support neither array nor string
 * constraints, so `maxItems` would be stripped by the SDK and constrain nothing while
 * looking like it did. That leaves the prompt as the only thing telling the model a
 * ceiling exists, and tripping this cap rejects the whole report: a valid summary, a
 * valid rewrite and every one of the first ten notes thrown away together. So the stated
 * ceiling sits below the cap, and the gap is where an imprecise count lands instead of
 * being discarded.
 */
export const MAX_IMPROVEMENTS = 10;
export const MAX_SPAN_CHARS = 300;
export const MAX_NOTE_CHARS = 240;

/**
 * Below this there is nothing to correct, and grading "hi" spends a model call
 * to say so. Refused as a 400 so the learner is told before anything is spent.
 */
export const MIN_TEXT_CHARS = 20;

export interface Improvement {
  /** The learner's own words, quoted as the smallest span that needs to change. */
  original: string;
  corrected: string;
  note: string;
}

export interface CorrectionReport {
  summary: string;
  /** The learner's text as a fluent speaker would write it. */
  corrected: string;
  improvements: Improvement[];
}

export const CORRECTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    corrected: { type: 'string' },
    improvements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          corrected: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['original', 'corrected', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'corrected', 'improvements'],
  additionalProperties: false,
};

export const CORRECTION_SYSTEM_PROMPT = `You are an English teacher correcting a learner's own writing, and you return one JSON object.

You are correcting something the learner typed themselves, so the mistakes are their English
rather than a transcription slip. Correct the English, never the meaning, and never rewrite it
into a register they did not ask for.

- summary: one or two sentences naming the single most useful thing to work on. No praise padding.
- corrected: the same text as a fluent speaker would write it, keeping the learner's meaning,
  voice, tense and paragraph breaks. Fix real errors only — do not upgrade the vocabulary to
  show off, do not shorten what they wrote, and do not reorder their sentences.
- improvements: one entry per distinct problem, most important first, and no more than 8 of
  them. original is the smallest span of their text that changes, corrected is the
  replacement, and note is one short sentence saying why. Return an empty array when the
  text needs nothing.

Rules:
- Judge the English, not the topic, and not the intent behind a mistake you cannot see.
- Never "correct" a proper noun, a technical term used deliberately, or a contraction.
- Do not invent facts or add information the learner did not write.
- Return the JSON object only, with no surrounding prose.`;

export function buildCorrectionRequest(text: string): { system: string; user: string } {
  return {
    system: CORRECTION_SYSTEM_PROMPT,
    // Fenced and labelled as data so anything inside it — the learner pasted
    // whatever they liked — cannot impersonate the instructions above.
    //
    // The closing tag is neutralised in the learner's own text first, because the tag
    // was previously interpolated raw: a submission quoting HTML or documentation
    // carries `</learner_text>` with it, which ended the fence early and left the rest
    // of the essay sitting where the instructions are — precisely what the fence is
    // for. Escaped rather than stripped, so the submission is still intact to correct.
    // The escape is XML's, which is what the model reads the character to mean, so
    // the learner's words survive intact and are still correctable.
    user: `Correct the English in this text:\n\n<learner_text>\n${text.replaceAll(
      '</learner_text>',
      '<\\/learner_text>',
    )}\n</learner_text>`,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const tooLong = (value: string, max: number) => value.length > max;

export type WritingRequestResult =
  | { ok: true; value: { text: string } }
  | { ok: false; issues: ValidationIssue[] };

export function parseWritingRequest(body: unknown): WritingRequestResult {
  const issues: ValidationIssue[] = [];

  if (!isObject(body)) {
    return { ok: false, issues: [{ path: '', message: 'expected a JSON object' }] };
  }

  if (typeof body.text !== 'string') {
    issues.push({ path: 'text', message: 'expected a string' });
  } else if (body.text.trim().length < MIN_TEXT_CHARS) {
    // Measured on the trimmed text: a box holding only whitespace is as empty as
    // an empty one, and it reads as "nothing to check" rather than "too short".
    issues.push({
      path: 'text',
      message: `expected at least ${MIN_TEXT_CHARS} characters of writing`,
    });
  } else if (body.text.length > MAX_TEXT_CHARS) {
    issues.push({ path: 'text', message: `expected at most ${MAX_TEXT_CHARS} characters` });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { text: body.text as string } };
}

export type CorrectionReportResult =
  | { ok: true; value: CorrectionReport }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Model output is untrusted input like any other. output_config.format makes it
 * schema-shaped, not correct, so nothing downstream may read it unchecked —
 * every improvement is rendered into a component and echoed back to the learner.
 */
export function parseCorrectionReport(raw: unknown): CorrectionReportResult {
  const issues: ValidationIssue[] = [];
  if (!isObject(raw)) {
    return { ok: false, issues: [{ path: '', message: 'expected a JSON object' }] };
  }

  if (typeof raw.summary !== 'string' || raw.summary.length === 0) {
    issues.push({ path: 'summary', message: 'expected a non-empty string' });
  } else if (tooLong(raw.summary, MAX_SUMMARY_CHARS)) {
    issues.push({ path: 'summary', message: `expected at most ${MAX_SUMMARY_CHARS} characters` });
  }

  if (typeof raw.corrected !== 'string' || raw.corrected.length === 0) {
    issues.push({ path: 'corrected', message: 'expected a non-empty string' });
  } else if (tooLong(raw.corrected, MAX_CORRECTED_CHARS)) {
    issues.push({
      path: 'corrected',
      message: `expected at most ${MAX_CORRECTED_CHARS} characters`,
    });
  }

  if (!Array.isArray(raw.improvements)) {
    issues.push({ path: 'improvements', message: 'expected an array' });
  } else if (raw.improvements.length > MAX_IMPROVEMENTS) {
    issues.push({
      path: 'improvements',
      message: `expected at most ${MAX_IMPROVEMENTS} entries`,
    });
  } else {
    raw.improvements.forEach((entry, index) => {
      const path = `improvements[${index}]`;
      if (!isObject(entry)) {
        issues.push({ path, message: 'expected an object' });
        return;
      }
      for (const key of ['original', 'corrected', 'note'] as const) {
        if (typeof entry[key] !== 'string' || entry[key].length === 0) {
          issues.push({ path: `${path}.${key}`, message: 'expected a non-empty string' });
        }
      }
      if (typeof entry.original === 'string' && tooLong(entry.original, MAX_SPAN_CHARS)) {
        issues.push({
          path: `${path}.original`,
          message: `expected at most ${MAX_SPAN_CHARS} characters`,
        });
      }
      if (typeof entry.corrected === 'string' && tooLong(entry.corrected, MAX_SPAN_CHARS)) {
        issues.push({
          path: `${path}.corrected`,
          message: `expected at most ${MAX_SPAN_CHARS} characters`,
        });
      }
      if (typeof entry.note === 'string' && tooLong(entry.note, MAX_NOTE_CHARS)) {
        issues.push({
          path: `${path}.note`,
          message: `expected at most ${MAX_NOTE_CHARS} characters`,
        });
      }
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: raw as unknown as CorrectionReport };
}