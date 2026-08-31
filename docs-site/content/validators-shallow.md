> **ToDo / feature gap.** There are no shallow validators. Typia's
> `is`/`assert` family has `equals`-style variants that check only the top level;
> `@zmdb/aot-validator`'s functions all recurse through the whole type.

## What is available

| Function             | Depth | Extra properties |
| -------------------- | ----- | ---------------- |
| `is<T>(v)`           | full  | ignored          |
| `assert<T>(v)`       | full  | ignored          |
| `validate<T>(v)`     | full  | ignored          |
| `equals<T>(v)`       | full  | **rejected**     |
| `assertEquals<T>(v)` | full  | **rejected**     |

So the axis that _is_ covered is strictness about unknown keys, not depth. `equals` is the one to reach for when an unexpected field should be an error — a webhook payload you are asked to reject on, or a config object where a typo must not be silently ignored.

## Why shallow checking is usually the wrong tool

The reason to want it is speed: skip the nested walk on a large object. But the generated validators are specialised to the type, which is where the [10–100× advantage over reflective validators](./benchmarks.html) comes from — the nested walk is a straight-line sequence of typed property reads, not a recursive interpretation of a schema. Measure before assuming the depth is what costs you. In the reported numbers, the nested-object case is not meaningfully worse per byte than the flat one.

The reason it is _risky_ is that a shallow check on a nested type is a partial check that reads like a total one. `is<{ user: { id: number } }>(v)` passing while `v.user.id` is a string is a bug waiting a few frames.

## If you need to check one level

Name a shallower type. This is explicit about what was verified, and the type system carries that fact forward:

```ts
type UserEnvelope = { id: number; profile: unknown };

const env = assert<UserEnvelope>(raw);
// profile is `unknown` — you cannot use it without narrowing, which is the point
const profile = assert<Profile>(env.profile);
```

Two checks, each total over what it claims. The `unknown` in the middle is doing the work: it makes the deferred validation impossible to forget.

## Deferring an expensive branch

The same trick handles "validate the envelope now, the payload when we get to it":

```ts
interface Job {
  kind: string;
  payload: unknown;
}

const job = assert<Job>(JSON.parse(body));
switch (job.kind) {
  case 'resize':
    return handleResize(assert<ResizeArgs>(job.payload));
  case 'encode':
    return handleEncode(assert<EncodeArgs>(job.payload));
  default:
    throw new Error(`unknown job ${job.kind}`);
}
```

For the general form of this, use [`discriminated`](./unions-refinements.html), which does the dispatch and the branch validation in one call.

## What it would take

A `depth` option on the descriptor and a generated validator that stops descending — small in the transformer, and genuinely useful for one case: revalidating a value at an internal boundary where the deep check already ran at the edge. It has not been prioritised because that case is better served by not revalidating at all. If you have a measured profile where the recursion is the cost, that is the argument that would move it.

---

See also: [is()](./validators-is.html) · [assert()](./validators-assert.html) · [equals()](./validators-misc.html)
