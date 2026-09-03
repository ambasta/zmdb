# SPEC — the outbox: table, claiming, and delivery semantics (frozen)

Part of `@zmdb/query-compiler`. This file owns the **SQL** an outbox needs — the table, the index, and the
three statements that make a claim safe. The declaration and the dispatcher loop land in `@zmdb/repository`
(§1), which is what `docs-site/content/transactional-outbox.md` already says the shape should be.

The reason this needs a freeze rather than an implementation note: three of the four mechanisms the pattern is
normally built on are **not expressible in this repository today**, and each one is unavailable for a different
reason. A design written against the textbook version compiles into SQL that is a syntax error on one dialect,
silently claims the same row twice on another, and cannot say "this event will never be delivered" at all.
Those are found by discovering them here, in front of the reader, rather than by an implementation that
appears to work on Postgres.

## 1. Which package, and why the issue names the wrong one

`#592` lists this file under `@zmdb/query-compiler` and also names `@zmdb/repository` without a file. The
split is real and it goes the other way round from the file list:

| Piece                               | Needs                                   | Lands in                               |
| ----------------------------------- | --------------------------------------- | -------------------------------------- |
| the table DDL and the partial index | a `Dialect` and `createIndexDdl`        | `@zmdb/query-compiler` — **this file** |
| the three claim statements          | `updateTable` / `selectFrom`            | `@zmdb/query-compiler` — **this file** |
| the `OutboxRow` declaration         | `Table<…>`, `Sql<…>` from `schema-core` | `@zmdb/repository`                     |
| `createOutboxDispatcher`            | `Driver`, a timer, a shutdown hook      | `@zmdb/repository`                     |

`packages/query-compiler/package.json` has **no dependencies at all** — not `@zmdb/schema-core`, not anything.
So `OutboxRow extends Table<'zmdb_outbox'>` cannot be declared here without giving this package its first
dependency, and `Driver` is `../../../repository/src/index.ts:51`, one package further out. Putting the
dispatcher here would invert the dependency direction that `repository → query-compiler` already establishes.

`transactional-outbox.md`'s own closing section says "An `Outbox` declaration and repository in
`@zmdb/repository`". That was right. This file is the compiler half, and it is the half where the hard
decisions are.

## 2. The table, and why `deliveredAt: Date | null` cannot express the state machine

```ts
export type OutboxStatus = 'pending' | 'delivered' | 'dead';

export interface OutboxRow extends Table<'zmdb_outbox'> {
  id: string & Sql<'text'> & PrimaryKey;
  topic: string & Sql<'text'>;
  payload: string & Sql<'text'>;
  status: OutboxStatus & Sql<'jsonEnum'>;
  attempts: number & Sql<'integer'> & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  leaseOwner: string & Sql<'text'> & HasDefault;
  leaseUntil: Date & Sql<'timestamp'> & HasDefault;
  deliveredAt: (Date & Sql<'timestamp'>) | null;
  lastError: (string & Sql<'text'>) | null;
}
```

Four differences from the issue's `OutboxRecord`, and every one of them is forced.

### 2.1 `status`, because `IS NULL` is not expressible

The canonical dispatcher predicate is `WHERE delivered_at IS NULL`. **The query builder cannot emit it.**
`Operator` (`../index.ts:13-27`) has no `is` member, and `sqlOperator` (`../clauses.ts:93`) ends
`return OP_MAP[op.toLowerCase().trim()] ?? op` — so an unrecognised operator is passed through into the SQL
verbatim and `where('deliveredAt', 'is', null)` compiles to `"delivered_at" is $1` with a null parameter.
That is a syntax error on Postgres, and on the dialects that tolerate it the comparison is never true. Nothing
in `@zmdb/repository` supplies an `isNull` either.

So **no nullable column is ever a predicate.** Every state test becomes an equality or an ordered comparison
on a column that is never null, which is why `status` exists and why `leaseOwner`/`leaseUntil` carry
`HasDefault` instead of `| null`:

| Wanted                    | Not expressible        | Expressed as         |
| ------------------------- | ---------------------- | -------------------- |
| undelivered               | `delivered_at IS NULL` | `status = 'pending'` |
| unclaimed or lease lapsed | `lease_owner IS NULL`  | `lease_until < :now` |

`deliveredAt` and `lastError` stay nullable because they are read and never filtered on. That distinction —
nullable is fine for data, fatal for a predicate — is the rule to remember, and it applies well beyond the
outbox.

`status` is tagged `Sql<'jsonEnum'>` rather than `Sql<'text'>`, because that is this project's spelling for a
column whose app type is a literal union — `vocabulary.type-test.ts:66` states it as data
(`enum: "Sql<'jsonEnum'> + a literal union"`), and it is asserted for the tagged-DTO path at
`../../../schema-core/src/derive/tagged-dto.type-test.ts:77`. The storage is identical: `jsonEnum` is `TEXT` on
all three dialects (`../migrations/index.ts:158,173,187`), and nothing JSON-encodes — the name is about the IR,
not the wire. What the tag buys is that the literal union survives into the IR's `enum`, so the app type is the
union rather than a bare string (`../../../schema-core/src/ir/index.ts:428-431`) and OpenAPI emits
`type: 'string'` with the three values listed (`:553-556`). Spelling it `text` would have discarded all of that
for a column whose entire purpose is that it has three legal values.

### 2.2 `status`, again, because "dead" has to have a name

`#592` step 8 requires "the terminal state for a permanently failing event. Without that last one the
dispatcher spins forever on one bad row and delivers nothing else." A `deliveredAt: Date | null` has exactly
two states, so it cannot carry a third. `attempts` cannot either: a threshold on `attempts` is a rule the
candidate query has to re-apply on every poll, so a poison row stays in the working set forever and keeps
paying for itself. `status = 'dead'` drops the row out of the index (§3) and out of the candidate query, once.

`transactional-outbox.md` names the failure mode — "otherwise one poisoned message blocks the queue behind
it" — and lists it under what is _not_ in zmdb. This is where it stops being the user's problem.

### 2.3 `payload` is `text`, not `json`

`transactional-outbox.md` declares `payload: Record<string, unknown> & Sql<'json'>`. The issue says `string`,
and the issue is right, for a reason neither states: a `json` column round-trips through the driver's own JSON
handling, so the bytes a consumer receives are not the bytes that were written — key order, number formatting
and unicode escaping are all the driver's choice. A payload that is signed, hashed for deduplication, or
compared to a replay is then not comparable to itself. Serialising once at the emit boundary makes the stored
string the message, and a broker takes a string anyway.

It also means a payload that is not JSON — protobuf in base64, a CloudEvents envelope — needs no new column
type.

### 2.4 `id` is `text`, because there is no `uuid`

`SqlType` (`../../../schema-core/src/index.ts:21-32`) is
`'serial' | 'integer' | 'bigint' | 'numeric' | 'text' | 'varchar' | 'boolean' | 'timestamp' | 'json' | 'jsonEnum'`.
No `uuid`. So the id is `text`, generated in the application with `globalThis.crypto.randomUUID()` —
`.oxlintrc.json:66` bans `node:crypto` and its message names `globalThis.crypto` as the replacement, so this
is the sanctioned route rather than a workaround.

A `Serial` id, which is what `transactional-outbox.md` uses, is deliberately rejected: the id has to be known
**before** the insert, because `emitInTransaction` (§6) writes inside the caller's transaction and the caller
may want to log or return the event id without waiting for a `RETURNING` that MySQL cannot do (§4.1).

`createdAt` is `timestamp` and dialect-specific by the repository's existing rule: a `Date` in Node,
`TIMESTAMPTZ` in Postgres, an ISO string in OpenAPI. Nothing here restates that mapping.

## 3. The index, and the one dialect that does not have it

```ts
createIndexDdl(
  {
    name: 'zmdb_outbox_pending',
    table: 'zmdb_outbox',
    columns: ['status', 'lease_until', 'created_at'],
    where: "status = 'pending'",
  },
  dialect,
);
```

`IndexDef.where` is a raw SQL string (`../schema-objects/index.ts:17`, emitted at `:23`), so the partial
predicate is expressible even though the query builder's `WHERE` is not — which is worth noticing, because it
is why §2.1's restriction lands on the dispatcher's queries and not on its schema.

**Partial indexes are Postgres and SQLite only. MySQL has none.** On MySQL the `where` is dropped and the same
index is created in full, and that is why `status` is the **leading column**: a full composite index on
`(status, lease_until, created_at)` still seeks straight to the pending rows, so the query plan degrades from
"index over a small set" to "index prefix over a small set" rather than to a table scan. An index ordered
`(created_at, status)` — the natural way to write it, and the shape `transactional-outbox.md` uses — would
degrade to a scan of every row ever written.

`#593` asserts the emitted DDL per dialect, including that the MySQL form has no `WHERE`.

## 4. Claiming a row with what exists

`transactional-outbox.md` claims rows with `SELECT … FOR UPDATE SKIP LOCKED`, and then notes the consequence:
"The whole thing has to run inside one transaction for `SKIP LOCKED` to hold the claim". That is correct and it
is the reason not to do it. The broker publishes for the entire batch then happen with row locks held and a
transaction open, so **one slow broker holds a transaction for the length of a batch** — which on Postgres also
holds back the oldest-transaction horizon and blocks vacuum on every table, not just this one. A pattern whose
job is decoupling should not couple the broker's latency to the database's transaction age.

It is also not expressible: `SelectBuilder` (`../index.ts:98-121`) has no lock clause of any kind, and SQLite
has no `SKIP LOCKED` at all — which is why `transactional-outbox.md` has to say "on SQLite run exactly one
relay".

### 4.1 And a compare-and-swap cannot report whether it won

The obvious replacement is a conditional `UPDATE` whose affected-row count says whether this dispatcher took
the row. **Neither channel for that answer exists:**

- `Driver.execute` (`../../../repository/src/index.ts:51-54`) returns
  `Promise<readonly Record<string, unknown>[]>`. Rows, and no affected-row count. There is nowhere for a count
  to arrive.
- `RETURNING` is emitted **unconditionally for every dialect**: `returningClause` (`../index.ts:196-199`) has
  no dialect guard. MySQL has no `RETURNING`, so `updateTable(…).returning([…])` compiled for MySQL is a
  syntax error today. That is a live defect in shipped code, it is not the outbox's to fix, and the outbox
  must not be built on the feature.

### 4.2 So the claim is three statements, and the predicate is the lock

```
1. candidates  SELECT "id" FROM "zmdb_outbox"
                WHERE "status" = 'pending' AND "lease_until" < :now
                ORDER BY "created_at" ASC LIMIT :batch

2. claim       UPDATE "zmdb_outbox"
                  SET "lease_owner" = :token, "lease_until" = :now_plus_lease
                WHERE "status" = 'pending' AND "lease_until" < :now AND "id" IN (:candidates)

3. read back   SELECT "id", "topic", "payload", "attempts" FROM "zmdb_outbox"
                WHERE "lease_owner" = :token
```

Every clause is on the existing builders: `SelectBuilder.where/orderBy/limit`, `UpdateBuilder.set/where/whereIn`
(`../index.ts:171-179`). No lock clause, no `RETURNING`, no row count, and the same SQL on all three dialects.

**Two dispatchers cannot claim the same row, and no explicit locking is what makes that true.** Statement 2 is
a single `UPDATE`, so each row's predicate is evaluated while that row is write-locked by the statement
itself. Whichever dispatcher gets there first sets `lease_until` into the future; the other one's
`"lease_until" < :now` is then false for that row and it skips it. The predicate _is_ the mutual exclusion, and
it needs no transaction spanning the batch — statement 2 commits on its own.

Statement 1 may therefore return rows this dispatcher does not win, and statement 3 is what says which it
actually has. That is the point: the read-back is authoritative, so nothing downstream has to reason about the
race.

`token` is `globalThis.crypto.randomUUID()` per batch, not per dispatcher. A per-dispatcher token would make
statement 3 return rows from a _previous_ batch that this dispatcher claimed and then failed to mark, which is
a plausible-looking bug that delivers an old message alongside a new one.

`#593` asserts the interleaving directly: two claims against one row, second gets nothing.

### 4.3 Why the lease also makes `attempts = attempts + 1` unnecessary

`makeUpdate`'s `compile` (`../index.ts:323-329`) pushes **every** `set()` value as a bound parameter, so a SET
that references a column — `attempts = attempts + 1` — cannot be written. It does not need to be. Statement 3
returned `attempts` under this dispatcher's lease, so `set({ attempts: row.attempts + 1 })` in §5's mark step
is a read-modify-write on a row nobody else may touch. The missing SQL expression costs nothing _given the
lease_, and would be genuinely unsafe without it — which is worth stating, because the natural reading is that
the increment is a workaround for a compiler gap rather than a consequence of the concurrency design.

Every mark statement additionally carries `AND "lease_owner" = :token`, so a dispatcher whose lease expired
while it was publishing writes nothing. That is the difference between at-least-once and at-least-once with a
lost `attempts` count.

## 5. The dispatcher loop

Exported from `@zmdb/repository` (§1):

```ts
export interface OutboxDispatcherOptions {
  readonly driver: Driver;
  readonly publish: (topic: string, payload: string) => Promise<void>;
  readonly batch?: number; // 100
  readonly leaseMs?: number; // 30_000
  readonly idleMs?: number; // 1_000, doubling to maxIdleMs
  readonly maxIdleMs?: number; // 30_000
  readonly maxAttempts?: number; // 10
  readonly backoffMs?: (attempts: number) => number;
  readonly onDead?: (row: DeadOutboxRow) => void | Promise<void>;
}

export declare function createOutboxDispatcher(opts: OutboxDispatcherOptions): OutboxDispatcher;

export interface OutboxDispatcher {
  runOnce(): Promise<{ readonly claimed: number; readonly delivered: number; readonly failed: number }>;
  start(): void;
  onShutdown(): Promise<void>;
}
```

One pass: claim (§4.2), then for each row `publish(topic, payload)`, then mark. Marking is per row and
outside any transaction, because the batch's rows are independent and one failed publish must not roll back
the successes.

| Outcome                             | Written                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `publish` resolved                  | `status = 'delivered'`, `deliveredAt = now`, `attempts + 1`                          |
| `publish` rejected, under the limit | `attempts + 1`, `lastError`, `leaseUntil = now + backoffMs(attempts)`, still pending |
| `publish` rejected, at the limit    | `status = 'dead'`, `attempts + 1`, `lastError`; then `onDead`                        |

**The backoff and the lease are the same column**, and that is deliberate rather than thrifty. Two columns —
one saying "claimed until" and one saying "not before" — must be compared together on every poll, and §2.1 has
already established that the candidate query gets one ordered comparison to work with. Pushing `leaseUntil`
into the future on failure means a retried row is invisible for exactly the backoff and visible after it, using
the predicate that is already there.

`backoffMs` defaults to `Math.min(2 ** attempts * 1000, 300_000)` — capped, because uncapped exponential
backoff on a row that will eventually succeed becomes an outage of its own.

**The idle poll backs off; the busy poll does not.** A pass that claimed a full batch polls again immediately,
because there is known work. A pass that claimed nothing doubles `idleMs` up to `maxIdleMs`, which is what
stops an empty outbox from being a permanent query load. On Postgres, `LISTEN/NOTIFY` collapses the idle
latency to nothing and the poll stays as a floor — `transactional-outbox.md` already documents that, including
why the poll must not be removed, and it is not restated or shipped here.

`onShutdown` is the `OnShutdown` hook from `../../../web/src/lifecycle.ts:20-22`, which `runShutdown` runs in
reverse construction order (`:49-54`). **`createApp` calls `runShutdown(controllers)`** (`../../../web/src/app/index.ts:39`),
so the hook fires for controllers only and a dispatcher registered as a plain provider would never be told to
stop. Until hook detection reaches providers — the app epic's work, not this one's — a dispatcher is held by a
controller, and `#593` asserts shutdown through that path so the test cannot pass by way of the broken one. It
stops claiming, waits for
the in-flight batch, and does **not** wait for the lease to expire — the rows it did not reach are still
`pending` with a future `leaseUntil`, so they are picked up `leaseMs` later by whatever is still running. Late
is the correct failure here; the alternative is a shutdown that blocks on a broker.

`#592` step 8 asks what happens "on a dialect without `SKIP LOCKED`". The answer is that the question does not
arise: §4.2 never uses it, so SQLite runs as many dispatchers as Postgres does, and
`transactional-outbox.md`'s "on SQLite run exactly one relay" restriction is retired by this design rather
than documented.

## 6. The publish path, and the guarantee that is the whole point

```ts
export declare function outboxWriter(tx: TransactionContext): OutboxWriter;
export interface OutboxWriter {
  write(topic: string, payload: string): Promise<string>; // returns the id
}
```

`TransactionContext` (`../../../repository/src/transactions/index.ts:8-12`) is the real type — the issue calls
it `Transaction`, which does not exist. It has `execute` and `savepoint`, and `execute` is all that is needed.

**The guarantee: the row is written through the caller's transaction, so a rollback discards the event.** There
is no compensating action, no cleanup pass and nothing to reconcile, because a rolled-back insert never
existed. `#593` asserts it in the only way that means anything: begin, write a row, write an outbox entry,
throw, then assert the outbox table is empty — with a real driver, because a mocked transaction would assert
the mock.

The trap here is already documented and is not restated: `web-events.md` explains that
`repo.withTransaction(tx)` returns a _new_ repository and that an un-rebound instance "would commit on its own
connection and the atomicity would be a fiction that reads exactly like the correct code". `outboxWriter(tx)`
takes the transaction as its only constructor argument for that reason — there is no instance that could be
holding the wrong connection, because there is no instance that exists without one.

`withTransaction(tx: { execute: Driver['execute'] })` (`../../../repository/src/index.ts:135`) is structural,
so a `TransactionContext` satisfies it with no adapter. Nothing new is needed to put a repository and the
outbox in the same transaction.

## 7. Ordering, stated as weakly as it actually is

**The outbox guarantees delivery. It does not guarantee order.** Not globally, and not per topic.

| Configuration               | Ordering                                             |
| --------------------------- | ---------------------------------------------------- |
| one dispatcher, `batch: 1`  | per-topic and global, by `createdAt`                 |
| one dispatcher, `batch > 1` | claimed in `createdAt` order; published sequentially |
| more than one dispatcher    | **none**                                             |

The last row is the one to read twice. Two dispatchers claim two rows of the same topic in the same instant
and publish them concurrently; which one the broker acknowledges first is the broker's business. There is no
per-topic ordering to fall back on, and a design that wants one needs a per-topic lease rather than a per-row
one — which is a different feature with a different failure mode (one stuck topic blocks itself, forever) and
is a non-goal.

`#592` step 9 asks for this to be stated honestly "because users will assume more than is true". Stating it in
the type is better than stating it in prose, and `#593` pins the prose: the documented guarantee is delivery,
and the ordering row for "more than one dispatcher" says _none_ rather than _best-effort_.

## 8. At-least-once, and the crash that is the reason

`publish` resolves; the process dies before the mark; the lease expires; another dispatcher claims the row and
publishes it again. **That is the duplicate**, and it is not avoidable without a distributed transaction
between this database and the broker, which is the thing the outbox exists to not need.

So delivery is **at-least-once** and consumers must be idempotent. `attempts` is visible in the payload's own
row, and a deduplication key belongs in the payload — `transactional-outbox.md` already says so. Consumer-side
idempotency is the queue epic's (`#585`) and is cross-referenced rather than restated, per `#592` step 10.

The reverse ordering — mark first, then publish — is refused: it converts a crash from a duplicate into a
**loss**, and a lost event in a system whose entire purpose is not losing events is the worse trade by a wide
margin.

## 9. What #593 has to assert

1. `an outbox row written in a transaction is gone after a rollback` — §6, against a real driver, asserting the
   table is empty.
2. `an outbox row written in a transaction survives a commit` — the other half, so the first test cannot pass
   by writing nothing.
3. `two claims against one row: the second claims nothing` — §4.2, interleaved, proving the predicate is the
   mutual exclusion.
4. `a lapsed lease is reclaimable` — advance the clock past `leaseUntil` and claim again.
5. `a mark whose lease was stolen writes nothing` — §4.3's `lease_owner = :token` guard, asserting `attempts`
   did not move.
6. `a failing publish backs off and stays pending` — `leaseUntil` in the future, `attempts` incremented,
   `lastError` set, `status` unchanged.
7. `a row at maxAttempts goes dead and leaves the candidate set` — and `onDead` fires once, and a subsequent
   `runOnce` does not see it. This is the poison-row assertion.
8. `the pending index is partial on postgres and sqlite and full on mysql` — §3, golden DDL per dialect.
9. `the candidate query never emits IS NULL` — golden SQL, because §2.1 is a rule that a later change would
   quietly break.
10. `no claim statement emits RETURNING` — §4.1, so the MySQL defect cannot reach the outbox.
11. `the dispatcher's idle interval doubles to the cap and resets on work` — §5.
12. `shutdown stops claiming and does not wait for the lease` — §5, asserting in-flight rows are still pending.

## Non-goals (rejected)

- **No `FOR UPDATE SKIP LOCKED`.** §4 — inexpressible, absent on SQLite, and it forces the broker's latency
  inside a database transaction. §4.2 is not a workaround for it; it is better.
- **No affected-row count on `Driver`.** §4.1 — adding one would change an interface every driver implements,
  for a design that no longer needs it.
- **No `RETURNING` in any outbox statement**, and no fix to `returningClause`'s missing dialect guard here.
  It is a real defect and it belongs to whoever owns `../index.ts:196-199`.
- **No `IS NULL` operator.** §2.1 — a real gap, worth closing, and not by a subsystem that can express itself
  without it. Adding an operator that changes how `null` binds in every existing query is not an outbox change.
- **No `attempts = attempts + 1`.** §4.3 — the lease makes the read-modify-write safe, so a column-referencing
  SET buys nothing here and would need a whole expression language to buy anything anywhere.
- **No per-topic ordering.** §7 — a per-topic lease means one stuck topic blocks itself indefinitely, which is
  a worse failure than unordered delivery for every application that does not need order.
- **No exactly-once.** §8 — it needs a distributed transaction with the broker, which is the thing being
  avoided.
- **No dead-letter table.** `status = 'dead'` plus `onDead` is the whole mechanism. A second table needs its
  own retention, its own migration and its own index, and the rows are already queryable where they are.
- **No `NOTIFY`-based wake-up.** §5 — Postgres-only, and `transactional-outbox.md` already documents it as
  something to add on top with the poll kept as a floor.
- **No broker.** `publish` is a function the application supplies. A shipped adapter for one broker is the
  transports epic's, and picking one here would be picking it for everybody.
- **No scheduler.** `start()` is a timer; running the dispatcher as a managed background worker is `#585`'s,
  and `transactional-outbox.md` correctly names that as the thing this waited on.
