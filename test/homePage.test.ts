import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import HomePage, { featuredStories } from '../app/page';
import { STORIES } from '../data/stories';
import { VOCAB_BANKS } from '../data/vocab';
import { StoryItem } from '../lib/types';
import { useTypingStore } from '../store/useTypingStore';

// The landing page renders the typing board, and the board fires confetti on completion —
// a canvas jsdom does not implement.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

// Same requirement as test/boardReadout.test.ts: React refuses to drive an `act` scope
// unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

/**
 * What the store held before any test touched it: the landing sample.
 *
 * Captured by value, because `loadCustomText` replaces the state object rather than
 * mutating it, and `resetSession` deliberately keeps the passage — so the only way back
 * to the boot text is to have kept it.
 */
const BOOT = { ...useTypingStore.getState() };

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  useTypingStore.setState(BOOT);
});

/**
 * The stories behind the three cards the landing page renders, read out of the DOM.
 *
 * Deliberately not a call to `featuredStories(STORIES)`. The defect was never that a
 * selection went stale — it was that the page *showed* three developer modules under a
 * heading promising English literature. Only the rendered card list can say whether the
 * section delivers what its copy claims; a test that calls the helper proves the helper
 * works and says nothing about what a learner sees.
 */
function featured(): StoryItem[] {
  const section = sectionNamed(renderHome(), 'Type Along With Real Stories');
  // `/stories/` and not `/stories`: the section's own "View all stories" link is a
  // sibling of the grid, not a card, and it would come back as a story slug.
  const slugs = [...section.querySelectorAll('a[href^="/stories/"]')].map((card) =>
    card.getAttribute('href')!.replace('/stories/', ''),
  );

  const stories = slugs.map((slug) => STORIES.find((story) => story.slug === slug));
  // A card linking at no story is a dead link, and the assertions below would quietly
  // read a shorter list rather than fail. Caught here, where it can be named.
  expect(stories).not.toContain(undefined);
  return stories as StoryItem[];
}

/** The landing page, rendered once per call and torn down by `afterEach`. */
function renderHome(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(HomePage)));
  return host;
}

/** The section under a heading, found by the heading a learner reads rather than by index. */
function sectionNamed(host: HTMLElement, heading: string): Element {
  const found = [...host.querySelectorAll('section')].find(
    (node) => node.querySelector('h2')?.textContent?.trim() === heading,
  );
  if (!found) throw new Error(`the landing page has no "${heading}" section`);
  return found;
}

describe('the landing page featured stories', () => {
  it('show more than one kind of story', () => {
    const stories = featured();
    expect(stories.length).toBeGreaterThan(1);
    expect(new Set(stories.map((story) => story.category)).size).toBeGreaterThan(1);
  });

  /**
   * The claim the section actually makes. "Type Along With Real Stories" over "absorbing
   * rich, contextual English literature" is a promise about genre, and a grid of
   * `Level B2` technical interview modules does not keep it however many of them there
   * are — three cards of one kind is still one kind.
   */
  it('include at least one for the English literature the section promises', () => {
    expect(featured().map((story) => story.category)).toContain('fable');
  });

  /**
   * The control, and the reason the two above are not satisfied by a helper that returns
   * whatever it likes. Handed a corpus with nothing but technical modules — which is what
   * the first four stories of `STORIES` are, and what the slice returned — the selector
   * finds one and stops. It cannot manufacture variety, so the variety the real corpus
   * produces comes from the corpus rather than from the rule.
   */
  it('cannot invent variety that the corpus does not have', () => {
    const onlyTech = STORIES.filter((story) => story.category === 'tech');
    expect(onlyTech.length).toBeGreaterThan(1);

    const picked = featuredStories(onlyTech);
    expect(picked).toHaveLength(1);
    expect(new Set(picked.map((story) => story.category)).size).toBe(1);
  });
});

/**
 * Where the word bank cards actually go.
 *
 * All four pointed at a bare `/vocab`, so clicking the card that says "IELTS Academic
 * Vocabulary" opened whichever bank happened to be first. Nothing on screen said the click
 * had been discarded — the card read as a link to that bank and was not one.
 *
 * `test/vocabPage.test.ts` covers the other half of this: it opens `/vocab?bank=…` and
 * checks which bank comes up, and it exercises switching between them. It types that URL
 * as its own input, so it would have passed just as well if every card in here had gone
 * back to pointing at a bare `/vocab`. The half that can regress is the half that builds
 * the link, and this is the only test that renders the landing page to look at one.
 */

/**
 * The four cards, read structurally.
 *
 * `div.grid > a` rather than `a[href*=bank]`, because selecting on the thing under test
 * reports success by finding nothing at all — a build where every card had lost its
 * parameter would hand back an empty list, not a failure. This selector cannot do that,
 * and the comparison below pins how many cards it found.
 */
function bankCards(): HTMLAnchorElement[] {
  const cards = [...sectionNamed(renderHome(), 'Targeted Word Banks').querySelectorAll('div.grid > a')];
  // The section header's own "Explore word banks" link sits outside the grid, so anything
  // here really is a bank. Thrown rather than asserted so a restructure says which half
  // moved instead of reading as four cards that all link somewhere.
  if (cards.length === 0) throw new Error('the word bank section rendered no cards');
  return cards as HTMLAnchorElement[];
}

describe('the landing page word bank cards', () => {
  it('each open the bank the card names', () => {
    expect(bankCards().map((card) => card.getAttribute('href'))).toEqual(
      VOCAB_BANKS.map((bank) => `/vocab?bank=${bank.slug}`),
    );
  });

  /**
   * The control, and the shape the regression actually took: four cards pointing at four
   * banks, not four cards pointing at one. Comparing against `VOCAB_BANKS` alone would
   * not catch a list that had been sliced down to a single bank and rendered four times,
   * so the hrefs are asserted to be four distinct destinations — every bank reachable
   * from the page that advertises it.
   */
  it('send a learner to four different places', () => {
    const hrefs = bankCards().map((card) => card.getAttribute('href'));

    expect(hrefs.length).toBeGreaterThan(1);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
/**
 * The landing page's own passage, and the one board in the app that has one and never
 * uses it.
 *
 * Every other board is handed its text: `StoryReader` passes the current paragraph,
 * `/vocab` passes the current word, both with a title carrying the position, and both seed
 * the store from it on arrival. This page passes neither — `<TypingEngine />` bare — so
 * the board reads `targetText` and `title` straight out of the store. On a cold load that
 * happens to be the landing sample, and `test/typingStore.test.ts` pins that the store
 * boots with one, which is what makes the arrangement look right.
 *
 * It is only right on arrival. The store is a module singleton that outlives every
 * component, so it is still holding whatever the last page left in it: a learner who
 * practises a pasted chapter on `/custom` and clicks the logo lands here to find their
 * own novel on the board, under a heading reading "Custom Text", beneath a hero promising
 * technical Q&A and real stories — plus whatever they had already typed, so pressing any
 * key continues that run and records it against this page. `TypingEngine`'s own comment
 * names this page as the surface that "does not own a passage of its own", which was true
 * when it was written and stopped being true the moment `/custom` grew a textarea.
 *
 * Both halves are asserted. What the board *displays* is one question, and what
 * `handleKeyInput` compares against — which decides the WPM, the accuracy and the recorded
 * session — is another, and a fix that moved only the first would leave the learner typing
 * one passage and being scored on another.
 */
describe('the landing page board', () => {
  const PASTED = 'The lantern gutters and the ledger lies.';

  /** The passage on the board, off the character spans it is rendered into. */
  function boardText(host: HTMLElement): string {
    const board = host.querySelector('div.select-none');
    if (!board) throw new Error('the landing page renders no board');
    // The board draws a space as U+00A0 so a run of them keeps its width; the
    // passage is the same string with ordinary spaces.
    return (board.textContent ?? '').replace(/\u00a0/g, ' ');
  }

  /** A learner who practised on `/custom` and came home by clicking the logo. */
  const pastesElsewhere = () =>
    act(() => {
      useTypingStore.getState().loadCustomText(PASTED, 'Custom Text', 'custom');
    });

  it('shows its own sample rather than the session another page left behind', () => {
    pastesElsewhere();

    expect(boardText(renderHome())).not.toContain(PASTED);
  });

  it('scores the keystrokes against what it is showing', () => {
    pastesElsewhere();

    renderHome();

    expect(useTypingStore.getState().targetText).not.toBe(PASTED);
  });

  /**
   * The control, and the reason the two above mean anything: both are also true of a page
   * that renders no board at all. This is the half that says the sample is still there
   * after the fix — a landing page that emptied itself would pass both.
   */
  it('still shows the sample on a cold visit', () => {
    expect(boardText(renderHome())).toBe(BOOT.targetText);
  });
});
