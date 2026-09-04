> **ToDo / feature gap.** There is no Gel (formerly EdgeDB) support, and it is the
> one target that is not a dialect problem. Gel's native query language is EdgeQL,
> which is not SQL and not a variant of it, so the [query compiler](./select.html)
> has nothing to map onto.

## Why this is different from the other gaps

Every other missing dialect — [SQL Server](./dialect-mssql.html), [Cockroach](./dialect-cockroach.html), [SingleStore](./dialect-singlestore.html) — is a matter of quoting, placeholders and type names. Gel is a different data model:

- **Objects and links, not rows and foreign keys.** A link is a first-class typed relationship, not a column holding a key.
- **Set-based semantics.** EdgeQL expressions return sets; there is no `NULL` in the SQL sense.
- **Shapes, not `SELECT` lists.** `select User { name, posts: { title } }` returns a nested structure natively — no join, no row multiplication, no second query.
- **The schema is Gel's own**, declared in `.gel`/`.esdl` files and migrated by Gel's tooling.

That last point is the deepest incompatibility: zmdb's whole design is that a TypeScript schema object is the single source of truth from which the DDL, the DTOs, the validators and the OpenAPI document are derived. Gel owns its schema and generates a client from it. Both are "one source of truth" designs, and they cannot both be the source.

## Gel's SQL endpoint

Gel exposes a read-mostly Postgres-protocol endpoint, so a subset works through `'postgres'`:

```ts
const pool = new Pool({ connectionString: process.env.GEL_DSN });
const compiler = createQueryCompiler('postgres');
```

Tables appear with Gel's own naming, links are surfaced as columns and link tables, and writes are limited. This is viable for analytics and reporting against a Gel database; it is not a way to build an application on one. Treat it as [raw SQL against a foreign schema](./raw-sql.html) — write the schema objects to match what the endpoint exposes and validate the rows.

## Using zmdb alongside Gel

The parts with no SQL in them transfer cleanly, and this is a reasonable architecture:

```ts
// Gel owns persistence; zmdb owns the HTTP boundary and validation
@Controller('/users')
export class UsersController {
  @Post('/')
  async create(ctx: Ctx<Record<never, string>, unknown>) {
    const dto = assert<CreateUserRequest>(ctx.body); // AOT validator
    return gelClient.query(`insert User { name := <str>$name }`, dto);
  }
}
```

You get `@zmdb/web`'s routing and DI, the generated validators, and `toOpenApi` over your request and response types, with Gel as the data layer. What you lose is the derivation — `CreateUserRequest` is hand-written rather than `CreateDTO<User>`, so it can drift from the Gel schema. A test that round-trips a `random<CreateUserRequest>()` through Gel is the cheapest guard against that.

## What it would take

Not a dialect. It would be a second compiler target emitting EdgeQL, and a decision about which schema is authoritative — either zmdb generates `.gel` schema files from schema objects (making zmdb the source and Gel's migration tooling downstream), or it reads Gel's schema and derives TypeScript types from it (making zmdb a client). The second is clearer about who owns what, and is a different product from what zmdb is.

No work is planned here. If you are choosing between them, choose one.

---

See also: [Query Compiler](./select.html) · [Architecture](./architecture.html) · [MongoDB](./dialect-mongodb.html)
