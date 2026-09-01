// @zmdb/app — compile-time domain state machines (epic #267, spec ./SPEC.md).
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

/** Options for configuring state discriminant keying and custom property validation predicates. */
export interface StateOptions<T> {
  /**
   * Optional discriminant property key and expected value.
   * Can be specified as a tuple `[key, expectedValue]`, an object `{ key, value }`,
   * or a key name.
   */
  discriminant?: [keyof T, unknown] | { key: keyof T; value: unknown } | keyof T;
  /**
   * Optional custom predicate function to perform structural property validation.
   */
  predicate?: (value: T) => boolean;
}

/**
 * Define a domain state. Returns a maker whose `create` brands base values and
 * whose `is` narrows to the branded type. The brand exists only in the type
 * system, so `create` is an identity at runtime.
 */
export function defineState<B extends string, T>(options?: StateOptions<T>): State<B, T> {
  let discKey: PropertyKey | undefined;
  let discValue: unknown;
  let hasDiscValue = false;

  if (options?.discriminant !== undefined) {
    const d = options.discriminant;
    if (Array.isArray(d)) {
      discKey = d[0] as PropertyKey;
      discValue = d[1];
      hasDiscValue = true;
    } else if (typeof d === 'object' && d !== null && 'key' in d) {
      discKey = d.key as PropertyKey;
      if ('value' in d) {
        discValue = d.value;
        hasDiscValue = true;
      }
    } else if (typeof d === 'string' || typeof d === 'symbol' || typeof d === 'number') {
      discKey = d as PropertyKey;
      hasDiscValue = false;
    }
  }

  const customPredicate = options?.predicate;

  function is(value: unknown): value is Brand<T, B> {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    if (discKey !== undefined) {
      if (!(discKey in value)) {
        return false;
      }
      if (hasDiscValue && (value as Record<PropertyKey, unknown>)[discKey] !== discValue) {
        return false;
      }
    }

    if (customPredicate && !customPredicate(value as T)) {
      return false;
    }

    return true;
  }

  return {
    create(value: T): Brand<T, B> {
      if (!is(value)) {
        throw new TypeError('Invalid state payload: structural verification failed');
      }
      // boundary: branding is a compile-time-only tag (the brand symbol has no
      // runtime representation), so returning the value unchanged as the branded
      // type is sound. This is the single enumerated brand-attach boundary
      // (ARCHITECTURE.md §2.1); it never appears on the consumer surface.
      return value as Brand<T, B>;
    },
    is,
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
