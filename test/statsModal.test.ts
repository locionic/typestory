import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import StatsModal from '../components/stats/StatsModal';
import {
  clearUserStats,
  getTodayDateString,
  loadUserStats,
  recordCompletedSession,
  saveUserStats,
} from '../lib/stats';
import {
  disableBackup,
  enableBackup,
  getBackupCode,
  pushProgress,
} from '../lib/progress-client';
import { MAX_SESSIONS } from '../lib/progress-schema';

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { unmount: () => void }[] = [];

beforeEach(() => clearUserStats());

afterEach(() => {
  closeAll();
  clearUserStats();
  // A stubbed `fetch` or `confirm` left behind would decide the outcome of the next test
  // rather than its own. The block below is the first to stub `fetch` for the restore path,
  // where the two are read for different URLs by the same stub.
  vi.unstubAllGlobals();
});

function renderModal(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(StatsModal, { isOpen: true, onClose: () => {} })));
  return host;
}

function closeAll() {
  for (const root of roots.splice(0)) act(() => root.unmount());
}

/**
 * One of the headline cards, found by its own title.
 *
 * The heading span sits inside a flex row, which sits inside the card, so the card is two
 * levels up. Walking rather than searching the panel's text is the only way to ask this
 * question of one card: "WPM" appears in the speed card's figure and nowhere else, but
 * "100" appears in the *Pure Precision* badge, "Best: N days" reads as prose in three
 * places, and a text search cannot tell a claim about the learner from a goal being
 * offered to them.
 */
function cardTitled(host: HTMLElement, title: string): Element | undefined {
  const heading = [...host.querySelectorAll('span')].find((el) => el.textContent === title);
  return heading?.parentElement?.parentElement ?? undefined;
}

/** The panel's own idiom for finding a control by what it says. */
function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`the panel offered no "${label}" button`);
  return found;
}

/** `n` finished sessions, oldest first — so the last one recorded is `Practice n`. */
function practiceSessions(n: number, accuracy = 95) {
  for (let i = 1; i <= n; i += 1) {
    recordCompletedSession({
      title: `Practice ${i}`,
      sourceType: 'custom',
      wpm: 40 + i,
      accuracy,
      durationSeconds: 30,
      wordsCount: 5,
      keystrokes: 200,
    });
  }
}

/**
 * What a screen reader can call each control in the modal.
 *
 * The close button is the one that matters, and it was the one missing. Every other
 * control in this panel is found by its text — which is exactly why an icon-only button
 * slipped past both suites that render it. And it is the only exit: the backdrop carries
 * no `onClick` and no key handler closes the modal, so it was reached as an unnamed
 * "button" standing between a screen reader user and the way out.
 *
 * Every button rather than that one alone, so one added later without a name fails here
 * rather than shipping.
 */
describe('every control in the modal is named', () => {
  const accessibleName = (el: Element) =>
    el.getAttribute('aria-label')?.trim() || el.textContent?.trim() || '';

  it('names every button it renders', () => {
    const buttons = [...renderModal().querySelectorAll('button')];

    // The precondition: finding no buttons would make the check below vacuously true.
    expect(buttons.length).toBeGreaterThan(0);

    const unnamed = buttons.filter((b) => accessibleName(b) === '');
    expect(unnamed.map((b) => b.outerHTML.slice(0, 100))).toEqual([]);
  });

  it('can be dismissed without seeing it', () => {
    // The first button in the panel is the close button — everything above it in the
    // header is an icon and a heading. Read by position rather than by the label it now
    // carries, so looking the button up by `aria-label` cannot be what makes this pass.
    const first = renderModal().querySelector('button');
    expect(first?.getAttribute('aria-label')).toBe('Close statistics');
  });
});

/**
 * Being a dialog, rather than a div that looks like one.
 *
 * Three keyboard failures stacked here, and each one alone leaves the other two standing.
 * The panel was never announced, so nothing said a dialog had opened; focus stayed on the
 * trigger behind the backdrop, so Tab walked content the learner cannot see; and with no
 * Escape handler the only exit was the close button. A keyboard user could open this panel
 * and have nothing tell them what had happened.
 *
 * Focus lands on the panel rather than on the close button, which is the standard
 * ordering — the dialog's name is announced, rather than one control's.
 */
describe('the modal behaves like a dialog', () => {
  it('announces itself as one, named by its own heading', () => {
    const dialog = renderModal().querySelector('[role="dialog"]');

    // Preconditions: an element that is not there, and a name it cannot resolve, both
    // read the same as a dialog that works.
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');

    const namedBy = dialog?.getAttribute('aria-labelledby');
    expect(namedBy).toBeTruthy();
    // Resolved through the id rather than string-matched, so a renamed heading that
    // leaves the reference dangling fails here instead of announcing nothing.
    expect(dialog?.ownerDocument.getElementById(namedBy!)?.textContent).toBe(
      'Typing & Learning Analytics',
    );
  });

  it('moves focus into itself when it opens', () => {
    const dialog = renderModal().querySelector<HTMLElement>('[role="dialog"]');

    expect(dialog).toBe(document.activeElement);
    // Without tabIndex the ref resolves and .focus() is a no-op, which looks identical
    // to this working — so the attribute is asserted, not just the focus.
    expect(dialog?.getAttribute('tabindex')).toBe('-1');
  });

  it('closes on Escape, and only while it is open', () => {
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(createElement(StatsModal, { isOpen: true, onClose })));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // The control itself is proved by the count above; this is the other half — a
    // listener left attached after the panel closes would fire `onClose` for a dialog
    // that is no longer on screen.
    closeAll();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * What the modal shows the second time it is opened.
 *
 * `useUserStats` reads through `getStatsSnapshot`, which serves a module-level
 * `memoryCache` after its first call — and only three places ever write that cache: the
 * first snapshot itself, `clearUserStats`, and the live-subscriber handler. `saveUserStats`
 * was not one of them, and it is the function every write in the app goes through: it
 * stores the bytes and fires `STATS_CHANGE_EVENT`, and the cache only caught up when
 * something was mounted to hear it.
 *
 * `StatsModal` is the only consumer, and it is mounted only while open. So the real
 * sequence is: open the stats modal, read five sessions, close it, go and finish a
 * passage — `recordCompletedSession` → `saveUserStats`, event fired at a window with no
 * listener — then open the modal again and be shown the five from last time. The learner's
 * streak, volume, peak speed and badges all frozen at whatever they were the first time
 * they ever opened the panel, and nothing on screen said the numbers were old.
 *
 * The numbers that do update are the ones stored elsewhere: `sessions` written by
 * `recordCompletedSession` before `saveUserStats` is called. So the defect is specific to
 * anything read through the cache.
 */
describe('reopening the stats panel', () => {
  it('shows the sessions finished while it was closed', () => {
    practiceSessions(5);
    expect(renderModal().textContent).toContain('Recent Sessions (5)');

    closeAll();
    practiceSessions(2);

    expect(renderModal().textContent).toContain('Recent Sessions (7)');
  });
});

/**
 * The practice log, and what its heading promises.
 *
 * The heading counts `stats.sessions.length` — every session stored, up to `MAX_SESSIONS`
 * (100) — while the list under it rendered `slice(0, 15)`. Past the sixteenth session the
 * two disagreed with no hint of it: no "and 5 more", nothing to scroll further, and
 * nothing else in the app that lists history. So a learner with twenty sessions was told
 * twenty and shown fifteen, and the other five were gone from the interface.
 *
 * The list was already a scrolling box, so the slice bought nothing: it did not keep the
 * modal from growing, it only made rows unreachable.
 */
describe('the practice log', () => {
  it('reaches every session the heading counts', () => {
    practiceSessions(20);
    const shown = renderModal().textContent ?? '';

    // Newest first, so `Practice 1` is the last row — the one a fifteen-row slice hides.
    expect(shown).toContain('Practice 1');
    expect(shown).toContain('Practice 20');
    // And the heading still says what it always said, so the two are about the same set.
    expect(shown).toContain('Recent Sessions (20)');
  });

  /**
   * The control: a learner with fewer sessions than the old slice got the same rows
   * before and after, so a change that quietly emptied the list would fail here rather
   * than hide inside the first test's passes.
   */
  it('still lists a short history in full', () => {
    practiceSessions(3);
    const shown = renderModal().textContent ?? '';

    for (const title of ['Practice 1', 'Practice 2', 'Practice 3']) {
      expect(shown).toContain(title);
    }
    expect(shown).toContain('Recent Sessions (3)');
  });
});

/**
 * The four headline cards, and what each one claims before anything has been typed.
 *
 * Three of them are honest by construction: `DEFAULT_STATS` puts `currentStreak`,
 * `bestStreak`, `bestWpm`, `averageWpm`, `totalWordsTyped` and `totalTimeSpentSeconds`
 * at zero, and zero is what "you have not done this yet" looks like. Accuracy was the
 * odd one out — its default is **100**, so the panel opened on a learner who had never
 * finished a passage reading `100%` under a `Target` icon, directly beside `0` WPM and
 * `0` words. Not a neutral starting value: a hundred per cent is the best number the
 * card can ever show, and the first thing the app states about a new learner is that
 * they are already perfect at it.
   *
   * The sentinel cannot simply be lowered to 0, because that is the other false claim:
   * it would read as a run in which every key was wrong. And it cannot be left as a real
   * number at all, because the field genuinely has no value until a session exists —
   * `recordCompletedSession` is what gives it one, as `Math.round(sum / sessions.length)`
   * over a list it knows is non-empty.
   *
   * The sentinel stays in `DEFAULT_STATS` because it is a stored field with a schema
   * bound (`isPercent`) and a value pushed to the sync API, and 100 is the right thing
   * to store for a profile with no sessions. What has to stop is the interface claiming
   * it as a measurement. Hence the dash, which is the same thing the other three cards
   * already say by rendering a number that means nothing yet.
   */
describe('the headline cards before anything has been typed', () => {
  /**
   * The accuracy card's headline figure on its own.
   *
   * Found by walking up from the card's own heading rather than by searching the panel's
   * text. `100%` also appears in the *Pure Precision* badge — "Complete a session with
   * 100% accuracy" — which is a goal the app is offering, not a claim about the learner,
   * and is correct to render either way. A text search cannot tell the two apart.
   */
  function accuracyCard(host: HTMLElement): Element | undefined {
    const heading = [...host.querySelectorAll('span')].find((el) => el.textContent === 'Accuracy');
    return heading?.parentElement?.parentElement ?? undefined;
  }

  function accuracyFigure(host: HTMLElement): string {
    return accuracyCard(host)?.querySelector('.text-2xl')?.textContent ?? '';
  }

  it('does not report a perfect accuracy score for a profile with no sessions', () => {
    expect(accuracyFigure(renderModal())).not.toBe('100%');
  });

  /**
   * The control, and the reason the test above is not simply "the number is gone": a
   * change that blanked the card for everyone would satisfy it too. A real average still
   * renders, so the guard is the zero-session case and not the number's disappearance.
   */
  it('still reports the real average once a session has been recorded', () => {
    practiceSessions(1);
    expect(accuracyFigure(renderModal())).toBe('95%');
  });

  /**
   * The window the average was taken over, which is every session stored up to the cap.
   *
   * The label read "Last 100 sessions" — a literal, and true of nobody below a hundred.
   * A learner with three runs was told the figure beside it was averaged over a hundred,
   * which is the one thing it very much was not. Unlike the number it describes it also
   * has a correct value at every size, so the fix is to read the count instead of
   * restating the cap.
   */
  it('names the sessions it actually averaged', () => {
    practiceSessions(3);
    expect(accuracyCard(renderModal())?.textContent).toContain('Last 3 sessions');
  });

  /** The cap is `MAX_SESSIONS`, so that is what a learner at the cap is told. */
  it('names the cap once the history is full', () => {
    practiceSessions(100);
    const card = accuracyCard(renderModal());

    expect(card?.textContent).toContain('Last 100 sessions');
    // The cap is 100, so 100 and the cap are the same number here — this is the case
    // that was already right, pinned so the derived label cannot quietly grow a bound
    // the truncation does not have.
    expect(card?.textContent).not.toContain('Last 101 sessions');
  });
});

/**
 * Two averages on one screen, and only one of them says what it averaged.
 *
 * The accuracy card names its window because the literal 100 it used to carry was true of
 * nobody below a hundred, and the block above pins that at three sessions and at the cap.
 * The speed card averages the *identical* list — `averageWpm` is written at
 * `lib/stats.ts:444` as `Math.round(totalWpmSum / updatedSessions.length)`, and
 * `updatedSessions` is the same newest-first, `MAX_SESSIONS`-trimmed array the accuracy
 * figure comes from. One window, two cards, and until this turn one sentence naming it.
 *
 * What the learner was left reading is a bare `Avg: 42 WPM` directly beneath a lifetime
 * `Peak Speed`. Every other all-time figure in this panel either says so — `Best: N days`
 * — or is unmistakably unbounded, and "Avg" is the word that most invites the opposite
 * reading. Three sessions and a hundred sessions render those same three characters, and
 * the number underneath them means something different each time: the first is a sample
 * of everything the learner has ever done, the second is a rolling recent figure, and
 * nothing on the card distinguishes them.
 */
describe('the speed card beside the accuracy card', () => {
  /** The window a card names, read back off the card rather than matched in panel prose. */
  function namedWindow(card: Element | undefined): string {
    return card?.textContent?.match(/Last (\d+) sessions?/)?.[1] ?? '';
  }

  it('names the sessions its average was taken over', () => {
    practiceSessions(3);
    expect(namedWindow(cardTitled(renderModal(), 'Peak Speed'))).toBe('3');
  });

  /**
   * The control, and the reason the test above is not "the sub-label is gone": a change
   * that deleted `Avg:` outright would satisfy that too. Both figures the window
   * describes are still on the card, and they are the two numbers that cannot be equal —
   * 41, 42 and 43 went in, so the peak is 43 and the average of all three is 42. Reading
   * them out of the card's own figure line also keeps this from passing on the peak
   * alone, which the average could coincidentally match.
   */
  it('still reports the speed that the window is describing', () => {
    practiceSessions(3);
    const card = cardTitled(renderModal(), 'Peak Speed');

    expect(card?.querySelector('.text-2xl')?.textContent).toBe('43 WPM');
    expect(card?.textContent).toContain('Avg: 42 WPM');
  });
});

/**
 * A milestone the app cannot take back.
 *
 * Four of the five badges read a lifetime field — `bestWpm`, `dailyStreak.bestStreak`,
 * `totalWordsTyped` — because each is a thing the learner did once. Pure Precision was
 * the fifth and read `sessions.some(...)` instead, over a list capped at MAX_SESSIONS and
 * sliced on both read and write. Type a passage perfectly, record 100 more sessions, and
 * the app withdrew a badge it had granted, with no way to earn it back and nothing the
 * learner did to deserve it.
 */
describe('the Pure Precision badge', () => {
  /**
   * Whether the badge is shown as earned.
   *
   * An unlocked badge renders a `CheckCircle2` beside its title; a locked one renders
   * nothing there. Found by walking up from the badge's own title rather than by
   * searching the panel's text, because "100% accuracy" also appears in the badge's own
   * description — which is a goal being offered, true or false, and cannot be an oracle.
   */
  function precisionEarned(host: HTMLElement): boolean {
    const title = [...host.querySelectorAll('span')].find((el) => el.textContent === 'Pure Precision');
    return Boolean(title?.parentElement?.querySelector('svg'));
  }

  it('is earned by a perfect session', () => {
    practiceSessions(1, 100);
    expect(precisionEarned(renderModal())).toBe(true);
  });

  /**
   * The control. Without it, a badge that was never earned at all would satisfy the test
   * below just as well as one that survives.
   */
  it('is not earned without one', () => {
    practiceSessions(3, 95);
    expect(precisionEarned(renderModal())).toBe(false);
  });

  /**
   * The defect itself.
   *
   * MAX_SESSIONS + 2, not MAX_SESSIONS: at exactly the cap the perfect run is still the
   * 101st entry and has not been sliced off yet, so the badge would pass against the old
   * code and the test would prove nothing. Two more is the smallest number that actually
   * pushes it out of the stored list.
   */
  it('survives the perfect run leaving the session window', () => {
    practiceSessions(1, 100);
    practiceSessions(MAX_SESSIONS + 2, 80);

    expect(precisionEarned(renderModal())).toBe(true);
  });
});

/**
 * Text an `opacity-` on one of its ancestors takes away.
 *
 * The locked achievement badges carried `opacity-50` on the card, which halves every colour
 * inside it rather than only the background the class was chosen for. Measured against
 * the palette Tailwind actually ships, the milestone *name* came out at 1.31:1 in light
 * mode and 4.33:1 in dark, and its description at 1.25:1 and 2.07:1 — where SC 1.4.3 asks
 * 4.5:1 for text this small. The same two colours without the opacity read 17.45:1 and
 * 4.75:1. So the badge meant to tell a learner what to aim for was, in effect, blank.
 *
 * `opacity-` on a text-bearing ancestor is the whole rule, and it generalises past this
 * one card: a sweep of `app` and `components` finds exactly one such element, the other
 * two hits being a `hover:opacity-90` (a 10% dip that still leaves 6.6:1) and the comment
 * in `StoryReader.tsx` recording that the same mistake was already removed from there.
 *
 * Hover, focus and dark variants are excluded rather than matched: they change state
 * instead of resting dimmed, and a rule that flagged them would be flagging the design.
 */
function dimmedText(root: HTMLElement): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (!text) continue;
    for (let el = node.parentElement; el; el = el.parentElement) {
      const match = (el.getAttribute('class') ?? '').match(/(?:^|\s)opacity-(\d+)(?:\s|$)/);
      if (match) {
        found.push(`"${text}" under opacity-${match[1]}`);
        break;
      }
    }
  }
  return found;
}

describe('the locked achievement badges', () => {
  /**
   * With no sessions recorded every badge is locked, which is the state a learner's first
   * visit lands on and the one where the dimming costs the most — it is what the whole
   * panel is for, and it is the moment they are deciding what to practise.
   */
  it('name what they are asking for', () => {
    expect(dimmedText(renderModal())).toEqual([]);
  });

  /**
   * The control, and the reason the assertion above is not satisfied by a walker that
   * finds nothing. Both halves are real text arriving the way an offence would: one that
   * must be reported, one that must not.
   */
  it('reports text a dimming ancestor would take away', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="opacity-50"><span>Dimmed heading</span></div>' +
      '<div class="transition hover:opacity-90"><span>Hover only</span></div>';
    document.body.appendChild(host);

    expect(dimmedText(host)).toEqual(['"Dimmed heading" under opacity-50']);
  });
});
/**
 * The panel's warning, found by what it says rather than by a class.
 *
 * Read live off the mounted tree: `pushProgress` settles on a microtask long after the
 * modal has rendered, so the assertion that matters is that the panel changes under the
 * learner, not that it would render correctly if it were mounted afterwards.
 */
function backupStoppedNotice(host: HTMLElement): string | null {
  return (
    [...host.querySelectorAll('p[role="status"]')]
      .map((p) => p.textContent ?? '')
      .find((text) => text.includes('did not reach the server')) ?? null
  );
}

describe('a backup that stopped', () => {
  beforeEach(() => {
    localStorage.clear();
    if (!enableBackup()) throw new Error('no backup code was issued');
  });

  /**
   * The failure the panel could not report at all.
   *
   * `pushProgress` swallowed every outcome, and a 400 is a *resolved* fetch, so even the
   * `.catch` that handled an outage never saw it. A push is a whole-record overwrite — one
   * field the server refuses takes the entire backup down — so this is the learner typing
   * their way through a working-looking app with no backup at all, told nothing, and finding
   * out days later on another machine with nothing to restore.
   *
   * Asserted on the live tree because "nothing on any screen is ever told" is the defect:
   * a warning that only appeared after a re-mount would still leave the learner looking at
   * a panel that says nothing while the backup is dead.
   */
  it('is said out loud, and unsaid once a push lands', async () => {
    const host = renderModal();
    expect(backupStoppedNotice(host)).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    await act(async () => {
      pushProgress(loadUserStats());
    });
    expect(backupStoppedNotice(host)).toContain('safe in this browser');
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await act(async () => {
      pushProgress(loadUserStats());
    });
    vi.unstubAllGlobals();

    // One dropped request on a train is not a broken backup. A notice that latched would be
    // its own kind of lie, and would train the learner to ignore the one that mattered.
    expect(backupStoppedNotice(host)).toBeNull();
  });

  /**
   * The control for the gate, and the case that makes it necessary.
   *
   * A push that was already on the wire settles after `disableBackup` has cleared the code
   * it was sent under. Its verdict describes a backup that no longer exists, and the code is
   * the only thing that makes it meaningful — without the gate the panel tells a learner who
   * has just turned backup off that their backup is broken.
   */
  it('says nothing about a backup that has been turned off', async () => {
    const host = renderModal();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    await act(async () => {
      pushProgress(loadUserStats());
    });
    expect(backupStoppedNotice(host)).not.toBeNull();

    await act(async () => {
      await disableBackup();
    });
    vi.unstubAllGlobals();

    expect(getBackupCode()).toBeNull();
    expect(backupStoppedNotice(host)).toBeNull();
  });
});

/**
 * The question the restore confirmation asks, and the one case where it answers wrongly.
 *
 * Restoring replaces everything on this device. `saveUserStats(found.stats, false)` is
 * called with `upload = false` — deliberately, because `pushProgress` reads the code live
 * and the pre-restore history has to survive on the server under *this device's own* code
 * rather than be overwritten by the record that was just restored. That reasoning is sound,
 * and the confirmation says so: with a code set, it tells the learner that what is here
 * now "stays recoverable under this device's own code".
 *
 * It is only recoverable there if it got there. `pushProgress` is fire-and-forget and a
 * refused push is invisible except through `useBackupPushFailed` — the flag this very panel
 * reads to render "the last upload did not reach the server… nothing has been lost", a few
 * hundred pixels above the button that opens this dialog.
 *
 * So on a device whose backup has stopped, the panel shows the learner a warning that
 * nothing has been lost and, in the dialog that destroys it, a promise that it is
 * recoverable. Both sentences are on screen at once. Agreeing with OK overwrites
 * localStorage with the backup and uploads nothing, by design — so the pre-restore history
 * is on neither side, and the warning above has just become false.
 *
 * The promise is true in the other two cases, which is what makes this one worth a branch
 * rather than a softer sentence: with no code the panel already says it cannot be
 * recovered, and with a code whose pushes land it is on the server.
 */
describe('restoring over a backup that never reached the server', () => {
  const OTHER_CODE = 'other-device-code';

  /** What the panel asked before it overwrote anything. */
  async function askToRestore(host: HTMLElement): Promise<string> {
    const input = host.querySelector('input[aria-label="Backup code to restore from"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, OTHER_CODE);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const asked: string[] = [];
    vi.stubGlobal('confirm', (message?: string) => {
      asked.push(String(message));
      // Declined: this asks what the panel *says*, not what it does next.
      return false;
    });
    // The stub answers the GET `fetchBackup` makes. `sessions: []` is enough for it to
    // accept the record, and makes it visibly not what is on this device.
    const remote = { ...loadUserStats(), sessions: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ record: { stats: remote } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    await act(async () => {
      button(host, 'Restore').click();
    });

    expect(asked).toHaveLength(1);
    return asked[0];
  }

  it('does not promise the device’s own copy can be recovered', async () => {
    localStorage.clear();
    // Recorded before the code exists, so the sessions do not push on their way in.
    practiceSessions(2);
    enableBackup();
    const host = renderModal();

    // The precondition, in the panel's own words: this device believes it is backed up and
    // the last upload is known not to have landed. Both have to be true before the dialog
    // has anything to get wrong.
    expect(getBackupCode()).not.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    await act(async () => {
      pushProgress(loadUserStats());
    });
    expect(backupStoppedNotice(host)).not.toBeNull();

    expect(await askToRestore(host)).not.toContain('stays recoverable');
  });

  /**
   * The control, and the case that tells the two are different states rather than one
   * softened sentence.
   *
   * With a code and every push landing, the pre-restore history really is on the server,
   * so the promise is exactly right and softening it would be the other lie: a warning
   * about something the reset spared, which is what the "Reset Stats" comment above calls
   * worse than the silence it replaced.
   */
  it('still promises recovery on a device whose backup is working', async () => {
    localStorage.clear();
    practiceSessions(2);
    enableBackup();
    const host = renderModal();

    // No failed push, so `pushFailed` is false — `enableBackup` has just cleared it.
    expect(backupStoppedNotice(host)).toBeNull();

    expect(await askToRestore(host)).toContain('stays recoverable');
  });

  /**
   * The other control: the branch for a device with no code at all, which already told the
   * truth and must keep doing so. A fix that made one warning out of the two would satisfy
   * the first test while replacing this sentence with one that promises a server copy that
   * does not exist.
   */
  it('still says a device with no code cannot recover, when there is no code', async () => {
    localStorage.clear();
    practiceSessions(2);
    expect(getBackupCode()).toBeNull();
    const host = renderModal();

    expect(await askToRestore(host)).toContain('cannot be recovered');
  });
});

/**
 * What "Reset Stats" tells the learner it is about to take.
 *
 * The reset is all-or-nothing because `clearUserStats` removes the whole stored record,
 * and that record holds three things, not two: the totals, the session history, and the
 * daily streak. The confirmation named the first two.
 *
 * The streak is the one that does not come back. A cleared history is rebuilt by one more
 * passage; a thirty-day streak is rebuilt by thirty days of showing up, and it is gone the
 * moment the learner presses the button — along with the "Consistency King" badge, which
 * reads `dailyStreak.bestStreak` and so locks again. Every other badge in this panel reads
 * a field the reset cannot make unreachable.
 *
 * Asserted as a pair on purpose. The copy naming the streak is only honest because the
 * second assertion holds — a warning about something the reset spared would be worse than
 * the silence it replaced.
 */
describe('"Reset Stats" names everything the reset takes', () => {
  it('names the streak, and the streak really goes', () => {
    const asked: string[] = [];
    vi.stubGlobal('confirm', (message?: string) => {
      asked.push(String(message));
      return true;
    });

    // A session, so the button renders at all — it is behind `sessions.length > 0` — and a
    // streak worth thirty days, so what is lost is worth a sentence.
    recordCompletedSession({
      title: 'Practice 1',
      sourceType: 'custom',
      wpm: 60,
      accuracy: 96,
      durationSeconds: 40,
      wordsCount: 12,
      keystrokes: 200,
    });
    saveUserStats({
      ...loadUserStats(),
      dailyStreak: { currentStreak: 9, bestStreak: 30, lastActiveDate: '2026-09-30' },
    });

    const host = renderModal();
    const reset = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Reset Stats'),
    );
    if (!reset) throw new Error('the panel offered no reset');

    // Before the click, so the assertion below is a change and not a coincidence: a seed
    // `saveUserStats` quietly dropped would leave it reading 0 either way.
    expect(loadUserStats().dailyStreak.bestStreak).toBe(30);

    act(() => reset.click());

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/streak/i);
    expect(loadUserStats().dailyStreak.bestStreak).toBe(0);

    vi.unstubAllGlobals();
  });
});

/**
 * Which stat field carries each badge's threshold.
 *
 * Deliberately no numbers. The figure is read out of the badge's own rendered description,
 * because the description and the condition are one claim written twice — six hand-written
 * pairs in StatsModal, and nothing held them together. The same reason `lib/routes.ts`
 * exists for the nav: a list nothing else checks is a list nothing else fails on when it
 * drifts, and this one drifts silently in the only direction that costs a learner the
 * badge they were told they had earned.
 */
const BADGE_FIELDS: Record<
  string,
  'sessions' | 'bestWpm' | 'bestAccuracy' | 'bestStreak' | 'totalWordsTyped'
> = {
  'First Flight': 'sessions',
  'Speed Sprinter': 'bestWpm',
  'Typing Virtuoso': 'bestWpm',
  'Pure Precision': 'bestAccuracy',
  'Consistency King': 'bestStreak',
  'Vocabulary Scholar': 'totalWordsTyped',
};

/** The block holding one badge's title, its tick and its description. */
function badgeBlock(host: HTMLElement, title: string): HTMLElement {
  const el = [...host.querySelectorAll('span')].find((s) => s.textContent === title);
  // Two levels, not one: the title's own parent is the row that also holds the tick, and the
  // description is a *sibling* of that row. `precisionEarned` above stops at one level
  // because it only ever looks for the tick; this one needs the text too.
  const block = el?.parentElement?.parentElement;
  if (!block) throw new Error(`the panel shows no badge titled "${title}"`);
  return block;
}

const badgeEarned = (host: HTMLElement, title: string): boolean =>
  Boolean(badgeBlock(host, title).querySelector('svg'));

/**
 * The figure a badge's own description prints, thousands separator removed.
 *
 * Safe to take the first number in the block: no badge title contains a digit, so the only
 * figure there is the one in the description.
 */
function statedFigure(host: HTMLElement, title: string): number {
  const found = badgeBlock(host, title).textContent?.match(/\d[\d,]*/);
  if (!found) {
    throw new Error(`"${title}" states no figure to check — found: ${badgeBlock(host, title).textContent}`);
  }
  return Number(found[0].replace(/,/g, ''));
}

describe('each badge unlocks at the figure its own description prints', () => {
  const TITLES = Object.keys(BADGE_FIELDS);

  it('holds every one of them until then', () => {
    const host = renderModal();
    expect(TITLES.filter((title) => badgeEarned(host, title))).toEqual([]);
  });

  /**
   * `bestWpm` carries two badges, so both of its badges are answered by whichever figure is
   * the larger — and that is the point rather than a wrinkle. "Achieve 50+ WPM" is a
   * promise about 50, and a learner who has hit 75 must hold the 50 badge too, so the two
   * descriptions have to be read together with the one field they share.
   */
  it('and releases every one of them at it', () => {
    const bare = renderModal();

    practiceSessions(1);
    saveUserStats({
      ...loadUserStats(),
      bestWpm: Math.max(
        statedFigure(bare, 'Speed Sprinter'),
        statedFigure(bare, 'Typing Virtuoso'),
      ),
      bestAccuracy: statedFigure(bare, 'Pure Precision'),
      totalWordsTyped: statedFigure(bare, 'Vocabulary Scholar'),
      dailyStreak: {
        currentStreak: 0,
        bestStreak: statedFigure(bare, 'Consistency King'),
        lastActiveDate: '2026-09-30',
      },
    });

    // "First Flight" states its threshold in words — "your first practice session" — so
    // there is no digit to read and `practiceSessions(1)` above is not a second copy of one.
    const host = renderModal();
    expect(TITLES.filter((title) => badgeEarned(host, title))).toEqual(TITLES);
  });

  /**
   * The other direction, which the two above cannot see.
   *
   * Both drive every field *up* to the figure the badge prints and check the tick appears. A
   * threshold sitting *below* that figure satisfies them just as well: set
   * `totalWordsTyped` to the 1,000 the badge prints and a predicate of `>= 500` still
   * renders the tick, so this describe stayed green over a Vocabulary Scholar handed out
   * after half the typing it asks for. Nothing above would have gone red, because the
   * figure it asserted was already past the threshold it was really there to catch.
   *
   * So the boundary is held from below as well, one under, which is the tightest question a
   * threshold can be asked when the copy renders it as inclusive. It matters more here than
   * it would elsewhere: `lib/types.ts:130` records that this app's badges are the one claim
   * that cannot be un-made. A badge granted early is not a number that drifts, it is
   * something the learner was told they had done.
   */
  it('and holds every one of them one below it', () => {
    const bare = renderModal();
    const oneUnder = (title: string) => statedFigure(bare, title) - 1;

    saveUserStats({
      ...loadUserStats(),
      // `Math.min` where the test above uses `Math.max`, and the inversion is the whole
      // point: one field answers both WPM badges, and driving it to the *larger* threshold
      // would earn the smaller one too — this would silently re-test "releases" and pass.
      bestWpm: Math.min(
        oneUnder('Speed Sprinter'),
        oneUnder('Typing Virtuoso'),
      ),
      bestAccuracy: oneUnder('Pure Precision'),
      totalWordsTyped: oneUnder('Vocabulary Scholar'),
      dailyStreak: {
        currentStreak: 0,
        bestStreak: oneUnder('Consistency King'),
        lastActiveDate: '2026-09-30',
      },
    });

    // No `practiceSessions`, which is First Flight's half of the claim and the one badge
    // with no figure to sit under.
    const host = renderModal();
    expect(TITLES.filter((title) => badgeEarned(host, title))).toEqual([]);
  });
});

/**
 * The opt-in, which is a button and not a side effect.
 *
 * `test/progressClient.test.ts` pins the rule at the layer that holds it: nothing is
 * uploaded while backup is off, and a code exists only once one has been minted. But every
 * backup test in *this* file begins with `enableBackup()` in its own `beforeEach`, so all
 * twenty-one of them start from a device that is already opted in. Nothing presses the
 * button. `startBackup` is the highest-stakes call site in the app — pressing it is the
 * consent — and it had no test at all: a panel whose button was wired to nothing would
 * leave this file entirely green.
 *
 * The failure branch matters as much as the happy one and is likelier. `enableBackup`
 * returns null when `localStorage.setItem` throws (`lib/progress-client.ts:97`), which is
 * what a private window or an exhausted quota does, and `startBackup` returns early on it —
 * before `pushProgress`, and before it says anything. Reordered, the learner is told their
 * backup is on and told to keep a code that was never issued.
 */
describe('pressing "Back up my progress"', () => {
  beforeEach(() => localStorage.clear());

  it('is the only thing that turns backup on', async () => {
    const host = renderModal();

    // The half the feature exists for: nothing shown, and nothing sent, until the learner
    // asks. `useBackupCode` is a pure read of the stored code, so this button is the whole
    // of the opt-in — which is why it is worth a test of its own rather than a client-layer
    // one that never renders anything.
    expect(host.querySelector('code')).toBeNull();
    expect(host.textContent).toContain('Back up my progress');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await act(async () => {
      button(host, 'Back up my progress').click();
    });

    // On screen, not merely somewhere in localStorage: this is what the learner writes
    // down, and the panel's own sentence calls it "the only way back in".
    const code = host.querySelector('code')?.textContent ?? '';
    expect(code).not.toBe('');
    expect(host.textContent).toContain('Keep this code');
    // The panel has moved on from asking, which is also what says the press registered.
    expect(host.textContent).not.toContain('Back up my progress');
    vi.unstubAllGlobals();
  });

  it('says the browser refused, rather than claiming a code it could not store', async () => {
    const host = renderModal();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      button(host, 'Back up my progress').click();
    });

    expect(host.textContent).toContain('will not let the app store a backup code');
    // Not the success sentence, and no code: nothing was stored, so there is nothing to
    // keep and no way back in. `startBackup` returns before saying anything.
    expect(host.textContent).not.toContain('Keep this code');
    expect(host.querySelector('code')).toBeNull();
    // And nothing left the device — the early return is before `pushProgress`, and this is
    // the assertion that would catch it being moved.
    expect(fetchMock).not.toHaveBeenCalled();

    setItem.mockRestore();
    vi.unstubAllGlobals();
  });
});

/**
 * The mirror of the describe above, and the panel's one irreversible control.
 *
 * `disableBackup` is the app's only deletion — `test/backupRoundTrip.test.ts` says so and
 * puts both ends of its query string in one test — but everything that pinned it pinned
 * the *client*: `test/progressClient.test.ts` resolves it true and false across five
 * branches, and `test/backupRoundTrip.test.ts` sends a real DELETE at a real route. Not
 * one of those renders a button, so the panel could have stopped reading the answer and
 * every one of them would stay green.
 *
 * That is not hypothetical here. `StatsModal.tsx:66` records the version that did:
 * `disableBackup` returned nothing and swallowed every failure, so this sentence claimed
 * "the stored copy was deleted" over a request that had not been sent. What makes it worth
 * a second test rather than trusting the comment is the shape of the harm — the learner
 * is told their practice history is gone from a server that still has it, reachable by
 * anyone holding the code the panel had just shown them.
 */
describe('pressing "Stop and delete"', () => {
  beforeEach(() => localStorage.clear());

  /** A panel with backup already on, which is the only state this button appears in. */
  function backupOn(): { host: HTMLElement; code: string } {
    enableBackup();
    const host = renderModal();
    const code = host.querySelector('code')?.textContent ?? '';
    if (!code) throw new Error('the panel offered no backup code, so there is nothing to delete');
    return { host, code };
  }

  it('asks first, and a refusal changes nothing', async () => {
    const { host, code } = backupOn();

    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await act(async () => {
      button(host, 'Stop and delete').click();
    });

    // Nothing went out — the one request in the app that removes data, gated on a dialog.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector('code')?.textContent).toBe(code);
    // And it said nothing about backup being off, which it is not.
    expect(host.textContent).not.toContain('Backup is off');
    vi.unstubAllGlobals();
  });

  /**
   * The claim under test, and the one the client-layer tests cannot make.
   *
   * `deleteRemote` counts a 500 as failure and a 404 as success (`lib/progress-client.ts:151`),
   * so a 500 is the honest way to hand this panel a refused delete. Backup still goes off —
   * `disableBackup` cleared the code before it asked — and the panel is right to say so; the
   * wrong sentence is the one about the copy.
   */
  it('warns that the copy may remain when the delete is refused', async () => {
    const { host } = backupOn();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));

    await act(async () => {
      button(host, 'Stop and delete').click();
    });

    expect(host.textContent).toContain('Backup is off');
    expect(host.textContent).toContain('could not be deleted');
    // The success half, word for word. Nothing short of this would catch a panel that had
    // swapped the two sentences.
    expect(host.textContent).not.toContain('the stored copy was deleted');
    vi.unstubAllGlobals();
  });

  /**
   * The control for the exclusion above.
   *
   * `not.toContain` passes on a string this panel never prints, which would make the test
   * above pass for a panel that said nothing at all. This pins that the forbidden sentence
   * is reachable — and that reaching it takes the code away, which is what makes it the
   * sentence worth protecting.
   */
  it('says the stored copy was deleted when it was', async () => {
    const { host } = backupOn();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    await act(async () => {
      button(host, 'Stop and delete').click();
    });

    expect(host.textContent).toContain('the stored copy was deleted');
    expect(host.querySelector('code')).toBeNull();
    vi.unstubAllGlobals();
  });
});

/**
 * The duration on the words card, and what it says before there is a minute of it.
 *
 * `totalMinutes` is `Math.round(totalTimeSpentSeconds / 60)` printed under a "~" that does
 * real work from a minute upwards — 12.5 minutes legitimately reads "~13 min". It cannot do
 * any work at zero: a first run of twenty seconds reads `~0 min`, on the same line as a word
 * count saying 45, on the card a learner opens having just finished their first session.
 * That is the moment the panel has the most to say and its reader the least reason to
 * distrust it, and zero minutes is not an approximation of twenty seconds — there is no
 * value of it to be approximately.
 *
 * Asserted on the card's own line rather than on the number, because the claim is about the
 * sentence the two figures are read in together.
 */
describe('the duration on the words card', () => {
  /** The line under the word count, which is where the duration is printed. */
  const timeLine = (host: HTMLElement) =>
    [...host.querySelectorAll('div')].find((el) =>
      el.textContent?.startsWith('words (~'),
    )?.textContent ?? '';

  it('is not zero minutes for a first run that has not reached one', () => {
    saveUserStats({ ...loadUserStats(), totalWordsTyped: 45, totalTimeSpentSeconds: 20 });
    const host = renderModal();

    // The precondition, and the contradiction this is about: the card has words to show.
    expect(host.textContent).toContain('45');
    expect(timeLine(host)).not.toContain('0 min');
  });

  /**
   * The control. Rounding is what makes "~13 min" a fair description of 12.5, and a fix
   * that dropped the minutes altogether would satisfy the test above by printing nothing
   * usable — so the minute scale has to keep reading in minutes.
   */
  it('still reads in minutes once there is more than a minute of it', () => {
    saveUserStats({ ...loadUserStats(), totalWordsTyped: 800, totalTimeSpentSeconds: 750 });

    expect(timeLine(renderModal())).toContain('~13 min');
  });
});

/**
 * One is the number that breaks every sentence beside it.
 *
 * Four places in this panel put a hardcoded plural after a count, and the app already has
 * the rule written down correctly elsewhere — `components/Navbar.tsx:113` reads
 * `day${streak === 1 ? '' : 's'}` in its own aria-label. So the same fact about the same
 * learner was rendered two ways in two files, and the panel's was the wrong one.
 *
 * One is not an edge case here, it is the first thing that happens. A learner's very first
 * finished session sets `currentStreak` to 1 and `sessions.length` to 1, and the panel is
 * what they open to see it: the Streak card — the first of the four — reads "1 days", and
 * its own subtitle reads "Best: 1 days". The history row is the same for a learner whose
 * only custom session is one word long, which is exactly what someone pasting a term to
 * drill would do.
 *
 * Zero and the plural forms were already right, which is why this survived: the suite pins
 * "0 days" and "12 days" (`test/streakDisplay.test.ts:141-143`), never a 1.
 */
describe('a count of one', () => {
  /** One finished session, as a learner's first ever one, with a stated word count. */
  const oneSession = (wordsCount: number) => {
    saveUserStats({
      ...loadUserStats(),
      dailyStreak: {
        currentStreak: 1,
        bestStreak: 1,
        lastActiveDate: getTodayDateString(),
      },
    });
    recordCompletedSession({
      title: 'Practice 1',
      sourceType: 'custom',
      wpm: 41,
      accuracy: 95,
      durationSeconds: 30,
      wordsCount,
      keystrokes: 40,
    });
  };

  it('reads "1 day" on the streak card, not "1 days"', () => {
    oneSession(5);
    const host = renderModal();

    expect(host.textContent).toContain('1 day');
    expect(host.textContent).not.toContain('1 days');
  });

  it('reads "Best: 1 day", not "Best: 1 days"', () => {
    oneSession(5);
    const host = renderModal();

    expect(host.textContent).toContain('Best: 1 day');
    expect(host.textContent).not.toContain('Best: 1 days');
  });

  it('names one session in the singular', () => {
    oneSession(5);
    const host = renderModal();

    expect(host.textContent).toContain('Last 1 session');
    expect(host.textContent).not.toContain('Last 1 sessions');
  });

  /** The same rule in the log rather than on a card, and the one a drill-length paste makes. */
  it('counts a one-word session in the singular too', () => {
    oneSession(1);
    const host = renderModal();

    expect(host.textContent).toContain('1 word in');
    expect(host.textContent).not.toContain('1 words in');
  });

  /**
   * The control, and the half that makes the four above mean something: a rule that
   * returned the singular whenever it could would pass all of them and leave "2 days"
   * wrong, which is what nearly every streak in the app actually reads.
   */
  it('still counts more than one in the plural', () => {
    practiceSessions(2);
    const host = renderModal();

    expect(host.textContent).toContain('Last 2 sessions');
    expect(host.textContent).toContain('5 words in');
  });
});
