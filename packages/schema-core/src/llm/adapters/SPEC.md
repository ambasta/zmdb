# SPEC — LangChain and Vercel AI SDK tool adapters

Part of `@zmdb/schema-core`. The optional `./llm/langchain` and `./llm/ai-sdk`
subpaths export two functions, `langchainTool` and `aiSdkTool`, that turn a
declared schema into the object shape each framework's tool constructor wants.
`../SPEC.md` freezes the document; this freezes the framing.

The subpaths isolate the framework-facing declarations from applications that
use neither integration. Their runtime graphs still import neither framework.

## 1. Optional peers, without framework runtime imports

`packages/schema-core/package.json` still has one runtime dependency:
`@zmdb/query-compiler`. LangChain and the AI SDK are optional peer dependencies,
so applications that do not import their subpaths do not install or load either
framework through zmdb.

- `@langchain/core` is tested at `1.2.9` and peers on `^1.2.9`.
- `ai` is tested at `7.0.83` and peers on `^7.0.83`.
- `peerDependenciesMeta.optional` prevents warnings for applications that use
  neither integration.

The adapter modules use structural fields and local runtime helpers. They do
not import either peer, Zod or another runtime schema package:

```ts
import { langchainTool } from '@zmdb/schema-core/llm/langchain';
import { aiSdkTool } from '@zmdb/schema-core/llm/ai-sdk';

new DynamicStructuredTool(langchainTool('create_user', users, { … }));
tool(aiSdkTool('create_user', users, { … }));
```

The compatibility is structural, so it needs a real compiler check rather than
a handwritten claim.

`fixtures/llm-adapters` pins the two tested versions and compiles the published
subpaths against `DynamicStructuredTool` and `tool()`. Like the existing
consumer fixtures, it proves what an installed user receives rather than what a
source-relative import happens to allow.

When a framework renames a field, that typecheck fails in this repository instead of in a user's.

The exact versions remain in the fixture manifest; the package manifest carries
only the compatible peer ranges.

## 2. The validation call cannot live inside the adapter

`assert<T>(x)` is rewritten by the transform **at the call site the transform can see**, from a type argument the checker can resolve there. Inside a published adapter, `T` is the adapter's own type parameter: there is no type to inline, so the call degrades to the witness path and throws `runtime type witness required in test/fallback mode` at runtime.

A generic function in a library cannot validate its own type parameter, which is the same rule `tests/api-coverage/mapping.mjs` records as `NO_FACTORY_FORM` and the reason no `createIs<T>()` exists.

So the adapter cannot synthesize the validator, and pretending otherwise would
produce an adapter that throws on its first tool call. **`validate` is a
required field the caller supplies**, one arrow in the caller's own file, where
the transform inlines it:

```ts
validate: v => assert<CreateDTO<User>>(v),
```

The guides keep that arrow in application code. Compared with the former
handwritten `func` and `execute` examples, it moves into the required
`validate` field and gains a job: `T` is inferred from its return type, so
`execute` receives a typed input with no type argument at the call and no `as`
anywhere.

```ts
export interface ToolAdapterOptions<T, Output = unknown> {
  readonly description: string;
  readonly validate: (value: unknown) => T;
  readonly execute: (input: T) => Output | PromiseLike<Output>;
}
```

`description` is required, not optional, in both adapters. Both frameworks accept a tool without one, and a
tool without one is the most common reason a model never calls it — an optional field here saves a reader four
words and costs them a debugging session.

Nothing in `ToolAdapterOptions` names a provider. The frameworks translate to their provider themselves —
LangChain in `bindTools`, the AI SDK in its provider packages — so an adapter that emitted the
`openai-strict` framing would be a second translation of the same document, racing the framework's. Both
adapters therefore use `json-schema` (`../SPEC.md` §5), and an app that wants the strict framing calls
`toolFor` and talks to the provider directly, which is what `llm-strategy.md` recommends anyway.

## 3. `langchainTool`

```ts
export interface LangChainToolFields {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonSchemaObject;
  readonly func: (input: unknown) => Promise<string>;
}

export declare function langchainTool<T, Output>(
  name: string,
  schema: CoreSchema<string>,
  options: ToolAdapterOptions<T, Output>,
): LangChainToolFields;
```

**`schema` is the JSON Schema document, not a Zod schema, and `json-schema-to-zod` goes away.** Current
LangChain accepts a JSON Schema for a structured tool, and the guide now takes
that direct route. The conversion cost is worth naming because it is the reason
this is not merely a shorter example:

- `format` has no Zod equivalent that survives a round trip, so `date-time` and `int64` were dropped silently.
- A `json` column's `{}` became `z.any()` — a tool parameter that accepts anything, described to the model as
  such. That is the one construct two providers refuse outright (`../SPEC.md` §4) being quietly waved through.

With the adapter there is no intermediate schema to lose anything, and the
caller-supplied validator remains for the reason §5 gives.

**`func` returns a string, always.** A LangChain tool result becomes `ToolMessage.content`, which is text; an
object return is stringified by whatever LangChain does that day. So the adapter stringifies a non-string
return with `JSON.stringify` and passes a string through unchanged — which is what the page's
`return JSON.stringify(row)` already does by hand, moved into the adapter so that every tool answers the same
way.

The functional form (`tool(fn, fields)`) takes the same object as its second argument minus `func`, so both
LangChain spellings are one destructure apart. The adapter does not pick one.

## 4. `aiSdkTool`, and the one thing that has to be injected

```ts
export interface AiSdkToolOptions<T, Output, Schema> extends ToolAdapterOptions<T, Output> {
  readonly jsonSchema: (schema: unknown) => Schema;
}

export interface AiSdkToolFields<Schema, Output> {
  readonly description: string;
  readonly inputSchema: Schema;
  readonly execute: (input: unknown) => Promise<Output | string>;
}

export declare function aiSdkTool<T, Output, Schema>(
  name: string,
  schema: CoreSchema<string>,
  options: AiSdkToolOptions<T, Output, Schema>,
): AiSdkToolFields<Schema, Output>;
```

The tested AI SDK 7.0.83 `tool()` wants `inputSchema`; its value must be either a
Zod schema or the SDK's own `Schema`, which is **branded with a symbol**.

A brand exists precisely so it cannot be produced from outside, so there are three ways through and two are wrong: importing `ai` is §1, and casting puts a lie in zmdb that goes stale the day the brand changes. Frozen: **the caller passes the SDK's own `jsonSchema` in**, typed by the minimal signature above, and `S` is generic so whatever it returns flows out unchanged and stays assignable to `tool()`.

```ts
import { tool, jsonSchema } from 'ai';

const tools = {
  create_user: tool(
    aiSdkTool('create_user', users, {
      jsonSchema,
      description: 'Create a user',
      validate: v => assert<CreateDTO<User>>(v),
      execute: dto => userRepo.create(dto),
    }),
  ),
};
```

One import from `ai`, in the app's file, which is where an `ai` import belongs.

Two smaller things, both stated because they look like mistakes:

- **The returned object has no `name`.** v5's `tool()` takes none; the key in the `tools` record is the name.
  The adapter still asks for `name` because a validation failure has to be able to say which tool it was
  (§5), and the duplication in the snippet above is the SDK's shape rather than something the adapter can fix.
- **`jsonSchema<T>()`'s type parameter is not passed.** The page's `jsonSchema<CreateDTO<User>>(...)` types the
  SDK's inference; here `T` is already known from `validate` and `execute` is typed from it, so a second
  declaration of the same type would be a second place to get it wrong.

The former hand-written guide passed `JsonSchemaObject` into the SDK boundary
directly, where its deeply readonly properties did not match the SDK's mutable
JSON-Schema node type. `aiSdkTool` now owns that structural handoff through the
declared `(schema: unknown) => Schema` callback, so applications need neither a
cast nor a second schema producer.

## 5. What happens when the model sends the wrong arguments

A model sending a malformed tool call is **not** an operator's problem: it is a
message to the model, and the model usually fixes it on the next turn. A
repository failing is the opposite.

LangChain owns one earlier boundary: `@langchain/core` 1.2.9 checks the supplied
JSON Schema before it calls `func`, and a shape-invalid call can therefore raise
its `ToolInputParsingException` without entering this adapter. The behavior
below covers input that reaches `func` — importantly, constraints hidden behind
an unconstrained `{}` — and every call to the AI SDK adapter's `execute`.

At that boundary the adapters tell validation failures from application
failures without importing the package that throws, because schema-core already
owns the answer:

- `validationIssuesOf(error)` (`../../index.ts`) returns a `readonly ValidationIssue[]` for anything carrying
  a well-formed `issues` array, and `undefined` otherwise. It is deliberately structural — the doc comment
  says so — so it recognises `AssertError` without an import, and it equally recognises a caller who wrote
  `validate: v => mySchema.parse(v)` with zod or io-ts. `ValidationIssue` is declared in this package;
  `AssertError` is not importable from here at all (`../SPEC.md` §4, the cycle), so a structural test is not a
  shortcut, it is the only option — and it happens to be the better one.
- A list, including **the empty list**, is a validation failure: an empty list means "validation, and it
  declined to say more", which is still the model's problem and not the database's.
- `undefined` is rethrown. That covers a repository error, a network failure, and the case where
  `claimsValidationIssues` would say yes while the `issues` property is not an array — a malformed error is a
  bug in somebody's validator, and swallowing it as "try different arguments" makes the model retry a broken
  tool in a loop until the agent's step limit stops it.

The result the model sees is a string beginning with a stable prefix, followed by one line per issue built
from `path` and `expected`. Two rules on its contents:

- **`value` is never included.** It is the value that failed, it came from the model but may have been
  assembled from a document the model was shown, and the string goes back to the provider. A tool-result
  string is the easiest accidental exfiltration path in an agent, and the model does not need the value to fix
  the call — it needs the path and the expectation.
- `message` is used only when `expected` is absent, since `expected` is optional and `message` is the only
  guaranteed field. zmdb's emitted messages are value-free by construction (the value lives in `value`), so
  this matters only for a caller's own validator; the page says so, and that is the whole mitigation.

For the AI SDK the same string is the `execute` return, for the same reason: an SDK-level throw becomes a
`ToolExecutionError` the application has to handle, when the thing that happened is a turn the model can
retry.

## 6. Where the `{}` gap is actually covered

`json-schema` passes an empty schema through (`../SPEC.md` §2), so a `json` column is an unconstrained tool parameter in both frameworks — the model may put anything there and the framework will accept it.

The `validate` arrow is what closes that, and it is the reason §2 makes it required rather than optional: the app's TypeScript type for that column is not `unknown`, so `assert<CreateDTO<User>>` rejects what the tool schema permitted.

Both pages say this next to their `validate` line, because "the schema
constrains the model" is otherwise a reasonable thing to assume from the code.

## 7. What the implementation tests assert

1. Each adapter's return, assigned to the framework's own parameter type, in the `fixtures/` package — the
   typecheck is the test.
2. `func`/`execute` returns the failure string, and does not throw, for an input the `validate` arrow rejects;
   the string contains the path and contains neither the value nor the word the value was.
3. A non-validation throw from `execute` propagates unchanged, including its type.
4. `langchainTool`'s `schema` is byte-identical to `toolFor('json-schema', …).parameters` — one producer.
5. `aiSdkTool` calls the injected `jsonSchema` exactly once, with that same document, and returns what it
   returned.
6. Neither framework appears in `dependencies`; both appear as optional peers
   at the tested compatible ranges.

## 8. Non-goals (rejected)

- **No runtime dependency or runtime import of either framework.** They remain
  optional peers isolated behind their own subpaths (§1).
- **No adapter-side validation of the caller's type.** §2 — a library cannot inline a check for its own type
  parameter, and an adapter that tried would throw on the first call.
- **No `provider` option on the adapters.** §2 — the framework translates for its provider, and two
  translations of one document is a bug waiting for a version bump.
- **No Zod, and no `json-schema-to-zod`.** §3 — it drops `format` and turns `{}` into `z.any()`, and it is a
  second producer of a document that already has one.
- **No `instanceof AssertError`.** §5 — it is not importable from here, and the structural test also serves
  callers who validate with something else.
- **No `LanguageModel` wrapper, retriever, vector store, chat-memory backend or `useChat` store.** Those are
  the other four ToDos on the two pages, and each is an interface owned by a framework that has changed it
  more than once. A tool document is derived from a schema; a memory backend is a repository call the
  application already knows how to write.
- **No provider HTTP client.** `llm-strategy.md`'s position, unchanged: a tool spec is a document, not a
  request.
