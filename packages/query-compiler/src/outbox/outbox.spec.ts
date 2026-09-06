// Outbox SQL and migration coverage for packages/query-compiler/src/outbox/SPEC.md.
// The repository-side writer and dispatcher tests live in
// packages/repository/src/outbox/outbox.spec.ts.
//
// This package has no dependencies and must keep none (SPEC §1), so the real-database tests use
// `node:sqlite` — a Node builtin — with a six-line `execute` shim rather than
// @zmdb/sqlite's `sqliteDriver`.
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { createQueryCompiler, quoteIdentifier } from '../index.js';
import type { CompiledQuery, DialectTarget } from '../index.js';
import { createIndexDdl } from '../schema-objects/index.js';
import {
  cockroachDialect,
  mysqlDialect,
  officialDialects,
  postgresDialect,
  singlestoreDialect,
  sqliteDialect,
  type OfficialDialectName,
} from '../testing/official-dialects.fixture.js';
import {
  OUTBOX_TABLE,
  outboxCandidatesQuery,
  outboxClaimQuery,
  outboxMarkDeadQuery,
  outboxMarkDeliveredQuery,
  outboxMarkRetryQuery,
  outboxMigration,
  outboxPendingIndexDdl,
  outboxReadBackQuery,
  outboxTableDdl,
  type OutboxStatus,
} from './index.js';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
const DIALECTS: readonly OfficialDialectName[] = ['postgres', 'mysql', 'sqlite', 'mssql', 'cockroach', 'singlestore'];

const EPOCH = new Date(0);
const NOW = new Date('2026-06-01T00:00:00.000Z');
const LEASE_UNTIL = new Date('2026-06-01T00:00:30.000Z');
const LAPSED = new Date('2026-06-01T00:01:00.000Z');
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

const PENDING: OutboxStatus = 'pending';

function target(dialect: OfficialDialectName): DialectTarget {
  return officialDialects[dialect];
}

// The three claim statements of §4.2, hand-built from the shipped builders. This is what the
// frozen helpers have to produce, and having it here twice — once as a golden string, once as a
// runnable protocol — is the point: the strings pin the SQL and the protocol pins the meaning.
function candidatesByHand(dialect: OfficialDialectName, now: Date, batch: number): CompiledQuery {
  return (
    createQueryCompiler(target(dialect))
      .selectFrom(OUTBOX_TABLE)
      .select(['id'])
      .where('status', '=', PENDING)
      .where('lease_until', '<', now)
      // lowercase: `Direction` is `'asc' | 'desc'` (../index.ts:31). The emitted keyword is
      // uppercase either way — verified 2026-09-04, both spellings give `ORDER BY "created_at" ASC`
      // — but 'ASC' is TS2345 at the call, so the assertions below quote the SQL and not the argument.
      .orderBy('created_at', 'asc')
      .limit(batch)
      .compile()
  );
}

function claimByHand(dialect: OfficialDialectName, now: Date, token: string, leaseUntil: Date, ids: readonly string[]) {
  return createQueryCompiler(target(dialect))
    .updateTable(OUTBOX_TABLE)
    .set({ lease_owner: token, lease_until: leaseUntil })
    .where('status', '=', PENDING)
    .where('lease_until', '<', now)
    .whereIn('id', ids)
    .compile();
}

function readBackByHand(dialect: OfficialDialectName, token: string): CompiledQuery {
  return createQueryCompiler(target(dialect))
    .selectFrom(OUTBOX_TABLE)
    .select(['id', 'topic', 'payload', 'attempts'])
    .where('lease_owner', '=', token)
    .compile();
}

/**
 * A `CompiledQuery` sink over `node:sqlite`. `Date` is the app type of every `timestamp`
 * column and node:sqlite refuses to bind one, so parameters are ISO-8601-encoded here for
 * the same reason `@zmdb/sqlite`'s `sqliteDriver` does it: fixed-width UTC ISO is the one
 * text form whose lexicographic order is its chronological order, which is what makes
 * `lease_until < ?` mean what §4.2 says it means.
 *
 * `bindable` is spelled out rather than inlined because `CompiledQuery['parameters']` is
 * `readonly unknown[]` and node:sqlite's `all(...)` takes `SQLInputValue`: passing the mapped array
 * straight through is TS2345, "Argument of type 'unknown' is not assignable to parameter of type
 * 'SQLInputValue'" (verified 2026-09-04). Narrowing here rather than casting keeps the one `as` in
 * this file on the result rows, where the shape really is the caller's claim.
 */
function bindable(value: unknown): string | number | bigint | null | Uint8Array {
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  return String(value);
}

function sink(db: DatabaseSync): (q: CompiledQuery) => readonly Record<string, unknown>[] {
  return q => db.prepare(q.text).all(...q.parameters.map(bindable)) as readonly Record<string, unknown>[];
}

function outboxDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  // Hand-written DDL: §1 promises a table emitter in this package but §9 has no item for one,
  // so this test does not invent its shape. The column types are §2's, per `../migrations`'
  // sqlite mapping (`text`/`jsonEnum` -> TEXT, `integer` -> INTEGER, `timestamp` -> TEXT).
  db.exec(`CREATE TABLE ${OUTBOX_TABLE} (
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
  return db;
}

function seedPending(db: DatabaseSync, ids: readonly string[]): void {
  const run = sink(db);
  ids.forEach((id, i) => {
    run(
      createQueryCompiler(sqliteDialect)
        .insertInto(OUTBOX_TABLE)
        .values({
          id,
          topic: 'post.published',
          payload: `{"id":${i}}`,
          status: PENDING,
          created_at: new Date(CREATED_AT.getTime() + i * 1000),
          lease_until: EPOCH,
        })
        .compile(),
    );
  });
}

function readRow(db: DatabaseSync, id: string): Record<string, unknown> {
  return db.prepare(`SELECT * FROM ${OUTBOX_TABLE} WHERE id = ?`).get(id) as Record<string, unknown>;
}

describe('outbox: the declared table migration (#594, SPEC §1-3)', () => {
  it('uses each dialect timestamp type and creates the pending index', () => {
    expect(outboxTableDdl(postgresDialect)).toContain('"created_at" TIMESTAMPTZ');
    expect(outboxTableDdl(mysqlDialect)).toContain('`id` VARCHAR(36) PRIMARY KEY');
    expect(outboxTableDdl(mysqlDialect)).toContain('`status` VARCHAR(16)');
    expect(outboxTableDdl(mysqlDialect)).toContain('`lease_owner` VARCHAR(36)');
    expect(outboxTableDdl(mysqlDialect)).toContain('`created_at` DATETIME(3)');
    expect(outboxTableDdl(sqliteDialect)).toContain('"created_at" TEXT');
    expect(outboxTableDdl(sqliteDialect)).toContain(
      `"created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    );
    expect(outboxTableDdl(officialDialects.mssql)).toContain('[id] NVARCHAR(36) PRIMARY KEY');
    expect(outboxTableDdl(officialDialects.mssql)).toContain(
      '[created_at] DATETIMEOFFSET(3) NOT NULL DEFAULT SYSDATETIMEOFFSET()',
    );
    expect(outboxTableDdl(cockroachDialect)).toContain('"attempts" INT4 NOT NULL DEFAULT 0');
    expect(outboxTableDdl(singlestoreDialect)).toMatch(/^CREATE ROWSTORE TABLE `zmdb_outbox`/);
    expect(outboxTableDdl(singlestoreDialect)).toContain(
      '`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)',
    );
    expect(outboxTableDdl(singlestoreDialect)).toContain(
      "`lease_until` DATETIME(6) NOT NULL DEFAULT '1970-01-01 00:00:00.000000'",
    );
    for (const dialect of DIALECTS) {
      const migration = outboxMigration(42, target(dialect));
      expect(migration.version).toBe(42);
      expect(migration.up).toMatch(/CREATE (?:ROWSTORE )?TABLE/);
      expect(migration.up).toContain('zmdb_outbox_pending');
      expect(migration.down).toContain('DROP TABLE');
    }
  });

  it('applies as a real sqlite migration with defaults and the partial index', () => {
    const db = new DatabaseSync(':memory:');
    const migration = outboxMigration(1, sqliteDialect);
    db.exec(migration.up);
    db.prepare(`INSERT INTO ${OUTBOX_TABLE} (id, topic, payload) VALUES (?, ?, ?)`).run('r1', 't', '{}');

    const row = readRow(db, 'r1');
    expect(row['status']).toBe('pending');
    expect(row['attempts']).toBe(0);
    expect(row['created_at']).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(row['lease_owner']).toBe('');
    expect(row['lease_until']).toBe('1970-01-01T00:00:00.000Z');
    expect(
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'zmdb_outbox_pending'").get(),
    ).toEqual({
      sql:
        'CREATE INDEX "zmdb_outbox_pending" ON "zmdb_outbox" ("status", "lease_until", "created_at") ' +
        "WHERE status = 'pending'",
    });
  });

  it('uses the pending index for the sqlite candidate query', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(outboxMigration(1, sqliteDialect).up);
    const query = outboxCandidatesQuery(sqliteDialect, { now: NOW, batch: 100 });
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${query.text}`)
      .all(...query.parameters.map(bindable)) as readonly Record<string, unknown>[];

    expect(plan.some(row => String(row['detail']).includes('USING INDEX zmdb_outbox_pending'))).toBe(true);
  });
});

// ===========================================================================
// §9 item 8 — the pending index is filtered on postgres, sqlite and mssql and full on mysql
// ===========================================================================
describe('outbox: the pending index (#593, SPEC §3, §9 item 8)', () => {
  it('the pending index is partial on postgres', () => {
    expect(outboxPendingIndexDdl(postgresDialect)).toBe(
      'CREATE INDEX "zmdb_outbox_pending" ON "zmdb_outbox" ("status", "lease_until", "created_at") ' +
        "WHERE status = 'pending'",
    );
  });

  it('the pending index is partial on sqlite', () => {
    expect(outboxPendingIndexDdl(sqliteDialect)).toBe(
      'CREATE INDEX "zmdb_outbox_pending" ON "zmdb_outbox" ("status", "lease_until", "created_at") ' +
        "WHERE status = 'pending'",
    );
  });

  it('the pending index has no WHERE on mysql, which has no partial index', () => {
    //
    // And when it exists it cannot simply forward to `createIndexDdl`: that emitter has no
    // dialect guard on `where` (../schema-objects/index.ts:23 emits ` WHERE ${def.where}`
    // unconditionally), so today the mysql call produces
    //   CREATE INDEX `zmdb_outbox_pending` ON `zmdb_outbox`
    //     (`status`, `lease_until`, `created_at`) WHERE status = 'pending'
    // which is a syntax error on MySQL. SPEC §3 asserts "On MySQL the `where` is dropped and
    // the same index is created in full"; that is not what the shipped emitter does. See the
    // green companion below, and NOTES.md.
    expect(outboxPendingIndexDdl(mysqlDialect)).toBe(
      'CREATE INDEX `zmdb_outbox_pending` ON `zmdb_outbox` (`status`, `lease_until`, `created_at`)',
    );
    expect(outboxPendingIndexDdl(singlestoreDialect)).toBe(
      'CREATE INDEX `zmdb_outbox_pending` ON `zmdb_outbox` (`status`, `lease_until`, `created_at`)',
    );
  });

  it('createIndexDdl refuses a partial predicate on mysql', () => {
    expect(() =>
      createIndexDdl(
        {
          name: 'zmdb_outbox_pending',
          table: OUTBOX_TABLE,
          columns: ['status', 'lease_until', 'created_at'],
          where: "status = 'pending'",
        },
        mysqlDialect,
      ),
    ).toThrow('mysql does not support the partial index "zmdb_outbox_pending"');
  });

  it('status leads the index, so the mysql full form still seeks to the pending rows', () => {
    // SPEC §3's reason for the column order, asserted as a property of the emitted text rather
    // than as prose: an index ordered (created_at, status) would degrade to a full scan on the
    // dialect that drops the predicate.
    const ddl = createIndexDdl(
      {
        name: 'zmdb_outbox_pending',
        table: OUTBOX_TABLE,
        columns: ['status', 'lease_until', 'created_at'],
        where: "status = 'pending'",
      },
      postgresDialect,
    );
    expect(ddl.indexOf('"status"')).toBeLessThan(ddl.indexOf('"created_at"'));
  });
});

// ===========================================================================
// §9 items 9 and 10, plus §4.2's golden SQL
// ===========================================================================
describe('outbox: the claim statements (#593, SPEC §4.2, §9 items 9 and 10)', () => {
  it('the candidate query is the same three-clause select on every dialect', () => {
    // The expected text is what the shipped builders produce for §4.2 statement 1 — note that
    // the literals in SPEC §4.2 are hand-written prose: the real statement binds them.
    expect(outboxCandidatesQuery(postgresDialect, { now: NOW, batch: 100 })).toEqual({
      text:
        'SELECT "id" FROM "zmdb_outbox" WHERE "status" = $1 AND "lease_until" < $2 ' +
        'ORDER BY "created_at" ASC LIMIT 100',
      parameters: [PENDING, NOW],
    });
    expect(outboxCandidatesQuery(mysqlDialect, { now: NOW, batch: 100 }).text).toBe(
      'SELECT `id` FROM `zmdb_outbox` WHERE `status` = ? AND `lease_until` < ? ' +
        'ORDER BY `created_at` ASC LIMIT 100',
    );
    expect(outboxCandidatesQuery(sqliteDialect, { now: NOW, batch: 100 }).text).toBe(
      'SELECT "id" FROM "zmdb_outbox" WHERE "status" = ? AND "lease_until" < ? ' +
        'ORDER BY "created_at" ASC LIMIT 100',
    );
  });

  it('the claim statement is one conditional UPDATE with the candidate ids bound in', () => {
    // `set()` values are pushed before the where parameters (../index.ts:323-329), which is why
    // the token and the lease take $1 and $2 rather than the last two slots.
    expect(
      outboxClaimQuery(postgresDialect, { now: NOW, token: 'tok', leaseUntil: LEASE_UNTIL, ids: ['a', 'b'] }),
    ).toEqual({
      text:
        'UPDATE "zmdb_outbox" SET "lease_owner" = $1, "lease_until" = $2 ' +
        'WHERE "status" = $3 AND "lease_until" < $4 AND "id" IN ($5, $6)',
      parameters: ['tok', LEASE_UNTIL, PENDING, NOW, 'a', 'b'],
    });
  });

  it('the read-back selects by lease owner and is what says which rows were won', () => {
    expect(outboxReadBackQuery(postgresDialect, { token: 'tok' })).toEqual({
      text: 'SELECT "id", "topic", "payload", "attempts" FROM "zmdb_outbox" WHERE "lease_owner" = $1',
      parameters: ['tok'],
    });
  });

  it('every mark statement carries the lease-owner guard', () => {
    // SPEC §4.3: without `AND "lease_owner" = :token` a dispatcher whose lease expired mid-publish
    // would still write, which loses the `attempts` count.
    const marks = [
      outboxMarkDeliveredQuery(postgresDialect, { id: 'r1', token: 'tok', deliveredAt: NOW, attempts: 1 }),
      outboxMarkRetryQuery(postgresDialect, {
        id: 'r1',
        token: 'tok',
        attempts: 1,
        lastError: 'boom',
        leaseUntil: LEASE_UNTIL,
      }),
      outboxMarkDeadQuery(postgresDialect, { id: 'r1', token: 'tok', attempts: 10, lastError: 'boom' }),
    ];
    for (const mark of marks) {
      expect(mark.text).toContain('AND "lease_owner" = ');
      expect(mark.text).toContain('WHERE "id" = ');
    }
  });

  it('the delivered mark sets status, deliveredAt and an incremented attempts', () => {
    expect(
      outboxMarkDeliveredQuery(postgresDialect, { id: 'r1', token: 'tok', deliveredAt: NOW, attempts: 1 }),
    ).toEqual({
      text:
        'UPDATE "zmdb_outbox" SET "status" = $1, "delivered_at" = $2, "attempts" = $3 ' +
        'WHERE "id" = $4 AND "lease_owner" = $5',
      parameters: ['delivered', NOW, 1, 'r1', 'tok'],
    });
  });

  it('the retry mark pushes leaseUntil into the future and leaves status pending', () => {
    // SPEC §5: the backoff and the lease are the same column, so a retried row is invisible for
    // exactly the backoff using the ordered comparison the candidate query already has.
    const q = outboxMarkRetryQuery(postgresDialect, {
      id: 'r1',
      token: 'tok',
      attempts: 1,
      lastError: 'boom',
      leaseUntil: LEASE_UNTIL,
    });
    expect(q.text).toBe(
      'UPDATE "zmdb_outbox" SET "attempts" = $1, "last_error" = $2, "lease_until" = $3 ' +
        'WHERE "id" = $4 AND "lease_owner" = $5',
    );
    expect(q.text).not.toContain('"status"');
  });

  it('the dead mark is the terminal state and sets no lease', () => {
    const q = outboxMarkDeadQuery(postgresDialect, { id: 'r1', token: 'tok', attempts: 10, lastError: 'boom' });
    expect(q.text).toBe(
      'UPDATE "zmdb_outbox" SET "status" = $1, "attempts" = $2, "last_error" = $3 ' +
        'WHERE "id" = $4 AND "lease_owner" = $5',
    );
    expect(q.parameters[0]).toBe('dead');
  });

  it('the candidate query never emits IS NULL', () => {
    // The builder can now spell IS NULL, but the outbox deliberately keeps its state machine
    // on the non-null status and lease columns so the claim index and terminal state stay explicit.
    for (const dialect of DIALECTS) {
      const q = outboxCandidatesQuery(target(dialect), { now: NOW, batch: 100 });
      expect(q.text.toUpperCase()).not.toContain('IS NULL');
      expect(q.text).toContain(quoteIdentifier(target(dialect), 'status'));
    }
  });

  it('the explicit `is null` operator emits no bound parameter', () => {
    expect(
      createQueryCompiler(postgresDialect)
        .selectFrom(OUTBOX_TABLE)
        .select(['id'])
        .where('deliveredAt', 'is null', null)
        .compile(),
    ).toEqual({ text: 'SELECT "id" FROM "zmdb_outbox" WHERE "deliveredAt" IS NULL', parameters: [] });
  });

  it('no claim or mark statement emits RETURNING', () => {
    // Dialect dispatch refuses MySQL-family RETURNING and places SQL Server OUTPUT,
    // but the outbox claim protocol deliberately requests neither row-returning form.
    const statements = DIALECTS.flatMap(dialect => [
      outboxCandidatesQuery(target(dialect), { now: NOW, batch: 100 }),
      outboxClaimQuery(target(dialect), { now: NOW, token: 'tok', leaseUntil: LEASE_UNTIL, ids: ['a'] }),
      outboxReadBackQuery(target(dialect), { token: 'tok' }),
      outboxMarkDeliveredQuery(target(dialect), { id: 'r1', token: 'tok', deliveredAt: NOW, attempts: 1 }),
      outboxMarkRetryQuery(target(dialect), {
        id: 'r1',
        token: 'tok',
        attempts: 1,
        lastError: 'x',
        leaseUntil: LEASE_UNTIL,
      }),
      outboxMarkDeadQuery(target(dialect), { id: 'r1', token: 'tok', attempts: 10, lastError: 'x' }),
    ]);
    for (const statement of statements) {
      expect(statement.text.toUpperCase()).not.toContain('RETURNING');
    }
  });

  it('refuses RETURNING on mysql instead of emitting SQL the server rejects', () => {
    expect(() =>
      createQueryCompiler(mysqlDialect)
        .updateTable(OUTBOX_TABLE)
        .set({ status: 'delivered' })
        .where('id', '=', 'r1')
        .returning(['id'])
        .compile(),
    ).toThrow(
      'returning is not supported for UPDATE on dialect "mysql"; omit returning() and perform an explicit read',
    );
  });

  it('Driver.execute has no affected-row count to report, so the claim cannot use one', () => {
    // SPEC §4.1's other half, against a real database: an UPDATE comes back as zero rows whether
    // it changed one row or none, which is why the read-back is what says what was won.
    const db = outboxDb();
    seedPending(db, ['r1']);
    const run = sink(db);
    const updated = run(claimByHand('sqlite', NOW, 'tok', LEASE_UNTIL, ['r1']));
    expect(updated).toEqual([]);
  });
});

// ===========================================================================
// §9 items 3, 4, 5 — the protocol, against a real database, interleaved by hand
// ===========================================================================
describe('outbox: claiming, against a real sqlite database (#593, SPEC §4.2, §9 items 3-5)', () => {
  it('two claims against one row: the second claims nothing', () => {
    // The interleaving is a fixed statement order, not two racing timers: A and B both read the
    // candidate set, then A claims, then B claims. Nothing here depends on wall-clock luck.
    const db = outboxDb();
    seedPending(db, ['r1']);
    const run = sink(db);

    const candidatesA = run(outboxCandidatesQuery(sqliteDialect, { now: NOW, batch: 100 })).map(r => String(r['id']));
    const candidatesB = run(outboxCandidatesQuery(sqliteDialect, { now: NOW, batch: 100 })).map(r => String(r['id']));
    expect(candidatesA).toEqual(['r1']);
    expect(candidatesB).toEqual(['r1']);

    run(outboxClaimQuery(sqliteDialect, { now: NOW, token: 'token-A', leaseUntil: LEASE_UNTIL, ids: candidatesA }));
    run(outboxClaimQuery(sqliteDialect, { now: NOW, token: 'token-B', leaseUntil: LEASE_UNTIL, ids: candidatesB }));

    expect(run(outboxReadBackQuery(sqliteDialect, { token: 'token-A' })).map(r => r['id'])).toEqual(['r1']);
    expect(run(outboxReadBackQuery(sqliteDialect, { token: 'token-B' }))).toEqual([]);
  });

  it('a lapsed lease is reclaimable', () => {
    // The clock is advanced by passing a later `now`, not by waiting: SPEC §4.2's predicate is
    // `lease_until < :now`, so a value is the whole mechanism.
    const db = outboxDb();
    seedPending(db, ['r1']);
    const run = sink(db);

    run(outboxClaimQuery(sqliteDialect, { now: NOW, token: 'token-A', leaseUntil: LEASE_UNTIL, ids: ['r1'] }));
    expect(run(outboxCandidatesQuery(sqliteDialect, { now: NOW, batch: 100 }))).toEqual([]);

    expect(run(outboxCandidatesQuery(sqliteDialect, { now: LAPSED, batch: 100 })).map(r => r['id'])).toEqual(['r1']);
    run(outboxClaimQuery(sqliteDialect, { now: LAPSED, token: 'token-C', leaseUntil: LAPSED, ids: ['r1'] }));
    expect(run(outboxReadBackQuery(sqliteDialect, { token: 'token-C' })).map(r => r['id'])).toEqual(['r1']);
    expect(run(outboxReadBackQuery(sqliteDialect, { token: 'token-A' }))).toEqual([]);
  });

  it('a mark whose lease was stolen writes nothing', () => {
    // SPEC §4.3's guard. The assertion is on `attempts`, because a mark that lands with the
    // wrong owner is invisible in `status` alone.
    const db = outboxDb();
    seedPending(db, ['r1']);
    const run = sink(db);

    run(outboxClaimQuery(sqliteDialect, { now: NOW, token: 'token-A', leaseUntil: LEASE_UNTIL, ids: ['r1'] }));
    run(outboxClaimQuery(sqliteDialect, { now: LAPSED, token: 'token-C', leaseUntil: LAPSED, ids: ['r1'] }));

    run(outboxMarkDeliveredQuery(sqliteDialect, { id: 'r1', token: 'token-A', deliveredAt: LAPSED, attempts: 1 }));
    const row = readRow(db, 'r1');
    expect(row['status']).toBe('pending');
    expect(row['attempts']).toBe(0);
    expect(row['delivered_at']).toBeNull();
  });

  it('a dead row leaves the candidate set for good', () => {
    // SPEC §2.2: this is why `status` has a third value instead of a threshold on `attempts` —
    // a threshold leaves the poison row in the working set to be re-read on every poll.
    const db = outboxDb();
    seedPending(db, ['r1', 'r2']);
    const run = sink(db);

    run(outboxClaimQuery(sqliteDialect, { now: NOW, token: 'tok', leaseUntil: LEASE_UNTIL, ids: ['r1'] }));
    run(outboxMarkDeadQuery(sqliteDialect, { id: 'r1', token: 'tok', attempts: 10, lastError: 'boom' }));

    expect(run(outboxCandidatesQuery(sqliteDialect, { now: LAPSED, batch: 100 })).map(r => r['id'])).toEqual(['r2']);
  });

  it('the predicate alone is the mutual exclusion, with no lock clause anywhere', () => {
    // The green half of §9 item 3: the design property, proven with the builders that exist, so
    // the `it.fails` above cannot be closed by an implementation that quietly adds a lock.
    // Recorded actual (2026-09-04): A's read-back is [{id:'r1',...}] and B's is [].
    const db = outboxDb();
    seedPending(db, ['r1']);
    const run = sink(db);

    const a = run(candidatesByHand('sqlite', NOW, 100)).map(r => String(r['id']));
    const b = run(candidatesByHand('sqlite', NOW, 100)).map(r => String(r['id']));
    run(claimByHand('sqlite', NOW, 'token-A', LEASE_UNTIL, a));
    run(claimByHand('sqlite', NOW, 'token-B', LEASE_UNTIL, b));

    expect(run(readBackByHand('sqlite', 'token-A')).map(r => r['id'])).toEqual(['r1']);
    expect(run(readBackByHand('sqlite', 'token-B'))).toEqual([]);
    for (const dialect of DIALECTS) {
      const text = claimByHand(dialect, NOW, 'tok', LEASE_UNTIL, ['r1']).text.toUpperCase();
      expect(text).not.toContain('FOR UPDATE');
      expect(text).not.toContain('SKIP LOCKED');
    }
  });

  it('candidates come back in createdAt order, which is the only ordering there is', () => {
    // SPEC §7: one dispatcher claims in `createdAt` order; more than one has no ordering at all.
    // This asserts the half that is a property of the SQL. The other half is not testable and is
    // not asserted anywhere — it is a documented non-guarantee.
    const db = outboxDb();
    seedPending(db, ['r3', 'r1', 'r2']);
    const ids = sink(db)(candidatesByHand('sqlite', NOW, 100)).map(r => r['id']);
    expect(ids).toEqual(['r3', 'r1', 'r2']);
  });
});
