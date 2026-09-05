import { type Driver, type ExecuteOptions, type TransactionalDriver } from '@zmdb/orm';
import { isWrite, withReplicas } from '@zmdb/orm/replicas';
import { createQueryCompiler, trustedTable, type QueryEffects } from '@zmdb/sql';
import { withComments } from '@zmdb/sql/comments';
import { setOperation } from '@zmdb/sql/set-ops';
import { describe, it, expect } from 'vitest';

import { postgresDialect } from '../testing/official-dialects.fixture.js';

function tagDriver(tag: string, log: string[]): Driver {
  return { dialect: postgresDialect, execute: async q => (log.push(`${tag}:${q.text.slice(0, 6)}`), []) };
}
const read: QueryEffects = { operation: 'SELECT', requiresPrimary: false, returnsRows: true };
const write: QueryEffects = { operation: 'INSERT', requiresPrimary: true, returnsRows: false };
const q = (text: string, effects: QueryEffects = read) => ({ text, parameters: [], effects });

describe('read replicas (#128)', () => {
  it('isWrite detects INSERT/UPDATE/DELETE, write CTEs, DDL, and locking reads', () => {
    expect(isWrite('INSERT INTO x ...')).toBe(true);
    expect(isWrite('  update x set ...')).toBe(true);
    expect(isWrite('SELECT 1')).toBe(false);
    expect(isWrite('CREATE TABLE users (id INT)')).toBe(true);
    expect(isWrite('SELECT * FROM users FOR UPDATE')).toBe(true);
    expect(isWrite('WITH moved AS (DELETE FROM old_users RETURNING *) INSERT INTO new_users SELECT * FROM moved')).toBe(
      true,
    );
    expect(isWrite({ text: 'SELECT * FROM users', parameters: [], isWrite: false })).toBe(false);
    expect(isWrite({ text: 'SELECT * FROM users', parameters: [], isWrite: true })).toBe(true);
  });

  it('routes write CTEs, DDL, and locking reads to primary based on metadata or SQL inspection', async () => {
    const log: string[] = [];
    const d = withReplicas({
      primary: tagDriver('P', log),
      replicas: [tagDriver('R0', log)],
    });

    const writeCte = {
      text: 'WITH moved AS (DELETE FROM old_users RETURNING *) INSERT INTO new_users SELECT * FROM moved',
      parameters: [],
      isWrite: true,
      operation: 'insert' as const,
    };
    const ddlQuery = {
      text: 'CREATE TABLE logs (id INT)',
      parameters: [],
      isWrite: true,
      operation: 'ddl' as const,
    };
    const lockingQuery = {
      text: 'SELECT * FROM accounts WHERE id = $1 FOR UPDATE',
      parameters: [1],
      isWrite: true,
      operation: 'select' as const,
    };
    const readCte = {
      text: 'WITH active AS (SELECT * FROM users WHERE active = true) SELECT * FROM active',
      parameters: [],
      isWrite: false,
      operation: 'select' as const,
    };

    await d.execute(writeCte);
    await d.execute(ddlQuery);
    await d.execute(lockingQuery);
    await d.execute(readCte);

    expect(log).toEqual(['P:WITH m', 'P:CREATE', 'P:SELECT', 'R0:WITH a']);
  });

  it('preserves primary driver dialect metadata', () => {
    const primary: Driver = {
      dialect: postgresDialect,
      execute: async () => [],
    };
    const d = withReplicas({
      primary,
      replicas: [{ dialect: postgresDialect, execute: async () => [] }],
    });
    expect(d.dialect).toBe(postgresDialect);
  });

  it('routes writes to primary, reads to replicas (round-robin)', async () => {
    const log: string[] = [];
    const d = withReplicas({
      primary: tagDriver('P', log),
      replicas: [tagDriver('R0', log), tagDriver('R1', log)],
    });
    await d.execute(q('SELECT a'));
    await d.execute(q('SELECT b'));
    await d.execute(q('INSERT INTO x', write));
    await d.execute(q('SELECT c'));
    expect(log).toEqual(['R0:SELECT', 'R1:SELECT', 'P:INSERT', 'R0:SELECT']);
  });

  it('falls back to primary when no replicas', async () => {
    const log: string[] = [];
    const d = withReplicas({ primary: tagDriver('P', log), replicas: [] });
    await d.execute(q('SELECT z'));
    expect(log).toEqual(['P:SELECT']);
  });

  it('routes DDL, locking reads, writing CTEs and explicit unknown effects to primary', async () => {
    const log: string[] = [];
    const driver = withReplicas({ primary: tagDriver('P', log), replicas: [tagDriver('R', log)] });
    await driver.execute(
      q('CREATE TABLE example (id int)', { operation: 'DDL', requiresPrimary: true, returnsRows: false }),
    );
    await driver.execute(q('SELECT id FROM example FOR UPDATE', { ...read, requiresPrimary: true }));
    await driver.execute(
      q('WITH changed AS (DELETE FROM example RETURNING id) SELECT id FROM changed', {
        ...read,
        requiresPrimary: true,
      }),
    );
    await driver.execute(
      q('SELECT custom_function()', { operation: 'UNKNOWN', requiresPrimary: true, returnsRows: true }),
    );
    await driver.execute(q('/* read */ SELECT id FROM example'));
    expect(log.map(entry => entry.split(':')[0])).toEqual(['P', 'P', 'P', 'P', 'R']);
  });

  it('derives statement and row-return effects while compiling queries', () => {
    const compiler = createQueryCompiler(postgresDialect);
    expect(compiler.selectFrom(trustedTable('items')).select(['id']).compile().effects).toEqual(read);
    expect(compiler.insertInto(trustedTable('items')).values({ id: 1 }).compile().effects).toEqual(write);
    expect(compiler.insertInto(trustedTable('items')).values({ id: 1 }).returning(['id']).compile().effects).toEqual({
      ...write,
      returnsRows: true,
    });
    expect(compiler.updateTable(trustedTable('items')).set({ id: 2 }).compile().effects).toEqual({
      ...write,
      operation: 'UPDATE',
    });
    expect(compiler.updateTable(trustedTable('items')).set({ id: 2 }).returning(['id']).compile().effects).toEqual({
      ...write,
      operation: 'UPDATE',
      returnsRows: true,
    });
    expect(compiler.deleteFrom(trustedTable('items')).compile().effects).toEqual({ ...write, operation: 'DELETE' });
    expect(compiler.deleteFrom(trustedTable('items')).returning(['id']).compile().effects).toEqual({
      ...write,
      operation: 'DELETE',
      returnsRows: true,
    });
  });

  it('keeps transactions on the primary driver', async () => {
    const log: string[] = [];
    const primary: TransactionalDriver = {
      ...tagDriver('P', log),
      transaction: async run => run(tagDriver('TX', log)),
    };
    const driver = withReplicas({ primary, replicas: [tagDriver('R', log)] });
    const transaction = driver.transaction;
    expect(transaction).toBeTypeOf('function');
    if (transaction === undefined) throw new Error('primary transactions were dropped');
    await transaction(async nested => {
      expect(nested.dialect).toBe(postgresDialect);
      await nested.execute(q('SELECT id FROM items'));
    });
    expect(log).toEqual(['TX:SELECT']);
  });

  it('preserves nested primary requirements through composition and comments', async () => {
    const compiler = createQueryCompiler(postgresDialect);
    let compilations = 0;
    const child = {
      dialect: postgresDialect,
      compile() {
        compilations++;
        return {
          ...q('SELECT id FROM items WHERE id = $1 FOR UPDATE', { ...read, requiresPrimary: true }),
          parameters: [7],
        };
      },
    };
    const outer = compiler.selectFrom(trustedTable('items')).whereExists(child).compile();
    expect(compilations).toBe(1);
    expect(outer.parameters).toEqual([7]);
    expect(outer.effects).toEqual({ ...read, requiresPrimary: true });
    const combined = setOperation('union', [q('SELECT id FROM items'), outer], postgresDialect);
    expect(combined.effects).toEqual({ ...read, requiresPrimary: true });
    expect(Object.isFrozen(combined.effects)).toBe(true);
    expect(setOperation('union', [q('SELECT 1'), q('SELECT 2')], postgresDialect).effects).toEqual(read);
    expect(() => setOperation('union', [q('INSERT INTO items DEFAULT VALUES', write), outer], postgresDialect)).toThrow(
      /row/i,
    );

    const log: string[] = [];
    const tagged = withComments(
      withReplicas({ primary: tagDriver('P', log), replicas: [tagDriver('R', log)] }),
      () => ({ route: '/items' }),
    );
    await tagged.execute(combined);
    expect(log).toEqual(['P:SELECT']);
    expect(tagged.dialect).toBe(postgresDialect);
  });

  it('forwards execute and stream options to the selected driver', async () => {
    const observed: (ExecuteOptions | undefined)[] = [];
    const streaming = (tag: string): Driver => ({
      dialect: postgresDialect,
      execute(_query, options) {
        observed.push(options);
        return Promise.resolve([]);
      },
      stream(_query, options) {
        observed.push(options);
        return {
          async *[Symbol.asyncIterator]() {
            yield { tag };
          },
        };
      },
    });
    const routed = withReplicas({
      primary: streaming('primary'),
      replicas: [streaming('replica')],
    });
    const signal = new AbortController().signal;

    await routed.execute(q('SELECT one'), { signal });
    const stream = routed.stream;
    if (stream === undefined) throw new Error('all selected drivers support stream');
    for await (const row of stream(q('SELECT two'), { signal, batchSize: 32 })) {
      expect(row).toEqual({ tag: 'replica' });
    }

    for await (const row of stream(q('SELECT three FOR UPDATE', { ...read, requiresPrimary: true }), {
      signal,
      batchSize: 16,
    })) {
      expect(row).toEqual({ tag: 'primary' });
    }

    expect(observed).toEqual([{ signal }, { signal, batchSize: 32 }, { signal, batchSize: 16 }]);
  });

  it('advertises streaming only when every routed driver has a callable method', () => {
    const primary: Driver = {
      dialect: postgresDialect,
      execute: () => Promise.resolve([]),
      stream: () => ({
        async *[Symbol.asyncIterator]() {},
      }),
    };
    const malformedReplica: Driver = {
      dialect: postgresDialect,
      execute: () => Promise.resolve([]),
      // @ts-expect-error — runtime capability checks must reject malformed
      // JavaScript adapters instead of advertising a method that will crash.
      stream: null,
    };

    const routed = withReplicas({ primary, replicas: [malformedReplica] });

    expect(routed.stream).toBeUndefined();
  });
});
