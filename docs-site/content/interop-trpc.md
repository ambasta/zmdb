tRPC gives you end-to-end typed RPC with no code generation. zmdb gives you typed data access and typed HTTP. They overlap on the HTTP layer and complement each other everywhere else — using tRPC for
transport and zmdb for the data layer is a sensible architecture.

## zmdb as tRPC's data layer

The clean combination. tRPC owns routing and the client type; zmdb owns the schema, queries and validation:

```ts
import { initTRPC } from '@trpc/server';
import { assert } from '@zmdb/aot-validator/utilities';
import type { CreateDTO, ListDTO } from '@zmdb/repository';

const t = initTRPC.context<{ postRepo: PostRepo }>().create();

export const appRouter = t.router({
  list: t.procedure.input((raw: unknown) => assert<ListDTO<Post>>(raw)).query(({ input, ctx }) => ctx.postRepo.list(input)),

  create: t.procedure.input((raw: unknown) => assert<CreateDTO<Post>>(raw)).mutation(({ input, ctx }) => ctx.postRepo.create(input)),
});
```

Two things to notice. `.input()` accepts any parser function, so `assert<T>` drops in where a Zod schema would go — no adapter needed. And `CreateDTO<Post>` and `ListDTO<Post>` are _derived_ from the
schema, so the procedure's input type tracks the table. Adding a required column is a type error in the procedure, not a runtime rejection.

> [!WARNING] If the [transformer is not running](./aot-setup.html), that `.input()` parser returns the input unchanged and validates nothing — while tRPC's types still claim it is validated. Under
> tRPC this is worse than usual, because the typed client makes unvalidated input feel safe. Add the canary test.

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

## tRPC or `@zmdb/web`?

If you are choosing between them for the HTTP layer:

|                              | tRPC                    | `@zmdb/web`                              |
| ---------------------------- | ----------------------- | ---------------------------------------- |
| Client types                 | inferred, no generation | via [OpenAPI](./openapi.html) generation |
| Public REST API              | needs `trpc-openapi`    | native — controllers _are_ REST          |
| Non-TypeScript consumers     | poor fit                | fine                                     |
| Dependency-injected services | DIY in context          | [built-in container](./web-di.html)      |
| Runtime dependencies         | `@trpc/server`          | zero                                     |
| Streaming responses          | yes                     | yes — `stream()` / `ReadableStream`      |
| Subscription protocol        | built in                | application-owned                        |
| Class + decorator style      | no                      | yes                                      |

The sensible split: tRPC for an internal TypeScript-to-TypeScript API where the inferred client is the whole point; `@zmdb/web` for a public REST API where OpenAPI is the contract and consumers are
not all TypeScript.

tRPC's subscription protocol remains a real advantage: `@zmdb/web` can stream a response body, but it does not define subscription routing, reconnection or a client protocol.

## Both, side by side

Common and fine — mount each on its own path:

```ts
if (url.pathname.startsWith('/trpc')) return trpcHandler(request);
return app.fetch(request);
```

Share the repositories, not the HTTP concerns. One data layer, two transports.

## Mounting tRPC's context on the container

Build the context from zmdb's DI so both halves share providers:

```ts
const app = createApp(AppModule);
await app.init();

const createContext = () => ({
  postRepo: app.container.resolve(POSTS),
  userRepo: app.container.resolve(USERS),
});
```

## Migrating from tRPC to `@zmdb/web`

Procedure-by-procedure. A query becomes a `@Get`, a mutation a `@Post`; `.input()` becomes `assert<T>(ctx.body)`; context becomes an injected field (`@Inject`, never a constructor parameter). The part
you lose is the inferred client — generate one from [OpenAPI](./openapi.html) instead, which is a build step where tRPC had none. Do not migrate subscriptions; there is nowhere for them to go yet.

---

See also: [OpenAPI Generation](./openapi.html) · [DI Container](./web-di.html) · [Streaming](./streaming.html)
