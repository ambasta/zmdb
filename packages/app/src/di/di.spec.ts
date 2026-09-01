// Tests (#264) for compile-time DI: Container register/resolve/has,
// UnresolvedTokenError, and @Inject field population via container.build. The
// token → instance-type binding is asserted in `di.type-test.ts`.
// Per ./SPEC.md.
import { describe, it, expect } from 'vitest';

import { Container, createToken, Inject, UnresolvedTokenError } from './index.js';

class Logger {
  log(msg: string): string {
    return msg;
  }
}
const LoggerToken = createToken<Logger>('Logger');

describe('@zmdb/app DI: Container', () => {
  it('registers and resolves an instance', () => {
    const logger = new Logger();
    const c = new Container().register(LoggerToken, logger);
    expect(c.resolve(LoggerToken)).toBe(logger);
    expect(c.has(LoggerToken)).toBe(true);
  });

  it('throws UnresolvedTokenError for an unregistered token', () => {
    const c = new Container();
    // @ts-expect-error — LoggerToken is unregistered on c
    expect(() => c.resolve(LoggerToken)).toThrow(UnresolvedTokenError);
    expect(c.has(LoggerToken)).toBe(false);
  });

  it('rejects a mismatched instance at compile time', () => {
    const c = new Container();
    // @ts-expect-error — a number is not a Logger
    c.register(LoggerToken, 42);
    expect(true).toBe(true);
  });

  it('supports fluent chaining of register and registerFactory', () => {
    const logger = new Logger();
    const PortToken = createToken<number>('Port');
    const c = new Container().register(LoggerToken, logger).registerFactory(PortToken, () => 8080);

    expect(c.resolve(LoggerToken)).toBe(logger);
    expect(c.resolve(PortToken)).toBe(8080);
  });
});

describe('@zmdb/app DI: @Inject + container.build', () => {
  it('populates injected fields from the container', () => {
    const logger = new Logger();
    const c = new Container().register(LoggerToken, logger);

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

// #607. A subclass's metadata record has the base's as its prototype, so a writer
// that pushes into the array it reads files the subclass's field under the base.
interface FieldRecord {
  readonly field: string | symbol;
}

function hasField(value: unknown): value is FieldRecord {
  return typeof value === 'object' && value !== null && 'field' in value;
}

// The INJECTIONS slot is module-private and has no reader yet — the devtools
// inspector is the first one (../../../web/src/devtools/SPEC.md §4) — so this reads the metadata
// record straight, finding the slot by symbol description. What it asserts is
// ownership: which class a decorated field is recorded against.
function injectedFields(ctor: abstract new (...args: never[]) => unknown): readonly string[] {
  const metadata = ctor[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return [];
  }
  const slot = Object.getOwnPropertySymbols(metadata).find(sym => sym.description === 'zmdb.web.di.injections');
  if (slot === undefined) {
    return [];
  }
  const requests: unknown = metadata[slot];
  if (!Array.isArray(requests)) {
    return [];
  }
  return requests.flatMap((request: unknown) => (hasField(request) ? [String(request.field)] : []));
}

describe('@zmdb/app DI: @Inject across a class hierarchy', () => {
  it('records a subclass field on the subclass, not on the base', () => {
    class BaseService {
      @Inject(LoggerToken)
      logger!: Logger;
    }

    class AdminService extends BaseService {
      @Inject(LoggerToken)
      adminLogger!: Logger;
    }

    class PublicService extends BaseService {
      @Inject(LoggerToken)
      publicLogger!: Logger;
    }

    expect(injectedFields(BaseService)).toEqual(['logger']);
    expect(injectedFields(AdminService)).toEqual(['logger', 'adminLogger']);
    expect(injectedFields(PublicService)).toEqual(['logger', 'publicLogger']);
  });

  it('still populates both inherited and own fields on a subclass', () => {
    const c = new Container();
    const logger = new Logger();
    c.register(LoggerToken, logger);

    class BaseService {
      @Inject(LoggerToken)
      base!: Logger;
    }

    class DerivedService extends BaseService {
      @Inject(LoggerToken)
      own!: Logger;
    }

    const svc = c.build(DerivedService);
    expect(svc.base).toBe(logger);
    expect(svc.own).toBe(logger);
  });
});
