import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import StatsModal from '../components/stats/StatsModal';
import { getBackupCode } from '../lib/progress-client';
import { saveUserStats } from '../lib/stats';
import type { UserStats } from '../lib/types';

// Same requirement as test/typingBoardA11y.test.ts: React refuses to drive an `act`
// scope unless it has been told this is one.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OLD = 'device-old99';
const WANTED = 'device-new77';

const restored = (): UserStats => ({
  sessions: [],
  dailyStreak: { currentStreak: 4, bestStreak: 9, lastActiveDate: '2026-09-30' },
  totalWordsTyped: 1234,
  totalTimeSpentSeconds: 600,
  bestWpm: 71,
  averageWpm: 62,
  averageAccuracy: 96,
  bestAccuracy: 96,
});

const fetchMock = vi.fn();
const roots: { unmount: () => void }[] = [];

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ record: { stats: restored() } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', () => true);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Paste a code, press Restore, and return the one line the panel answers with. */
async function restoreInto(host: HTMLElement, code: string): Promise<string> {
  const input = host.querySelector('input') as HTMLInputElement;
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Restore'),
  )!;

  act(() => {
    // React tracks the input's value, so the change has to go through the setter it
    // patched over the DOM one.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, code);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    button.click();
  });
  return host.querySelector('[role="status"]')?.textContent ?? '';
}

function renderModal(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(StatsModal, { isOpen: true, onClose: () => {} })));
  return host;
}

/**
 * Put a code on this device, as turning a backup on would have.
 *
 * Seeded rather than minted because the test has to name the code it later finds the
 * device still on, and `enableBackup` only ever produces a fresh UUID.
 */
function seedBackupCode(code: string) {
  localStorage.setItem('typestory_backup_device_v1', code);
  expect(getBackupCode()).toBe(code);
}

/**
 * Refuse to write the backup code, and nothing else.
 *
 * Keyed rather than blanket, because the rest of the restore has to keep working: the
 * progress is written under a different key, and a test where every write fails would
 * not isolate the one promise this file is about.
 */
function blockBackupCodeWrites() {
  const real = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'typestory_backup_device_v1') throw new DOMException('full', 'QuotaExceededError');
    real.call(this, key, value);
  });
}

/**
 * Refuse to write the stored progress, and nothing else.
 *
 * The other half of `blockBackupCodeWrites`, for the write that has to succeed for
 * "Restored." to mean anything. Keyed the same way and for the same reason: a test where
 * every write fails would not be about this one.
 */
function blockStatsWrites() {
  const real = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'typestory_user_stats_v1') throw new DOMException('full', 'QuotaExceededError');
    real.call(this, key, value);
  });
}

/**
 * Progress that was never stored, reported as though it had been.
 *
 * `adoptBackupCode` was the third caller that ignored a boolean, and it was fixed. The
 * write *before* it was not: `saveUserStats` swallowed a refused `setItem` and returned
 * nothing, so the panel could not have asked. The learner was told their progress was
 * restored, the device was switched to the code they had typed, and the copy on the
 * device was the one they already had — the one thing the sentence said had been
 * replaced.
 *
 * Reachable without anything exotic: a quota, storage switched off, or Safari's private
 * mode, which is the same refusal `enableBackup` returns null for and `disableBackup`
 * keeps working around.
 */
describe('restoring a backup this browser will not store', () => {
  it('does not claim the progress was restored', async () => {
    seedBackupCode(OLD);
    blockStatsWrites();

    const message = await restoreInto(renderModal(), WANTED);

    expect(message).not.toContain('Restored');
    expect(message).toContain('nothing was changed');
    // And the device is still on the code that holds its history, rather than pointed at
    // the one typed — a backup code switched to a record that was never written is a
    // learner believing their history is safe somewhere it is not.
    expect(getBackupCode()).toBe(OLD);
  });

  /**
   * The control.
   *
   * The write going through is what has to put the sentence back, so a change that simply
   * stopped claiming success would fail here instead of passing.
   */
  it('claims it when the progress does land', async () => {
    seedBackupCode(OLD);

    const message = await restoreInto(renderModal(), WANTED);

    expect(message).toContain('Restored');
    expect(getBackupCode()).toBe(WANTED);
  });
});

/**
 * Every PUT the server has been sent, as the body it would parse.
 *
 * Read off the mock rather than off `getBackupCode`, because that is the whole claim: two
 * codes are both "live" at different moments of one restore, and only the request bodies
 * say what actually reached the server under each.
 */
function putBodies(): { deviceId: string; stats: UserStats }[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/progress' && (init as RequestInit)?.method === 'PUT')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

/**
 * The pre-restore history the confirmation promised to keep.
 *
 * `confirm` says "What is here now stays recoverable under this device's own code", and
 * the ordering that fixed the refused write broke exactly that sentence. Restore saves
 * before it adopts, so the save's own upload runs while the device is still on `OLD` —
 * and `pushProgress` reads the code at call time, not the one that is about to be adopted.
 * The PUT therefore carries the *restored* record under `OLD`, overwriting on the server
 * the one copy of the progress the dialog just said would survive. Then the device moves
 * to `WANTED`, whose server record already holds what was restored, so the two ends agree
 * and the destruction is invisible from the device.
 *
 * Nothing about this needs an exotic browser. It is what a restore does on a second
 * machine, or onto a code someone shared, and the learner is told to expect the opposite.
 */
describe('restoring over a code this device already had', () => {
  it('does not overwrite that code’s stored record', async () => {
    seedBackupCode(OLD);

    await restoreInto(renderModal(), WANTED);

    const clobbered = putBodies().filter((body) => body.deviceId === OLD);
    expect(clobbered.map((body) => body.stats.totalWordsTyped)).toEqual([]);
  });

  /**
   * The control.
   *
   * The assertion above is an empty list, which a fetch mock that recorded nothing at all
   * would satisfy. Saving anything on a device that has a code must reach the server —
   * `test/progressClient.test.ts` asserts that of `pushProgress`, not of this panel — so
   * it is re-asserted here, through the same mock, in the same file.
   */
  it('still uploads, once the code has been switched', async () => {
    seedBackupCode(WANTED);
    await restoreInto(renderModal(), WANTED);

    // Restoring does not upload anything of its own — the record it fetched came from
    // there, and `WANTED` still holds it.
    expect(putBodies()).toEqual([]);

    // A session finished afterwards does, which is what makes the line above meaningful.
    saveUserStats(restored());
    expect(putBodies().map((body) => body.deviceId)).toEqual([WANTED]);
  });
});

/**
 * "This device backs up to that code from now on."
 *
 * `adoptBackupCode` is the one function in the backup path that reports whether it
 * worked — it returns false instead of swallowing a storage failure — and the other two
 * callers ask it: `startBackup` refuses to start, `stopBackup` leaves the old code alone
 * and says the stored copy may still be there. Restore was the third caller and it did
 * not ask. It discarded the boolean and printed the sentence that is only true when that
 * boolean came back true.
 *
 * The state it promises about is not in doubt. This device had already turned a backup
 * on and been given `OLD`, and the restore is pointed at `WANTED`. When the write of the
 * new code is refused, `getBackupCode()` keeps answering `OLD` — so the progress that was
 * just restored is uploaded under the code the learner was shown before they started,
 * while the panel names the one they asked for. Someone who believes their restored
 * history is safe under `WANTED` has it under `OLD`, and nothing on screen says so.
 *
 * A browser refusing a storage write is not exotic here, and the same module already
 * treats it as ordinary: `enableBackup` returns null rather than inventing a code, and
 * `disableBackup` leaves the existing one in place precisely so it keeps uploading to
 * something it can still switch off. This is that same refusal, on the one path nobody
 * was listening to.
 */
describe('restoring a backup', () => {
  it('does not claim a backup the device refused to switch over', async () => {
    seedBackupCode(OLD);
    blockBackupCodeWrites();

    const message = await restoreInto(renderModal(), WANTED);

    // The truth, which is not the sentence on screen.
    expect(getBackupCode()).toBe(OLD);
    expect(message).not.toContain('from now on');
    // And it has to say which code is live. "Nothing is backed up" would be a second
    // lie in the other direction: the learner would take the backup they still have to
    // be gone, and the old code is the one holding their history.
    expect(message).toContain(OLD);
  });

  /**
   * The other way to be wrong, and the one a device with no backup takes: there is no
   * code to keep, so the honest sentence is that nothing is being backed up — not that
   * it is backing up to the one it could not store.
   */
  it('says nothing is backed up when there was no code to keep', async () => {
    expect(getBackupCode()).toBeNull();
    blockBackupCodeWrites();

    const message = await restoreInto(renderModal(), WANTED);

    expect(getBackupCode()).toBeNull();
    expect(message).toContain('nothing is backed up');
  });

  /**
   * The control.
   *
   * Without it the assertion above is satisfied just as well by a panel that never
   * reports on its backup at all, rather than by one that reports it honestly. Here the
   * write goes through, so the sentence has to be there.
   */
  it('says so when the switch took', async () => {
    seedBackupCode(OLD);

    const message = await restoreInto(renderModal(), WANTED);

    expect(getBackupCode()).toBe(WANTED);
    expect(message).toContain('from now on');
  });
});