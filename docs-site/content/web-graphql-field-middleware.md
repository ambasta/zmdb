> **ToDo / feature gap.** There is no GraphQL layer, so there is no field
> middleware — no `@UseMiddleware` on a field, no `middleware` option on `@Field`,
> no per-field resolution wrapper.

## What field middleware is for

Wrapping the resolution of a single field: masking a value, timing it, caching it, or checking authorisation on it. The zmdb equivalents split by _when_ the concern applies.

| Field middleware use               | zmdb equivalent                                |
| ---------------------------------- | ---------------------------------------------- |
| Mask or redact a value             | `sensitive()` on the column, or `select`       |
| Authorise a single field           | an explicit check in the service               |
| Transform on read                  | [`postSelect` hook](./lifecycle-hooks.html)    |
| Time or count a field's resolution | a [driver wrapper](./web-graphql-plugins.html) |

## Do not fetch what you will not return

The strongest version of field-level control, and it is available today:

```ts
const { rows } = await repo.list({ select: ['id', 'title', 'createdAt'], page: { limit: 20 } });
```

`select` narrows both the SQL and the row type. A column that is not selected never leaves the database, so there is no value to mask, nothing in a log, nothing in a heap dump and nothing in an error payload. Field middleware masks _after_ fetching; this is strictly stronger.

The `as const` on a shared field list is required, or the array widens to `string[]` and you get the full row type back:

```ts
const PUBLIC = ['id', 'title', 'createdAt'] as const;
```

## `sensitive()` and exactly what it does

```ts
const users = defineSchema('users', {
  id: serial(),
  email: varchar(320).notNull(),
  passwordHash: text().notNull().sensitive(),
});
```

> [!WARNING]
> `sensitive()` affects **serialization**, not queries. The column is still
> selected, still travels from the database into your process, and still appears in
> anything that stringifies the raw row — including a debug log or an error dump. It
> is a serialization marker, not an access control.

Combine it with `select` for defence in depth: `select` keeps the value out of the process, `sensitive()` catches the case where something serialises a row you did fetch.

## Per-field authorisation, explicitly

```ts
function toDto(post: Post, viewer: Viewer): PublicPost {
  const canSeeEmail = viewer.id === post.authorId || viewer.role === 'admin';
  const { authorEmail, ...rest } = post;
  return canSeeEmail ? { ...rest, authorEmail } : rest;
}
```

Verbose, and it has two properties field middleware does not: the rule is a plain function you can unit test without a server, and the compiler tells you when a new sensitive column appears — provided `PublicPost` is an `Omit` of the real entity rather than a hand-written interface.

The pattern that scales better is to make the unauthorised data unreachable at the data layer, with a [per-request driver](./web-request-context.html) that sets a tenant or with row-level security. A control at that level cannot be forgotten by a new field; a per-field check can.

## Transform on read

`postSelect` is the one true per-field hook in the project:

```ts
class UserRepository extends BaseRepository<typeof users> {
  protected override postSelect(row: Entity<typeof users>): Entity<typeof users> {
    return { ...row, email: row.email.toLowerCase() };
  }
}
```

It runs on every read path through the repository, which is what makes it trustworthy. The asymmetry to know about: there is no matching pre-write hook that covers `create`, `update` and the query builder uniformly, so an inbound transform — encrypting a column, say — has to live in your service. See [Repository Hooks](./lifecycle-hooks.html) and [Encryption](./web-encryption.html).

## Timing a field

There is no per-field timing, and the driver wrapper gives you something more actionable — which query was slow, not which field was slow:

```ts
if (ms > 50) console.warn(JSON.stringify({ ms: Math.round(ms), sql: query.text }));
```

A slow field is nearly always a slow query or an N+1 pattern. Instrumenting the driver finds both; instrumenting the field tells you where you noticed.

## What it would take

Field middleware presupposes field resolution, so it follows [the GraphQL layer](./web-graphql-resolvers.html).

The framework-side gap worth closing independently is the missing **pre-write** counterpart to `postSelect` — a `preSave` transform applied uniformly across `create`, `update` and the compiler. That would make transparent column encryption and normalisation possible without duplicating the logic in every write path, which is a real, current limitation rather than a GraphQL one.

---

See also: [Repository Hooks](./lifecycle-hooks.html) · [Query Performance](./perf-queries.html) · [Encryption](./web-encryption.html)
