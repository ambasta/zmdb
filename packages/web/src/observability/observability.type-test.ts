// Type-level tests for the telemetry port frozen in ./SPEC.md §2, §3, §5 (#580, epic #578).
// No runtime code: a *compilation* gate run by `node scripts/typecheck.mjs`, and therefore
// by CI. `packages/web/tsconfig.json` includes `src/**/*.ts`, so this file is compiled.
//
// Three of this epic's decisions are compile-time decisions and have no runtime shadow at
// all, so if they are not asserted here they are not asserted anywhere:
//
//   - `Observability.comments.keys` being `readonly [CommentKey, ...CommentKey[]]` rather
//     than `readonly CommentKey[]` — ./SPEC.md §2 rejects the sketch's three spellings of
//     "off", and the empty array being one of them is only a *compile* error.
//   - `Ctx.span` being a definite `Span` inside the tracer branch under
//     `exactOptionalPropertyTypes` — §3 states this as "verified"; these lines are the
//     verification.
//   - `Meter.histogram`'s `unit: 's'` literal — §7's seconds-not-milliseconds rule is a
//     runtime assertion for the *value* and a compile-time one for the *unit*.
//
import type { Equal, Expect } from '@zmdb/schema-core';

import type { Ctx } from '../context/index.js';
import {
  SpanKind,
  type Attributes,
  type CommentKey,
  type Meter,
  type Observability,
  type QueryTelemetry,
  type Span,
  type SpanContext,
  type SpanOptions,
  type TraceCarrier,
  type Tracer,
} from './index.js';

// §3: `Ctx` gains exactly one field. Written here as an intersection rather than a
// re-declaration so that the assertions below are about the *real* `Ctx` — when #582 adds
// `readonly span?: Span` to `../context/index.ts`, `TracedCtx` becomes `Ctx` and every
// assertion still holds. Widening it to `Span | undefined` breaks `spanIsDefinite` below.
type TracedCtx = Ctx;

declare const tracer: Tracer;
declare const meter: Meter;
declare const parentContext: SpanContext;

// Every negative assertion in this file is written as a ONE-LINE declaration, deliberately.
// `@ts-expect-error` suppresses errors reported on the single following line, and TypeScript
// reports different error kinds in different places: a *missing* required property lands on
// the declaration's identifier (TS2741), a property whose *value* is unassignable lands on
// that property, and an excess property lands on the property. A one-line declaration puts
// every candidate position on the covered line, so an assertion cannot rot into
// `TS2578: Unused '@ts-expect-error' directive` when a compiler release moves the span.

// --- §2: `comments` present means on, and there is no second spelling of off ----

export const commentsOn: Observability = { comments: { keys: ['traceparent'] } };
export const commentsAll: Observability = {
  comments: { keys: ['action', 'controller', 'framework', 'route', 'traceparent'] },
};
export const commentsOff: Observability = { tracer };
// @ts-expect-error — `keys: []` is the sketch's third spelling of "off"; a non-empty tuple makes it a compile error (§2).
export const commentsEmpty: Observability = { comments: { keys: [] } };
// @ts-expect-error — `enabled: false` is the sketch's second spelling of "off"; there is no such field (§2).
export const commentsEnabled: Observability = { comments: { enabled: false, keys: ['route'] } };
// @ts-expect-error — the key set is closed: `request_id` is the highest-cardinality thing available and is rejected (§2, comments SPEC §5).
export const commentsRequestId: Observability = { comments: { keys: ['request_id'] } };
// @ts-expect-error — `application` and `db_driver` are sqlcommenter keys this spec omits (comments SPEC §2).
export const commentsApplication: Observability = { comments: { keys: ['application'] } };

// A widened element type is what an implementation would reach for to make `keys: []`
// compile again, so assert the tuple-ness directly rather than only through the negative.
export type _KeysIsNonEmptyTuple = Expect<
  Equal<NonNullable<Observability['comments']>['keys'], readonly [CommentKey, ...CommentKey[]]>
>;
export type _CommentKeyIsClosed = Expect<
  Equal<CommentKey, 'traceparent' | 'controller' | 'action' | 'route' | 'framework'>
>;

// --- §3: `Ctx.span` is definite inside the branch, under exactOptionalPropertyTypes ---
//
// This is the assertion §3 calls "verified", and it is the reason the router fills `span`
// inside the tracer branch instead of computing `tracer?.startSpan(...)` and spreading the
// result: the second shape does not compile, which is the point.

declare const baseCtx: Ctx;
declare const definiteSpan: Span;
declare const maybeSpan: Span | undefined;

export const spanIsDefinite: TracedCtx = { ...baseCtx, span: definiteSpan };
export const spanIsAbsent: TracedCtx = { ...baseCtx };
// @ts-expect-error — `Span | undefined` is not assignable to an optional `Span` under exactOptionalPropertyTypes (§3).
export const spanIsMaybe: TracedCtx = { ...baseCtx, span: maybeSpan };
// @ts-expect-error — nor is an explicit `undefined`, which is the same mistake spelled out.
export const spanIsUndefined: TracedCtx = { ...baseCtx, span: undefined };

// Readers use `ctx.span?.setAttribute(...)`, so reading it unconditionally must be an error;
// otherwise the optionality is decoration and every reader is one refactor from a TypeError.
export const spanRead: string | undefined = baseCtxTraced().span?.spanContext().traceId;
function baseCtxTraced(): TracedCtx {
  return baseCtx;
}
// @ts-expect-error — `ctx.span` is possibly undefined: it is only present inside the tracer branch (§3).
export const spanReadUnchecked: string = baseCtxTraced().span.spanContext().traceId;

// §3 refuses `AsyncLocalStorage`, so there is nothing ambient to read a span from: `Ctx` is
// the only carrier. Asserting the key set is how a later `currentSpan()` helper gets noticed.
export type _TracedCtxKeys = Expect<Equal<keyof TracedCtx, keyof Ctx | 'span'>>;

// --- §2: the port's own shape ------------------------------------------------
//
// §2 explicitly does *not* claim structural compatibility with `@opentelemetry/api`, so
// there is nothing to compile against it. What is worth pinning is that the port stayed
// narrow: an added method is an added thing every adapter has to implement, and it would
// arrive silently.
export type _SpanMethods = Expect<
  Equal<keyof Span, 'updateName' | 'setAttribute' | 'recordException' | 'setStatus' | 'end' | 'spanContext'>
>;
export type _SpanContextKeys = Expect<
  Equal<keyof SpanContext, 'traceId' | 'spanId' | 'traceFlags' | 'isRemote' | 'traceState'>
>;
export type _SpanKindIsClosed = Expect<Equal<SpanKind, 'internal' | 'server' | 'client' | 'producer' | 'consumer'>>;
export type _SpanOptionsKeys = Expect<Equal<keyof SpanOptions, 'parent' | 'link' | 'kind'>>;
export type _TraceCarrierKeys = Expect<Equal<keyof TraceCarrier, 'traceparent' | 'tracestate'>>;
export type _TracerMethods = Expect<Equal<keyof Tracer, 'startSpan'>>;
export type _MeterMethods = Expect<Equal<keyof Meter, 'counter' | 'histogram'>>;
export type _ObservabilityKeys = Expect<Equal<keyof Observability, 'tracer' | 'meter' | 'comments'>>;

declare const span: Span;
export const renamed: void = span.updateName('GET /posts/:id');
export const statusOk: void = span.setStatus({ error: false });
// @ts-expect-error — `setStatus` takes `{ error: boolean }`, not OpenTelemetry's `{ code: SpanStatusCode }` (§2: this is a port, not a re-export).
export const statusCode: void = span.setStatus({ code: 2 });

// `startSpan`'s options carry a `SpanContext`, not a `Span`. §8 needs both a parent and a
// link, and the linked case is the one an implementation gets wrong by passing the span.
export const childSpan: Span = tracer.startSpan('zmdb.request', { parent: parentContext });
export const linkedSpan: Span = tracer.startSpan('zmdb.request', { link: parentContext });
export const rootSpan: Span = tracer.startSpan('zmdb.request');
export const internalSpan: Span = tracer.startSpan('zmdb.internal', { kind: SpanKind.INTERNAL });
export const serverSpan: Span = tracer.startSpan('zmdb.server', { kind: SpanKind.SERVER });
export const clientSpan: Span = tracer.startSpan('zmdb.client', { kind: SpanKind.CLIENT });
export const producerSpan: Span = tracer.startSpan('zmdb.producer', { kind: SpanKind.PRODUCER });
export const consumerSpan: Span = tracer.startSpan('zmdb.consumer', { kind: SpanKind.CONSUMER });
// @ts-expect-error — a `Span` is not a `SpanContext`: the port carries context, not the span object (§2, §8).
export const parentIsSpan: Span = tracer.startSpan('zmdb.request', { parent: span });
// @ts-expect-error — there is no `attributes` option; attributes are set through `setAttribute` (§2).
export const spanWithAttrs: Span = tracer.startSpan('zmdb.request', { attributes: { 'url.path': '/posts/1' } });
// @ts-expect-error — the span role is a closed union, not an arbitrary exporter string.
export const invalidKind: Span = tracer.startSpan('zmdb.request', { kind: 'database' });

export const remoteContext: SpanContext = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  traceFlags: 1,
  isRemote: true,
  traceState: 'vendor=value',
};
export const traceCarrier: TraceCarrier = {
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  tracestate: 'vendor=value',
};
// @ts-expect-error — the port preserves serialized tracestate rather than exposing an SDK TraceState object.
export const objectTraceState: SpanContext = { ...remoteContext, traceState: { serialize: () => 'vendor=value' } };
// @ts-expect-error — trace headers are strings at every transport boundary.
export const numericTraceparent: TraceCarrier = { traceparent: 1 };

// --- §7: the unit is a literal, so a millisecond histogram cannot be constructed ---
//
// §7's argument is that a millisecond histogram exported under a seconds-named metric lands
// every observation in the top bucket. The runtime half of that lives in
// ./observability.spec.ts; this half makes the mistake unrepresentable.
export const httpHistogram = meter.histogram('http.server.request.duration', 's');
export const dbHistogram = meter.histogram('db.client.operation.duration', 's');
// @ts-expect-error — `'ms'` is not the unit: semconv duration histograms are seconds (§7).
export const msHistogram = meter.histogram('http.server.request.duration', 'ms');
// @ts-expect-error — and the unit is not optional, so it cannot be defaulted to whatever the caller had (§7).
export const unitlessHistogram = meter.histogram('http.server.request.duration');

// `Attributes` is flat and scalar. A nested object is the shape an exporter cannot encode,
// and it is what `{ ...someObject }` produces when somebody spreads a request in.
export const attrsOk: Attributes = { 'http.route': '/posts/:id', 'http.response.status_code': 200 };
// @ts-expect-error — attribute values are `string | number | boolean`: no nested objects (§2).
export const attrsNested: Attributes = { 'http.request.header': { host: 'example.test' } };
// @ts-expect-error — and no arrays, which is the other thing a header value arrives as.
export const attrsArray: Attributes = { 'http.request.header.host': ['a', 'b'] };

// --- §5: built-ins use semconv spelling; injected dialects keep the field open ---
//
// This is the one rename in the epic that a runtime test cannot catch by inspection,
// because both strings are plausible: built-in `postgres` maps to semconv's `postgresql`.
// Runtime compiler tests pin that mapping. The type is open because a third-party
// `SqlDialect` carries a family that the six-name union cannot enumerate.
export const telemetryPg: QueryTelemetry = { system: 'postgresql', operation: 'SELECT', collection: 'users' };
export const telemetryExternal: QueryTelemetry = { system: 'acme', operation: 'SELECT', collection: 'users' };
// @ts-expect-error — the operation is one of four verbs, uppercase: not the regex's `'other'` fallback (§5).
export const telemetryOther: QueryTelemetry = { system: 'sqlite', operation: 'other', collection: 'users' };
// @ts-expect-error — nor lowercase, which is what `/^\s*(\w+)/` returns before `.toUpperCase()` (§5).
export const telemetryLowercase: QueryTelemetry = { system: 'sqlite', operation: 'select', collection: 'users' };
// @ts-expect-error — `collection` is required: a span with no `db.collection.name` is a span nobody can group by (§5).
export const telemetryNoCollection: QueryTelemetry = { system: 'mysql', operation: 'DELETE' };
export type _SystemAcceptsExternalDialect = Expect<Equal<QueryTelemetry['system'], string>>;
export type _TelemetryKeys = Expect<Equal<keyof QueryTelemetry, 'system' | 'operation' | 'collection'>>;

// §6 refuses parameter values under any setting, and §5 emits `parameters.length` instead.
// The refusal is "absent, not off-by-default", which is a statement about the *type*: there
// is no key here to set. `Observability` having exactly three keys (asserted above) is that
// assertion; this one says the same thing about the per-query record.
//
// Kept to one line at 119 columns on purpose: `printWidth` is 120 in `.oxfmtrc.json`, and
// `yarn fmt` wraps a longer object literal across lines, which moves the excess-property
// error off the directive's line and turns this assertion into a TS2578. The one-line idiom
// and the format gate are coupled, so a longer name here is a build failure, not a style nit.
// @ts-expect-error — there is no field for parameter values on `QueryTelemetry`, at any level (§6).
export const noParamsField: QueryTelemetry = { system: 'mysql', operation: 'DELETE', collection: 'u', parameters: [] };
