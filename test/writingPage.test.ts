import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import WritingPage from '../app/writing/page';
import { AiRefusalError, AiUnusableOutputError, aiFailureCode } from '../lib/ai';
import { MAX_IMPROVEMENTS, MIN_TEXT_CHARS, type CorrectionReport } from '../lib/writing';

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  // The page restores the last draft and its correction on mount, and a test that left
  // either behind would turn the next test's fresh mount into the report rather than the
  // editor — no textarea, so `checkSomeWriting` would type into a box that is not there.
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** The length caps the page fetches on the way in. Every state of the page needs them. */
const CAPS = { minTextChars: MIN_TEXT_CHARS, maxTextChars: 4000 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Mount the page. `post` decides what submitting answers with; the GET always serves the
 * caps, which is the shape the page actually meets — it cannot leave its spinner without
 * them, so a caller who stubs only the POST still gets a page that renders.
 */
async function mount(post: (init?: RequestInit) => Response): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === 'POST' ? post(init) : json(CAPS),
    ),
  );

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(WritingPage));
  });
  return host;
}

/** What `checkSomeWriting` types. Read back by the tests that assert on the editor. */
const SUBMITTED = 'Yesterday I go to the market with my sister.';

/** Type into the textarea the way a learner would. */
const edit = async (host: HTMLElement, text: string) => {
  const textarea = host.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** Type enough to pass the button's own gate and press it, as a learner would. */
async function checkSomeWriting(host: HTMLElement): Promise<void> {
  const textarea = host.querySelector('textarea')!;
  // React tracks the value, so the change has to go through the setter it patched over
  // the DOM one — the same reason test/tutorPage.test.ts uses it.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, SUBMITTED);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Clicked rather than submitted: this page has no <form> — submission is the
  // button's onClick, and the button stays disabled below `minTextChars`, so the
  // text above has to be long enough before this can reach the route at all.
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Check my writing',
  )!;
  expect(button.disabled).toBe(false);

  await act(async () => {
    button.click();
  });
}

/** Mount the page with POST refusing in the way the caller asks. */
function renderWritingPage(errorCode = 'ai_unavailable'): Promise<HTMLElement> {
  return mount(() => json({ error: errorCode }, 502));
}

/** Type enough to pass the button's own gate, submit, and report what the alert said. */
async function submitAndRead(errorCode: string): Promise<string> {
  const host = await renderWritingPage(errorCode);
  await checkSomeWriting(host);

  const alert = host.querySelector('[role="alert"]');
  expect(alert).toBeTruthy();
  return alert?.textContent ?? '';
}

/** The page with a correction to show, which is the state it spends nearly all its time in. */
async function correctedPage(report: CorrectionReport): Promise<HTMLElement> {
  const host = await mount(() => json({ report }));
  await checkSomeWriting(host);
  return host;
}

/**
 * What a screen reader is told when the correction comes back unusable.
 *
 * The error paragraph is the whole result of pressing the button, and nothing else on
 * the page moves — the report branch is not taken and the text stays put. Without an
 * alert region the learner was told nothing at all, including which of the route's
 * failure codes they hit, which is the only reason those codes are told apart.
 *
 * Asserted against the exact message rather than the region's presence, so a live
 * region wired to something else could not satisfy it. test/tutorPage.test.ts pins the
 * same guarantee on the tutor's identical surface.
 */
describe('writing the correction service cannot check', () => {
  it('is announced as an alert, with the reason the route gave', async () => {
    expect(await submitAndRead('ai_unavailable')).toBe(
      'The correction service is not reachable right now. Please try again.',
    );
  });
});

/**
 * The three codes `lib/ai.ts` can emit, worked out rather than copied.
 *
 * `aiFailureCode` is the one place the two routes that report a bare model failure agree
 * on what went wrong, and it has exactly three answers. Asking it for them means this file
 * cannot fall behind the shared layer: a fourth case added there arrives here automatically,
 * where a list written out by hand would quietly test three of four forever.
 *
 * A code the page has never heard of lands on the generic fallback, and that is what a
 * dropped entry looks like from the outside — the learner presses the button, the request
 * fails, and they are told "The correction failed. Please try again." instead of what
 * actually happened. Nothing breaks, nothing warns, and the map is `Record<string, string>`
 * rather than `Record<AiFailureCode, string>`, so the compiler cannot see it either. The
 * only thing standing between that and a learner is a test.
 */
describe('each failure the shared AI layer can report', () => {
  const CODES = [
    aiFailureCode(new AiRefusalError('declined')),
    aiFailureCode(new AiUnusableOutputError('not the schema')),
    aiFailureCode(new Error('socket hang up')),
  ];

  it('is one this page has a sentence of its own for', async () => {
    // A code no route emits, so whatever it renders is the page's behaviour for anything
    // it does not recognise — which is exactly what a dropped entry degrades into. Read
    // rather than written down: the fallback is production copy, and a second copy of it
    // here would be a copy that drifts.
    const fallback = await submitAndRead('no_such_code');
    expect(fallback).not.toBe('');

    for (const code of CODES) {
      expect(await submitAndRead(code), `the page has no sentence for "${code}"`).not.toBe(
        fallback,
      );
    }
  });

  /**
   * And they are told apart, which the previous test cannot see: two codes sharing one
   * sentence is three distinct messages and still passes it.
   *
   * This is the failure the codes exist to prevent. A refusal and an outage are different
   * things — one is the model declining, the other is the service not answering — and a
   * learner told "not reachable right now" about a refusal is being told a falsehood about
   * the world, which is the same defect as the placement page's "That is normal" sentence
   * on a result it never earned.
   */
  it('is not one sentence standing in for two of them', async () => {
    // One at a time: each call mounts its own page into the shared document, so running
    // them together leaves each one reaching for a textarea another has already unmounted.
    const said: string[] = [];
    for (const code of CODES) said.push(await submitAndRead(code));

    expect(new Set(said).size).toBe(CODES.length);
  });
});

/**
 * The state this page is in almost all the time, which nothing was looking at.
 *
 * Every test above is about the page failing, and the failing branch returns before the
 * report is ever consulted — so all three finish with the report branch untaken. Between
 * them they cover the alert, the three codes and the fallback, and not one line of what a
 * learner actually came for. The empty report at the bottom of this block is a further
 * branch of the same JSX, so it was uncovered for the same reason.
 *
 * What is under test is the page's own copy, which promises two things at `page.tsx:126`:
 * "You get back how a fluent speaker would phrase it, plus each change explained." The
 * first is a rendered field. The second is per-item — a report that listed the changes and
 * dropped their notes would still render a list, still render a count, and leave a learner
 * holding corrections they had been told were explained.
 */
describe('the correction the page came back with', () => {
  /** A report carrying `n` changes, none of them alike so a mix-up would show. */
  const report = (n: number): CorrectionReport => ({
    summary: 'Tense agreement is the thing costing you most.',
    corrected: 'Yesterday I went to the market with my sister.',
    improvements: Array.from({ length: n }, (_, i) => ({
      original: `go number ${i}`,
      corrected: `went number ${i}`,
      note: `Reason number ${i}.`,
    })),
  });

  /** The page after submitting and getting `report` back. */
  const corrected = (n: number) => correctedPage(report(n));

  it('shows the rewrite and says what to work on', async () => {
    const host = await corrected(2);

    expect(host.textContent).toContain('Tense agreement is the thing costing you most.');
    expect(host.textContent).toContain('Yesterday I went to the market with my sister.');
  });

  /**
   * The second half of the promise, and the part that is per-item rather than per-report.
   *
   * All three fields of every change, not just the pair being replaced. A page that
   * rendered `original` and `corrected` and dropped `note` would satisfy an assertion
   * about the rewrite and leave the learner with corrections nobody explained — which is
   * what "each change explained" is for.
   */
  it('explains every change it lists', async () => {
    const items = [...(await corrected(3)).querySelectorAll('li')];

    expect(items).toHaveLength(3);
    for (const [i, item] of items.entries()) {
      expect(item.textContent).toContain(`go number ${i}`);
      expect(item.textContent).toContain(`went number ${i}`);
      expect(item.textContent).toContain(`Reason number ${i}.`);
    }
  });

  /**
   * The number in the heading is the number of things under it.
   *
   * The heading reads "Changes (n)" and not "Every change" because `parseCorrectionReport`
   * slices to `MAX_IMPROVEMENTS` rather than throwing the report away, so a model that
   * answered with more is describing a truncated list and the learner can see it is. That
   * count is two separate expressions — the heading and the `.map` beneath it — and nothing
   * but this stops them drifting apart. Same pair as the category pills in
   * `test/catalogFilters.test.ts`, for the same reason.
   *
   * Driven at the cap rather than at an arbitrary count, so "Changes (10)" is a claim about
   * a report that really was cut short and not a coincidence of two equal numbers.
   */
  it('numbers the list it is showing', async () => {
    const host = await corrected(MAX_IMPROVEMENTS);

    expect(host.textContent).toContain(`Changes (${MAX_IMPROVEMENTS})`);
    expect(host.querySelectorAll('li')).toHaveLength(MAX_IMPROVEMENTS);
    // The cap has to be one this run can actually reach, or the heading is being checked
    // against a list of one that happens to equal it.
    expect(MAX_IMPROVEMENTS).toBeGreaterThan(2);
  });

  /**
   * The other end of the same branch: a model that found nothing.
   *
   * Without this the heading promised changes over an empty list, which reads as a page
   * that failed rather than as a text that was already right — the one conclusion here
   * worth stating in as many words as it takes.
   */
  it('says plainly when there was nothing to change', async () => {
    const host = await corrected(0);

    expect(host.querySelectorAll('li')).toHaveLength(0);
    expect(host.textContent).toContain('Nothing needed changing.');
    // Not the other branch's heading: a list of nothing is still a list of nothing.
    expect(host.textContent).toContain('Changes (0)');
  });
});
/**
 * The editor and the report are never on screen together.
 *
 * The textarea's `onChange` carried `if (report) setReport(null)`, under a comment
 * claiming that "editing invalidates the report: feedback for text that is no longer on
 * screen is worse than no feedback at all". That branch could not run. The page renders
 * `report ? <the report and a button> : <the editor>`, so the textarea is mounted only
 * when `report` is falsy — the guard sat inside the one branch where its condition is
 * false by definition. The claim was true; the mechanism was not there.
 *
 * Which matters, because the claim is the one worth keeping. A report is advice about
 * specific words; showing it next to an editor the learner has since changed into is
 * exactly the "feedback for text that is no longer on screen" the comment was about. The
 * page does not merely avoid it — it makes it unrepresentable, because the only way back
 * to the editor clears the report. So these tests assert the structural fact rather than
 * the setter, which means a page that grew an editor alongside the report fails here
 * instead of quietly reintroducing the mismatch the deleted line used to paper over.
 */
describe('the editor and the report', () => {
  const report = (): CorrectionReport => ({
    summary: 'Tense agreement is the thing costing you most.',
    corrected: 'Yesterday I went to the market with my sister.',
    improvements: [
      { original: 'go', corrected: 'went', note: 'Past simple, because "yesterday".' },
    ],
  });

  it('never shows a report next to the text it is grading', async () => {
    const host = await correctedPage(report());

    // The precondition: the report is really up, so "no editor" is the page's doing.
    expect(host.textContent).toContain('Tense agreement is the thing costing you most.');
    expect(host.querySelector('textarea')).toBeNull();
  });

  /**
   * The way back, which is the only way there is. This is the transition a regression
   * would break: a Clear that emptied the report but not the editor, or the reverse.
   */
  it('gives up the report to bring the editor back', async () => {
    const host = await correctedPage(report());
    const again = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Check something else',
    )!;
    expect(again).toBeTruthy();

    await act(async () => {
      again.click();
    });

    expect(host.textContent).not.toContain('Tense agreement is the thing costing you most.');
    expect(host.querySelector('textarea')).toBeTruthy();
  });

  /**
   * …and the writing is still in the editor when it gets there.
   *
   * The click above used to set the text to `''` too, on the sound reasoning that a
   * learner pressing it is starting something else and should not find a graded essay
   * waiting to be submitted again by muscle memory. Being the only way back off the
   * report, it was also the one click in the app that destroyed both halves at once: the
   * correction, and the essay it was explaining. The essay is the learner's own prose —
   * it is not a passage from this app's corpus, so there is no second copy anywhere — and
   * there is no undo, no history and no clipboard copy. One misdirected click, and the
   * sentence that produced "Past simple, because 'yesterday'" is gone along with the
   * sentence explaining it.
   *
   * This is the same class of loss `test/customPage.test.ts` pins on the typing board: a
   * singleton that outlives the component, and a control that can delete what the
   * component was holding. Both fixes are the same one — stop throwing the learner's own
   * words away on a navigation the page describes as something else.
   */
  it('brings back the editor with the writing that was graded still in it', async () => {
    const host = await correctedPage(report());
    const again = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Check something else',
    )!;

    await act(async () => {
      again.click();
    });

    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(SUBMITTED);
  });

  /**
   * The control, and what makes keeping the text free.
   *
   * The worry behind clearing it was that the learner would find a graded essay waiting
   * and submit it again without meaning to. Keeping it answers that by making the
   * re-submission visible instead of hidden: the button the editor brings back does not
   * read "Check something else" — that is the button they just pressed — it reads "Check
   * my writing", and their own words are in the box being looked at.
   *
   * This is not the half that catches the fix; it passes either way, because the editor
   * has always been the branch that renders that label. It is here because it is the
   * property the preservation leans on, and nothing else holds it: reword the editor's
   * button to "Check something else" to match the one above it, and the test above still
   * passes while the second press has become the nameless one.
   */
  it('brings back a button that names what pressing it will now cost', async () => {
    const host = await correctedPage(report());
    await act(async () => {
      (
        [...host.querySelectorAll('button')].find(
          (b) => b.textContent === 'Check something else',
        ) as HTMLButtonElement
      ).click();
    });

    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Check my writing');
    expect(labels).not.toContain('Check something else');
  });

  /**
   * The control, and the other direction. Before anything is submitted there is an editor
   * and no report, so "no editor" above is not just a page that renders very little.
   */
  it('shows the editor alone before anything has been checked', async () => {
    const host = await mount(() => json({ report: report() }));

    expect(host.querySelector('textarea')).toBeTruthy();
    expect(host.textContent).not.toContain('Tense agreement is the thing costing you most.');

    // And editing it works, which is the state the deleted guard used to be defending.
    await edit(host, 'Yesterday I went to the market with my sister and bought vegetables.');
    expect(host.querySelector('textarea')!.value).toContain('vegetables');
  });
});

/**
 * The essay outliving the visit, which is the part of this page that was actually losable.
 *
 * The essay is the learner's own work, and the comment on "Check something else" already
 * says it exists nowhere else — no copy, no history, no undo. It lived in component state
 * and nowhere else, so a refresh mid-sentence threw it away, and the report with it: a
 * model call's worth of correction, reachable again only by paying for it a second time.
 *
 * These walk the real round trip through the component — type, or submit; unmount; mount
 * again — because seeding localStorage by hand would prove the read and say nothing about
 * the write, which is the half that can quietly go missing.
 *
 * Canaried four ways, each against the mechanism it names, and each failing exactly one
 * test: dropping the `onChange` save, dropping the save on submit, dropping the save on
 * "Check something else", and relaxing the report guard to a bare `?? null` — which goes
 * red with `Cannot read properties of undefined (reading 'length')`, the crash-in-render
 * the guard exists to prevent.
 */
describe('reopening the page', () => {
  const report = (): CorrectionReport => ({
    summary: 'Tense agreement is the thing costing you most.',
    corrected: 'Yesterday I went to the market with my sister.',
    improvements: [{ original: 'go', corrected: 'went', note: 'Past simple, because "yesterday".' }],
  });

  /** A visit with nothing stored. The POST is never reached — nothing is pressed. */
  const reopen = () => mount(() => json({ report: report() }));

  function reload(): void {
    const root = roots.pop();
    if (!root) throw new Error('nothing mounted to reload');
    act(() => root.unmount());
  }

  /**
   * The loss the page could not see coming: no submit, no correction, no confirmation —
   * a browser refresh in the middle of writing.
   */
  it('still holds an essay that was never graded', async () => {
    const first = await reopen();
    await edit(first, SUBMITTED);

    reload();
    const second = await reopen();

    expect((second.querySelector('textarea') as HTMLTextAreaElement).value).toBe(SUBMITTED);
  });

  it('still shows a correction, so it is not paid for twice', async () => {
    const first = await mount(() => json({ report: report() }));
    await checkSomeWriting(first);
    expect(first.textContent).toContain('Tense agreement');

    reload();
    const second = await reopen();

    expect(second.textContent).toContain('Tense agreement');
    // Asserted rather than assumed: "no editor" is also true of a page that failed to
    // render, which would satisfy the sentence above on its own.
    expect(second.querySelector('textarea')).toBeNull();
    expect(second.textContent).toContain('Check something else');
  });

  /**
   * The one that had to be designed rather than copied: pressing "Check something else"
   * clears the report, and the decision already recorded on that button is that the words
   * stay. Persisting makes that a claim about storage too — a reload after pressing it must
   * still find the essay, or the button destroys both halves across a refresh even though it
   * no longer destroys both halves on screen.
   */
  it('"Check something else" forgets the correction and keeps the essay', async () => {
    const host = await mount(() => json({ report: report() }));
    await checkSomeWriting(host);
    const button = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Check something else',
    );
    if (!button) throw new Error('the report offers no way back to the editor');
    await act(async () => {
      button.click();
    });

    reload();
    const again = await reopen();

    expect((again.querySelector('textarea') as HTMLTextAreaElement).value).toBe(SUBMITTED);
    expect(again.textContent).not.toContain('Tense agreement');
  });

  /**
   * The control on validating the two halves apart, and the reason they are apart.
   *
   * A stored report missing `improvements` is not a report: the card does
   * `report.improvements.length`, so accepting it throws inside a render and tears the
   * document down. The temptation is to drop the whole blob and start clean. That would
   * trade the learner's own essay — the half that exists nowhere else — for a correction
   * they can ask for again, so the guard keeps the text and drops only the report.
   */
  it('keeps the essay when a stored correction cannot be read', async () => {
    localStorage.setItem(
      'typestory:writing',
      JSON.stringify({ text: SUBMITTED, report: { summary: 'x', corrected: 'y' } }),
    );

    const host = await reopen();

    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(SUBMITTED);
  });
});
