# SPEC — Schema objects DDL (frozen)

Part of `@zmdb/query-compiler`. Declarative schema objects that emit
dialect-correct DDL (feeding migrations). Pure string emitters, no runtime
mutation. Epic #98.

## 1. Indexes & constraints (#99/#100/#101)

```ts
type IndexColumn =
  | string
  | { readonly column: string; readonly opclass?: string }
  | { readonly expr: string; readonly opclass?: string };

interface IndexDef {
  name: string;
  table: string;
  columns: readonly IndexColumn[];
  unique?: boolean;
  where?: string;
  method?: IndexMethod;
  with?: Readonly<Record<string, number>>;
}
function createIndexDdl(def: IndexDef, dialect): string;
function checkConstraintDdl(table: string, name: string, expr: string, dialect): string;
```

- `CREATE [UNIQUE] INDEX "name" ON "table" ("a","b") [WHERE expr]`.
- Check: `ALTER TABLE "t" ADD CONSTRAINT "n" CHECK (expr)`.

### 1.1 Expression columns (frozen — epic "Composite primary keys and expression indexes")

An index column is either a **name** or an **expression**, and the two are different kinds
rather than one string the emitter inspects. A name goes through `quoteIdentifier`; an
expression is emitted **verbatim** between the parens and is never quoted:

```
{ name: 'users_email_ci', table: 'users', columns: [{ expr: 'lower(email)' }], unique: true }

postgres  CREATE UNIQUE INDEX "users_email_ci" ON "users" (lower(email))
sqlite    CREATE UNIQUE INDEX "users_email_ci" ON "users" (lower(email))
mysql     — refused (see below)
```

Mixed forms are allowed and each element is treated on its own:
`columns: ['tenant_id', { expr: 'lower(email)' }]` gives `("tenant_id", lower(email))`.

The tagged wrapper exists to make the choice explicit at the call site.

A bare string could not: `'lower(email)'` quoted as an identifier produces `"lower(email)"`, which Postgres reads as a column whose name contains parentheses and rejects with "column does not exist" — and sniffing for a `(` to decide would make a legitimately odd column name unindexable while quietly accepting a half-written expression.

So the caller says which it meant, and the case- insensitive-unique recipe this epic exists to enable (`{ expr: 'lower(email)' }`) is spelled differently from an ordinary index on a column that happens to be called `email`.

The expression is trusted, schema-authored DDL rather than request data. The caller is responsible
for quoting every identifier inside it and must never interpolate user input. This is a deliberate
boundary: parsing or re-quoting the text here would turn the migration compiler into an incomplete
SQL parser and would break the opaque comparison rule below.

**An expression is opaque to `diff`.** It is compared as a byte string, which makes
`lower(email)` and `LOWER(email)` two different indexes, and a whitespace edit a drop and a
recreate. That is deliberate and stated so nobody implements the alternative: normalising SQL
expressions means parsing three dialects' expression grammars, and a normaliser that is wrong
in one direction reports no change for an index that did change.

**MySQL is refused.** MySQL 8 supports functional key parts, but only wrapped in a second set
of parens — `((lower(email)))` — and not at all before 8.0.13. Emitting the Postgres spelling
there produces a syntax error at migration time; emitting the MySQL spelling silently means
the same declaration is two different indexes per dialect. So `createIndexDdl` throws
`UnsupportedFeatureError` for an expression column on MySQL, consistent with how this module
already handles materialized views and RLS:

```
mysql does not support an expression index ("users_email_ci" on "users" uses lower(email));
add a generated column and index that instead
```

### 1.2 Method, operator class and options (frozen — epic "Database extensions")

A vector index is not a b-tree, and the two things that make it one — the access method and its build
parameters — have nowhere to go in the shape above. Both are added, and both are closed:

```ts
type IndexMethod = 'btree' | 'hash' | 'gin' | 'gist' | 'brin' | 'ivfflat' | 'hnsw';
```

```
{ name: 'items_embedding_l2', table: 'items', method: 'ivfflat',
  columns: [{ column: 'embedding', opclass: 'vector_l2_ops' }], with: { lists: 100 } }

postgres  CREATE INDEX "items_embedding_l2" ON "items" USING ivfflat ("embedding" vector_l2_ops) WITH (lists = 100)

{ name: 'items_embedding_cos', table: 'items', method: 'hnsw',
  columns: [{ column: 'embedding', opclass: 'vector_cosine_ops' }], with: { m: 16, ef_construction: 64 } }

postgres  CREATE INDEX "items_embedding_cos" ON "items" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64)
```

`method` is an enum and not a string for the same reason §1.1's expression form is a tagged object: it
lands in the statement unquoted, so a free string there is caller-supplied text in SQL — the shape of
#364. `opclass` is a string because the set is open (every extension ships its own), so it carries the
identifier check instead: `/^[A-Za-z_][A-Za-z0-9_]*$/`, refused otherwise, the same rule as
`ExtensionType.args`.

`with` keys are closed **per method** — `lists` for `ivfflat`, `m` and `ef_construction` for `hnsw`, and
nothing at all for the four ordinary methods — and every value must be a non-negative integer. A key the
method does not define is refused naming both, because the pgvector tuning parameters are easy to
misremember and `WITH (list = 100)` is a Postgres error at migration time rather than at build time:

```
ivfflat does not take the option `m` ("items_embedding_l2"); ivfflat options are (lists)
```

Omitting `method` emits no `USING` clause, so every existing golden statement is unchanged. `ivfflat` and
`hnsw` are refused on MySQL and SQLite by the same rule as the expression form, and `gin`, `gist` and
`brin` are refused there too — they are Postgres access methods, and MySQL's `USING BTREE` / `USING HASH`
are the only two it has.

## 2. Views (#102/#103/#104)

```ts
interface ViewDef {
  name: string;
  select: string;
  materialized?: boolean;
}
function createViewDdl(def, dialect): string; // CREATE [MATERIALIZED] VIEW "n" AS <select>
function dropViewDdl(name, dialect, materialized?): string;
```

- `CREATE [MATERIALIZED] VIEW "n" AS <select>`; drop is `DROP [MATERIALIZED]
VIEW IF EXISTS "n"`. Materialized views: postgres only (else throws).

## 3. Sequences (#105/#106/#107)

```ts
interface SequenceDef {
  name: string;
  start?: number;
  increment?: number;
}
function createSequenceDdl(def, dialect): string; // CREATE SEQUENCE "n" [START x] [INCREMENT y]
```

## 4. Generated columns (#108/#109/#110)

```ts
interface GeneratedColumn {
  name: string;
  type: string;
  expression: string;
  stored?: boolean;
}
function generatedColumnDdl(col, dialect): string;
// "n" <type> GENERATED ALWAYS AS (expr) STORED
```

## 5. Schemas / namespaces (#111/#112/#113)

```ts
function createSchemaDdl(name, dialect): string; // CREATE SCHEMA "n"
function qualify(schema: string, object: string, dialect): string; // "schema"."object"
```

## 6. Row-Level Security (#114/#115/#116)

```ts
interface RlsPolicy {
  name: string;
  table: string;
  using: string;
  command?: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
}
function enableRlsDdl(table, dialect): string; // ALTER TABLE "t" ENABLE ROW LEVEL SECURITY
function createPolicyDdl(p: RlsPolicy, dialect): string; // CREATE POLICY "n" ON "t" FOR CMD USING (expr)
```

## 7. Extensions (frozen — epic "Database extensions")

An extension is a schema object like a view or a sequence, and it belongs here rather than beside the
column types that need it, because installing one is a statement and using one is a type.

```ts
interface ExtensionDef {
  readonly name: string;
  readonly schema?: string;
  readonly version?: string;
}
function createExtensionDdl(def: ExtensionDef, dialect): string;
```

```
{ name: 'vector' }                                    CREATE EXTENSION IF NOT EXISTS "vector"
{ name: 'postgis', schema: 'extensions' }             CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA "extensions"
{ name: 'vector', version: '0.7.0' }                  CREATE EXTENSION IF NOT EXISTS "vector" VERSION '0.7.0'
```

`IF NOT EXISTS` is not optional and is not a flag. An extension is frequently installed by a DBA before
zmdb ever runs, so the statement that assumes it is absent fails on precisely the well-run databases.
`name` and `schema` are identifiers and go through `quoteIdentifier`; `version` is a string literal and
is single-quoted, which is the one place in this module where the two differ in the same statement.

MySQL and SQLite refuse — neither has the concept — with the same `UnsupportedFeatureError` as
materialized views and RLS.

**Ordering is part of the contract.** `CREATE EXTENSION` runs before anything that could name a type it
provides, and index creation runs after the tables. A `vector` column in a table created before the
extension is a migration that fails halfway, leaving the database in a state the snapshot does not
describe — which is worse than either succeeding or failing cleanly. See
`../migrations/SPEC.md` §1.5 for where that order is imposed and how a snapshot records extensions.

**Dropping is not automatic, and this is the deliberate asymmetry.** An extension declared and then undeclared produces no `DROP EXTENSION`, because `DROP EXTENSION vector` fails while any column still uses the type and `DROP EXTENSION vector CASCADE` drops those columns instead — so the two available behaviours are "the migration fails" and "the migration deletes data".

Neither is something to generate from the absence of a declaration, particularly when that absence often means "somebody else manages this one now". Removal is a hand-written migration, and the generated operation list intentionally contains no extension-removal entry.

## 8. Stored routines (frozen — epic "Stored procedures and functions")

The dialects diverge further here than anywhere else in this module, so the shape comes first and every
statement below is a golden.

```ts
export interface RoutineDef {
  readonly kind: 'function' | 'procedure';
  readonly name: string;
  readonly params: readonly {
    readonly name: string;
    readonly type: SqlType;
    readonly mode?: 'in' | 'out' | 'inout';
  }[];
  /** Functions only. `setof` marks a set-returning function. */
  readonly returns?: { readonly type: SqlType | 'void'; readonly setof?: boolean };
  readonly language?: string; // postgres only; default 'plpgsql'
  readonly deterministic?: boolean; // mysql only; default false
  readonly body: string; // opaque; the author owns it
}

function createRoutineDdl(def: RoutineDef, dialect): string;
function dropRoutineDdl(def: RoutineDef, dialect): string;
function replaceRoutineStatements(prev: RoutineDef | undefined, next: RoutineDef, dialect): readonly string[];
function routineFingerprint(def: RoutineDef): string;
```

### 8.1 Postgres

```
{ kind: 'function', name: 'archive_old_orders', language: 'plpgsql',
  params: [{ name: 'cutoff', type: 'timestamp' }], returns: { type: 'integer' },
  body: 'DECLARE moved INTEGER;\nBEGIN\n  …\n  RETURN moved;\nEND;' }

CREATE OR REPLACE FUNCTION "archive_old_orders"("cutoff" TIMESTAMPTZ) RETURNS INTEGER LANGUAGE plpgsql AS $zmdb$
DECLARE moved INTEGER;
BEGIN
  …
  RETURN moved;
END;
$zmdb$
```

Clause order is frozen as `RETURNS`, then `LANGUAGE`, then `AS`. Postgres accepts those three in any
order, so an emitter with no rule produces DDL that is correct and unstable, and every golden becomes a
re-record.

Parameter types are rendered by the same `ddlType(dialect, type)` the columns use, which is why `timestamp`
is `TIMESTAMPTZ` here and not `TIMESTAMP` — a routine parameter and a column of the same declared type must
be the same database type, or a value round-trips through the routine having lost its offset.

**The body is dollar-quoted with a tagged delimiter, never with bare `$$`.** A plpgsql body containing `$$` is ordinary — it happens the moment somebody nests a function definition or pastes an example — and bare `$$` there does not fail cleanly: it terminates the literal early, and the remainder either is a syntax error or parses as further clauses, giving a function whose body is a truncated prefix of what the author wrote.

So the tag is `$zmdb$`, and if the body contains that string the emitter appends the smallest integer that does not appear: `$zmdb1$`, `$zmdb2$`, and so on. The search is over the body text, so the tag is a pure function of the body and the goldens stay stable.

### 8.2 MySQL

```
CREATE FUNCTION `archive_old_orders`(`cutoff` DATETIME) RETURNS INT
  NOT DETERMINISTIC MODIFIES SQL DATA SQL SECURITY INVOKER
DECLARE moved INT;
BEGIN
  …
END;
```

```
{ kind: 'procedure', name: 'rebuild_search_index', params: [] }

CREATE PROCEDURE `rebuild_search_index`() MODIFIES SQL DATA SQL SECURITY INVOKER
BEGIN
  …
END;
```

No `LANGUAGE` clause: MySQL has one routine language and naming it is a syntax error. `language` on a
MySQL routine is therefore refused rather than ignored, because ignoring it would let a `plpgsql` body be
declared for MySQL and fail at migration time with MySQL's own parse error instead of ours.

Three characteristics are emitted and none of them is decoration:

- `NOT DETERMINISTIC` unless `deterministic: true`. Under the default
  `log_bin_trust_function_creators = 0`, MySQL **refuses to create a function at all** without a
  determinism characteristic, so an emitter that omits it produces DDL that fails on every server with
  binary logging on — which is most production servers and no development one, the worst possible place for
  the difference to show up. The default is the pessimistic value because the body is opaque: claiming
  `DETERMINISTIC` for a body that reads a table lets the optimizer evaluate it once for a whole scan and
  lets a replica compute a different answer, and a wrong result is worse than a refused statement.
- `MODIFIES SQL DATA`, always, for the same reason at a lower stake — it is the widest data-access
  characteristic, so it never refuses a body that turns out to write.
- `SQL SECURITY INVOKER`, always. This one is not a MySQL detail but a cross-dialect correctness rule:
  MySQL defaults a routine to `SQL SECURITY DEFINER` while Postgres defaults to `SECURITY INVOKER`, so one
  `RoutineDef` emitted to both dialects would run under two different privilege models. Definer rights are
  the escalation surface `../../../repository/SPEC.md` §4a is about; making them the silent default on one
  of three dialects is not a thing to inherit. A definer-rights routine is deliberately not expressible
  here (§8.8).

### 8.3 SQLite refuses

```
sqlite does not support stored routines (function "archive_old_orders"); SQLite has no CREATE FUNCTION,
so register the function on the connection instead — `node:sqlite` exposes `DatabaseSync#function` — and
call it like any other
```

`UnsupportedFeatureError`, the same class as materialized views, RLS and extensions. Nothing is emulated: a
routine emulated in JavaScript would run in the application process, so a `CALL` inside a trigger or
another routine would not reach it, and the emulation would be correct exactly for the calls that did not
need it.

### 8.4 Replace semantics, and why `CREATE OR REPLACE` is not enough

`CREATE OR REPLACE FUNCTION` on Postgres replaces a routine **only** when the parameter list and the return
type are unchanged. Two failure modes otherwise, and they differ:

- A changed **return type** is refused outright — `cannot change return type of existing function`.
- A changed **parameter list** succeeds and creates a _second_ overload. Postgres identifies a function by
  name and argument types, so `f(integer)` and `f(text)` coexist, calls dispatch by argument type, and the
  old body keeps answering every call that matches the old signature. This is the failure this section
  exists for: it is silent, it survives a green deploy, and the symptom is a routine that is sometimes the
  old one.

So `replaceRoutineStatements(prev, next, dialect)` decides:

| Dialect  | Signature unchanged          | Signature changed                                     |
| -------- | ---------------------------- | ----------------------------------------------------- |
| postgres | `[CREATE OR REPLACE …]`      | `[DROP FUNCTION IF EXISTS "f"(<prev types>), CREATE]` |
| mysql    | `[DROP … IF EXISTS, CREATE]` | `[DROP … IF EXISTS, CREATE]`                          |

The Postgres `DROP` names the **previous** parameter types, because an unqualified
`DROP FUNCTION IF EXISTS "f"` is ambiguous when overloads exist and Postgres errors rather than guessing.
That is also why `replaceRoutineStatements` takes `prev`: no other input carries the signature that has to
be dropped, and reconstructing it from the database would mean introspecting `pg_proc` at emit time.

**Drop-then-create is not atomic, and the spec does not pretend otherwise.** On Postgres the pair is inside the migration's transaction, because Postgres has transactional DDL, so no window exists. On MySQL, DDL commits implicitly and there is a real interval in which the routine does not exist; a caller in that interval gets `PROCEDURE does not exist`.

There is no emitter trick that closes it — the practical remedies are outside the emitter: deploy the new routine under a new name and switch callers, or accept the window in a maintenance step. The runner surfaces the failure; it does not retry, because a retry after an implicit commit re-runs a `CREATE` against a routine that may now exist.

### 8.5 The `DELIMITER` question, resolved

`DELIMITER` is **not SQL**. It is a directive of the `mysql` command-line client, interpreted client-side to
decide where one statement ends; it is never sent to the server, and sending it to a driver produces a
syntax error. The server protocol frames one statement per message, so a routine body full of semicolons
travels fine as long as nobody splits the string on `;`.

Therefore: **no emitter in this module ever emits `DELIMITER`**, and `createRoutineDdl` returns exactly one
statement, preserving this module's standing invariant. `replaceRoutineStatements` returns an ordered
_array_ of statements rather than one string joined by `;` for precisely this reason — one `exec` per
element is correct on every driver, whereas joining them needs multi-statement support (`mysql2` wants
`multipleStatements: true`) and is the only thing that would ever need a delimiter.

Two consumers, two treatments:

- The **migration runner** hands `Migration.up` to `MigrationConnection#exec`. A migration containing a
  routine should call `exec` once per statement, which the array gives it directly.
- A **`.sql` script** written for humans to pipe into the `mysql` client is the one artifact that needs
  wrapping (`DELIMITER $$ … $$ DELIMITER ;`), and the wrapping belongs to whatever writes the script — see
  the CLI's export verb. Putting it in the emitter would break the driver path to fix the CLI path.

### 8.6 Diffing an opaque body

`routineFingerprint(def)` covers `kind`, `name`, the parameter list in order (name, type, mode), `returns`,
`language`, `deterministic`, and the body **normalised only by stripping trailing whitespace from each line
and any trailing newline**. Equal fingerprints mean no statement is emitted; any difference re-emits by
§8.4.

That is all the normalisation there will be, and the consequence is accepted: a reindent, a comment edit or a case change in a keyword causes a re-emit.

The alternative is a SQL parser, and not even one — `language` is an open string, so the body may be plpgsql, sql, plv8 JavaScript, or PL/Python. "Normalise the body" means "normalise an arbitrary programming language", and a normaliser that is wrong in the other direction reports no change for a routine that did change, which is the failure worth avoiding.

A re-emitted identical routine costs one DDL statement; a missed change costs a wrong answer in production.

A parameter **rename** changes the fingerprint even though the call signature is unchanged, because a
plpgsql body references parameters by name and the emitter cannot tell whether the body was updated to
match.

### 8.7 `out` and `inout` are refused for now

`mode` is declared, and `'out' | 'inout'` throws `UnsupportedFeatureError` naming the parameter. The field
exists rather than being omitted so that a declaration written today does not change shape when support
lands, and so the refusal can name the parameter instead of failing as an unknown property.

The reason it is refused is that retrieving an output parameter is not a result set. MySQL needs `CALL p(@out)` followed by `SELECT @out` — two statements sharing session state, which a `Driver.execute(CompiledQuery)` returning rows cannot express and a pooled connection cannot guarantee is the same session. Postgres instead returns output parameters _as a result row_.

So one declaration would need two call shapes and two result types, and the typed call surface (`../../../repository/SPEC.md` §4a) would have a return type that depends on the dialect. Refusing is consistent; supporting it on one dialect is how a schema stops being portable.

### 8.8 Not expressible, on purpose

- **Definer rights.** No `SECURITY DEFINER` on Postgres, no `SQL SECURITY DEFINER` on MySQL. A routine that
  runs as its owner converts "may call this" into "may do what the owner may do", and generating that from a
  declaration puts a privilege boundary in a file that reviews like schema. An author who wants it writes
  the migration by hand, where it is visible as a decision.
- **A composite or table return type.** `returns.type` is a `SqlType`, so `RETURNS TABLE (…)` and
  `RETURNS SETOF users` cannot be declared. A row-returning function is better modelled as a relation — give
  it a schema object and query it with `selectFrom` — and a `setof` of a scalar type covers the rest.
- **Overloads.** One `RoutineDef` per name. Postgres allows overloading; nothing else does, the fingerprint
  is keyed by name, and §8.4's drop already assumes a single previous signature.
- **Triggers.** A trigger is a separate object with its own timing and event vocabulary; it is not a routine
  with extra fields.

## Frozen (all)

- Identifiers quoted per dialect (`"` pg/sqlite, `` ` `` mysql).
- Emitters are pure functions returning a single DDL statement; deterministic.
- RLS / materialized views are postgres features — on other dialects the emitter
  throws an explicit `UnsupportedFeatureError` (never silently wrong).

<!-- §3 sequences frozen: CREATE SEQUENCE with optional START/INCREMENT. -->

<!-- §4 generated columns frozen: GENERATED ALWAYS AS (expr) [STORED]. -->

<!-- §5 namespaces frozen: CREATE SCHEMA; qualify() ⇒ "schema"."object". -->

<!-- §6 RLS frozen (pg only): ENABLE ROW LEVEL SECURITY + CREATE POLICY. -->
