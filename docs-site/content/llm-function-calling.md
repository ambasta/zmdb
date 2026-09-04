> **Install:** `npm add @zmdb/ai@alpha @zmdb/schema-core@alpha @zmdb/aot-validator@alpha`. Provider document dialects live in `@zmdb/ai`; that package has no provider SDK or framework peer.

zmdb derives a tool's input document from the table's `create` shape. Use `toolFor` when you know the target provider; it applies that provider's framing and schema rules before the document is
inlined.

## Generate the provider shape directly

<!-- snippet: llm-function-calling.ts#snippet-1 -->

The normal [AOT setup](./aot-setup.html) replaces that call with a frozen document. `Serial` fields are absent from the create shape, `Sensitive` fields are omitted, and validation tags remain JSON
Schema constraints.

Each target has its own top-level shape:

| Target          | Result                                                         |
| --------------- | -------------------------------------------------------------- |
| `openai`        | `{ type: 'function', function: { name, parameters } }`         |
| `openai-strict` | the OpenAI shape plus `strict: true` and a strict document     |
| `anthropic`     | `{ name, description?, input_schema }`                         |
| `gemini`        | `{ name, description?, parameters }`                           |
| `json-schema`   | `{ name, description?, parameters }` without provider rewrites |

Read [Provider Schema Strategies](./llm-strategy.html) before choosing a target. It shows the exact optional, nullable and `bigint` rewrites and the build-time refusals.

## The provider-neutral case

`toolFromSchema` remains the right API when a framework or protocol wants a plain JSON Schema tool record:

<!-- snippet: llm-function-calling.ts#snippet-2 -->

It is the schema-value form of the `json-schema` target. It does not apply OpenAI strict rewrites, Anthropic's `input_schema` framing or Gemini's nullable spelling. The LangChain and AI SDK adapters
deliberately start from this provider-neutral document because those frameworks perform their own provider translation.

## A provider document is not validation

A model response is still untrusted. Validate the returned arguments before a repository or handler sees them:

<!-- snippet: llm-function-calling.ts#snippet-3 -->

This is especially important for an optional field widened to nullable by the OpenAI strict target, or an untyped `json` column that a provider-neutral document represents as `{}`.

## Parsing text responses

When the API returns text rather than a structured tool call, `lenientParse` strips an outer Markdown fence and calls `JSON.parse`:

<!-- snippet: llm-function-calling.ts#snippet-4 -->

It does not repair trailing commas, single quotes or prose around the JSON. Pass a coercion function to validate and decode in the same boundary:

<!-- snippet: llm-function-calling.ts#snippet-5 -->

`lenientParse` catches a validator exception and returns its message in `errors`. With no coercion function, `lenientParse<T>` does no validation at all: `T` is only the caller's claim, just as it is
with `JSON.parse`.

## Framework adapters

Use [`langchainTool`](./llm-langchain.html) or [`aiSdkTool`](./llm-vercel-ai-sdk.html) when those frameworks own dispatch. Both keep the generated schema and AOT validator together, require validation
before the handler, and add no runtime schema library to zmdb.

---

See also: [Provider Schema Strategies](./llm-strategy.html) · [Structured Output](./llm-structured-output.html) · [Validation](./validators-assert.html)
