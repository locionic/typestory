import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A selected control that only says so with a colour.
 *
 * Three controls in this app chose between two background colours to mark themselves as
 * the active one — the six category pills on the story catalog, the four bank tabs on the
 * word banks, and the on/off toggle for the virtual keyboard. None of them put the state in
 * the accessibility tree, so all three announced themselves as plain buttons and left the
 * learner to infer the selection from pixels. WCAG 2.1 SC 4.1.2. The pills were fixed
 * first, by hand; the other two turned up later, in different components, which is what
 * says a hand fix is the wrong shape.
 *
 * Native controls are exempt and need nothing here: a `<select>` and a radio report their
 * own value, and the placement test is built from radios. This is about the buttons that
 * have to do it themselves.
 *
 * What this cannot do, having been found out the hard way: it checks that the attribute is
 * *present*, not that its value is meaningful. Writing `aria-pressed={undefined}` satisfies
 * it and puts nothing in the tree. That is the boundary of a source scan — deciding whether
 * an expression evaluates to something is not one — and it is aimed at the mistake it can
 * actually make, which is an author adding a control and never hearing of the attribute.
 * Whether the rendered DOM carries a usable value is a different question, asked of a real
 * render in test/catalogFilters.test.ts.
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
 * Anchored on the attribute rather than on any quoted string, so a comment explaining one
 * of these fixes is invisible to the scan. A scan that flags the note left beside the fix
 * is a good way to get the note deleted and the mistake reinstated.
 */
function classNameValues(text: string): { value: string; at: number }[] {
  return [...text.matchAll(/className\s*=\s*\{?\s*(["'`])/g)]
    .map((match) => {
      const start = match.index + match[0].length;
      const end = text.indexOf(match[1], start);
      return { value: end === -1 ? '' : text.slice(start, end), at: start };
    })
    .filter((entry) => entry.value.includes('?'));
}

/**
 * Whether this className picks between two background colours.
 *
 * Split at the ternary's own colon rather than matched against a list of "selected"
 * colours, because the mistake is not a particular shade — it is that the *only* thing
 * distinguishing one state from another is a background, and a list would need a new entry
 * every time someone picked a nicer indigo.
 */
function colourSwap(className: string): boolean {
  const colon = className.indexOf(':');
  if (!className.includes('?') || colon === -1) return false;
  return /\bbg-[a-z]/.test(className.slice(0, colon)) && /\bbg-[a-z]/.test(className.slice(colon));
}

/**
 * The attributes opening the element this className sits on, up to the className itself.
 *
 * Anchored on the nearest `<`, not on `lastIndexOf('<button')`: these classNames are the
 * fourth attribute of a tag Prettier has spread over seven lines, and a line window finds
 * the wrong element or none. Searching backwards for the literal `<button` is worse than
 * either — a colour swap on a `<div>` in a file that contains buttons somewhere above it
 * gets attributed to the one before, which is how the milestone badge came to be reported
 * as an unnamed button when it is a card.
 */
function tagBefore(text: string, at: number): string {
  const start = text.lastIndexOf('<', at);
  return start === -1 ? '' : text.slice(start, at);
}

/** A colour swap with nothing in the accessibility tree to match it. */
function unannounced(className: string, tag: string): boolean {
  return colourSwap(className) && !/aria-(pressed|selected|current)\s*=/.test(tag);
}

interface Finding {
  where: string;
  className: string;
}

const FINDINGS: Finding[] = [];
/** Every colour swap the scan resolved, split by what turned out to be behind it. */
const RESOLVED = { announced: 0, notASwap: 0, notAButton: 0 };

for (const file of SCANNED) {
  const text = readFileSync(file, 'utf8');
  for (const { value, at } of classNameValues(text)) {
    const line = text.slice(0, at).split('\n').length;
    if (!colourSwap(value)) {
      RESOLVED.notASwap += 1;
      continue;
    }
    const tag = tagBefore(text, at);
    if (!/^<button\b/.test(tag)) {
      // A ternary className on something that is not a button — the milestone badge card,
      // which picks between an indigo fill and a grey one and is a card, not a control.
      // Colour-only there is not a missing state.
      RESOLVED.notAButton += 1;
      continue;
    }
    if (!unannounced(value, tag)) {
      RESOLVED.announced += 1;
      continue;
    }
    FINDINGS.push({ where: `${file}:${line}`, className: value });
  }
}

describe('every control that marks itself selected', () => {
  it('says so in the accessibility tree and not only in a colour', () => {
    expect(FINDINGS).toEqual([]);
  });

  /**
   * The control, and the reason the scan above is not a green test that checked nothing.
   * Each step in it is a regex over a directory listing and every one fails open — a scan
   * that matched no files, a reader that returned `''` for each className, a rule that
   * returned false unconditionally. These are the three answers the rule has to reach: a
   * real offence, the same control once fixed, and a className with only one background in
   * it, which is not an offence at all.
   */
  it('tells a colour swap with no state from one that has it', () => {
    const swap = "? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'";

    expect(unannounced(swap, '<button className=')).toBe(true);
    expect(unannounced(swap, '<button aria-pressed={active} className=')).toBe(false);
    expect(
      unannounced('rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200', '<button className='),
    ).toBe(false);
  });

  /**
   * Every bucket has to be non-empty, or the classification above is only half exercised.
   * `announced` is the catalog pills, fixed in place; `notAButton` is the milestone badge
   * card, which picks between two backgrounds and is not a button and never needed to be;
   * `notASwap` is the ternaries that are not about backgrounds at all. Delete all three
   * kinds and this fails before the first assertion stops meaning anything.
   */
  it('found the colour swaps there are to classify', () => {
    expect(RESOLVED.announced).toBeGreaterThan(0);
    expect(RESOLVED.notASwap).toBeGreaterThan(0);
    expect(RESOLVED.notAButton).toBeGreaterThan(0);
  });
});