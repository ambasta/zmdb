# SPEC — resolvers, binding and execution (frozen)

Part of `@zmdb/web`, a new `./graphql` subpath. The resolver half of the GraphQL core epic:
`packages/schema-core/src/sdl/SPEC.md` freezes the SDL a type produces, and this freezes what runs when a
client asks for a field.

The claim the epic makes is that a resolver is structurally a controller — a method on a container-resolved
class with typed arguments and a typed return — so this should be a second front end over machinery that
already exists rather than a second framework. That claim holds, and holding it is a constraint on every
decision below: `Container`, `Chain`, `runChain`, `Symbol.metadata` and the module graph are reused as they
are, and where the existing shape does not fit, the shape is named rather than duplicated.

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

**There is no `@Args`, because there are no parameter decorators.** `packages/web/src/context/index.ts:22`
states the reason as a design note on `Ctx` itself — "Stage 3 has no parameter decorators, so params/body/query
/headers arrive on one strongly-typed context object" — and it is not a limitation this package can route
around: `Args(): ParameterDecorator` is a TypeScript-experimental-decorators type, and this codebase proves it
uses ES decorators everywhere (`Inject` is a `ClassFieldDecoratorContext`, the verbs are
`ClassMethodDecoratorContext`). Arguments therefore arrive the way a body does, on the one context object (§2).

**No decorator takes a thunk.** `Resolver(of?: () => unknown)` and `Query(returns?: () => unknown)` are the
code-first idiom of a library whose types are classes with runtime metadata; `() => Post` there evaluates to a
constructor the schema builder reads. Here `Post` is an `interface` — there is nothing to return and nothing to
read, which is the same reason `web-graphql-mapped-types.md` gives for there being no `PartialType`. So
`@Resolver` takes the SDL type name as a string, and a field's type comes from the declaration the SDL was
emitted from:

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
  readonly operation: 'query' | 'mutation';
}

export declare function gqlRequestFrom(ctx: Ctx<Record<string, string>, unknown, QueryValues>): GqlRequest;
```

**`GqlCtx` extends `Ctx` so that the existing chain applies with no change to it.** `Guard.canActivate` takes
`Ctx<Record<string, string>, unknown, QueryValues>`; a guard that reads `ctx.headers.authorization` is then one
guard, usable on a route and on a field, which is what the epic means by reusing the chain rather than
duplicating it. Widening `Guard` to a union of two context types would have meant editing every guard anyone
has written, to make the GraphQL case possible.

**`body` is the arguments, and there is no separate `args` field.** `runChain` folds the pipes over `ctx.body`
and hands the handler `{ ...ctx, body }`, so a validation pipe works on a field's arguments unchanged — and a
second name for the same value would be the pre-pipe value, still visible, still readable, silently stale. The
spread also carries `parent`, `request` and `field` through untouched, which is why the resolver still has them
after the chain has run. `params` and `query` are empty: a GraphQL request has no path parameters and its query
string is not input.

`#539` pins the assignability in a type-test (`a GqlCtx is accepted by runChain`). If it does not hold,
`AnyCtx`'s `params` is the thing to widen, in `middleware/index.ts` — one line, in the file that owns the
question.

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

`validate` is **required by the type** for every field that has arguments, and the epic's "no path around it"
is therefore not a runtime check that could be skipped — it is a compile error at the registration site. The
validator is the caller's for the reason `packages/schema-core/src/llm/chat/SPEC.md` §3 and
`.../llm/adapters/SPEC.md` §2 give at length: `assert<T>` is inlined where the checker can resolve `T`, and
inside a published generic there is no `T` to resolve, so a framework that offered to validate for you would
fall back to a runtime walk — which §2.2 forbids anyway.

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

This is also where the boundary to the runtime-controls epic sits. That epic owns the GraphQL execution
context as a first-class object, per-field middleware, plugins, complexity limits and directives. This epic
owns exactly the seam: `GqlCtx` carries `typeName`, `field`, `fieldPath` and `operation` because a guard needs
them to make a decision, and nothing more. **No `info` object is exposed and none is re-exported** — those four
values are read structurally from the engine's fourth resolver argument (`fieldName`, `parentType.name`,
`path`), which keeps `GraphQLResolveInfo` from becoming part of this package's surface before the epic that
owns it decides what it should look like.

## 6. An executable schema, with no dependency on the engine

`parts()` returns SDL text and a plain resolver map — `{ Query: { post(…) }, Post: { author(…) }, DateTime: … }`
— which is what `createSchema`, `makeExecutableSchema` and `buildSchema` plus `execute` all consume. So
`graphql` is **not** a dependency, not a peer dependency and not an optional peer, which is stricter than the
epic's constraint list and is the position `packages/schema-core/src/llm/adapters/SPEC.md` §1 already took for
LangChain and the AI SDK. `web-graphql-resolvers.md`'s "it would be an optional entry point with a peer
dependency" is superseded: there is nothing to peer on.

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

## 10. Non-goals (rejected)

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
- **No subscriptions, no federation, no complexity limits, no directives, no per-field middleware, no
  plugins.** Two later epics own those, and a directive whose runtime does not exist is a schema that lies.
- **No dataloader.** The request-scope bullet above — the caching epic owns batching, and this epic owns only
  how a field resolver reaches one.
