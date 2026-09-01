An application is `createApp` plus an adapter, so deployment is ordinary Node deployment. This page is the checklist, in the order things go wrong.

## Build

```json
{
  "scripts": {
    "build": "tsup",
    "start": "node dist/main.js"
  }
}
```

Build in CI, deploy the artefact. Building on the target host means the transformer's behaviour depends on the host's toolchain, and a host that builds differently from CI is how validation ends up disabled in production only.

**Verify the transformer ran in the artefact you are shipping:**

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

Run this against the built output, not the source. AOT validation [fails open](./jit-vs-aot.html) — if the transformer is skipped, `is<T>()` returns `true` for invalid input and nothing errors. That is the single most consequential deployment mistake available with this stack.

## A container image

```dockerfile
FROM node:26-slim AS build
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable
COPY . .
RUN yarn build && yarn vitest run

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn workspaces focus --production --all
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/main.js"]
```

- **Tests in the build stage** — that is where the transformer check runs against real output.
- **`USER node`.** Running as root in a container means a code-execution bug is a container-escape starting point.
- **`--production`** so dev dependencies, including the transformer, are absent from the runtime image.
- **Do not `COPY .` into the final stage.** It pulls in `.env`, `.git` and your source. Copy `dist` only, and keep a `.dockerignore`.

## Configuration

Read environment variables once, validate at startup, and fail loudly:

```ts
export const env = assert<{ DATABASE_URL: string; PORT: string; JWT_SECRET: string }>(process.env);
```

A missing variable now crashes at boot instead of producing `undefined` in a connection string at 3am. See [Configuration](./configuration.html).

Never bake secrets into the image or commit a `.env`. Use the platform's secret store, and rotate anything that has ever been in a repository — including in history.

## Graceful shutdown

```ts
const server = createServer(toNodeHandler(app));
server.listen(Number(env.PORT));

let ready = true;
process.once('SIGTERM', async () => {
  ready = false; // readiness now fails
  await new Promise(r => setTimeout(r, 5_000)); // let the LB stop routing
  server.close();
  await app[Symbol.asyncDispose]();
  await pool.end();
});
```

The order matters and the sleep is the part people omit. Closing the server first drops requests the load balancer has already sent, which shows up as a burst of 502s on every deploy. See [Health Checks](./web-health-checks.html).

## Migrations

Run them as a separate step, never on application boot:

```yaml
# deploy pipeline
- run: node dist/migrate.js up
- run: kubectl rollout restart deployment/api
```

On boot with several replicas, every replica races the same migration. Some dialects will deadlock; some will half-apply.

Make migrations backward-compatible so old and new code can run together during a rollout: add a column before writing to it, stop reading a column before dropping it. A single deploy that adds a `NOT NULL` column without a default fails every request from the old replicas. See [Migrations](./migrations.html).

## Behind a proxy

Terminate TLS at the proxy. Then:

- **`x-forwarded-for`** is the client IP. `req.socket.remoteAddress` is the proxy. Trust the header only from a proxy you control, or an attacker sets it.
- **`x-forwarded-proto`** tells you whether the original request was HTTPS.
- **Set a body limit** at the proxy _and_ in your adapter — the framework has none, so a large body is a memory-exhaustion vector. See [Raw Body](./web-raw-body.html).
- **Set security headers** at the proxy: `strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: DENY`. A handler can set them per response via `json(value, { headers })`, but a proxy applies them to every response including errors, which is what you want here.

## The pre-flight checklist

|                                                            |                                                 |
| ---------------------------------------------------------- | ----------------------------------------------- |
| Transformer canary test passes against the built artefact  | see above                                       |
| `NODE_ENV=production`                                      |                                                 |
| Secrets from a secret store, not the image                 |                                                 |
| `max` pool size × replicas ≤ database connection limit     | [Connection Pooling](./connect-postgres.html)   |
| TLS to the database, `rejectUnauthorized` **not** disabled |                                                 |
| Migrations run as a separate step                          | [Migrations](./migrations.html)                 |
| Readiness fails on `SIGTERM`, with a drain delay           | [Health Checks](./web-health-checks.html)       |
| Body size capped at the proxy and in the adapter           | [Raw Body](./web-raw-body.html)                 |
| Logs structured; no parameters, tokens or bodies logged    | [Logging](./logging.html)                       |
| `/metrics` and admin routes not publicly reachable         | [Multiple Servers](./web-multiple-servers.html) |
| Source maps enabled                                        | [Hot Reload](./web-hot-reload.html)             |

> [!WARNING]
> Never set `ssl: { rejectUnauthorized: false }` to make a connection work. It
> disables certificate verification entirely, which makes the connection
> interceptable — and the fix is to supply the provider's CA certificate, which
> every managed database publishes.

---

See also: [Deployment](./deployment.html) · [Serverless](./web-serverless.html) · [Health Checks](./web-health-checks.html)
