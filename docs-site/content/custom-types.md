Custom types let you define domain-specific types with bidirectional encoding/decoding between your TypeScript runtime and the database. zmdb treats custom types as first-class citizens — they're not ORM magic but explicit contracts between your app and the database.

A column has **three** types, and a custom type is where they visibly differ: what JSON carries, what your handler holds, and what the driver binds.

## Defining a Custom Type

`defineType` takes those three as type parameters and one function per crossing. The result is immutable and frozen — safe to share across your application.

```ts
import { defineType, encodeValue, decodeValue } from '@zmdb/schema-core/custom-types';

interface Money {
  amount: number;
  currency: string;
}

//                       wire    app     db
const MoneyType = defineType<string, Money, string>({
  sqlType: 'VARCHAR(50)',
  toDb: m => `${m.amount}:${m.currency}`,
  fromDb: s => {
    const [amount, currency] = s.split(':');
    return { amount: Number(amount), currency };
  },
  toWire: m => `${m.amount} ${m.currency}`,
  fromWire: s => {
    const [amount, currency] = s.split(' ');
    return { amount: Number(amount), currency };
  },
});

// Usage
const dbValue = encodeValue(MoneyType, { amount: 100, currency: 'USD' });
// dbValue => "100:USD"

const appValue = decodeValue(MoneyType, '100:USD');
// appValue => { amount: 100, currency: 'USD' }
```

All four functions are required, and that is deliberate: a codec whose `toWire` was optional
would be a codec that sometimes converts, and the caller cannot tell which kind it has. The
three type parameters exist for the same reason — a codec that named only two left the third
to be guessed, and the guess was "the same as the app type", which is how a `Money` instance
got handed to `JSON.stringify` unchanged.

> [!TIP]
> Keep all four as pure functions — no side effects. This ensures predictable behavior during serialization and deserialization.

## Naming it on a column

A column names its codec with the `Codec<'Name'>` tag, and says what JSON carries with
`WireAs<W>`:

```ts
import type { Codec, PrimaryKey, Serial, Sql, Table, WireAs } from 'zmdb/tags';

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  total: Money & Sql<'varchar'> & Codec<'Money'> & WireAs<string>;
}
```

Three tags, three answers: `Sql<'varchar'>` is the storage, `Codec<'Money'>` is the conversion,
`WireAs<string>` is the JSON. The app type is the property type, `Money`, which is what
`Entity<Order>['total']` gives you.

Generated DDL:

```sql
CREATE TABLE "orders" (
  "id" SERIAL PRIMARY KEY,
  "total" VARCHAR NOT NULL
)
```

> [!IMPORTANT]
> The DDL type comes from `Sql<…>`, not from the codec's `sqlType`. Nothing in the migration
> path reads a codec, so `VARCHAR(50)` versus a bare `VARCHAR` is a `Length<50>` tag on the
> column, not a field on the `CustomType`. Keep `sqlType` for your own reference or drop it.

## Wiring the registry

The tag names a codec; the application supplies it. One registry, keyed by the same name:

```ts
import { wireCodec } from '@zmdb/schema-core/custom-types';
import { wireDecoder, wireEncoder } from '@zmdb/web/data';

const codecs = { Money: wireCodec(MoneyType) };

const decode = wireDecoder(schemaOf<Order>(), 'create', codecs);
const encode = wireEncoder(schemaOf<Order>(), codecs);
```

`wireCodec` adapts the four-function `CustomType` to the two-function `Codec` the boundary
asks for. A column that names a codec with nothing behind it **throws**:

```
column "total" names the codec "Money", which is not in the registry
```

That is on purpose. Silently passing the value through would store whatever JSON happened to
carry, in the one column whose entire point is that it needs converting.

And a `Codec<'…'>` column with no `WireAs<…>` is refused by the JSON Schema and OpenAPI
back-ends, with the reason spelled out: the codec does not say what the column looks like on
the wire, so nothing downstream can guess it.

## JSON payloads

For a nested shape with no conversion, you do not need a codec at all — the property's type
_is_ the payload type:

```ts
interface Priority {
  level: 'low' | 'medium' | 'high';
  escalated: boolean;
}

export interface Task extends Table<'tasks'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  priority: Priority & Sql<'json'>;
}
```

The generated validator walks `priority.level` and `priority.escalated`, so `assert<CreateDTO<Task>>(body)` covers it. Reach for a codec when the stored form and the app form genuinely differ — `Money` as `"100:USD"`, a `bigint` as a decimal string — not merely because a column holds an object.

```ts
// a codec that does need one: the stored text is not the app shape
const PriorityType = defineType<string, Priority, string>({
  sqlType: 'JSONB',
  toDb: p => JSON.stringify(p),
  // the column is JSONB; nothing guarantees the shape on read, so check it
  fromDb: raw => assert<Priority>(JSON.parse(raw)),
  toWire: p => JSON.stringify(p),
  fromWire: raw => assert<Priority>(JSON.parse(raw)),
});
```

## Type Safety Guarantees

The three parameters are what make the boundaries checked rather than assumed:

```ts
// This compiles — types align
const encoded = encodeValue(MoneyType, { amount: 50, currency: 'EUR' });

// This fails — fromDb expects string, not number
// decodeValue(MoneyType, 42); // Type error
```

> [!IMPORTANT]
> Custom types do NOT add runtime validation. If the database returns malformed data, `fromDb` will throw — or worse, succeed with nonsense. Pair them with `@zmdb/aot-validator`, as `PriorityType.fromDb` does above.

## Extension-backed storage types

`Codec<'Name'>` and `Ext<'extension', 'type', [...]>` solve different problems.
A codec converts values between wire, application and database forms. `Ext`
names a PostgreSQL extension type for schema reflection and migration DDL; it
does not invoke the codec registry.

That distinction matters for pgvector and PostGIS. Their declarations, indexes
and closed query expressions are typed, while writes that need a
database-specific constructor or text encoding use explicit parameterised SQL.
See [Database Extensions](./db-extensions.html), [Vector similarity
search](./guide-vector-search.html), and [PostGIS](./guide-postgis.html) for the
working boundaries.

---

See also: [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html) · [Validation](./validators-is.html) · [DTO Helpers](./read-dtos.html)
