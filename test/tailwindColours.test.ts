import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Colour steps that do not exist, so the rules for them are never generated.
 *
 * `dark:bg-gray-850` and `dark:hover:bg-gray-750` were in thirteen places across seven
 * files, every one of them a card, row, list or key given no dark-mode surface at all.
 * Tailwind 4 builds colour utilities by matching a class against a theme variable, and
 * there is no `--color-gray-850` in the palette or in this project's `@theme inline` —
 * which extends only the background, the foreground and the two fonts. So nothing is
 * emitted, and the class is not a near-miss that renders slightly off: it renders *not at
 * all*, leaving the element on whatever colour is behind it while the author believed it
 * was shaded. Nothing warns. The declaration looks exactly like the working ones beside
 * it, in the same className, on the same line.
 *
 * Why it survived so long is the other half: 800 and 900 really are 850's neighbours,
 * and a number between two real steps reads as deliberate rather than as a guess.
 *
 * Verified rather than assumed, by running the installed Tailwind over the two classes:
 * it emitted `--color-gray-100`, `--color-gray-700` and `--color-gray-800`, and nothing
 * at all for `gray-850` with or without an opacity modifier, or for `gray-750`.
 */
const THEME = readFileSync(join(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');

/** Every `--color-<hue>-<step>` the installed Tailwind actually defines. */
const PALETTE = new Set(
  [...THEME.matchAll(/--color-([a-z]+)-(\d+)\s*:/g)].map(([, hue, step]) => `${hue}-${step}`),
);

/**
 * The preconditions, before anything is scanned.
 *
 * A palette that failed to parse leaves this set empty, and an empty set accepts every
 * colour in the app — the check would pass having tested nothing. So it is asserted to
 * have parsed, and the two steps this file exists for are named before the scan that
 * would otherwise have to discover them.
 */
describe("Tailwind's installed palette", () => {
  it('was read, rather than silently matching nothing', () => {
    // Counted by hue rather than by step: the default palette is around two dozen hues,
    // and that survives a Tailwind release adding or dropping an individual shade, which
    // a total-step threshold would not.
    expect(new Set([...PALETTE].map((entry) => entry.split('-')[0])).size).toBeGreaterThan(15);
    expect(PALETTE.has('gray-800')).toBe(true);
    expect(PALETTE.has('gray-850')).toBe(false);
    expect(PALETTE.has('gray-750')).toBe(false);
  });
});

/** Source files under the two directories a colour utility can be typed into. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const SCANNED = [...sources('app'), ...sources('components')];

/**
 * A colour utility, captured as its hue and its step.
 *
 * Matched off the utility prefix rather than off a list of greys, so `indigo-350` and
 * `rose-850` are caught by the same check — the mistake is not about grey.
 *
 * The opacity modifier is outside the capture, so `bg-gray-850/60` is still read as the
 * step `850`. The `dark:` and `hover:` prefixes are part of the utility name and are not
 * part of the capture, so `dark:bg-gray-800` and `bg-gray-800` are the same lookup.
 */
const UTILITY = /\b(?:bg|text|border|ring|outline|fill|stroke|shadow|from|via|to|divide|decoration|accent|caret|placeholder)-([a-z]+)-(\d{2,3})\b/g;

describe('colour steps used by the app', () => {
  it('every one of them exists in the palette', () => {
    const unknown = SCANNED.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [...text.matchAll(UTILITY)]
        .filter(([, hue, step]) => !PALETTE.has(`${hue}-${step}`))
        .map(([, hue, step]) => `${hue}-${step} in ${file}`);
    });

    expect(unknown).toEqual([]);
  });

  /**
   * The control for the scan above, which is a regex over a directory listing and would
   * pass just as happily on an empty one. These two are real, in real files, and reach
   * the check through exactly the same path as a bad step would.
   */
  it('finds the steps that are there', () => {
    const found = new Set(
      SCANNED.flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(UTILITY)].map(([, hue, step]) => `${hue}-${step}`),
      ),
    );

    expect(found.has('gray-800')).toBe(true);
    expect(found.has('gray-700')).toBe(true);
  });
});
