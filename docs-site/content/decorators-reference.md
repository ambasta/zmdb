Every builder and modifier, in one place. Import from `@zmdb/schema-core` unless noted.

## Column types

| Builder                    | SQL (postgres / mysql / sqlite)             | TypeScript                                       |
| -------------------------- | ------------------------------------------- | ------------------------------------------------ |
| `serial()`                 | `SERIAL` / `INT AUTO_INCREMENT` / `INTEGER` | `number`                                         |
| `integer()`                | `INTEGER` / `INT` / `INTEGER`               | `number`                                         |
| `bigint()`                 | `BIGINT`                                    | `number` — see [bigint keys](./bigint-keys.html) |
| `numeric()`                | `NUMERIC` / `DECIMAL` / `NUMERIC`           | `number`                                         |
| `text()`                   | `TEXT`                                      | `string`                                         |
| `varchar(n)`               | `VARCHAR(n)`                                | `string`                                         |
| `boolean()`                | `BOOLEAN` / `TINYINT(1)` / `INTEGER`        | `boolean`                                        |
| `timestamp()`              | `TIMESTAMP` / `DATETIME` / `TEXT`           | `Date`                                           |
| `json<T>()`                | `JSONB` / `JSON` / `TEXT`                   | `T`                                              |
| `jsonEnum([...] as const)` | as `json`                                   | the union of the members                         |

That is the whole set. Anything else — `uuid`, `date`, `interval`, `inet`, arrays, `vector` — is a [custom type](./custom-types.html) or a `json` column. See [Column Types](./column-types.html) for the reasoning.

## Modifiers

Chainable on any column, and each one changes the column's _type_, which is how the DTOs stay correct.

| Modifier          | Effect on the derived types                              |
| ----------------- | -------------------------------------------------------- |
| `.notNull()`      | removes `\| null` from `Entity`; required in `CreateDTO` |
| `.nullable()`     | adds `\| null`; optional in `CreateDTO`                  |
| `.primaryKey()`   | marks the key `findById` / `update` / `delete` use       |
| `.unique()`       | `UNIQUE` in the DDL                                      |
| `.defaultTo(v)`   | optional in `CreateDTO`; `v` is written into the DDL     |
| `.validate(rule)` | recorded on the column; feeds JSON Schema and OpenAPI    |
| `.sensitive()`    | excluded from serialization and from OpenAPI             |

Functional forms exist for all of them and compose the same way: `notNull(col)`, `nullable(col)`, `primaryKey(col)`, `unique(col)`, `defaultTo(col, v)`, `validate(col, rule)`, `sensitive(col)`.

```ts
email: text().notNull().unique().validate({ kind: 'pattern', value: '^[^@]+@[^@]+$' }),
```

> [!NOTE]
> `.defaultTo('now()')` writes the string `now()` into the DDL as a SQL expression. It is not evaluated by zmdb. See [Timestamp defaults](./guide-timestamp-defaults.html).

## Foreign keys

`references` is a **function**, not a chained modifier, because it takes the target schema:

```ts
import { references, integer } from '@zmdb/schema-core';

authorId: references(integer(), authors, 'id').notNull(),   // checked against authors.id
authorId: references(integer(), 'authors.id').notNull(),    // by name, unchecked
```

The three-argument form type-checks that the local column's TypeScript type matches the target column's. A mismatch resolves to `{ __error: 'Referenced column type does not match' }`, which fails at the `defineSchema` call.

## Validation rules

`ValidationRule` is `{ kind: string; value?: unknown; message?: string }`. Recognised kinds feed the JSON Schema output:

```ts
.validate({ kind: 'pattern', value: '^[A-Z]{2}$', message: 'Two capitals' })
.validate({ kind: 'minLength', value: 3 })
.validate({ kind: 'maximum', value: 120 })
```

> [!WARNING]
> Validation rules are metadata: they shape the JSON Schema, the OpenAPI document and the [seed generator](./seed-functions.html). The repository's write path checks _types_ against the column, not rules. Enforce rules at the HTTP boundary with [`assert`](./validators-assert.html), where the failure becomes a 400 instead of a partially-applied write.

## `defineSchema`

```ts
defineSchema(table: string, columns: ColumnsMap, options?: SchemaOptions): CoreSchema
```

`SchemaOptions` currently carries one field, `ftsTable`, which opts the schema into [full-text search](./full-text-search.html).

Schemas register themselves; `getRegisteredSchema(table)` and `registeredSchemas()` read the registry, which is what the migration snapshotter and OpenAPI component builder use.

## Relations

From `@zmdb/schema-core/relations`:

```ts
manyToOne(target, fkColumn);
oneToMany(target, fkColumn); // fk lives on the target
oneToOne(target, fkColumn);
manyToMany(target, { through, sourceColumn, targetColumn });
```

See [Relations](./relations.html).

## Web decorators

From `@zmdb/web`, and the only decorators in the project:

| Decorator                                | Module     | Records                                  |
| ---------------------------------------- | ---------- | ---------------------------------------- |
| `@Controller(prefix)`                    | `routing`  | route prefix                             |
| `@Get` `@Post` `@Put` `@Patch` `@Delete` | `routing`  | method + path                            |
| `@Module(def)`                           | `modules`  | controllers, providers, imports, exports |
| `@Inject(token)`                         | `di`       | constructor parameter token              |
| `@Gateway(namespace)`                    | `gateways` | gateway namespace                        |
| `@Subscribe(event)`                      | `gateways` | message handler                          |

None of them read runtime type metadata. There is no `@Injectable()`, no `@Body()`, no `@Param()`: the handler receives one typed `Ctx`. See [Architecture](./architecture.html).

---

See also: [Schema Declaration](./schema-declaration.html) · [Column Types](./column-types.html) · [Type Derivation](./type-derivation.html)
