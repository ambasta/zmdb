# `@zmdb/web` — OpenAPI generation SPEC

> Generate OpenAPI 3.1 from the route table + schema-derived JSON Schemas
> (epic #302). Builds on routing (#252) + schema-core openapi. Frozen.

## Contract

### `toOpenApi(controllers, options?)`

- Input: an array of controller **classes** (or instances), plus `options`:
  - `info?: { title; version }` (defaults provided),
  - `schemas?: Record<routePath, { body?; response? } schema>` — optional
    per-route JSON Schemas produced from `@zmdb/schema-core`'s `toJsonSchema`,
  - `versioning?: VersionStrategy` — the same single path, header or media-type
    strategy passed to `createRouter`,
  - `versionSchemas?: Record<routePath, Record<version, RouteSchemas>>` for the
    header/media representations whose public path is shared.
- Reads each controller's routes via `getRoutes`, and emits an
  **OpenAPI 3.1 document**:
  - `openapi: '3.1.0'`, `info`,
  - `paths`: one entry per route; the zmdb `/users/:id` path is converted to the
    OpenAPI `/users/{id}` form, with a `parameters` entry (`in: 'path'`,
    `required: true`, string) per derived param,
  - request body / responses filled from `options.schemas` when provided.
- **Deterministic**: paths and methods emitted in a stable (sorted) order.

### `serveOpenApi(doc)` (optional)

A tiny helper returning a route handler (`Ctx → the doc`) so an app can expose
`/openapi.json`.

## Invariants

- Generation is **build/boot-time**, pure, and **reflection-free** (reads
  `getRoutes` + provided schemas).
- **No `as`/`any`/`!` on the consumer surface.**

## Acceptance

- `toOpenApi([UsersController])` yields a 3.1 doc whose `paths` include the
  controller's routes with `{param}` path params + a `parameters` array; methods
  are lowercased operation keys; output is deterministic.
- Provided body/response schemas appear under the right operation.
- No consumer-surface `as`; suite + typecheck green.

## `operationId` (frozen — epic "The agent runtime")

`toOpenApi` emits an `operationId` on every operation. Derived form: the lowercased method, then the path with
runs of `/`, `:` and OpenAPI braces replaced by `_`, leading and trailing separators dropped —
`POST /users/:id/roles` becomes `post_users_id_roles`. Deterministic, like the path ordering above; a
collision throws at generation, because two routes with the same method and path is already a routing bug.

There is deliberately no `operationId` override on `RouteSchemas`: that record is keyed only by route path,
so one override would apply to both `GET /users` and `POST /users` and create the duplicate this rule refuses.
An application that needs a different public name post-processes the plain returned document, where the
operation itself — method plus path — is available as the key.

Why a document generator cares: `toolsFromOpenApi`
(`packages/schema-core/src/llm/http/SPEC.md` §5) uses `operationId` as the tool name, and a tool name has to be
stable across regenerations. A renamed tool is a _new_ tool as far as a model is concerned, and it invalidates
the prompt caches that make a tool loop affordable. An `operationId` that is derived from the route rather than
from a counter or a hash changes only when the route does.

Still not emitted: no `query` or arbitrary `header` parameters beyond the
configured version header, no `tags`, and no per-status responses beyond the
`200`. Security and components are implemented by #575 as specified below.

## Out of scope

Auto-deriving schemas from handler signatures. It stays explicit, via `options.schemas` plus schema-core's
`toJsonSchema`.

## Amendments (security schemes and versioning, #573)

At the #573 freeze, guards were not attached to routes. #575 implements the
design below: route guards live in the per-handler options record, while app and
controller guards live in one registry; both are passed unchanged to the router
and document generator.

`Guard` is `{ canActivate(ctx): boolean | Promise<boolean> }`. A `Chain` is a
hand-built record of guards, pipes, interceptors and filters, and `runChain`
remains the complete-chain executor. #575 additionally makes the router execute
the effective guard chain before validation. There is still no `@UseGuards`, and
`getRoutes` still returns `{ method, path, handlerName }` only.

That decides the design rather than blocking it. Below, the guards are actual
instances in the **same route record and guard registry the router runs**, and
the derivation reads those objects. The document is not derived from a second
declaration that has to be kept in step with execution. Disagreement is not
detected, it is unrepresentable.

### S1. The scheme union, against OpenAPI 3.1

The document declares `openapi: '3.1.0'` above, so the scheme types are 3.1's, and 3.1's list is `apiKey`,
`http`, `mutualTLS`, `oauth2`, `openIdConnect`.

```ts
export interface OAuthFlow {
  readonly refreshUrl?: string;
  readonly scopes: Readonly<Record<string, string>>;
}
export interface ImplicitFlow extends OAuthFlow {
  readonly authorizationUrl: string;
}
export interface PasswordFlow extends OAuthFlow {
  readonly tokenUrl: string;
}
export interface ClientCredentialsFlow extends OAuthFlow {
  readonly tokenUrl: string;
}
export interface AuthorizationCodeFlow extends OAuthFlow {
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
}

interface AllFlows {
  readonly implicit?: ImplicitFlow;
  readonly password?: PasswordFlow;
  readonly clientCredentials?: ClientCredentialsFlow;
  readonly authorizationCode?: AuthorizationCodeFlow;
}

/** At least one flow, enforced by the compiler rather than at generation. */
export type OAuthFlows =
  | (AllFlows & { readonly implicit: ImplicitFlow })
  | (AllFlows & { readonly password: PasswordFlow })
  | (AllFlows & { readonly clientCredentials: ClientCredentialsFlow })
  | (AllFlows & { readonly authorizationCode: AuthorizationCodeFlow });

export type SecurityScheme =
  | { readonly type: 'http'; readonly scheme: 'bearer'; readonly bearerFormat?: string; readonly description?: string }
  | { readonly type: 'http'; readonly scheme: 'basic'; readonly description?: string }
  | { readonly type: 'mutualTLS'; readonly description?: string }
  | {
      readonly type: 'apiKey';
      readonly in: 'header' | 'query' | 'cookie';
      readonly name: string;
      readonly description?: string;
    }
  | { readonly type: 'oauth2'; readonly flows: OAuthFlows; readonly description?: string }
  | { readonly type: 'openIdConnect'; readonly openIdConnectUrl: string; readonly description?: string };
```

Three differences from #573's sketch, each one making an invalid document unwritable rather than
detectable:

1. **The `http` arm is split in two.** `bearerFormat` is defined only for the `bearer` scheme, so a single
   arm carrying both lets somebody write `{ type: 'http', scheme: 'basic', bearerFormat: 'JWT' }` — which
   is not wrong enough to break anything and not right enough to mean anything. Split, it does not
   compile. Verified.
2. **`mutualTLS` is added.** It is a 3.1 scheme type and the sketch omitted it; a service mesh terminating
   client certificates is a real deployment, and the arm carries no fields, so including it costs one line.
3. **`OAuthFlows` requires at least one flow**, as a four-arm union. 3.1 permits any subset but an empty
   `flows` object describes nothing, and `{}` is exactly what a half-finished configuration looks like.
   Verified: `const bad: OAuthFlows = {}` is a compile error, and naming two flows is still allowed.

`scopes` is required on every flow and may be `{}`, because 3.1 requires the key. The document's
`securitySchemes` map goes under a new top-level `components`:

```ts
export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, PathItem>;
  readonly components?: { readonly securitySchemes: Readonly<Record<string, SecurityScheme>> };
}
```

`components` is optional and is emitted only when at least one scheme is declared, so a document
generated by today's callers is byte-for-byte what it is now. `components` is otherwise empty: schemas
stay inline per operation, because the existing `schemas` map is keyed by route path and hoisting them
into `components.schemas` needs a naming scheme and a `$ref` rewrite that is a separate change.

### S2. Where the derivation reads from

`RouteOptions` — the existing per-handler record passed to
`router.register(controller, options)` — gains two fields:

```ts
export interface RouteOptions {
  readonly validateBody?: (raw: unknown) => unknown;
  readonly guards?: readonly Guard[];
  readonly security?: readonly SecurityRequirement[]; // an override, see S5
}

export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

export interface GuardRegistry {
  readonly app?: readonly Guard[];
  readonly controllers?: Readonly<Record<string, readonly Guard[]>>;
}

export interface RouterOptions {
  readonly guardRegistry?: GuardRegistry;
}
```

and `OpenApiOptions` gains the same route record and guard registry plus the
scheme declarations:

```ts
export interface OpenApiOptions {
  readonly info?: { readonly title: string; readonly version: string };
  readonly schemas?: Readonly<Record<string, RouteSchemas>>;
  readonly versioning?: VersionStrategy;
  readonly versionSchemas?: Readonly<Record<string, Readonly<Record<string, RouteSchemas>>>>;
  readonly securitySchemes?: Readonly<Record<string, SecurityScheme>>;
  readonly routes?: Readonly<Record<string, Readonly<Record<string, RouteOptions>>>>;
  readonly guardRegistry?: GuardRegistry;
  readonly strictSecurity?: boolean; // default true, see S4
}
```

`routes` is keyed by controller name and then by handler name. `guardRegistry.controllers`
uses that same controller-name key. An application therefore constructs every guard once and hands the
same objects to both the router and the generator:

```ts
const GUARD_REGISTRY = {
  app: [auth],
  controllers: { UsersController: [requireTenant] },
} as const satisfies GuardRegistry;

const ROUTES = {
  UsersController: {
    create: { guards: [requireWrite], validateBody: assert<CreateDTO<User>> },
  },
} as const satisfies Record<string, Record<string, RouteOptions>>;

const router = createRouter({ guardRegistry: GUARD_REGISTRY });
for (const ControllerClass of CONTROLLERS) {
  router.register(new ControllerClass(), ROUTES[ControllerClass.name] ?? {});
}
const doc = toOpenApi(CONTROLLERS, {
  info,
  schemas,
  securitySchemes: SCHEMES,
  guardRegistry: GUARD_REGISTRY,
  routes: ROUTES,
});
```

The effective chain is resolved once, in runtime order: app guards, then the controller's guards, then
the handler's `RouteOptions.guards`.

**Guards are instances, and `enforces` is an instance property.** A `@UseGuards(AuthGuard)` decorator can
only record a _class_, and a class has no `enforces` — reading one means constructing the guard, which
means running the injector at document-generation time, which contradicts §2.2's build-time,
reflection-free rule. The options record and registry hold constructed guards, so the declaration is
right there.

**The document and the router cannot disagree**, because there is nothing to keep in step: the same
guard arrays are the thing that runs and the thing that is read. Epic #572 asks for disagreement to be
_detectable_; deriving from the running objects makes the question not arise. The one place a
disagreement can still be written is the explicit `security` override, and S5 constrains it.

The cost, stated plainly: guards are configured next to module wiring rather than beside the handler, so
a reviewer reading a controller does not see them. That is why `@Public()` (S4) stays a decorator on the
handler — the assertion that a route needs _no_ protection is the one a reviewer must be able to see
without opening another file.

### S3. `enforces`, and what several guards on one route mean

```ts
export interface SecurityAwareGuard extends Guard {
  readonly enforces: { readonly scheme: string; readonly scopes: readonly string[] };
}
```

**`scopes` is required and may be empty**, against the sketch's `scopes?`. Two reasons. OpenAPI's security
requirement object always carries an array — `{ bearerAuth: [] }` is the no-scopes form, not an absent
key — so the required field is the document's own shape and removes a `?? []` from the emitter. And under
`exactOptionalPropertyTypes` an optional `scopes?: readonly string[]` cannot be filled from a computed
`readonly string[] | undefined`, so a guard deriving its scopes from configuration could not construct
itself without a cast. Verified; the same correction as `../pipeline/SPEC.md` §A1 made for a stream's
`length`, and for the same reason.

`scheme` is a `string` checked at generation against `securitySchemes`, not a `keyof` of it. Making it a
key would put the scheme record's type into the signature of every guard, and a guard is a small class
written once whose scheme name is data. A name with no matching declaration is a generation error, which
catches the typo at the one moment the two are in the same room.

**Several effective guards on one route mean _all_ of them, and that is forced rather than
chosen.** Both the router's guard loop and `runChain` stop at the first
`false`, so every guard must pass. In OpenAPI, several schemes inside **one**
requirement object are an AND and several requirement objects in the array are
an OR. So:

| effective guards                                                 | emitted `security`                              |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| route `[auth]`                                                   | `[{ bearerAuth: [] }]`                          |
| app `[auth]`, route `[requireWrite]`, both `bearer`              | `[{ bearerAuth: ['posts:write'] }]`             |
| app `[auth]`, controller `[apiKeyGuard]`, route `[requireWrite]` | `[{ bearerAuth: ['posts:write'], apiKey: [] }]` |
| any inherited guards, with `@Public()` and no route guard        | `[]`                                            |

One object, always. Two guards declaring the **same** scheme merge into one entry whose scopes are the
union, sorted, deduplicated — because `{ bearerAuth: ['a'], bearerAuth: ['b'] }` is not a thing and a
route requiring two scopes requires both. Emitting the OR form is never correct here: the array-of-objects
spelling would tell a generated client that satisfying any one guard is enough, which is the opposite of
what the code does, and a document that understates enforcement is the failure this epic exists to
prevent.

Scopes remain documentation. Neither route execution nor `runChain` reads
`enforces` — the guard's own `canActivate` is the enforcement, and `enforces` is
its description of itself. A guard whose `enforces` disagrees with its
`canActivate` is a lie the framework cannot catch, and
`web-openapi-security.md` already says so.

### S4. `@Public()`, and strictness on by default

```ts
export declare function Public(): (target: (...args: never[]) => unknown, context: ClassMethodDecoratorContext) => void;
```

Not `MethodDecorator`. That is the pre-stage-3 type and this project sets `experimentalDecorators: false`
(`tsconfig.json:6`), so `@Public()` typed as `MethodDecorator` fails to compile at every application
site: `TS1241 — the runtime will invoke the decorator with 2 arguments, but the decorator expects 3`, plus
`TS1270` on the return type. Verified. The same correction applies to `Version` (`../versioning/SPEC.md`
§V2) and it is worth stating once here because #573's sketch uses `MethodDecorator` for both.

`Public` writes a symbol-keyed slot on `context.metadata`, read by a `isPublic(controller, handlerName)`
that lives beside `getRoutes` — the same mechanism, the same trust boundary comment, per §2.1. A route
carrying it emits `security: []`, which in OpenAPI means "no authentication required" and is not the same
as omitting the key. At runtime it bypasses app and controller guards. Declaring a route guard or a
non-empty explicit requirement on the same handler is an error rather than an ambiguous override.

**`strictSecurity` defaults to `true`**, and under it `toOpenApi` throws when a route is in either of two
states:

| state                                                                      | why it is an error                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| effective guards present, no requirement derivable, no explicit `security` | the route is protected and the document would say nothing   |
| no effective guards and no `@Public()`                                     | "forgot a guard" and "meant it to be public" look identical |

The second is the valuable one and it is the reason strictness is on rather than available. Without it, a
new route added to a controller is documented as unprotected the moment it is written, and nothing ever
asks whether that was the intent. With it, the build stops until somebody types either a guard or
`@Public()` — a decision that takes one line and cannot be made by accident.

An explicit `security` override is not a substitute for either choice: under
strictness, a route with no effective guards still fails even if the override is
non-empty. Conversely, `@Public()` cannot declare route guards or a non-empty
override; inherited app and controller guards are deliberately bypassed. That
keeps a grep of public markers identical to the operations carrying `security: []`.

The opt-out is `strictSecurity: false`, and what it costs is worth being exact about, because it is not
"the document becomes wrong". A route with neither effective guards nor `@Public()` emits **no
`security` key at all**, and since S6 emits no document-level `security` either, a reader and a client
generator both see a route with nothing said about it — which they will read as public. So the opt-out
does not produce a false document, it produces a _silent_ one, and silence is what the epic's first
paragraph objects to. It exists so an existing application can generate a document on the day it adopts
this, and leaving it off is a decision to keep the gap.

### S5. A guard that cannot declare

A third-party or legacy guard is a `Guard` and not a `SecurityAwareGuard`; it has no `enforces` and
nothing can be added to it. Without an answer here, `strictSecurity` makes the feature unusable for
exactly the applications most likely to have such a guard.

The answer is the explicit `security` on `RouteOptions` (S2), and it is constrained rather than free:

1. If it is absent, the requirement is the union of every effective app, controller and route guard's
   `enforces` (S3).
2. If it is present, it must be a **superset** of what the effective declaring guards derive — every
   scheme they name must appear, with at least their scopes. A superset is allowed because a scheme may
   genuinely be enforced somewhere the framework cannot see (an authenticating proxy, a service mesh
   presenting a client certificate). A subset is a generation error, because a document may overstate
   what it requires and must never understate it.
3. A route whose guards _all_ declare and which also carries an explicit `security` naming exactly the
   derived set is not an error — it is redundant, and redundancy that agrees is not worth an error — but
   it is the shape that drifts, so the recommendation is to omit it.

This is where a disagreement is still writable, and rule 2 is the check the epic's item 3 asks for. It
runs at generation, which is boot or build time, so it is not a per-request cost.

### S6. No document-level `security`

`toOpenApi` never emits a top-level `security`, and there is no option to supply one, although
`web-openapi-security.md`'s workaround uses exactly that and it is the conventional arrangement.

The reason is that a document-level default plus per-operation overrides makes "this route inherits the
default" and "nobody wrote anything for this route" the same document text — an absent key. Every audit
question then requires knowing the default, and the failure mode is silent in the unsafe direction. When
the requirement is derived rather than written, there is no cost to writing it on every operation, and a
document whose every operation states its own security can be read a line at a time. The `security: []`
that `@Public()` produces is then a positive statement rather than an override of something offscreen.

The workaround section of that page stays valid for a hand-post-processed document and is now labelled as
the pre-#575 arrangement rather than the recommendation.

### S7. Versions in the document

Strategies, resolution and status codes are `../versioning/SPEC.md`. What belongs here is the document
representation, which differs per strategy and is where a generated client is made usable or confusing.

Two corrections to the frozen S7 text are required by the already accepted
runtime contract.

1. The original `OpenApiOptions` had no strategy carrier, although identical
   route metadata has three different representations. `versioning` is therefore
   the same `VersionStrategy` value passed to `createRouter`; generation refuses
   `@Version` without it and refuses an undeclared route when it is present.
2. The original media-type paragraph allowed differing **request** schemas, but
   `../versioning/SPEC.md` §5 explicitly reads versions from `Accept` and never
   from request `Content-Type`. A request body selected by a versioned
   `Content-Type` would generate a client the runtime does not honour. Media
   versions may therefore differ in response schema, while request schemas must
   be identical; differing request shapes use path versioning.

`versionSchemas` carries the schema dimension that a shared public path lacks:

```ts
export type VersionSchemas = Readonly<Record<string, Readonly<Record<string, RouteSchemas>>>>;
```

The outer key is the unexpanded route path and the inner key is one exact
declared version. `schemas[routePath]` remains the common fallback when every
version has the same shape.

**Path versioning** produces distinct paths. `@Version('1', '2')` on a `/users`
route emits `/v1/users` and `/v2/users` as separate path items with independent
`parameters`, `requestBody` and `responses`, and their `operationId`s differ
automatically because the derivation above is path-derived (`get_v1_users`,
`get_v2_users`). The existing `schemas` map is keyed by the expanded route path,
so no second schema mechanism is needed.

**Header versioning** produces one path item per route, with the version as a
`parameters` entry:

```json
{ "name": "accept-version", "in": "header", "required": false, "schema": { "enum": ["1", "2"], "default": "1" } }
```

`required: false` with a `default` because `../versioning/SPEC.md` §V4 requires the header strategy to
carry a default version; a client omitting the header gets it. Generation fails
when the configured default is not among that operation's versions, because
OpenAPI requires a schema default to satisfy its enum and an optional header
would otherwise describe a request the route refuses. Request and response
schemas must be identical across header versions: one operation has one
`requestBody` and one `responses` block, with no dimension keyed by a header
value.

**Media-type versioning** produces one path item per route. Its request body, if
present, remains under plain `application/json`. Its response schemas are under
versioned content keys — `application/json; version=1` and
`application/json; version=2` — and the runtime returns the selected key as the
JSON response `Content-Type`. OpenAPI 3.1 permits media-type parameters in a
content-map key, so generated clients can send the matching `Accept` value and
select the correct response shape.

The consequence, said out loud because it is a design position and not an accident: header versioning is
for versions that differ in _behaviour_, and path versioning is for versions that differ in _shape_. An
API changing a response shape should put the version in the path, which is what
`web-versioning.md` already recommends and what works today with no framework at all.

**A route serving several versions with identical schemas** emits one operation under header and
media-type versioning, and N identical operations under path versioning. Identical is the point: the
handler is one function, and the document says the same thing N times because the paths are N resources.

Several controllers may implement disjoint versions of the same header/media
method and path; generation merges them into one operation. It refuses a
duplicate version. A neutral route emits an ordinary unversioned operation, but
a neutral and a version-specific handler sharing one method/path is a generation
error: runtime shadowing cannot be encoded by one OpenAPI operation. Security
and `deprecated` metadata must likewise agree across versions sharing an
operation; differing operation metadata uses path versioning.

### S8. `deprecated`

`RouteOptions` gains `deprecated?: true` and it is emitted as OpenAPI's `deprecated: true` on the
operation. It is cheap — one boolean, one key, no derivation, no interaction with anything above — and it
is the only machine-readable way to tell a client generator that a version is going away, which is the
half of versioning that makes a migration finishable. `true` rather than `boolean`, so
`deprecated: false` is not a way to write a key that means nothing.

Deprecation is documentation and changes no behaviour: a deprecated route is routed, guarded and answered
exactly as before. A `Sunset` header or a warning log would be a runtime feature and is not in this epic.

### S9. What #574 has to assert

1. Each arm of `SecurityScheme` round-trips into `components.securitySchemes`, including `mutualTLS` and
   each of the four OAuth2 flows with `refreshUrl` present and absent.
2. Compile-time, in a `*.type-test.ts` so `scripts/typecheck.mjs` is what fails: `bearerFormat` on the
   `basic` arm is rejected, an empty `OAuthFlows` is rejected, and `enforces.scopes` accepts a computed
   `readonly string[]` under `exactOptionalPropertyTypes`.
3. A document generated with no `securitySchemes`, `routes` or `guardRegistry` is **identical** to what
   today's `toOpenApi` produces — no `components` key, no `security` key. This is the assertion that keeps
   the amendment additive.
4. Every row of S3's table, including runtime order and derivation across app, controller and route
   guards; two guards declaring the same scheme merge into one entry with the sorted union of their
   scopes, and two guards declaring different schemes produce one requirement object rather than two.
5. `@Public()` emits `security: []` and not an absent key, and `isPublic` reads a route the decorator was
   applied to and not its sibling.
6. Under `strictSecurity: true`: a route with effective guards that cannot declare and no explicit
   `security` throws; a route with neither effective guards nor `@Public()` throws, naming the controller
   and handler; and with `strictSecurity: false` the same two routes generate an operation with no
   `security` key.
7. An explicit `security` that is a strict subset of the derived requirement throws; a superset does not;
   a scheme name with no entry in `securitySchemes` throws.
8. No top-level `security` appears in any generated document.
9. Path versioning emits N paths with distinct `operationId`s; header versioning emits the `enum`
   parameter with the default; media-type versioning emits per-version `content` keys.
10. Header versioning with two versions whose `RouteSchemas` differ throws; media-type versioning with
    differing request schemas throws while differing response schemas produce separate content keys.
    Each refusal names path versioning.
11. `deprecated: true` appears on the operation and nowhere else; `deprecated` absent emits no key.
12. Generation stays deterministic with all of the above present — the same input twice is the same
    document, including the order of keys inside a requirement object.

## Non-goals (rejected)

- **A `@UseGuards` decorator** (S2). It can record only a class, and reading `enforces` off a class means
  constructing the guard at generation time, which needs the injector and breaks §2.2.
- **A document-level `security` with per-operation overrides** (S6). It makes "inherited" and "forgotten"
  the same text.
- **The OR spelling of several guards** (S3). It understates what `runChain` enforces.
- **Enforcing scopes** (S3). `enforces` describes a guard; `canActivate` is the guard. A framework that
  read `enforces` and enforced it would need to know where the scopes in a request are, which is the
  guard's whole job.
- **`scheme` as a `keyof` of the scheme record** (S3). It puts the record's type in every guard's
  signature to catch a typo that generation already catches.
- **Hoisting schemas into `components.schemas` with `$ref`s** (S1). It needs a naming scheme and a
  rewrite pass; the current inline-per-operation form is correct, just repetitive.
- **`security` on `RouteSchemas`** — an earlier docs draft suggested it there.
  `RouteSchemas` is keyed by route path, and two methods on one path share one entry; security
  is per operation, so it belongs on the per-handler record instead.
- **Emitting `tags`** — still not emitted, and still worth doing; it is grouping metadata with no
  relationship to this amendment.
- **A `Sunset` header, or any runtime behaviour for `deprecated`** (S8).
- **Deriving security from a handler's parameter list or its name.** Reflection, and a naming convention
  is not a control.
