import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Navbar from '../components/Navbar';
import { clearUserStats, recordCompletedSession, loadUserStats } from '../lib/stats';
import { adoptBackupCode, enableBackup, pushProgress } from '../lib/progress-client';

/**
 * The pathname is a property of the browser and `Link` wants a router context that does
 * not exist outside the App Router. Both are inputs to the Navbar rather than things it
 * decides, so both are stubbed — what is under test is what the Navbar does with them.
 */
const mocks = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

vi.mock('next/link', async () => {
  const { createElement: el } = await import('react');
  return {
    default: ({ href, children, ...rest }: Record<string, unknown>) =>
      el('a', { href, ...rest }, children as never),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

beforeEach(() => {
  mocks.pathname = '/';
  clearUserStats();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

function renderNav(pathname: string): HTMLElement {
  mocks.pathname = pathname;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(Navbar)));
  return host;
}

/** The links the header's nav row is made of, in document order. */
function navLinks(host: HTMLElement): HTMLAnchorElement[] {
  return [...host.querySelectorAll('nav a')] as HTMLAnchorElement[];
}

/** The one link saying it is the page you are on — or nothing at all. */
function currentLabels(host: HTMLElement): string[] {
  return navLinks(host)
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.textContent ?? '');
}

/**
 * Which page the header says you are on.
 *
 * `aria-current` is the half a screen reader needs and the half that cannot be inferred
 * from anything else on screen, so it is the oracle. The header had none of it: every
 * nav link carried an identical className, there was no `usePathname` in the component
 * at all, and the app's only `aria-current` was the paragraph tracker inside StoryReader.
 * A learner moving between the six routes — three of which fetch a bundle before they
 * render anything, so the page goes blank mid-navigation — was told nothing about where
 * they had landed.
 */
describe('the header says which page you are on', () => {
  it('marks the route you are on, and only that one', () => {
    expect(currentLabels(renderNav('/placement'))).toEqual(['Placement']);
  });

  /**
   * The eleven story pages live one level down, so a strict equality test would leave
   * every one of them with a nav that claims none of them is current.
   */
  it('keeps Stories current on a story page', () => {
    expect(currentLabels(renderNav('/stories/the-lost-artifact'))).toEqual(['Stories']);
  });

  /**
   * Not colour alone.
   *
   * `aria-current` announces the current page but renders nothing, so a Navbar carrying
   * only that would leave sighted learners with the five identical links they have now.
   * Compared against a sibling rather than against a class list, because the failure
   * this guards is the two drifting apart — a literal here keeps passing after the
   * Navbar's own styling is reflowed.
   */
  it('makes the current link look different from the others', () => {
    const links = navLinks(renderNav('/writing'));
    const writing = links.find((a) => a.getAttribute('aria-current') === 'page')!;
    const tutor = links.find((a) => a.textContent === 'Tutor')!;

    expect(writing.className).not.toBe(tutor.className);
    // `font-bold`, not just `text-indigo-600`: the active state has to survive a
    // monochrome or high-contrast rendering, which drops the colour and keeps the weight.
    expect(writing.className).toContain('font-bold');
  });

  it('marks nothing on the home page, which is not in the nav', () => {
    expect(currentLabels(renderNav('/'))).toEqual([]);
  });
});

/**
 * What a screen reader can call each control in the header.
 *
 * `aria-label` first, because it *replaces* the content rather than adding to it — a
 * button with a label and visible text is announced by the label alone. Otherwise the
 * text. Which is the whole of the objection to `title`: a tooltip is the last resort of
 * the name algorithm, it never wins against real content, and it is not a name anyone
 * types into a review.
 */
function accessibleName(el: Element): string {
  return el.getAttribute('aria-label')?.trim() || el.textContent?.trim() || '';
}

function accessibleNames(host: HTMLElement): string[] {
  return [...host.querySelectorAll('button, select, a[href]')].map(accessibleName);
}

/** A session today, so the streak pill is showing a real number rather than a zero. */
function practiseOnce() {
  recordCompletedSession({
    title: 'Practice 1',
    sourceType: 'custom',
    wpm: 42,
    accuracy: 96,
    durationSeconds: 60,
    wordsCount: 40,
    keystrokes: 200,
  });
}

/**
 * The streak pill, found by what it shows rather than by anything identifying.
 *
 * Its only content is `{n}d`, so that text is how it is located before the fix and after
 * it: `aria-label` hides the content from the name but does not stop it rendering.
 */
function streakPill(host: HTMLElement): HTMLButtonElement {
  const pill = [...host.querySelectorAll('button')].find((button) =>
    /^\d+d$/.test(button.textContent?.trim() ?? ''),
  );
  if (!pill) throw new Error('no control showing a day count');
  return pill;
}

describe('every control in the header is named', () => {
  /**
   * The defect. The pill carried `title="Daily Practice Streak"` and a flame and `5d`,
   * which leaves the accessible name as `5d` — the tooltip never wins against content, so
   * the learner is told a number and nothing else, on every page of the app, from a
   * control whose entire purpose is to be understood at a glance. The Stats button beside
   * it had been fixed for the same reason and this one had not.
   */
  it('and none of them is named with a bare count', () => {
    practiseOnce();
    const counted = accessibleNames(renderNav('/')).filter((name) => /^\d+d?$/.test(name));

    expect(counted).toEqual([]);
  });

  /**
   * A name has to carry the count as well as the thing. Labelling it "Daily practice
   * streak" and dropping the number would name the control and leave a screen reader user
   * unable to tell one day from nine — the number is the reason the pill is in the header
   * at all. Read back off the rendered `Nd`, so the label and the display cannot disagree
   * about what is being counted.
   */
  it('and the streak pill names what it is counting', () => {
    practiseOnce();
    const pill = streakPill(renderNav('/'));
    const days = Number(pill.textContent!.trim().slice(0, -1));
    const name = accessibleName(pill);

    expect(name).toContain('streak');
    expect(name).toContain(`${days} day${days === 1 ? '' : 's'}`);
  });

  /**
   * The control, and the reason the two above are not satisfied by a filter that matches
   * nothing: it has to claim a control whose name really is a bare count, and spare one
   * that is not. The second is what a fix looks like.
   */
  it('tells a counted control apart from a described one', () => {
    expect(/^\d+d?$/.test('3d')).toBe(true);
    expect(/^\d+d?$/.test('Daily practice streak: 3 days')).toBe(false);
  });
});

/**
 * That a backup has stopped, said on a page the learner is already on.
 *
 * `pushProgress` is fire-and-forget by design — a dead network must not interrupt a typing
 * session — so it returns nothing and reports nothing, and `StatsModal` was the only thing
 * in the app that said so. That put the one signal that weeks of practice were not reaching
 * the server inside a panel behind a button that is icon-only under 640px. A learner who
 * never thought to open it found out by switching devices with nothing to restore, which is
 * the exact moment the warning would have been worth having.
 *
 * Driven through the real `pushProgress` against a stubbed `fetch` rather than by exporting
 * a way to set the verdict, because `setPushFailed` is module-private and an export added
 * for tests is an export nothing else is allowed to rely on.
 */
describe('the header says when the backup has stopped', () => {
  /** A device id the schema accepts, so `adoptBackupCode` actually writes rather than refuses. */
  const CODE = 'test-device-1';

  beforeEach(() => {
    /* Both halves off, which is the state the rest of this file is already in.
     *
     * `pushFailed` is module state, and the only path that clears it is `writeDeviceId` —
     * which clears it *by writing a code*. So write one and take it away again; clearing
     * localStorage alone would leave a previous test's verdict standing. */
    adoptBackupCode(CODE);
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  /** The Stats button, found by what it is for rather than by where it sits in the header. */
  function statsButton(host: HTMLElement): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="View your learning progress"]',
    );
    if (!button) throw new Error('no control named for learning progress');
    return button;
  }

  /** Whether that button is marked. */
  function marked(host: HTMLElement): boolean {
    return statsButton(host).querySelector('[data-testid="backup-stopped"]') !== null;
  }

  /**
   * One push, settled rather than still in flight, at whatever status the stub is serving.
   * `act` because the verdict lands through a store subscription the header is subscribed to,
   * and a header that has not re-rendered is the one thing this file must not assert on.
   */
  async function pushSettling(status: number) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    await act(async () => {
      pushProgress(loadUserStats());
      await Promise.resolve();
    });
  }

  /**
   * Two uploads on the wire at once, neither settled, and a way to settle them in any order.
   *
   * A push is issued per local write and never awaited, so overlapping them is ordinary —
   * finishing a passage writes, and so does the reset button behind the panel. The pair
   * comes back as a settle function taking which one and with what status, because the
   * order they settle in is the entire subject of the two tests below.
   */
  async function pushPair(): Promise<(which: 0 | 1, status: number) => Promise<void>> {
    const answers: ((response: Response) => void)[] = [];
    const held = [0, 1].map(
      () => new Promise<Response>((resolve) => answers.push(resolve)),
    );
    let next = 0;
    vi.stubGlobal('fetch', vi.fn(() => held[next++]));

    await act(async () => {
      pushProgress(loadUserStats());
      pushProgress(loadUserStats());
      await Promise.resolve();
    });

    return async (which, status) => {
      await act(async () => {
        answers[which](new Response('{}', { status }));
        await Promise.resolve();
      });
    };
  }

  /** Backup on, so `pushProgress` gets past its `readDeviceId` guard and actually pushes. */
  async function backupOn(): Promise<void> {
    await act(async () => {
      enableBackup();
      await Promise.resolve();
    });
  }

  it('and marks nothing while the backup is off', async () => {
    const host = renderNav('/');
    await pushSettling(500);

    expect(marked(host)).toBe(false);
  });

  /**
   * The control for the two below, and the reason they are worth having: `pushProgress`
   * returns early without a device id, so "no mark" is what a harness that never pushed at
   * all also produces. This is the same construction with the backup on, and it does mark.
   */
  it('and marks it once backup is on and the server refuses an upload', async () => {
    const host = renderNav('/');
    await act(async () => {
      enableBackup();
      await Promise.resolve();
    });
    await pushSettling(500);

    expect(marked(host)).toBe(true);
  });

  it('and says so in the name, which is the half the dot is not', async () => {
    const host = renderNav('/');
    await act(async () => {
      enableBackup();
      await Promise.resolve();
    });
    await pushSettling(500);

    const name = accessibleName(statsButton(host));
    expect(name).toContain('backup');
    expect(name).toContain('did not reach the server');
  });

  it('and leaves it unmarked when the same upload succeeded', async () => {
    const host = renderNav('/');
    await act(async () => {
      enableBackup();
      await Promise.resolve();
    });
    await pushSettling(200);

    expect(marked(host)).toBe(false);
  });

  /**
   * A newer upload refused, then an older one that lands late and succeeds.
   *
   * The header's own contract, at `lib/progress-client.ts`: "Only the last push counts. One
   * dropped request on a train is not a broken backup… the next successful push clears it."
   * The code did not do that. It recorded whatever answered last, so this order — a slow
   * success overtaking a newer failure — cleared the warning and told the learner their
   * backup was whole, while the write holding their newest sessions had been refused and the
   * server's copy was the one from before it.
   *
   * `pushFailed` starts false, so the first settle here is what turns it on; the second is
   * what used to turn it back off.
   */
  it('and keeps it marked when an older upload succeeds after a newer one was refused', async () => {
    const host = renderNav('/');
    await backupOn();
    const settle = await pushPair();

    await settle(1, 500);
    expect(marked(host)).toBe(true);

    await settle(0, 200);
    expect(marked(host)).toBe(true);
  });

  /**
   * The control for the test above, and the reason that one means anything: "always marked
   * once anything has failed" would pass it.
   *
   * The same two uploads with the older one refused, which is the case that says what a
   * superseded push is worth: nothing. It is dropped, and the header stays unmarked even
   * while the newest is still in flight — because a push is a whole-record overwrite carrying
   * the latest stats, so the newest upload describes the server whatever the older one did.
   * Marking on the older failure would report a backup that the newer one had already made
   * whole.
   *
   * This is the half that had to be rewritten. It first asserted that the older refusal lit
   * the warning and the newer success cleared it, which is the behaviour before the fix and
   * not a coherent rule — it made the verdict depend on which of two pushes happened to
   * answer first, while the ordering being tested is meant to stop exactly that.
   */
  it('and ignores a superseded upload even when it is the one that was refused', async () => {
    const host = renderNav('/');
    await backupOn();
    const settle = await pushPair();

    await settle(0, 500);
    expect(marked(host)).toBe(false);

    await settle(1, 200);
    expect(marked(host)).toBe(false);
  });

  /**
   * A push issued while there was a code, settled after the code was taken away.
   *
   * `StatsModal` gates on the code for exactly this reason: a push already on the wire
   * settles after `disableBackup` has cleared it, and its verdict then describes an upload to
   * a backup that no longer exists. A header without the gate would greet a learner who had
   * deliberately turned backup off with a warning about a backup they had just cancelled.
   *
   * The order is the whole test, and getting it wrong makes the case vacuous — which is what
   * the first attempt did. Clearing the code first means `pushProgress` returns early at its
   * `readDeviceId` guard, no verdict is ever set, and the assertion below passes whether or
   * not the header gates on anything. Removing the gate from `Navbar` left this green.
   *
   * `localStorage.clear()` rather than `disableBackup()` because the latter clears the
   * verdict itself and issues a DELETE; the state under test is the one where the code is
   * gone and the verdict arrives afterwards, and reaching it through the real function would
   * mean stubbing two requests to say the same thing.
   */
  it('and stops saying it once backup is off, whatever the last upload did', async () => {
    const host = renderNav('/');
    await act(async () => {
      enableBackup();
      await Promise.resolve();
    });

    // Issued while the code still exists, then held open so the code can go first.
    let answer!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(() => held));
    await act(async () => {
      pushProgress(loadUserStats());
      await Promise.resolve();
    });

    localStorage.clear();
    await act(async () => {
      answer(new Response('{}', { status: 500 }));
      await Promise.resolve();
    });

    expect(marked(host)).toBe(false);
  });
});