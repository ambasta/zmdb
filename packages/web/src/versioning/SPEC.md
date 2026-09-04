# `@zmdb/web` — API version negotiation SPEC

> Resolving an API version out of the path, a request header or a media type, and
> doing it from a table built at startup (epic #572, sub-issue #573). Frozen
> before code.

The document representation is `../openapi/SPEC.md`'s `## Amendments (security
schemes and versioning, #573)` §S7. This file is resolution: where a version comes
from, what happens when it is absent or unknown, and what it costs per request.

## 1. The argument this has to answer

`tests/api-coverage/mapping.mjs` used to carry one committed argument against
this feature across 568 upstream NestJS assertions:

> zmdb routes on method and path only; a version lives in the path if you want
> one, which is a routing decision the reader can see rather than a resolver
> running on every request.

That argument is not withdrawn, it is satisfied. Two of its three clauses survive
intact:

1. **A version in the path stays the recommendation**, and under the path
   strategy there is no resolver at all — §7. What `@Version` adds there is the
   path expansion at registration and the document representation, both of which
   happen once.
2. **"A resolver running on every request" is refused as described.** Header
   versioning performs one header lookup before the startup-built method/version
   table lookup. Media-type versioning performs one `Accept` read and an
   allocation-free character/trie scan before the same table lookup. Neither
   scans routes from another version or runs a regular expression. Of those, 404
   version-related assertions are now mapped to focused tests; the remaining
   164 custom-extractor assertions retain a narrower written argument because a
   callback has no finite document representation.

The clause that does change is "routes on method and path only". The broad
`NO_VERSIONING` argument in `mapping.mjs` is replaced by named coverage plus a
narrow `NO_CUSTOM_VERSIONING` argument about the extractor callback that remains
outside this finite strategy surface.

## 2. The surface

```ts
export type VersionStrategy =
  | { readonly kind: 'path'; readonly prefix: string }
  | { readonly kind: 'header'; readonly name: string; readonly default: string }
  | { readonly kind: 'media-type'; readonly key: string; readonly default: string };

interface VersionDecorator {
  <T extends abstract new (...args: never[]) => unknown>(target: T, context: ClassDecoratorContext<T>): void;
  (target: (...args: never[]) => unknown, context: ClassMethodDecoratorContext): void;
}

/** Declare the versions a controller or a handler serves. At least one. */
export declare function Version(...versions: readonly [string, ...string[]]): VersionDecorator;

/** Declare that a route is the same in every version — the explicit, greppable opt-out. */
export declare function VersionNeutral(): VersionDecorator;

export declare function versionsOf(
  controller: abstract new (...args: never[]) => unknown,
  handlerName: string,
): readonly string[] | 'neutral' | undefined;
```

The router's existing construction options gain the strategy, not each
registration:

```ts
export interface RouterOptions {
  readonly guardRegistry?: GuardRegistry;
  readonly versioning?: VersionStrategy;
}

export declare function createRouter(options?: RouterOptions): Router;
```

Three corrections to #573's sketch, and the first is the same one `../openapi/SPEC.md` §S4 makes for
`Public`.

**Not `MethodDecorator | ClassDecorator`.** Those are the pre-stage-3 types and this project sets
`experimentalDecorators: false` (`tsconfig.json:6`), so the sketch's signature does not compile at any
application site. A union return is additionally uncallable as either half — `TS1238` and `TS1241`, _"each
member of the union type has signatures, but none of those signatures are compatible with each other"_.
The overloaded interface above compiles applied to a class and to a method. Both verified.

**`...versions: readonly [string, ...string[]]`** rather than `readonly string[]`, so `@Version()` with no
arguments is a compile error instead of a route that serves no version.

**`default` is required on the header and media-type arms and absent from the path arm**, so the type
carries §4's asymmetry instead of a paragraph having to.

A version is a **string compared for exact equality**. There is no ordering and no range matching: `'1'`,
`'1.0'`, `'2'` and `'2024-11-05'` are all things real APIs use, and any comparison rule the framework
picked would invent semantics — semver for the first two, dates for the last — that it cannot know applies.
"At least version 2" is therefore not expressible, and a route that serves two versions lists both.

## 3. One strategy, not several

`versioning` is a single `VersionStrategy` and not an array, so #573's step 6 question about precedence
between configured strategies is answered by making the configuration unwritable.

With two strategies live, one request can name two different versions — `/v1/users` with
`accept-version: 2` — and every resolution of that is a rule the client cannot see. "First configured
wins" makes behaviour depend on the order of a configuration array. "Most specific wins" requires ranking
a path against a header. "A conflict is an error" is defensible but means a correct client can be broken
by a proxy that adds a default header. §2.6 asks for three strategies and not a pluggable negotiation
framework, and a precedence rule between them is the framework.

The scenario this costs is migrating from one strategy to another. The answer is that both strategies'
routes can be served at once by mounting a second router — `createRouter({ versioning: … })` twice, with
the adapter choosing by path prefix — which is visible in one place instead of implicit in every request.
A migration is finite; a precedence rule is permanent.

## 4. A request that names no version

| strategy     | behaviour                                                                   |
| ------------ | --------------------------------------------------------------------------- |
| `path`       | not a case — the version is in the path, so an absent one is an absent path |
| `header`     | resolves to `default`                                                       |
| `media-type` | resolves to `default`                                                       |

`default` is a **required** field rather than an optional one because the alternative is an API that
refuses every request lacking a header it invented, including every first request, every `curl` and every
browser address bar. Making the field optional and refusing when it is unset would mean the most hostile
possible configuration is the one you get by leaving something out.

Under `path`, a request to `/users` when only `/v1/users` and `/v2/users` are registered is a `404` from
the existing table, with no versioning code involved. That is not a special case being handled; it is the
absence of one.

## 5. A request that names an unknown version

Per strategy, because the three are asking different questions and HTTP already has three answers:

| strategy     | status | why                                                                                          |
| ------------ | ------ | -------------------------------------------------------------------------------------------- |
| `path`       | `404`  | the path does not exist; there is nothing at `/v9/users`                                     |
| `header`     | `400`  | an unsupported value in a request header the client controls                                 |
| `media-type` | `406`  | the client stated what it will accept and the server cannot produce it — 406's exact meaning |

A single status for all three would have to be wrong twice. `404` for a header version sends a client
hunting for a typo in a path that is correct. `400` for an `Accept` it cannot satisfy discards the one
status code that exists for precisely that situation, and a client that knows how to fall back on a `406`
gets no signal.

The `400` and `406` bodies list the versions the route serves:
`{ "error": "unsupported version \"9\"", "supported": ["1", "2"] }`. A negotiation failure that does not
say what would have worked makes the client's next request a guess. The `404` says nothing extra, for the
same reason `../static/SPEC.md` §3 makes every rejection one uniform `404`: a body enumerating which
versions of which paths exist is a route-table oracle.

Under `media-type`, the version is read from **`Accept`**, and an `Accept` carrying several acceptable
types is resolved by `q` — the same rules as `../compression/SPEC.md` §4, cited rather than restated, and
the same treatment of `q=0` as a prohibition. A version in the request's `Content-Type` is a different
question — which version of the _body_ the client is sending — and is not read; a route whose request
shape changes between versions is the case §S7 sends to path versioning anyway.

## 6. A route with no version, and `@VersionNeutral()`

Once a strategy is configured, a route must say something. `versionsOf` returning `undefined` for a
registered route is a **registration error** naming the controller and the handler — the parallel of
`../openapi/SPEC.md` §S4's strict security, and for the same reason: "serves every version" and "nobody
thought about it" must not be the same text.

`@VersionNeutral()` is the explicit, greppable form of "this route is the same in every version", and it
matches every version including ones no route declares. It exists for the routes that genuinely have no
version — `/health`, `/openapi.json`, `/metrics` — and for a controller whose version is already written
into its own prefix by hand:

```ts
@VersionNeutral()
@Controller('/v1/users')
class UsersV1 { … }
```

That is the arrangement `docs-site/content/web-versioning.md` documents today, and it keeps working under
a configured path strategy at the cost of one line per controller. The negotiator is being told that this
controller does its own versioning, which is true.

Precedence between the two decorators is method over class, with no merging: a `@Version('2')` method
inside a `@VersionNeutral()` controller serves version 2 only, and a `@Version('1')` controller's
`@VersionNeutral()` method serves everything. The nearer declaration wins because that is what a reader
expects from every other decorator in the package, and merging a neutral with a list has no meaning —
neutral already includes the list.

Two declarations claiming the same method, path and version are a registration
error: version is a third key in the table (§7), so a duplicate versioned key
cannot be represented. This is a new strictness for configured versioning.
Unconfigured routing retains its existing first-registered-wins behaviour.

## 7. Resolution is built at startup

`MethodBuckets` is `Map<method, BoundRoute[][]>` — method, then segment count — and the comment at
`../pipeline/index.ts:52-61` says why: a request never looks at a route that cannot possibly match, and the
flat scan it replaced grew without bound. Version is a third key of the same kind, in front of segment
count:

```ts
type VersionBuckets = Map<string, Map<string, BoundRoute[][]>>; // method → version → segmentCount → routes
```

Per request under `header`, the configured header value is already the version
map key. Under `media-type`, a startup-built trie matches the version parameter
directly against canonical registered strings; it does not `split`, `slice`,
lower-case or otherwise create a substring on the known-version success path.
Both strategies then use the nested method/version map and segment-count array.
There is no cross-version route scan or regular expression over the path.

The no-allocation statement is specifically about successful version
extraction. A sampled V8 allocation profile over 100,000 media-type requests at
a 64-byte interval attributed zero sampled bytes to the parser functions, and
the focused test supplies an `Accept` carrier whose allocating string helpers
throw. An unsupported-version response necessarily allocates its JSON error
body and, for an unknown media value, the value copied into that body.

Under `path`, **no version extractor or version-table lookup runs per request.**
`@Version('1', '2')` on a route under
`{ kind: 'path', prefix: 'v' }` registers `/v1/users` and `/v2/users` at register time, and the existing
two-key table answers both without extracting or looking up a version. This is the property that makes path
versioning the recommendation rather than merely one of three.

A `@VersionNeutral()` route is registered into every version bucket that exists, and into a neutral bucket consulted after the version's own bucket misses — so a neutral route is found under a version no route declares, and a versioned route still shadows a neutral one at the same path.

Registering into the buckets rather than testing a flag during the match keeps the per-request path a lookup: the alternative is a second candidate list and a branch, which is a scan reintroduced one route at a time.

The version resolved for a request is not put on `Ctx`. A handler that needs to know its own version has
been given two versions' worth of behaviour and should be two handlers; the framework declining to make
that convenient is deliberate, and `@Version('1', '2')` on one method means the method is the same in both.

## 8. What #574 has to assert

1. Compile-time, in a `*.type-test.ts`: `@Version()` with no arguments is rejected, `Version` applies to
   both a class and a method, and a `header` strategy without `default` is rejected.
2. Each row of §4 — under `header` and `media-type` a request naming no version gets the default's
   handler; under `path` a request to the unversioned path is a `404` from the ordinary table.
3. Each row of §5, by status: `404`, `400` and `406` respectively, with `supported` listing the versions in
   the `400` and `406` bodies and absent from the `404`.
4. `Accept: application/json;version=2;q=0.1, application/json;version=1;q=0.9` resolves to version 1, and
   `version=1;q=0` does not resolve to 1 even when 1 is the only version served.
5. A registered route with neither `@Version` nor `@VersionNeutral()` under a configured strategy throws at
   registration, naming the controller and the handler.
6. A `@VersionNeutral()` route answers a version no route declares; a `@Version('1')` route at the same
   path answers version 1 in preference to it.
7. Method-over-class precedence, both directions of §6.
8. `@Version('1', '2')` under the path strategy registers exactly `/v1/users` and `/v2/users`, and
   `getRoutes` is unchanged — the expansion is the router's, not the routing metadata's.
9. With no `versioning` configured, every route behaves exactly as it does today and `@Version` on a route
   is a registration error rather than being ignored. A decorator that silently does nothing is worse than
   one that refuses.
10. A performance assertion in the existing shape: matching against a table with N versions of M routes
    does not read more candidates than matching one version of M routes.
11. The successful media-type path does not call allocating string extraction
    helpers, and the existing router microbenchmark can run all three strategies
    so committed and versioned route-table timings can be compared without a
    fixed CI threshold.

## Non-goals (rejected)

- **Several strategies at once, and any precedence rule between them** (§3).
- **A query-parameter strategy.** The epic's own text raises it and the sub-issue's surface drops it, which
  is the right call: a version in the query string is a version in a cache key that every proxy treats
  differently, and it is the one place a version can be added by a link rather than by a client.
- **A custom extractor.** `(req) => string | undefined` is the pluggable negotiation framework §2.6 rules
  out, and it moves the decision about which requests are which version out of anything the document can
  describe.
- **Version ordering, ranges, or "at least version N"** (§2). It requires semantics for a string the
  framework does not own.
- **Reading a version from `Content-Type`** (§5).
- **The resolved version on `Ctx`** (§7).
- **Implicit fallthrough to an unversioned handler** (§6) — this is the epic's §2.4-in-spirit constraint
  spelled as a registration error.
- **Deprecating a whole version.** `deprecated` is per route (`../openapi/SPEC.md` §S8); a version-wide
  sweep is a loop over the routes of that version in the application's own configuration, and a framework
  option for it would be a second place the truth lives.
- **`Sunset` or `Deprecation` response headers.** Runtime behaviour, not in this epic.
