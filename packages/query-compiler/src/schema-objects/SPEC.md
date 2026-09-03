# SPEC — Schema objects DDL (frozen)

Part of `@zmdb/query-compiler`. Declarative schema objects that emit
dialect-correct DDL (feeding migrations). Pure string emitters, no runtime
mutation. Epic #98.

## 1. Indexes & constraints (#99/#100/#101)

```ts
type IndexColumn = string | { readonly expr: string };

interface IndexDef {
  name: string;
  table: string;
  columns: readonly IndexColumn[];
  unique?: boolean;
  where?: string;
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

## Frozen (all)

- Identifiers quoted per dialect (`"` pg/sqlite, `` ` `` mysql).
- Emitters are pure functions returning a single DDL statement; deterministic.
- RLS / materialized views are postgres features — on other dialects the emitter
  throws an honest `UnsupportedFeatureError` (never silently wrong).

<!-- §3 sequences frozen: CREATE SEQUENCE with optional START/INCREMENT. -->

<!-- §4 generated columns frozen: GENERATED ALWAYS AS (expr) [STORED]. -->

<!-- §5 namespaces frozen: CREATE SCHEMA; qualify() ⇒ "schema"."object". -->

<!-- §6 RLS frozen (pg only): ENABLE ROW LEVEL SECURITY + CREATE POLICY. -->
