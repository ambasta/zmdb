// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createToken } from '@zmdb/app/di';
import { Module } from '@zmdb/app/modules';
// Application-level coverage for the connection-ownership contract published on
// docs-site/content/connections-and-shutdown.md. That page makes four claims a reader will act
// on, and each one is a separate failure mode in production:
//
//   1. no zmdb API closes the client you passed to a driver;
//   2. a `Pool` registered as a provider is therefore never closed — it has no `onShutdown`, so
//      the lifecycle has nothing to call, and the process exits holding a socket;
//   3. the owner that created the pool closes it LAST, because reverse-construction-order teardown
//      puts a dependency after every dependent, so a final write in a dependent's `onShutdown`
//      still has a live pool;
//   4. extensions stop before any `onShutdown` hook, and only they receive the `graceMs` budget.
//
// ./outbox-shutdown.spec.ts asserts the ordering rule itself with bare recorder objects. This file
// asserts it through a REAL `postgresDriver`, because claim 1 is a statement about that driver: a
// hand-written stand-in for it could not fail the test the way a future `driver.end()` would.
import { postgresDriver, type PgQueryable } from '@zmdb/postgres';
import { describe, expect, it } from 'vitest';

import { createApplication, type ApplicationExtension } from './index.js';
import type { OnShutdown } from './lifecycle.js';

/**
 * A pool-shaped queryable that records every statement and refuses to serve one after `end()`.
 *
 * `postgresDriver` duck-types a pool on `connect` + `totalCount` + `idleCount`, so those three
 * members are what make this object take the pool paths (checked-out transactions and cursors)
 * rather than the single-client ones. The `end()` refusal is the part that matters here: it is how
 * a hook that runs after the pool closed fails loudly instead of passing quietly.
 */
class RecordingPool {
  readonly log: string[] = [];
  readonly totalCount = 1;
  readonly idleCount = 1;
  ends = 0;

  async query(argument: string | { readonly text: string }): Promise<{ rows: Record<string, unknown>[] }> {
    if (this.ends > 0) throw new Error('Cannot use a pool after calling end on the pool');
    this.log.push(typeof argument === 'string' ? argument : argument.text);
    return { rows: [] };
  }

  async connect(): Promise<{ query: RecordingPool['query']; release(): void }> {
    if (this.ends > 0) throw new Error('Cannot use a pool after calling end on the pool');
    return { query: this.query.bind(this), release: () => this.log.push('release') };
  }

  async end(): Promise<void> {
    this.ends += 1;
    this.log.push('end');
  }
}

const SELECT_ONE = {
  effects: { operation: 'SELECT', requiresPrimary: false, returnsRows: true },
  text: 'SELECT 1',
  parameters: [],
} as const;

describe('pool ownership across an application lifecycle (T1.7)', () => {
  it('exposes no way for a driver to close the client it was given', async () => {
    const pool = new RecordingPool();
    const driver = postgresDriver(pool as unknown as PgQueryable);

    // The published contract is "there is no `driver.close()`, no `driver.end()`". Asserted on the
    // object rather than on the type, so removing the methods from an interface while leaving them
    // on the implementation cannot pass.
    expect(Reflect.has(driver, 'end')).toBe(false);
    expect(Reflect.has(driver, 'close')).toBe(false);
    expect(Reflect.has(driver, Symbol.asyncDispose)).toBe(false);

    await driver.execute(SELECT_ONE);
    await driver.transaction(async transaction => transaction.execute(SELECT_ONE));

    expect(pool.ends).toBe(0);
    expect(pool.log).toEqual(['SELECT 1', 'BEGIN', 'SELECT 1', 'COMMIT', 'release']);
  });

  it('never closes a pool registered as a bare provider, which is why the page insists on an owner', async () => {
    const pool = new RecordingPool();
    const POOL = createToken<RecordingPool>('POOL');

    @Module({ providers: [{ token: POOL, useValue: pool }] })
    class DatabaseModule {}

    const app = createApplication(DatabaseModule);
    await app.init();
    await app[Symbol.asyncDispose]();

    // Not a bug to fix here — a `Pool` has no `onShutdown`, and inventing one by reflection is how
    // a library ends up closing a pool its caller still needs. It is the documented trap, and the
    // reason the page's example wraps the pool in a class that does have the hook.
    expect(pool.ends).toBe(0);
  });

  it('closes the pool from its owner, after every dependent has flushed through it', async () => {
    const pool = new RecordingPool();
    const order: string[] = [];

    class Database implements OnShutdown {
      readonly driver = postgresDriver(pool as unknown as PgQueryable);

      async onShutdown(): Promise<void> {
        order.push('pool');
        await pool.end();
      }
    }

    class Repository implements OnShutdown {
      constructor(private readonly database: Database) {}

      async onShutdown(): Promise<void> {
        order.push('repository');
        // The load-bearing assertion of the whole page: a dependent's last write must still find a
        // live pool. Reversed ordering makes this throw with the pool's own end-of-life message.
        await this.database.driver.execute(SELECT_ONE);
      }
    }

    const DATABASE = createToken<Database>('DATABASE');
    const REPOSITORY = createToken<Repository>('REPOSITORY');

    // DATABASE is declared first on purpose, so declaration order cannot be what makes this pass:
    // resolving REPOSITORY constructs Database first, and shutdown reverses construction.
    @Module({
      providers: [
        { token: DATABASE, useFactory: () => new Database() },
        { token: REPOSITORY, useFactory: c => new Repository(c.resolve(DATABASE)) },
      ],
    })
    class DatabaseModule {}

    const app = createApplication(DatabaseModule);
    app.container.resolve(REPOSITORY);
    await app.init();
    await app[Symbol.asyncDispose]();

    expect(order).toEqual(['repository', 'pool']);
    expect(pool.log).toEqual(['SELECT 1', 'end']);
    expect(pool.ends).toBe(1);
  });

  it('closes the pool even when an earlier hook fails, and reports the failure afterwards', async () => {
    const pool = new RecordingPool();

    class Database implements OnShutdown {
      onShutdown(): Promise<void> {
        return pool.end();
      }
    }
    class Broken implements OnShutdown {
      constructor(readonly database: Database) {}

      onShutdown(): void {
        throw new Error('flush failed');
      }
    }

    const DATABASE = createToken<Database>('DATABASE');
    const BROKEN = createToken<Broken>('BROKEN');

    @Module({
      providers: [
        { token: DATABASE, useFactory: () => new Database() },
        { token: BROKEN, useFactory: c => new Broken(c.resolve(DATABASE)) },
      ],
    })
    class DatabaseModule {}

    const app = createApplication(DatabaseModule);
    app.container.resolve(BROKEN);
    await app.init();

    // "Errors do not abort the sequence": the pool must be closed even though the hook above it
    // threw, and the throw must not be swallowed either.
    await expect(app[Symbol.asyncDispose]()).rejects.toThrow('flush failed');
    expect(pool.ends).toBe(1);
  });

  it('stops extensions before any shutdown hook, and gives only them the grace budget', async () => {
    const pool = new RecordingPool();
    const order: string[] = [];
    const budgets: number[] = [];

    // Stands in for `jobsExtension`, which is the extension this ordering exists for: a worker that
    // is still draining must not lose the pool underneath it. Kept local because @zmdb/app cannot
    // depend on @zmdb/jobs — the dependency runs the other way.
    const jobs: ApplicationExtension = {
      name: 'jobs-stand-in',
      start: () => {
        order.push('jobs:start');
      },
      stop: ({ graceMs }) => {
        budgets.push(graceMs);
        order.push('jobs:stop');
      },
    };

    class Database implements OnShutdown {
      async onShutdown(): Promise<void> {
        order.push('pool');
        await pool.end();
      }
    }
    const DATABASE = createToken<Database>('DATABASE');

    @Module({ providers: [{ token: DATABASE, useFactory: () => new Database() }] })
    class DatabaseModule {}

    const app = createApplication(DatabaseModule, { extensions: [jobs], graceMs: 1_234 });
    app.container.resolve(DATABASE);
    await app.init();
    await app[Symbol.asyncDispose]();

    expect(order).toEqual(['jobs:start', 'jobs:stop', 'pool']);
    // The extension receives what is left of the budget; a hook receives no argument at all, so
    // nothing bounds `pool.end()` and the page tells the reader to keep a hard-exit timer.
    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toBeGreaterThan(0);
    expect(budgets[0]).toBeLessThanOrEqual(1_234);
    expect(Database.prototype.onShutdown).toHaveLength(0);
  });
});
