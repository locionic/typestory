import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Focus indicators removed and never put back.
 *
 * Six inputs and textareas in this app swap the browser's focus ring for a border colour,
 * which is a real indicator: `focus:outline-none focus:border-indigo-500` turns the border
 * from grey to indigo and leaves a visible state change. Three `<select>`s took the first
 * half of that and not the second. `<select className="bg-transparent font-medium
 * focus:outline-none">` has nothing left that changes when it is focused — the header's
 * keyboard-sound control, and the level filter and sort control on the story catalog. So
 * on every page, a keyboard user tabbing the header passes a control with no indication at
 * all of where they are. That is WCAG 2.2 SC 2.4.7, and this is an app about the keyboard.
 *
 * `role="dialog"` is exempt because the StatsModal container carries `tabIndex={-1}` and is
 * focused programmatically when the modal opens, and painting a ring around the whole dialog
 * box is not what a focus indicator is for. The exemption is stated rather than inferred
 * because the class is there and would otherwise read as the same mistake.
 */

/** Source files under the two directories a className can be typed into. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const SCANNED = [...sources('app'), ...sources('components')];

/**
 * Every `className=` attribute in a file, as the text of its value.
 *
 * Anchoring on the attribute rather than on any quoted string is what keeps a comment from
 * reading as code. The first version of this scan found `outline-none` anywhere and walked
 * back to the nearest quote, which meant the three-line comment left beside the fix —
 * quoting the class it removed — was itself reported as an offence. A scan that flags the
 * note explaining a fix gets the note deleted, and then the next person reinstates the
 * class; anchoring on `className=` makes the prose invisible to it.
 */
function classNameValues(text: string): { value: string; at: number }[] {
  return [...text.matchAll(/className\s*=\s*\{?\s*(["'`])/g)]
    .map((match) => {
      const start = match.index + match[0].length;
      const end = text.indexOf(match[1], start);
      return { value: end === -1 ? '' : text.slice(start, end), at: start };
    })
    .filter((entry) => entry.value.includes('outline-none'));
}

/**
 * Whether this className takes the focus indicator away and names nothing in its place.
 *
 * The removal is matched on the *end* of the token, not equality with it: every one of
 * these is spelled `focus:outline-none` or `focus-visible:outline-none`, and testing for
 * the bare `outline-none` matches none of them — a rule that quietly finds nothing and
 * passes.
 *
 * `focus:` and `focus-visible:` both count as a replacement, since either one restores an
 * indicator on the interaction that matters. A removal is excluded from that search, or a
 * class that only takes the ring away would satisfy the rule that requires one.
 */
function hidesFocusWithoutReplacingIt(className: string): boolean {
  const removes = (token: string) => token === 'outline-none' || token.endsWith(':outline-none');
  const tokens = className.split(/\s+/);
  if (!tokens.some(removes)) return false;
  return !tokens.some(
    (token) =>
      (token.startsWith('focus:') || token.startsWith('focus-visible:')) && !removes(token),
  );
}

interface Finding {
  where: string;
  className: string;
}

const FINDINGS: Finding[] = [];
/** Every `outline-none` the scan resolved, split by what it turned out to be. */
const RESOLVED = { replaced: 0, bare: 0, dialog: 0 };

for (const file of SCANNED) {
  const text = readFileSync(file, 'utf8');
  for (const { value, at } of classNameValues(text)) {
    const line = text.slice(0, at).split('\n').length;
    if (!hidesFocusWithoutReplacingIt(value)) {
      RESOLVED.replaced += 1;
      continue;
    }
    // Scoped to the opening tag rather than to the line: this className is the sixth
    // attribute of a `<div>` Prettier spread over seven lines, so `role="dialog"` is four
    // lines above it and a line-window finds nothing.
    const tagStart = text.lastIndexOf('<', at);
    if (tagStart !== -1 && text.slice(tagStart, at).includes('role="dialog"')) {
      RESOLVED.dialog += 1;
      continue;
    }
    RESOLVED.bare += 1;
    FINDINGS.push({ where: `${file}:${line}`, className: value });
  }
}

describe('the focus indicator on every control', () => {
  it('is never removed without something put in its place', () => {
    expect(FINDINGS).toEqual([]);
  });

  /**
   * The control, and the reason this file is not a green test that checks nothing.
   *
   * Every step above is a regex over a directory listing, and each one fails open: a
   * scanner that matched no files, a reader that returned `''` for every className, or a
   * rule that returned `false` unconditionally would all produce a clean run. These are the
   * two answers the rule has to be capable of reaching on this codebase — one control that
   * is genuinely fine and one that is genuinely broken, both real text, both arriving by
   * exactly the same route as a future offence would.
   */
  it('tells a removed ring from a replaced one', () => {
    expect(hidesFocusWithoutReplacingIt('bg-transparent font-medium focus:outline-none')).toBe(true);
    expect(
      hidesFocusWithoutReplacingIt(
        'rounded-xl border border-gray-200 focus:border-indigo-500 focus:outline-none',
      ),
    ).toBe(false);
  });

  it('found the occurrences there are to classify', () => {
    expect(RESOLVED.replaced).toBeGreaterThan(0);
    expect(RESOLVED.dialog).toBeGreaterThan(0);
    expect(RESOLVED.bare).toBe(FINDINGS.length);
  });
});