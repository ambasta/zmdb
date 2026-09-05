Define HTTP controllers with **Stage-3 decorators**. `@Controller` sets a path prefix; `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete` mark handler methods. All route data is stored in the standard
`Symbol.metadata` record — **no `reflect-metadata`, no runtime type reflection**. The route table is resolved once via `getRoutes`.

## Declaring a controller

```ts
import { Controller, Get, Post, Patch, Delete } from '@zmdb/web';

@Controller('/users')
class UsersController {
  @Get('/:id')
  get() {
    /* ... */
  }

  @Post()
  create() {
    /* ... */
  }

  @Patch('/:id')
  update() {
    /* ... */
  }

  @Delete('/:id')
  remove() {
    /* ... */
  }
}
```

> [!NOTE] Stage 3 has **no parameter decorators**, so handlers don't take `@Param`/`@Body` arguments. Instead they'll receive a single strongly-typed request context — see the
> [typed context](./web-overview.html) work (path params are _derived_ from the route string). This page covers the route wiring itself.

## Reading the route table

`getRoutes(ControllerClass)` returns the resolved routes — the controller prefix composed with each method path, normalized, in **declaration order**:

```ts
import { getRoutes } from '@zmdb/web';

getRoutes(UsersController);
// [
//   { method: 'GET',    path: '/users/:id', handlerName: 'get' },
//   { method: 'POST',   path: '/users',     handlerName: 'create' },
//   { method: 'PATCH',  path: '/users/:id', handlerName: 'update' },
//   { method: 'DELETE', path: '/users/:id', handlerName: 'remove' },
// ]
```

The table is computed by reading `context.metadata` — cache it freely; it is stable after class initialization and never re-reflected per request.

## Path composition

| `@Controller` prefix | method path | resolved     |
| -------------------- | ----------- | ------------ |
| `/users`             | `/:id`      | `/users/:id` |
| `users` (no slash)   | _(none)_    | `/users`     |
| _(none)_             | `/health`   | `/health`    |
| `users/`             | `/`         | `/users`     |

Duplicate slashes collapse and a trailing slash is stripped (the root `/` stays `/`).

## Design notes

- **No `as` on the consumer surface** — you never assert types to declare routes.
- Route/prefix data is kept in **symbol-keyed** slots inside `context.metadata`, off the public string keyspace.
- Granular import: `import { getRoutes } from '@zmdb/web/routing'`.

## Cross-links

- [@zmdb/web overview](./web-overview.html) — the Stage-3 baseline & invariants
