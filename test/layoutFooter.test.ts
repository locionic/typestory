import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RootLayout from '../app/layout';
import { NAV_ROUTES } from '../lib/routes';

/**
 * The header needs a router context and a persisted-stats read, neither of which exists
 * outside the App Router. It is not what is under test — the footer is — so it is stubbed
 * out. The route list it is compared against comes from `lib/routes` directly, which is
 * the point: the two have to agree because they read the same thing.
 */
vi.mock('../components/Navbar', () => ({ default: () => null }));

/** The routes the footer links to, in the order it renders them. */
function footerHrefs(): string[] {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(createElement(RootLayout, null, null));
  const footer = host.querySelector('footer');
  if (!footer) throw new Error('the layout rendered no footer');
  return [...footer.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!);
}

/**
 * Where the footer sends you.
 *
 * The layout held two hand-written lists of the same routes and they had drifted. The
 * header publishes six — Stories, Word Banks, Placement, Writing, Tutor, Paste Text — and
 * the footer published three of them, so Placement, Writing and Tutor were reachable only
 * from the nav. That matters most where the nav is hardest to use: it wraps to a second
 * row below 768px, and the nav's own comment names the phone as this app's primary
 * device. The footer is the one fixed position on every page.
 *
 * It is the Navbar comment's own bug — six hand-copied blocks, one rule — unfixed one
 * component down. Same fix, same reason: one list, read twice, cannot drift.
 */
describe('the footer reaches every route the header does', () => {
  it('links all of them', () => {
    expect(footerHrefs()).toEqual(NAV_ROUTES.map((route) => route.href));
  });

  /**
   * The control. Three hand-written hrefs against a six-route header is what the footer
   * actually rendered; if that comparison could pass, the test above would be green with
   * Placement, Writing and Tutor still unreachable.
   */
  it('tells a complete footer apart from the one it replaced', () => {
    expect(['/stories', '/vocab', '/custom']).not.toEqual(NAV_ROUTES.map((r) => r.href));
  });
});

/**
 * Of every href on that list, which ones no longer lead to a page.
 *
 * Resolved against the repo rather than a rendered route table, because the App Router
 * serves a route by the mere existence of `app/<href>/page.tsx` — there is no other
 * registry to check against, and a test that imported the pages would import React and
 * four route handlers to learn the same thing.
 */
function missingPages(hrefs: readonly string[]): string[] {
  // `process.cwd()` rather than `import.meta.url`, which under this config is not a
  // `file:` URL — see the same note in test/reducedMotion.test.ts.
  const app = path.join(process.cwd(), 'app');
  return hrefs.filter((href) => !existsSync(path.join(app, href, 'page.tsx')));
}

/**
 * The list itself, which the deduplication above only bounds in one direction.
 *
 * "One list, read twice, cannot drift" is true of the header against the footer, and says
 * nothing about either of them against the routes that exist. Deleting a page takes the
 * header's copy with it — this file's own fix makes the two agree instantly on a link
 * neither can reach — so a single `rm app/tutor` would publish a 404 from the header and
 * the footer together, on every page, with both suites green. The footer is the one fixed
 * position on every page, which is what made it worth deduplicating in the first place.
 */
describe('the routes the header and footer both publish', () => {
  it('are pages that exist', () => {
    expect(missingPages(NAV_ROUTES.map((route) => route.href))).toEqual([]);
  });

  /**
   * The control. A lookup that silently answered "nothing is missing" would report all six
   * as live, so the assertion above would pass with the directory gone — which is the
   * exact failure it exists to catch.
   */
  it('notices a route that is not there', () => {
    expect(missingPages(['/tutor'])).toEqual([]);
    expect(missingPages(['/tutor', '/retired'])).toEqual(['/retired']);
  });
});