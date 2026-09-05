AOT (ahead-of-time) validation inlines type checks at build time, eliminating runtime parsing overhead. The validator transforms the full and depth-limited `is`/`assert`/`validate` families into
direct JavaScript checks — no Zod-style runtime parsers, no reflection.

## Why AOT?

Runtime-schema validators carry schema machinery into the application and execute it on every call. AOT inlining compiles checks from the TypeScript type once, at build time:

```ts
// Authored code
const ok = is<{ email: string }>(input);

// Compiled output (no runtime parser)
const ok = typeof input === 'object' && input !== null && typeof input.email === 'string';
```

> [!IMPORTANT] AOT validation achieves 5-24× speedup over runtime validators on assert operations. See [benchmarks](./benchmarks.html) for real numbers.

## Build Plugin

The AOT transformer is available as an unplugin for Vite, esbuild, Webpack, and Rollup:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { zmdbAot } from 'zmdb/unplugin';

export default defineConfig({
  plugins: [await zmdbAot()],
});
```

The umbrella entry discovers `zmdb.config.ts`, including its project and naming strategy. Tooling that owns config loading can instead use the synchronous low-level `@zmdb/aot-validator/unplugin`
entry and pass `project` and `naming` explicitly.

## Metro for React Native and Expo

Metro uses a Babel-transformer seam rather than an unplugin. Wrap the default config selected by the application:

```js
// Bare React Native: require('@react-native/metro-config')
// Expo: require('expo/metro-config')
const { getDefaultConfig } = require('expo/metro-config');
const { withZmdb } = require('@zmdb/aot-validator/metro');

module.exports = withZmdb(getDefaultConfig(__dirname));
```

The supported range is Metro `>=0.87.0 <0.88.0`. `withZmdb` keeps Expo's or the application's existing Babel transformer and delegates to it after the shared zmdb transform. See
[React Native & Expo](./connect-react-native.html) for the bare-RN form, worker-memory tuning, the cache key, and the one dev-server case that needs a reset.

## ts-patch Alternative

For TypeScript project references or direct ts-patch usage:

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@zmdb/aot-validator/plugin", "type": "program" }]
  }
}
```

## Prove the transform is installed

No lint rule can prove that a transform runs. A project may wire zmdb through Vite, esbuild, Webpack, Rollup, Metro, ts-patch or `zmdb-codegen`, and a linter looking at one source file cannot
distinguish those working configurations from a missing one without false positives.

Add a build-path smoke test instead:

```ts
import { schemaOf } from 'zmdb';
import type { User } from './schema.js';

it('runs the zmdb AOT transform', () => {
  expect(schemaOf<User>().table).toBe('users');
});
```

An untransformed `schemaOf<User>()` call throws rather than returning a plausible empty schema. The [Lint Rules](./lint-rules.html) complement this test by catching declaration mistakes that are
precise from syntax alone.

## Intercepted Functions

The transformer recognizes these seventeen generic entry points:

`toolFor<T>()` is imported from `@zmdb/ai`; install it with `npm add @zmdb/ai@alpha`. The five protobuf/gRPC entries are imported from `@zmdb/protobuf`; `@zmdb/aot-validator` remains their compiler
and does not re-export either package.

| Function                            | Emits                                       |
| ----------------------------------- | ------------------------------------------- |
| `is<T>(x)`                          | Inline full-depth boolean check             |
| `isShallow<T, D>(x)`                | Inline boolean check through depth `D`      |
| `assert<T>(x)`                      | Full-depth check + throw on failure         |
| `assertShallow<T, D>(x)`            | Depth-limited check + throw on failure      |
| `equals<T>(x)`                      | Exact-shape check with excess-key rejection |
| `assertEquals<T>(x)`                | Exact-shape check + throw on mismatch       |
| `validate<T>(x)`                    | Structured full-depth success or issues     |
| `validateShallow<T, D>(x)`          | Structured depth-limited success or issues  |
| `random<T>()`                       | Type-directed value generator               |
| `toJsonSchema<T>()`                 | JSON Schema object                          |
| `schemaOf<T>()`                     | Frozen tagged table schema and IR           |
| `toolFor<T>(provider, …)`           | Frozen provider-specific tool document      |
| `protoDescriptor<T>()`              | Protobuf message descriptor                 |
| `protoDecode<T>(bytes)`             | Generated protobuf decoder                  |
| `protoEncode<T>(value)`             | Generated protobuf encoder                  |
| `grpcDescriptor<S>(name, package)`  | Protobuf service descriptor                 |
| `loadGrpcService<S>(name, package)` | Typed gRPC descriptor/codecs                |

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
const ok = typeof input === 'object' && input !== null && typeof input.user === 'object' && input.user !== null && typeof input.user.email === 'string';
```

> [!TIP] Deeply nested objects emit longer inline expressions. For extreme depth (10+ levels), consider flattening your types.

## Excluded Files

The plugin skips:

- Files in `node_modules`
- Declaration files (`.d.ts`)
- Non-TypeScript files

## Runtime witness fallback

An untransformed generic call has no runtime access to its type argument. `is<User>(payload)`, `assert<User>(payload)`, `validate<User>(payload)` and their shallow variants therefore throw
`runtime type witness required in test/fallback mode`; they do not silently run a weaker reflective validator.

The utilities accept an explicit `TypeIR` witness for tests and generated fallback modules:

```ts
import { is } from '@zmdb/aot-validator/utilities';

const ok = is(payload, userTypeIr);
```

The generic `schemaOf<T>()`, `toJsonSchema<T>()` and protobuf calls are compile-time-only surfaces. `toJsonSchema(schema, variant)` remains available when the caller already has a runtime schema. Use
the build plugin or `zmdb-codegen` for the generic forms.

## Cross-links

- [Pure TypeScript](./pure-typescript.html) — runtime-only validation
- [Validation](./validators-is.html) — validation API surface
- [Lint Rules](./lint-rules.html) — syntactic declaration and query checks
- [Benchmarks](./benchmarks.html) — performance numbers
