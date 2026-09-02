// The codemod's round trip: `defineSchema` → tagged interface → `SchemaIR`, compared
// against the IR of the value it came from.
//
// This is the assertion that makes `scripts/codemod-tagged-schema.mjs` trustworthy. The
// codemod interprets a builder chain statically, and a static interpretation that is subtly
// wrong does not throw — it emits a plausible interface describing a slightly different
// table. Nothing downstream would notice: the DDL compiles, the validator compiles, the
// JSON Schema looks right. So the check has to be end to end, and it has to be total.
//
// Total means two things here. The generated TypeScript is *compiled* — a semantic
// diagnostic on it fails the suite — and the IR comparison is deep equality over the whole
// document rather than field by field, because a field-by-field comparison passes when one
// side omits a field the other sets, which is exactly how the two IR walkers drifted apart
// in `f70186c6`.
//
// Two fields cannot survive the trip, and both are asymmetries recorded in the corpus too:
//
//   - `default`. `defaultTo('now()')` keeps the value; `HasDefault` records only that a
//     default exists. No type carries a runtime value.
//   - `payload`. `json<Attachment>()` erases its phantom parameter, so `irFromSchema` has
//     nothing to read. The tagged side is *richer* here, not different.
//
// They are dropped by name, and one of the tests below asserts that the set of fields the
// two sides actually disagree on is exactly those two — otherwise the drop list could
// quietly grow to cover real drift, and the round trip would keep passing while meaning
// less and less.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { irFromSchema, type ColumnIR, type SchemaIR } from '@zmdb/schema-core/ir';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  convertFiles,
  rewriteFile,
  type ConvertedSchema,
  type ProjectFileConversion,
} from '../../../../scripts/codemod-tagged-schema.mjs';
import { findCallSites } from './callsites.ts';
import { Reflector, type ReflectDiagnostic } from './index.ts';
import { ReflectSession } from './session.ts';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const PROJECT = `${FIXTURES}tsconfig.json`;
/** Written, compiled and deleted by this file. Gitignored; nothing else may read it. */
const SCRATCH = `${FIXTURES}__generated__/`;

/** The two fields that exist on one side of the trip and cannot exist on the other. */
const ASYMMETRIC = ['default', 'payload'] as const;

interface Conversion extends ProjectFileConversion {
  /** The text after `rewriteFile`, which is what actually gets compiled. */
  readonly rewritten: string;
}

let session: ReflectSession;
let corpus: Conversion;
/** table name → what the reflector made of the *generated* interface for it. */
const reflected = new Map<string, { readonly ir: SchemaIR; readonly diagnostics: readonly ReflectDiagnostic[] }>();

/**
 * Run the codemod over one fixture, through the same path the CLI takes.
 *
 * `rewriteFile` rather than the raw interfaces: the rewrite is what keeps `Attachment` in
 * scope for `meta: Attachment & Sql<'json'>`, so testing the interfaces alone would test a
 * file that does not compile and call it a pass.
 */
function convert(fixture: string): Conversion {
  const [result] = convertFiles(PROJECT, [`${FIXTURES}${fixture}`]);
  if (!result) throw new Error(`the codemod returned nothing for ${fixture}`);
  return { ...result, rewritten: rewriteFile(result.text, result).text };
}

beforeAll(() => {
  corpus = convert('codemod-corpus.ts');
  // A refusal here is not a soft failure. The corpus exists to be convertible, so one means
  // either the codemod lost a construct or the corpus grew one it never claimed to handle.
  expect(corpus.refusals, 'the round-trip corpus must convert without refusals').toEqual([]);

  // `pair<T>()` is how `equivalence.ts` hands a type to the checker. Reusing the shape means
  // the generated interfaces are reflected through exactly the same path as the hand-written
  // ones, rather than through a second path that could disagree with it.
  const probes = [
    'declare function pair<T>(table: string): void;',
    ...corpus.converted.map(entry => `pair<${entry.name}>('${entry.table}');`),
  ].join('\n');

  mkdirSync(SCRATCH, { recursive: true });
  writeFileSync(`${SCRATCH}corpus.ts`, `${corpus.rewritten}\n${probes}\n`);
  // Its own project: `__fixtures__/tsconfig.json` lists its files explicitly, and a file the
  // config does not name is invisible to that program however it is announced.
  writeFileSync(
    `${SCRATCH}tsconfig.json`,
    `${JSON.stringify({ extends: `${ROOT}tsconfig.base.json`, files: ['corpus.ts'] }, undefined, 2)}\n`,
  );

  session = ReflectSession.open({ project: `${SCRATCH}tsconfig.json` });

  // The strongest single claim in this file: the TypeScript the codemod emitted compiles.
  // A misspelled tag, a pruned import that was still needed, `(T | null) & Unique` written
  // the wrong way round — all of them land here first, before any IR is compared.
  const diagnostics = session.diagnostics(`${SCRATCH}corpus.ts`);
  expect(diagnostics, `the generated corpus does not compile: ${JSON.stringify(diagnostics[0])}`).toEqual([]);

  const generated = session.sourceFile(`${SCRATCH}corpus.ts`);
  if (!generated) throw new Error('the generated corpus is not in its own program');
  for (const call of findCallSites(generated, new Set(['pair']))) {
    const [first] = call.node.arguments;
    const table = first && 'text' in first ? String(first.text) : undefined;
    const type = session.checker.getTypeFromTypeNode(call.typeArgument);
    // Skipping silently would let a probe vanish and the coverage test above would be the
    // one to notice, several assertions from the cause, so say which one went missing.
    if (table === undefined || !type) throw new Error(`could not resolve the probe type for ${table ?? '<unnamed>'}`);
    // One reflector per table: `diagnostics` accumulates per instance, and sharing one would
    // attribute the first table's refusal to whichever table happened to follow it.
    const reflector = new Reflector(session.checker, generated, {});
    reflected.set(table, { ir: reflector.schemaIR(type), diagnostics: reflector.diagnostics });
  }
});

afterAll(() => {
  session?.close();
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** The schemas the corpus declares at runtime, which are the oracle for the trip. */
async function corpusSchemas(): Promise<readonly { readonly table: string }[]> {
  const loaded: Record<string, unknown> = await import('./__fixtures__/codemod-corpus.ts');
  return Object.values(loaded).filter(
    (value): value is { readonly table: string } =>
      typeof value === 'object' && value !== null && typeof (value as { table?: unknown }).table === 'string',
  );
}

/** A column with the fields no type can carry removed. */
function comparable(column: ColumnIR): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...column };
  for (const field of ASYMMETRIC) delete copy[field];
  return copy;
}

function comparableSchema(ir: SchemaIR): Record<string, unknown> {
  return { ...ir, columns: ir.columns.map(comparable) };
}

/** The field names on which two columns disagree by value, present-or-absent included. */
function differingFields(left: ColumnIR, right: ColumnIR): readonly string[] {
  const a = left as unknown as Record<string, unknown>;
  const b = right as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    key => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  );
}

/** The property lines of an emitted interface, trimmed of indentation. */
function body(source: string): readonly string[] {
  return source
    .split('\n')
    .slice(1, -1)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function byTable(converted: readonly ConvertedSchema[]): Map<string, ConvertedSchema> {
  return new Map(converted.map(entry => [entry.table, entry]));
}

describe('the codemod reads every schema in the corpus (REQ-TF-4)', () => {
  it('converts exactly the tables the corpus declares at runtime', async () => {
    const tables = (await corpusSchemas()).map(schema => schema.table);
    expect(tables.length).toBeGreaterThan(0);
    expect(corpus.converted.map(entry => entry.table).toSorted()).toEqual(tables.toSorted());
    expect([...reflected.keys()].toSorted()).toEqual(tables.toSorted());
  });

  it('names each interface from the binding, never from the table', () => {
    // `auditEntries` → `AuditEntries`, not `AuditEntry`. De-pluralising would make the
    // codemod a fifth place with an opinion about English, and the reflector already refuses
    // to guess in the other direction.
    expect(corpus.converted.map(entry => entry.name).toSorted()).toEqual(['Accounts', 'AuditEntries', 'Uploads']);
  });

  it('prunes the DSL import it made dead and leaves what the file still uses', () => {
    // The corpus's header text mentions `json` and `defaultTo`; an earlier prune matched on
    // a text search and kept the import alive because of the prose. This is that bug's test.
    expect(corpus.rewritten).not.toContain('@zmdb/schema-core"');
    expect(corpus.rewritten).not.toContain("from '@zmdb/schema-core'");
    expect(corpus.rewritten).toContain("from '@zmdb/schema-core/tags'");
    // `Attachment` is not part of the DSL and is still referenced, so it stays.
    expect(corpus.rewritten).toContain('export interface Attachment');
  });
});

describe('codemod round trip (REQ-TF-7, REQ-TF-12)', () => {
  it('produces the same IR as irFromSchema, but for the two fields no type can carry', async () => {
    for (const schema of await corpusSchemas()) {
      const fromType = reflected.get(schema.table);
      expect(fromType, `nothing reflected for ${schema.table}`).toBeDefined();
      expect(fromType?.diagnostics, `${schema.table} reflected with diagnostics`).toEqual([]);
      expect(comparableSchema(fromType!.ir), schema.table).toEqual(comparableSchema(irFromSchema(schema as never)));
    }
  });

  it('differs on exactly `default` and `payload`, and on nothing else', async () => {
    // The assertion that keeps the one above honest. If the codemod started losing `unique`,
    // the test above would go green again the moment `unique` joined the drop list — so the
    // list is asserted from the observed data rather than taken from the constant.
    const observed = new Set<string>();
    for (const schema of await corpusSchemas()) {
      const fromType = reflected.get(schema.table)!.ir;
      for (const column of irFromSchema(schema as never).columns) {
        const twin = fromType.columns.find(other => other.name === column.name);
        expect(twin, `${schema.table}.${column.name} is missing from the converted interface`).toBeDefined();
        for (const field of differingFields(column, twin!)) observed.add(field);
      }
    }
    expect([...observed].toSorted()).toEqual([...ASYMMETRIC].toSorted());
  });

  it('keeps hasDefault wherever it dropped the default value', async () => {
    const dropped = corpus.converted.flatMap(entry => entry.droppedDefaults.map(name => `${entry.table}.${name}`));
    expect(dropped.length, 'the corpus must exercise a dropped default').toBeGreaterThan(0);
    for (const schema of await corpusSchemas()) {
      for (const column of irFromSchema(schema as never).columns) {
        if (column.default === undefined) continue;
        // Reported, not silent: a value the migration has to re-supply by hand is exactly
        // the thing a codemod must not swallow.
        expect(dropped, `${schema.table}.${column.name} lost its default silently`).toContain(
          `${schema.table}.${column.name}`,
        );
        const twin = reflected.get(schema.table)!.ir.columns.find(other => other.name === column.name);
        // The flag is what survives, and it is the load-bearing half: it is what makes the
        // column optional on insert.
        expect(twin?.hasDefault, `${schema.table}.${column.name}`).toBe(true);
      }
    }
  });

  it('reproduces the hand-written tagged twin of the equivalence corpus (REQ-TF-5)', () => {
    // `equivalence.ts` was written by hand and is already proved deep-equal to
    // `equivalence-schemas.ts`. Reproducing its property lines exactly means the codemod
    // inherits that proof instead of restating it — and it pins the two things IR equality
    // cannot see: the order the tags are emitted in, and the `(T & Tags) | null` bracketing
    // that keeps `null & Unique` from collapsing to `never`.
    const twins = convert('equivalence-schemas.ts');
    expect(twins.refusals).toEqual([]);
    const bodies = byTable(twins.converted);
    expect(body(bodies.get('users')!.source)).toEqual([
      "id: number & Sql<'serial'> & Serial & PrimaryKey;",
      "email: string & Sql<'varchar'> & Length<255> & Unique & Pattern<'^\\\\S+@\\\\S+$'>;",
      "age: number & Sql<'integer'> & Min<18> & Max<120>;",
      "score: number & Sql<'numeric'>;",
      "visits: bigint & Sql<'bigint'>;",
      "bio: (string & Sql<'text'> & MinLength<3> & MaxLength<2000>) | null;",
      "active: boolean & Sql<'boolean'>;",
      "createdAt: Date & Sql<'timestamp'> & HasDefault;",
      // The author's order, not the IR's: a union has one and the codemod has no business
      // reordering source it is only re-spelling. `ColumnIR.enum` canonicalises later.
      "role: 'viewer' | 'admin' | 'editor';",
      "passwordHash: string & Sql<'text'> & Sensitive;",
    ]);
    expect(body(bodies.get('memberships')!.source)).toEqual([
      "userId: number & Sql<'integer'> & PrimaryKey & References<'users.id'>;",
      "groupId: number & Sql<'integer'> & PrimaryKey & References<'groups.id'>;",
      "invitedBy: (number & Sql<'integer'> & References<'users.id'>) | null;",
    ]);
  });
});

describe('the codemod refuses rather than guessing (REQ-TF-6)', () => {
  it('names what it could not read, and converts nothing in that call', () => {
    const refused = convert('codemod-refusals.ts');
    expect(refused.converted).toEqual([]);
    const reasons = refused.refusals.map(refusal => refusal.reason);
    expect(reasons).toHaveLength(3);
    // A dynamic table name, a column built outside the DSL, and a name already in scope.
    // The message has to name the thing: "could not convert this file" would send someone
    // reading 40 lines to find out which of them was the problem.
    expect(reasons.find(reason => reason.includes('table name'))).toContain('expected a literal');
    expect(reasons.find(reason => reason.includes('opaqueColumn'))).toContain('unknown column function');
    expect(reasons.find(reason => reason.includes('Colliding'))).toContain('already declared in scope');
  });
});
