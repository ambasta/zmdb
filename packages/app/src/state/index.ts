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

/** Options for configuring state name, discriminant keying, and custom property validation predicates. */
export interface StateOptions<T> {
  /**
   * Optional state name used in diagnostic error messages when structural validation fails.
   */
  name?: string;
  /**
   * Optional discriminant property key and expected value.
   * Can be specified as a tuple `[key, expectedValue?]` or a key name `key`.
   */
  discriminant?: [keyof T, unknown?] | keyof T;
  /**
   * Optional custom predicate function to perform structural property validation.
   */
  predicate?: (value: T) => boolean;
}

/**
 * Define a domain state. Returns a maker whose `create` validates structural
 * requirements (discriminant fields and custom predicates) and brands base values,
 * and whose `is` narrows to the branded type.
 * `create` throws TypeError with diagnostic details if validation fails.
 * When validation succeeds, `create` returns the value unchanged at runtime
 * (preserving object identity with 0 allocation overhead).
 */
export function defineState<B extends string, T>(name?: string, options?: StateOptions<T>): State<B, T>;
export function defineState<B extends string, T>(options?: StateOptions<T>): State<B, T>;
export function defineState<B extends string, T>(
  nameOrOptions?: string | StateOptions<T>,
  options?: StateOptions<T>,
): State<B, T> {
  let name: string | undefined;
  let opts: StateOptions<T> | undefined;

  if (typeof nameOrOptions === 'string') {
    name = nameOrOptions;
    opts = options;
  } else if (typeof nameOrOptions === 'object' && nameOrOptions !== null) {
    opts = nameOrOptions;
    name = opts.name;
  } else {
    opts = options;
  }

  let discKey: PropertyKey | undefined;
  let discValue: unknown;
  let hasDiscValue = false;

  if (opts?.discriminant !== undefined) {
    const d = opts.discriminant;
    if (Array.isArray(d)) {
      discKey = d[0];
      if (d.length >= 2) {
        discValue = d[1];
        hasDiscValue = true;
      }
    } else if (typeof d === 'string' || typeof d === 'symbol' || typeof d === 'number') {
      discKey = d;
      hasDiscValue = false;
    }
  }

  const customPredicate = opts?.predicate;

  function getValidationError(value: unknown): string | null {
    // boundary: structural state guards evaluate unbranded input payloads against user-provided custom predicate T
    const targetName = name ? ` for "${name}"` : '';

    if (value === null || value === undefined) {
      return `Invalid state payload${targetName}: expected non-nullish value, got ${value === null ? 'null' : 'undefined'}`;
    }

    if (discKey !== undefined) {
      if (typeof value !== 'object') {
        return `Invalid state payload${targetName}: expected object for discriminant key "${String(discKey)}", got ${typeof value}`;
      }
      if (!(discKey in value)) {
        return `Invalid state payload${targetName}: missing discriminant property "${String(discKey)}"`;
      }
      if (hasDiscValue) {
        const actual = Reflect.get(value, discKey);
        if (actual !== discValue) {
          return `Invalid state payload${targetName}: discriminant property "${String(discKey)}" expected ${JSON.stringify(discValue)}, got ${JSON.stringify(actual)}`;
        }
      }
    }

    if (customPredicate && !Reflect.apply(customPredicate, undefined, [value])) {
      return `Invalid state payload${targetName}: custom predicate validation failed`;
    }

    return null;
  }

  function is(value: unknown): value is Brand<T, B> {
    return getValidationError(value) === null;
  }

  return {
    create(value: T): Brand<T, B> {
      const error = getValidationError(value);
      if (error !== null) {
        throw new TypeError(error);
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
