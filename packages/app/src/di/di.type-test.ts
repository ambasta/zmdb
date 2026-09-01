// Type-level tests for compile-time DI (#264). No runtime code: a *compilation*
// gate run by `yarn typecheck`, and therefore by CI.
//
// The token → instance-type binding is the whole point of `Token<T>`'s phantom
// field, and it was previously "checked" by `expectTypeOf` inside a `.spec.ts`,
// where such a call does nothing at runtime.
import type { Equal, Expect } from '@zmdb/schema-core';

import { Container, createToken } from './index.js';

class Logger {
  log(msg: string): string {
    return msg;
  }
}
class Clock {
  now(): number {
    return 0;
  }
}

const LoggerToken = createToken<Logger>('Logger');
const ClockToken = createToken<Clock>('Clock');
declare const c: Container;

// --- resolve returns the token's instance type ------------------------------
export type _Di1 = Expect<Equal<ReturnType<typeof c.resolve<Logger>>, Logger>>;
export const _resolved: Logger = c.resolve(LoggerToken);
export const _resolvedClock: Clock = c.resolve(ClockToken);
// @ts-expect-error — the Logger token does not resolve to a Clock.
export const _crossToken: Clock = c.resolve(LoggerToken);

// --- register is checked against the token ---------------------------------
export const _registered: Container = c.register(LoggerToken, new Logger());
// @ts-expect-error — a number is not a Logger.
export const _badRegister = c.register(LoggerToken, 42);
// @ts-expect-error — a Clock is not a Logger either (nominal by token, not shape).
export const _wrongInstance = c.register(LoggerToken, new Clock());

// --- Fluent container token accumulation ----------------------------------
class Cache {
  get(k: string): string {
    return k;
  }
}
const CacheToken = createToken<Cache>('Cache');

const fluentC = new Container().register(LoggerToken, new Logger()).registerFactory(ClockToken, () => new Clock());

// Registered tokens resolve cleanly with static type safety:
export const _fluentLogger: Logger = fluentC.resolve(LoggerToken);
export const _fluentClock: Clock = fluentC.resolve(ClockToken);

// @ts-expect-error — CacheToken is unregistered on fluentC, causing a build-time type error.
export const _unregisteredError = fluentC.resolve(CacheToken);

// --- Preserving previously registered token types across fluent steps ------
const step1 = new Container().register(LoggerToken, new Logger());
const step2 = step1.registerFactory(ClockToken, () => new Clock());
const step3 = step2.register(CacheToken, new Cache());

export const _step3Logger: Logger = step3.resolve(LoggerToken);
export const _step3Clock: Clock = step3.resolve(ClockToken);
export const _step3Cache: Cache = step3.resolve(CacheToken);

// @ts-expect-error — CacheToken was not registered on step1 yet.
export const _step1MissingCache = step1.resolve(CacheToken);

// --- Empty fluently created container --------------------------------------
const emptyC = new Container();
// @ts-expect-error — LoggerToken is not registered on empty container.
export const _emptyMissingLogger = emptyC.resolve(LoggerToken);
