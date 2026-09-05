# Installed core-server consumer

This fixture is the external package boundary for issue #646. It deliberately has no workspace protocol, compiler `paths`, or source-relative import into the monorepo.

`verify-installed.mjs --jobs` packs only `@zmdb/jobs` and its workspace dependency closure, typechecks worker/scheduler/extension usage with no source mappings, imports every jobs subpath, and runs
the SQLite memory backend and one worker from the installed tarballs.

`--plain` packs the current `zmdb` closure and proves that a normal product install contains no optional server package or server peer. `--target` remains the parent integration fixture owned by #651:
it installs packed app, web, jobs, and facade packages, typechecks every declared subpath, runs the runtime identity checks, and proves the moved web paths are absent.
