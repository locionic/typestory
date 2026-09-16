import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import Navbar from '../components/Navbar';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://typestory.app'),
  title: 'TypeStory: Learn English by Typing & Speaking Stories',
  description:
    'Master touch typing, expand English vocabulary, and test your pronunciation with real-world stories, Oxford 3000 words, and native microphone speech recognition.',
  keywords: [
    'learn english by typing',
    'touch typing english',
    'typing test with stories',
    'english pronunciation mic test',
    'qwerty learner english',
    'type along stories',
    'english muscle memory',
    'speech typing practice',
  ],
  authors: [{ name: 'TypeStory Team' }],
  openGraph: {
    title: 'TypeStory: Learn English by Typing & Speaking Stories',
    description:
      'Practice touch typing while absorbing rich English stories, Oxford 3000 vocabulary, and real-time microphone pronunciation feedback.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TypeStory: Learn English by Typing & Speaking Stories',
    description:
      'Practice touch typing while absorbing rich English stories, Oxford 3000 vocabulary, and real-time microphone pronunciation feedback.',
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
                'Interactive touch typing and English language learning platform combining real-world stories with microphone voice assessment.',
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
              &copy; {new Date().getFullYear()} TypeStory. Free open-access English typing and speech trainer.
            </div>
            <div className="flex gap-4">
              <Link href="/stories" className="hover:text-indigo-600">Stories</Link>
              <Link href="/vocab" className="hover:text-indigo-600">Word Banks</Link>
              <Link href="/custom" className="hover:text-indigo-600">Paste Text</Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
