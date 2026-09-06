# Installed core-server consumer

This fixture is the external package boundary for issues #646 and #651. It deliberately has no workspace protocol, compiler `paths`, or source-relative import into the monorepo.

`verify-installed.mjs --jobs` packs only `@zmdb/jobs` and its workspace dependency closure, typechecks worker/scheduler/extension usage with no source mappings, imports every jobs subpath, and runs
the SQLite memory backend and one worker from the installed tarballs.

`--plain` packs the current `zmdb` closure and proves that a normal product install contains no optional server package or server peer.

`--target` installs the exact app, web, jobs, and product dependency closure from packed tarballs. It typechecks every direct and facade subpath, checks runtime identity, proves moved web paths remain
absent, and executes one installed journey through HTTP, command, and in-memory worker paths.
