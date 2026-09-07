import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export interface AtomicWriteOperations {
  readonly write: (path: string, text: string) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
}

const FILE_OPERATIONS: AtomicWriteOperations = {
  write: (path, text) => writeFile(path, text, { flag: 'wx' }),
  rename,
  remove: path => rm(path, { force: true }),
};

let temporaryFileSequence = 0;

/**
 * Replace one text file with a complete sibling written first.
 *
 * The temporary file lives in the destination directory, so `rename` is the
 * atomic filesystem operation rather than a cross-device copy.
 */
export async function writeTextAtomically(
  path: string,
  text: string,
  operations: AtomicWriteOperations = FILE_OPERATIONS,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  temporaryFileSequence += 1;
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${String(temporaryFileSequence)}.tmp`,
  );

  try {
    await operations.write(temporary, text);
    await operations.rename(temporary, path);
  } catch (error) {
    await operations.remove(temporary);
    throw error;
  }
}
