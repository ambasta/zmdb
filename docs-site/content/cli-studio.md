> **Available now; the final CLI documentation pass is still open.**
> `zmdb studio` serves a small, read-only browser for the tables declared by
> the active config.

## Limits first

The Studio is deliberately narrower than a database client or an admin panel:

- it binds only to `127.0.0.1` and has no authentication or `--host` flag;
- it accepts `GET` requests only and has no write mode;
- it lists only the config's schema set, without database introspection;
- it never accepts SQL, free-text filters, or undeclared sort columns;
- it omits columns tagged `Sensitive`, but otherwise shows raw values without
  masking;
- every page uses `LIMIT`/`OFFSET`, with a hard maximum of 50 rows.

Do not point it at a production database expecting an authorization layer or
general-purpose redaction. The loopback socket is the security boundary.

## Start it

The selected config must include the same `driver` thunk used by the other
database commands:

```bash
zmdb studio
```

The command chooses an ephemeral loopback port and prints its URL. A fixed port
does not widen the bind:

```bash
zmdb studio --port 4545
```

There is no non-loopback fallback. If the requested socket cannot be opened,
the command fails rather than listening on another interface.

## What the browser shows

The index lists the config's declared tables. From there you can:

1. page and sort a table by declared columns;
2. open one row through its declared primary key;
3. follow a declared relation to another configured table.

Declared property names stay in the browser while physical table and column
names stay inside the compiled SQL. Unknown tables, columns, query parameters,
and malformed row keys are refused before a query runs.

The application uses `@zmdb/web`, but it has no browser framework, JavaScript
bundle, or asset build. Each view is server-rendered HTML made from links,
tables, and page controls.

## What it is not

Studio does not discover tables that exist only in the database, edit data, or
replace `psql`, DataGrip, TablePlus, Beekeeper Studio, `sqlite3`, or another
wire-protocol client. Those remain the right tools for database-wide
introspection and administration.

For remote access to this local-only viewer, use an authenticated tunnel such
as `ssh -L`; Studio itself will not expose an unauthenticated database browser
to the network.

---

See also: [Config File](./config-file.html) · [pull](./cli-pull.html) ·
[CLI Overview](./cli-overview.html)
