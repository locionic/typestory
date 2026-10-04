import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/site';

/**
 * What a share of the custom-text page says about itself.
 *
 * A layout because `app/custom/page.tsx` is `'use client'` — a client component cannot export
 * `metadata`, so without this file the route inherited the root layout's whole object and
 * announced itself as the homepage. Verified in the build output on 2026-10-04.
 */
export const metadata = pageMetadata(
  'Custom Typing Practice: Type Your Own Text',
  'Paste your own English reading assignment, novel chapter, or study notes. Practice touch typing it with real-time WPM, accuracy tracking, and mechanical keyboard audio.',
);

export default function CustomLayout({ children }: { children: ReactNode }) {
  return children;
}