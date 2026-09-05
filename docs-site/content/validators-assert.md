`assert<T>()` checks a value against `T` and throws an `AssertError` if it does not hold. On success it returns the value typed as `T`, which is what makes it a one-line boundary: the unknown goes in,
the typed value comes out, and there is no cast anywhere.

Reach for it where a failure means something upstream is broken. Where a failure is an expected outcome you have to render, use [`validate`](./validators-validate.html).

## Basic Usage

<!-- snippet: validators-assert.ts#snippet-1 -->

The type argument is the schema. `assert<Player>(x)` is a complete call — there is no descriptor to write beside the type and no way for the two to disagree.

> [!IMPORTANT] `issues` holds **every** failure, not just the first. The message on the error is the first issue's message, because an exception needs one line; the array is what you render.

## AssertError Shape

<!-- snippet: validators-assert.ts#snippet-2 -->

For the failing call above:

```text
path: input.username, expected: maxLength 20, value: "thisusernameistoolong"
path: input.score,    expected: minimum 0,    value: -5
```

`expected` is one spelling, produced in one place and used by both the emitted and the runtime path: a violated constraint reads `<keyword> <value>` (`minimum 0`, `maxLength 20`, `pattern ^\d+$`), and
a wrong type reads the type (`number`, `string`, `Date`, `"draft" | "published"`). `message` is always `expected ` followed by it.

`AssertError` is a real exported class in its own module, and the emitted code imports it rather than declaring its own. That is deliberate: a hoisted class in the generated prelude would make
`err instanceof AssertError` true before a build and false after one, which is exactly the dev-versus-prod divergence the AOT path exists to avoid.

## Asserting a table's write shape

<!-- snippet: validators-assert.ts#snippet-3 -->

`CreateDTO<User>` and not `User`: a `Serial` primary key is absent from the insert shape, so a client that sends an `id` gets an issue rather than a surprise. See [DTO Helpers](./read-dtos.html).

## Excess Property Checking

`assertEquals<T>()` is the strict form: it additionally rejects properties `T` does not declare.

<!-- snippet: validators-assert.ts#snippet-4 -->

> [!NOTE] `assertEquals<T>(input)` takes **one** value. It is not a two-value comparison — the name is about exactness against the type, not equality between two objects. `equals<T>(input)` is the
> boolean form.

Both check recursively: a nested object may not carry properties its nested type does not declare either. Excess is reported as one issue about the value as a whole, and only when nothing else was
wrong — "you also passed `extra`" is noise next to "`name` is not a string".

## Constraints

The tags from `zmdb/tags` are what the checks come from, on a bare type argument as much as on a table:

<!-- snippet: validators-assert.ts#snippet-5 -->

See [Tag Reference](./tags-reference.html) for the full vocabulary and [validators-tags](./validators-tags.html) for the difference between these type-level tags and the runtime `tags.Min(18)` rule
values.

## AOT Inlining

With the transformer enabled, an `assert` call becomes straight-line JavaScript. The gate is the allocation-free boolean check, and the issue walk only runs once a throw is already certain:

<!-- snippet: validators-assert.ts#snippet-6 -->

```text
// emitted, in outline
if (typeof value === "number" && !Number.isNaN(value) && value >= 0) return value;
const _e = []; _zmdbIssues0(value, "input", _e);
throw new _zmdbAssertError(_e[0] ? _e[0].message : "validation failed", _e);
```

Nothing is allocated on the success path — no descriptor, no issue array, no closure. Two `assert<Player>(…)` calls in the same module share one hoisted checker, matched by the shape of the IR rather
than by the name you wrote, so two call sites that never mention each other still compile to one function.

Without the transformer, the runtime walker does the same walk over the same IR, and `differential.spec.ts` holds the two to identical accept/reject sets _and_ identical issue paths.

---

- [validate](./validators-validate.html) — non-throwing variant
- [is](./validators-is.html) — boolean guard
- [Tag Reference](./tags-reference.html) — the constraints
- [random](./random.html) — generate valid test data
