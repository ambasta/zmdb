# @zmdb/schema-core — Frozen Spec (Issue #11)

> Status: **FROZEN** for TDD. Implementation (#12–#15) must satisfy this spec.
> Targets: Node 26+, ESM-only, TypeScript 7 semantics (tests run under TS 5.9 today).

## 1. Column builders

Every builder is a zero-argument (or fixed-argument) function returning a **frozen
column metadata object**. Builders never mutate shared state.

| Builder | `type` | Default flags |
|---------|--------|---------------|
| `serial()` | `'serial'` | `{ autoIncrement: true, primaryKey: false, nullable: false, hasDefault: true }` |
| `integer()` | `'integer'` | `{ nullable: false }` |
| `bigint()` | `'bigint'` | `{ nullable: false }` |
| `numeric()` | `'numeric'` | `{ nullable: false }` |
| `text()` | `'text'` | `{ nullable: false }` |
| `varchar(n)` | `'varchar'` | `{ nullable: false, length: n }` |
| `boolean()` | `'boolean'` | `{ nullable: false }` |
| `timestamp()` | `'timestamp'` | `{ nullable: false }` |
| `json()` | `'json'` | `{ nullable: false }` |
| `jsonEnum(values)` | `'jsonEnum'` | `{ nullable: false, enum: values }` |

### Metadata object shape

```ts
interface ColumnMeta {
  readonly type: SqlType;              // one of the `type` strings above
  readonly flags: {
    readonly nullable: boolean;
    readonly primaryKey?: boolean;
    readonly unique?: boolean;
    readonly autoIncrement?: boolean;
    readonly hasDefault?: boolean;
    readonly length?: number;          // varchar only
    readonly enum?: readonly string[]; // jsonEnum only
  };
  readonly default?: unknown;
  readonly references?: { readonly target: string };
  readonly validation?: readonly ValidationRule[];
}
```

`serial()` defaults `nullable:false` and is treated as auto-increment + has-default
(so it is stripped from `CreateDTO`).

## 2. Modifiers

Each modifier is a **pure function** `(col: ColumnMeta, ...args) => ColumnMeta`
returning a **new frozen object**. Chaining is order-independent for flag-setting
modifiers. The input object is never mutated.

| Modifier | Effect |
|----------|--------|
| `notNull(col)` | `flags.nullable = false` |
| `nullable(col)` | `flags.nullable = true` |
| `primaryKey(col)` | `flags.primaryKey = true` |
| `unique(col)` | `flags.unique = true` |
| `references(col, target)` | `references = { target }` |
| `defaultTo(col, value)` | `default = value`, `flags.hasDefault = true` |
| `validate(col, rule)` | append `rule` to `validation[]` |

A fluent wrapper is also exposed so builders can be chained method-style:
`serial().primaryKey()`, `text().notNull().validate(rule)`. Method-style and
function-style MUST produce deep-equal metadata.

## 3. `defineSchema`

```ts
function defineSchema<T extends string>(
  table: T,
  columns: Record<string, ColumnMeta>,
): CoreSchema<T>;
```

`CoreSchema<T>` shape (frozen):

```ts
interface CoreSchema<T extends string> {
  readonly table: T;
  readonly columns: Readonly<Record<string, ColumnMeta>>;
  readonly primaryKey: readonly string[];   // derived from flags.primaryKey
  readonly references: readonly { readonly column: string; readonly target: string }[];
}
```

Rules:
- `primaryKey` is derived by scanning columns where `flags.primaryKey === true`.
- Throws `SchemaError` if **zero** primary keys.
- Throws `SchemaError` if a `serial()` column is not marked primary and no other PK exists (documented; enforced in #15).
- `references` is derived from columns carrying a `references` metadata entry.
- The returned object and nested `columns` are deeply frozen.

## 4. Type derivation (compile-time only)

```ts
type Entity<S extends CoreSchema<string>>    // full row type
type CreateDTO<S extends CoreSchema<string>> // omit autoIncrement; hasDefault → optional
type UpdateDTO<S extends CoreSchema<string>> // Partial<CreateDTO<S>>
```

- `Entity`: every column mapped to its TS type; `nullable` columns become `| null`.
- `CreateDTO`: columns with `flags.autoIncrement` are omitted; columns with
  `flags.hasDefault` become optional.
- `UpdateDTO`: `Partial<CreateDTO<S>>`.

TS type mapping: serial/integer→`number`, bigint→`bigint`, numeric→`number`,
text/varchar→`string`, boolean→`boolean`, timestamp→`Date`, json→`unknown`,
jsonEnum→union of the enum literals.

## 5. Non-goals / anti-patterns (rejected)

- No runtime reflection, no proxies, no decorators-required API.
- No mutation of column objects after creation (immutability enforced by `Object.freeze`).
