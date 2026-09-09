`validate<T>()` is non-throwing validation: it returns a result object rather than raising. Use it where a failure is an expected outcome you have to render — a request body, a config file, a queue
message — and [`assert`](./validators-assert.html) where a failure means a bug.

> [!WARNING] Use full-depth `validate<T>()` for untrusted input. `validateShallow<T, D>()` deliberately omits checks below `D` and can report success for malformed nested data; it is only for
> rechecking data whose deeper contents are already trusted. See [Shallow Validation](./validators-shallow.html).

<!-- snippet: validators-validate.ts#snippet-1 -->

## Basic Usage

The type argument is the schema. There is nothing to pass and nothing to keep in step:

<!-- snippet: validators-validate.ts#snippet-2 -->

On success, `data` is narrowed to `T`; on failure it is absent and `errors` is populated. The two are never both present, so the discriminator to branch on is `success`:

<!-- snippet: validators-validate.ts#snippet-3 -->

> [!NOTE] The transformer rewrites `validate<Signup>(body)` into a call carrying `Signup`'s IR, reflected from the type at build time. The second parameter — a `TypeIR` — is the escape hatch for a
> caller that already holds one; the transformer normally supplies it and you do not write it. Without the transformer, an untransformed call with no second argument throws.

## Error Structure

Each issue carries where and what:

<!-- snippet: validators-validate.ts#snippet-4 -->

`path` is exact, including array indices and nested keys:

<!-- snippet: validators-validate.ts#snippet-5 -->

`validate` collects every issue rather than stopping at the first, which is what makes it usable for a form: one round trip, every field.

## Validating a table's write shape

The DTO types are the useful arguments here — they are the shapes a client actually sends:

<!-- snippet: validators-validate.ts#snippet-6 -->

`CreateDTO<User>` and not `User`: passing an `id` to an insert is an error worth reporting, and the DTO type is what makes it one. See [DTO Helpers](./read-dtos.html).

## Integration with Repository

You get this without asking on every write. `create`, `upsert` and `update` validate the payload against the same IR before any SQL is compiled:

<!-- snippet: validators-validate.ts#snippet-7 -->

The thrown `ValidationError` carries `.issues`, the same `ValidationIssue[]` shape, so a handler can render a repository failure and a boundary failure the same way:

<!-- snippet: validators-validate.ts#snippet-8 -->

`validationIssuesOf` is structural rather than an `instanceof` check — it accepts anything carrying a well-formed `issues` array, so a zod or io-ts error from elsewhere in the same handler lands in
the same branch — and it drops entries missing a `path` or a `message` rather than serialising them half-formed into a response body.

Two things it checks that a hand-written walk over the columns would not: the bounds (`Min`, `Pattern`, `MaxLength`) that the declaration carries, and excess keys — supplying a `Serial` column gets
you `the database generates "id", so a payload cannot supply it` rather than a silent drop.

## `validate` against the others

| Function             | On failure                   | On success                              |
| -------------------- | ---------------------------- | --------------------------------------- |
| `is<T>(x)`           | `false`                      | `true`, narrows `x`                     |
| `validate<T>(x)`     | `{ success: false, errors }` | `{ success: true, data }`               |
| `assert<T>(x)`       | throws `AssertError`         | returns `x` as `T`                      |
| `equals<T>(x)`       | `false`                      | `true` — and no excess keys             |
| `assertEquals<T>(x)` | throws                       | returns `x` as `T` — and no excess keys |

---

- [assert](./validators-assert.html) — throwing variant
- [is](./validators-is.html) — boolean type guard
- [tags](./validators-tags.html) — the constraints (`Min`, `Pattern`, …)
- [unions-refinements](./unions-refinements.html) — union types and custom refinements
