// TypeIR -> straight-line protobuf encoder JavaScript.
//
// This is build-time only. The generated functions access named properties directly
// and call the small wire runtime; no descriptor, field table or property-name loop
// reaches the application.

import type { ObjectIR, PropertyIR, ProtoScalar, ScalarIR, TypeIR } from '@zmdb/schema-core/ir';

export interface ProtoEncodeDiagnostic {
  readonly path: string;
  readonly reason: string;
  readonly source?: string;
}

export interface ProtoEncoderOptions {
  /** Unique valid-identifier prefix supplied by the file-level emitter. */
  readonly namespace: string;
  /** Local identifier bound to the emitted wire-runtime import. */
  readonly writer: string;
}

export interface ProtoEncoderResult {
  readonly entry?: string;
  readonly helpers: readonly string[];
  readonly diagnostics: readonly ProtoEncodeDiagnostic[];
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
  readonly zero: 'number' | 'bigint' | 'boolean' | 'string';
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

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const THIRTY_TWO_BIT = new Set<ProtoScalar>(['int32', 'uint32', 'sint32', 'fixed32', 'sfixed32']);
const SIXTY_FOUR_BIT = new Set<ProtoScalar>(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64']);
const FLOATING = new Set<ProtoScalar>(['float', 'double']);

/** Emit all helper declarations and the root helper to call, or named diagnostics. */
export function emitProtoEncoder(
  root: TypeIR,
  preferredName: string,
  options: ProtoEncoderOptions,
): ProtoEncoderResult {
  return new EncoderEmitter(options).emit(root, preferredName);
}

class EncoderEmitter {
  readonly #options: ProtoEncoderOptions;
  readonly #diagnostics: ProtoEncodeDiagnostic[] = [];
  readonly #objects: ObjectIR[] = [];
  readonly #objectHelpers = new Map<ObjectIR, string>();
  readonly #namedHelpers = new Map<string, string>();
  readonly #auxiliary: string[] = [];
  readonly #messages: string[] = [];
  #counter = 0;
  #timestampHelper: string | undefined;

  constructor(options: ProtoEncoderOptions) {
    this.#options = options;
  }

  emit(root: TypeIR, preferredName: string): ProtoEncoderResult {
    if (root.kind !== 'object') {
      const reason =
        root.kind === 'union' && root.members.some(member => member.kind === 'object')
          ? 'a union of message types would require `oneof`, but union arms have no ProtoField<N> tag slot'
          : 'a protobuf encoder root must be an object message';
      this.#refuse(preferredName, reason);
      return { helpers: [], diagnostics: this.#diagnostics };
    }

    this.#collect(root, preferredName);
    for (const message of this.#objects) this.#renderMessage(message);
    if (this.#diagnostics.length > 0) return { helpers: [], diagnostics: this.#diagnostics };

    const entry = this.#objectHelpers.get(root);
    if (entry === undefined) {
      this.#refuse(preferredName, 'the protobuf root did not receive an encoder helper');
      return { helpers: [], diagnostics: this.#diagnostics };
    }
    return { entry, helpers: [...this.#auxiliary, ...this.#messages], diagnostics: [] };
  }

  #collect(node: TypeIR, suggested: string): void {
    switch (node.kind) {
      case 'object': {
        if (this.#objectHelpers.has(node)) return;
        const helper = this.#name(`Encode${safeName(node.name ?? suggested)}`);
        this.#objectHelpers.set(node, helper);
        if (node.name !== undefined && !this.#namedHelpers.has(node.name)) this.#namedHelpers.set(node.name, helper);
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

  #renderMessage(node: ObjectIR): void {
    const helper = this.#objectHelpers.get(node);
    if (helper === undefined) {
      this.#refuse(node.name ?? 'Message', 'the protobuf message did not receive an encoder helper');
      return;
    }

    const lines = [`const _w = new ${this.#options.writer}();`];
    const ordered = node.properties.toSorted(
      (left, right) => (left.protoField ?? Number.MAX_SAFE_INTEGER) - (right.protoField ?? Number.MAX_SAFE_INTEGER),
    );
    for (const property of ordered) {
      lines.push(...this.#field(property, `${node.name ?? 'Message'}.${property.name}`));
    }
    lines.push('return _w.finish();');
    this.#messages.push(`function ${helper}(_v) { ${lines.join(' ')} }`);
  }

  #field(property: PropertyIR, path: string): string[] {
    if (!IDENTIFIER.test(property.name)) {
      this.#refuse(path, `\`${property.name}\` is not a valid protobuf field identifier`);
      return [];
    }
    if (property.protoField === undefined) {
      this.#refuse(path, `protobuf property \`${property.name}\` has no ProtoField<N> field number`);
      return [];
    }

    const plan = this.#fieldPlan(property.type, path);
    if (plan === undefined) return [];
    if (property.optional && plan.nullable) {
      this.#refuse(
        path,
        'an optional nullable protobuf field has three TypeScript states but only two wire-presence states',
      );
      return [];
    }

    const value = `_v.${property.name}`;
    if (plan.repeated) {
      const body = this.#repeated(plan.atom, value, property.protoField);
      if (property.optional) return [`if (${value} !== undefined) { ${body.join(' ')} }`];
      if (plan.nullable) return [`if (${value} !== null) { ${body.join(' ')} }`];
      return body;
    }

    const body = this.#singular(plan.atom, value, property.protoField);
    if (property.optional) return [`if (${value} !== undefined) { ${body.join(' ')} }`];
    if (plan.nullable) return [`if (${value} !== null) { ${body.join(' ')} }`];

    const nonDefault = defaultGuard(plan.atom, value);
    return nonDefault === undefined ? body : [`if (${nonDefault}) { ${body.join(' ')} }`];
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
          ? this.#refuse(path, 'the nested protobuf message did not receive an encoder helper')
          : { kind: 'message', helper, wire: 2 };
      }
      case 'ref': {
        const helper = this.#namedHelpers.get(node.name);
        return helper === undefined
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
        return this.#refuse(path, 'an internal protobuf encoder plan was not reduced to one field');
    }
  }

  #scalar(node: ScalarIR, path: string): AtomPlan | undefined {
    const proto = node.proto;
    switch (node.scalar) {
      case 'number':
      case 'integer':
        if (proto === undefined) return scalar('double', 1, 'number');
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
        if (proto === undefined || proto === 'bool') return scalar('bool', 0, 'boolean');
        return this.#refuse(path, `a boolean protobuf field cannot use Proto<'${proto}'>`);
      case 'string':
        if (proto === undefined || proto === 'string') return scalar('string', 2, 'string');
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
    const cases = values.map((value, index) => `case ${JSON.stringify(value)}: return ${index + 1};`);
    const message = `unknown protobuf enum value for ${path}`;
    this.#auxiliary.push(
      `function ${helper}(_v) { switch (_v) { ${cases.join(' ')} default: throw new TypeError(${JSON.stringify(message)}); } }`,
    );
    return { kind: 'enum', helper, wire: 0 };
  }

  #timestamp(): string {
    if (this.#timestampHelper !== undefined) return this.#timestampHelper;
    const helper = this.#name('Timestamp');
    this.#timestampHelper = helper;
    this.#auxiliary.push(
      `function ${helper}(_v) { ` +
        `const _w = new ${this.#options.writer}(); ` +
        'const _ms = BigInt(_v.getTime()); ' +
        'let _seconds = _ms / 1000n; ' +
        'let _nanos = (_ms % 1000n) * 1000000n; ' +
        'if (_nanos < 0n) { _seconds -= 1n; _nanos += 1000000000n; } ' +
        'if (_seconds !== 0n) { _w.tag(1, 0); _w.int64(_seconds); } ' +
        'if (_nanos !== 0n) { _w.tag(2, 0); _w.int32(Number(_nanos)); } ' +
        'return _w.finish(); }',
    );
    return helper;
  }

  #singular(atom: AtomPlan, value: string, fieldNumber: number): string[] {
    switch (atom.kind) {
      case 'scalar':
        return [`_w.tag(${fieldNumber}, ${atom.wire});`, `_w.${atom.method}(${value});`];
      case 'enum':
        return [`_w.tag(${fieldNumber}, 0);`, `_w.uint32(${atom.helper}(${value}));`];
      case 'message':
      case 'timestamp':
        return [`_w.tag(${fieldNumber}, 2);`, `_w.bytes(${atom.helper}(${value}));`];
    }
  }

  #repeated(atom: AtomPlan, value: string, fieldNumber: number): string[] {
    if (isPacked(atom)) {
      const payload = this.#name('Packed');
      const element = this.#name('Element');
      const write =
        atom.kind === 'enum'
          ? `${payload}.uint32(${atom.helper}(${element}));`
          : `${payload}.${atom.method}(${element});`;
      return [
        `if (${value}.length !== 0) { ` +
          `const ${payload} = new ${this.#options.writer}(); ` +
          `for (const ${element} of ${value}) { ${write} } ` +
          `_w.tag(${fieldNumber}, 2); _w.bytes(${payload}.finish()); }`,
      ];
    }

    const element = this.#name('Element');
    const write = this.#singular(atom, element, fieldNumber).join(' ');
    return [`for (const ${element} of ${value}) { ${write} }`];
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

function defaultGuard(atom: AtomPlan, value: string): string | undefined {
  if (atom.kind !== 'scalar') return undefined;
  switch (atom.zero) {
    case 'number':
      return `${value} !== 0`;
    case 'bigint':
      return `${value} !== 0n`;
    case 'boolean':
      return value;
    case 'string':
      return `${value} !== ""`;
  }
}

function isPacked(atom: AtomPlan): atom is ScalarPlan | EnumPlan {
  return atom.kind === 'enum' || (atom.kind === 'scalar' && atom.method !== 'string');
}

function safeName(raw: string): string {
  const words = raw.split(/[^A-Za-z0-9_$]+/).filter(word => word.length > 0);
  const joined = words.map(word => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join('');
  return joined.length === 0 ? 'Message' : joined;
}
