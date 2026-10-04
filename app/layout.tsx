import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import Navbar from '../components/Navbar';
import { NAV_ROUTES } from '../lib/routes';
import { SITE_URL, TWITTER_CARD } from '../lib/site';

/**
 * The title and description, once.
 *
 * `title` and `description` were each written out three times in the object below — once
 * for the SERP and once each for the OpenGraph and Twitter cards. Three copies of one
 * sentence is three chances to edit one and forget the others, and it had already happened:
 * the description drifted apart between the SERP ("Master touch typing…") and the social
 * cards ("Practice touch typing…"), so what a search result promised and what a shared
 * link promised were different sentences about the same product. One const each, read
 * three times, cannot drift.
 */
const TITLE = 'TypeStory: Master Touch Typing with Real Stories & Technical Vocabulary';

/**
 * "Oxford 3000" is a published word list of roughly three thousand words, and all three
 * copies of this description offered it as something the site contains. The bank is drawn
 * from that list — it is titled "Oxford 3000 Essentials" and its eight words are core
 * A1/A2 vocabulary from it — but eight is not three thousand, and the home page says so
 * plainly one screen away, in "{bank.words.length} core words" on the vocab card. Not by
 * line number: that reference was already stale once, and it is the one part of this
 * comment that could not survive an edit. The list is still worth naming — it is what the
 * bank is actually taken from, and it is what people searching for it are looking for.
 */
const DESCRIPTION =
  'Master touch typing, expand English vocabulary, and build muscle memory with real-world stories, a curated core set drawn from the Oxford 3000, and full-stack software engineering concepts.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'learn english by typing',
    'touch typing english',
    'typing test with stories',
    'software engineer typing practice',
    'qwerty learner english',
    'type along stories',
    'english muscle memory',
    'developer typing practice',
  ],
  authors: [{ name: 'TypeStory Team' }],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
  },
  twitter: {
    /* The large-image card, which is a promise of a 2:1 picture beside the text.
     *
     * It sat on `summary` for as long as this app had no picture at all: `public/` held the
     * five untouched Next scaffold SVGs, there was no `opengraph-image` or `twitter-image`
     * convention anywhere, and `app/favicon.ico` is emitted as `<link rel="icon">` — never as
     * `twitter:image`. Every share was a text card wearing the label for the other kind, which
     * changes nothing a reader sees, which is why it survived: nothing renders wrong.
     *
     * `app/opengraph-image.tsx` is that picture, so the label can be true now. Downgrading it
     * back fails `test/shareMetadata.test.ts`, which is the point — the declaration and the
     * file that backs it are one arrangement, not two facts that happen to agree today.
     */
    card: TWITTER_CARD,
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        {/* JSON-LD WebApplication Structured Data for SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'TypeStory',
              applicationCategory: 'EducationalApplication',
              operatingSystem: 'All',
              description:
                'Interactive touch typing and English language learning platform combining real-world stories, technical vocabulary, and mechanical keyboard audio.',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
            }),
          }}
        />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100 flex flex-col justify-between font-sans">
        <Navbar />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-gray-200 bg-white py-8 text-center text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950">
          <div className="mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              &copy; {new Date().getFullYear()} TypeStory. Free open-access touch typing and English learning platform.
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              {/* The header's list, not a second hand-written one. Three of these six
                * used to be written out by hand, and Placement, Writing and Tutor were
                * in the header alone. The footer is the one fixed position on every page,
                * which is what a learner has when the nav has wrapped to a second row —
                * see the note on the list. `Icon` is the header's; the footer takes the
                * label alone. */}
              {NAV_ROUTES.map(({ href, label }) => (
                <Link key={href} href={href} className="hover:text-indigo-600">
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
