import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/site';

/**
 * What a share of the placement test says about itself.
 *
 * A layout because `app/placement/page.tsx` is `'use client'` — a client component cannot
 * export `metadata`, so without this file the route inherited the root layout's whole object
 * and announced itself as the homepage. Verified in the build output on 2026-10-04.
 *
 * "Never averaged away" is the page's own rule — it shows the lower of the quiz score and
 * the writing band — so the description is claiming what the page already does.
 *
 * The other two sentences used to say *typing* twice: "Find Your English Typing Level",
 * and "a short set of typing questions". The quiz measures English, not typing. All twelve
 * prompts in `lib/placement.ts` are grammar — articles, prepositions, tenses,
 * comparatives, conditionals — and not one of them is about a keyboard, so a searcher
 * arriving on this description was told they were about to be timed, and the level they
 * were given was never one this page could have measured.
 *
 * Which makes it the worst place for the error, and the reason a sweep had cleared this
 * file: it checked the one sentence that *is* true against the code and found it exact,
 * and the two beside it went unread. The page's own visible copy has never claimed
 * otherwise — it says "{n} questions plus a short piece of writing" — so the learner who
 * arrived by link and the learner who read the page were told different things.
 */
export const metadata = pageMetadata(
  'Placement Test: Find Your English Level',
  'Answer a short set of grammar questions and write a short piece in English. Your final level is the lower of the two scores, so a weak skill is never averaged away.',
);

export default function PlacementLayout({ children }: { children: ReactNode }) {
  return children;
}