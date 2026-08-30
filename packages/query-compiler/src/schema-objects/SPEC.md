# SPEC — Schema objects DDL (frozen)

Part of `@zmdb/query-compiler`. Declarative schema objects that emit
dialect-correct DDL (feeding migrations). Pure string emitters, no runtime
mutation. Epic #98.

## 1. Indexes & constraints (#99/#100/#101)

```ts
interface IndexDef { name: string; table: string; columns: readonly string[]; unique?: boolean; where?: string; }
function createIndexDdl(def: IndexDef, dialect): string;
function checkConstraintDdl(table: string, name: string, expr: string, dialect): string;
```
- `CREATE [UNIQUE] INDEX "name" ON "table" ("a","b") [WHERE expr]`.
- Check: `ALTER TABLE "t" ADD CONSTRAINT "n" CHECK (expr)`.

## 2. Views (#102/#103/#104)

```ts
interface ViewDef { name: string; select: string; materialized?: boolean; }
function createViewDdl(def, dialect): string; // CREATE [MATERIALIZED] VIEW "n" AS <select>
function dropViewDdl(name, dialect, materialized?): string;
```

## 3. Sequences (#105/#106/#107)

```ts
interface SequenceDef { name: string; start?: number; increment?: number; }
function createSequenceDdl(def, dialect): string; // CREATE SEQUENCE "n" [START x] [INCREMENT y]
```

## 4. Generated columns (#108/#109/#110)

```ts
interface GeneratedColumn { name: string; type: string; expression: string; stored?: boolean; }
function generatedColumnDdl(col, dialect): string;
// "n" <type> GENERATED ALWAYS AS (expr) STORED
```

## 5. Schemas / namespaces (#111/#112/#113)

```ts
function createSchemaDdl(name, dialect): string;      // CREATE SCHEMA "n"
function qualify(schema: string, object: string, dialect): string; // "schema"."object"
```

## 6. Row-Level Security (#114/#115/#116)

```ts
interface RlsPolicy { name: string; table: string; using: string; command?: 'ALL'|'SELECT'|'INSERT'|'UPDATE'|'DELETE'; }
function enableRlsDdl(table, dialect): string;        // ALTER TABLE "t" ENABLE ROW LEVEL SECURITY
function createPolicyDdl(p: RlsPolicy, dialect): string; // CREATE POLICY "n" ON "t" FOR CMD USING (expr)
```

## Frozen (all)
- Identifiers quoted per dialect (`"` pg/sqlite, `` ` `` mysql).
- Emitters are pure functions returning a single DDL statement; deterministic.
- RLS / materialized views are postgres features — on other dialects the emitter
  throws an honest `UnsupportedFeatureError` (never silently wrong).
