import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import PlacementPage from '../app/placement/page';

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  // The page now keeps its last result in localStorage, and the mount effect reads it
  // back on every render. Left behind, it turns the *next* test's fresh mount into a
  // result card: no fieldsets, no textarea, no submit — every assertion below would then
  // pass on a page that never received a submission at all.
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LEVELS = ['A1', 'A2', 'B1'];

/** What GET serves. Two questions, so the form is answerable in two clicks. */
const BUNDLE = {
  questions: [
    { id: 'q1', prompt: 'She ___ to school.', options: ['walk', 'walks'] },
    { id: 'q2', prompt: 'They ___ football.', options: ['plays', 'play'] },
  ],
  writingTask: { prompt: 'Write 60 words about a place you like.' },
  maxWritingChars: 1200,
  passRate: 0.6,
  levels: LEVELS,
};

/**
 * The quiz the three existing tests place a learner at A1 from: A1 passed, nothing above it.
 *
 * Every field here is one the route really sends. `objective.level` was missing from this
 * fixture until the card started reading it, which is the whole defect below in miniature —
 * a response shape the page had never been shown in full, so nothing held the two halves
 * of it together.
 */
const BENIGN = {
  byLevel: {
    A1: { correct: 4, total: 4, rate: 1 },
    A2: { correct: 0, total: 4, rate: 0 },
    B1: { correct: 0, total: 4, rate: 0 },
  },
  level: 'A1',
};

/**
 * A learner strong everywhere except the floor.
 *
 * `cascade` (lib/placement.ts) breaks at the first level under the mark, so A2 and B1 never
 * get read: 2/4 on A1 pins the result at A1 no matter how well the rest went. Both the
 * passing rates and the level the scorer reached are here, because the defect was the card
 * believing the first and ignoring the second.
 */
const STRONG_ABOVE_A_WEAK_FLOOR = {
  byLevel: {
    A1: { correct: 2, total: 4, rate: 0.5 },
    A2: { correct: 4, total: 4, rate: 1 },
    B1: { correct: 4, total: 4, rate: 1 },
  },
  level: 'A1',
};

/** A placement with no writing grade. `writingOutcome` is the field under test. */
const result = (
  writingOutcome: 'graded' | 'skipped' | 'failed',
  objective = BENIGN,
) => ({
  level: objective.level,
  cappedByWriting: false,
  objective,
  writing: null,
  writingOutcome,
});

/**
 * Mount the page, answer both questions, submit `body` as the result, hand back the host.
 *
 * `writing` is typed before the submit rather than after, which is the only order it exists
 * in: the result card replaces the form, so by the time there is a result there is no
 * textarea left to type into.
 */
async function submitBody(body: unknown, status = 200, writing = ''): Promise<HTMLElement> {
  // A visit on which the learner answers the quiz, which now means *starting* with nothing
  // stored: the page restores the last result on mount, so a second submission inside one
  // test would come back to the result card instead of the form and find no `form` to send.
  // `afterEach` clears between tests, but not between two calls in the same one.
  localStorage.clear();

  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      : new Response(JSON.stringify(BUNDLE), {
          headers: { 'content-type': 'application/json' },
        }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(PlacementPage));
  });

  if (writing) {
    // React tracks the value, so the change has to go through the setter it patched over
    // the DOM one — test/tutorPage.test.ts does the same for the same reason.
    const textarea = host.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(textarea, writing);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Asserted rather than assumed, so a caller can rely on there being something for
    // `restart` to clear. A dispatch that did not take would leave the box empty all the
    // way through, and a test about a retake emptying it would pass for the wrong reason.
    if (textarea.value !== writing) throw new Error('the writing never reached the box');
  }

  // jsdom's `.click()` toggles `checked` and bubbles a real click, which is the event
  // React listens to for a radio — so this is the learner answering, not state poked in.
  for (const radio of host.querySelectorAll('input[type=radio]')) {
    await act(async () => {
      (radio as HTMLInputElement).click();
    });
  }

  const form = host.querySelector('form') as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  return host;
}

/**
 * A plain visit: the page mounts, the bundle arrives, nothing has been answered.
 *
 * Separate from `submitBody` because the two differ in the only way these tests care
 * about — one ends on the result card and one never leaves the form — and reusing
 * `submitBody` with a body nobody reads would leave the write half of the round trip
 * untested in the one place it matters.
 */
async function mountPage(): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(BUNDLE), { headers: { 'content-type': 'application/json' } }),
    ),
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(PlacementPage));
  });
  return host;
}

/** Drop the mounted tree the way a reload would, and hand the roots array its entry back. */
function reload(): void {
  const root = roots.pop();
  if (!root) throw new Error('nothing mounted to reload');
  act(() => root.unmount());
}

/** `submitBody` with one of the three ordinary outcomes, for the tests that are not about a cap. */
const submitAndRead = (
  writingOutcome: 'graded' | 'skipped' | 'failed',
  objective = BENIGN,
) => submitBody(result(writingOutcome, objective));

/**
 * A placement the writing pulled down, as `decideLevel` records it.
 *
 * `cappedByWriting` is set whenever the writing band ranks below the quiz's, and there are
 * three levels — so the gap can be one or two, and the two fixtures below are the two ends
 * of it. Neither number the route sends is reachable from the page's own state: the headline
 * is the level that was *used* and the feedback card names the writing band, so the quiz's
 * own result appears nowhere on the card unless it is rendered from the result.
 */
const capped = (objective: typeof BENIGN, band: string) => ({
  level: band,
  cappedByWriting: true,
  objective,
  writing: { band, rationale: 'Short simple sentences throughout.', corrections: [] },
  writingOutcome: 'graded' as const,
});

/** Quiz at B1, writing at A1: two levels of cap. */
const QUIZ_AT_B1 = {
  byLevel: {
    A1: { correct: 4, total: 4, rate: 1 },
    A2: { correct: 4, total: 4, rate: 1 },
    B1: { correct: 4, total: 4, rate: 1 },
  },
  level: 'B1',
};

/** Quiz at A2, writing at A1: the narrow cap, where "one level" would have been true. */
const QUIZ_AT_A2 = {
  byLevel: {
    A1: { correct: 4, total: 4, rate: 1 },
    A2: { correct: 4, total: 4, rate: 1 },
    B1: { correct: 0, total: 4, rate: 0 },
  },
  level: 'A2',
};

/**
 * The sentence explaining a cap has to describe the cap that happened.
 *
 * It used to read "Your written answer was graded a level below your quiz score" and say
 * so for every cap. `PLACEMENT_LEVELS` is A1, A2, B1 and `cappedByWriting` only asks whether
 * the writing band ranks *lower*, so the gap is one level or two — and the learner who most
 * needs this sentence is the one who hits the two-level case: strong on the grammar quiz,
 * writing at A1, capped from B1 to A1, told they lost a single level.
 *
 * The sentence now names both levels, so it cannot be wrong about the distance. This asserts
 * the shape of that claim rather than the exact wording.
 */
describe('when the writing pulled the level down', () => {
  it('does not call a two-level cap a single level', async () => {
    const host = await submitBody(capped(QUIZ_AT_B1, 'A1'));

    expect(text(host)).toContain('Your quiz placed you at B1');
    expect(text(host)).toContain('graded A1');
    // The defect, by its own words: true for the narrow cap, false for this one.
    expect(text(host)).not.toMatch(/a level below/);
  });

  /**
   * The control. The narrow cap is the case the old sentence was written for, and it must
   * still explain itself — naming both levels is only a fix if it works at either distance.
   */
  it('explains a one-level cap the same way', async () => {
    const host = await submitBody(capped(QUIZ_AT_A2, 'A1'));

    expect(text(host)).toContain('Your quiz placed you at A2');
    expect(text(host)).toContain('graded A1');
  });

  /**
   * And the sentence stays off when nothing was capped. It is an explanation of a cap, and
   * the feedback card already names the writing band on its own.
   */
  it('is absent when the quiz was the lower of the two', async () => {
    const host = await submitAndRead('graded', QUIZ_AT_A2);

    expect(text(host)).not.toContain('Your quiz placed you at');
  });
});

const text = (host: HTMLElement) => host.textContent ?? '';

/**
 * The placement itself, not the level names in the per-level breakdown beneath it.
 *
 * The card shows "A1" twice for a learner placed at A1 — once as the headline and once as
 * a row label — so a bare `toContain('A1')` passes on a card whose headline is missing,
 * which is the one thing both messages promise. The headline is the `text-6xl` element;
 * a rename there fails this loudly and points at the line to fix.
 */
const headline = (host: HTMLElement) => host.querySelector('p.text-6xl')?.textContent ?? '';

/**
 * The sentence the learner is shown when their writing is missing.
 *
 * The route returns `writing: null` for four situations that are not the same thing: an
 * empty box, no API key, and a model that refused, could not be reached, or answered with
 * something the validator threw away. The card rendered all four as "Your writing was not
 * graded… That is normal — the writing check is optional", which for the last three is
 * false — it asserts that nothing went wrong, to the one learner who knows something did.
 *
 * `lib/ai.ts` states the rule this broke for the codes that *did* reach the page: a claim
 * about the world must mean exactly that. So the route now reports which side of the line
 * it is on, and these two tests hold the page to it. Both are cheap; a regression is the
 * card quietly reassuring a learner whose essay was dropped.
 */
describe('a placement with no writing grade', () => {
  it('says the writing could not be graded when it failed', async () => {
    const shown = text(await submitAndRead('failed'));

    expect(shown).toContain('Your writing could not be graded');
    // The distinguishing half. "That is normal" is what makes the old sentence false.
    expect(shown).not.toContain('That is normal');
  });

  it('says the writing was simply not graded when it was skipped', async () => {
    const shown = text(await submitAndRead('skipped'));

    expect(shown).toContain('Your writing was not graded');
    expect(shown).toContain('That is normal');
  });

  /**
   * The control, and the reason either message is worth printing at all.
   *
   * Both sentences promise the level above is unaffected, so the level has to actually be
   * there. A render that silently failed would satisfy the first test's `not.toContain`
   * on its own, which is exactly the shape a broken harness produces.
   */
  it('still places the learner from the quiz either way', async () => {
    expect(headline(await submitAndRead('failed'))).toBe('A1');
    expect(headline(await submitAndRead('skipped'))).toBe('A1');
  });
});

/**
 * The per-level ticks, against the rule the scorer actually applied.
 *
 * The grid is the only place the card shows its working, and it used to reach its own
 * verdict: each row's `rate >= passRate`, decided level by level. `cascade` in
 * lib/placement.ts is written as a conjunction — "highest level passed, but only when every
 * level below it was passed too" — and breaks at the first level that misses. A row check
 * and a cascade are the same test only until a level above the break passes on its own,
 * and then they disagree.
 *
 * With 2/4 on A1 and 4/4 on both A2 and B1 the learner is told **A1** in the headline and
 * shown green ticks on A2 and B1: three levels passed, one of them stated twice, and
 * nothing on screen to say the second two do not count. `test/placementPage.test.ts` before
 * this only ever used A1 4/4 with A2 and B1 at zero — the one shape where the two rules
 * happen to agree — so the contradicting direction was never rendered.
 */
describe('the per-level ticks', () => {
  /**
   * Whether a level's row carries a tick.
   *
   * `CheckCircle2` renders an `<svg>`, and the label sits beside it in a flex row, so
   * walking up from the label finds it. A text search cannot: the card prints the placed
   * level twice — headline and row label — so "does the page contain A2" is true of every
   * card ever rendered, ticked or not.
   */
  function ticked(host: HTMLElement, level: string): boolean {
    const label = [...host.querySelectorAll('span')].find((el) => el.textContent === level);
    return Boolean(label?.parentElement?.querySelector('svg'));
  }

  it('ticks no level above the one the result states', async () => {
    const host = await submitAndRead('graded', STRONG_ABOVE_A_WEAK_FLOOR);

    expect(headline(host)).toBe('A1');
    expect(ticked(host, 'A2')).toBe(false);
    expect(ticked(host, 'B1')).toBe(false);
  });

  /**
   * The control: the fix must untick the two unreachable levels without unticking
   * everything. A grid that simply stopped ticking — the obvious way to make the test above
   * pass — fails here.
   */
  it('still ticks the level that was reached', async () => {
    expect(ticked(await submitAndRead('graded', STRONG_ABOVE_A_WEAK_FLOOR), 'A1')).toBe(true);
  });

  /**
   * The shape that was already right, pinned so the fix cannot cost it.
   *
   * A1 passed and nothing above it, so A1 is ticked and A2/B1 are not. Every level above
   * the break fails on its own rate here, so ranking and re-deriving agree — which is
   * precisely why this direction needed a fixture of its own and why the defect survived
   * a test file that only contained it.
   */
  it('agrees with the result when the levels fall the ordinary way', async () => {
    const host = await submitAndRead('graded');

    expect(ticked(host, 'A1')).toBe(true);
    expect(ticked(host, 'A2')).toBe(false);
    expect(ticked(host, 'B1')).toBe(false);
  });

  /**
   * And the sentence that makes the unticking legible.
   *
   * A 100% bar with no tick next to it is the exact look of a broken card, and the learner
   * has no other way to learn that the level above was strong and simply had nothing
   * underneath it to stand on. Printed only when the conjunction actually cost them
   * something visible — the last test's fixture is the case where it did not, and the
   * sentence there would be explaining a result nobody can see.
   */
  it('explains a score higher up that did not carry', async () => {
    const shown = text(await submitAndRead('graded', STRONG_ABOVE_A_WEAK_FLOOR));

    expect(shown).toContain('does not carry past a level that was not passed');
  });

  it('says nothing extra when the levels fall the ordinary way', async () => {
    expect(text(await submitAndRead('graded'))).not.toContain('does not carry past');
  });
});
/**
 * What a screen reader is told when the placement submission does not come back.
 *
 * The error paragraph is the entire result of submitting, and nothing is rolled back when
 * it fails — the answers and the writing are left exactly as they were, so every part of
 * the DOM around the form is unchanged and the paragraph is the one thing that appears.
 * Without a live region the learner had no way to know that the test they spent the
 * longest flow in the app completing had failed at all.
 *
 * Asserted against the exact message rather than the region's presence, so a live region
 * wired to something else could not satisfy it. test/tutorPage.test.ts and
 * test/writingPage.test.ts pin the same guarantee on the other two AI-backed pages.
 */
describe('a placement the route will not grade', () => {
  it('is announced as an alert, with the reason the route gave', async () => {
    const host = await submitBody({ error: 'invalid_json' }, 400);

    const alert = host.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toBe('The server could not read that submission.');
  });

  /**
   * The control: a result still renders, so the paragraph is absent there and a change
   * that announced every result as an error would fail here rather than pass quietly.
   */
  it('announces nothing when the placement comes back', async () => {
    expect((await submitAndRead('graded')).querySelector('[role="alert"]')).toBeNull();
  });

  /**
   * A 200 the page cannot use — a different failure from a non-200, and before this a
   * worse one.
   *
   * The route validates its own reply, so nothing it serves today reaches this. The guard
   * is here because the two siblings carry it and this page did not: `app/tutor/page.tsx:115`
   * checks `!data.reply`, `app/writing/page.tsx:71` checks `!data.report`, and this read
   * `res.ok` and took the rest on trust. The card then dereferenced
   * `result.objective.byLevel[level]` during render, so the throw happened *inside* React —
   * which takes the whole document down rather than showing an error. A learner who had
   * just answered twelve questions got a blank page and no sentence.
   *
   * Asserted as the sentence rather than as the absence of a crash, because "did not go
   * blank" is what the learner experiences and it is the only claim the old code failed.
   */
  it('is the page\'s own sentence rather than a blank document', async () => {
    const host = await submitBody({}, 200);

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'The placement test failed. Please try again.',
    );
    // And the quiz is still there to resubmit from — the page's own promise that nothing is
    // rolled back on a failure. Without it the sentence would be the end of the attempt.
    expect(host.querySelectorAll('fieldset')).toHaveLength(BUNDLE.questions.length);
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
  });
});

/**
 * What a retake is.
 *
 * "Retake the test" is five lines of `restart`, and not one of them is tested — no test in
 * the repo presses the button. That is a different shape from the defects around it: not a
 * call site whose function is pinned elsewhere, but a handler with no test at all, where
 * deleting any single line leaves the suite green.
 *
 * It matters because the failure looks like success. A retake that cleared the answers but
 * left the result card up is a control that does nothing and appears to work; one that left
 * the answers ticked offers the same quiz again with Submit already unlocked, so the learner
 * is placed identically to last time while believing they have had a second go.
 *
 * Which lines are reachable decides what can be pinned, and one cannot be. `setSubmitError`
 * is cleared by `submit` before every attempt (`app/placement/page.tsx:116`), `restart`
 * lives inside the result card, and `submit` refuses unless every question is answered
 * (`:113`) — so there is no path that reaches a retake with an error on screen. The line is
 * harmless, it is left alone, and it is not something a test can stand behind.
 */
describe('a retake', () => {
  const ESSAY = 'I really enjoy visiting my grandparents every summer.';

  /** The quiz's own submit button. Absent from the result card, which is the point of it. */
  function submitButton(host: HTMLElement): HTMLButtonElement {
    return host.querySelector('button[type=submit]') as HTMLButtonElement;
  }

  /** Which questions have an answer ticked, by index — off the DOM rather than the state. */
  function ticked(host: HTMLElement): number[] {
    return [...host.querySelectorAll('fieldset')].flatMap((set, index) =>
      set.querySelector('input:checked') ? [index] : [],
    );
  }

  function retake(host: HTMLElement): HTMLButtonElement {
    const button = [...host.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Retake the test'),
    );
    if (!button) throw new Error('the result card offers no retake');
    return button;
  }

  /**
   * The state the retake is pressed from.
   *
   * "Every answer was ticked" is not readable here and does not need to be: the result card
   * replaced the form, and `submit` refuses unless every question is answered
   * (`app/placement/page.tsx:113`) — so a result card existing at all *is* the evidence
   * that the quiz was filled in and that Submit was unlocked to send it.
   *
   * Without this, every assertion below is also true of a page that never got as far as a
   * result: no fieldsets, no box and no submit button are the initial state too, so the
   * tests would pass on a retake button wired to nothing whatsoever.
   */
  function expectPlacedOnTheResultCard(host: HTMLElement): void {
    expect(host.querySelectorAll('fieldset')).toHaveLength(0);
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('button[type=submit]')).toBeNull();
  }

  /**
   * The retake, answered.
   *
   * A confirmation is a promise about the consequence, and it has to be *answerable* or
   * it is a wall: jsdom's `window.confirm` returns nothing, so every test below would
   * decline and pass for the wrong reason — which is why `confirm` is stubbed here rather
   * than left to the environment. The refusal path is the other half, below.
   */
  async function pressRetake(host: HTMLElement, answer: boolean): Promise<void> {
    vi.spyOn(window, 'confirm').mockReturnValue(answer);
    await act(async () => {
      retake(host).click();
    });
  }

  it('asks before it throws the result away', async () => {
    const host = await submitBody(result('graded'));
    expectPlacedOnTheResultCard(host);

    // The message is the whole point. The result lives in localStorage and nowhere
    // else — no `placementLevel` on `UserStats` and no field on the progress record, so
    // it is not backed up either — so this confirmation is the last moment the learner
    // can be told that the level, the per-level breakdown and the writing grade are
    // about to stop existing. The button's own label says what happens next and nothing
    // about what is being given up.
    let asked = '';
    vi.spyOn(window, 'confirm').mockImplementation((message?: string) => {
      asked = message ?? '';
      return false;
    });
    await act(async () => {
      retake(host).click();
    });

    expect(asked).toContain('This result will be discarded');
  });

  it('keeps the result when the question is declined', async () => {
    const host = await submitBody(result('graded'));
    expectPlacedOnTheResultCard(host);

    await pressRetake(host, false);

    // Nothing was thrown away, and nothing was asked again either — a decline that still
    // cleared the answers would show the quiz again with nothing ticked, which is the
    // half of this that looks like a working retake.
    expect(host.textContent).toContain('Your English level');
    expectPlacedOnTheResultCard(host);
  });

  it('locks Submit and gives back a blank quiz', async () => {
    const host = await submitBody(result('graded'));
    expectPlacedOnTheResultCard(host);

    await pressRetake(host, true);

    // The fieldsets are asserted back before `ticked` is read, so it cannot pass on an
    // empty walk — which is what the result card above looks like from the outside.
    expect(host.querySelectorAll('fieldset')).toHaveLength(BUNDLE.questions.length);
    expect(ticked(host)).toEqual([]);
    expect(submitButton(host).disabled).toBe(true);
    // The counter the learner actually reads, because a locked button on its own does not
    // tell them whether the retake worked or the quiz simply refuses to submit.
    expect(host.textContent).toContain(`0 of ${BUNDLE.questions.length} answered`);
  });

  /**
   * The page's own promise: the failed-writing sentence tells the learner they "can retake
   * the test with a new essay" (`app/placement/page.tsx:283`). An old essay still sitting
   * in the box is that promise broken, and the learner who reads it as saved has to notice
   * and delete it themselves.
   */
  it('empties the writing box rather than keeping the last essay', async () => {
    const host = await submitBody(result('graded'), 200, ESSAY);
    expectPlacedOnTheResultCard(host);

    await pressRetake(host, true);

    expect(host.querySelector('textarea')!.value).toBe('');
  });

  /**
   * The result is what carries the retake button, so a `setResult(null)` that went missing
   * leaves the control exactly where it was, still pressable, pressing successfully — a
   * retake that re-posted the same submission and rendered the same card again.
   */
  it('shows the quiz again rather than the result', async () => {
    const host = await submitBody(result('graded'));
    expect(host.textContent).toContain('Your English level');

    await pressRetake(host, true);

    expect(host.textContent).not.toContain('Your English level');
    expect(host.querySelectorAll('fieldset')).toHaveLength(BUNDLE.questions.length);
  });
});

/**
 * The result outliving the visit.
 *
 * It used to live in component state and nowhere else, so a refresh — or a tab closed and
 * reopened next week — threw away a level that had cost twelve answers and a graded essay
 * to earn. `restart` warned the learner about exactly that loss while pressing the button
 * themselves; nothing stopped the browser doing it unasked. The result now waits in
 * localStorage, so this walks the whole round trip through the real component: submit,
 * unmount, mount again. Seeding the key by hand would have tested the read without the
 * write, which is the half that can go missing.
 *
 * Canaried three ways, each against the mechanism it names, and each failing exactly one
 * test: `useState(null)` for the restore, `storeResult(null)` commented out in `restart`
 * for the forgetting, and `typeof byLevel` swapped for a bare truthiness check for the
 * guard — that last one red with `Cannot read properties of undefined (reading 'rate')`,
 * the crash-in-render the guard exists to prevent. The first two are orthogonal: the restore
 * test stays green with the clear removed and the forget test stays green with the restore
 * removed, which is what says they are pinning two different halves rather than one twice.
 */
describe('reopening the page', () => {
  it('still shows the result, not an empty quiz', async () => {
    const first = await submitAndRead('graded');
    expect(first.textContent).toContain('Your English level');

    reload();
    const second = await mountPage();

    // The card itself, asserted by what it removed: the form is what a mount with nothing
    // stored renders, so "no fieldsets, no box, no submit" means the card came back rather
    // than the page having silently failed to render at all.
    expect(second.textContent).toContain('Your English level');
    expect(second.querySelectorAll('fieldset')).toHaveLength(0);
    expect(second.querySelector('textarea')).toBeNull();
    expect(second.querySelector('button[type=submit]')).toBeNull();
  });

  /**
   * The other half, and the reason the confirmation in `restart` is still true.
   *
   * Restoring on mount means a retake that only emptied the screen would put the card
   * straight back on the next visit, and the learner who confirmed "this result will be
   * discarded" would be told otherwise by the app they confirmed to. So the stored copy has
   * to go with the state.
   */
  it('a retake is what forgets it', async () => {
    const host = await submitAndRead('graded');
    const button = [...host.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Retake the test'),
    );
    if (!button) throw new Error('the result card offers no retake');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      button.click();
    });

    reload();
    const again = await mountPage();

    expect(again.textContent).not.toContain('Your English level');
    expect(again.querySelectorAll('fieldset')).toHaveLength(BUNDLE.questions.length);
  });

  /**
   * The control on the guard, and the reason it exists.
   *
   * localStorage is shared with every other script on the origin and this value is read on
   * every visit, so the blob cannot be assumed to be a placement. This one carries a
   * `byLevel` that is a string, which is the exact shape that makes the card throw inside a
   * render — `byLevel[level].rate` — and a throw there tears the whole document down, so the
   * learner gets a blank page instead of a quiz.
   */
  it('reads an unusable stored blob as no result rather than a blank page', async () => {
    localStorage.setItem(
      'typestory:placement',
      JSON.stringify({ level: 'A1', objective: { byLevel: 'not an object' } }),
    );

    const host = await mountPage();

    expect(host.querySelectorAll('fieldset')).toHaveLength(BUNDLE.questions.length);
  });
});
