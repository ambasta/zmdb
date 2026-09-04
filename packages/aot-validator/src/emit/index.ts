// IR → JavaScript. The back-end that makes `is<T>(x)` cost a few `typeof`s.
//
// Four targets, one walk each, sharing one naming/hoisting/budget context:
//
//   check   `(v) => boolean`                  `is<T>`, and the first pass of the rest
//   excess  statements that `return false`    the strict half of `equals`/`assertEquals`
//   issues  `(v, path, out) => void`          `assert<T>` / `validate<T>`
//   sample  an expression producing a value   `random<T>`
//
// And two that are not walks, and so are not `EmitTarget`s: `emitJsonSchema` emits a
// *finished* JSON Schema document for `toJsonSchema<T>()`, and `emitSchemaValue` a
// finished `CoreSchema` for `schemaOf<T>()`. The other four emit code that runs later and
// therefore need a walk per target; these two are data, computed here by the very
// functions — `jsonSchemaFromShape`, `schemaFromIR` — that the value path calls.
//
// Three decisions shape all of it.
//
// **REQ-AV-7 — no allocation on the success path.** `assert<T>(x)` does not build an
// issues array and then check whether it is empty. It runs the allocation-free `check`
// and only walks `issues` once it already knows the value is bad. Valid input therefore
// allocates nothing at all, and the second walk is paid for exactly where a throw was
// about to happen anyway.
//
// **REQ-AV-4 — the emitted and the runtime paths must agree.** They are two walks, so
// everything both of them decide — issue text, whether a union has a discriminant —
// lives in `./shape.ts` and is imported by both. `utilities/index.ts` is the other walk.
//
// **Anonymous inlines, named hoists.** A name is the signal that a type may recur or
// appear twice, and `RefIR` exists because it does. So `is<{ n: number }>(x)` stays a
// straight-line expression with no call in it, while `is<User>(x)` gets one hoisted
// `_zmdbCheckUser0` that a `ref` can call. Arrays always hoist: a loop is not an
// expression, and `.every(cb)` allocates a closure per call.
//
// An `unsupported` node is a build error, never a guess (plan D4). The walk records a
// diagnostic and returns `undefined`, and the transformer leaves that call site alone.

import {
  jsonSchemaFromShape,
  schemaFromIR,
  type ArrayIR,
  type Constraints,
  type ObjectIR,
  type ScalarIR,
  type SchemaIR,
  type ShapeIR,
  type TupleIR,
  type TypeIR,
  type UnionIR,
} from '@zmdb/schema-core/ir';

import { validatePatternComplexity } from '../regex-complexity.js';
import {
  discriminantOf,
  expectedForConstraint,
  expectedForDiscriminant,
  expectedOf,
  hasExcessCheck,
  type ConstraintKeyword,
} from './shape.js';

/** Sanitise a pattern before it goes between `/` delimiters in emitted source. */
export function escapePattern(pattern: string): string {
  return pattern
    .replace(/(?<!\\)(?:\\\\)*\//g, match => match.slice(0, -1) + '\\/')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

export type EmitTarget = 'check' | 'excess' | 'issues' | 'sample';

export interface EmitOptions {
  /** Prefix for every emitted identifier. Default `_zmdb`. */
  readonly prefix?: string;
  /** Cap on hoisted helpers per file. Exceeding it is a refusal, not a hang. */
  readonly maxHelpers?: number;
  /** Module specifier the emitted prelude imports `AssertError` from. */
  readonly errorModule?: string;
}

/** A refusal. `path` is the property chain that reached it, as in the reflection. */
export interface EmitDiagnostic {
  readonly path: string;
  readonly reason: string;
  readonly source?: string;
}

const DEFAULT_MAX_HELPERS = 512;

/** Above this many literal members a hoisted `Set` beats a chain of `===`. */
const MANY_LITERALS = 8;

/** An identifier or dotted path is cheap to re-read; anything else is bound once. */
const SIMPLE_REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const STRING_LITERAL = /^"(?:[^"\\]|\\.)*"$/;
const NUMERIC = /^\d+$/;

/** An excess walk that is nothing but a delegation, so the delegation can be dropped. */
const SOLE_GUARD = /^if \(!(\w+)\(_v\)\) return false;$/;

/**
 * "This is a keyed object." An array is excluded, because the runtime walker has always
 * excluded it, and `is<{}>([])` answering `true` in a built bundle and `false` in dev is
 * exactly the divergence REQ-AV-4 forbids.
 */
function recordTest(v: string): string {
  return `typeof ${v} === "object" && ${v} !== null && !Array.isArray(${v})`;
}

/** Looser: only enough to make a `for…in` or an indexed loop safe. */
function keyableTest(v: string): string {
  return `typeof ${v} === "object" && ${v} !== null`;
}

/** How a call site's argument expression is referred to inside emitted code. */
interface Bound {
  /** The expression to read the value from, safe to repeat. */
  readonly ref: string;
  /** Wrap an expression body so `ref` is in scope. */
  expression(body: string): string;
  /** Wrap a statement body (which `return`s) so `ref` is in scope. */
  block(statements: readonly string[]): string;
}

/** Options for emitting an object's property checks without its own record test. */
interface ObjectBodyOptions {
  /** A property already established by the caller — a union's discriminant. */
  readonly skip?: string;
  /** Omit the record test, because the caller has already done it. */
  readonly bare?: boolean;
}

export class Emitter {
  readonly #prefix: string;
  readonly #maxHelpers: number;
  readonly #errorModule: string;
  readonly #helpers: (string | undefined)[] = [];
  readonly #diagnostics: EmitDiagnostic[] = [];
  /** `target:name` → helper, for the emission in progress. Lets a `ref` resolve. */
  readonly #open = new Map<string, string>();
  /** `target:fingerprint` → helper, for the whole file. Two call sites share one. */
  readonly #shared = new Map<string, string>();
  #counter = 0;
  #needsAssertError = false;
  #hasIssueHelper = false;
  #hasFreeze = false;
  #hasIntSample = false;
  #hasStringSample = false;

  constructor(options: EmitOptions = {}) {
    this.#prefix = options.prefix ?? '_zmdb';
    this.#maxHelpers = options.maxHelpers ?? DEFAULT_MAX_HELPERS;
    this.#errorModule = options.errorModule ?? '@zmdb/aot-validator/errors';
  }

  get diagnostics(): readonly EmitDiagnostic[] {
    return this.#diagnostics;
  }

  /** True once anything has been hoisted, so a caller knows a prelude is needed. */
  get hasPrelude(): boolean {
    return this.#needsAssertError || this.#helpers.length > 0;
  }

  /**
   * Everything that has to sit at the top of the module: the `AssertError` import when a
   * throwing form was emitted, then the helpers in definition order.
   */
  prelude(): string {
    const lines: string[] = [];
    if (this.#needsAssertError) {
      lines.push(`import { AssertError as ${this.#prefix}AssertError } from ${JSON.stringify(this.#errorModule)};`);
    }
    for (const helper of this.#helpers) if (helper !== undefined) lines.push(helper);
    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // The call sites
  // -------------------------------------------------------------------------

  /** `is<T>(expr)` → a boolean expression. */
  emitIs(node: TypeIR, expr: string): string | undefined {
    this.#open.clear();
    const bound = this.#bind(expr);
    const check = this.#check(node, bound.ref, '');
    if (check === undefined) return undefined;
    return bound.expression(`(${check})`);
  }

  /** `equals<T>(expr)` → `is<T>` plus a recursive no-excess-keys check. */
  emitEquals(node: TypeIR, expr: string): string | undefined {
    this.#open.clear();
    const bound = this.#bind(expr);
    const check = this.#check(node, bound.ref, '');
    if (check === undefined) return undefined;
    // The excess walk goes through a hoisted helper rather than inline statements so the
    // whole thing stays one expression: `equals<T>(x)` in a condition should not have to
    // pay for an IIFE just to run a second pass.
    const excess = this.#excessHelper(node);
    if (excess === undefined) return undefined;
    if (excess === null) return bound.expression(`(${check})`);
    return bound.expression(`((${check}) && ${excess}(${bound.ref}))`);
  }

  /** `assert<T>(expr)` / `assertEquals<T>(expr)` → the value, or a throw. */
  emitAssert(node: TypeIR, expr: string, strict: boolean): string | undefined {
    const plan = this.#twoPass(node, expr, strict);
    if (!plan) return undefined;
    this.#needsAssertError = true;
    // The success path is `if (gate) return v` and nothing else: no array, no issue
    // objects, no closure (REQ-AV-7). Everything below the `if` runs once, on the way to
    // a throw that was going to be expensive regardless.
    return plan.bound.block([
      `if (${plan.gate}) return ${plan.bound.ref};`,
      `const _e = []; ${plan.collect}(${plan.bound.ref}, "input", _e);`,
      `throw new ${this.#prefix}AssertError(_e[0] ? _e[0].message : "validation failed", _e);`,
    ]);
  }

  /** `validate<T>(expr)` → a `ValidateResult<T>`, never a throw. */
  emitValidate(node: TypeIR, expr: string, strict = false): string | undefined {
    const plan = this.#twoPass(node, expr, strict);
    if (!plan) return undefined;
    return plan.bound.block([
      `if (${plan.gate}) return { success: true, data: ${plan.bound.ref} };`,
      `const _e = []; ${plan.collect}(${plan.bound.ref}, "input", _e);`,
      'return { success: false, errors: _e };',
    ]);
  }

  /** `random<T>()` → an expression producing a value that satisfies `T`. */
  emitRandom(node: TypeIR): string | undefined {
    this.#open.clear();
    const sample = this.#sample(node, '');
    return sample === undefined ? undefined : `(${sample})`;
  }

  /**
   * `toJsonSchema<T>()` → a reference to the document, hoisted and frozen (REQ-TF-7).
   *
   * One of the two targets that is not a walk. The other four emit code that runs later;
   * a JSON Schema document is *finished* at build time, so what gets emitted is the
   * answer itself. `jsonSchemaFromShape` is the same function the value path calls, which
   * is what makes the two documents identical rather than merely tested for equality.
   */
  emitJsonSchema(shape: ShapeIR): string | undefined {
    return this.#literal('jsonSchema', 'JsonSchema', jsonSchemaFromShape(shape));
  }

  /**
   * `schemaOf<T>()` → a reference to the generated schema value, hoisted and frozen
   * (REQ-TF-10).
   *
   * The other half of "one IR, several back-ends": the query compiler and the DDL emitter
   * want the table and the column types as data, so what gets emitted is the projection
   * `schemaFromIR` builds — and that includes the IR itself, on the value's `ir` field.
   * Both are in the literal on purpose. The projection is what the query compiler reads on
   * every call and wants flat; the IR is what the decoders, the wire codecs and the OpenAPI
   * document read, and it says things no column map can hold. Emitting only the projection
   * would mean recovering the rest by inference at runtime, which is the walk this design
   * removed.
   *
   * Relations do not travel with the projection. A `CoreSchema` has no relation map — the
   * repository takes one separately — so a `ManyToOne<…>` on the declaration is read, is
   * not a column, and reaches a consumer only through `ir.relations`.
   */
  emitSchemaValue(ir: SchemaIR): string | undefined {
    return this.#literal('schema', 'Schema', schemaFromIR(ir));
  }

  /**
   * A finished value, hoisted once and deeply frozen.
   *
   * Both callers compute their answer at build time rather than emitting code that
   * computes it later, so what is left is printing — and the IR is JSON by construction
   * (`ir/index.ts`'s first constraint), which makes `JSON.stringify` the printer.
   *
   * Shared by fingerprint, so ten routes asking for the same document, or four modules
   * asking for the same schema, carry one copy. Which is why it is frozen: the value
   * path hands back a fresh object per call, and a shared literal one consumer could
   * mutate would be visible to the other nine. Frozen, that mistake is a `TypeError` at
   * the assignment instead.
   */
  #literal(kind: string, label: string, value: unknown): string | undefined {
    const printed = JSON.stringify(value);
    const fingerprint = `${kind}:${printed}`;
    const cached = this.#shared.get(fingerprint);
    if (cached !== undefined) return cached;
    const slot = this.#reserve();
    if (slot === undefined) return undefined;
    const name = this.#name(label);
    this.#helpers[slot] = `const ${name} = ${this.#freeze()}(${printed});`;
    this.#shared.set(fingerprint, name);
    return name;
  }

  /**
   * The name of a hoisted function implementing `target` for `node`, for callers that
   * want the function rather than an inlined call site — the differential suite and the
   * emitted-output snapshots both do.
   */
  helper(node: TypeIR, target: EmitTarget): string | undefined {
    this.#open.clear();
    switch (target) {
      case 'check': {
        const check = this.#check(node, '_v', '');
        return check === undefined ? undefined : this.#function('Check', ['_v'], [`return ${check};`]);
      }
      case 'excess': {
        const guards = this.#excess(node, '_v', '');
        return guards === undefined ? undefined : this.#function('Excess', ['_v'], [...guards, 'return true;']);
      }
      case 'issues':
        return this.#issuesHelper(node);
      case 'sample': {
        const sample = this.#sample(node, '');
        return sample === undefined ? undefined : this.#function('Sample', [], [`return ${sample};`]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  #refuse(path: string, reason: string, source?: string): undefined {
    this.#diagnostics.push(source === undefined ? { path, reason } : { path, reason, source });
    return undefined;
  }

  #name(hint: string): string {
    return `${this.#prefix}${hint}${this.#counter++}`;
  }

  /** Reserve a slot so a recursive walk can name a helper before it exists. */
  #reserve(): number | undefined {
    if (this.#helpers.length >= this.#maxHelpers) {
      return this.#refuse('', `more than ${this.#maxHelpers} emitted helpers in one file`);
    }
    this.#helpers.push(undefined);
    return this.#helpers.length - 1;
  }

  #function(hint: string, parameters: readonly string[], body: readonly string[]): string | undefined {
    const slot = this.#reserve();
    if (slot === undefined) return undefined;
    const name = this.#name(hint);
    this.#helpers[slot] = `function ${name}(${parameters.join(', ')}) { ${body.join(' ')} }`;
    return name;
  }

  #bind(expr: string): Bound {
    const trimmed = expr.trim();
    if (SIMPLE_REFERENCE.test(trimmed)) {
      // Re-read rather than bound. A property access could in principle run a getter
      // more than once; that is the pre-existing behaviour of this transformer, and the
      // alternative — an arrow wrapper around every `is<T>(o.p)` — costs a call on the
      // hot path for a shape that does not occur in validated data.
      return {
        ref: trimmed,
        expression: body => body,
        block: statements => `((() => { ${statements.join(' ')} })())`,
      };
    }
    // Anything with a call, an index or an operator in it is evaluated exactly once:
    // `assert<T>(next())` must not advance the iterator twice.
    const parameter = this.#name('Arg');
    return {
      ref: parameter,
      expression: body => `((${parameter}) => ${body})(${trimmed})`,
      block: statements => `((${parameter}) => { ${statements.join(' ')} })(${trimmed})`,
    };
  }

  /**
   * The shared shape of `assert` and `validate`: an allocation-free gate, and the issues
   * walker to run only once the gate has said no.
   */
  #twoPass(
    node: TypeIR,
    expr: string,
    strict: boolean,
  ): { readonly bound: Bound; readonly gate: string; readonly collect: string } | undefined {
    this.#open.clear();
    const bound = this.#bind(expr);
    const check = this.#check(node, bound.ref, '');
    if (check === undefined) return undefined;

    const excess = strict ? this.#excessHelper(node) : null;
    if (excess === undefined) return undefined;

    const issues = this.#issuesHelper(node);
    if (issues === undefined) return undefined;

    const gate = excess === null ? `(${check})` : `((${check}) && ${excess}(${bound.ref}))`;
    if (excess === null) return { bound, gate, collect: issues };

    // Excess properties are one issue about the value as a whole, and only worth
    // reporting when nothing else was wrong: "you also passed `extra`" is noise next to
    // "`email` is not a string".
    const collect = this.#function(
      'Strict',
      ['_v', '_p', '_o'],
      [
        `${issues}(_v, _p, _o);`,
        `if (_o.length === 0 && !${excess}(_v)) ${this.#issue('_o', '_p', JSON.stringify('no excess properties'), '_v')}`,
      ],
    );
    return collect === undefined ? undefined : { bound, gate, collect };
  }

  /** A hoisted `(v) => boolean` excess check, or `null` when the type has none. */
  #excessHelper(node: TypeIR): string | null | undefined {
    const fingerprint = `excessFn:${JSON.stringify(node)}`;
    const cached = this.#shared.get(fingerprint);
    if (cached !== undefined) return cached;
    const guards = this.#excess(node, '_v', '');
    if (guards === undefined) return undefined;
    if (guards.length === 0) return null;
    // A named type's excess walk is already a hoisted function, and wrapping
    // `if (!_zmdbExcessUser1(_v)) return false; return true;` in a second one buys a call
    // per validation and nothing else. Hand back the inner function instead.
    const [only] = guards;
    const inner = guards.length === 1 && only !== undefined ? SOLE_GUARD.exec(only)?.[1] : undefined;
    if (inner !== undefined) {
      this.#shared.set(fingerprint, inner);
      return inner;
    }
    const name = this.#function('Excess', ['_v'], [...guards, 'return true;']);
    if (name === undefined) return undefined;
    this.#shared.set(fingerprint, name);
    return name;
  }

  #issuesHelper(node: TypeIR): string | undefined {
    const fingerprint = `issuesFn:${JSON.stringify(node)}`;
    const cached = this.#shared.get(fingerprint);
    if (cached !== undefined) return cached;
    const slot = this.#reserve();
    if (slot === undefined) return undefined;
    const name = this.#name('Issues');
    this.#shared.set(fingerprint, name);
    const statements = this.#issues(node, '_v', '_p', '_o', '');
    if (statements === undefined) {
      this.#shared.delete(fingerprint);
      return undefined;
    }
    this.#helpers[slot] = `function ${name}(_v, _p, _o) { ${statements.join(' ')} }`;
    return name;
  }

  /**
   * The deep-freeze used by `emitJsonSchema`, hoisted once per file.
   *
   * A helper rather than nested `Object.freeze(…)` calls inside the literal: the point of
   * emitting a document is that the emitted source reads as the document, and wrapping
   * every nested object in a call buries it. A recursive walk over a schema document at
   * module load is not a cost worth optimising.
   */
  #freeze(): string {
    const name = `${this.#prefix}Freeze`;
    if (!this.#hasFreeze) {
      this.#hasFreeze = true;
      this.#helpers.push(
        `function ${name}(_v) { if (_v !== null && typeof _v === "object") { for (const _k of Object.keys(_v)) ${name}(_v[_k]); Object.freeze(_v); } return _v; }`,
      );
    }
    return name;
  }

  /** The one-liner that records a failure. Hoisted once per file. */
  #issue(out: string, path: string, expected: string, value: string): string {
    if (!this.#hasIssueHelper) {
      this.#hasIssueHelper = true;
      this.#helpers.push(
        `function ${this.#prefix}Issue(out, path, expected, value) { out.push({ path, expected, value, message: "expected " + expected }); }`,
      );
    }
    return `${this.#prefix}Issue(${out}, ${path}, ${expected}, ${value});`;
  }

  // -------------------------------------------------------------------------
  // Target: check
  // -------------------------------------------------------------------------

  #check(node: TypeIR, v: string, path: string): string | undefined {
    switch (node.kind) {
      case 'unsupported':
        return this.#refuse(path, node.reason, node.source);
      case 'unknown':
        return 'true';
      case 'null':
        return `${v} === null`;
      case 'undefined':
        return `${v} === undefined`;
      case 'literal':
        return `${v} === ${JSON.stringify(node.value)}`;
      case 'scalar':
        return this.#scalarCheck(node, v, path);
      case 'union':
        return this.#unionCheck(node, v, path);
      case 'tuple':
        return this.#tupleCheck(node, v, path);
      case 'array':
        return this.#arrayCheck(node, v, path);
      case 'object':
        return this.#objectCheck(node, v, path);
      case 'ref': {
        const helper = this.#open.get(`check:${node.name}`);
        if (helper === undefined) {
          return this.#refuse(path, `a back-reference to \`${node.name}\`, which was never declared`);
        }
        return `${helper}(${v})`;
      }
    }
  }

  #scalarCheck(node: ScalarIR, v: string, path: string): string | undefined {
    const constraints = this.#constraintChecks(node.constraints, v, node.scalar === 'string', path);
    if (constraints === undefined) return undefined;
    return [scalarBase(node.scalar, v), ...constraints].join(' && ');
  }

  /** `length`-based bounds read a `.length`; numeric ones compare the value itself. */
  #constraintChecks(
    constraints: Constraints | undefined,
    v: string,
    lengthy: boolean,
    path: string,
  ): string[] | undefined {
    const parts: string[] = [];
    if (!constraints) return parts;
    if (constraints.minimum !== undefined) parts.push(`${v} >= ${constraints.minimum}`);
    if (constraints.maximum !== undefined) parts.push(`${v} <= ${constraints.maximum}`);
    if (constraints.minLength !== undefined) parts.push(`${v}.length >= ${constraints.minLength}`);
    if (constraints.maxLength !== undefined) parts.push(`${v}.length <= ${constraints.maxLength}`);
    if (constraints.pattern !== undefined) {
      if (!lengthy) return this.#refuse(path, 'a `pattern` constraint on something that is not a string');
      // Validated here rather than trusted: an unparseable pattern would otherwise
      // become a syntax error in the emitted module, which is a far worse message.
      validatePatternComplexity(constraints.pattern);
      parts.push(`/${escapePattern(constraints.pattern)}/.test(${v})`);
    }
    return parts;
  }

  #unionCheck(node: UnionIR, v: string, path: string): string | undefined {
    if (node.members.length === 0) return this.#refuse(path, 'an empty union matches nothing');

    if (node.members.length > MANY_LITERALS && node.members.every(member => member.kind === 'literal')) {
      // A long enum is a set lookup, not a chain of `===`. Below the cutoff the chain is
      // faster and reads better; above it, the `Set` wins.
      //
      // boundary: `every` above proved each member is a `literal`, but it returns a boolean
      // and the narrowing does not reach this `map`. The alternative is testing `kind` again
      // inside the map for a branch the condition has ruled out.
      const values = node.members.map(member => JSON.stringify((member as { value: unknown }).value));
      const name = this.#name('Set');
      this.#helpers.push(`const ${name} = new Set([${values.join(', ')}]);`);
      return `${name}.has(${v})`;
    }

    const discriminant = discriminantOf(node.members);
    if (discriminant) {
      const arms: string[] = [];
      for (const arm of discriminant.arms) {
        const body = this.#objectBody(arm.node, v, path, { skip: discriminant.key, bare: true });
        if (body === undefined) return undefined;
        arms.push(`${v}${accessor(discriminant.key)} === ${JSON.stringify(arm.value)} ? (${body})`);
      }
      return `(${recordTest(v)} && (${arms.join(' : ')} : false))`;
    }

    const parts: string[] = [];
    for (const [index, member] of node.members.entries()) {
      const check = this.#check(member, v, `${path}|${index}`);
      if (check === undefined) return undefined;
      parts.push(`(${check})`);
    }
    return `(${parts.join(' || ')})`;
  }

  #tupleCheck(node: TupleIR, v: string, path: string): string | undefined {
    const parts = [`Array.isArray(${v})`, `${v}.length === ${node.elements.length}`];
    for (const [index, element] of node.elements.entries()) {
      const check = this.#check(element, `${v}[${index}]`, `${path}[${index}]`);
      if (check === undefined) return undefined;
      if (check !== 'true') parts.push(`(${check})`);
    }
    return parts.join(' && ');
  }

  #arrayCheck(node: ArrayIR, v: string, path: string): string | undefined {
    const fingerprint = `checkArray:${JSON.stringify(node)}`;
    const cached = this.#shared.get(fingerprint);
    if (cached !== undefined) return `${cached}(${v})`;

    const slot = this.#reserve();
    if (slot === undefined) return undefined;
    const name = this.#name('CheckArray');
    this.#shared.set(fingerprint, name);

    const element = this.#check(node.element, '_v[_i]', `${path}[]`);
    if (element === undefined) {
      this.#shared.delete(fingerprint);
      return undefined;
    }
    const bounds = this.#constraintChecks(node.constraints, '_v', true, path);
    if (bounds === undefined) return undefined;

    const body = [`if (!Array.isArray(_v)) return false;`];
    for (const bound of bounds) body.push(`if (!(${bound})) return false;`);
    if (element !== 'true') {
      body.push(`for (let _i = 0; _i < _v.length; _i++) { if (!(${element})) return false; }`);
    }
    body.push('return true;');
    this.#helpers[slot] = `function ${name}(_v) { ${body.join(' ')} }`;
    return `${name}(${v})`;
  }

  #objectCheck(node: ObjectIR, v: string, path: string): string | undefined {
    if (node.name === undefined) return this.#objectBody(node, v, path, {});

    const openKey = `check:${node.name}`;
    const open = this.#open.get(openKey);
    if (open !== undefined) return `${open}(${v})`;

    const fingerprint = `check:${JSON.stringify(node)}`;
    const cached = this.#shared.get(fingerprint);
    if (cached !== undefined) return `${cached}(${v})`;

    const slot = this.#reserve();
    if (slot === undefined) return undefined;
    const name = this.#name(`Check${capitalise(node.name)}`);
    this.#open.set(openKey, name);
    this.#shared.set(fingerprint, name);
    const body = this.#objectBody(node, '_v', path, {});
    if (body === undefined) return undefined;
    this.#helpers[slot] = `function ${name}(_v) { return ${body}; }`;
    return `${name}(${v})`;
  }

  #objectBody(node: ObjectIR, v: string, path: string, options: ObjectBodyOptions): string | undefined {
    const parts = options.bare === true ? [] : [recordTest(v)];
    for (const property of node.properties) {
      if (property.name === options.skip) continue;
      const member = `${v}${accessor(property.name)}`;
      const check = this.#check(property.type, member, join(path, property.name));
      if (check === undefined) return undefined;
      if (check === 'true') continue;
      parts.push(property.optional ? `(${member} === undefined || (${check}))` : `(${check})`);
    }
    return parts.length === 0 ? 'true' : parts.join(' && ');
  }

  // -------------------------------------------------------------------------
  // Target: excess
  // -------------------------------------------------------------------------

  /**
   * Statements that `return false` when the value carries a property the type does not
   * declare. Reached only after `check` has passed, so every declared property is known
   * to be there — which is what lets an all-required object reduce "no excess keys" to a
   * key count.
   */
  #excess(node: TypeIR, v: string, path: string): string[] | undefined {
    switch (node.kind) {
      case 'object':
        return this.#objectExcess(node, v, path);
      case 'array':
        return this.#arrayExcess(node, v, path);
      case 'tuple': {
        const statements: string[] = [];
        for (const [index, element] of node.elements.entries()) {
          if (!hasExcessCheck(element)) continue;
          const inner = this.#excess(element, `${v}[${index}]`, `${path}[${index}]`);
          if (inner === undefined) return undefined;
          statements.push(...inner);
        }
        return statements;
      }
      case 'union': {
        // A value can satisfy several arms of an undiscriminated union, so "which arm's
        // property list is the declared one" has no answer and neither path checks it.
        // With a discriminant there is exactly one answer.
        const discriminant = discriminantOf(node.members);
        if (!discriminant) return [];
        const branches: string[] = [];
        for (const arm of discriminant.arms) {
          const inner = this.#excess(arm.node, v, path);
          if (inner === undefined) return undefined;
          if (inner.length === 0) continue;
          branches.push(
            `if (${v}${accessor(discriminant.key)} === ${JSON.stringify(arm.value)}) { ${inner.join(' ')} }`,
          );
        }
        return branches;
      }
      case 'ref': {
        // Every named object hoists, and registers itself before its own body is
        // walked, so an ancestor a `ref` points at always has a helper by the time the
        // `ref` is reached. The guard is here because "always" is a claim about the
        // reflector, and emitting nothing is safer than emitting a call to nothing.
        const helper = this.#open.get(`excess:${node.name}`);
        if (helper === undefined) {
          return this.#refuse(path, `a back-reference to \`${node.name}\`, which was never declared`);
        }
        return [`if (!${helper}(${v})) return false;`];
      }
      default:
        return [];
    }
  }

  #objectExcess(node: ObjectIR, v: string, path: string): string[] | undefined {
    // A named object always hoists, even at the top. Inlining it there would leave
    // `excess:<name>` unregistered, so a `ref` back to it inside its own body would
    // find no helper and silently skip the check the runtime walker still performs.
    if (node.name === undefined) return this.#objectExcessBody(node, v, path);

    const openKey = `excess:${node.name}`;
    const open = this.#open.get(openKey);
    if (open !== undefined) return [`if (!${open}(${v})) return false;`];

    const fingerprint = `excess:${JSON.stringify(node)}`;
    const cached = this.#shared.get(fingerprint);
    if (cached !== undefined) return [`if (!${cached}(${v})) return false;`];

    const slot = this.#reserve();
    if (slot === undefined) return undefined;
    const name = this.#name(`Excess${capitalise(node.name)}`);
    this.#open.set(openKey, name);
    this.#shared.set(fingerprint, name);
    const inner = this.#objectExcessBody(node, '_v', path);
    if (inner === undefined) return undefined;
    this.#helpers[slot] = `function ${name}(_v) { ${inner.join(' ')} return true; }`;
    return [`if (!${name}(${v})) return false;`];
  }

  #objectExcessBody(node: ObjectIR, v: string, path: string): string[] | undefined {
    const statements: string[] = [];
    const names = node.properties.map(property => property.name);

    if (names.length > 0 && node.properties.every(property => !property.optional)) {
      // Fast path: nothing is optional, so every declared key is present and "no excess"
      // is exactly "the counts agree". No Set, no allocation, and the loop bails as soon
      // as it has seen one key too many.
      const counter = this.#name('C');
      statements.push(
        `let ${counter} = 0; for (const _ in ${v}) { if (++${counter} > ${names.length}) return false; } if (${counter} !== ${names.length}) return false;`,
      );
    } else {
      const set = this.#name('Keys');
      this.#helpers.push(`const ${set} = new Set([${names.map(name => JSON.stringify(name)).join(', ')}]);`);
      statements.push(`for (const _k in ${v}) { if (!${set}.has(_k)) return false; }`);
    }

    for (const property of node.properties) {
      if (!hasExcessCheck(property.type)) continue;
      const member = `${v}${accessor(property.name)}`;
      const inner = this.#excess(property.type, member, join(path, property.name));
      if (inner === undefined) return undefined;
      if (inner.length === 0) continue;
      // The nested value may legitimately be absent (an optional property) or not an
      // object at all (a `T | null`), and `for (const _ in undefined)` throws.
      statements.push(`if (${keyableTest(member)}) { ${inner.join(' ')} }`);
    }
    return statements;
  }

  #arrayExcess(node: ArrayIR, v: string, path: string): string[] | undefined {
    if (!hasExcessCheck(node.element)) return [];
    const index = this.#name('I');
    const inner = this.#excess(node.element, `${v}[${index}]`, `${path}[]`);
    if (inner === undefined) return undefined;
    if (inner.length === 0) return [];
    return [`for (let ${index} = 0; ${index} < ${v}.length; ${index}++) { ${inner.join(' ')} }`];
  }

  // -------------------------------------------------------------------------
  // Target: issues
  // -------------------------------------------------------------------------

  #issues(node: TypeIR, v: string, p: string, out: string, path: string): string[] | undefined {
    switch (node.kind) {
      case 'unsupported':
        return this.#refuse(path, node.reason, node.source);
      case 'unknown':
        return [];
      case 'null':
      case 'undefined':
      case 'literal': {
        const check = this.#check(node, v, path);
        if (check === undefined) return undefined;
        return [`if (!(${check})) ${this.#issue(out, p, JSON.stringify(expectedOf(node)), v)}`];
      }
      case 'scalar':
        return this.#scalarIssues(node, v, p, out, path);
      case 'tuple':
        return this.#tupleIssues(node, v, p, out, path);
      case 'array':
        return this.#arrayIssues(node, v, p, out, path);
      case 'object':
        return this.#objectIssues(node, v, p, out, path);
      case 'union':
        return this.#unionIssues(node, v, p, out, path);
      case 'ref': {
        const helper = this.#open.get(`issues:${node.name}`);
        if (helper === undefined) {
          return this.#refuse(path, `a back-reference to \`${node.name}\`, which was never declared`);
        }
        return [`${helper}(${v}, ${p}, ${out});`];
      }
    }
  }

  #scalarIssues(node: ScalarIR, v: string, p: string, out: string, path: string): string[] | undefined {
    const base = scalarBase(node.scalar, v);
    const bounds = this.#constraintIssues(node.constraints, v, p, out, node.scalar === 'string', path);
    if (bounds === undefined) return undefined;
    const shape = this.#issue(out, p, JSON.stringify(expectedOf(node)), v);
    // The shape is checked first and stops the walk: reporting `minLength 3` about a
    // number would be two issues where one is the truth.
    if (bounds.length === 0) return [`if (!(${base})) ${shape}`];
    return [`if (!(${base})) { ${shape} } else { ${bounds.join(' ')} }`];
  }

  #constraintIssues(
    constraints: Constraints | undefined,
    v: string,
    p: string,
    out: string,
    lengthy: boolean,
    path: string,
  ): string[] | undefined {
    if (!constraints) return [];
    const statements: string[] = [];
    const push = (keyword: ConstraintKeyword, test: string, value: number | string): void => {
      statements.push(
        `if (!(${test})) ${this.#issue(out, p, JSON.stringify(expectedForConstraint(keyword, value)), v)}`,
      );
    };
    if (constraints.minimum !== undefined) push('minimum', `${v} >= ${constraints.minimum}`, constraints.minimum);
    if (constraints.maximum !== undefined) push('maximum', `${v} <= ${constraints.maximum}`, constraints.maximum);
    if (constraints.minLength !== undefined) {
      push('minLength', `${v}.length >= ${constraints.minLength}`, constraints.minLength);
    }
    if (constraints.maxLength !== undefined) {
      push('maxLength', `${v}.length <= ${constraints.maxLength}`, constraints.maxLength);
    }
    if (constraints.pattern !== undefined) {
      if (!lengthy) return this.#refuse(path, 'a `pattern` constraint on something that is not a string');
      validatePatternComplexity(constraints.pattern);
      push('pattern', `/${escapePattern(constraints.pattern)}/.test(${v})`, constraints.pattern);
    }
    return statements;
  }

  #tupleIssues(node: TupleIR, v: string, p: string, out: string, path: string): string[] | undefined {
    const inner: string[] = [];
    for (const [index, element] of node.elements.entries()) {
      const statements = this.#issues(element, `${v}[${index}]`, indexed(p, String(index)), out, `${path}[${index}]`);
      if (statements === undefined) return undefined;
      inner.push(...statements);
    }
    const shape = this.#issue(out, p, JSON.stringify(expectedOf(node)), v);
    return [
      `if (!Array.isArray(${v}) || ${v}.length !== ${node.elements.length}) { ${shape} } else { ${inner.join(' ')} }`,
    ];
  }

  #arrayIssues(node: ArrayIR, v: string, p: string, out: string, path: string): string[] | undefined {
    const fingerprint = `issuesArray:${JSON.stringify(node)}`;
    const cached = this.#shared.get(fingerprint);
    if (cached !== undefined) return [`${cached}(${v}, ${p}, ${out});`];

    const slot = this.#reserve();
    if (slot === undefined) return undefined;
    const name = this.#name('IssuesArray');
    this.#shared.set(fingerprint, name);

    const element = this.#issues(node.element, '_v[_i]', indexed('_p', '_i'), '_o', `${path}[]`);
    if (element === undefined) {
      this.#shared.delete(fingerprint);
      return undefined;
    }
    const bounds = this.#constraintIssues(node.constraints, '_v', '_p', '_o', true, path);
    if (bounds === undefined) return undefined;
    const body = [
      `if (!Array.isArray(_v)) { ${this.#issue('_o', '_p', JSON.stringify('array'), '_v')} return; }`,
      ...bounds,
      `for (let _i = 0; _i < _v.length; _i++) { ${element.join(' ')} }`,
    ];
    this.#helpers[slot] = `function ${name}(_v, _p, _o) { ${body.join(' ')} }`;
    return [`${name}(${v}, ${p}, ${out});`];
  }

  #objectIssues(node: ObjectIR, v: string, p: string, out: string, path: string): string[] | undefined {
    if (node.name === undefined) return this.#objectIssuesBody(node, v, p, out, path);

    const openKey = `issues:${node.name}`;
    const open = this.#open.get(openKey);
    if (open !== undefined) return [`${open}(${v}, ${p}, ${out});`];

    const fingerprint = `issues:${JSON.stringify(node)}`;
    const cached = this.#shared.get(fingerprint);
    if (cached !== undefined) return [`${cached}(${v}, ${p}, ${out});`];

    const slot = this.#reserve();
    if (slot === undefined) return undefined;
    const name = this.#name(`Issues${capitalise(node.name)}`);
    this.#open.set(openKey, name);
    this.#shared.set(fingerprint, name);
    const body = this.#objectIssuesBody(node, '_v', '_p', '_o', path);
    if (body === undefined) return undefined;
    this.#helpers[slot] = `function ${name}(_v, _p, _o) { ${body.join(' ')} }`;
    return [`${name}(${v}, ${p}, ${out});`];
  }

  #objectIssuesBody(node: ObjectIR, v: string, p: string, out: string, path: string): string[] | undefined {
    const inner: string[] = [];
    for (const property of node.properties) {
      const member = `${v}${accessor(property.name)}`;
      const statements = this.#issues(property.type, member, join(p, property.name), out, join(path, property.name));
      if (statements === undefined) return undefined;
      if (statements.length === 0) continue;
      inner.push(property.optional ? `if (${member} !== undefined) { ${statements.join(' ')} }` : statements.join(' '));
    }
    const shape = this.#issue(out, p, JSON.stringify(expectedOf(node)), v);
    return [`if (!(${recordTest(v)})) { ${shape} } else { ${inner.join(' ')} }`];
  }

  #unionIssues(node: UnionIR, v: string, p: string, out: string, path: string): string[] | undefined {
    const discriminant = discriminantOf(node.members);
    if (!discriminant) {
      // No discriminant, so there is no arm to blame: one issue naming the whole union.
      const check = this.#check(node, v, path);
      if (check === undefined) return undefined;
      return [`if (!(${check})) ${this.#issue(out, p, JSON.stringify(expectedOf(node)), v)}`];
    }

    const branches: string[] = [];
    for (const arm of discriminant.arms) {
      const body = this.#objectIssuesBody(arm.node, v, p, out, path);
      if (body === undefined) return undefined;
      branches.push(`if (${v}${accessor(discriminant.key)} === ${JSON.stringify(arm.value)}) { ${body.join(' ')} }`);
    }
    const shape = this.#issue(out, p, JSON.stringify(expectedOf(node)), v);
    const wrongKey = this.#issue(
      out,
      join(p, discriminant.key),
      JSON.stringify(expectedForDiscriminant(discriminant)),
      `${v}${accessor(discriminant.key)}`,
    );
    return [`if (!(${recordTest(v)})) { ${shape} } else ${branches.join(' else ')} else { ${wrongKey} }`];
  }

  // -------------------------------------------------------------------------
  // Target: sample
  // -------------------------------------------------------------------------

  /**
   * A value that satisfies `node` **by construction**. Where that cannot be promised the
   * emitter refuses, which is the difference between this and what it replaced: the old
   * generator answered `'x'` for an arbitrary `pattern`, so `is(random(d), d)` — the one
   * property it claimed — was false.
   */
  #sample(node: TypeIR, path: string): string | undefined {
    switch (node.kind) {
      case 'unsupported':
        return this.#refuse(path, node.reason, node.source);
      case 'unknown':
      case 'null':
        return 'null';
      case 'undefined':
        return 'undefined';
      case 'literal':
        return JSON.stringify(node.value);
      case 'scalar':
        return this.#scalarSample(node, path);
      case 'tuple': {
        const elements: string[] = [];
        for (const [index, element] of node.elements.entries()) {
          const sample = this.#sample(element, `${path}[${index}]`);
          if (sample === undefined) return undefined;
          elements.push(sample);
        }
        return `[${elements.join(', ')}]`;
      }
      case 'array':
        return this.#arraySample(node, path);
      case 'object': {
        const entries: string[] = [];
        for (const property of node.properties) {
          const sample = this.#sample(property.type, join(path, property.name));
          if (sample === undefined) return undefined;
          entries.push(`${JSON.stringify(property.name)}: ${sample}`);
        }
        return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
      }
      case 'union':
        return this.#unionSample(node, path);
      case 'ref':
        return this.#refuse(path, `\`${node.name}\` recurs with no terminating arm, so no finite value satisfies it`);
    }
  }

  #arraySample(node: ArrayIR, path: string): string | undefined {
    const element = this.#sample(node.element, `${path}[]`);
    if (element === undefined) return undefined;
    const min = node.constraints?.minLength ?? 1;
    const max = node.constraints?.maxLength ?? Math.max(min, 3);
    if (min > max) return this.#refuse(path, `an array with minLength ${min} above maxLength ${max}`);
    const name = this.#function(
      'SampleArray',
      [],
      [
        `const _n = ${this.#randInt(min, max)};`,
        `const _a = []; for (let _i = 0; _i < _n; _i++) _a.push(${element});`,
        'return _a;',
      ],
    );
    return name === undefined ? undefined : `${name}()`;
  }

  #unionSample(node: UnionIR, path: string): string | undefined {
    // Back-references are dropped rather than sampled: `Node_ { next: Node_ | null }`
    // has a terminating arm and the generator takes it. A `ref` with no way out is the
    // refusal in `#sample`.
    const usable = node.members.filter(member => member.kind !== 'ref');
    if (usable.length === 0) {
      return this.#refuse(path, 'a union of nothing but back-references cannot be sampled');
    }
    const options: string[] = [];
    for (const [index, member] of usable.entries()) {
      const sample = this.#sample(member, `${path}|${index}`);
      if (sample === undefined) return undefined;
      options.push(sample);
    }
    // boundary: `usable` is non-empty — the line above returns otherwise — and the loop
    // pushes exactly one option per member or returns, so `options` has at least one
    // element. `noUncheckedIndexedAccess` cannot follow that, and the alternatives are a
    // refusal for a case that cannot happen or a default sample that would be emitted.
    const first = options[0] as string;
    if (options.length === 1) return first;
    const cases = options.map((option, index) => `case ${index}: return ${option};`);
    const name = this.#function(
      'SampleUnion',
      [],
      [`switch (${this.#randInt(0, options.length - 1)}) { ${cases.join(' ')} }`, `return ${first};`],
    );
    return name === undefined ? undefined : `${name}()`;
  }

  #scalarSample(node: ScalarIR, path: string): string | undefined {
    const constraints = node.constraints;
    switch (node.scalar) {
      case 'boolean':
        return 'Math.random() < 0.5';
      case 'date':
        // The same instant the runtime sampler draws, and for the same reason: one documented
        // function should not mean "now" when the transformer inlined it and "an arbitrary
        // instant" when it did not. Epoch to roughly 2024.
        return 'new Date(Math.floor(Math.random() * 1700000000000))';
      case 'number':
      case 'integer':
      case 'bigint': {
        const min = constraints?.minimum ?? 0;
        const max = constraints?.maximum ?? min + 1000;
        if (min > max) return this.#refuse(path, `a bound with minimum ${min} above maximum ${max}`);
        const int = this.#randInt(min, max);
        return node.scalar === 'bigint' ? `BigInt(${int})` : int;
      }
      case 'string': {
        if (constraints?.pattern !== undefined) {
          return this.#refuse(
            path,
            'a sample cannot be built from a `pattern`; nothing here inverts a regular expression',
            constraints.pattern,
          );
        }
        const min = constraints?.minLength ?? 1;
        const max = constraints?.maxLength ?? Math.max(min, 12);
        if (min > max) return this.#refuse(path, `a string with minLength ${min} above maxLength ${max}`);
        if (!this.#hasStringSample) {
          this.#hasStringSample = true;
          this.#helpers.push(
            `function ${this.#prefix}Str(min, max) { let s = ""; while (s.length < Math.max(min, 1)) s += Math.random().toString(36).slice(2); return s.slice(0, max); }`,
          );
        }
        return `${this.#prefix}Str(${min}, ${max})`;
      }
    }
  }

  #randInt(min: number, max: number): string {
    if (!this.#hasIntSample) {
      this.#hasIntSample = true;
      this.#helpers.push(
        `function ${this.#prefix}Int(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }`,
      );
    }
    return `${this.#prefix}Int(${min}, ${max})`;
  }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

/**
 * The shape half of a scalar check, without its bounds. Shared by `check` and `issues`
 * so the two cannot drift apart about what a `number` is.
 *
 * `NaN` is rejected: it cannot cross a JSON boundary, and the runtime walker has always
 * rejected it. The emitted form used not to, which is one of the divergences REQ-AV-4
 * exists to close.
 */
function scalarBase(scalar: ScalarIR['scalar'], v: string): string {
  switch (scalar) {
    case 'string':
      return `typeof ${v} === "string"`;
    case 'number':
      return `typeof ${v} === "number" && !Number.isNaN(${v})`;
    case 'integer':
      return `Number.isInteger(${v})`;
    case 'bigint':
      return `typeof ${v} === "bigint"`;
    case 'boolean':
      return `typeof ${v} === "boolean"`;
    case 'date':
      return `${v} instanceof Date && !Number.isNaN(${v}.getTime())`;
  }
}

/** `.email`, or `["odd name"]` when the property is not a plain identifier. */
function accessor(name: string): string {
  return IDENTIFIER.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

/**
 * Extend a path *expression* with a static key, folding when it is already a literal so
 * the emitted code reads `"input.email"` rather than `"input" + ".email"`.
 *
 * boundary: `JSON.parse` returns `any`, and the assertion says the parse of a JSON string
 * literal is a string. `STRING_LITERAL` is what establishes that — it matches a complete
 * double-quoted JSON string and nothing else, so the parse cannot return a number or an
 * object. `indexed` below carries the same argument.
 */
function join(pathExpr: string, key: string): string {
  const suffix = IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
  if (STRING_LITERAL.test(pathExpr)) return JSON.stringify(`${JSON.parse(pathExpr) as string}${suffix}`);
  return `${pathExpr} + ${JSON.stringify(suffix)}`;
}

/**
 * Extend a path expression with an index, which for an array is only known at runtime.
 *
 * boundary: as in `join` — `STRING_LITERAL` proves the parse yields a string.
 */
function indexed(pathExpr: string, index: string): string {
  if (STRING_LITERAL.test(pathExpr) && NUMERIC.test(index)) {
    return JSON.stringify(`${JSON.parse(pathExpr) as string}[${index}]`);
  }
  return `${pathExpr} + "[" + ${index} + "]"`;
}

function capitalise(name: string): string {
  const cleaned = name.replaceAll(/[^A-Za-z0-9]/g, '');
  if (cleaned.length === 0) return 'T';
  return `${cleaned.slice(0, 1).toUpperCase()}${cleaned.slice(1)}`;
}

export {
  discriminantOf,
  expectedForConstraint,
  expectedForDiscriminant,
  expectedOf,
  hasExcessCheck,
  messageFor,
} from './shape.js';
export type { ConstraintKeyword, Discriminant, DiscriminantArm } from './shape.js';
