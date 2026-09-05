// One general comparison-operator-to-SQL boundary.
//
// The builder deliberately accepts open `op: string` values because database
// extension operators cannot be enumerated centrally. That only stays safe
// while every general operator reaches `sqlOperator` before it reaches SQL
// text. Closed vocabularies such as set operations and expression-valued writes
// are different: their parameter types are finite and their emitters own every
// output token.
//
// This is an AST check rather than a text scan. Strings and comments therefore
// cannot create or hide findings, and a local alias of `predicate.op` remains
// tainted through calls, conditionals and assignments. There is no exemption
// list: clauses.ts contains the one declaration and renderPredicate contains
// the one call.

import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SyntaxKind } from 'typescript/unstable/ast';
import { isExpression } from 'typescript/unstable/ast/is';
import { API } from 'typescript/unstable/sync';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BOUNDARY = 'packages/query-compiler/src/clauses.ts';
const PACKAGES = [
  'client',
  'react',
  'schema-core',
  'ai',
  'ai-anthropic',
  'ai-langchain',
  'ai-vercel',
  'aot-validator',
  'protobuf',
  'repository',
  'query-compiler',
  'app',
  'otel',
  'web',
  'zmdb',
];
const OPERATOR_NAMES = new Set(['op', 'operator']);

const FUNCTION_LIKE = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
]);

const NOT_SHIPPED = [
  /\.spec\.[cm]?tsx?$/,
  /\.type-test\.[cm]?tsx?$/,
  /\/__testing__\//,
  /\/__fixtures__\//,
  /\/testing\//,
];

function isShipped(fileName, packageRoot) {
  if (!fileName.startsWith(`${packageRoot}/src/`)) return false;
  if (fileName.endsWith('.d.ts')) return false;
  if (/\.generated\.[cm]?tsx?$/.test(fileName)) return false;
  if (NOT_SHIPPED.some(pattern => pattern.test(fileName))) return false;
  return /\.[cm]?tsx?$/.test(fileName);
}

function walk(node, visit) {
  visit(node);
  node.forEachChild(child => walk(child, visit));
}

function nameText(name) {
  if (name?.kind === SyntaxKind.Identifier || name?.kind === SyntaxKind.StringLiteral) return name.text;
  return undefined;
}

function functionName(node) {
  const direct = nameText(node.name);
  if (direct !== undefined) return direct;
  const parent = node.parent;
  if (parent?.kind === SyntaxKind.VariableDeclaration || parent?.kind === SyntaxKind.PropertyAssignment) {
    return nameText(parent.name);
  }
  return undefined;
}

function lineOf(sourceFile, node) {
  return sourceFile.text.slice(0, node.getStart()).split('\n').length;
}

function typeIsOpenString(type) {
  if (type === undefined) return true;
  if (type.kind === SyntaxKind.StringKeyword) return true;
  if (type.kind === SyntaxKind.ParenthesizedType) return typeIsOpenString(type.type);
  if (type.kind === SyntaxKind.UnionType || type.kind === SyntaxKind.IntersectionType) {
    return type.types.some(typeIsOpenString);
  }
  return (
    type.kind === SyntaxKind.TypeReference &&
    type.typeName?.kind === SyntaxKind.Identifier &&
    type.typeName.text === 'Operator'
  );
}

function bindingNames(name, found = []) {
  if (name?.kind === SyntaxKind.Identifier) {
    found.push(name.text);
    return found;
  }
  if (name?.kind === SyntaxKind.ObjectBindingPattern || name?.kind === SyntaxKind.ArrayBindingPattern) {
    for (const element of name.elements) {
      if (element.kind === SyntaxKind.BindingElement) bindingNames(element.name, found);
    }
  }
  return found;
}

function operatorBindings(name, found = []) {
  if (name?.kind !== SyntaxKind.ObjectBindingPattern) return found;
  for (const element of name.elements) {
    if (element.kind !== SyntaxKind.BindingElement) continue;
    const source = nameText(element.propertyName) ?? nameText(element.name);
    if (source !== undefined && OPERATOR_NAMES.has(source)) bindingNames(element.name, found);
  }
  return found;
}

function elementName(node) {
  if (node?.kind !== SyntaxKind.ElementAccessExpression) return undefined;
  const argument = node.argumentExpression;
  if (argument?.kind === SyntaxKind.StringLiteral || argument?.kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return argument.text;
  }
  return undefined;
}

function isSqlOperatorCall(node) {
  return (
    node?.kind === SyntaxKind.CallExpression &&
    node.expression?.kind === SyntaxKind.Identifier &&
    node.expression.text === 'sqlOperator'
  );
}

function expressionIsTainted(node, tainted) {
  if (node === undefined) return false;
  switch (node.kind) {
    case SyntaxKind.Identifier:
      return tainted.has(node.text);
    case SyntaxKind.PropertyAccessExpression:
      if (node.name?.text === 'op') return true;
      return expressionIsTainted(node.expression, tainted);
    case SyntaxKind.ElementAccessExpression:
      if (elementName(node) === 'op') return true;
      return expressionIsTainted(node.expression, tainted) || expressionIsTainted(node.argumentExpression, tainted);
    case SyntaxKind.ParenthesizedExpression:
    case SyntaxKind.AsExpression:
    case SyntaxKind.SatisfiesExpression:
    case SyntaxKind.NonNullExpression:
    case SyntaxKind.TypeAssertionExpression:
    case SyntaxKind.AwaitExpression:
    case SyntaxKind.YieldExpression:
    case SyntaxKind.PrefixUnaryExpression:
    case SyntaxKind.PostfixUnaryExpression:
      return expressionIsTainted(node.expression ?? node.operand, tainted);
    case SyntaxKind.BinaryExpression: {
      const preservesOperand =
        node.operatorToken?.kind === SyntaxKind.PlusToken ||
        node.operatorToken?.kind === SyntaxKind.BarBarToken ||
        node.operatorToken?.kind === SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken?.kind === SyntaxKind.QuestionQuestionToken ||
        node.operatorToken?.kind === SyntaxKind.CommaToken ||
        node.operatorToken?.kind === SyntaxKind.EqualsToken;
      return preservesOperand && (expressionIsTainted(node.left, tainted) || expressionIsTainted(node.right, tainted));
    }
    case SyntaxKind.ConditionalExpression:
      return expressionIsTainted(node.whenTrue, tainted) || expressionIsTainted(node.whenFalse, tainted);
    case SyntaxKind.CallExpression:
    case SyntaxKind.NewExpression:
      if (isSqlOperatorCall(node)) return false;
      return (
        expressionIsTainted(node.expression, tainted) ||
        (node.arguments?.some(argument => expressionIsTainted(argument, tainted)) ?? false)
      );
    case SyntaxKind.TemplateExpression:
      return node.templateSpans.some(span => expressionIsTainted(span.expression, tainted));
    case SyntaxKind.TaggedTemplateExpression:
      return expressionIsTainted(node.tag, tainted) || expressionIsTainted(node.template, tainted);
    case SyntaxKind.ArrayLiteralExpression:
      return node.elements.some(element => expressionIsTainted(element, tainted));
    case SyntaxKind.ObjectLiteralExpression:
      return node.properties.some(property => {
        if (property.kind === SyntaxKind.PropertyAssignment) {
          return expressionIsTainted(property.initializer, tainted);
        }
        if (property.kind === SyntaxKind.ShorthandPropertyAssignment) {
          return expressionIsTainted(property.name, tainted);
        }
        if (property.kind === SyntaxKind.SpreadAssignment) {
          return expressionIsTainted(property.expression, tainted);
        }
        return false;
      });
    case SyntaxKind.SpreadElement:
    case SyntaxKind.SpreadAssignment:
      return expressionIsTainted(node.expression, tainted);
    case SyntaxKind.CommaListExpression:
      return node.elements.some(element => expressionIsTainted(element, tainted));
    default: {
      let found = false;
      node.forEachChild(child => {
        if (!found && isExpression(child) && expressionIsTainted(child, tainted)) found = true;
      });
      return found;
    }
  }
}

function scopeNodes(scope) {
  const own = [];
  const nested = [];
  const root = scope.kind === SyntaxKind.SourceFile ? scope : scope.body;
  if (root === undefined) return { own, nested };

  const descend = node => {
    if (node !== scope && FUNCTION_LIKE.has(node.kind)) {
      nested.push(node);
      return;
    }
    own.push(node);
    node.forEachChild(descend);
  };
  descend(root);
  return { own, nested };
}

function declaredNames(scope, own, nested) {
  const names = [];
  for (const parameter of scope.parameters ?? []) bindingNames(parameter.name, names);
  for (const node of own) {
    if (node.kind === SyntaxKind.VariableDeclaration) bindingNames(node.name, names);
  }
  for (const fn of nested) {
    const name = functionName(fn);
    if (name !== undefined) names.push(name);
  }
  return new Set(names);
}

function initialTaint(scope, inherited) {
  const tainted = new Set(inherited);
  for (const parameter of scope.parameters ?? []) {
    if (parameter.name?.kind === SyntaxKind.Identifier) {
      if (OPERATOR_NAMES.has(parameter.name.text) && typeIsOpenString(parameter.type)) {
        tainted.add(parameter.name.text);
      }
    } else {
      for (const name of operatorBindings(parameter.name)) tainted.add(name);
    }
  }
  return tainted;
}

function collectAliases(own, tainted) {
  let changed = false;
  for (const node of own) {
    if (node.kind === SyntaxKind.VariableDeclaration) {
      for (const name of operatorBindings(node.name)) {
        if (!tainted.has(name)) {
          tainted.add(name);
          changed = true;
        }
      }
      if (node.initializer !== undefined && expressionIsTainted(node.initializer, tainted)) {
        for (const name of bindingNames(node.name)) {
          if (!tainted.has(name)) {
            tainted.add(name);
            changed = true;
          }
        }
      }
    }
    if (
      node.kind === SyntaxKind.BinaryExpression &&
      node.operatorToken?.kind === SyntaxKind.EqualsToken &&
      node.left?.kind === SyntaxKind.Identifier &&
      expressionIsTainted(node.right, tainted) &&
      !tainted.has(node.left.text)
    ) {
      tainted.add(node.left.text);
      changed = true;
    }
  }
  return changed;
}

function sinkReason(node, tainted) {
  if (
    node.kind === SyntaxKind.TemplateExpression &&
    node.templateSpans.some(span => expressionIsTainted(span.expression, tainted))
  ) {
    return 'interpolates an open comparison operator';
  }
  if (
    node.kind === SyntaxKind.BinaryExpression &&
    node.operatorToken?.kind === SyntaxKind.PlusToken &&
    (expressionIsTainted(node.left, tainted) || expressionIsTainted(node.right, tainted))
  ) {
    return 'concatenates an open comparison operator';
  }
  if (node.kind === SyntaxKind.CallExpression && node.expression?.kind === SyntaxKind.PropertyAccessExpression) {
    const method = node.expression.name?.text;
    if (
      (method === 'concat' || method === 'join' || method === 'replace' || method === 'replaceAll') &&
      (expressionIsTainted(node.expression.expression, tainted) ||
        node.arguments.some(argument => expressionIsTainted(argument, tainted)))
    ) {
      return `builds text with an open comparison operator through .${method}()`;
    }
  }
  return undefined;
}

function auditScope(scope, sourceFile, label, inherited, findings, counters) {
  const { own, nested } = scopeNodes(scope);
  const declared = declaredNames(scope, own, nested);
  const visible = new Set([...inherited].filter(name => !declared.has(name)));
  const tainted = initialTaint(scope, visible);

  while (collectAliases(own, tainted)) {
    // Alias chains are finite: each pass can only add a declared name.
  }

  if (functionName(scope) !== 'sqlOperator') {
    for (const node of own) {
      const reason = sinkReason(node, tainted);
      if (reason === undefined) continue;
      findings.push(`${label}:${String(lineOf(sourceFile, node))}: ${reason} outside ${BOUNDARY}`);
    }
  }

  counters.scopes += 1;
  counters.taintedNames += tainted.size;
  for (const fn of nested) auditScope(fn, sourceFile, label, tainted, findings, counters);
}

function enclosingFunction(node) {
  let current = node.parent;
  while (current !== undefined) {
    if (FUNCTION_LIKE.has(current.kind)) return current;
    current = current.parent;
  }
  return undefined;
}

const declarations = [];
const calls = [];
const findings = [];
const counters = { files: 0, scopes: 0, taintedNames: 0 };

for (const name of PACKAGES) {
  const packageRoot = resolve(ROOT, 'packages', name);
  const project = resolve(packageRoot, 'tsconfig.json');
  if (!existsSync(project)) continue;

  const api = new API({ cwd: packageRoot });
  try {
    const program = api.updateSnapshot({ openProjects: [project] }).getProjects()[0]?.program;
    if (!program) throw new Error(`could not load ${relative(ROOT, project)}`);
    for (const fileName of program.getSourceFileNames()) {
      if (!isShipped(fileName, packageRoot)) continue;
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const label = relative(ROOT, fileName);
      counters.files += 1;

      walk(sourceFile, node => {
        if (
          node.kind === SyntaxKind.FunctionDeclaration &&
          node.name?.kind === SyntaxKind.Identifier &&
          node.name.text === 'sqlOperator'
        ) {
          declarations.push({ label, node, sourceFile });
        }
        if (isSqlOperatorCall(node)) calls.push({ label, node, sourceFile });
      });
      auditScope(sourceFile, sourceFile, label, new Set(), findings, counters);
    }
  } finally {
    api.close();
  }
}

if (declarations.length !== 1 || declarations[0]?.label !== BOUNDARY) {
  findings.push(
    `sqlOperator must be declared exactly once in ${BOUNDARY}; found ${
      declarations.length === 0 ? 'none' : declarations.map(entry => entry.label).join(', ')
    }`,
  );
}

if (calls.length !== 1 || calls[0]?.label !== BOUNDARY) {
  findings.push(
    `sqlOperator must be called exactly once in ${BOUNDARY}; found ${
      calls.length === 0
        ? 'none'
        : calls.map(entry => `${entry.label}:${String(lineOf(entry.sourceFile, entry.node))}`).join(', ')
    }`,
  );
}

const call = calls[0];
if (call !== undefined) {
  const owner = enclosingFunction(call.node);
  const argument = call.node.arguments[0];
  const exactArgument =
    argument?.kind === SyntaxKind.PropertyAccessExpression &&
    argument.expression?.kind === SyntaxKind.Identifier &&
    argument.expression.text === 'p' &&
    argument.name?.text === 'op';
  if (functionName(owner) !== 'renderPredicate' || !exactArgument) {
    findings.push('the sole sqlOperator call must be renderPredicate calling sqlOperator(p.op, dialect)');
  }
}

if (findings.length > 0) {
  console.error(`operator-boundary: ${String(findings.length)} problem(s):\n`);
  for (const finding of findings) console.error(`  ${finding}\n`);
  process.exit(1);
}

console.log(
  `operator-boundary: ${String(counters.files)} shipped source file(s), ${String(counters.scopes)} lexical scope(s); ` +
    `${BOUNDARY} is the sole general operator-to-SQL boundary.`,
);
