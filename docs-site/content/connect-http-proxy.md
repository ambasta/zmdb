Because a `Driver` has one required method over `{ text, parameters }`, you can put anything between your application and the database — including your own HTTP endpoint. This is how you reach a database from a runtime with no TCP.

## The client driver

```ts
import type { Driver } from '@zmdb/repository';

export function httpDriver(url: string, token: string): Driver {
  return {
    async execute(query) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: query.text, parameters: query.parameters }),
      });
      if (!res.ok) throw new Error(`proxy ${res.status}: ${await res.text()}`);
      return (await res.json()) as Record<string, unknown>[];
    },
  };
}
```

Runs anywhere `fetch` exists — a browser, a Worker, an edge function, React Native.

## The server

A `@zmdb/web` controller over your real driver:

```ts
@Controller('/sql')
export class SqlProxyController {
  @Inject(DRIVER) private readonly driver!: Driver;

  @Post('/')
  async execute(ctx: Ctx<Record<never, string>, unknown>) {
    const body = assert<{ text: string; parameters: unknown[] }>(ctx.body);
    return this.driver.execute(body);
  }
}
```

## Read this before you deploy it

**That endpoint executes arbitrary SQL as your database user.** A proxy accepting `text` from a client is a remote SQL console. If it is reachable from a browser, so is your entire database — a `DROP TABLE`, a `SELECT` over another tenant's rows, a `pg_read_file`. Authentication does not fix it, because an authenticated user is exactly who would abuse it.

Only deploy the shape above **server to server**, inside a trust boundary, with a token that is not shipped to any client.

## The safe version: named queries

For anything a client can reach, do not accept SQL. Accept a name and typed arguments, and compile server-side:

```ts
const QUERIES = {
  activeUsers: (args: { limit: number }) =>
    createQueryCompiler('postgres').selectFrom('users').where('active', '=', true).limit(args.limit).compile(),

  userById: (args: { id: number }) =>
    createQueryCompiler('postgres').selectFrom('users').where('id', '=', args.id).compile(),
} as const;

@Controller('/query')
export class QueryController {
  @Inject(DRIVER) private readonly driver!: Driver;

  @Post('/:name')
  async run(ctx: Ctx<{ name: string }, unknown>) {
    const fn = QUERIES[ctx.params.name as keyof typeof QUERIES];
    if (fn === undefined) throw new ValidationError(`no query named ${ctx.params.name}`, []);
    const args = assert<{ limit?: number; id?: number }>(ctx.body);
    return this.driver.execute(fn(args as never));
  }
}
```

Now the client chooses from a fixed set, the arguments are validated, and the parameters are bound. The blast radius is the queries you wrote.

Better still: skip the generic layer and write ordinary endpoints. `@Controller('/users')` with `@Get('/')` is the same amount of code and produces an [OpenAPI document](./openapi.html) — a "query proxy" is usually a REST API with the types removed.

## What it costs

**A round trip per statement.** `populate` is two. A loop of `findById` is a loop of HTTP calls. The [batching guidance](./connect-cloudflare-d1.html) applies with more force.

**No transactions**, unless you add a session concept — which means server-side state keyed by a token, and a leak if a client never commits.

**JSON type erosion.** `Date` becomes a string, `bigint` will not serialize at all. Handle it in the proxy and validate on the client:

```ts
const rows = (await res.json()).map(r => assert<Entity<User>>(revive(r)));
```

## Where it is genuinely the right answer

A trusted internal service consolidating database access; a local-first client syncing through your API; a runtime with no TCP that must reach Postgres. In all three the proxy is server-controlled — which is the property that makes it acceptable.

---

See also: [Writing a Driver](./custom-driver.html) · [React Native](./connect-react-native.html) · [Security](./web-security-headers.html)
