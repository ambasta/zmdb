> **ToDo / feature gap.** There is no CLI, so there is no monorepo mode — no
> `nest-cli.json`, no `zmdb generate library`, no project-aware build
> orchestration.

## What to use instead

Yarn workspaces, which is how the zmdb monorepo itself is built. Nothing framework-specific is required, and the tooling is the ecosystem's rather than a framework's.

```json
// package.json
{
  "private": true,
  "packageManager": "yarn@4.18.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "yarn workspaces foreach -Apt run build",
    "test": "vitest run",
    "typecheck": "yarn workspaces foreach -Ap run typecheck"
  }
}
```

`-t` is topological, so a shared package builds before the app that consumes it; `-p` is parallel. That ordering is the substance of what a monorepo-aware CLI provides.

## A layout that works

```
apps/
  api/            # createApp + toNodeHandler
  worker/         # the outbox consumer
  cli/            # operational scripts
packages/
  domain/         # defineSchema tables, services
  contracts/      # shared types and DTOs
```

The important part is that **schemas live in a shared package**. `defineSchema` produces the tables, and `Entity`/`CreateDTO`/`UpdateDTO` are derived from them, so the API, the worker and the CLI share one definition and cannot drift:

```ts
// packages/domain/src/posts.ts
export const posts = defineSchema('posts', { id: serial(), title: varchar(200).notNull() });
export type Post = Entity<typeof posts>;
```

```ts
// apps/api — imports the same table
import { posts } from '@acme/domain';
```

A change to a column is a type error in every consumer at once, which is the whole reason to have the monorepo.

## Registry awareness has a real consequence

`registeredSchemas()` only knows about modules that have been **imported**. In a monorepo it is easy to have a schema that no entry point imports, which means it is invisible to a migration snapshot — and the migration for it never gets generated.

```ts
// packages/domain/src/index.ts — a single barrel that imports every schema
export * from './posts.ts';
export * from './users.ts';
export * from './comments.ts';
```

Then have your migration script import that barrel, and assert the count:

```ts
it('every schema is registered', () => {
  expect(registeredSchemas()).toHaveLength(SCHEMA_COUNT);
});
```

A test rather than a convention, because a missing import produces a missing table with no error.

## Sharing modules, not just types

A module is a class, so a shared package can export one:

```ts
// packages/domain/src/domain.module.ts
@Module({
  providers: [{ token: POSTS, useFactory: c => defineRepository(posts, c.resolve(DRIVER), { dialect: 'postgres' }) }],
})
export class DomainModule {}
```

```ts
// apps/api
@Module({ imports: [DomainModule], controllers: [PostsController] })
export class AppModule {}
```

`compileModule` produces one flat container, so `DRIVER` must be registered somewhere in the graph — and note that `exports` is accepted but **not enforced**, so everything a shared module registers is visible to everything else. Treat module boundaries as documentation, not encapsulation. See [Modules](./web-modules.html).

## TypeScript project references

```json
// apps/api/tsconfig.json
{
  "references": [{ "path": "../../packages/domain" }],
  "compilerOptions": { "composite": true }
}
```

References give incremental builds and enforce that dependencies are declared. The alternative — path mappings into a sibling's `src` — compiles but breaks the moment you publish or build in isolation.

Keep the AOT transformer configured consistently across packages. A shared package built without it exports validators that [fail open](./jit-vs-aot.html), and the app that imports them inherits the problem. Run the canary test in each package that validates:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

## One test runner, one linter

```json
{ "scripts": { "test": "vitest run", "lint": "oxlint", "fmt": "oxfmt" } }
```

Vitest discovers tests across workspaces from the root, so one command covers everything and CI has one entry point. This is what the zmdb repository does, and it is simpler than per-package runners with a coordinating script.

## What it would take

Very little, and that is the point: the gap is a CLI feature whose replacement is the package manager. If a zmdb CLI ships, the monorepo-specific parts worth having are a schema registry check across workspaces and a migration command that knows which app owns which tables — not project scaffolding.

---

See also: [Modules](./web-modules.html) · [CLI](./web-cli.html) · [Migrations](./migrations.html)
