This manual covers the union of four doc surfaces — [Drizzle ORM](https://orm.drizzle.team/docs/overview), [MikroORM](https://mikro-orm.io/docs/quick-start), [Typia](https://typia.io/docs/) and
[NestJS](https://docs.nestjs.com/) — because zmdb is meant to replace all four. Coverage is checked mechanically: `yarn verify:docs-coverage` walks the upstream page inventory and fails if any page is
neither documented here nor listed as out of scope with a reason.

Fourteen upstream pages are out of scope. They are not gaps and they are not roadmap — a page marked **ToDo** in this manual is a capability we intend to build; a page on this list is one we have
decided against. Almost all of them share a root cause: they document machinery that exists to recover, cache or track information that zmdb resolves at compile time and then keeps in plain data.

> [!NOTE] Disagreeing with an entry here is a design argument, not a bug report — but do make it. Each reason below is falsifiable, and if the trade-off stops holding the right response is to build
> the feature, not to soften the wording.

## What lint can enforce

Most entries on this page are architectural choices, not syntax a linter can identify from one file. The shipped [Lint Rules](./lint-rules.html) deliberately cover only six precise local mistakes:
nullable tag distribution, erased JSON shapes, interpolated SQL sinks, ambiguous numeric columns, unbounded reads and empty update patches. They do not pretend to detect an identity map, a unit of
work or another application-level design from an AST node.

## Loaders and caches do not make rows live

The supported [DataLoader](./dataloaders.html) and [result cache](./caching.html) retain read values, but neither is the identity map rejected below:

| Property       | Request loader              | Result cache                    | Identity map                       |
| -------------- | --------------------------- | ------------------------------- | ---------------------------------- |
| Consulted by   | Explicit `load()`           | A read with `cache`             | Every entity read                  |
| Lifetime       | One explicit request scope  | Explicit TTL/store              | ORM session/context                |
| Row identity   | Fresh shallow copy          | Fresh shallow copy              | Shared object reference            |
| Write behavior | No tracking or invalidation | Invalidates table + caller tags | Tracks objects for flush/coherence |

The distinction is not the word “cache”. It is whether the ORM owns a canonical live object graph. zmdb does not: ordinary reads bypass both mechanisms, mutating a returned row never schedules SQL,
and every write remains an explicit repository call.

## Application-level cascade emulation hides writes

zmdb emits `ON DELETE` and `ON UPDATE` actions into database constraints; it does not make a repository walk an object graph and delete or persist related rows on the caller's behalf. Database actions
are atomic with the parent write, apply to every database client and do not turn one repository call into an unbounded series of queries.

When deleting related rows also has application side effects, write those operations explicitly inside a transaction. See [Cascading](./cascading.html) for the generated constraints and the explicit
transaction pattern.

<!-- generated: coverage/mapping.mjs antiPatterns() -->

## What is _not_ on this list

Three exclusions people expect to find here, and why they are not:

- **Active Record.** Not an upstream page in its own right; the underlying objection is [inert rows](./inert-rows.html) — a row has no `save()` because it carries no persistence state.
- **Protocol Buffers.** Typia's protobuf codec is documented, not excluded — see [Protobuf Message](./protobuf-message.html), [Encode](./protobuf-encode.html) and [Decode](./protobuf-decode.html).
- **Runtime schema sync.** `updateSchema()`-style live DDL is documented as a deliberately narrow tool in [Migrations](./migrations.html) and [`cli-push`](./cli-push.html), which is the reviewable,
  diffed path.

---

See also: [Why zmdb](./why-zmdb.html) · [Architecture](./architecture.html) · [Lint Rules](./lint-rules.html) · [Inert Rows](./inert-rows.html) · [JIT vs AOT](./jit-vs-aot.html)
