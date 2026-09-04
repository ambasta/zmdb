// Phase 4's gate: every construct in `__fixtures__/constructs.ts` either reflects
// correctly or produces a NAMED refusal. Zero rows silently wrong.
//
// The corpus test near the bottom is the one that matters most, and it used to be a
// differential: a tagged interface and a `defineSchema` call describing the same table
// had to produce deep-equal `SchemaIR`. That oracle went when `defineSchema` did, so
// what stands in its place is a written-out `SchemaIR` for the same two tables. It is a
// worse test in one way — a golden agrees with whatever produced it — and a better one in
// another, because the differential only ever proved the two front-ends were wrong in the
// same way, and this says what the right answer is.

import type { ColumnIR, SchemaIR, TypeIR } from '@zmdb/schema-core/ir';
import { isStringLiteral } from 'typescript/unstable/ast/is';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findCallSites } from './callsites.js';
import {
  DEFAULT_LIMITS,
  irFromType,
  Reflector,
  schemaIrFromType,
  type ReflectDiagnostic,
  type ReflectOptions,
} from './index.js';
import { ReflectSession } from './session.js';

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const PROJECT = `${FIXTURES}tsconfig.json`;

interface Probed {
  readonly ir: TypeIR;
  readonly diagnostics: readonly ReflectDiagnostic[];
}

let session: ReflectSession;
/** label → what the reflection made of it, for `constructs.ts`. */
const probes = new Map<string, Probed>();
/** table name → the IR reflected from the tagged interface, for `tables.ts`. */
const tagged = new Map<string, { readonly ir: SchemaIR; readonly diagnostics: readonly ReflectDiagnostic[] }>();

/** The string argument of `probe<T>('label')`, which is the assertion key. */
function labelOf(call: { readonly node: { readonly arguments: readonly unknown[] } }): string | undefined {
  const [first] = call.node.arguments;
  return first && isStringLiteral(first as never) ? (first as { text: string }).text : undefined;
}

beforeAll(() => {
  session = ReflectSession.open({ project: PROJECT });

  // A type read out of a file that does not compile is a guess. Checking first turns
  // "the reflection is wrong" into "the fixture is broken", which are very different
  // afternoons.
  for (const file of ['constructs.ts', 'tables.ts', 'naming-strategy.ts']) {
    const diagnostics = session.diagnostics(`${FIXTURES}${file}`);
    if (diagnostics.length > 0) {
      throw new Error(
        `fixture ${file} has ${diagnostics.length} semantic diagnostic(s): ${JSON.stringify(diagnostics[0])}`,
      );
    }
  }

  const constructs = session.sourceFile(`${FIXTURES}constructs.ts`);
  if (!constructs) throw new Error('constructs.ts is not in the program');
  for (const call of findCallSites(constructs, new Set(['probe']))) {
    const label = labelOf(call);
    const type = session.checker.getTypeFromTypeNode(call.typeArgument);
    if (label === undefined || !type) continue;
    // One reflector per probe: the budget and the helper-name table are per-file
    // state, and sharing them across 40 unrelated types would make one probe's
    // diagnostics show up in another's.
    const reflector = new Reflector(session.checker, constructs, {});
    probes.set(label, { ir: reflector.typeIR(type), diagnostics: reflector.diagnostics });
  }

  const corpus = session.sourceFile(`${FIXTURES}tables.ts`);
  if (!corpus) throw new Error('tables.ts is not in the program');
  for (const call of findCallSites(corpus, new Set(['pair']))) {
    const label = labelOf(call);
    const type = session.checker.getTypeFromTypeNode(call.typeArgument);
    if (label === undefined || !type) continue;
    const reflector = new Reflector(session.checker, corpus, {});
    tagged.set(label, { ir: reflector.schemaIR(type), diagnostics: reflector.diagnostics });
  }
});

afterAll(() => session?.close());

/** The IR for a labelled probe, asserting the probe exists at all. */
function ir(label: string): TypeIR {
  const probed = probes.get(label);
  expect(probed, `no probe labelled ${label}`).toBeDefined();
  return (probed as Probed).ir;
}

function reasonFor(label: string): string {
  const node = ir(label);
  expect(node.kind, `${label} should have been refused, got ${node.kind}`).toBe('unsupported');
  return node.kind === 'unsupported' ? node.reason : '';
}

describe('irFromType — scalars', () => {
  it('maps each primitive to its scalar kind', () => {
    expect(ir('string')).toEqual({ kind: 'scalar', scalar: 'string' });
    expect(ir('number')).toEqual({ kind: 'scalar', scalar: 'number' });
    expect(ir('boolean')).toEqual({ kind: 'scalar', scalar: 'boolean' });
    expect(ir('bigint')).toEqual({ kind: 'scalar', scalar: 'bigint' });
    expect(ir('date')).toEqual({ kind: 'scalar', scalar: 'date' });
  });

  it('recognises `boolean` as a scalar and not as the union `true | false` it is', () => {
    // The checker models `boolean` as a two-member union of boolean literals. Without
    // the special case the walk reaches the object branch and emits property checks
    // for a primitive — the exact shape of bug the IR exists to make impossible.
    expect(ir('boolean')).toEqual({ kind: 'scalar', scalar: 'boolean' });
  });
});

describe('irFromType — literals and unions', () => {
  it('carries literal values', () => {
    expect(ir('string-literal')).toEqual({ kind: 'literal', value: 'admin' });
    expect(ir('number-literal')).toEqual({ kind: 'literal', value: 7 });
    expect(ir('true-literal')).toEqual({ kind: 'literal', value: true });
  });

  it('reflects a literal union as a union of literals', () => {
    expect(ir('literal-union')).toEqual({
      kind: 'union',
      members: [
        { kind: 'literal', value: 'admin' },
        { kind: 'literal', value: 'viewer' },
      ],
    });
  });

  it('reflects `| null` and `| undefined` as members, not as flags', () => {
    expect(ir('nullable-string')).toEqual({
      kind: 'union',
      members: [{ kind: 'scalar', scalar: 'string' }, { kind: 'null' }],
    });
    expect(ir('optional-string')).toEqual({
      kind: 'union',
      members: [{ kind: 'scalar', scalar: 'string' }, { kind: 'undefined' }],
    });
  });

  it('reflects a genuine sum type', () => {
    expect(ir('mixed-union')).toEqual({
      kind: 'union',
      members: [
        { kind: 'scalar', scalar: 'string' },
        { kind: 'scalar', scalar: 'number' },
      ],
    });
  });

  it('refuses a bigint literal, which has no wire spelling', () => {
    expect(reasonFor('bigint-literal')).toContain('bigint literal');
  });
});

describe('irFromType — tags', () => {
  it("narrows `number` to `integer` under Sql<'integer'> and Sql<'integer'>", () => {
    // The integrality check comes from the SQL type, never from a `Min<1>` that
    // happens to be nearby. `numeric` stays a plain number.
    expect(ir('tagged-integer')).toEqual({ kind: 'scalar', scalar: 'integer' });
    expect(ir('tagged-serial')).toEqual({ kind: 'scalar', scalar: 'integer' });
    expect(ir('tagged-numeric')).toEqual({ kind: 'scalar', scalar: 'number' });
  });

  it("keeps a tagged boolean a boolean, through the checker's distribution", () => {
    // `boolean` is `true | false`, and an intersection over a union distributes: the walk
    // is handed `(false & Sql<'boolean'>) | (true & Sql<'boolean'>)`. Reading the boolean
    // literals through the tag parts is what keeps `active: boolean & Sql<'boolean'>` one
    // `typeof` check instead of two literal comparisons — and what makes it agree with the
    // value front-end, which had no union to distribute in the first place.
    expect(ir('tagged-boolean')).toEqual({ kind: 'scalar', scalar: 'boolean' });
  });

  it('reads numeric and string bounds off the tags', () => {
    expect(ir('tagged-bounds')).toEqual({
      kind: 'scalar',
      scalar: 'number',
      constraints: { minimum: 18, maximum: 120 },
    });
    expect(ir('tagged-lengths')).toEqual({
      kind: 'scalar',
      scalar: 'string',
      constraints: { minLength: 3, maxLength: 64 },
    });
  });

  it('treats Length<N> as a maximum, and lets an explicit MaxLength win', () => {
    expect(ir('tagged-varchar')).toEqual({ kind: 'scalar', scalar: 'string', constraints: { maxLength: 255 } });
    expect(ir('tagged-length-vs-maxlength')).toEqual({
      kind: 'scalar',
      scalar: 'string',
      constraints: { maxLength: 10 },
    });
  });

  it('reads a pattern verbatim', () => {
    expect(ir('tagged-pattern')).toEqual({
      kind: 'scalar',
      scalar: 'string',
      constraints: { pattern: '^\\S+@\\S+$' },
    });
  });

  it('keeps constraints under a null union', () => {
    expect(ir('tagged-nullable')).toEqual({
      kind: 'union',
      members: [{ kind: 'scalar', scalar: 'string', constraints: { minLength: 3 } }, { kind: 'null' }],
    });
  });

  it('refuses a tags-only type, which carries no value to check', () => {
    expect(reasonFor('tags-only')).toContain('no properties');
  });
});

describe('irFromType — composites', () => {
  it('reflects arrays, readonly or not', () => {
    expect(ir('array')).toEqual({ kind: 'array', element: { kind: 'scalar', scalar: 'number' } });
    expect(ir('readonly-array')).toEqual({ kind: 'array', element: { kind: 'scalar', scalar: 'string' } });
  });

  it('keeps element constraints and array constraints apart', () => {
    expect(ir('array-of-tagged')).toEqual({
      kind: 'array',
      element: { kind: 'scalar', scalar: 'string', constraints: { minLength: 2 } },
    });
    expect(ir('tagged-array')).toEqual({
      kind: 'array',
      element: { kind: 'scalar', scalar: 'string', constraints: { minLength: 1 } },
      constraints: { maxLength: 3 },
    });
  });

  it('reflects a fixed tuple', () => {
    expect(ir('tuple')).toEqual({
      kind: 'tuple',
      elements: [
        { kind: 'scalar', scalar: 'string' },
        { kind: 'scalar', scalar: 'number' },
      ],
    });
  });

  it('refuses optional and rest tuple elements rather than checking a fixed length', () => {
    // `TupleType.elementFlags` is declared in the client's `.d.ts` but arrives
    // `undefined`, so the distinction is not available structurally. Refusing beats
    // emitting `length === 2` for `[string, ...number[]]`.
    expect(reasonFor('tuple-optional')).toContain('optional or rest');
    expect(reasonFor('tuple-rest')).toContain('optional or rest');
  });
});

describe('irFromType — objects', () => {
  it('names a declared interface and recurses into its properties', () => {
    expect(ir('nested-object')).toEqual({
      kind: 'object',
      name: 'Profile',
      properties: [
        {
          name: 'address',
          optional: false,
          readonly: false,
          type: {
            kind: 'object',
            name: 'Address',
            properties: [
              { name: 'street', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'string' } },
              {
                name: 'zip',
                optional: false,
                readonly: false,
                type: { kind: 'scalar', scalar: 'string', constraints: { maxLength: 10 } },
              },
            ],
          },
        },
        {
          name: 'nickname',
          optional: true,
          readonly: false,
          // Measured, not assumed: even under `exactOptionalPropertyTypes` the checker
          // reports `nickname?: string` as plain `string`, with no `| undefined` arm.
          // `optional: true` is therefore the ONLY record that absence is allowed, and
          // an emitter that ignores it rejects every value the type accepts.
          type: { kind: 'scalar', scalar: 'string' },
        },
      ],
    });
  });

  it('leaves an anonymous object unnamed', () => {
    expect(ir('anonymous-object')).toEqual({
      kind: 'object',
      properties: [{ name: 'a', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'number' } }],
    });
  });

  it('refuses `{}`, which admits every object', () => {
    expect(reasonFor('empty-object')).toContain('no properties');
  });

  it('closes a cycle with a ref rather than recursing forever', () => {
    expect(ir('recursive')).toEqual({
      kind: 'object',
      name: 'Node_',
      properties: [
        { name: 'value', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'string' } },
        {
          name: 'next',
          optional: false,
          readonly: false,
          type: { kind: 'union', members: [{ kind: 'ref', name: 'Node_' }, { kind: 'null' }] },
        },
      ],
    });
  });

  it('uses one ref for a type reached twice', () => {
    const node = ir('recursive-twice');
    expect(node.kind).toBe('object');
    if (node.kind !== 'object') return;
    for (const property of node.properties) {
      expect(property.type).toEqual({ kind: 'union', members: [{ kind: 'ref', name: 'Tree' }, { kind: 'null' }] });
    }
  });

  it('closes a mutual cycle, which a per-type guard would miss', () => {
    // Neither `Folder` nor `FileEntry` is its own ancestor; the pair is. The cycle guard
    // is a stack of frames rather than a "am I inside myself" check for exactly this.
    expect(ir('mutual-recursion')).toEqual({
      kind: 'object',
      name: 'Folder',
      properties: [
        { name: 'name', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'string' } },
        {
          name: 'files',
          optional: false,
          readonly: false,
          type: {
            kind: 'array',
            element: {
              kind: 'object',
              name: 'FileEntry',
              properties: [
                { name: 'name', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'string' } },
                {
                  name: 'parent',
                  optional: false,
                  readonly: false,
                  type: { kind: 'union', members: [{ kind: 'ref', name: 'Folder' }, { kind: 'null' }] },
                },
              ],
            },
          },
        },
      ],
    });
  });

  it('refuses a type with a method, naming the property that gave it away', () => {
    // Refused as a whole rather than property by property: an object with behaviour is
    // not a data type, and "`WithMethod` has a method (`run`)" is a message someone can
    // act on, where a nested `unsupported` beside eight good properties is not.
    expect(reasonFor('object-with-method')).toContain('has a method (`run`)');
  });
});

describe('irFromType — unions of objects (REQ-AV-5)', () => {
  // The reflection does not pick a discrimination strategy; that is the emitter's
  // choice in Phase 5. What it must do is preserve enough for the emitter to make it:
  // a discriminant survives as a `literal` property, so "is there a key whose type is a
  // literal in every arm" is answerable from the IR alone.
  it('keeps the discriminant as a literal on each arm', () => {
    const node = ir('discriminated-union');
    expect(node).toEqual({
      kind: 'union',
      members: [
        {
          kind: 'object',
          name: 'Circle',
          properties: [
            { name: 'kind', optional: false, readonly: false, type: { kind: 'literal', value: 'circle' } },
            { name: 'radius', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'number' } },
          ],
        },
        {
          kind: 'object',
          name: 'Square',
          properties: [
            { name: 'kind', optional: false, readonly: false, type: { kind: 'literal', value: 'square' } },
            { name: 'side', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'number' } },
          ],
        },
      ],
    });
  });

  it('reflects an undiscriminated union in declaration order', () => {
    // Order is part of the contract: an emitter that tries the arms in sequence gives
    // the first match, so a reordering here would change which arm wins.
    const node = ir('undiscriminated-union');
    expect(node.kind).toBe('union');
    if (node.kind !== 'union') return;
    expect(node.members.map(m => (m.kind === 'object' ? m.name : m.kind))).toEqual(['HasEmail', 'HasPhone']);
  });
});

describe('irFromType — intersections and type operators', () => {
  it('merges the properties of an object intersection', () => {
    expect(ir('object-intersection')).toEqual({
      kind: 'object',
      properties: [
        { name: 'street', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'string' } },
        {
          name: 'zip',
          optional: false,
          readonly: false,
          type: { kind: 'scalar', scalar: 'string', constraints: { maxLength: 10 } },
        },
        { name: 'country', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'string' } },
      ],
    });
  });

  it('sees through Omit, Pick, Partial, Required, mapped and conditional types', () => {
    // These need no special handling at all, which is the point: the checker resolves
    // them before we look, so the reflection reads structure and never syntax. A
    // property-list assertion is the honest way to say that.
    const names = (label: string): readonly (readonly [string, boolean])[] => {
      const node = ir(label);
      expect(node.kind, label).toBe('object');
      return node.kind === 'object' ? node.properties.map(p => [p.name, p.optional] as const) : [];
    };
    expect(names('omit')).toEqual([['address', false]]);
    expect(names('pick')).toEqual([['street', false]]);
    expect(names('partial')).toEqual([
      ['street', true],
      ['zip', true],
    ]);
    expect(names('required')).toEqual([
      ['address', false],
      ['nickname', false],
    ]);
    expect(names('mapped')).toEqual([
      ['a', false],
      ['b', false],
    ]);
    expect(ir('conditional')).toEqual({ kind: 'scalar', scalar: 'number' });
  });

  it('keeps `Length<10>` from inside a Pick', () => {
    // The tag lives on the property type, not on the interface, so a type operator that
    // rebuilds the object must not lose it.
    expect(ir('pick')).toEqual({
      kind: 'object',
      name: 'Pick',
      properties: [{ name: 'street', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'string' } }],
    });
    const partial = ir('partial');
    expect(partial.kind === 'object' && partial.properties[1]?.type).toEqual({
      kind: 'scalar',
      scalar: 'string',
      constraints: { maxLength: 10 },
    });
  });
});

describe('irFromType — brands and template literals', () => {
  it('strips a brand and reflects the base type', () => {
    // A brand is a phantom `unique symbol` slot with a name the reflection does not
    // know, and it erases at runtime, so the base type is exactly what is checkable.
    // Refusing it — which is what happened while only *our* tag names were treated as
    // phantom — would have made every branded column a build error.
    expect(ir('brand')).toEqual({ kind: 'scalar', scalar: 'number' });
    expect(probes.get('brand')?.diagnostics).toEqual([]);
  });

  it('derives a pattern from a template literal type', () => {
    expect(ir('template-literal')).toEqual({
      kind: 'scalar',
      scalar: 'string',
      constraints: { pattern: String.raw`^[\s\S]*@[\s\S]*$` },
    });
  });

  it('derives one pattern per arm when a placeholder is a union', () => {
    // The checker normalises `` `v${1 | 2}.${string}` `` into two template literal types
    // before the reflection sees it, so there is no alternation branch to write.
    expect(ir('template-literal-union')).toEqual({
      kind: 'union',
      members: [
        { kind: 'scalar', scalar: 'string', constraints: { pattern: String.raw`^v1\.[\s\S]*$` } },
        { kind: 'scalar', scalar: 'string', constraints: { pattern: String.raw`^v2\.[\s\S]*$` } },
      ],
    });
  });

  it('refuses `${number}` rather than guessing a numeric grammar', () => {
    // TypeScript accepts exponents, signs and `Infinity` there. A short regex is either
    // stricter than the type — rejecting values it accepts — or looser. Both are wrong,
    // so the author is asked for the grammar they mean.
    expect(reasonFor('template-literal-number')).toContain('`number`');
    expect(reasonFor('template-literal-number')).toContain('Pattern');
  });

  it('refuses a string-mapping type, which has no pattern at all', () => {
    expect(reasonFor('string-mapping')).toContain('string-mapping');
  });

  it('does not blame a template literal type on an index signature', () => {
    // `string` carries a numeric index signature, so before `#template` existed a
    // template literal type fell through to the object branch and collected the
    // `Record<string, T>` refusal — a message about neither the type nor the problem.
    expect(reasonFor('template-literal-number')).not.toContain('index signature');
  });
});

describe('irFromType — refusals are named', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['unknown', 'no shape'],
    ['any', 'disables the check'],
    ['never', 'no values'],
    ['bare-object', 'no properties to check'],
    ['symbol', 'JSON boundary'],
    ['record', 'index signature'],
    ['index-signature', 'index signature'],
    ['function', 'function cannot be validated'],
    ['class', 'is a class'],
    ['type-parameter', 'generic type parameter'],
  ];

  for (const [label, fragment] of cases) {
    it(`refuses ${label} with a reason mentioning "${fragment}"`, () => {
      expect(reasonFor(label)).toContain(fragment);
    });
  }

  it('refuses Map, Set, Promise and a typed array', () => {
    for (const label of ['map', 'set', 'promise', 'typed-array']) {
      const node = ir(label);
      // Each is refused, but not all for the same reason: a typed array has an index
      // signature, the others have methods. Asserting only that each IS refused keeps
      // the test from pinning an implementation detail of the standard library.
      expect(node.kind, `${label} should be refused`).toBe('unsupported');
    }
  });

  it('records a diagnostic for every refusal, not just an IR node', () => {
    // The emitter turns a diagnostic into a build error (plan D4). An `unsupported`
    // node with no diagnostic beside it would be a refusal nobody hears.
    for (const label of ['unknown', 'any', 'record', 'class']) {
      expect(probes.get(label)?.diagnostics.length, label).toBeGreaterThan(0);
    }
  });

  it('reflects everything else without a diagnostic', () => {
    const clean = [
      'string',
      'literal-union',
      'tagged-bounds',
      'tagged-varchar',
      'protobuf-tags',
      'nested-object',
      'recursive',
      'tuple',
      'array-of-tagged',
    ];
    for (const label of clean) {
      expect(probes.get(label)?.diagnostics, label).toEqual([]);
    }
  });
});

describe('irFromType — Rule<Name>', () => {
  it('reads one rule and a union of rules', () => {
    // A second `Rule<>` in the same intersection reuses the symbol slot and intersects
    // the arguments to `never`, so a union is the spelling for more than one.
    expect(ir('rule')).toEqual({ kind: 'scalar', scalar: 'string' });
    expect(ir('rule-union')).toEqual({ kind: 'scalar', scalar: 'string' });
  });
});

describe('irFromType — budgets', () => {
  it('degrades to a named refusal at the depth cap instead of hanging', () => {
    const constructs = session.sourceFile(`${FIXTURES}constructs.ts`);
    const call = findCallSites(constructs as never, new Set(['probe'])).find(c => labelOf(c) === 'nested-object');
    const type = session.checker.getTypeFromTypeNode((call as never as { typeArgument: never }).typeArgument);
    const reflector = new Reflector(session.checker, constructs as never, { limits: { maxDepth: 0 } });
    const node = reflector.typeIR(type as never);
    expect(JSON.stringify(node)).toContain('nesting deeper than 0 levels');
    expect(reflector.diagnostics.length).toBeGreaterThan(0);
  });

  it('degrades to a named refusal at the node cap', () => {
    const constructs = session.sourceFile(`${FIXTURES}constructs.ts`);
    const call = findCallSites(constructs as never, new Set(['probe'])).find(c => labelOf(c) === 'nested-object');
    const type = session.checker.getTypeFromTypeNode((call as never as { typeArgument: never }).typeArgument);
    const reflector = new Reflector(session.checker, constructs as never, { limits: { maxNodes: 2 } });
    expect(JSON.stringify(reflector.typeIR(type as never))).toContain('more than 2 IR nodes');
  });
});

describe('irFromType and schemaIrFromType', () => {
  /** The type argument of a `probe<T>` / `pair<T>` call, with the node it was written at. */
  function at(file: string, helper: string, label: string) {
    const source = session.sourceFile(`${FIXTURES}${file}`);
    const call = findCallSites(source as never, new Set([helper])).find(c => labelOf(c) === label);
    expect(call, `no ${helper} labelled ${label}`).toBeDefined();
    const type = session.checker.getTypeFromTypeNode((call as never as { typeArgument: never }).typeArgument);
    return { type: type as never, location: source as never };
  }

  it('are the one-shot form of a reflector, diagnostics included', () => {
    // Two entry points into the same walk, and the free one is what `transformFile` and the
    // CLI reach for. If it forgot to hand the diagnostics back, a refusal would become a
    // silent gap — which is the failure mode `unsupported` nodes exist to prevent.
    const { type, location } = at('constructs.ts', 'probe', 'nested-object');
    const reflector = new Reflector(session.checker, location, {});
    const expected = { ir: reflector.typeIR(type), diagnostics: reflector.diagnostics };
    expect(irFromType(session.checker, type, location)).toEqual(expected);

    const table = at('tables.ts', 'pair', 'users');
    const viaFunction = schemaIrFromType(session.checker, table.type, table.location);
    expect(viaFunction.diagnostics).toEqual([]);
    expect(viaFunction.ir).toEqual(tagged.get('users')?.ir);
  });

  it('read the same declaration two ways, because two back-ends ask different questions', () => {
    // `irFromType` answers "what does a value of this look like" and `schemaIrFromType`
    // answers "which table is this". Same type, and neither answer is derivable from the
    // other: the structural walk has no table name, and the schema has no nesting.
    const { type, location } = at('tables.ts', 'pair', 'users');
    const structural = irFromType(session.checker, type, location).ir;
    expect(structural.kind).toBe('object');
    expect(schemaIrFromType(session.checker, type, location).ir.table).toBe('users');
  });

  it('default to DEFAULT_LIMITS, and take a partial override of it', () => {
    // The point of the default being a named export is that a caller can raise one cap
    // without restating the other two, and that the numbers are readable rather than folded
    // into a constructor. Both are only true if the merge is a merge.
    expect(DEFAULT_LIMITS).toEqual({ maxDepth: 32, maxNodes: 20_000, maxHelpers: 512 });

    const { type, location } = at('constructs.ts', 'probe', 'nested-object');
    const plain = irFromType(session.checker, type, location);
    expect(plain.ir.kind).toBe('object');
    expect(irFromType(session.checker, type, location, { limits: DEFAULT_LIMITS })).toEqual(plain);

    // One cap named, and it is the one that fires — the other two keep their defaults rather
    // than becoming `undefined` and refusing everything at `> undefined`. Each override is
    // checked both ways round: the cap it names is reported, and the two it does not are not.
    const depthCapped = JSON.stringify(irFromType(session.checker, type, location, { limits: { maxDepth: 1 } }).ir);
    expect(depthCapped).toContain('nesting deeper than 1 levels');
    expect(depthCapped).not.toContain('IR nodes');
    const nodeCapped = JSON.stringify(irFromType(session.checker, type, location, { limits: { maxNodes: 1 } }).ir);
    expect(nodeCapped).toContain('more than 1 IR nodes in one file');
    expect(nodeCapped).not.toContain('nesting deeper');
  });
});

describe('build-time naming strategy (frozen: reflect/SPEC.md 7a)', () => {
  interface FrozenNamingStrategy {
    readonly column?: (property: string, context: { readonly table: string }) => string;
    readonly table?: (declared: string) => string;
    readonly index?: (table: string, columns: readonly string[], unique: boolean) => string;
  }

  type FrozenReflectOptions = ReflectOptions & { readonly naming?: FrozenNamingStrategy };
  type FrozenColumnIR = ColumnIR & { readonly physicalName: string };
  type FrozenSchemaIR = Omit<SchemaIR, 'columns'> & {
    readonly physicalTable: string;
    readonly columns: readonly FrozenColumnIR[];
  };

  function reflectNamingCase(label: string, options: FrozenReflectOptions = {}) {
    const source = session.sourceFile(`${FIXTURES}naming-strategy.ts`);
    const call = findCallSites(source as never, new Set(['namingCase'])).find(c => labelOf(c) === label);
    expect(call, `no namingCase labelled ${label}`).toBeDefined();
    const type = session.checker.getTypeFromTypeNode((call as never as { typeArgument: never }).typeArgument);

    // boundary: #417 freezes the `naming` option before `ReflectOptions` ships it.
    // The assertion is confined to the one real exported call; the result widening
    // below only exposes the two required IR fields the same frozen spec names.
    const result = schemaIrFromType(session.checker, type as never, source as never, options as ReflectOptions);
    return { ...result, ir: result.ir as FrozenSchemaIR };
  }

  // actual today: `naming` is ignored, the callback is never called, and the IR
  // contains neither `physicalTable` nor `physicalName`.
  it.fails('applies the column strategy once, into the IR', () => {
    const calls: string[] = [];
    const result = reflectNamingCase('camel-case', {
      naming: {
        column(property, context) {
          calls.push(`${context.table}.${property}`);
          return property === 'createdAt' ? 'created_at' : property;
        },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ir.physicalTable).toBe('userAccount');
    expect(result.ir.columns.map(column => [column.name, column.physicalName])).toEqual([
      ['id', 'id'],
      ['createdAt', 'created_at'],
    ]);
    expect(calls).toEqual(['userAccount.id', 'userAccount.createdAt']);
  });

  // actual today: both physical fields are absent rather than carrying the
  // identity value explicitly.
  it.fails('leaves physicalName equal to name when no strategy is configured', () => {
    const result = reflectNamingCase('camel-case');
    expect(result.diagnostics).toEqual([]);
    expect(result.ir.physicalTable).toBe(result.ir.table);
    expect(result.ir.columns.map(column => column.physicalName)).toEqual(result.ir.columns.map(column => column.name));
  });

  // actual today: the local `Physical<'created_ts'>` tag is ignored and no
  // strategy callback runs, because neither surface exists in the reflector.
  it.fails('lets an explicit column name beat the strategy', () => {
    const calls: string[] = [];
    const result = reflectNamingCase('explicit-column', {
      naming: {
        column(property) {
          calls.push(property);
          return `strategy_${property}`;
        },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ir.columns.map(column => [column.name, column.physicalName])).toEqual([
      ['id', 'strategy_id'],
      ['createdAt', 'created_ts'],
    ]);
    expect(calls).toEqual(['id']);
  });

  // actual today: the two properties are accepted with zero diagnostics because
  // the strategy is never applied.
  it.fails('fails the build when two properties collide on one physical name, naming both', () => {
    const result = reflectNamingCase('collision', {
      naming: {
        column: property => (property === 'createdAt' ? 'created_at' : property),
      },
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.reason).toContain('createdAt');
    expect(result.diagnostics[0]?.reason).toContain('created_at');
    expect(result.diagnostics[0]?.reason).toContain('both map to the column');
  });
});

describe('the schema IR of the corpus, written out (REQ-TF-7, REQ-TF-12)', () => {
  // Every column is compared whole, not field by field: a field-by-field comparison passes
  // when the reflection stops setting a flag, and a flag quietly going missing is exactly how
  // the four walkers this IR replaced drifted apart in the first place.
  //
  // `column()` supplies the six booleans and the two empty collections that every column has,
  // so each row below reads as the facts that are true of it rather than as ninety words of
  // `false`. The comparison is still total — `toEqual` sees a complete `ColumnIR` either way.
  type Defaulted =
    | 'nullable'
    | 'primaryKey'
    | 'serial'
    | 'unique'
    | 'hasDefault'
    | 'sensitive'
    | 'constraints'
    | 'rules';
  function column(facts: Omit<ColumnIR, Defaulted> & Partial<Pick<ColumnIR, Defaulted>>): ColumnIR {
    return {
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: false,
      constraints: {},
      rules: [],
      ...facts,
    };
  }

  function reflected(table: string): SchemaIR {
    const found = tagged.get(table);
    expect(found, `no tagged declaration labelled ${table}`).toBeDefined();
    expect(found?.diagnostics, `${table} reflected with diagnostics`).toEqual([]);
    return (found as { ir: SchemaIR }).ir;
  }

  it('reads every column kind in one table', () => {
    expect(reflected('users')).toEqual({
      table: 'users',
      columns: [
        // `serial`, not `integer`: `Serial` names a column type of its own in the IR, because
        // that is the word two of the three dialects want in the DDL.
        column({ name: 'id', sql: 'serial', primaryKey: true, serial: true, hasDefault: true }),
        column({
          name: 'email',
          sql: 'varchar',
          unique: true,
          length: 255,
          constraints: { pattern: '^\\S+@\\S+$' },
        }),
        column({ name: 'age', sql: 'integer', constraints: { minimum: 18, maximum: 120 } }),
        column({ name: 'score', sql: 'numeric' }),
        column({ name: 'visits', sql: 'bigint' }),
        column({ name: 'bio', sql: 'text', nullable: true, constraints: { minLength: 3, maxLength: 2000 } }),
        column({ name: 'active', sql: 'boolean' }),
        column({ name: 'createdAt', sql: 'timestamp', hasDefault: true }),
        // Sorted, and declared in a third order in the fixture: see `ColumnIR.enum`.
        column({ name: 'role', sql: 'jsonEnum', enum: ['admin', 'editor', 'viewer'] }),
        column({ name: 'passwordHash', sql: 'text', sensitive: true }),
      ],
      primaryKey: ['id'],
      relations: [],
      ftsTable: 'users_fts',
    });
  });

  it('reads a composite key and a foreign key spelled table.column', () => {
    expect(reflected('memberships')).toEqual({
      table: 'memberships',
      columns: [
        column({ name: 'userId', sql: 'integer', primaryKey: true, references: 'users.id' }),
        column({ name: 'groupId', sql: 'integer', primaryKey: true, references: 'groups.id' }),
        column({ name: 'invitedBy', sql: 'integer', nullable: true, references: 'users.id' }),
      ],
      // Declaration order, not sorted: it is the order of the key in the DDL and in every
      // `WHERE` the query compiler builds, so reversing it would be a different table.
      primaryKey: ['userId', 'groupId'],
      relations: [],
    });
  });

  it('covers every table the corpus pairs', () => {
    // A `pair<T>` added to the fixture and forgotten here would be reflected, held in
    // `tagged` and never compared against anything.
    expect([...tagged.keys()].toSorted()).toEqual(['memberships', 'users']);
  });
});

describe('what only a tagged declaration can say', () => {
  /** A `taggedOnly<T>` fixture: the tables deliberately kept out of the golden above. */
  function taggedOnly(label: string): SchemaIR {
    const corpus = session.sourceFile(`${FIXTURES}tables.ts`);
    const call = findCallSites(corpus as never, new Set(['taggedOnly'])).find(c => labelOf(c) === label);
    const type = session.checker.getTypeFromTypeNode((call as never as { typeArgument: never }).typeArgument);
    const reflector = new Reflector(session.checker, corpus as never, {});
    const reflected = reflector.schemaIR(type as never);
    expect(reflector.diagnostics).toEqual([]);
    return reflected;
  }

  const invoice = (): SchemaIR => taggedOnly('invoices');

  it('carries numeric precision, which ColumnFlags has no field for', () => {
    expect(invoice().columns.find(c => c.name === 'amount')?.precision).toEqual([12, 2]);
  });

  it('carries a json payload shape, which a column map has nowhere to put', () => {
    // `ColumnMeta` describes a json column as `sql: 'json'` and stops there, which is why
    // `CoreSchema` carries its IR rather than only the projection: read the payload off the
    // column map and the answer is "an object, unspecified".
    expect(invoice().columns.find(c => c.name === 'lines')?.payload).toEqual({
      kind: 'array',
      element: {
        kind: 'object',
        name: 'Line',
        properties: [
          { name: 'sku', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'string' } },
          {
            name: 'qty',
            optional: false,
            readonly: false,
            type: { kind: 'scalar', scalar: 'integer', constraints: { minimum: 1 } },
          },
        ],
      },
    });
  });

  it('carries a codec name', () => {
    expect(invoice().columns.find(c => c.name === 'currency')?.codec).toBe('currency');
  });

  it("carries a codec's three types: the app shape, the wire form, and the stored type", () => {
    const total = invoice().columns.find(c => c.name === 'total');
    // Stored as an integer, held as a `Money`, crossing as a decimal string. Each layer
    // reads its own field, and none of them has to guess at another's.
    expect(total?.sql).toBe('integer');
    expect(total?.payload).toEqual({
      kind: 'object',
      name: 'Money',
      // `number`, not `integer`: `Sql<'integer'>` describes the *column*, and nothing
      // inside a nested app type has said which kind of number this is.
      properties: [{ name: 'cents', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'number' } }],
    });
    expect(total?.wire).toEqual({ kind: 'scalar', scalar: 'string' });
  });

  it('leaves a codec over a plain scalar to the SQL type, which already describes it', () => {
    // `currency` is a string on both sides. Recording the data part as an app type would
    // drop the tags' constraints, which `appTypeOf` reads off the column instead.
    const currency = invoice().columns.find(c => c.name === 'currency');
    expect(currency && 'payload' in currency).toBe(false);
  });

  it('records that a column has a default without being able to say what it is', () => {
    // `HasDefault` means "has one", not "has this one". A default *value* is a runtime
    // value and no type can carry it, so the DDL keeps the value and the type keeps the
    // flag. Naming the split here is the point of the test.
    const issuedAt = invoice().columns.find(c => c.name === 'issuedAt');
    expect(issuedAt?.hasDefault).toBe(true);
    expect(issuedAt && 'default' in issuedAt).toBe(false);
  });

  it('reads relations off the declaration itself', () => {
    const invoices = invoice();
    expect(invoices.relations).toEqual([{ name: 'author', relation: 'manyToOne', target: 'authors', via: 'authorId' }]);
    // A relation is not a column: the join lives on `authorId`, and emitting `author`
    // as a column too would put a nested entity in the INSERT statement.
    expect(invoices.columns.map(c => c.name)).not.toContain('author');
  });

  it('reads all four cardinalities, and the join table many-to-many carries instead of a key', () => {
    // `via` is one IR field for two different things: the foreign key for the three
    // to-one/to-many shapes, and the join table for `manyToMany`. A back-end that read the
    // wrong one would emit a join against a table called `authorId`.
    expect(taggedOnly('products').relations).toEqual([
      { name: 'labels', relation: 'manyToMany', target: 'labels', via: 'product_labels' },
      { name: 'listing', relation: 'oneToOne', target: 'listings', via: 'productId' },
    ]);
  });

  it('carries Fts<true>, the spelling that asks the back-end to name the index', () => {
    // The string form is in the golden above. `true` is the form only this asserts, and
    // `true` is falsy-adjacent enough that a `if (fts)` somewhere would drop it.
    expect(taggedOnly('products').ftsTable).toBe(true);
  });

  it('treats Serial as implying a default', () => {
    // Not a convenience. `hasDefault` is what keeps the column out of `CreateDTO`, so a
    // `Serial` that only set `serial` would produce an insert payload demanding the key the
    // database is about to generate.
    const id = invoice().columns.find(c => c.name === 'id');
    expect(id?.serial).toBe(true);
    expect(id?.hasDefault).toBe(true);
  });
});

describe('what the reflection declines to guess', () => {
  it('refuses a tagged entity with no Table<> tag rather than guessing from the type name', () => {
    // The type is `Profile`; the table could be `profiles`, `profile` or `user_profile`
    // and a pluraliser would be a fifth source of truth.
    const constructs = session.sourceFile(`${FIXTURES}constructs.ts`);
    const call = findCallSites(constructs as never, new Set(['probe'])).find(c => labelOf(c) === 'nested-object');
    const type = session.checker.getTypeFromTypeNode((call as never as { typeArgument: never }).typeArgument);
    const reflector = new Reflector(session.checker, constructs as never, {});
    reflector.schemaIR(type as never);
    expect(reflector.diagnostics.map(d => d.reason).join('\n')).toContain('Table');
  });

  it("infers the SQL type wherever TypeScript is unambiguous, and asks for Sql<> where it isn't", () => {
    // The one refused case: `integer` and `numeric` are both `number`, with no default
    // worth guessing between them. Everything else the type already says, and a tag would
    // be a second spelling of the same fact.
    const corpus = session.sourceFile(`${FIXTURES}tables.ts`);
    const call = findCallSites(corpus as never, new Set(['pair'])).find(c => labelOf(c) === 'users');
    const type = session.checker.getTypeFromTypeNode((call as never as { typeArgument: never }).typeArgument);
    const reflector = new Reflector(session.checker, corpus as never, {});
    const role = reflector.schemaIR(type as never).columns.find(c => c.name === 'role');
    expect(role?.sql).toBe('jsonEnum');
    expect(role?.enum).toEqual(['admin', 'editor', 'viewer']);
  });
});
