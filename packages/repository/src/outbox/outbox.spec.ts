// Tests freeze (#593) for the outbox's runtime half — packages/query-compiler/src/outbox/SPEC.md
// §9 items 1, 2, 6, 7, 11 and 12, plus §8's documented duplicate.
//
// §1 of that file puts `OutboxRow`, `outboxWriter` and `createOutboxDispatcher` here rather than
// in @zmdb/query-compiler, because they need `Table<…>`/`Sql<…>` and `Driver` and that package has
// no dependencies. Items 3, 4, 5, 8, 9 and 10 are the SQL half and live in
// ../../../query-compiler/src/outbox/outbox.spec.ts.
//
// THE IDIOM, identical to the sibling file: nothing in ./index.ts exists, so every frozen export
// is declared locally and initialised from `unimplemented()`, which throws. Any test that drives
// one is `it.fails` — the body typechecks against the signature the implementation must have, the
// throw keeps the assertion in the summary line rather than hiding it behind `.skip`, and each one
// records the output produced today so it cannot later pass for the wrong reason. When ./index.ts
// lands, delete the frozen-surface block, use the commented-out import, and flip `it.fails` to
// `it` one test at a time.
//
// Nothing here waits on a timer it does not control. The rollback and commit tests use a real
// node:sqlite database because the guarantee is a property of the database transaction (§6); every
// dispatcher test uses a scripted fake `Driver` plus `vi.useFakeTimers()`, because a concurrency or
// backoff test that depends on wall-clock timing is a flake.
import { DatabaseSync } from 'node:sqlite';

import { createQueryCompiler } from '@zmdb/query-compiler';
import type { CompiledQuery } from '@zmdb/query-compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sqliteDriver } from '../drivers/sqlite.js';
import type { Driver } from '../index.js';
import { createTransactionalDb } from '../transactions/index.js';
import type { TransactionContext, TxConnection } from '../transactions/index.js';

// ---------------------------------------------------------------------------
// the frozen surface — SPEC §5 and §6, verbatim. Delete when ./index.ts lands and use:
//
//   import {
//     createOutboxDispatcher,
//     outboxWriter,
//     type DeadOutboxRow,
//     type OutboxDispatcher,
//     type OutboxDispatcherOptions,
//     type OutboxWriter,
//   } from './index.js';
// ---------------------------------------------------------------------------
function unimplemented(what: string): never {
  throw new Error(`unimplemented: ${what}`);
}

interface DeadOutboxRow {
  readonly id: string;
  readonly topic: string;
  readonly payload: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

interface OutboxDispatcherOptions {
  readonly driver: Driver;
  readonly publish: (topic: string, payload: string) => Promise<void>;
  readonly batch?: number;
  readonly leaseMs?: number;
  readonly idleMs?: number;
  readonly maxIdleMs?: number;
  readonly maxAttempts?: number;
  readonly backoffMs?: (attempts: number) => number;
  readonly onDead?: (row: DeadOutboxRow) => void | Promise<void>;
}

interface OutboxDispatcher {
  runOnce(): Promise<{ readonly claimed: number; readonly delivered: number; readonly failed: number }>;
  start(): void;
  onShutdown(): Promise<void>;
}

interface OutboxWriter {
  write(topic: string, payload: string): Promise<string>;
}

const createOutboxDispatcher: (opts: OutboxDispatcherOptions) => OutboxDispatcher = () =>
  unimplemented('createOutboxDispatcher');

const outboxWriter: (tx: TransactionContext) => OutboxWriter = () => unimplemented('outboxWriter');

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
const NOW = new Date('2026-06-01T00:00:00.000Z');
const qb = createQueryCompiler('sqlite');

function txConn(db: DatabaseSync): TxConnection {
  const driver = sqliteDriver(db);
  return {
    async raw(sql: string) {
      db.exec(sql);
    },
    execute: q => driver.execute(q),
  };
}

function outboxDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE zmdb_outbox (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    lease_owner TEXT NOT NULL DEFAULT '',
    lease_until TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
    delivered_at TEXT,
    last_error TEXT
  )`);
  db.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
  return db;
}

function rows(db: DatabaseSync, table: string): readonly Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM ${table}`).all() as readonly Record<string, unknown>[];
}

/**
 * A `Driver` whose answers are scripted and whose calls are recorded. This is the deterministic
 * interleaving vehicle for every dispatcher test: the dispatcher's next step depends only on what
 * this returns, so an assertion about claiming, backoff or shutdown is a statement about the
 * dispatcher and not about which promise happened to settle first.
 *
 * Queries are matched on a substring rather than on exact SQL, because the SQL is the sibling
 * file's assertion and duplicating it here would make one change break two suites.
 */
interface FakeDriver extends Driver {
  readonly calls: readonly CompiledQuery[];
  reply(match: string, rows: readonly Record<string, unknown>[]): void;
  countMatching(match: string): number;
}

function fakeDriver(): FakeDriver {
  const calls: CompiledQuery[] = [];
  const replies = new Map<string, readonly Record<string, unknown>[]>();
  return {
    dialect: 'sqlite',
    calls,
    reply(match, rowsForMatch) {
      replies.set(match, rowsForMatch);
    },
    countMatching(match) {
      return calls.filter(c => c.text.includes(match)).length;
    },
    execute(query) {
      calls.push(query);
      for (const [match, rowsForMatch] of replies) {
        if (query.text.includes(match)) return Promise.resolve(rowsForMatch);
      }
      return Promise.resolve([]);
    },
  };
}

/** One pending row, in the shape §4.2's read-back returns. */
const claimedRow = (id: string, topic = 'post.published', attempts = 0) => ({
  id,
  topic,
  payload: `{"id":"${id}"}`,
  attempts,
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// §9 items 1 and 2 — the guarantee, against a real database
// ===========================================================================
describe('outbox: the transactional guarantee (#593, SPEC §6, §9 items 1 and 2)', () => {
  it.fails('an outbox row written in a transaction is gone after a rollback', async () => {
    // actual today: Error: unimplemented: outboxWriter.
    //
    // The headline assertion of the epic, and the only shape of it that means anything: a real
    // driver, a real BEGIN, a real ROLLBACK, and the table read back outside the transaction. A
    // mocked transaction would assert the mock.
    const db = outboxDb();
    const dbx = createTransactionalDb(txConn(db));

    await expect(
      dbx.transaction(async tx => {
        await tx.execute({ text: 'INSERT INTO posts(id, title) VALUES (?, ?)', parameters: [1, 'hi'] });
        await outboxWriter(tx).write('post.published', '{"id":1}');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(rows(db, 'zmdb_outbox')).toEqual([]);
    expect(rows(db, 'posts')).toEqual([]);
  });

  it.fails('an outbox row written in a transaction survives a commit', async () => {
    // actual today: Error: unimplemented: outboxWriter.
    //
    // The other half, so the rollback test cannot pass by writing nothing at all. `write` returns
    // the id (SPEC §6) and the id is generated before the insert (§2.4), so this also pins that
    // there is no RETURNING in the write path.
    const db = outboxDb();
    const dbx = createTransactionalDb(txConn(db));

    const id = await dbx.transaction(async tx => {
      await tx.execute({ text: 'INSERT INTO posts(id, title) VALUES (?, ?)', parameters: [1, 'hi'] });
      return outboxWriter(tx).write('post.published', '{"id":1}');
    });

    const stored = rows(db, 'zmdb_outbox');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.['id']).toBe(id);
    expect(stored[0]?.['status']).toBe('pending');
    expect(stored[0]?.['attempts']).toBe(0);
    expect(stored[0]?.['topic']).toBe('post.published');
    // §2.4: a text id, generated in the application with globalThis.crypto.randomUUID().
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it.fails('the stored payload is byte-identical to what was written', async () => {
    // actual today: Error: unimplemented: outboxWriter.
    //
    // SPEC §2.3: `payload` is `text`, not `json`, so key order, number formatting and unicode
    // escaping are the caller's and a payload stays comparable to itself. A `json` column would
    // round-trip through the driver's own JSON handling and this assertion would fail.
    const db = outboxDb();
    const dbx = createTransactionalDb(txConn(db));
    const payload = '{"b":1,"a":2,"n":1.50,"u":"\\u00e9"}';

    await dbx.transaction(async tx => outboxWriter(tx).write('t', payload));

    expect(rows(db, 'zmdb_outbox')[0]?.['payload']).toBe(payload);
  });

  it('a TransactionContext joins a repository with no adapter', () => {
    // SPEC §6's closing claim, which is why nothing new is needed to put a repository and the
    // outbox in one transaction: `withTransaction(tx: { execute: Driver['execute'] })` is
    // structural. The type-level half is in ./outbox.type-test.ts; this is the runtime half.
    const db = outboxDb();
    const dbx = createTransactionalDb(txConn(db));
    expect(typeof dbx.transaction).toBe('function');
    const structural: { execute: Driver['execute'] } = { execute: () => Promise.resolve([]) };
    expect(typeof structural.execute).toBe('function');
  });
});

// ===========================================================================
// §9 items 6 and 7 — failure, backoff and the poison row
// ===========================================================================
describe('outbox: the dispatcher on failure (#593, SPEC §5, §9 items 6 and 7)', () => {
  it.fails('a failing publish backs off and stays pending', async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    //
    // SPEC §5: `attempts + 1`, `lastError`, `leaseUntil = now + backoffMs(attempts)`, and `status`
    // untouched. The backoff and the lease are the same column, so "invisible for the backoff" and
    // "claimed until" are one write.
    const driver = fakeDriver();
    driver.reply('SELECT "id" FROM "zmdb_outbox"', [{ id: 'r1' }]);
    driver.reply('"lease_owner" = ', [claimedRow('r1')]);

    const dispatcher = createOutboxDispatcher({
      driver,
      publish: () => Promise.reject(new Error('broker down')),
      maxAttempts: 10,
      backoffMs: attempts => attempts * 1000,
    });

    const report = await dispatcher.runOnce();
    expect(report).toEqual({ claimed: 1, delivered: 0, failed: 1 });

    const mark = driver.calls.at(-1);
    expect(mark?.text).toContain('"attempts"');
    expect(mark?.text).toContain('"last_error"');
    expect(mark?.text).toContain('"lease_until"');
    expect(mark?.text).not.toContain('"status"');
    expect(mark?.parameters).toContain('broker down');
  });

  it.fails('the default backoff is capped', async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    //
    // SPEC §5: `Math.min(2 ** attempts * 1000, 300_000)`. Uncapped exponential backoff on a row
    // that will eventually succeed becomes an outage of its own, so the cap is asserted rather
    // than the curve: attempt 9 is under the cap, attempt 20 is exactly at it.
    const driver = fakeDriver();
    driver.reply('SELECT "id" FROM "zmdb_outbox"', [{ id: 'r1' }]);
    driver.reply('"lease_owner" = ', [claimedRow('r1', 'post.published', 20)]);
    const dispatcher = createOutboxDispatcher({ driver, publish: () => Promise.reject(new Error('x')) });

    await dispatcher.runOnce();

    const mark = driver.calls.at(-1);
    const leaseUntil = mark?.parameters.find((p): p is Date => p instanceof Date);
    expect(leaseUntil).toBeInstanceOf(Date);
    expect((leaseUntil?.getTime() ?? 0) - NOW.getTime()).toBe(300_000);
  });

  it.fails('a row at maxAttempts goes dead, fires onDead once, and leaves the candidate set', async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    //
    // The poison-row assertion. SPEC §2.2: without a terminal state the dispatcher spins forever
    // on one bad row and delivers nothing else, so all three halves are asserted together —
    // `status = 'dead'` is written, `onDead` fires exactly once, and the next pass does not see it.
    const driver = fakeDriver();
    const dead: DeadOutboxRow[] = [];
    driver.reply('SELECT "id" FROM "zmdb_outbox"', [{ id: 'r1' }]);
    driver.reply('"lease_owner" = ', [claimedRow('r1', 'post.published', 9)]);

    const dispatcher = createOutboxDispatcher({
      driver,
      publish: () => Promise.reject(new Error('poison')),
      maxAttempts: 10,
      onDead: row => {
        dead.push(row);
      },
    });

    const first = await dispatcher.runOnce();
    expect(first).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(dead).toHaveLength(1);
    expect(dead[0]?.id).toBe('r1');
    expect(dead[0]?.attempts).toBe(10);
    expect(dead[0]?.lastError).toBe('poison');
    expect(driver.calls.at(-1)?.parameters).toContain('dead');

    // The row is now out of the candidate set, so the second pass claims nothing — and, crucially,
    // publish is not called again.
    driver.reply('SELECT "id" FROM "zmdb_outbox"', []);
    driver.reply('"lease_owner" = ', []);
    const second = await dispatcher.runOnce();
    expect(second).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(dead).toHaveLength(1);
  });

  it.fails('one permanently failing row does not stop the rest of the batch', async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    //
    // SPEC §5: marking is per row and outside any transaction, because the batch's rows are
    // independent and one failed publish must not roll back the successes. The anti-stall
    // assertion the issue body calls "the anti-stall test".
    const driver = fakeDriver();
    driver.reply('SELECT "id" FROM "zmdb_outbox"', [{ id: 'bad' }, { id: 'good' }]);
    driver.reply('"lease_owner" = ', [claimedRow('bad'), claimedRow('good')]);

    const published: string[] = [];
    const dispatcher = createOutboxDispatcher({
      driver,
      publish: (topic, payload) => {
        if (payload.includes('bad')) return Promise.reject(new Error('poison'));
        published.push(topic);
        return Promise.resolve();
      },
    });

    const report = await dispatcher.runOnce();
    expect(report).toEqual({ claimed: 2, delivered: 1, failed: 1 });
    expect(published).toEqual(['post.published']);
  });

  it.fails('a publish that resolves is marked delivered with a deliveredAt and no lastError', async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    // SPEC §5's first outcome row, and the "exactly once under normal operation" case the issue
    // body asks for. "Exactly once" here means one publish call, not a broker guarantee — see §8.
    const driver = fakeDriver();
    driver.reply('SELECT "id" FROM "zmdb_outbox"', [{ id: 'r1' }]);
    driver.reply('"lease_owner" = ', [claimedRow('r1')]);

    let publishes = 0;
    const dispatcher = createOutboxDispatcher({
      driver,
      publish: () => {
        publishes += 1;
        return Promise.resolve();
      },
    });

    expect(await dispatcher.runOnce()).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(publishes).toBe(1);
    const mark = driver.calls.at(-1);
    expect(mark?.parameters).toContain('delivered');
    expect(mark?.text).toContain('"delivered_at"');
    expect(mark?.text).not.toContain('"last_error"');
  });
});

// ===========================================================================
// SPEC §8 — the duplicate, asserted rather than wished away
// ===========================================================================
describe('outbox: at-least-once (#593, SPEC §8)', () => {
  it.fails('a crash between publish and mark delivers twice, which is the documented behaviour', async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    //
    // Not in §9's list; the issue body asks for it and §8 states it, so it is asserted rather than
    // left as prose. `publish` resolves, the process dies before the mark, the lease expires, and
    // the row is claimed and published again. The crash is modelled by the mark rejecting, because
    // from the row's point of view a mark that did not land and a process that died are the same
    // event. Two publishes is the CORRECT outcome here: the alternative — mark first — turns a
    // crash into a lost event, which §8 refuses.
    const driver = fakeDriver();
    driver.reply('SELECT "id" FROM "zmdb_outbox"', [{ id: 'r1' }]);
    driver.reply('"lease_owner" = ', [claimedRow('r1')]);

    const published: string[] = [];
    const dispatcher = createOutboxDispatcher({
      driver,
      publish: (_topic, payload) => {
        published.push(payload);
        return Promise.resolve();
      },
    });

    await dispatcher.runOnce().catch(() => undefined);
    // the lease lapses and the row is still pending, so the next pass sees it again
    vi.advanceTimersByTime(30_000);
    await dispatcher.runOnce().catch(() => undefined);

    expect(published).toHaveLength(2);
    expect(published[0]).toBe(published[1]);
  });
});

// ===========================================================================
// §9 items 11 and 12 — the loop and the shutdown
// ===========================================================================
describe('outbox: the dispatcher loop (#593, SPEC §5, §9 items 11 and 12)', () => {
  it.fails("the dispatcher's idle interval doubles to the cap and resets on work", async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    //
    // SPEC §5: an idle pass doubles `idleMs` up to `maxIdleMs`; a pass that claimed work polls
    // again immediately. Driven by `vi.useFakeTimers()`, so the assertion is on the schedule and
    // not on how long the test machine took.
    //
    // NOTE (see NOTES.md): `OutboxDispatcherOptions` has no clock or timer port — unlike
    // ../../../web/src/queues/SPEC.md §2's `Clock`. Fake timers are therefore the only way to
    // assert this, and that is a coupling to vitest the frozen surface should probably not force.
    const driver = fakeDriver();
    const dispatcher = createOutboxDispatcher({
      driver,
      publish: () => Promise.resolve(),
      idleMs: 1_000,
      maxIdleMs: 4_000,
    });

    dispatcher.start();
    const polls = () => driver.countMatching('SELECT "id" FROM "zmdb_outbox"');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(polls()).toBe(1);
    // idle, so the interval is now 2s: one more second buys nothing
    await vi.advanceTimersByTimeAsync(1_000);
    expect(polls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(polls()).toBe(2);
    // 4s, then the cap holds
    await vi.advanceTimersByTimeAsync(4_000);
    expect(polls()).toBe(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(polls()).toBe(4);

    // work resets it: a pass that claimed a row polls again with no idle wait
    driver.reply('SELECT "id" FROM "zmdb_outbox"', [{ id: 'r1' }]);
    driver.reply('"lease_owner" = ', [claimedRow('r1')]);
    await vi.advanceTimersByTimeAsync(4_000);
    const afterWork = polls();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(polls()).toBeGreaterThan(afterWork);

    await dispatcher.onShutdown();
  });

  it.fails('an empty outbox is not polled hot', async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    // The property the doubling exists for, asserted as a bound rather than as a schedule: over
    // one minute of idle time with idleMs 1s and maxIdleMs 30s the dispatcher must poll far fewer
    // than 60 times. An implementation that forgot to double polls 60.
    const driver = fakeDriver();
    const dispatcher = createOutboxDispatcher({
      driver,
      publish: () => Promise.resolve(),
      idleMs: 1_000,
      maxIdleMs: 30_000,
    });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await dispatcher.onShutdown();

    expect(driver.countMatching('SELECT "id" FROM "zmdb_outbox"')).toBeLessThan(10);
  });

  it.fails('shutdown stops claiming and does not wait for the lease', async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    //
    // SPEC §5: `onShutdown` stops claiming, waits for the in-flight batch, and does NOT wait for
    // the lease to expire — the rows it did not reach are still pending with a future leaseUntil
    // and are picked up leaseMs later by whatever is still running. Late is the correct failure;
    // the alternative is a shutdown that blocks on a broker.
    const driver = fakeDriver();
    driver.reply('SELECT "id" FROM "zmdb_outbox"', [{ id: 'r1' }, { id: 'r2' }]);
    driver.reply('"lease_owner" = ', [claimedRow('r1'), claimedRow('r2')]);

    let release = (): void => undefined;
    const inFlight = new Promise<void>(resolve => {
      release = resolve;
    });
    let started = 0;
    const dispatcher = createOutboxDispatcher({
      driver,
      publish: async () => {
        started += 1;
        await inFlight;
      },
      leaseMs: 30_000,
    });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toBeGreaterThan(0);

    const shutdown = dispatcher.onShutdown();
    const pollsAtShutdown = driver.countMatching('SELECT "id" FROM "zmdb_outbox"');
    release();
    await shutdown;

    // no further claiming after onShutdown resolved...
    expect(driver.countMatching('SELECT "id" FROM "zmdb_outbox"')).toBe(pollsAtShutdown);
    // ...and it did not sit on the lease
    await vi.advanceTimersByTimeAsync(60_000);
    expect(driver.countMatching('SELECT "id" FROM "zmdb_outbox"')).toBe(pollsAtShutdown);
  });

  it.fails('shutdown resolves without marking the rows it never published', async () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    // The other half of §5's shutdown sentence: an unreached row must be left alone, so it is
    // still `pending` with a future `leaseUntil` and another dispatcher gets it leaseMs later. A
    // shutdown that marked them would either lose them or duplicate their attempts count.
    const driver = fakeDriver();
    driver.reply('SELECT "id" FROM "zmdb_outbox"', [{ id: 'r1' }]);
    driver.reply('"lease_owner" = ', [claimedRow('r1')]);

    const dispatcher = createOutboxDispatcher({
      driver,
      publish: () => new Promise<void>(() => undefined),
      leaseMs: 30_000,
    });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await dispatcher.onShutdown();

    expect(driver.calls.filter(c => c.text.startsWith('UPDATE') && c.parameters.includes('delivered'))).toEqual([]);
    expect(driver.calls.filter(c => c.parameters.includes('dead'))).toEqual([]);
  });

  it.fails('the dispatcher takes its driver structurally and needs nothing else', () => {
    // actual today: Error: unimplemented: createOutboxDispatcher.
    // SPEC §1 and §4.1: the seam is `Driver`, and the whole point of the split is that no new
    // dependency is needed in either direction. A bare object literal with one method is enough.
    const dispatcher = createOutboxDispatcher({
      driver: { execute: () => Promise.resolve([]) },
      publish: () => Promise.resolve(),
    });
    expect(typeof dispatcher.runOnce).toBe('function');
    expect(typeof dispatcher.start).toBe('function');
    expect(typeof dispatcher.onShutdown).toBe('function');
  });

  it('a claim is one UPDATE, so two dispatchers over one row need no shared state', async () => {
    // The green companion to the sibling file's interleaving test, from this side: two dispatchers
    // constructed over the same driver share nothing — no module-level registry, no lock table.
    // Recorded actual (2026-09-04): the sqlite protocol probe gave A the row and B nothing, with
    // no transaction spanning either batch.
    const db = outboxDb();
    const driver = sqliteDriver(db);
    await driver.execute(
      qb
        .insertInto('zmdb_outbox')
        .values({
          id: 'r1',
          topic: 't',
          payload: '{}',
          status: 'pending',
          created_at: NOW,
          lease_until: new Date(0),
        })
        .compile(),
    );

    const claim = (token: string) =>
      qb
        .updateTable('zmdb_outbox')
        .set({ lease_owner: token, lease_until: new Date(NOW.getTime() + 30_000) })
        .where('status', '=', 'pending')
        .where('lease_until', '<', NOW)
        .whereIn('id', ['r1'])
        .compile();
    const readBack = (token: string) =>
      qb.selectFrom('zmdb_outbox').select(['id']).where('lease_owner', '=', token).compile();

    await driver.execute(claim('token-A'));
    await driver.execute(claim('token-B'));

    expect(await driver.execute(readBack('token-A'))).toEqual([{ id: 'r1' }]);
    expect(await driver.execute(readBack('token-B'))).toEqual([]);
  });
});
