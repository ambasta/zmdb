// The LLM surface today is two functions: `toolFromSchema` (one JSON Schema shape) and
// `lenientParse`. Everything above that — provider dialects, framework adapters, a chat loop, MCP,
// and OpenAPI-derived tools — is missing. Split into what a tool *is* and what runs it.

export const LLM_EPICS = [
  {
    key: 'toolspec',
    title: '[EPIC] Tool specs that each provider actually accepts, and adapters for the two frameworks people use',
    labels: ['enhancement', 'area:llm'],
    pages: ['llm-strategy', 'llm-langchain', 'llm-vercel-ai-sdk'],
    packages: ['@zmdb/schema-core'],
    motivation: `
\`toolFromSchema(name, schema)\` returns \`{ name, description?, parameters }\` where \`parameters\` is
whatever \`toJsonSchema\` produces (packages/schema-core/src/llm/index.ts:11). One shape, for every
provider. The page note is exact: "no per-provider dialect (OpenAI / Claude / Gemini) switch".

That single shape is not portable, and the ways it fails are specific rather than cosmetic. OpenAI's
strict function calling requires \`additionalProperties: false\` on every object and every property
listed in \`required\` — including optional ones, which must instead be typed as nullable. Anthropic
wants \`input_schema\` rather than \`parameters\` and does not impose the strict-mode requirements. Gemini
accepts a reduced subset of JSON Schema and rejects several keywords outright (\`$ref\`, \`oneOf\` in
places, \`format\` values it does not know), so a schema with a union or a reference is refused at the
API boundary rather than degraded.

Which means a tool spec derived from a zmdb type today works with one provider by luck. And the fix is
not a formatting layer: the *provider dialect is a real target*, in the same sense a SQL dialect is,
and some types are not expressible in a given provider's subset. Refusing those at build time — with a
message naming the provider and the offending type — is the honest behaviour, and it is the behaviour
zmdb's architecture is set up to give, because the schema is known at compile time.

The adapters follow from that. LangChain and the Vercel AI SDK are how most people actually call
tools, and both want a slightly different object: LangChain a \`StructuredTool\` (or a
\`DynamicStructuredTool\` with a validation function), the AI SDK a \`tool({ parameters, execute })\`
record. Both can be built on top of an AOT-emitted validator, which gives them something neither
normally has: argument validation with no runtime schema library in the bundle.
`,
    dod: [
      "Tool specs are emitted per provider dialect — OpenAI (strict and non-strict), Anthropic, Gemini — each accepted by that provider's API without hand-editing.",
      "A type not expressible in a provider's subset is refused at build time with the provider named and the offending path pointed at.",
      'A LangChain adapter produces a working structured tool whose argument validation is the AOT-emitted validator.',
      'A Vercel AI SDK adapter does the same for `tool()`.',
      'Neither adapter makes zod, or any runtime schema library, a runtime dependency of zmdb.',
      'Round-trip tests prove a model-produced argument object validates and decodes to the declared TypeScript type.',
      'All three pages flip to supported.',
    ],
    invariants: [
      '§2.2 no runtime reflection: the provider-specific JSON Schema is computed at AOT time and inlined. There is no walk of a schema object when a tool spec is requested.',
      '§2.3 validation at the boundary: model output is the least trustworthy input in the system. Tool arguments are validated before the handler sees them, always, with no opt-out.',
      "§2.6 no over-abstraction: an adapter is a thin function producing the framework's own object. Do not build a zmdb-flavoured agent abstraction that frameworks then wrap.",
      'Peer dependencies only: `langchain` and `ai` are dev/peer dependencies. A user of zmdb who never touches LLMs must not install either.',
      'Refuse rather than degrade: silently dropping a `oneOf` Gemini cannot take would produce a tool that accepts arguments the type does not allow — a validation hole reached through the model.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] provider dialects, the expressibility rules, and adapter shapes',
        labels: ['spec'],
        goal: 'Freeze the three provider dialects keyword by keyword, the exact rule for what each provider cannot express, and the shape of both framework adapters. No code.',
        why: 'The expressibility rules are the substance. "Emit JSON Schema per provider" is easy; knowing that OpenAI strict mode requires every property in `required` and expresses optionality as a nullable type, and that Gemini rejects `$ref`, is what makes the emitted spec actually work. Those rules have to be written down and cited, because they are the kind of thing that is otherwise rediscovered by a user hitting a 400.',
        files: [
          '`packages/schema-core/src/llm/SPEC.md` — provider dialects and expressibility.',
          '`packages/schema-core/src/llm/adapters/SPEC.md` (new) — the two adapters.',
        ],
        api: `
export type ToolProvider = 'openai' | 'openai-strict' | 'anthropic' | 'gemini' | 'json-schema';

export interface ToolSpecFor {
  readonly 'openai': { type: 'function'; function: { name: string; description?: string; parameters: object } };
  readonly 'openai-strict': { type: 'function'; function: { name: string; description?: string; strict: true; parameters: object } };
  readonly 'anthropic': { name: string; description?: string; input_schema: object };
  readonly 'gemini': { name: string; description?: string; parameters: object };
  readonly 'json-schema': ToolSpec;
}

export declare function toolFor<P extends ToolProvider>(
  provider: P, name: string, schema: CoreSchema<string>, opts?: { description?: string },
): ToolSpecFor[P];
`,
        steps: [
          "Write the OpenAI section: the non-strict form, and the strict form's requirements (`additionalProperties: false` everywhere, every property in `required`, optionality expressed as a nullable union, a restricted keyword set, nesting and property-count limits). Cite the documented limits by number so a future reader can check them.",
          'Write the Anthropic section: `input_schema` naming, what it accepts, and where it is more permissive than OpenAI strict.',
          'Write the Gemini section: the reduced subset, the rejected keywords, and — critically — the list of zmdb type constructs that therefore cannot be expressed. Discriminated unions and recursive types are the likely casualties; name them.',
          'Specify the refusal: which provider × construct pairs are refused, the diagnostic shape (provider, path, construct, and a suggested reformulation), and that it happens at AOT time. Reuse the existing `EmitDiagnostic` machinery rather than a new error type.',
          'Decide how optionality maps per provider — this is where the same type legitimately produces different schemas, and it is the highest-value thing to get right. Write the mapping table.',
          'Specify the LangChain adapter: which class or factory, how the validator plugs into it, how a validation failure is reported back to the model (a tool error message the model can act on, not a thrown exception that kills the loop — and say which, because it changes agent behaviour).',
          'Specify the AI SDK adapter: the `tool()` record, and how `parameters` is supplied given the SDK expects a schema object. If the SDK requires a validator interface, specify the small adapter that presents the AOT validator through it — without importing zod.',
          'Specify the dependency policy: peer/optional, version ranges, and what happens when the framework is absent (the subpath is simply not imported; no runtime probing).',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Three provider dialects specified keyword by keyword with documented limits cited.',
          'Optionality mapping table written per provider.',
          'Refusal list and diagnostic shape frozen, reusing `EmitDiagnostic`.',
          'Both adapter shapes specified, including validation-failure behaviour and the no-zod requirement.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] provider-accepted specs, refusals, and adapter round trips',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land the failing tests: golden per-provider schemas for a shared set of types, refusal tests for the inexpressible ones, and adapter tests that run a real tool call end to end with a stubbed model.',
        why: 'The specs are just JSON, so golden tests are cheap and precise. The part worth designing carefully is the refusal coverage and the adapter round trip — proving a model-shaped argument object gets validated before a handler runs is the security-relevant assertion in this epic.',
        files: [
          '`packages/schema-core/src/llm/providers.spec.ts` (new)',
          '`packages/schema-core/src/llm/adapters/langchain.spec.ts`, `ai-sdk.spec.ts` (new)',
          '`packages/schema-core/src/llm/llm.type-test.ts` (new) — `toolFor` return types.',
        ],
        tests: [
          '`emits an OpenAI strict schema with additionalProperties false at every level`.',
          '`lists every property in required and expresses an optional field as nullable under openai-strict` — the rule that most often breaks in practice.',
          '`emits input_schema for anthropic`.',
          '`emits the Gemini subset and omits no required information` — assert the exact document.',
          '`refuses a discriminated union for gemini, naming the provider and the path`.',
          '`refuses a recursive type where the provider cannot express it`.',
          '`refuses a schema exceeding the provider nesting or property limit`.',
          "`returns a provider-specific type from toolFor` — type-test, so `toolFor('anthropic', ...)` has `input_schema` and no `function` key.",
          '`validates model arguments before the handler runs` — the adapter test: feed a wrong-typed argument object and assert the handler was never called.',
          '`reports a validation failure to the model as a tool error rather than throwing` — per the spec decision.',
          '`decodes validated arguments to the declared TypeScript type` — including a custom type with a decoder, so the adapter is proven to run the decode step and not just the check.',
          '`does not import zod or any runtime schema library` — assert the module graph of both adapters.',
        ],
        steps: [
          'Pick one shared fixture type set used by every provider test — an object with optionals, a nested object, an array, a union, an enum, a date, and a custom type — so the per-provider differences are visible side by side in the goldens.',
          'Write the module-graph assertion for the no-zod requirement; a package.json check is not enough, since a transitive import would still bundle.',
          'Stub the frameworks minimally rather than pulling their full runtimes into the unit tests, but keep one test per adapter that uses the real package so the shape is genuinely conformant.',
        ],
        dod: [
          'Golden per-provider schemas for a shared fixture type set.',
          'Refusal tests for every inexpressible construct in the spec list.',
          'Adapter tests prove validation-before-handler, decoding, and error reporting.',
          'No-runtime-schema-library requirement enforced by module-graph assertion.',
        ],
      },
      {
        key: 'providers',
        title: 'Provider dialects for OpenAI, Anthropic and Gemini',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement `toolFor` with per-provider emission and build-time refusals, computed at AOT time and inlined.',
        files: [
          '`packages/schema-core/src/llm/providers.ts` (new)',
          '`packages/schema-core/src/llm/index.ts` — export `toolFor`, keep `toolFromSchema` as the `json-schema` provider.',
          '`packages/aot-validator/src/emit/` — the emission path for the inlined spec.',
        ],
        steps: [
          'Implement the three dialects as transformations of the IR, not post-processing of the generic JSON Schema. Post-processing cannot know that an optional field must become nullable-and-required, because that information is in the IR and lost in the generic output.',
          'Implement the refusals through `EmitDiagnostic`, with a path that points at the declaration site. Note the existing defect that `EmitDiagnostic.path` sometimes carries an emitted-expression fragment rather than a source path — if it bites here, fix it, because a diagnostic that cannot be located is not a diagnostic.',
          "Make the provider a type parameter so the return type is the provider's shape, and keep the union closed so adding a provider is exhaustively checked.",
          "Ensure the result is inlined by the AOT transform. If `toolFor` currently falls outside the transform's `CALLEES` list, add it — an untransformed call would walk a schema at runtime, which §2.2 forbids.",
          'Check the type-instantiation budget after making the return type provider-dependent.',
          'Retain `toolFromSchema` unchanged in behaviour so existing callers are unaffected; it becomes the `json-schema` provider internally.',
        ],
        tests: [
          'All provider golden and refusal tests green.',
          '`toolFor is inlined by the AOT transform` — assert emitted output, not just the runtime result.',
          '`yarn verify:instantiations` within budget.',
        ],
        dod: [
          'Three dialects implemented from the IR, with a closed provider union and typed returns.',
          'Refusals surface as locatable diagnostics at build time.',
          "`toolFor` is on the transform's callee list and provably inlined.",
        ],
      },
      {
        key: 'adapters',
        title: 'LangChain and Vercel AI SDK adapters',
        labels: ['enhancement'],
        blockedBy: ['providers'],
        goal: 'Ship both adapters as thin factories over an AOT-emitted validator, on their own subpaths, with the frameworks as peer dependencies.',
        why: 'The selling point is narrow and real: a structured tool whose argument validation is generated code rather than a runtime schema library. Keeping the adapters thin is what preserves that — the moment either grows its own agent concepts, the value is gone and the maintenance starts.',
        files: [
          '`packages/schema-core/src/llm/adapters/langchain.ts`, `ai-sdk.ts` (new)',
          '`packages/schema-core/package.json` — `./llm/langchain` and `./llm/ai-sdk` subpaths, peer deps, `peerDependenciesMeta.optional`.',
        ],
        api: `
export declare function langchainTool<T>(
  name: string, description: string, validator: Validator<T>, run: (args: T) => Promise<string>,
): StructuredToolInterface;

export declare function aiSdkTool<T>(
  description: string, validator: Validator<T>, execute: (args: T) => Promise<unknown>,
): Tool;
`,
        steps: [
          'Implement each adapter to validate, then decode, then call the handler — in that order, with no path that skips validation.',
          'Report validation failures the way the spec chose. A returned tool error keeps the agent loop alive and lets the model correct itself, which is usually right; a thrown exception is right when the failure indicates a bug rather than a bad guess. Implement the chosen one and comment why.',
          'Present the AOT validator through whatever schema interface each framework requires, without importing zod. If the AI SDK needs a `Schema`-shaped object, construct it from the validator plus the provider JSON Schema.',
          'Mark both frameworks as optional peer dependencies with sensible ranges, and pin the ranges tested against.',
          'Verify the subpaths through `yarn verify:exports` and `yarn verify:publish`, so the new entry points are actually shipped.',
          'Add both to the docs-site examples so the code on the page is the code that is tested.',
        ],
        tests: [
          'All adapter tests green, including the real-package conformance test for each.',
          '`does not import zod or any runtime schema library`.',
          '`yarn verify:exports`, `yarn verify:publish` green.',
        ],
        dod: [
          'Both adapters ship on documented subpaths with optional peer dependencies.',
          'Validation and decoding always run before the handler; failure behaviour deliberate and commented.',
          'No runtime schema library reaches the bundle; exports verified.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] provider dialects and the two framework adapters',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['adapters'],
        goal: 'Flip all three pages to supported, with the per-provider differences shown side by side and the expressibility limits stated up front.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/llm-strategy.md`, `llm-langchain.md`, `llm-vercel-ai-sdk.md`',
          '`docs-site/content/llm-function-calling.md` — the existing page documents `toolFromSchema` and needs to point at `toolFor`.',
        ],
        steps: [
          'Show one type emitted for all four providers side by side. That single comparison teaches the whole feature better than prose, especially the optional-to-nullable transformation.',
          'Document what each provider cannot express and what the refusal looks like, before the happy path — a reader with a discriminated union needs to know immediately.',
          'Document the adapters with runnable examples, stating the peer-dependency requirement and the tested version ranges.',
          'State the property the adapters have that alternatives do not: validation without a runtime schema library, and how that is enforced.',
          'Update the existing `llm-function-calling` page so `toolFromSchema` is described as the provider-neutral case, and refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Three pages supported with a side-by-side provider comparison, limits documented first, and runnable adapter examples; `llm-tools` updated.',
        ],
      },
    ],
  },

  {
    key: 'agent',
    title: '[EPIC] The agent runtime — a typed chat loop, MCP, and tools from an OpenAPI document',
    labels: ['enhancement', 'area:llm'],
    pages: ['llm-chat', 'llm-mcp', 'llm-http'],
    packages: ['@zmdb/schema-core', '@zmdb/web'],
    motivation: `
Three page notes, one theme: "no chat loop, message types or agent driver", "no MCP server or client",
"no generator that turns an OpenAPI document into callable tool specs". Tool specs describe what a
model may call; this epic is about running the calls.

The third of those is the one where zmdb has an unusual advantage and it is worth being concrete about
why. zmdb already generates an OpenAPI document from typed controllers, and it already generates
validators from types. So a zmdb service can expose its own endpoints as model-callable tools with no
new description written anywhere, and — going the other direction — an arbitrary OpenAPI document can
become a set of tool specs with generated argument validators. The same is true of MCP: an MCP server
is, structurally, a tool registry plus a transport, and a typed tool registry is what the previous epic
produces.

The chat loop is the smallest and most dangerous part. It is easy to write and easy to write badly: an
unbounded loop that calls tools until the model stops is a way to spend money and, if the tools have
side effects, to do damage. The safety properties have to be in the design rather than in a warning on
the page — a hard iteration cap, an explicit approval hook for effectful tools, and a rule that the
loop never invents a tool call the model did not request.

For MCP the security surface is sharper still, because the server exposes tools to a client the service
does not control. Tool argument validation is the entire boundary. Any tool exposed over MCP whose
handler trusts its arguments is remotely exploitable by whatever drives the client.
`,
    dod: [
      'A chat loop exists with typed messages, a hard iteration cap, and an approval hook for tools declared effectful.',
      'The loop is provider-agnostic over a small driver interface, with at least one real driver.',
      "An MCP server exposes typed tools with mandatory argument validation, and an MCP client consumes a remote server's tools as typed calls.",
      "A generator turns an OpenAPI document into tool specs with generated argument validators, and zmdb's own generated document round-trips through it.",
      'Every tool call in every path validates arguments before the handler runs — asserted, not assumed.',
      'All three pages flip to supported.',
    ],
    invariants: [
      '§2.3 validation at the boundary, at its most load-bearing: model and MCP-client input is untrusted. No path may reach a handler with unvalidated arguments.',
      '§2.7 no hidden state: the chat loop holds no module-level conversation state. A conversation is a value the caller owns and passes in.',
      '§2.6 no over-abstraction: a driver interface with one method for "produce the next message" is enough. Do not build a graph or workflow engine.',
      '§1 cost model: message and tool-argument validators are AOT-emitted like every other validator; the loop does no reflection.',
      'Bounded by construction: iteration caps, tool-call caps per turn, and response size limits are parameters with safe defaults, not optional configuration a caller might forget.',
    ],
    nonGoals: [
      'A workflow or agent-graph framework. The loop runs a conversation; orchestration belongs to the caller.',
      'Prompt templating or memory management.',
      'Shipping provider SDKs as dependencies. Drivers are thin and the SDKs stay peer/optional.',
    ],
    subs: [
      {
        key: 'spec',
        title: "[Spec Freeze] message types, the loop's safety properties, MCP shape, and OpenAPI-to-tools",
        labels: ['spec'],
        goal: 'Freeze the message model, the driver interface, every bound and approval point in the loop, both MCP directions, and the OpenAPI-to-tool-spec mapping. No code.',
        why: 'This is the epic where a design mistake has consequences beyond a wrong result: an unbounded loop over effectful tools, or an MCP server that trusts arguments. The bounds and the approval model have to be specified as required parameters with defaults, because anything optional here will be omitted by someone.',
        files: [
          '`packages/schema-core/src/llm/chat/SPEC.md` (new)',
          '`packages/schema-core/src/llm/mcp/SPEC.md` (new)',
          '`packages/schema-core/src/llm/http/SPEC.md` (new)',
        ],
        api: `
export type Message =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string; readonly toolCalls?: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly callId: string; readonly content: string; readonly isError?: boolean };

export interface ToolCall { readonly id: string; readonly name: string; readonly args: unknown }

export interface ChatDriver {
  next(messages: readonly Message[], tools: readonly ToolSpec[]): Promise<Message>;
}

export interface RunOptions {
  readonly maxTurns: number;                    // required: no default that permits runaway
  readonly maxToolCallsPerTurn?: number;
  readonly approve?: (call: ToolCall) => Promise<boolean>;   // required when any tool is effectful
}
export declare function run(driver: ChatDriver, messages: readonly Message[], tools: ToolRegistry, opts: RunOptions): Promise<readonly Message[]>;
`,
        steps: [
          'Specify the message union, and decide how provider-specific fields (reasoning blocks, cache markers, citations) are carried — an escape-hatch field is honest, but say what is guaranteed and what is passthrough.',
          'Specify the loop precisely: when it stops (no tool calls, cap reached, driver error), what it returns, and that reaching the cap is a distinguishable outcome rather than a silent stop. A caller cannot tell "finished" from "gave up" unless it is in the return value.',
          'Make `maxTurns` required with no default. Then specify what happens if a tool is declared effectful and no `approve` is supplied: a type error if that is achievable, a thrown error at registration otherwise. Say which and why.',
          'Specify tool declaration: a registry entry carries the validator, the handler, the provider spec, and an `effectful` flag. Specify that the flag defaults to effectful — the safe default is the one that requires approval, not the one that does not.',
          'Specify the error path: a tool that throws becomes a tool message with `isError`, so the model can recover; a driver that throws propagates. Note that returning a raw exception message to the model can leak internals, so specify what is sent (a sanitised message) versus what is logged.',
          "Specify the MCP server: which protocol version, which transports (stdio and HTTP, with the HTTP one's auth requirement stated), tool listing derived from the registry, and mandatory validation before dispatch. Specify that the server never exposes a tool not explicitly registered.",
          "Specify the MCP client: how a remote server's advertised tools become typed calls, and — since a remote schema is only known at runtime — exactly how far typing can go and where validation of remote *results* happens. Be honest that a remote tool's types come from a document the client did not compile.",
          'Specify OpenAPI-to-tools: which document constructs map to tool parameters (path, query, header, body), how operation ids become tool names, what is refused (documents with constructs the target provider cannot express, or operations with no operationId), and whether validators are generated at build time from a checked-in document. Build time is the right answer for the cost model — say so.',
          "Specify the round-trip requirement: zmdb's own generated OpenAPI document, fed through the generator, must produce tools whose arguments match the controllers' declared input types.",
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Message union, driver interface and loop termination semantics frozen, with cap-reached distinguishable from completion.',
          '`maxTurns` required; effectful-by-default tools require an approval hook, with the enforcement mechanism chosen.',
          'Error path specifies what the model sees versus what is logged.',
          'Both MCP directions specified including transport auth and the limits of typing a remote tool.',
          'OpenAPI mapping, refusals and build-time validator generation specified, plus the self-round-trip requirement.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] loop bounds, validation-before-dispatch, MCP conformance, OpenAPI round trip',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests driven by a scripted fake driver, covering every bound and every refusal, plus MCP protocol conformance and the OpenAPI self-round-trip.',
        why: 'A fake driver that returns a scripted sequence of messages makes the loop fully testable with no network and no non-determinism — including the adversarial cases, which are the ones that matter: a driver that never stops, that calls an unregistered tool, that sends malformed arguments.',
        files: [
          '`packages/schema-core/src/llm/chat/chat.spec.ts` (new)',
          '`packages/schema-core/src/llm/mcp/mcp.spec.ts` (new)',
          '`packages/schema-core/src/llm/http/openapi-tools.spec.ts` (new)',
        ],
        tests: [
          '`stops when the driver returns no tool calls`.',
          '`stops at maxTurns and reports that it was capped` — a driver that always requests a tool call; the result must be distinguishable from a natural finish.',
          '`refuses a tool call for a name that is not registered` — the model hallucinating a tool is the common case, and executing anything for it would be a serious bug.',
          '`refuses malformed tool arguments and reports them to the model as a tool error` — assert the handler never ran.',
          '`requires an approval hook when a tool is effectful` — per the chosen enforcement.',
          '`does not call an effectful tool when approval is denied, and tells the model it was denied`.',
          '`caps tool calls per turn`.',
          '`sanitises a handler exception before sending it to the model` — assert an internal detail (a stack frame, a file path) does not appear in the tool message.',
          '`holds no state between two concurrent runs` — run two conversations interleaved and assert no cross-talk, which is the §2.7 assertion.',
          '`lists only registered tools over MCP`.',
          '`validates MCP tool arguments before dispatch` — the remote-exploitation boundary.',
          '`refuses an MCP HTTP connection without the specified auth`.',
          '`speaks the specified MCP protocol version and rejects an unsupported one`.',
          '`turns an OpenAPI operation into a tool spec with path, query and body parameters`.',
          '`refuses an operation with no operationId, naming the path`.',
          "`round-trips zmdb's own generated document into tools whose argument types match the controllers` — the headline test.",
          '`validates a remote tool result before returning it as typed` — the MCP client boundary.',
        ],
        steps: [
          'Build the scripted fake driver as a small helper returning a queued list of messages; every loop test uses it. Include a driver that always requests a call, for the cap tests.',
          "For MCP conformance, test against the protocol's own message shapes rather than only against our client — a server that only our client can talk to is not an MCP server.",
          'Write the round-trip test to derive its expectation from an existing controller fixture in `@zmdb/web`, so it stays true as the controller surface evolves.',
        ],
        dod: [
          'Every bound, refusal and approval path tested with a scripted driver.',
          'Concurrency isolation asserted; exception sanitisation asserted with a concrete internal detail.',
          'MCP tested against real protocol message shapes in both directions, including transport auth.',
          'OpenAPI self-round-trip test in place against a real controller fixture.',
        ],
      },
      {
        key: 'loop',
        title: 'The chat loop and tool registry',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement the typed message model, the tool registry, the bounded loop with approval, and one real provider driver.',
        files: [
          '`packages/schema-core/src/llm/chat/index.ts` (new)',
          '`packages/schema-core/src/llm/chat/drivers/anthropic.ts` (new) — thin, over an optional peer dep.',
          '`packages/schema-core/package.json` — the `./llm/chat` subpath.',
        ],
        steps: [
          'Implement the registry so a tool cannot be registered without a validator, and so `effectful` defaults to true. The default is the whole safety design: a caller who forgets the flag gets the cautious behaviour.',
          'Implement the loop as a pure function over its inputs — no module state, so two runs can interleave. The concurrency test asserts this and it is the easiest property to lose.',
          'Validate every tool call against its registered validator before dispatch, with no fast path around it, and reject unknown names before any lookup that could touch a prototype chain — the same allowlist discipline as #364, since tool names come from a model.',
          'Return a result that says why the loop stopped, and include the full message list so the caller can continue the conversation.',
          'Sanitise handler exceptions into a message that names the tool and the failure class without internals; log the full error through whatever the project uses.',
          'Write the one real driver thinly: translate messages and specs, call the SDK, translate back. No retry policy invented here beyond what the spec chose, and no hidden token accounting.',
        ],
        tests: [
          'All loop tests green, including caps, approval denial, unknown tools and sanitisation.',
          '`holds no state between two concurrent runs`.',
          "One test against the real provider SDK's types (no network) so the driver is shape-conformant.",
        ],
        dod: [
          'Registry requires validators and defaults to effectful; loop is a pure function with a reasoned stop result.',
          'Every dispatch validates; unknown tool names refused safely.',
          'Exceptions sanitised toward the model, logged in full; one real driver ships.',
        ],
      },
      {
        key: 'mcp',
        title: 'MCP server and client',
        labels: ['enhancement'],
        blockedBy: ['loop'],
        goal: "Expose a typed tool registry as an MCP server over stdio and authenticated HTTP, and consume a remote server's tools as validated calls.",
        why: "The server is where zmdb's validation story becomes a security property rather than a convenience: the tool boundary is remote, and generated validators mean the boundary is enforced by code that cannot drift from the types.",
        files: [
          '`packages/schema-core/src/llm/mcp/server.ts`, `client.ts` (new)',
          '`packages/web/src/mcp/` (new, if an HTTP transport belongs with the web layer)',
        ],
        steps: [
          "Implement tool listing from the registry, emitting each tool's schema in the MCP-expected form, and never listing anything not registered.",
          'Validate before dispatch, unconditionally. Treat this as the same boundary as an HTTP request body, because it is.',
          'Implement stdio transport, then HTTP with the auth the spec requires. An unauthenticated HTTP MCP endpoint exposing effectful tools would be a remote-execution surface; make auth non-optional in the HTTP path rather than a configuration flag.',
          "Honour the protocol version negotiation and reject unsupported versions with the protocol's own error shape.",
          "Implement the client so a remote tool's advertised schema produces a runtime validator for its *results*, and document plainly that the argument types are as trustworthy as the remote document.",
          'Apply the same bounds as the loop — response size, call counts — to anything the client drives.',
        ],
        tests: [
          'All MCP tests green in both directions, against real protocol message shapes.',
          '`refuses an MCP HTTP connection without the specified auth`.',
          '`validates MCP tool arguments before dispatch`.',
        ],
        dod: [
          'Server lists only registered tools and validates every call; HTTP transport cannot be run unauthenticated.',
          'Version negotiation implemented with protocol-shaped errors.',
          'Client validates remote results and documents the trust boundary; bounds applied.',
        ],
      },
      {
        key: 'openapi',
        title: 'Tools from an OpenAPI document',
        labels: ['enhancement'],
        blockedBy: ['loop'],
        goal: "Generate tool specs and argument validators from an OpenAPI document at build time, and prove it on zmdb's own generated document.",
        files: [
          '`packages/schema-core/src/llm/http/index.ts` (new)',
          '`packages/zmdb/src/cli/commands/generate.ts` — a tools-from-document output, if the CLI is the entry point.',
        ],
        steps: [
          "Parse the document's operations into the same IR the rest of the system uses, so validators come from the existing emitter rather than a second one. A second validator generator for this path would violate §2.9 and would drift.",
          'Map path, query, header and body parameters into a single arguments object, and decide (and document) how a name collision between a path and a query parameter is resolved — refusing is acceptable and probably better.',
          'Refuse operations with no operationId, unresolvable `$ref`s, or constructs the target provider cannot express, with the path named.',
          'Generate at build time into a checked-in module, deterministic and formatter-clean with a generated header, so the runtime does no parsing.',
          'Build the caller: a tool handler that issues the HTTP request, with the URL constructed from validated parameters — never string-concatenated from raw input, since path parameters reaching a URL unvalidated is an SSRF-shaped hazard. Validate the base URL against an allowlist supplied by the caller.',
          'Prove the self-round-trip against a real controller fixture, which is both the best test and the best demo.',
        ],
        tests: [
          'All OpenAPI-to-tools tests green, including the self-round-trip.',
          '`refuses an operation with no operationId, naming the path`.',
          '`constructs request URLs from validated parameters against an allowlisted base`.',
        ],
        dod: [
          'Document operations flow through the existing IR and validator emitter, not a second one.',
          'Generation is build-time, deterministic and formatter-clean; refusals name the offending path.',
          'The caller validates parameters and constrains the base URL; the self-round-trip test passes.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] the chat loop, MCP, and OpenAPI-derived tools',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['mcp', 'openapi'],
        goal: 'Flip all three pages to supported, leading with the safety model rather than the happy path.',
        files: ['`docs-site/pages.mjs`, `docs-site/content/llm-chat.md`, `llm-mcp.md`, `llm-http.md`'],
        steps: [
          'Write the chat page around the bounds: why `maxTurns` is required, why tools are effectful by default, and what the approval hook is for. A reader who copies the example must get the safe configuration, because the example is what gets copied.',
          'Document the stop-reason result and how to continue a conversation, since holding no state is a deliberate choice a reader will otherwise find surprising.',
          'Write the MCP page with both directions, and state the HTTP auth requirement as a requirement. Include the remote-trust caveat for the client.',
          'Write the OpenAPI page around the self-round-trip: a zmdb service exposing its own endpoints as tools with no extra description written. Show the generated output.',
          'Cross-link to the provider-dialect page, since a generated tool still needs a provider dialect to be callable.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Three pages supported, safety model documented before the happy path, HTTP auth stated as a requirement, and the self-round-trip shown with real generated output.',
        ],
      },
    ],
  },
];
