## The build-time boundary

A table declaration has two vocabularies:

```ts
interface ColumnIR {
  name: string; // TypeScript property and DTO key
  physicalName: string; // SQL identifier
}

interface SchemaIR {
  table: string; // declared table identity
  physicalTable: string; // SQL table identifier
}
```

The naming strategy runs while the AOT reflector creates this IR. It runs once per table and once per real column, then disappears. There is no query-time naming hook and no per-query strategy call:

- `Entity<T>`, `CreateDTO<T>`, JSON Schema, OpenAPI and validation use declared property names;
- DDL, snapshots, repository filters, ordering, grouping and writes use physical names;
- reads select `physical_name AS "propertyName"` when the two differ, so no JavaScript pass renames every returned row;
- raw SQL expressions and fragments are emitted byte-for-byte.

For `authorId → author_id` and `blogPost → blog_posts`, a repository query can therefore compile to:

```sql
SELECT "id", "author_id" AS "authorId"
FROM "blog_posts"
WHERE "author_id" = $1
```

The returned entity still has an `authorId` property.

## Built-in strategies

The public implementations live at `@zmdb/schema-core/naming`:

```ts
import { resolveNaming, snakeCase, snakeCasePlural } from '@zmdb/schema-core/naming';
```

`snakeCase` handles acronym and digit boundaries rather than inserting an underscore before every capital:

| Declared        | Physical        |
| --------------- | --------------- |
| `createdAt`     | `created_at`    |
| `HTTPStatus`    | `http_status`   |
| `id2`           | `id2`           |
| `userID`        | `user_id`       |
| `already_snake` | `already_snake` |

`snakeCasePlural` uses the same column conversion and pluralises the final table word: `userAccount → user_accounts`, `blogPost → blog_posts`, and `person → people`. The pluraliser is deliberately a
small deterministic rule set, not a linguistics package. Uninflected or ambiguous words such as `metadata`, `series`, and `species` stay unchanged; use a custom strategy for domain vocabulary outside
the built-in rules.

## Configure it once

```ts
// zmdb.config.ts
import { defineConfig } from 'zmdb/config';

export default defineConfig({
  schema: 'src/**/*.schema.ts',
  dialect: 'postgres',
  naming: 'snake_case_plural',
});
```

`loadConfig()` returns `resolvedNaming`, which is always a strategy object:

- the `snakeCase` or `snakeCasePlural` singleton for a named config;
- the custom `namingStrategy` object by identity;
- an empty identity strategy when neither field is present.

A custom object wins if both config fields are present:

```ts
export default defineConfig({
  schema: 'src/**/*.schema.ts',
  dialect: 'postgres',
  namingStrategy: {
    table: declared => `app_${declared.toLowerCase()}`,
    column: property => property.replaceAll(/[A-Z]/g, letter => `_${letter.toLowerCase()}`),
  },
});
```

Database commands, `zmdb-codegen`, and the umbrella build plugin all pass `resolvedNaming` into reflection automatically:

```ts
import { zmdbAot } from 'zmdb/unplugin';

const plugin = await zmdbAot();
```

The lower-level `@zmdb/aot-validator` APIs still accept an explicit `naming` option for tools that own config loading. The build plugin and `zmdb-codegen` resolve the same project config, so both emit
the same physical names.

## Explicit overrides

Import `Physical` from either documented tag subpath:

```ts
import type { Physical, PrimaryKey, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'userAccount'>, Physical<'legacy_users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'> & Physical<'created_ts'>;
}
```

The interface-level tag fixes the SQL table name at `legacy_users`; the property intersection fixes the SQL column at `created_ts`. Each explicit name is resolved before the configured strategy, so
the corresponding strategy callback is not invoked. The declared table identity remains `userAccount`, and the returned entity property remains `createdAt`.

## Sharp edges

A collision is a build diagnostic, not a query-time surprise. For example, `createdAt` and `created_at` both become `created_at` under `snake_case`, so the diagnostic names both properties and the
physical name they share.

Raw SQL is never rewritten. A partial-index predicate written as `createdAt IS NOT NULL` remains exactly that string; write the physical `created_at` identifier yourself.

Turning on or changing a strategy under an existing database changes snapshot names. A diff cannot safely guess whether `createdAt → created_at` is a rename or a drop plus add, so review and author
the rename migration explicitly.

---

See also: [Schema Declaration](./schema-declaration.html) · [Configuration](./config-file.html) · [Migrations](./migrations.html)
