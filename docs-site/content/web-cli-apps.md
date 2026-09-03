> **ToDo / feature gap.** There is no CLI application mode — no
> `CommandFactory.run`, no `@Command`/`@Option` decorators, no `nest-commander`
> equivalent.

## What works today

A module graph without a server, which is most of the value:

```ts
// scripts/report.ts
import { createApp } from '@zmdb/web';
import { AppModule } from '../src/app.module.ts';
import { REPORTS } from '../src/tokens.ts';

await using app = createApp(AppModule);
await app.init();
const reports = app.container.resolve(REPORTS);

console.log(JSON.stringify(await reports.monthly(), undefined, 2));
```

`createApp` runs `onModuleInit` and `onApplicationBootstrap`, builds every controller and gives you the container. No socket is opened — `App` has [no `listen()`](./web-standalone.html), so nothing starts listening unless you call an adapter.

`await using` matters. `App` is `AsyncDisposable`, and without disposal the connection pool keeps the process alive after your work finishes — the script hangs rather than exiting, which is the first thing people hit here.

## A command dispatcher

```ts
// scripts/task.ts
import { parseArgs } from 'node:util';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: 'string', default: '100' },
    'dry-run': { type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
  },
});

interface Options {
  readonly limit: number;
  readonly dryRun: boolean;
  readonly verbose: boolean;
}

await using app = createApp(AppModule);
await app.init();

const COMMANDS: Record<string, (c: Container, o: Options) => Promise<void>> = {
  backfill: backfillSlugs,
  reindex: rebuildSearchIndex,
  digest: sendDigests,
};

const name = positionals[0] ?? '';
const command = COMMANDS[name];
if (command === undefined) {
  console.error(`usage: task <${Object.keys(COMMANDS).join('|')}> [--limit n] [--dry-run] [-v]`);
  process.exit(1);
}

try {
  await command(app.container, {
    limit: Number(values.limit),
    dryRun: values['dry-run'] === true,
    verbose: values.verbose === true,
  });
} catch (error) {
  console.error(String(error));
  process.exit(1);
}
```

`parseArgs` is a Node built-in, so this has no dependency. A missing exit code on failure is a real bug: a script that logs an error and exits 0 makes CI and cron think it succeeded.

## Make destructive commands ask

```ts
async function backfillSlugs(container: Container, options: Options): Promise<void> {
  const posts = container.resolve(POSTS);
  const { items } = await posts.list({ page: { limit: options.limit } });

  for (const row of items) {
    const slug = slugify(row.title);
    if (options.dryRun) {
      console.log(`${row.id}: ${row.slug ?? '∅'} -> ${slug}`);
      continue;
    }
    await posts.update(row.id, { slug });
  }
  console.log(`${options.dryRun ? 'would update' : 'updated'} ${items.length} rows`);
}
```

`--dry-run` printing the diff is the difference between reviewing a backfill and discovering it afterwards. Default it to _off_ but make it the first thing anyone running the command does — and print which database you are connected to:

```ts
console.error(`database: ${new URL(env.DATABASE_URL).host}`);
```

A one-line reminder of the target host has prevented more incidents than any amount of confirmation prompting.

## Batching, not one big query

```ts
let after: string | undefined;
for (;;) {
  const page = await posts.list({
    orderBy: [{ column: 'id', dir: 'asc' }],
    page: { limit: 500, ...(after !== undefined ? { after } : {}) },
  });

  for (const row of page.items) await posts.update(row.id, { slug: slugify(row.title) });

  if (!page.hasMore) break;
  after = page.cursor;
}
```

Keyset pagination rather than `offset`, because an offset scan over a large table gets slower as it progresses and can skip rows when concurrent writes shift the ordering. See [Cursor Pagination](./guide-cursor-pagination.html).

Wrap each batch in a transaction if partial progress would be inconsistent; leave it out if resumability matters more.

## The transformer, again

Running scripts with `--experimental-strip-types` skips the AOT transformer, so any `assert<T>()` in a script throws `runtime type witness required in test/fallback mode` on its first call — the transformer is what supplies the runtime witness, and without it there is nothing to validate against. It fails loudly rather than accepting anything, so a stripped script does not silently pass bad data; it stops. For a script that validates a CSV or an external API response, build it with `tsup` instead of stripping types. See [JIT vs AOT](./jit-vs-aot.html).

## What it would take

A `@Command('backfill')` decorator with `@Option` metadata, a `CommandFactory.run(AppModule)` entry point that reads them, and help text generation. Perhaps two hundred lines, and it would need [hook detection extended to providers](./web-standalone.html) so a command class need not be a controller.

Worth honesty about the value: the dispatcher above is thirty lines and does not hide the exit codes, the argument types or the disposal — all three of which are places a decorator-based command runner tends to obscure behaviour you need to see in an operational script.

---

See also: [CLI](./web-cli.html) · [Standalone Applications](./web-standalone.html) · [Cursor Pagination](./guide-cursor-pagination.html)
