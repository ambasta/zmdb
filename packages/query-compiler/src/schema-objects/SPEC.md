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

The tagged wrapper exists to make the choice explicit at the call site. A bare string could
not: `'lower(email)'` quoted as an identifier produces `"lower(email)"`, which Postgres reads
as a column whose name contains parentheses and rejects with "column does not exist" — and
sniffing for a `(` to decide would make a legitimately odd column name unindexable while
quietly accepting a half-written expression. So the caller says which it meant, and the case-
insensitive-unique recipe this epic exists to enable (`{ expr: 'lower(email)' }`) is spelled
differently from an ordinary index on a column that happens to be called `email`.

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

**Dropping is not automatic, and this is the deliberate asymmetry.** An extension declared and then
undeclared produces no `DROP EXTENSION`, because `DROP EXTENSION vector` fails while any column still
uses the type and `DROP EXTENSION vector CASCADE` drops those columns instead — so the two available
behaviours are "the migration fails" and "the migration deletes data". Neither is something to generate
from the absence of a declaration, particularly when that absence often means "somebody else manages
this one now". Removal is a hand-written migration, and the diff says so rather than staying silent
about it.

## Frozen (all)

- Identifiers quoted per dialect (`"` pg/sqlite, `` ` `` mysql).
- Emitters are pure functions returning a single DDL statement; deterministic.
- RLS / materialized views are postgres features — on other dialects the emitter
  throws an honest `UnsupportedFeatureError` (never silently wrong).

<!-- §3 sequences frozen: CREATE SEQUENCE with optional START/INCREMENT. -->

<!-- §4 generated columns frozen: GENERATED ALWAYS AS (expr) [STORED]. -->

<!-- §5 namespaces frozen: CREATE SCHEMA; qualify() ⇒ "schema"."object". -->

<!-- §6 RLS frozen (pg only): ENABLE ROW LEVEL SECURITY + CREATE POLICY. -->
