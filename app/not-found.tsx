import Link from 'next/link';
import { ArrowLeft, BookOpen, SearchX } from 'lucide-react';

/**
 * What a wrong address, and a story that is no longer there, both arrive at.
 *
 * `app/stories/[slug]/page.tsx` calls `notFound()` for a slug the corpus does not carry,
 * which is what a mistyped URL and a bookmark whose story was renamed both look like from
 * here. This file did not exist, so both landed on the framework's built-in 404: no Navbar,
 * no footer, no dark mode, and copy about nothing on this site. The metadata beside it was
 * already correct — `generateMetadata` returns "Story Not Found | TypeStory" — so the title
 * promised a page the body had never been showing.
 *
 * `app/not-found` rather than `app/global-not-found`, which is the more obvious name for a
 * 404. That one is still experimental behind an `experimental.globalNotFound` flag, skips
 * the root layout entirely, and has to return a complete HTML document — it would have
 * thrown away the very chrome this page exists to restore. This one renders inside the
 * layout and inherits it. Both notes are from node_modules/next/dist/docs.
 *
 * No `role="alert"`, which the tutor's load-error paragraph does carry. That branch
 * replaces content a learner is already looking at and has to interrupt them; this page is
 * the whole document on arrival, so an alert would announce itself against nothing.
 *
 * The copy says a typo is *possible* rather than asserting one cause. The address really
 * can be a mistyped story slug, and it really can be a bookmark to a story that was renamed,
 * and this file cannot tell those apart — it takes no props (documented, not a choice
 * here). Naming one as the cause would be the same failure in reverse: a claim on the page
 * that the page cannot back.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
      <SearchX className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />

      <h1 className="mt-4 text-3xl font-black text-gray-900 sm:text-4xl dark:text-white">
        Page not found
      </h1>

      <p className="mx-auto mt-3 max-w-md text-sm text-gray-500 dark:text-gray-400">
        That address does not match anything on TypeStory. If you typed it by hand, it may
        have a typo in it.
      </p>

      {/* The two ways out, and the order they are in. `/stories` is the app's actual
        * starting point — the Navbar's own primary action is "Start Practice", pointing
        * there — so a learner who mistyped a story URL most likely wanted that, and home is
        * the fallback rather than the destination. */}
      <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Link
          href="/stories"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          <BookOpen className="h-4 w-4" />
          Browse all stories
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}