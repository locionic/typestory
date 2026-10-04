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

/**
 * The other three model-output caps, interpolated straight into the system prompt.
 *
 * Every cap here rejects the *whole* report — a valid summary, a valid rewrite and
 * every note lost together — so a model that never heard a ceiling loses everything for
 * one field. The schema cannot carry it: structured outputs support neither array nor
 * string constraints, so `maxLength` and `maxItems` would be stripped by the SDK and
 * constrain nothing while looking like it did. The prompt is the only channel, and these
 * are written into it rather than typed beside it, so the number the model is given and
 * the number the validator enforces cannot drift apart.
 *
 * MAX_CORRECTED_CHARS is the one that bites. A submission is capped at 4000 characters
 * and the prompt tells the model not to shorten what was written, so the only headroom
 * between a learner's essay and losing their whole correction is a factor of 1.5.
 */
export const MAX_CORRECTED_CHARS = 6000;
export const MAX_SUMMARY_CHARS = 600;
export const MAX_SPAN_CHARS = 300;
export const MAX_NOTE_CHARS = 240;

/**
 * Deliberately above the ceiling the system prompt states, and the one cap that is not
 * interpolated.
 *
 * This is the only model-output cap the learner can drive over on their own: a longer
 * essay has more distinct problems in it, and the prompt asks for one entry per problem.
 * The stated ceiling is a hand-written eight because the gap is where an imprecise count
 * lands: `parseCorrectionReport` slices to this number rather than throwing the report
 * away, so a model that answers with nine gives the learner a truncated list instead of
 * nothing, and a model that never heard the cap existed gives them nothing at all.
 * test/writing.test.ts reads the number back out of the prompt so the two cannot drift
 * apart unnoticed.
 */
export const MAX_IMPROVEMENTS = 10;

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
  text needs nothing — and only then, because an empty array is shown to the learner as
  their writing having needed nothing at all.

Length limits: keep summary under ${MAX_SUMMARY_CHARS} characters, corrected under
${MAX_CORRECTED_CHARS}, each original or corrected span under ${MAX_SPAN_CHARS}, and each
note under ${MAX_NOTE_CHARS}. Going over one is not fatal — the field is trimmed with an
ellipsis and the rest of the report survives — but a trimmed correction ends
mid-sentence, so stay inside each limit with room to spare.

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

/**
 * Clip an over-long model string to its cap, marked as clipped.
 *
 * Length used to be a rejection like every other check here, which made this parser
 * all-or-nothing for the wrong reason: a 601-character summary is a good summary, and
 * throwing it away also threw away the corrected rewrite and every note with it, after
 * the learner had already waited out the model call. Clipping keeps the property that
 * actually protects the page — nothing downstream reads a string longer than its cap —
 * and stops one verbose field deciding the fate of the whole report.
 *
 * The marker is not decoration. A silently sliced span reads as the whole span, so the
 * learner would be told the change was `went to the store` when it was the first 299
 * characters of something longer.
 *
 * Applied to model output only. `parseWritingRequest` still rejects an over-long
 * submission, and that is the same word for the opposite situation: an over-long paste
 * is the client sending something wrong, and the page caps the box at exactly this
 * number, so there is nothing to salvage and something to tell the learner about.
 *
 * lib/placement.ts and lib/tutor.ts clip the same way, for the same reason.
 */
const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/**
 * Measured on the trimmed string, the same way `parseWritingRequest` measures the
 * submission: a field holding only whitespace says nothing, and a page that renders
 * it draws a blank. `parseTutorReply` has always done this; here `.length === 0` let
 * three spaces through, and because the report is all-or-nothing that blank cost the
 * whole thing — see `parseCorrectionReport`.
 */
const isBlank = (value: string) => value.trim().length === 0;

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

  if (typeof raw.summary !== 'string' || isBlank(raw.summary)) {
    issues.push({ path: 'summary', message: 'expected a non-empty string' });
  }

  if (typeof raw.corrected !== 'string' || isBlank(raw.corrected)) {
    issues.push({ path: 'corrected', message: 'expected a non-empty string' });
  }

  const entries = Array.isArray(raw.improvements) ? raw.improvements : undefined;
  if (!entries) {
    issues.push({ path: 'improvements', message: 'expected an array' });
  } else {
    // Every entry is validated, not just the ones that survive the slice: a malformed
    // ninth improvement is still a report the model got wrong, and silently dropping it
    // is how a report arrives looking complete when it is not.
    entries.forEach((entry, index) => {
      const path = `improvements[${index}]`;
      if (!isObject(entry)) {
        issues.push({ path, message: 'expected an object' });
        return;
      }
      for (const key of ['original', 'corrected', 'note'] as const) {
        if (typeof entry[key] !== 'string' || isBlank(entry[key])) {
          issues.push({ path: `${path}.${key}`, message: 'expected a non-empty string' });
        }
      }
    });
  }

  // Bail before clipping. Clipping repairs a field that is too long, and a field that is
  // the wrong shape or blank has nothing to clip — building a value here would mean
  // reading it as the type this function has just promised the caller it checked.
  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      summary: clip(raw.summary as string, MAX_SUMMARY_CHARS),
      corrected: clip(raw.corrected as string, MAX_CORRECTED_CHARS),
      improvements: (entries as Record<string, unknown>[]).slice(0, MAX_IMPROVEMENTS).map(
        (entry) => ({
          original: clip(entry.original as string, MAX_SPAN_CHARS),
          corrected: clip(entry.corrected as string, MAX_SPAN_CHARS),
          note: clip(entry.note as string, MAX_NOTE_CHARS),
        }),
      ),
    },
  };
}