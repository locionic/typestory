import type { TypingSessionRecord } from './types';

/**
 * The learner's session history as a CSV.
 *
 * The backup code is restore-only and the session rows are not selectable, so these
 * records are readable in the panel and unreachable everywhere else. This is the way out,
 * and `TypingSessionRecord` is already flat — eight scalar fields — which is the whole of
 * why a CSV is a real feature rather than a format to design around.
 *
 * It is also an export of the *stored window* and nothing else. `stats.sessions` is capped
 * at `MAX_SESSIONS`, so a learner with two years of practice gets their last 100 runs and
 * no earlier. The button beside it says so; nothing here can widen it, and calling a
 * rolling window a history is the same over-claim the accuracy card already had to fix.
 */

/** RFC 4180 column order. A spreadsheet user sees these names, so they are the contract. */
const HEADER = ['Date', 'Title', 'Source', 'WPM', 'Accuracy %', 'Seconds', 'Words', 'Keystrokes'];

/**
 * One field, quoted when the value needs it and defused when it could be executed.
 *
 * Two unrelated problems that happen to share a line. Quoting is about *parsing*: a title
 * with a comma in it ends the cell early and shifts every column after it, and an
 * unescaped quote does the same thing one character earlier. Formula injection is about
 * *execution*: Excel and Google Sheets evaluate a cell beginning `=`, `+`, `-` or `@` when
 * the file is opened, not when it is drawn, so `=HYPERLINK("http://…","click")` in a
 * pasted title becomes a live link in the learner's spreadsheet. `/custom` derives the
 * title from text the learner pasted, so this is a value the app does not get to choose —
 * hence the defusal, and hence the apostrophe going *inside* the quotes, which is where
 * both spreadsheets read it as "this is text" and drop it from the cell's value.
 *
 * Numbers are deliberately left unquoted: the main use of this file is charting WPM, and a
 * quoted `58` arrives as text often enough to make the first chart a string axis.
 *
 * The leading-character test is `/[\s=+\-@]/` and not the four operators alone, because
 * whitespace is the bypass: an import path that trims a cell before evaluating it turns
 * `" =1+1"` back into a formula, and one character of leading space is all it takes. One
 * character class covers both, which is why there is no second test to keep in step.
 */
function cell(value: string | number, isText = false): string {
  const text = String(value);
  const safe = isText && /^[\s=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The whole file, as text.
 *
 * Oldest first, against the panel's newest-first order: this is not a list to read down, it
 * is a table to plot, and every tool that plots one expects time to run forwards. CRLF
 * because that is what RFC 4180 says and what Excel itself writes.
 */
export function sessionsCsv(sessions: TypingSessionRecord[]): string {
  const rows = [
    HEADER.join(','),
    ...[...sessions].reverse().map((session) =>
      [
        cell(session.dateStr),
        cell(session.title, true),
        cell(session.sourceType),
        cell(session.wpm),
        cell(session.accuracy),
        cell(session.durationSeconds),
        cell(session.wordsCount),
        cell(session.keystrokes),
      ].join(','),
    ),
  ];

  // `\uFEFF` and not nothing. Excel on Windows reads a UTF-8 CSV that has no BOM as the
  // local codepage, so a Vietnamese story title comes back as mojibake — and every gloss
  // in this app carries a translation, so a title with one is not a rare row. Excel writes
  // the BOM itself when it saves a CSV, so this is the shape it round-trips.
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

/**
 * Hand the file to the browser.
 *
 * `URL.createObjectURL` is missing from jsdom, so the button's test stubs it — which is
 * also the only way that test can tell the button is wired to this and not to nothing.
 * `revokeObjectURL` is in the same statement deliberately: an object URL pins its Blob for
 * the lifetime of the document, and a learner who exports fifty times has fifty live blobs
 * holding the whole history, for a file they already have on disk.
 */
export function downloadSessionsCsv(sessions: TypingSessionRecord[]): void {
  const url = URL.createObjectURL(
    new Blob([sessionsCsv(sessions)], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'typestory-sessions.csv';
  // Attached for the click, which is not ceremony. Chromium downloads from a detached
  // anchor; Firefox has historically required the element to be in the document, and the
  // symptom when it is not is a button that silently does nothing. Nothing here has run in
  // a real browser — `npm run test:e2e` needs a `--no-sandbox` authorisation this machine
  // does not have — so this is the shape the platform's own file-saving code uses rather
  // than a difference I could observe.
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}