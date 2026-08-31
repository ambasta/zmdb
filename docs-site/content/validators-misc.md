The rest of `@zmdb/aot-validator/utilities`. All of these take an optional `TypeDescriptor` that the transformer fills in — without it, they have nothing to work from. See [AOT Setup](./aot-setup.html).

## `equals` / `assertEquals` — reject unknown keys

```ts
import { equals, assertEquals } from '@zmdb/aot-validator/utilities';

interface Config {
  host: string;
  port: number;
}

equals<Config>({ host: 'a', port: 1 }); // true
equals<Config>({ host: 'a', port: 1, prot: 2 }); // false — `prot` is not in the type
assertEquals<Config>(raw); // throws instead of returning false
```

`is` and `assert` ignore extra properties, which is right for an API request you do not control. `equals` is right when an unknown key means someone made a mistake you should surface — a config file, an internal message, a payload whose sender you own. The typo case is the strongest argument for it: `prot: 8080` with `is` gives you a default port and a confusing afternoon.

## `random` — a value that satisfies a type

```ts
import { random } from '@zmdb/aot-validator/utilities';

const user = random<User>();
const body = random<CreateUserRequest>();
```

Useful for tests and for property-style checks over your own code:

```ts
it('serialization round-trips', () => {
  for (let i = 0; i < 100; i++) {
    const u = random<User>();
    expect(parse<User>(stringify<User>(u))).toEqual({ success: true, data: u });
  }
});
```

The values satisfy the type and any recognised `validate()` rules. They are not realistic — see [Seed Functions](./seed-functions.html) if you want data that looks like data.

> [!NOTE]
> `random` is not seeded. Two calls give two values, and a failing generated case
> is not reproducible from the test output. Log the value on failure, or use
> `seedRows` / `makeRng` when you need determinism.

## `validate` — errors without an exception

```ts
import { validate } from '@zmdb/aot-validator/utilities';

const result = validate<CreateUserRequest>(ctx.body);
if (!result.success) {
  throw new ValidationError('invalid payload', result.errors);
}
```

Each error carries the path (`input.address.zip`), the expected type and the value found — which is what makes a 400 response useful to whoever is calling you. Prefer this over catching an `assert`: a validation failure is an expected outcome of an untrusted input, not an exceptional one.

## Choosing between them

| You want                                       | Use            |
| ---------------------------------------------- | -------------- |
| a boolean                                      | `is`           |
| the value or an exception                      | `assert`       |
| every error, as data                           | `validate`     |
| a boolean, extra keys rejected                 | `equals`       |
| the value or an exception, extra keys rejected | `assertEquals` |
| a value of the type                            | `random`       |

## The pattern at an HTTP boundary

```ts
@Post('/users')
async create(ctx: Ctx<Record<never, string>, unknown>) {
  const result = validate<CreateDTO<typeof users>>(ctx.body);
  if (!result.success) throw new ValidationError('invalid payload', result.errors);
  return this.repo.create(result.data);
}
```

Typing the body as `unknown` is deliberate: it makes the `validate` call the only way to get at it, so the check cannot be skipped by accident.

---

See also: [is()](./validators-is.html) · [assert()](./validators-assert.html) · [Seed Functions](./seed-functions.html)
