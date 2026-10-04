import { ImageResponse } from 'next/og';
import { OG_ALT, OG_SIZE, TAGLINE } from '../lib/site';

/**
 * The card every shared TypeStory link wears.
 *
 * It did not exist, and `app/layout.tsx` and `app/stories/[slug]/page.tsx` both declared
 * `twitter: { card: 'summary_large_image' }` — the card that promises a 2:1 picture beside
 * the text — with no image anywhere to keep that promise. `public/` held only the five
 * untouched Next scaffold SVGs and `app/favicon.ico` resolves to `<link rel="icon">`, never
 * to `twitter:image`. Nothing rendered wrong: a share with no image falls back to a text
 * card, so this changed no page anybody could see. The declaration was the only place the
 * claim existed, and leaving it is how it stays true by accident.
 *
 * The claim is now backed. Flip a `card` back to `'summary'` and `test/shareMetadata.test.ts`
 * fails, which is the arrangement that stops the file and the declaration drifting apart
 * again — one is what the other promises.
 *
 * It reaches `/` and nothing else. The story page exports an explicit `openGraph` object, and
 * an explicit field group wins over this file convention for that group — so a story link
 * carried no image at all until `app/stories/[slug]/page.tsx` named this one in `images` by
 * hand. Checked in the build output, not inferred: with this file present, `index.html`
 * carried `og:image` and `stories/*.html` carried none. So the story page's `images` entry is
 * not redundant with this file, whatever it looks like, and deleting it re-breaks the card
 * that gets shared most.
 *
 * `TAGLINE` rather than the string written out, because the Navbar wordmark says it too and
 * `lib/site.ts` is where the two are kept from drifting — as are the dimensions and the alt
 * text here, which the story page needs the same three of. `next/font` is not used anywhere
 * in this app, so there is no `fontFamily` to name: this renders in satori's own default.
 *
 * Satori supports flexbox and a subset of CSS, so this is `display: flex` on every element
 * and no `grid`, no custom font, and no `gap` — each of those is a build failure rather than a
 * wrong pixel. The palette is the app's own: slate-900 for the field the dark mode uses
 * (`body`'s `dark:bg-slate-950`) and the indigo-to-purple of the Navbar logo gradient.
 */
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 104,
            fontWeight: 800,
            letterSpacing: -3,
            color: '#ffffff',
          }}
        >
          TypeStory
        </div>

        <div style={{ display: 'flex', marginTop: 20, fontSize: 40, color: '#a5b4fc' }}>
          {TAGLINE}
        </div>

        {/* The logo gradient, `from-indigo-500 to-purple-600`, as the one piece of colour. */}
        <div
          style={{
            display: 'flex',
            marginTop: 48,
            padding: '16px 36px',
            borderRadius: 999,
            background: 'linear-gradient(90deg, #6366f1, #9333ea)',
            color: '#ffffff',
            fontSize: 30,
            fontWeight: 600,
          }}
        >
          Touch typing with real stories
        </div>
      </div>
    ),
    { ...size },
  );
}