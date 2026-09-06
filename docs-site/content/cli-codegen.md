`@zmdb/compiler` compiles zmdb validators and schemas ahead of time **without a bundler**, writes the result beside the source, and exposes checking as a library operation.

```bash
npm add --save-dev @zmdb/compiler@alpha typescript@^7
```

The compiler package deliberately owns no executable. The unified `zmdb` CLI is a separate package boundary; build systems, custom tools, and the future CLI all call the same `compileProject` and
`writeCompileResult` operations.

## A project compiler script

Create `scripts/compile-zmdb.mjs`:

```js
import { fileURLToPath } from 'node:url';

import { compileProject, writeCompileResult } from '@zmdb/compiler';
import { loadConfig } from '@zmdb/compiler/config';

const check = process.argv.includes('--check');
const config = await loadConfig({ optional: true });
const project = config?.project ?? fileURLToPath(new URL('../tsconfig.json', import.meta.url));

const result = await compileProject({
  project,
  ...(config === undefined ? {} : { naming: config.resolvedNaming }),
});

for (const diagnostic of result.diagnostics) {
  console.error(`${diagnostic.code}: ${diagnostic.message}`);
}

if (result.diagnostics.length > 0) {
  process.exitCode = 1;
} else {
  const materialised = await writeCompileResult(result, { check });
  if (check && materialised.stale.length > 0) {
    for (const path of materialised.stale) console.error(`stale ${path}`);
    process.exitCode = 1;
  }
}
```

Run it with:

```bash
node scripts/compile-zmdb.mjs
node scripts/compile-zmdb.mjs --check
```

`compileProject` reads and compiles in a disposable shadow; it does not modify the application. `writeCompileResult` is the only writer. With `check: true`, it reports every stale, missing, or
orphaned artifact and writes or deletes nothing.

## What it writes

For each source file that calls one of the seventeen generic entry points with a type argument — `is`, `isShallow`, `equals`, `assert`, `assertShallow`, `assertEquals`, `validate`, `validateShallow`,
`random`, `toJsonSchema`, `schemaOf`, `toolFor`, `protoDescriptor`, `protoDecode`, `protoEncode`, `grpcDescriptor`, `loadGrpcService` — project compilation writes three files beside it and edits the
call. The five protobuf/gRPC calls must resolve to `@zmdb/protobuf`; local or foreign functions with the same name are left alone.

```text
src/handlers.ts                      your source; the call is rewritten
src/handlers.zmdb.witness.ts         the type argument, kept and checked by TypeScript
src/handlers.zmdb.generated.js       the compiled runtime code
src/handlers.zmdb.generated.d.ts     its signatures
```

```ts
// before
import { is, schemaOf } from 'zmdb';
if (is<User>(body)) { … }
const users = defineRepository(schemaOf<User>(), driver);
```

```ts
// after
import { zmdbIsUser, zmdbSchemaUser } from './handlers.zmdb.generated.js';
if (zmdbIsUser(body)) { … }
const users = defineRepository(zmdbSchemaUser(), driver);
```

Commit all four files. A fresh clone then runs the generated application code without loading TypeScript, `@zmdb/compiler`, a build plugin, or a schema interpreter.

## Why three generated files

The rewrite is destructive: after compilation, the original type argument no longer appears in the source. The witness preserves it in a TypeScript module checked by the application's own project. A
renamed or deleted type therefore becomes a build error instead of leaving behind an ungrounded validator.

The emitted helpers are untyped JavaScript, so they live in `.js`; the adjacent `.d.ts` carries their signatures. Generated runtime JavaScript imports only runtime helpers such as
`@zmdb/aot-validator/errors` and `@zmdb/protobuf/wire`. It never imports `@zmdb/compiler`.

## Selecting files

Omit `files` to compile the project source set, or pass exact project members:

```js
const result = await compileProject({
  project: '/workspace/app/tsconfig.json',
  files: ['/workspace/app/src/orders.ts'],
});
```

A requested file that is outside the project, duplicated after normalisation, or itself generated is returned as a compiler diagnostic rather than silently skipped.

## Which route should I use?

| Build shape                                    | Compiler route                                        |
| ---------------------------------------------- | ----------------------------------------------------- |
| Vite, Rollup, esbuild, webpack, or Rspack      | [`@zmdb/compiler/unplugin`](./aot-setup.html)         |
| React Native or Expo                           | [`@zmdb/compiler/metro`](./connect-react-native.html) |
| plain `tsc`, Node type stripping, Bun, or Deno | `compileProject` + `writeCompileResult`               |
| a library that ships generated validators      | project compilation; commit the generated files       |

All routes reuse the same reflection, transform, and emission implementation.

---

See also: [AOT Setup](./aot-setup.html) · [JIT vs AOT](./jit-vs-aot.html) · [Schema Declaration](./schema-declaration.html) · [CLI Overview](./cli-overview.html)
