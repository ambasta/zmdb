// TypeIR -> straight-line protobuf encoder JavaScript.
//
// This is build-time only. The generated functions access named properties directly
// and call the small wire runtime; no descriptor, field table or property-name loop
// reaches the application.

import { type ObjectIR, type PropertyIR, type ScalarIR, type TypeIR } from '@zmdb/schema/ir';

import {
  collectMessages,
  IDENTIFIER,
  isPacked,
  planField,
  planScalar,
  safeName,
  type AtomPlan,
  type EnumPlan,
  type FieldAtomIR,
  type FieldPlan as ProtoFieldPlan,
} from './plan.js';

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

type FieldPlan = ProtoFieldPlan<AtomPlan>;

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
    collectMessages(node, suggested, (message, name) => {
      if (this.#objectHelpers.has(message)) return false;
      const helper = this.#name(`Encode${safeName(message.name ?? name)}`);
      this.#objectHelpers.set(message, helper);
      if (message.name !== undefined && !this.#namedHelpers.has(message.name)) {
        this.#namedHelpers.set(message.name, helper);
      }
      this.#objects.push(message);
      return true;
    });
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
    return planField<AtomPlan>(
      node,
      path,
      (value, location) => this.#atom(value, location),
      (location, values) => this.#enum(location, values),
      (location, reason, origin) => this.#refuse(location, reason, origin),
    );
  }

  #atom(node: FieldAtomIR, path: string): AtomPlan | undefined {
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
    }
  }

  #scalar(node: ScalarIR, path: string): AtomPlan | undefined {
    return planScalar(
      node,
      path,
      () => this.#timestamp(),
      (location, reason, origin) => this.#refuse(location, reason, origin),
    );
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
