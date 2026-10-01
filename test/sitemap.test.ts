import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sitemap from '../app/sitemap';

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
});
