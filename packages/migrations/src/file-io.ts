import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { Migration } from './runner.js';

export interface FileMigration extends Migration {
  readonly path: string;
  readonly hasDown: boolean;
}

/** Read the single-file up/down format emitted by `zmdb generate`. */
export async function readMigrations(directory: string): Promise<readonly FileMigration[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }

  const migrations: FileMigration[] = [];
  for (const file of entries.filter(entry => entry.endsWith('.sql')).toSorted()) {
    const match = /^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/i.exec(file);
    if (match === null) {
      throw new Error(`migration file ${join(directory, file)} must be named <YYYYMMDDHHMMSS>_<slug>.sql`);
    }
    const versionText = match[1];
    const name = match[2];
    if (versionText === undefined || name === undefined) {
      throw new Error(`migration file ${join(directory, file)} has no version or name`);
    }
    const path = join(directory, file);
    const parsed = parseMigration(await readFile(path, 'utf8'), path);
    migrations.push({
      version: Number(versionText),
      name,
      path,
      up: parsed.up,
      down: parsed.down,
      hasDown: parsed.hasDown,
    });
  }
  return migrations;
}

function parseMigration(
  source: string,
  path: string,
): { readonly up: string; readonly down: string; readonly hasDown: boolean } {
  const up = marker(source, 'up');
  if (up === undefined) throw new Error(`migration file ${path} has no -- zmdb:up section`);
  const down = marker(source, 'down');
  if (down !== undefined && down.start < up.end) {
    throw new Error(`migration file ${path} puts -- zmdb:down before -- zmdb:up`);
  }
  return {
    up: source.slice(up.end, down?.start ?? source.length),
    down: down === undefined ? '' : source.slice(down.end),
    hasDown: down !== undefined,
  };
}

function marker(source: string, name: 'up' | 'down'): { readonly start: number; readonly end: number } | undefined {
  const match = new RegExp(`^-- zmdb:${name}[\\t ]*(?:\\r?\\n|$)`, 'm').exec(source);
  if (match === null) return undefined;
  return { start: match.index, end: match.index + match[0].length };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

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

/** Replace one text file with a complete sibling written first. */
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
