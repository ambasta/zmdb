// Type-level tests for compile-time DI (#264). No runtime code: a *compilation*
// gate run by `yarn typecheck`, and therefore by CI.
//
// The token → instance-type binding is the whole point of `Token<T>`'s phantom
// field, and it was previously "checked" by `expectTypeOf` inside a `.spec.ts`,
// where such a call does nothing at runtime.
import type { Equal, Expect } from '@zmdb/schema-core';

import { createToken } from './index.ts';
import type { Container } from './index.ts';

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
export const _registered: void = c.register(LoggerToken, new Logger());
// @ts-expect-error — a number is not a Logger.
export const _badRegister = c.register(LoggerToken, 42);
// @ts-expect-error — a Clock is not a Logger either (nominal by token, not shape).
export const _wrongInstance = c.register(LoggerToken, new Clock());
