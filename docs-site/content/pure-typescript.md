Runtime validation without the AOT build step. The `@zmdb/aot-validator` package provides validation utilities that work without any build plugin — just import and use.

## When to Use Runtime

- Quick prototyping without build configuration
- Environments where build plugins aren't available
- Debugging AOT-transformed code (compare behavior)

> [!NOTE]
> Runtime validation is slower than AOT (5-24× depending on the case). For production, prefer the AOT setup.

## Basic Usage

```ts
import { is, assert, validate, equals } from '@zmdb/aot-validator/utilities';

// Type guard — returns boolean
if (is<User>(payload)) {
  // TypeScript narrows payload to User here
  console.log(payload.email);
}

// Assert — throws on invalid
const user = assert<User>(payload);
// user: User (or throws AssertError)

// Validate — returns result object
const result = validate<User>(payload);
if (result.success) {
  console.log(result.data);
} else {
  console.log(result.errors);
}

// Deep equality check
const same = equals<User>(a, b);
```

## Result Types

```ts
// validate() returns this shape:
interface ValidateResult<T> {
  success: boolean;
  data?: T;
  errors?: readonly {
    path: string;
    expected: string;
    value: unknown;
    message: string;
  }[];
}
```

## Working with DTOs

Validate against your schema-derived types:

```ts
import type { CreateDTO } from '@zmdb/schema-core';
import { assert } from '@zmdb/aot-validator/utilities';

// Type is derived from your schema
const payload = assert<CreateDTO<typeof UserSchema>>(requestBody);
```

## Tags for Constraints

Use validation tags for runtime rules:

```ts
import { tags, validate } from '@zmdb/aot-validator'; // rule-first validate: (rule, value) => boolean

const ok = validate(tags.Min(0), input.price);
const validEmail = validate(tags.Pattern('^[^@]+@[^@]+$'), input.email);
```

Available tags:

- `Min(n)`, `Max(n)` — numeric bounds
- `MinLength(n)`, `MaxLength(n)` — string/array bounds
- `Pattern(regex)` — RegExp validation
- `Enum([values])` — allowed values

## Serialization

JSON stringify/parse with validation:

```ts
import { stringify, parse, assertStringify } from '@zmdb/aot-validator/serialization';

// Serialize (fast, no validation)
const json = stringify(user);

// Serialize + validate (throws on invalid)
const safeJson = assertStringify<User>(user);

// Parse + validate
const result = parse<User>(json);
if (!result.success) {
  console.log(result.errors);
}
```

## Comparison: Runtime vs AOT

| Aspect      | Runtime               | AOT          |
| ----------- | --------------------- | ------------ |
| Setup       | None                  | Build plugin |
| Performance | Baseline              | 5-24× faster |
| Output      | `TypeDescriptor` walk | Inline JS    |
| Debugging   | Easier                | Harder       |

```ts
// Runtime path (no build)
import { is } from '@zmdb/aot-validator/utilities';

// After AOT build, this becomes inline JS
const ok = is<User>(payload);
```

> [!TIP]
> Start with runtime validation for development speed. Add the AOT build plugin before deploying to production.

## Cross-links

- [AOT Setup](./aot-setup.html) — build plugin configuration
- [Validation](./validators-is.html) — full validation API
- [Benchmarks](./benchmarks.html) — performance comparison
