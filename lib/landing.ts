/**
 * The passage the landing page teaches with.
 *
 * It was the store's boot state and nothing else, and the store is a module singleton
 * that outlives every component — so "the landing page's passage" and "whatever the last
 * page left behind" were the same string until a learner visited `/custom`, after which
 * the front door of the app opened onto their own pasted novel, under a heading reading
 * "Custom Text". `app/page.tsx` is a server component and cannot seed the store itself, so
 * the page hands this to the board the way every other board's page hands over its own.
 *
 * Here rather than in `store/useTypingStore.ts` because both ends need it and neither can
 * reach the other: the store holds the *session*, the landing page holds the *input*, and
 * this is the input. Reading it out of the store instead would give the server component a
 * second, server-side instance of the singleton — one whose boot value is the only answer
 * it could ever return, which is the arrangement being removed.
 *
 * `test/typingStore.test.ts` asserts this pair against `STORIES`, so an edit to either
 * string that breaks the link fails there.
 */
export const LANDING_PASSAGE = {
  title: 'Full-Stack & Next.js: Technical Interview Q&A',
  text:
    'Q: What is the main architectural benefit of React Server Components in Next.js 16? ' +
    'A: React Server Components execute exclusively on the server, significantly reducing ' +
    'client JavaScript bundle size and enabling secure, direct database access without ' +
    'exposing internal credentials.',
} as const;