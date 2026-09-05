Studio is not an admin panel. It is a deliberately small, read-only browser for the tables declared by the active `zmdb.config.ts`, served only on IPv4 loopback.

## Limits first

- It binds to `127.0.0.1` and has no authentication or `--host` flag.
- It accepts `GET` only. There is no write mode behind another flag.
- It lists only the config's schema set; it does not introspect the database.
- It never accepts SQL, free-text filters, undeclared tables, or undeclared sort columns from the browser.
- Columns tagged `Sensitive` are omitted. Every other value is raw and unmasked.
- Pages use `LIMIT`/`OFFSET`, default to 25 rows, and are capped at 50.
- The UI is server-rendered HTML with no browser framework, script bundle, or asset build.

Do not point Studio at a production database expecting an authorization layer, general-purpose redaction, audit workflow, or editing controls. The loopback socket is the access boundary.

## Start the installed command

The selected config must declare the same `driver` thunk used by migration and push commands. This transcript was captured from the built executable against a generated SQLite project:

```text
$ npx zmdb studio --port 4545
http://127.0.0.1:4545
```

The emitted application served its declared-table index and rejected a write verb before database access:

```text
$ curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4545/
200

$ curl -sS -o /dev/null -w '%{http_code}\n' \
    -X POST http://127.0.0.1:4545/
405
```

The measured index contained:

```text
Local raw-data viewer
Declared tables
posts
2 visible columns
```

Omit `--port` to choose an ephemeral port. A fixed port does not widen the bind. If the requested loopback socket cannot be opened, the command fails; it never retries on another interface.

## What the browser shows

The index comes exactly from the config's schema files. From there you can:

1. page a table and sort by one visible declared column;
2. open a row through its declared primary key;
3. follow a declared relation to another configured table.

Logical property and table names stay in the browser. Physical names remain inside compiler-generated SQL. Unknown query parameters and malformed row keys are refused before a query runs.

Every page includes the raw-data warning. `Sensitive` columns are structurally excluded through the emitted JSON Schema property list, including from row keys and pagination links; Studio does not
apply masking rules to anything else.

## What it is not

Studio does not discover tables that exist only in the database, edit data, accept arbitrary SQL, or replace `psql`, DataGrip, TablePlus, Beekeeper Studio, `sqlite3`, or another wire-protocol client.
Those remain the right tools for database-wide introspection and administration.

For remote access, put the loopback viewer behind an authenticated tunnel such as `ssh -L`. Studio itself will not expose an unauthenticated database browser to the network.

---

See also: [Config File](./config-file.html) · [pull](./cli-pull.html) · [CLI Overview](./cli-overview.html)
