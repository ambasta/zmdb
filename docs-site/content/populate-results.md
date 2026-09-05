Populate loads related entities for to-one and to-many relations. Unlike lazy-loading proxies, zmdb uses explicit batched queries — no proxies, no N+1 problem, and no identity map.

## Typed populate: `findById(id, { populate })`

Declare the relation on the type — see [Relations](./relations.html) — then ask for it by key. The result is a parent **typed** with its nested relation(s).

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  orders?: Order[] & OneToMany<'orders', 'userId'>;
}

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}

const user = await users.findById(1, { populate: ['orders'] });
// user.orders: readonly Entity<Order>[]   — to-one relations come back as Entity<Child> | null
```

`populate` accepts the relation keys of `User`, so `['ordres']` does not compile. There is no static `relations` map: it used to sit beside `static schema`, restating the target table, the foreign key
and the cardinality that the declaration above already carries.

Under the hood zmdb loads the parent, then runs **one batched query** for the children and attaches them — a plain array on a plain object.

```sql
SELECT * FROM "users" WHERE "id" = $1 LIMIT 1
SELECT * FROM "orders" WHERE "userId" = $1   -- batched across all parents
```

> [!TIP] Without `{ populate }` the result is a plain `Entity<User>` — the relation key is not on the type and not on the object — so you never pay for data you didn't ask for. This replaces the older
> stringly-typed `findAllWithMany`.

## Populating To-One Relations (via JOIN)

Use `findJoined` to fetch a parent with its related entity via JOIN.

```ts
// Given `user?: User & ManyToOne<'users', 'userId'>` on Order
const orders = await ordersRepo.findJoined({ target: 'users', leftCol: 'userId', rightCol: 'id', kind: 'left' }, { col: 'status', op: '=', value: 'pending' });

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

> [!IMPORTANT] `findAllWithMany` executes exactly two queries regardless of parent count. This eliminates N+1 without proxies.

## Populate in GetDTO

Pass `populate` in the GetOptions to type-narrow the result:

```ts
import type { GetDTO } from '@zmdb/schema-core/dto';
import type { Populated } from '@zmdb/schema-core/derive';

const result = await users.findById(1, { populate: ['orders'] });
// result: Populated<User, 'orders'> | undefined
// result.orders: readonly Entity<Order>[]
```

## No Lazy Loading

There are no lazy-loading proxies. If you don't call a populate method, relations are simply absent from the result:

```ts
const user = await users.findById(1);
// 'orders' in user === false — absent, not `undefined`, and not a key of the result type
```

> [!TIP] Always consider which relations you need. Load only what's necessary to avoid unnecessary queries.

## Cross-links

- [Relations](./relations.html) — schema definition
- [Read DTOs](./read-dtos.html) — typed reads
- [Repository](./repository.html) — CRUD with populate
