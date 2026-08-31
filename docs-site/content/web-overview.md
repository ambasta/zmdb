`@zmdb/web` is a **Stage-3 decorator web framework** for the zmdb ecosystem —
controllers, a typed request context, compile-time dependency injection and
compile-time domain state machines, with **zero `reflect-metadata` and zero
runtime reflection**. It sits above [`@zmdb/repository`](./repository.html) in the
architecture: controllers inject repositories, routes validate request bodies via
the [AOT validator](./aot-setup.html), and responses serialize through the same
zero-overhead path as the rest of zmdb.

> [!NOTE]
> `@zmdb/web` is in **early alpha**. This page documents the shipped **package
> baseline**; controllers/routing, the typed `Ctx`, DI, domain state machines,
> the request pipeline and the full NestJS-parity layers are being built out
> issue-by-issue (spec → tests → implementation → docs).

## Install

```bash
npm add @zmdb/web@alpha
# or via the umbrella:
npm add zmdb@alpha   # then: import { metadataOf } from 'zmdb/web';
```

> Requires **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. Uses **Stage 3**
> standard decorators — set `"experimentalDecorators": false` (the default under
> a modern `tsconfig`). No `reflect-metadata`.

## Why Stage 3 (and not `experimentalDecorators`)?

NestJS-style frameworks rely on `experimentalDecorators` + `emitDecoratorMetadata`

- `reflect-metadata`, which does **runtime type reflection** on every decorated
  class. `@zmdb/web` rejects that: it uses the **standardized** Stage-3 decorators
  and stores per-class data in the well-known **`Symbol.metadata`** record
  (`context.metadata`). Route tables and the DI graph are resolved **once at
  class-init**, never re-reflected per request — consistent with zmdb's
  [zero-overhead](./inert-rows.html) philosophy.

## The metadata baseline

Every decorator in the framework builds on one primitive — reading the Stage-3
metadata a decorator wrote:

```ts
import { metadataOf } from '@zmdb/web';

function Tagged(value: string) {
  return function <T extends abstract new (...args: never[]) => unknown>(
    _target: T,
    context: ClassDecoratorContext<T>,
  ): void {
    context.metadata.tag = value; // stored in Symbol.metadata
  };
}

@Tagged('users')
class UsersController {}

metadataOf(UsersController).tag; // 'users'
```

`metadataOf(target)` reads the well-known `Symbol.metadata` record off a decorated
class behind a runtime type-guard — **no `as`, no `reflect-metadata`**. For an
undecorated class it returns a frozen empty record (never `undefined`), so callers
can read slots unconditionally.

> [!NOTE]
> Node 26 / V8 does not yet expose `Symbol.metadata`. `@zmdb/web` ships a
> zero-dependency polyfill that installs the well-known symbol when absent (a
> no-op once a runtime ships it natively); it assigns only `Symbol.metadata` and
> mutates no other global.

## Design invariants

- **No `as` on the consumer surface.** You never need a type assertion to use the
  framework correctly.
- **No runtime reflection / no `reflect-metadata`.** Metadata lives in
  `context.metadata`; type information is erased.
- **Zero required third-party runtime dependencies.**
- **ESM-only, Node 26+, TS 7+, Stage 3.**

See the project [ARCHITECTURE](https://github.com/ambasta/zmdb/blob/main/ARCHITECTURE.md)
for where `@zmdb/web` fits in the package DAG and the language/perf policy.

## Roadmap

Controllers & routing · typed `Ctx<Params, Body, Query>` with path-param
derivation · compile-time DI (`@Inject`) · domain state machines · request
pipeline + adapters · repository integration — then full NestJS parity (modules,
guards/pipes/interceptors/filters, app bootstrap & lifecycle, OpenAPI, WS/SSE,
testing utilities).
