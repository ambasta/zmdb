import { describe, it, expect } from 'vitest';

import type { Driver, ExecuteOptions } from '../index.js';
import { postgresDialect } from '../testing/official-dialects.fixture.js';
import { withReplicas, isWrite } from './index.js';

function tagDriver(tag: string, log: string[]): Driver {
  return { dialect: postgresDialect, execute: async q => (log.push(`${tag}:${q.text.slice(0, 6)}`), []) };
}
const q = (text: string) => ({ text, parameters: [] });

describe('read replicas (#128)', () => {
  it('isWrite detects INSERT/UPDATE/DELETE across upper/lower/mixed case and whitespace', () => {
    // Upper case
    expect(isWrite('INSERT INTO x ...')).toBe(true);
    expect(isWrite('UPDATE x SET ...')).toBe(true);
    expect(isWrite('DELETE FROM x ...')).toBe(true);

    // Lower case
    expect(isWrite('insert into x ...')).toBe(true);
    expect(isWrite('update x set ...')).toBe(true);
    expect(isWrite('delete from x ...')).toBe(true);

    // Mixed case
    expect(isWrite('iNsErT INTO x ...')).toBe(true);
    expect(isWrite('uPdAtE x SET ...')).toBe(true);
    expect(isWrite('DeLeTe FROM x ...')).toBe(true);

    // Leading whitespace (spaces, tabs, newlines, carriage returns)
    expect(isWrite('   \t\n\r  INSERT INTO x ...')).toBe(true);
    expect(isWrite('\n\r  update x set ...')).toBe(true);
    expect(isWrite('\t\tDELETE FROM x ...')).toBe(true);

    // Non-write queries
    expect(isWrite('SELECT 1')).toBe(false);
    expect(isWrite('  select * from users')).toBe(false);
    expect(isWrite('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(false);
    expect(isWrite('CREATE TABLE foo (id INT)')).toBe(false);
    expect(isWrite('DROP TABLE foo')).toBe(false);
    expect(isWrite('EXPLAIN SELECT 1')).toBe(false);

    // Short or empty strings
    expect(isWrite('')).toBe(false);
    expect(isWrite('   ')).toBe(false);
    expect(isWrite('\t\n')).toBe(false);
    expect(isWrite('INS')).toBe(false);
    expect(isWrite('UPD')).toBe(false);
    expect(isWrite('DEL')).toBe(false);
    expect(isWrite('INSER')).toBe(false);
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

    expect(observed).toEqual([{ signal }, { signal, batchSize: 32 }]);
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
