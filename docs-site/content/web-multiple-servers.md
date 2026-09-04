Nothing in the framework is global. `createApp` returns an independent object with its own container and its own router, so running several servers in one process is a matter of calling it more than once.

```ts
const publicApp = createApp(PublicModule);
await publicApp.init();
const adminApp = createApp(AdminModule);
await adminApp.init();

createServer(toNodeHandler(publicApp)).listen(3000);
createServer(toNodeHandler(adminApp)).listen(3001);
```

Two ports, two route tables, two containers. There is no shared registry to collide over and no ordering dependency between them.

## Why you would

**Separating public from internal.** The strongest reason, because it is a security boundary you get from network configuration rather than from code:

```ts
createServer(toNodeHandler(publicApp)).listen(3000, '0.0.0.0');
createServer(toNodeHandler(internalApp)).listen(9000, '127.0.0.1');
```

The internal port binds to loopback, so [`/metrics`](./web-observability.html), health detail and admin routes are unreachable from outside the host regardless of what your proxy does. A guard protecting those routes is one mistake away from being bypassed; a socket that does not accept external connections is not.

**Different middleware or body limits per surface.** A webhook endpoint that needs [raw bytes](./web-raw-body.html) and a large limit can have its own adapter without affecting the JSON API.

**A gradual split.** Two apps in one process today, two processes tomorrow, with no code change other than which `listen` calls you make.

## Sharing state between them

They share nothing by default. If both need the same connection pool — and they should, rather than opening two — build it outside and inject the same instance:

```ts
// shared.module.ts
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

@Module({ providers: [{ token: DRIVER, useValue: makeDriver(pool) }] })
export class SharedModule {}
```

```ts
@Module({ imports: [SharedModule], controllers: [PublicController] })
export class PublicModule {}

@Module({ imports: [SharedModule], controllers: [AdminController] })
export class AdminModule {}
```

A module both apps import is the mechanism. `createApp(rootModule)` takes **no
second argument** — provider overrides are a `createTestApp` feature — so a shared
instance comes from a shared module whose `useValue` is evaluated once, at import
time, no matter how many graphs reference it.

If you need overrides outside a test, drop one level down and wire the router
yourself:

```ts
import { compileModule } from '@zmdb/web/modules';
import { createRouter, toNodeHandler } from '@zmdb/web/pipeline';

const { controllers } = compileModule(PublicModule, [{ token: DRIVER, useValue: driver }]);
const router = createRouter();
for (const controller of controllers) router.register(controller);

createServer(toNodeHandler(router)).listen(3000);
```

That is exactly what `createApp` does, minus the lifecycle hooks — which you then
call yourself if any controller implements them.

Get this right or you will double your connection count — with `max: 10` in two apps you hold 20 connections and your pool sizing calculations are silently wrong. See [Connection Pooling](./connect-postgres.html).

## One process, or several?

|                    | One process, several ports | Several processes |
| ------------------ | -------------------------- | ----------------- |
| Memory             | one runtime                | one per process   |
| Pool sharing       | trivial                    | needs a pooler    |
| Isolation on crash | none — one crash kills all | independent       |
| Scaling            | together                   | independently     |
| Deployment         | one artefact               | one per service   |

The crash row is the one to weigh. An unhandled rejection in the admin app takes the public API down with it. If the public API's availability matters more than the convenience, split the processes.

## Sharing a port instead

Often what you actually want — one port, routes from two modules:

```ts
const app = createApp(RootModule); // RootModule imports both
await app.init();
```

Or, if the modules must stay separate, dispatch by prefix in the adapter:

```ts
createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const target = path.startsWith('/admin') ? adminApp : publicApp;
  const out = await target.handle(await webRequest(req));
  res.writeHead(out.status, { ...out.headers }).end(out.body);
});
```

Note that `adminApp`'s controllers must then declare the `/admin` prefix themselves — the dispatcher does not strip it, and a mismatch produces a 404 that looks like a routing bug. `webRequest(req)` is the `WebRequest` the dispatcher builds itself — there is no `toWebRequest` to import; it is written out in [Request Lifecycle](./web-request-lifecycle.html).

Prefix dispatch on a single port is **not** a security boundary. Anything reachable on the port is reachable; use separate ports and a loopback bind for that.

## HTTPS and HTTP/2

The adapters are transport-agnostic — they produce a Node request handler, so any Node server accepts them:

```ts
import { createSecureServer } from 'node:http2';
import { createServer as createHttps } from 'node:https';

createHttps({ key, cert }, toNodeHandler(app)).listen(443);
createSecureServer({ key, cert, allowHTTP1: true }, toNodeHandler(app)).listen(8443);
```

In practice terminate TLS at a proxy or load balancer, which also handles certificate rotation, OCSP and HTTP/2 negotiation. Terminating in Node means you own certificate renewal, and a lapsed certificate is a full outage.

## Fetch-based runtimes

`toFetchHandler` gives you a `(Request) => Promise<Response>` for Workers, Deno and Bun. Multiple apps compose the same way:

```ts
const handlePublic = toFetchHandler(publicApp);
const handleAdmin = toFetchHandler(adminApp);

export default {
  fetch(request: Request) {
    return new URL(request.url).pathname.startsWith('/admin') ? handleAdmin(request) : handlePublic(request);
  },
};
```

One worker, one port — the platform gives you no second socket, so the loopback-isolation trick is unavailable there. Use a separate worker deployment for the internal surface.

---

See also: [Standalone Applications](./web-standalone.html) · [Observability](./web-observability.html) · [Deployment](./web-deployment.html)
