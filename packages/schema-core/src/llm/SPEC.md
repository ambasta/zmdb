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

## 1. What the document contains, which decides every question below

One function emits every keyword a zmdb tool spec can contain: `jsonSchemaForColumn` in `../ir/index.ts`.
It is worth reading before reasoning about providers, because what it emits is much smaller than what JSON
Schema can say:

| Column                     | Emitted keywords                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `serial`, `integer`        | `type: 'integer'`                                                                       |
| `bigint`                   | `type: 'integer'`, `format: 'int64'`                                                    |
| `numeric`                  | `type: 'number'`                                                                        |
| `text`, `varchar`          | `type: 'string'`, `maxLength` when the varchar has a length                             |
| `boolean`                  | `type: 'boolean'`                                                                       |
| `timestamp`                | `type: 'string'`, `format: 'date-time'`                                                 |
| `jsonEnum`                 | `type: 'string'`, `enum`                                                                |
| `json`                     | **nothing at all** — `{}`                                                               |
| any of the above           | `minimum`, `maximum`, `minLength`, `maxLength`, `pattern` from the column's constraints |
| `WireAs<W>` scalar         | the wire scalar's `type`, and its `format` when it declares one                         |
| `WireAs<W>` literal union  | `enum`                                                                                  |
| nullable, any of the above | the `type` becomes `[T, 'null']`                                                        |

And the document that wraps them is `{ type: 'object', properties, required }` — `JsonSchemaObject` at
`../ir/index.ts:512`, three members, all required, all `readonly`.

So a zmdb tool spec is **exactly one level deep**, with scalar leaves. There is no `items`, no nested
`properties`, no `$ref`, no `$defs`, no `oneOf`/`anyOf`/`allOf`, no `additionalProperties`, no
`description` on a property, and no recursion. That is not an accident to be fixed later — a tool spec is
derived from a table, and a table's columns are scalars.

**Which makes step 3 of the issue wrong about the casualties.** It expects discriminated unions and
recursive types to be what Gemini cannot express, and names them as the likely losses. Neither is
expressible here on _any_ provider: a `json` column produces `{}`, and a union of string literals produces
an `enum`. Every provider limit on nesting depth, property count, `$ref`, recursion or definition reuse is
unreachable by construction. What is left, once that is established, is four keywords:

| The whole question | Where it comes from                    | Who has a problem with it         |
| ------------------ | -------------------------------------- | --------------------------------- |
| `{}`               | a `json` column, or a rich `WireAs<W>` | `openai-strict`, `gemini`         |
| `type: [T,'null']` | any nullable column                    | `gemini`                          |
| `format: 'int64'`  | a `bigint` column                      | `openai-strict`                   |
| `required`         | "not optional and not nullable"        | `openai-strict` wants all of them |

The rest of this section is those four rows, argued.

## 2. The four, provider by provider

| Keyword                | `json-schema` | `openai`   | `openai-strict`                              | `anthropic` | `gemini`                                                |
| ---------------------- | ------------- | ---------- | -------------------------------------------- | ----------- | ------------------------------------------------------- |
| `type` (single)        | as emitted    | pass       | pass                                         | pass        | pass                                                    |
| `type: [T,'null']`     | as emitted    | pass       | pass — it is how strict mode spells optional | pass        | **translated** to a single `type` plus `nullable: true` |
| `format: 'date-time'`  | as emitted    | pass       | pass                                         | pass        | pass                                                    |
| `format: 'int64'`      | as emitted    | pass       | **dropped**                                  | pass        | pass                                                    |
| `enum`                 | as emitted    | pass       | pass                                         | pass        | pass                                                    |
| `minimum` … `pattern`  | as emitted    | pass       | pass                                         | pass        | pass                                                    |
| `{}` (no `type`)       | as emitted    | pass       | **refused**                                  | pass        | **refused**                                             |
| `required`             | as emitted    | as emitted | **every property**                           | as emitted  | as emitted                                              |
| `additionalProperties` | absent        | absent     | **`false`, added**                           | absent      | absent                                                  |

Three of those cells are worth their own sentence.

**`format: 'int64'` is dropped for `openai-strict` and kept for `gemini`**, which is the clearest example of
why one document cannot serve every provider. Strict mode publishes the keywords it accepts and integer
`format` is not among them; Gemini's schema documents `int32` and `int64` for an integer. Dropping it is
lossless: JSON Schema `format` is an annotation, and nothing a model can produce is rejected by `int64` that
`type: 'integer'` accepts.

**`{}` is a refusal and not a translation, on the two providers that require every property to have a
type.** There is no honest substitute. `type: 'object'` with no properties would tell the model the value is
an object when a `json` column holds anything JSON can hold; `type: 'string'` would be a lie the validator
then rejects. So the tool spec is refused, by column name, with the reformulation that works: declare the
payload's shape with `WireAs<W>` — which is exactly the case `declaredWireKeywords` exists for — or omit the
column from the tool. This is the one construct in zmdb that a provider genuinely cannot take, and it is a
column kind rather than a type-system feature.

**`gemini` translating a nullable type is a translation and not a refusal**, because OpenAPI 3.0 — the
dialect Gemini's schema is a subset of — has no type arrays and does have `nullable`. The information
survives exactly; only the spelling changes.

### 2.1 These rows are vendor data, and the spec says so

Every "pass", "dropped" and "refused" above describes somebody else's API, which changes on their schedule
and not ours. Two rules follow, and they are what keep this section from rotting into confidently wrong
documentation:

1. The allowed keyword set per provider lives in **one table in one module**, each entry carrying the vendor
   document it came from and the date it was read. A provider changing its mind is a one-line edit.
2. The tests assert the **mechanism**, not the vendor's list: that a keyword outside the set is dropped or
   refused according to its row, that a refusal names the column and the provider, and that the resulting
   document contains no keyword the set does not allow. A test that hard-codes "Gemini rejects type arrays"
   would have to be rewritten the day Gemini stops; a test that asserts the translation happens for whatever
   the table says does not.

The numeric limits providers publish — property counts, nesting depth, enum sizes, total identifier length —
are recorded in that same table and are **structurally unreachable** for a schema-derived tool spec (§1): one
level, one object, one property per column. They are checked anyway, because a hand-passed schema could reach
them and a 400 from a provider is a worse place to learn it than a build.

## 3. Optionality, which is already conflated before a provider sees it

Two facts in `../ir/index.ts` decide this, and neither is a provider's fault:

- `required` is "not optional **and** not nullable" (`jsonSchemaFromShape`): a nullable column is never
  required, because `null` is admissible for it and demanding the key adds nothing a validator can act on.
- Nullable widens the `type` keyword to `[T, 'null']` (`nullableType`), and a column with no `type` — a
  `json` column — is left alone, so its nullability is not expressed at all.

So by the time a provider dialect runs, "optional" and "nullable" have already collapsed into one bit for
`required` and a second, differently-derived bit for `type`. The mapping table has to be read with that in
mind: the input is not "optional or nullable", it is what the emitter already decided.

| Column is…             | Emitted document                | `openai` / `anthropic` / `json-schema` | `openai-strict`                                            | `gemini`                                                                          |
| ---------------------- | ------------------------------- | -------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| neither                | in `required`, `type: T`        | as emitted                             | in `required`, `type: T`                                   | in `required`, `type: T`                                                          |
| nullable, not optional | not in `required`, `[T,'null']` | as emitted                             | **in `required`**, `[T,'null']`                            | in `required` unchanged? **no** — not in `required`, `type: T` + `nullable: true` |
| optional, not nullable | not in `required`, `type: T`    | as emitted                             | **in `required`**, and the type is widened to `[T,'null']` | not in `required`, `type: T`                                                      |
| both                   | not in `required`, `[T,'null']` | as emitted                             | **in `required`**, `[T,'null']`                            | not in `required`, `type: T` + `nullable: true`                                   |

The one row that changes meaning is the third, and it is frozen deliberately: **for `openai-strict`, an
optional non-nullable column is emitted as nullable.** Strict mode requires every property in `required` and
documents a nullable union as the way to say "may be absent", so there are exactly two options — widen the
type, or drop the column from the spec entirely. Dropping it changes what the model is allowed to fill in,
which is a worse lie than a type that admits a value the app would then reject. It is written down here
because a reader comparing `toolFor('openai-strict', …)` with `toolFor('anthropic', …)` will see a type they
did not declare, and the answer must not be "some provider quirk".

`gemini` keeps zmdb's `required` rule unchanged and adds `nullable: true`, so nothing is widened there.

## 4. The refusal, the diagnostic, and when it happens

The refusal list is short, because §1 made it short:

| Provider        | Construct                                                 | Reformulation offered                                    |
| --------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `openai-strict` | a column whose document is `{}`                           | declare the payload with `WireAs<W>`, or omit the column |
| `gemini`        | a column whose document is `{}`                           | the same                                                 |
| any             | a schema whose `create` variant has no visible properties | drop the tool, or unmark a `Sensitive` column            |

**`EmitDiagnostic` is not reused, and the instruction to reuse it is refused on the dependency graph.**
`EmitDiagnostic` is declared in `@zmdb/aot-validator/emit`. `@zmdb/aot-validator` lists `@zmdb/schema-core`
in its `dependencies`; `@zmdb/schema-core` lists `@zmdb/aot-validator` only in `devDependencies`. A runtime
module of this package importing from that one is a cycle and a devDependency at runtime, and it would be the
first. It also has three fields — `path`, `reason`, `source?` — where this needs the provider and the
construct as well. Frozen instead:

```ts
export interface ToolSpecRefusal {
  readonly provider: ToolProvider;
  readonly path: string; // the column, as a property path
  readonly construct: string; // what could not be expressed, in zmdb's vocabulary
  readonly reason: string;
  readonly suggestion: string;
}
```

`path` and `reason` are named identically to `EmitDiagnostic`'s on purpose: a reader who knows one knows the
other, and the shape is the thing worth sharing when the type cannot be.

**It does not happen at AOT time, and step 4 is wrong about that.** `toolFor(provider, name, schema, opts)`
takes a schema _value_ and a provider _string_; `P` is inferred from an argument. The transform reads **type**
arguments — `CALLEES` is eight names and a call site's type argument is what the reflector reads — so
`toolFor` cannot join that list, and there would be nothing for it to do if it did. Frozen: `toolFor` throws
a `ToolSpecRefusal`-carrying error at the call, which for a tool registry built at module scope is startup
rather than first request.

Two build-time routes were considered. `toolFor<'gemini', CreateDTO<Order>>()` — provider as a type argument —
_is_ transformable, and is refused because a provider is a runtime configuration value in any app that
supports more than one model, and forcing it into a type argument makes the common case unwritable. A `check`
finding is the other, and is left to the CLI epic: it needs the declaration set, which `check` already reads,
and it is additive rather than a change of shape.

What the transform already does is the part worth keeping: `toJsonSchema<CreateDTO<Order>>()` is inlined to a
frozen literal, and a provider framing is a pure function of that literal.

## 5. `toolFor`, `ToolSpecFor`, and what `toolFromSchema` becomes

```ts
export type ToolProvider = 'openai' | 'openai-strict' | 'anthropic' | 'gemini' | 'json-schema';

export interface ToolSpecFor {
  readonly openai: { type: 'function'; function: { name: string; description?: string; parameters: JsonSchemaObject } };
  readonly 'openai-strict': {
    type: 'function';
    function: { name: string; description?: string; strict: true; parameters: StrictJsonSchemaObject };
  };
  readonly anthropic: { name: string; description?: string; input_schema: JsonSchemaObject };
  readonly gemini: { name: string; description?: string; parameters: GeminiSchemaObject };
  readonly 'json-schema': ToolSpec;
}

export declare function toolFor<P extends ToolProvider>(
  provider: P,
  name: string,
  schema: CoreSchema<string>,
  opts?: { description?: string },
): ToolSpecFor[P];
```

Three departures from the issue's block, all of them the same departure:

- **`parameters: object` becomes a named type**, because `object` says nothing and this is the value a
  provider will reject. Where the document passes through unchanged it is `JsonSchemaObject`, which is the
  type `toJsonSchema` already returns.
- **`openai-strict` gets its own type, and `JsonSchemaObject` is not widened to accommodate it.**
  `JsonSchemaObject` has exactly three members and no optional ones, and the golden suites assert emitted
  documents byte for byte; adding an optional `additionalProperties` would let a document that is not the
  golden one typecheck, in the interface every other consumer reads. `StrictJsonSchemaObject` declares the
  three plus `additionalProperties: false`, and `GeminiSchemaObject` declares the OpenAPI-3.0 spelling. Three
  types because there are three documents.
- **`toolFromSchema` stays, and is `toolFor('json-schema', …)`.** It is published, the docs pages use it, and
  `ToolSpec` is the name in them. It is not deprecated and not reimplemented: one of the two is a call to the
  other.

`toolFor` never re-derives a document. It calls `toJsonSchema(schema, 'create')` — the same `create` variant
`toolFromSchema` uses, because a tool call is an input — and then reframes and translates. One producer, five
framings, which is the same rule §2.9 of `ARCHITECTURE.md` applies to the transform.

## 6. What the three pages have to change

Owned by the docs slice; both adapter pages and the strategy page stay `todo` until the epic closes.

1. _Done._ `llm-langchain.md` routed the document through `json-schema-to-zod` and then admitted the
   conversion was lossy. It now passes the document to `DynamicStructuredTool` directly, and names what the
   conversion was dropping — `format`, and `{}` becoming `z.any()`. The adapter removes the remaining glue
   (`adapters/SPEC.md` §3).
2. _Done._ `llm-vercel-ai-sdk.md` passed `parameters:` to `tool()`, which is the pre-v5 key; v5 calls it
   `inputSchema`. It also passed `toJsonSchema(...)` straight into `jsonSchema<T>()`, and
   `JsonSchemaObject.properties` is a `Readonly<Record<string, unknown>>` — not assignable to a mutable index
   signature of JSON-Schema nodes, so that line did not compile. The page now shows the one cast and says why
   it is unavoidable by hand; the adapter is where that cast moves to (`adapters/SPEC.md` §4). The same pass
   fixed two more v4 names on that page, `toDataStreamResponse` and `usage.completionTokens`.
3. `llm-strategy.md`'s "no provider wrapper, call the API with `fetch`" is still the position and does not
   change — `toolFor` emits a document, it does not make a request. The page should say that explicitly, since
   a per-provider tool spec looks like the first half of a provider abstraction and is not.
4. Both adapter pages open with "no tool adapter" in the ToDo banner. When #526 lands, that clause is false
   and the remaining gaps are the retriever, the memory backend and the `useChat` store — which are what the
   banners should then say, rather than being deleted. A banner that overstates the gap sends a reader off to
   write something that exists.
5. `tests/api-coverage/mapping.mjs` cites one test title for four typia entries — `llm.schema`,
   `llm.parameters`, `llm.application` and `llm.structuredOutput` all point at "produces a schema an LLM tool
   call can be validated against". With five providers there are five documents to assert, so those entries
   get distinct titles when the tests land. Two justifications there were checked and **survive**:
   `llm.controller`'s, because an adapter returns a tool object the application passes to the framework and
   the framework dispatches (zmdb still decides nothing about which function a model may invoke), and
   `NO_FACTORY_FORM`, because nothing here hands back a validator closure — the adapter's handler calls an
   inlined `assert` at its own call site.
