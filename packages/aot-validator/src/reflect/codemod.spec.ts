// The codemod's output, pinned as text and then compiled.
//
// This is what makes `scripts/codemod-tagged-schema.mjs` trustworthy. The codemod interprets a
// builder chain statically, and a static interpretation that is subtly wrong does not throw —
// it emits a plausible interface describing a slightly different table. Nothing downstream
// would notice: the DDL compiles, the validator compiles, the JSON Schema looks right.
//
// It used to be checked as a differential. `defineSchema` still existed, so the corpus could
// be *run*, and the converted interface had to reflect back to the same `SchemaIR` the value
// produced. That oracle went when the DSL did, and the two things standing in its place are
// stronger in the ways that were previously blind spots and weaker in one:
//
//  1. **The emitted text is compared, not just its meaning.** `codemod-tables.ts` is the old
//     spelling of the two tables `__fixtures__/tables.ts` declares by hand, and the assertion
//     is that converting one produces the other — read out of both files, so there is no
//     golden to keep in sync. That pins two things IR equality never could: the order the tags
//     come out in, and the `(T & Tags) | null` bracketing that keeps `null & Unique` from
//     reducing to `never` and silently dropping the nullability. And it inherits everything
//     `tables.ts` is already covered by, since that interface is the corpus four other specs
//     are checked against.
//  2. **The generated TypeScript is compiled and reflected.** A semantic diagnostic on the
//     output fails the suite, and each interface is then read back to `SchemaIR` with the
//     reflector, which has to refuse nothing. A misspelled tag, a pruned import that was still
//     needed, a construct converted into something the reflector cannot read — all of them
//     land here.
//
// What is weaker: the corpus in `codemod-corpus.ts` reaches for constructs `tables.ts` has no
// use for, and for those the expected property lines are written out below rather than derived.
// A written-out expectation agrees with whatever produced it, which a differential did not — so
// each of those lines has to be read as a claim about what the old spelling meant, not just as
// a record of what the tool emitted.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import type { SchemaIR } from '@zmdb/schema-core/ir';
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

  // `pair<T>()` is how `tables.ts` hands a type to the checker. Reusing the shape means the
  // generated interfaces are reflected through exactly the same path as the hand-written ones,
  // rather than through a second path that could disagree with it.
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
  // the wrong way round — all of them land here first, before any text is compared.
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

/** The property lines of an emitted interface, trimmed of indentation. */
function body(source: string): readonly string[] {
  return source
    .split('\n')
    .slice(1, -1)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('//'));
}

function byTable(converted: readonly ConvertedSchema[]): Map<string, ConvertedSchema> {
  return new Map(converted.map(entry => [entry.table, entry]));
}

function irFor(table: string): SchemaIR {
  const found = reflected.get(table);
  expect(found, `nothing reflected for ${table}`).toBeDefined();
  expect(found?.diagnostics, `${table} reflected with diagnostics`).toEqual([]);
  return (found as { ir: SchemaIR }).ir;
}

describe('the codemod reads every schema in the corpus (REQ-TF-4)', () => {
  it('converts every schema the corpus declares, and reflects each one back', () => {
    const tables = ['accounts', 'audit_entries', 'uploads'];
    expect(corpus.converted.map(entry => entry.table).toSorted()).toEqual(tables);
    expect([...reflected.keys()].toSorted()).toEqual(tables);
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
    expect(corpus.rewritten).not.toContain("from './legacy-dsl.ts'");
    expect(corpus.rewritten).toContain("from '@zmdb/schema-core/tags'");
    // `Attachment` is not part of the DSL and is still referenced, so it stays.
    expect(corpus.rewritten).toContain('export interface Attachment');
  });
});

describe('what the codemod emits, line for line (REQ-TF-4)', () => {
  it('converts every construct the corpus reaches for', () => {
    expect(body(byTable(corpus.converted).get('accounts')!.source)).toEqual([
      "id: number & Sql<'integer'> & Serial & PrimaryKey;",
      "handle: string & Sql<'varchar'> & Length<64> & Unique;",
      // A literal union is how an enum is declared, so no `Sql` tag comes out of it (REQ-TF-2).
      "tier: 'free' | 'pro' | 'enterprise';",
      // And bracketed the moment a tag joins it: `&` binds tighter than `|`, so
      // `'monthly' | 'yearly' & HasDefault` would mean `'monthly' | ('yearly' & HasDefault)`.
      // That compiles, and it is a different type.
      "plan: ('monthly' | 'yearly') & HasDefault;",
      // Nested twice, for the same reason twice.
      "region: (('eu' | 'us') & Unique) | null;",
      "balance: number & Sql<'numeric'>;",
      "visits: bigint & Sql<'bigint'>;",
      "verified: boolean & Sql<'boolean'>;",
      "note: (string & Sql<'text'>) | null;",
      // `sensitive(false)` says the column is not sensitive, so no tag. Reading the call as
      // "sensitive was mentioned" would publish a column the author marked public.
      "publicBio: string & Sql<'text'>;",
      "secret: string & Sql<'text'> & Sensitive;",
      // The value `now()` is gone and the flag is not. See `droppedDefaults` below.
      "createdAt: Date & Sql<'timestamp'> & HasDefault;",
    ]);
  });

  it('carries a foreign key named by schema value as well as by string', () => {
    expect(body(byTable(corpus.converted).get('uploads')!.source)).toEqual([
      "id: number & Sql<'integer'> & Serial & PrimaryKey;",
      "label: string & Sql<'text'>;",
      // `fk(integer(), accounts, 'id')` — the target is a schema *value* declared in the same
      // file, and the table name it resolves to is `accounts`, not `Accounts` or `uploads`.
      "accountId: number & Sql<'integer'> & References<'accounts.id'>;",
      // A string target with no column keeps the bare table name, and the nullability wraps
      // the whole intersection rather than joining it.
      "reviewedBy: (number & Sql<'integer'> & References<'accounts'>) | null;",
      // The conversion is a *gain* here: `json<Attachment>()` erased its payload at runtime,
      // and the type keeps it.
      "meta: Attachment & Sql<'json'>;",
      "variant: (Attachment | string) & Sql<'json'>;",
    ]);
  });

  it('converts function-style validate rules into the tag each one means', () => {
    expect(body(byTable(corpus.converted).get('audit_entries')!.source)).toEqual([
      "accountId: number & Sql<'integer'> & PrimaryKey;",
      "seq: number & Sql<'integer'> & PrimaryKey;",
      "action: 'create' | 'update' | 'delete';",
      "detail: string & Sql<'text'> & MaxLength<500>;",
      "weight: number & Sql<'integer'> & Min<0> & Max<100>;",
      "slug: string & Sql<'varchar'> & Length<32> & Pattern<'^[a-z-]+$'>;",
    ]);
  });

  it('writes the table name and the FTS option into the heritage clause', () => {
    const heritage = (table: string) => byTable(corpus.converted).get(table)!.source.split('\n')[0];
    expect(heritage('accounts')).toBe("export interface Accounts extends Table<'accounts'> {");
    expect(heritage('uploads')).toBe("export interface Uploads extends Table<'uploads'>, Fts<'uploads_fts'> {");
    // `ftsTable: true` is the spelling that asks the back-end to name the index, and `true` is
    // falsy-adjacent enough that dropping it would look like the option was never set.
    expect(heritage('audit_entries')).toBe("export interface AuditEntries extends Table<'audit_entries'>, Fts<true> {");
  });
});

describe('what the reflector reads back out of it (REQ-TF-12)', () => {
  it('reports every default value it dropped, and keeps the flag for each', () => {
    // A default *value* is a runtime value and no type can carry one, so the migration has to
    // re-supply it by hand — which makes silently swallowing it the worst thing this tool could
    // do. The flag is the load-bearing half and does survive: it is what keeps the column out
    // of `CreateDTO`.
    const dropped = corpus.converted.flatMap(entry => entry.droppedDefaults.map(name => `${entry.table}.${name}`));
    expect(dropped.toSorted()).toEqual(['accounts.createdAt', 'accounts.plan']);
    for (const name of ['createdAt', 'plan']) {
      const column = irFor('accounts').columns.find(other => other.name === name);
      expect(column?.hasDefault, `accounts.${name}`).toBe(true);
      // And the value is not invented back: `HasDefault` says "has one", not "has this one".
      expect(column && 'default' in column, `accounts.${name}`).toBe(false);
    }
  });

  it('reaches the IR with the constraints the builder chain carried', () => {
    const columns = new Map(irFor('audit_entries').columns.map(column => [column.name, column]));
    expect(columns.get('detail')?.constraints).toEqual({ maxLength: 500 });
    expect(columns.get('weight')?.constraints).toEqual({ minimum: 0, maximum: 100 });
    expect(columns.get('slug')?.constraints).toEqual({ pattern: '^[a-z-]+$' });
    // Declaration order, because it is the order of the key in the DDL and in every `WHERE`
    // the query compiler builds.
    expect(irFor('audit_entries').primaryKey).toEqual(['accountId', 'seq']);
    expect(irFor('audit_entries').ftsTable).toBe(true);
  });

  it('reaches the IR with the json payload the runtime value had erased', () => {
    const meta = irFor('uploads').columns.find(column => column.name === 'meta');
    expect(meta?.sql).toBe('json');
    expect(meta?.payload).toEqual({
      kind: 'object',
      name: 'Attachment',
      properties: [
        { name: 'name', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'string' } },
        { name: 'bytes', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'number' } },
      ],
    });
  });

  it('keeps sensitive off a column that said sensitive(false)', () => {
    const columns = new Map(irFor('accounts').columns.map(column => [column.name, column]));
    expect(columns.get('publicBio')?.sensitive).toBe(false);
    expect(columns.get('secret')?.sensitive).toBe(true);
  });
});

describe('the codemod reproduces an interface a person wrote (REQ-TF-5)', () => {
  // `codemod-tables.ts` is the old spelling of the two tables `tables.ts` declares by hand, so
  // the expected answer is a file rather than a golden. Read out of both sides on purpose: a
  // copy of the expected lines pasted in here would be a second place to keep the same fact,
  // and the whole point of this design is that there is one.

  /**
   * The declaration of one interface in a fixture, as the codemod would have printed it:
   * heritage line, property lines, no comments, no blank lines, and the interface's own name
   * replaced — the codemod derives its name from the binding, so `users` gives `Users` where a
   * person writing the same table by hand called it `User`.
   */
  function declaration(source: string, name: string): readonly string[] {
    const start = source.indexOf(`export interface ${name} extends `);
    expect(start, `${name} is not declared`).toBeGreaterThanOrEqual(0);
    const [heritage, ...properties] = source.slice(start, source.indexOf('\n}', start)).split('\n');
    return [
      heritage!.replace(`interface ${name} `, 'interface _ '),
      ...properties
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
        .map(unionSorted),
    ];
  }

  /**
   * A property whose type is a bare literal union, with the members sorted.
   *
   * The one difference between the two sides that is not a difference. A union has an order in
   * source and the codemod has no business reordering source it is only re-spelling, so it
   * copies the author's — and the author of `tables.ts` wrote a third order again, deliberately,
   * because `ColumnIR.enum` canonicalises and that had passed by luck while every order was
   * alphabetical. Bare unions only: anything with a `&` in it has bracketing to preserve, which
   * is the thing this comparison exists to check.
   */
  function unionSorted(line: string): string {
    if (line.includes('&') || !line.includes('|')) return line;
    const [property, type] = line.split(/:\s*/, 2);
    if (property === undefined || type === undefined) return line;
    const members = type.replace(/;$/, '').split(' | ').toSorted();
    return `${property}: ${members.join(' | ')};`;
  }

  it('converts each table into the interface already in the repository', () => {
    const twins = convert('codemod-tables.ts');
    expect(twins.refusals).toEqual([]);
    const handWritten = readFileSync(`${FIXTURES}tables.ts`, 'utf8');
    const byName = byTable(twins.converted);

    for (const [table, name] of [
      ['users', 'User'],
      ['memberships', 'Membership'],
    ] as const) {
      const converted = declaration(byName.get(table)!.source, byName.get(table)!.name);
      expect(converted, table).toEqual(declaration(handWritten, name));
      // Not vacuous: `declaration` returns the heritage line plus at least one property, so an
      // extraction that silently found nothing would have to fail on both sides identically.
      expect(converted.length, table).toBeGreaterThan(3);
    }
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
