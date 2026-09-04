Command applications use the same module graph, dependency injection and lifecycle as an HTTP application,
without creating a listener. `@zmdb/web/cli` supplies the `@Command` decorator and `createCommandApp`.

## Declare a command

The arguments are an ordinary DTO. Its emitted JSON Schema drives option parsing, number coercion and help;
its emitted validator checks the final object before `run` receives it.

```ts
import { assert } from '@zmdb/aot-validator';
import { toJsonSchema } from '@zmdb/schema-core/openapi';
import { Command, createCommandApp } from '@zmdb/web/cli';
import { Inject } from '@zmdb/web/di';
import { Module } from '@zmdb/web/modules';

import { POSTS } from '../src/tokens.js';
import type { PostRepository } from '../src/types.js';

interface BackfillArgs {
  readonly tenant: string;
  readonly limit?: number;
  readonly dryRun?: boolean;
  readonly tag?: readonly string[];
}

@Command<BackfillArgs>({
  name: 'backfill-slugs',
  description: 'Backfill missing post slugs',
  args: toJsonSchema<BackfillArgs>(),
  validate: raw => assert<BackfillArgs>(raw),
  positionals: ['tenant'],
})
class BackfillSlugs {
  @Inject(POSTS) private readonly posts!: PostRepository;

  async run(args: BackfillArgs): Promise<void> {
    const page = await this.posts.list({
      page: { limit: args.limit ?? 500 },
    });

    for (const post of page.items) {
      if (args.dryRun === true) {
        console.log(`${post.id}: ${post.slug ?? '∅'} -> ${slugify(post.title)}`);
      } else {
        await this.posts.update(post.id, { slug: slugify(post.title) });
      }
    }
  }
}

@Module({
  providers: [postRepositoryProvider],
  commands: [BackfillSlugs],
})
class AppModule {}

await using app = createCommandApp(AppModule);
await app.init();
process.exitCode = await app.run();
```

The class has a zero-argument constructor. Dependencies use the same `@Inject` fields as controllers, and a
controller and command in one module resolve the same singleton provider.

There is deliberately no `@Args()` or `@Option()` parameter decorator. Stage-3 decorators have no parameter
form, and the JSON Schema document already carries the option names and scalar types without duplicating
them in decorator metadata.

## argv conventions

For the declaration above:

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

The parser follows the conventional spellings:

- `dryRun` becomes `--dry-run`, while `--no-dry-run` supplies `false`.
- A repeated array flag is always an array, including a single occurrence.
- JSON Schema `number` and `integer` properties are coerced before validation.
- `positionals` binds names in declaration order.
- Values after `--` are passthrough and never enter the DTO.
- Unknown flags, missing required values and validator failures print command help and return exit code 2.

Nested objects and arrays of objects are refused when the application is created: argv is a flat boundary.
A property tagged `Sensitive` is absent from the emitted document, so no flag is registered for it; secrets
belong in the environment rather than process arguments.

## Help and exit codes

With several commands, no name or `--help` prints every command and its description. A single registered
command may omit its name, which keeps a one-command binary terse. `command --help` is derived from the same
args document used by the parser, so it cannot drift from accepted flags.

`run` returns an exit code and never calls `process.exit`:

| Command result       |                        Exit code |
| -------------------- | -------------------------------: |
| `undefined` / `void` |                                0 |
| number               |     floored and clamped to 0–255 |
| `true` / `false`     |                            0 / 1 |
| thrown error         |    1, with the message on stderr |
| usage error          | 2, with generated help on stderr |

Assign the result to `process.exitCode`. Calling `process.exit(...)` would skip `await using` disposal and can
leave a pool or driver open.

## Lifecycle and operational safety

`app.init()` runs provider and command `onModuleInit` / `onApplicationBootstrap` hooks in construction order.
Disposal runs `onShutdown` in reverse construction order, so a command closes before the provider it
resolved. An unresolved provider factory is not constructed merely to look for hooks.

For destructive work, keep an explicit `--dry-run`, print the target database, and process bounded keyset
pages rather than one offset scan:

```ts
console.error(`database: ${new URL(env.DATABASE_URL).host}`);

let after: string | undefined;
for (;;) {
  const page = await posts.list({
    orderBy: [{ column: 'id', dir: 'asc' }],
    page: { limit: 500, ...(after !== undefined ? { after } : {}) },
  });

  for (const row of page.items) {
    if (!args.dryRun) await posts.update(row.id, { slug: slugify(row.title) });
  }

  if (!page.hasMore) break;
  after = page.cursor;
}
```

## The transformer still matters

Running a command source through Node type stripping skips the AOT transformer. An untransformed
`assert<T>()` therefore throws `runtime type witness required in test/fallback mode` rather than accepting
unvalidated input. Build command entry points with the configured transformer, and keep a transformer canary
in generated-project tests.

---

See also: [CLI](./web-cli.html) · [Standalone Applications](./web-standalone.html) ·
[Cursor Pagination](./guide-cursor-pagination.html)
