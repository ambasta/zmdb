# SPEC — Framework integrations (frozen)

Part of `@zmdb/repository`. A thin, optional adapter contract that wires boundary
validation + AOT serialization into any HTTP framework. No framework is a hard
dependency. Epic #152.

## Contract

```ts
interface Handler<In, Out> {
  validate: (raw: unknown) => In; // e.g. assert<CreateDTO>
  handle: (input: In) => Promise<Out>;
  serialize?: (out: Out) => string; // default JSON.stringify
}
function makeEndpoint<In, Out>(h: Handler<In, Out>): (raw: unknown) => Promise<{ status: number; body: string }>;
```

## Frozen behavior

- `makeEndpoint(h)(raw)` = validate → handle → serialize, returning
  `{ status, body }`.
- Validation failure ⇒ `{ status: 400, body }` with the error message (no handler
  call). Handler success ⇒ `{ status: 200, body }`.
- `serialize` defaults to `JSON.stringify`.
- This is framework-agnostic; NestJS/Hono/tRPC/Express adapters are thin wrappers
  over `makeEndpoint` (documented), never hard deps of the core.
