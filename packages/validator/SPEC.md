# `@zmdb/validator` — emitted-code runtime (issue #635)

> Specification only. Issue #635 creates no package manifest or runtime source.

`@zmdb/validator` owns runtime validation, issue collection, assertion errors, serialization, equality, random generation, advanced runtime rules, regex-complexity protection, and every helper
ordinary generated validator code imports. It also owns protobuf/gRPC runtime calls and the dependency-free protobuf wire reader/writer.

## Public surface

The root exports `is`, `assert`, `validate`, shallow/equality variants, `random`, runtime rule helpers, and public validation errors. Stable concern subpaths are `./advanced`, `./errors`, and
`./serialization`; `./protobuf/wire` is the emitted protobuf runtime. Generated validation code imports the root or `./errors`, and generated protobuf code imports `./protobuf/wire`.

Compiler sessions, reflection, emitters, transforms, plugins, Metro, lint rules, testing reflection, code generation, and executables belong to `@zmdb/compiler`/`@zmdb/cli`.

## Dependency contract

The only production dependency is `@zmdb/schema`. There are no external production, optional, or peer dependencies and no `node:*` imports. TypeScript and oxlint cannot be reached from any source,
declaration, generated, or packed runtime entry.
