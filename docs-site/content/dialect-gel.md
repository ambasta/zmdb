> **ToDo / not planned.** No native Gel (formerly EdgeDB) target ships. The
> accepted feasibility decision refused it because Gel owns its schema and
> migration model, while zmdb's declaration is designed to be the source of
> those artifacts. Gel's PostgreSQL-compatible SQL endpoint is the usable path
> today.

## The supported path today: Gel's SQL endpoint

Gel exposes a PostgreSQL-wire SQL endpoint. It supports queries and standard
DML, but not DDL, so Gel's own schema and migration tooling remain authoritative.
Use zmdb's Postgres compiler for reporting, analytics and SQL operations the
endpoint supports:

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.GEL_DSN });
const compiler = createQueryCompiler('postgres');
const query = compiler.selectFrom('users').select(['id', 'name']).compile();

const result = await pool.query({
  text: query.text,
  values: [...query.parameters],
});
```

Write the zmdb declarations to match the relations and tables Gel exposes
through SQL, and validate the returned rows. This is SQL against a
Gel-controlled schema; it is not a native EdgeQL target, and zmdb does not
create or migrate that schema.

## Native target method matrix

This table records only whether EdgeQL could express each repository operation
if the schema-ownership conflict were resolved. **No native Gel method is
implemented or supported.**

| Repository method | EdgeQL query feasibility                                                           |
| ----------------- | ---------------------------------------------------------------------------------- |
| `findById`        | expressible                                                                        |
| `findOne`         | expressible                                                                        |
| `find`            | expressible                                                                        |
| `findAll`         | expressible                                                                        |
| `list`            | needs translation: the current flat predicate plan borrows SQL operator precedence |
| `findByFullText`  | not assessed: full-text search is declared in Gel's schema, the refused half       |
| `findJoined`      | expressible through links and nested shapes                                        |
| `aggregate`       | refused: the callback form gives application code a SQL aggregate builder          |
| `findAllWithMany` | expressible as one nested shape                                                    |
| `create`          | expressible                                                                        |
| `upsert`          | expressible with `unless conflict on`                                              |
| `update`          | expressible                                                                        |
| `delete`          | expressible                                                                        |
| `withTransaction` | not assessed after the target was refused on schema ownership                      |

The query half is a better fit than this refusal might suggest. The target stops
before implementation because the epic explicitly required Gel's
schema-definition model too.

## Why the native target was refused

[SQL Server](./dialect-mssql.html), [CockroachDB](./dialect-cockroach.html), and
[SingleStore](./dialect-singlestore.html) demonstrate that SQL differences can
be represented by traits and explicit DDL branches.

Gel is not another SQL dialect. EdgeQL uses objects, links, sets and shapes:

- a link is a first-class typed relationship, not a foreign-key column;
- expressions return sets rather than SQL-style nullable scalar values;
- shapes return nested objects directly; and
- schemas live in Gel's own files and are migrated by Gel's tooling.

That last point is decisive. zmdb's design makes a TypeScript table declaration
the source from which database shape, DTOs, validators and API documents are
derived. Gel owns its schema and generates a client from it. Both designs cannot
be authoritative for the same application.

There are only two ways to cross that boundary:

1. zmdb generates Gel schema files and turns its migration command into input
   for a second migration system; or
2. zmdb reads Gel's schema and derives TypeScript from it, making Gel the source
   and zmdb a client.

The second design is clearer about ownership, but it is a different product from
zmdb. Neither direction is planned here.

## Where EdgeQL would fit better

Refusal is not a claim that EdgeQL is less expressive. It improves several
areas where the SQL repository has to assemble results:

| Repository concern         | SQL path today                                                    | EdgeQL query half        |
| -------------------------- | ----------------------------------------------------------------- | ------------------------ |
| to-many populate           | second query, chunked `IN`, grouped in JavaScript                 | one nested shape         |
| `Populated<T, K>`          | assembled by `attachRelations`                                    | the shape is the result  |
| `findJoined`               | flat rows; same-named columns on both sides collide               | links and nested objects |
| predicate grouping         | the flat plan borrows SQL's `AND`-before-`OR` precedence          | explicit grouping        |
| many-to-many relationships | the SQL path refuses a relation whose junction cannot be inferred | a native multi link      |

Set semantics are the harder part: EdgeQL has no SQL `NULL`, so `isNull`,
`notNull` and nullable predicate behavior need a semantic decision rather than
a spelling change. The current flat predicate plan also has to become a nested
tree before any non-SQL target can preserve its meaning.

## Using zmdb alongside Gel

Gel can own persistence while zmdb owns the HTTP boundary and validation:

```ts
@Controller('/users')
export class UsersController {
  @Post('/')
  async create(ctx: Ctx<Record<never, string>, unknown>) {
    const dto = assert<CreateUserRequest>(ctx.body);
    return gelClient.query(`insert User { name := <str>$name }`, dto);
  }
}
```

This keeps `@zmdb/web`, AOT validation, generated fixtures and OpenAPI for the
request and response types. `CreateUserRequest` is hand-written rather than
derived from Gel's schema, so it can drift. A round-trip test using
`random<CreateUserRequest>()` is the cheapest guard, not proof that the two
schema systems share a source.

No native compiler target, repository driver or migration integration is
planned.

---

See also: [Query Compiler](./select.html) ·
[Architecture](./architecture.html) · [MongoDB](./dialect-mongodb.html)
