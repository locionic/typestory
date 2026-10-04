import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import StoriesCatalog from '../components/stories/StoriesCatalog';
import { STORIES } from '../data/stories';
import { StoryItem } from '../lib/types';

/**
 * The state of a control, exposed to something other than a pair of colours.
 *
 * The six category pills are how a learner reaches anything the landing page did not show
 * them, and they were six `<button>`s that differ only in `bg-indigo-600` versus
 * `bg-gray-100`. A screen reader announces all six identically — "All Stories, button",
 * "Tech & Engineering, button" — with nothing saying which one is active, so the state the
 * learner can see is the one thing they cannot reach. It is SC 4.1.2, and the level filter
 * beside them does not have the problem: a `<select>` reports its value on its own.
 *
 * Pinned over all six rather than one, because announcing only the pressed pill would be
 * the easier half of this fix and the misleading one — a screen reader that says
 * "Fables, pressed" and then nothing for the other five leaves the learner unsure whether
 * the rest are still available.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

/** The category pills, found by their labels so a reordering does not silently pass. */
const LABELS = [
  'All Stories',
  'Tech & Engineering',
  'Fables',
  'Classics',
  'Speeches & Essays',
  'Daily Dialogues',
];

function render(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(StoriesCatalog, { initialStories: STORIES })));
  return host;
}

function categoryPills(host: HTMLElement): HTMLButtonElement[] {
  const byLabel = new Map(
    [...host.querySelectorAll('button')]
      .map((button) => [(button.textContent ?? '').trim(), button] as const)
      .filter(([label]) => LABELS.includes(label)),
  );
  return LABELS.map((label) => {
    const pill = byLabel.get(label);
    if (!pill) throw new Error(`no category pill labelled ${label}`);
    return pill;
  });
}

/**
 * The stories behind the rendered cards, in the order they appear, optionally after a
 * change of sort. Read off the DOM rather than recomputed from the component's own logic,
 * so this says what a learner sees and not what the sort function intended.
 */
function cardStories(sortBy?: 'shortest' | 'longest'): StoryItem[] {
  const host = render();
  if (sortBy) {
    const control = host.querySelector('select[aria-label="Sort stories"]')!;
    act(() => {
      // `value` is a React-controlled input; setting it natively is what a real
      // interaction does, and dispatching change is what React actually listens for.
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        control,
        sortBy,
      );
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  return storiesIn(host);
}

/** The stories behind the cards on screen, in the order they appear. */
function storiesIn(host: HTMLElement): StoryItem[] {
  return [...host.querySelectorAll('a[href^="/stories/"]')].map(
    (card) => STORIES.find((story) => `/stories/${story.slug}` === card.getAttribute('href'))!,
  );
}

describe('the story catalog category filters', () => {
  it('announce which of them is selected', () => {
    expect(categoryPills(render()).map((pill) => [pill.textContent, pill.getAttribute('aria-pressed')])).toEqual([
      ['All Stories', 'true'],
      ['Tech & Engineering', 'false'],
      ['Fables', 'false'],
      ['Classics', 'false'],
      ['Speeches & Essays', 'false'],
      ['Daily Dialogues', 'false'],
    ]);
  });

  /**
   * The state is read from the control rather than from the one pill that happens to be
   * active on load. A build where `aria-pressed` was pinned to the first label, or derived
   * from something other than the selection, passes the test above and fails this one.
   */
  it('move the announced selection when another category is picked', () => {
    const pills = categoryPills(render());
    act(() => pills[2].click()); // Fables

    const pressed = pills.filter((pill) => pill.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent).toBe('Fables');
  });

  /**
   * The control, and the reason the two above are not satisfied by pressing the right
   * button while leaving the page lying: the announced selection has to be the same one
   * the colours show. These are two separate expressions of "selected" in the same
   * `className` template, and nothing but a test stops them drifting apart.
   */
  it('announce exactly the selection the colours show', () => {
    const pills = categoryPills(render());
    act(() => pills[3].click()); // Classics

    const pressed = pills.filter((pill) => pill.getAttribute('aria-pressed') === 'true');
    const highlighted = pills.filter((pill) => pill.className.includes('bg-indigo-600'));
    expect(highlighted).toHaveLength(1);
    expect(pressed.map((pill) => pill.textContent)).toEqual(
      highlighted.map((pill) => pill.textContent),
    );
  });
});

/**
 * The order the default view arrives in.
 *
 * "Recommended" is the initial value of the sort control, so it is the order every learner
 * sees on their first visit to the library with no filters set. It compared with `0` —
 * not a slow sort but the absence of one — and the corpus is authored in blocks, so that
 * order was four technical interview modules, then the fable, then everything else. A
 * default view is a claim about what to read first; this one made no claim under a label
 * promising that it would.
 *
 * Easiest first is the claim, and it also happens to be what turns the list into a
 * library rather than a subject: in this order it runs the A2 fable, the A2 dialogue, the
 * B1 tech, the B1 classic, then the B2s and the single C1. Featured-first was the other
 * candidate and the weaker one — it would have put those three on top and left four tech
 * modules directly beneath them.
 *
 * The CEFR labels are all the same length, so comparing the strings compares the levels
 * and a seventh level added to `CefrLevel` sorts itself into place.
 */

/** Whether no card in the list is easier than the one above it. */
function isEasiestFirst(levels: string[]): boolean {
  return levels.every((level, i) => i === 0 || levels[i - 1] <= level);
}

describe('the catalog default order', () => {
  it('is an order, and not the order the corpus happens to be authored in', () => {
    const shown = cardStories();

    expect(isEasiestFirst(shown.map((story) => story.level))).toBe(true);
    expect(shown.map((story) => story.slug)).not.toEqual(STORIES.map((story) => story.slug));
  });

  /**
   * The other two branches of the same comparator. One sort function holds all three, so
   * a change to the branch above can quietly take one of these with it, and both are one
   * click away on the same control.
   */
  it('still sorts by length when that is what is asked for', () => {
    const ascending = cardStories('shortest').map((story) => story.wordCount);
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

    const descending = cardStories('longest').map((story) => story.wordCount);
    expect(descending).toEqual([...ascending].reverse());
  });

  /**
   * The control, and the reason the two above are not satisfied by a predicate that cannot
   * say no. Both halves matter: `isEasiestFirst` has to reject a list that goes backwards,
   * and the corpus has to hold more than one level for "non-decreasing" to mean anything.
   */
  it('can tell an ascending list from a descending one', () => {
    expect(isEasiestFirst(['A2', 'A2', 'B1', 'B2', 'C1'])).toBe(true);
    expect(isEasiestFirst(['C1', 'B2', 'A2'])).toBe(false);
    expect(new Set(STORIES.map((story) => story.level)).size).toBeGreaterThan(1);
  });
});

/** The catalog with `query` typed into its search box, as a learner would type it. */
function searched(query: string): HTMLElement {
  const host = render();
  const box = host.querySelector<HTMLInputElement>('#stories-search')!;
  act(() => {
    // Same idiom as the sort control above: `value` is React-controlled, so the native
    // setter plus an `input` event is what a real keystroke goes through.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, query);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return host;
}

/** The way out, which only exists while something is narrowing the list. */
function clear(host: HTMLElement): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Clear filters',
  );
  if (!found) throw new Error('the catalog offered no way out of its own filter');
  return found as HTMLButtonElement;
}

/**
 * Typing something that matches nothing, which is one keystroke away for every learner.
 *
 * The six tests above only ever narrow the list to something non-empty — each one asserts
 * on cards it went looking for — so the branch the catalog takes when the list comes back
 * empty has no test at all. It is not an edge case: the corpus is eleven stories, and any
 * query narrower than "the" empties it.
 *
 * What matters is that the empty state explains itself and offers a way back. A grid that
 * renders to nothing looks like a broken page, and a learner whose list has vanished has to
 * be able to get it back without first understanding why it went.
 */
describe('a search that matches nothing', () => {
  it('says so, rather than showing an empty grid', () => {
    const host = searched('zzzz-no-such-story');

    // The precondition: the grid really is gone, so what follows is the empty state and
    // not a heading that happens to sit above the cards.
    expect(host.querySelectorAll('a[href^="/stories/"]')).toHaveLength(0);
    expect(host.textContent).toContain('No stories matched');
  });

  /**
   * The count, which is the other half of "nothing here".
   *
   * Read off the DOM rather than the component's own state, so this is the sentence a
   * learner sees. The corpus size beside it is the control: "Showing 0" is only meaningful
   * if "of 11" is the real total and not the filtered one.
   */
  it('counts what is left rather than the whole corpus', () => {
    const host = searched('zzzz-no-such-story');

    expect(host.textContent).toContain(`Showing 0 of ${STORIES.length} stories`);
  });

  /**
   * The way out, and the claim worth having.
   *
   * The button appears on a query alone, not only on a level or a category, so the empty
   * state a learner reaches by typing is the one that has to offer a way back — and has to
   * *give* the list back when pressed. It is the same click that made the list disappear.
   */
  it('brings the list back when the learner clears it', () => {
    const host = searched('zzzz-no-such-story');

    // The precondition again, at the moment of the click: someone pressing this is looking
    // at nothing, so a button that leaves them looking at nothing is the bug.
    expect(host.querySelectorAll('a[href^="/stories/"]')).toHaveLength(0);
    expect(host.textContent).toContain('No stories matched');

    act(() => clear(host).click());

    expect(host.querySelectorAll('a[href^="/stories/"]')).toHaveLength(STORIES.length);
    expect(host.textContent).not.toContain('No stories matched');
    expect(host.querySelector<HTMLInputElement>('#stories-search')!.value).toBe('');
  });
});

/**
 * The sort is not a filter.
 *
 * It is a separate `<select>`, with its own `aria-label="Sort stories"`, sitting in a
 * different row of the toolbar from the category pills and the level dropdown. The button
 * reads "Clear filters" — and its own visibility test at `StoriesCatalog.tsx:190` is written
 * out of the three filters alone, so it appears only when a filter is set and presents
 * itself as a filter-scoped control. It was also resetting the sort, which is how a learner
 * who picked "Shortest first" to get through a long catalog, typed a search to narrow it,
 * and pressed the one button that said it would undo their search, silently lost the sort
 * they chose and was given "Recommended" instead.
 */
describe('clearing the filters', () => {
  /** The sort control, found by what it is rather than by where it sits. */
  function sortControl(host: HTMLElement): HTMLSelectElement {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Sort stories"]');
    if (!select) throw new Error('no sort control');
    return select;
  }

  /**
   * React tracks the DOM's own value, so a plain assignment is invisible to it — the same
   * trap the paste helper in this repo already carries a note about.
   */
  function chooseSort(host: HTMLElement, value: string): void {
    const select = sortControl(host);
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('leaves the sort where the learner put it', () => {
    const host = render();
    chooseSort(host, 'shortest');

    // A search, so the button is on screen at all — choosing the sort alone does not
    // summon it, which is the whole of why this could not be reached by accident before.
    typeInto(host, 'zzzz-no-such-story');
    expect(host.textContent).toContain('No stories matched');

    act(() => clear(host).click());

    expect(sortControl(host).value).toBe('shortest');
  });

  /** The search box, driven the way a keystroke drives it. */
  function typeInto(host: HTMLElement, value: string): void {
    const box = host.querySelector<HTMLInputElement>('#stories-search')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  /**
   * The control, and the reason the test above means anything: a sort control that never
   * worked would satisfy it just as well.
   *
   * Ascending word counts read off the cards, not off `cardStories` — that helper renders
   * the catalog and drives the same select this test drives, so comparing against it checks
   * the component against itself, and it passed with the comparator's `shortest` branch
   * returned `0`. The order is read from the DOM because that is the only version of it the
   * learner gets; a `recommended` list and an authored one both fail here, so the oracle can
   * say no.
   */
  it('and the sort is still doing the ordering it was chosen for', () => {
    const host = render();
    chooseSort(host, 'shortest');
    typeInto(host, 'zzzz-no-such-story');
    act(() => clear(host).click());

    const wordCounts = storiesIn(host).map((story) => story.wordCount);
    expect(wordCounts.length).toBeGreaterThan(1);
    expect(wordCounts).toEqual([...wordCounts].sort((a, b) => a - b));
  });
});

/**
 * The one filter of the three with nothing over it.
 *
 * The file is named for the catalog's filters and covers two of them: the category pills
 * and the sort control. The level `<select>` between them was the one left out, so all
 * three of its branches — the arrays of CEFR levels at `StoriesCatalog.tsx:63`, `:66` and
 * `:69` — could be wrong in any combination and every test here would have stayed green.
 *
 * It is worth three branches because the filter's claim is written down twice, in two
 * different forms. The option a learner reads says `Beginner (A1-A2)` in prose; the branch
 * that does the work holds `['A1', 'A2']`. Nothing ties the two together, so widening one
 * and not the other gives a filter that quietly drops stories while the dropdown still
 * promises otherwise — and the "Showing 2 of 11" beside it reads as though the corpus
 * really were that small.
 *
 * So the tests below read the range back out of the label and check the stories that
 * survive against it. Not "beginner keeps two stories" — that is today's answer, and
 * pinning the number would make the test refuse to notice the corpus growing. The claim
 * under test is that the dropdown tells the truth about its own bounds.
 */

/** CEFR in order. `CefrLevel` is a type and erased at runtime, so the scale is written out. */
const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/**
 * Every level an option promises, read out of its own label rather than from the filter.
 *
 * A label with no range in it promises no bound, which for a level scale means all of it —
 * so "All Levels" falls out of this as the whole corpus rather than as an empty one.
 */
function promisedLevels(label: string): readonly string[] {
  const range = /\(([A-C]\d)-([A-C]\d)\)/.exec(label);
  if (!range) return CEFR_ORDER;

  const scale = CEFR_ORDER as readonly string[];
  const from = scale.indexOf(range[1]);
  const to = scale.indexOf(range[2]);
  // Thrown rather than returned, because an end that is not on the scale slices to an empty
  // range and every assertion downstream then fails for a reason that has nothing to do
  // with the filter. This is the drift the test exists to catch, so it should say so.
  if (from < 0 || to < 0) throw new Error(`${label} names a level outside the CEFR scale`);

  return CEFR_ORDER.slice(from, to + 1);
}

/** The level control, found by the name a screen reader would use to reach it. */
function levelFilter(host: HTMLElement): HTMLSelectElement {
  const found = host.querySelector<HTMLSelectElement>(
    'select[aria-label="Filter stories by proficiency level"]',
  );
  if (!found) throw new Error('the catalog offered no level filter');
  return found;
}

/** The options it offers, each as its value and the label the learner actually reads. */
function levelOptions(host: HTMLElement): { value: string; label: string }[] {
  return [...levelFilter(host).options].map((option) => ({
    value: option.value,
    label: option.textContent!.trim(),
  }));
}

/** The catalog narrowed to one level option, the way a learner narrows it. */
function atLevel(value: string): HTMLElement {
  const host = render();
  const control = levelFilter(host);
  act(() => {
    // Controlled select, so the native setter plus `change` is the interaction — the same
    // idiom the sort control above already uses.
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return host;
}

describe('the level filter', () => {
  /**
   * The control, and the reason the tests below are not satisfied by a dropdown that
   * filters nothing. All six CEFR levels have to be offered to somebody, and to exactly one
   * option: three bands that all missed one level would pass every assertion about
   * individual options and still leave a story unreachable from the control.
   */
  it('divides the CEFR scale into the three bands it names', () => {
    const bands = levelOptions(render()).slice(1);

    expect(bands.map((band) => promisedLevels(band.label))).toEqual([
      ['A1', 'A2'],
      ['B1', 'B2'],
      ['C1', 'C2'],
    ]);
    expect(bands.flatMap((band) => promisedLevels(band.label))).toEqual([...CEFR_ORDER]);
  });

  /**
   * The claim: what an option's label says it keeps is what it keeps.
   *
   * Read off the DOM, so this is the list a learner was shown, not the predicate that
   * produced it. Every option including "All Levels", which is the one that promises no
   * bound and so has to keep the whole corpus — a filter that narrowed it would be the
   * least visible version of this bug, because the dropdown still reads as though it
   * applies nothing.
   */
  it('keeps exactly the stories its own label promises', () => {
    for (const { value, label } of levelOptions(render())) {
      const promised = promisedLevels(label);
      // Sorted, because order is the sort control's business and is already pinned by its
      // own tests — comparing the two in corpus order would be asserting a second thing
      // about the sort and failing for a reason that has nothing to do with the filter.
      const levelsOf = (stories: StoryItem[]) => stories.map((story) => story.level).sort();

      expect({ [label]: levelsOf(storiesIn(atLevel(value))) }).toEqual({
        [label]: levelsOf(STORIES.filter((story) => promised.includes(story.level))),
      });
    }
  });

  /**
   * The other half, which parsing the labels cannot see: the bands add up.
   *
   * Each option telling the truth about its own bounds still leaves the whole corpus
   * reachable or not. A story in two bands is counted twice and appears in a list the
   * learner believes is filtered; a story in none is one that cannot be found from the
   * control at all, and nothing on the page says which control lost it.
   */
  it('puts every story in exactly one of the bands', () => {
    const shown = levelOptions(render())
      .slice(1)
      .flatMap((band) => storiesIn(atLevel(band.value)).map((story) => story.slug));

    expect(shown).toHaveLength(STORIES.length);
    expect(new Set(shown).size).toBe(shown.length);
  });
});