Railway runs a long-running container, which is the easy case: a real pool, real transactions, a release command for migrations, and no serverless caveats.

## The server

```ts
// src/main.ts
import { createServer } from 'node:http';
import { bodyText, createApp } from '@zmdb/web';
import { AppModule } from './app-module.js';

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

server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
```

This module-level adapter buffers streamed responses. Use `toNodeHandler` at
router level when streaming and backpressure must be preserved.

Two Railway-specific requirements: bind `0.0.0.0`, not `localhost`, or the health check cannot reach you; and use `process.env.PORT`, which Railway assigns.

`App` has no `listen()` — it is transport-agnostic on purpose. See [Standalone Applications](./web-standalone.html).

## Graceful shutdown

Railway sends `SIGTERM` on redeploy. Without this, every deploy kills in-flight requests:

```ts
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
```

The timeout is the important half — `server.close` waits for open connections, and a keep-alive connection that never closes will hang the deploy forever.

## Connecting

Railway's Postgres plugin injects `DATABASE_URL`. Use the private network URL (`postgres.railway.internal`) rather than the public proxy — lower latency, no egress, and the traffic does not leave the project.

```ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  statement_timeout: 10_000,
});

export const driver: Driver = {
  async execute(query) {
    const result = await pool.query(query.text, [...query.parameters]);
    return result.rows;
  },
};
```

Because this is a long-running process with a real pool, `withTransaction` works properly — unlike the HTTP-driver situation on [Vercel](./deploy-vercel.html) and [Netlify](./deploy-netlify.html). This is the main reason to prefer a container.

Keep `max` × replicas under the database's `max_connections`. Railway's Postgres defaults are modest, so a pool of 10 across 3 replicas is already 30.

## Migrations as a release command

```json
{
  "scripts": {
    "build": "tsup",
    "start": "node dist/main.js",
    "migrate": "node dist/scripts/migrate.js up",
    "release": "yarn migrate"
  }
}
```

Set the pre-deploy command to `yarn migrate` in the service settings. It runs once per deploy, before the new containers take traffic — which is exactly the ordering you want.

Do not run migrations at boot. With more than one replica they race. See [migrate](./cli-migrate.html).

And keep the schema backward-compatible for one deploy: during a rolling restart, the old code runs against the new schema, so dropping a column the old code selects is a two-deploy operation. See [Deployment](./deployment.html).

## The transformer

Railway builds with Nixpacks or a Dockerfile, so you control the build — which means `tsc` with the transformer works normally. Gate the deploy on the canary:

```json
{ "scripts": { "build": "tsup && yarn test:transformer" } }
```

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

This is the one platform in this section where the transformer needs no special handling — take advantage of it. See [AOT Setup](./aot-setup.html).

## A Dockerfile, if you want reproducibility

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
CMD ["node", "dist/main.js"]
```

Nothing native to compile and no engine binary to match, so the image is small and the build is fast — the practical dividend of zero runtime dependencies.

## Health checks

```ts
@Get('/healthz')
live() { return { ok: true }; }

@Get('/readyz')
async ready() {
  await this.driver.execute({ text: 'SELECT 1', parameters: [] });
  return { ok: true };
}
```

Point Railway's health check at `/readyz`. Do not point a _liveness_ check at a database query — a brief database hiccup would restart your application and turn a short outage into a longer one.

---

See also: [Deployment](./deployment.html) · [Standalone Applications](./web-standalone.html) · [Connect: Postgres](./connect-postgres.html)
