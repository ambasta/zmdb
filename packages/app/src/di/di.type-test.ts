// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Type-level tests for compile-time DI (#264). No runtime code: a *compilation*
// gate run by `yarn typecheck`, and therefore by CI.
//
// The token → instance-type binding is the whole point of `Token<T>`'s phantom
// field, and it was previously "checked" by `expectTypeOf` inside a `.spec.ts`,
// where such a call does nothing at runtime.
import { type Equal, type Expect } from '@zmdb/schema';

import { createToken } from './index.js';
import type { Container } from './index.js';

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

// --- fluent calls retain the subtype and provider value types --------------
interface AppContainer extends Container {
  appName(): string;
}
declare const app: AppContainer;
export const _fluent = app.register(LoggerToken, new Logger()).registerFactory(ClockToken, () => new Clock());
export type _FluentSubtype = Expect<Equal<typeof _fluent, AppContainer>>;
export const _appName: string = _fluent.appName();
export const _fluentLogger: Logger = _fluent.resolve(LoggerToken);
export const _fluentClock: Clock = _fluent.resolve(ClockToken);
// @ts-expect-error — a fluent factory must still return the token's value type.
export const _badFactory = _fluent.registerFactory(LoggerToken, () => 42);
// @ts-expect-error — a fluent value must still match the token's value type.
export const _badFluentRegister = _fluent.register(LoggerToken, 42);
// @ts-expect-error — a fluent Logger resolution does not return a Clock.
export const _badFluentResolve: Clock = _fluent.resolve(LoggerToken);
