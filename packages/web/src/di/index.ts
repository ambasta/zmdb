// @zmdb/web — compile-time dependency injection (epic #262, spec ./SPEC.md).
// Container + @Inject field decorator. No emitDecoratorMetadata, no reflection,
// no `as` on the consumer surface. Resolution happens at build (class-init) time.

// Install Symbol.metadata (used by field decorators) before any decorated class
// in a consumer module is evaluated.
import '../polyfill.ts';

// A typed injection token. The phantom `__type` carries the instance type at
// compile time without existing at runtime (it is `never`-valued and optional).
export interface Token<T> {
  readonly description: string;
  readonly __type?: T;
}

/** Create a unique injection token carrying its instance type. */
export function createToken<T>(description: string): Token<T> {
  return { description };
}

/** Thrown by `Container.resolve` when a token was never registered. */
export class UnresolvedTokenError extends Error {
  constructor(description: string) {
    super(`@zmdb/web: no provider registered for token "${description}"`);
    this.name = 'UnresolvedTokenError';
  }
}

// A field-injection request recorded by @Inject and read by Container.build.
interface InjectionRequest {
  readonly field: string | symbol;
  readonly token: Token<unknown>;
}

const INJECTIONS = Symbol('zmdb.web.di.injections');

interface DiMetadata {
  [INJECTIONS]?: InjectionRequest[];
}

// boundary: our @Inject decorator is the only writer of the INJECTIONS slot, so
// viewing the metadata record through DiMetadata is sound (no call-site `as`).
function diView(metadata: DecoratorMetadata): DiMetadata {
  return metadata;
}

// The container whose `build` is currently running. Field initializers read it
// to resolve their token. Set for the duration of `build` and cleared in a
// `finally`, so there is no persistent global request-time state.
let currentContainer: Container | undefined;

/**
 * Field decorator: resolve `token` from the container that is building this
 * instance. The field's declared type must be assignable from the token type,
 * so a mismatch is a compile error and no `as` is needed.
 */
export function Inject<T>(token: Token<T>) {
  return function (_value: undefined, context: ClassFieldDecoratorContext<unknown, T>): (initial: T) => T {
    const view = diView(context.metadata);
    const request: InjectionRequest = { field: context.name, token };
    const existing = view[INJECTIONS];
    if (existing === undefined) {
      view[INJECTIONS] = [request];
    } else {
      existing.push(request);
    }
    // The initializer runs during construction; resolve from the active build.
    return function (): T {
      if (currentContainer === undefined) {
        throw new Error(
          `@zmdb/web: @Inject field "${String(context.name)}" was initialized outside container.build(...)`,
        );
      }
      return currentContainer.resolve(token);
    };
  };
}

/** A class constructor the container can build. */
export type Constructor<T> = new () => T;

/** The explicit, opt-in DI registry. Resolution is O(1) by token identity. */
export class Container {
  // Keyed by token identity. Values are the registered instances; each key's
  // value type is guaranteed by `register`'s typed signature.
  readonly #bindings = new Map<Token<unknown>, unknown>();

  /** Bind a token to an instance. The instance type is constrained to T. */
  register<T>(token: Token<T>, instance: T): void {
    this.#bindings.set(token, instance);
  }

  /** True if the token is registered. */
  has<T>(token: Token<T>): boolean {
    return this.#bindings.has(token);
  }

  /** Resolve a token to its instance, or throw UnresolvedTokenError. */
  resolve<T>(token: Token<T>): T {
    if (!this.#bindings.has(token)) {
      throw new UnresolvedTokenError(token.description);
    }
    return readBinding(this.#bindings, token);
  }

  /**
   * Construct `Ctor` with its `@Inject`ed fields satisfied from this container.
   * Resolution happens here (once), then is cached on the instance.
   */
  build<T>(Ctor: Constructor<T>): T {
    const previous = currentContainer;
    currentContainer = this;
    try {
      return new Ctor();
    } finally {
      currentContainer = previous;
    }
  }
}

// boundary: `register<T>` is the only writer and stores exactly the token's T
// under that token key, so reading it back as T is sound. This is the single
// enumerated boundary cast in the DI module (ARCHITECTURE.md §2.1) — a
// heterogeneous token→instance Map cannot prove its value type structurally, so
// the assertion is isolated here with the soundness argument, and never appears
// at a call site or on the consumer surface.
function readBinding<T>(bindings: ReadonlyMap<Token<unknown>, unknown>, token: Token<T>): T {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return bindings.get(token) as T;
}
