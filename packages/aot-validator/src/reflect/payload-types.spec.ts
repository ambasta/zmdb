// The IR's third back-end, checked against the front-end that does not use it.
//
// `objectTypeFromIR(ir, variant)` turns a schema value's IR into the `TypeIR` of one
// payload — the type the repository validates a `create` or an `update` against. That
// function could be wrong in a way no test in `@zmdb/schema-core` would notice, because
// every assertion there is written against the same understanding of the tags that wrote
// it. The reflector is the independent one: it reads `CreateDTO<User>` out of the
// *checker*, so `objectTypeFromIR(irFromSchema(users), 'create')` equalling
// `reflector.typeIR(CreateDTO<User>)` says the derived type and the derived IR describe
// the same payload — which is the whole claim of REQ-TF-13, and the reason the back-end
// is a projection of `shapeOfVariant` rather than a fifth walker.
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

import { irFromSchema, objectTypeFromIR, type TypeIR, type Variant } from '@zmdb/schema-core/ir';
import { isStringLiteral } from 'typescript/unstable/ast/is';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { memberships, users } from './__fixtures__/equivalence-schemas.ts';
import { findCallSites } from './callsites.ts';
import { Reflector } from './index.ts';
import { ReflectSession } from './session.ts';

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const PROJECT = `${FIXTURES}tsconfig.json`;
const FILE = `${FIXTURES}payloads.ts`;

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

function fromSchema(schema: { readonly table: string }, variant: Variant): TypeIR {
  return canonical(objectTypeFromIR(irFromSchema(schema as never), variant));
}

/** label → the schema value and variant that must describe the identical payload. */
const PAIRS: readonly (readonly [string, { readonly table: string }, Variant])[] = [
  ['users:entity', users, 'entity'],
  ['users:create', users, 'create'],
  ['users:update', users, 'update'],
  ['memberships:entity', memberships, 'entity'],
  ['memberships:create', memberships, 'create'],
  ['memberships:update', memberships, 'update'],
];

describe('objectTypeFromIR vs the derived type (REQ-TF-13)', () => {
  for (const [label, schema, variant] of PAIRS) {
    it(`${label} is the ${variant} payload of ${schema.table}`, () => {
      expect(fromSchema(schema, variant)).toEqual(fromType(label));
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
    expect(property(fromSchema(users, 'entity'), 'createdAt')?.type).toEqual({ kind: 'scalar', scalar: 'date' });
  });

  it('drops the serial key from create and keeps the composite one', () => {
    const names = (node: TypeIR) => (node.kind === 'object' ? node.properties.map(p => p.name) : []);
    expect(names(fromType('users:create'))).not.toContain('id');
    expect(names(fromSchema(users, 'create'))).not.toContain('id');
    expect(names(fromType('memberships:create'))).toContain('userId');
    expect(names(fromSchema(memberships, 'create'))).toContain('userId');
  });

  it('keeps a sensitive column, unlike the JSON Schema back-end', () => {
    // A `create` has to be able to carry a password. REQ-TF-6 is about what gets
    // published, and a validator publishes nothing — so this is the one back-end where
    // dropping the column would be the bug.
    const names = (node: TypeIR) => (node.kind === 'object' ? node.properties.map(p => p.name) : []);
    expect(names(fromType('users:create'))).toContain('passwordHash');
    expect(names(fromSchema(users, 'create'))).toContain('passwordHash');
  });

  it('makes every property of a patch optional and none of an entity', () => {
    const optionals = (node: TypeIR) =>
      node.kind === 'object' ? node.properties.filter(p => p.optional).map(p => p.name) : [];
    const all = (node: TypeIR) => (node.kind === 'object' ? node.properties.map(p => p.name) : []);
    expect(optionals(fromSchema(users, 'update'))).toEqual(all(fromSchema(users, 'update')));
    expect(optionals(fromType('users:update'))).toEqual(all(fromType('users:update')));
    expect(optionals(fromSchema(users, 'entity'))).toEqual([]);
    expect(optionals(fromType('users:entity'))).toEqual([]);
  });
});
