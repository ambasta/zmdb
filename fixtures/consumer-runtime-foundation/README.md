# Runtime foundation packed consumers

These four projects are the external-install contract for issue #636. Each manifest names released package versions, never `workspace:`, `file:`, a root `paths` alias, or a private source path:

- `schema` installs only `@zmdb/schema`;
- `sql` installs only `@zmdb/sql`;
- `validator` installs `@zmdb/schema` and `@zmdb/validator`;
- `orm` installs the four foundation packages and supplies its own structural driver.

`verify-installed.mjs` builds and packs the real workspace packages, installs only the fixture's declared foundation closure into a clean npm project, runs `src/runtime.mjs`, and typechecks
`src/contracts.ts` against the packed declarations. The aggregate assertion is an `it.fails` until #638–#641 create the hard-cutover packages.
