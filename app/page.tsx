import React from 'react';
import Link from 'next/link';
import { BookOpen, Mic, Volume2, Sparkles, ArrowRight, Zap, Target, Award, CheckCircle } from 'lucide-react';
import TypingEngine from '../components/typing/TypingEngine';
import { STORIES } from '../data/stories';
import { VOCAB_BANKS } from '../data/vocab';

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Hero Header */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 mb-4">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Typing Practice + Voice Pronunciation + English Stories</span>
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-gray-900 dark:text-white leading-[1.15]">
          Learn English by Typing &amp; Speaking Real Stories
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base sm:text-lg text-gray-600 dark:text-gray-300 leading-relaxed">
          Transform touch-typing into language fluency. Type through classic literature, inspiring essays, and tech history: then test your pronunciation using instant microphone voice feedback.
        </p>
      </div>

      {/* Live Interactive Typing & Microphone Arena */}
      <div className="mb-16">
        <TypingEngine />
      </div>

      {/* Featured Stories Grid */}
      <section className="mb-16">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Type Along With Real Stories
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Practice touch typing while absorbing rich, contextual English literature.
            </p>
          </div>
          <Link
            href="/stories"
            className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            View all stories <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STORIES.slice(0, 3).map((story) => (
            <Link
              key={story.slug}
              href={`/stories/${story.slug}`}
              className="group flex flex-col justify-between rounded-3xl border border-gray-200 bg-white p-6 transition-all hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-3xl">{story.coverEmoji}</span>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                    Level {story.level}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-400">
                  {story.title}
                </h3>
                <p className="mt-1 text-xs text-gray-400">By {story.author}</p>
                <p className="mt-2.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300 line-clamp-3">
                  {story.summary}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-800">
                <span>{story.wordCount} words</span>
                <span className="font-semibold text-indigo-600 group-hover:translate-x-0.5 transition-transform dark:text-indigo-400">
                  Start Typing &rarr;
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Vocabulary Banks */}
      <section className="mb-16">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Targeted Word Banks
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Drill high-frequency words for exams, developer documentation, and daily fluency.
            </p>
          </div>
          <Link
            href="/vocab"
            className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            Explore word banks <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {VOCAB_BANKS.map((bank) => (
            <Link
              key={bank.slug}
              href="/vocab"
              className="flex flex-col justify-between rounded-3xl border border-gray-200 bg-white p-6 transition-all hover:border-indigo-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
            >
              <div>
                <span className="text-2xl mb-2 block">{bank.iconEmoji}</span>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {bank.badge}
                </span>
                <h3 className="mt-2 text-base font-bold text-gray-900 dark:text-white">
                  {bank.title}
                </h3>
                <p className="mt-1.5 text-xs text-gray-500 leading-relaxed dark:text-gray-400">
                  {bank.description}
                </p>
              </div>
              <div className="mt-4 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                {bank.words.length} core words &rarr;
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Why Typing + Speaking Works (SEO Content) */}
      <section className="mb-16 rounded-3xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Why Typing &amp; Speaking Boosts English Fluency Faster
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 text-sm">
          <div className="flex flex-col gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
              <Zap className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">Kinesthetic Muscle Memory</h3>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-xs">
              Typing forces you to encode English spelling letter-by-letter. Your fingers remember the spatial cadence of complex words far longer than passive flashcard scanning.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400">
              <Mic className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">Active Vocal Feedback</h3>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-xs">
              Reading silently creates a false sense of confidence. Testing your voice with real-time speech recognition confirms whether your accent and phonetics are clearly understood.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <BookOpen className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">Contextual Reading</h3>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-xs">
              Isolated words are easily forgotten. By typing through complete stories and historical speeches, you absorb natural grammatical structures, collocations, and cadence in context.
            </p>
          </div>
        </div>
      </section>

      {/* SEO Frequently Asked Questions */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Frequently Asked Questions
        </h2>
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">
              How does the microphone voice evaluation work?
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              TypeStory utilizes the browser-native Web Speech Recognition API. When you speak into your microphone, the speech engine compares your words against the target English text in real-time, highlighting exact phonetic matches and calculating your pronunciation accuracy percentage.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">
              Can I practice with my own English articles or textbooks?
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              Yes. You can visit the Paste Text section to paste any English essay, news article, or study notes. TypeStory will instantly segment it into an interactive typing session with full audio narration and pronunciation testing.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">
              Is TypeStory free to use?
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              Yes, TypeStory is 100% free and open to everyone. All typing stats, switch acoustics, and voice recognition tools run client-side in your browser with no account or subscription required.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
