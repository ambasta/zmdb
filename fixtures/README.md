# Consumer fixtures

Four projects use zmdb the way somebody who installed it would, kept here so that CI
builds them rather than trusting that they still work.

`consumer-cli/` and `consumer-plugin/` contain the **same program**, declared the same way,
and reach the compiled validator by the two supported routes:

|                   | `consumer-cli/`                                        | `consumer-plugin/`               |
| ----------------- | ------------------------------------------------------ | -------------------------------- |
| build step        | `zmdb-codegen`                                         | a bundler with `zmdbAot()` in it |
| what is committed | the generated `.js`/`.d.ts`/witness, beside the source | nothing generated                |
| what runs it      | `node src/probe.ts`, no tooling at all                 | the bundle esbuild wrote         |

The split is the point. A bundler plugin can rewrite a module on its way into a bundle, and
that is the fastest route when there is a bundler; a library, a `tsc` build or a
`node --strip-types` script has nowhere to put that step, and REQ-AV-3 says the compiled path
may not be a reward for choosing a particular toolchain. So one fixture proves the plugin
route and the other proves there is a route without one.

`consumer-metro/` is the frozen third route. It runs a real Metro 0.87 bundle, preserves a
pre-existing Babel transformer, and has a separate unconfigured control that reaches the
current runtime refusal. Its configured assertions are `it.fails` until
`@zmdb/aot-validator/metro` ships; the fixture does not make Metro a supported route by
itself.

`packages/aot-validator/src/cli/consumer-fixtures.spec.ts` is what holds that pair together, and
what stops two directories from quietly becoming two different programs. It builds the plugin
fixture into a temp directory, runs `--check` over the committed one, and then asserts that the
non-generated sources are byte-identical, that the committed witness makes the same calls the
plugin fixture's source still makes, that both print the same bytes, and that both compile to
the same check — measuring each, since by then they are known to be the same code.

`llm-adapters/` is compile-only and independent of that pair. It pins the real
`@langchain/core` and `ai` packages, then checks the frozen plain-object adapter
shapes against their constructors. The framework dependencies belong to that private
consumer fixture; neither becomes a dependency or peer of `@zmdb/schema-core`.

## Working on them

`consumer-plugin/` is the one to edit. `consumer-cli/` is derived:

```sh
node packages/aot-validator/src/cli/bin.ts --project fixtures/consumer-cli/tsconfig.json
```

Copy the source change into `consumer-cli/src/` first, then run that. CI runs the same
command with `--check`, which writes nothing and fails if the committed output is stale.
