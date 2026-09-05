# Installed core-server consumer

This fixture is the external package boundary for issue #646. It deliberately has no workspace protocol, compiler `paths`, or source-relative import into the monorepo.

`verify-installed.mjs --plain` packs the current `zmdb` closure and proves that a normal product install contains no optional server package or server peer. `--target` is intentionally red until
`@zmdb/app` and `@zmdb/jobs` ship: it installs packed app, web, jobs, and facade packages, typechecks every declared subpath, runs the runtime identity checks, and proves the moved web paths are
absent.
