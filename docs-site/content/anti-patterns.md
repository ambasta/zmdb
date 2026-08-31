This manual covers the union of four doc surfaces — [Drizzle ORM](https://orm.drizzle.team/docs/overview), [MikroORM](https://mikro-orm.io/docs/quick-start), [Typia](https://typia.io/docs/) and [NestJS](https://docs.nestjs.com/) — because zmdb is meant to replace all four. Coverage is checked mechanically: `yarn verify:docs-coverage` walks the upstream page inventory and fails if any page is neither documented here nor listed as out of scope with a reason.

Fourteen upstream pages are out of scope. They are not gaps and they are not roadmap — a page marked **ToDo** in this manual is a capability we intend to build; a page on this list is one we have decided against. Almost all of them share a root cause: they document machinery that exists to recover, cache or track information that zmdb resolves at compile time and then keeps in plain data.

> [!NOTE]
> Disagreeing with an entry here is a design argument, not a bug report — but do make it. Each reason below is falsifiable, and if the trade-off stops holding the honest move is to build the feature, not to soften the wording.

<!-- generated: coverage/mapping.mjs antiPatterns() -->

## What is _not_ on this list

Three exclusions people expect to find here, and why they are not:

- **Active Record.** Not an upstream page in its own right; the underlying objection is [inert rows](./inert-rows.html) — a row has no `save()` because it carries no persistence state.
- **Protocol Buffers.** Typia's protobuf codec is documented, not excluded — see [Protobuf Message](./protobuf-message.html), [Encode](./protobuf-encode.html) and [Decode](./protobuf-decode.html).
- **Runtime schema sync.** `updateSchema()`-style live DDL is documented as a deliberately narrow tool in [Migrations](./migrations.html) and [`cli-push`](./cli-push.html), which is the reviewable, diffed path.

---

See also: [Why zmdb](./why-zmdb.html) · [Architecture](./architecture.html) · [Inert Rows](./inert-rows.html) · [JIT vs AOT](./jit-vs-aot.html)
