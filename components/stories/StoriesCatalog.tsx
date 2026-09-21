'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, Clock, ArrowRight, Filter, BookOpen } from 'lucide-react';
import { StoryItem } from '../../lib/types';

interface StoriesCatalogProps {
  initialStories: StoryItem[];
}

const CATEGORIES = [
  { id: 'all', label: 'All Stories' },
  { id: 'tech', label: 'Tech & Engineering' },
  { id: 'fable', label: 'Fables' },
  { id: 'classic', label: 'Classics' },
  { id: 'essay', label: 'Speeches & Essays' },
  { id: 'dialogue', label: 'Daily Dialogues' },
];

const LEVELS = [
  { id: 'all', label: 'All Levels' },
  { id: 'beginner', label: 'Beginner (A1-A2)' },
  { id: 'intermediate', label: 'Intermediate (B1-B2)' },
  { id: 'advanced', label: 'Advanced (C1-C2)' },
];

export default function StoriesCatalog({ initialStories }: StoriesCatalogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('all');
  const [sortBy, setSortBy] = useState<'recommended' | 'shortest' | 'longest'>('recommended');

  const filteredStories = useMemo(() => {
    return initialStories
      .filter((story) => {
        // Search filter
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase().trim();
          const matchTitle = story.title.toLowerCase().includes(query);
          const matchAuthor = story.author.toLowerCase().includes(query);
          const matchSummary = story.summary.toLowerCase().includes(query);
          if (!matchTitle && !matchAuthor && !matchSummary) return false;
        }

        // Category filter
        if (selectedCategory !== 'all' && story.category !== selectedCategory) {
          return false;
        }

        // Level filter
        if (selectedLevel === 'beginner' && !['A1', 'A2'].includes(story.level)) {
          return false;
        }
        if (selectedLevel === 'intermediate' && !['B1', 'B2'].includes(story.level)) {
          return false;
        }
        if (selectedLevel === 'advanced' && !['C1', 'C2'].includes(story.level)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'shortest') return a.wordCount - b.wordCount;
        if (sortBy === 'longest') return b.wordCount - a.wordCount;
        return 0; // recommended order
      });
  }, [initialStories, searchQuery, selectedCategory, selectedLevel, sortBy]);

  return (
    <div className="flex flex-col gap-8">
      {/* Search & Filter Controls */}
      <div className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search stories by title, author, or topic..."
              className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 py-2.5 pl-10 pr-4 text-xs sm:text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-gray-800 dark:bg-gray-850 dark:text-white dark:placeholder-gray-500"
            />
          </div>

          {/* Level Filter Dropdown & Sort */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-850 dark:text-gray-300">
              <Filter className="h-3.5 w-3.5 text-indigo-500" />
              <select
                aria-label="Filter stories by proficiency level"
                value={selectedLevel}
                onChange={(e) => setSelectedLevel(e.target.value)}
                className="bg-transparent font-medium focus:outline-none"
              >
                {LEVELS.map((lvl) => (
                  <option key={lvl.id} value={lvl.id}>
                    {lvl.label}
                  </option>
                ))}
              </select>
            </div>

            <select
              aria-label="Sort stories"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'recommended' | 'shortest' | 'longest')}
              className="rounded-2xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-xs font-medium text-gray-700 focus:outline-none dark:border-gray-800 dark:bg-gray-850 dark:text-gray-300"
            >
              <option value="recommended">Recommended</option>
              <option value="shortest">Shortest first</option>
              <option value="longest">Longest first</option>
            </select>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                selectedCategory === cat.id
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          Showing <span className="font-bold text-gray-900 dark:text-white">{filteredStories.length}</span> of {initialStories.length} stories
        </span>
        {(searchQuery || selectedCategory !== 'all' || selectedLevel !== 'all') && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
              setSelectedLevel('all');
              setSortBy('recommended');
            }}
            className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Stories Grid or Empty State */}
      {filteredStories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-gray-200 bg-white p-12 text-center dark:border-gray-800 dark:bg-gray-900">
          <BookOpen className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-200">
            No stories matched your filters
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Try adjusting your search query or selecting a different level or category.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStories.map((story) => (
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
                  <span>
                    {story.category === 'tech' ? `${story.paragraphs.length} Q&A Questions` : `${story.wordCount} words`}
                  </span>
                </div>

                <div className="flex items-center justify-between font-semibold text-xs text-indigo-600 dark:text-indigo-400">
                  <span>{story.category === 'tech' ? 'Practice Q&A Session' : 'Start Typing Session'}</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
