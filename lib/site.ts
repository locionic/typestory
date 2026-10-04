import type { Metadata } from 'next';

/**
 * Where this app lives, as far as anything outside the browser is concerned.
 *
 * Three files need it and had each written the line out: `app/robots.ts`, `app/sitemap.ts`
 * and `app/layout.tsx`. They agreed only because nobody had touched one of them, and there
 * was nothing that could have said otherwise — checked by canary on 2026-10-04: pointing
 * robots.txt at a different host left all 651 tests green, with robots advertising a
 * sitemap URL that does not exist, sitemap.xml served from the old host, and every Open
 * Graph share and canonical link built from a third. No build error, no warning, no test.
 *
 * A crawler would have followed the sitemap pointer and 404'd, and shares would have gone
 * out with the wrong origin — which is the worst class of bug in this repo, because the
 * screen looks right and the page works. Hence one constant rather than a test comparing
 * three literals: agreement is now structural rather than checked.
 *
 * `NEXT_PUBLIC_`-prefixed, which is what the existing three read, so the value is inlined
 * at build time and stays correct in a static export as well as on the server.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://typestory.app';

/**
 * The line under the wordmark, which is also the line on the social card.
 *
 * Two places it has to agree: the Navbar wordmark, and `app/opengraph-image.tsx`, which is
 * a card somebody sees before they have seen the site. So one constant — the same reasoning
 * as `SITE_URL` above, for the same reason.
 *
 * Plain text, not `&amp;`. It was written as an entity because it sat in JSX, where React
 * escapes for you; here it is a string that gets rendered as `{TAGLINE}`, and a literal
 * entity would reach the card as a literal entity. And the claim is one the app backs:
 * "Speak" is a thing this product does rather than a thing it implies.
 *
 * Which surfaces do that is listed here because this is the only place that has to answer
 * it, and the list had the tutor on it. The tutor does not speak — `/tutor` reaches
 * `soundEngine` nowhere, and a wordmark promising speech over a page with no way to hear
 * anything is the same over-claim as a card promising an image nobody ships. What reaches
 * `speak` is the vocabulary drill, the story glossary, and the board's own Listen button,
 * and `test/audio.test.ts` holds that list to the code so it cannot rot a second time.
 *
 * Note what is *not* on it: `/tutor`, `/placement` and `/writing` render this wordmark
 * without a board and so without a Listen button, because they are the three routes where
 * speaking would not help the task. That is a deliberate gap rather than an oversight, and
 * the next person to add a fifth speak surface should add it to the list here too.
 */
export const TAGLINE = 'Type & Speak English';

/**
 * The card every shared link wears, described once so its three consumers cannot disagree.
 *
 * `app/opengraph-image.tsx` renders the picture and exports `size`/`alt`; a story page names
 * the same picture again in its `openGraph.images`, because of the note on that file. Those
 * three are the same card, so their dimensions and their alt text live here rather than being
 * written out in each — the same reasoning as `SITE_URL`, for the same reason.
 *
 * `OG_IMAGE_URL` is the unhashed route path, and the hash is deliberately left off. Next emits
 * the emitted tag as `/opengraph-image?<content hash>` — cache-busting, derived from the card
 * file's bytes, so it changes every time the artwork does. Copying a hash here would mean
 * rebuilding this constant to match an edit made somewhere else, and a stale one still serves
 * the image, so nothing would ever announce the drift. The bare path is stable and is a real
 * route: verified against `routes-manifest.json` and the prerendered `.body` on 2026-10-04.
 * Relative rather than absolute because `metadataBase` is set in the root layout, which
 * resolves it to the same origin every other share tag is built from.
 */
export const OG_SIZE = { width: 1200, height: 630 };

export const OG_ALT = 'TypeStory — touch typing practice with real English stories and vocabulary';

export const OG_IMAGE_URL = '/opengraph-image';

/**
 * The Twitter card every page here claims.
 *
 * Written down because a page that sets `twitter` for its own title *replaces* the root
 * layout's whole `twitter` object rather than merging into it. A page that named a title and
 * forgot the card would quietly get the small one — trading the wrong preview for a smaller
 * wrong preview. The card and the image it promises are one arrangement; see `app/layout.tsx`.
 */
export const TWITTER_CARD = 'summary_large_image';

/**
 * Everything a page needs for a share of itself to describe *it*.
 *
 * Three fields that have to agree with each other, on every page: `title` is the browser tab
 * and the search result, `openGraph` is the link preview, `twitter` is that same preview on
 * the card the app claims. Written out per page, they drift — and had: `/stories` set its own
 * `title` and shipped the *homepage's* `og:title`, because a page that does not set
 * `openGraph` inherits the root's whole object rather than falling back to its own title.
 * Checked in the build output on 2026-10-04, not inferred.
 *
 * The `images` entry is load-bearing, not decorative. Setting `openGraph` at all drops the
 * inherited `opengraph-image` file convention — see `app/opengraph-image.tsx` — so a page
 * that set only its title would have traded a wrong preview for no preview at all.
 *
 * `type: 'website'` throughout: these are interactive app pages. The story pages are
 * `article`, which is the one genuine exception and they set it themselves.
 */
export function pageMetadata(title: string, description: string): Metadata {
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: OG_IMAGE_URL, ...OG_SIZE, alt: OG_ALT }],
    },
    // No `images` of its own: Next fills a card's image from the `openGraph` one above when
    // the card names none, which is what the story pages' built HTML already shows.
    twitter: { card: TWITTER_CARD, title, description },
  };
}