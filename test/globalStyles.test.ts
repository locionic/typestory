import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A `var(--x)` that nothing declares, which silently means "no declaration at all".
 *
 * `app/globals.css` set `--font-sans: var(--font-geist-sans)` and `--font-mono:
 * var(--font-geist-mono)`, and neither `--font-geist-*` was declared anywhere — no
 * `next/font` import, no `:root`, no other stylesheet. The whole app rendered in the
 * browser's default font, and said nothing about it.
 *
 * The mechanism is the part worth keeping. Tailwind's preflight is
 * `font-family: var(--default-font-family, -apple-system, BlinkMacSystemFont, …)`, and a
 * fallback list is the *second* argument of `var()`: it applies only when the first is
 * undefined. Overriding `--font-sans` made `--default-font-family` *defined* — as a
 * reference to something that was not — so the real fallback list never came into play
 * and the declaration was invalid at computed value time, all the way down to the root.
 * `.font-sans` on `<body>` was dead by the same route, which is also why the hand-written
 * `body { font-family: Arial }` beneath it never showed: the class outranks the element.
 *
 * Reads like a deliberate stack and renders as the browser's default. Nothing warns.
 */
const STYLESHEET = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
const TAILWIND = readFileSync(join(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');

const declared = new Set(
  [...`${TAILWIND}\n${STYLESHEET}`.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(([, name]) => name),
);

/** Every `var(--name)` in the stylesheet, fallback list included. */
const referenced = [...STYLESHEET.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(([, name]) => name);

describe('the stylesheet', () => {
  it('was read, rather than silently matching nothing', () => {
    expect(referenced.length).toBeGreaterThan(0);
    // Tailwind's own theme is large; a regex that quietly stopped matching would leave
    // this at zero and make every assertion below vacuously pass.
    expect(declared.size).toBeGreaterThan(300);
  });

  it('reads only variables that something declares', () => {
    const dangling = [...new Set(referenced)].filter((name) => !declared.has(name));

    expect(dangling).toEqual([]);
  });

  /**
   * The control.
   *
   * The two variables above are the check's whole subject — they are declared in `:root`,
   * they are what `body` reads for its background and colour, and they go through the same
   * `declared` set as the dangling ones did. So this fails if the parsing is broken rather
   * than proving the list above is genuinely empty.
   */
  it('still reads the two it does declare', () => {
    for (const name of ['--background', '--foreground']) {
      expect(referenced).toContain(name);
      expect(declared.has(name)).toBe(true);
    }
  });
});

/**
 * An `animate-*` class the theme has never heard of.
 *
 * `animate-fadeIn` sat on the typing engine's completion card and on the stats modal's
 * backdrop. Tailwind declares its animations as `--animate-*` keys — four of them, in the
 * theme read above — and `fadeIn` was in none of them, with no `@keyframes` for it anywhere
 * in the app. So the class generated no rule at all: two elements carried a class that
 * styled nothing, and the reduced-motion block in `app/globals.css` was credited with
 * silencing two animations that had never run.
 *
 * Nothing warns about this. An unknown utility is not an unknown class — it compiles, it
 * ships, and it leaves no trace in the built stylesheet to go looking for, which is the
 * same failure shape as the `--font-geist-*` variables above with the variable layer taken
 * off. Read off the theme rather than listed here, for the reason the whole file is about:
 * a hand-written list of the four animation names would agree with Tailwind only until
 * Tailwind shipped a fifth.
 */
const used = new Set<string>();
for (const dir of ['app', 'components']) {
  for (const path of readdirSync(join(process.cwd(), dir), { recursive: true, encoding: 'utf8' })) {
    if (!path.endsWith('.tsx')) continue;
    const source = readFileSync(join(process.cwd(), dir, path), 'utf8');
    for (const [, name] of source.matchAll(/\banimate-([A-Za-z0-9-]+)/g)) {
      used.add(`animate-${name}`);
    }
  }
}

const defined = new Set(
  [...`${TAILWIND}\n${STYLESHEET}`.matchAll(/--animate-([A-Za-z0-9-]+)\s*:/g)].map(([, name]) => `animate-${name}`),
);

describe('the animations the app asks for', () => {
  /**
   * The control, and the reason the list below is not simply "there are none". `animate-spin`
   * is Tailwind's own and is in both sets, so this fails if either regex stopped matching
   * rather than proving the dangling list is genuinely empty.
   */
  it('finds an animation in the components and the same one in the theme', () => {
    expect(used.has('animate-spin')).toBe(true);
    expect(defined.has('animate-spin')).toBe(true);
  });

  it('are all defined by the theme or by the stylesheet', () => {
    const dangling = [...used].filter((cls) => !defined.has(cls));

    expect(dangling).toEqual([]);
  });
});