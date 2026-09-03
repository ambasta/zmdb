> **ToDo / feature gap.** There is no GraphQL layer, so there is no field
> middleware — no `@UseMiddleware` on a field, no `middleware` option on `@Field`,
> no per-field resolution wrapper.

## What field middleware is for

Wrapping the resolution of a single field: masking a value, timing it, caching it, or checking authorisation on it. The zmdb equivalents split by _when_ the concern applies.

| Field middleware use               | zmdb equivalent                                |
| ---------------------------------- | ---------------------------------------------- |
| Mask or redact a value             | `Sensitive` on the column, or `select`         |
| Authorise a single field           | a `Chain` bound to the field (frozen, below)   |
| Transform on read                  | [`postSelect` hook](./lifecycle-hooks.html)    |
| Time or count a field's resolution | a [driver wrapper](./web-graphql-plugins.html) |

## Do not fetch what you will not return

The strongest version of field-level control, and it is available today:

```ts
const { items } = await repo.list({ select: ['id', 'title', 'createdAt'], page: { limit: 20 } });
```

`select` narrows both the SQL and the row type. A column that is not selected never leaves the database, so there is no value to mask, nothing in a log, nothing in a heap dump and nothing in an error payload. Field middleware masks _after_ fetching; this is strictly stronger.

The `as const` on a shared field list is required, or the array widens to `string[]` and you get the full row type back:

```ts
const PUBLIC = ['id', 'title', 'createdAt'] as const;
```

## `Sensitive` and exactly what it does

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<320>;
  passwordHash: string & Sql<'text'> & Sensitive;
}
```

> [!WARNING]
> `Sensitive` affects **serialization**, not queries. The column is still
> selected, still travels from the database into your process, and still appears in
> anything that stringifies the raw row — including a debug log or an error dump. It
> is a serialization marker, not an access control.

Combine it with `select` for defence in depth: `select` keeps the value out of the process, `Sensitive` catches the case where something serialises a row you did fetch.

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
class UserRepository extends BaseRepository<User> {
  protected override postSelect(row: Entity<User>): Entity<User> {
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

## What it will take

Field middleware presupposes field resolution, so it follows [the GraphQL layer](./web-graphql-resolvers.html) — but the shape it takes there is frozen, in `packages/web/src/graphql/SPEC.md` §5, and it is not a new decorator:

```ts
const ownerOnly: Chain = { guards: [OwnerOrAdmin], pipes: [], interceptors: [], filters: [] };

registry.register<PostFields>(container.build(PostResolver), {
  post: { validate: raw => assert<{ id: number }>(raw) },
  authorEmail: { chain: ownerOnly },
});
```

It is the same `Chain` an HTTP route takes — the same `Guard`, `Pipe`, `Interceptor` and `ExceptionFilter` interfaces — bound per field in the registration table rather than declared on the field. Two consequences worth knowing now:

- A chain does **not** inherit down a traversal. A guard on `Query.post` says nothing about `Post.authorEmail`; each field that exposes data carries its own. That is deliberate, for the reason the section above gives — a control that a new field can be added without is a control that will be forgotten.
- It authorises, it does not mask. A guard refuses the field, which becomes an error entry with `FORBIDDEN` in `extensions.code` and `null` in the data; nothing rewrites a value on the way out. `Sensitive` still does not stop a resolver returning a value, exactly as the warning above says, so the `select` advice on this page keeps its force.

Because the binding is a table rather than an annotation, the boot check can be exhaustive: every decorated field must appear in it, and every key in it must be a decorated field. A typo is a boot failure rather than a field that silently resolves with no guard.

The framework-side gap worth closing independently is the missing **pre-write** counterpart to `postSelect` — a `preSave` transform applied uniformly across `create`, `update` and the compiler. That would make transparent column encryption and normalisation possible without duplicating the logic in every write path, which is a real, current limitation rather than a GraphQL one.

---

See also: [Repository Hooks](./lifecycle-hooks.html) · [Query Performance](./perf-queries.html) · [Encryption](./web-encryption.html)
