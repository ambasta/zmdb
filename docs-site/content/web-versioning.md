> **ToDo / partial.** There is no built-in `VersioningType` (URI/header/media-type)
> negotiator like `@nestjs/common`. **URI versioning works today** via
> controller path prefixes; header/media-type negotiation is roadmap.

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

## Header/media-type versioning (roadmap)

A version negotiator would be a [Guard](./web-middleware.html) reading
`ctx.headers['accept-version']` (or an `Accept` media-type) and selecting a
handler variant. It's a ToDo because doing it well means integrating with route
resolution, not just branching in a Guard.

## Cross-links

- [Controllers & routing](./web-controllers.html) · [Middleware](./web-middleware.html)
