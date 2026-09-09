# @zmdb/compiler

`@zmdb/compiler` is zmdb's single TypeScript front end. It owns reflection, AOT emission, project compilation, unplugin and Metro adapters, lint rules, testing helpers, and canonical project-config
loading.

Part of **[zmdb](https://github.com/ambasta/zmdb)**. Application runtime code imports its published runtime owner; generated code never imports this package.

## Install

```bash
yarn add --dev @zmdb/compiler@1.0.0-beta.2 typescript@^7.0.2
```

> **Prerelease** (`1.0.0-beta.2`). Requires **Node.js 26+**. Published modules are ESM; Node.js 26 also supports synchronous `require('@zmdb/compiler/metro')` from a CommonJS Metro configuration.

## Choose a compilation route

- Use the sole `zmdb` executable from `@zmdb/cli` for `zmdb codegen --project tsconfig.json`.
- Use `compileProject({ project })` to collect artifacts without changing the project, then `writeCompileResult(result)` to publish them. Its `{ check: true }` option reports stale artifacts without
  writing them. `watchCodegen` provides the retained-session watch API.
- Use the root `zmdbAot` function for an async build plugin that loads the project's zmdb config. The synchronous `@zmdb/compiler/unplugin` entry accepts explicit project and naming options when the
  caller owns configuration.
- Select `@zmdb/compiler/metro` for Metro or `@zmdb/compiler/lint` for Oxlint, installing that adapter's optional peers.

Configuration belongs to this package: `@zmdb/compiler/config` loads it and `@zmdb/compiler/config/contract` provides `defineConfig` and its structural types. The product facade exposes the curated
compiler and config APIs through `@zmdb/core/compiler` and `@zmdb/core/config`.

## Entry points

`@zmdb/compiler`, `@zmdb/compiler/config`, `@zmdb/compiler/config/contract`, `@zmdb/compiler/emit`, `@zmdb/compiler/errors`, `@zmdb/compiler/lint`, `@zmdb/compiler/metro`, `@zmdb/compiler/reflect`,
`@zmdb/compiler/testing`, `@zmdb/compiler/transform`, `@zmdb/compiler/unplugin`

Generated application JavaScript imports runtime helpers from the source's published runtime owner, such as `@zmdb/core`, `@zmdb/validator`, or `@zmdb/protobuf`; it never imports this package. Install
the runtime owners used by your application as runtime dependencies and keep compiler setup in the build environment.

TypeScript is a required peer. Oxlint, Metro, and Metro's Babel transformer are optional peers used only by the matching explicit subpaths.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
