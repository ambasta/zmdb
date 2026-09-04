# `@zmdb/query-compiler` — sqlcommenter query tagging SPEC

> A trailing `/* ... */` tag on a compiled statement, a closed key set, and escaping
> rules that make a comment terminator unrepresentable rather than merely unlikely
> (epic #578, sub-issue #579). Frozen before code.

The spans and metrics this tag correlates with are `../../../web/src/observability/SPEC.md`.
This file is the string: what goes in it, how it is escaped, where it sits, and why it is
off unless somebody asks for it.

## 1. Why this is a security spec and not a formatting spec

Everything else in this epic is telemetry, where the failure mode is a bad dashboard. This
is the one part where the failure mode is SQL injection in generated SQL. A value that can
close the comment early turns the remainder of the tag into statement text, on a statement
the application built and trusts, from a value that may be `ctx.path`.

At freeze time, `docs-site/content/sql-comments.md` already carried the warning but not a
correct serializer. Section 3 records why the obvious one was wrong.

## 2. The format and the closed key set

sqlcommenter: `key='value'` pairs, comma-separated, keys sorted, inside a trailing
`/* */`. For a `GET /users/:id` handled by `UsersController.get`:

```sql
SELECT "id", "email" FROM "users" WHERE "id" = $1 /*action='get',controller='UsersController',framework='zmdb%3A0.1.0',route='%2Fusers%2F%3Aid',traceparent='00-4bf92f...-00f067...-01'*/
```

Keys are sorted so that the same request produces the same string, which is what makes the
statement text stable enough to appear as one entry in `pg_stat_statements` rather than one
per key ordering — the same reason `docs-site/content/web-observability.md` sorts metric
labels.

The key set is closed:

```ts
export type CommentKey = 'traceparent' | 'controller' | 'action' | 'route' | 'framework';
```

**There is no arbitrary key/value form, and rejecting `Record<string, string>` is the
central decision of this file.** An open record is the interface through which a request id
gets tagged and the plan cache dies (§5), and through which a caller-supplied string reaches
comment text without passing anything that knows to escape it. Because the configuration is
a `CommentKey`-keyed structure rather than a string, **there is no path from a caller to
comment text at all** — step 10's "no caller-supplied string reaches the comment unencoded"
is a property of the type rather than a rule a reviewer enforces. The values come from the
router (`route`, `controller`, `action`), the tracer (`traceparent`) and the package's own
version (`framework`).

sqlcommenter also standardises `application` and `db_driver`. Both are omitted: `framework`
is `zmdb:<version>` and covers what `db_driver` is for, and `application` is a constant
string that belongs in the connection's `application_name`, where it costs no statement-text
uniqueness at all.

## 3. Escaping, and the bug on the docs page

Two facts, both verified with `node`, and the second one is a live bug:

**`encodeURIComponent('*/')` is `'*%2F'`.** The `/` is what makes a comment terminator
unrepresentable — `*` is in `encodeURIComponent`'s unreserved set and passes through
untouched. Worth stating explicitly, because a "sanitizer" that strips `*` would look like
it addressed the warning and would have done nothing.

**`encodeURIComponent("o'brien")` is `"o'brien"`.** The apostrophe is unreserved and
survives. So `sql-comments.md`'s

```ts
.map(([k, v]) => `${k}='${encodeURIComponent(v)}'`)
```

is wrong: a value containing an apostrophe closes its own quote, and the remainder of the
tag is no longer inside a quoted value. It is not exploitable as written — the value there
is `ctx.path`, and a path containing `'` still cannot produce `*/` — but the escaping is
one key away from being load-bearing, and the page presents it as the pattern to copy.

sqlcommenter's rule, and the frozen one:

```ts
const encode = (s: string): string => encodeURIComponent(s).replace(/'/g, "\\'");
```

Encode first, then escape the surviving apostrophe as `\'`. That order matters and the
result is unambiguous, because `encodeURIComponent('\\')` is `'%5C'` — every backslash in the
input becomes `%5C`, so **the only backslash in a serialized value is the escaper's own.**
There is no double-escaping question and no ambiguity for a reader parsing the tag back out.

The full serializer, with its verified output:

```ts
const serialize = (pairs: Readonly<Partial<Record<CommentKey, string>>>): string =>
  Object.keys(pairs)
    .sort()
    .map(k => `${encode(k)}='${encode(pairs[k as CommentKey] as string)}'`)
    .join(',');
```

```
input   { route: "/users/:id", controller: "o'brien*/DROP", action: 'list', traceparent: '00-abc-def-01' }
output  action='list',controller='o\'brien*%2FDROP',route='%2Fusers%2F%3Aid',traceparent='00-abc-def-01'
```

Verified: the output contains no `*/` and no unescaped `'`.

Keys go through `encode` as well, although a value drawn from a five-member string literal
union cannot contain anything that needs it. The encode costs nothing on a path that is
already building a string, and it means a sixth key added later by somebody who has not read
this section is still safe. A guarantee that depends on the key set staying closed is a
guarantee with a maintenance requirement; this one does not have it.

## 4. Placement: trailing

Trailing, per step 11, for three reasons in increasing order of how annoying they are to
discover:

1. Some proxies and MySQL client configurations strip a leading comment. A tag that does not
   arrive is worse than no tag, because you believe you have one — the page's own caveat at
   `sql-comments.md`.
2. `text.startsWith('SELECT')` stays true, so existing snapshot assertions, `EXPLAIN`
   prefixing and anything that inspects the first token keeps working.
3. A leading comment breaks the operation-name extraction on
   `web-observability.md` — `/^\s*(\w+)/` returns nothing for `/*tag*/ SELECT`, so every
   database metric in the application silently relabels to `other`. This is what a
   self-inflicted telemetry bug looks like: turning on tracing degrades metrics.
   `../../../web/src/observability/SPEC.md` §5 removes that regex, but the same shape of
   assumption exists in every APM tool and slow-query parser that reads the first word.

The page's own note that a trailing comment can confuse tooling appending its own `LIMIT` is
real and narrower: that tooling is a proxy rewriting statements, which has to parse SQL
properly anyway.

## 5. Off by default, and the one key that is a trade

**Comments in statement text defeat plan caching wherever the cache keys on the text**, which
is server-side prepared statements on Postgres and `pg_stat_statements` normalisation. A tag
that varies per statement produces one cache entry and one `pg_stat_statements` row per
variant, which is a slow memory problem in the database and turns the tool you added the tag
to read into a tool with thousands of near-duplicate rows. That is why this is off unless
`Observability.comments` is present, and it is stated plainly rather than as a caveat at the
bottom, because it is the reason for the default.

Four of the five keys are low cardinality — `route`, `controller`, `action` and `framework`
take one value per route per deploy, so the number of statement variants is bounded by the
route table and the tag is free in the sense that matters.

`traceparent` is the exception and it is the whole point of the feature. It is what turns
"this `SELECT` on `orders` is slow" into a link to the trace of the request that issued it,
closing the loop from `pg_stat_activity` to a waterfall, and it contains a fresh 16-byte span
id per query, so **every statement is unique**. There is no way to have both, and rather than
picking one the freeze names the trade and puts it in the caller's hands: `keys` is an
explicit list, `traceparent` is one of the things you can put in it, and putting it in is a
decision to trade the plan cache for the correlation. Diagnosing an incident is worth it; a
steady-state default is not. sqlcommenter's own documentation reaches the same conclusion.

## 6. The comment is rendered, not stored

The tag is applied by the driver decorator at execute time from `CompiledQuery.telemetry`
(`../../../web/src/observability/SPEC.md` §5) plus the request's `Ctx`. It is **not** a field
on `CompiledQuery`.

That answers the open question `sql-comments.md` raises — whether a comment counts as part
of a query's identity for the many existing tests that compare `CompiledQuery` with
`toEqual` — by removing it. A compiled query has no comment, so its identity is what it is
today, a compiled query can be cached and reused across requests that would tag it
differently, and the same statement compiled once can carry two different traceparents.
Storing the comment on the compiled query would make a per-request value part of a
per-route cached object, which is the sort of thing that works until the cache is enabled.

The driver decorator also fixed a smaller bug in the pre-implementation page's
example: it returned `{ execute }` and dropped `dialect`, so the wrapped driver
lost the field `Driver` declares and the repository reads to pick its dialect.
A decorator spreads the driver it wraps.

## 7. What #580 has to assert

1. `serialize` of a value containing `*/` produces text containing no `*/`, asserted on the
   substring rather than on an escaped form, so a different-but-correct encoding still passes
   and an incorrect one cannot.
2. `serialize` of a value containing `'` produces no unescaped `'`, and the escaped form is
   `\'` — the assertion `sql-comments.md`'s serializer fails.
3. A value containing a literal backslash round-trips: the output's only `\` is the
   apostrophe escaper's, verified by a value that is `\` alone becoming `%5C`.
4. Keys are sorted: two calls with the same pairs inserted in different orders produce
   identical strings.
5. Compile-time, in a `*.type-test.ts`: `keys: []` is rejected, and a key outside the five is
   rejected. There is no runtime assertion for an arbitrary key because there is no way to
   pass one.
6. The comment is trailing, and `text.startsWith` of the untagged statement's first token
   still holds on the tagged one.
7. `CompiledQuery` deep-equals its untagged self after a tagged driver has executed it — the
   assertion that §6's "rendered, not stored" is true.
8. One compiled query executed under two different traceparents produces two different
   statement texts, which is the property that makes reuse safe.
9. With `comments` absent, the statement text is byte-identical to today's.

## Non-goals (rejected)

- **`Record<string, string>` or any open key set** (§2). This is the one rejection the rest of
  the file depends on.
- **Stripping rather than encoding.** Removing `*/` from a value produces a tag that is
  wrong in a way nobody notices, where encoding produces one that is right.
- **A leading comment, or a configurable position** (§4). A position option means every
  consumer of the text has to handle both.
- **`traceparent` on by default** (§5).
- **`application` and `db_driver` keys** (§2).
- **A `comment` field on `CompiledQuery`, or a `.comment(s)` builder method** (§6) — which is
  what `sql-comments.md` proposes. A builder method makes the tag part of the query's
  identity and puts a per-request value in a per-route object.
- **Tagging by request id.** It is the highest-cardinality thing available, it is what
  `sql-comments.md` already tells you not to do, and `traceparent` is the version of it
  that at least links to something.
- **Reading the comment back out of a statement.** The tag is for the database's own tools;
  a parser for it in this package would be a second format definition to keep in step with
  sqlcommenter's.
