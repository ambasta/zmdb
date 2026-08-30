// Tests (#264) for compile-time DI — RED first (di exports absent). Container
// register/resolve/has, UnresolvedTokenError, type-level token match, and
// @Inject field population via container.build. Per packages/web/src/di/SPEC.md.
import { describe, it, expect, expectTypeOf } from 'vitest';

import { Container, createToken, Inject, UnresolvedTokenError } from './index.ts';

class Logger {
  log(msg: string): string {
    return msg;
  }
}
const LoggerToken = createToken<Logger>('Logger');

describe('@zmdb/web DI: Container', () => {
  it('registers and resolves an instance', () => {
    const c = new Container();
    const logger = new Logger();
    c.register(LoggerToken, logger);
    expect(c.resolve(LoggerToken)).toBe(logger);
    expect(c.has(LoggerToken)).toBe(true);
  });

  it('throws UnresolvedTokenError for an unregistered token', () => {
    const c = new Container();
    expect(() => c.resolve(LoggerToken)).toThrow(UnresolvedTokenError);
    expect(c.has(LoggerToken)).toBe(false);
  });

  it('resolve returns the token type (type-level)', () => {
    const c = new Container();
    c.register(LoggerToken, new Logger());
    expectTypeOf(c.resolve(LoggerToken)).toEqualTypeOf<Logger>();
  });

  it('rejects a mismatched instance at compile time', () => {
    const c = new Container();
    // @ts-expect-error — a number is not a Logger
    c.register(LoggerToken, 42);
    expect(true).toBe(true);
  });
});

describe('@zmdb/web DI: @Inject + container.build', () => {
  it('populates injected fields from the container', () => {
    const c = new Container();
    const logger = new Logger();
    c.register(LoggerToken, logger);

    class Service {
      @Inject(LoggerToken)
      logger!: Logger;

      greet(): string {
        return this.logger.log('hi');
      }
    }

    const svc = c.build(Service);
    expect(svc.logger).toBe(logger);
    expect(svc.greet()).toBe('hi');
  });
});
