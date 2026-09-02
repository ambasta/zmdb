// Finding the call sites the transformer replaces.
//
// `is<User>(x)` is the whole user-facing API of the AOT validator, so "which calls in
// this file take a type argument and name one of our functions" is a question both
// the reflection tests and the transformer ask. It is one walk, so it is one function.
//
// Matching is by *identifier text*, not by symbol. That is a deliberate limitation
// with a name: a local `const is = ...` that shadows the import would be rewritten
// too. Resolving the symbol would cost a checker round-trip per call site, and the
// import shape is asserted separately, so the trade is recorded here rather than
// silently taken.

import type { CallExpression, Node, SourceFile, TypeNode } from 'typescript/unstable/ast';
import { isCallExpression, isIdentifier, isPropertyAccessExpression } from 'typescript/unstable/ast/is';

export interface CallSite {
  /** The identifier being called: `is`, `assert`, `validate`, `toJsonSchema`. */
  readonly callee: string;
  /** The single type argument. A call with none is not a call site. */
  readonly typeArgument: TypeNode;
  readonly node: CallExpression;
}

/** `is(...)` → `is`; `v.is(...)` → `is`; anything else → `undefined`. */
function calleeName(call: CallExpression): string | undefined {
  const target = call.expression;
  if (isIdentifier(target)) return target.text;
  if (isPropertyAccessExpression(target) && isIdentifier(target.name)) return target.name.text;
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
      const callee = calleeName(node);
      if (typeArgument && callee !== undefined && callees.has(callee)) {
        found.push({ callee, typeArgument, node });
      }
    }
    node.forEachChild(visit);
    return undefined;
  };

  sourceFile.forEachChild(visit);
  return found;
}
