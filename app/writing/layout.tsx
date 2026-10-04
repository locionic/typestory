import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/site';

/**
 * What a share of the writing workshop says about itself.
 *
 * A layout because `app/writing/page.tsx` is `'use client'` — a client component cannot
 * export `metadata`, so without this file the route inherited the root layout's whole object
 * and announced itself as the homepage. Verified in the build output on 2026-10-04.
 */
export const metadata = pageMetadata(
  'English Writing Feedback: Get Your Writing Corrected',
  'Paste something you wrote in English. You get back how a fluent speaker would phrase it, plus each change explained.',
);

export default function WritingLayout({ children }: { children: ReactNode }) {
  return children;
}