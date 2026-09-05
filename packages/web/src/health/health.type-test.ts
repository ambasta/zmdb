import type { CheckResult, LivenessCheck, ReadinessCheck, databaseReadinessCheck } from '@zmdb/app/health';
// Type-level tests for the health-check surface frozen in ./SPEC.md §2 (#580, epic #578).
// No runtime code: a *compilation* gate run by `node scripts/typecheck.mjs`, and therefore
// by CI. `packages/web/tsconfig.json` includes `src/**/*.ts`, so this file is compiled.
//
// The negative assertions are the mechanism of §2: a `kind:
// 'liveness' | 'readiness'` discriminant would pass every runtime test because a
// convention wearing a field name has no compile-time consequence.
import type { Driver } from '@zmdb/repository';
import type { Equal, Expect } from '@zmdb/schema-core';

import type { WebResponse } from '../pipeline/index.js';
import type { healthRoutes } from './index.js';

type HealthRoutes = typeof healthRoutes;
declare const readinessRun: (signal: AbortSignal) => Promise<CheckResult>;
declare const driver: Driver;

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
const databaseLivenessRun = async (): Promise<boolean> => (
  await driver.execute({ text: 'SELECT 1', parameters: [] }),
  true
);
// @ts-expect-error — a database round trip is asynchronous and therefore cannot be registered as liveness.
export const liveDatabase: LivenessCheck = { name: 'database', run: databaseLivenessRun };
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
export type _DatabaseExampleIsReadiness = Expect<Equal<ReturnType<typeof databaseReadinessCheck>, ReadinessCheck>>;
