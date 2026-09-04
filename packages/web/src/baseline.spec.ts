// Baseline test (#249): a Stage-3 class decorator writing to `context.metadata`
// round-trips through `metadataOf()` — no reflect-metadata, no `as` on the
// consumer surface. Proves the @zmdb/web decorator baseline.
import { describe, it, expect } from 'vitest';

import { metadataOf } from './index.js';

// A trivial Stage-3 class decorator that records a value in context.metadata.
// Standard decorators only — `experimentalDecorators` is false.
function Tagged(value: string) {
  return function <T extends abstract new (...args: never[]) => unknown>(
    _target: T,
    context: ClassDecoratorContext<T>,
  ): void {
    context.metadata.tag = value;
  };
}

describe('@zmdb/web baseline: Symbol.metadata round-trip', () => {
  it('reads back metadata a Stage-3 decorator wrote — no reflect-metadata, no as', () => {
    @Tagged('users')
    class UsersController {}

    const meta = metadataOf(UsersController);
    expect(meta.tag).toBe('users');
  });

  it('returns an empty frozen record for an undecorated class (never undefined)', () => {
    class Plain {
      value = 0;
    }
    const meta = metadataOf(Plain);
    expect(meta).toBeDefined();
    expect(Object.keys(meta)).toHaveLength(0);
    expect(Object.isFrozen(meta)).toBe(true);
  });
});
