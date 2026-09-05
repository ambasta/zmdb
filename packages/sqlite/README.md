# @zmdb/sqlite

The complete SQLite vertical for zmdb: dialect metadata, DDL and migration refusals, catalog introspection, embedded migrations, and a structural `node:sqlite` driver. Its runtime dependency field
contains only `@zmdb/query-compiler` and `@zmdb/repository`; no third-party database client is installed or imported by this package.

## Install

```bash
npm add @zmdb/sqlite@alpha
```

The package requires Node.js 26+ and is ESM-only.

## Entry points

- `@zmdb/sqlite` — browser-safe dialect, introspector, driver factory and vertical
- `@zmdb/sqlite/node` — the structural `DatabaseSync`-compatible driver adapter
- `@zmdb/sqlite/embedded` — browser-safe embedded SQLite migration runner

The root and embedded entry points import no Node built-in or database binding. Applications pass their own `node:sqlite` `DatabaseSync`-compatible object to `sqliteDriver`.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
