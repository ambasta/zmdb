zmdb has no runtime dependencies, no native binaries and no engine to ship, so deploying it is deploying your own JavaScript. What needs thought is the build step, the migration ordering, and the connection arithmetic.

## The build

Two things must be true of your build output.

**It is ESM.** zmdb is ESM-only and Node 26+.

```json
{ "type": "module" }
```

**The AOT transformer ran.** If it did not, generic `is<T>()` and `assert<T>()` calls
[throw because the runtime has no type witness](./gotchas.html).

```json
{
  "scripts": {
    "build": "tsup",
    "test:transformer": "vitest run test/transformer-canary.test.ts",
    "prepublishOnly": "yarn build && yarn test:transformer"
  }
}
```

Run the canary against the **built output**, not the source, and make it a deploy gate:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

This is the one deployment check specific to zmdb. Platforms with their own transpiler —
[Bun](./connect-bun.html), esbuild-only pipelines, or Metro without the
[React Native wrapper](./connect-react-native.html) — are where configuration is easiest to miss. See
[AOT Setup](./aot-setup.html).

## Migrations run before the new code

```toml
# fly.toml
[deploy]
  release_command = "node dist/scripts/migrate.js up"
```

```yaml
# ci
- run: node dist/scripts/migrate.js up
  env: { DATABASE_URL: ${{ secrets.DATABASE_URL_DIRECT }} }
- run: deploy
```

Two rules:

- **Not at application boot.** Two instances starting together both run the runner. If you have no release step, take an advisory lock — see [migrate](./cli-migrate.html).
- **Use a direct, non-pooled connection.** Multi-statement DDL through a transaction-mode pooler is how you get a half-applied migration.

## Keep the schema backward-compatible for one deploy

During a rolling deploy, the _old_ code runs against the _new_ schema:

| Change                              | Safe in one deploy?                           |
| ----------------------------------- | --------------------------------------------- |
| Add a nullable column               | yes                                           |
| Add a column with a default         | yes                                           |
| Add an index                        | yes (use `CONCURRENTLY` on a live table)      |
| Drop a column the old code selects  | **no** — two deploys                          |
| Rename a column                     | **no** — add, dual-write, backfill, remove    |
| `SET NOT NULL` on a populated table | **no** — takes an exclusive lock; three steps |

A correct migration deployed in the wrong order is the most common way to break a service that has no bugs. See [Custom Migrations](./migrations-custom.html).

## Connections

`max × instances ≤ max_connections − headroom`. Keep `max` small — Postgres connections are processes, and a pool of 10 that queues usually beats a pool of 50 that thrashes. For serverless, see [Serverless Performance](./perf-serverless.html).

## Configuration

Validate the environment once, at startup, so a missing variable fails at boot naming the field:

```ts
export const env = assert<Env>({
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: Number(process.env.PORT ?? 3000),
});
```

See [Configuration](./configuration.html), including the `Number(undefined)` trap.

## A server

```ts
import { createServer } from 'node:http';
import { bodyText, createApp } from '@zmdb/web';

const app = createApp(AppModule);
await app.init();

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const out = await app.handle({
    method: req.method ?? 'GET',
    path: req.url ?? '/',
    headers: req.headers as Record<string, string>,
    rawBody: Buffer.concat(chunks).toString('utf8'),
  });
  res.writeHead(out.status, out.headers).end(await bodyText(out));
});

server.listen(env.PORT);
```

This hand-written module adapter buffers streamed responses. At router level,
`toNodeHandler` streams with backpressure and cancellation.

`App` has no `listen()` — it is transport-agnostic on purpose. See [Standalone Applications](./web-standalone.html).

Handle shutdown, or an in-flight request dies on every deploy:

```ts
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
```

## A container

```dockerfile
FROM node:26-slim AS build
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable
COPY . .
RUN yarn build && yarn test:transformer

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn workspaces focus --production
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
```

Nothing to compile natively and no engine binary to match to the base image — which is the practical benefit of zero runtime dependencies.

## Health checks

```ts
@Get('/healthz')
live() { return { ok: true }; }              // is the process up

@Get('/readyz')
async ready() {                              // can it serve traffic
  await this.driver.execute({ text: 'SELECT 1', parameters: [] });
  return { ok: true };
}
```

Point the load balancer at `/readyz` and the restart policy at `/healthz`. A liveness probe that queries the database restarts your application when the database hiccups, which turns a brief outage into a longer one.

---

See also: [Serverless Performance](./perf-serverless.html) · [migrate](./cli-migrate.html) · [Tutorials](./tutorials.html)
