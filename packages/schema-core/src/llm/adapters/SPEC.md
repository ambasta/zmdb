# SPEC — LangChain and Vercel AI SDK tool adapters (frozen)

Part of `@zmdb/schema-core`, exported from the existing `./llm` subpath. Two functions,
`langchainTool` and `aiSdkTool`, that turn a declared schema into the object shape each framework's
tool constructor wants. `../SPEC.md` freezes the document; this freezes the framing.

No new subpath. The adapters import nothing from either framework (§1), so there is nothing to isolate
behind an entry point, and `ARCHITECTURE.md`'s subpath inventory does not move.

## 1. Neither adapter imports its framework, and that is still type-checked

`packages/schema-core/package.json` has exactly one dependency — `@zmdb/query-compiler` — and **no
`peerDependencies` field at all**. This section exists to keep that true, because "an adapter for X" is
normally spelled as a dependency on X.

- A `dependency` puts LangChain's tree in every consumer's `node_modules`, including the ones that use the
  AI SDK, and including the ones that use neither.
- A `peerDependency` makes an install warn for every app that does not have it.
- `peerDependenciesMeta.optional` silences the warning and still puts both framework names in the published
  manifest, where a resolver, an audit tool and a reader all see them. A package with zero runtime
  dependencies is a claim `docs-site/content/why-zmdb.md` makes on the front page; two optional peers are a
  footnote on that claim.

Frozen: **no dependency of any kind, and the adapters return plain objects that the app passes to the
framework's own constructor.**

```ts
new DynamicStructuredTool(langchainTool('create_user', users, { … }));
tool(aiSdkTool('create_user', users, { … }));
```

Which means the type compatibility is structural, and a structural claim that nothing checks is a claim that
rots. So it is checked: **a package under `fixtures/` devDepends on `@langchain/core` and `ai`, and its
typecheck is the assertion** — it assigns each adapter's return to the framework's own parameter type and does
nothing else. `fixtures/` rather than the package's own devDependencies, for the reason the existing
`consumer-cli` and `consumer-plugin` fixtures are there: a fixture consumes the built package through its
published types, so what it proves is what a user gets rather than what the source happens to allow. When a
framework renames a field, that typecheck fails in this repository instead of in a user's.

The version each framework is pinned at is recorded in the fixture's manifest and nowhere else. A framework
version is not a fact about zmdb.

## 2. The validation call cannot live inside the adapter

`assert<T>(x)` is rewritten by the transform **at the call site the transform can see**, from a type argument
the checker can resolve there. Inside a published adapter, `T` is the adapter's own type parameter: there is
no type to inline, so the call degrades to the witness path and throws `runtime type witness required in
test/fallback mode` at runtime. A generic function in a library cannot validate its own type parameter, which
is the same rule `tests/api-coverage/mapping.mjs` records as `NO_FACTORY_FORM` and the reason no
`createIs<T>()` exists.

So the adapter cannot be the thing that validates, and pretending otherwise would produce an adapter that
throws on its first tool call. Frozen: **`validate` is a required field the caller supplies**, one arrow, in
the caller's own file, where the transform inlines it:

```ts
validate: v => assert<CreateDTO<User>>(v),
```

Both docs pages already write that exact line inside `func` and `execute`. It moves up by one field and gains
a job: `T` is inferred from `validate`'s return type, so `execute` receives a typed input with no type
argument at the call and no `as` anywhere.

```ts
export interface ToolAdapterOptions<T> {
  readonly description: string;
  readonly validate: (value: unknown) => T;
  readonly execute: (input: T) => unknown | PromiseLike<unknown>;
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
export interface LangChainToolFields<T> {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonSchemaObject;
  readonly func: (input: unknown) => Promise<string>;
}

export declare function langchainTool<T>(
  name: string,
  schema: CoreSchema<string>,
  opts: ToolAdapterOptions<T>,
): LangChainToolFields<T>;
```

**`schema` is the JSON Schema document, not a Zod schema, and `json-schema-to-zod` goes away.** Current
LangChain accepts a JSON Schema for a structured tool; `llm-langchain.md:30` already knows this and calls it
"the better path" in a sentence after the example that does not take it. What the conversion cost is worth
naming, because it is the reason this is not merely a shorter example:

- `format` has no Zod equivalent that survives a round trip, so `date-time` and `int64` were dropped silently.
- A `json` column's `{}` became `z.any()` — a tool parameter that accepts anything, described to the model as
  such. That is the one construct two providers refuse outright (`../SPEC.md` §4) being quietly waved through.

`llm-langchain.md:28` currently apologises for this ("if the conversion loses a constraint — and it does") and
tells the reader the second `assert` is what notices. With the adapter there is no first schema to lose
anything, and the `assert` is still there for the reason §5 gives.

**`func` returns a string, always.** A LangChain tool result becomes `ToolMessage.content`, which is text; an
object return is stringified by whatever LangChain does that day. So the adapter stringifies a non-string
return with `JSON.stringify` and passes a string through unchanged — which is what the page's
`return JSON.stringify(row)` already does by hand, moved into the adapter so that every tool answers the same
way.

The functional form (`tool(fn, fields)`) takes the same object as its second argument minus `func`, so both
LangChain spellings are one destructure apart. The adapter does not pick one.

## 4. `aiSdkTool`, and the one thing that has to be injected

```ts
export declare function aiSdkTool<T, S>(
  name: string,
  schema: CoreSchema<string>,
  opts: ToolAdapterOptions<T> & { readonly jsonSchema: (schema: unknown) => S },
): { readonly description: string; readonly inputSchema: S; readonly execute: (input: unknown) => Promise<unknown> };
```

The AI SDK's `tool()` wants `inputSchema` — `parameters` was the v4 key and `llm-vercel-ai-sdk.md:16` and
`:34` still use it — and its value must be either a Zod schema or the SDK's own `Schema`, which is **branded
with a symbol**. A brand exists precisely so it cannot be produced from outside, so there are three ways
through and two are wrong: importing `ai` is §1, and casting puts a lie in zmdb that goes stale the day the
brand changes. Frozen: **the caller passes the SDK's own `jsonSchema` in**, typed by the minimal signature
above, and `S` is generic so whatever it returns flows out unchanged and stays assignable to `tool()`.

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

`llm-vercel-ai-sdk.md:16` does not compile today, adapter or not: `JsonSchemaObject.properties` is a
`Readonly<Record<string, unknown>>`, and the SDK's parameter is a mutable JSON-Schema node type, so that line
needs a cast the page does not show. The adapter is where the one cast lives — inside `aiSdkTool`, at the
`opts.jsonSchema(document)` call, against a signature this package declares — instead of in every app.

## 5. What happens when the model sends the wrong arguments

A model sending a malformed tool call is **not** an operator's problem: it is a message to the model, and the
model usually fixes it on the next turn. A repository failing is the opposite. Both adapters have to tell
those apart without importing the package that throws, and they can, because schema-core already owns the
answer:

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

`json-schema` passes an empty schema through (`../SPEC.md` §2), so a `json` column is an unconstrained tool
parameter in both frameworks — the model may put anything there and the framework will accept it. The
`validate` arrow is what closes that, and it is the reason §2 makes it required rather than optional: the
app's TypeScript type for that column is not `unknown`, so `assert<CreateDTO<User>>` rejects what the tool
schema permitted. Both pages should say this next to their `validate` line, because "the schema constrains the
model" is otherwise a reasonable thing to assume from the code.

## 7. What #526 has to assert

1. Each adapter's return, assigned to the framework's own parameter type, in the `fixtures/` package — the
   typecheck is the test.
2. `func`/`execute` returns the failure string, and does not throw, for an input the `validate` arrow rejects;
   the string contains the path and contains neither the value nor the word the value was.
3. A non-validation throw from `execute` propagates unchanged, including its type.
4. `langchainTool`'s `schema` is byte-identical to `toolFor('json-schema', …).parameters` — one producer.
5. `aiSdkTool` calls the injected `jsonSchema` exactly once, with that same document, and returns what it
   returned.
6. No `dependencies` or `peerDependencies` entry appears in `packages/schema-core/package.json` — the existing
   dependency audit gains this package's manifest rather than a new script.

## 8. Non-goals (rejected)

- **No dependency, peer dependency or optional peer dependency on either framework.** §1.
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
