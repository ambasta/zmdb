A compile-time type guard: `is<T>(value)` returns `boolean` and **narrows** the input on success. With the [AOT transform](./aot-setup.html) it inlines to the exact structural checks `T` implies — no
runtime schema, no reflection.

## Usage

<!-- snippet: validators-is.ts#snippet-1 -->

## What the transform emits

For a type like `{ email: string; age: number }`, the call site compiles to a straight-line boolean expression:

<!-- snippet: validators-is.ts#snippet-2 -->

> [!NOTE] This is the same single boolean-chain shape typia emits — and in our [benchmarks](../benchmarks/index.html) it out-performs `new Function()` JIT validators. Without the transform wired in,
> `is` falls back to a slower runtime walk of the type descriptor.

## Related

- [assert()](./validators-assert.html) — throw with the failing path
- [validate()](./validators-validate.html) — collect every error
- [Special tags](./validators-tags.html) — constraints like `Min`/`Pattern`
