> **ToDo / feature gap.** The `zmdb` executable exists and currently ships the
> application-graph `modules` command and the local-terminal `repl`. It does not
> yet ship `zmdb new`, scaffolding or project templates.

## What exists instead

Two things that cover most of what a CLI is used for.

**A migration runner you invoke from your own script.** This is real and supported:

```ts
// scripts/migrate.ts
import { runCli } from '@zmdb/query-compiler/migrations/runner';
import { migrations } from '../src/migrations/index.js';

await runCli(process.argv[2] ?? 'status', connection, migrations);
```

```json
{
  "scripts": {
    "migrate": "node --experimental-strip-types scripts/migrate.ts"
  }
}
```

```bash
yarn migrate up
yarn migrate status
```

`runCli(command, connection, migrations)` handles `up`, `down` and `status` against a `MigrationConnection` you supply. See [Migration Runner](./migrations-cli.html).

**Ordinary Node scripts over the module graph.** Because `createApp` needs no server, any operational task is a script with full access to your services:

```ts
// scripts/backfill.ts
await using app = createApp(AppModule);
await app.init();
const posts = app.container.resolve(POSTS);

for (const row of (await posts.list({ page: { limit: 1000 } })).items) {
  await posts.update(row.id, { slug: slugify(row.title) });
}
```

`await using` disposes the app, closing the pool so the process exits. See [Standalone Applications](./web-standalone.html).

## Why scaffolding is less useful here

A generator earns its keep when creating a component means several files with boilerplate wiring. Here a controller is:

```ts
@Controller('/posts')
export class PostsController {
  @Inject(POSTS) private readonly repo!: PostRepo;

  @Get()
  list() {
    return this.repo.list({ page: { limit: 20 } });
  }
}
```

and registering it is one array entry. There is no `.module.ts` triple, no `.spec.ts` stub with mocked reflection, no provider metadata to generate — so `zmdb new controller posts` would produce roughly what you just read.

A schema, similarly, is one `interface`, and the DTOs, JSON Schema, DDL and validators are all [derived from it](./type-derivation.html) rather than generated as files. That is the design decision that removes most of the generator's job — and the reason the one build step that does exist, [`zmdb-codegen`](./cli-codegen.html), writes nothing into your repository.

## What is genuinely missing

**Introspection command wiring.** There is no `db pull` command, but the library
now reads PostgreSQL, MySQL, and SQLite catalogs and emits reviewed TypeScript
declarations, and `detectDrift()` compares those snapshots with declarations.
The remaining gap is executable config/driver/output wiring; see
[`cli-pull`](./cli-pull.html). `cli-studio` still needs its own server and UI.

**Migration generation from a diff against the live database.** `detectDrift()`
can compare declarations with an introspected snapshot, but generation still
uses the committed snapshot workflow and there is no reviewed command that
applies live findings. See [Migrations](./migrations.html).

**A project starter.** `create-zmdb-app` does not exist. Copy the [Quick Start](./quick-start.html) or the [blog tutorial](./tutorial-blog-api.html).

## Rolling your own commands

`parseArgs` is in Node, so a small task runner needs no dependency:

```ts
import { parseArgs } from 'node:util';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { limit: { type: 'string', default: '100' }, 'dry-run': { type: 'boolean' } },
});

const COMMANDS: Record<string, (o: { limit: number; dryRun: boolean }) => Promise<void>> = {
  backfill,
  reindex,
};

const command = COMMANDS[positionals[0] ?? ''];
if (command === undefined) {
  console.error(`usage: task <${Object.keys(COMMANDS).join('|')}> [--limit n] [--dry-run]`);
  process.exit(1);
}
await command({ limit: Number(values.limit), dryRun: values['dry-run'] === true });
```

A `--dry-run` that logs instead of writing is worth building into anything that touches production data — it is the difference between reviewing a backfill and discovering it.

## What it would take

The `bin` entry and argument dispatch already exist. Scaffolding still needs the
`new` dispatch, templates, workspace targeting and generated-code gates. The migration commands already exist as library calls, so wrapping them is small.

The commands worth building are the ones that still own operational policy:
`db pull` around the shipped reader/emitter, a complete diff against a live
database, and a repeatable seed runner. Scaffolding is the least valuable,
because the thing it would scaffold is already about eight lines.

---

See also: [Migration Runner](./migrations-cli.html) · [Standalone Applications](./web-standalone.html) · [Schema Introspection](./cli-pull.html)
