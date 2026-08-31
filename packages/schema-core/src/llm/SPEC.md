# SPEC — LLM function-calling harness (frozen)

Part of `@zmdb/schema-core`. Turn a schema into an LLM tool/parameter schema and
leniently parse+validate model output. Reuses the OpenAPI generator + validators.
Epic #157.

## API

```ts
interface ToolSpec {
  name: string;
  description?: string;
  parameters: JsonSchemaObject;
}
function toolFromSchema<S>(name: string, schema: S, opts?: { description?: string }): ToolSpec;

interface ParseResult<T> {
  success: boolean;
  data?: T;
  errors?: readonly string[];
}
function lenientParse<T = unknown>(text: string, coerce?: (v: unknown) => T): ParseResult<T>;
```

## Frozen behavior

- `toolFromSchema(name, schema)` returns `{ name, description?, parameters }`
  where `parameters` is the schema's `create`-variant JSON Schema (input shape).
- `lenientParse(text)`:
  - strips Markdown code fences (`json … `) before parsing,
  - tolerates trailing commas is **not** attempted; only fence-stripping + a
    plain `JSON.parse`,
  - on parse failure returns `{ success:false, errors:[msg] }`,
  - applies `coerce` when provided; a throwing coerce ⇒ `success:false`.
- Deterministic; build-time schema generation + runtime lenient parse.
