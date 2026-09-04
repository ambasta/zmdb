AOT (ahead-of-time) validation inlines type checks at build time, eliminating runtime
parsing overhead. The validator transforms the full and depth-limited
`is`/`assert`/`validate` families into direct JavaScript checks — no Zod-style runtime
parsers, no reflection.

## Why AOT?

Runtime validators like Zod parse type definitions on every call. AOT inlining compiles those checks once, at build time:

```ts
// Authored code
const ok = is<{ email: string }>(input);

// Compiled output (no runtime parser)
const ok = typeof input === 'object' && input !== null && typeof input.email === 'string';
```

> [!IMPORTANT]
> AOT validation achieves 5-24× speedup over runtime validators on assert operations. See [benchmarks](./benchmarks.html) for real numbers.

## Build Plugin

The AOT transformer is available as an unplugin for Vite, esbuild, Webpack, and Rollup:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { zmdbAot } from '@zmdb/aot-validator/unplugin';

export default defineConfig({
  plugins: [zmdbAot()],
});
```

## ts-patch Alternative

For TypeScript project references or direct ts-patch usage:

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@zmdb/aot-validator/plugin", "type": "program" }]
  }
}
```

## Intercepted Functions

The transformer recognizes these generic functions from `@zmdb/aot-validator`:

| Function                | Emits                                                       |
| ----------------------- | ----------------------------------------------------------- |
| `is<T>(x)`              | Inline boolean check                                        |
| `assert<T>(x)`          | Inline check + throw on failure                             |
| `validate<T>(x)`        | Returns `{ success: boolean; data?: T; errors?: Issues[] }` |
| `equals<T>(x, y)`       | Inline deep equality + excess key check                     |
| `assertEquals<T>(x, y)` | Inline equality + throw on mismatch                         |

## Golden Transformations

**Before:**

```ts
const ok = is<{ n: number; s: string }>(input);
```

**After:**

```ts
const ok = typeof input === 'object' && input !== null && typeof input.n === 'number' && typeof input.s === 'string';
```

**assert with throw:**

```ts
const v = assert<{ s: string }>(input);
```

```ts
const v = ((() => {
  if (!(typeof input === "object" && input !== null && typeof input.s === "string"))
    throw new AssertError("assertion failed", ...);
  return input;
})());
```

## Nested Objects

The transformer recursively inlines nested object checks:

```ts
// Input
const ok = is<{ user: { email: string } }>(input);

// Output
const ok =
  typeof input === 'object' &&
  input !== null &&
  typeof input.user === 'object' &&
  input.user !== null &&
  typeof input.user.email === 'string';
```

> [!TIP]
> Deeply nested objects emit longer inline expressions. For extreme depth (10+ levels), consider flattening your types.

## Excluded Files

The plugin skips:

- Files in `node_modules`
- Declaration files (`.d.ts`)
- Non-TypeScript files

```ts
// vite.config.ts
export default defineConfig({
  plugins: [
    zmdbAot({
      // Optional: additional excludes
      exclude: [/node_modules/, /dist/],
    }),
  ],
});
```

## Fallback Runtime

If AOT is not configured, the runtime validator from `@zmdb/aot-validator` is used as a fallback — validation still works, just without the speed benefit.

```ts
// Without AOT build, this uses runtime parser (slower but functional)
import { is } from '@zmdb/aot-validator/utilities';
const ok = is<User>(payload);
```

## Cross-links

- [Pure TypeScript](./pure-typescript.html) — runtime-only validation
- [Validation](./validators-is.html) — validation API surface
- [Benchmarks](./benchmarks.html) — performance numbers
