import type { TransactionContext } from '@zmdb/repository/transactions';
// Tests freeze (#593), the compile-time half of packages/web/src/events/SPEC.md: §9 item 4's type
// clause ("a type-test that `emit(…)` is not awaitable") and §9 item 6 in full ("binding an event
// the map does not declare is a compile error — type-test, both on `on` and on the payload").
//
// It also records the one place the spec's own example does not compile: §2's prose and
// docs-site/content/web-events.md both write `interface AppEvents { … }`, and an interface does not
// satisfy `EventMap`'s index signature. That is asserted here rather than described, because it is
// the first thing every reader of the docs will hit.
//
// No runtime code. Compiled by `node scripts/typecheck.mjs`, not run by vitest. While ./index.ts
// does not exist the surface below is §2/§3/§6 transcribed; when it lands, delete the transcription
// and add:
//
//   import type { EmitReport, EventFailure, EventMap, Events, EventsOptions, ResolvedEventHandler } from './index.js';
//   import type { OnEvent } from './index.js';
//
// leaving every assertion untouched.
import type { Equal, Expect, Mutual } from '@zmdb/schema-core';

// ---------------------------------------------------------------------------
// SPEC §2, §3 and §6 — the surface, transcribed
// ---------------------------------------------------------------------------
interface EventMap {
  readonly [event: string]: unknown;
}

interface EventFailure {
  readonly event: string;
  readonly handler: string;
  readonly error: unknown;
}

interface EmitReport {
  readonly delivered: number;
  readonly failures: readonly EventFailure[];
}

interface Events<M extends EventMap> {
  emit<K extends keyof M & string>(event: K, payload: M[K]): void;
  emitAndWait<K extends keyof M & string>(event: K, payload: M[K]): Promise<EmitReport>;
  on<K extends keyof M & string>(event: K, handler: (payload: M[K]) => void | Promise<void>): () => void;
  bind(instance: object): () => void;
  emitInTransaction<K extends keyof M & string>(tx: TransactionContext, event: K, payload: M[K]): Promise<string>;
}

interface EventsOptions<M extends EventMap> {
  readonly onError: (failure: EventFailure) => void;
  readonly validate?: { readonly [K in keyof M]?: (raw: unknown) => M[K] };
}

interface ResolvedEventHandler {
  readonly event: string;
  readonly handlerName: string;
}

declare function createEvents<M extends EventMap>(opts: EventsOptions<M>): Events<M>;
declare function OnEvent(event: string): (target: Function, context: ClassMethodDecoratorContext) => void;
declare function getEventHandlers(cls: abstract new (...args: never[]) => unknown): readonly ResolvedEventHandler[];

// ---------------------------------------------------------------------------
// the map. A TYPE ALIAS — see the block at the bottom of this file for why.
// ---------------------------------------------------------------------------
type AppEvents = {
  readonly 'post.published': { readonly id: number };
  readonly 'user.deleted': { readonly userId: string };
};

declare const onError: (failure: EventFailure) => void;
const events = createEvents<AppEvents>({ onError });

// ===========================================================================
// §9 item 4 (type clause) — emit is not awaitable
// ===========================================================================

// SPEC §4: "A method that returns `void` cannot be awaited by mistake and cannot produce an
// unhandled rejection." The positive form.
type _EmitReturnsVoid = Expect<Equal<ReturnType<Events<AppEvents>['emit']>, void>>;

// And the negative, which is the one that would catch a later `emit(): Promise<void>` "improvement":
// nothing promise-shaped is assignable to the return type.
type _EmitIsNotThenable = Expect<
  Equal<Promise<void> extends ReturnType<Events<AppEvents>['emit']> ? true : false, false>
>;

// The user-visible consequence, asserted as a compile error rather than as a type equality, because
// this is the line a caller actually writes. TS2339 is reported on the `.then`, so the directive
// goes on the expression and not on a declaration.
// @ts-expect-error - emit returns void: there is nothing to chain, and nothing to await.
void events.emit('post.published', { id: 1 }).then(() => undefined);

// The contrast that makes the pair meaningful: `emitAndWait` IS awaitable, and resolves a report.
type _EmitAndWaitIsAwaitable = Expect<Equal<ReturnType<Events<AppEvents>['emitAndWait']>, Promise<EmitReport>>>;
type _ReportShape = Expect<Mutual<keyof EmitReport, 'delivered' | 'failures'>>;

// §3: `error` stays `unknown`. Narrowing it to `Error` "would be a claim the runtime cannot keep",
// and a test that threw a string proves the runtime cannot keep it.
type _FailureErrorIsUnknown = Expect<Equal<EventFailure['error'], unknown>>;
type _FailureShape = Expect<Mutual<keyof EventFailure, 'event' | 'handler' | 'error'>>;

// §3: `onError` is REQUIRED. This is the one piece of friction the spec sets out to defend, so it
// is asserted: `createEvents({})` must not compile.
// @ts-expect-error - onError is required: §3 refuses both a silent default and a console.error one.
const noSink = createEvents<AppEvents>({});
void noSink;

// §2: `validate` is optional AND per event — a single entry is a complete `validate`, unlike
// ../subscriptions/SPEC.md's total `TopicValidators<M>`.
const partialValidate: EventsOptions<AppEvents> = {
  onError,
  validate: { 'post.published': raw => ({ id: Number(raw) }) },
};
void partialValidate;

// §4 non-goal: "No `wait` option on `emit`." A third parameter does not exist, so the union return
// type the spec refuses cannot be introduced by a caller.
// @ts-expect-error - emit takes two arguments: §4 refuses `{ wait: true }`.
events.emit('post.published', { id: 1 }, { wait: true });

// ===========================================================================
// §9 item 6 — an undeclared event is a compile error, on both sides
// ===========================================================================

// "both on `on` and on the payload", so four assertions: a bad name and a bad payload, each on the
// registering side and on the emitting side.

// @ts-expect-error - 'post.unpublished' is not a key of AppEvents.
events.on('post.unpublished', () => undefined);

// @ts-expect-error - 'post.unpublished' is not a key of AppEvents.
events.emit('post.unpublished', { id: 1 });

// @ts-expect-error - the payload for 'post.published' is { id: number }, not { id: string }.
events.emit('post.published', { id: 'not-a-number' });

// The handler's parameter is inferred from the map, so reading a field the payload does not have is
// an error inside the handler body. This is the half that makes the map worth having: §2 refuses
// `EventType<T>` precisely because a caller-supplied generic lets "a handler declare a payload type
// the emitter never agreed to, and the two compile independently".
events.on('post.published', payload => {
  // @ts-expect-error - 'userId' is not on { id: number }: the handler cannot widen its own payload.
  void payload.userId;
});

// The same, stated as a declaration so the failure names the type rather than a property.
// @ts-expect-error - a handler for 'user.deleted' does not accept a { id: number } payload.
const wrongHandler: Parameters<Events<AppEvents>['on']>[1] = (payload: { readonly nope: boolean }) => {
  void payload.nope;
};
void wrongHandler;

// And the positive baseline, so the four negatives cannot all be passing for a shared wrong reason.
const off: () => void = events.on('user.deleted', payload => {
  void payload.userId.length;
});
void off;

// §2: `keyof M & string` and not `keyof M`. With a `symbol`-keyed map entry the event parameter must
// still be a string, because the outbox `topic` column is text (../../../query-compiler/src/outbox/
// SPEC.md §2.3) and a symbol has no serialisation.
type _EventKeyIsAString = Expect<Equal<Parameters<Events<AppEvents>['emit']>[0], 'post.published' | 'user.deleted'>>;

// ===========================================================================
// §6 — the decorator's shape, and §5's crossing
// ===========================================================================

// §6: "`MethodDecorator` does not exist under Stage 3; the shape is `(target, context:
// ClassMethodDecoratorContext)`, the same correction ../graphql/SPEC.md §13 and
// ../subscriptions/SPEC.md §3 record." Asserted on the returned decorator's parameter list, which
// is what a `@OnEvent('x')` application actually has to satisfy.
type Decorator = ReturnType<typeof OnEvent>;
type _DecoratorContextIsStage3 = Expect<Equal<Parameters<Decorator>[1], ClassMethodDecoratorContext>>;
type _DecoratorReturnsVoid = Expect<Equal<ReturnType<Decorator>, void>>;

// §6: `getEventHandlers` takes the CLASS. Handing it an instance must not compile — "nothing scans",
// and an instance-taking reader is the first step towards something that does.
class Subscriber {
  onPublished(): void {
    // nothing
  }
}
const fromClass: readonly ResolvedEventHandler[] = getEventHandlers(Subscriber);
void fromClass;
// @ts-expect-error - getEventHandlers reads the class, not an instance (§6).
const fromInstance = getEventHandlers(new Subscriber());
void fromInstance;

// §6: `ResolvedEventHandler` mirrors `ResolvedRoute` (../routing/index.ts:21-25) and deliberately
// does NOT reuse ./gateways' `EventBinding`. Two fields, no more; a `handler` function field would
// make the reader hold a bound closure and turn a declaration reader into a registry.
type _ResolvedShape = Expect<Mutual<keyof ResolvedEventHandler, 'event' | 'handlerName'>>;

// §5: `emitInTransaction` resolves the outbox row's id, and it takes a `TransactionContext` — the
// real type at ../../../repository/src/transactions/index.ts:8-12. #592 calls it `Transaction`,
// which does not exist; this assertion is what stops that name coming back.
type _EmitInTransactionResolvesAnId = Expect<
  Equal<ReturnType<Events<AppEvents>['emitInTransaction']>, Promise<string>>
>;
type _EmitInTransactionTakesATx = Expect<
  Equal<Parameters<Events<AppEvents>['emitInTransaction']>[0], TransactionContext>
>;

// ===========================================================================
// the defect: §2's own example does not compile
// ===========================================================================
//
// SPEC §2 justifies the map by pointing at the docs — "it is what
// docs-site/content/web-events.md already recommends (`interface AppEvents { 'post.published':
// { id: number } }`)". That declaration does not satisfy `EventMap`. Verified 2026-09-04: TS2344,
// "Index signature for type 'string' is missing in type 'AppEvents'". Only object-literal type
// ALIASES receive an implicit index signature; interface declarations do not, because an interface
// is open to declaration merging and the compiler therefore cannot know its key set is closed.
//
// The fix is one keyword — `type` instead of `interface` — and it belongs in the spec and in the
// docs page (see DOCS.md), not in a workaround here.
interface InterfaceMap {
  readonly 'post.published': { readonly id: number };
}
// @ts-expect-error - an interface has no implicit index signature, so it does not satisfy EventMap.
declare const eventsFromAnInterface: Events<InterfaceMap>;
void eventsFromAnInterface;

// The alias form, which does.
type AliasMap = {
  readonly 'post.published': { readonly id: number };
};
declare const eventsFromAnAlias: Events<AliasMap>;
void eventsFromAnAlias;

// The narrow statement of the rule, so a reader does not conclude that interfaces are unusable
// generally: an interface WITH an explicit index signature is fine. That is the other legal fix,
// and it is worse for a map — the index signature makes every unknown event name type-check, which
// is exactly the checking §9 item 6 asserts.
interface IndexedMap {
  readonly [event: string]: unknown;
  readonly 'post.published': { readonly id: number };
}
declare const eventsFromAnIndexedInterface: Events<IndexedMap>;
void eventsFromAnIndexedInterface;
// ...and here is the cost, asserted so nobody chooses it by accident: the undeclared event compiles.
eventsFromAnIndexedInterface.emit('post.unpublished', { anything: true });
