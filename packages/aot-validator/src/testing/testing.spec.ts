// `schemasFrom` reads its own file, which is the shape every migrated test uses.
//
// The happy path is covered many times over by the rest of the repository — around thirty spec
// files get their schema value this way, so a fourth assertion that a `serial` column comes
// back as a `serial` column buys nothing. What is only covered here is the three ways it
// refuses, and those matter more than they look: each one is a mistake somebody makes while
// writing a test, and each has a symptom that points somewhere else entirely if the message is
// wrong. A file that does not compile reflects as "the checker could not resolve this type",
// once per column, with no mention of the import that is actually broken.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Length, PrimaryKey, Sensitive, Serial, Sql, Table, Unique } from '@zmdb/schema-core/tags';
import { afterAll, describe, expect, it } from 'vitest';

import { schemaIrsFrom, schemasFrom } from './index.ts';

export interface Account extends Table<'accounts'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique;
  secret: string & Sql<'text'> & Sensitive;
  note: (string & Sql<'text'>) | null;
}

const directories: string[] = [];
afterAll(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A one-file project outside the repo, for the cases that need a file that is wrong. */
function scratch(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'zmdb-testing-'));
  directories.push(directory);
  mkdirSync(join(directory, 'src'), { recursive: true });
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        skipLibCheck: true,
        types: [] as string[],
      },
      include: ['**/*.ts'],
    }),
  );
  const file = join(directory, 'src', 'model.ts');
  writeFileSync(file, source);
  return file;
}

describe('schemasFrom', () => {
  it('reads a tagged interface out of the file that declares it', () => {
    const { Account: accounts } = schemasFrom(import.meta.url, ['Account']);

    expect(accounts.table).toBe('accounts');
    expect(Object.keys(accounts.columns).toSorted()).toEqual(['email', 'id', 'note', 'secret']);
    expect(accounts.primaryKey).toEqual(['id']);
    expect(accounts.columns.id).toMatchObject({ type: 'serial', flags: { primaryKey: true, autoIncrement: true } });
    expect(accounts.columns.email).toMatchObject({ type: 'varchar', flags: { unique: true, length: 255 } });
    expect(accounts.columns.secret?.flags).toMatchObject({ sensitive: true });
    expect(accounts.columns.note?.flags).toMatchObject({ nullable: true });
  }, 60_000);

  it('stops at the IR when asked, because that is what the front-end produces', () => {
    const { Account: ir } = schemaIrsFrom(import.meta.url, ['Account']);

    expect(ir.table).toBe('accounts');
    expect(ir.columns.map(column => column.name).toSorted()).toEqual(['email', 'id', 'note', 'secret']);
  }, 60_000);

  it('names the compile error rather than every column it made unreadable', () => {
    const file = scratch(`import type { Sql, Table } from './nowhere.ts';

export interface Broken extends Table<'broken'> {
  id: number & Sql<'serial'>;
}
`);
    // Not "the checker could not resolve this type" four times over: the import is the problem,
    // and the reflection's view of a broken file is a symptom of it.
    expect(() => schemasFrom(file, ['Broken'])).toThrow(/does not compile[\s\S]*TS2307/);
  }, 60_000);

  it('says what a missing name looks like, and lists what is there', () => {
    const file = scratch(`interface Hidden {
  id: number;
}

export type Visible = Hidden;
`);
    expect(() => schemasFrom(file, ['Hidden'])).toThrow(/exports no `Hidden`[\s\S]*Exports found: Visible/);
  }, 60_000);

  it('refuses a type that is not a table, rather than inventing a table name', () => {
    const file = scratch(`export interface Loose {
  id: number;
}
`);
    expect(() => schemasFrom(file, ['Loose'])).toThrow(/Table<'name'> tag/);
  }, 60_000);
});
