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

function writeDeviceId(deviceId: string | null): void {
  if (deviceId === null) localStorage.removeItem(DEVICE_KEY);
  else localStorage.setItem(DEVICE_KEY, deviceId);
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
 * Stop backing up, and delete what is already on the server.
 *
 * Forgetting the code alone would leave the learner's history sitting on a machine
 * they just asked to stop uploading to, reachable by anyone holding that code.
 */
export function disableBackup(): void {
  if (typeof window === 'undefined') return;
  const code = readDeviceId();

  try {
    writeDeviceId(null);
  } catch {
    // Leave the code in place rather than uploading to something we can no longer
    // switch off.
    return;
  }

  if (code && typeof fetch === 'function') {
    void fetch(`${ENDPOINT}?deviceId=${encodeURIComponent(code)}`, {
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
    }).catch(() => {
      // The record is now unaddressable, which is the outcome the user asked for.
    });
  }
}

/**
 * Mirror local stats to the server after every local write.
 *
 * Fire-and-forget on purpose: localStorage is the source of truth, and a backup that
 * fails because the network is down must never interrupt a typing session.
 */
export function pushProgress(stats: UserStats): void {
  if (typeof fetch !== 'function') return;
  const deviceId = readDeviceId();
  if (!deviceId) return;

  void fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, version: PROGRESS_SCHEMA_VERSION, stats }),
  }).catch(() => {
    // Offline, 5xx, unwritable data directory — all of them just mean this backup
    // did not happen, and the local copy is still correct.
  });
}

export type BackupLookup =
  | { ok: true; stats: UserStats }
  | { ok: false; error: string };

/**
 * Read a backup without touching anything local, so the caller can ask before
 * committing to it. The returned stats are unsanitised; they are safe to keep only
 * because loadUserStats() validates every field on the way back out.
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
