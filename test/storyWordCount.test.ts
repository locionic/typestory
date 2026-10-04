import { describe, expect, it } from 'vitest';
import { STORIES } from '../data/stories';
import { wordsTyped } from '../lib/stats';
import { normalizeTypableText } from '../store/useTypingStore';

/**
 * The word count a story advertises, and the words a learner is credited for typing.
 *
 * `wordCount` is what the page prints beside the reading time, what the catalog sorts
 * "shortest" by, and what the story JSON-LD publishes to search engines. `wordsTyped` is
 * what goes into `totalWordsTyped` and behind the "Type over 1,000 words total" badge.
 * They are the same measure of the same passage and they have to agree, because a learner
 * who finishes a passage and is credited a different number than the one the card
 * promised has no way to tell which of the two is right.
 *
 * They agree on something that looks like a bug. Every Q&A paragraph is stored as
 * `Q: … A: …`, so a whitespace split counts `Q:` and `A:` as two more words per paragraph.
 * That looks like a module with 240 words of English in it being advertised as 250, and
 * the obvious tidy-up is to strip the markers where the count is derived — which breaks
 * exactly this agreement, because `wordsTyped` counts the markers too: the learner really
 * did type `Q:` and `A:`, and a run typed perfectly banks both. The markers are structural
 * scaffolding in the prose sense and characters in the typing sense, and this test is what
 * holds the second reading in place.
 */

const passage = (story: (typeof STORIES)[number]) => story.paragraphs.join(' ');

/** Tokens as a whitespace split reads them, which is what both counts do. */
function tokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The same passage with the two markers taken out, for the control below. */
function withoutMarkers(text: string): string {
  return text.replace(/Q:/g, ' ').replace(/ A:/g, ' ');
}

describe("a story's advertised word count", () => {
  it('is what a learner is credited for typing the passage perfectly', () => {
    const mismatched = STORIES.filter(
      (story) =>
        wordsTyped(passage(story), passage(story)) !== story.wordCount ||
        tokens(passage(story)) !== story.wordCount,
    );

    expect(mismatched.map((story) => story.slug)).toEqual([]);
  });

  /**
   * The control, and the reason the test above is not satisfied by an empty corpus or a
   * definition that collapsed. `Q:` markers have to exist for the distinction to be live,
   * and the marker-free count has to be genuinely different from the real one — otherwise
   * an implementation that stripped them, in `data/stories.ts` or in `wordsTyped`, would
   * leave both figures still agreeing with each other, on a number that is simply wrong.
   */
  it('counts something that stripping the Q&A markers would change', () => {
    const marked = STORIES.filter((story) => passage(story).includes('Q:'));
    expect(marked.length).toBeGreaterThan(0);

    const strippedDiffers = marked.filter(
      (story) => tokens(withoutMarkers(passage(story))) !== story.wordCount,
    );
    expect(strippedDiffers.length).toBe(marked.length);
  });
});
/**
 * Normalising a passage must not change how many words it has.
 *
 * The count above is checked against `story.paragraphs.join(' ')` — the paragraphs as
 * stored. The text a learner actually types is that run through
 * `normalizeTypableText`, which `loadCustomText` applies and `TypingEngine` applies
 * again. So every claim the word count makes — the number on the story page, the one the
 * catalog sorts by, the one in the JSON-LD search engines read, the one behind the 1,000
 * words badge — is a claim about text that has been rewritten on the way to the board,
 * and nothing compared the two.
 *
 * They agree, and for a reason worth writing down rather than leaving to luck. Every
 * character normalisation turns into a space is already a space as far as `tokens` is
 * concerned: `\s` matches all of them, ` ` through `　` and `﻿` included. So
 * a NBSP that was splitting a word was splitting it in both readings. And every character
 * normalisation deletes is one with no key and no whitespace — zero-width, bidi, the soft
 * hyphen — so removing it can join two characters but never split one. Normalisation is
 * therefore count-preserving, which is why this has never needed checking.
 *
 * Which is exactly what makes it worth checking: it holds for reasons nothing enforces.
 * The next edit to `normalizeTypableText` that spaces out punctuation — `-` to ` - `,
 * a colon to `: ` — would silently break every number on the card, and every assertion
 * in this file would still pass, because they all read the stored text.
 */
describe('a passage as the learner actually types it', () => {
  it('has the same number of words before and after normalising', () => {
    const shifted = STORIES.flatMap((story) =>
      story.paragraphs
        .filter((paragraph) => tokens(normalizeTypableText(paragraph)) !== tokens(paragraph))
        .map((paragraph) => `${story.slug}: ${JSON.stringify(paragraph.slice(0, 40))}`),
    );

    expect(shifted).toEqual([]);
  });

  it('credits a perfectly typed story what the story page advertised', () => {
    const miscounted = STORIES.filter((story) => {
      const typed = story.paragraphs.map(normalizeTypableText).join(' ');
      return wordsTyped(typed, typed) !== story.wordCount;
    });

    expect(miscounted.map((story) => story.slug)).toEqual([]);
  });
});
