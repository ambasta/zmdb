import { describe, expect, it, vi } from 'vitest';

import { mysql } from './dialect.js';
import { mysqlFamilyDriver, type MysqlConnection, type MysqlPool, type MysqlQueryable } from './driver.js';

const query = {
  text: 'SELECT ? AS value',
  parameters: [42],
} as const;

describe('mysql2 structural driver', () => {
  it('executes positional parameters through mysql2', async () => {
    const execute = vi.fn(async () => [[{ value: 42 }], []] as const);
    const driver = mysqlFamilyDriver(mysql, { execute });

    await expect(driver.execute(query)).resolves.toEqual([{ value: 42 }]);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith('SELECT ? AS value', [42]);
  });

  it('pins a transaction to one acquired connection', async () => {
    const events: string[] = [];
    const connection: MysqlConnection = {
      async execute(sql) {
        events.push(`execute:${sql}`);
        return [[{ connection: 'pinned' }], []];
      },
      async beginTransaction() {
        events.push('begin');
      },
      async commit() {
        events.push('commit');
      },
      async rollback() {
        events.push('rollback');
      },
      release() {
        events.push('release');
      },
    };
    const pool: MysqlPool = {
      async execute() {
        throw new Error('the pool must not execute a transaction query');
      },
      async getConnection() {
        events.push('acquire');
        return connection;
      },
    };

    const driver = mysqlFamilyDriver(mysql, pool);
    await expect(
      driver.transaction(transaction => transaction.execute({ text: 'SELECT 1', parameters: [] })),
    ).resolves.toEqual([{ connection: 'pinned' }]);

    expect(events).toEqual(['acquire', 'begin', 'execute:SELECT 1', 'commit', 'release']);
  });

  it('rolls back and releases the same acquired connection when the callback fails', async () => {
    const events: string[] = [];
    const connection: MysqlConnection = {
      async execute() {
        return [[], []];
      },
      async beginTransaction() {
        events.push('begin');
      },
      async commit() {
        events.push('commit');
      },
      async rollback() {
        events.push('rollback');
      },
      release() {
        events.push('release');
      },
    };
    const pool: MysqlPool = {
      async execute() {
        return [[], []];
      },
      async getConnection() {
        events.push('acquire');
        return connection;
      },
    };

    const driver = mysqlFamilyDriver(mysql, pool);
    await expect(
      driver.transaction(() => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
    expect(events).toEqual(['acquire', 'begin', 'rollback', 'release']);
  });

  it('returns affectedRows and insertId without inventing returned entities', async () => {
    const client: MysqlQueryable = {
      async execute() {
        return [{ affectedRows: 2, insertId: 9007199254740993n, warningStatus: 0 }, []];
      },
    };
    const driver = mysqlFamilyDriver(mysql, client);

    await expect(driver.executeResult({ text: 'UPDATE users SET active = 1', parameters: [] })).resolves.toEqual({
      kind: 'command',
      affectedRows: 2,
      insertId: 9007199254740993n,
      warningStatus: 0,
    });
    await expect(driver.execute({ text: 'UPDATE users SET active = 1', parameters: [] })).resolves.toEqual([]);
  });

  it('refuses an unsafe numeric insertId instead of accepting precision loss', async () => {
    const driver = mysqlFamilyDriver(mysql, {
      async execute() {
        return [{ affectedRows: 1, insertId: 9_007_199_254_740_992 }, []];
      },
    });

    await expect(driver.executeResult({ text: 'INSERT INTO users () VALUES ()', parameters: [] })).rejects.toThrow(
      'insertId must be a safe integer, string, or bigint',
    );
  });

  it('preserves bigint without number precision loss', async () => {
    const exact = '9007199254740993';
    const driver = mysqlFamilyDriver(mysql, {
      async execute() {
        return [[{ id: exact }], []];
      },
    });

    const rows = await driver.execute({ text: 'SELECT id FROM ids', parameters: [] });
    expect(rows).toEqual([{ id: exact }]);
    expect(rows[0]?.id).not.toBe(Number(exact));
  });

  it('honors a signal that was already aborted without dispatching', async () => {
    const execute = vi.fn(async () => [[], []] as const);
    const controller = new AbortController();
    controller.abort(new Error('stop'));

    await expect(mysqlFamilyDriver(mysql, { execute }).execute(query, { signal: controller.signal })).rejects.toThrow(
      'stop',
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
