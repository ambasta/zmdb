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
  domain/         # table interfaces, services
  contracts/      # shared types and DTOs
```

The important part is that **the declarations live in a shared package**. A table is an
interface, and `Entity`/`CreateDTO`/`UpdateDTO` are derived from it, so the API, the worker
and the CLI share one definition and cannot drift:

```ts
// packages/domain/src/posts.ts
import type { Length, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'varchar'> & Length<200>;
}
```

```ts
// apps/api — imports the same declaration
import type { Post } from '@acme/domain';

const posts = defineRepository(schemaOf<Post>(), driver, { dialect: 'postgres' });
```

Note what crosses the package boundary: a **type**. `schemaOf<Post>()` is resolved by the
transformer in the consuming package, from the same `.d.ts` the type checker reads, so
there is no schema value to export and no import order to get right.

A change to a column is a type error in every consumer at once, which is the whole reason to have the monorepo.

## Nothing enumerates your tables for you

There is no registry. A declaration is a type, and a type registers itself nowhere — so the
list of tables a migration snapshot covers is the **array you pass**:

```ts
// packages/domain/src/tables.ts — the one list
import { schemaOf } from '@zmdb/schema-core';
import type { Comment, Post, User } from './index.ts';

export const ALL_TABLES = [schemaOf<User>(), schemaOf<Post>(), schemaOf<Comment>()];
```

```ts
const ops = diff(previous, snapshot(ALL_TABLES));
```

A table missing from that array is a table with no migration and no error. The old registry
had the same failure mode wearing a disguise — it only knew about modules something had
imported — and an explicit array at least puts the omission in a file a reviewer reads.

Guard it with a test that counts declarations against the list, which is cheap because
`extends Table<` is greppable:

```ts
it('every declared table is in ALL_TABLES', async () => {
  const sources = await glob('packages/domain/src/**/*.ts');
  const declared = (await Promise.all(sources.map(f => readFile(f, 'utf8')))).flatMap(text =>
    [...text.matchAll(/extends Table<'([^']+)'/g)].map(m => m[1]),
  );
  expect(new Set(ALL_TABLES.map(s => s.table))).toEqual(new Set(declared));
});
```

A test rather than a convention, because the omission is silent either way.

## Sharing modules, not just types

A module is a class, so a shared package can export one:

```ts
// packages/domain/src/domain.module.ts
@Module({
  providers: [
    { token: POSTS, useFactory: c => defineRepository(schemaOf<Post>(), c.resolve(DRIVER), { dialect: 'postgres' }) },
  ],
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

Keep the transformer configured consistently across packages — and note that this is not
optional for a package that declares tables, since `schemaOf<T>()` is compiled away by it
and [throws](./jit-vs-aot.html) if it was not. A package built without it does not export
validators that quietly pass; it exports code that throws on first use, which is the
failure direction you want but still a broken build. Run the canary test in each package
that validates:

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
