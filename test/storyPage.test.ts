import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StoryDetailPage, { generateMetadata } from '../app/stories/[slug]/page';
import { STORIES } from '../data/stories';

// The reader pulls in the typing engine, which imports confetti; jsdom has no canvas.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

/**
 * `notFound()` throws in the real framework, and a spy that returned instead would let the
 * page walk straight on into the null dereference it is supposed to avoid — so this one
 * throws the same message, and the test below can tell the two apart.
 */
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  }),
);

vi.mock('next/navigation', () => ({ notFound: () => notFound() }));

/** `params` is a promise in this Next.js version; the page awaits it itself. */
const props = (slug: string) => ({ params: Promise.resolve({ slug }) }) as never;

/** The `<script type="application/ld+json">` the page emits, parsed. */
async function creativeWork(slug: string): Promise<Record<string, unknown>> {
  const html = renderToStaticMarkup(await StoryDetailPage(props(slug)));
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error(`no JSON-LD on /stories/${slug}`);
  return JSON.parse(script) as Record<string, unknown>;
}

/**
 * The author this page claims, in the two formats a crawler parses rather than reads.
 *
 * `StoryItem.author` is one string doing two jobs: four of the eleven stories are credited
 * to a person who wrote them, seven to a series or collection. The page never asked which,
 * so it published `author: { '@type': 'Person', name: 'Everyday Dialogues' }` and an
 * OpenGraph `article:author` of the same name — a person who does not exist, asserted
 * across every story, in the two formats where a false statement is least visible and most
 * likely to be believed.
 *
 * Omitting is the honest response for a series: schema.org has no type for one, and
 * `Organization` would be a different false claim. So the key is absent rather than wrong.
 * `test/storyReader.test.ts` covers the two surfaces a person actually reads.
 */
describe('what the story page claims about authorship', () => {
  it('names no author at all for a story with no byline', async () => {
    expect(await creativeWork('daily-coffee-shop-dialogue')).not.toHaveProperty('author');
  });

  it('never names a series or collection as a person', async () => {
    const invented: string[] = [];

    for (const s of STORIES) {
      const author = (await creativeWork(s.slug)).author as
        | { '@type'?: string; name?: string }
        | undefined;
      if (author?.['@type'] === 'Person' && !s.authorIsPerson) {
        invented.push(`${s.slug}: ${author.name}`);
      }
    }

    expect(invented).toEqual([]);
  });

  /**
   * The control, and the reason the test above means anything: the key is not simply gone
   * from every page. Dropping authorship wholesale would satisfy it.
   */
  it('still names the people who did write a story', async () => {
    expect(await creativeWork('the-tortoise-and-the-hare')).toMatchObject({
      author: { '@type': 'Person', name: 'Aesop' },
    });
  });

  it('keeps every real byline present', async () => {
    // Not pinned to a count. Four of the eleven stories are a person's today, but the
    // claim here is that every story flagged `authorIsPerson` names that person — not
    // how many there are, and freezing the number only stops the corpus from growing.
    // The proof that this loop is not vacuous is the Aesop case above: if the flag were
    // broken to always-false, that test fails rather than this one passing quietly.
    const people = STORIES.filter((s) => s.authorIsPerson);

    for (const s of people) {
      expect(await creativeWork(s.slug)).toMatchObject({
        author: { '@type': 'Person', name: s.author },
      });
    }
  });
});

/**
 * The same claim in the page title and the OpenGraph card.
 *
 * `${title} by ${author}` puts a preposition of authorship in front of a series name, the
 * human-readable twin of the JSON-LD: "The Birth of the World Wide Web by Tech History".
 * It reads as a statement about who wrote the passage, which is the one thing nobody here
 * can check.
 */
describe('the story page title', () => {
  const title = async (slug: string) => (await generateMetadata(props(slug))).title;

  it('names the person in the title when there is one', async () => {
    expect(await title('the-tortoise-and-the-hare')).toBe(
      'The Tortoise and the Hare by Aesop: English Type-Along Practice',
    );
  });

  it('leaves a series out of the title', async () => {
    const shown = await title('the-birth-of-the-world-wide-web');

    expect(shown).not.toContain('by Tech History');
    // The bare form, so the title is not left holding nothing but the suffix. Tim
    // Berners-Lee's name is already in the story's own title; "by Tech History" beside
    // it is the app claiming the passage on his subject was written by a series.
    expect(shown).toBe('How Tim Berners-Lee Built the Web: English Type-Along Practice');
  });

  it('publishes no article:author for a story with no byline', async () => {
    const meta = await generateMetadata(props('daily-coffee-shop-dialogue'));

    expect(meta.openGraph).not.toHaveProperty('authors');
  });

  it('still publishes article:author for a story with a byline', async () => {
    const meta = await generateMetadata(props('the-tortoise-and-the-hare'));

    expect(meta.openGraph).toMatchObject({ authors: ['Aesop'] });
  });
});

/**
 * A URL no story answers to, which is the one path through this page nothing covered.
 *
 * `generateStaticParams` only ever emits the eleven real slugs, so the other tests in this
 * file are all reading stories that exist and every assertion below is about the happy
 * path by construction. An unknown slug is not hypothetical though — it is a mistyped link,
 * a renamed slug in somebody's bookmark, or a crawler following a URL from years ago — and
 * it is the one input where `STORIES.find` returns `undefined` and every `story.title`
 * below it dereferences nothing.
 *
 * Both halves matter, and they are separate functions. The page calls `notFound()`, which
 * is the framework's 404. `generateMetadata` runs *before* the page does and returns a
 * title by hand instead, because a metadata generator that threw would turn every bad URL
 * into a 500 rather than a 404 — a server error page where a "this page has moved" belongs.
 */
describe('a slug no story has', () => {
  it('is a 404 from the page, not a crash on a missing story', async () => {
    // Throwing is not the claim — `notFound` throwing *is* the claim, so the spy is what
    // is asserted. A removed guard would also reject, with a TypeError, and pass a
    // `rejects.toThrow()` on its own.
    await expect(StoryDetailPage(props('no-such-story'))).rejects.toThrow(/404/);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('still gets a title, because a metadata generator cannot throw', async () => {
    const meta = await generateMetadata(props('no-such-story'));

    // Asserted as the absence of a crash plus a usable title, not the exact string: the
    // separator here is `|` where the rest of the app uses `:`, and pinning the punctuation
    // would make this test a reason to keep it.
    expect(meta.title).toContain('Not Found');
  });
});