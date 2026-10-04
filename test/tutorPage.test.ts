import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import TutorPage from '../app/tutor/page';
import { AiRefusalError, AiUnusableOutputError, aiFailureCode } from '../lib/ai';
import { MAX_TURNS, parseTutorRequest } from '../lib/tutor';

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no scrolling at all. The page scrolls the transcript to its newest turn
// on every change to `transcript` or `submitting`, so the first test here that actually
// sends a question hits it — the three above only ever read the static page.
Element.prototype.scrollIntoView = vi.fn();

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.unstubAllGlobals();
});

/** Mount the page against a stubbed GET and hand back the rendered host. */
async function renderTutorPage(): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ maxMessageChars: 2000, maxTurns: MAX_TURNS }), {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(TutorPage));
  });
  return host;
}

/**
 * What the page tells the learner it remembers.
 *
 * `trimHistory` keeps the most recent `MAX_TURNS` turns, so the tutor genuinely has the
 * last six questions and nothing before them — while the transcript on screen keeps every
 * turn, so the two diverge exactly where a learner is most likely to notice. The heading
 * said "the tutor keeps the conversation, so follow-ups work", which describes the
 * scrollback rather than the context the model receives.
 *
 * The number is derived from the route's own `maxTurns` rather than written into the
 * sentence, which is the point of the test: a literal here would drift from `MAX_TURNS`
 * silently and would be wrong in the same quiet way. `test/tutorHistory.test.ts` pins the
 * trimming; this pins the sentence describing it.
 */
/**
 * Whether the learner is told the tutor is still fetching.
 *
 * An `aria-label` only names an element that supports naming, and a bare Lucide `<svg>`
 * does not: it has no `role`, so it computes to `generic`, and `generic` is one of the
 * roles ARIA forbids a name on. The label was dropped with the rest of the accessibility
 * tree, and what is left is an element with no text, no name and no announcement — a
 * screen reader arrives on `/tutor`, hears nothing, and has no way to tell the page from a
 * blank one. `role="status"` makes it a polite live region, so it is announced when it
 * appears, which is the only moment a loading indicator is worth hearing.
 *
 * Same shape on all five icon-only spinners in the app. The one inside the transcript is
 * deliberately not in that set: it sits beside a visible "thinking…", so it is not the
 * only way the state reaches the accessibility tree.
 *
 * Rendered against a GET that never resolves, which is the state the indicator exists for.
 */
/** The page against a GET that never settles, which is the state it exists in. */
async function renderLoadingTutorPage(): Promise<HTMLElement> {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(TutorPage));
  });
  return host;
}

describe('loading indicators', () => {
  it('announces the fetch, rather than labelling a picture of a spinner', async () => {
    const host = await renderLoadingTutorPage();

    const status = host.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-label')).toBe('Loading');
  });

  /**
   * Whether the page is identifiable before it is usable.
   *
   * `if (!bundle) return <spinner/>` meant the entire document was a picture of a spinner:
   * no heading, no landmark, no text at all. That is what a screen reader arrives on when
   * it opens the page, so the learner is told nothing — not "the tutor is loading", not
   * even what page they are on — and a keyboard user tabbing straight away lands on
   * nothing. The heading belongs to the page rather than to the data, so it has no reason
   * to wait for the bundle; rendering it in both states also stops the heading appearing
   * from nowhere when the content lands.
   *
   * Same wording in both states, so the page does not change title under the learner.
   */
  it('names the page while the bundle is still in flight', async () => {
    const host = await renderLoadingTutorPage();

    expect(host.querySelector('h1')?.textContent).toBe(
      (await renderTutorPage()).querySelector('h1')?.textContent,
    );
  });
});

describe('what the tutor page says it remembers', () => {
  it('names the window the tutor actually has', async () => {
    const shown = (await renderTutorPage()).textContent ?? '';

    expect(shown).toContain(`remembers your last ${MAX_TURNS / 2} questions`);
  });

  /**
   * The control, and the reason the sentence is worth anything.
   *
   * The transcript itself is never trimmed, so "keeps the conversation" is not a
   * description of nothing — it describes the scrollback. Without this, a rewrite that
   * deleted the claim outright would satisfy the test above on its own.
   */
  it('says the older half of the scrollback is not in the conversation', async () => {
    const shown = (await renderTutorPage()).textContent ?? '';

    expect(shown).toContain('no longer part of the conversation');
  });

  it('no longer promises the conversation without limit', async () => {
    expect((await renderTutorPage()).textContent ?? '').not.toContain(
      'tutor keeps the conversation',
    );
  });

  /**
   * The scope, which is the half of the sentence that was missing.
   *
   * The transcript is `useState<TutorMessage[]>([])` at `app/tutor/page.tsx:63` and is
   * written nowhere else — no store, no localStorage, no backup, no field on the progress
   * record. So the tutor's memory ends at the page: a reload, a back button, or simply
   * coming back tomorrow, and the header says the same sentence it said before any of it.
   *
   * Which is a promise to exactly the learner most likely to read it as one. This is the one
   * page in the app that keeps no conversation, and it is the page where everything else has
   * already taught the learner to expect that it will — stats, streak, placement result and
   * backup all survive a refresh. A learner who asked three questions last night arrives at a
   * header stating the tutor remembers their last six, asks a follow-up, and gets an answer
   * with no idea what they were referring to. The follow-up working is the whole point of the
   * sentence, so it is the sentence that has to be honest.
   *
   * The number needed no fixing. `Math.floor(maxTurns / 2)` is right, and the test above
   * already holds it — which is also what stops this one being satisfied by cutting the
   * sentence out, since deleting it would fail both.
   */
  it('scopes what it remembers to the page that is holding it', async () => {
    const shown = (await renderTutorPage()).textContent ?? '';

    expect(shown).toMatch(/remembers your last \d+ questions in this session/);
  });
});

/**
 * What a screen reader is told when the tutor cannot answer.
 *
 * The error paragraph is the whole result of pressing Enter, and on a failure the
 * transcript is reverted too — so nothing else on the page moves. Without an alert region
 * the learner was told nothing at all, including which of the route's three failure codes
 * they hit, which is the only reason those codes are told apart.
 *
 * Asserted against the exact message rather than the region's presence, so a live region
 * wired to something else could not satisfy it.
 */
describe('a question the tutor cannot answer', () => {
  it('is announced as an alert, with the reason the route gave', async () => {
    // GET serves the caps and POST refuses: the shape the page actually meets.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) =>
        init?.method === 'POST'
          ? new Response(JSON.stringify({ error: 'ai_unavailable' }), { status: 502 })
          : new Response(JSON.stringify({ maxMessageChars: 2000, maxTurns: MAX_TURNS }), {
              headers: { 'content-type': 'application/json' },
            }),
      ),
    );

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(createElement(TutorPage));
    });

    const textarea = host.querySelector('textarea')!;
    // React tracks the value, so the change has to go through the setter it patched over
    // the DOM one — test/statsModalRestore.test.ts does the same for the same reason.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(textarea, 'Why is it "I have been" and not "I am been"?');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Submitted on the form rather than by clicking the button, so the assertion does
    // not also depend on the button being enabled.
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const alert = host.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toBe('The tutor is not reachable right now. Please try again.');
  });
});

/**
 * Mount the page and hand back the host, plus every POST body it sent, in order.
 *
 * GET serves the caps; POST is answered by `post`, called once per question, so a test can
 * make the first ask fail and the second succeed. The bodies are collected because the
 * claim worth checking after a failure is not what the page displays but what it would send
 * on the *next* question.
 *
 * `post` may hand back a promise, because a request that never settles is a state the page
 * has to survive — the transcript is asserted while one is still open, and the stub has to
 * stay open to allow it. The page awaits whatever this returns either way.
 */
async function mountTutor(
  post: (call: number) => Response | Promise<Response>,
): Promise<{ host: HTMLElement; sent: unknown[] }> {
  const sent: unknown[] = [];
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === 'POST'
        ? (sent.push(JSON.parse(String(init.body))), post(call++))
        : new Response(JSON.stringify({ maxMessageChars: 2000, maxTurns: MAX_TURNS }), {
            headers: { 'content-type': 'application/json' },
          }),
    ),
  );

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(TutorPage));
  });
  return { host, sent };
}

/** Type a question and submit it the way the form does. */
async function ask(host: HTMLElement, text: string): Promise<void> {
  const textarea = host.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
  });
}

const refuses = (code: string) => () =>
  new Response(JSON.stringify({ error: code }), { status: 502 });

/**
 * A failed question must not poison the next one.
 *
 * The page appends the turn and an empty assistant placeholder before the request goes out,
 * so a learner watching the screen sees their question and a "thinking…" while it is in
 * flight. If the request fails and those stay, the empty assistant turn is re-posted as
 * history with the next question — and `parseTutorRequest` rejects an assistant turn whose
 * content is blank, so every subsequent question is answered 400 for that learner, with no
 * way out but a page reload. That is a whole tutor broken by one dropped request, and the
 * one thing on screen at the time is a polite sentence about the service being down.
 *
 * So the failure is judged by what the page does next, and the oracle is the route's own
 * validator rather than a rule written here: whatever the second POST carries has to be a
 * request `parseTutorRequest` still accepts. That is the claim in the route's terms, and it
 * stays true if the rules ever change.
 */
describe('a question that failed', () => {
  it('leaves the next request one the route will still accept', async () => {
    const { host, sent } = await mountTutor((call) =>
      call === 0 ? refuses('ai_unavailable')() : new Response(JSON.stringify({ reply: 'It is the present perfect.' }), { status: 200 }),
    );

    await ask(host, 'Why is it "I have been"?');
    await ask(host, 'And not "I am been"?');

    expect(sent).toHaveLength(2);
    const [first, second] = sent as { history: { role: string; content: string }[] }[];

    // The failed turn is gone from the wire, not merely from the screen: the second ask
    // carries only what was said before the failure.
    expect(second.history).toEqual(first.history);

    const parsed = parseTutorRequest(second);
    expect(
      parsed.ok ? [] : parsed.issues.map((issue) => `${issue.path}: ${issue.message}`),
    ).toEqual([]);
  });

  /**
   * The screen half of the same claim, which the wire half cannot see: a "thinking…" still
   * on the page is an empty assistant turn still in the transcript, and the next ask is what
   * would carry it.
   */
  it('leaves nothing behind on screen either', async () => {
    const { host } = await mountTutor(refuses('ai_unavailable'));

    await ask(host, 'Why is it "I have been"?');

    expect(host.textContent).not.toContain('thinking…');
    // The failed question is rolled back off the screen along with the placeholder, which
    // is the point: `setTranscript(soFar)` restores exactly what went on the wire, so the
    // transcript cannot drift from the history the next request carries. The cost is that
    // the learner has to retype what they asked — the page is explicit about the box being
    // empty again rather than leaving them a stale question to resubmit. Asserted here as
    // it is, not as it might have been: the starters are still offered, which is what a
    // blanked-out page would fail.
    expect(host.textContent).toContain('What is the difference between');
    // And usable again — the box is empty because the draft is cleared on submit, and Ask
    // is disabled for the same reason, so this is "you can type another" rather than a
    // control left stuck mid-request.
    expect(host.querySelector('textarea')!.value).toBe('');
    const askButton = [...host.querySelectorAll('button[type=submit]')].find((b) =>
      (b.textContent ?? '').includes('Ask'),
    ) as HTMLButtonElement;
    expect(askButton.disabled).toBe(true);
  });
});

/**
 * The tutor's half of the writing page's map, and the same defect in the same shape.
 *
 * `ERROR_TEXT` here is `Record<string, string>`, so nothing ties it to the three codes
 * `lib/ai.ts` can emit, and an entry that goes missing degrades to the generic fallback
 * rather than breaking. The codes are worked out by asking `aiFailureCode` rather than
 * copied, so a fourth case added there arrives here on its own.
 */
/**
 * The tutor actually answering, which nothing was looking at.
 *
 * Every test above is about the page before it knows anything or after it has failed. The
 * failure tests are thorough — they check the wire with the route's own validator and the
 * screen with the absence of a "thinking…" — and between them they never once render a
 * reply. So the state this page exists to reach, a conversation with the learner's turns and
 * the tutor's in it, was untested.
 *
 * The turns are the product. A tutor that answered correctly but styled both sides the same
 * would pass every test in this file and be unusable, because nothing else on the page says
 * who said what.
 */
describe('the tutor answering', () => {
  /** The transcript's turns, in order. The scroll anchor is a `div`, so it is not one. */
  const turns = (host: HTMLElement) => [...host.querySelectorAll('li')];

  const reply = (text: string) => () => new Response(JSON.stringify({ reply: text }), { status: 200 });

  /**
   * Two turns in, two turns out.
   *
   * The page appends the question and an empty assistant placeholder *before* the request
   * goes out, so a learner watching sees their question and a "thinking…" while it is in
   * flight. On success the placeholder is filled rather than a third turn appended, and the
   * comment at `page.tsx:118` names the alternative: "or a failed send would leave a second
   * empty bubble". A regression that appends instead of filling renders the question, an
   * empty bubble, then the answer — and no test in the file could see it, because the two
   * failure tests only ever look at what is *not* left behind.
   */
  it('leaves one turn per side of the exchange, and no empty one between', async () => {
    const { host } = await mountTutor(reply('Present perfect covers the period up to now.'));

    await ask(host, 'Why is it "I have been"?');

    const shown = turns(host);
    expect(shown).toHaveLength(2);
    expect(shown[0].textContent).toBe('Why is it "I have been"?');
    expect(shown[1].textContent).toBe('Present perfect covers the period up to now.');
    // And the placeholder is gone rather than merely covered: a spinner left rendered under
    // the answer is an assistant turn still in the transcript.
    expect(host.textContent).not.toContain('thinking…');
  });

  /**
   * The claim the turns are readable *as a conversation*.
   *
   * jsdom applies no layout, so `justify-end` and `justify-start` cannot be observed as a
   * position — the class is the mechanism, and the same one the category pills and the
   * navbar's current link are pinned on. Compared between the two turns rather than against
   * a class list, because the failure is the two expressions of "who spoke" drifting into
   * agreeing with each other.
   */
  it('tells the learner’s questions from the tutor’s answers', async () => {
    const { host } = await mountTutor(reply('Present perfect covers the period up to now.'));

    await ask(host, 'Why is it "I have been"?');

    const [question, answer] = turns(host);
    expect(question.className).not.toBe(answer.className);
    // One side is the learner's and it is the indigo, right-aligned one; the tutor's is the
    // plain left-aligned bubble. A page that styled both alike would satisfy the check above.
    const learners = [question, answer].filter((turn) => turn.className.includes('justify-end'));
    expect(learners).toEqual([question]);
    expect(question.querySelector('div')!.className).toContain('bg-indigo-600');
    expect(answer.querySelector('div')!.className).not.toContain('bg-indigo-600');
  });

  /**
   * And while the answer is still coming, which is the state the placeholder exists for.
   *
   * The alternative is an empty bubble: a grey rectangle with nothing in it, indistinguishable
   * from a tutor that had finished and said nothing. Rendered against a POST that does not
   * resolve, because that is the only moment the branch is live.
   */
  it('says the answer is coming rather than showing an empty turn', async () => {
    // A POST that never settles, which is the only moment the branch is live. Nothing has
    // to release it: the transcript is asserted while the request is still open.
    const { host } = await mountTutor(() => new Promise<Response>(() => {}));

    await ask(host, 'Why is it "I have been"?');

    expect(turns(host)).toHaveLength(2);
    expect(host.textContent).toContain('thinking…');
    // The placeholder is the assistant's turn and it is not blank — a spinner with a word
    // beside it, which is the one thing on screen that says the request is still open.
    expect(turns(host)[1].textContent).not.toBe('');
  });
});

describe('each failure the shared AI layer can report', () => {
  const CODES = [
    aiFailureCode(new AiRefusalError('declined')),
    aiFailureCode(new AiUnusableOutputError('not the schema')),
    aiFailureCode(new Error('socket hang up')),
  ];

  it('is one this page has a sentence of its own for', async () => {
    // A code no route emits, so whatever it renders is what this page does with anything
    // it does not recognise — which is exactly what a dropped entry degrades into.
    const { host: unknownHost } = await mountTutor(refuses('no_such_code'));
    await ask(unknownHost, 'Why is it "I have been"?');
    const fallback = unknownHost.querySelector('[role="alert"]')?.textContent ?? '';
    expect(fallback).not.toBe('');

    for (const code of CODES) {
      const { host } = await mountTutor(refuses(code));
      await ask(host, 'Why is it "I have been"?');
      expect(
        host.querySelector('[role="alert"]')?.textContent,
        `the page has no sentence for "${code}"`,
      ).not.toBe(fallback);
    }
  });
});
/**
 * A question typed into the box while the tutor is still answering.
 *
 * `send` opens with `if (!bundle || submitting) return;`, and that guard is load-bearing —
 * it is what stops a second POST while the first is open, which is why the Ask button is
 * `disabled={submitting}` too. The textarea is not: it carries no `disabled`, so it stays
 * live and editable through the whole request, which is deliberate — a learner waiting out
 * an answer should be able to compose the next question rather than have the page lock.
 *
 * So the Enter handler has to be the one that respects the guard, and it did not. It ran
 *
 *     setDraft('');
 *     void send(text);
 *
 * `setDraft('')` is not conditional on `send` going on to do anything, so pressing Enter
 * while a request was in flight cleared the box and sent nothing: the question was gone,
 * no request carried it, no error appeared, and the page said nothing about it. Silent,
 * total loss of a question the learner had finished composing — on the one input whose
 * whole purpose is composing a question.
 *
 * The Ask button being disabled is why this survived: a mouse user cannot reach this path
 * at all, since the only other way to submit is that button. Enter is the keyboard path,
 * and a keyboard user waiting on a slow answer is exactly who hit it.
 */
describe('a question composed while the tutor is still answering', () => {
  it('is still in the box, and still unsent, when Enter is pressed too early', async () => {
    // A POST that never settles, so `submitting` is still true throughout.
    const { host, sent } = await mountTutor(() => new Promise(() => {}));

    await ask(host, 'Why is it "I have been"?');

    // The first ask is genuinely in flight: the button that would have submitted the second
    // one is disabled, and `submitting` is the flag the handler has to check.
    const textarea = host.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    const askButton = [...host.querySelectorAll('button[type=submit]')].find((b) =>
      (b.textContent ?? '').includes('Ask'),
    ) as HTMLButtonElement;
    expect(askButton.disabled).toBe(true);

    const followUp = 'And not "I am been"?';
    await act(async () => {
      setter.call(textarea, followUp);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });

    expect(textarea.value).toBe(followUp);
    expect(sent).toHaveLength(1);
  });

  /**
   * The control, and the half that makes the test above mean something: the guard is
   * `submitting`, not Enter. `ask` above submits the *form*, so nothing in this file
   * otherwise proves the Enter path works at all — and a handler that simply refused
   * every Enter would leave the box intact forever and pass.
   */
  it('is sent, and cleared, by the same Enter key once the tutor has answered', async () => {
    const { host, sent } = await mountTutor(() =>
      new Response(JSON.stringify({ reply: 'It is the present perfect.' }), { status: 200 }),
    );

    const textarea = host.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;

    await ask(host, 'Why is it "I have been"?');

    const followUp = 'And not "I am been"?';
    await act(async () => {
      setter.call(textarea, followUp);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });

    expect(sent).toHaveLength(2);
    expect((sent[1] as { message: string }).message).toBe(followUp);
    expect(textarea.value).toBe('');
  });
});

/**
 * Clear — the only control on this page that throws away a conversation rather than adding
 * to one, and the last one here with nothing watching it.
 *
 * Everything else in this file asserts a page that is loading, failing or answering. Clear
 * is the fourth state: the learner has a transcript, does not want it, and asks for it to
 * go. Its handler is two setters,
 *
 *     setTranscript([]);
 *     setSubmitError(null);
 *
 * and the reason to pin them together rather than either alone is that they are cleared by
 * different failures. A failed send leaves both an error banner and a rolled-back
 * transcript, and a Clear that emptied the transcript while leaving the banner would leave
 * the learner reading "the tutor is not reachable" over a page with no conversation on it —
 * a complaint about a question that is no longer visible. The starters come back, so the
 * page looks usable while the one sentence on it says it is not.
 *
 * Reachable, which is the other half: the banner only outlives its question when the
 * failure came *after* an exchange, so this needs a good send followed by a refused one.
 */
describe('clearing the conversation', () => {
  /**
   * The transcript's turns only. The starters are `<li>`s too, and they render on exactly
   * the assertion that matters here — the cleared page — so an unfiltered count reads three
   * after a Clear that worked perfectly. The two are told apart by the button a starter
   * wraps and a turn does not have.
   */
  const turns = (host: HTMLElement) =>
    [...host.querySelectorAll('li')].filter((li) => !li.querySelector('button'));

  const clearButton = (host: HTMLElement) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Clear') as
      | HTMLButtonElement
      | undefined;

  /** One exchange that lands, then one the route refuses. */
  const oneGoodThenOneRefused = (call: number) =>
    call === 0
      ? new Response(JSON.stringify({ reply: 'It is the present perfect.' }), { status: 200 })
      : new Response(JSON.stringify({ error: 'ai_unavailable' }), { status: 502 });

  it('takes the transcript away, and offers the starters again', async () => {
    const { host } = await mountTutor(oneGoodThenOneRefused);

    await ask(host, 'Why is it "I have been"?');

    // The precondition: there is a conversation, and Clear is on the page because of it.
    expect(turns(host)).toHaveLength(2);
    expect(clearButton(host)).toBeTruthy();

    await act(async () => {
      clearButton(host)!.click();
    });

    expect(turns(host)).toHaveLength(0);
    // The empty state, which is what makes "cleared" different from "broken": the starters
    // are the way back in, and they only render when the transcript is empty.
    expect(host.textContent).toContain('What is the difference between');
  });

  /**
   * The other failure, and the reason the banner is cleared alongside the transcript rather
   * than by the failure path's own `finally`: the two outlive each other in exactly one
   * state, which is a refused question asked after a good one.
   */
  it('takes the error banner with it', async () => {
    const { host } = await mountTutor(oneGoodThenOneRefused);

    await ask(host, 'Why is it "I have been"?');
    await ask(host, 'And not "I am been"?');

    // Both are on screen: the first exchange, and the alert the second ask produced.
    expect(turns(host)).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')).toBeTruthy();

    await act(async () => {
      clearButton(host)!.click();
    });

    expect(turns(host)).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  /**
   * The control, and the state the guard exists for: an open request. Clearing then would
   * throw away the transcript the in-flight reply is about to land in — `send` fills the
   * *last* entry, which after a clear is nothing, so the answer would append its own turn
   * onto an empty page. Asserted as a property rather than by clicking, because jsdom does
   * not dispatch clicks on a disabled control.
   */
  it('is not offered while a request is still open', async () => {
    const { host } = await mountTutor(() => new Promise(() => {}));

    expect(clearButton(host)).toBeUndefined();

    await ask(host, 'Why is it "I have been"?');

    expect(clearButton(host)!.disabled).toBe(true);
  });
});
