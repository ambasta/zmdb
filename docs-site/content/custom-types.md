Custom types let you define domain-specific types with bidirectional encoding/decoding between your TypeScript runtime and the database. zmdb treats custom types as first-class citizens — they're not ORM magic but explicit contracts between your app and the database.

## Defining a Custom Type

Use `defineType` to create a custom type with explicit `toDb` and `fromDb` functions. The type is immutable and frozen — safe to share across your application.

```ts
import { defineType, encodeValue, decodeValue } from '@zmdb/schema-core';

interface Money {
  amount: number;
  currency: string;
}

const MoneyType = defineType<Money, string>({
  sqlType: 'VARCHAR(50)',
  toDb: m => `${m.amount}:${m.currency}`,
  fromDb: s => {
    const [amount, currency] = s.split(':');
    return { amount: Number(amount), currency };
  },
});

// Usage
const dbValue = encodeValue(MoneyType, { amount: 100, currency: 'USD' });
// dbValue => "100:USD"

const appValue = decodeValue(MoneyType, '100:USD');
// appValue => { amount: 100, currency: 'USD' }
```

> [!TIP]
> Keep `toDb` and `fromDb` as pure functions — no side effects. This ensures predictable behavior during serialization and deserialization.

## Using Custom Types in Schemas

Reference your custom type in a column definition. The `sqlType` becomes the DDL; the codec functions handle runtime conversion.

```ts
import { defineSchema, text, defineType } from '@zmdb/schema-core';
import { assert } from '@zmdb/aot-validator/utilities';

const MoneyType = defineType<Money, string>({
  sqlType: 'VARCHAR(50)',
  toDb: m => `${m.amount}:${m.currency}`,
  fromDb: s => {
    const [amount, currency] = s.split(':');
    return { amount: Number(amount), currency };
  },
});

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  total: text().customType(MoneyType).notNull(),
});
```

Generated DDL:

```sql
CREATE TABLE "orders" (
  "id" SERIAL PRIMARY KEY,
  "total" VARCHAR(50) NOT NULL
)
```

## JSON/Enum Variants

For complex enums or JSON columns, custom types shine. You can store structured data as JSON while maintaining type safety in your domain model.

```ts
interface Priority {
  level: 'low' | 'medium' | 'high';
  escalated: boolean;
}

const PriorityType = defineType<Priority, string>({
  sqlType: 'JSONB',
  toDb: p => JSON.stringify(p),
  // the column is JSONB; nothing guarantees the shape on read, so check it
  fromDb: raw => assert<Priority>(JSON.parse(raw)),
});

const TaskSchema = defineSchema('tasks', {
  id: serial().primaryKey(),
  priority: text().customType(PriorityType).notNull(),
});
```

## Type Safety Guarantees

Custom types provide compile-time guarantees. If your `toDb` returns `DB` and `fromDb` accepts `DB`, the type system ensures you never accidentally pass raw values where decoded types are expected.

```ts
// This compiles — types align
const encoded = encodeValue(MoneyType, { amount: 50, currency: 'EUR' });

// This fails — fromDb expects string, not number
// decodeValue(MoneyType, 42); // Type error
```

> [!IMPORTANT]
> Custom types do NOT add runtime validation. If the database returns malformed data, `fromDb` will throw. Pair custom types with `@zmdb/aot-validator` for full runtime safety.

---

See also: [Schema Core](./schema-declaration.html) · [Validation](./validators-is.html) · [DTO Helpers](./read-dtos.html)
