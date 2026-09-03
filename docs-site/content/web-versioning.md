> **ToDo / partial.** There is no built-in `VersioningType` (URI/header/media-type)
> negotiator like `@nestjs/common`. **URI versioning works today** via
> controller path prefixes; header/media-type negotiation is roadmap.
>
> The three strategies, what happens when a request names no version or an
> unknown one, and where the version sits in the routing table are frozen in
> `packages/web/src/versioning/SPEC.md`; the document representation is in
> `packages/web/src/openapi/SPEC.md`.

## URI versioning now

```ts
@Controller('/v1/users')
class UsersV1 {
  @Get('/') list(ctx: Ctx) {
    /* ... */
  }
}

@Controller('/v2/users')
class UsersV2 {
  @Get('/') list(ctx: Ctx) {
    /* v2 shape */
  }
}
```

Both mount independently; the [route table](./web-controllers.html) resolves them
at boot with zero per-request cost.

This stays the recommendation after the negotiator lands, for two reasons that are
worth knowing before you reach for a header. Under the path strategy nothing runs
per request — `@Version('1', '2')` registers two paths at boot and the existing
route table answers both, so there is no resolution step at all. And a version in
the path is the only strategy that can carry a **different response shape**, which
is usually the reason to version in the first place; see below.

## Header/media-type versioning (roadmap, now specified)

A negotiator, not a [Guard](./web-middleware.html). A guard runs after a route has
been matched, so it can reject a version but cannot select between two handlers —
which is why the earlier note here called this "integrating with route resolution".
The frozen design makes the version a third key in the same startup-built table
that already indexes by method and segment count, so a request costs one header
read and two map lookups and never scans candidate routes.

```ts
const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
```

`default` is a required field, not an optional one. An API that refuses every
request lacking a header it invented refuses every first request, every `curl` and
every address bar, and that should not be the configuration you get by leaving
something out.

**A route must say which versions it serves**, once a strategy is configured. A
registered route with neither `@Version` nor `@VersionNeutral()` fails at
registration rather than quietly serving everything, because "serves every version"
and "nobody thought about it" must not be the same text. The example above keeps
working with one line added:

```ts
@VersionNeutral()
@Controller('/v1/users')
class UsersV1 { … }
```

which says what is true: this controller does its own versioning.

**An unknown version gets a different status per strategy**, and each is the one
HTTP already has for the question being asked — `404` under path versioning
(nothing exists at `/v9/users`), `400` under header versioning (an unsupported
value in a header the client controls) and `406` under media-type versioning, which
is exactly what 406 means. The `400` and `406` bodies list the versions the route
serves; a negotiation failure that does not say what would have worked makes the
next request a guess.

**Versions are strings compared for equality.** There is no ordering and no "at
least version 2", because `'1'`, `'1.0'` and `'2024-11-05'` are all versions real
APIs use and any comparison rule would invent semver or date semantics the framework
cannot know apply.

## Where the version shows up in the generated document

This is the part that decides whether a generated client is usable, and the three
strategies genuinely differ.

| strategy     | in the document                                                      |
| ------------ | -------------------------------------------------------------------- |
| `path`       | distinct paths, independent schemas, distinct `operationId`s         |
| `media-type` | one path, each version's schemas under its own `content` key         |
| `header`     | one path, the version as an `enum` header parameter with a `default` |

**A response shape that differs between versions is only expressible under path
versioning.** Under header versioning it is a generation error that names path
versioning as the fix: an OpenAPI operation has exactly one `responses` block and
one `requestBody`, and the only dimension it offers is the `content` map keyed by
media type — there is no dimension keyed by the value of a request header. Emitting
one version's schema and dropping the other's produces a document that generates a
client which compiles and is wrong, which is worse than refusing at build time.

So the division is: **header versioning is for versions that differ in behaviour,
path versioning is for versions that differ in shape.** If you are versioning
because the JSON changed, the URI versioning at the top of this page is not the
workaround — it is the answer.

`deprecated: true` is expressible per route, which is the half of versioning that
makes a migration finishable.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [Middleware](./web-middleware.html) · [Security Schemes](./web-openapi-security.html)
