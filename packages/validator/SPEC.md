# `@zmdb/validator` — emitted-code runtime (issue #635)

> Specification only. Issue #635 creates no package manifest or runtime source. Amended by #656 after protobuf moved to its dedicated zero-dependency package.

`@zmdb/validator` owns runtime validation, issue collection, assertion errors, serialization, equality, random generation, advanced runtime rules, regex-complexity protection, and every helper
ordinary generated validator code imports. `@zmdb/protobuf` separately owns protobuf/gRPC source calls, artifact types, and the dependency-free wire reader/writer.

## Public surface

The root exports `is`, `assert`, `validate`, shallow/equality variants, `random`, runtime rule helpers, and public validation errors. Stable concern subpaths are `./advanced`, `./errors`, and
`./serialization`. Generated validation code imports the root or `./errors`; generated protobuf code imports `@zmdb/protobuf/wire`.

Compiler sessions, reflection, emitters, transforms, plugins, Metro, lint rules, testing reflection, code generation, and executables belong to `@zmdb/compiler`/`@zmdb/cli`.

## Dependency contract

The only production dependency is `@zmdb/schema`. There is no dependency on `@zmdb/protobuf`; compiler-generated protobuf artifacts select that optional package directly. There are no external
production, optional, or peer dependencies and no `node:*` imports. TypeScript and oxlint cannot be reached from any source, declaration, generated, or packed runtime entry.
