import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import CustomTextPage, { SAMPLES } from '../app/custom/page';
import { useTypingStore } from '../store/useTypingStore';

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// TypingEngine is rendered once a session starts. Confetti only fires on completion,
// which this never reaches, but the module is stubbed so the assertion below cannot
// start depending on a canvas jsdom does not implement.
vi.mock('canvas-confetti', () => ({ default: () => void 0 }));

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  useTypingStore.getState().resetSession();
  // Same reason the store is reset on the line above: the page now opens on the draft it
  // stored, so a test that pasted one would hand the next test a textarea showing that paste
  // instead of the opening sample.
  localStorage.clear();
  // `resetSession` deliberately leaves the passage alone, so a test that started a custom
  // session would hand the next one a store that already holds one — and a page that reads
  // the store back would open on that passage instead of the opening sample. Not a test
  // artefact: it is the same state a real learner is in after a custom run, and the tests
  // below are about the difference between having run one and not.
  useTypingStore.setState({ sourceType: 'story' });
});

/** Unmounts everything rendered, the way leaving the page does. */
function leavePage(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
}

function renderPage(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(CustomTextPage)));
  return host;
}

/** React tracks the DOM's own value, so a plain assignment is invisible to it. */
function paste(host: HTMLElement, value: string) {
  const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** "Sample N", as labelled on the preset buttons. */
function pickSample(host: HTMLElement, n: number) {
  const buttons = [...host.querySelectorAll('button')].filter((b) =>
    (b.textContent ?? '').startsWith('Sample '),
  );
  act(() => {
    (buttons[n - 1] as HTMLButtonElement).click();
  });
}

function startButton(host: HTMLElement): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes('Load & Start Practice'),
  ) as HTMLButtonElement;
}

function start(host: HTMLElement) {
  const button = startButton(host);
  act(() => {
    button.click();
  });
}

/** What the session was actually recorded under — the string in the stats history. */
const recordedTitle = () => useTypingStore.getState().title;

/**
 * The Start button, asked whether there is anything to type.
 *
 * The gate used to be `inputText.trim()`, and it answered a different question from the one
 * the board asks. `trim()` strips whitespace only at the *ends* of a string, so the case
 * that mattered most — a paste made entirely of characters no key can produce — passed it.
 * Zero-width joiners and a BOM reach a paste routinely: CMS output, Google Docs and PDF
 * extractors all emit them. The learner got a passage of invisible characters, and because
 * the caret advances on every keystroke regardless of correctness, the first overshoot can
 * never turn green — which deflates the WPM and the accuracy the session is recorded with.
 *
 * `normalizeTypableText` deletes those characters and collapses what is left, so a paste
 * that is *only* them leaves nothing behind and the button stays disabled. The page says
 * this is the honest explanation, so the disabled button is the whole of the message.
 *
 * Only the call site is pinned here. `test/typingStore.test.ts` covers what
 * `normalizeTypableText` does — it pins the zero-width deletion and the space collapse, and
 * pins that a soft hyphen in a real paragraph is stripped — but it never renders this page,
 * so the gate itself could go back to `trim()` with that file entirely green. That is the
 * same gap `test/wordsCredited.test.ts` closes for the recording call: a claim about a call
 * site is only a claim until something renders the component.
 */
describe('a paste with nothing typeable in it', () => {
  // The exact string the blocked e2e flow uses, and the same one CMS output produces.
  const UNTYPEABLE = '‌‍﻿   ';

  it('leaves Start disabled', () => {
    const host = renderPage();
    // The page opens pre-filled with Sample 1, so the gate has to be reached by replacing
    // the text rather than by the empty state.
    paste(host, UNTYPEABLE);

    expect(startButton(host).disabled).toBe(true);
  });

  /**
   * The control, and the reason the first test means anything.
   *
   * A gate reading the wrong thing is easy to write and easy to satisfy: `disabled` on
   * every render passes the test above and refuses to start anything at all, which is not
   * a gate but a brick. This is the half that says the button is enabled exactly when
   * there is something to type.
   */
  it('leaves Start enabled for text that can be typed', () => {
    const host = renderPage();
    paste(host, 'It was a bright cold day in April.');

    expect(startButton(host).disabled).toBe(false);
  });

  /**
   * And the reason the gate is a normalization rather than a check: a real paragraph
   * carrying one of those characters in the middle is still worth starting, and what
   * reaches the board is the text with the character gone. `trim()` agrees with
   * `normalizeTypableText` here — this is the case that distinguishes them from
   * "always disabled", not from each other, which is why the test above is the load-bearing one.
   */
  it('still starts a real paragraph that carries one', () => {
    const host = renderPage();
    paste(host, 'It was a bright cold day in April, and the clocks were striking thirteen.­');

    expect(startButton(host).disabled).toBe(false);
    start(host);

    expect(useTypingStore.getState().targetText).toBe(
      'It was a bright cold day in April, and the clocks were striking thirteen.',
    );
  });
});

/**
 * The other half of "typeable", and the half nothing asked about.
 *
 * The describe above covers a paste with nothing in it to type. This one covers a paste
 * with plenty — a whole sentence of perfectly ordinary English — carrying a character no
 * key on a US layout produces. `normalizeTypableText` rewrites curly quotes, dashes and
 * ellipses into typeable ASCII and deletes the invisible ones, so those are handled; a
 * letter with an accent is not, and is left alone *on purpose* by that same function.
 *
 * That leaves the board asking for something unreachable. `handleKeyInput` advances the
 * caret on every keystroke whether or not it matched, so `é` parks it on a position that
 * can never turn green: the position cannot be repaired mid-passage, it does not block
 * completion, and it drags the WPM and accuracy the session is *recorded* with. One
 * character in a pasted novel, silently taxing every number on the completion card and
 * every row it ever writes to the history — and `test/content.test.ts`, which does hold
 * the shipped corpus to this, could never have caught it. This is the one passage nothing
 * can check before the learner presses the button.
 */
describe('a paste with a character no key produces', () => {
  const UNREACHABLE = 'He drank café au lait at dawn.';

  it('leaves Start disabled', () => {
    const host = renderPage();
    // The page opens on Sample 1, so the character has to arrive by replacing the text.
    paste(host, UNREACHABLE);

    expect(startButton(host).disabled).toBe(true);
  });

  /**
   * A disabled button with no reason is a brick the learner cannot argue with, and this
   * is the one they cannot fix by trying again. It names the character, so the refusal is
   * something to act on rather than something to report.
   */
  it('names the character it cannot accept', () => {
    const host = renderPage();
    paste(host, UNREACHABLE);

    expect(host.textContent).toContain('“é”');
  });

  /**
   * The control, and the reason the first test means anything: `disabled` on every render
   * passes it and refuses to start anything at all. Same sentence, same length, same page
   * — one character different.
   */
  it('leaves Start enabled once that character is gone', () => {
    const host = renderPage();
    paste(host, 'He drank cafe au lait at dawn.');

    expect(startButton(host).disabled).toBe(false);
  });

  /**
   * Asked of the text the board will actually be given, not of what is sitting in the
   * textarea.
   *
   * `normalizeTypableText` turns newlines into spaces and curly apostrophes into plain
   * ones, so every multi-line paste and every typist's quote mark arrives as a character
   * the layout has no key for. Asking the raw textarea would refuse almost everything
   * anyone has ever pasted here — the case above would pass and the page would be useless.
   */
  it('does not refuse the newlines and quotes a paste arrives with', () => {
    const host = renderPage();
    paste(host, '“Good morning,” she said.\nIt was a bright cold day in April.');

    expect(startButton(host).disabled).toBe(false);
  });
});

/**
 * The title a pasted passage is stored under.
 *
 * This page promises to practise "any text or article" and the entire flow is: open it,
 * replace the text, press one button. The title it recorded came from `customTitle`, which
 * only the three preset buttons ever wrote — the initial value was `SAMPLES[0].title` and
 * nothing reset it. So a novel chapter was filed in the learner's stats history as
 * "Technology & AI Impact", with `sourceType: 'custom'` beside it claiming otherwise, and
 * the row was wrong in their backup from then on. Nothing on screen said the text could
 * not be named; the `customTitle || 'Custom Text'` guard below the call was unreachable,
 * which is the other half of the evidence that empty was the intended default.
 *
 * The title belongs to the text, so it follows the text: a preset's name while the preset
 * is what is loaded, and 'Custom Text' once the learner has changed it.
 */
describe('a custom text session', () => {
  it('is recorded under the text the learner pasted, not a preset’s', () => {
    const host = renderPage();
    paste(host, 'It was a bright cold day in April.');

    start(host);

    expect(recordedTitle()).toBe('Custom Text');
  });

  it('keeps a preset’s name when the preset is what is loaded', () => {
    const host = renderPage();
    pickSample(host, 2);

    start(host);

    expect(recordedTitle()).toBe('Mindset & Daily Habits');
  });

  /**
   * The control, and the reason the first test means anything: the page opens pre-filled
   * with Sample 1, so "Custom Text" is only the right answer once the text has changed.
   * A fix that always said 'Custom Text' would pass the first test and break this one.
   */
  it('keeps the opening sample’s name when nothing is pasted', () => {
    const host = renderPage();

    start(host);

    expect(recordedTitle()).toBe('Technology & AI Impact');
  });

  /**
   * Editing a preset is the other half, and the reason the rule is "is this still the
   * preset's text" rather than "has the learner typed anything". Someone who tries Sample
   * 2 and fixes a typo is practising Sample 2.
   */
  it('records the pasted text once the learner edits the sample away', () => {
    const host = renderPage();
    pickSample(host, 2);
    paste(host, 'We are what we repeatedly do! Excellence is a habit.');

    start(host);

    expect(recordedTitle()).toBe('Custom Text');
  });
});

/**
 * A paste of one word.
 *
 * The counter is a plain `{…} words`, and one is a length a learner reaches constantly on
 * this page — a term to drill, a single line, a word they want to see on the board. It is
 * also the number this page's own gate is built around: the button opens for anything the
 * normalizer leaves non-empty, so the shortest session the page will start is one word long
 * and the sentence describing it is wrong for the whole of it.
 *
 * `app/page.tsx:104`, `components/typing/StoryReader.tsx:85` and
 * `components/stories/StoriesCatalog.tsx:259` write the same sentence and are left alone:
 * the corpus puts those at 124 words and 5 questions, so nothing in the data can reach
 * one. `components/Navbar.tsx:113` gets it right already, with
 * `day${streak === 1 ? '' : 's'}` — the rule exists in the app already, which is what
 * makes the two copies of it worth one shared helper rather than three.
 */
describe('a paste of exactly one word', () => {
  it('is counted in the singular', () => {
    const host = renderPage();

    paste(host, 'hello');

    expect(host.textContent).toContain('1 word');
    expect(host.textContent).not.toContain('1 words');
  });

  /** The control: the rule is about one, not about small numbers. */
  it('still counts two words in the plural', () => {
    const host = renderPage();

    paste(host, 'hello world');

    expect(host.textContent).toContain('2 words');
  });
});

/**
 * Changing the text with a run in progress.
 *
 * The textarea and the board are both on this page at once, and the board is reading the
 * textarea. That is the right relationship when there is no run — one text, one board — and
 * it stops being one the moment there is: a run in progress is a learner partway through a
 * passage, and the textarea is the one control this page offers for changing what they are
 * typing. Typing in it is focus in a textarea, so the board's keydown guard holds it off
 * (`TypingEngine` ignores events from an input) and the run is not advanced — but the text
 * the board was handed changed, so the board re-seeds the store with it, and `loadCustomText`
 * writes `typedText: ''` with every counter at zero.
 *
 * So the edit they made to fix one word threw away the run they were in the middle of, and
 * the passage under the caret changed as they did it. Nothing said so. "Load & Start
 * Practice" is already the page's one explicit way to start over, and it was not what they
 * pressed.
 */
describe('changing the text with a run in progress', () => {
  const EDITED = 'The ledger lies, and the lantern gutters.';

  /** The keystrokes of a run partway through, as the store holds them. */
  function typeIntoTheBoard(text: string): string {
    for (const key of text) {
      act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
    }
    return useTypingStore.getState().typedText;
  }

  it('does not throw the run away', () => {
    const host = renderPage();
    pickSample(host, 2);
    start(host);
    const typed = typeIntoTheBoard('We are');
    expect(typed).not.toBe('');

    paste(host, EDITED);

    expect(useTypingStore.getState().typedText).toBe(typed);
  });

  it('leaves the passage the run is on alone, rather than swapping it mid-word', () => {
    const host = renderPage();
    pickSample(host, 2);
    start(host);
    typeIntoTheBoard('We are');
    const running = useTypingStore.getState().targetText;

    paste(host, EDITED);

    expect(useTypingStore.getState().targetText).toBe(running);
  });

  /**
   * The control, and the reason the two above are not satisfied by a textarea that stopped
   * being a textarea: `paste` writes the DOM value and fires an event, and React tracks its
   * own copy of that value. A textarea that had stopped updating would leave `inputText`
   * alone, the board would never be re-seeded, and all three of these would pass over a
   * page nobody can paste into.
   */
  it('still takes the edit — the textarea is not locked against it', () => {
    const host = renderPage();
    pickSample(host, 2);
    start(host);

    paste(host, EDITED);

    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(EDITED);
  });
});

/**
 * Coming back to the page.
 *
 * `/custom` is the sixth entry in `NAV_ROUTES`, so it is one header click from anywhere.
 * Everything on it was `useState`, and the store is a module singleton that outlives the
 * component — so leaving and coming back left the two holding different answers to the same
 * question. The board was gone and the textarea showed the opening sample, while the store
 * still held the pasted passage and every keystroke of a run in progress, and one press of
 * "Load & Start Practice" overwrote it.
 *
 * The paste is the whole point of this page: an article, a chapter, someone's own notes.
 * The controls that can navigate away from it are the header and the footer, on every page,
 * and nothing warns that a click on "Stories" throws the passage away.
 */
describe('coming back to it', () => {
  const PASTED = 'The lantern gutters and the ledger lies. Type this passage to the end.';

  it('still holds the pasted passage and the run in progress', () => {
    const first = renderPage();
    paste(first, PASTED);
    start(first);

    for (const key of 'The lantern') {
      act(() =>
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
      );
    }
    const typed = useTypingStore.getState().typedText;
    expect(typed).not.toBe('');

    leavePage();
    const second = renderPage();

    expect((second.querySelector('textarea') as HTMLTextAreaElement).value).toBe(PASTED);
    expect(second.textContent).toContain('lantern');
    expect(useTypingStore.getState().typedText).toBe(typed);
  });

  /**
   * The control, and the reason the test above means anything: "always restore whatever the
   * store holds" would pass it. A learner who has never started a custom session — or who
   * last practised a story — comes back to the page they were given, not to a passage they
   * never chose and a board they never started.
   *
   * Against `SAMPLES[0].text` rather than "anything but the paste": the store holds no paste
   * at this point either way, so the weaker comparison passed a fix that restored the wrong
   * passage entirely — it is the sample's own text that pins it.
   */
  it('opens on the sample and no board when the store holds no custom session', () => {
    const host = renderPage();

    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(SAMPLES[0].text);
    expect(host.textContent).not.toContain('lantern');
  });
});

/**
 * The other half of "coming back": a refresh rather than a click.
 *
 * The store is a module singleton, so it survives leaving the page and does not survive
 * reloading it — which made the test above pass for a page that lost a pasted chapter at F5.
 * The passage is the learner's own work, copied out of a document they would have to open
 * and find again, and it is the third page holding a learner's text where `/placement` and
 * `/writing` now keep theirs.
 *
 * Every test here leaves the *store* alone, which is what separates this from the describe
 * above: a draft that was never started is held by nothing but the draft, so a restore that
 * quietly read the store would pass none of them.
 *
 * Canaried three ways, each against the mechanism it names. Emptying `saveDraft` kills all
 * three of the draft tests and leaves the precedence one green, which is the split the
 * describe was built around. `??` swapped for `||` kills only the cleared-box test — that is
 * the canary for the `null`-vs-`''` distinction, and the first one I wrote was wrong: dropping
 * the `draft` read entirely breaks the same test for an unrelated reason, so it proved the
 * draft was stored but not the thing this test exists to pin. And deleting the store's
 * `restored` branch from `initialText` kills only the precedence test.
 */
describe('reloading the page', () => {
  const PASTED = 'The tide came in overnight and left a seam of kelp across the path.';

  it('still holds a passage that was pasted but never started', () => {
    const first = renderPage();
    paste(first, PASTED);

    leavePage();
    const second = renderPage();

    expect((second.querySelector('textarea') as HTMLTextAreaElement).value).toBe(PASTED);
    // The pre-condition: nothing was ever run, so this cannot be the store answering.
    expect(useTypingStore.getState().sourceType).not.toBe('custom');
  });

  /**
   * The half that is easy to get wrong and invisible when it is.
   *
   * `presetIndex` is what decides whether the run is recorded under a sample's name or under
   * "Custom Text", and the page's own history here is a bug where the two initialisers
   * disagreed about it — so a restored draft that showed the right text under the wrong
   * preset would type correctly and then file the session wrongly, and the wrong row goes
   * into the backup. Asserted through `Start`, which is the only thing that names a session.
   */
  it('keeps a chosen sample named as itself, not as Custom Text', () => {
    const first = renderPage();
    const preset = [...first.querySelectorAll('button')].find(
      (b) => b.textContent === 'Sample 2',
    );
    if (!preset) throw new Error('the page offers no presets');
    act(() => preset.click());

    leavePage();
    const second = renderPage();
    expect((second.querySelector('textarea') as HTMLTextAreaElement).value).toBe(SAMPLES[1].text);

    start(second);
    expect(useTypingStore.getState().title).toBe(SAMPLES[1].title);
  });

  /**
   * A box the learner deliberately emptied.
   *
   * `null` and `''` are different stored values here, and the difference is the whole test:
   * a draft read as "empty means fall back to the opening sample" would put a passage back
   * into a box the learner had just cleared, which is the surprising direction.
   */
  it('leaves a cleared box cleared rather than refilling it with a sample', () => {
    const first = renderPage();
    paste(first, PASTED);
    paste(first, '');

    leavePage();
    const second = renderPage();

    expect((second.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  /**
   * Precedence, and the one that is not obviously right in either direction: a run in the
   * store wins over a stored draft.
   *
   * The store holds what the learner is drilling *now*, and the draft is what they are
   * writing for next — a difference the page keeps on purpose, with the textarea and the
   * board holding different text. Restoring the draft on top of the run would show the
   * passage in the box that the board is not running, and `Start` would then silently
   * replace the run in progress with it.
   */
  it('prefers the run in the store over the draft being written', () => {
    const first = renderPage();
    paste(first, PASTED);
    start(first);
    paste(first, 'Something else entirely, half-written.');

    leavePage();
    const second = renderPage();

    expect((second.querySelector('textarea') as HTMLTextAreaElement).value).toBe(PASTED);
  });
});
