# `@zmdb/web` — context SPEC

> Typed request context `Ctx` + compile-time path-param derivation (epic #257).
> Frozen before code. This is a **type-level** concern with a small runtime
> surface.

## Contract

### `PathParams<Path>`
A template-literal type that derives an object of path parameters from a route
string. Every \`:name\` segment becomes a **required** \`string\` property.

- \`PathParams<'/users/:id'>\` → \`{ id: string }\`
- \`PathParams<'/users/:id/posts/:postId'>\` → \`{ id: string; postId: string }\`
- \`PathParams<'/health'>\` → \`{}\` (empty object type)
- \`PathParams<'/files/:path'>\` (trailing param) → \`{ path: string }\`
- A param stops at the next \`/\` (so \`/:id/x\` yields \`id\`, not \`id/x\`).

### `Ctx<Params, Body, Query>`
The single argument a handler receives (Stage 3 has no parameter decorators).
All three type parameters default to sensible empties:

\`\`\`ts
interface Ctx<
  Params extends Record<string, string> = Record<never, string>,
  Body = unknown,
  Query extends Record<string, string | readonly string[]> = Record<never, string>,
> {
  readonly params: Params;
  readonly body: Body;
  readonly query: Query;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly path: string;
}
\`\`\`

### `HandlerFor<Path, Body, Query, Result>`
A helper that binds a route **path string** to a handler signature whose
\`ctx.params\` is exactly \`PathParams<Path>\` — so a handler that reads
\`ctx.params.wrongName\` is a **compile error**, and no \`as\` is ever needed to type
params.

\`\`\`ts
type HandlerFor<Path extends string, Body = unknown, Query ... = ..., Result = unknown> =
  (ctx: Ctx<PathParams<Path>, Body, Query>) => Result | Promise<Result>;
\`\`\`

## Runtime surface (minimal)
- \`extractParams(pattern, path)\` — a small pure helper that, given a route
  pattern (\`/users/:id\`) and a concrete path (\`/users/42\`), returns the params
  record (\`{ id: '42' }\`) or \`undefined\` when the path doesn't match the pattern.
  Used later by the dispatcher (#272); typed so its return matches
  \`PathParams<Pattern>\` when the pattern is a literal.

## Invariants
- **Derivation is 100% compile-time** for the types; \`extractParams\` is the only
  runtime code and allocates one params object.
- **No `as`/`any`/`!`** on the consumer surface. Type-level tests use
  \`expectTypeOf\`/\`@ts-expect-error\`.
- No reflection.

## Acceptance
- Type-level tests prove \`PathParams\` derivation for the cases above, that
  \`HandlerFor\` rejects unknown param names, and that \`Ctx\` defaults work.
- \`extractParams\` matches/extracts correctly and returns \`undefined\` on mismatch
  (runtime test).
- No \`as\`; suite + typecheck green.

## Out of scope
Dispatch/wiring of Ctx to a real request (epic #272), body/query validation
(#272/#297).
