import React from 'react';
import Link from 'next/link';
import { BookOpen, Sparkles, ArrowRight, Zap, Code } from 'lucide-react';
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
          <span>Touch Typing Practice • Full-Stack Engineering • Developer Stories</span>
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-gray-900 dark:text-white leading-[1.15]">
          Master Touch Typing with Real Stories &amp; Technical Sentences
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base sm:text-lg text-gray-600 dark:text-gray-300 leading-relaxed">
          Build genuine speed and muscle memory. Practice typing full-stack architecture concepts, RAG system pipelines, cloud infrastructure workflows, and classic literature.
        </p>
      </div>

      {/* Live Interactive Typing Arena */}
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

      {/* Why Typing Technical CV Sentences & Stories Builds Speed */}
      <section className="mb-16 rounded-3xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Why Typing Technical CV Sentences Builds Real Developer Speed
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 text-sm">
          <div className="flex flex-col gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
              <Zap className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">Technical Muscle Memory</h3>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-xs">
              Typing framework names, library methods, and architecture terms letter-by-letter trains your fingers for live coding, terminal commands, and technical interviews.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400">
              <Code className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">CV &amp; Interview Fluency</h3>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-xs">
              Internalize your own professional accomplishments, RAG pipeline designs, and DevOps workflows so you can articulate them effortlessly during conversations.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <BookOpen className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">Contextual Reading Cadence</h3>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-xs">
              Isolated words don&apos;t match how developers work. By typing complete sentences and paragraphs, you absorb natural grammatical rhythm and typing stamina.
            </p>
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Frequently Asked Questions
        </h2>
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">
              What kind of technical sentences are included?
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              We provide real-world software engineering practice modules covering Full-Stack architecture, Next.js 15 App Router, RAG pipelines, dense vector retrieval, Azure cloud PaaS, Docker containerization, and CI/CD automation workflows.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">
              Can I practice with my own English articles or custom text?
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              Yes. Visit the Custom Text page to paste any resume bullet points, cover letters, technical documentation, or study notes. TypeStory will immediately load them into the typing engine.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">
              Is TypeStory free to use?
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              Yes, TypeStory is 100% free. All typing metrics (WPM, accuracy, time), mechanical keyboard sounds, and stories run locally in your browser with zero sign-up required.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
