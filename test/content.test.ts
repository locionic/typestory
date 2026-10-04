import { describe, expect, it } from 'vitest';
import { STORIES } from '../data/stories';
import { VOCAB_BANKS } from '../data/vocab';
import { SAMPLES } from '../app/custom/page';
import { LANDING_PASSAGE } from '../lib/landing';
import { normalizeTypableText } from '../store/useTypingStore';
import { TYPABLE_CHARS } from '../components/typing/VirtualKeyboard';
import pkg from '../package.json';

/**
 * What a learner can physically type.
 *
 * Derived from the keyboard the app itself renders, not from a list written here: the
 * claim "this text is typable on a US layout" has exactly one source of truth in the
 * codebase, and a second copy inside a test is a copy that drifts. It used to be one —
 * this loop rebuilt the set from `KEYBOARD_ROWS` while `/custom` asked the same question
 * with no answer, so the passage a learner pastes was the one input in the app nothing
 * checked. The set now lives beside the rows it is derived from and both callers read it.
 */

/** Everything that reaches the typing board, labelled so a failure says where it came from. */
function typableText(): [string, string][] {
  const out: [string, string][] = [];
  // First, because it is first: the front door's board, the only passage a learner meets
  // before choosing anything at all. The other three corpora each have a guard the landing
  // passage has no version of — `/custom` asks `untypeableIn` at its Start button, and
  // these three are listed here — while this one is authored by hand and read by nobody
  // but the board. An em dash in it parks the caret on the same position for every visit
  // to the front page, permanently, and the store's empty-target guard is the only thing
  // that stands between that and a board with nothing to do.
  out.push(['the landing passage', LANDING_PASSAGE.text]);
  for (const story of STORIES) {
    story.paragraphs.forEach((paragraph, i) => {
      out.push([`${story.slug} paragraph ${i + 1}`, paragraph]);
    });
    story.keyVocabulary.forEach((entry) => {
      out.push([`${story.slug} vocabulary "${entry.word}"`, entry.word]);
    });
  }
  for (const bank of VOCAB_BANKS) {
    for (const entry of bank.words) out.push([`${bank.slug} "${entry.word}"`, entry.word]);
  }
  // The `/custom` presets are the one corpus that went unchecked, and they are the
  // first board a learner ever sees: `SAMPLES[0].text` seeds the textarea on mount, so
  // it is what the page offers before the learner has typed a character themselves.
  SAMPLES.forEach((sample, i) => out.push([`/custom preset ${i + 1} "${sample.title}"`, sample.text]));
  return out;
}

/**
 * The corpus is the app's only content, and nothing tested it.
 *
 * Every other input here has a guard: `saveUserStats` validates before it stores,
 * `parseTutorRequest` before a model sees it, `normalizeTypableText` before the board
 * renders it. The stories and word banks had no equivalent, and they are the one input
 * where a single character puts a learner somewhere they cannot get out of.
 *
 * The store advances the caret on every keystroke whether or not it matched, so a
 * character with no key of its own produces a position that can never turn green. It
 * cannot be repaired mid-passage, it does not block completion, and it drags the WPM
 * and accuracy the session is *recorded* with — so one curly quote or stray `€` taxes
 * every run of that story, silently and permanently. `normalizeTypableText` deletes
 * invisible characters for precisely this reason and leaves visible ones alone on
 * purpose; that judgement is only sound while the visible ones are typable, which is
 * the claim these tests are here to keep true.
 */
describe('the corpus is typeable', () => {
  it('contains only characters the app keyboard can produce', () => {
    const unreachable = typableText().flatMap(([where, text]) => {
      const bad = new Set([...normalizeTypableText(text)].filter((char) => !TYPABLE_CHARS.has(char)));
      return [...bad].map(
        (char) =>
          `${where}: ${JSON.stringify(char)} (U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`,
      );
    });

    // Sorted so the message is stable between runs rather than following data order.
    expect(unreachable.sort()).toEqual([]);
  });

  it('leaves nothing on the board with nothing to type', () => {
    // A paragraph made only of characters the normalizer deletes lands on an empty
    // board: no progress, no completion, no session recorded. `handleKeyInput` has a
    // guard for exactly this, which stops it recording nonsense — but the guard turns
    // a bug into a dead page rather than preventing one.
    //
    // Over `typableText()` rather than `STORIES`, so the check covers everything the
    // check above covers plus the landing passage and the three corpora it grew to cover
    // since — which is what let a dead front door stay dead through a version of this
    // file that named stories only.
    const dead = typableText()
      .filter(([, text]) => normalizeTypableText(text).length === 0)
      .map(([where]) => where);

    expect(dead).toEqual([]);
  });

  it('gives every story something to read and words to learn', () => {
    // An empty `paragraphs` array renders a board fed `''` with a Next button that can
    // never advance, on a page that otherwise looks healthy.
    const empty = STORIES.filter((s) => s.paragraphs.length === 0).map((s) => s.slug);
    expect(empty).toEqual([]);
    // The glossary section is hidden outright at zero, so it would simply vanish
    // rather than announce itself as broken.
    const noGlossary = STORIES.filter((s) => s.keyVocabulary.length === 0).map((s) => s.slug);
    expect(noGlossary).toEqual([]);
    // `/vocab` renders one section per bank; an empty one is a heading over nothing.
    const emptyBanks = VOCAB_BANKS.filter((b) => b.words.length === 0).map((b) => b.slug);
    expect(emptyBanks).toEqual([]);
  });

  it('gives every story a slug of its own', () => {
    // `generateStaticParams` returns one entry per story and the sitemap emits one URL
    // per slug. Two stories sharing one gives a route that resolves to whichever the
    // lookup found first, and a second story nobody can reach.
    const seen = new Map<string, number>();
    for (const story of STORIES) seen.set(story.slug, (seen.get(story.slug) ?? 0) + 1);
    expect([...seen].filter(([, count]) => count > 1).map(([slug]) => slug)).toEqual([]);
  });
});

describe('the corpus agrees with what it claims about itself', () => {
  it('counts the words each story actually has', () => {
    // `wordCount` is published in the story card, in the JSON-LD `wordCount` a crawler
    // reads, and beside the reading time. It is derived, so it cannot drift — but only
    // while it is derived from the same text the learner is actually given.
    const wrong = STORIES.filter((story) => {
      const actual = story.paragraphs
        .join(' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      return story.wordCount !== actual;
    }).map((s) => s.slug);
    expect(wrong).toEqual([]);
  });

  it('never calls a longer story quicker than a shorter one', () => {
    // `readingTimeMinutes` sat next to the word count on the catalog card and, worse, in
    // the same sentence as the word count itself on the story page — "180 words • ~3 min"
    // above a 202-word story reading "202 words • ~2 min". Eleven hand-entered numbers
    // that tracked nothing, so they contradicted the text they were describing: sorted
    // by length the corpus read 2, 2, 2, 2, 3, 2, 2, 3, 2, 2, 3 minutes.
    //
    // Stated as an ordering rather than as a number on purpose. It is the contradiction
    // a reader can see, and unlike "minutes equals words divided by some rate" it stays
    // true when that rate is retuned, which is the one thing here worth being able to do.
    const byLength = [...STORIES].sort((a, b) => a.wordCount - b.wordCount);
    const contradictions: string[] = [];

    for (let i = 1; i < byLength.length; i++) {
      const shorter = byLength[i - 1];
      const longer = byLength[i];
      if (longer.readingTimeMinutes < shorter.readingTimeMinutes) {
        contradictions.push(
          `${longer.slug} is ${longer.wordCount} words at ${longer.readingTimeMinutes} min, ` +
            `but the shorter ${shorter.slug} is ${shorter.wordCount} words at ${shorter.readingTimeMinutes} min`,
        );
      }
    }

    expect(contradictions).toEqual([]);
  });

  it('keeps every paragraph either a full Q&A drill or plain prose', () => {
    // Two consumers test the same question on different text: StoryReader tests the
    // raw paragraph, TypingEngine tests the normalised one. A paragraph that reads as
    // Q&A on the board and as prose in the panel is the same passage rendered two ways
    // by two components that both claim to be showing it.
    const isQA = (text: string) => text.startsWith('Q:') && text.includes(' A:');
    const mixed = STORIES.flatMap((story) =>
      story.paragraphs.flatMap((paragraph, i) =>
        isQA(paragraph) === isQA(normalizeTypableText(paragraph))
          ? []
          : [`${story.slug} paragraph ${i + 1}`],
      ),
    );
    expect(mixed).toEqual([]);
  });

  /**
   * A Q&A story is all drills, so its count and its label agree.
   *
   * `isQA` answers `some`, on purpose, so a module introduced by a paragraph of context
   * is still shown as a module; `qaCount` counts the drills under that same rule. Both
   * are correct for a story that is *only* drills, which is every one of the eleven.
   * Nothing enforced that, so the first mixed story would ship a card reading
   * "1 Q&A Questions" beside a "Practice Q&A Session" button.
   *
   * The part with no agreed fix is `StoryReader`'s header, which labels a paragraph
   * "Question 3 of 13" off `isQA` while counting against `paragraphs.length` — on the
   * one paragraph that is a question, in a story that holds one. Closing that needs a
   * product decision about what a mixed story should say, so rather than guess, this
   * records that the shape does not exist yet.
   *
   * ponytail: the corpus is uniform today. To add a mixed story, delete this and fix
   * the header's denominator in the same change — `qaCount` is already derived, so the
   * data half is done.
   */
  it('keeps a Q&A story all drills, so nothing has to count two ways', () => {
    const isQADrill = (text: string) => text.startsWith('Q:') && text.includes(' A:');
    const mixed = STORIES.filter((story) => {
      const drills = story.paragraphs.filter(isQADrill).length;
      return story.isQA && drills !== story.paragraphs.length;
    }).map((story) => story.slug);
    expect(mixed).toEqual([]);
  });

  /**
   * Every word in the glossary is a word in the story.
   *
   * The panel is headed "Key Vocabulary in this Story" and gives each entry a speaker
   * button, so it promises a word the learner is about to meet on the board. Seven
   * entries across three stories made that promise and kept it badly: `serverless`,
   * `provisioning`, `regression`, `reproducible`, `synchronization`, `indexing` and
   * `architecture` appeared nowhere in their own story — in one case only in the *slug*,
   * which is how `architecture` passed every earlier eyeball. They were plausible words
   * for the subject, written as topic notes rather than read out of the text, which is
   * exactly the kind of content that slips in unremarked.
   *
   * The summary counts. It is the story's own prose, the catalog card prints it, and three
   * entries (`perseverance`, `sacrifice`, `artisanal`) live only there — stripping the
   * summary out would fail them, and they are not wrong. The claim is about the story, not
   * about the typeable paragraphs.
   */
  it('draws every glossary word from its own story', () => {
    const untraceable = STORIES.flatMap((story) => {
      const prose = `${story.paragraphs.join(' ')}\n${story.summary}`.toLowerCase();
      return story.keyVocabulary
        .filter((entry) => !prose.includes(entry.word.toLowerCase()))
        .map((entry) => `${story.slug}: "${entry.word}"`);
    });

    // Sorted so the message is stable between runs rather than following data order.
    expect(untraceable.sort()).toEqual([]);
  });
});
/**
 * Every "Next.js <n>" the lessons ask a learner to type.
 *
 * Scoped to `STORIES` alone on purpose. The store's opening passage is not listed here
 * because `test/typingStore.test.ts` already asserts it is byte-identical to one of
 * these paragraphs, so covering the stories covers it — and a second copy of the text in
 * this file would be a third place to forget to update.
 */
const LESSON_TEXT = STORIES.flatMap((story) => [
  { where: `${story.slug} summary`, text: story.summary },
  ...story.paragraphs.map((p, i) => ({ where: `${story.slug} ¶${i + 1}`, text: p })),
]);

/** Every Next.js major the lessons name, with where it was named. */
function pinnedMajors(): { where: string; major: number }[] {
  return LESSON_TEXT.flatMap(({ where, text }) =>
    [...text.matchAll(/Next\.js (\d+)/g)].map((m) => ({ where, major: Number(m[1]) })),
  );
}

/**
 * The interview module taught a major that shipped over a year ago.
 *
 * "What is the main architectural benefit of React Server Components in Next.js 15?" was
 * still a fair question — RSC did go stable in 15, and an interviewer may well say 15 —
 * but the app builds on 16.3.5, so the corpus was a release behind on the one thing it
 * exists to prepare people for. The answer beside it never changed and did not need to;
 * only the version in the question did.
 *
 * The check is against `package.json` rather than a literal, because a literal would need
 * editing at every rotation and the whole point is that nobody has to remember. It is
 * `>=` and not `===` for the same reason: an interviewer asking about a *newer* Next.js
 * than the app runs is a question worth typing, and pinning it to this exact build would
 * fail it for the wrong reason.
 */
describe('the Next.js the lessons talk about', () => {
  const installed = Number(/^(\d+)\./.exec(pkg.dependencies.next)![1]);

  /**
   * The control. A regex that stopped matching, or a corpus that stopped naming a version,
   * would leave the loop below iterating over nothing and this file green — which is the
   * state it was in for a release.
   */
  it('is named somewhere, so the check below has something to check', () => {
    expect(pinnedMajors().length).toBeGreaterThan(0);
  });

  it('is never older than the build it ships in', () => {
    const stale = pinnedMajors().filter((p) => p.major < installed);
    expect(stale).toEqual([]);
  });
});
