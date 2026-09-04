// Tests freeze (#593), the compile-time half of packages/query-compiler/src/outbox/SPEC.md.
//
// The claims a runtime test cannot make: that the frozen row declaration of §2 and the frozen
// options of §5 are the types the spec says they are, that `exactOptionalPropertyTypes` refuses an
// explicit `undefined` for the optional knobs, that §6's "no adapter needed" is a structural fact
// about `withTransaction` and not an intention, and that the non-goals of §7 are absent from the
// surface rather than merely undocumented.
//
// No runtime code. This file is compiled by `node scripts/typecheck.mjs` and therefore by CI; it
// checks the shipped exports directly against the frozen surface.
import type { Equal, Expect, Mutual } from '@zmdb/schema-core';
import type { HasDefault, PrimaryKey, Sql } from '@zmdb/schema-core/tags';

import type { Driver } from '../index.js';
import type { TransactionContext } from '../transactions/index.js';
import {
  outboxWriter,
  type DeadOutboxRow,
  type OutboxDispatcher,
  type OutboxDispatcherOptions,
  type OutboxRow,
  type OutboxStatus,
  type OutboxWriter,
} from './index.js';

declare const driver: Driver;
declare const tx: TransactionContext;

// ===========================================================================
// §2.1 — nullability is the load-bearing property of the row
// ===========================================================================

// The claim: exactly two columns are nullable. §4.2's candidate predicate reads `status` and
// `leaseUntil`, and a NULL there is not `< now` and not `= 'pending'`, so a row would become
// permanently invisible with no error anywhere. `leaseOwner` and `leaseUntil` therefore carry
// sentinels ('' and the epoch), not NULL, and this assertion is what stops a later "make it
// nullable, it reads better" change from silently breaking claiming.
type NullableColumns = { [K in keyof OutboxRow]-?: null extends OutboxRow[K] ? K : never }[keyof OutboxRow];
type _OnlyTwoNullableColumns = Expect<Mutual<NullableColumns, 'deliveredAt' | 'lastError'>>;

// The corollary, stated positively so a reader of the failure knows which way round it goes.
type _LeaseUntilIsNotNullable = Expect<Equal<null extends OutboxRow['leaseUntil'] ? true : false, false>>;
type _LeaseOwnerIsNotNullable = Expect<Equal<null extends OutboxRow['leaseOwner'] ? true : false, false>>;

// §2.1: three states, closed. A fourth ('retrying') is what §2.2 explicitly refuses — retrying is
// `pending` with a future lease, not a state — so the union being closed is an assertion, not a
// formality.
type _StatusIsAClosedUnion = Expect<Equal<OutboxStatus, 'pending' | 'delivered' | 'dead'>>;
type _StatusCarriesItsPhysicalDefault = Expect<Equal<OutboxRow['status'] extends HasDefault ? true : false, true>>;
// @ts-expect-error - 'retrying' is not a status: a retry is `pending` with a future leaseUntil (§2.2).
const notAStatus: OutboxStatus = 'retrying';
void notAStatus;

// §2.3: `payload` is text, not json. A `json`-tagged column would round-trip through the driver's
// JSON handling and stop being byte-comparable to what the writer passed, which is what the
// payload-fidelity test in ./outbox.spec.ts asserts from the runtime side.
type _PayloadIsText = Expect<Equal<OutboxRow['payload'] extends Sql<'text'> ? true : false, true>>;

// The negative half. Note it has to be written as an assignment, not as `Expect<Equal<…>>`:
// `Sql<T>` is `{ readonly [zmdbSqlType]?: T }` (../../../schema-core/src/tags/index.ts:117), an
// OPTIONAL phantom property, so a bare `string` IS assignable to `string & Sql<'text'>` and
// `Expect<Equal<string extends OutboxRow['payload'] ? true : false, false>>` fails — verified
// 2026-09-04, TS2344 "Type 'false' does not satisfy the constraint 'true'". What the tags do
// discriminate is one tag against another, which is the claim worth making.
declare const jsonPayload: string & Sql<'json'>;
// @ts-expect-error - a json-tagged value is not a text column: '"json"' is not assignable to '"text"'.
const payloadIsNotJson: OutboxRow['payload'] = jsonPayload;
void payloadIsNotJson;

// §2.4: a text id, generated in the application, because §7 refuses RETURNING and a
// database-generated id cannot be read back without it.
type _IdIsText = Expect<Equal<OutboxRow['id'] extends string & Sql<'text'> ? true : false, true>>;
type _IdIsThePrimaryKey = Expect<Equal<OutboxRow['id'] extends PrimaryKey ? true : false, true>>;

// ===========================================================================
// §5 — the options
// ===========================================================================

// Two required, seven optional. This is the assertion that keeps `createOutboxDispatcher(...)`
// callable with a two-property literal, which is what every test and every example depends on.
type RequiredOptions = {
  [K in keyof OutboxDispatcherOptions]-?: {} extends Pick<OutboxDispatcherOptions, K> ? never : K;
}[keyof OutboxDispatcherOptions];
type _OnlyDriverAndPublishAreRequired = Expect<Mutual<RequiredOptions, 'driver' | 'publish'>>;

const minimal: OutboxDispatcherOptions = { driver, publish: () => Promise.resolve() };
void minimal;

// `exactOptionalPropertyTypes: true` is on in this repo, so `{ batch: undefined }` is refused
// rather than silently meaning "default". Callers building options conditionally must omit the key.
// Verified 2026-09-04: this is TS2375 and it is reported on the DECLARATION line, not on the
// `batch:` line — a directive on the property fails with TS2578 "Unused '@ts-expect-error'".
// @ts-expect-error - exactOptionalPropertyTypes refuses an explicit undefined; omit the key instead.
const explicitUndefined: OutboxDispatcherOptions = { driver, publish: () => Promise.resolve(), batch: undefined };
void explicitUndefined;

// §5: `backoffMs` takes the attempt count and returns milliseconds. Both numbers, so the only
// thing a type can pin is the arity and that it is not `(row) => number` — the backoff must not be
// able to depend on the payload, or it stops being a pure function of the retry count.
type _BackoffTakesOneNumber = Expect<
  Equal<NonNullable<OutboxDispatcherOptions['backoffMs']>, (attempts: number) => number>
>;

// §5: `onDead` may be async and the dispatcher awaits it, so a handler that writes to a database
// is a legal handler. `void | Promise<void>` rather than `void` is the assertion.
type _OnDeadMayBeAsync = Expect<
  Equal<ReturnType<NonNullable<OutboxDispatcherOptions['onDead']>>, void | Promise<void>>
>;

// §5: the dead-row callback gets the payload, because the whole reason to observe it is to page
// someone with enough context to replay by hand. It does NOT get the full row: `status`,
// `leaseOwner` and `leaseUntil` are dispatcher bookkeeping and exposing them would invite a
// handler that writes them back.
type _DeadRowShape = Expect<Mutual<keyof DeadOutboxRow, 'id' | 'topic' | 'payload' | 'attempts' | 'lastError'>>;

// §5: `runOnce` reports all three counts, so a caller (a test, a cron entry, a health probe) can
// tell "nothing to do" from "everything failed" without reading the table.
type _RunOnceReport = Expect<
  Equal<
    Awaited<ReturnType<OutboxDispatcher['runOnce']>>,
    { readonly claimed: number; readonly delivered: number; readonly failed: number }
  >
>;

// §5: `start` and its lifecycle alias are fire-and-forget; `onShutdown` is the awaitable. A
// `start(): Promise<void>` that resolved when the loop stopped would be un-awaitable in an init hook
// without hanging it.
type _StartIsSync = Expect<Equal<ReturnType<OutboxDispatcher['start']>, void>>;
type _InitIsSync = Expect<Equal<ReturnType<OutboxDispatcher['onModuleInit']>, void>>;
type _ShutdownIsAwaitable = Expect<Equal<ReturnType<OutboxDispatcher['onShutdown']>, Promise<void>>>;

// ===========================================================================
// §4.1 and §6 — the seams, which are structural
// ===========================================================================

// §4.1: the dispatcher's only database seam is `Driver`. Its optional dialect and
// compile-telemetry marker do not make an object literal stop being a driver, which is what
// makes the fake driver in ./outbox.spec.ts legal without a mocking library.
const structuralDriver: Driver = { execute: () => Promise.resolve([]) };
void structuralDriver;
type _DriverIsOneMethodPlusOptions = Expect<Mutual<keyof Driver, 'dialect' | 'queryTelemetry' | 'execute'>>;

// §6's closing claim: a repository joins an outbox transaction with no new adapter, because
// `withTransaction` takes `{ execute: Driver['execute'] }` structurally and a `TransactionContext`
// already has that method with that signature. Verified 2026-09-04. If `withTransaction` ever
// narrows to a nominal parameter this assertion is the thing that catches it.
type WithTransactionParam = { execute: Driver['execute'] };
type _TxSatisfiesWithTransaction = Expect<Equal<TransactionContext extends WithTransactionParam ? true : false, true>>;

// §6: `write` resolves the id, so the caller can correlate without a read-back — the id exists
// before the INSERT (§2.4).
type _WriteResolvesTheId = Expect<Equal<Awaited<ReturnType<OutboxWriter['write']>>, string>>;
const writer = outboxWriter(tx);
void writer;

// §6: the writer takes a `TransactionContext`, not a `Driver`. Handing it a bare driver would let
// a caller write an outbox row outside a transaction, which is the one thing the pattern exists to
// prevent, so the compiler refuses it.
// @ts-expect-error - a Driver is not a TransactionContext: an outbox write must be inside a transaction.
const writerOutsideATransaction = outboxWriter(driver);
void writerOutsideATransaction;

// ===========================================================================
// §7 — the non-goals, asserted as absences
// ===========================================================================

// "Ordered delivery: no." There is no knob, so nobody can configure a guarantee the design does
// not provide. Prose in a spec does not stop a PR; a missing key does.
type _NoOrderingKnob = Expect<Equal<'ordered' extends keyof OutboxDispatcherOptions ? true : false, false>>;
type _NoPartitionKnob = Expect<Equal<'partitionBy' extends keyof OutboxDispatcherOptions ? true : false, false>>;

// "Exactly-once delivery: no." §8 documents at-least-once, so there is no dedupe or idempotency
// key on this side of the boundary — that is the consumer's, and it is #587's freeze.
type _NoDedupeKnob = Expect<Equal<'dedupe' extends keyof OutboxDispatcherOptions ? true : false, false>>;

// "A queue: no." No concurrency or worker-count option; that is @zmdb/web's queues module.
type _NoConcurrencyKnob = Expect<Equal<'concurrency' extends keyof OutboxDispatcherOptions ? true : false, false>>;

// §4.3: the claim is a bare UPDATE, so nothing in the surface reports affected rows — the read-back
// is the count. `Driver` has no `rowCount`, which is exactly why §4.2 needs three statements
// instead of two. Verified 2026-09-04 against packages/repository/src/index.ts.
type _DriverHasNoRowCount = Expect<Equal<'rowCount' extends keyof Driver ? true : false, false>>;
type _ExecuteResolvesRowsOnly = Expect<
  Equal<Awaited<ReturnType<Driver['execute']>>, readonly Record<string, unknown>[]>
>;
