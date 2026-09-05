# @zmdb/aot-validator

`@zmdb/aot-validator` generates validation, serialization, protobuf, and typed gRPC artifacts during the build. It owns the single TypeScript reflection and emission front end; source-level protobuf
calls, service-artifact types, and the generated-code wire ABI are published separately by `@zmdb/protobuf`.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript schema drives validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
npm add @zmdb/aot-validator@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Runtime APIs: `@zmdb/aot-validator`, `/advanced`, `/emit`, `/errors`, `/serialization`, `/utilities`
- Build tooling: `/plugin`, `/reflect`, `/testing`, `/codegen`, `/transformer`, `/unplugin`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
