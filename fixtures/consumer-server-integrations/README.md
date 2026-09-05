# Optional server package consumers

Each child directory is one external consumer for #655. It imports one package root at runtime and typechecks that package's declarations without a workspace `paths` mapping.

`verify-installed.mjs --integrations` builds and packs the real workspace packages, extracts only the target package and its declared internal dependency closure into each clean consumer, links the
consumer-selected peer versions, then runs `src/runtime.mjs` and `tsc`.

The fixture root deliberately has no `tsconfig.json`. Until the remaining #657–#661 packages exist, the aggregate consumer assertion is an `it.fails`; the ordinary monorepo typecheck must not turn
those five missing imports into an uncontrolled failure outside that assertion.
