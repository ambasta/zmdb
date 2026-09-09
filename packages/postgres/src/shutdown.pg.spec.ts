// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Real-PostgreSQL coverage for the shutdown half of
// docs-site/content/connections-and-shutdown.md. ../../app/src/pool-shutdown.spec.ts asserts who
// calls `end()` and in what order; this file asserts what `end()` does to work that is already
// running, which is the half no fake can establish — every claim here is `pg` behaviour, so a
// stand-in pool would only be asserting itself.
//
// The page tells a reader to stop accepting traffic BEFORE disposing, and that instruction is only
// worth following because of the third test: a statement still waiting for a free client when the
// pool ends never settles at all. It is not rejected. Whoever awaited it waits forever, which is
// what a hung deploy looks like from the inside.
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { postgresDriver } from './index.js';
import { POSTGRES_CONNECTION, usePostgres } from './testing/fixture.js';

const pg = usePostgres(async () => {});
const opened: Pool[] = [];

/**
 * A pool this file owns, so ending it cannot disturb the shared fixture pool. Warmed on the way
 * out: with a live idle client, a checkout is immediate, which is what lets these tests distinguish
 * "holds a connection" from "queued for one" without sleeping on a wall clock.
 */
async function warmPool(max: number): Promise<Pool> {
  const pool = new Pool({ connectionString: POSTGRES_CONNECTION, max });
  opened.push(pool);
  await pool.query('SELECT 1');
  return pool;
}

const select = (text: string) => ({
  effects: { operation: 'SELECT', requiresPrimary: false, returnsRows: true } as const,
  text,
  parameters: [],
});

/** Long enough to still be running while the assertions below execute; no timing is asserted. */
const SLEEP = select('SELECT pg_sleep(0.4) IS NULL AS slept');

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(async () => {
  // Every test ends its own pool; this is the cleanup path for a test that failed before it got
  // there. `end()` on an already-ended pool rejects, hence `allSettled`, and it never resolves while
  // a client is checked out, hence the bound — a leaked pool must not turn a failed assertion into
  // a ten-second hook timeout that hides it.
  await Promise.race([
    Promise.allSettled(opened.splice(0).map(pool => pool.end())),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
});

describe('postgresDriver: a pool closing under in-flight work (T1.7)', () => {
  it('lets a dispatched statement finish, and resolves end() after it', async () => {
    if (!pg.reachable()) return;
    const pool = await warmPool(2);
    const driver = postgresDriver(pool);
    const settled: string[] = [];

    const inFlight = driver.execute(SLEEP).then(rows => {
      settled.push('query');
      return rows;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(pool.waitingCount).toBe(0);
    expect(pool.totalCount - pool.idleCount).toBe(1);

    const ended = pool.end().then(() => settled.push('end'));
    await expect(inFlight).resolves.toEqual([{ slept: false }]);
    await ended;

    // Ordering, not duration: the point is that `end()` waits for the checked-out client to come
    // back, not that a sleeping statement takes any particular time.
    expect(settled).toEqual(['query', 'end']);
  });

  it('lets an open transaction commit, and releases its client to end()', async () => {
    if (!pg.reachable()) return;
    const pool = await warmPool(2);
    const driver = postgresDriver(pool);
    const settled: string[] = [];
    const entered = deferred();
    const proceed = deferred();

    const work = driver
      .transaction(async transaction => {
        const rows = await transaction.execute(select('SELECT txid_current() IS NOT NULL AS open'));
        entered.resolve();
        await proceed.promise;
        return rows;
      })
      .then(rows => {
        settled.push('transaction');
        return rows;
      });

    await entered.promise;
    // Sampled rather than asserted here: a failed assertion while the callback is parked would
    // leave the transaction open, and then `end()` never resolves and the failure arrives as a
    // cleanup timeout instead of as itself.
    const checkedOut = pool.totalCount - pool.idleCount;
    const waiting = pool.waitingCount;

    const ended = pool.end().then(() => settled.push('end'));
    proceed.resolve();
    await expect(work).resolves.toEqual([{ open: true }]);
    await ended;

    // A transaction holds exactly one client for its whole callback — the sizing rule the page
    // states — and `end()` could not finish until that one came back.
    expect(checkedOut).toBe(1);
    expect(waiting).toBe(0);
    expect(settled).toEqual(['transaction', 'end']);
  });

  it('drops a statement that was still queued: it never settles, and end() does not wait for it', async () => {
    if (!pg.reachable()) return;
    const pool = await warmPool(1);
    const driver = postgresDriver(pool);
    let outcome = 'pending';

    // `max: 1` and the first statement owns that client, so the second sits in the pool's pending
    // queue rather than on the wire.
    const holding = driver.execute(SLEEP);
    await new Promise(resolve => setImmediate(resolve));
    expect(pool.waitingCount).toBe(0);

    const queued = driver.execute(select('SELECT 1 AS never')).then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );
    expect(pool.waitingCount).toBe(1);

    await pool.end();
    await expect(holding).resolves.toEqual([{ slept: false }]);
    await Promise.race([queued, new Promise(resolve => setTimeout(resolve, 250))]);

    // Neither resolved nor rejected: ending the pool discarded the queue without telling anyone.
    // This is the failure the page exists to warn about, and the reason the documented order stops
    // traffic before it disposes the application.
    expect(outcome).toBe('pending');
  });

  it('refuses a statement issued after the pool ended, rather than hanging', async () => {
    if (!pg.reachable()) return;
    const pool = await warmPool(1);
    const driver = postgresDriver(pool);
    await pool.end();

    // The one case that is loud: a query arriving after `end()` completed gets an error, so a
    // handler still running past shutdown fails instead of stalling.
    await expect(driver.execute(select('SELECT 1 AS ready'))).rejects.toThrow(/after calling end/i);
  });
});
