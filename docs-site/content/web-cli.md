> **ToDo / documentation gap.** The `zmdb` executable ships `generate`,
> `migrate`, `rollback`, `status`, `push`, `check`, `upgrade`, `export`,
> `modules`, `repl`, `studio`, and formatter-backed `new` scaffolding. `pull`
> and the final command transcripts remain.

## Scaffolding that ships

Create a SQLite-backed project:

```bash
npx zmdb new project blog
```

The generated project includes strict TypeScript configuration, formatter and
linter scripts, an AOT build adapter, a health controller with a behavioural
test, and a file-backed SQLite config. Its `check`, `test`, `build`, and `start`
scripts are self-contained once dependencies are installed.

Inside an existing package, generate an application component and its
behavioural spec:

```bash
npx zmdb new schema post
npx zmdb new controller posts
npx zmdb new module billing
npx zmdb new repository post
npx zmdb new command import-posts
```

Generation formats every supported source file before writing it, refuses to
replace an existing path, and prints the module wiring instead of editing a
barrel or application module. Use `--dry-run` to inspect the complete formatted
output without writing files.

## Operational commands

The packaged database commands use the same runner described in the CLI guide:

```bash
npx zmdb migrate
npx zmdb status
npx zmdb rollback
npx zmdb check
```

The library boundary remains available when an application already owns the
migration array:

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

`runCli(command, connection, migrations)` handles `up`, `down` and `status`
against a `MigrationConnection` you supply. See [Migration
Runner](./migrations-cli.html).

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

**A local read-only data browser.** The Studio implementation serves the tables
declared by the active config on `127.0.0.1`. It accepts no SQL or write method,
omits `Sensitive` columns, and caps pages at 50 rows. Publish verification
executes the installed command, waits for its loopback URL, and fetches that
declared-table index. See [studio](./cli-studio.html).

## Why scaffolding stays deliberately small

A generated controller remains ordinary framework code:

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

The scaffold pairs it with a real route-behaviour test and prints the one module
registration step. It does not generate barrel edits, mocked-reflection
boilerplate, or hidden provider metadata.

A schema, similarly, is one `interface`, and the DTOs, JSON Schema, DDL and validators are all [derived from it](./type-derivation.html) rather than generated as files. That is the design decision that removes most of the generator's job — and the reason the one build step that does exist, [`zmdb-codegen`](./cli-codegen.html), writes nothing into your repository.

## What is genuinely missing

**Introspection command wiring.** There is no `db pull` command, but the library
now reads PostgreSQL, MySQL, and SQLite catalogs and emits reviewed TypeScript
declarations, and `detectDrift()` compares those snapshots with declarations.
The remaining gap is executable config/driver/output wiring; see
[`cli-pull`](./cli-pull.html). Studio deliberately does not depend on that
introspection path: it browses only the declarations selected by the config.

**Migration generation from a diff against the live database.** `detectDrift()`
can compare declarations with an introspected snapshot, but generation still
uses the committed snapshot workflow and there is no reviewed command that
applies live findings. See [Migrations](./migrations.html).

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

The `new` dispatch, templates, workspace targeting, formatter integration, and
generated-code gates have landed. The migration, push, check, and upgrade
commands now own their executable config, driver, policy, and output wiring.

The commands worth building are the ones that still own operational policy:
`db pull` around the shipped reader/emitter and a repeatable seed runner.

---

See also: [Migration Runner](./migrations-cli.html) · [Standalone Applications](./web-standalone.html) · [Schema Introspection](./cli-pull.html)
