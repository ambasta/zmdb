import { describe, it, expect } from 'vitest';

import type { Driver, ExecuteOptions } from '../index.js';
import { withReplicas, isWrite } from './index.js';

function tagDriver(tag: string, log: string[]): Driver {
  return { execute: async q => (log.push(`${tag}:${q.text.slice(0, 6)}`), []) };
}
const q = (text: string) => ({ text, parameters: [] });

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
      dialect: 'postgres',
      execute: async () => [],
    };
    const d = withReplicas({
      primary,
      replicas: [{ dialect: 'postgres', execute: async () => [] }],
    });
    expect(d.dialect).toBe('postgres');
  });

  it('routes writes to primary, reads to replicas (round-robin)', async () => {
    const log: string[] = [];
    const d = withReplicas({
      primary: tagDriver('P', log),
      replicas: [tagDriver('R0', log), tagDriver('R1', log)],
    });
    await d.execute(q('SELECT a'));
    await d.execute(q('SELECT b'));
    await d.execute(q('INSERT INTO x'));
    await d.execute(q('SELECT c'));
    expect(log).toEqual(['R0:SELECT', 'R1:SELECT', 'P:INSERT', 'R0:SELECT']);
  });

  it('falls back to primary when no replicas', async () => {
    const log: string[] = [];
    const d = withReplicas({ primary: tagDriver('P', log), replicas: [] });
    await d.execute(q('SELECT z'));
    expect(log).toEqual(['P:SELECT']);
  });

  it('forwards execute and stream options to the selected driver', async () => {
    const observed: (ExecuteOptions | undefined)[] = [];
    const streaming = (tag: string): Driver => ({
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

    expect(observed).toEqual([{ signal }, { signal, batchSize: 32 }]);
  });

  it('advertises streaming only when every routed driver has a callable method', () => {
    const primary: Driver = {
      execute: () => Promise.resolve([]),
      stream: () => ({
        async *[Symbol.asyncIterator]() {},
      }),
    };
    const malformedReplica: Driver = {
      execute: () => Promise.resolve([]),
      // @ts-expect-error — runtime capability checks must reject malformed
      // JavaScript adapters instead of advertising a method that will crash.
      stream: null,
    };

    const routed = withReplicas({ primary, replicas: [malformedReplica] });

    expect(routed.stream).toBeUndefined();
  });
});
