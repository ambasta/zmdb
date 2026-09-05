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

// --- Fluent container chaining --------------------------------------------
class Cache {
  get(k: string): string {
    return k;
  }
}
const CacheToken = createToken<Cache>('Cache');

const fluentC = new Container()
  .register(LoggerToken, new Logger())
  .registerFactory(ClockToken, () => new Clock())
  .register(CacheToken, new Cache());

// Registered tokens resolve cleanly with static type safety:
export const _fluentLogger: Logger = fluentC.resolve(LoggerToken);
export const _fluentClock: Clock = fluentC.resolve(ClockToken);
export const _fluentCache: Cache = fluentC.resolve(CacheToken);

// --- Modular container registration pattern --------------------------------
function registerModule(container: Container): Container {
  return container.register(LoggerToken, new Logger()).registerFactory(ClockToken, () => new Clock());
}

const modularC = registerModule(new Container());
export const _modularLogger: Logger = modularC.resolve(LoggerToken);
export const _modularClock: Clock = modularC.resolve(ClockToken);
