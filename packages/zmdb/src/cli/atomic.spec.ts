import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { writeTextAtomically, type AtomicWriteOperations } from './atomic.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('writes a migration file atomically', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zmdb-atomic-migration-'));
  directories.push(directory);
  const target = join(directory, '20260904120000_initial.sql');
  const operations: AtomicWriteOperations = {
    write: (path, text) => writeFile(path, text),
    rename: () => Promise.reject(new Error('injected rename failure')),
    remove: path => rm(path, { force: true }),
  };

  await expect(writeTextAtomically(target, '-- zmdb:up\nSELECT 1;\n', operations)).rejects.toThrow(
    'injected rename failure',
  );
  expect(existsSync(target)).toBe(false);
  expect(readdirSync(directory)).toEqual([]);
});
