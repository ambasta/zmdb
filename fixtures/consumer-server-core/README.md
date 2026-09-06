# Installed core-server consumer

This fixture is the external package boundary for issues #646, #651, and #755. It deliberately has no workspace protocol, compiler `paths`, or source-relative import into the monorepo.

`verify-installed.mjs --jobs` packs only the explicitly selected `@zmdb/jobs` dependency closure, typechecks worker/scheduler/extension usage with no source mappings, imports every jobs subpath,
composes `jobsExtension` through the real `@zmdb/app` lifecycle, and runs the SQLite memory backend and one worker from the installed tarballs.

`--plain` packs the current `zmdb` closure and proves that a normal product install contains no optional server package or server peer.

`--target` installs packed app, web, and product packages, typechecks every declared default subpath, runs the runtime identity checks, and proves both the moved web paths and every `zmdb/jobs*`
facade are absent. Its installed journey serves HTTP and runs a command without a jobs package in the default closure.
