import { MetadataRoute } from 'next';
import { STORIES } from '../data/stories';
import { SITE_URL } from '../lib/site';

/**
 * No entry carries a `lastModified`, and that is the honest answer rather than an omission.
 *
 * Every entry used to carry `new Date()` — the moment the build ran — handed to a crawler
 * as the moment the page last changed. Nothing behind these URLs changes: eleven stories
 * that are static literals, and six fixed routes. So each build told search engines all
 * seventeen had just been edited, which is a claim about the world with nothing behind it,
 * and the sort a crawler learns to discount. The corpus carries no real date to offer
 * instead, and the spec treats the field as optional, so it is left off. Put it back the
 * day something knows the answer.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_URL;

  const storyEntries: MetadataRoute.Sitemap = STORIES.map((story) => ({
    url: `${baseUrl}/stories/${story.slug}`,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  return [
    {
      url: baseUrl,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/stories`,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/vocab`,
      changeFrequency: 'weekly',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/placement`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/custom`,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/writing`,
      changeFrequency: 'monthly',
      // Lowest, with `/tutor` below: these are the newest routes, and both are a
      // conversation with a model rather than something to land on. This used to give a
      // different reason — "worth nothing without an API key" — which stopped being true
      // when the routes stopped refusing to run without one and started resolving an
      // `ant auth login` credential chain instead. A priority whose stated reason is
      // false is not a priority anyone can reason about.
      priority: 0.6,
    },
    {
      url: `${baseUrl}/tutor`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    ...storyEntries,
  ];
}