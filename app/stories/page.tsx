import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, Sparkles, ArrowRight, Clock, Award } from 'lucide-react';
import { STORIES } from '../../data/stories';

export const metadata: Metadata = {
  title: 'English Type-Along Stories: Practice Typing with Classic Literature & Fables',
  description:
    'Browse and practice typing with English short stories, Aesop fables, O. Henry classics, and tech essays. Track WPM and test your pronunciation with microphone voice feedback.',
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
          Improve typing speed and reading comprehension simultaneously. Choose a story below to start an interactive type-along session with native audio narration and voice evaluation.
        </p>
      </div>

      {/* Stories Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {STORIES.map((story) => (
          <Link
            key={story.slug}
            href={`/stories/${story.slug}`}
            className="group flex flex-col justify-between rounded-3xl border border-gray-200 bg-white p-6 transition-all hover:-translate-y-1 hover:border-indigo-300 hover:shadow-xl dark:border-gray-800 dark:bg-gray-900"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-4xl">{story.coverEmoji}</span>
                <span className="rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  Level {story.level}
                </span>
              </div>

              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                {story.difficultyLabel}
              </span>

              <h2 className="mt-1 text-xl font-bold text-gray-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-400">
                {story.title}
              </h2>

              <p className="mt-1 text-xs text-gray-400">By {story.author}</p>

              <p className="mt-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                {story.summary}
              </p>
            </div>

            <div className="mt-6 border-t border-gray-100 pt-4 dark:border-gray-800">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  <span>~{story.readingTimeMinutes} min</span>
                </span>
                <span>{story.wordCount} words</span>
              </div>

              <div className="flex items-center justify-between font-semibold text-xs text-indigo-600 dark:text-indigo-400">
                <span>Start Typing Session</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
