ArkType parses TypeScript-like syntax in a template string and builds a validator from it. That makes it the most philosophically similar library to zmdb — both want the type to be the schema — with a completely different implementation.

```ts
// ArkType: TypeScript syntax as a runtime string, parsed by the type system
const user = type({ id: 'number', email: 'string.email' });
const out = user(body);

// zmdb: actual TypeScript, read by a transformer
interface User {
  id: number;
  email: string;
}
const out = assert<User>(body);
```

## Where the two approaches diverge

ArkType's achievement is parsing its syntax _in the type system_, so `'number'` becomes `number` with no build step. The cost is that the syntax is ArkType's, not TypeScript's — it covers a large subset, but a type you already have has to be re-expressed as an ArkType definition to be validated.

zmdb reads the real type. `assert<SomeImportedType>(x)` works on a type from another package, a generated OpenAPI client, or `Entity<typeof users>`, with nothing rewritten. The cost is the transformer.

|                               | ArkType                       | zmdb                            |
| ----------------------------- | ----------------------------- | ------------------------------- |
| Build step                    | none                          | **required**                    |
| Validates a pre-existing type | must be re-expressed          | directly                        |
| Syntax                        | ArkType's string DSL          | TypeScript                      |
| Runtime schema construction   | at module load (fast)         | none                            |
| Dynamic schemas               | yes — definitions are strings | no                              |
| `new Function`                | no                            | no                              |
| Misconfiguration failure mode | n/a                           | **silently accepts everything** |

Both avoid runtime codegen, so both work under a strict CSP and at the edge.

## Using both

The natural boundary is the same as elsewhere: ArkType where the shape is assembled at runtime, zmdb for your own types — especially those derived from a schema, where re-expressing them would defeat the point.

```ts
const dto = assert<CreateDTO<typeof posts>>(body); // derived; nothing to re-declare
const rule = type(tenantConfig.shape)(payload); // string from the database
```

## Mapping the API

| ArkType                                 | zmdb                                                         |
| --------------------------------------- | ------------------------------------------------------------ |
| `user(x)` returning data or `ArkErrors` | `validate<T>(x)` → `{ success, data?, errors? }`             |
| `user.assert(x)`                        | `assert<T>(x)`                                               |
| `user.allows(x)`                        | `is<T>(x)`                                                   |
| `type('number > 5')`                    | `validate()` rules, or [`refine`](./unions-refinements.html) |
| `type([a, '                             | ', b])`                                                      | [`union`](./unions-refinements.html) |
| morphs (`=>`)                           | [`transform`](./unions-refinements.html)                     |
| `'string.email'`                        | a `validate({ kind: 'pattern', value: … })` rule             |

ArkType's constraint syntax (`'number > 5'`, `'string < 100'`) is more expressive inline than zmdb's rule objects. Where you need arbitrary predicates, `refine` takes a function, which is strictly more general and less pretty.

## Migrating from ArkType

1. Write the interface. ArkType definitions map to TypeScript almost mechanically, which is the point of its syntax.
2. `user.assert(x)` → `assert<T>(x)`; `user(x)` → `validate<T>(x)`, noting that the error shape differs.
3. Move numeric and string constraints to `validate()` rules or `refine`.
4. Add the canary **before** step 2:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

## When to stay on ArkType

If a build step is unacceptable and you want type-first validation, ArkType is the better tool — it is the only library in this list that gets close to type-as-schema with no transformer. That is a real engineering trade, not a consolation.

---

See also: [Refine & Transform](./unions-refinements.html) · [Unions](./unions-refinements.html) · [JIT vs AOT](./jit-vs-aot.html)
