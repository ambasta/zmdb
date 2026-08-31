zmdb is framework-agnostic — it doesn't depend on Express, Hono, Fastify, or any other web framework. The `makeEndpoint` utility provides a thin adapter layer that converts your repository into an HTTP handler. Each framework wraps this in 1-2 lines.

## The Endpoint Handler

```ts
import { makeEndpoint, type Handler, type EndpointResult } from '@zmdb/repository';

interface CreateUserInput {
  name: string;
  email: string;
}

const handler: Handler<CreateUserInput, User> = {
  validate: raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid input');
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string') throw new Error('name required');
    if (typeof r.email !== 'string') throw new Error('email required');
    return r as CreateUserInput;
  },
  handle: async input => {
    return repo.create(input);
  },
};

const endpoint = makeEndpoint(handler);
// endpoint: (raw: unknown) => Promise<EndpointResult>
```

## Express

```ts
import express from 'express';

const app = express();
app.use(express.json());

app.post('/users', async (req, res) => {
  const result = await endpoint(req.body);
  res.status(result.status).send(result.body);
});
```

## Hono

```ts
import { Hono } from 'hono';

const app = new Hono();
app.post('/users', async c => {
  const result = await endpoint(await c.req.json());
  return c.body(result.body, result.status);
});
```

## tRPC

```ts
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();
export const appRouter = t.router({
  createUser: t.procedure
    .input(z.object({ name: z.string(), email: z.string() }))
    .mutation(({ input }) => endpoint(input)),
});
```

## NestJS

```ts
import { Controller, Post, Body } from '@nestjs/common';

@Controller('users')
class UserController {
  @Post()
  async create(@Body() body: unknown) {
    const result = await endpoint(body);
    return JSON.parse(result.body);
  }
}
```

> [!NOTE]
> The `validate` function should parse and validate input. Use `@zmdb/aot-validator` for compile-time inlined validation — zero runtime overhead.

## Serialization

The endpoint returns `{ status: number; body: string }`. Customize serialization by adding a `serialize` method to your handler:

```ts
const handler: Handler<Input, Output> = {
  validate: /* ... */,
  handle: /* ... */,
  serialize: (out) => JSON.stringify(out), // default
  // Or use a custom serializer
  // serialize: (out) => YAML.stringify(out),
};
```

> [!TIP]
> Keep handlers thin — delegate to your repository. The endpoint layer should only handle HTTP concerns (parsing, serialization, status codes).

---

See also: [Repository](./repository.html) · [Validation](./validators-is.html) · [DTO Helpers](./read-dtos.html)
