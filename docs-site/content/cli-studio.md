> **ToDo / feature gap.** There is no `zmdb studio`. There is no HTTP server, no
> UI, and no browser bundle anywhere in the project. Unlike most
> [CLI gaps](./cli-overview.html), this one is not packaging — it is a web
> application that does not exist.

## Why it is a long way off

`drizzle-kit studio` and `prisma studio` need three things zmdb does not have:

1. **Introspection**, to show tables it was not told about and to render a column it cannot type. See [pull](./cli-pull.html).
2. **A UI**, which means a build step, a framework, and a bundle — in a project with [zero runtime dependencies](./why-zmdb.html) and no browser target.
3. **A privileged connection**, held by a long-running local process, with write access to your database.

The third is the one worth thinking hardest about. A studio is a tool that holds production credentials and executes arbitrary generated SQL. That is a reasonable thing to build and a serious thing to ship, and it is not the next most valuable feature.

## What to use instead

**Your database's own tools**, which are better than any ORM's:

- `psql` with `\d+ table`, and `\x` for readable wide rows
- `pgcli` / `mycli` — completion and syntax highlighting over the same protocol
- TablePlus, DataGrip, Beekeeper Studio — a GUI over the wire protocol, so nothing about zmdb affects them
- `sqlite3` and the `.schema` / `.tables` dot-commands

None of them care what generated your schema, which is the advantage of a data layer that produces ordinary tables.

**A read-only admin endpoint**, if what you want is a browsable view of your own data. This is thirty lines with the pieces that exist, and it inherits your authentication:

```ts
@Controller('/admin')
export class AdminController {
  @Inject(USERS) private readonly repo!: UserRepository;

  @Get('/users')
  list(ctx: Ctx<Record<never, string>, unknown, { page?: string }>) {
    const limit = 50;
    const offset = (Math.max(Number(ctx.query.page ?? 1), 1) - 1) * limit;
    return this.repo.list({ page: { limit, offset }, orderBy: [{ column: 'id', dir: 'desc' }] });
  }
}
```

Typed, paginated, behind your existing auth, and it only exposes the tables you wrote a handler for — which is a smaller blast radius than a general studio, not a limitation.

**`toOpenApi` plus any OpenAPI viewer**, for browsing the _shape_ of your data rather than its contents. `toOpenApiComponents(schemas)` gives you every table as a JSON Schema; drop it into Swagger UI or Redoc and you have generated documentation of the schema. See [OpenAPI](./openapi.html).

## What it would take

Introspection first, because without it a studio can only show what the schema objects declare — which is a data browser for your own tables, not a database client. That narrower tool is genuinely feasible: it would be a `@zmdb/web` application over an array of schemas you hand it — nothing enumerates your tables, so the list is an argument — generating a list and a detail view per table from `toJsonSchema`, with writes going through the repositories. Shipping it as an opt-in package rather than a CLI command would keep the credentials question in the user's hands, which is where it belongs.

---

See also: [pull](./cli-pull.html) · [OpenAPI](./openapi.html) · [CLI Overview](./cli-overview.html)
