// The front door: source text in, source text out.
//
// Two paths, and the split is the whole point of Phase 5.
//
// `transformFile` is the real one. It asks the compiler what `T` is, reflects the answer
// into IR, and hands the IR to the emitter. Every type TypeScript can express is
// therefore either understood exactly or refused by name (REQ-TF-8).
//
// `transformCode` is what is left of the old text-based transformer: `validate(tags.X,
// …)` inlining, which needs no types because the rule is spelled out at the call site.
// It used to *also* parse type arguments with a 60-line hand-rolled parser, and that is
// deleted rather than kept as a fallback. `f70186c6` is the reason: the parser read
// `string[]` as `string` and `number | string` as `number`, so a call was inlined to a
// check that answers a different question, and a wrong answer that looks right is worse
// than no answer at all. A call site the checker cannot reach is now left alone.
//
// Rewriting is by text offset rather than by AST printing, because `sourceFile.text` is
// byte-identical to the file on disk (measured) and every other byte of the file — the
// comments, the formatting, the sourcemap-relevant line breaks — should survive
// untouched. The price is that the offsets are only valid for the exact text the
// compiler parsed, so `transformFile` checks that before it trusts one.

import type { ToolProvider } from '@zmdb/ai';
import type { SchemaIR, ShapeIR, TypeIR } from '@zmdb/schema-core/ir';
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast';
import {
  isLiteralTypeNode,
  isNumericLiteral,
  isPrefixUnaryExpression,
  isStringLiteral,
} from 'typescript/unstable/ast/is';
import { visitEachChild } from 'typescript/unstable/ast/visitor';
import type { Type } from 'typescript/unstable/sync';

import { Emitter, escapePattern, type EmitOptions } from './emit/index.js';
import type { GrpcServiceIR } from './protobuf/grpc-ir.js';
import { CALL_OWNERS, findOwnedCallSites, OWNED_CALLEES, type CallSite } from './reflect/callsites.js';
import { Reflector, type ReflectOptions } from './reflect/index.js';
import type { ReflectSession } from './reflect/session.js';
import { MAX_REGEX_CACHE_SIZE, validatePatternComplexity } from './regex-complexity.js';
import type { TypeDescriptor } from './utilities/index.js';

export { escapePattern };

/**
 * The calls `transformFile` rewrites. Matched by identifier text — see `callsites.ts`.
 *
 * Exported because `zmdb-codegen` asks the same question about the same names, and
 * two lists would drift: a callee added here and not there is a call the bundler inlines
 * and the CLI leaves as a runtime walk, which is a silent performance cliff between two
 * paths that are supposed to be equivalent.
 */
export const CALLEES: ReadonlySet<string> = OWNED_CALLEES;

/**
 * What the reflector made of the type argument.
 *
 * Three shapes because there are three questions. The validation callees ask "what does
 * a value of this type look like", which is the structural walk. `toJsonSchema<T>()` asks
 * "which columns does this document describe", which needs per-property optionality and
 * tags and no structure below the first level. `schemaOf<T>()` asks "which table is this",
 * which additionally wants a name, a primary key and the relations — and refuses a type
 * that has no `Table<'name'>` tag, where a document is happy with a `Pick`.
 *
 * Reflecting one and emitting from another would mean re-deriving in the emitter what the
 * checker already knew.
 */
type Reflected =
  | { readonly kind: 'type'; readonly node: TypeIR }
  | { readonly kind: 'shape'; readonly shape: ShapeIR }
  | { readonly kind: 'schema'; readonly ir: SchemaIR }
  | { readonly kind: 'grpc'; readonly service: GrpcServiceIR }
  | { readonly kind: 'protobuf'; readonly node: TypeIR; readonly name: string };

type EmissionDepth =
  | { readonly kind: 'full' }
  | { readonly kind: 'shallow'; readonly value: number }
  | { readonly kind: 'refused'; readonly reason: string };

const SHALLOW_CALLEES: ReadonlySet<string> = new Set(['isShallow', 'assertShallow', 'validateShallow']);
const TOOL_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'openai-strict', 'anthropic', 'gemini', 'json-schema']);
type ToolProviderTarget = ToolProvider | 'dynamic';

export interface TransformOptions {
  sourceFile?: unknown;
  checker?: unknown;
  id?: string;
}

type PType = { kind: 'number' | 'string' | 'boolean' } | { kind: 'object'; fields: { name: string; type: PType }[] };

/** A call site left alone, and why. Plan D4: the build reports these as errors. */
export interface TransformDiagnostic {
  readonly fileName: string;
  /** Offset of the call this came from, when it came from one. */
  readonly position?: number;
  readonly callee?: string;
  /** The property chain within the type that reached the refusal. */
  readonly path: string;
  readonly reason: string;
  /** The type as the checker prints it, when that is more use than the path. */
  readonly source?: string;
}

export interface TransformResult {
  readonly code: string;
  readonly changed: boolean;
  readonly diagnostics: readonly TransformDiagnostic[];
}

export interface TransformContext {
  /** One session per build, held open by the caller. See `session.ts`. */
  readonly session: ReflectSession;
  readonly emit?: EmitOptions;
  readonly reflect?: ReflectOptions;
  /** Synthetic test projects can opt into their ambient global call declarations. */
  readonly allowUnboundCallees?: boolean;
}

/**
 * Rewrite every reachable validation call in one file.
 *
 * The file must be part of the session's project and its text must be what the compiler
 * parsed. When either does not hold the offsets are meaningless, so this degrades to
 * `transformCode` and says so, rather than rewriting at a position it guessed.
 */
export function transformFile(fileName: string, code: string, context: TransformContext): TransformResult {
  const { session } = context;

  const sourceFile = session.sourceFile(fileName);
  if (!sourceFile) {
    return degrade(fileName, code, 'this file is not part of the TypeScript project the session loaded');
  }
  if (sourceFile.text !== code) {
    // Another plugin got here first, or the watcher is a revision behind. Either way the
    // AST describes text we do not have, and an offset into the wrong string lands in
    // the middle of an identifier.
    return degrade(
      fileName,
      code,
      'the text handed to the transformer is not the text the compiler parsed, so every offset in it would be a guess',
    );
  }

  const sites = findOwnedCallSites(sourceFile, session.checker, CALLEES, CALL_OWNERS, {
    allowUnbound: context.allowUnboundCallees === true,
  });
  if (sites.length === 0) {
    const out = transformCode(code);
    return { code: out, changed: out !== code, diagnostics: [] };
  }

  const emitter = new Emitter(context.emit);
  // One reflector for the file, so two `is<User>(…)` calls agree on `User`'s name and
  // the emitter can then share one hoisted helper between them.
  const reflector = new Reflector(session.checker, sourceFile, context.reflect);
  const diagnostics: TransformDiagnostic[] = [];
  const rewriter = new Rewriter(code);
  let rewritten = 0;

  // Back to front. `findCallSites` walks pre-order, so reversing puts the innermost and
  // last call first, which is what keeps the offsets of everything before it valid.
  for (const site of sites.toReversed()) {
    const position = site.node.getStart();
    const reflectedAt = reflector.diagnostics.length;
    const emittedAt = emitter.diagnostics.length;
    const depth = emissionDepth(site);
    if (depth.kind === 'refused') {
      diagnostics.push({
        fileName,
        position,
        callee: site.callee,
        path: '',
        reason: depth.reason,
      });
      continue;
    }

    const type = session.checker.getTypeFromTypeNode(site.typeArgument);
    if (!type) {
      // The checker has no type for a node it parsed, which in practice means the file
      // has an error in it. Rewriting from a type the compiler could not resolve is the
      // one thing this path exists to avoid.
      diagnostics.push({
        fileName,
        position,
        callee: site.callee,
        path: '',
        reason: 'the compiler could not resolve this type argument; the file probably does not compile',
      });
      continue;
    }
    const reflected: Reflected = reflect(reflector, site.callee, type);

    const provider = site.callee === 'toolFor' ? toolProvider(site) : undefined;
    if (site.callee === 'toolFor' && provider === undefined) {
      diagnostics.push({
        fileName,
        position,
        callee: site.callee,
        path: '',
        reason: '`toolFor<T>` needs a provider argument',
      });
      continue;
    }
    if (site.callee === 'toolFor' && site.node.arguments[1] === undefined) {
      diagnostics.push({
        fileName,
        position,
        callee: site.callee,
        path: '',
        reason: '`toolFor<T>` needs a tool name',
      });
      continue;
    }

    const refusals = reflector.diagnostics.slice(reflectedAt);
    if (refusals.length > 0) {
      // The type is only partly understood, so nothing is emitted from it. This is the
      // f70186c6 rule applied to the checker-driven path: partial knowledge produces a
      // named build error, never a partial check.
      for (const refusal of refusals) diagnostics.push({ fileName, position, callee: site.callee, ...refusal });
      continue;
    }

    const replacement = emitFor(
      emitter,
      site,
      reflected,
      rewriter,
      depth.kind === 'shallow' ? depth.value : undefined,
      provider,
    );
    if (replacement === undefined) {
      const emitted = emitter.diagnostics.slice(emittedAt);
      if (emitted.length === 0) {
        diagnostics.push({
          fileName,
          position,
          callee: site.callee,
          path: '',
          reason: `\`${site.callee}<T>()\` needs a value to check`,
        });
      }
      for (const refusal of emitted) diagnostics.push({ fileName, position, callee: site.callee, ...refusal });
      continue;
    }

    rewriter.replace(position, site.node.end, replacement);
    rewritten += 1;
  }

  let out = transformCode(rewriter.text);
  // No prelude when nothing was rewritten. A refused site can still have hoisted a helper
  // on its way to the refusal — `random<T>` reserves its integer sampler before it
  // discovers the `pattern` it cannot invert — and emitting that alone would leave dead
  // code in a file the transformer decided not to touch.
  if (rewritten > 0 && emitter.hasPrelude) out = withPrelude(out, emitter.prelude());
  return { code: out, changed: out !== code, diagnostics };
}

function emissionDepth(site: CallSite): EmissionDepth {
  if (!SHALLOW_CALLEES.has(site.callee)) return { kind: 'full' };

  const argument = site.node.typeArguments?.[1];
  if (argument === undefined) return { kind: 'shallow', value: 1 };
  if (!isLiteralTypeNode(argument)) {
    return { kind: 'refused', reason: '`depth` must be a positive integer literal type' };
  }

  const literal = argument.literal;
  let value: number | undefined;
  if (isNumericLiteral(literal)) {
    value = Number(literal.text);
  } else if (
    isPrefixUnaryExpression(literal) &&
    (literal.operator === SyntaxKind.PlusToken || literal.operator === SyntaxKind.MinusToken) &&
    isNumericLiteral(literal.operand)
  ) {
    const magnitude = Number(literal.operand.text);
    value = literal.operator === SyntaxKind.MinusToken ? -magnitude : magnitude;
  }

  if (value === undefined) {
    return { kind: 'refused', reason: '`depth` must be a positive integer literal type' };
  }
  if (!Number.isInteger(value) || value <= 0) {
    return { kind: 'refused', reason: '`depth` must be a positive integer literal' };
  }
  return { kind: 'shallow', value };
}

function degrade(fileName: string, code: string, reason: string): TransformResult {
  const out = transformCode(code);
  return { code: out, changed: out !== code, diagnostics: [{ fileName, path: '', reason }] };
}

function reflect(reflector: Reflector, callee: string, type: Type): Reflected {
  switch (callee) {
    case 'toJsonSchema':
      return { kind: 'shape', shape: reflector.shapeIR(type) };
    case 'schemaOf':
    case 'toolFor':
      return { kind: 'schema', ir: reflector.schemaIR(type) };
    case 'grpcDescriptor':
    case 'loadGrpcService':
      return { kind: 'grpc', service: reflector.grpcServiceIR(type) };
    case 'protoDescriptor':
    case 'protoDecode':
    case 'protoEncode':
      return { kind: 'protobuf', node: reflector.protobufIR(type), name: protobufName(type) };
    default:
      return { kind: 'type', node: reflector.typeIR(type) };
  }
}

function emitFor(
  emitter: Emitter,
  site: CallSite,
  reflected: Reflected,
  rewriter: Rewriter,
  maxDepth?: number,
  provider?: ToolProviderTarget,
) {
  if (site.callee === 'toolFor' && reflected.kind === 'schema' && provider !== undefined) {
    const providerArgument = site.node.arguments[0];
    const name = site.node.arguments[1];
    if (providerArgument === undefined || name === undefined) return undefined;
    const providerExpression = rewriter.slice(providerArgument.getStart(), providerArgument.end);
    const nameExpression = rewriter.slice(name.getStart(), name.end);
    const options = site.node.arguments[2];
    const optionsExpression = options === undefined ? undefined : rewriter.slice(options.getStart(), options.end);
    if (provider !== 'dynamic') {
      const parameters = emitter.emitToolSchema(reflected.ir, provider);
      return parameters === undefined ? undefined : toolFrame(provider, nameExpression, parameters, optionsExpression);
    }
    const documents = toolProviders().map(target => {
      const parameters = emitter.emitToolSchema(reflected.ir, target);
      return parameters === undefined ? undefined : { provider: target, parameters };
    });
    if (documents.some(document => document === undefined)) return undefined;
    return toolFrameDynamic(
      providerExpression,
      nameExpression,
      documents.filter(document => document !== undefined),
      optionsExpression,
    );
  }

  // Both of these are the answer itself, so there is nothing to check and no argument
  // to read.
  if (reflected.kind === 'shape') return emitter.emitJsonSchema(reflected.shape);
  if (reflected.kind === 'schema') return emitter.emitSchemaValue(reflected.ir);
  if (reflected.kind === 'grpc') {
    const names = grpcNames(site, emitter);
    if (names === undefined) return undefined;
    return site.callee === 'grpcDescriptor'
      ? emitter.emitGrpcDescriptor(reflected.service, names.service, names.pkg)
      : emitter.emitGrpcService(reflected.service, names.service, names.pkg);
  }
  if (reflected.kind === 'protobuf' && site.callee === 'protoDescriptor') {
    return emitter.emitProtoDescriptor(reflected.node, reflected.name);
  }

  const node = reflected.node;
  if (site.callee === 'random') return emitter.emitRandom(node);

  const argument = site.node.arguments[0];
  if (!argument) return undefined;
  // Read through the rewriter, not the original text: in `assert<A>(is<B>(x))` the inner
  // call has already been replaced, and taking the original text here would carry a live
  // `is<B>(x)` into the output and silently undo it.
  const expression = rewriter.slice(argument.getStart(), argument.end);

  switch (site.callee) {
    case 'protoDecode':
      return emitter.emitProtoDecode(node, reflected.kind === 'protobuf' ? reflected.name : 'Message', expression);
    case 'protoEncode':
      return emitter.emitProtoEncode(node, reflected.kind === 'protobuf' ? reflected.name : 'Message', expression);
    case 'is':
      return emitter.emitIs(node, expression);
    case 'isShallow':
      return emitter.emitIs(node, expression, maxDepth);
    case 'equals':
      return emitter.emitEquals(node, expression);
    case 'assert':
      return emitter.emitAssert(node, expression, false);
    case 'assertShallow':
      return emitter.emitAssert(node, expression, false, maxDepth);
    case 'assertEquals':
      return emitter.emitAssert(node, expression, true);
    case 'validate':
      return emitter.emitValidate(node, expression);
    case 'validateShallow':
      return emitter.emitValidate(node, expression, false, maxDepth);
    default:
      return undefined;
  }
}

function toolProvider(site: CallSite): ToolProviderTarget | undefined {
  const argument = site.node.arguments[0];
  if (argument === undefined) return undefined;
  if (!isStringLiteral(argument)) return 'dynamic';
  if (!TOOL_PROVIDERS.has(argument.text)) return undefined;
  switch (argument.text) {
    case 'openai':
    case 'openai-strict':
    case 'anthropic':
    case 'gemini':
    case 'json-schema':
      return argument.text;
  }
}

function toolProviders(): readonly ToolProvider[] {
  return ['openai', 'openai-strict', 'anthropic', 'gemini', 'json-schema'];
}

function toolFrame(provider: ToolProvider, name: string, parameters: string, options: string | undefined): string {
  const description = options === undefined ? '' : '...(_o?.description ? { description: _o.description } : {}), ';
  let body: string;
  switch (provider) {
    case 'openai':
      body = `{ type: "function", function: { name: _n, ${description}parameters: ${parameters} } }`;
      break;
    case 'openai-strict':
      body = `{ type: "function", function: { name: _n, ${description}strict: true, parameters: ${parameters} } }`;
      break;
    case 'anthropic':
      body = `{ name: _n, ${description}input_schema: ${parameters} }`;
      break;
    case 'gemini':
    case 'json-schema':
      body = `{ name: _n, ${description}parameters: ${parameters} }`;
      break;
  }
  return options === undefined ? `((_n) => (${body}))(${name})` : `((_n, _o) => (${body}))(${name}, ${options})`;
}

function toolFrameDynamic(
  provider: string,
  name: string,
  documents: readonly { readonly provider: ToolProvider; readonly parameters: string }[],
  options: string | undefined,
): string {
  const cases = documents
    .map(document => {
      const framed = toolFrame(document.provider, '_n', document.parameters, options === undefined ? undefined : '_o');
      return `case ${JSON.stringify(document.provider)}: return ${framed};`;
    })
    .join(' ');
  const body = `switch (_p) { ${cases} } throw new Error(\`unsupported tool provider \${String(_p)}\`);`;
  return options === undefined
    ? `((_p, _n) => { ${body} })(${provider}, ${name})`
    : `((_p, _n, _o) => { ${body} })(${provider}, ${name}, ${options})`;
}

function grpcNames(site: CallSite, emitter: Emitter): { readonly service: string; readonly pkg: string } | undefined {
  const service = site.node.arguments[0];
  const pkg = site.node.arguments[1];
  if (service === undefined || pkg === undefined || site.node.arguments.length !== 2) {
    return emitter.refuse('', `\`${site.callee}<S>()\` needs exactly two string literals: service and package`);
  }
  if (!isStringLiteral(service)) {
    return emitter.refuse('service', 'the gRPC service name must be a string literal so the build artifact is stable');
  }
  if (!isStringLiteral(pkg)) {
    return emitter.refuse('package', 'the gRPC package name must be a string literal so the build artifact is stable');
  }
  return { service: service.text, pkg: pkg.text };
}

function protobufName(type: Type): string {
  const alias = type.getAliasSymbol()?.name;
  if (alias !== undefined && alias !== '__type') return alias;
  const symbol = type.getSymbol()?.name;
  return symbol === undefined || symbol === '__type' ? 'Message' : symbol;
}

function primType(prim: string): PType | undefined {
  return prim === 'number' || prim === 'string' || prim === 'boolean' ? { kind: prim } : undefined;
}

// Minimal parser for TS type syntax: primitives and `{ a: T; b: U }` object literals.
function parseType(src: string): PType | undefined {
  let i = 0;
  const s = src.trim();
  function ws() {
    while (i < s.length && /\s/.test(s[i] ?? '')) i++;
  }
  function parse(): PType | undefined {
    ws();
    if (s[i] === '{') {
      i++; // consume {
      const fields: { name: string; type: PType }[] = [];
      ws();
      while (i < s.length && s[i] !== '}') {
        ws();
        let name = '';
        while (i < s.length && /[A-Za-z0-9_$]/.test(s[i] ?? '')) {
          name += s[i] ?? '';
          i++;
        }
        ws();
        if (s[i] === ':') i++; // consume :
        ws();
        let type: PType | undefined;
        if (s[i] === '{') {
          type = parse();
        } else {
          let prim = '';
          while (i < s.length && /[A-Za-z]/.test(s[i] ?? '')) {
            prim += s[i] ?? '';
            i++;
          }
          type = primType(prim);
        }
        if (!type) return undefined;
        fields.push({ name, type });
        ws();
        if (s[i] === ';' || s[i] === ',') i++;
        ws();
      }
      if (s[i] === '}') i++; // consume }
      return { kind: 'object', fields };
    }
    let prim = '';
    while (i < s.length && /[A-Za-z]/.test(s[i] ?? '')) {
      prim += s[i] ?? '';
      i++;
    }
    return primType(prim);
  }
  return parse();
}

function pTypeToTypeDescriptor(t: PType): TypeDescriptor {
  switch (t.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return { kind: t.kind };
    case 'object': {
      const fields: Record<string, TypeDescriptor> = {};
      for (const f of t.fields) {
        fields[f.name] = pTypeToTypeDescriptor(f.type);
      }
      return { kind: 'object', fields };
    }
  }
}

/**
 * Maps a resolved TypeScript type (from ts.TypeChecker) to a TypeDescriptor IR.
 */
export function tsTypeToTypeDescriptor(
  type: unknown,
  checker: unknown,
  locationNode?: unknown,
  depth = 0,
): TypeDescriptor | undefined {
  if (!type || depth > 20) return undefined;
  const tObj = type as Record<string, unknown>;
  const cObj = checker as Record<string, unknown> | undefined;

  if (typeof tObj['isErrorType'] === 'function' && (tObj['isErrorType'] as () => boolean)()) return undefined;

  const typeStr =
    cObj && typeof cObj['typeToString'] === 'function' ? (cObj['typeToString'] as (t: unknown) => string)(type) : '';
  if (typeStr === 'any' || typeStr === 'unknown' || typeStr === 'never') return undefined;
  if (typeStr === 'string') return { kind: 'string' };
  if (typeStr === 'number') return { kind: 'number' };
  if (typeStr === 'boolean') return { kind: 'boolean' };

  if (typeof tObj['isStringLiteralType'] === 'function' && (tObj['isStringLiteralType'] as () => boolean)()) {
    return { kind: 'enum', values: [String(tObj['value'])] };
  }
  if (typeof tObj['isNumberLiteralType'] === 'function' && (tObj['isNumberLiteralType'] as () => boolean)())
    return { kind: 'number' };
  if (typeof tObj['isBooleanLiteralType'] === 'function' && (tObj['isBooleanLiteralType'] as () => boolean)())
    return { kind: 'boolean' };

  const isArr =
    cObj &&
    ((typeof cObj['isArrayType'] === 'function' && (cObj['isArrayType'] as (t: unknown) => boolean)(type)) ||
      (typeof cObj['isTupleType'] === 'function' && (cObj['isTupleType'] as (t: unknown) => boolean)(type)));
  if (isArr) {
    const typeArgs =
      typeof cObj['getTypeArguments'] === 'function'
        ? (cObj['getTypeArguments'] as (t: unknown) => unknown[])(type)
        : undefined;
    const elemType = typeArgs && typeArgs[0];
    const ofDesc = elemType ? tsTypeToTypeDescriptor(elemType, checker, locationNode, depth + 1) : undefined;
    return ofDesc ? { kind: 'array', of: ofDesc } : undefined;
  }

  if (typeof tObj['isUnionType'] === 'function' && (tObj['isUnionType'] as () => boolean)()) {
    const types = typeof tObj['getTypes'] === 'function' ? (tObj['getTypes'] as () => unknown[])() : [];
    const isAllStringLiterals =
      types.length > 0 &&
      types.every((t: unknown) => {
        const item = t as Record<string, unknown>;
        return typeof item['isStringLiteralType'] === 'function' && (item['isStringLiteralType'] as () => boolean)();
      });
    if (isAllStringLiterals) {
      return { kind: 'enum', values: types.map((t: unknown) => String((t as Record<string, unknown>)['value'])) };
    }
    const branches: TypeDescriptor[] = [];
    for (const b of types) {
      const bDesc = tsTypeToTypeDescriptor(b, checker, locationNode, depth + 1);
      if (!bDesc) return undefined;
      branches.push(bDesc);
    }
    return { kind: 'union', branches };
  }

  if (typeof tObj['isIntersectionType'] === 'function' && (tObj['isIntersectionType'] as () => boolean)()) {
    const types = typeof tObj['getTypes'] === 'function' ? (tObj['getTypes'] as () => unknown[])() : [];
    const fields: Record<string, TypeDescriptor> = {};
    for (const b of types) {
      const bDesc = tsTypeToTypeDescriptor(b, checker, locationNode, depth + 1);
      if (bDesc && bDesc.kind === 'object' && bDesc.fields) {
        Object.assign(fields, bDesc.fields);
      }
    }
    return { kind: 'object', fields };
  }

  const props =
    cObj && typeof cObj['getPropertiesOfType'] === 'function'
      ? (cObj['getPropertiesOfType'] as (t: unknown) => { name: string }[])(type)
      : [];
  if (
    (props && props.length > 0) ||
    (typeof tObj['isObjectType'] === 'function' && (tObj['isObjectType'] as () => boolean)())
  ) {
    const fields: Record<string, TypeDescriptor> = {};
    for (const p of props) {
      const propType =
        locationNode && typeof cObj?.['getTypeOfSymbolAtLocation'] === 'function'
          ? (cObj['getTypeOfSymbolAtLocation'] as (s: unknown, l: unknown) => unknown)(p, locationNode)
          : typeof cObj?.['getTypeOfSymbol'] === 'function'
            ? (cObj['getTypeOfSymbol'] as (s: unknown) => unknown)(p)
            : undefined;
      const fDesc = tsTypeToTypeDescriptor(propType, checker, locationNode, depth + 1);
      if (!fDesc) return undefined;
      fields[p.name] = fDesc;
    }
    return { kind: 'object', fields };
  }

  return undefined;
}

export function emitCheckFromDescriptor(d: TypeDescriptor, expr: string): string {
  switch (d.kind) {
    case 'number':
      return `typeof ${expr} === "number"`;
    case 'string':
      return `typeof ${expr} === "string"`;
    case 'boolean':
      return `typeof ${expr} === "boolean"`;
    case 'enum': {
      const values = d.values ?? [];
      return `(${values.map(v => `${expr} === ${JSON.stringify(v)}`).join(' || ')})`;
    }
    case 'array': {
      const ofStr = d.of ? emitCheckFromDescriptor(d.of, '_i') : 'true';
      return `Array.isArray(${expr}) && ((() => { for (const _i of ${expr}) { if (!(${ofStr})) return false; } return true; })())`;
    }
    case 'object': {
      const parts = [`typeof ${expr} === "object"`, `${expr} !== null`];
      for (const [key, fd] of Object.entries(d.fields ?? {})) {
        parts.push(emitCheckFromDescriptor(fd, `${expr}.${key}`));
      }
      return parts.join(' && ');
    }
    case 'union': {
      const branches = d.branches ?? [];
      return `(${branches.map(b => `(${emitCheckFromDescriptor(b, expr)})`).join(' || ')})`;
    }
    default:
      return 'false';
  }
}

export function emitExcessKeyGuardsFromDescriptor(d: TypeDescriptor, expr: string, varPrefix = '_c'): string[] {
  if (d.kind !== 'object' || !d.fields) return [];
  const guards: string[] = [];
  const fieldKeys = Object.keys(d.fields);
  const topCount = fieldKeys.length;
  guards.push(
    `let ${varPrefix} = 0; for (const _ in ${expr}) { if (++${varPrefix} > ${topCount}) return false; } if (${varPrefix} !== ${topCount}) return false;`,
  );
  let idx = 0;
  for (const [key, fd] of Object.entries(d.fields)) {
    if (fd.kind === 'object') {
      guards.push(...emitExcessKeyGuardsFromDescriptor(fd, `${expr}.${key}`, `${varPrefix}_${idx++}`));
    }
  }
  return guards;
}

export function emitEqualsCheckFromDescriptor(d: TypeDescriptor, expr: string): string {
  if (d.kind !== 'object') return emitCheckFromDescriptor(d, expr);
  const check = emitCheckFromDescriptor(d, expr);
  const excess = emitExcessKeyGuardsFromDescriptor(d, expr).join(' ');
  return `((() => { if (!(${check})) return false; ${excess} return true; })())`;
}

function findTypeArgNode(node: unknown, pos: number, typeSrc: string): unknown {
  if (!node) return undefined;
  const n = node as Record<string, unknown>;
  const start = typeof n['getStart'] === 'function' ? (n['getStart'] as () => number)() : (n['pos'] as number);
  const end = typeof n['getEnd'] === 'function' ? (n['getEnd'] as () => number)() : (n['end'] as number);
  const typeArgs = n['typeArguments'] as { getText?: () => string }[] | undefined;
  if (pos >= start - 20 && pos <= end + 20) {
    if (n['kind'] === SyntaxKind.CallExpression && typeArgs && typeArgs.length > 0) {
      return typeArgs[0];
    }
  }

  if (n['kind'] === SyntaxKind.CallExpression && typeArgs && typeArgs.length > 0) {
    if (typeof typeArgs[0]?.getText === 'function' && typeArgs[0].getText() === typeSrc) {
      return typeArgs[0];
    }
  }

  let found: unknown = undefined;
  if (typeof n['forEachChild'] === 'function') {
    (n['forEachChild'] as (cb: (child: unknown) => void) => void)((child: unknown) => {
      const res = findTypeArgNode(child, pos, typeSrc);
      if (res) found = res;
    });
  } else {
    visitEachChild(n as unknown as Parameters<typeof visitEachChild>[0], (child: unknown) => {
      const res = findTypeArgNode(child, pos, typeSrc);
      if (res) found = res;
      return child as Parameters<typeof visitEachChild>[0];
    });
  }
  return found;
}

/** Hoisted helpers go at the top of the module, but after a shebang if there is one. */
function withPrelude(code: string, prelude: string): string {
  if (!code.startsWith('#!')) return `${prelude}\n${code}`;
  const newline = code.indexOf('\n');
  if (newline === -1) return `${code}\n${prelude}\n`;
  return `${code.slice(0, newline + 1)}${prelude}\n${code.slice(newline + 1)}`;
}

/**
 * Text edits in original coordinates, applied back to front, with one twist: `slice`
 * reads the *current* text, so an outer call sees an inner one already rewritten.
 *
 * The bookkeeping is a list of applied edits and their length deltas. Because AST spans
 * nest and never partially overlap, and because callers work backwards, every applied
 * edit is either inside the span being asked about or entirely after it — which is what
 * makes a single sum the right answer.
 */
export class Rewriter {
  #text: string;
  /** Applied edits in original coordinates. Nested ones are folded into their parent. */
  #edits: { start: number; end: number; delta: number }[] = [];

  constructor(text: string) {
    this.#text = text;
  }

  get text(): string {
    return this.#text;
  }

  /** A span of the original text, as it reads now. */
  slice(start: number, end: number): string {
    return this.#text.slice(start, this.#current(start, end));
  }

  /** Replace a span of the original text. Call in descending order of `start`. */
  replace(start: number, end: number, text: string): void {
    const current = this.#current(start, end);
    this.#text = this.#text.slice(0, start) + text + this.#text.slice(current);
    // `text` was built from the current buffer, so it already contains every nested
    // edit. They stop being separate deltas and become part of this one; leaving them
    // in the list would count their lengths twice.
    this.#edits = this.#edits.filter(edit => edit.start < start || edit.end > end);
    this.#edits.push({ start, end, delta: text.length - (end - start) });
  }

  #current(start: number, end: number): number {
    let shift = 0;
    for (const edit of this.#edits) {
      if (edit.start >= start && edit.end <= end) shift += edit.delta;
    }
    return end + shift;
  }
}

// ---------------------------------------------------------------------------
// The no-checker path: `validate(tags.X, expr)`
// ---------------------------------------------------------------------------

function splitTopLevelComma(s: string): [string, string] {
  let depth = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k] ?? '';
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) return [s.slice(0, k), s.slice(k + 1)];
  }
  return [s, ''];
}

function splitArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function inlineCheck(ruleSrc: string, expr: string, ensureRegexCache?: () => void): string {
  const m = /^tags\.(\w+)\((.*)\)$/s.exec(ruleSrc);
  if (!m) return `validate(${ruleSrc}, ${expr})`;
  const kind = m[1] ?? '';
  const args = (m[2] ?? '').trim();
  switch (kind) {
    case 'Min':
      return `(typeof ${expr} === "number" && ${expr} >= ${args})`;
    case 'Max':
      return `(typeof ${expr} === "number" && ${expr} <= ${args})`;
    case 'MinLength':
      return `(typeof ${expr} === "string" && ${expr}.length >= ${args})`;
    case 'MaxLength':
      return `(typeof ${expr} === "string" && ${expr}.length <= ${args})`;
    case 'Pattern': {
      let raw = args.trim();
      const first = raw[0] ?? '';
      const last = raw.length > 0 ? (raw[raw.length - 1] ?? '') : '';
      const isQuoted =
        raw.length >= 2 &&
        ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`'));

      if (!isQuoted || (first === '`' && raw.includes('${'))) {
        if (ensureRegexCache) {
          ensureRegexCache();
          return `(typeof ${expr} === "string" && _getRegExp(${raw}).test(${expr}))`;
        }
        return `(typeof ${expr} === "string" && new RegExp(${raw}).test(${expr}))`;
      }

      raw = raw.slice(1, -1);
      const re = escapePattern(raw);
      validatePatternComplexity(re);
      return `(typeof ${expr} === "string" && /${re}/.test(${expr}))`;
    }
    case 'Enum': {
      const values = splitArgs(args);
      return `(${values.map(v => `${expr} === ${v}`).join(' || ')})`;
    }
    default:
      return `validate(${ruleSrc}, ${expr})`;
  }
}

type MatchKind = 'validate' | 'is' | 'assert' | 'equals' | 'assertEquals';

const MATCH_KINDS: Record<string, MatchKind> = {
  validate: 'validate',
  is: 'is',
  assert: 'assert',
  equals: 'equals',
  assertEquals: 'assertEquals',
};

function getMatchKind(text: string): MatchKind | undefined {
  return MATCH_KINDS[text];
}

/**
 * Inline `validate(tags.X(…), expr)`, or type-checked checks when options/checker is present.
 */
export function transformCode(code: string, options?: TransformOptions): string {
  const scanner = createScanner(false, LanguageVariant.Standard);
  scanner.setText(code);

  let out = '';
  let lastPos = 0;

  const hoisted: string[] = [];
  let hasRegexCache = false;

  const ensureRegexCache = () => {
    if (!hasRegexCache) {
      hasRegexCache = true;
      hoisted.push(
        `const _MAX_REGEX_CACHE_SIZE = ${MAX_REGEX_CACHE_SIZE};\nconst _regexCache = new Map();\nfunction _getRegExp(p) { let re = _regexCache.get(p); if (re) { _regexCache.delete(p); _regexCache.set(p, re); return re; } if (_regexCache.size >= _MAX_REGEX_CACHE_SIZE) { const k = _regexCache.keys().next().value; if (k !== undefined) _regexCache.delete(k); } re = new RegExp(p); _regexCache.set(p, re); return re; }`,
      );
    }
  };

  let token = scanner.scan();
  while (token !== SyntaxKind.EndOfFile) {
    const tokenStart = scanner.getTokenStart();
    const tokenEnd = scanner.getTokenEnd();

    if (tokenStart < lastPos) {
      token = scanner.scan();
      continue;
    }

    const tokenText = scanner.getTokenText();
    const kind = getMatchKind(tokenText);

    if (kind !== undefined) {
      const prevChar = tokenStart > 0 ? (code[tokenStart - 1] ?? '') : '';
      if (!prevChar || !/[A-Za-z0-9_$.]/.test(prevChar)) {
        let i = tokenEnd;
        while (i < code.length && /\s/.test(code[i] ?? '')) i++;

        let typeSrc: string | undefined = undefined;
        if (i < code.length && code[i] === '<') {
          const typeStart = i + 1;
          let depth = 1;
          i++;
          while (i < code.length && depth > 0) {
            if (code[i] === '<') depth++;
            else if (code[i] === '>') depth--;
            i++;
          }
          if (depth === 0) {
            typeSrc = code.slice(typeStart, i - 1).trim();
          }
        }

        while (i < code.length && /\s/.test(code[i] ?? '')) i++;

        if (i < code.length && code[i] === '(') {
          let depth = 1;
          const argStart = i + 1;
          i++;
          while (i < code.length && depth > 0) {
            if (code[i] === '(') depth++;
            else if (code[i] === ')') depth--;
            i++;
          }
          if (depth === 0) {
            const argSrc = code.slice(argStart, i - 1);
            let replacement: string | null = null;

            if (kind === 'validate' && !typeSrc) {
              const [ruleSrc, exprSrc] = splitTopLevelComma(argSrc);
              if (ruleSrc && exprSrc) {
                replacement = inlineCheck(ruleSrc.trim(), exprSrc.trim(), ensureRegexCache);
              }
            } else if (typeSrc) {
              let descriptor: TypeDescriptor | undefined = undefined;
              const t = parseType(typeSrc);
              if (t) {
                descriptor = pTypeToTypeDescriptor(t);
              } else if (options?.checker && options?.sourceFile) {
                const chk = options.checker as Record<string, unknown>;
                const typeArgNode = findTypeArgNode(options.sourceFile, tokenStart, typeSrc);
                if (typeArgNode) {
                  const tsType =
                    typeof chk['getTypeFromTypeNode'] === 'function'
                      ? (chk['getTypeFromTypeNode'] as (node: unknown) => unknown)(typeArgNode)
                      : undefined;
                  descriptor = tsTypeToTypeDescriptor(tsType, options.checker, typeArgNode);
                }
                if (!descriptor && typeof chk['resolveName'] === 'function') {
                  const sym = (chk['resolveName'] as (name: string, flags: number, location: unknown) => unknown)(
                    typeSrc,
                    524288,
                    options.sourceFile,
                  );
                  if (sym && typeof chk['getDeclaredTypeOfSymbol'] === 'function') {
                    const tsType = (chk['getDeclaredTypeOfSymbol'] as (symbol: unknown) => unknown)(sym);
                    descriptor = tsTypeToTypeDescriptor(tsType, options.checker, options.sourceFile);
                  }
                }
              }

              if (descriptor) {
                const expr = argSrc.trim();
                const check = `(${emitCheckFromDescriptor(descriptor, expr)})`;
                if (kind === 'is') {
                  replacement = check;
                } else if (kind === 'equals') {
                  replacement = `(${emitEqualsCheckFromDescriptor(descriptor, expr)})`;
                } else if (kind === 'assert') {
                  replacement = `((() => { if (!${check}) throw new Error("assertion failed"); return ${expr}; })())`;
                } else if (kind === 'assertEquals') {
                  const eq = emitEqualsCheckFromDescriptor(descriptor, expr);
                  replacement = `((() => { if (!(${eq})) throw new Error("assertion failed"); return ${expr}; })())`;
                } else if (kind === 'validate') {
                  replacement = `((${check}) ? { success: true, data: ${expr} } : { success: false, errors: [{ path: "input", expected: "valid type", value: ${expr}, message: "validation failed" }] })`;
                }
              } else {
                console.warn(
                  `[zmdb-aot] Warning: Could not resolve type '${typeSrc}' in ${options?.id ?? 'source file'}, falling back to runtime validation.`,
                );
              }
            }

            if (replacement !== null) {
              out += code.slice(lastPos, tokenStart);
              out += replacement;
              lastPos = i;
            }
          }
        }
      }
    }

    token = scanner.scan();
  }

  out += code.slice(lastPos);
  if (hoisted.length > 0) {
    return hoisted.join('\n') + '\n' + out;
  }
  return out;
}
