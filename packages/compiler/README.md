# @zmdb/compiler

`@zmdb/compiler` is zmdb's single TypeScript front end. It owns reflection, AOT emission, project compilation, unplugin and Metro adapters, lint rules, testing helpers, and canonical project-config
loading.

Part of **[zmdb](https://github.com/ambasta/zmdb)**. Application runtime code imports its published runtime owner; generated code never imports this package.

## Install

```bash
npm add -D @zmdb/compiler@alpha typescript@^7.0.2
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**.

## Entry points

`@zmdb/compiler`, `@zmdb/compiler/config`, `@zmdb/compiler/emit`, `@zmdb/compiler/errors`, `@zmdb/compiler/lint`, `@zmdb/compiler/metro`, `@zmdb/compiler/reflect`, `@zmdb/compiler/testing`,
`@zmdb/compiler/transform`, `@zmdb/compiler/unplugin`

The root exports `compileProject` and `writeCompileResult`. Generated application JavaScript imports runtime helpers from the source's published runtime owner, such as `zmdb`, `@zmdb/aot-validator`,
or `@zmdb/protobuf`; it never imports this package.

TypeScript is a required peer. Oxlint, Metro, and Metro's Babel transformer are optional peers used only by the matching explicit subpaths.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
