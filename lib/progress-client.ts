import { useSyncExternalStore } from 'react';
import { isValidDeviceId, PROGRESS_SCHEMA_VERSION, type ProgressRecord } from './progress-schema';
import type { UserStats } from './types';

/**
 * Browser half of the progress sync served by app/api/progress/route.ts.
 *
 * Opt-in, never automatic. The session history is the most personal thing this app
 * holds — it records exactly which passages someone typed, when, and how long it
 * took — so nothing leaves the device until the learner turns a backup on.
 *
 * A push is a whole-record overwrite, not a merge, and that is deliberate: the code
 * is the identity, and two browsers writing the same code are one person on two
 * machines rather than two people. Merging would need a rule for cumulative totals
 * that neither side can compute correctly, so the code makes the question go away.
 */

const DEVICE_KEY = 'typestory_backup_device_v1';
const ENDPOINT = '/api/progress';
export const BACKUP_CHANGE_EVENT = 'typestory:backup-changed';

function readDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    return isValidDeviceId(stored) ? stored : null;
  } catch {
    // Storage unavailable (private mode, blocked third-party data): no backup.
    return null;
  }
}

function newDeviceId(): string {
  // crypto.randomUUID only exists in a secure context, and reaching a self-hosted
  // instance over http://192.168.x.x is a perfectly normal way to use this app.
  // The code is an identity label rather than a secret — the API is unauthenticated
  // either way — so falling back costs nothing.
  const webcrypto = globalThis.crypto;
  if (webcrypto && typeof webcrypto.randomUUID === 'function') return webcrypto.randomUUID();
  return `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Whether the most recent push was refused.
 *
 * `pushProgress` is fire-and-forget by design — a backup that fails because the network is
 * down must never interrupt a typing session — but it had no way to report an outcome, so a
 * 400 was indistinguishable from a 200 to every screen in the app. `lib/stats.ts` names the
 * cost: a push is a whole-record overwrite, so one refused field takes the entire backup down
 * and the learner finds out days later, on another machine, with no record of the run and
 * nothing anywhere that said the backup had stopped.
 *
 * Only the last push counts. One dropped request on a train is not a broken backup, and a
 * warning that latched would be its own kind of lie; the next successful push clears it.
 */
let pushFailed = false;
const pushListeners = new Set<() => void>();

/**
 * How many pushes have been issued, so an old one can tell it is no longer the newest.
 *
 * The verdict above is a claim about the server's copy, and the server's copy is whatever the
 * most recent upload made it. A push still on the wire cannot say what that is, and an older
 * push answering *after* a newer one is describing data that has since been replaced — so it
 * is not allowed to answer. Which is not what "last push counts" was implemented as: it was
 * last settlement to win, and the difference is a slow success overtaking a newer refusal,
 * which switched the warning off and told a learner their backup was whole while the write
 * holding their newest sessions had been refused.
 *
 * A counter rather than the promises, because `inFlight` below already holds those to answer a
 * different question, and holding them here too would let a request that never settles keep a
 * handle alive that is never released.
 */
let pushSeq = 0;

function setPushFailed(next: boolean): void {
  if (pushFailed === next) return;
  pushFailed = next;
  for (const notify of pushListeners) notify();
}

function writeDeviceId(deviceId: string | null): void {
  if (deviceId === null) localStorage.removeItem(DEVICE_KEY);
  else localStorage.setItem(DEVICE_KEY, deviceId);
  // The code just changed, so the last upload's verdict describes a backup that no longer
  // exists. Left set, it would greet a learner who had already turned backup off — or who
  // had turned it back on — with a warning about a push this code never made.
  //
  // The counter is bumped for the pushes still on the wire rather than only for the verdict
  // already stored: one of those settles later, describes the *previous* code, and would
  // re-raise the warning this line just cleared — against the code adopted on the next line.
  pushSeq++;
  setPushFailed(false);
  window.dispatchEvent(new CustomEvent(BACKUP_CHANGE_EVENT));
}

/**
 * The code backing up to, or null when backup is off.
 *
 * Pure on purpose — it is called during render — so a device id is only ever
 * created by enableBackup()/adoptBackupCode(), both of which are event handlers.
 */
export function getBackupCode(): string | null {
  return readDeviceId();
}

/** Start backing up. Call from a click handler; returns the code to show the user. */
export function enableBackup(): string | null {
  if (typeof window === 'undefined') return null;
  const existing = readDeviceId();
  if (existing) return existing;

  const fresh = newDeviceId();
  if (!isValidDeviceId(fresh)) return null;

  try {
    writeDeviceId(fresh);
    return fresh;
  } catch {
    return null;
  }
}

/** Take over a code that already has a backup, so later sessions keep syncing there. */
export function adoptBackupCode(code: string): boolean {
  if (typeof window === 'undefined' || !isValidDeviceId(code)) return false;
  try {
    writeDeviceId(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * Uploads that have been issued and not yet settled.
 *
 * Only `disableBackup` reads this, and only to learn that its delete might not be the
 * last word — see there. A Set rather than a counter because nothing needs to know which
 * push it is, and because a request that never settles must not be able to keep a handle
 * alive that is never released.
 */
const inFlight = new Set<Promise<unknown>>();

/**
 * Ask the server to drop this code's record. Resolves to whether it is gone.
 *
 * A 404 counts as success: the record not being there is the state this is asking for,
 * and the route answers 404 precisely when there is nothing left to delete. Only a
 * transport failure or a server error is a failure — and both used to be swallowed here,
 * which is how the caller ended up promising a deletion it had never checked.
 */
function deleteRemote(code: string): Promise<boolean> {
  return fetch(`${ENDPOINT}?deviceId=${encodeURIComponent(code)}`, {
    method: 'DELETE',
    // This is the one request that must not be lost to a page unload. Turning
    // backup off is what someone does at the end of a session, so closing the tab
    // is the likeliest next click — and an ordinary in-flight fetch is cancelled
    // when the page goes away. The learner would be told their history was deleted
    // and it would still be sitting on the server, reachable by anyone holding the
    // code they had just been shown. `keepalive` outlives the document.
    //
    // Only the delete gets it. A bodyless DELETE is a few bytes against a 64KB
    // keepalive budget, whereas every push is a whole stats record and is *meant*
    // to be droppable: localStorage is the source of truth, so a lost push costs a
    // backup, not a session.
    keepalive: true,
  })
    .then((response) => response.ok || response.status === 404)
    .catch(() => {
      // Best effort. A failure here means the record may outlive the code, which is the
      // one thing this is for — so the retry below is the part that has to be right, and
      // `false` is what tells the caller to stop claiming the record is gone.
      return false;
    });
}

/**
 * Stop backing up, and delete what is already on the server.
 *
 * Forgetting the code alone would leave the learner's history sitting on a machine
 * they just asked to stop uploading to, reachable by anyone holding that code.
 *
 * Resolves to whether the record is gone, because the answer is not the same on every
 * path and the caller has to be able to tell the learner which one it got. This used to
 * return void and swallow every failure, so `StatsModal` asserted "the stored copy was
 * deleted" without anything having established it — a promise about someone's history,
 * made by a best-effort request, after the only key to it had been thrown away.
 *
 * The delete that settles the answer is the last one to go out: when uploads were in
 * flight, only that one can tell whether a resurrected record was cleaned up.
 */
export function disableBackup(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const code = readDeviceId();

  try {
    writeDeviceId(null);
  } catch {
    // Leave the code in place rather than uploading to something we can no longer
    // switch off. Nothing was deleted, so nothing may claim it was.
    return Promise.resolve(false);
  }

  // No code means nothing was ever uploaded under one, so there is nothing to delete.
  if (!code) return Promise.resolve(true);
  if (typeof fetch !== 'function') return Promise.resolve(false);

  // Taken after the code is cleared, which is what makes it a complete list: `pushProgress`
  // reads the code, so nothing new can start from here.
  const pending = [...inFlight];

  const immediate = deleteRemote(code);

  /**
   * The delete is not the last word, and could not be.
   *
   * `pushProgress` runs on every local write, so finishing a typing session leaves an
   * upload on the wire, and turning backup off is what someone does straight afterwards.
   * The two requests are wildly different sizes — a bodyless DELETE against a whole
   * stats record — so the server is free to complete the delete while the upload is
   * still streaming, and the PUT then re-creates the record under the code the learner
   * was just shown they no longer have. Server-side the two are indistinguishable: PUT
   * is `progressStore.put`, DELETE is `progressStore.remove`, and a put after a remove is
   * an ordinary write. That is the outcome the keepalive comment above exists to
   * prevent, reached a second way round.
   *
   * So the delete goes out twice when it has to: once now, because the page may be
   * about to close, and once after the uploads in flight have settled, because a page
   * that is still alive should not leave a resurrected record behind. The second one
   * costs a 404 on a record that is already gone.
   *
   * The last delete to go out is the one that answers the question, so that is the one
   * returned. Answering on the first would decide before the resurrection it exists to
   * clean up has even been looked for.
   */
  if (pending.length === 0) return immediate;
  return Promise.allSettled(pending).then(() => deleteRemote(code));
}

/**
 * Mirror local stats to the server after every local write.
 *
 * Fire-and-forget on purpose: localStorage is the source of truth, and a backup that
 * fails because the network is down must never interrupt a typing session. Nothing is
 * thrown and nothing is returned — but the outcome is recorded, which is what lets the
 * panel say a backup had stopped instead of the app finding out for them later.
 */
export function pushProgress(stats: UserStats): void {
  if (typeof fetch !== 'function') return;
  const deviceId = readDeviceId();
  if (!deviceId) return;

  // Taken before the request goes out, so "am I still the newest" is answered against the
  // state at the time this push was issued rather than the one after it was sent.
  const seq = ++pushSeq;

  const sent = fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, version: PROGRESS_SCHEMA_VERSION, stats }),
  }).then(
    (response) => {
      if (seq === pushSeq) setPushFailed(!response.ok);
      return response;
    },
    () => {
      // Offline, 5xx, unwritable data directory — all of them just mean this backup
      // did not happen, and the local copy is still correct.
      if (seq === pushSeq) setPushFailed(true);
    },
  );

  inFlight.add(sent);
  void sent.finally(() => inFlight.delete(sent));
}

export type BackupLookup =
  | { ok: true; stats: UserStats }
  | { ok: false; error: string };

/**
 * Read a backup without touching anything local, so the caller can ask before
 * committing to it. The returned stats are unsanitised, and the caller is expected to
 * hand them straight to `saveUserStats` — which is what validates every field, because
 * that is the function that turns them into stored bytes and an uploaded body.
 *
 * Named `loadUserStats` here once, which is the wrong function and the dangerous kind
 * of wrong: it would have said the *read* path is the guarantee, and the read path only
 * governs what is displayed. Trusting that sentence is what would let a restored record
 * reach localStorage and the PUT unchecked.
 */
export async function fetchBackup(code: string): Promise<BackupLookup> {
  if (!isValidDeviceId(code)) {
    return { ok: false, error: 'That is not a backup code.' };
  }

  let record: ProgressRecord;
  try {
    const response = await fetch(`${ENDPOINT}?deviceId=${encodeURIComponent(code)}`, {
      cache: 'no-store',
    });
    if (response.status === 404) return { ok: false, error: 'No backup is stored under that code.' };
    if (!response.ok) return { ok: false, error: `The server answered ${response.status}.` };
    record = ((await response.json()) as { record: ProgressRecord }).record;
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }

  if (!record?.stats || !Array.isArray(record.stats.sessions)) {
    return { ok: false, error: 'That backup could not be read.' };
  }
  return { ok: true, stats: record.stats };
}

/**
 * Read the backup code without a hydration mismatch.
 *
 * Only the browser knows whether backup is on, so the server has to render "off"
 * and let the client correct it — which is what the third argument does.
 */
export function useBackupCode(): string | null {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener(BACKUP_CHANGE_EVENT, onChange);
      return () => window.removeEventListener(BACKUP_CHANGE_EVENT, onChange);
    },
    readDeviceId,
    () => null,
  );
}

/**
 * Whether the last upload was refused, for a panel that has somewhere to say so.
 *
 * Its own store rather than another event on `BACKUP_CHANGE_EVENT`, because a push
 * settles long after the code it was sent under was read, and a component cannot see a
 * plain module variable change without a subscription.
 */
export function useBackupPushFailed(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      pushListeners.add(onChange);
      return () => {
        pushListeners.delete(onChange);
      };
    },
    () => pushFailed,
    () => false,
  );
}
