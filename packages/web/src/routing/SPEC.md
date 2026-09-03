# `@zmdb/web` — routing SPEC

> Controllers & routing via Stage-3 decorators (epic #252). Frozen before code.

## Contract

### Decorators

- **`@Controller(prefix?: string)`** — a Stage-3 **class** decorator. Records the
  controller's path prefix in `context.metadata`. A missing/empty prefix means no
  prefix. Leading/trailing slashes are normalized so composition is predictable.
- **`@Get(path?) / @Post(path?) / @Put(path?) / @Patch(path?) / @Delete(path?)`** —
  Stage-3 **method** decorators. Each appends a `RouteDefinition` to the list the
  decorated class **owns** in `context.metadata`, capturing
  `{ method, path, handlerName }`. A missing path means the controller prefix
  itself. The own-property write is load-bearing: a subclass's metadata record has
  the base's as its prototype, so appending to the list a plain read returns would
  write the subclass's route into the base, and through it into every sibling
  subclass (#607).

### Reader

- **`getRoutes(ControllerClass)`** → `readonly ResolvedRoute[]` where
  `ResolvedRoute = { method: HttpMethod; path: string; handlerName: string }`.
  The `path` is the **prefix composed with the method path**, normalized to a
  single leading slash and no trailing slash (except the root `/`). Ordering is
  **declaration order** of the methods. Computed by reading `context.metadata`
  (no reflection); callers may cache — the metadata is stable after class-init.

### Inheritance

- A subclass's routes are **the routes it inherits, then its own**, all composed
  with the prefix that applies to the subclass. `@Controller` on the subclass is
  optional; without it the base's prefix is inherited too.
- A handler the subclass **redeclares** keeps only the subclass's path: overriding
  a method to change its route is a rename, not an addition. Two verbs on one
  method are both own declarations, so both survive.
- Reading a base class is unaffected by whether a subclass's module has been
  evaluated. Without that, two entry points importing different subsets of an app
  get different route tables from the same base class.

### Types

- `HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`.
- `RouteDefinition` (raw, per-method) and `ResolvedRoute` (prefix-composed).

## Path composition rules

- \`prefix='/users'\`, method \`path='/:id'\` → \`/users/:id\`.
- \`prefix='users'\`, \`path='' \` → \`/users\`.
- empty prefix + \`path='/health'\` → \`/health\`.
- duplicate slashes collapse; a trailing slash is stripped; the root stays \`/\`.

## Invariants

- Stage 3 decorators only; data lives in `context.metadata`. **No
  `reflect-metadata`, no runtime reflection.**
- **No `as`/`any`/`!` on the consumer surface.** The metadata slots the framework
  reads/writes are accessed behind typed helpers; any internal boundary read is a
  commented `// boundary:` exception per ARCHITECTURE.md §2.1.
- Handlers are plain methods; there are **no parameter decorators** (Stage 3 has
  none) — the typed request context is a separate concern (epic #257).

## Acceptance

- A decorated controller's routes are recoverable via `getRoutes` with correct
  method, composed path, and handler name, in declaration order.
- Prefix composition matches the rules above (covered by tests, incl. empty
  prefix and root path).
- No `as` in the routing source; suite + typecheck green.

## Out of scope

Dispatch/execution (epic #272), typed `Ctx` & path params (#257), DI (#262).
