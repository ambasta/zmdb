import { createQueryCompiler } from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

import { Users } from '../typed-methods/fixtures.js';
import { mssqlDriver, type MssqlPool, type MssqlRequest, type MssqlTransaction } from './mssql.js';

class RecordingRequest implements MssqlRequest {
  readonly inputs: { readonly name: string; readonly value: unknown }[] = [];
  text = '';

  input(name: string, value: unknown): MssqlRequest {
    this.inputs.push({ name, value });
    return this;
  }

  async query(text: string): Promise<{ readonly recordset: readonly Record<string, unknown>[] }> {
    this.text = text;
    return { recordset: [{ id: 7 }] };
  }
}

class RecordingPool implements MssqlPool {
  readonly requests: RecordingRequest[] = [];
  readonly transactions: RecordingTransaction[] = [];

  request(): RecordingRequest {
    const request = new RecordingRequest();
    this.requests.push(request);
    return request;
  }

  transaction(): RecordingTransaction {
    const transaction = new RecordingTransaction();
    this.transactions.push(transaction);
    return transaction;
  }
}

class RecordingTransaction implements MssqlTransaction {
  readonly events: string[] = [];
  readonly requests: RecordingRequest[] = [];

  async begin(): Promise<void> {
    this.events.push('begin');
  }

  async commit(): Promise<void> {
    this.events.push('commit');
  }

  async rollback(): Promise<void> {
    this.events.push('rollback');
  }

  request(): RecordingRequest {
    this.events.push('request');
    const request = new RecordingRequest();
    this.requests.push(request);
    return request;
  }
}

describe('mssqlDriver (#508)', () => {
  it('binds the positional parameter array as p1 through pn without @ prefixes', async () => {
    const pool = new RecordingPool();
    const driver = mssqlDriver(pool);
    const query = createQueryCompiler('mssql')
      .selectFrom('users')
      .where('email', '=', 'a@b.com')
      .andWhere('active', '=', true)
      .compile();

    const rows = await driver.execute(query);
    const request = pool.requests[0];

    expect(driver.dialect).toBe('mssql');
    expect(request?.text).toBe('SELECT * FROM [users] WHERE [email] = @p1 AND [active] = @p2');
    expect(request?.inputs).toEqual([
      { name: 'p1', value: 'a@b.com' },
      { name: 'p2', value: true },
    ]);
    expect(rows).toEqual([{ id: 7 }]);
  });

  it('returns an empty row list when node-mssql reports no recordset', async () => {
    const request: MssqlRequest = {
      input: () => request,
      query: async () => ({}),
    };
    const transaction = new RecordingTransaction();
    const driver = mssqlDriver({ request: () => request, transaction: () => transaction });

    await expect(driver.execute({ text: 'UPDATE [users] SET [active] = 1', parameters: [] })).resolves.toEqual([]);
  });

  it('pins every transaction query to one node-mssql transaction and rolls back on failure', async () => {
    const pool = new RecordingPool();
    const driver = mssqlDriver(pool);

    await expect(
      driver.transaction(async transaction => {
        await transaction.execute({ text: 'CREATE TABLE [probe] ([id] INT)', parameters: [] });
        await transaction.execute({ text: 'INSERT INTO [probe] ([id]) VALUES (@p1)', parameters: [1] });
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');

    const transaction = pool.transactions[0];
    expect(pool.requests).toEqual([]);
    expect(transaction?.events).toEqual(['begin', 'request', 'request', 'rollback']);
    expect(transaction?.requests.map(request => request.text)).toEqual([
      'CREATE TABLE [probe] ([id] INT)',
      'INSERT INTO [probe] ([id]) VALUES (@p1)',
    ]);
    expect(transaction?.requests[1]?.inputs).toEqual([{ name: 'p1', value: 1 }]);
  });

  it('commits a successful node-mssql transaction', async () => {
    const pool = new RecordingPool();
    const driver = mssqlDriver(pool);

    await driver.transaction(async transaction => {
      await transaction.execute({ text: 'SELECT @p1 AS [value]', parameters: [7] });
    });

    expect(pool.transactions[0]?.events).toEqual(['begin', 'request', 'commit']);
  });

  it('orders repository first-row reads before SQL Server OFFSET/FETCH', async () => {
    const pool = new RecordingPool();
    const repository = new Users(mssqlDriver(pool), 'mssql');
    const noChanges = {};

    await repository.findById(7);
    await repository.findOne({ email: 'a@b.com' });
    await repository.update(7, noChanges);

    expect(pool.requests.map(request => request.text)).toEqual([
      'SELECT * FROM [users] WHERE [id] = @p1 ORDER BY [id] ASC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY',
      'SELECT * FROM [users] WHERE [email] = @p1 ORDER BY [id] ASC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY',
      'SELECT * FROM [users] WHERE [id] = @p1 ORDER BY [id] ASC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY',
    ]);
  });
});
