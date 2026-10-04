import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/site';

/**
 * What a share of the tutor says about itself.
 *
 * A layout because `app/tutor/page.tsx` is `'use client'` — a client component cannot export
 * `metadata`, so without this file the route inherited the root layout's whole object and
 * announced itself as the homepage. Verified in the build output on 2026-10-04: `tutor.html`
 * shipped the homepage's `<title>`, `og:title` and `twitter:title`.
 *
 * The alternative was moving the page's contents into a child component to make the page
 * itself a server component. That is a larger diff, for the same tags.
 */
export const metadata = pageMetadata(
  'English Grammar Tutor: Ask a Question, Get an Explanation',
  'Ask about anything in English — grammar, phrasing, why a sentence sounds wrong — and get an explanation back in a conversation that carries the thread, not a single answer.',
);

export default function TutorLayout({ children }: { children: ReactNode }) {
  return children;
}