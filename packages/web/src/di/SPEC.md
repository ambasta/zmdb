# `@zmdb/web` — dependency injection SPEC

> Compile-time DI: `Container` + `@Inject` (epic #262). Frozen before code. No `emitDecoratorMetadata`, no reflection.

## Contract

### Token

- **`Token<T>`** — a typed, unique injection token carrying its instance type at compile time. Created by `createToken<T>(description)`. Two tokens are equal iff they are the same reference
  (identity), so the phantom type never leaks to runtime as an `as`.

### Container

- **`new Container()`**.
- **`register(token: Token<T>, instance: T): void`** — bind a token to a value. The value type is constrained to the token's type, so a mismatched instance is a **compile error**.
- **`resolve(token: Token<T>): T`** — return the bound instance. Throws `UnresolvedTokenError` (with the token description) if not registered.
- **`has(token): boolean`**.
- The container is the one explicit, opt-in registry; no global mutable hot-path state. Resolution is O(1) (Map by token identity).

### `@Inject`

- **`@Inject(token: Token<T>)`** — a Stage-3 **field** decorator. The decorated field's type must be assignable from `T` (so `@Inject(userRepoToken) repo: UserRepo` type-checks and a mismatch is a
  compile error). It returns an initializer that resolves the token from a container.
- Because Stage-3 field decorators cannot see the enclosing instance's container directly, resolution is bound through a small, explicit convention: `container.build(ClassCtor)` constructs the class
  and satisfies its `@Inject`ed fields from the container. (Field initializers read from an ambient "current container" set for the duration of `build`, cleared in a `finally` — no global request-time
  state.)
- The record of injected fields is written as an **own** property of the class's metadata, copying what it inherits on the first write. A subclass's metadata record has the base's as its prototype, so
  appending to the list a plain read returns would file the subclass's field under the base class (#607). A reader therefore sees a subclass's inherited fields followed by its own, and a base class's
  list does not grow when a subclass is declared.

## Invariants

- **No `emitDecoratorMetadata` / no reflection.** Tokens are explicit values.
- **No `as`/`any`/`!` on the consumer surface.** The injected field type is inferred from the token; users never assert it. Any internal boundary read is a commented exception.
- Resolution happens at `build` (class-init) time, cached on the instance — not re-resolved per method call.

## Acceptance

- Register + resolve returns the instance; unresolved throws `UnresolvedTokenError`.
- Type-level: `register(token, wrongTypeInstance)` is a compile error; an `@Inject`ed field's type equals the token type with no `as`.
- `container.build(Class)` populates `@Inject`ed fields.
- No `as`; suite + typecheck green.

## Out of scope

Provider scopes / modules (epic #282), per-request scopes (#282).
