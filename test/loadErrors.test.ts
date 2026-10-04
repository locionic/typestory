import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ComponentType } from 'react';
import WritingPage from '../app/writing/page';
import TutorPage from '../app/tutor/page';
import PlacementPage from '../app/placement/page';

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no scrolling. The tutor scrolls its transcript to the newest turn on
// every change, which this file never reaches — the stub is here because it costs one line
// and the tutor is one of the three pages under it.
Element.prototype.scrollIntoView = vi.fn();

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  // `/writing` and `/placement` both restore their last work from localStorage on mount, so
  // a test that left a draft or a result behind turns the next test's fresh mount into that
  // state instead of the editor or the quiz.
  localStorage.clear();
  vi.unstubAllGlobals();
});

/**
 * The three pages that fetch a bundle before they can be used.
 *
 * One file rather than three tests in the three files that already own these pages, because
 * the defect is one defect: the same six-line branch, byte-identical in all three, and the
 * same one attribute missing from all three. Split across three files it would read as
 * three coincidences.
 */
const PAGES: Record<string, ComponentType> = {
  '/writing': WritingPage,
  '/tutor': TutorPage,
  '/placement': PlacementPage,
};

/**
 * Mount `page` against a GET that never comes back — the state `loadError` exists for.
 *
 * Each route's GET is an unconditional 200 (`app/api/writing/route.ts:34`,
 * `app/api/tutor/route.ts:37`), so this is not a missing key; it is the transport, and a
 * rejected promise is what the browser gives for the DNS, connection and offline cases. A
 * non-ok response takes the identical path, which is the other half and needs no second test.
 */
async function renderLoadFailure(page: ComponentType): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(page));
  });
  return host;
}

/**
 * What a screen reader is told when the bundle never arrives.
 *
 * This branch replaces the whole page, so it has exactly the property the submit-error
 * paragraph was given `role="alert"` for on the same three pages: the failure is the whole
 * result of what the learner did, and nothing else is on screen to say it. Only this branch
 * is worse. On a submit failure the form, the transcript and the heading are all still there,
 * and the error is one more thing among them; here the page was promising something a
 * moment ago and has stopped, focus is on `<body>` because nothing that renders is
 * focusable, and there is no live region to announce the change. A sighted learner sees the
 * page give up. A screen reader user is left in silence on a page they cannot type into,
 * with no way to tell it apart from one that never loaded.
 *
 * The loading state immediately before it *is* announced — `role="status"` on the spinner —
 * so the accessibility tree was built deliberately on these pages, and the one state where
 * being told matters most is the one that was left out. All three, in the same shape, in a
 * branch copied verbatim between them.
 */
describe('a bundle that never arrives', () => {
  for (const [route, page] of Object.entries(PAGES)) {
    it(`${route} says so in a live region`, async () => {
      const host = await renderLoadFailure(page);

      // The precondition, and the reason the assertion below cannot pass vacuously: the
      // page really is the error state and not a form that merely failed to appear. These
      // three render an icon and a sentence between them, and nothing else.
      expect(host.querySelector('textarea, input, button, form')).toBeNull();

      const alert = host.querySelector('[role="alert"]');
      expect(alert, `${route} fails in silence`).toBeTruthy();

      // Read off the page rather than written down, because the copy is production copy and
      // a second copy of it here would be one that drifts. The error state *is* this
      // sentence and nothing else, so the whole document is the alert — which also rules
      // out a region that is present and empty, or one wired to something else. Emptiness
      // is asserted because a textContent check would sail past it.
      expect(alert?.textContent?.trim()).not.toBe('');
      expect(host.textContent?.trim()).toBe(alert?.textContent?.trim());
    });
  }
});
