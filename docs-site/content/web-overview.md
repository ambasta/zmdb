`@zmdb/web` is the **Stage-3 HTTP framework** for the zmdb ecosystem — controllers, typed request context, middleware, OpenAPI, gateways, and testing over the protocol-neutral `@zmdb/app` kernel, with
**zero `reflect-metadata` and zero runtime type reflection**. Controllers inject app-owned services, routes validate request bodies via the [AOT validator](./aot-setup.html), and responses serialize
through the same zero-overhead path as the rest of zmdb.

> [!NOTE] `@zmdb/web` and `@zmdb/app` are in **early alpha**. The package boundary is intentional: app owns metadata, DI, modules, lifecycle, commands, events, CQRS, state, health contracts, and
> observability ports; web owns HTTP-facing composition.

## Install

```bash
npm add @zmdb/web@alpha
# or via the umbrella:
npm add zmdb@alpha
```

> Requires **Node.js 26+**, **TypeScript 7+**, and is **ESM-only**. Uses **Stage 3** standard decorators — set `"experimentalDecorators": false` (the default under a modern `tsconfig`). No
> `reflect-metadata`.

## Why Stage 3 (and not `experimentalDecorators`)?

NestJS-style frameworks rely on `experimentalDecorators` + `emitDecoratorMetadata`

- `reflect-metadata`, which does **runtime type reflection** on every decorated class. `@zmdb/web` rejects that: it uses the **standardized** Stage-3 decorators and stores per-class data in the
  well-known **`Symbol.metadata`** record (`context.metadata`). Route tables and the DI graph are resolved **once at class-init**, never re-reflected per request — consistent with zmdb's
  [zero-overhead](./inert-rows.html) philosophy.

## The metadata baseline

Every decorator in the framework builds on one primitive — reading the Stage-3 metadata a decorator wrote:

```ts
import { metadataOf } from '@zmdb/app';

function Tagged(value: string) {
  return function <T extends abstract new (...args: never[]) => unknown>(_target: T, context: ClassDecoratorContext<T>): void {
    context.metadata.tag = value; // stored in Symbol.metadata
  };
}

@Tagged('users')
class UsersController {}

metadataOf(UsersController).tag; // 'users'
```

`metadataOf(target)` reads the well-known `Symbol.metadata` record off a decorated class behind a runtime type-guard — **no `as`, no `reflect-metadata`**. For an undecorated class it returns a frozen
empty record (never `undefined`), so callers can read slots unconditionally.

> [!NOTE] Node 26 / V8 does not yet expose `Symbol.metadata`. `@zmdb/app` ships the one zero-dependency polyfill that installs the well-known symbol when absent (a no-op once a runtime ships it
> natively); it assigns only `Symbol.metadata` and mutates no other global.

## Design invariants

- **No `as` on the consumer surface.** You never need a type assertion to use the framework correctly.
- **No runtime reflection / no `reflect-metadata`.** Metadata lives in `context.metadata`; type information is erased.
- **Zero required third-party runtime dependencies.**
- **ESM-only, Node 26+, TS 7+, Stage 3.**

See the project [ARCHITECTURE](https://github.com/ambasta/zmdb/blob/main/ARCHITECTURE.md) for where `@zmdb/web` fits in the package DAG and the language/perf policy.

## Package boundary

Use `@zmdb/app` for protocol-neutral application code and `@zmdb/web` for HTTP declarations and adapters. The `zmdb/web` umbrella remains a curated combined surface during the package migration.
