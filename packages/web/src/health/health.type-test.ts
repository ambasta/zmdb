// Type-level tests for the health-check surface frozen in ./SPEC.md §2 (#580, epic #578).
// No runtime code: a *compilation* gate run by `node scripts/typecheck.mjs`, and therefore
// by CI. `packages/web/tsconfig.json` includes `src/**/*.ts`, so this file is compiled.
//
// SPEC.md §6.1 asks for exactly two assertions here, and says why they are the two:
// they are the mechanism of §2, so they are the two that would notice the mechanism
// being removed. A `kind: 'liveness' | 'readiness'` discriminant — the #579 sketch's
// shape — would pass every runtime test in ./health.spec.ts and fail nothing, because
// a convention wearing a field name has no compile-time consequence. These lines are
// the consequence.
//
// ---------------------------------------------------------------------------
// FROZEN SURFACE — delete this block when `./index.js` exists (#581)
// ---------------------------------------------------------------------------
// `./index.ts` does not exist yet, so importing from it would be TS2307 and this file
// would not compile at all — which is the one thing a tests freeze may not do. The
// declarations below are transcribed verbatim from ./SPEC.md §2. When #581 lands,
// delete them and write
//
//   import type { CheckResult, LivenessCheck, ReadinessCheck } from './index.js';
//
// and nothing else in this file changes. The same block appears in ./health.spec.ts;
// both copies are deleted in the same commit.
import type { Equal, Expect } from '@zmdb/schema-core';

import type { WebResponse } from '../pipeline/index.js';

/** The process is not wedged. Synchronous, and that is the whole mechanism. */
interface LivenessCheck {
  readonly name: string;
  run(): boolean;
}

interface CheckResult {
  readonly ok: boolean;
  readonly detail?: string;
}

/** The process can serve traffic. Asked with a deadline, because dependencies hang. */
interface ReadinessCheck {
  readonly name: string;
  readonly timeoutMs: number;
  readonly cacheMs?: number;
  run(signal: AbortSignal): Promise<CheckResult>;
}

type HealthRoutes = (checks: {
  readonly liveness?: readonly LivenessCheck[];
  readonly readiness?: readonly ReadinessCheck[];
}) => { readonly live: () => WebResponse; readonly ready: () => Promise<WebResponse> };
// --------------------------- end frozen surface ---------------------------

declare const readinessRun: (signal: AbortSignal) => Promise<CheckResult>;

// --- §6.1 assertion 1: a liveness check cannot be asynchronous -------------
//
// Every negative assertion in this file is written as a ONE-LINE declaration, and that
// is deliberate rather than a formatting accident. `@ts-expect-error` suppresses errors
// reported on the single line that follows it, and TypeScript reports different error
// kinds in different places: a *missing* required property is reported at the
// declaration's identifier (TS2741), while a property whose *value* is unassignable is
// reported at that property. Verified: splitting `{ name: 'db', run: async () => true }`
// across lines and putting the directive on the declaration line yields
// `error TS2578: Unused '@ts-expect-error' directive` for the missing-property case.
// A one-line declaration puts both possible error positions on the covered line, so the
// assertion cannot rot into a TS2578 when a future compiler moves the span.

export const liveOk: LivenessCheck = { name: 'init-finished', run: () => true };
// @ts-expect-error — `run` returns `Promise<boolean>`, not `boolean`: a liveness check cannot await.
export const liveAsync: LivenessCheck = { name: 'db', run: async () => true };
// @ts-expect-error — an explicit `Promise<boolean>` return type is the same rejection, spelled out.
export const liveAsyncTyped: LivenessCheck = { name: 'db', run: (): Promise<boolean> => Promise.resolve(true) };
// @ts-expect-error — there is no `timeoutMs` on a `LivenessCheck`: a synchronous predicate has no deadline (§2).
export const liveTimeout: LivenessCheck = { name: 'init', timeoutMs: 100, run: () => true };
// @ts-expect-error — there is no `detail` either: §3 fixes the liveness body regardless of what a check would say.
export const liveDetail: LivenessCheck = { name: 'init', detail: 'up', run: () => true };
// @ts-expect-error — and no `AbortSignal` parameter, because there is nothing to abort (§2).
export const liveSignal: LivenessCheck = { name: 'init', run: (signal: AbortSignal) => signal.aborted };

// --- §6.1 assertion 2: `timeoutMs` is required on a readiness check --------
//
// §4: not optional with a default, because the default is the number every check
// silently inherits and nobody chooses, and the correct value is a property of the
// dependency.

export const readyOk: ReadinessCheck = { name: 'db', timeoutMs: 2000, run: readinessRun };
export const readyCached: ReadinessCheck = { name: 'db', timeoutMs: 2000, cacheMs: 5000, run: readinessRun };
// @ts-expect-error — `timeoutMs` is missing, and there is no default to fall back on (§4).
export const readyNoTimeout: ReadinessCheck = { name: 'db', run: readinessRun };
// @ts-expect-error — `cacheMs` is optional, but `undefined` is not a value for it under exactOptionalPropertyTypes.
export const readyUndefCache: ReadinessCheck = { name: 'db', timeoutMs: 1, cacheMs: undefined, run: readinessRun };

// --- the sketch's shape is not expressible ---------------------------------
//
// #579 proposed one interface with `kind: 'liveness' | 'readiness'`. The freeze's point
// is that the split *takes the ability away* rather than labelling it, so the two
// interfaces must not be mutually assignable: a `ReadinessCheck` must not be usable
// where a `LivenessCheck` is, or the split is decoration.
export type _NotAssignable = Expect<Equal<ReadinessCheck extends LivenessCheck ? true : false, false>>;
export type _NotAssignableBack = Expect<Equal<LivenessCheck extends ReadinessCheck ? true : false, false>>;

// --- the shapes themselves ------------------------------------------------
export type _LivenessKeys = Expect<Equal<keyof LivenessCheck, 'name' | 'run'>>;
export type _ReadinessKeys = Expect<Equal<keyof ReadinessCheck, 'name' | 'timeoutMs' | 'cacheMs' | 'run'>>;
export type _LiveReturn = Expect<Equal<ReturnType<LivenessCheck['run']>, boolean>>;
// `live()` is synchronous all the way out: §2's mechanism is only real if nothing
// downstream of it has a promise to wait on either.
export type _LiveRouteReturn = Expect<Equal<ReturnType<ReturnType<HealthRoutes>['live']>, WebResponse>>;
export type _ReadyRouteReturn = Expect<Equal<ReturnType<ReturnType<HealthRoutes>['ready']>, Promise<WebResponse>>>;
