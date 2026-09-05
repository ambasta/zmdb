# SPEC — shared tool invocation runtime

Part of `@zmdb/ai`, exported from `@zmdb/ai/tool-runtime`. This entry point contains provider-neutral invocation behavior shared by chat, framework integrations, and MCP without exposing a provider or
framework SDK.

## Public surface

```ts
export interface InvocableTool<T> {
  readonly validate: (args: unknown) => T;
  readonly handler: (input: T, identity?: unknown) => unknown | PromiseLike<unknown>;
}

export type ToolInvocation =
  | { readonly kind: 'success'; readonly content: string }
  | { readonly kind: 'validation-error'; readonly error: unknown; readonly content?: string }
  | { readonly kind: 'handler-error'; readonly error: unknown };

export interface ToolAdapterOptions<T, Output = unknown> {
  readonly description: string;
  readonly validate: (value: unknown) => T;
  readonly execute: (input: T) => Output | PromiseLike<Output>;
}

export declare function invokeTool<T>(entry: InvocableTool<T>, args: unknown, identity?: unknown): Promise<ToolInvocation>;
export declare function serialiseToolResult(result: unknown): string;
export declare function executeToolAdapter<T, Output>(name: string, value: unknown, options: ToolAdapterOptions<T, Output>): Promise<Awaited<Output> | string>;
```

## Behavior

- Validation always runs before a handler or adapter executes.
- A structured validation error becomes model-readable paths and expectations without including `ValidationIssue.value`.
- An unstructured validation error and every handler error remain application failures.
- String results pass through. Other results use `JSON.stringify`; an `undefined` result becomes the literal string `undefined`.
- Error-id generation and validation-error formatting remain private implementation details.

## Dependency boundary

The runtime imports only `validationIssuesOf` and its structural issue type from `@zmdb/schema-core`. It has no provider or framework dependency or peer. Callers supply validators at their own AOT
call sites because a published generic cannot reflect its unresolved type parameter.

## Non-goals

- No schema reflection or validator compiler.
- No provider request/response translation.
- No retries, logging, approval policy, transport, or SDK lifecycle.
