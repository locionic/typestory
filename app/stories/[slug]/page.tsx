import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { STORIES } from '../../../data/stories';
import { OG_ALT, OG_IMAGE_URL, OG_SIZE, TWITTER_CARD } from '../../../lib/site';
import StoryReader from '../../../components/typing/StoryReader';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return STORIES.map((story) => ({
    slug: story.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = STORIES.find((s) => s.slug === slug);
  if (!story) return { title: 'Story Not Found | TypeStory' };

  // "by" reads as provenance, which is what a person is and a series is not. Seven of
  // the eleven have no byline; the bare title is the honest form, and the credit still
  // appears on the page itself.
  const title = story.authorIsPerson
    ? `${story.title} by ${story.author}: English Type-Along Practice`
    : `${story.title}: English Type-Along Practice`;
  const description = `${story.summary} Practice touch typing with this CEFR Level ${story.level} story. Real-time WPM, accuracy tracking, and tactile keyboard feedback.`;

  return {
    title,
    description,
    keywords: [
      `${story.title} typing test`,
      `${story.title} english practice`,
      'type along stories',
      'english typing practice',
      'touch typing literature',
    ],
    openGraph: {
      title,
      description,
      type: 'article',
      // `article:author` is the same person-shaped claim the JSON-LD below made
      // unconditionally: it published "Everyday Dialogues" as an author of record.
      // Omitted rather than filled, since there is no accurate value to put here.
      ...(story.authorIsPerson ? { authors: [story.author] } : {}),
      /* The card's picture, named explicitly rather than inherited.
       *
       * `app/opengraph-image.tsx` sits at the app root and is what a `/` share wears. It does
       * not reach here: the `openGraph` object above is explicit, and an explicit field group
       * wins over the file convention for that group — so until this entry, a story link
       * carried no image at all. Checked in the build output rather than assumed: with that
       * file present, `index.html` carried `og:image` and `stories/*.html` carried none.
       *
       * The story's own title is already this card's text, so the picture beside it is the
       * product's rather than this story's. Rendering one per story would mean a second card
       * file holding a second copy of this palette, on a route per story, to restate what the
       * text beside it already says.
       */
      images: [{ url: OG_IMAGE_URL, ...OG_SIZE, alt: OG_ALT }],
    },
    twitter: {
      /* The large card, restored in the same change that made the image it promises exist —
       * the root layout's rule, which was a comment and a failing test until this landed.
       * This is the link that gets shared, so it was the one most often a text card labelled
       * otherwise. `TWITTER_CARD` rather than the literal so this page and the other six
       * cannot disagree about it; `test/shareMetadata.test.ts` fails if one of them ever
       * writes its own value back. */
      card: TWITTER_CARD,
      title,
      description,
    },
  };
}

export default async function StoryDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const story = STORIES.find((s) => s.slug === slug);

  if (!story) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Schema.org CreativeWork JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CreativeWork',
            headline: story.title,
            // Only where there is a person to name. Asserting
            // `@type: 'Person'` for "Full-Stack Interview Series" or "Tech History"
            // invented an author who does not exist, in the one format here that is
            // parsed by machines rather than read — a series is not a Person, and
            // schema.org has no honest type for one, so the key is left out.
            ...(story.authorIsPerson
              ? { author: { '@type': 'Person', name: story.author } }
              : {}),
            description: story.summary,
            educationalLevel: story.level,
            learningResourceType: 'Typing and Reading Exercise',
            wordCount: story.wordCount,
          }),
        }}
      />

      <StoryReader story={story} />
    </div>
  );
}
