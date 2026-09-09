// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type ObjectIR, type ProtoScalar, type ScalarIR, type TypeIR } from '@zmdb/schema/ir';

type NumericMethod =
  | 'uint32'
  | 'int32'
  | 'sint32'
  | 'uint64'
  | 'int64'
  | 'sint64'
  | 'fixed32'
  | 'sfixed32'
  | 'fixed64'
  | 'sfixed64'
  | 'float'
  | 'double';

export type ScalarZero = 'number' | 'bigint' | 'boolean' | 'string';

export interface ScalarPlan<Zero extends string = ScalarZero> {
  readonly kind: 'scalar';
  readonly method: NumericMethod | 'bool' | 'string';
  readonly wire: 0 | 1 | 2 | 5;
  readonly zero: Zero;
}

export interface EnumPlan {
  readonly kind: 'enum';
  readonly helper: string;
  readonly wire: 0;
}

export interface MessagePlan {
  readonly kind: 'message';
  readonly helper: string;
  readonly wire: 2;
}

export interface TimestampPlan {
  readonly kind: 'timestamp';
  readonly helper: string;
  readonly wire: 2;
}

export type AtomPlan<Zero extends string = ScalarZero> = ScalarPlan<Zero> | EnumPlan | MessagePlan | TimestampPlan;

export interface FieldPlan<Atom> {
  readonly atom: Atom;
  readonly repeated: boolean;
  readonly nullable: boolean;
}

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const THIRTY_TWO_BIT = new Set<ProtoScalar>(['int32', 'uint32', 'sint32', 'fixed32', 'sfixed32']);
const SIXTY_FOUR_BIT = new Set<ProtoScalar>(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64']);
const FLOATING = new Set<ProtoScalar>(['float', 'double']);

type Refuse = (path: string, reason: string, source?: string) => undefined;

export type FieldAtomIR = Extract<TypeIR, { kind: 'scalar' | 'object' | 'ref' }>;

export function collectMessages(
  node: TypeIR,
  suggested: string,
  register: (node: ObjectIR, suggested: string) => boolean,
): void {
  switch (node.kind) {
    case 'object':
      if (!register(node, suggested)) return;
      for (const property of node.properties) {
        collectMessages(property.type, `${suggested}${safeName(property.name)}`, register);
      }
      return;
    case 'array':
      collectMessages(node.element, suggested, register);
      return;
    case 'tuple':
      for (const [index, element] of node.elements.entries()) {
        collectMessages(element, `${suggested}${index + 1}`, register);
      }
      return;
    case 'union':
      for (const member of node.members) collectMessages(member, suggested, register);
      return;
    default:
      return;
  }
}

export function planField<Atom>(
  node: TypeIR,
  path: string,
  atomPlan: (node: FieldAtomIR, path: string) => Atom | undefined,
  enumeration: (path: string, values: readonly string[]) => Atom,
  refuse: Refuse,
): FieldPlan<Atom> | undefined {
  if (node.kind === 'array') {
    if (node.element.kind === 'array') {
      return refuse(
        path,
        'a nested array would require `repeated repeated`, which proto3 cannot spell without an explicit wrapper message',
      );
    }
    const element = planField(node.element, `${path}[]`, atomPlan, enumeration, refuse);
    if (element === undefined) return undefined;
    if (element.repeated || element.nullable) {
      return refuse(path, 'a repeated protobuf element cannot itself be repeated or nullable');
    }
    return { atom: element.atom, repeated: true, nullable: false };
  }

  if (node.kind === 'union') {
    const values = node.members.filter(member => member.kind !== 'null' && member.kind !== 'undefined');
    const nullable = node.members.some(member => member.kind === 'null');
    const literals = values.filter(member => member.kind === 'literal' && typeof member.value === 'string');
    if (literals.length === values.length && literals.length > 0) {
      const atom = enumeration(
        path,
        literals.map(member => (member.kind === 'literal' && typeof member.value === 'string' ? member.value : '')),
      );
      return { atom, repeated: false, nullable };
    }

    const [only] = values;
    if (values.length === 1 && only !== undefined) {
      const resolved = planField(only, path, atomPlan, enumeration, refuse);
      return resolved === undefined ? undefined : { ...resolved, nullable: resolved.nullable || nullable };
    }
    if (values.some(member => member.kind === 'object')) {
      return refuse(
        path,
        'a union of message types would require `oneof`, but union arms have no ProtoField<N> tag slot',
      );
    }
    return refuse(path, 'this TypeScript union has no single protobuf field spelling');
  }

  switch (node.kind) {
    case 'scalar':
    case 'object':
    case 'ref': {
      const atom = atomPlan(node, path);
      return atom === undefined ? undefined : { atom, repeated: false, nullable: false };
    }
    case 'literal':
      return typeof node.value === 'string'
        ? { atom: enumeration(path, [node.value]), repeated: false, nullable: false }
        : refuse(path, 'a numeric or boolean literal has no protobuf wire constraint');
    case 'tuple':
      return refuse(path, 'a tuple has no protobuf field spelling; declare a numbered wrapper message');
    case 'unknown':
      return refuse(path, '`unknown` has no protobuf wire type');
    case 'null':
    case 'undefined':
      return refuse(path, 'a protobuf field cannot contain only null or undefined');
    case 'unsupported':
      return refuse(path, node.reason, node.source);
  }
}

export function planScalar(
  node: ScalarIR,
  path: string,
  timestamp: () => string,
  refuse: Refuse,
): ScalarPlan | TimestampPlan | undefined {
  const proto = node.proto;
  switch (node.scalar) {
    case 'number':
    case 'integer':
      if (proto === undefined) return scalar('double', 1, 'number');
      if (THIRTY_TWO_BIT.has(proto) || FLOATING.has(proto)) return numeric(proto);
      if (SIXTY_FOUR_BIT.has(proto)) {
        return refuse(
          path,
          `Proto<'${proto}'> needs bigint because a TypeScript number cannot preserve every 64-bit integer`,
        );
      }
      return refuse(path, `Proto<'${proto}'> is not a numeric protobuf scalar`);
    case 'bigint':
      if (proto === undefined) {
        return refuse(path, 'an untagged bigint has no inferable protobuf width or signedness; add Proto<K>');
      }
      return SIXTY_FOUR_BIT.has(proto)
        ? numeric(proto)
        : refuse(path, `a bigint protobuf field needs an explicit 64-bit scalar, not Proto<'${proto}'>`);
    case 'boolean':
      if (proto === undefined || proto === 'bool') return scalar('bool', 0, 'boolean');
      return refuse(path, `a boolean protobuf field cannot use Proto<'${proto}'>`);
    case 'string':
      if (proto === undefined || proto === 'string') return scalar('string', 2, 'string');
      if (proto === 'bytes') {
        return refuse(
          path,
          "Proto<'bytes'> needs Uint8Array, and the current reflection refuses typed-array data types",
        );
      }
      return refuse(path, `a string protobuf field cannot use Proto<'${proto}'>`);
    case 'date':
      if (proto !== undefined) {
        return refuse(path, `Date has the fixed google.protobuf.Timestamp mapping, not Proto<'${proto}'>`);
      }
      return { kind: 'timestamp', helper: timestamp(), wire: 2 };
  }
}

function numeric(method: ProtoScalar): ScalarPlan {
  switch (method) {
    case 'int32':
    case 'uint32':
    case 'sint32':
      return scalar(method, 0, 'number');
    case 'int64':
    case 'uint64':
    case 'sint64':
      return scalar(method, 0, 'bigint');
    case 'fixed32':
    case 'sfixed32':
    case 'float':
      return scalar(method, 5, 'number');
    case 'fixed64':
    case 'sfixed64':
      return scalar(method, 1, 'bigint');
    case 'double':
      return scalar(method, 1, 'number');
    case 'bool':
    case 'string':
    case 'bytes':
      throw new Error(`non-numeric protobuf scalar ${method}`);
  }
}

function scalar(method: ScalarPlan['method'], wire: ScalarPlan['wire'], zero: ScalarPlan['zero']): ScalarPlan {
  return { kind: 'scalar', method, wire, zero };
}

export function isPacked<Zero extends string>(atom: AtomPlan<Zero>): atom is ScalarPlan<Zero> | EnumPlan {
  return atom.kind === 'enum' || (atom.kind === 'scalar' && atom.method !== 'string');
}

export function safeName(raw: string): string {
  const words = raw.split(/[^A-Za-z0-9_$]+/).filter(word => word.length > 0);
  const joined = words.map(word => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join('');
  return joined.length === 0 ? 'Message' : joined;
}
