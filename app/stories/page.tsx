import React from 'react';
import type { Metadata } from 'next';
import { BookOpen } from 'lucide-react';
import { STORIES } from '../../data/stories';
import StoriesCatalog from '../../components/stories/StoriesCatalog';

export const metadata: Metadata = {
  title: 'English Type-Along Stories: Practice Typing with Classic Literature & Fables',
  description:
    'Browse and practice typing with English short stories, Aesop fables, O. Henry classics, and tech essays. Track WPM, typing accuracy, and speed in real-time.',
  keywords: [
    'type along stories',
    'english typing stories',
    'read and type english',
    'fable typing practice',
    'english literature typing test',
  ],
};

export default function StoriesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 mb-3">
          <BookOpen className="h-3.5 w-3.5" />
          <span>Curated Reading &amp; Typing Library</span>
        </div>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-gray-900 dark:text-white">
          English Type-Along Stories
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed">
          Improve typing speed and reading comprehension simultaneously. Choose a story or technical interview Q&amp;A module below to start an interactive touch typing session.
        </p>
      </div>

      {/* Interactive Catalog with Search, Filters & Sorting */}
      <StoriesCatalog initialStories={STORIES} />
    </div>
  );
}
