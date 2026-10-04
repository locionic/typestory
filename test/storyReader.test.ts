import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import StoryReader from '../components/typing/StoryReader';
import StoriesCatalog from '../components/stories/StoriesCatalog';
import { STORIES } from '../data/stories';
import { useTypingStore, normalizeTypableText } from '../store/useTypingStore';
import type { StoryItem } from '../lib/types';

// Confetti draws to a canvas jsdom does not implement. The engine fires it on completion,
// which none of these tests reach, but the module is imported either way.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

const story = (slug: string): StoryItem => {
  const found = STORIES.find((s) => s.slug === slug);
  if (!found) throw new Error(`no story "${slug}"`);
  return found;
};

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

const reader = (slug: string) => render(createElement(StoryReader, { story: story(slug) }));
const catalog = (slug: string) => render(createElement(StoriesCatalog, { initialStories: [story(slug)] }));
const shown = (host: HTMLElement) => host.textContent ?? '';

/**
 * Type the loaded passage out, so the completion card mounts.
 *
 * The advance button's label lives on that card and nowhere else — mid-passage there is
 * no button to label, so a test that does not finish a passage cannot see it and would
 * pass against either wording.
 */
function completePassage() {
  const store = useTypingStore.getState();
  const text = store.targetText;
  act(() => {
    for (const ch of text) useTypingStore.getState().handleKeyInput(ch);
  });
}

/**
 * Whether a story is a Q&A drill, decided by the text rather than the category.
 *
 * `category: 'tech'` was doing two unrelated jobs: it is the "Tech & Engineering" browse
 * filter in the catalog, and it was also the test for "is this an interview Q&A module".
 * Two of the six tech stories are narrative essays with no `Q:` and no `A:` anywhere in
 * them, so the second job returned the wrong answer for them — a category that is true of
 * six stories answering a question about eight.
 *
 * Kept here as the oracle rather than imported from the source, so a change to the rule
 * under test has to be made deliberately in both places before these tests agree again.
 */
const isQaDrill = (s: StoryItem) =>
  s.paragraphs.some((p) => p.startsWith('Q:') && p.includes(' A:'));

describe('the story page labels match the story', () => {
  it('counts a narrative essay about technology in paragraphs, not questions', () => {
    // Six paragraphs of prose about Berners-Lee at CERN. Category 'tech', zero Q&A.
    const s = story('the-birth-of-the-world-wide-web');
    expect(s.category).toBe('tech');
    expect(isQaDrill(s)).toBe(false);

    const host = reader(s.slug);
    const text = shown(host);
    expect(text).toContain(`Paragraph 1 of ${s.paragraphs.length}`);
    expect(text).not.toContain('Question 1 of');
    expect(text).not.toContain('Technical Interview Questions');

    completePassage();
    expect(shown(host)).toContain('Next Paragraph');
    expect(shown(host)).not.toContain('Next Question');
  });

  it('counts an interview module in questions', () => {
    // The control: same category, genuinely a Q&A drill, and its labels must survive.
    const s = story('modern-full-stack-web-architecture');
    expect(isQaDrill(s)).toBe(true);

    const host = reader(s.slug);
    const text = shown(host);
    expect(text).toContain(`Question 1 of ${s.paragraphs.length}`);
    expect(text).toContain('Technical Interview Questions & Model Answers');

    completePassage();
    expect(shown(host)).toContain('Next Question');
  });

  it('leaves a non-tech narrative alone, so the fix is about the category and nothing else', () => {
    const s = story('the-tortoise-and-the-hare');
    expect(s.category).not.toBe('tech');

    const text = shown(reader(s.slug));
    expect(text).toContain(`Paragraph 1 of ${s.paragraphs.length}`);
    expect(text).not.toContain('Question 1 of');
  });
});

/**
 * The catalog makes the same claim one page earlier, in the form that decides whether
 * someone opens the story at all: "5 Q&A Questions / Practice Q&A Session" on a story
 * with no questions in it.
 */
describe('the catalog card', () => {
  it('offers a tech essay by word count rather than as a Q&A session', () => {
    const s = story('the-first-computer-bug');
    expect(s.category).toBe('tech');
    expect(isQaDrill(s)).toBe(false);

    const text = shown(catalog(s.slug));
    expect(text).toContain(`${s.wordCount} words`);
    expect(text).toContain('Start Typing Session');
    expect(text).not.toContain('Q&A Questions');
    expect(text).not.toContain('Practice Q&A Session');
  });

  it('still offers an interview module as a Q&A session', () => {
    const s = story('database-design-distributed-systems');
    expect(isQaDrill(s)).toBe(true);

    const text = shown(catalog(s.slug));
    expect(text).toContain(`${s.qaCount} Q&A Questions`);
    expect(text).toContain('Practice Q&A Session');
  });

  /**
   * The number has to be the number of questions, which `paragraphs.length` is not.
   *
   * `isQA` answers `some` — deliberately, so a module introduced by a paragraph of
   * context is still a module — while the count beside it answered `every`. Nothing in
   * the corpus separated the two, because all four drill stories have every paragraph a
   * drill, so the bug was held in place by the data rather than by the reasoning. This
   * builds the one story that separates them, by adding the context paragraph `some`
   * was chosen to accommodate, and the two counts are then provably different.
   *
   * Asserted against a rendered card rather than the field, because the card is the
   * claim a learner reads; the field is only what the fix changed.
   */
  it('counts the questions it has, not every paragraph', () => {
    const s = story('database-design-distributed-systems');
    const mixed: StoryItem = {
      ...s,
      paragraphs: ['A paragraph of context, introducing the module in prose.', ...s.paragraphs],
      isQA: true,
      qaCount: s.qaCount,
    };
    // Precondition: the two counts really do differ, so this cannot pass by accident.
    expect(mixed.paragraphs.length).not.toBe(mixed.qaCount);

    const text = shown(render(createElement(StoriesCatalog, { initialStories: [mixed] })));
    expect(text).toContain(`${mixed.qaCount} Q&A Questions`);
    expect(text).not.toContain(`${mixed.paragraphs.length} Q&A Questions`);
  });
});

/**
 * What a screen reader calls each control on the catalog.
 *
 * The search field is the only way to reach a story other than by filtering, and it was
 * the only form control in the app with no accessible name. The two selects beside it
 * carry `aria-label`; /tutor, /writing and /custom all use a real `<label htmlFor>`. A
 * placeholder is neither of those — it is not an accessible name, and it stops saying what
 * the field is the moment a character is typed.
 *
 * Every control rather than the search box alone, so one added later without a name fails
 * here instead of shipping. `placeholder` is deliberately not counted as a name: accepting
 * it here would pass against the defect this exists to catch.
 */
describe('every control on the catalog is named', () => {
  const accessibleName = (host: HTMLElement, el: Element): string => {
    const aria = el.getAttribute('aria-label')?.trim();
    if (aria) return aria;
    const id = el.getAttribute('id');
    if (!id) return '';
    const label = [...host.querySelectorAll('label')].find((l) => l.htmlFor === id);
    return label?.textContent?.trim() ?? '';
  };

  it('names every input, select and textarea the catalog renders', () => {
    const host = catalog('the-tortoise-and-the-hare');
    const controls = [...host.querySelectorAll('input, select, textarea')];

    // The precondition: a suite that found no controls would otherwise pass vacuously.
    expect(controls.length).toBe(3);

    const unnamed = controls
      .filter((el) => accessibleName(host, el) === '')
      .map((el) => el.outerHTML.slice(0, 120));
    expect(unnamed).toEqual([]);
  });

  it('names the search box with the same words it shows', () => {
    // A label that names the control as something else is not a label, and the placeholder
    // is the only thing a sighted learner has to go on.
    const host = catalog('the-tortoise-and-the-hare');
    const input = host.querySelector<HTMLInputElement>('#stories-search');
    expect(input?.placeholder).toBe('Search stories by title, author, or topic...');
    expect(accessibleName(host, input!)).toBe(
      (input?.placeholder ?? '').replace(/\.\.\.$/, ''),
    );
  });

  it('does not count a placeholder as a name, which is what this guards against', () => {
    // The canary. A helper that fell back to `placeholder` would pass both tests above
    // while the defect they exist for was still shipping, and the only thing standing
    // between that edit and a green suite is this one.
    const bare = document.createElement('input');
    bare.setAttribute('placeholder', 'Search stories by title, author, or topic...');
    expect(accessibleName(document.body, bare)).toBe('');
  });
});

/**
 * The board, and which passage it is holding.
 *
 * `StoryReader` seeds the typing store from a `useEffect`, and an effect runs after the
 * first commit — so on every `/stories/[slug]` page the learner watched a board built for
 * the home page's sample passage, "What is the main architectural benefit of React Server
 * Components in Next.js 16?", sit under a header naming the story they asked for: an A2
 * fable advertised as "Level A2 / Beginner Friendly / Paragraph 1 of 6" while the thing to
 * type was the first question of a B2 interview module. One commit of wrong text on all
 * eleven pages, every visit, until the effect caught up.
 *
 * The store is now written during render instead, and these pin that from both ends: one
 * proves the write happens in the render phase, before any effect could have run, and one
 * proves the board ends up reading the right passage.
 *
 * The store write is not enough on its own, and the third test is why. Zustand hands
 * `useSyncExternalStore` its `getInitialState()` as the server snapshot, so every store
 * read during SSR returns the store as it was created — the home page's sample passage —
 * no matter what a render has written since. Moving the write earlier cannot reach the
 * server. The passage therefore reaches the board as a page input, and the store is still
 * seeded alongside it because `handleKeyInput` needs the next expected character.
 */
describe('the board on the story page', () => {
  /**
   * The store as the app boots, read at module load before anything has rendered.
   *
   * Restored before each of these. Without it a test inherits the previous one's leftovers
   * — and the `reader()` tests do seed the store, because `act` runs their effects — so
   * the control would pass on the strength of whatever ran before it.
   */
  const BOOT = useTypingStore.getState();

  beforeEach(() => {
    useTypingStore.setState({
      title: BOOT.title,
      targetText: BOOT.targetText,
      typedText: BOOT.typedText,
    });
  });

  /**
   * Two boards on one page, which is what a render-phase seed cannot survive.
   *
   * The seed used to run in the page's render, and the pages that did it were outside the
   * store subscription — so a board never heard itself write. Moving the write into the
   * board, which is what it took for the landing page to own its sample (a server component
   * cannot seed a store), put every board inside the subscription: the first write woke the
   * second, which saw the store holding somebody else's passage, and wrote its own back.
   * Each write woke both. `render` here mounts two readers into one document, and the
   * assert is the only thing this can be — the failure mode was not a wrong value but no
   * value at all.
   *
   * Nothing a learner sees is pinned here rather than in the test this replaced, which
   * asserted the store held the passage *before effects ran*. That is what has gone: it is
   * unreachable now, and what it protected — the board not showing the wrong passage on its
   * first commit — is impossible by construction, because the board renders from the
   * `passage` prop and never from the store. The HTML the server sends is asserted in the
   * test below; this one holds the keyboard, which is the half that still reads the store.
   */
  it('settles on one passage when a second board is on the page', () => {
    const hare = story('the-tortoise-and-the-hare');
    const dialogue = story('daily-coffee-shop-dialogue');

    render(
      createElement(
        'div',
        null,
        createElement(StoryReader, { story: hare }),
        createElement(StoryReader, { story: dialogue }),
      ),
    );

    // Whichever board wrote last holds the store, and exactly one of them does — the two
    // cannot both be true, and the pair is what pins that the two of them stopped writing.
    const held = [hare, dialogue].filter(
      (s) => useTypingStore.getState().targetText === normalizeTypableText(s.paragraphs[0]),
    );
    expect(held).toHaveLength(1);
  });

  it('shows this story on the board, not the one the store booted with', () => {
    const s = story('the-tortoise-and-the-hare');
    const text = shown(reader(s.slug));

    // The board's own header, not the page's: the reading panel below repeats every
    // paragraph of the story, so the story's own text is on the page either way.
    expect(text).toContain(`The Tortoise and the Hare (Part 1/${s.paragraphs.length})`);
    expect(text).not.toContain('What is the main architectural benefit');
  });

  /**
   * The same, in the HTML the server sends.
   *
   * This is the crawler's copy and the no-JS reader's copy, and it was the one still wrong
   * after the render-time seed: the store write had happened, and the server could not see
   * it, because `getInitialState()` is what `useSyncExternalStore` reads during SSR. Read
   * the markup rather than the store — the store is correct here either way, which is
   * exactly why reading it hid this.
   */
  it('server-renders this story onto the board, not the store’s boot passage', () => {
    const s = story('the-tortoise-and-the-hare');
    const html = renderToStaticMarkup(createElement(StoryReader, { story: s }));

    expect(html).toContain(`The Tortoise and the Hare (Part 1/${s.paragraphs.length})`);
    expect(html).not.toContain('What is the main architectural benefit');
  });
});

/**
 * The level pill, and what its parenthetical was claiming to be.
 *
 * The pill read `Level B2 (DevOps & Cloud Q&A)` — one span, so the parenthetical reads as
 * a gloss on the level, as though the topic were what the B2 consisted of. It is not a
 * gloss: for nine of the eleven stories it is a subject ("Full-Stack Q&A", "Tech History",
 * "Inspirational Speech"), and only two of them carry a word that is about difficulty at
 * all. The catalog had it right one page earlier — a `Level B2` pill with the subject as
 * its own eyebrow above the title — and the story page merged the two into a claim they
 * do not make.
 *
 * Asserted on the pill's own text rather than on the page's, because the subject is still
 * on the page and still should be; only its position was the problem.
 */
describe('the level badge', () => {
  it('states the level and nothing the level does not explain', () => {
    const s = story('devops-automation-azure-ci-cd');
    const host = reader(s.slug);

    const pill = [...host.querySelectorAll('span')].find((el) => el.textContent?.startsWith('Level '));
    expect(pill?.textContent).toBe(`Level ${s.level}`);
  });

  /**
   * The control. The subject is not being deleted — it is being moved out of the level's
   * parentheses — so a change that dropped it entirely would satisfy the test above.
   */
  it('still shows the subject, just outside the level', () => {
    const s = story('devops-automation-azure-ci-cd');
    expect(shown(reader(s.slug))).toContain(s.difficultyLabel);
  });
});

/**
 * The credit under the title, and what it is not allowed to say.
 *
 * `author` was one string serving two jobs. For four stories it is a person who wrote the
 * text — Aesop, O. Henry, Steve Jobs, Arthur Conan Doyle — and "By" is right. For seven it
 * is a series or a collection: "Full-Stack Interview Series", "Everyday Dialogues", "Tech
 * History". Those read fine as a credit and badly as a byline, and every surface that
 * printed them used the byline shape: "By Everyday Dialogues" reads as a person named
 * Everyday Dialogues having written the coffee-shop dialogue.
 *
 * The data now says which is which (`StoryItem.authorIsPerson`), and the two surfaces are
 * held to it below. These are the visible halves; `test/storyPage.test.ts` covers the two
 * that a crawler reads instead of a person.
 */
describe('the byline', () => {
  /** The credit line, which is the element immediately after the title in both surfaces. */
  const byline = (host: HTMLElement, tag: 'h1' | 'h2'): string =>
    (host.querySelector(tag)?.nextElementSibling?.textContent ?? '').trim();

  it('attributes a story to the person who wrote it', () => {
    const host = reader('the-tortoise-and-the-hare');

    expect(byline(host, 'h1')).toBe('By Aesop');
  });

  it('credits a series without claiming it wrote the story', () => {
    const host = reader('daily-coffee-shop-dialogue');

    expect(byline(host, 'h1')).toBe('Everyday Dialogues');
  });

  /**
   * Both surfaces, all eleven stories — the property the flag exists to hold.
   *
   * Two spot checks would pass against a per-story special case and leave the other nine
   * printing "By Tech History". Enumerating the corpus is cheap here and is the only way
   * the next story added is covered without anyone remembering to look.
   */
  it('holds on the catalog and the reader for every story', () => {
    const wrong: string[] = [];

    for (const s of STORIES) {
      const expected = s.authorIsPerson ? `By ${s.author}` : s.author;
      if (byline(reader(s.slug), 'h1') !== expected) wrong.push(`reader:${s.slug}`);
      if (byline(catalog(s.slug), 'h2') !== expected) wrong.push(`catalog:${s.slug}`);
    }

    expect(wrong).toEqual([]);
  });
});

/**
 * What each glossary button announces.
 *
 * `title` is not in this, on purpose, and the reasoning is the one the catalog's own
 * control-naming block already uses for `placeholder`: a tooltip is a description, not a
 * name, and it is not shown at all on a touch screen. The name comes from `aria-label` or
 * from a `<label for>`, which is everything a button here can have.
 */
const glossaryName = (el: Element): string => el.getAttribute('aria-label')?.trim() ?? '';

/**
 * The story page's key-vocabulary glossary.
 *
 * Every entry printed the word beside a bare speaker icon and every button carried the
 * same `title="Pronounce word"`, so a learner tabbing through heard "Pronounce word,
 * button" four times in a row with nothing to tell the entries apart. The word was on
 * screen the whole time and the name simply did not say it — which is why this is an
 * `aria-label` and not a new tooltip.
 */
describe('the glossary says which word each button speaks', () => {
  const entries = (host: HTMLElement, story: StoryItem) => {
    // Located by the heading, so the assertion is about the glossary rather than about
    // whatever buttons happen to be on the page.
    const heading = [...host.querySelectorAll('span')].find(
      (s) => s.textContent === 'Key Vocabulary in this Story',
    );
    const grid = heading?.parentElement?.parentElement?.querySelector('.grid');
    if (!grid) throw new Error(`no glossary grid for "${story.slug}"`);
    return story.keyVocabulary.map((entry) => {
      const card = [...grid.children].find(
        (c) => c.querySelector('.font-bold')?.textContent === entry.word,
      );
      const button = card?.querySelector('button');
      if (!button) throw new Error(`no button for "${entry.word}"`);
      return { word: entry.word, name: glossaryName(button) };
    });
  };

  it('names each one after the word printed beside it', () => {
    const host = reader('the-first-computer-bug');
    const named = entries(host, story('the-first-computer-bug'));

    // The precondition: a locator that found nothing would pass vacuously.
    expect(named.length).toBe(4);

    const wrong = named.filter((e) => !e.name.includes(e.word)).map((e) => e.name);
    expect(wrong).toEqual([]);
  });

  /**
   * All eleven, because the property is the same everywhere and one spot check cannot
   * see a story whose glossary happens to have a single entry.
   */
  it('holds on every story', () => {
    const wrong: string[] = [];
    for (const s of STORIES) {
      for (const e of entries(reader(s.slug), s)) {
        if (!e.name.includes(e.word)) wrong.push(`${s.slug}: "${e.word}" → "${e.name}"`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

/**
 * `text-gray-600` as the installed Tailwind actually ships it.
 *
 * The palette in `node_modules/tailwindcss/theme.css` is oklch —
 * `--color-gray-600: oklch(55.1% 0.027 264.364)` — which resolves to this. Written out
 * rather than converted per run because the assertion does not turn on the exact shade: at
 * full opacity this grey is 4.84:1 on white, and every step beside it clears AA too, so a
 * Tailwind release that nudged the shade cannot flip the result. What fails this is the
 * `opacity` modifier, and every grey in that band fails it.
 */
const SHADES: Record<string, [number, number, number]> = {
  'gray-600': [106, 114, 130],
};
const WHITE: [number, number, number] = [255, 255, 255];

/** WCAG 2.x relative luminance. */
const luminance = (rgb: [number, number, number]) =>
  rgb
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);

/** The contrast ratio between two colours, as WCAG defines it. */
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** `fg` painted at `alpha` over `bg` — what an ancestor's `opacity-N` actually does. */
const blended = (fg: [number, number, number], alpha: number) =>
  fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * WHITE[i])) as [number, number, number];

/**
 * The colour and the dimming actually in force on `el`.
 *
 * Both are inherited, and from different places: the non-current paragraphs carried
 * `opacity-75` and no `text-` class at all, taking `text-gray-600` from the panel above
 * them. A scan of class strings cannot see that pairing — one token on the button, one on
 * an ancestor — so this walks the rendered tree instead. Only unprefixed tokens count:
 * `dark:text-gray-300` and `hover:opacity-75` are for other states, and this measures the
 * one the reader is sitting in.
 */
function paintedAt(el: Element): { step: string; alpha: number } {
  let step = '';
  let alpha = 1;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const base = (node.getAttribute('class') ?? '').split(/\s+/).filter((t) => t && !t.includes(':'));
    if (!step) {
      // A hue and a numeric step, so `text-gray-600` counts and the three other things
      // that start with `text-` on this tree do not: `text-left` on the button itself,
      // `text-base` on the panel, `text-4xl` on a heading further up.
      step = base.find((t) => /^text-[a-z]+-\d+$/.test(t))?.replace('text-', '') ?? '';
    }
    if (alpha === 1) {
      const dim = base.find((t) => /^opacity-\d+$/.test(t));
      if (dim) alpha = Number(dim.slice('opacity-'.length)) / 100;
    }
  }
  return { step, alpha };
}

/**
 * The paragraphs you are not on were unreadable in light mode.
 *
 * Six of every story's seven paragraphs carried `opacity-75`, painted over the panel's
 * `text-gray-600` — 3.01:1 against the card's white, against a 4.5:1 floor for body text.
 * They are the content the learner came to read, and on a phone in daylight that is the
 * difference between reading them and squinting at them. The current paragraph was never
 * dimmed; it is highlighted instead, with a background and a ring, which is the distinction
 * that was actually wanted.
 */
describe('every paragraph stays readable, not only the one in play', () => {
  /** The contrast the reader actually sees for `el`, or 0 if the test cannot tell. */
  const ratioFor = (el: Element) => {
    const { step, alpha } = paintedAt(el);
    const shade = SHADES[step];
    // Unknown shade is a loud failure, not a silent pass on the wrong colour.
    if (!shade) throw new Error(`no sRGB recorded for text-${step}`);
    return contrast(blended(shade, alpha), WHITE);
  };

  it('keeps the paragraphs you are not on at the AA threshold', () => {
    const host = reader('the-gift-of-the-magi');
    // By value, not by presence: React writes `aria-current="false"` on the others, so a
    // `[aria-current]` attribute selector matches all seven and keeps none.
    const idle = [...host.querySelectorAll('button[aria-current]')].filter(
      (b) => b.getAttribute('aria-current') !== 'true',
    );

    // The precondition: the panel has paragraphs and one of them is in play. A count of
    // zero here means the contrast assertions below are measuring nothing and passing.
    expect(idle.length).toBe(6);

    for (const p of idle) expect(ratioFor(p)).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The control for the arithmetic above, which is the same shape as the control in the
   * catalog's control-naming block: a ratio that cannot fall below the threshold would
   * pass this file having measured nothing.
   */
  it('would still fail on a paragraph dimmed the way this one was', () => {
    const dimmed = blended(SHADES['gray-600'], 0.75);
    expect(contrast(dimmed, WHITE)).toBeLessThan(4.5);
    expect(contrast(blended(SHADES['gray-600'], 1), WHITE)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * Typing a paragraph and moving on, which is the reader's loop and which nothing reached.
 *
 * `completePassage` exists so a test can get as far as the completion card, and the three
 * tests that use it stop at reading that card's label. Nobody clicked the button, and nobody
 * pressed the key the label prints in its own text. `onNext` is the prop that carries the
 * advance into `TypingEngine`, and it is reachable three ways — the "Next Paragraph
 * (Enter ↵)" button, the Enter key bound to the same handler, and the `undefined` that has
 * to replace it on the last paragraph so the learner is not handed a Next that goes
 * nowhere. None of the three was asserted here or, before last turn, on `/vocab` either.
 *
 * The paragraph is typed through the store, so what these check is the advance rather than
 * the keyboard listener standing in front of it.
 */
describe('moving on after typing a paragraph', () => {
  /** The reader's own tracker control, which is always rendered. */
  const stepper = (host: HTMLElement, label: string): HTMLButtonElement => {
    const found = [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no "${label}" control on the page`);
    return found as HTMLButtonElement;
  };

  /**
   * The advance control, which exists only on a finished passage that is not the last one.
   *
   * `undefined` is a legitimate answer and the last test below depends on it being
   * distinguishable from a button that failed to render.
   */
  const advanceButton = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

  it('offers a way on, and puts the next paragraph on the board', () => {
    const s = story('the-tortoise-and-the-hare');
    const host = reader(s.slug);

    completePassage();
    const advance = advanceButton(host, 'Next Paragraph');
    expect(advance).toBeDefined();

    act(() => advance!.click());

    expect(useTypingStore.getState().targetText).toBe(normalizeTypableText(s.paragraphs[1]));
    expect(shown(host)).toContain(
      `${s.title} (Part 2/${s.paragraphs.length})`,
    );
  });

  /**
   * The same handler, reached by the key rather than the mouse.
   *
   * The button's own label advertises "(Enter ↵)", so a control promising a shortcut that
   * does nothing is its own defect, and this is the only place either half of that promise
   * is checked.
   *
   * Dispatched on `document.body` rather than on `window`, because the listener reads
   * `e.target.closest(...)`: a real keypress always has an element for a target, and the
   * controls on the page are what decide whether this board claims the key.
   */
  it('advances on Enter, which is what the button promises', () => {
    const s = story('the-tortoise-and-the-hare');
    reader(s.slug);

    completePassage();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(useTypingStore.getState().targetText).toBe(normalizeTypableText(s.paragraphs[1]));
  });

  /**
   * The other end of the same condition, and the reason the `&&` is there at all: the last
   * paragraph has nothing after it, so `onNext` is `undefined` and the completion card
   * offers a restart instead. A Next button here would be dead on click, and the learner
   * would have to click it to find out the story had ended.
   */
  it('offers no way on from the last paragraph, which is the end of the story', () => {
    const s = story('the-tortoise-and-the-hare');
    const host = reader(s.slug);

    // Walk there through the reader's own Next, the way a learner reaches the last part.
    for (let i = 1; i < s.paragraphs.length; i += 1) {
      act(() => stepper(host, 'Next').click());
    }
    completePassage();

    // Spelled out rather than inferred from the position: a paragraph that never reached
    // the board would leave the button absent for the wrong reason and pass this.
    expect(useTypingStore.getState().targetText).toBe(
      normalizeTypableText(s.paragraphs[s.paragraphs.length - 1]),
    );
    expect(advanceButton(host, 'Next Paragraph')).toBeUndefined();
  });

  /**
   * The other branch of the same label, doing the same work.
   *
   * `nextLabel` is `story.isQA ? 'Next Question' : 'Next Paragraph'`, and the block at the
   * top of this file already pinned which story gets which wording — but only that the
   * words appear. This says the Q&A label is on a control that advances, so a rename that
   * put the two stories' labels on each other's button would pass the tests above.
   */
  it('advances between questions on an interview module, under its own label', () => {
    const s = story('modern-full-stack-web-architecture');
    expect(isQaDrill(s)).toBe(true);
    const host = reader(s.slug);

    completePassage();
    const advance = advanceButton(host, 'Next Question');
    expect(advance).toBeDefined();

    act(() => advance!.click());

    expect(useTypingStore.getState().targetText).toBe(normalizeTypableText(s.paragraphs[1]));
    expect(shown(host)).not.toContain('Next Paragraph');
  });
});
