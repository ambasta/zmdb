// Finding the call sites the transformer replaces.
//
// The generic `findCallSites` helper remains text-based because reflection fixtures use
// local probe functions. Production transformation uses `findOwnedCallSites` instead.
// The five protobuf/gRPC calls resolve strictly to exports of `@zmdb/protobuf`, so a
// local shadow, foreign same-named export, or old forwarding package is not a target.
// Existing validator/schema calls retain their historical text-based forwarding support.

import type { CallExpression, Node, SourceFile, TypeNode } from 'typescript/unstable/ast';
import {
  isCallExpression,
  isIdentifier,
  isImportDeclaration,
  isPropertyAccessExpression,
  isStringLiteral,
} from 'typescript/unstable/ast/is';
import { SymbolFlags, type Checker, type Symbol as TsSymbol } from 'typescript/unstable/sync';

export const CALL_OWNERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  is: ['@zmdb/aot-validator/utilities', 'zmdb'],
  isShallow: ['@zmdb/aot-validator/utilities', 'zmdb'],
  assert: ['@zmdb/aot-validator/utilities', 'zmdb'],
  assertShallow: ['@zmdb/aot-validator/utilities', 'zmdb'],
  equals: ['@zmdb/aot-validator/utilities', 'zmdb'],
  assertEquals: ['@zmdb/aot-validator/utilities', 'zmdb'],
  validate: ['@zmdb/aot-validator/utilities', 'zmdb'],
  validateShallow: ['@zmdb/aot-validator/utilities', 'zmdb'],
  random: ['@zmdb/aot-validator/utilities', 'zmdb'],
  toJsonSchema: ['@zmdb/schema-core/openapi', 'zmdb'],
  schemaOf: ['@zmdb/schema-core', 'zmdb'],
  toolFor: ['@zmdb/schema-core/llm'],
  grpcDescriptor: ['@zmdb/protobuf'],
  loadGrpcService: ['@zmdb/protobuf'],
  protoDescriptor: ['@zmdb/protobuf'],
  protoDecode: ['@zmdb/protobuf'],
  protoEncode: ['@zmdb/protobuf'],
});

export const OWNED_CALLEES: ReadonlySet<string> = new Set(Object.keys(CALL_OWNERS));
export const STRICT_OWNER_CALLEES: ReadonlySet<string> = new Set([
  'grpcDescriptor',
  'loadGrpcService',
  'protoDescriptor',
  'protoDecode',
  'protoEncode',
]);

export interface CallSite {
  /** The canonical exported name, even when the local import is aliased. */
  readonly callee: string;
  /** The local named-import binding, or the namespace binding for `ns.callee`. */
  readonly binding: string;
  /** The owner module whose export resolved to this call. */
  readonly specifier?: string;
  /** The single type argument. A call with none is not a call site. */
  readonly typeArgument: TypeNode;
  readonly node: CallExpression;
}

/** `is(...)` → `is`; `v.is(...)` → `is`; anything else → `undefined`. */
function calleeName(call: CallExpression): { readonly callee: string; readonly binding: string } | undefined {
  const target = call.expression;
  if (isIdentifier(target)) return { callee: target.text, binding: target.text };
  if (isPropertyAccessExpression(target) && isIdentifier(target.name) && isIdentifier(target.expression)) {
    return { callee: target.name.text, binding: target.expression.text };
  }
  return undefined;
}

/**
 * Every call to one of `callees` that carries a type argument, in source order.
 *
 * Source order matters downstream: the transformer rewrites by text offset, and
 * rewriting back-to-front is what keeps earlier offsets valid.
 */
export function findCallSites(sourceFile: SourceFile, callees: ReadonlySet<string>): readonly CallSite[] {
  const found: CallSite[] = [];

  // `forEachChild` is a method on the node, not a free function: it is not among the
  // exports of `typescript/unstable/ast`, which only offers the *visitor* (rewriting)
  // half of the pair.
  const visit = (node: Node): undefined => {
    if (isCallExpression(node)) {
      const typeArgument = node.typeArguments?.[0];
      const named = calleeName(node);
      if (typeArgument && named !== undefined && callees.has(named.callee)) {
        found.push({ ...named, typeArgument, node });
      }
    }
    node.forEachChild(visit);
    return undefined;
  };

  sourceFile.forEachChild(visit);
  return found;
}

function resolved(checker: Checker, symbol: TsSymbol | undefined): TsSymbol | undefined {
  if (symbol === undefined) return undefined;
  return (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
}

function importedExports(
  sourceFile: SourceFile,
  checker: Checker,
  callees: ReadonlySet<string>,
  owners: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<number, { readonly callee: string; readonly specifier: string }> {
  const bySymbol = new Map<number, { readonly callee: string; readonly specifier: string }>();

  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const candidates = [...callees].filter(callee => owners[callee]?.includes(specifier) === true);
    if (candidates.length === 0) continue;

    const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (module === undefined) continue;
    const exports = new Map(checker.getExportsOfModule(module).map(symbol => [symbol.name, symbol]));
    for (const callee of candidates) {
      const symbol = resolved(checker, exports.get(callee));
      if (symbol !== undefined) bySymbol.set(symbol.id, { callee, specifier });
    }
  }

  return bySymbol;
}

function callTarget(call: CallExpression): { readonly location: Node; readonly binding: string } | undefined {
  const target = call.expression;
  if (isIdentifier(target)) return { location: target, binding: target.text };
  if (isPropertyAccessExpression(target) && isIdentifier(target.name) && isIdentifier(target.expression)) {
    return { location: target.name, binding: target.expression.text };
  }
  return undefined;
}

export interface OwnedCallOptions {
  /**
   * Test-only escape for synthetic global declarations. Production callers leave
   * this false; strict-owner calls then require a matching `CALL_OWNERS` import.
   */
  readonly allowUnbound?: boolean;
}

/**
 * Calls whose resolved symbol is an allowed package export, plus legacy
 * text-matched validator/schema calls that intentionally retain forwarding support.
 *
 * The canonical export table is built only from owner modules the file actually
 * imports. Strict-owner calls therefore cannot match a foreign same-named function
 * by structural type or text.
 */
export function findOwnedCallSites(
  sourceFile: SourceFile,
  checker: Checker,
  callees: ReadonlySet<string>,
  owners: Readonly<Record<string, readonly string[]>>,
  options: OwnedCallOptions = {},
): readonly CallSite[] {
  if (options.allowUnbound === true) return findCallSites(sourceFile, callees);

  const canonical = importedExports(sourceFile, checker, callees, owners);
  const found: CallSite[] = [];

  const visit = (node: Node): undefined => {
    if (isCallExpression(node)) {
      const typeArgument = node.typeArguments?.[0];
      const target = callTarget(node);
      if (typeArgument !== undefined && target !== undefined) {
        const symbol = resolved(checker, checker.getSymbolAtLocation(target.location));
        const owned = symbol === undefined ? undefined : canonical.get(symbol.id);
        if (owned !== undefined) {
          found.push({
            callee: owned.callee,
            binding: target.binding,
            specifier: owned.specifier,
            typeArgument,
            node,
          });
        } else {
          const named = calleeName(node);
          if (named !== undefined && callees.has(named.callee) && !STRICT_OWNER_CALLEES.has(named.callee)) {
            // Validator/schema calls retain their established forwarding support.
            // The new protobuf boundary is deliberately stricter because those old
            // owners are removed rather than kept as compatibility aliases.
            found.push({ ...named, typeArgument, node });
          }
        }
      }
    }
    node.forEachChild(visit);
    return undefined;
  };

  sourceFile.forEachChild(visit);
  return found;
}
