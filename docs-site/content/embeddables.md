Embeddables let you compose complex value objects from multiple columns. Instead of storing a JSON blob, you get flat columns with type-safe access. zmdb provides `flattenEmbeddable` and `liftEmbeddable` utilities to transform between the flat database representation and nested TypeScript objects.

## Embedding a Value Object

Define an embeddable as a TypeScript interface, then use helper functions to map between flat and nested representations.

```ts
import { defineSchema, serial, text, json } from '@zmdb/schema-core';
import { flattenEmbeddable, liftEmbeddable } from '@zmdb/repository/entity-modeling';
import { assert } from '@zmdb/aot-validator/utilities';

interface Address {
  street: string;
  city: string;
  zip: string;
  country: string;
}

// No separate schema — just a type you compose
type AddressEmbed = {
  street: string;
  city: string;
  zip: string;
  country: string;
};

const CustomerSchema = defineSchema('customers', {
  id: serial().primaryKey(),
  name: text().notNull(),
  // Embed as separate columns
  address_street: text().notNull(),
  address_city: text().notNull(),
  address_zip: text().notNull(),
  address_country: text().notNull(),
});

// Flatten for inserts/updates
function toDbAddress(addr: Address): Record<string, unknown> {
  return flattenEmbeddable('address', addr);
}

// Lift from database rows
function fromDbAddress(row: Record<string, unknown>): Address {
  // liftEmbeddable returns Record<string, unknown>; assert returns the narrowed value
  return assert<Address>(liftEmbeddable('address', row));
}

// Usage in repository
class CustomerRepository extends BaseRepository<typeof CustomerSchema> {
  async createWithAddress(data: { name: string; address: Address }) {
    const flat = { name: data.name, ...toDbAddress(data.address) };
    return this.create(flat);
  }

  async findById(id: number) {
    const row = await super.findById(id);
    if (!row) return null;
    return { ...row, address: fromDbAddress(row) };
  }
}
```

Generated DDL:

```sql
CREATE TABLE "customers" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "address_street" TEXT NOT NULL,
  "address_city" TEXT NOT NULL,
  "address_zip" TEXT NOT NULL,
  "address_country" TEXT NOT NULL
)
```

## JSON-Based Embeddables

For complex nested structures, store as JSON. The schema still defines each field explicitly for validation, but you can nest the type in TypeScript.

```ts
const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  // Single JSON column for complex embed
  metadata: json().notNull(),
});

// Type-safe access via projection
type OrderMetadata = {
  source: string;
  priority: number;
  tags: string[];
};
```

> [!NOTE]
> Embeddables are a modeling pattern, not a database feature. You choose between flat columns (better indexability, SQL compatibility) or JSON (flexibility, nested structure). Both work with zmdb.

## Validation Integration

Embeddables integrate with `@zmdb/aot-validator`. Define the embeddable type, then validate it using the AOT inlined validators.

```ts
import { is, assert, validate } from '@zmdb/aot-validator/utilities';

// Inline the embeddable schema
const AddressValidator = is(
  object({
    street: string,
    city: string,
    zip: string,
    country: string,
  }),
);

// Validate incoming data
const result = validate(AddressValidator, incomingAddress);
if (!result.success) {
  throw new Error(result.errors.join(', '));
}
```

> [!TIP]
> Keep embeddables as value objects — immutable, compared by value. They're not entities with identity.

---

See also: [Schema Core](./schema-declaration.html) · [Lifecycle Hooks](./lifecycle-hooks.html) · [Validation](./validators-is.html)
