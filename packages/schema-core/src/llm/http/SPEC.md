# SPEC — the `fetch` drivers, and tools from an OpenAPI document (frozen)

Part of `@zmdb/schema-core`, exported from the existing `./llm` subpath. Two things that are both `fetch` and
nothing else: a `ChatDriver` per provider over the provider's HTTP API, and a build-time generator that turns
an OpenAPI document into tool specs whose handlers are HTTP calls.

`../chat/SPEC.md` owns the loop and the registry; `../SPEC.md` owns the document and the provider framings.
This file is the two places where a request is actually made — which is also why it is the file where a
timeout, a retry policy and a leaked API key are in scope.

## 1. A driver is not a provider wrapper

`docs-site/content/llm-strategy.md` argues against wrapping vendor APIs and `docs-site/content/llm-http.md`
gives complete `fetch` examples instead. Neither position changes here, and the distinction is precise:

- **Refused**, still: a `LanguageModel` abstraction, a unified options object, provider fallback, a model
  registry, cost tables, and anything that makes two providers look like one when they are not.
- **Frozen** here: a `ChatDriver` (`../chat/SPEC.md` §2) per provider, which is one method — messages and
  tool specs in, one `ChatMessage` out. Its whole job is the translation the loop refuses to do, because the
  loop hands out `ToolSpec` and a provider wants its own framing.

The difference is that a driver has no surface to grow. There is no options object to accumulate fields, no
capability flags, no feature detection: a model name, a key, a base URL, and the translation.

```ts
export interface HttpDriverOptions {
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly maxOutputTokens: number; // required — see §2
  readonly timeoutMs?: number; // default 60_000
  readonly fetch?: typeof globalThis.fetch;
}
export declare function anthropicDriver(opts: HttpDriverOptions): ChatDriver;
export declare function openaiDriver(opts: HttpDriverOptions): ChatDriver;
export declare function geminiDriver(opts: HttpDriverOptions): ChatDriver;
```

`apiKey` is a required string and not read from `process.env`: this package has no `node:process`
(`../mcp/SPEC.md` §1 explains why that matters), and a library reaching into the environment is a library that
works differently in a test. `requireEnv` at the call site is the pattern `web-configuration.md` already
documents.

`fetch` is injectable for one reason — the tests must not make network calls — and defaults to
`globalThis.fetch`. It is not a general transport seam: nothing in the driver's contract is stated in terms of
anything but a `Response`.

## 2. Three required values, and why each is required

- **`maxOutputTokens`.** Anthropic's API rejects a request without `max_tokens`, so a driver has to supply
  something; a default would be a cost decision made by a library. `llm-http.md` picks 1024 in its example and
  says why sixty seconds is not generous for a long completion — the same reasoning applies to a token budget,
  and the caller is the only party who knows theirs.
- **`timeoutMs`, defaulted rather than required, at 60 000.** `fetch` has no timeout, so a hung request hangs
  forever, which is the one failure mode that has no upper bound. It is defaulted rather than required because
  a default that is wrong costs a slow request, whereas no default at all costs a stuck process — and
  `AbortSignal.timeout(60_000)` is exactly the line `llm-http.md` already recommends.
- **No `retries` option at all.** Retries belong to the caller, wrapped around the driver, for the reason
  `../chat/SPEC.md` §2 gives: retryability is a set of provider status codes plus a policy about idempotence,
  and `llm-http.md` has the fifteen lines including the jitter that stops a fleet from synchronising.

## 3. Translation, both ways, and the two `assert`s

Outbound, per provider: `ChatMessage[]` and `ToolSpec[]` become the provider's request. That is
`toolFor(provider, …)`'s framing (`../SPEC.md` §5) for the tools, the provider's own message shape for the
history, and — for Anthropic — the `system` message lifted out of the array into a top-level field, because it
is not a message there. A `provider` passthrough block (`../chat/SPEC.md` §1.1) is emitted verbatim in the
position it was received in, and a driver that meets a `kind` it does not recognise **refuses**, per that
section's rule.

Inbound: the provider's response becomes one `ChatMessage`. Two validations, doing different jobs, exactly as
`llm-http.md` already argues:

1. The **response envelope** is checked against the driver's own declared interface. An API change, or an error
   body returned with a 200, fails here with a field name.
2. The **tool arguments** are not checked by the driver at all. They are `unknown` on `ToolCall.args` and the
   registry entry's validator is what types them (`../chat/SPEC.md` §3). A driver that validated arguments
   would need the caller's type, which it cannot have.

A non-2xx response throws, carrying the status and the body text. It does not become a `ChatMessage` with
`isError`, because `isError` is the channel for something the model can fix and a 401 is not.

**Never log the request init.** The key is in the headers, which is the mistake `llm-http.md` closes with. A
driver that took a logger would be a driver that could make it; it takes none.

## 4. Tools from an OpenAPI document: what maps, and what is not there to map

```ts
export interface OpenApiToolsOptions {
  readonly provider?: ToolProvider; // default 'json-schema'
  readonly baseUrl: string;
  readonly include?: (op: { readonly method: string; readonly path: string; readonly operationId: string }) => boolean;
}
export declare function toolsFromOpenApi(doc: unknown, opts: OpenApiToolsOptions): readonly ToolSpec[];
```

The mapping, and the part the issue's step 8 asks for:

| Document construct                  | Tool parameter                                              |
| ----------------------------------- | ----------------------------------------------------------- |
| `in: 'path'` parameter              | a required property, `type` from its schema, name unchanged |
| `in: 'query'` parameter             | a property, required iff the parameter is                   |
| `in: 'header'` parameter            | **dropped** — see below                                     |
| `in: 'cookie'` parameter            | **dropped** — same reason                                   |
| `requestBody`, `application/json`   | its properties, flattened into the same object              |
| `requestBody`, any other media type | the operation is refused                                    |
| `operationId`                       | the tool name, after the provider's name rule               |
| `summary` / `description`           | the tool description, `summary` preferred                   |

**Headers and cookies are dropped rather than exposed, and that is a security decision, not a simplification.**
A header parameter is where `Authorization`, `Cookie`, `X-Api-Key` and every tenant header live. A tool
parameter is a field a language model fills in from text it was given, some of which may be attacker-supplied.
Letting a model choose a header value is letting it choose who the request is authenticated as. So headers come
from the caller's `fetch` wrapper, one place, per generated call, and the model cannot see or set them —
`llm-mcp.md`'s "authorise the caller, not the request", in the one place where a document would otherwise hand
the model the mechanism.

**Flattening the body into the same object** is chosen because a tool document is one level deep for zmdb's own
schemas (`../SPEC.md` §1) and a nested `body` object would be the only nesting in the system, reachable only by
this path. A name collision between a parameter and a body property refuses the operation rather than
resolving it, since either resolution silently sends the model's value to the wrong place.

Refusals, each naming the operation:

- no `operationId` **and** no derivable name (§5),
- a name the target provider's pattern rejects — the same table `../SPEC.md` §2.1 freezes, which is where a
  64-character limit and a `[A-Za-z0-9_-]` rule live,
- two operations that produce the same tool name,
- a body that is not `application/json`,
- a parameter or body schema containing a construct the target provider cannot express — `$ref` that does not
  resolve within the document, `oneOf`/`anyOf` for `gemini`, and everything else §2.1's table lists. This is
  the one place those provider limits are reachable at all: a third-party document has nesting, unions and
  recursion that a zmdb schema cannot produce.

`$ref` within the document is resolved by inlining, with a cycle detected and refused. A `$ref` to another
file or a URL is refused without fetching it — a generator that dereferences a URL is a generator that makes a
network call at build time against a document that may be hostile.

## 5. `operationId`, and the round trip through zmdb's own document

Step 9 asks that zmdb's own generated document round-trip into tools that match the controllers' inputs.
Reading `packages/web/src/openapi/index.ts` first is what makes that requirement precise, because as it stands
it cannot hold:

- `toOpenApi` emits **no `operationId`** — `OpenApiOperation` has `parameters`, `requestBody` and `responses`
  and nothing else. Step 8's "refuse operations with no `operationId`" would therefore refuse every operation
  in zmdb's own document, which contradicts step 9 directly.
- It emits **no query or header parameters at all**: `parameters` is derived from the path string alone, every
  entry `in: 'path'`, `required: true`, `schema: { type: 'string' }`.
- A request body appears only when the caller passes `options.schemas`, keyed by **route path** — so two
  methods on one path share one body schema.

So the round-trip claim is frozen at what is actually true, and the gap is closed on the `@zmdb/web` side
rather than papered over here:

1. `toOpenApi` gains a deterministic `operationId` per operation, overridable per route. That is one field, and
   it is specified in `packages/web/src/openapi/SPEC.md` alongside the reason a tool name has to be stable:
   renaming a tool between two generations is a _new_ tool to a model, and the prompt caches that make a tool
   loop affordable key on the tool list.
2. `toolsFromOpenApi` falls back to a derived name — `<method>_<path with separators replaced>` — when a
   third-party document omits `operationId`, and refuses on collision. Refusing an operation because a document
   we do not control omits an optional field would make the generator useless against most real documents.
3. **The round-trip assertion is: every route becomes exactly one tool; path parameters become required string
   properties; a body's properties appear when and only when a `schemas` entry supplied them.** Path parameters
   being `string` is not a mismatch to fix — `Ctx.params` is `Record<string, string>` at the controller
   boundary too, so the tool and the handler agree.

## 6. Build time, and what is _not_ generated

Step 8 says build time is the right answer for the cost model, and it is — for the documents. Parsing an
OpenAPI document, resolving its `$ref`s and framing every operation is work whose result changes only when the
document does, so it happens once in a script that writes a module, the way
`migrations-web-mobile.md` already generates client migrations. A process that does it at boot pays for it on
every deploy, every worker and every lambda cold start.

**Validators are not generated, and the issue's step 8 is wrong that they could be.** The transform reads
TypeScript types from the checker; it does not read JSON Schema. Generating a validator from a document means
either a second validation front end compiling JSON Schema — which `ARCHITECTURE.md` §2.9's one-front-end rule
forbids, and which would be a different implementation of the same semantics, drifting — or generating
TypeScript interfaces from the document and letting the existing transform compile those. The second is a real
option, and it is refused for this epic as a second codegen front end whose output has to be checked in,
reviewed and kept in sync with a document somebody else owns.

What the caller does instead is what they already do everywhere: declare the type they expect and
`assert<T>` it at their own call site. For a tool derived from a third-party document that is the honest state
of affairs anyway — the document is a claim about the API, not a proof.

The generated module therefore contains tool **specs** and a call template, and no validators:

```ts
// generated by scripts/generate-api-tools.mjs — do not edit
export const searchDocs = { name: 'search_docs', description: '…', parameters: { … } } as const;
```

The handler is the caller's, and it is where the base URL, the headers and the timeout live — one wrapper for
all generated tools, which is also the answer to §4's dropped headers.

## 7. What #534 has to assert

1. Each driver's request body, against a recorded fixture per provider, with an injected `fetch` and no
   network — including the Anthropic `system` lift and the `provider` passthrough emitted in place.
2. A driver refuses a `provider` block whose `kind` it does not recognise, rather than dropping it.
3. A non-2xx throws with the status and the body; a 200 carrying an error envelope fails the envelope
   assertion with a field name.
4. `timeoutMs` aborts: an injected `fetch` that never settles, and the driver rejects.
5. `toolsFromOpenApi` over a fixture document covers every row of §4's table, including that a header
   parameter does not appear in any tool's properties.
6. Each refusal in §4, by operation name: missing name, provider-rejected name, duplicate name, non-JSON body,
   unresolvable `$ref`, `$ref` cycle, external `$ref`, parameter/body name collision.
7. The round trip of §5.3 against `toOpenApi([...controllers])` for the existing
   `openapi/__fixtures__/route-schemas.ts` controllers — the tools are compared to the routes, not to a
   snapshot, so a new route cannot pass by being added to both sides.
8. No test makes a network call, which the injected `fetch` makes structural rather than a matter of
   discipline.

## 8. Non-goals (rejected)

- **No provider abstraction, model registry, fallback or cost table.** §1 — `llm-strategy.md`'s position,
  unchanged.
- **No `process.env` access.** §1 — `apiKey` is a required argument.
- **No retries in the driver.** §2 — a policy about idempotence belongs to the caller.
- **No streaming driver.** `../chat/SPEC.md` §2 — the loop's product is a message list, and the framework's
  response body is a string.
- **No header or cookie parameters in a generated tool.** §4 — a model choosing a header value is a model
  choosing an identity.
- **No nested `body` object in a generated tool.** §4 — it would be the only nesting in the system.
- **No `$ref` fetching, and no cyclic `$ref` support.** §4.
- **No generated validators, and no generated TypeScript interfaces.** §6 — one validation front end, one
  codegen front end.
- **No runtime document parsing helper.** §6 — a boot-time parse of a build-time-constant document is a cost
  with no benefit, and offering it is how it gets used.
