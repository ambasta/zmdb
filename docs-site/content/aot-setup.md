AOT (ahead-of-time) validation compiles TypeScript types into JavaScript checks at build time. `@zmdb/compiler` owns reflection and emission; generated application code uses the published runtime
owners, including `@zmdb/validator`, without loading the compiler.

## Why AOT?

Runtime-schema validators carry schema machinery into the application and execute it on every call. AOT inlining compiles checks from the TypeScript type once, at build time:

```ts {"mode":"illustrative","id":"example-001","reason":"This before-and-after comparison shows alternative authored and generated declarations, not one module."}
// Authored code
const ok = is<{ email: string }>(input);

// Compiled output (no runtime parser)
const ok = typeof input === 'object' && input !== null && typeof input.email === 'string';
```

## Build Plugin

Install the compiler and its required TypeScript peer in the build environment:

```bash
npm add --save-dev @zmdb/compiler@1.0.0-beta.1 typescript@^7.0.2
```

The configured root plugin is available for Vite, esbuild, Webpack, and Rollup:

```ts {"mode":"compile","id":"example-002"}
// vite.config.ts
import { defineConfig } from 'vite';
import { zmdbAot } from '@zmdb/compiler';

export default defineConfig({
  plugins: [await zmdbAot()],
});
```

The async compiler root entry discovers `zmdb.config.ts`, including its project and naming strategy. `zmdb/compiler` exposes the same configured factory for product consumers. Tooling that owns config
loading can use the synchronous `@zmdb/compiler/unplugin` entry and pass `project` and `naming` explicitly. [Tooling Boundaries](./tooling-boundaries.html) explains the package and runtime graph.

## Metro for React Native and Expo

Metro uses a Babel-transformer seam rather than an unplugin. Wrap the default config selected by the application:

```js
// Bare React Native: require('@react-native/metro-config')
// Expo: require('expo/metro-config')
const { getDefaultConfig } = require('expo/metro-config');
const { withZmdb } = require('@zmdb/compiler/metro');

module.exports = withZmdb(getDefaultConfig(__dirname));
```

Install the selected peers `metro@^0.87.0` and `metro-babel-transformer@^0.87.0`. On Node.js 26, the CommonJS configuration loads this explicit compiler subpath synchronously. `withZmdb` keeps Expo's
or the application's existing Babel transformer and delegates to it after the shared zmdb transform. See [React Native Client](./client-react-native.html) for generated-client lifecycle and
[React Native & Expo](./connect-react-native.html) for the bare-RN form, embedded SQLite boundary, worker-memory tuning, the cache key, and the one dev-server case that needs a reset.

## Direct compiler integration

Tools that already own a TypeScript project can call the shared transform directly:

```ts {"mode":"illustrative","id":"example-003","reason":"The application supplies the source text and the project files transformed by this excerpt."}
import { ReflectSession } from '@zmdb/compiler/reflect';
import { transformFile } from '@zmdb/compiler/transform';

using session = ReflectSession.open({ project: '/workspace/app/tsconfig.json' });
const result = transformFile('/workspace/app/src/orders.ts', source, { session });
```

## Prove the transform is installed

No lint rule can prove that a transform runs. A project may wire zmdb through Vite, esbuild, Webpack, Rollup, Metro, direct project compilation, or another compiler host, and a linter looking at one
source file cannot distinguish those working configurations from a missing one without false positives.

Add a build-path smoke test instead:

```ts {"mode":"illustrative","id":"example-004","reason":"The application supplies its schema module and the test runner declarations used by this test excerpt."}
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

`toolFor<T>()` is imported from `@zmdb/ai`; install it with `npm add @zmdb/ai@1.0.0-beta.1`. The five protobuf/gRPC entries are imported from `@zmdb/protobuf`; `@zmdb/compiler` compiles them and does
not re-export either package.

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

```ts {"mode":"illustrative","id":"example-005","reason":"This authored-call excerpt depends on the surrounding input value and validator import."}
const ok = is<{ n: number; s: string }>(input);
```

**After:**

```ts {"mode":"illustrative","id":"example-006","reason":"This generated expression depends on the input value declared in the surrounding application."}
const ok = typeof input === 'object' && input !== null && typeof input.n === 'number' && typeof input.s === 'string';
```

**assert with throw:**

```ts {"mode":"illustrative","id":"example-007","reason":"This authored-call excerpt depends on the surrounding input value and validator import."}
const v = assert<{ s: string }>(input);
```

```ts {"mode":"illustrative","id":"example-008","reason":"This generated-code outline omits the complete AssertError arguments and surrounding input declaration."}
const v = ((() => {
  if (!(typeof input === "object" && input !== null && typeof input.s === "string"))
    throw new AssertError("assertion failed", ...);
  return input;
})());
```

## Nested Objects

The transformer recursively inlines nested object checks:

```ts {"mode":"illustrative","id":"example-009","reason":"This before-and-after comparison shows alternative declarations and omits the surrounding input value."}
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

```ts {"mode":"illustrative","id":"example-010","reason":"The application supplies the payload and reflected type IR consumed by this runtime call."}
import { is } from '@zmdb/validator';

const ok = is(payload, userTypeIr);
```

The generic `schemaOf<T>()`, `toJsonSchema<T>()` and protobuf calls are compile-time-only surfaces. `toJsonSchema(schema, variant)` remains available when the caller already has a runtime schema. Use
the build plugin or [project compiler](./cli-codegen.html) for the generic forms.

## Cross-links

- [Pure TypeScript](./pure-typescript.html) — runtime-only validation
- [Validation](./validators-is.html) — validation API surface
- [React Native Client](./client-react-native.html) — generated-client lifecycle around the Metro build
- [Lint Rules](./lint-rules.html) — syntactic declaration and query checks
- [Benchmarks](./benchmarks.html) — performance numbers
