import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { STORIES } from '../../../data/stories';
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

  const title = `${story.title} by ${story.author}: English Type-Along Practice`;
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
      authors: [story.author],
    },
    twitter: {
      card: 'summary_large_image',
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
            author: {
              '@type': 'Person',
              name: story.author,
            },
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
