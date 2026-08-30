# JSON Schema / OpenAPI Generation — Frozen Spec (Issue #63)

> Status: **FROZEN** for TDD. Implementation (#64–#67) must satisfy this spec.
> Part of `@zmdb/schema-core` (module `src/openapi/`). Build-time only, no runtime reflection.
> Targets: Node 26+, ESM, TS 7. JSON Schema draft 2020-12 / OpenAPI 3.1.

## 1. toJsonSchema(schema, variant?)

```ts
type Variant = 'entity' | 'create' | 'update';           // default 'entity'
function toJsonSchema(schema: CoreSchema<string>, variant?: Variant): JsonSchemaObject;
```

Emits a draft 2020-12 object schema. Output keys are **stably ordered**
(alphabetical within `properties`; `required` sorted) so documents are diffable.

### Read variants (#173/#174/#175)

The variant set is extended for the read/query DTO family:

```ts
type Variant = 'entity' | 'create' | 'update' | 'get' | 'list' | 'search';
```

- `get` → the entity response schema (same shape as `entity`).
- `list` → an envelope `{ items: { type:'array', items: entity }, total?: integer,
  hasMore: boolean, cursor?: string }` via `toListSchema(schema)`.
- `search` → `list` whose item schema also carries an optional `_score` number,
  via `toSearchSchema(schema)`.
- Deterministic key ordering; build-time only; no runtime reflection.

## 2. Column type → JSON Schema mapping

| Column type | JSON Schema |
|-------------|-------------|
| serial / integer | `{ "type": "integer" }` |
| bigint | `{ "type": "integer", "format": "int64" }` |
| numeric | `{ "type": "number" }` |
| text / varchar | `{ "type": "string" }` (varchar adds `maxLength` from `length`) |
| boolean | `{ "type": "boolean" }` |
| timestamp | `{ "type": "string", "format": "date-time" }` |
| json | `{}` (any) |
| jsonEnum(values) | `{ "type": "string", "enum": values }` |

Nullable columns → `{ "type": ["<t>", "null"] }`.

## 3. Validation tag → keyword mapping

| Tag | Keyword |
|-----|---------|
| `Minimum(n)` | `minimum: n` |
| `Maximum(n)` | `maximum: n` |
| `MinLength(n)` | `minLength: n` |
| `MaxLength(n)` | `maxLength: n` |
| `Pattern(re)` | `pattern: re` |
| `Enum(...v)` | `enum: v` |

## 4. Variant rules (DTO-aware)

- `entity`: all columns; `required` = non-nullable columns.
- `create`: omit `autoIncrement` columns; `hasDefault` columns are **optional**
  (excluded from `required`).
- `update`: like `create` but `required` is `[]` (all optional).

## 5. Relations → $ref

- to-one (`many-to-one`/`one-to-one`) → `{ "$ref": "#/components/schemas/<Target>" }`.
- to-many (`one-to-many`/`many-to-many`) → `{ "type": "array", "items": { "$ref": … } }`.

## 6. toOpenApiComponents(schemas)

```ts
function toOpenApiComponents(schemas: readonly CoreSchema<string>[]): {
  schemas: Record<string, JsonSchemaObject>;
};
```

Builds `components.schemas` keyed by PascalCase table name (`users` → `User`).
Deterministic: same input → byte-identical output.

## 7. Golden fixture (users)

```jsonc
// toJsonSchema(UserSchema, 'entity')
{
  "type": "object",
  "properties": {
    "createdAt": { "type": "string", "format": "date-time" },
    "email": { "type": "string", "pattern": "^[^@]+@[^@]+\\.[^@]+$" },
    "id": { "type": "integer" },
    "role": { "type": "string", "enum": ["admin", "user", "guest"] }
  },
  "required": ["createdAt", "email", "id", "role"]
}
```

## 8. Non-goals (rejected)

- Runtime reflection / decorator scanning. Server-introspection schema builds.
- Hand-written OpenAPI that can drift from the schema.
