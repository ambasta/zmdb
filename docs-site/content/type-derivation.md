No hand-written DTOs. Three types derive from every schema:

```ts
import type { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';

type User = Entity<typeof UserSchema>;
// { id: number; email: string; role: 'admin'|'user'|'guest'; createdAt: Date }

type CreateUser = CreateDTO<typeof UserSchema>;
// { email: string; role?: 'admin'|'user'|'guest' }
//   id omitted (autoIncrement); role/createdAt optional (hasDefault)

type UpdateUser = UpdateDTO<typeof UserSchema>;
// Partial<CreateUser>
```

- **Entity** — the full row shape returned by reads.
- **CreateDTO** — insert shape; auto-increment PKs dropped, defaulted columns optional.
- **UpdateDTO** — `Partial<CreateDTO>`.

These are the same types the validators and serializers are generated against, so the request DTO, the DB write, and the response type can never drift apart.

> [!IMPORTANT]
> This is the anti-drift guarantee: change a column and all three types update.
> Any code that no longer satisfies them **fails to compile** — there is no
> runtime schema object to fall out of sync with.

Beyond the write triad, the **read side** also derives typed DTOs —
`GetDTO`, `ListDTO`/`ListResult`, `SearchDTO`, `Projection`,
`Populated` and `AggregateResult`. See [Read/Query DTOs](./read-dtos.html).
