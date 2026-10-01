import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isValidDeviceId, type ProgressRecord } from './progress-schema';

/**
 * Storage seam for progress sync.
 *
 * `FileProgressStore` is the reference implementation and the only thing
 * app/api/progress/route.ts talks to. Swapping in Postgres means writing one
 * class with the same three methods — see db/schema.sql for the target shape.
 */
export interface ProgressStore {
  get(deviceId: string): Promise<ProgressRecord | null>;
  put(record: ProgressRecord): Promise<ProgressRecord>;
  remove(deviceId: string): Promise<boolean>;
}

export class UnsafeDeviceIdError extends Error {}

function assertSafeDeviceId(deviceId: string): void {
  // Defence in depth: the route validates first, but this is the layer that
  // turns a device id into a filename, so it re-checks rather than trusts.
  if (!isValidDeviceId(deviceId)) {
    throw new UnsafeDeviceIdError(`unsafe device id: ${JSON.stringify(deviceId)}`);
  }
}

/** Read per call rather than at module load so tests can redirect the store. */
function dataDir(): string {
  return process.env.TYPE_STORY_DATA_DIR || path.join(process.cwd(), '.data');
}

export class FileProgressStore implements ProgressStore {
  private fileFor(deviceId: string): string {
    assertSafeDeviceId(deviceId);
    return path.join(dataDir(), 'progress', `${deviceId}.json`);
  }

  async get(deviceId: string): Promise<ProgressRecord | null> {
    const file = this.fileFor(deviceId);
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as ProgressRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      // A truncated or hand-edited file must not take the API down: treat it as
      // absent and let the next PUT replace it.
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async put(record: ProgressRecord): Promise<ProgressRecord> {
    const file = this.fileFor(record.deviceId);
    await fs.mkdir(path.dirname(file), { recursive: true });

    // Write-then-rename: a reader never observes a half-written record.
    //
    // The temp name is unique per *write*, not per process. A pid-scoped one made two
    // in-flight puts of the same device collide on a single temp file — the likeliest
    // way to get two is one learner with the app open in two tabs finishing a passage
    // in each — and then the first rename moved the *second* write's bytes into place
    // while reporting success for its own, and the second rename failed ENOENT. The
    // backup silently ended up holding the wrong record.
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record), 'utf8');
    await fs.rename(tmp, file);
    return record;
  }

  async remove(deviceId: string): Promise<boolean> {
    const file = this.fileFor(deviceId);
    try {
      await fs.unlink(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}

/** One instance per process: the directory is shared, the config is not. */
export const progressStore: ProgressStore = new FileProgressStore();
