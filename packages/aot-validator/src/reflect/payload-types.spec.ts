// The IR's third back-end, checked against the derivation that does not use it.
//
// `objectTypeFromIR(ir, variant)` turns a table's IR into the `TypeIR` of one payload — the
// type the repository validates a `create` or an `update` against. That function could be
// wrong in a way no test in `@zmdb/schema-core` would notice, because every assertion there
// is written against the same understanding of the tags that wrote it. The reflector is the
// independent one: it reads `CreateDTO<User>` out of the *checker*, so
// `objectTypeFromIR(users, 'create')` equalling `reflector.typeIR(CreateDTO<User>)` says the
// mapped types in `@zmdb/schema-core/derive` and the variant projection in
// `@zmdb/schema-core/ir` describe the same payload — which is the whole claim of REQ-TF-13,
// and the reason the back-end is a projection of `shapeOfVariant` rather than a fifth walker.
//
// Two differences are canonicalised away rather than asserted, because neither is
// information:
//
//  1. **Property order.** `CreateDTO<T>` is an intersection, so the checker reports the
//     defaulted columns last whatever order they were declared in, while the IR keeps
//     declaration order. Sorted by name on both sides.
//  2. **Union member order.** `ColumnIR.enum` is sorted for the reason its doc comment
//     gives — the checker's own order is not recoverable — and `| null` lands on whichever
//     end each producer put it. Sorted structurally on both sides.
//
// The `name` of an object node goes the same way: the reflector sets it when the type had
// one so an emitter can hoist a shared helper, and a shape assembled from columns has no
// type name to give. It changes what the emitted code looks like, not what it accepts.

import { objectTypeFromIR, type SchemaIR, type TypeIR, type Variant } from '@zmdb/schema-core/ir';
import { isStringLiteral } from 'typescript/unstable/ast/is';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { schemaIrsFrom } from '../testing/index.js';
import { findCallSites } from './callsites.js';
import { Reflector } from './index.js';
import { ReflectSession } from './session.js';

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const PROJECT = `${FIXTURES}tsconfig.json`;
const FILE = `${FIXTURES}payloads.ts`;

// The IRs of the same interfaces the fixture derives its DTOs from. `schemaIrsFrom` rather
// than `schemasFrom` because the schema value is a conversion further on and nothing here
// reads it — the IR is what `objectTypeFromIR` takes.
const { Membership: membershipsIR, User: usersIR } = schemaIrsFrom(`${FIXTURES}tables.ts`, ['User', 'Membership'], {
  project: PROJECT,
});

let session: ReflectSession;
/** label → the `TypeIR` the reflector made of the derived type. */
const reflected = new Map<string, TypeIR>();

beforeAll(() => {
  session = ReflectSession.open({ project: PROJECT });

  const diagnostics = session.diagnostics(FILE);
  if (diagnostics.length > 0) {
    throw new Error(`payloads.ts has ${diagnostics.length} semantic diagnostic(s): ${JSON.stringify(diagnostics[0])}`);
  }

  const source = session.sourceFile(FILE);
  if (!source) throw new Error('payloads.ts is not in the program');
  for (const call of findCallSites(source, new Set(['payload']))) {
    const [first] = call.node.arguments;
    const label = first && isStringLiteral(first) ? first.text : undefined;
    const type = session.checker.getTypeFromTypeNode(call.typeArgument);
    if (label === undefined || !type) continue;
    const reflector = new Reflector(session.checker, source, {});
    const ir = reflector.typeIR(type);
    if (reflector.diagnostics.length > 0) {
      throw new Error(`the reflector refused ${label}: ${JSON.stringify(reflector.diagnostics)}`);
    }
    reflected.set(label, ir);
  }
});

afterAll(() => session?.close());

/** Sort properties by name and union members structurally; drop object names. See above. */
function canonical(node: TypeIR): TypeIR {
  switch (node.kind) {
    case 'object':
      return {
        kind: 'object',
        properties: node.properties
          .map(property => ({ ...property, type: canonical(property.type) }))
          .toSorted((a, b) => a.name.localeCompare(b.name)),
      };
    case 'union':
      return {
        kind: 'union',
        members: node.members.map(canonical).toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      };
    case 'array':
      return { ...node, element: canonical(node.element) };
    case 'tuple':
      return { ...node, elements: node.elements.map(canonical) };
    default:
      return node;
  }
}

function fromType(label: string): TypeIR {
  const node = reflected.get(label);
  expect(node, `no payload labelled ${label}`).toBeDefined();
  return canonical(node as TypeIR);
}

function fromIR(ir: SchemaIR, variant: Variant): TypeIR {
  return canonical(objectTypeFromIR(ir, variant));
}

/** label → the table's IR and the variant that must describe the identical payload. */
const PAIRS: readonly (readonly [string, SchemaIR, Variant])[] = [
  ['users:entity', usersIR, 'entity'],
  ['users:create', usersIR, 'create'],
  ['users:update', usersIR, 'update'],
  ['memberships:entity', membershipsIR, 'entity'],
  ['memberships:create', membershipsIR, 'create'],
  ['memberships:update', membershipsIR, 'update'],
];

describe('objectTypeFromIR vs the derived type (REQ-TF-13)', () => {
  for (const [label, ir, variant] of PAIRS) {
    it(`${label} is the ${variant} payload of ${ir.table}`, () => {
      expect(fromIR(ir, variant)).toEqual(fromType(label));
    });
  }

  it('covers every payload the fixture declares', () => {
    expect([...reflected.keys()].toSorted()).toEqual(PAIRS.map(([label]) => label).toSorted());
  });
});

describe('what the two agree about, spelled out', () => {
  // The equality above is the gate; these say what it is worth. Each is a difference
  // between the four original walkers, now on both sides of one assertion.

  it('a timestamp is a Date, on both sides, at the app layer', () => {
    const property = (node: TypeIR, name: string) =>
      node.kind === 'object' ? node.properties.find(p => p.name === name) : undefined;
    expect(property(fromType('users:entity'), 'createdAt')?.type).toEqual({ kind: 'scalar', scalar: 'date' });
    expect(property(fromIR(usersIR, 'entity'), 'createdAt')?.type).toEqual({ kind: 'scalar', scalar: 'date' });
  });

  it('drops the serial key from create and keeps the composite one', () => {
    const names = (node: TypeIR) => (node.kind === 'object' ? node.properties.map(p => p.name) : []);
    expect(names(fromType('users:create'))).not.toContain('id');
    expect(names(fromIR(usersIR, 'create'))).not.toContain('id');
    expect(names(fromType('memberships:create'))).toContain('userId');
    expect(names(fromIR(membershipsIR, 'create'))).toContain('userId');
  });

  it('keeps a sensitive column, unlike the JSON Schema back-end', () => {
    // A `create` has to be able to carry a password. REQ-TF-6 is about what gets
    // published, and a validator publishes nothing — so this is the one back-end where
    // dropping the column would be the bug.
    const names = (node: TypeIR) => (node.kind === 'object' ? node.properties.map(p => p.name) : []);
    expect(names(fromType('users:create'))).toContain('passwordHash');
    expect(names(fromIR(usersIR, 'create'))).toContain('passwordHash');
  });

  it('makes every property of a patch optional and none of an entity', () => {
    const optionals = (node: TypeIR) =>
      node.kind === 'object' ? node.properties.filter(p => p.optional).map(p => p.name) : [];
    const all = (node: TypeIR) => (node.kind === 'object' ? node.properties.map(p => p.name) : []);
    expect(optionals(fromIR(usersIR, 'update'))).toEqual(all(fromIR(usersIR, 'update')));
    expect(optionals(fromType('users:update'))).toEqual(all(fromType('users:update')));
    expect(optionals(fromIR(usersIR, 'entity'))).toEqual([]);
    expect(optionals(fromType('users:entity'))).toEqual([]);
  });
});
