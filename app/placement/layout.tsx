import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/site';

/**
 * What a share of the placement test says about itself.
 *
 * A layout because `app/placement/page.tsx` is `'use client'` — a client component cannot
 * export `metadata`, so without this file the route inherited the root layout's whole object
 * and announced itself as the homepage. Verified in the build output on 2026-10-04.
 *
 * "Never averaged away" is the page's own rule — it shows the lower of the typing score and
 * the writing score — so the description is claiming what the page already does.
 */
export const metadata = pageMetadata(
  'Placement Test: Find Your English Typing Level',
  'Answer a short set of typing questions and write a short piece in English. Your final level is the lower of the two scores, so a weak skill is never averaged away.',
);

export default function PlacementLayout({ children }: { children: ReactNode }) {
  return children;
}