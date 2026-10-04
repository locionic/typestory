import { describe, expect, it } from 'vitest';
import { sessionsCsv } from '../lib/csv';
import type { TypingSessionRecord } from '../lib/types';

/**
 * The export, and the ways a CSV is wrong without anyone noticing.
 *
 * A session file is read by a program, not by this suite and not by the app, so there is
 * no other place a mistake in it can surface. It is the only feature in the codebase whose
 * output is consumed by something with a formula evaluator and a second opinion about
 * which encoding a file is in — and both of those judge it at *open* time, on the
 * learner's machine, long after this suite is green.
 *
 * Canaried in lib/csv.ts, each alone and each failing one test here and no other: the
 * `isText` guard on the formula defusal short-circuited to `false`. The quoting, the BOM
 * and the column set are each read off the exact string in the first test, so a change to
 * any of them changes that string.
 */
const session = (over: Partial<TypingSessionRecord> = {}): TypingSessionRecord => ({
  id: 's1',
  timestamp: 1_757_000_000_000,
  dateStr: '2026-10-01',
  title: 'The Lazy Crab',
  sourceType: 'story',
  wpm: 52,
  accuracy: 97,
  durationSeconds: 90,
  wordsCount: 78,
  keystrokes: 400,
  ...over,
});

/**
 * The title cell of the first data row — the only column with anything interesting in it.
 *
 * Rebuilt from the left and the right so it does not matter how the six columns after it
 * are quoted, which is what lets the quoting tests assert a title alone. Six, not seven:
 * `Source` is a column too, and it is not numeric. A quoted title containing a comma would
 * be split in two by a naive `split(',')`, so the tail is taken off first and what remains
 * in the middle is what the cell was.
 */
const titleCell = (csv: string): string =>
  csv
    .split('\r\n')[1]
    .split(',')
    .slice(1, -6)
    .join(',');

describe('the session CSV', () => {
  /**
   * The whole file, for a known history, as one exact string.
   *
   * Not a row count and not a `toContain`. Every column name, every value, the order, the
   * line ending and the byte order mark are in this one string, so a change to any of them
   * is a change to it.
   *
   * The fixture is newest-first because that is the shape `sessions` has: `lib/stats.ts`
   * builds it as `[newSession, ...current.sessions]`, so index 0 is the latest run and the
   * panel above the button renders it top. The exporter reverses that, and a spreadsheet
   * is a table to plot rather than a list to read down — a chart whose x-axis runs
   * backwards is worse than no chart at all. Written here in strict date order so the
   * reversal is doing visible work rather than coincidentally matching.
   */
  it('writes every field of every session, oldest first', () => {
    const csv = sessionsCsv([
      session({ dateStr: '2026-10-03', title: 'Third', sourceType: 'custom', wpm: 54, accuracy: 95 }),
      session({ dateStr: '2026-10-02', title: 'Second', sourceType: 'vocab', wpm: 53, accuracy: 96 }),
      session({ dateStr: '2026-10-01', title: 'First', sourceType: 'story', wpm: 52, accuracy: 97 }),
    ]);

    expect(csv).toBe(
      '﻿' +
        [
          'Date,Title,Source,WPM,Accuracy %,Seconds,Words,Keystrokes',
          '2026-10-01,First,story,52,97,90,78,400',
          '2026-10-02,Second,vocab,53,96,90,78,400',
          '2026-10-03,Third,custom,54,95,90,78,400',
        ].join('\r\n') +
        '\r\n',
    );
  });

  /**
   * The mark, on its own, with nothing else in the file to carry it.
   *
   * It is invisible in a diff and the failure it prevents is invisible too — the file is
   * correct, the learner's copy of Excel is what mangles it — so the assertion that catches
   * its removal is one against a file with no rows in it.
   */
  it('leads with a byte order mark, so Excel reads it as UTF-8', () => {
    expect(sessionsCsv([])).toBe('﻿Date,Title,Source,WPM,Accuracy %,Seconds,Words,Keystrokes\r\n');
  });

  it('keeps a non-ASCII title readable', () => {
    expect(titleCell(sessionsCsv([session({ title: 'Bến Cảng Hạ Long' })]))).toBe(
      'Bến Cảng Hạ Long',
    );
  });

  /**
   * The two quoting rules, as exact cells.
   *
   * A comma in a title ends the cell early and shifts every column after it one place
   * left, so the WPM column silently becomes accuracy and every number is still
   * plausible. Nothing about that looks broken in the file.
   */
  it('quotes a title holding a comma, and doubles a quote inside one', () => {
    expect(titleCell(sessionsCsv([session({ title: 'Full-Stack, Part II' })]))).toBe(
      '"Full-Stack, Part II"',
    );
    expect(titleCell(sessionsCsv([session({ title: 'The "Lazy" Crab' })]))).toBe(
      '"The ""Lazy"" Crab"',
    );
  });

  /**
   * The operators, the exact defused cell for each, and the control that says the defusal
   * is not being applied to everything.
   *
   * Excel and Sheets evaluate a leading `=` when the file is *opened*, so a title of
   * `=HYPERLINK("http://…","click")` becomes a live link in the learner's spreadsheet
   * before they have looked at a cell. `/custom` takes its title from text the learner
   * pasted, so the app does not get to choose this value — the defence belongs in the
   * exporter, and here rather than in the title because the title is already rendered
   * inert in the panel and this is the only path that hands it to a formula engine.
   *
   * The whitespace cases are the ones worth having: an import path that trims a cell
   * before evaluating it turns `" =1+1"` back into a formula, and a test covering only
   * the four operators walks straight past exactly that. The control is the last
   * assertion — a title starting with a letter must come through untouched, or the
   * apostrophe is corrupting real data and the fix has become its own defect.
   */
  it('defuses a title a spreadsheet would evaluate on open', () => {
    const cellsFor = (title: string) => titleCell(sessionsCsv([session({ title })]));

    expect(['=1+1', '+1+1', '-1+1', '@SUM(A1)', ' =1+1', '\t=1+1'].map(cellsFor)).toEqual([
      "'=1+1",
      "'+1+1",
      "'-1+1",
      "'@SUM(A1)",
      "' =1+1",
      "'\t=1+1",
    ]);

    expect(cellsFor('The Lazy Crab')).toBe('The Lazy Crab');
  });

  /**
   * Numbers stay unquoted, which is the whole reason the columns are not quoted wholesale.
   *
   * A quoted `52` is legal CSV and arrives as text often enough that the first chart a
   * learner builds is a string axis, sorted alphabetically, which puts 100 before 40.
   */
  it('leaves the numeric columns unquoted so they arrive as numbers', () => {
    expect(sessionsCsv([session()]).split('\r\n')[1]).toBe(
      '2026-10-01,The Lazy Crab,story,52,97,90,78,400',
    );
  });
});
