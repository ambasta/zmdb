# SPEC — resolvers, binding and execution (frozen, not planned)

> **Not planned.** GraphQL is out of scope for zmdb: the epics and every sub-issue under
> them are closed as wontfix, and no code in this tree implements this document. It stays
> frozen as the record of what was decided and why — the failure modes it names are the
> ones anyone building this outside zmdb will meet.

Part of `@zmdb/web`, a new `./graphql` subpath. The resolver half of the GraphQL core epic:
`packages/schema-core/src/sdl/SPEC.md` freezes the SDL a type produces, and this freezes what runs when a
client asks for a field.

The claim the epic makes is that a resolver is structurally a controller — a method on a container-resolved class with typed arguments and a typed return — so this should be a second front end over machinery that already exists rather than a second framework.

That claim holds, and holding it is a constraint on every decision below: `Container`, `Chain`, `runChain`, `Symbol.metadata` and the module graph are reused as they are, and where the existing shape does not fit, the shape is named rather than duplicated.

## 1. The decorators, and the two things the issue's API surface cannot be

```ts
export declare function Resolver(typeName?: string): (target: Function, context: ClassDecoratorContext) => void;
export declare function Query(name?: string): (target: Function, context: ClassMethodDecoratorContext) => void;
export declare function Mutation(name?: string): (target: Function, context: ClassMethodDecoratorContext) => void;
export declare function ResolveField(name?: string): (target: Function, context: ClassMethodDecoratorContext) => void;
export declare function getResolverFields(cls: abstract new (...args: never[]) => unknown): readonly ResolverField[];

export interface ResolverField {
  readonly typeName: string; // 'Query', 'Mutation', or the class's @Resolver name
  readonly field: string;
  readonly methodName: string;
}
```

Stored in `Symbol.metadata` under module-private symbols, read back through the existing type guard, exactly as
`routing/index.ts` stores `ROUTES` and `PREFIX`. **`metadataOf` needs no change** — it returns the record and
this module declares its own slots, which is what "one metadata story covers both front ends" already means. A
new registry would be a second place a decorated class can be remembered, and the two would disagree for any
class that was decorated but not registered.

Two departures from the issue's API block, both forced:

**There is no `@Args`, because there are no parameter decorators.** `packages/web/src/context/index.ts:22` states the reason as a design note on `Ctx` itself — "Stage 3 has no parameter decorators, so params/body/query /headers arrive on one strongly-typed context object" — and it is not a limitation this package can route around: `Args(): ParameterDecorator` is a TypeScript-experimental-decorators type, and this codebase proves it uses ES decorators everywhere (`Inject` is a `ClassFieldDecoratorContext`, the verbs are `ClassMethodDecoratorContext`).

Arguments therefore arrive the way a body does, on the one context object (§2).

**No decorator takes a thunk.** `Resolver(of?: () => unknown)` and `Query(returns?: () => unknown)` are the code-first idiom of a library whose types are classes with runtime metadata; `() => Post` there evaluates to a constructor the schema builder reads.

Here `Post` is an `interface` — there is nothing to return and nothing to read, which is the same reason `web-graphql-mapped-types.md` gives for there being no `PartialType`. So `@Resolver` takes the SDL type name as a string, and a field's type comes from the declaration the SDL was emitted from:

```ts
interface PostQueries {
  post: { args: { id: number }; result: Entity<Post> | null };
  posts: { args: { limit?: number }; result: readonly Entity<Post>[] };
}

@Resolver()
class PostResolver implements ResolversOf<PostQueries, AppContext> {
  @Inject(POSTS) private readonly posts!: PostRepo;

  @Query()
  async post(ctx: GqlCtx<undefined, { id: number }, AppContext>) {
    return (await this.posts.findById(ctx.body.id)) ?? null;
  }

  @Query()
  async posts(ctx: GqlCtx<undefined, { limit?: number }, AppContext>) {
    return (await this.posts.list({ page: { limit: Math.min(ctx.body.limit ?? 20, 100) } })).items;
  }
}
```

`ResolversOf<F, R>` is the whole type-checking story, and it is ordinary TypeScript:

```ts
export type ResolversOf<F, R extends GqlRequest> = {
  readonly [K in keyof F]: (ctx: GqlCtx<ParentOf<F, K>, ArgsOf<F[K]>, R>) => ResultOf<F[K]> | Promise<ResultOf<F[K]>>;
};
```

`implements ResolversOf<PostQueries, AppContext>` is where a resolver that disagrees with the SDL fails to
compile, naming the method — and it is total, because `sdlFields<PostQueries>('Query')` emitted the SDL from the
same declaration. There is no generated file, no snapshot, and nothing to regenerate.

The `@Inject` field above is the canonical DI spelling (`web-di.md`): a class field, since `Container.build`
constructs with a zero-argument constructor and satisfies fields from the active container.

## 2. `GqlCtx` is a `Ctx`, and its `body` is the arguments

```ts
/** What the app's per-request context must carry. Everything else on it is the app's. */
export interface GqlRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly path: string;
}

export interface GqlCtx<Parent, Args, R extends GqlRequest> extends Ctx<
  Record<never, string>,
  Args,
  Record<never, string>
> {
  readonly parent: Parent;
  readonly request: R;
  readonly typeName: string;
  readonly field: string;
  readonly fieldPath: readonly string[];
  readonly operation: 'query' | 'mutation' | 'subscription';
}

export declare function gqlRequestFrom(ctx: Ctx<Record<string, string>, unknown, QueryValues>): GqlRequest;
```

**`GqlCtx` extends `Ctx` so that the existing chain applies with no change to it.** `Guard.canActivate` takes
`Ctx<Record<string, string>, unknown, QueryValues>`; a guard that reads `ctx.headers.authorization` is then one
guard, usable on a route and on a field, which is what the epic means by reusing the chain rather than
duplicating it. Widening `Guard` to a union of two context types would have meant editing every guard anyone
has written, to make the GraphQL case possible.

**`body` is the arguments, and there is no separate `args` field.** `runChain` folds the pipes over `ctx.body` and hands the handler `{ ...ctx, body }`, so a validation pipe works on a field's arguments unchanged — and a second name for the same value would be the pre-pipe value, still visible, still readable, silently stale.

The spread also carries `parent`, `request` and `field` through untouched, which is why the resolver still has them after the chain has run. `params` and `query` are empty: a GraphQL request has no path parameters and its query string is not input.

`operation`'s third member arrived with `subscriptions/SPEC.md` §4, which extends `GqlCtx` rather than
declaring a fourth context type. A query's narrowing is unaffected; `#552` pins that.

`#539` pins the assignability in a type-test (`a GqlCtx is accepted by runChain`). If it does not hold,
`AnyCtx`'s `params` is the thing to widen, in `middleware/index.ts` — one line, in the file that owns the
question.

The runtime half of the preceding paragraph is true as written; the _type_ half needs `runChain` to be generic,
because `ChainHandler`'s parameter is `AnyCtx` and that erases `parent`. §10.3 has the signature.

## 3. Every field validates its arguments, and the type is what guarantees it

Registration mirrors `Router.register(controller, options)`, including the per-method options record:

```ts
export interface GraphqlRegistry {
  register<F>(resolver: object, bindings: ResolverBindings<F>): void;
  parts(): { readonly typeDefs: string; readonly resolvers: ResolverMap };
}

export type ResolverOptionsFor<A> = [keyof A] extends [never]
  ? { readonly chain?: Chain }
  : { readonly chain?: Chain; readonly validate: (raw: unknown) => A };

export type ResolverBindings<F> = { readonly [K in keyof F]: ResolverOptionsFor<ArgsOf<F[K]>> };
```

```ts
registry.register<PostQueries>(container.build(PostResolver), {
  post: { validate: raw => assert<{ id: number }>(raw), chain: authed },
  posts: { validate: raw => assert<{ limit?: number }>(raw) },
});
```

`validate` is **required by the type** for every field that has arguments, and the epic's "no path around it" is therefore not a runtime check that could be skipped — it is a compile error at the registration site.

The validator is the caller's for the reason `packages/schema-core/src/llm/chat/SPEC.md` §3 and `.../llm/adapters/SPEC.md` §2 give at length: `assert<T>` is inlined where the checker can resolve `T`, and inside a published generic there is no `T` to resolve, so a framework that offered to validate for you would fall back to a runtime walk — which §2.2 forbids anyway.

`[keyof A] extends [never]` degrades in the safe direction, like `HasEffectful<R>` in the chat loop: an `args`
type that widened to a record still has keys, so `validate` stays required. Only a declaration that genuinely
says "no arguments" relaxes it.

Two boot-time checks close the loop between the declaration and the class, because `keyof F` is a compile-time
set and the decorated methods are a runtime one:

1. **Every decorated method has a binding, and every binding has a decorated method.** `register` compares
   `getResolverFields(ctor)` with `Object.keys(bindings)` and throws on either difference, naming the field. A
   method someone decorated and forgot to bind would otherwise be a field with no validator; a binding with no
   method would be a field that is in the SDL and always null.
2. **A class with a `@ResolveField` must name its type in `@Resolver`.** There is no default: a field resolver
   without a parent type is not a thing, and guessing `Query` is how a field resolver silently becomes a root
   query.

Combined with `ResolverBindings<F>` requiring exactly `keyof F`, those checks make the metadata set, the
bindings set and the declaration one set — which is what stops the SDL and the runtime from drifting without
either being generated from the other.

## 4. `@ResolveField`, the parent, and the collisions that are refused

A field resolver receives the parent's resolved value on `ctx.parent`, typed by the declaration:
`sdlFields<PostFields>('Post')` where `PostFields` is `{ author: { args: …; result: Entity<User> } }` gives
`ParentOf` = the object type `Post` was emitted from. The engine passes the value the parent field's resolver
returned, so `ctx.parent` is a row when the parent was a repository read — not a copy, and not a promise.

Four cases, three of them refusals, all resolved at boot rather than at request time because all four are
decidable from the SDL type's declaration plus `getResolverFields`:

| Case                                                       | Answer                                 |
| ---------------------------------------------------------- | -------------------------------------- |
| `@ResolveField('author')` where `author` is a **relation** | the expected case — bound              |
| `@ResolveField('title')` where `title` is a **column**     | **refused at boot**                    |
| `@ResolveField('slug')` where the type has no such field   | **refused at boot**                    |
| an emitted **relation** field with no `@ResolveField`      | **refused at boot** (sdl `SPEC.md` §6) |

The column case is the one the issue asks about, and refusal is the answer rather than a precedence rule.
Either precedence is defensible in isolation and indefensible in practice: if the property wins, the resolver
is dead code that looks alive; if the resolver wins, it shadows a column that a `select` still fetches, so the
cost is paid and the value discarded, and a reader comparing the SDL with the table finds nothing wrong. The
diagnostic names both:

```
@zmdb/web: PostResolver.title resolves `Post.title`, which is already a column of the type `Post` was emitted
from. A field resolver may only implement a relation field. Rename the field, or remove the column from the
emitted type with `Omit`.
```

`Omit` in that suggestion is the §10 point of the SDL spec being live: hiding a column and resolving a field of
the same name is expressible, in one place, as a type.

## 5. Authorisation is per field, and the framework does not pretend otherwise

`web-graphql-resolvers.md` calls this the trap, and it is right: a client can reach `Post.author` without going
through `Query.user`, so a guard on one entry point secures nothing about the type it returns. What the freeze
adds is the mechanical consequence, so nobody expects otherwise:

- A `chain` is per **field**, not per class and not per request. There is no inheritance from a root field to
  the fields of the type it returned; guards do not compose down a traversal, because a traversal is not a
  static structure.
- A field with no `chain` runs no guards. The absence is silent by construction, which is why the page's
  advice — authorise on the field that exposes the data — is the operative rule and not a suggestion.
- `Sensitive` on a column keeps a value out of derived types and documents, not out of a resolver's return.
  `web-mapped-types.md` already says this; it is repeated here because a reader arriving from the SDL side will
  assume a `Sensitive` column cannot be selected as a GraphQL field. It can, if a resolver returns it.

This is also where the boundary to the runtime-controls epic sits. That epic owns the GraphQL execution context as a first-class object, per-field middleware, plugins, complexity limits and directives. This epic owns exactly the seam: `GqlCtx` carries `typeName`, `field`, `fieldPath` and `operation` because a guard needs them to make a decision, and nothing more.

**No `info` object is exposed and none is re-exported** — those four values are read structurally from the engine's fourth resolver argument (`fieldName`, `parentType.name`, `path`), which keeps `GraphQLResolveInfo` from becoming part of this package's surface before the epic that owns it decides what it should look like.

## 6. An executable schema, with no dependency on the engine

`parts()` returns SDL text and a plain resolver map — `{ Query: { post(…) }, Post: { author(…) }, DateTime: … }` — which is what `createSchema`, `makeExecutableSchema` and `buildSchema` plus `execute` all consume.

So `graphql` is **not** a dependency, not a peer dependency and not an optional peer, which is stricter than the epic's constraint list and is the position `packages/schema-core/src/llm/adapters/SPEC.md` §1 already took for LangChain and the AI SDK. `web-graphql-resolvers.md`'s "it would be an optional entry point with a peer dependency" is superseded: there is nothing to peer on.

The one thing that genuinely needs the engine's class is a custom scalar, and it is **injected**:

```ts
export interface ScalarTypeConstructor {
  new (config: {
    readonly name: string;
    readonly serialize: (value: unknown) => unknown;
    readonly parseValue: (value: unknown) => unknown;
    readonly parseLiteral: (node: unknown, variables?: Readonly<Record<string, unknown>>) => unknown;
  }): unknown;
}

export declare function createGraphqlRegistry(opts: {
  readonly types: readonly string[]; // sdlOf / sdlFields output
  readonly scalars?: readonly ScalarDefinition[];
  readonly scalarType?: ScalarTypeConstructor; // required iff `scalars` is non-empty
  readonly subgraph?: { readonly version: string }; // federation/SPEC.md §6
}): GraphqlRegistry;
```

The caller passes their own `GraphQLScalarType`, one line, no version range — the same injection
`aiSdkTool`'s `jsonSchema` uses in `.../llm/adapters/SPEC.md` §4 and for the same reason: the value has to be
an instance of a class only the consumer's copy of the library can construct.

`types` is a list of strings and the registry concatenates them, **de-duplicating by definition name and
refusing when two definitions share a name and differ**. That is the collision check the SDL spec's §4.1 defers
to a builder, and it is where two `sdlOf` calls that each emitted a shared `Address` meet.

Nothing in this package serves `/graphql`. The transport is a controller the application writes — a
`@Post('/graphql')` that parses the request, calls the engine and returns `json(result)` — for the reason
`packages/schema-core/src/llm/mcp/SPEC.md` §1 gives for MCP: a shipped endpoint would have to invent an
authentication model, and here it would additionally have to choose an engine. `web-graphql-resolvers.md`
already shows the composition, one container behind both surfaces, and it stays the recommended shape.

## 7. Errors: a field failure is a field failure

A resolver's throw must become a GraphQL error entry, not an HTTP status. The HTTP response stays `200` — a
partial result with an `errors` array is the protocol's own shape, and turning one denied field into a `403`
for the whole document hides every field that succeeded.

The wrapper catches, offers the error to the chain's `ExceptionFilter`s (which is where an application's
existing mapping is), and then throws a `GqlError` the engine surfaces:

```ts
export class GqlError extends Error {
  readonly extensions: { readonly code: string; readonly status?: number };
}
```

| Thrown                                         | `extensions.code`       | Message                     |
| ---------------------------------------------- | ----------------------- | --------------------------- |
| `ChainError(403)` — a guard returned `false`   | `FORBIDDEN`             | the chain's message         |
| `ChainError(400)` — a pipe or `validate` threw | `BAD_USER_INPUT`        | the validation paths (§7.1) |
| a filter returned a `WebResponse`              | derived from its status | its `body`                  |
| anything else                                  | `INTERNAL_SERVER_ERROR` | `internal error (<8 hex>)`  |

### 7.1 What crosses to the client, and what does not

The rule is `packages/schema-core/src/llm/chat/SPEC.md` §6's, applied to a different boundary because the
exposure is identical — a message assembled from an exception, sent to something outside the program:

- A validation failure yields the **paths and expectations** via `validationIssuesOf(error)`, and **never
  `ValidationIssue.value`**. The client needs to know which argument was wrong; echoing what they sent adds
  nothing and is the cheapest accidental exfiltration path there is when the same error type is used for
  values read from a row.
- Anything else yields exactly `internal error (<errorId>)`: no message, no class name, no stack. An exception
  in this codebase can carry a table name, a column list or compiled SQL, and a GraphQL error entry goes
  straight into a client's console.
- `errorId` is 8 hex from `globalThis.crypto.getRandomValues` — the Web Crypto route `.oxlintrc.json`
  requires — and the original error is attached as the `GqlError`'s `cause`, so a server-side error handler
  (`maskedErrors`, `onError`, a filter) can join the id to the real failure. Nothing here logs: `@zmdb/web`
  owns no stream, and the join is what makes that affordable.

An `ExceptionFilter` returning a `WebResponse` in a field context has its `body` used as the message. That is
not a new exposure — the same string already goes to an HTTP client from the same filter — but it is worth
stating, because a filter written for HTTP with an HTML body will produce a strange GraphQL error.

## 8. The chain is wired here first, and what that means

`createApp` registers controllers with the router and **never calls `runChain`**: `Chain` and `runChain` exist,
are exported and are tested (`dto-pipes.spec.ts` drives them directly), but nothing in the HTTP dispatch path
applies one, and `middleware/SPEC.md`'s promised `applyChain(route, chain)` helper does not exist. So the
GraphQL front end is the first caller of `runChain` inside the framework.

That is worth naming rather than quietly relying on, in both directions: it means the chain-reuse tests
(#539) are the first end-to-end exercise of `runChain` in a dispatch path, and it means the asymmetry — fields
can carry a chain, routes still cannot — is a gap in the HTTP side, not a GraphQL design. Closing it is
`applyChain`'s job, in the epic that owns routing; this epic must not grow a second chain runner while waiting.

Also settled here, because it changes two of #539's test titles and the epic's fifth Definition-of-Done item:
schema-first generation is refused (`packages/schema-core/src/sdl/SPEC.md` §11). The replacements:

- `generates resolver signature types from an SDL document` becomes
  `reports every field where an external SDL document and the emitted schema disagree`, over `sdlDiff`.
- `fails to compile when a resolver disagrees with the SDL` **stays**, and moves to
  `graphql.type-test.ts` over `implements ResolversOf<F, R>` — the disagreement is a compile error at the
  resolver class, which is exactly where the issue asked for it to surface.
- `derives a PartialType SDL input consistent with the DTO family` becomes
  `derives an SDL input from Partial<CreateDTO<T>> consistent with the DTO family`.

## 9. What #539 has to assert on this side

1. `resolves a query through a container-resolved resolver class` — built with `container.build`, its
   `@Inject` field satisfied, against the real `graphql` engine rather than a stub.
2. `validates arguments before the resolver runs` — the resolver is a spy and its call count is zero for a bad
   argument, and the error entry's `extensions.code` is `BAD_USER_INPUT`.
3. `runs guards, pipes, interceptors and filters from the existing chain` — one test per kind, asserting the
   observable behaviour of `runChain` (guard `false` → the handler never runs; a pipe's transform is what the
   resolver's `ctx.body` contains) so a reimplementation fails them.
4. `resolves a field with @ResolveField, receiving the parent value` — by identity, so nothing copies the row.
5. Each row of §4's table: a field resolver over a column refuses at boot, over an unknown field refuses, and
   a relation field with no resolver refuses — every one naming the field.
6. The binding/metadata mismatch throws in both directions, and `ResolverBindings<F>` requires `validate` for
   a field with arguments and permits its absence for one without — the second half in
   `graphql.type-test.ts`, including that a widened `args` type keeps it required.
7. A resolver that throws produces one error entry matching `internal error (<8 hex>)` with the original error
   reachable as `cause`, and a validation failure's message contains the argument path and **not** the value,
   for a value chosen to be recognisable if it leaked.
8. Two `sdlOf` results that both emit `Address` compose; two that emit different `Address` definitions refuse.
9. `a GqlCtx is accepted by runChain` — the assignability §2 depends on, pinned so it cannot regress silently.

## 10. The execution context: one shared request type, one discriminant, one generic runner

`#544` asks for a `GraphQLExecutionContext` carrying `kind`, `parent`, `args`, `info` and `request`. Four of the
five are already frozen: `parent` is `parent`, `args` is `body` (§2), `request` is `request`, and `info` is
refused (§5 — four flat values instead). So this section is not a new type. It is the three changes the
_existing_ type needs before a guard can be written once and used on both sides, which is what the ask is for.

### 10.1 `RequestFacts`, so the shared part has a name

```ts
/** In `context/index.ts`: what both an HTTP request and a GraphQL request carry. */
export interface RequestFacts {
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly path: string;
}

export interface Ctx<Params, Body, Query> extends RequestFacts {
  readonly kind: 'http' | 'graphql';
  readonly params: Params;
  readonly body: Body;
  readonly query: Query;
}
```

`GqlRequest` (§2) becomes an alias of `RequestFacts` rather than a second declaration of the same three
members. Structurally nothing changes — they were already identical, which is the problem: a guard's helper
function had no name to accept, so it had to take a whole `AnyCtx` or restate the three fields inline. Naming
the shared part is the smallest change that makes `function bearer(r: RequestFacts): string | undefined`
writable, and §2's refusal of a widened `Guard` stands: nothing about `Guard.canActivate`'s parameter moves.

### 10.2 The discriminant is a field, checked with a predicate

```ts
export type AnyGqlCtx = GqlCtx<unknown, unknown, RequestFacts>;
export declare function isGqlCtx(ctx: AnyCtx): ctx is AnyGqlCtx;
```

`kind` is `'http'` for every context `pipeline/index.ts` builds and `'graphql'` for every one the registry
builds, and `isGqlCtx` is `ctx.kind === 'graphql'` — a field comparison, not `instanceof` and not
`'parent' in ctx`. `instanceof` fails because both are object literals with no class; the `in` check fails
because a route whose body happens to have a `parent` property would answer yes.

**`kind` narrows but the union is not declared.** A guard's parameter type stays `AnyCtx`, and `isGqlCtx`
narrows to `AnyGqlCtx` inside the branch. Declaring `type SomeCtx = AnyCtx | AnyGqlCtx` and typing
`canActivate` on it is the alternative, and it is exactly what §2 refused: every existing guard's parameter
would have to be re-narrowed before touching `params`. A predicate gives the same narrowing at the one call
site that needs it and costs the other guards nothing.

`AnyCtx` is currently declared at `middleware/index.ts:8` and **not exported**. It becomes exported, because
`isGqlCtx`'s signature names it and a guard that wants to write a helper over it needs it too.

### 10.3 `runChain` becomes generic, and this is a correctness fix

`ChainHandler = (ctx: AnyCtx) => unknown` and `const pipedCtx: AnyCtx = { ...ctx, body }` are both `AnyCtx`, so
although the spread carries `parent`, `request` and `field` through at runtime — §2 says so, and it is true —
the **type** the handler receives has lost them. A resolver reached through the chain would not compile against
`ctx.parent`. §2's claim is therefore only half-true today, and the fix is in `middleware/index.ts`:

```ts
export type Piped<C extends AnyCtx> = Omit<C, 'body'> & { readonly body: unknown };

export declare function runChain<C extends AnyCtx>(
  chain: Chain,
  ctx: C,
  handler: (ctx: Piped<C>) => unknown,
): Promise<WebResponse | unknown>;
```

`body` widens to `unknown` because that is what the pipes did to it — a pipe's `transform` returns `unknown`,
so claiming the handler still gets `C['body']` would be a lie in the other direction, and the resolver's
`assert` is what narrows it back. Everything else on `C` survives, which is precisely the guarantee §2 needs.

If the checker refuses `{ ...ctx, body }` as `Piped<C>` — a spread of a generic is not provably the mapped
type — **one `as Piped<C>` is permitted, with a comment naming the boundary**, following the existing
`page.after as Record<string, unknown>` precedent in `repository/src/index.ts`. `#545` pins the outcome with a
type-test rather than the implementation: a `GqlCtx` in, a handler whose `ctx.parent` is the parent type.

The HTTP call site is unaffected — `C` infers to `AnyCtx` there and `Piped<AnyCtx>` is `AnyCtx`.

## 11. The field chain: three declared layers, one flattened chain, and a budget

Middleware is declared at three levels and **flattened once, at `register()`**, into exactly one `Chain` per
field:

```ts
export interface ResolverMiddleware {
  readonly global?: Chain;
  readonly perType?: Readonly<Record<string, Chain>>;
}
```

`perField` is not a fourth option — it is the `chain` already on `ResolverOptionsFor<A>` (§3), so a field's own
middleware is declared next to its `validate`, in the same record, and nothing has to agree about a field's
name in two places.

Order, and it is not symmetric:

| Kind           | Concatenation order   | Why                                                                                                    |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `guards`       | global → type → field | The broadest check runs first and refuses cheapest.                                                    |
| `pipes`        | global → type → field | A field's pipe sees what the type's pipe produced.                                                     |
| `interceptors` | global → type → field | Outermost wraps: a global timer measures the field's work.                                             |
| `filters`      | field → type → global | `runChain` takes the first filter that returns a response, so the most specific must be reached first. |

The `filters` reversal is the one thing here a reader would get wrong, and getting it wrong is silent: a global
catch-all placed first would swallow every error before a field's own filter ever saw it, and the tests would
still pass because _something_ handled it. Stated here, and asserted by `#545`.

**A field with no chain in any layer gets no wrapper at all.** The resolver map holds the bound method itself,
so `resolvers.Post.author === boundMethod` — assertable by identity, which is a stronger statement than
measuring how fast a wrapper is. This matters because most fields on a large schema have no middleware, and a
per-field wrapper on all of them is the cost the epic's performance step is worried about.

The budget is stated in **allocations per field invocation**, not microseconds:

| Field            | Allocations                                      |
| ---------------- | ------------------------------------------------ |
| no chain         | 0 (the bound method is called directly)          |
| a guard only     | 1 — the `GqlCtx`                                 |
| pipes            | 2 — the `GqlCtx`, and `pipedCtx`                 |
| _n_ interceptors | the above, plus one closure and one promise each |

The guard-only row requires a change in `middleware/index.ts`: skip the `{ ...ctx, body }` spread when
`pipes.length === 0` and pass `ctx` through. Today the spread is unconditional. A count is chosen over a
duration because it is hardware-independent and a test can actually check it; a microsecond target in a spec
is a number that rots on the next machine.

The wall-clock claim, where one is needed, is a **ratio** measured by the existing `benchmarks/` harness: a
guard-only field must add **less than 5%** to a 100-item list against an in-memory driver. Ratios survive a
change of machine; absolute numbers do not.

One flattening, memoised: `chainFor('Post', 'author') === chainFor('Post', 'author')`, so the arrays are
concatenated at boot and never per request.

## 12. Plugins: the hook set is empty, and that is the finding

`#544` asks for a `ServerPlugin` lifecycle. Working backwards from step 4's own rule — a hook with no consumer
does not ship — every hook that could go on it is impossible here, someone else's, or a duplicate of something
that already exists:

| Proposed hook                          | Verdict                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onParse(document)`                    | Impossible — nothing in this package parses. §6: the app calls `parse`.                                                                                             |
| `onValidate(rules: ValidationContext)` | Impossible without the dependency — `ValidationContext` is a `graphql` class.                                                                                       |
| `onRequest` / `onResponse`             | The app's, and already available — its transport controller is where it mounts, and that controller is an ordinary `@zmdb/web` route with the ordinary chain on it. |
| `onExecute(ctx, next)`                 | A duplicate — that signature **is** `Interceptor.intercept(ctx, next)`.                                                                                             |
| `onComplexity`                         | Not a hook — `complexityOf` is called by the app between `parse` and `execute` (`complexity/SPEC.md` §1).                                                           |

**So `ServerPlugin` is refused entirely**, and `#544`'s third requirement is met by that refusal rather than by
an interface: there is nothing a plugin could observe that an interceptor, a filter or the app's own route
cannot, and a second extension mechanism aliasing the first is how two ways to do one thing get documented,
diverge, and then disagree about ordering.

An `apollo-server` or `envelop` plugin still works, unchanged, because it plugs into the engine the app
constructed. That is a feature of not owning the transport, not a gap.

## 13. Directives: one emitted, one mechanism for behaviour

Three kinds of directive get three different answers.

**`@deprecated(reason:)` is emitted**, and it is the only one. It comes from a new tag, so the SDL and the
declaration cannot disagree:

```ts
/** In `@zmdb/schema-core/tags`. */
export type Deprecated<Reason extends string> = { readonly __deprecated?: Reason };

export interface Post extends Table<'posts'> {
  legacySlug: string & Sql<'text'> & Deprecated<'use `slug`'>;
}
```

→ `legacySlug: String! @deprecated(reason: "use \`slug\`")`. This is a cross-package addition: the tag in
`schema-core/tags`, the emission in the SDL walk (`schema-core/src/sdl/SPEC.md`). It is the one directive worth
the reach because it is pure schema — it changes what the document says and requires nothing at runtime.

**A directive with runtime behaviour is an interceptor.** `@upper`, `@auth`, `@rateLimit` — each is a function
that wraps a field's resolution, which is `Interceptor` with `runChain` already calling it in the right place
(§11). There is no directive visitor: transforming a built schema is `mapSchema` from `@graphql-tools`, a
dependency §6 gave up, and re-implementing schema transformation to get a second spelling of the interceptor
we already have is work with a negative payoff.

**A directive definition an app needs in its SDL travels as text.** `createGraphqlRegistry({ types })` already
takes SDL strings and concatenates them (§6), so `directive @auth(role: String!) on FIELD_DEFINITION` is one
more string in that array. No new API, and the app's engine — which is the thing that would enforce it — sees
it.

`@Complexity` is the exception that proves the rule:

```ts
export declare function Complexity(
  cost: number | ((args: Readonly<Record<string, unknown>>) => number),
): (target: Function, context: ClassMethodDecoratorContext) => void;
```

It populates the cost table (`complexity/SPEC.md` §3) and **emits nothing into the SDL**. A `@cost` directive in
the emitted schema that no zmdb code reads is exactly the "schema that lies" this file's non-goals already
refuse — worse here than elsewhere, because a reader would take an unenforced `@cost` for a limit. Note the
signature: an ES class-method decorator, `(target, context)`, not `MethodDecorator`; the legacy form does not
exist in Stage 3 and typing it that way would not compile.

## 14. Introspection is the engine's switch, and the committed SDL is the better answer

`#544` lists disabling introspection as a control. It is not one that can live here: turning it off is
`useDisableIntrospection`, or a `validationRule`, or the schema the app built — all of them on the engine's
side of §6's boundary. Declaring an `introspection: false` option that this package cannot enforce would be a
setting that reads as protection and provides none.

What is offered instead is two things that are ours. Introspection is **costed** rather than switched
(`complexity/SPEC.md` §6: a flat charge per `__schema`/`__type` root, multiplied, so the aliased-introspection
amplification is closed). And the emitted `schema.graphql` is a **committed file**
(`schema-core/src/sdl/SPEC.md` §11), so the legitimate reason to leave introspection on in production — clients
and tooling need the schema — disappears: they read it from the repository, at a version, without asking the
server.

## 15. What #545 has to assert on this side

1. `narrows a context with isGqlCtx` — true for a registry-built context, false for a router-built one, and a
   route context carrying a `body.parent` property still false (§10.2's duck-typing trap).
2. `a chained resolver still sees parent, request and field` — in `graphql.type-test.ts` over
   `Piped<GqlCtx<…>>`, and at runtime through a real chain. This is the §10.3 fix; without it the type-test
   fails to compile.
3. `runChain does not allocate a piped context when there are no pipes` — the guard-only row of §11's table,
   asserted by identity (`handler` received the same object reference that was passed in).
4. `a field with no chain in any layer is the bound method itself` — `parts().resolvers` identity, so no
   wrapper can creep back in.
5. `flattens global, per-type and per-field middleware in order` — one recording guard per layer, asserting
   `['global', 'type', 'field']`, and one recording filter per layer asserting the **reverse**. Two tests, and
   the second is the one that catches §11's asymmetry.
6. `memoises the flattened chain per field` — `chainFor` returns an identical reference twice.
7. `a guard-only field adds less than 5% to a 100-item list` — in `benchmarks/`, as a ratio against the same
   query with no chain.
8. `emits @deprecated from the Deprecated tag` — over `sdlOf`, including that the reason string is escaped
   into the SDL, and that a field with no tag emits no directive.
9. `@Complexity populates the cost table and emits nothing` — both halves in one test, because the second is
   the part a future change would break silently.
10. `there is no ServerPlugin export` — over `verify:exports`, so §12's refusal is enforced rather than
    documented; and `onExecute`-shaped behaviour is demonstrated as an `Interceptor` instead.
11. `there is no introspection option` — the same shape, for §14.

## 16. Non-goals (rejected)

- **No `@Args`, and no parameter decorators.** §1 — ES decorators have none, which is why `Ctx` exists.
- **No thunks in the decorators.** §1 — there is no runtime type to return.
- **No `graphql` dependency or peer dependency.** §6 — text plus a plain map, and an injected constructor for
  the one class that needs one.
- **No `/graphql` endpoint.** §6 — the transport needs the app's authentication and choice of engine.
- **No `info` object, and no `GraphQLResolveInfo` on the surface.** §5 — four values, read structurally; the
  execution context belongs to the runtime-controls epic.
- **No request-scoped DI.** `Scope` is `singleton | transient`. A per-request value — a dataloader scope above
  all — travels on the app's own context object, which the engine already builds once per request; that is
  the seam the dataloaders epic's `LoaderScope` drops into with no coordination, and
  `web-graphql-resolvers.md`'s warning about a module-level loader is why it must not be a provider.
- **No guard inheritance down a traversal.** §5 — a traversal is not a static structure, and pretending
  otherwise is how a field is believed to be protected.
- **No second chain runner, and no `applyChain` here.** §8 — that helper belongs to the routing side.
- **No subscriptions and no federation _here_.** Both are frozen next door —
  `subscriptions/SPEC.md` and `federation/SPEC.md` — and both extend this surface rather than replacing any of
  it: `SubCtx` extends `GqlCtx`, a subscription's chain is §11's chain, and a subgraph's directives are one
  more thing the same SDL walk emits. What they add to this file is one widened union (§2's `operation`) and
  one registry option (§6's `subgraph`).
- **No `ServerPlugin`, and no plugin lifecycle.** §12 — every hook is impossible here, the app's, or an
  `Interceptor` under another name.
- **No directive visitor, and no `@cost` in the SDL.** §13 — schema transformation is `@graphql-tools`, and a
  directive the emitter writes that nothing enforces is a schema that lies.
- **No `introspection` option.** §14 — an engine flag this package cannot enforce.
- **No declared `AnyCtx | AnyGqlCtx` union.** §10.2 — it would force every existing guard to re-narrow, which
  is what §2 refused. A predicate narrows at the one site that needs it.
- **No `info`, no `args`, and no `GraphQLExecutionContext`.** §5 and §10 — `GqlCtx` is that type, four of its
  five requested members already exist under the names the rest of the package uses.
- **No complexity enforcement inside this package.** `complexity/SPEC.md` §1 — the limit is checked between
  `parse` and `execute`, both of which the app owns, so the call is the app's and the absence of one is
  documented rather than papered over.
- **No dataloader.** The request-scope bullet above — the caching epic owns batching, and this epic owns only
  how a field resolver reaches one.
