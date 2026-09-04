Short, task-shaped answers to things people actually search for. Each one is a working snippet against the real API, plus the reason it is written that way.

## Querying

|                                                           |                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| [Conditional filters](./guide-conditional-filters.html)   | Building a `where` from optional inputs without dropping `0` and `''` |
| [Count rows](./guide-count-rows.html)                     | `hasMore` is free, a total is not, and `aggregate` is how you get one |
| [Cursor-based pagination](./guide-cursor-pagination.html) | Keyset pagination, and why `OFFSET` gets slower                       |
| [`EXISTS` subqueries](./guide-exists-subquery.html)       | `whereExists` and correlated subqueries                               |
| [Dynamic queries](./dynamic-queries.html)                 | Composing a builder across functions                                  |

## Writing

|                                                           |                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| [Increment / decrement](./guide-increment-decrement.html) | **ToDo** — compiler support exists; repository integration remains |
| [Toggle a boolean](./guide-toggle-boolean.html)           | **ToDo** — same repository blocker                                 |
| [Bulk update](./guide-bulk-update.html)                   | **ToDo** — one statement per row today                             |
| [Upsert](./upsert.html)                                   | **ToDo** — no `ON CONFLICT`                                        |

Increment and toggle now have a closed expression vocabulary in `UpdateBuilder.set()`, while repository
validation still accepts values only. Updating different rows to different values is a separate, wider
`CASE` / `VALUES` problem. Each page separates what the compiler can emit from the remaining typed
repository gap.

## Schema

|                                                                               |                                                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Array and JSON defaults](./guide-array-defaults.html)                        | `defaultTo` with a JSON value, and the shared-reference trap     |
| [Timestamp defaults](./guide-timestamp-defaults.html)                         | `now()` in the database versus `new Date()` in the process       |
| [Case-insensitive unique](./guide-case-insensitive-unique.html)               | Expression index on PostgreSQL/SQLite; generated column on MySQL |
| [Full-text search with generated columns](./guide-fts-generated-columns.html) | `tsvector` via `generatedColumnDdl`                              |
| [Vector search](./guide-vector-search.html)                                   | **ToDo** — `SqlType` has no vector                               |
| [PostGIS](./guide-postgis.html)                                               | **ToDo** — same                                                  |

## Local development

|                                               |                                                      |
| --------------------------------------------- | ---------------------------------------------------- |
| [Local Postgres](./guide-local-postgres.html) | Docker, `psql`, and a test database that resets fast |
| [Local MySQL](./guide-local-mysql.html)       | Same, plus the collation settings that matter        |
| [PGlite](./connect-pglite.html)               | Postgres in-process, for tests                       |

## The three facts behind most of these

Worth knowing before reading any individual page:

- **`Operator` is SQL, not an abbreviation.** `where('age', '>=', 18)`, not `'gte'`. The DTO form uses `{ age: { gte: 18 } }` — the two layers spell it differently, deliberately.
- **`References` is a tag, not a function.** `authorId: number & Sql<'integer'> & References<'users.id'>`. The target is a `table.column` string literal, so nothing has to be imported — and nothing cross-checks it either.
- **The builder is immutable.** Every `where`/`orderBy`/`limit` returns a new builder, so `b.where(...)` without reassigning does nothing.

---

See also: [Tutorials](./tutorials.html) · [Query Builder](./select.html) · [Gotchas](./gotchas.html)
