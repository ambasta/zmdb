import { createQueryCompiler } from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

import { mssql, mssqlDriver, type MssqlPool, type MssqlRequest, type MssqlTransaction } from './index.js';

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

describe('mssqlDriver (#672)', () => {
  it('binds parameters as p1 through pn', async () => {
    const pool = new RecordingPool();
    const configured: RecordingRequest[] = [];
    const driver = mssqlDriver(pool, {
      queryTelemetry: true,
      configureRequest: request => {
        if (request instanceof RecordingRequest) configured.push(request);
      },
    });
    const query = createQueryCompiler(mssql)
      .selectFrom('users')
      .where('email', '=', 'a@b.com')
      .andWhere('active', '=', true)
      .compile();

    await expect(driver.execute(query)).resolves.toEqual([{ id: 7 }]);
    expect(driver.dialect).toBe(mssql);
    expect(driver.queryTelemetry).toBe(true);
    expect(configured).toEqual([pool.requests[0]]);
    expect(pool.requests[0]).toMatchObject({
      text: 'SELECT * FROM [users] WHERE [email] = @p1 AND [active] = @p2',
      inputs: [
        { name: 'p1', value: 'a@b.com' },
        { name: 'p2', value: true },
      ],
    });
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

  it('binds Dates as ISO instants so DATETIMEOFFSET keeps millisecond precision', async () => {
    const pool = new RecordingPool();
    const instant = new Date('2026-09-05T12:34:56.789Z');

    await mssqlDriver(pool).execute({
      text: 'SELECT CAST(@p1 AS DATETIMEOFFSET(3)) AS [value]',
      parameters: [instant],
    });

    expect(pool.requests[0]?.inputs).toEqual([
      {
        name: 'p1',
        value: '2026-09-05T12:34:56.789Z',
      },
    ]);
  });

  it('pins requests to one node-mssql transaction', async () => {
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

  it('preserves the callback failure when rollback also fails', async () => {
    const transaction: MssqlTransaction = {
      begin: async () => undefined,
      commit: async () => undefined,
      rollback: async () => {
        throw new Error('rollback failed');
      },
      request: () => new RecordingRequest(),
    };
    const driver = mssqlDriver({
      request: () => new RecordingRequest(),
      transaction: () => transaction,
    });

    await expect(
      driver.transaction(async () => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
  });

  it('refuses an already-aborted request before allocating a node-mssql Request', async () => {
    const pool = new RecordingPool();
    const controller = new AbortController();
    controller.abort(new Error('cancelled before dispatch'));

    await expect(
      mssqlDriver(pool).execute(
        { text: 'SELECT 1', parameters: [] },
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow('cancelled before dispatch');
    expect(pool.requests).toEqual([]);
  });
});
