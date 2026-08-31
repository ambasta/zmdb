Populate loads related entities for to-one and to-many relations. Unlike lazy-loading proxies, zmdb uses explicit batched queries — no proxies, no N+1 problem, and no identity map.

## Typed populate: `findById(id, { populate })`

Declare a repository's relations once in a typed static `relations` map, then ask
for them by key — the result is a parent **typed** with its nested relation(s).

```ts
import { oneToMany } from '@zmdb/schema-core/relations';

class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
  static readonly relations = {
    orders: {
      meta: oneToMany('orders', 'userId'),
      entity: OrderSchema,
      cardinality: 'one-to-many',
      childTable: 'orders',
      childFk: 'userId',
      parentKey: 'id',
    },
  } as const;
}

const user = await users.findById(1, { populate: ['orders'] });
// user.orders: Order[]   — typed; to-one relations come back as Child | null
```

Under the hood zmdb loads the parent, then runs **one batched query** for the
children and attaches them — a plain array on a plain object.

```sql
SELECT * FROM "users" WHERE "id" = $1 LIMIT 1
SELECT * FROM "orders" WHERE "userId" = $1   -- batched across all parents
```

> [!TIP]
> Without `{ populate }` the result is a plain `Entity<S>` (no relation key), so
> you never pay for data you didn't ask for. This replaces the older stringly-
> typed `findAllWithMany`.

## Populating To-One Relations (via JOIN)

Use `findJoined` to fetch a parent with its related entity via JOIN.

```ts
// Given OrderSchema with user: manyToOne('users', 'userId')
const orders = await ordersRepo.findJoined(
  { target: 'users', leftCol: 'userId', rightCol: 'id', kind: 'left' },
  { col: 'status', op: '=', value: 'pending' },
);

// Each order now has user data attached (flat object)
for (const order of orders) {
  console.log(order.userId, order.user?.email);
}
```

**SQL emitted:**

```sql
SELECT "orders".*, "users"."id" AS "user_id", "users"."email" AS "user_email"
FROM "orders" LEFT JOIN "users" ON "orders"."userId" = "users"."id"
WHERE "orders"."status" = $1
```

## Populating To-Many Relations

Use `findAllWithMany` to batch-load children for all parents.

```ts
// Find all users, then batch-load their orders
const usersWithOrders = await usersRepo.findAllWithMany(
  'orders', // relation name on User
  'orders', // child table
  'userId', // foreign key on orders
  'id', // parent key (default: 'id')
);

// usersWithOrders[0].orders = all orders where userId = user.id
```

**SQL emitted (2 queries):**

```sql
-- First: fetch all users
SELECT * FROM "users"

-- Second: batched IN query for orders
SELECT * FROM "orders" WHERE "userId" IN ($1, $2, $3, ...)
```

> [!IMPORTANT]
> `findAllWithMany` executes exactly two queries regardless of parent count. This eliminates N+1 without proxies.

## Populate in GetDTO

Pass `populate` in the GetOptions to type-narrow the result:

```ts
import type { GetDTO, Populated } from '@zmdb/schema-core/dto';

const result = await users.findById(1, { populate: ['orders'] });
// result: Populated<typeof UserSchema, 'orders'> | undefined
// result.orders: Order[]
```

## No Lazy Loading

There are no lazy-loading proxies. If you don't call a populate method, relations are simply absent from the result:

```ts
const user = await users.findById(1);
// user.orders === undefined (not loaded)
```

> [!TIP]
> Always consider which relations you need. Load only what's necessary to avoid unnecessary queries.

## Cross-links

- [Relations](./relations.html) — schema definition
- [Read DTOs](./read-dtos.html) — typed reads
- [Repository](./repository.html) — CRUD with populate
