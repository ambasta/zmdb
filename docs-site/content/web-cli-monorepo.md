At a workspace root, `zmdb new` requires `--package`. It discovers the legal
targets, but it does not guess which one should receive framework code.

## The refusal is intentional

Given this workspace:

```text
apps/
├── api/
│   └── package.json  # @acme/api
└── worker/
    └── package.json  # @acme/worker
package.json          # workspaces: ["apps/*"]
```

an untargeted scaffold is an exit-2 usage error:

```text
$ npx zmdb new controller posts
zmdb new: refusing to guess a workspace package; pass --package <name>. Candidates:
  @acme/api (apps/api)
  @acme/worker (apps/worker)
```

No file is written. A wrong package choice is not a warning that can be fixed
before the command exits; it is source code silently created in a package that
may not even depend on the web framework. One explicit flag is cheaper than
finding that file later.

## Select a package explicitly

Use either its package name or its workspace-relative path:

```text
$ npx zmdb new controller posts --package @acme/api
created src/posts.controller.ts
created src/posts.controller.spec.ts

add to src/app.module.ts, in @Module({ controllers: [ … ] }):
  PostsController,
```

The output paths are relative to the selected package. The measured workspace
tree is:

```text
apps/
├── api/
│   ├── package.json
│   └── src/
│       ├── posts.controller.spec.ts
│       └── posts.controller.ts
└── worker/
    └── package.json
```

This spelling is equivalent when the path is unique:

```bash
npx zmdb new controller posts --package apps/api
```

## Invocation inside a package

When the current directory is inside exactly one discovered workspace package,
there is no choice to make and the CLI targets that package:

```text
$ cd apps/worker
$ npx zmdb new module jobs
created src/jobs.module.ts
created src/jobs.module.spec.ts

add to src/app.module.ts, in @Module({ imports: [ … ] }):
  JobsModule,
```

It does not infer a target merely because a workspace currently contains one
candidate. Workspace membership changes; the current directory is the stable
signal that the caller selected a package.

## What workspace discovery reads

The CLI walks upward to the nearest workspace declaration and supports:

- `package.json` with a `workspaces` array;
- `package.json` with `workspaces.packages`;
- `pnpm-workspace.yaml`;
- include and `!` exclusion patterns.

Each matching package is resolved to its real path, read for its `name`, and
listed deterministically. A symlink that escapes the workspace root is ignored.

## Build orchestration stays with the package manager

There is no `zmdb new library`, `zmdb.workspace.json`, or framework build
planner. Yarn, pnpm, and npm already know the dependency graph:

```json
{
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "yarn workspaces foreach -Apt run build",
    "test": "vitest run",
    "typecheck": "yarn workspaces foreach -Ap run typecheck"
  }
}
```

Topological build order, caching, and parallelism belong there. The scaffold's
monorepo responsibility is narrower: choose one package safely and write only
below it.

## Share declarations as types

A shared package can own the declaration:

```ts
// packages/domain/src/post.ts
import type { Length, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'varchar'> & Length<200>;
}
```

Each application imports the same type and derives its own schema value:

```ts
import { defineRepository, schemaOf } from 'zmdb';
import type { Post } from '@acme/domain';

const posts = defineRepository(schemaOf<Post>(), driver, { dialect: 'postgres' });
```

`schemaOf<Post>()` is transformed in the consuming package. Keep the AOT adapter
configured in every package that calls a transformed function, and retain a
small canary such as:

```ts
it('runs the transformer', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

Each application should also own the `zmdb.config.ts` that names its schema
globs, migrations, dialect, and driver. That explicit config answers which
application owns which tables without adding a second workspace registry.

---

See also: [CLI & Scaffolding](./web-cli.html) · [Configuration](./configuration.html) ·
[Modules](./web-modules.html)
