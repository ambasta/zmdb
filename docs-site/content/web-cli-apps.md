A command application is the same compiled module graph, dependency injection, validation boundary, and lifecycle as an HTTP application, driven by argv instead of a request. It creates no listener.

## A repository-backed batch command

The arguments are an ordinary DTO. Its emitted JSON Schema defines the flat argv surface, and its emitted validator checks the coerced object before `run` receives it.

```ts
// scripts/backfill-slugs.ts
import { assert, defineRepository, schemaOf, type BaseRepository } from 'zmdb';
import { Command, createCommandApp } from '@zmdb/web/cli';
import { toJsonSchema } from '@zmdb/schema-core/openapi';
import { Inject, Module, repositoryToken } from 'zmdb/web';

import config from '../zmdb.config.js';
import type { Post } from '../src/post.js';
import { slugify } from '../src/slugify.js';

interface BackfillArgs {
  readonly tenant: string;
  readonly limit?: number;
  readonly dryRun?: boolean;
  readonly tag?: readonly string[];
}

const POSTS = repositoryToken<Post>('PostRepository');

@Command<BackfillArgs>({
  name: 'backfill-slugs',
  description: 'Backfill missing post slugs',
  args: toJsonSchema<BackfillArgs>(),
  validate: raw => assert<BackfillArgs>(raw),
  positionals: ['tenant'],
})
class BackfillSlugs {
  @Inject(POSTS) private readonly posts!: BaseRepository<Post>;

  async run(args: BackfillArgs): Promise<void> {
    let after: string | undefined;

    for (;;) {
      const page = await this.posts.list({
        where: { tenant: args.tenant },
        orderBy: [{ column: 'id', dir: 'asc' }],
        page: {
          limit: args.limit ?? 500,
          ...(after === undefined ? {} : { after }),
        },
      });

      for (const post of page.items) {
        const slug = slugify(post.title);
        if (args.dryRun === true) {
          console.log(`${String(post.id)}: ${post.slug ?? '∅'} -> ${slug}`);
        } else {
          await this.posts.update(post.id, { slug });
        }
      }

      if (!page.hasMore || page.cursor === undefined) break;
      after = page.cursor;
    }
  }
}

if (config.driver === undefined) {
  throw new Error('backfill-slugs needs a configured driver');
}
const driver = await config.driver();

@Module({
  providers: [
    {
      token: POSTS,
      useValue: defineRepository(schemaOf<Post>(), driver, {
        dialect: driver.dialect ?? config.dialect,
      }),
    },
  ],
  commands: [BackfillSlugs],
})
class AppModule {}

await using app = createCommandApp(AppModule);
await app.init();
process.exitCode = await app.run();
```

The zero-argument command class receives its repository through the same `@Inject` field mechanism as a controller. A controller and command that request `POSTS` from the same module graph receive the
same singleton.

There is no `@Args()` or `@Option()` parameter decorator. Stage-3 decorators have no parameter form, and the emitted JSON Schema already carries the option names and scalar types without duplicating
them in runtime metadata.

## Generated help is measured from the same declaration

For the declaration above, the real command runner emits:

```text
$ node dist/backfill-slugs.mjs --help
Usage: backfill-slugs <tenant>

Backfill missing post slugs

Options:
  --dry-run
  --limit <value>
  --tag <value>...
  --help
```

Help is alphabetical for options because it comes from the emitted document; positionals retain the order in `positionals`.

## argv mapping

```text
backfill-slugs acme --limit 100 --dry-run --tag urgent --tag repair
```

becomes:

```ts
{
  tenant: 'acme',
  limit: 100,
  dryRun: true,
  tag: ['urgent', 'repair'],
}
```

The parser follows these conventions:

- `dryRun` maps to `--dry-run`; `--no-dry-run` supplies `false`.
- A repeated array flag is always an array, including one occurrence.
- JSON Schema `number` and `integer` properties are coerced before validation.
- Named positionals bind in declaration order.
- Values after `--` are passthrough and never enter the DTO.
- Unknown flags, extra positionals, missing required values, and validation failures print command help and return exit code 2.

Nested objects and arrays of objects are refused when the application is created: argv is a flat boundary. A property omitted from JSON Schema, including one tagged `Sensitive`, never becomes a
registered flag. Secrets belong in the environment, not process arguments.

## Dispatch and exit codes

With several commands, no name or `--help` prints every command and description. A single registered command may omit its name, which keeps a one-command binary terse.

`run` returns an exit code and never calls `process.exit`:

| Command result       | Exit code                        |
| -------------------- | -------------------------------- |
| `undefined` / `void` | 0                                |
| number               | floored and clamped to 0–255     |
| `true` / `false`     | 0 / 1                            |
| thrown error         | 1, with the message on stderr    |
| usage error          | 2, with generated help on stderr |

Assign the result to `process.exitCode`. Calling `process.exit(...)` would skip `await using` disposal and can leave a pool or driver open.

## Lifecycle and the AOT boundary

`app.init()` runs provider and command `onModuleInit` / `onApplicationBootstrap` hooks in construction order. Disposal runs `onShutdown` in reverse construction order, so a command shuts down before
the provider it resolved. An unresolved provider factory is not constructed merely to look for hooks.

Build command entry points with the configured AOT adapter. Running the source through Node type stripping skips the transform; an untransformed `assert<T>()` throws
`runtime type witness required in test/fallback mode`. The failure is loud rather than permissive, but it still means the command was not built correctly.

`zmdb new command <name>` creates a command and behavioural spec with the same surface, then prints the `@Module({ commands: [...] })` registration.

---

See also: [CLI & Scaffolding](./web-cli.html) · [Standalone Applications](./web-standalone.html) · [Cursor Pagination](./guide-cursor-pagination.html)
