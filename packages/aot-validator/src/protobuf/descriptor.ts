// TypeIR -> proto3 descriptor text.
//
// This is build-time only: the transformer calls it while replacing
// `protoDescriptor<T>()`, and the emitted application receives one string literal.
// No descriptor, parser or field table is walked at runtime.

import type { ObjectIR, PropertyIR, ProtoScalar, ScalarIR, TypeIR } from '@zmdb/schema-core/ir';

export interface ProtoDescriptorDiagnostic {
  readonly path: string;
  readonly reason: string;
  readonly source?: string;
}

export interface ProtoDescriptorResult {
  readonly source?: string;
  readonly diagnostics: readonly ProtoDescriptorDiagnostic[];
}

interface FieldType {
  readonly type: string;
  readonly repeated: boolean;
  readonly nullable: boolean;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const THIRTY_TWO_BIT = new Set<ProtoScalar>(['int32', 'uint32', 'sint32', 'fixed32', 'sfixed32']);
const SIXTY_FOUR_BIT = new Set<ProtoScalar>(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64']);
const FLOATING = new Set<ProtoScalar>(['float', 'double']);

/** Emit a complete proto3 file, or named diagnostics when the IR has no honest spelling. */
export function emitProtoDescriptor(root: TypeIR, preferredName?: string): ProtoDescriptorResult {
  return new DescriptorEmitter().emit(root, preferredName);
}

class DescriptorEmitter {
  readonly #diagnostics: ProtoDescriptorDiagnostic[] = [];
  readonly #definitions: string[] = [];
  readonly #objectNames = new Map<ObjectIR, string>();
  readonly #rawObjectNames = new Map<string, string>();
  readonly #usedNames = new Set<string>();
  readonly #renderedMessages = new Set<string>();
  readonly #renderingMessages = new Set<string>();
  readonly #renderedEnums = new Map<string, string>();
  #needsTimestamp = false;

  emit(root: TypeIR, preferredName?: string): ProtoDescriptorResult {
    if (root.kind !== 'object') {
      const name = preferredName ?? rootName(root);
      const reason =
        root.kind === 'union' && root.members.some(member => member.kind === 'object')
          ? 'a union of message types would require `oneof`, but union arms have no ProtoField<N> tag slot'
          : 'a protobuf descriptor root must be an object message';
      this.#refuse(name, reason);
      return { diagnostics: this.#diagnostics };
    }

    const rootMessage = preferredName ?? root.name ?? 'Message';
    this.#collectObjectNames(root, rootMessage);
    this.#renderMessage(root, rootMessage);
    if (this.#diagnostics.length > 0) return { diagnostics: this.#diagnostics };

    const lines = ['syntax = "proto3";'];
    if (this.#needsTimestamp) lines.push('', 'import "google/protobuf/timestamp.proto";');
    if (this.#definitions.length > 0) lines.push('', this.#definitions.join('\n\n'));
    lines.push('');
    return { source: lines.join('\n'), diagnostics: [] };
  }

  #collectObjectNames(node: TypeIR, suggested: string): void {
    switch (node.kind) {
      case 'object': {
        const raw = node.name;
        const existing = raw === undefined ? undefined : this.#rawObjectNames.get(raw);
        const name = existing ?? this.#reserveName(raw ?? suggested);
        this.#objectNames.set(node, name);
        if (raw !== undefined && existing === undefined) this.#rawObjectNames.set(raw, name);
        for (const property of node.properties) {
          this.#collectObjectNames(property.type, `${name}_${pascal(property.name)}`);
        }
        return;
      }
      case 'array':
        this.#collectObjectNames(node.element, suggested);
        return;
      case 'tuple':
        for (const [index, element] of node.elements.entries()) {
          this.#collectObjectNames(element, `${suggested}_${index + 1}`);
        }
        return;
      case 'union':
        for (const member of node.members) this.#collectObjectNames(member, suggested);
        return;
      default:
        return;
    }
  }

  #renderMessage(node: ObjectIR, path: string): string | undefined {
    const name = this.#objectNames.get(node);
    if (name === undefined) return this.#refuse(path, 'the protobuf message did not receive a deterministic name');
    if (this.#renderedMessages.has(name) || this.#renderingMessages.has(name)) return name;

    this.#renderingMessages.add(name);
    const fields: string[] = [];
    const ordered = node.properties.toSorted(
      (left, right) => (left.protoField ?? Number.MAX_SAFE_INTEGER) - (right.protoField ?? Number.MAX_SAFE_INTEGER),
    );
    for (const property of ordered) {
      const field = this.#field(name, property, `${path}.${property.name}`);
      if (field !== undefined) fields.push(field);
    }
    this.#renderingMessages.delete(name);
    if (this.#diagnostics.length > 0) return undefined;

    const body = fields.map(field => `  ${field}`).join('\n');
    this.#definitions.push(`message ${name} {\n${body}\n}`);
    this.#renderedMessages.add(name);
    return name;
  }

  #field(owner: string, property: PropertyIR, path: string): string | undefined {
    if (!IDENTIFIER.test(property.name)) {
      return this.#refuse(path, `\`${property.name}\` is not a valid protobuf field identifier`);
    }
    if (property.protoField === undefined) {
      return this.#refuse(path, `protobuf property \`${property.name}\` has no ProtoField<N> field number`);
    }

    const fieldType = this.#fieldType(property.type, owner, property.name, path);
    if (fieldType === undefined) return undefined;
    if (property.optional && fieldType.nullable) {
      return this.#refuse(
        path,
        'an optional nullable protobuf field has three TypeScript states but only two wire-presence states',
      );
    }

    const qualifier = fieldType.repeated ? 'repeated ' : property.optional || fieldType.nullable ? 'optional ' : '';
    return `${qualifier}${fieldType.type} ${property.name} = ${property.protoField};`;
  }

  #fieldType(node: TypeIR, owner: string, field: string, path: string): FieldType | undefined {
    switch (node.kind) {
      case 'scalar': {
        const type = this.#scalar(node, path);
        return type === undefined ? undefined : { type, repeated: false, nullable: false };
      }
      case 'array': {
        if (node.element.kind === 'array') {
          return this.#refuse(
            path,
            'a nested array would require `repeated repeated`, which proto3 cannot spell without an explicit wrapper message',
          );
        }
        const element = this.#fieldType(node.element, owner, field, `${path}[]`);
        if (element === undefined) return undefined;
        if (element.repeated || element.nullable) {
          return this.#refuse(path, 'a repeated protobuf element cannot itself be repeated or nullable');
        }
        return { type: element.type, repeated: true, nullable: false };
      }
      case 'object': {
        const type = this.#renderMessage(node, path);
        return type === undefined ? undefined : { type, repeated: false, nullable: false };
      }
      case 'ref': {
        const type = this.#rawObjectNames.get(node.name);
        return type === undefined
          ? this.#refuse(path, `protobuf back-reference \`${node.name}\` has no message declaration`)
          : { type, repeated: false, nullable: false };
      }
      case 'union':
        return this.#union(node.members, owner, field, path);
      case 'literal':
        if (typeof node.value === 'string') {
          return {
            type: this.#enum(owner, field, [node.value]),
            repeated: false,
            nullable: false,
          };
        }
        return this.#refuse(path, 'a numeric or boolean literal has no protobuf descriptor constraint');
      case 'tuple':
        return this.#refuse(path, 'a tuple has no protobuf field spelling; declare a numbered wrapper message');
      case 'unknown':
        return this.#refuse(path, '`unknown` has no protobuf wire type');
      case 'null':
      case 'undefined':
        return this.#refuse(path, 'a protobuf field cannot contain only null or undefined');
      case 'unsupported':
        return this.#refuse(path, node.reason, node.source);
    }
  }

  #union(members: readonly TypeIR[], owner: string, field: string, path: string): FieldType | undefined {
    const values = members.filter(member => member.kind !== 'null' && member.kind !== 'undefined');
    const nullable = members.some(member => member.kind === 'null');
    const literals = values.filter(member => member.kind === 'literal' && typeof member.value === 'string');
    if (literals.length === values.length && literals.length > 0) {
      return {
        type: this.#enum(
          owner,
          field,
          literals.map(member => (member.kind === 'literal' && typeof member.value === 'string' ? member.value : '')),
        ),
        repeated: false,
        nullable,
      };
    }

    const [only] = values;
    if (values.length === 1 && only !== undefined) {
      const resolved = this.#fieldType(only, owner, field, path);
      return resolved === undefined ? undefined : { ...resolved, nullable: resolved.nullable || nullable };
    }

    if (values.some(member => member.kind === 'object')) {
      return this.#refuse(
        path,
        'a union of message types would require `oneof`, but union arms have no ProtoField<N> tag slot',
      );
    }
    return this.#refuse(path, 'this TypeScript union has no single protobuf field spelling');
  }

  #scalar(node: ScalarIR, path: string): string | undefined {
    const proto = node.proto;
    switch (node.scalar) {
      case 'number':
      case 'integer':
        if (proto === undefined) return 'double';
        if (THIRTY_TWO_BIT.has(proto) || FLOATING.has(proto)) return proto;
        if (SIXTY_FOUR_BIT.has(proto)) {
          return this.#refuse(
            path,
            `Proto<'${proto}'> needs bigint because a TypeScript number cannot preserve every 64-bit integer`,
          );
        }
        return this.#refuse(path, `Proto<'${proto}'> is not a numeric protobuf scalar`);
      case 'bigint':
        if (proto === undefined) {
          return this.#refuse(path, 'an untagged bigint has no inferable protobuf width or signedness; add Proto<K>');
        }
        return SIXTY_FOUR_BIT.has(proto)
          ? proto
          : this.#refuse(path, `a bigint protobuf field needs an explicit 64-bit scalar, not Proto<'${proto}'>`);
      case 'boolean':
        if (proto === undefined || proto === 'bool') return 'bool';
        return this.#refuse(path, `a boolean protobuf field cannot use Proto<'${proto}'>`);
      case 'string':
        if (proto === undefined || proto === 'string') return 'string';
        if (proto === 'bytes') {
          return this.#refuse(
            path,
            "Proto<'bytes'> needs Uint8Array, and the current reflection refuses typed-array data types",
          );
        }
        return this.#refuse(path, `a string protobuf field cannot use Proto<'${proto}'>`);
      case 'date':
        if (proto !== undefined) {
          return this.#refuse(path, `Date has the fixed google.protobuf.Timestamp mapping, not Proto<'${proto}'>`);
        }
        this.#needsTimestamp = true;
        return 'google.protobuf.Timestamp';
    }
  }

  #enum(owner: string, field: string, values: readonly string[]): string {
    const fingerprint = `${owner}:${field}:${JSON.stringify(values)}`;
    const cached = this.#renderedEnums.get(fingerprint);
    if (cached !== undefined) return cached;

    const name = this.#reserveName(`${owner}_${pascal(field)}`);
    const prefix = screaming(name);
    const unspecified = `${prefix}_UNSPECIFIED`;
    const used = new Set<string>([unspecified]);
    const members = [`  ${unspecified} = 0;`];
    for (const [index, value] of values.entries()) {
      const base = `${prefix}_${screaming(value)}`;
      let member = base;
      let suffix = 2;
      while (used.has(member)) member = `${base}_${suffix++}`;
      used.add(member);
      members.push(`  ${member} = ${index + 1};`);
    }
    this.#definitions.push(`enum ${name} {\n${members.join('\n')}\n}`);
    this.#renderedEnums.set(fingerprint, name);
    return name;
  }

  #reserveName(raw: string): string {
    const base = protoName(raw);
    let candidate = base;
    let suffix = 2;
    while (this.#usedNames.has(candidate)) candidate = `${base}_${suffix++}`;
    this.#usedNames.add(candidate);
    return candidate;
  }

  #refuse(path: string, reason: string, source?: string): undefined {
    this.#diagnostics.push(source === undefined ? { path, reason } : { path, reason, source });
    return undefined;
  }
}

function rootName(node: TypeIR): string {
  if (node.kind === 'object' && node.name !== undefined) return node.name;
  if (node.kind === 'union') {
    for (const member of node.members) {
      if (member.kind === 'object' && member.name !== undefined) return member.name;
    }
  }
  return 'message';
}

function protoName(raw: string): string {
  const cleaned = raw.replaceAll(/[^A-Za-z0-9_]/g, '_');
  const nonEmpty = cleaned.length === 0 ? 'Message' : cleaned;
  return /^[A-Za-z_]/.test(nonEmpty) ? nonEmpty : `Message_${nonEmpty}`;
}

function pascal(raw: string): string {
  const words = raw.split(/[^A-Za-z0-9]+/).filter(word => word.length > 0);
  if (words.length === 0) return 'Field';
  return words.map(word => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join('');
}

function screaming(raw: string): string {
  const separated = raw.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2').replaceAll(/[^A-Za-z0-9]+/g, '_');
  const upper = separated.replaceAll(/^_+|_+$/g, '').toUpperCase();
  return upper.length === 0 ? 'VALUE' : upper;
}
