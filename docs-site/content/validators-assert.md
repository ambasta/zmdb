The `assert` function validates a value against a TypeDescriptor and throws an `AssertError` if validation fails. Unlike `validate` which returns a result object, `assert` is designed for cases where you want validation failures to halt execution immediately — perfect for guard clauses and early returns.

> [!IMPORTANT]
> The AssertError contains a `issues` array with all validation failures, not just the first one. This enables displaying comprehensive error messages to users.

## Basic Usage

```ts
import { assert } from '@zmdb/aot-validator/utilities';
import { tags } from '@zmdb/aot-validator';

const descriptor = {
  kind: 'object',
  fields: {
    username: { kind: 'string', maxLength: 20 },
    score: { kind: 'number', minimum: 0 },
  },
};

// Success — returns the value cast to T
const user = assert({ username: 'alice', score: 100 }, descriptor);
// user: { username: 'alice', score: 100 }

// Failure — throws AssertError
try {
  assert({ username: 'thisusernameistoolong', score: -5 }, descriptor);
} catch (e) {
  // e instanceof AssertError === true
  // e.issues contains all failures
}
```

## AssertError Shape

When validation fails, an `AssertError` is thrown with detailed error information:

```ts
class AssertError extends Error {
  readonly issues: readonly ValidationIssue[] = [];
}

// Each issue provides exact path and expected type
interface ValidationIssue {
  readonly path: string; // e.g., 'input.score'
  readonly expected: string; // e.g., 'number >= 0'
  readonly value: unknown; // -5
  readonly message: string; // 'expected number >= 0'
}
```

```sql
-- Generated error output (for debugging):
-- path: input.username, expected: maxLength 20, value: "thisusernameistoolong"
-- path: input.score, expected: number >= 0, value: -5
```

## Excess Property Checking

Use `assertEquals` for strict mode — it enforces that no extra properties exist beyond what the descriptor defines:

```ts
import { assertEquals } from '@zmdb/aot-validator/utilities';

const descriptor = {
  kind: 'object',
  fields: {
    id: { kind: 'number' },
    name: { kind: 'string' },
  },
};

// OK — only declared properties
assertEquals({ id: 1, name: 'test' }, descriptor);

// Throws — excess property 'extra' not in descriptor
assertEquals({ id: 1, name: 'test', extra: 'oops' }, descriptor);
// Issues: [{ path: 'input', expected: 'no excess properties', ... }]
```

> [!WARNING]
> The `equals` and `assertEquals` functions check for excess properties recursively. Objects with nested structures must not contain properties not defined in the nested descriptor.

## Using with Primitive Tags

The validation system integrates with tags for rich constraint checking:

```ts
import { assert, validate } from '@zmdb/aot-validator/utilities';

// A descriptor is what these two take — tags belong on schema columns, and
// `validate(rule, value)` from the package root is the tag evaluator.
assert('user@example.com', { kind: 'string', pattern: '^[^@]+@[^@]+$' });

// Combining with validate() for programmatic flow
const result = validate(
  { email: 'bad', age: 17 },
  {
    kind: 'object',
    fields: {
      email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
      age: { kind: 'number', minimum: 21 },
    },
  },
);

if (!result.success) {
  // Handle errors gracefully
  console.log(result.errors);
}
```

## AOT Inlining

In production with the AOT transformer, authored validation code like:

```ts
// Authored source:
assert(value, { kind: 'string', pattern: '^\\d+$' });
```

Becomes inlined at build time:

```ts
// AOT output (no function call, no descriptor allocation):
(typeof value === 'string' && /^\d+$/.test(value) ? value : (() => { throw ...; })())
```

This eliminates all runtime validation overhead — the check becomes a simple boolean expression.

- [validate](./validators-validate.html) — non-throwing variant
- [is](./validators-tags.html) — boolean guard (no throws)
- [random](./random.html) — generate valid test data
