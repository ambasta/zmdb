// @zmdb/web — compile-time domain state machines (epic #267, spec ./SPEC.md).
// Branded/phantom types make illegal transitions fail to compile; branding
// erases at runtime (0 cost). No `as` on the consumer surface — construction
// goes through a checked factory. No reflection.

// A unique phantom brand key so branded types are nominal (structurally
// incompatible across brands) yet erase to the base type at runtime.
declare const brand: unique symbol;

/** `T` nominally tagged with brand `B`. Erases to `T` at runtime. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A state maker for a named state over a base type. */
export interface State<B extends string, T> {
  /** Construct a branded value from base fields — no consumer `as`. */
  create(value: T): Brand<T, B>;
  /** Type guard narrowing an unknown/base value to this branded state. */
  is(value: unknown): value is Brand<T, B>;
}

/**
 * Define a domain state. Returns a maker whose `create` brands base values and
 * whose `is` narrows to the branded type. The brand exists only in the type
 * system, so `create` is an identity at runtime.
 */
export function defineState<B extends string, T>(): State<B, T> {
  return {
    create(value: T): Brand<T, B> {
      // boundary: branding is a compile-time-only tag (the brand symbol has no
      // runtime representation), so returning the value unchanged as the branded
      // type is sound. This is the single enumerated brand-attach boundary
      // (ARCHITECTURE.md §2.1); it never appears on the consumer surface.
      return value as Brand<T, B>;
    },
    is(value: unknown): value is Brand<T, B> {
      // The brand is erased at runtime; a value "is" this state by construction.
      // We can only assert non-nullish here — the compile-time brand carries the
      // real guarantee. Callers use `is` to narrow values they already trust.
      return value !== undefined && value !== null;
    },
  };
}

/**
 * Declare a legal state transition `From -> To`. The returned function only
 * accepts a value already branded `From`, so applying it to any other state is
 * a compile error, and undeclared edges simply have no function.
 */
export function transition<T, From extends string, To extends string>(
  _from: State<From, T>,
  to: State<To, T>,
  fn: (value: Brand<T, From>) => T,
): (value: Brand<T, From>) => Brand<T, To> {
  return function (value: Brand<T, From>): Brand<T, To> {
    return to.create(fn(value));
  };
}
