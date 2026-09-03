// GraphQL is the largest single hole in the web package: ten `todo` pages. Split three ways — the
// schema and execution core, the runtime controls layered on it, and the distributed story
// (subscriptions and federation). Each is independently valuable; the latter two depend on the first
// at the sub-issue level.

export const GRAPHQL_EPICS = [
  {
    key: 'gqlcore',
    title: '[EPIC] GraphQL core — SDL derived from types, and resolvers on the container',
    labels: ['enhancement', 'area:graphql', 'area:web', 'parity:nestjs'],
    pages: [
      'web-graphql',
      'web-graphql-resolvers',
      'web-graphql-scalars',
      'web-graphql-mapped-types',
      'web-graphql-schema-first',
    ],
    packages: ['@zmdb/web', '@zmdb/schema-core'],
    motivation: `
Five pages, and the notes read as one feature: "no GraphQL layer shipped; resolvers could sit on the DI
container", "no @Resolver/@Query/@Mutation decorators", "no SDL type emitters", "no PartialType/PickType
analogue for SDL output", "no SDL-to-resolver-type generator".

The parenthetical in the first note is the design already half-decided, and it is right: \`Container\`
(packages/web/src/di/index.ts:99), \`Controller\`/\`Get\`/\`Post\` (routing/index.ts:72–100), \`Chain\` with
guards, pipes, interceptors and filters (middleware/index.ts), \`createApp\` (app/index.ts:26) and the
OpenAPI emitter already exist. A resolver is a method on a container-resolved class with typed
arguments and a typed return — structurally the same thing as a controller handler. So this is not a
new framework; it is a second front-end over machinery that is already there.

The part that is genuinely new, and the reason this is an epic rather than a decorator pass, is SDL
emission from TypeScript types. That is the same problem \`toJsonSchema\` and the OpenAPI emitter solve,
against a third target language with its own constraints: GraphQL has no unions of scalars, no
arbitrary maps, distinguishes nullability per-position with \`!\`, requires input and output object types
to be *separate* types, and needs every type named. The last two are the ones that bite: a TypeScript
type used as both an argument and a return value must emit two SDL types, and an anonymous structural
type has no name to emit.

There is a known related defect worth fixing here or nearby: \`toJsonSchema<Order>()\` emits
\`"shipTo": {}\` for a nested object rather than the nested schema. Whatever causes that will cause the
same hole in SDL emission, so this epic should not build on top of it.
`,
    dod: [
      'SDL is derived from TypeScript types at AOT time, with separate input and output types, correct per-position nullability, named types for every emitted shape, and a diagnostic for anything unnameable or inexpressible.',
      'Custom scalars are declarable and map to a `CustomType` with encode/decode, including the timestamp rule (Date in Node, ISO string on the wire).',
      '`@Resolver`, `@Query`, `@Mutation`, `@ResolveField`, `@Args` bind resolver classes to the existing container and chain, reusing guards, pipes, interceptors and filters rather than duplicating them.',
      'Mapped types (`PartialType`, `PickType`, `OmitType`, `IntersectionType` analogues) produce derived SDL types consistent with the DTO family already in `schema-core`.',
      'A schema-first path generates resolver signature types from an existing SDL document, so an SDL-owned schema is type-checked against its resolvers.',
      'An executable schema runs against a real `graphql` execution engine, with argument validation at the boundary.',
      'All five pages flip to supported.',
    ],
    invariants: [
      '§2.9 one front-end: SDL emission goes through the same IR as JSON Schema and OpenAPI. A separate type walker for GraphQL would be a second front-end and `yarn verify:one-walker` exists to prevent exactly that.',
      "§2.2 no runtime reflection: SDL is emitted at build time. Nothing walks a type at request time to decide a field's shape.",
      '§2.3 validation at the boundary: GraphQL variables and arguments are untrusted input and get AOT-emitted validators, the same as request bodies.',
      '§2.5 no `as`: resolver argument and return types are checked, not asserted. A resolver whose return type does not satisfy its SDL type is a compile error.',
      '§2.6 no over-abstraction: reuse `Container`, `Chain`, `runChain` and the lifecycle hooks. Do not build a parallel GraphQL DI or middleware system.',
      '`graphql` is a peer dependency. A user who does not use GraphQL must not install it.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the TypeScript-to-SDL mapping, resolver binding, and both schema directions',
        labels: ['spec'],
        goal: 'Freeze the complete type-to-SDL mapping including every refusal, the resolver decorator set and how it binds to the existing container and chain, the mapped-type derivations, and the schema-first generation direction. No code.',
        why: 'The mapping is where this feature is won or lost, and its hard cases are known in advance: input/output type duplication, naming anonymous shapes, nullability per position, and the constructs GraphQL cannot express. Deciding those in the spec means the implementation is mechanical; discovering them during implementation means the emitted SDL grows special cases.',
        files: [
          '`packages/web/src/graphql/SPEC.md` (new) — resolvers, execution, binding.',
          '`packages/schema-core/src/sdl/SPEC.md` (new) — the type-to-SDL mapping.',
        ],
        api: `
export declare function Resolver(of?: () => unknown): ClassDecorator;
export declare function Query(returns?: () => unknown): MethodDecorator;
export declare function Mutation(returns?: () => unknown): MethodDecorator;
export declare function ResolveField(name?: string): MethodDecorator;
export declare function Args(name?: string): ParameterDecorator;

/** SDL derived at build time from a type. */
export declare function sdlOf<T>(name: string, opts?: { readonly kind?: 'input' | 'output' }): string;

/** A named scalar backed by a custom type. */
export declare function scalar<Wire, TS>(name: string, type: CustomType<Wire, TS, never>): ScalarDefinition;
`,
        steps: [
          'Write the mapping table: primitives, string/number literal unions to enums, arrays, optionals to nullable, `null` versus `undefined` (GraphQL has one null — decide and document what `undefined` means), nested objects, and recursive types (which SDL handles natively via named references, so this is where naming matters).',
          'Decide the input/output split rule. A type reachable only from an argument emits `input X`; reachable only from a return emits `type X`; reachable from both emits both with a naming convention (`XInput` is conventional). Write the convention and the collision behaviour.',
          'Decide the naming rule for anonymous structural types. Options: refuse with a diagnostic pointing at the site, or derive a name from the path (`OrderShipTo`). Refusing is more honest; deriving is friendlier. Pick one, justify it, and specify the diagnostic either way.',
          "Enumerate what GraphQL cannot express from zmdb's type vocabulary: unions of scalars, arbitrary index-signature maps, tuples, intersections that are not object merges, discriminated unions with non-object members. For each, specify refusal with a diagnostic — never a degradation to a `JSON` scalar, since that silently discards the type.",
          'Specify custom scalars over `CustomType` (packages/schema-core/src/custom-types/index.ts:17), with `encodeValue`/`decodeValue` as the serialise/parse pair, and apply the project timestamp rule explicitly: `Date` in Node, ISO 8601 string on the wire, and a named `DateTime` scalar.',
          'Specify `parseLiteral` versus `parseValue` handling, since a literal in a query document and a variable take different paths and a scalar that only handles one is broken for the other.',
          'Specify the resolver decorators and their binding: resolvers are container-resolved classes; `Chain` applies with the same guards/pipes/interceptors/filters; the GraphQL context is built once per request and made available the way HTTP context already is (see `packages/web/src/context/index.ts`). Say explicitly that guards receive a GraphQL-shaped execution context, which is what the `web-graphql-middleware` page is about — note the boundary between this epic and that one.',
          'Specify `@ResolveField` and how a field resolver receives its parent, plus what happens when a field resolver and a property of the same name both exist.',
          "Specify the mapped types by reference to the existing DTO family, so `PartialType` for SDL means the same thing `Partial` means for a DTO. Consistency with the existing derivations matters more than matching another framework's naming.",
          'Specify the schema-first direction: SDL in, generated resolver signature types out, with the generated file deterministic and formatter-clean, and the failure mode when SDL and resolvers disagree (a compile error, and specify where it surfaces).',
          "Specify the N+1 story's boundary: this epic does not build dataloaders (that is the caching epic), but it must specify how a field resolver reaches one, so the two epics meet cleanly.",
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Complete mapping table including nullability, enums, recursion and the input/output split convention with collision behaviour.',
          'Anonymous-type naming decision made and justified; every inexpressible construct has a specified refusal, none degrade to `JSON`.',
          'Custom scalars specified over `CustomType` with the timestamp rule and both parse paths.',
          'Resolver binding specified in terms of the existing `Container`, `Chain` and context, with the boundary to the runtime-controls epic drawn.',
          'Mapped-type semantics tied to the existing DTO family; schema-first generation and its failure mode specified.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] golden SDL, refusals, and a real executable schema',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests: golden SDL for a fixture type set, a refusal per inexpressible construct, and execution tests that run real queries through the `graphql` engine against container-resolved resolvers.',
        why: 'SDL is text, so goldens are exact and cheap. Execution tests are what prove the binding actually works — a schema that emits correctly but whose resolvers never receive validated arguments would pass every emission test.',
        files: [
          '`packages/schema-core/src/sdl/sdl.spec.ts` (new)',
          '`packages/web/src/graphql/graphql.spec.ts` (new)',
          '`packages/web/src/graphql/graphql.type-test.ts` (new)',
        ],
        tests: [
          '`emits a named output type with per-position nullability`.',
          '`emits separate input and output types for a type used in both positions`.',
          '`emits an enum for a string literal union`.',
          '`emits a recursive type as a named reference`.',
          '`emits a nested object type rather than an empty one` — the direct analogue of the `toJsonSchema` `"shipTo": {}` defect; this must be green here even if the JSON Schema path is fixed separately.',
          '`refuses a union of scalars, naming the path`.',
          '`refuses an index-signature map` and `refuses a tuple`.',
          '`refuses or names an anonymous nested type` — per the spec decision.',
          '`emits a DateTime scalar and serialises a Date to an ISO string`, plus `parses an ISO string from a variable and from a query literal` — both paths.',
          '`resolves a query through a container-resolved resolver class`.',
          '`validates arguments before the resolver runs` — assert the resolver never ran for a bad argument.',
          '`runs guards, pipes, interceptors and filters from the existing chain` — one test per kind, asserting the existing machinery is reused rather than reimplemented.',
          '`resolves a field with @ResolveField, receiving the parent value`.',
          '`derives a PartialType SDL input consistent with the DTO family`.',
          '`generates resolver signature types from an SDL document` and `fails to compile when a resolver disagrees with the SDL` — the second is a type-test.',
          '`does not walk a type at request time` — assert emitted output contains the SDL, so §2.2 is machine-checked rather than assumed.',
        ],
        steps: [
          'Use one fixture type set across all emission tests so the input/output split and nullability differences are visible in one place.',
          'Run execution against the real `graphql` package rather than a stub; a hand-rolled executor would prove nothing about conformance.',
          'Write the chain-reuse tests to assert on the existing `runChain` behaviour (packages/web/src/middleware/index.ts:58), so a reimplementation would fail them.',
        ],
        dod: [
          'Golden SDL for the fixture set, including the nested-object case.',
          'A refusal test for every inexpressible construct in the spec.',
          'Execution tests against the real engine, proving validation-before-resolver and reuse of the existing chain.',
          'Schema-first generation covered including the disagreement compile error.',
        ],
      },
      {
        key: 'sdl',
        title: 'SDL emission from types, with scalars and mapped types',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement the SDL target over the existing IR: named types, the input/output split, nullability, enums, recursion, custom scalars, mapped-type derivations, and diagnostics for everything refused.',
        why: 'This is the substantive engineering in the epic and it must go through the shared IR. A GraphQL-specific type walker would be a second front-end, and the project has a verifier specifically to stop that.',
        files: [
          '`packages/schema-core/src/sdl/index.ts` (new)',
          '`packages/schema-core/src/ir/` — anything the SDL target needs that the IR does not yet carry.',
          '`packages/aot-validator/src/emit/` — inlining `sdlOf`.',
        ],
        steps: [
          'Implement the emitter as an IR consumer alongside `toJsonSchema` and the OpenAPI emitter. If the IR lacks something SDL needs — per-position nullability distinctions, for instance — extend the IR rather than reading types again.',
          'Fix or route around the nested-object hole that produces `"shipTo": {}` in `toJsonSchema`. If it is an IR gap, fixing it improves three targets at once; if it is emitter-local, note that on the JSON Schema side so it is not lost.',
          'Implement the input/output split with the naming convention, and make a collision a diagnostic rather than a silent rename.',
          'Implement custom scalars over `CustomType`, wiring `encodeValue`/`decodeValue` into both parse paths, and ship a `DateTime` scalar following the project timestamp rule.',
          'Implement the mapped-type derivations by reusing the existing DTO derivation logic, not by re-deriving from types.',
          'Emit refusal diagnostics through `EmitDiagnostic` with a source-located path.',
          "Confirm `sdlOf` is on the transform's callee list and inlined; add it if not, since an untransformed call is a runtime type walk.",
          'Run `yarn verify:one-walker` and `yarn verify:instantiations`.',
        ],
        tests: [
          'All SDL emission and refusal tests green, including the nested-object case and both scalar parse paths.',
          '`yarn verify:one-walker` green.',
          '`does not walk a type at request time`.',
        ],
        dod: [
          'SDL emitted from the shared IR with no second walker; `verify:one-walker` green.',
          'Input/output split, nullability, enums, recursion, scalars and mapped types all implemented; refusals are located diagnostics.',
          'The nested-object emission hole resolved or explicitly tracked on the JSON Schema side.',
        ],
      },
      {
        key: 'resolvers',
        title: 'Resolver decorators, container binding and execution',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship `@Resolver`/`@Query`/`@Mutation`/`@ResolveField`/`@Args`, build an executable schema, and run it through the real engine with the existing chain and container.',
        files: [
          '`packages/web/src/graphql/index.ts` (new) — decorators, schema assembly, execution.',
          '`packages/web/src/index.ts` — `metadataOf` needs to carry resolver metadata.',
          '`packages/web/package.json` — a `./graphql` subpath and the `graphql` peer dependency.',
        ],
        steps: [
          'Store resolver metadata through the existing `WebMetadata` mechanism (packages/web/src/index.ts:49) rather than a new registry, so one metadata story covers both front-ends.',
          'Assemble an executable schema from the emitted SDL plus resolver maps, resolving each resolver class through `Container` with its declared scope.',
          'Wire `runChain` so guards, pipes, interceptors and filters apply per resolver, and build the GraphQL execution context once per request. Where a guard needs GraphQL-specific context that does not exist yet, keep the seam minimal and leave the full execution-context work to the runtime-controls epic — but do not fake it.',
          'Validate arguments and variables with AOT validators before dispatch, with no path around it.',
          'Map a resolver throwing to a GraphQL error through the existing `ExceptionFilter` mechanism, and make sure internals do not leak into the response — the same sanitisation concern as any error boundary.',
          'Ship the schema-first direction: read an SDL document, generate resolver signature types into a deterministic formatter-clean file, so the compile error appears at the resolver.',
          'Verify the subpath through `yarn verify:exports` and `yarn verify:publish`; confirm `graphql` is a peer dependency and not pulled in otherwise.',
        ],
        tests: [
          'All execution tests green, including validation-before-resolver and the four chain kinds.',
          '`fails to compile when a resolver disagrees with the SDL`.',
          '`yarn verify:exports`, `yarn verify:publish` green.',
        ],
        dod: [
          'Decorators use the existing metadata, container and chain — no parallel systems.',
          'Arguments always validated; errors flow through `ExceptionFilter` without leaking internals.',
          'Schema-first generation ships with a compile-time disagreement error; `graphql` stays a peer dependency.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] the GraphQL core — SDL, resolvers, scalars, mapped types, schema-first',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['sdl', 'resolvers'],
        goal: 'Flip all five pages to supported, with the type-to-SDL mapping table, every refusal, and both schema directions documented from working code.',
        files: [
          '`docs-site/pages.mjs`',
          'the five content files',
          '`docs-site/content/index.md` and the nav — GraphQL becomes a real section.',
        ],
        steps: [
          'Publish the mapping table verbatim from the spec, including the input/output split convention — a reader who sees `OrderInput` appear needs to know why.',
          'Document every refusal with the diagnostic text, so a reader with a union of scalars finds the answer before hitting the build error.',
          'Document custom scalars with the `DateTime` example, showing `Date` in Node and an ISO string on the wire.',
          'Document code-first and schema-first side by side, and say which the project recommends and why.',
          'State plainly what is in the next two epics (subscriptions, federation, complexity, per-field middleware) so a reader evaluating GraphQL support is not misled by five green pages.',
          'Refresh README counts, which move noticeably here.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Five pages supported with the mapping table, documented refusals, both directions, and an honest statement of what is still missing.',
        ],
      },
    ],
  },

  {
    key: 'gqlruntime',
    title: '[EPIC] GraphQL runtime controls — execution context, per-field middleware, plugins, complexity, directives',
    labels: ['enhancement', 'area:graphql', 'area:web', 'parity:nestjs'],
    pages: [
      'web-graphql-middleware',
      'web-graphql-field-middleware',
      'web-graphql-plugins',
      'web-graphql-complexity',
      'web-graphql-directives',
    ],
    packages: ['@zmdb/web'],
    motivation: `
Five notes: "no GraphQL execution context for the middleware chain", "no per-field middleware chain",
"no server plugin lifecycle", "no complexity estimator or plugin", "no directive or extension metadata".

These are what makes a GraphQL endpoint operable rather than merely working, and one of them is a
security requirement rather than a nicety. A public GraphQL endpoint without a complexity limit is a
denial-of-service surface: a nested query over a list field multiplies, and a modest document can ask
for millions of rows. Depth limiting alone is insufficient because breadth multiplies too. So the
complexity estimator is not an optional plugin in the same sense as the others — an endpoint exposed to
untrusted callers needs it, and the docs must say so at the top of the page.

The execution context is the enabling piece. Guards, pipes and interceptors already exist over an HTTP
context (\`AnyCtx\` in packages/web/src/middleware/index.ts:49). A guard on a resolver needs the GraphQL
equivalent — the field being resolved, the parent, the arguments, the info object — and until that
exists, reusing the chain for GraphQL is only half true. Per-field middleware is then a second chain at
a finer granularity, and it has a real cost question attached: middleware that runs per field runs
thousands of times for a list query, so it must not allocate per invocation the way a per-request chain
can afford to.

Directives and extension metadata are the smallest of the five, but they are what lets the other four be
declared rather than configured — a complexity cost declared on a field, for instance.
`,
    dod: [
      'A GraphQL execution context exists and guards, pipes, interceptors and filters receive it, with a documented mapping from the HTTP context so a shared guard can serve both.',
      'Per-field middleware runs in a chain with a measured per-field cost and a documented budget.',
      'A server plugin lifecycle exists with hooks covering request start, parse, validate, execute and response, sufficient to implement the complexity plugin without special-casing.',
      'A complexity estimator computes a cost before execution and rejects documents over a limit, with per-field costs declarable via directives.',
      'Directive and extension metadata can be attached and appears in emitted SDL.',
      'A benchmark demonstrates the per-field middleware and complexity cost against a realistic query, in the existing benchmark harness.',
      'All five pages flip to supported, with the complexity page stating the DoS risk up front.',
    ],
    invariants: [
      '§1 cost model: per-field work is the hot path. The chain for a field is resolved once at schema build time, not assembled per field per request.',
      '§2.7 no hidden state: plugins and middleware receive context explicitly; no ambient request state.',
      '§2.6 no over-abstraction: the plugin lifecycle covers what the shipped plugins need and no more. A speculative hook nobody uses is a maintenance liability with a compatibility promise attached.',
      'The complexity limit must be enforced before execution begins. A limit checked during execution has already done the work it was meant to prevent.',
      'Reuse `Chain`, `runChain` and `ExceptionFilter`. A second middleware system inside GraphQL would be the failure this epic exists to avoid.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the execution context, both chains, the plugin lifecycle, and the cost model',
        labels: ['spec'],
        goal: 'Freeze the GraphQL execution context and its relationship to the HTTP context, the per-field chain and its cost budget, the plugin hook set, the complexity algorithm, and directive metadata. No code.',
        why: 'Two decisions here are hard to reverse: the context shape (because every guard signature depends on it) and the complexity algorithm (because a limit that is wrong in either direction is either a DoS hole or a broken endpoint). Both deserve to be written down with worked examples before code.',
        files: [
          '`packages/web/src/graphql/SPEC.md` — context, chains, plugins.',
          '`packages/web/src/graphql/complexity/SPEC.md` (new) — the algorithm.',
        ],
        api: `
export interface GraphQLExecutionContext {
  readonly kind: 'graphql';
  readonly parent: unknown;
  readonly args: Readonly<Record<string, unknown>>;
  readonly info: GraphQLResolveInfo;
  readonly request: RequestContext;   // the shared part, so a guard can serve both front-ends
}

export type FieldMiddleware = (ctx: GraphQLExecutionContext, next: () => Promise<unknown>) => Promise<unknown>;

export interface ServerPlugin {
  onRequest?(ctx: RequestContext): void | Promise<void>;
  onParse?(document: string): void;
  onValidate?(rules: ValidationContext): void;
  onExecute?(ctx: GraphQLExecutionContext): void;
  onResponse?(result: ExecutionResult): void;
}

export declare function Complexity(cost: number | ((args: Readonly<Record<string, unknown>>) => number)): MethodDecorator;
`,
        steps: [
          'Specify the execution context, and specify the *shared* part explicitly. A guard that checks authentication should work for both HTTP and GraphQL, and that only happens if the common fields are a named type both contexts embed. Design for that.',
          'Specify how a guard distinguishes the two front-ends when it must — a discriminant field, not a runtime type check.',
          'Specify the per-field chain: registration (global, per-type, per-field), ordering, and how it composes with the resolver-level chain. Then specify the cost budget: a number, measured, for per-field overhead, and the rule that the chain is resolved at schema build time.',
          'Specify the plugin hook set from the plugins actually shipped (complexity, and whatever tracing the observability epic needs) working backwards. Hooks with no consumer do not ship.',
          'Specify the complexity algorithm concretely with worked examples: default field cost, multipliers from list arguments (`first`, `limit`), how nesting multiplies, how fragments and inline fragments are counted, how aliases count (each alias is separate work), and the treatment of introspection queries. Include a worked example of a small document with a large cost, since that is the case the feature exists for.',
          'Specify enforcement point: after parse and validate, before execute, as a validation rule or an equivalent. Say what the rejection response looks like and that it does not leak the limit unless configured to.',
          'Specify the interaction with `@Complexity` directives and with declared costs on fields, including a default for undeclared fields and whether an undeclared list field is refused or given a conservative default — conservative default is probably right, but say why.',
          'Specify directive and extension metadata: how a directive is declared, how it reaches emitted SDL, and how a directive with runtime behaviour is implemented (a field middleware, most likely — say so, so there is one mechanism rather than two).',
          'Specify introspection control, since disabling introspection in production is a common requirement and belongs with these controls.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Execution context specified with a shared portion that lets one guard serve both front-ends, and a discriminant.',
          'Per-field chain semantics and a numeric cost budget frozen; chain resolved at build time.',
          'Plugin hooks derived from real consumers only.',
          'Complexity algorithm fully specified with worked examples covering lists, nesting, fragments, aliases and introspection, plus the pre-execution enforcement point.',
          'Directive metadata specified, with runtime directives implemented as field middleware.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] context reuse, per-field cost, plugin hooks, and complexity rejection',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests including the adversarial complexity cases and a benchmark that measures per-field middleware overhead.',
        why: 'The complexity tests are the ones worth writing carefully, because they are a security control. The interesting cases are the ones an attacker would use: aliases to multiply work, fragments to hide depth, and a list argument that is a variable rather than a literal.',
        files: [
          '`packages/web/src/graphql/context.spec.ts`, `field-middleware.spec.ts`, `plugins.spec.ts` (new)',
          '`packages/web/src/graphql/complexity/complexity.spec.ts` (new)',
          '`benchmarks/` — a per-field middleware benchmark.',
        ],
        tests: [
          '`passes a GraphQL execution context to a guard` and `runs the same guard over HTTP and GraphQL` — the shared-context payoff, asserted with one guard instance used twice.',
          '`runs per-field middleware in registration order`.',
          '`resolves the field chain at schema build time, not per request` — assert by counting an allocation or a resolution call across two requests.',
          '`calls plugin hooks in the specified order` and `a plugin that throws in onRequest rejects the request without executing`.',
          '`rejects a document over the complexity limit before executing` — assert no resolver ran, which is the whole point.',
          '`multiplies cost by a list argument, whether literal or variable` — the variable case is the one a naive estimator misses.',
          '`counts each alias separately` — the classic amplification trick.',
          '`counts cost inside a named fragment and an inline fragment`.',
          '`applies a conservative default cost to an undeclared list field` — per the spec.',
          '`does not leak the configured limit in the rejection unless configured to`.',
          '`can disable introspection` and `does not count introspection against the limit when introspection is enabled` — per the spec.',
          '`emits a declared directive into the SDL`.',
          '`implements a runtime directive as field middleware` — asserting one mechanism, not two.',
          'A benchmark asserting per-field overhead is within the specified budget for a list query of realistic size.',
        ],
        steps: [
          "Write the complexity tests from an attacker's perspective first: alias amplification, variable-driven list sizes, deeply nested fragments. If the estimator survives those, the ordinary cases follow.",
          "Add the benchmark to the existing harness so it reports through the same dashboard, and follow the project's honesty rules about what the number means.",
        ],
        dod: [
          'Shared-guard reuse asserted across both front-ends.',
          'Build-time chain resolution asserted, not assumed.',
          'Complexity suite covers aliases, variables, fragments, defaults and introspection, and proves rejection happens before any resolver runs.',
          'A per-field overhead benchmark exists in the standard harness.',
        ],
      },
      {
        key: 'context',
        title: 'The GraphQL execution context and per-field middleware',
        labels: ['enhancement'],
        blockedBy: ['tests', 'gqlcore:resolvers'],
        goal: 'Implement the execution context with a shared portion, wire the existing chain kinds onto it, and add per-field middleware resolved at schema build time within budget.',
        files: [
          '`packages/web/src/graphql/context.ts` (new)',
          '`packages/web/src/context/index.ts` — factor out the shared portion.',
          '`packages/web/src/middleware/index.ts` — `AnyCtx` widened to cover both.',
        ],
        steps: [
          'Factor the shared context fields out of the HTTP context first, keeping HTTP behaviour identical, then have both contexts embed it. Doing it in that order keeps the refactor auditable.',
          'Widen `AnyCtx` so a guard can be written against the shared portion, and add the discriminant so a guard that needs specifics can narrow without a cast (§2.5).',
          'Compose the per-field chain at schema build time into a single function per field, so per-request work is one call rather than an assembly. This is the difference between meeting the budget and not.',
          'Avoid per-field allocation in the hot path: no new context object per field if the shared portion can be reused, and no array building per invocation.',
          'Run the benchmark and record the number in the same place the other benchmark numbers live.',
        ],
        tests: [
          'Context and field-middleware tests green, including build-time resolution.',
          'The benchmark within the specified budget.',
          'Existing HTTP context and middleware tests unchanged.',
        ],
        dod: [
          'Shared context extracted with HTTP behaviour unchanged; one guard can serve both front-ends without a cast.',
          'Field chains composed at build time; per-field allocation avoided; budget met and recorded.',
        ],
      },
      {
        key: 'plugins',
        title: 'The server plugin lifecycle and directive metadata',
        labels: ['enhancement'],
        blockedBy: ['tests', 'gqlcore:resolvers'],
        goal: 'Implement the plugin hooks the shipped plugins need, plus directive and extension metadata that reaches emitted SDL, with runtime directives implemented as field middleware.',
        files: [
          '`packages/web/src/graphql/plugins.ts` (new)',
          '`packages/web/src/graphql/directives.ts` (new)',
          '`packages/schema-core/src/sdl/index.ts` — directives in emitted SDL.',
        ],
        steps: [
          'Implement only the specified hooks, in the specified order, with errors from a hook handled explicitly — a plugin throwing during `onResponse` must not corrupt an otherwise successful response, and what happens instead needs to be a decision.',
          'Make plugin registration explicit at app construction; no discovery, no ambient registration (§2.7).',
          'Implement directive declaration and carry it to the SDL emitter, so a directive is visible in the schema a client introspects.',
          'Implement runtime directive behaviour as field middleware so there is exactly one execution mechanism.',
          'Implement introspection control here, since it is a schema-level plugin concern.',
        ],
        tests: [
          'Plugin ordering and error-handling tests green.',
          'Directive emission and runtime-directive-as-middleware tests green.',
          '`can disable introspection`.',
        ],
        dod: [
          'Only consumer-backed hooks ship; hook errors have defined behaviour including the `onResponse` case.',
          'Registration explicit; directives reach SDL; runtime directives reuse field middleware.',
        ],
      },
      {
        key: 'complexity',
        title: 'The complexity estimator and limit',
        labels: ['enhancement'],
        blockedBy: ['plugins'],
        goal: 'Implement the estimator per spec and enforce the limit before execution, with declarable per-field costs and conservative defaults.',
        why: 'This is the security control in the epic. It is implemented last because it is written as a plugin over the lifecycle, and that ordering also proves the lifecycle is sufficient without special cases.',
        files: [
          '`packages/web/src/graphql/complexity/index.ts` (new)',
          '`packages/web/src/graphql/index.ts` — wiring and configuration.',
        ],
        steps: [
          'Implement the estimator as a validation-phase rule so rejection happens before execution, and assert that with a test that fails if any resolver runs.',
          'Handle list multipliers from both literal and variable arguments; a variable-driven `first` is the obvious bypass if only literals are read.',
          'Count aliases separately and traverse fragments and inline fragments fully, with a guard against fragment cycles — a cyclic fragment spread is itself a DoS if the estimator recurses without a visited set. (The document validator normally rejects cycles, but the estimator must not depend on ordering to be safe.)',
          'Apply the conservative default to undeclared fields and make the default configurable but not removable.',
          'Implement `@Complexity` with both the constant and the function form, and validate that a cost function cannot itself be expensive — document that it runs per field during estimation.',
          'Make the rejection message configurable in how much it reveals, defaulting to revealing nothing about the limit.',
        ],
        tests: [
          'The full complexity suite green, including alias, variable, fragment and cycle cases.',
          '`rejects a document over the complexity limit before executing`.',
        ],
        dod: [
          'Enforcement provably pre-execution; list multipliers handle variables; aliases and fragments counted; fragment cycles cannot cause unbounded recursion.',
          'Conservative defaults not removable; rejection reveals nothing by default.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] GraphQL runtime controls, complexity first',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['context', 'complexity'],
        goal: 'Flip all five pages to supported, with the complexity page opening on the denial-of-service risk and the recommended configuration for a public endpoint.',
        files: [
          '`docs-site/pages.mjs`',
          'the five content files',
          '`docs-site/content/web-graphql.md` — link the controls.',
        ],
        steps: [
          'Open the complexity page with the risk, not the API: an unprotected public GraphQL endpoint is a DoS surface, and here is the configuration that addresses it. A reader who stops after the first paragraph should still end up safer.',
          "Document the cost algorithm with the spec's worked examples, so a team can predict and tune costs.",
          'Document the shared execution context and show one guard serving both HTTP and GraphQL, which is the most useful thing on these five pages.',
          'Document the per-field middleware cost with the measured number and the benchmark it came from.',
          'Document the plugin hooks with the shipped complexity plugin as the worked example, and say the hook set is deliberately minimal.',
          'Document introspection control alongside complexity, since they are configured together in production.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Five pages supported; complexity page leads with the risk and a recommended public-endpoint configuration; measured per-field cost published.',
        ],
      },
    ],
  },

  {
    key: 'gqldist',
    title: '[EPIC] GraphQL subscriptions and federation',
    labels: ['enhancement', 'area:graphql', 'area:web', 'parity:nestjs'],
    pages: ['web-graphql-subscriptions', 'web-graphql-federation'],
    packages: ['@zmdb/web'],
    motivation: `
"no @Subscription decorator or pub/sub binding" and "no federated schema directives or gateway".

These are separated from the rest of GraphQL because they are the two features that leave the process.
A subscription is a long-lived connection with an async iterable behind it, which means backpressure,
cleanup on disconnect, and authorisation that has to hold for the *lifetime* of the connection rather
than at the moment of the request. Federation means a schema assembled from services, with entity
resolution across boundaries and directives (\`@key\`, \`@external\`, \`@requires\`, \`@provides\`) that must
be emitted correctly or the gateway composes a schema that is subtly wrong.

The subscription authorisation point deserves emphasis because it is the one people get wrong: a guard
that runs once at subscribe time and then never again means a revoked token keeps receiving data
indefinitely. Whatever this epic ships must have a defined answer — periodic re-authorisation, or
per-event authorisation, or an explicit documented statement that the caller must close connections on
revocation. Any of those is defensible; silence is not.

\`@zmdb/web\` already has \`gateways/\` (packages/web/src/gateways/), which is the natural home for the
transport side of subscriptions, so this builds on an existing seam rather than inventing one.
`,
    dod: [
      'A `@Subscription` decorator binds a resolver to an async iterable, with a pub/sub interface that has at least an in-process implementation and a documented path to an external broker.',
      'Subscription authorisation has a defined lifetime behaviour, implemented and tested — not left to the caller by omission.',
      'Connections clean up on client disconnect, server shutdown and error, with a test that asserts no leaked subscribers.',
      'Backpressure has a defined policy when a client cannot keep up, and it is enforced rather than documented.',
      'Federation directives are emitted correctly and a composed schema is validated against a real federation composer.',
      'Entity resolution across service boundaries works, with reference resolvers typed against the entity key.',
      'Both pages flip to supported.',
    ],
    invariants: [
      '§2.7 no hidden state: subscription registries are owned by the app instance, not module-level. Two apps in one process must not share subscribers — which is also what makes the tests reliable.',
      '§2.3 validation at the boundary: subscription arguments and every published payload are validated. A payload published from another part of the system is still crossing a boundary.',
      '§1 cost model: a published event must not walk a type to serialise. Payload validators and serialisers are AOT-emitted.',
      'Resource safety is a correctness property here: a subscription that leaks a listener per connection is a slow outage, and the tests must prove it does not.',
      'Federation directives are emitted from declarations, not hand-written SDL fragments, so they cannot drift from the types.',
    ],
    nonGoals: [
      'Shipping a broker. The pub/sub interface has an in-process implementation and adapters are the seam.',
      'Building a federation gateway router. Emitting a correctly composable subgraph schema is the deliverable; the gateway is validated against an existing composer.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] subscription lifetime, backpressure, and the federation directive set',
        labels: ['spec'],
        goal: 'Freeze the pub/sub interface, the subscription lifecycle including authorisation lifetime and backpressure policy, the cleanup guarantees, and the federation directives with their emission rules. No code.',
        why: 'Three of these are decisions that cannot be retrofitted: authorisation lifetime, backpressure policy, and cleanup guarantees. All three are about what happens when things go wrong, which is exactly what gets omitted from a spec written around the happy path.',
        files: [
          '`packages/web/src/graphql/subscriptions/SPEC.md` (new)',
          '`packages/web/src/graphql/federation/SPEC.md` (new)',
        ],
        api: `
export interface PubSub {
  publish<T>(topic: string, payload: T): Promise<void>;
  subscribe<T>(topic: string, signal: AbortSignal): AsyncIterable<T>;
}

export declare function Subscription(
  returns: () => unknown,
  opts?: { readonly topic?: string; readonly filter?: (payload: unknown, args: unknown) => boolean },
): MethodDecorator;

export declare function Key(fields: string): ClassDecorator;
export declare function External(): PropertyDecorator;
export declare function Requires(fields: string): PropertyDecorator;
export declare function Provides(fields: string): PropertyDecorator;
export declare function ResolveReference(): MethodDecorator;
`,
        steps: [
          'Specify `PubSub` with an `AbortSignal` in the subscribe path, so cancellation is structural rather than a separate unsubscribe call that can be forgotten. Note the alignment with the query-cancellation work, which uses the same primitive.',
          'Specify the authorisation lifetime. Write down all three options (subscribe-time only, periodic re-check, per-event check), pick one as the default with the cost of each stated, and make the others reachable. Then specify what a guard failure mid-stream does to the connection.',
          'Specify the backpressure policy for a slow consumer: buffer with a bound then drop, buffer then close the connection, or apply pull-based backpressure through the async iterable. Say which, say the bound, and say what the client observes. An unbounded buffer is a memory exhaustion bug reachable by a client that simply stops reading.',
          'Specify cleanup guarantees: on client disconnect, on error, on server shutdown (which ties to the existing `OnShutdown` lifecycle hook), and on an app being disposed. Specify that a test asserts zero remaining subscribers after each.',
          'Specify payload filtering, and be explicit that a filter is not an authorisation mechanism — a filter is about relevance, a guard is about permission, and conflating them is how data leaks to the wrong subscriber. Say this in the spec so it lands in the docs.',
          'Specify the transport: WebSocket over the existing `gateways/` seam, which protocol (`graphql-ws` is the current standard — name the version), and the connection-init authentication handshake.',
          'Specify the federation directive set and the emission rules for each, including where the key fields come from (a declaration, so they cannot drift) and what happens when a key names a field that does not exist (a build error).',
          'Specify `@ResolveReference` typing: a reference resolver receives the key fields and returns the entity, and both sides must be typed from the key declaration rather than `any`.',
          'Specify which federation version is targeted, and that composition is validated against a real composer in CI — not against our own reading of the spec.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          '`PubSub` specified with `AbortSignal`-based cancellation.',
          'Authorisation lifetime decided with costs stated and mid-stream failure behaviour defined.',
          'Backpressure policy chosen with a concrete bound and observable client behaviour; unbounded buffering explicitly ruled out.',
          'Cleanup guarantees enumerated with a zero-subscribers assertion required for each.',
          'Filter-versus-guard distinction stated explicitly.',
          'Federation directive set, key derivation, build-time errors, reference-resolver typing and target version frozen, with real-composer validation required.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] subscription lifecycle and leak tests, and real federation composition',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests covering every failure mode of a long-lived connection, plus composition of two subgraph schemas through a real federation composer.',
        why: 'Subscription bugs are leaks and races, not wrong values, so the tests have to assert on resource state after failure paths. Federation bugs are composition failures, so the test has to run a real composer — our own opinion about whether the SDL is valid is worth very little.',
        files: [
          '`packages/web/src/graphql/subscriptions/subscriptions.spec.ts` (new)',
          '`packages/web/src/graphql/federation/federation.spec.ts` (new)',
        ],
        tests: [
          '`delivers a published payload to a subscriber`.',
          '`validates a published payload before delivering it`.',
          '`applies a filter without treating it as authorisation` — two subscribers, one authorised, and assert the guard not the filter is what excludes.',
          '`re-checks authorisation per the configured lifetime and closes the connection when it fails` — the revoked-token case, which is the security-relevant test.',
          '`removes the subscriber on client disconnect` — assert zero subscribers.',
          '`removes every subscriber on server shutdown` — via the existing lifecycle hook.',
          '`removes the subscriber when the resolver throws mid-stream`.',
          '`does not leak a subscriber across a thousand connect/disconnect cycles` — the assertion that catches the realistic leak.',
          '`bounds the buffer for a slow consumer and behaves as specified` — a consumer that never reads; assert memory does not grow without bound and the specified client-visible outcome occurs.',
          '`does not share subscribers between two apps in one process` — the §2.7 assertion.',
          '`authenticates on connection init and rejects an unauthenticated socket`.',
          '`emits @key, @external, @requires and @provides into subgraph SDL`.',
          '`fails the build when @key names a field that does not exist`.',
          '`composes two subgraph schemas with a real federation composer` — the headline federation test.',
          '`resolves an entity reference with types derived from the key` — plus a type-test that a wrong-shaped reference resolver fails to compile.',
        ],
        steps: [
          'Write the leak tests with an explicit subscriber count read from the app instance, so the assertion is direct rather than inferred from memory.',
          "Write the slow-consumer test with a consumer that genuinely never reads, and bound the test's own runtime so a failure is a timeout rather than a hang.",
          'Add the federation composer as a dev dependency and compose real subgraph SDL in CI; a golden-SDL test alone would not catch a composition error.',
        ],
        dod: [
          'Every specified failure path has a test asserting zero leaked subscribers.',
          'Slow-consumer backpressure asserted with a bounded test.',
          'Per-app isolation asserted; connection-init auth asserted.',
          'Federation SDL validated by a real composer, and reference-resolver typing checked at the type level.',
        ],
      },
      {
        key: 'subs',
        title: 'Subscriptions: pub/sub, transport and lifecycle',
        labels: ['enhancement'],
        blockedBy: ['tests', 'gqlruntime:context'],
        goal: 'Implement `@Subscription`, the in-process `PubSub`, the WebSocket transport over the existing gateway seam, and every cleanup and authorisation guarantee the spec requires.',
        files: [
          '`packages/web/src/graphql/subscriptions/index.ts` (new)',
          '`packages/web/src/gateways/index.ts` — the transport binding.',
          '`packages/web/src/graphql/index.ts` — schema assembly for subscription fields.',
        ],
        steps: [
          'Implement the in-process `PubSub` with per-app ownership, so two apps in one process are isolated by construction rather than by convention.',
          'Drive cancellation from `AbortSignal` end to end: disconnect aborts, abort removes the subscriber, and the removal path is the only one, so there is nothing to forget.',
          'Implement the authorisation lifetime the spec chose, including closing the connection with a defined close code when it fails. A silently degraded stream is worse than a closed one.',
          'Implement the backpressure bound and the specified client-visible behaviour. Make the bound a required configuration value with a safe default, never unbounded.',
          'Validate every published payload with an AOT-emitted validator, and keep serialisation off the reflection path.',
          'Wire `OnShutdown` so shutdown drains subscribers, and make sure an app disposal path does too — `App extends AsyncDisposable` already exists (packages/web/src/app/index.ts:14), so use it.',
          'Implement the `graphql-ws` handshake including connection-init auth, and reject unauthenticated sockets before any subscription is registered.',
          'Document the external-broker adapter shape without shipping a broker, and keep the interface small enough that an adapter is obviously writable.',
        ],
        tests: [
          'Every subscription test green, including the thousand-cycle leak test and the slow-consumer bound.',
          '`does not share subscribers between two apps in one process`.',
        ],
        dod: [
          'Cancellation has exactly one removal path, driven by `AbortSignal`.',
          'Authorisation lifetime enforced with a defined close code; buffering always bounded.',
          'Shutdown and disposal drain subscribers; connection-init auth precedes registration.',
          'Payloads validated by generated code; broker adapter shape documented.',
        ],
      },
      {
        key: 'federation',
        title: 'Federation directives and entity resolution',
        labels: ['enhancement'],
        blockedBy: ['tests', 'gqlcore:sdl'],
        goal: 'Emit correct subgraph SDL from declarations and support typed entity resolution, validated by a real composer.',
        files: [
          '`packages/web/src/graphql/federation/index.ts` (new)',
          '`packages/schema-core/src/sdl/index.ts` — federation directive emission.',
        ],
        steps: [
          'Implement the directives as declaration metadata that the SDL emitter consumes, so a key cannot drift from the type. Make a key naming a nonexistent field a build error with the path.',
          'Emit the federation-version-specific preamble (`@link` in Federation 2) exactly, since composition fails obscurely when it is wrong.',
          'Type `@ResolveReference` from the key declaration so the reference argument and the return type are both checked, with no `as` (§2.5).',
          'Run the real composer in CI over two subgraph fixtures, and treat a composition warning as a failure unless it is explicitly allowlisted with a reason.',
          'Document what is not supported at the target federation version rather than leaving a reader to discover it at composition time.',
        ],
        tests: [
          'Federation tests green including real composition and the type-level reference-resolver check.',
          '`fails the build when @key names a field that does not exist`.',
        ],
        dod: [
          'Directives emitted from declarations with build-time validation; version preamble exact.',
          'Reference resolvers typed from the key with no assertions.',
          'Real composition runs in CI with warnings treated as failures unless justified.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] subscriptions and federation',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['subs', 'federation'],
        goal: 'Flip both pages to supported, documenting the authorisation lifetime, the backpressure policy, the filter-versus-guard distinction and the federation version supported.',
        files: ['`docs-site/pages.mjs`', 'the two content files', '`docs-site/content/web-graphql.md`'],
        steps: [
          'Document the authorisation lifetime prominently, including the revoked-token scenario and how to configure a stricter check. This is the thing a reader most needs and least expects to have to think about.',
          'Document the filter-versus-authorisation distinction explicitly, with a worked example of the wrong way, because the wrong way looks reasonable.',
          'Document the backpressure policy, the bound and what a slow client sees.',
          'Document the broker adapter shape and state plainly that no broker ships.',
          'Document the federation version, the directive set, and what is unsupported at that version.',
          'Refresh README counts and cross-link from the GraphQL overview.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Both pages supported; authorisation lifetime, filter-versus-guard, backpressure and federation version all documented; no-broker stated plainly.',
        ],
      },
    ],
  },
];
