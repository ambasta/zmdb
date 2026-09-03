> **ToDo / feature gap.** There is no GraphQL layer, so there is no federation — no
> Apollo Federation directives, no subgraph schema building, no gateway, no
> `@key`/`@external`/`@requires` support. The design is frozen (see the last
> section) and covers the subgraph only; a gateway stays out of scope.

## What federation solves, and the cheaper answer

Federation exists so several teams can own parts of one graph and have a gateway compose them, letting a client traverse across service boundaries in a single query.

That is genuinely valuable at a certain size, and it costs a gateway, a schema registry, a composition check in CI, and a debugging story that spans services. Before adopting it, weigh what zmdb gives you in one process:

- `withTransaction` across every table you own.
- Typed joins and `findAllWithMany` across relations, in the database rather than over the network.
- One connection pool, one deployment, one place to look when a request is slow.

Most applications that reach for federation would be better served by one deployable with clear module boundaries. `@Module` gives you the boundaries; see [Modules](./web-modules.html) — bearing in mind that `exports` is accepted but **not enforced**, so a module boundary here is documentation rather than encapsulation.

Split when you have a boundary across which you genuinely never need a transaction.

## Composing services without a gateway

**A contract per service, in OpenAPI.** The closest available equivalent to a subgraph schema, and a real one — commit the document and diff it in CI so a breaking change to a service's interface is visible in review:

```ts
const doc = toOpenApi(CONTROLLERS, { info: { title: 'Orders', version: '1.0.0' } });
```

See [OpenAPI Operations](./web-openapi-operations.html).

**Shared types when both sides are TypeScript.** Better than any generated client, because there is no generation step to drift:

```ts
// packages/contracts
export type OrderRow = Entity<Order>;
```

```ts
const order = await client.get(`/orders/${id}`, raw => assert<OrderRow>(raw));
```

`assert<OrderRow>` is AOT-compiled from the same type the owning service uses, so the boundary is checked at full speed and a schema change is a compile error in the consumer.

**Composition at the edge.** A thin service that calls several others and assembles a response — a gateway you can read:

```ts
@Get('/dashboard')
async dashboard(ctx: Ctx) {
  const [orders, profile] = await Promise.all([
    this.ordersApi.get('/orders?limit=10', (raw) => assert<Order[]>(raw)),
    this.usersApi.get(`/users/${viewer.id}`, (raw) => assert<User>(raw)),
  ]);
  return { orders, profile };
}
```

`Promise.all`, so the fan-out is concurrent. Timeouts on every call — one slow upstream should degrade the dashboard, not hang it. See [HTTP Client](./web-http-client.html).

## The entity-resolution problem does not disappear

Federation's `@key` mechanism exists because a client asking for `Order.customer.name` needs the gateway to fetch the customer from another subgraph. Without federation you do that fetch yourself, and the same N+1 risk applies: ten orders means ten customer lookups unless you batch.

```ts
const ids = [...new Set(orders.map(o => o.customerId))];
const customers = await this.usersApi.get(`/users?ids=${ids.join(',')}`, raw => assert<User[]>(raw));
const byId = new Map(customers.map(c => [c.id, c]));
```

Deduplicate the ids, one batched call, index by id. A batch endpoint on the owning service is the cross-service equivalent of a [DataLoader](./dataloaders.html), and it is worth building before you need it.

## Security across the seam

- **Authenticate service-to-service calls.** An internal service reachable without credentials is reachable by anything that gets into the network. mTLS, or a signed service token — not "it is on a private subnet".
- **Never trust identity claims in a payload.** `body.userId` was written by the caller. Propagate an authenticated token and verify it in the receiving service.
- **Validate every response.** Another team's service is an external dependency; a field going null after their deploy should be an error at your boundary, not `undefined` three layers in.
- **Do not forward a raw error.** An upstream error message can carry table names and values. Log it; return something generic.

## What it will take

The design is frozen, in `packages/web/src/graphql/federation/SPEC.md`, and the deliverable is deliberately narrow: **a subgraph schema a real composer accepts.** No gateway, no router. The advice above stands — most applications reaching for federation want one deployable with real module boundaries — and this makes the subgraph correct for the ones that genuinely need one.

**The directives are tags, not decorators.** A zmdb entity is an `interface`, so there is no class to decorate and no field position that can carry a decorator. `@key`, `@external`, `@requires` and `@provides` come from intersection tags, the same way `Unique` and `References` already do.

**`@key` comes from the primary key you already declared:**

```ts
export interface Product extends Table<'products'> {
  sku: string & Sql<'text'> & PrimaryKey;
  name: string & Sql<'text'>;
}
```

→ `type Product @key(fields: "sku")`. Nothing is written twice, so the gateway's notion of a row's identity cannot drift from the database's. A `Key<'tenantId sku'>` tag exists for a compound key the primary key cannot express, and a field set naming a field the type does not have is a **build error** — the composer may accept it, and entity resolution then fails at runtime for one field path.

**`External` cannot go on a column, and that is the sharpest edge here.** The entity interface generates the DDL, so tagging a column "another service owns this" would create a column in _your_ table for data you never write — duplicated, never updated, silently stale. An entity you extend but do not own is declared as a plain interface with **no `Table<…>`**, which keeps it out of migrations by construction:

```ts
/** Owned by the users subgraph. Not a table here. */
export interface User {
  id: number & Sql<'integer'> & PrimaryKey;
  email: string & Sql<'text'> & External;
}
```

**A reference resolver is typed from the key.** `@ResolveReference()` on a resolver method receives `Reference<Entity<Product>, 'sku'>` — a `Pick` of exactly the key fields plus `__typename` — so reading a non-key field does not compile. The gateway sends only the key fields; typing that parameter any wider is how a reference resolver comes to depend on a field that is not there.

**Composition is validated against a real composer in CI**, not against our reading of the specification, with a deliberately broken subgraph in the negative case so the test proves the composer is actually running. `_service` and `_entities` are not emitted: `buildSubgraphSchema({ typeDefs, resolvers })` adds them from the two things the registry already returns, so a federated app calls that where a plain app calls `createSchema` — one line further along the boundary that already exists.

The nearer-term work that serves the same need is still making the single-deployable story excellent — enforced module `exports`, better cross-module boundaries — so that fewer teams need to split in the first place.

---

See also: [Microservice Transports](./web-microservices-transports.html) · [Modules](./web-modules.html) · [HTTP Client](./web-http-client.html)
