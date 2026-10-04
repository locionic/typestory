import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { STORIES } from '../data/stories';
import { OG_ALT, OG_IMAGE_URL, OG_SIZE, pageMetadata } from '../lib/site';
import { metadata } from '../app/layout';
import { metadata as storiesMetadata } from '../app/stories/page';
import { metadata as customMetadata } from '../app/custom/layout';
import { metadata as placementMetadata } from '../app/placement/layout';
import { metadata as tutorMetadata } from '../app/tutor/layout';
import { metadata as vocabMetadata } from '../app/vocab/layout';
import { metadata as writingMetadata } from '../app/writing/layout';
import { generateMetadata } from '../app/stories/[slug]/page';

/**
 * A card type that promises an image nobody ships.
 *
 * `summary_large_image` is the Twitter/X card that renders a 2:1 picture beside the text.
 * The app declared it twice — in the root layout and again on every story page — and had no
 * image of any kind: `public/` held the five untouched Next scaffold SVGs, there was no
 * `opengraph-image` or `twitter-image` file convention anywhere, and the one image-ish file
 * in `app/` was `favicon.ico`, which Next resolves to a `<link rel="icon">` and never to
 * `twitter:image`. Every share of every story was a text card, described as a large one.
 *
 * Nothing rendered wrong. Twitter falls back to a text card without an image, so this changed
 * no page anyone could see, which is what `lib/site.ts` calls the worst class of bug in this
 * repo: the screen looks right and the page works. The declaration was the only place the
 * claim existed, and leaving it is how it stays true by accident.
 *
 * What it could not do was tie a card to the page it belongs to. It only ever knew whether
 * *some* image shipped anywhere, so the day `app/opengraph-image.tsx` appeared it stopped
 * being a rule and became a coincidence — it would have gone on calling a page fine while
 * that page's card pointed at nothing. It is per-page now, and the rule has a second half
 * that a file scan can never supply: the image has to be the one *that page* reaches.
 *
 * The two reach theirs differently, which is most of why each needs its own assertion:
 *
 *   - `/` — the root file convention, which Next attaches to the root segment.
 *   - `/stories/[slug]` — an explicit `openGraph.images`. An explicit `openGraph` object wins
 *     over the file convention for that whole group, so the root file does *not* reach a
 *     story. Checked in the build output rather than assumed: with that file present,
 *     `index.html` carried `og:image` and every `stories/*.html` carried none.
 *
 * Deliberately not pinned, because it is Next's behaviour and not this app's: a story card's
 * `twitter:image`, `twitter:image:width` and `twitter:image:alt` are filled from
 * `openGraph.images` even though its `twitter` object names no images of its own. Confirmed
 * in the build output on 2026-10-04. Nothing here would catch Next changing that, and nothing
 * here claims to.
 */

/**
 * Comments removed, so prose about a card is never counted as a card.
 *
 * The lookbehind is the only clever part: it leaves the `//` in a URL alone. Everything else
 * here is a regular expression, and a stripper that understood strings would be more machinery
 * than a test over three declarations is worth. What it costs: a `//` inside a string literal
 * would truncate the rest of that line — no such literal exists in `app/`, and the control
 * below is what would notice if one appeared.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');
}

/**
 * Every place the card's value is written as a quoted string, with the file it came from.
 *
 * Scans for the *value* rather than for `card: '…'`, because the two are no longer the same
 * shape: the value moved out of a `twitter` object and into `TWITTER_CARD`, so a scan keyed
 * to the property would have found nothing at all and reported success. A scan that matches
 * nothing is the failure mode this file already has one of — see the control below.
 *
 * `app/` and `lib/`, not `test/`: this file names the value in its own assertions, and a scan
 * that counted those would be counting its own homework.
 *
 * The claim it buys: a page that wants a different card has to write the value out again, and
 * this is the list it would appear in.
 */
function cardValueLiterals(): { file: string; card: string }[] {
  const out: { file: string; card: string }[] = [];
  for (const dir of ['app', 'lib']) {
    for (const path of readdirSync(join(process.cwd(), dir), { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(path)) continue;
      const file = `${dir}/${path}`;
      const source = stripComments(readFileSync(join(process.cwd(), file), 'utf8'));
      for (const [, card] of source.matchAll(/'(summary_large_image)'/g)) out.push({ file, card });
    }
  }
  return out;
}

/**
 * The card type a page's metadata declares, or `undefined` when it declares none.
 *
 * `Twitter` is a union over five card shapes — summary, large image, player, app and the bare
 * metadata object — and only two of them carry `card`. So reading `.card` straight off it is a
 * type error, which Vitest will not catch: it strips types, so the assertion kept passing and
 * `tsc` was the only thing that noticed. Worth the three lines to say so rather than to cast.
 */
function declaredCard(meta: Metadata): string | undefined {
  const twitter = meta.twitter;
  return twitter && 'card' in twitter ? twitter.card : undefined;
}

/**
 * Next's two file conventions for a card image, matched by basename and nothing else.
 *
 * Deliberately not `icon.` / `apple-icon.`: those become `<link rel="icon">`, which no card
 * ever reads. And deliberately not "any file that looks like an image" — a PNG in `public/`
 * that nothing references is not an image this app has, and treating it as one is how the
 * check would have passed having checked nothing.
 */
function imageConventionFiles(): string[] {
  const out: string[] = [];
  for (const dir of ['app', 'public']) {
    for (const path of readdirSync(join(process.cwd(), dir), { recursive: true, encoding: 'utf8' })) {
      const name = path.split('/').pop() ?? path;
      if (/^(opengraph|twitter)-image\./.test(name)) out.push(`${dir}/${path}`);
    }
  }
  return out.sort();
}

/** Every route with a `page.tsx` under it, discovered from the filesystem rather than listed. */
function pageRoutes(): string[] {
  const out: string[] = [];
  for (const path of readdirSync(join(process.cwd(), 'app'), { recursive: true, encoding: 'utf8' })) {
    if (path !== 'page.tsx' && !path.endsWith('/page.tsx')) continue;
    const dir = path.slice(0, -'page.tsx'.length).replace(/\/$/, '');
    out.push(dir ? `/${dir}` : '/');
  }
  return out.sort();
}

describe('the card each shared link claims', () => {
  /**
   * The control.
   *
   * Both lists are named exactly rather than counted, because a scan that quietly stopped
   * matching leaves an empty list and every assertion downstream of it passes having looked at
   * nothing. That was not hypothetical: the first version of this file read
   * `shippedImages().length > 0 ? promising : []`, which is `[]` on both sides in the state
   * under test — no image shipped, so the answer was empty whichever card the app declared.
   *
   * The card list names one file, and it is a *structural* claim rather than a comment's: a
   * page that wanted a different card would have to write the value out again, and that is
   * exactly what this list would then be looking at.
   *
   * `app/opengraph-image.tsx` showing up in either list would mean the comment stripper
   * regressed. Its docstring names `card: 'summary_large_image'` in prose, and a scanner that
   * reads comments counts a description of a card as a card.
   */
  it('finds exactly the one card declaration, and the one image that backs it', () => {
    expect(cardValueLiterals()).toEqual([{ file: 'lib/site.ts', card: 'summary_large_image' }]);
    expect(imageConventionFiles()).toEqual(['app/opengraph-image.tsx']);
  });

  it('backs the root card with the image the root segment ships', () => {
    expect(declaredCard(metadata)).toBe('summary_large_image');
    expect(imageConventionFiles()).toContain('app/opengraph-image.tsx');
  });

  /**
   * Unconditional over the corpus, so no story is quietly exempt from it.
   *
   * `expect(STORIES.length)` comes first because a loop over an empty corpus is a test that
   * passes having checked nothing — the shape of the failure this file already had once.
   */
  it('backs every story card with a picture of the size the card is drawn at', async () => {
    expect(STORIES.length).toBeGreaterThan(0);

    for (const story of STORIES) {
      const meta: Metadata = await generateMetadata({ params: Promise.resolve({ slug: story.slug }) });
      // Next types `images` down to a bare string or a `URL`, so the shape this app actually
      // writes is established by the assertions rather than by the type.
      const images = (Array.isArray(meta.openGraph?.images) ? meta.openGraph.images : []) as unknown;
      const [image] = images as Array<Record<string, unknown>>;

      expect(declaredCard(meta), `${story.slug} card`).toBe('summary_large_image');
      expect(image?.url, `${story.slug} image url`).toBe(OG_IMAGE_URL);
      expect(image?.width, `${story.slug} image width`).toBe(OG_SIZE.width);
      expect(image?.height, `${story.slug} image height`).toBe(OG_SIZE.height);
      expect(image?.alt, `${story.slug} image alt`).toBe(OG_ALT);
    }
  });
});

/**
 * Every route's metadata, as it actually ships.
 *
 * Five of them need a `layout.tsx` to hold it, because their `page.tsx` is `'use client'` and
 * a client component cannot export `metadata`. That is why five of them had none: with no
 * metadata of their own they inherited the root layout's whole object, and the build output
 * on 2026-10-04 showed `/tutor`, `/writing`, `/vocab`, `/custom` and `/placement` all shipping
 * the homepage's `<title>`, `og:title` and `twitter:title`.
 *
 * `/stories` was the awkward one, because it looked like it had been done: it set `title` and
 * `description` and still shipped the homepage's `og:title`, since a page that does not set
 * `openGraph` inherits the root's object rather than falling back to its own title. The app's
 * most-shared page, describing itself as the homepage.
 */
const PAGES: Record<string, Metadata> = {
  '/': metadata,
  '/stories': storiesMetadata,
  '/custom': customMetadata,
  '/placement': placementMetadata,
  '/tutor': tutorMetadata,
  '/vocab': vocabMetadata,
  '/writing': writingMetadata,
};

/** `/stories/[slug]` builds its own per story, and `test/storyPage.test.ts` checks that. */
const BUILT_ELSEWHERE = '/stories/[slug]';

describe('what each page says about itself', () => {
  /**
   * The control, and the reason a new page cannot quietly join the homepage.
   *
   * Naming every route rather than counting them is what makes the next test mean anything:
   * "no two pages share a title" is trivially true of an empty map, and of a one-page one. It
   * takes the list below to be the real list of pages in `app/`, so a ninth page fails here
   * until it has been given a title of its own.
   */
  it('reaches every route in app/', () => {
    expect(pageRoutes()).toEqual([...Object.keys(PAGES), BUILT_ELSEWHERE].sort());
  });

  /**
   * The defect, in one line.
   *
   * Six of this app's eight pages shipped the same `<title>`, so a link to any of them
   * previewed as a link to the homepage and competed with it for the same search result.
   */
  it('gives no two pages the same title', () => {
    const titles = Object.values(PAGES).map((meta) => meta.title);

    expect(titles.every((title) => typeof title === 'string' && title.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });

  /**
   * The three names a share is read out under, and the reason one call to `pageMetadata`
   * exists rather than six hand-written objects: `title` is the browser tab and the search
   * result, `openGraph` is the link preview, `twitter` is that preview on the card type the
   * app claims. A page that sets one and not the others is the defect above in a new hat.
   */
  it('says the same thing in the tab, the preview and the card', () => {
    for (const [route, meta] of Object.entries(PAGES)) {
      const title = typeof meta.title === 'string' ? meta.title : undefined;

      expect(title, `${route} title`).toBeTruthy();
      expect(meta.openGraph?.title, `${route} og:title`).toBe(title);
      expect(meta.twitter?.title, `${route} twitter:title`).toBe(title);
    }
  });

  /**
   * The card and the picture, on every page rather than on the root.
   *
   * A page that sets `openGraph` at all drops the inherited `opengraph-image` file
   * convention, so fixing the titles without carrying the image along would have traded a
   * wrong preview for no preview on five routes. This is what stops that being a refactor
   * someone makes later.
   *
   * `/` is the one page that does not carry the image in its own object, and it is spelled out
   * rather than skipped: it takes the picture from `app/opengraph-image.tsx` — the file
   * convention on the root segment, which the control above already asserts is there. The two
   * routes reach the same picture by different means, and a `continue` would have hidden which
   * one this page happens to be on.
   */
  it('keeps the card and the picture on every one of them', () => {
    for (const [route, meta] of Object.entries(PAGES)) {
      expect(declaredCard(meta), `${route} card`).toBe('summary_large_image');

      const images = (Array.isArray(meta.openGraph?.images) ? meta.openGraph.images : []) as unknown;
      const [image] = images as Array<Record<string, unknown>>;

      if (route === '/') {
        expect(meta.openGraph?.images, '/ image url').toBeUndefined();
        expect(imageConventionFiles(), '/ picture').toEqual(['app/opengraph-image.tsx']);
        continue;
      }

      expect(image?.url, `${route} image url`).toBe(OG_IMAGE_URL);
      expect(image?.alt, `${route} image alt`).toBe(OG_ALT);
    }
  });

  /**
   * The helper on its own, apart from any page.
   *
   * Every claim the two tests above make about six pages is a claim about what this function
   * does with two strings, and this is the only place those strings become five fields. If it
   * grows a field its callers do not set, this is where that shows rather than in a preview.
   */
  it('builds every field a share is read out under from the two it is given', () => {
    expect(pageMetadata('A title', 'A description')).toMatchObject({
      title: 'A title',
      description: 'A description',
      openGraph: {
        title: 'A title',
        description: 'A description',
        type: 'website',
        images: [{ url: OG_IMAGE_URL, alt: OG_ALT }],
      },
      twitter: { card: 'summary_large_image', title: 'A title', description: 'A description' },
    });
  });
});