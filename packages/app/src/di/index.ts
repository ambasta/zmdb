// @zmdb/app — compile-time dependency injection (epic #262, spec ./SPEC.md).
// Container + @Inject field decorator. No emitDecoratorMetadata, no reflection,
// no `as` on the consumer surface. Resolution happens at build (class-init) time.

// Install Symbol.metadata (used by field decorators) before any decorated class
// in a consumer module is evaluated.
import '../polyfill.js';

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
    super(`@zmdb/app: no provider registered for token "${description}"`);
    this.name = 'UnresolvedTokenError';
  }
}

// A field-injection request recorded by @Inject. Nothing reads the slot yet — the
// HTTP-aware devtools inspector is its first reader
// (../../../web/src/devtools/SPEC.md §4).
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

/** Read the field-injection declarations recorded on a class. */
export function injectionsOf(
  ctor: abstract new (...args: never[]) => unknown,
): readonly { readonly field: string | symbol; readonly token: Token<unknown> }[] {
  const metadata = ctor[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return [];
  }
  return diView(metadata)[INJECTIONS] ?? [];
}

// The container whose `build` is currently running. Field initializers read it
// to resolve their token. Set for the duration of `build` and cleared in a
// `finally`, so there is no persistent global request-time state.
let currentContainer: Container | undefined;

// Run `fn` with `container` set as the active (building) container, restoring the
// previous one afterward. Keeps the swap out of `Container.build` so the method
// body never aliases `this` to a variable.
function withActiveContainer<T>(container: Container, fn: () => T): T {
  const previous = currentContainer;
  currentContainer = container;
  try {
    return fn();
  } finally {
    currentContainer = previous;
  }
}

/**
 * Field decorator: resolve `token` from the container that is building this
 * instance. The field's declared type must be assignable from the token type,
 * so a mismatch is a compile error and no `as` is needed.
 */
export function Inject<T>(token: Token<T>) {
  return function (_value: undefined, context: ClassFieldDecoratorContext<unknown, T>): (initial: T) => T {
    const view = diView(context.metadata);
    const request: InjectionRequest = { field: context.name, token };
    // A subclass's metadata record is created with the base's as its prototype, so
    // `view[INJECTIONS]` on a subclass reads the base's array and pushing into it
    // files the subclass's field under the base class. Copy what is inherited on
    // the first own write, then push, so a reader sees base fields then own.
    const own = Object.hasOwn(context.metadata, INJECTIONS) ? view[INJECTIONS] : undefined;
    if (own === undefined) {
      view[INJECTIONS] = [...(view[INJECTIONS] ?? []), request];
    } else {
      own.push(request);
    }
    // The initializer runs during construction; resolve from the active build.
    return function (): T {
      if (currentContainer === undefined) {
        throw new Error(
          `@zmdb/app: @Inject field "${String(context.name)}" was initialized outside container.build(...)`,
        );
      }
      return currentContainer.resolve(token);
    };
  };
}

/** A class constructor the container can build. */
export type Constructor<T> = new () => T;

/** Provider scope: a singleton is resolved once and cached; transient re-runs. */
export type Scope = 'singleton' | 'transient';

class ContainerImpl<RegisteredTokens = never> {
  // Keyed by token identity. Values are the registered instances; each key's
  // value type is guaranteed by `register`'s typed signature.
  readonly #bindings = new Map<Token<unknown>, unknown>();
  // Factory providers: token → { factory, scope }. Singleton factories cache
  // their first result back into #bindings.
  readonly #factories = new Map<Token<unknown>, { factory: (c: Container) => unknown; scope: Scope }>();

  /** Bind a token to an instance. Returns an updated container reference accumulating the token type. */
  register<T, TToken extends Token<T> = Token<T>>(token: TToken, instance: T): Container<RegisteredTokens | TToken> {
    this.#bindings.set(token, instance);
    return this as unknown as Container<RegisteredTokens | TToken>;
  }

  /** Bind a token to a factory with a scope (default singleton). Returns an updated container reference accumulating the token type. */
  registerFactory<T, TToken extends Token<T> = Token<T>>(
    token: TToken,
    factory: (c: Container) => T,
    scope: Scope = 'singleton',
  ): Container<RegisteredTokens | TToken> {
    this.#factories.set(token, { factory, scope });
    return this as unknown as Container<RegisteredTokens | TToken>;
  }

  /** True if the token is registered (as a value or a factory). */
  has<T>(token: Token<T>): boolean {
    return this.#bindings.has(token) || this.#factories.has(token);
  }

  /** Resolve a token to its instance, or throw UnresolvedTokenError. Rejects unregistered tokens at compile time for fluently constructed containers. */
  resolve<T, TToken extends Token<T> = Token<T>>(
    token: 0 extends 1 & RegisteredTokens
      ? TToken
      : [unknown] extends [RegisteredTokens]
        ? TToken
        : TToken & ([TToken] extends [RegisteredTokens] ? unknown : never),
  ): T {
    if (this.#bindings.has(token)) {
      return readBinding(this.#bindings, token);
    }
    const provider = this.#factories.get(token);
    if (provider !== undefined) {
      const value = provider.factory(this as unknown as Container);
      if (provider.scope === 'singleton') {
        this.#bindings.set(token, value);
      }
      return narrowFactoryValue<T>(value);
    }
    throw new UnresolvedTokenError(token.description);
  }

  /**
   * Construct `Ctor` with its `@Inject`ed fields satisfied from this container.
   * Resolution happens here (once), then is cached on the instance.
   */
  build<T>(Ctor: Constructor<T>): T {
    return withActiveContainer(this as unknown as Container, () => new Ctor());
  }
}

/** The explicit, opt-in DI registry. Resolution is O(1) by token identity. */
export type Container<RegisteredTokens = unknown> = ContainerImpl<RegisteredTokens>;

/** The Container constructor. Produces a container with no initial registered tokens. */
export const Container: {
  new (): Container<never>;
  readonly prototype: Container<unknown>;
} = ContainerImpl as unknown as {
  new (): Container<never>;
  readonly prototype: Container<unknown>;
};

// boundary: `register<T>` is the only writer and stores exactly the token's T
// under that token key, so reading it back as T is sound. This is the single
// enumerated boundary cast in the DI module (ARCHITECTURE.md §2.1) — a
// heterogeneous token→instance Map cannot prove its value type structurally, so
// the assertion is isolated here with the soundness argument, and never appears
// at a call site or on the consumer surface.
function readBinding<T>(bindings: ReadonlyMap<Token<unknown>, unknown>, token: Token<T>): T {
  return bindings.get(token) as T;
}

// boundary: a factory registered under Token<T> via registerFactory returns T by
// construction; widening its `unknown` result to T is sound. Same enumerated DI
// boundary as readBinding (ARCHITECTURE.md §2.1); never on the consumer surface.
function narrowFactoryValue<T>(value: unknown): T {
  return value as T;
}
