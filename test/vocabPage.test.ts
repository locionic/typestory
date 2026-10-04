import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTypingStore } from '../store/useTypingStore';
import { clearUserStats } from '../lib/stats';
import { VOCAB_BANKS } from '../data/vocab';

// Confetti draws to a canvas jsdom does not implement, and the engine fires it the
// moment a passage completes.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

/**
 * A real enough router that a click actually navigates.
 *
 * `useSearchParams` is backed by React state and `replace` writes to that state, so the
 * page behaves the way it does in a browser: click a tab, the URL changes, the bank on
 * screen follows. Mocking `replace` as a no-op would have made the test unable to see the
 * bug at all — the whole defect is that the two did not move together.
 */
const mocks = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn(), suspend: false }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => {
    // The real hook is what opts this page out of static rendering, so what ships as the
    // HTML is the Suspense fallback rather than the page. Throwing a promise is that
    // behaviour, reproduced; the flag keeps it out of every test that is not about it.
    if (mocks.suspend) throw new Promise(() => {});
    const [params, setParams] = useState(mocks.params);
    mocks.replace.mockImplementation((url: string) => {
      setParams(new URL(url, 'http://localhost').searchParams);
    });
    return params;
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

beforeEach(() => {
  mocks.params = new URLSearchParams();
  mocks.replace.mockClear();
  mocks.suspend = false;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  // The tests below are the first in this file to finish a passage, and finishing one
  // records a session to localStorage on the engine's own. Nothing else here reads stats,
  // so this is not fixing a failure — it is keeping a run's record from outliving it.
  clearUserStats();
});

async function renderVocab(query = '') {
  const { default: VocabPage } = await import('../app/vocab/page');
  mocks.params = new URLSearchParams(query);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(VocabPage)));
  return host;
}

/** The tab button for a bank, found by the title the catalog card also uses. */
function tab(host: HTMLElement, label: string): HTMLElement {
  const match = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!match) throw new Error(`no tab labelled "${label}"`);
  return match as HTMLElement;
}

/**
 * The bank the typing board is actually showing.
 *
 * Not `host.textContent`: the tab bar renders every bank's name at once so the learner
 * can switch, so "Oxford 3000 Essentials is on the page" is true whichever bank is
 * loaded — an earlier version of this file asserted exactly that and passed against a
 * page that ignored the URL entirely. The store holds the one string that is only true
 * of the loaded bank — it is written from the bank prop, and it carries the word index
 * as well, which makes it the oracle for both "which bank" and "which word" in one read.
 */
const loaded = () => useTypingStore.getState().title;

/**
 * The tab bar and the address bar describing different banks.
 *
 * `useLinkedBank` read `?bank=` on the way into a lazy `useState`, so it was the value at
 * mount and nothing ever moved it again. The three bank cards on the landing page are the
 * only deep links into this page, so the URL is meant to name the bank — and it stopped
 * agreeing with the screen the moment anyone clicked a tab.
 *
 * The sequence: open `/vocab?bank=ielts-academic` from a landing-page card, click the
 * "Developer & Tech English" tab, and Developer is on screen while the address bar still
 * reads `ielts-academic`. That URL is now a bookmark to the wrong bank. Follow the Navbar's
 * plain "Word Banks" link back to `/vocab` and it is worse — the code reads a bare `/vocab`
 * as "first bank", so a copied address bar opens Full-Stack in a new tab while this one
 * still shows Developer. The bar was never a description of the page.
 */
describe('the vocabulary drill keeps the URL and the screen together', () => {
  it('opens the bank the link named', async () => {
    await renderVocab('bank=ielts-academic');
    expect(loaded()).toContain('IELTS Academic Vocabulary (1/');
  });

  it('writes the bank it switched to into the URL', async () => {
    const host = await renderVocab('bank=ielts-academic');
    act(() => tab(host, 'Developer & Tech English').click());

    expect(mocks.replace).toHaveBeenCalledWith('/vocab?bank=tech-developer');
    expect(loaded()).toContain('Developer & Tech English (1/');
  });

  /**
   * The bookmark case, and the reason the two assertions above are not enough: the
   * address bar has to be readable *after* the switch, not merely written to. What the
   * page shows is what the page's own code means by that URL.
   */
  it('shows the bank its own URL names, once it has been switched', async () => {
    const host = await renderVocab('bank=ielts-academic');
    act(() => tab(host, 'Oxford 3000 Essentials').click());

    expect(loaded()).toContain('Oxford 3000 Essentials (1/');
    const slug = mocks.replace.mock.calls.at(-1)![0] as string;
    expect(slug).toBe('/vocab?bank=oxford-essential');

    // And the round trip a bookmark performs: reload on that URL, same bank.
    await renderVocab('bank=oxford-essential');
    expect(loaded()).toContain('Oxford 3000 Essentials (1/');
  });

  /**
   * The index has to be thrown away with the bank.
   *
   * Advancing first is the whole test: switching banks from word 1 proves nothing, because
   * 1 is where a reset lands and also where a component that forgot to reset already is.
   */
  it('starts a newly chosen bank at its first word', async () => {
    const host = await renderVocab('bank=ielts-academic');

    // Walk into the middle of the bank, so a stale index would be visible.
    for (let i = 0; i < 4; i += 1) act(() => tab(host, 'Next').click());
    expect(useTypingStore.getState().title).toContain('IELTS Academic Vocabulary (5/');

    act(() => tab(host, 'Developer & Tech English').click());

    expect(loaded()).toContain('Developer & Tech English (1/');
  });

  it('falls back to the first bank on a bare link', async () => {
    await renderVocab();
    expect(loaded()).toContain('Full-Stack, RAG & Cloud Terminology (1/');
    expect(useTypingStore.getState().sourceType).toBe('vocab');
  });

  /**
   * The same, in the HTML the server sends.
   *
   * Every test above reads its oracle out of the store, which is why none of them could
   * see this: Zustand hands `useSyncExternalStore` its `getInitialState()` as the server
   * snapshot, so the markup is built from the store as it was at boot — the home page's
   * sample question — no matter what the page writes during render. `/vocab` therefore
   * shipped "English Word Banks" and a correct word card over a board asking for a B2
   * interview question. `renderToStaticMarkup` runs the render phase and no effects, which
   * is the only way to hold the server still like that.
   *
   * Asserted on the board's own header, the one string carrying the bank title *and* a
   * position. The tab bar above prints all four bank names at once, so the title alone is
   * on the page whichever bank is loaded.
   */
  it('server-renders the requested bank onto the board, not the store’s boot passage', async () => {
    const { default: VocabPage } = await import('../app/vocab/page');
    mocks.params = new URLSearchParams('bank=ielts-academic');
    const html = renderToStaticMarkup(createElement(VocabPage));

    expect(html).toContain('IELTS Academic Vocabulary (1/');
    expect(html).not.toContain('What is the main architectural benefit');
  });
});

/**
 * Whether the page is identifiable in the HTML that actually ships.
 *
 * `useSearchParams` is the one hook that opts this page out of static rendering, so the
 * prerendered `/vocab` document is the Suspense fallback and not the page — the whole
 * reason the boundary is there, as its own note says. The fallback was a lone spinner, so
 * the document that reached a learner before the drill existed had no heading, no landmark
 * and no text: a screen reader arriving on `/vocab` was told nothing, not even the page's
 * name, and the heading appeared from nowhere once the client took over. This is the fourth
 * page to get this treatment and the only one whose loading state is a boundary rather than
 * an early return, which is why it was the one left behind.
 *
 * The two states are compared rather than the string written out, because the failure this
 * guards against is the two drifting apart — and a literal here would keep passing after
 * the page's heading was renamed and the fallback was not.
 */
describe('the page before the URL is known', () => {
  it('names the page in the fallback that ships as the HTML', async () => {
    mocks.suspend = true;
    const during = await renderVocab();
    const fallbackHeading = during.querySelector('h1')?.textContent;

    mocks.suspend = false;
    const after = await renderVocab();

    expect(fallbackHeading).toBe('English Word Banks');
    expect(fallbackHeading).toBe(after.querySelector('h1')?.textContent);
  });
});

/**
 * The name a screen reader gets for `el`.
 *
 * `aria-label` only, deliberately. A `title` is a tooltip — it is not exposed as a name,
 * and it is not shown on a touch screen — so reading one here would hide the exact defect
 * this checks for. The control below pins that, and it is the same rule the catalog block
 * in `test/storyReader.test.ts` and `test/tailwindColours.test.ts` already apply.
 */
const accessibleName = (el: Element) => el.getAttribute('aria-label')?.trim() ?? '';

/**
 * The button that speaks the word, found by what it is rather than where it is.
 *
 * It is the only control on the page with nothing in it but an icon, which is also the
 * whole problem: an icon is not a name, and a name is all a screen reader has to go on.
 * Counting them rather than indexing one means a second unnamed icon would fail here
 * instead of being silently ignored.
 */
function speakButton(host: HTMLElement): HTMLButtonElement {
  const iconOnly = [...host.querySelectorAll('button')].filter(
    (b) => !b.textContent?.trim() && b.querySelector('svg'),
  );
  expect(iconOnly).toHaveLength(1);
  return iconOnly[0] as HTMLButtonElement;
}

describe('the pronunciation button', () => {
  /**
   * The same defect the story glossary had, missed here. Its tooltip read "Hear word
   * pronunciation" and carried no `aria-label`, so the control had no accessible name at
   * all — and the tooltip named the action rather than the word, so even a screen reader
   * that fell back to it would have heard the same sentence for all eight words in a bank.
   *
   * It is the one action on the page. The card is there to be studied, and hearing the
   * word is how you learn to spell it back.
   */
  it('is named, and names the word it speaks', async () => {
    const host = await renderVocab('bank=ielts-academic');
    const name = accessibleName(speakButton(host));

    expect(name).not.toBe('');
    expect(name).toContain('ubiquitous');
  });

  /**
   * The control for `accessibleName` above, in the shape this file already uses elsewhere.
   * A helper that fell back to `title` would pass the test above with the defect still
   * shipping, and the only thing standing between that and a green suite is this one.
   */
  it('would not accept a tooltip as a name', () => {
    const tooltipOnly = document.createElement('button');
    tooltipOnly.setAttribute('title', 'Hear word pronunciation');

    expect(accessibleName(tooltipOnly)).toBe('');
  });
});

/**
 * Which tab says it is the open one.
 *
 * `aria-pressed` is the toggle-button pattern: the state is not in the pixels and not in
 * the text, so without it a screen reader announces four identical buttons. The URL is
 * what a learner gets from copying the address bar, and the tab is what a screen reader
 * gets — the two halves have to agree, or the fix above traded one disagreement for
 * another. `test/selectionState.test.ts` pins that the attribute is written at all; this
 * is the half it cannot check, which is whether the value in the rendered DOM tracks the
 * bank the URL actually names. `/vocab` has no prerendered HTML to inspect — it is a
 * Suspense shell, because `useSearchParams` opts it out of static rendering — so a render
 * is the only place this can be read.
 */
function pressed(host: HTMLElement, label: string): string | null {
  return tab(host, label).getAttribute('aria-pressed');
}

describe('the bank tabs say which one is open', () => {
  it('presses the bank the URL names, and no other', async () => {
    const host = await renderVocab('?bank=ielts-academic');

    expect(pressed(host, 'IELTS Academic Vocabulary')).toBe('true');
    for (const bank of VOCAB_BANKS.filter((b) => b.slug !== 'ielts-academic')) {
      expect(pressed(host, bank.title)).toBe('false');
    }
  });

  /**
   * A bank tab is a toggle, and the pressed state has to be `false`, not absent, on the
   * three that are not open. The URL carries the choice, but a learner pressing the
   * already-open tab has to be told it was already down — which is what the unpressed
   * buttons being explicitly unpressed is for. Four pressed tabs would say four banks
   * are open at once; none would say none is.
   */
  it('leaves the others explicitly unpressed rather than silent', async () => {
    const host = await renderVocab('');

    const states = VOCAB_BANKS.map((bank) => pressed(host, bank.title));
    expect(states.filter((s) => s === 'true')).toHaveLength(1);
    expect(states.filter((s) => s === 'false')).toHaveLength(VOCAB_BANKS.length - 1);
  });
});

/** The text the typing board is asking the learner to type. */
const onBoard = () => useTypingStore.getState().targetText;

/** The vocab page's own Next/Prev, as buttons rather than the tab helper's elements. */
function stepper(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no "${label}" control on the page`);
  return found as HTMLButtonElement;
}

/**
 * The two ends of a bank, which nothing exercised.
 *
 * The drill is eight words long at most in every bank in `data/vocab.ts`, so a learner
 * reaches the last one in a few clicks and then sits there. Forward motion was already
 * covered incidentally, by a test about switching banks that walks four clicks into a bank
 * (`test/vocabPage.test.ts:138`); nothing covered the ends, and nothing walked a bank all
 * the way to its last word.
 *
 * The property worth having is that the position label and the word on the board agree at
 * every position. They are written from two different places — the index is the page's,
 * the text is the store's — and they are kept in step by one mechanism: `wordTitle` carries
 * the position, and `loadCustomText` re-seeds the board only when that string changes
 * (`app/vocab/page.tsx:44-54`). Drop the position from that string and the card walks on
 * while the board sits on word 1 for the whole bank, which is the lag that comment was
 * written about. Nothing else in the app compares the two, so nothing else would see it.
 *
 * What this deliberately does not assert is the handler's own guard at `:58` and `:64`.
 * Both ends are `disabled` on the button first (`:173`, `:182`), and a disabled button does
 * not fire a click — so a test that clicked past the end would pass just as happily with
 * the guard deleted. Verified, by canary: loosening the guard to `< words.length` left this
 * file entirely green. The `disabled` assertions below are what can actually be broken, and
 * a visibly-enabled dead button is its own defect.
 */
describe('the ends of a word bank', () => {
  // A bare `/vocab` is read as the first bank — already pinned above — so the word list
  // written out here is the list the page is actually walking, with no literal to drift.
  const words = VOCAB_BANKS[0].words;

  it('carries the last word onto the board, labelled as the last word', async () => {
    const host = await renderVocab();
    for (let i = 1; i < words.length; i += 1) act(() => stepper(host, 'Next').click());

    // The pair, which is the whole claim. `not.toBe(words[0].word)` is the control for the
    // oracle: if the store read here were not the one the board shows, both assertions
    // would agree with each other and mean nothing.
    expect(loaded()).toContain(`(${words.length}/${words.length})`);
    expect(onBoard()).toBe(words[words.length - 1].word);
    expect(onBoard()).not.toBe(words[0].word);

    expect(stepper(host, 'Next').disabled).toBe(true);
  });

  it('carries the first word back onto the board when stepping back to it', async () => {
    const host = await renderVocab();
    for (let i = 1; i < words.length; i += 1) act(() => stepper(host, 'Next').click());
    expect(onBoard()).toBe(words[words.length - 1].word);

    // Back to the start the long way, which is the only way to prove the return trip
    // re-seeds as well as the outward one.
    for (let i = 1; i < words.length; i += 1) act(() => stepper(host, 'Prev').click());

    expect(loaded()).toContain(`(1/${words.length})`);
    expect(onBoard()).toBe(words[0].word);
    expect(stepper(host, 'Prev').disabled).toBe(true);
  });
});

/**
 * Typing a word and moving on, which is the drill's whole loop.
 *
 * The bank above is walked by clicking the page's own Next, whose handler calls
 * `handleNext` directly. Nothing reached the engine's `onNext` — the "Next Word (Enter ↵)"
 * button on the completion card, and the Enter key bound to the same handler. Two surfaces
 * use it (`/vocab` and `/stories/[slug]`), it is the only control a finished drill offers
 * besides restarting, and both routes sit behind two conditions nothing asserted: the run
 * has to be *complete* for either to exist, and `onNext` has to be `undefined` on the last
 * word, or the learner is handed a Next that cannot go anywhere.
 *
 * The word is typed through the store rather than through key events, so what these check
 * is the advance and not the keyboard listener standing in front of it.
 */
describe('moving on after typing a word', () => {
  const words = VOCAB_BANKS[0].words;

  /** Type whatever the board is currently asking for, in full. */
  const typeTheWord = () => {
    const store = useTypingStore.getState();
    act(() => {
      for (const char of store.targetText) store.handleKeyInput(char);
    });
  };

  /**
   * The advance control, which exists only on a finished word that is not the last one.
   *
   * Matched on the label rather than indexed, because the label is what the learner reads
   * and the thing being claimed is that it is offered. `undefined` is a legitimate answer
   * and the last test below depends on it being distinguishable from a button that failed
   * to render.
   */
  const nextWordButton = (host: HTMLElement) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Next Word'));

  it('offers a way on, and puts the next word on the board', async () => {
    const host = await renderVocab();

    typeTheWord();
    const advance = nextWordButton(host);
    expect(advance).toBeDefined();

    act(() => advance!.click());

    expect(onBoard()).toBe(words[1].word);
    expect(loaded()).toContain(`(2/${words.length})`);
  });

  /**
   * The same handler, reached by the key rather than the mouse.
   *
   * The button's own label promises it — "(Enter ↵)" is printed on the control — so a
   * label advertising a shortcut that does nothing is its own defect, and this is the only
   * place either half of that promise is checked.
   *
   * Dispatched on `document.body` rather than on `window`, because the listener reads
   * `e.target.closest(...)`: a real keypress always has an element for a target, and the
   * page's own controls are what decide whether this board claims the key.
   */
  it('advances on Enter, which is what the button promises', async () => {
    await renderVocab();
    typeTheWord();

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onBoard()).toBe(words[1].word);
  });

  /**
   * The other end of the same condition, and the reason the `&&` is there at all: the last
   * word in a bank has nothing after it, so `onNext` is `undefined` and the completion card
   * offers a restart instead. A Next button here would be dead on click, and the learner
   * would have to discover that to find out the bank had ended.
   */
  it('offers no way on from the last word, which is the end of the bank', async () => {
    const host = await renderVocab();
    for (let i = 1; i < words.length; i += 1) act(() => stepper(host, 'Next').click());

    typeTheWord();

    // Spelled out rather than inferred from the position: a word that never reached the
    // board would leave the button absent for the wrong reason and pass this.
    expect(onBoard()).toBe(words[words.length - 1].word);
    expect(nextWordButton(host)).toBeUndefined();
  });
});
