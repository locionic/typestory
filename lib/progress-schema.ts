import type { SourceType, TypingSessionRecord, UserStats } from './types';

/**
 * Wire contract for auth-less progress sync (GET/PUT/DELETE /api/progress).
 *
 * The browser owns a device id; the server owns storage and validation only.
 * When real auth lands, `deviceId` becomes a user id and nothing else here moves.
 */

export const PROGRESS_SCHEMA_VERSION = 1;

/** Keep in lockstep with the cap in lib/stats.ts so a synced record can never grow unbounded. */
export const MAX_SESSIONS = 100;
export const MAX_TITLE_LENGTH = 120;

/**
 * Exported so lib/stats.ts can reuse it rather than keep a second copy to drift.
 *
 * The client clamps to this in `wpmFrom` before a run is ever written, and this file
 * is what rejects it. That pair only works while they are the same number, and until
 * now nothing held them together: 400 was a bare literal in `isWpm`, a bare literal in
 * each of the three messages below, and a third copy in lib/stats.ts under a comment
 * claiming it was in lockstep with this one. Lower the bound here — a "no real
 * typist is that fast" edit — and `wpmFrom` keeps reporting, recording and storing runs
 * above it, and the next push is refused wholesale: a finished session, a valid local
 * history, and a backup that has silently stopped with nothing on screen to say so.
 */
export const MAX_WPM = 400;

/**
 * Restricted on purpose: this value reaches the filesystem as a filename in
 * lib/progress-store.ts, so it must not be able to express a path.
 */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Exported so lib/stats.ts can reuse it rather than keep a second copy to drift. */
export const SOURCE_TYPES: readonly SourceType[] = ['story', 'vocab', 'custom'];

/** A malformed payload can trip many checks at once; never echo all of them back. */
const MAX_ISSUES = 20;

export interface ProgressRecord {
  version: number;
  deviceId: string;
  /** ISO-8601 timestamp of the last accepted write. */
  updatedAt: string;
  stats: UserStats;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; value: ProgressRecord }
  | { ok: false; issues: ValidationIssue[] };

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The three numeric shapes a record may hold.
 *
 * Exported because lib/stats.ts is the other half of the same contract and used to
 * carry a weaker notion of "valid" — finite-only — which agreed with these on nothing
 * that mattered. Every field below has a bound the server enforces and the client did
 * not: a count may not be negative, a percent may not exceed 100, a speed may not
 * exceed MAX_WPM. A record holding one was stored locally, looked fine, and was then
 * refused wholesale by the push — see `sanitiseUserStats` for what that cost.
 */
export const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const isPercent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

/** WPM above this is a client bug or an attempt to poison any future leaderboard. */
export const isWpm = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_WPM;

/** A session's day, as opposed to the streak's, which may also be "never practised". */
export const isDateStr = (value: unknown): value is string =>
  typeof value === 'string' && DATE_PATTERN.test(value);

function push(issues: ValidationIssue[], path: string, message: string) {
  if (issues.length < MAX_ISSUES) issues.push({ path, message });
}

/**
 * The session as it will be stored.
 *
 * Built from the checked fields rather than handed back whole. The caller's object
 * can carry whatever other keys it likes, and MAX_SESSIONS and MAX_TITLE_LENGTH say
 * nothing at all about those — so passing it through let a request put a megabyte in
 * `stats.anythingElse` and have it written to disk, on a record this file promises can
 * never grow unbounded. Constructing it is what makes that promise true rather than
 * aspirational: the stored size is now a function of the caps above.
 *
 * null when it did not validate. parseProgressBody discards the whole parse in that
 * case, so the casts below never carry a value that failed its check.
 */
function parseSession(raw: unknown, path: string, issues: ValidationIssue[]): TypingSessionRecord | null {
  if (!isObject(raw)) {
    push(issues, path, 'expected an object');
    return null;
  }

  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) {
    push(issues, `${path}.id`, 'expected a string of 1-64 characters');
  }
  if (!isCount(raw.timestamp)) push(issues, `${path}.timestamp`, 'expected a non-negative number');
  if (!isDateStr(raw.dateStr)) {
    push(issues, `${path}.dateStr`, 'expected YYYY-MM-DD');
  }
  if (typeof raw.title !== 'string' || raw.title.length > MAX_TITLE_LENGTH) {
    push(issues, `${path}.title`, `expected a string of at most ${MAX_TITLE_LENGTH} characters`);
  }
  if (!SOURCE_TYPES.includes(raw.sourceType as SourceType)) {
    push(issues, `${path}.sourceType`, `expected one of ${SOURCE_TYPES.join(', ')}`);
  }
  if (!isWpm(raw.wpm)) push(issues, `${path}.wpm`, `expected a number between 0 and ${MAX_WPM}`);
  if (!isPercent(raw.accuracy)) push(issues, `${path}.accuracy`, 'expected a number between 0 and 100');
  if (!isCount(raw.durationSeconds)) {
    push(issues, `${path}.durationSeconds`, 'expected a non-negative number');
  }
  if (!isCount(raw.wordsCount)) push(issues, `${path}.wordsCount`, 'expected a non-negative number');
  if (!isCount(raw.keystrokes)) push(issues, `${path}.keystrokes`, 'expected a non-negative number');

  return {
    id: raw.id as string,
    timestamp: raw.timestamp as number,
    dateStr: raw.dateStr as string,
    title: raw.title as string,
    sourceType: raw.sourceType as SourceType,
    wpm: raw.wpm as number,
    accuracy: raw.accuracy as number,
    durationSeconds: raw.durationSeconds as number,
    wordsCount: raw.wordsCount as number,
    keystrokes: raw.keystrokes as number,
  };
}

/** As parseSession: only the three checked keys, so the same argument applies. */
function parseStreak(raw: unknown, path: string, issues: ValidationIssue[]): UserStats['dailyStreak'] | null {
  if (!isObject(raw)) {
    push(issues, path, 'expected an object');
    return null;
  }

  if (!isCount(raw.currentStreak)) {
    push(issues, `${path}.currentStreak`, 'expected a non-negative number');
  }
  if (!isCount(raw.bestStreak)) {
    push(issues, `${path}.bestStreak`, 'expected a non-negative number');
  }
  // Empty string means "never practised" — see DEFAULT_STATS in lib/stats.ts.
  if (raw.lastActiveDate !== '' && (typeof raw.lastActiveDate !== 'string' || !DATE_PATTERN.test(raw.lastActiveDate))) {
    push(issues, `${path}.lastActiveDate`, 'expected YYYY-MM-DD or an empty string');
  }

  return {
    currentStreak: raw.currentStreak as number,
    bestStreak: raw.bestStreak as number,
    lastActiveDate: raw.lastActiveDate as string,
  };
}

function parseStats(raw: unknown, issues: ValidationIssue[]): UserStats | null {
  if (!isObject(raw)) {
    push(issues, 'stats', 'expected an object');
    return null;
  }

  if (!Array.isArray(raw.sessions)) {
    push(issues, 'stats.sessions', 'expected an array');
    return null;
  }
  if (raw.sessions.length > MAX_SESSIONS) {
    push(issues, 'stats.sessions', `expected at most ${MAX_SESSIONS} entries`);
    return null;
  }
  const sessions = raw.sessions
    .map((session, index) => parseSession(session, `stats.sessions[${index}]`, issues))
    .filter((session): session is TypingSessionRecord => session !== null);

  const dailyStreak = parseStreak(raw.dailyStreak, 'stats.dailyStreak', issues);

  if (!isCount(raw.totalWordsTyped)) {
    push(issues, 'stats.totalWordsTyped', 'expected a non-negative number');
  }
  if (!isCount(raw.totalTimeSpentSeconds)) {
    push(issues, 'stats.totalTimeSpentSeconds', 'expected a non-negative number');
  }
  if (!isWpm(raw.bestWpm)) push(issues, 'stats.bestWpm', `expected a number between 0 and ${MAX_WPM}`);
  if (!isWpm(raw.averageWpm)) {
    push(issues, 'stats.averageWpm', `expected a number between 0 and ${MAX_WPM}`);
  }
  if (!isPercent(raw.averageAccuracy)) {
    push(issues, 'stats.averageAccuracy', 'expected a number between 0 and 100');
  }
  // Deliberately the only numeric field here that pushes no issue when it is missing.
  // `bestAccuracy` was added after records were already on disk, and this parse is
  // all-or-nothing: push an issue for a field that is merely absent and every backup the
  // previous build wrote is refused wholesale, which is the exact failure this file's own
  // comments describe — a valid local history and a push that has silently stopped. An
  // absent field is recovered from the sessions above instead, the same derivation the
  // client makes, so both ends agree on what an old record meant.
  const bestAccuracy = isPercent(raw.bestAccuracy)
    ? raw.bestAccuracy
    : sessions.reduce((best, session) => Math.max(best, session.accuracy), 0);

  // Every check above has run, so the remaining issue is a one-line report for a
  // payload with two problems. An invalid streak already pushed its own issue.
  if (!dailyStreak) return null;

  return {
    sessions,
    dailyStreak,
    totalWordsTyped: raw.totalWordsTyped as number,
    totalTimeSpentSeconds: raw.totalTimeSpentSeconds as number,
    bestWpm: raw.bestWpm as number,
    averageWpm: raw.averageWpm as number,
    averageAccuracy: raw.averageAccuracy as number,
    bestAccuracy,
  };
}

/**
 * Validates an untrusted request body into a ProgressRecord.
 *
 * Deliberately all-or-nothing: a half-applied sync is worse than a rejected one,
 * because the client cannot tell which sessions survived.
 */
export function parseProgressBody(body: unknown, now: Date = new Date()): ParseResult {
  const issues: ValidationIssue[] = [];

  if (!isObject(body)) {
    return { ok: false, issues: [{ path: '', message: 'expected a JSON object' }] };
  }

  if (!isValidDeviceId(body.deviceId)) {
    push(issues, 'deviceId', `expected 8-64 characters matching ${DEVICE_ID_PATTERN.source}`);
  }

  // Absent means "current client"; an explicit future version is refused so a new
  // server never silently drops fields an old client does not understand.
  let version = PROGRESS_SCHEMA_VERSION;
  if (body.version !== undefined) {
    if (!Number.isInteger(body.version) || (body.version as number) < 1) {
      push(issues, 'version', 'expected a positive integer');
    } else if ((body.version as number) > PROGRESS_SCHEMA_VERSION) {
      push(issues, 'version', `unsupported schema version, server is at ${PROGRESS_SCHEMA_VERSION}`);
    } else {
      version = body.version as number;
    }
  }

  const stats = parseStats(body.stats, issues);

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      version,
      deviceId: body.deviceId as string,
      updatedAt: now.toISOString(),
      stats: stats as UserStats,
    },
  };
}

export type ProgressSession = TypingSessionRecord;
