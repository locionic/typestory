'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, RotateCcw } from 'lucide-react';

/**
 * What a page looks like while it is failing, in the app's own clothes.
 *
 * It did not exist, so an uncaught render error anywhere under `app/` replaced the whole
 * page with the framework's bare fallback — no Navbar, no footer, no dark mode, and a
 * heading about an "Application error" that named nothing about this app.
 *
 * `retry` and not `reset`, which is the whole reason this file was worth reading the docs
 * for. `retry` became stable in v16.3.0 and this app is on 16.3.5; `reset` also exists but
 * re-renders the boundary's children *without* re-fetching them, which is the wrong thing
 * for a page that just failed to load. Both are from node_modules/next/dist/docs.
 *
 * The `console.error` is the whole diagnostic. The routes log their own failures, but a
 * render error on the client never reaches those logs, so this effect is the only trace of
 * it — and `error.digest` rides along in it, because a production server error is scrubbed
 * to a generic message and the digest is then the only thing identifying which one it was.
 * That is why the digest is logged rather than rendered: it is for whoever reads the
 * console, not something to put in front of a learner.
 *
 * `role="alert"`, which `app/not-found.tsx` deliberately does not carry. This branch
 * replaces content somebody is already looking at mid-session, so it has to interrupt; a
 * page that is the whole document on arrival has nothing to interrupt.
 *
 * Nothing here promises the learner's progress survived. A render error in one segment says
 * nothing about the store or the backup, and the backup has a real state where it is
 * stopped and out of reach — so reassuring them about it on this page would be exactly the
 * kind of claim the rest of this repo keeps refusing to make.
 */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
      <AlertCircle className="mx-auto h-10 w-10 text-red-500" />

      <h1 className="mt-4 text-3xl font-black text-gray-900 sm:text-4xl dark:text-white">
        Something went wrong
      </h1>

      <p role="alert" className="mx-auto mt-3 max-w-md text-sm text-gray-600 dark:text-gray-400">
        This page hit an error while it was loading. Trying again usually clears it.
      </p>

      <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-500/20 transition hover:bg-indigo-500"
        >
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
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