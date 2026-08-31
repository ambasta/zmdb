The validation system supports advanced composition through union types and custom refinements. Unions allow modeling "one of many" scenarios, while refinements enable arbitrary predicate-based validation beyond what tags provide.

> [!NOTE]
> These advanced features are designed for the AOT transformer — the runtime fallback evaluates them via `evalRule()`, but full AOT inlining unlocks maximum performance.

## Union Types

Use `union()` to create a validation rule that passes if any branch passes:

```ts
import { union, refine, validateObject } from '@zmdb/aot-validator/advanced';

const stringOrNumber = union({ kind: 'string' }, { kind: 'number' });

// validateObject evaluates the union:
const result = validateObject('hello', { value: stringOrNumber }, 'strip');
// { success: true, issues: [] }

const result2 = validateObject(true, { value: stringOrNumber }, 'strip');
// { success: false, issues: [{ path: 'input.value', ... }] }
```

## Discriminated Unions

For tagged union patterns, use `discriminated()` to validate based on a discriminator key:

```ts
import { discriminated, validateObject } from '@zmdb/aot-validator/advanced';

const paymentMethod = discriminated('type', {
  credit: { kind: 'object', fields: { cardNumber: { kind: 'string' } } },
  debit: { kind: 'object', fields: { bankCode: { kind: 'string' } } },
  cash: { kind: 'object', fields: {} },
});

const validPayment = {
  type: 'credit',
  cardNumber: '4111111111111111',
};

const result = validateObject(validPayment, { payment: paymentMethod }, 'strip');
// { success: true, issues: [] }
```

## Custom Refinements

The `refine()` function creates a custom validation rule with an arbitrary predicate:

```ts
import { refine, validateObject } from '@zmdb/aot-validator/advanced';

// Predicate source is a string that gets compiled to a function
const adultAge = refine('v >= 18', 'must be at least 18 years old');
const oddNumber = refine('v % 2 === 1', 'must be an odd number');

const result = validateObject({ age: 17 }, { age: adultAge }, 'strip');
// { success: false, issues: [{ path: 'input.age', expected: 'v >= 18', message: 'must be at least 18 years old' }] }
```

> [!TIP]
> The predicate source string is what enables AOT inlining — the transformer can emit direct JavaScript rather than calling a runtime function.

## Transform Rules

Use `transform()` to apply a transformation during validation:

```ts
import { transform, validateObject } from '@zmdb/aot-validator/advanced';

const trimAndLowercase = transform('v.trim().toLowerCase()');

const result = validateObject({ name: '  ALICE  ' }, { name: transform('v.trim().toLowerCase()') }, 'strip');
// Result has { name: 'alice' } after transform applied
```

## Strict Mode and Excess Properties

The third parameter to `validateObject` controls how excess properties are handled:

```ts
import { validateObject } from '@zmdb/aot-validator/advanced';

const schema = {
  id: { kind: 'number' },
  name: { kind: 'string' },
};

// 'strip' — removes unknown properties (PostgreSQL default behavior)
validateObject({ id: 1, name: 'a', extra: 'x' }, schema, 'strip');
// { success: true, issues: [], data: { id: 1, name: 'a' } }

// 'strict' — rejects unknown properties
validateObject({ id: 1, name: 'a', extra: 'x' }, schema, 'strict');
// { success: false, issues: [{ path: 'input.extra', expected: 'no excess property', ... }] }

// 'passthrough' — allows unknown properties
validateObject({ id: 1, name: 'a', extra: 'x' }, schema, 'passthrough');
// { success: true, issues: [], data: { id: 1, name: 'a', extra: 'x' } }
```

## Branded Types (Nominal Typing)

Use the `Brand` type to create nominally-typed versions of base types:

```ts
import { Brand } from '@zmdb/aot-validator/advanced';

type UserId = Brand<number, 'UserId'>;
type OrderId = Brand<number, 'OrderId'>;

const userId: UserId = 123 as UserId;
const orderId: OrderId = 456 as OrderId;

// TypeScript sees these as distinct types
// But at runtime they are just numbers (zero footprint)
```

> [!WARNING]
> Branded types are compile-time only — they erase to the base type at runtime. This is intentional for performance; use runtime checks if you need to validate brand at runtime.

- [validate](./validators-validate.html) — base validation
- [assert](./validators-assert.html) — throwing validation
- [json-schema](./json-schema.html) — JSON Schema generation
