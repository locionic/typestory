import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import NotFound from '../app/not-found';
import ErrorPage from '../app/error';

/**
 * The two pages the app had no clothes for.
 *
 * One file rather than one test each, because the defect was one defect: `notFound()` and an
 * uncaught render error both dropped the learner onto a framework page with no Navbar, no
 * footer and no dark mode, and both sat inside a root layout that already had all three. One
 * file also makes the pair's *difference* readable, which is the part most likely to be
 * broken by someone tidying them into one shape — see the `role="alert"` assertions.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
});

async function render(Component: () => React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(Component));
  });
  return host;
}

/** The anchors on the page, as `[text, href]`. */
const links = (host: HTMLElement): [string, string][] =>
  [...host.querySelectorAll('a')].map((a) => [
    a.textContent?.trim() ?? '',
    a.getAttribute('href') ?? '',
  ]);

const heading = (host: HTMLElement): string => host.querySelector('h1')?.textContent?.trim() ?? '';

describe('the page a wrong address gets', () => {
  it('says what happened, and offers both ways back', async () => {
    const host = await render(NotFound);

    expect(heading(host)).toBe('Page not found');
    // `/stories` first: it is the Navbar's own "Start Practice" destination, so a learner
    // who mistyped a story URL most likely wanted that rather than the landing page.
    expect(links(host)).toEqual([
      ['Browse all stories', '/stories'],
      ['Back to home', '/'],
    ]);
  });

  /**
   * The framework's copy, gone.
   *
   * This is the assertion that fails if someone deletes the file and lets the built-in 404
   * back in — which is what the page was before, and which is why the file exists at all.
   * Asserting the heading alone would not catch it: the built-in page has a heading too.
   */
  it('is not the framework default wearing our classes', async () => {
    const host = await render(NotFound);

    expect(host.textContent).not.toContain('could not be found');
  });

  /**
   * No live region here, and that is deliberate.
   *
   * `app/tutor/page.tsx` and `app/writing/page.tsx` both put `role="alert"` on the paragraph
   * that replaces a loaded page, and the reasoning there is sound: it interrupts a learner
   * who is already looking at something. This page *is* the whole document on arrival, so an
   * alert would announce itself against nothing. Pinned so the two files are not later
   * tidied into one shape — the `role="alert"` below is the counterpart.
   */
  it('does not interrupt, because it is the whole document', async () => {
    const host = await render(NotFound);

    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('the page a crash gets', () => {
  /**
   * The prop is `retry`, and that is the whole reason this file was worth reading the bundled
   * docs for: `reset` is the name this prop has everywhere else in the React and Next
   * ecosystem, `retry` became stable only in v16.3.0, and a page written against the older
   * name renders a button whose handler is `undefined` — clicking it throws inside the
   * handler and the learner gets the error page again, which is the one thing they were told
   * not to do.
   *
   * Verified by canary: renaming the call to `reset` leaves the rest of this file green and
   * fails exactly this assertion.
   */
  it('offers a way back that re-fetches rather than re-rendering', async () => {
    const retry = vi.fn();
    const host = await render(() =>
      createElement(ErrorPage, { error: new Error('boom'), retry }),
    );

    const button = [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Try again',
    );
    expect(button).toBeDefined();
    // `type="button"`, like all thirty-four buttons already in the app: without it this one
    // is a submit button by default, and the rule is only true if every button keeps it.
    expect(button?.getAttribute('type')).toBe('button');

    act(() => {
      button?.click();
    });

    expect(retry).toHaveBeenCalledTimes(1);
  });

  /**
   * The counterweight to the assertion above, and what makes that one mean something.
   *
   * Without it the "Try again" test would still pass against a component that renders
   * nothing usable — so this one proves the page rendered its heading and its link, and the
   * other proves the button is wired to the framework's function and not merely present.
   */
  it('renders the page at all', async () => {
    const host = await render(() =>
      createElement(ErrorPage, { error: new Error('boom'), retry: vi.fn() }),
    );

    expect(heading(host)).toBe('Something went wrong');
    expect(links(host)).toEqual([['Back to home', '/']]);
  });

  /**
   * The one place the error *is* announced, because unlike `not-found.tsx` this branch
   * replaces content somebody is already looking at. Same reasoning, and the same attribute,
   * as the load-error paragraph on the tutor and writing pages.
   */
  it('announces itself, because it interrupts a page in progress', async () => {
    const host = await render(() =>
      createElement(ErrorPage, { error: new Error('boom'), retry: vi.fn() }),
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('hit an error');
  });

  /**
   * The console line is the diagnostic, not a leftover.
   *
   * The routes log their own failures, but a render error on the client never reaches those
   * logs — this effect is the only trace of it, and in production the message is scrubbed to
   * a generic one, so `error.digest` rides along in it as the only thing identifying which
   * error it was. Removing it would leave nothing to report from.
   */
  it('logs the error, which is the only trace of it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await render(() =>
      createElement(ErrorPage, { error: new Error('boom'), retry: vi.fn() }),
    );

    expect(logged).toHaveBeenCalledTimes(1);
    expect((logged.mock.calls[0][0] as Error).message).toBe('boom');
  });

  /**
   * What it must not say.
   *
   * The temptation on an error page is to reassure: "your progress is safe". A render error
   * in one segment says nothing about the store or the backup, and the backup has a real
   * state where it is stopped and out of reach. So the copy is not allowed to mention either,
   * because on this page the promise could not be kept.
   */
  it('promises nothing about saved progress', async () => {
    const host = await render(() =>
      createElement(ErrorPage, { error: new Error('boom'), retry: vi.fn() }),
    );

    expect(host.textContent).not.toMatch(/progress|backup|still (safe|saved)/i);
  });
});