Zod declares a schema and infers a type from it. zmdb goes the other way: the type _is_ the schema, and the check is generated at compile time. Both directions work; they interoperate at the edges.

## The shape of the difference

```ts
// Zod: schema first, type derived
const User = z.object({ id: z.number(), email: z.string().email() });
type User = z.infer<typeof User>;
const parsed = User.parse(body);

// zmdb: type first, checker generated
interface User {
  id: number;
  email: string;
}
const parsed = assert<User>(body);
```

|                                   | Zod                  | zmdb validator                               |
| --------------------------------- | -------------------- | -------------------------------------------- |
| Source of truth                   | the schema value     | the TypeScript type                          |
| Runtime cost of the schema        | built at module load | none — a compile-time literal                |
| Build step                        | none                 | **required** ([AOT setup](./aot-setup.html)) |
| Dynamic (runtime-defined) schemas | yes                  | no                                           |
| Refinements                       | `.refine()`          | [`refine`](./unions-refinements.html)        |
| Transforms                        | `.transform()`       | [`transform`](./unions-refinements.html)     |
| Failure mode if misconfigured     | n/a                  | **silently accepts everything**              |

That last row is the one to internalise. Zod cannot be misconfigured into passing everything; zmdb can, if the transformer is not running. See [Gotchas](./gotchas.html).

## Using both in one codebase

Perfectly reasonable, and common during a migration. Keep the boundary explicit:

```ts
// Zod for the dynamic parts — a user-defined form, a plugin manifest
const formSchema = buildZodFromUserConfig(config);

// zmdb for the fixed parts — your own DTOs
const dto = assert<CreatePostDto>(body);
```

The dynamic case is the one zmdb genuinely cannot do: a type parameter must be known at compile time, so a schema assembled at runtime has to be interpreted by something. Zod is a good answer for that; so is [`evalRule`](./unions-refinements.html) for simple rules, or ajv over JSON Schema.

## Feeding a zmdb schema to Zod

If you have a declared table and want a Zod validator for it — say a route already validating with Zod — go through JSON Schema:

```ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';

const jsonSchema = toJsonSchema(users, 'create');
// then use a json-schema-to-zod converter, or ajv directly
```

`toJsonSchema(schema, variant)` covers `entity | create | update | get | list | search`, so the create-shaped schema already omits `serial` columns and respects `defaultTo`. See [OpenAPI Schemas](./openapi.html).

Often the simpler move is to skip Zod for that route: the DTO types are already derived from the schema, and `assert<CreateDTO<User>>(body)` needs no bridge at all.

## Migrating off Zod

Incrementally, one boundary at a time.

**1. Keep the inferred type, drop the schema.** Where the schema is only used for `parse`, the type it inferred is what you actually wanted:

```ts
// before
const User = z.object({ id: z.number(), email: z.string() });
type User = z.infer<typeof User>;

// after
interface User {
  id: number;
  email: string;
}
```

**2. Replace `parse` with `assert`, `safeParse` with `validate`.**

```ts
User.parse(body)      → assert<User>(body)
User.safeParse(body)  → validate<User>(body)   // { success, data?, errors? }
```

**3. Translate the refinements you actually rely on.** Format checks that Zod gives you as methods are `validate()` rules or a [`refine`](./unions-refinements.html) predicate. Decide explicitly which ones matter — `z.string().email()` is a regex, and half the codebases that call it do not need it.

> [!WARNING]
> Zod coerces nothing by default and neither does `assert`. But `z.coerce.number()`
> has no direct equivalent — use [`coerce`](./unions-refinements.html) explicitly, and
> only at a boundary where the input is genuinely stringly-typed (query strings,
> form bodies).

**4. Add the canary test before you trust any of it.**

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

Without this, step 2 replaces working validation with validation that reports success unconditionally. It is the single most important step in the migration.

## When to stay on Zod

- Schemas defined at runtime.
- A toolchain you cannot add a TypeScript transformer to — [Bun](./connect-bun.html), Metro, an esbuild-only pipeline.
- Heavy use of Zod's ecosystem (`zod-to-openapi`, form libraries binding to Zod schemas).

There is no prize for having one validator.

---

See also: [AOT Setup](./aot-setup.html) · [Refine & Transform](./unions-refinements.html) · [Gotchas](./gotchas.html)
