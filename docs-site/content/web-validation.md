First-class **pipes** that bind a route to schema-derived DTO validation and
entity serialization — the NestJS `ValidationPipe` / `ClassSerializerInterceptor`
analogues, but **zero-runtime-parser**: validation is your
[AOT `assert`](./aot-setup.html), so there is no Zod-style parser on the hot
path.

## Validation pipe

```ts
import { validationPipe, runChain } from '@zmdb/web';
import { assert } from '@zmdb/aot-validator/utilities';
import type { CreateDTO } from '@zmdb/schema-core';

// The pipe's Out type is the DTO, so the handler body is typed — no 'as'.
const pipe = validationPipe(raw => assert<CreateDTO<User>>(raw));
```

A body that fails validation makes the chain return **400**; the handler never
runs. A valid body reaches the handler **typed** as the DTO.

## Serialization interceptor

```ts
import { serializationInterceptor } from '@zmdb/web';

// shape the response from Entity<S> (default is identity — the pipeline
// JSON-encodes downstream)
const serializer = serializationInterceptor(entity => toPublicUser(entity));
```

## One-call composition

```ts
import { dtoChain } from '@zmdb/web';

const chain = dtoChain({
  validate: raw => assert<CreateDTO<User>>(raw),
  serialize: user => toPublicUser(user),
});
// → a Chain with the validation pipe + serialization interceptor pre-composed
```

> [!IMPORTANT]
> Validation runs **before** the handler (invalid → 400) and the response is
> shaped **after** — both bound to your schema DTOs, so the request contract, the
> DB write and the response never drift.

## Design notes

- **Zero runtime parser** — validation is the consumer's AOT `assert`; the
  framework embeds none.
- **No `as`** — the pipe's `Out` type is the DTO, so the handler body is typed by
  the pipe.
- Granular import: `import { dtoChain } from '@zmdb/web/dto-pipes'`.

## Cross-links

- [Guards, pipes, interceptors & filters](./web-middleware.html) · [Building an API with zmdb](./web-data-integration.html) · [AOT setup](./aot-setup.html)
