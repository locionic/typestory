import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sitemap from '../app/sitemap';
import robots from '../app/robots';

const APP_DIR = path.join(process.cwd(), 'app');

/**
 * `/writing` shipped with a page, a nav link and an API route — and no sitemap
 * entry, so the one route a search engine should send a learner to was the one it
 * was never told about. A list is exactly the thing nothing else fails on when it
 * drifts, so pin it.
 */
describe('sitemap', () => {
  const routes = sitemap().map((entry) => new URL(entry.url).pathname);

  const pageRoutes = readdirSync(APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'api')
    .map((entry) => entry.name)
    // A directory with no page.tsx is a segment, not a route.
    .filter((name) => existsSync(path.join(APP_DIR, name, 'page.tsx')));

  it('registers every page route in the app directory', () => {
    // Dynamic segments are registered by their own entries (one per story), so a
    // segment only has to be reachable as its own prefix.
    const unregistered = pageRoutes.filter((name) => !routes.includes(`/${name}`));
    expect(unregistered).toEqual([]);
  });

  it('emits absolute URLs on one origin', () => {
    const origins = new Set(sitemap().map((entry) => new URL(entry.url).origin));
    expect(origins.size).toBe(1);
  });

  it('lists no URL twice', () => {
    expect(new Set(routes).size).toBe(routes.length);
  });

  /**
   * A modification date, or nothing. Not the build clock.
   *
   * Every entry carried `new Date()`, which is when the build ran, presented to a crawler
   * as when the page last changed. Seventeen URLs behind static literals, so each build
   * claimed all of them had been edited. Nothing here can know a real date, and the spec
   * treats the field as optional, so the honest entry is no entry.
   *
   * Asserted as an absence because that is the change: someone adding a genuine
   * `lastModified` back has to update this deliberately, which is the point. The value
   * itself is not checkable here — only that it stopped being invented.
   */
  it('claims no modification date it cannot know', () => {
    const claimed = sitemap()
      .filter((entry) => entry.lastModified)
      .map((entry) => new URL(entry.url).pathname);
    expect(claimed).toEqual([]);
  });
});

/**
 * The other half of what a crawler is told, and the half with no coverage at all until now.
 *
 * `app/robots.ts` shipped untested, which is how its origin came to be a fourth copy of
 * the site URL — `lib/site.ts` says the story. The policy below is the part that still
 * needed a test rather than a constant: `disallow` is one string, and a typo in it is
 * invisible everywhere except in a search index days later.
 */
describe('robots', () => {
  it('keeps the API out of the index and the rest of the site in it', () => {
    const rules = robots().rules as { userAgent: string; allow: string; disallow: string };

    expect(rules.userAgent).toBe('*');
    // Both halves, because a blanket `Disallow: /` satisfies the first and de-indexes the
    // entire product — the one failure in this file that a learner's own visit would not
    // show them.
    expect(rules.disallow).toBe('/api/');
    expect(rules.allow).toBe('/');
  });

  /**
   * The invariant that three copies of a literal broke, kept as a test anyway.
   *
   * `SITE_URL` now makes it structural, so this cannot fail without someone editing the
   * constant or bypassing it — which is the point of the assertion, not a redundancy. The
   * outcome it describes is the one that is invisible from inside the app: robots.txt
   * advertising a sitemap URL on a host that does not serve it, so the crawler follows the
   * pointer and 404s on every entry the sitemap lists.
   */
  it('points at the sitemap on the origin the entries are written with', () => {
    // Next types this as `string | string[] | undefined`, since a robots file may name
    // several sitemaps or none. Thrown rather than asserted, so the failure says which of
    // the three it is instead of surfacing as a confusing `undefined` further down.
    const pointer = robots().sitemap;
    if (typeof pointer !== 'string') throw new Error('robots names no single sitemap URL');

    const origin = new URL(pointer).origin;
    const entries = sitemap().map((entry) => new URL(entry.url).origin);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((o) => o === origin)).toBe(true);
  });
});
