import {
  BookOpen,
  Bookmark,
  FileText,
  GraduationCap,
  MessageCircle,
  PenLine,
} from 'lucide-react';

/**
 * The app's routes, in one list.
 *
 * It lives here rather than in the Navbar because there are two consumers and one of them
 * is a server component: `app/layout.tsx` renders the footer, and a server component
 * cannot read an export out of a `'use client'` module. Duplicating the list would have
 * worked right up until a route was added to one of them.
 *
 * It was duplicated. The header published all six; the footer published three, so
 * Placement, Writing and Tutor were reachable only from the nav — and the nav wraps to a
 * second row below 768px, which the header's own comment calls this app's primary device.
 * This is the Navbar's original bug, the six hand-copied blocks, unfixed one component
 * down. One list, read twice, cannot drift.
 *
 * `Icon` is for the header only; the footer renders the label alone.
 */
export const NAV_ROUTES = [
  { href: '/stories', label: 'Stories', Icon: BookOpen },
  { href: '/vocab', label: 'Word Banks', Icon: Bookmark },
  { href: '/placement', label: 'Placement', Icon: GraduationCap },
  { href: '/writing', label: 'Writing', Icon: PenLine },
  { href: '/tutor', label: 'Tutor', Icon: MessageCircle },
  { href: '/custom', label: 'Paste Text', Icon: FileText },
] as const;