What works with no build plugin, and what does not. The short version: a validator call that gets its shape from a **type argument** needs the transformer, because a type argument does not exist at
runtime. Everything that gets its shape from a **value** does not.

## The part that needs the build step

```ts
import { is } from '@zmdb/aot-validator/utilities';

is<User>(payload); // needs the transformer
```

`is<T>`, `isShallow<T, D>`, `assert<T>`, `assertShallow<T, D>`, `validate<T>`, `validateShallow<T, D>`, `equals<T>`, `assertEquals<T>`, `random<T>`, `toJsonSchema<T>`, `schemaOf<T>`, `toolFor<T>`,
`protoDescriptor<T>`, `protoDecode<T>`, `protoEncode<T>`, `grpcDescriptor<S>` and `loadGrpcService<S>` are the seventeen calls the transformer currently rewrites. It replaces each with emitted code
built from the reflected IR. Where it did not run over a file, the type argument is gone and the call **throws** — the validation utilities ask for a runtime witness, while the schema, protobuf and
gRPC artifact calls name the build transform that should have replaced them.

> [!IMPORTANT] There is no fallback that inspects `T` at runtime, because there is nothing to inspect. An earlier version of this page described the untransformed path as "slower but working"; it
> fails open, which is worse than failing, so it now throws. See [AOT Setup](./aot-setup.html).

## The part that does not

**Rule-first validation.** `validate(rule, value)` takes the constraint as a value, so it runs anywhere:

```ts
import { tags, validate } from '@zmdb/aot-validator';

validate(tags.Min(0), input.price); // boolean
validate(tags.Pattern('^[^@]+@[^@]+$'), input.email);
validate(tags.Enum('draft', 'review', 'published'), input.status);
```

| Rule                            | Checks                                  |
| ------------------------------- | --------------------------------------- |
| `Min(n)` / `Max(n)`             | a `number` within an inclusive bound    |
| `MinLength(n)` / `MaxLength(n)` | a `string`'s length                     |
| `Pattern(re)`                   | a `string` against a regular expression |
| `Enum(...values)`               | membership — variadic, not an array     |

Every rule answers `false` for a value of the wrong type rather than throwing, and the emitted form has identical boolean semantics — that equivalence is what makes this a safe fallback rather than a
second implementation. An unknown `kind` throws.

**Serialization.** Neither `stringify` nor `parse` is transformed, so both work unchanged:

```ts
import { parse, stringify } from '@zmdb/aot-validator/serialization';

const json = stringify(user); // JSON.stringify, plus one fixed bigint TypeError
const result = parse(json); // { success, data? , issues? } — malformed JSON is a value, not a throw
```

`parse<T>`'s type argument is an unvalidated claim, exactly as `JSON.parse`'s cast would be. The checking step is separate, and it is one of the transformed validation calls.

**A validator with an explicit schema.** The nine validation/generation utilities accept a `TypeIR` value as their fallback witness (`random` takes it first; the eight value-checking calls take it
second). The three shallow calls additionally accept their depth as a third fallback-only argument. The schema and protobuf calls cannot use that escape hatch because their public contract is
compile-time-only:

```ts
import { assert, type TypeIR } from '@zmdb/aot-validator/utilities';

const ir: TypeIR = { kind: 'scalar', scalar: 'string' };
assert(rawValue, ir); // no type argument, no transformer
```

There used to be a second accepted shape, a hand-written `TypeDescriptor`. It is gone: a descriptor is a type written out again by hand, in a form nothing checks against the type it claims to
describe, so it drifts silently the moment the interface is edited.

Where the IR comes from is the catch: reflecting it from a type is what the build step does. Writing one by hand is reasonable for a scalar and unreasonable for a table.

**Everything that is not the validator.** The query compiler, the repository, `WhereDTO`/`ListDTO` handling, the migration engine, `@zmdb/web`'s routing and DI, and all of the derived DTO _types_ are
plain TypeScript and plain functions. They need no plugin. The one exception inside that list is `schemaOf<T>()`, which is how a declaration becomes a runtime schema object — so the value you pass to
`defineRepository` comes from the build step even though the repository itself does not.

## Comparison

| Aspect      | Rule-first / explicit IR | Type argument + AOT                     |
| ----------- | ------------------------ | --------------------------------------- |
| Setup       | none                     | build plugin                            |
| Shape from  | a value you wrote        | the type you declared                   |
| Coverage    | five constraint keywords | the whole type                          |
| Performance | a `switch` per call      | straight-line, no allocation            |
| Failure     | `false`                  | `false`, or an `AssertError` with paths |

The performance line is the least interesting one. What the type-argument path buys is that the check cannot drift from the declaration, because there is only one declaration.

## Cross-links

- [AOT Setup](./aot-setup.html) — configuring the plugin
- [jit-vs-aot](./jit-vs-aot.html) — what the emitted code looks like
- [assert](./validators-assert.html) · [validate](./validators-validate.html)
- [Tag Reference](./tags-reference.html) — the type-level constraint vocabulary
