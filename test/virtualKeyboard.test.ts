import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import VirtualKeyboard, { KEYBOARD_ROWS } from '../components/typing/VirtualKeyboard';

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => act(() => root.unmount()));

/** Render the board for one next-target character and hand back its text. */
function renderKeyboard(expectedChar: string): string {
  act(() => root.render(createElement(VirtualKeyboard, { expectedChar })));
  return host.textContent ?? '';
}

/**
 * The "Hold Shift" prompt, and the list of keys that earns it.
 *
 * `requiresShift` decides this with its own array of 21 shifted symbols while the keys
 * that are actually shifted live in `KEYBOARD_ROWS` as `shiftDisplay` — the same
 * information, written down twice. The two agree today, so nothing is broken; what is
 * broken is that nothing makes them agree.
 *
 * `KEYBOARD_ROWS` is the file's own statement of the layout, and it is already exported
 * so the corpus can be measured against it (see `test/content.test.ts`, which builds its
 * typable-character set from these same rows). So a key added to the layout appeared on
 * screen and in that test, and *only* failed to raise the Shift prompt — the one thing a
 * learner is told when they are about to type it. Nothing failed, because the copy that
 * had to change was a literal somebody had to remember.
 *
 * The invariant is stated as an enumeration rather than as "the two arrays are equal"
 * because the equality is the thing that has to stop being checkable: the point is that
 * there is no second list left to disagree.
 */
describe('the Shift prompt', () => {
  it('appears for every shifted key the layout declares', () => {
    const shifted = KEYBOARD_ROWS.flat()
      .map((key) => key.shiftDisplay)
      .filter((symbol): symbol is string => Boolean(symbol));

    // The control. A layout with no shifted keys would satisfy the loop below by never
    // running it, which is the one way this test could pass having checked nothing.
    expect(shifted.length).toBeGreaterThan(0);

    for (const symbol of shifted) {
      expect(renderKeyboard(symbol), `no Shift prompt for ${JSON.stringify(symbol)}`).toContain(
        'Hold Shift',
      );
    }
  });

  /**
   * The other half of the rule, and a separate branch: an uppercase letter is shifted
   * without appearing in any `shiftDisplay`, because the key it lives on is the lowercase
   * one. Reading the shifted-symbol list alone would miss every capital.
   */
  it('appears for an uppercase letter, which is shifted without a shifted symbol', () => {
    expect(renderKeyboard('Q')).toContain('Hold Shift');
  });

  /**
   * The control for the test above, and the reason it is not simply "the prompt is always
   * there": a plain lowercase key takes no modifier, and a learner told to hold Shift
   * for every letter would be typing wrong.
   */
  it('does not appear for a lowercase letter', () => {
    expect(renderKeyboard('q')).not.toContain('Hold Shift');
  });
});
/** The finger the board names for `expectedChar`, or '' when it names none. */
function fingerHint(expectedChar: string): string {
  act(() => root.render(createElement(VirtualKeyboard, { expectedChar })));
  return /Suggested:\s*([A-Za-z() ]+)/.exec(host.textContent ?? '')?.[1].trim() ?? '';
}

/**
 * The keys the board lights up as the next to press.
 *
 * `ring-indigo-400` is on the highlight branch and nowhere else, so it is the discriminator
 * — `bg-indigo-600` will not do, the "Next Target" badge wears that too.
 */
function highlightedKeys(expectedChar: string): string[] {
  act(() => root.render(createElement(VirtualKeyboard, { expectedChar })));
  return [...host.querySelectorAll('div')]
    .filter((el) => (el.getAttribute('class') ?? '').includes('ring-indigo-400'))
    .map((el) => el.textContent ?? '');
}

/**
 * The board showed a character and then said nothing about pressing it.
 *
 * `normalizeTypableText` keeps accented characters on purpose — on a French or Brazilian
 * layout `é` is one keystroke, so rewriting it to `e` would force exactly the wrong thing
 * on exactly the learners who pasted it. But keeping the character put the board's own
 * two jobs on opposite sides of that decision. It printed the character in "Next Target",
 * and every key on the board went dark and the finger line stayed empty, because `é` is
 * on no key in `KEYBOARD_ROWS`. The learner was told what to type and given no means of
 * typing it, on the one screen in the app built to show them how.
 *
 * The finger and the key are knowable: `é` is `e` with a mark on it, and the key for `e`
 * is right there. Stripping the mark is a lookup, not an edit — the character on screen and
 * the character to press are both left exactly as they were.
 */
describe('a target the board can locate', () => {
  it('names the finger of the letter an accented character is built on', () => {
    expect(fingerHint('é')).toBe('Left Middle Finger');
  });

  it('lights the key that letter lives on', () => {
    expect(highlightedKeys('é')).toEqual(highlightedKeys('e'));
    expect(highlightedKeys('é')).not.toEqual([]);
  });

  /**
   * The same gap one branch over. `requiresShift` asks whether the character is `A`–`Z`,
   * and `É` is not in that range, so the accented capital raised no prompt either — the
   * learner pressing the unshifted key gets a different character from the one on screen.
   */
  it('raises the Shift prompt for an accented capital', () => {
    expect(renderKeyboard('É')).toContain('Hold Shift');
    expect(highlightedKeys('É')).toContain('Shift');
  });

  /**
   * The control, in the same shape as the one above `requiresShift`: a character with no
   * base letter to fall back to must still be left alone. It wants a character the board
   * genuinely cannot place — an ideograph, which has no key on a US layout and no canonical
   * decomposition for the fallback to strip. A `~` would not do, being on the backtick key,
   * where naming a finger is right. A fallback that answered for everything would have this
   * passing having checked nothing.
   */
  it('still names no finger for a character with no letter under it', () => {
    expect(fingerHint('学')).toBe('');
    expect(highlightedKeys('学')).toEqual([]);
  });
});
