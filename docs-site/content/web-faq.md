What maps 1:1 from NestJS, what's deliberately different, and the honest
feature-gap list.

## Maps directly

| NestJS                                  | @zmdb/web                                         |
| --------------------------------------- | ------------------------------------------------- |
| `@Controller`/`@Get`…                   | [same decorators](./web-controllers.html)         |
| Providers / DI                          | [Token + Container](./web-di.html)                |
| `@Module`                               | [`@Module` + `compileModule`](./web-modules.html) |
| Guards / Pipes / Interceptors / Filters | [same four](./web-middleware.html)                |
| Lifecycle (`onModuleInit`…)             | [`OnModuleInit`/`OnShutdown`](./web-app.html)     |
| `@nestjs/swagger`                       | [`toOpenApi`](./web-openapi.html)                 |
| Gateways (WS)                           | [`@Gateway`/`@Subscribe`](./web-gateways.html)    |
| `Test.createTestingModule`              | [`createTestApp`](./web-testing.html)             |

## Deliberately different

- **No `reflect-metadata`** — Stage-3 decorators native; the route table + DI
  graph resolve **once at boot**, zero runtime reflection.
- **No request-scoped providers by default** — request data rides on
  [`Ctx`](./web-injection-scopes.html), not a rebuilt DI sub-tree.
- **No `as`** on the consumer surface — everything is inferred/typed.
- **Responses are transport-neutral descriptors** (`{ status, headers, body }`),
  so the [Node and Fetch adapters](./web-pipeline.html) share one handler.
- **Target ES2026+/ESNext** — no downlevel of decorators in source.

## Honest feature gaps

- [File upload](./web-file-upload.html) (multipart) · [GraphQL](./web-graphql.html) ·
  [Microservices](./web-microservices.html)

Everything else (config, auth, authz, CORS, cookies/sessions, rate limiting,
security headers, caching, logging) is a **pattern on the existing primitives**,
documented in this Guides group rather than a bundled module — so there's no
hidden magic and nothing to reflect.

## Cross-links

- [Overview](./web-overview.html) · [Anti-patterns](./anti-patterns.html) · [Benchmarks](./web-benchmarks.html)
