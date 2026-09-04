// TypeIR -> field-number-dispatched protobuf decoder JavaScript.
//
// This is build-time only. Generated helpers construct the declared object shape and
// switch directly on known field numbers. The runtime reader owns byte bounds and wire
// primitives only; no descriptor or property table reaches the application.

import type { ObjectIR, PropertyIR, ProtoScalar, ScalarIR, TypeIR } from '@zmdb/schema-core/ir';

export interface ProtoDecodeDiagnostic {
  readonly path: string;
  readonly reason: string;
  readonly source?: string;
}

export interface ProtoDecoderOptions {
  /** Unique valid-identifier prefix supplied by the file-level emitter. */
  readonly namespace: string;
  /** Local identifier bound to the emitted wire-runtime import. */
  readonly reader: string;
}

export interface ProtoDecoderResult {
  readonly entry?: string;
  readonly helpers: readonly string[];
  readonly diagnostics: readonly ProtoDecodeDiagnostic[];
}

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

interface ScalarPlan {
  readonly kind: 'scalar';
  readonly method: NumericMethod | 'bool' | 'string';
  readonly wire: 0 | 1 | 2 | 5;
  readonly zero: string;
}

interface EnumPlan {
  readonly kind: 'enum';
  readonly helper: string;
  readonly wire: 0;
}

interface MessagePlan {
  readonly kind: 'message';
  readonly helper: string;
  readonly wire: 2;
}

interface TimestampPlan {
  readonly kind: 'timestamp';
  readonly helper: string;
  readonly wire: 2;
}

type AtomPlan = ScalarPlan | EnumPlan | MessagePlan | TimestampPlan;

interface FieldPlan {
  readonly atom: AtomPlan;
  readonly repeated: boolean;
  readonly nullable: boolean;
}

interface PlannedField {
  readonly property: PropertyIR;
  readonly path: string;
  readonly plan: FieldPlan;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const THIRTY_TWO_BIT = new Set<ProtoScalar>(['int32', 'uint32', 'sint32', 'fixed32', 'sfixed32']);
const SIXTY_FOUR_BIT = new Set<ProtoScalar>(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64']);
const FLOATING = new Set<ProtoScalar>(['float', 'double']);

/** Emit all helper declarations and the root helper to call, or named diagnostics. */
export function emitProtoDecoder(
  root: TypeIR,
  preferredName: string,
  options: ProtoDecoderOptions,
): ProtoDecoderResult {
  return new DecoderEmitter(options).emit(root, preferredName);
}

class DecoderEmitter {
  readonly #options: ProtoDecoderOptions;
  readonly #diagnostics: ProtoDecodeDiagnostic[] = [];
  readonly #objects: ObjectIR[] = [];
  readonly #objectHelpers = new Map<ObjectIR, string>();
  readonly #namedObjects = new Map<string, ObjectIR>();
  readonly #auxiliary: string[] = [];
  readonly #messages: string[] = [];
  #counter = 0;
  #timestampHelper: string | undefined;

  constructor(options: ProtoDecoderOptions) {
    this.#options = options;
  }

  emit(root: TypeIR, preferredName: string): ProtoDecoderResult {
    if (root.kind !== 'object') {
      const reason =
        root.kind === 'union' && root.members.some(member => member.kind === 'object')
          ? 'a union of message types would require `oneof`, but union arms have no ProtoField<N> tag slot'
          : 'a protobuf decoder root must be an object message';
      this.#refuse(preferredName, reason);
      return { helpers: [], diagnostics: this.#diagnostics };
    }

    this.#collect(root, preferredName);
    this.#validateRequiredCycles();
    for (const message of this.#objects) this.#renderMessage(message);
    if (this.#diagnostics.length > 0) return { helpers: [], diagnostics: this.#diagnostics };

    const entry = this.#objectHelpers.get(root);
    if (entry === undefined) {
      this.#refuse(preferredName, 'the protobuf root did not receive a decoder helper');
      return { helpers: [], diagnostics: this.#diagnostics };
    }
    return { entry, helpers: [...this.#auxiliary, ...this.#messages], diagnostics: [] };
  }

  #collect(node: TypeIR, suggested: string): void {
    switch (node.kind) {
      case 'object': {
        if (this.#objectHelpers.has(node)) return;
        const helper = this.#name(`Decode${safeName(node.name ?? suggested)}`);
        this.#objectHelpers.set(node, helper);
        if (node.name !== undefined && !this.#namedObjects.has(node.name)) this.#namedObjects.set(node.name, node);
        this.#objects.push(node);
        for (const property of node.properties) {
          this.#collect(property.type, `${suggested}${safeName(property.name)}`);
        }
        return;
      }
      case 'array':
        this.#collect(node.element, suggested);
        return;
      case 'tuple':
        for (const [index, element] of node.elements.entries()) this.#collect(element, `${suggested}${index + 1}`);
        return;
      case 'union':
        for (const member of node.members) this.#collect(member, suggested);
        return;
      default:
        return;
    }
  }

  #validateRequiredCycles(): void {
    const visited = new Set<ObjectIR>();
    const active = new Set<ObjectIR>();

    const visit = (node: ObjectIR, path: readonly string[]): void => {
      if (visited.has(node)) return;
      active.add(node);
      for (const property of node.properties) {
        if (property.optional) continue;
        const target = this.#requiredMessage(property.type);
        if (target === undefined) continue;
        const next = [...path, property.name];
        if (active.has(target)) {
          this.#refuse(
            next.join('.'),
            'a cycle of required singular protobuf messages has no finite absent-field value; make one edge optional, nullable, or repeated',
          );
          continue;
        }
        visit(target, next);
      }
      active.delete(node);
      visited.add(node);
    };

    for (const object of this.#objects) visit(object, [object.name ?? 'Message']);
  }

  #requiredMessage(node: TypeIR): ObjectIR | undefined {
    switch (node.kind) {
      case 'object':
        return node;
      case 'ref':
        return this.#namedObjects.get(node.name);
      case 'union': {
        if (node.members.some(member => member.kind === 'null' || member.kind === 'undefined')) return undefined;
        const values = node.members.filter(member => member.kind !== 'null' && member.kind !== 'undefined');
        return values.length === 1 && values[0] !== undefined ? this.#requiredMessage(values[0]) : undefined;
      }
      default:
        return undefined;
    }
  }

  #renderMessage(node: ObjectIR): void {
    const helper = this.#objectHelpers.get(node);
    if (helper === undefined) {
      this.#refuse(node.name ?? 'Message', 'the protobuf message did not receive a decoder helper');
      return;
    }

    const fields: PlannedField[] = [];
    const ordered = node.properties.toSorted(
      (left, right) => (left.protoField ?? Number.MAX_SAFE_INTEGER) - (right.protoField ?? Number.MAX_SAFE_INTEGER),
    );
    for (const property of ordered) {
      const path = `${node.name ?? 'Message'}.${property.name}`;
      if (!IDENTIFIER.test(property.name)) {
        this.#refuse(path, `\`${property.name}\` is not a valid protobuf field identifier`);
        continue;
      }
      if (property.protoField === undefined) {
        this.#refuse(path, `protobuf property \`${property.name}\` has no ProtoField<N> field number`);
        continue;
      }
      const plan = this.#fieldPlan(property.type, path);
      if (plan === undefined) continue;
      if (property.optional && plan.nullable) {
        this.#refuse(
          path,
          'an optional nullable protobuf field has three TypeScript states but only two wire-presence states',
        );
        continue;
      }
      fields.push({ property, path, plan });
    }
    if (this.#diagnostics.length > 0) return;

    const initial = fields
      .flatMap(field => {
        const value = this.#initial(field);
        return value === undefined ? [] : [`[${JSON.stringify(field.property.name)}]: ${value}`];
      })
      .join(', ');
    const lines = [`if (_v === undefined) _v = { ${initial} };`, 'while (!_r.done) {'];
    lines.push(
      'const _key = _r.key();',
      'const _field = Math.floor(_key / 8);',
      'const _wire = _key % 8;',
      'switch (_field) {',
    );
    for (const field of fields) lines.push(this.#case(field));
    lines.push('default: _r.skip(_wire); break;', '}', '}');

    for (const field of fields) {
      if (field.property.optional || field.plan.nullable || field.plan.repeated) continue;
      const has = `Object.hasOwn(_v, ${JSON.stringify(field.property.name)})`;
      if (field.plan.atom.kind === 'enum') {
        lines.push(`if (!${has}) ${field.plan.atom.helper}(0);`);
      } else if (field.plan.atom.kind === 'message') {
        lines.push(
          `if (!${has}) ${this.#assign('_v', field.property.name, `${field.plan.atom.helper}(new ${this.#options.reader}())`)};`,
        );
      }
    }
    lines.push('return _v;');
    this.#messages.push(`function ${helper}(_r, _v) { ${lines.join(' ')} }`);
  }

  #initial(field: PlannedField): string | undefined {
    if (field.plan.repeated) return '[]';
    if (field.plan.nullable) return 'null';
    if (field.property.optional) return undefined;
    switch (field.plan.atom.kind) {
      case 'scalar':
        return field.plan.atom.zero;
      case 'timestamp':
        return 'new Date(0)';
      case 'enum':
      case 'message':
        return undefined;
    }
  }

  #case(field: PlannedField): string {
    const number = field.property.protoField;
    if (number === undefined) return '';
    const property = access('_v', field.property.name);
    const atom = field.plan.atom;

    let body: string;
    if (field.plan.repeated && isPacked(atom)) {
      const packed = this.#name('Packed');
      const one = this.#read(atom, '_r');
      const packedOne = this.#read(atom, packed);
      body =
        `if (_wire === ${atom.wire}) { ${property}.push(${one}); } ` +
        `else if (_wire === 2) { const ${packed} = _r.message(); while (!${packed}.done) ${property}.push(${packedOne}); } ` +
        'else _r.skip(_wire);';
    } else if (field.plan.repeated) {
      body = `_wire === ${atom.wire} ? ${property}.push(${this.#read(atom, '_r')}) : _r.skip(_wire);`;
    } else {
      const current =
        atom.kind === 'message' || atom.kind === 'timestamp'
          ? `Object.hasOwn(_v, ${JSON.stringify(field.property.name)}) ? ${property} : undefined`
          : undefined;
      const value = this.#read(atom, '_r', current);
      body = `if (_wire === ${atom.wire}) { ${this.#assign('_v', field.property.name, value)}; } else _r.skip(_wire);`;
    }
    return `case ${number}: ${body} break;`;
  }

  #read(atom: AtomPlan, reader: string, current?: string): string {
    switch (atom.kind) {
      case 'scalar':
        return `${reader}.${atom.method}()`;
      case 'enum':
        return `${atom.helper}(${reader}.uint32())`;
      case 'message':
      case 'timestamp':
        return `${atom.helper}(${reader}.message()${current === undefined ? '' : `, ${current}`})`;
    }
  }

  #assign(target: string, property: string, value: string): string {
    if (property !== '__proto__') return `${access(target, property)} = ${value}`;
    return (
      `Object.defineProperty(${target}, "__proto__", ` +
      `{ value: ${value}, writable: true, enumerable: true, configurable: true })`
    );
  }

  #fieldPlan(node: TypeIR, path: string): FieldPlan | undefined {
    if (node.kind === 'array') {
      if (node.element.kind === 'array') {
        return this.#refuse(
          path,
          'a nested array would require `repeated repeated`, which proto3 cannot spell without an explicit wrapper message',
        );
      }
      const element = this.#fieldPlan(node.element, `${path}[]`);
      if (element === undefined) return undefined;
      if (element.repeated || element.nullable) {
        return this.#refuse(path, 'a repeated protobuf element cannot itself be repeated or nullable');
      }
      return { atom: element.atom, repeated: true, nullable: false };
    }

    if (node.kind === 'union') {
      const values = node.members.filter(member => member.kind !== 'null' && member.kind !== 'undefined');
      const nullable = node.members.some(member => member.kind === 'null');
      const literals = values.filter(member => member.kind === 'literal' && typeof member.value === 'string');
      if (literals.length === values.length && literals.length > 0) {
        const atom = this.#enum(
          path,
          literals.map(member => (member.kind === 'literal' && typeof member.value === 'string' ? member.value : '')),
        );
        return { atom, repeated: false, nullable };
      }

      const [only] = values;
      if (values.length === 1 && only !== undefined) {
        const resolved = this.#fieldPlan(only, path);
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

    const atom = this.#atom(node, path);
    return atom === undefined ? undefined : { atom, repeated: false, nullable: false };
  }

  #atom(node: TypeIR, path: string): AtomPlan | undefined {
    switch (node.kind) {
      case 'scalar':
        return this.#scalar(node, path);
      case 'object': {
        const helper = this.#objectHelpers.get(node);
        return helper === undefined
          ? this.#refuse(path, 'the nested protobuf message did not receive a decoder helper')
          : { kind: 'message', helper, wire: 2 };
      }
      case 'ref': {
        const target = this.#namedObjects.get(node.name);
        const helper = target === undefined ? undefined : this.#objectHelpers.get(target);
        return helper === undefined || target === undefined
          ? this.#refuse(path, `protobuf back-reference \`${node.name}\` has no message declaration`)
          : { kind: 'message', helper, wire: 2 };
      }
      case 'literal':
        return typeof node.value === 'string'
          ? this.#enum(path, [node.value])
          : this.#refuse(path, 'a numeric or boolean literal has no protobuf wire constraint');
      case 'tuple':
        return this.#refuse(path, 'a tuple has no protobuf field spelling; declare a numbered wrapper message');
      case 'unknown':
        return this.#refuse(path, '`unknown` has no protobuf wire type');
      case 'null':
      case 'undefined':
        return this.#refuse(path, 'a protobuf field cannot contain only null or undefined');
      case 'unsupported':
        return this.#refuse(path, node.reason, node.source);
      case 'array':
      case 'union':
        return this.#refuse(path, 'an internal protobuf decoder plan was not reduced to one field');
    }
  }

  #scalar(node: ScalarIR, path: string): AtomPlan | undefined {
    const proto = node.proto;
    switch (node.scalar) {
      case 'number':
      case 'integer':
        if (proto === undefined) return scalar('double', 1, '0');
        if (THIRTY_TWO_BIT.has(proto) || FLOATING.has(proto)) return numeric(proto);
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
          ? numeric(proto)
          : this.#refuse(path, `a bigint protobuf field needs an explicit 64-bit scalar, not Proto<'${proto}'>`);
      case 'boolean':
        if (proto === undefined || proto === 'bool') return scalar('bool', 0, 'false');
        return this.#refuse(path, `a boolean protobuf field cannot use Proto<'${proto}'>`);
      case 'string':
        if (proto === undefined || proto === 'string') return scalar('string', 2, '""');
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
        return { kind: 'timestamp', helper: this.#timestamp(), wire: 2 };
    }
  }

  #enum(path: string, values: readonly string[]): EnumPlan {
    const helper = this.#name('Enum');
    const cases = values.map((value, index) => `case ${index + 1}: return ${JSON.stringify(value)};`);
    const message = `unknown protobuf enum number for ${path}`;
    this.#auxiliary.push(
      `function ${helper}(_v) { switch (_v) { ${cases.join(' ')} default: throw new RangeError(${JSON.stringify(message)} + ": " + _v); } }`,
    );
    return { kind: 'enum', helper, wire: 0 };
  }

  #timestamp(): string {
    if (this.#timestampHelper !== undefined) return this.#timestampHelper;
    const helper = this.#name('Timestamp');
    this.#timestampHelper = helper;
    this.#auxiliary.push(
      `function ${helper}(_r, _current) { ` +
        'let _seconds = 0n; let _nanos = 0; ' +
        'if (_current !== undefined) { ' +
        'const _milliseconds = BigInt(_current.getTime()); ' +
        '_seconds = _milliseconds / 1000n; _nanos = Number(_milliseconds % 1000n) * 1000000; ' +
        'if (_nanos < 0) { _seconds -= 1n; _nanos += 1000000000; } } ' +
        'while (!_r.done) { const _key = _r.key(); const _field = Math.floor(_key / 8); const _wire = _key % 8; ' +
        'switch (_field) { ' +
        'case 1: if (_wire === 0) _seconds = _r.int64(); else _r.skip(_wire); break; ' +
        'case 2: if (_wire === 0) _nanos = _r.int32(); else _r.skip(_wire); break; ' +
        'default: _r.skip(_wire); break; } } ' +
        'if (_seconds < -62135596800n || _seconds > 253402300799n) ' +
        'throw new RangeError("protobuf Timestamp seconds are outside 0001-01-01 through 9999-12-31"); ' +
        'if (_nanos < 0 || _nanos > 999999999) ' +
        'throw new RangeError("protobuf Timestamp nanos must be in 0 … 999999999"); ' +
        'const _milliseconds = _seconds * 1000n + BigInt(Math.trunc(_nanos / 1000000)); ' +
        'const _number = Number(_milliseconds); const _date = new Date(_number); ' +
        'if (!Number.isSafeInteger(_number) || Number.isNaN(_date.getTime())) ' +
        'throw new RangeError("protobuf Timestamp cannot be represented by a JavaScript Date"); ' +
        'return _date; }',
    );
    return helper;
  }

  #name(hint: string): string {
    return `${this.#options.namespace}${hint}${this.#counter++}`;
  }

  #refuse(path: string, reason: string, source?: string): undefined {
    this.#diagnostics.push(source === undefined ? { path, reason } : { path, reason, source });
    return undefined;
  }
}

function numeric(method: ProtoScalar): ScalarPlan {
  switch (method) {
    case 'int32':
    case 'uint32':
    case 'sint32':
      return scalar(method, 0, '0');
    case 'int64':
    case 'uint64':
    case 'sint64':
      return scalar(method, 0, '0n');
    case 'fixed32':
    case 'sfixed32':
    case 'float':
      return scalar(method, 5, '0');
    case 'fixed64':
    case 'sfixed64':
      return scalar(method, 1, '0n');
    case 'double':
      return scalar(method, 1, '0');
    case 'bool':
    case 'string':
    case 'bytes':
      throw new Error(`non-numeric protobuf scalar ${method}`);
  }
}

function scalar(method: ScalarPlan['method'], wire: ScalarPlan['wire'], zero: string): ScalarPlan {
  return { kind: 'scalar', method, wire, zero };
}

function isPacked(atom: AtomPlan): atom is ScalarPlan | EnumPlan {
  return atom.kind === 'enum' || (atom.kind === 'scalar' && atom.method !== 'string');
}

function access(target: string, property: string): string {
  return `${target}[${JSON.stringify(property)}]`;
}

function safeName(raw: string): string {
  const words = raw.split(/[^A-Za-z0-9_$]+/).filter(word => word.length > 0);
  const joined = words.map(word => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join('');
  return joined.length === 0 ? 'Message' : joined;
}
