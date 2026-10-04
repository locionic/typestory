import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Navbar from '../components/Navbar';
import TypingEngine from '../components/typing/TypingEngine';
import { NAV_ROUTES } from '../lib/routes';

/**
 * Two controls in this app are labelled only on wide screens.
 *
 * Both the header's stats button and the board's keyboard toggle carry a
 * `<span className="hidden sm:inline">` around their visible label, so below 640px the
 * label is `display: none` and the button is an icon with nothing but a `title` beside it.
 * Content in `display: none` is excluded from the accessible name, and a `title` is not an
 * accessible name at all, so a screen reader on a phone announces "button" for both.
 *
 * The phone is not a marginal case here: this codebase says so in its own comments, twice —
 * the sound selector was unhidden from `lg:flex` for exactly this reason, on the grounds
 * that hiding a control on small screens "made this the only control for the switch sound,
 * and hid it on every screen under 1024px — including the phone this header's own comment
 * calls the primary device". Labelling is the same failure arriving by a different route:
 * nothing is hidden in the source, so it reads as labelled.
 */
const mocks = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

vi.mock('next/link', async () => {
  const { createElement: el } = await import('react');
  return {
    default: ({ href, children, ...rest }: Record<string, unknown>) =>
      el('a', { href, ...rest }, children as never),
  };
});

// Confetti draws to a canvas jsdom does not implement, and the engine fires it the moment
// a passage completes.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

function render(node: ReturnType<typeof createElement>): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

/**
 * The text of `el` that survives at every width.
 *
 * A class token of exactly `hidden` takes the element to `display: none`; a token like
 * `sm:inline` is scoped to a breakpoint, so it is not hiding anything by default. jsdom
 * applies no Tailwind, so rendering will not hide these spans for us and `textContent`
 * would report a label that a phone never shows — which is why this reads the class
 * instead of trusting the DOM's own idea of what is visible.
 */
function alwaysVisibleText(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      // `instanceof Element` rather than `nodeType === 1`: the latter narrows to
      // ChildNode, which has no getAttribute, and the build rejects it.
      if (child instanceof Element) {
        const tokens = (child.getAttribute('class') ?? '').split(/\s+/);
        if (!tokens.includes('hidden')) walk(child);
      } else if (child.nodeType === 3) {
        parts.push(child.textContent ?? '');
      }
    }
  };
  walk(el);
  return parts.join('').trim();
}

/**
 * The name a control is left with once the layout is narrow.
 *
 * `aria-label` or visible text, which is the rule this codebase has already settled on
 * (`test/tailwindColours.test.ts`, and the catalog block in `test/storyReader.test.ts`):
 * `title` and `placeholder` are not names. `aria-labelledby` is not consulted because
 * nothing in the app uses it to name a control.
 */
function nameAtNarrowWidth(el: Element): string {
  return el.getAttribute('aria-label')?.trim() || alwaysVisibleText(el);
}

/** Every control on `host` whose name would be empty on a phone. */
function unnamedWhenNarrow(host: HTMLElement): string[] {
  return [...host.querySelectorAll('button')]
    .filter((b) => !nameAtNarrowWidth(b))
    .map((b) => b.getAttribute('title') ?? b.textContent?.trim() ?? '(no title, no text)');
}

/**
 * Whether `el` itself, or anything wrapping it, is `display: none` at the narrowest width.
 *
 * A bare `hidden` token with no breakpoint-scoped companion: `hidden sm:inline` is not
 * hidden at every width, `hidden lg:flex` is — which is the whole difference, and the
 * reason the token is read alone rather than as a prefix match. Same class-list reading as
 * `alwaysVisibleText` above, walking *up* instead of down, because a control can be hidden
 * by the row it sits in just as easily as by itself.
 *
 * `hidden` is the whole vocabulary, and `sr-only` is deliberately not in it. `sr-only` does
 * take content off the screen — that is half of what it is for — but it leaves it in the
 * accessibility tree, which is the other half and the reason to use it. Four places here
 * rely on that: the search box's label, the placement test's `<legend>`, the tutor's
 * question-box label, and `TypingEngine.tsx:425`, a `role="status"` element that carries
 * `lastKeystroke` and exists for no other reason than to be announced. Reading `sr-only` as
 * hidden would invert the rule these helpers exist to state, and would report the one
 * element on the board that is guaranteed to be in the tree as the one that is not.
 * `opacity-0` is a different case — it hides without removing from the tree, like `sr-only`
 * — and does not occur in this repo at all.
 *
 * What actually regressed here was `hidden lg:flex`, on the sound selector, and that is
 * what this reports.
 */
function hiddenAtNarrowWidth(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if ((node.getAttribute('class') ?? '').split(/\s+/).includes('hidden')) return true;
  }
  return false;
}

/**
 * The one control a phone could not reach at all.
 *
 * The switch-sound `<select>` was the only way to mute, and it sat behind `hidden lg:flex`,
 * so it did not exist on any screen under 1024px — including the phone this header's own
 * comment calls the primary device, on the grounds this file's header quotes verbatim.
 * Someone practising in a library had no way to stop the clicky default.
 *
 * `unnamedWhenNarrow` cannot catch that even in principle: it collects `button` elements,
 * and this is a `<select>`. The blocked e2e flow can, but only by measuring
 * `getClientRects()` in a real browser — and jsdom applies no Tailwind and no layout, so
 * every element on the page reports zero client rects here and that measurement is
 * unavailable. The class list is what is left, and this file already reads it for exactly
 * this reason.
 *
 * The choice is also asserted, because it is the other half: a control with no accessible
 * name and one that is off-screen both fail the same learner, and the e2e selects this
 * element by that name.
 */
describe('the sound control survives the narrow layout', () => {
  it('is in the header, named, and not behind a wrapper that hides it', () => {
    const host = render(createElement(Navbar));
    const select = host.querySelector('select');
    if (!select) throw new Error('the header renders no sound control');

    expect(select.getAttribute('aria-label')).toBe('Select keyboard sound effect');
    expect(hiddenAtNarrowWidth(select)).toBe(false);
  });

  /**
   * The control for the walk above, on real markup rather than one written here.
   *
   * The stats button's label is `hidden sm:inline` and its stats text is behind the same
   * treatment, so the header does contain elements the narrow layout hides — and every one
   * of them must be reported hidden, the ones nested several levels down included. If this
   * found nothing, the test above would be asserting `false` about an empty walk and would
   * pass for a navbar with no controls at all.
   */
  it('reports as hidden every element the narrow layout does hide', () => {
    const host = render(createElement(Navbar));
    const hidden = [...host.querySelectorAll<HTMLElement>('[class]')].filter((el) =>
      (el.getAttribute('class') ?? '').split(/\s+/).includes('hidden'),
    );

    expect(hidden.length).toBeGreaterThan(0);
    for (const el of hidden) expect(hiddenAtNarrowWidth(el)).toBe(true);
  });
});

/**
 * Every route, on the width this app calls primary.
 *
 * The header's own comment records the regression: the nav used to be `hidden md:flex`,
 * which took all six routes off every screen under 768px. That is not a lost affordance,
 * it is the whole product — the header's controls narrow to icons beside the brand, and
 * the routes were the other thing on the line. It was fixed here and in `lib/routes.ts`
 * (where the footer had the same bug one component down) and both fixes are comments and
 * classes: nothing in the runnable suite asked for them, so nothing in it would notice
 * their return. `hidden md:flex` compiles, renders, and passes every test in this file
 * except the one below.
 *
 * Reachability is checked two ways because they fail apart. Hidden is what `hiddenAtNarrowWidth`
 * sees. The label is what `alwaysVisibleText` sees, and a nav link can be visible and still
 * say nothing — the label sits in a bare `<span>` today, and the `hidden sm:inline` wrapper
 * that broke two buttons this session would break it silently, since a nav link has no `title`
 * to fall back on and a link with no name is announced as nothing at all.
 *
 * Derived from `NAV_ROUTES` rather than written out, because a list here would be a copy
 * that drifts — and would keep passing after a route was dropped from the header, which is
 * the failure this file exists to catch.
 */
describe('every route in the header nav survives the narrow layout', () => {
  it('is a link that is neither hidden nor blank at narrow widths', () => {
    const host = render(createElement(Navbar));
    const links = [...(host.querySelector('nav')?.querySelectorAll('a') ?? [])];

    // The precondition. A `hidden md:flex` regression takes the links off the page
    // without removing them, so every assertion below would pass on an empty list.
    expect(links).toHaveLength(NAV_ROUTES.length);

    for (const { href, label } of NAV_ROUTES) {
      const link = links.find((a) => a.getAttribute('href') === href);
      if (!link) throw new Error(`the header nav has no link to ${href}`);

      expect(hiddenAtNarrowWidth(link), `${href} is hidden below 768px`).toBe(false);
      expect(alwaysVisibleText(link), `${href} has no label a phone would show`).toBe(label);
    }
  });
});

describe('controls keep their name when the layout narrows', () => {
  it('names every button in the header', () => {
    const host = render(createElement(Navbar));
    expect(unnamedWhenNarrow(host)).toEqual([]);
  });

  it('names every button on the board', () => {
    const host = render(createElement(TypingEngine));
    expect(unnamedWhenNarrow(host)).toEqual([]);
  });

  /**
   * The control, and the only thing standing between this file and a green suite that
   * checked nothing.
   *
   * A helper written as `textContent` — the obvious version, and the one that reads best
   * — returns "Keyboard" for the span below and every test above would pass with both
   * defects still shipping. So the exclusion is asserted directly, on a button shaped
   * exactly like the two that are broken.
   */
  it('reads a label the narrow layout hides as no label at all', () => {
    const button = document.createElement('button');
    button.setAttribute('title', 'Toggle touch-typing virtual keyboard');
    const label = document.createElement('span');
    label.className = 'hidden sm:inline';
    label.textContent = 'Keyboard';
    button.append(label);

    expect(button.textContent).toBe('Keyboard');
    expect(alwaysVisibleText(button)).toBe('');
    expect(nameAtNarrowWidth(button)).toBe('');
  });
});