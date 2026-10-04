import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import TutorPage from '../app/tutor/page';
import WritingPage from '../app/writing/page';
import PlacementPage from '../app/placement/page';
import { POST as tutorPost } from '../app/api/tutor/route';
import { POST as writingPost } from '../app/api/writing/route';
import { GET as placementGet, POST as placementPost } from '../app/api/placement/route';
import { createModelClient } from '../lib/ai';
import { MAX_MESSAGE_CHARS, MAX_TURNS } from '../lib/tutor';
import { MAX_TEXT_CHARS, MIN_TEXT_CHARS } from '../lib/writing';

// Mocked at the module boundary for the same reason as test/tutorRoute.test.ts: the real
// module pulls in the Anthropic SDK, and this suite must make no network call.
vi.mock('../lib/ai', () => ({
  AiRefusalError: class extends Error {},
  AiUnusableOutputError: class extends Error {},
  aiFailureCode: () => 'ai_unavailable',
  createModelClient: vi.fn(),
}));

// Same requirement as test/tutorPage.test.ts — the tutor scrolls its transcript on every
// change, and jsdom implements no scrolling.
Element.prototype.scrollIntoView = vi.fn();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = 'Why is it "I have been" and not "I am been"?';
const REPLY = 'Present perfect: an action with a time in the past.';
const ESSAY = 'Yesterday I go to the market with my sister and we come back home very late.';
const REPORT = {
  summary: 'Third person -s is the habit to build here.',
  corrected: 'Yesterday I went to the market with my sister, and we came back very late.',
  improvements: [{ original: 'I go', corrected: 'I went', note: 'Past tense needs -ed.' }],
};

const roots: { unmount: () => void }[] = [];

/**
 * The exact bytes each page puts on the wire, or null if it never posted.
 *
 * Kept as the raw string rather than a parsed object, because the string is what the
 * route would receive — re-serialising a parsed object would quietly repair a body the
 * page could not actually produce.
 */
let wire: string | null = null;

beforeEach(() => {
  wire = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

      // The GETs are the caps each page renders against; the POSTs capture the body and
      // answer well enough for the page to reach a result rather than an error.
      if (!init?.method || init.method === 'GET') {
        if (url.includes('/tutor')) return json({ maxMessageChars: MAX_MESSAGE_CHARS, maxTurns: MAX_TURNS });
        if (url.includes('/writing')) return json({ minTextChars: MIN_TEXT_CHARS, maxTextChars: MAX_TEXT_CHARS });
        if (url.includes('/placement')) {
          // The real handler, so the page is shown the same questions the route scores
          // against — a hand-written bank could drift from it and answer a different test.
          const bundle = await placementGet();
          return new Response(bundle.body, { status: bundle.status, headers: bundle.headers });
        }
        throw new Error(`unexpected GET ${url}`);
      }

      wire = String(init.body);
      if (url.includes('/tutor')) return json({ reply: REPLY });
      if (url.includes('/writing')) return json({ report: REPORT });
      // The real handler, and free: the essay box is left empty, so the quiz is scored
      // with no model call. A hand-written result was tried first and the result card
      // reads more of it than the assertions care about — `result.objective.level`
      // included — so a stub has to track a shape it is not testing.
      return placementPost(
        new Request('http://localhost:3000/api/placement', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: wire,
        }),
      );
    }),
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  // The placement page restores its last result on mount, so a test that left one behind
  // turns the next test's fresh mount into the result card — no quiz, no "See my level",
  // and an `answerAll` that has nothing to answer.
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.mocked(createModelClient).mockReset();
});

/** Mount a page and hand back its host, once its caps have arrived. */
async function render(Page: typeof TutorPage | typeof WritingPage | typeof PlacementPage): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(Page));
  });
  return host;
}

/**
 * Set a controlled field.
 *
 * React tracks the value, so the change has to go through the setter it patched over the
 * DOM one — test/tutorPage.test.ts does the same for the same reason.
 */
async function fill(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** A button, found by the text it shows rather than by position. */
function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found as HTMLButtonElement;
}

/** What the page under test sent, failing loudly if it never posted. */
function sent(): string {
  if (wire === null) throw new Error('the page never posted');
  return wire;
}

/** The same body with one field renamed — the smallest edit that breaks the app. */
const rename = (body: string, from: string, to: string) => {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, [to]: parsed[from], [from]: undefined });
};

/**
 * Answer every question with its first option.
 *
 * Driven from the DOM rather than from the question bank, because the page is the thing
 * under test: if it stopped rendering an answer slot for a question, this would click
 * fewer radios than the route requires and the round-trip below would fail — which is the
 * behaviour we want, not something to assert separately.
 */
async function answerAll(host: HTMLElement) {
  const first = new Map<string, HTMLInputElement>();
  for (const radio of host.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    if (!first.has(radio.name)) first.set(radio.name, radio);
  }
  await act(async () => {
    for (const radio of first.values()) radio.click();
  });
}

/**
 * The seam between each page and its own route.
 *
 * Both sides are tested, and neither test can see the other. `test/tutorPage.test.ts`
 * stubs the network, so it asserts only that the page sends *something* it can read back;
 * `test/tutorRoute.test.ts` hand-writes a payload, so it asserts only that the route
 * accepts *something* it recognises. A field renamed on one side — `message` to `prompt`,
 * `text` to `writing` — leaves both suites green and turns every question a learner asks
 * and every essay they paste into a 400 they cannot cause or recover from. Nothing in the
 * repository exercises the two together.
 *
 * So: the page writes the body, the route reads it. Same string, no re-serialising.
 *
 * The control under each pair is the load-bearing half. A 200 from a route that accepted
 * any body at all would look identical to a 200 from a route that agrees with its page,
 * so the renamed body has to turn red — otherwise the round-trip proves that two halves
 * are wired together, not that they agree.
 */
describe('the tutor page and its route', () => {
  const post = (body: string) =>
    tutorPost(
      new Request('http://localhost:3000/api/tutor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );

  it('agrees on the shape of a question', async () => {
    const host = await render(TutorPage);
    await fill(host.querySelector('textarea')!, QUESTION);
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockResolvedValue({ reply: REPLY }),
    });

    const response = await post(sent());

    expect(response.status).toBe(200);
    expect(((await response.json()) as { reply: string }).reply).toBe(REPLY);
  });

  it('rejects the same question under a field name it does not read', async () => {
    const host = await render(TutorPage);
    await fill(host.querySelector('textarea')!, QUESTION);
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect((await post(rename(sent(), 'message', 'prompt'))).status).toBe(400);
  });
});

describe('the writing page and its route', () => {
  const post = (body: string) =>
    writingPost(
      new Request('http://localhost:3000/api/writing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );

  it('agrees on the shape of an essay', async () => {
    const host = await render(WritingPage);
    await fill(host.querySelector('textarea')!, ESSAY);
    await act(async () => {
      button(host, 'Check my writing').click();
    });
    vi.mocked(createModelClient).mockReturnValue({
      generate: vi.fn().mockResolvedValue(REPORT),
    });

    const response = await post(sent());

    expect(response.status).toBe(200);
    expect(((await response.json()) as { report: unknown }).report).toEqual(REPORT);
  });

  it('rejects the same essay under a field name it does not read', async () => {
    const host = await render(WritingPage);
    await fill(host.querySelector('textarea')!, ESSAY);
    await act(async () => {
      button(host, 'Check my writing').click();
    });

    expect((await post(rename(sent(), 'text', 'writing'))).status).toBe(400);
  });
});
/**
 * The third of the same seam, and the one with two required fields rather than one.
 *
 * The control renames `answers` rather than `writing` on purpose. `writing` is optional by
 * design — a blank essay is a legitimate placement — so renaming it cannot turn this
 * route red. `parsePlacementRequest` reads a missing key, a null and an empty string as
 * the same thing, so the field would come back `null` with `writingOutcome: 'skipped'`,
 * and the card would tell the learner "your writing was not graded, so this result comes
 * from the quiz alone" — honest about what happened, wrong about what they did. That is
 * a real failure, and it is exactly why the control has to be the required field:
 * renaming `answers` is the edit that turns this route red, and a control that cannot
 * fail would prove nothing about the round-trip beside it.
 */
describe('the placement page and its route', () => {
  const post = (body: string) =>
    placementPost(
      new Request('http://localhost:3000/api/placement', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );

  it('agrees on the shape of an answer sheet', async () => {
    const host = await render(PlacementPage);
    await answerAll(host);
    await act(async () => {
      button(host, 'See my level').click();
    });

    const response = await post(sent());

    expect(response.status).toBe(200);
    // A level is what a quiz alone can produce, and the essay box was left empty — so
    // this also pins that the page and the route agree the essay is optional.
    expect((await response.json()) as { level: string }).toMatchObject({ level: expect.any(String) });
  });

  it('rejects the same answer sheet under a field name it does not read', async () => {
    const host = await render(PlacementPage);
    await answerAll(host);
    await act(async () => {
      button(host, 'See my level').click();
    });

    expect((await post(rename(sent(), 'answers', 'responses'))).status).toBe(400);
  });
});
