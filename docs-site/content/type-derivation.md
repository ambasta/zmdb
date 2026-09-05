No hand-written DTOs. Every DTO derives from the interface you declared the table as:

```ts
import type { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';

// interface User extends Table<'users'> { … } — see Schema Declaration.

type UserRow = Entity<User>;
// { id: number; email: string; role: 'admin'|'user'|'guest'; createdAt: Date }

type CreateUser = CreateDTO<User>;
// { email: string; role?: 'admin'|'user'|'guest' }
//   id omitted (Serial); role/createdAt optional (HasDefault)

type UpdateUser = UpdateDTO<User>;
// every column optional, minus the serial ones and the primary key
```

- **Entity** — the full row shape returned by reads: every column, required, mutable, relations left out because a relation is not a column.
- **CreateDTO** — insert shape; `Serial` columns dropped, `HasDefault` and nullable columns optional.
- **UpdateDTO** — a patch: every column optional, with the serial columns and the primary key removed, because a key is not a field you patch.

The argument is the **type**, not the schema value. `Entity<User>`, never `Entity<typeof UserSchema>` — a schema value is data for the query compiler and the migration emitter, and it has nowhere to
put a json column's payload shape, so nothing derives a row type from one. Where you hold a value and need its type, hand it to something that asks for one:
`defineRepository(schemaOf<User>(), driver)` gives you a repository whose every method is already typed in `User`, with no annotation.

These are the same types the validators and serializers are generated against, so the request DTO, the DB write, and the response type can never drift apart.

> [!IMPORTANT] This is the anti-drift guarantee: change a column and all three types update. Any code that no longer satisfies them **fails to compile** — there is no runtime schema object to fall out
> of sync with.

Beyond the write triad, the **read side** also derives typed DTOs — `GetDTO`, `ListDTO`/`ListResult`, `SearchDTO`, `Projection`, `Populated` and `AggregateResult`. See
[Read/Query DTOs](./read-dtos.html).
