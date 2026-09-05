// The RISK-7 counter: PRD §9.4, recomputed, with a ceiling per row.
//
// §9.4 audited the escape hatches in `packages/*/src` and got the number of type assertions
// from 91 down to 28. Its own conclusion was that the audit does not hold itself up:
//
//   > **This is still not "zero escape hatches"**, and RISK-7 stays open until the count is
//   > _ratcheted in CI_ — that part is not built yet, so nothing stops the number climbing
//   > back.
//
// It had already climbed once. The published figure was 23 and the real count was 28; it
// drifted up by five with nothing watching, which is the whole argument for this file. So
// this recomputes every row of §9.4's table and fails on any increase — a decrease is fine
// and is reported, because the table is meant to keep going down.
//
// Two things it checks that a number cannot:
//
//   - **Every assertion is covered.** `ARCHITECTURE.md` §2.1 requires a `// boundary:`
//     comment saying why the assertion is sound. An assertion in a function that has no
//     such comment fails even when the total did not move, because otherwise the ratchet
//     rewards deleting one assertion and adding an undocumented one.
//   - **Runtime code generation stays gone** (§9.5). A count of zero is the only count
//     worth having here, so direct `Function` construction and `eval` are presence
//     checks with the call site named. The refine/transform guard below is deliberately
//     stronger than a token check: it verifies their public signatures, JavaScript
//     boundary and separation from both validator-emission paths.
//
// ---------------------------------------------------------------------------
// Why the compiler and not a grep
// ---------------------------------------------------------------------------
//
// §9.4's numbers came from greps, and it says so — which is why it had to explain that its
// first pass reported 93 and 17 because "one-off greps differ from the method above by a
// couple of hits". A ratchet cannot be built on a method that disagrees with itself by a
// couple of hits: the whole point is that a difference of one is a failure.
//
// So the assertions are counted off a real parse tree. `as const` is not an assertion and
// is not counted; `as unknown as T` is one assertion of `T` over one of `unknown`, and both
// rows in the table say so; `satisfies` is not an assertion at all. None of those three
// distinctions survives a regex, and the first two are most of the gap between 91 and 93.
//
// Comments are the one thing read out of the text, because a comment is trivia and trivia
// is not a node. The spans of every string, template part and regex literal come off the
// tree first and a match inside one is discarded, so the word `eval` in a message and the
// text `// boundary:` in a fixture are not findings.
//
// ---------------------------------------------------------------------------
// What is not counted
// ---------------------------------------------------------------------------
//
// Tests, and the code that exists to support them. §9.4 measured "the 67 non-spec source
// files in `packages/*/src`", and a test is allowed to assert its way to a value the type
// system cannot see — that is often the point of the test. `*.type-test.ts` is the clearest
// case: a file whose job is to prove a type *rejects* something is nothing but
// `@ts-expect-error`, and 45 of them are not 45 escape hatches. `__testing__/` and
// `__fixtures__/` are the same argument for directories. Shipped code is what this guards.

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SyntaxKind } from 'typescript/unstable/ast';
import { API, SignatureKind, TypeFlags } from 'typescript/unstable/sync';

import { createImportGraph } from './lib/import-graph.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * PRD §9.4's table, recounted by this script, and the ceiling for each row.
 *
 * Every one of these is a number somebody argued for in the PRD, so the failure message
 * points back at the argument rather than at a style rule. The counts are §9.4's 2026-09-02
 * recount — the first one this script produced, over 84 shipped files rather than the 67 the
 * grep pass measured, because the type-first front-end (reflection, emitter, CLI) landed in
 * between. Where a row differs from the grep pass, §9.4 says why.
 */
const BUDGET = {
  any: { limit: 0, what: '`any` in a type position (`: any`, `<any>`, `any[]`, `as any`)' },
  suppressions: { limit: 0, what: '`@ts-expect-error` / `@ts-ignore`' },
  // The final one was `attachRelations`' populated-row return. Repository loader work gave
  // that helper overloads whose implementation is checked without asserting through
  // `unknown`, so the double-cast ceiling is now zero.
  doubleCasts: { limit: 0, what: '`as unknown as` double casts' },
  // 53. It was 65 when `aot-validator/src/testing` landed, and came down by three with
  // `defineSchema`: its own rebuild-of-a-generic-record assertion, `makeColumn`'s, and
  // `references`'s. The fourth went with the repository's `relations` map — a `Populated<T, R,
  // K>` built from a relation *value* could not be indexed without one. The shallow-validator
  // public surface then consolidated the three successful validation returns behind one
  // `certified` boundary, removing two more. Repository loader work then replaced
  // `attachRelations`' asserted return with checked overloads, removing two more. Composite-key
  // queries then moved from asserted runtime where objects to the compiler's typed `where`
  // methods, removing the final two in that path. The OpenAPI renderer then stopped traversing
  // controller metadata and TypeIR, removing its two boundary casts. Argued in §9.4, which is
  // where a raise has to be argued.
  assertions: { limit: 53, what: 'type assertions (`as T` and `<T>x`, excluding `as const`)' },
  nonNull: { limit: 0, what: 'non-null assertions (`!`)' },
  lintDisables: { limit: 1, what: '`eslint-disable` / `oxlint-disable`' },
  dynamicCode: { limit: 0, what: '`Function` constructor / `eval` call sites' },
};

/** Reported, not capped: `// boundary:` comments. The grep pass counted 37. */
const BOUNDARIES_AT_AUDIT = 37;

/** The packages whose shipped source this covers, in §9.4's order. */
const PACKAGES = [
  'client',
  'react',
  'angular',
  'schema-core',
  'ai',
  'ai-anthropic',
  'ai-langchain',
  'ai-vercel',
  'mcp',
  'aot-validator',
  'protobuf',
  'repository',
  'query-compiler',
  'sqlite',
  'app',
  'jobs',
  'jobs-postgres',
  'otel',
  'transport-grpc',
  'transport-nats',
  'transport-rabbitmq',
  'transport-redis',
  'web',
  'zmdb',
];

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

const FUNCTION_LIKE = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
  SyntaxKind.ClassStaticBlockDeclaration,
]);

/** Where a `//` or `/*` is text rather than a comment. */
const LITERAL_KINDS = new Set([
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.JsxText,
]);

/** `x as const` is a literal-type request, not a claim about a type. §9.4 excludes it. */
function isAsConst(node) {
  const type = node.type;
  return (
    type !== undefined &&
    type.kind === SyntaxKind.TypeReference &&
    type.typeName?.kind === SyntaxKind.Identifier &&
    type.typeName.text === 'const'
  );
}

/** `expr as unknown as T` — the inner half, which is the one the row is about. */
function isDoubleCast(node) {
  const inner = node.expression;
  return inner?.kind === SyntaxKind.AsExpression && inner.type?.kind === SyntaxKind.UnknownKeyword;
}

/** Direct `Function(…)`, `new Function(…)` or `eval(…)`, by callee name. */
function dynamicCodeName(node) {
  const callee =
    node.kind === SyntaxKind.NewExpression || node.kind === SyntaxKind.CallExpression ? node.expression : undefined;
  if (callee?.kind !== SyntaxKind.Identifier) return undefined;
  if (callee.text === 'Function') return node.kind === SyntaxKind.NewExpression ? 'new Function' : 'Function';
  if (node.kind === SyntaxKind.CallExpression && callee.text === 'eval') return 'eval';
  return undefined;
}

// ---------------------------------------------------------------------------
// String-source validator guard
// ---------------------------------------------------------------------------

const STRING_SOURCE_APIS = ['refine', 'transform'];
const STRING_SOURCE_PAYLOADS = [
  "typeof v === 'string'",
  "v.constructor.constructor('return process.env.HOME')()",
  "v['constructor']['constructor']('return process.env.HOME')()",
  "v.__proto__.constructor.constructor('return process.env.HOME')()",
  "v['__proto__']['constructor']['constructor']('return process.env.HOME')()",
  "v.constructor.prototype.constructor.constructor('return process.env.HOME')()",
  "v['constructor']['prototype']['constructor']['constructor']('return process.env.HOME')()",
];

/** True when `file` is `root` or below it. */
function isWithin(root, file) {
  const path = relative(root, file);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/**
 * Whether a parameter type admits source text in any form.
 *
 * `checker.isTypeAssignableTo(string, type)` catches the ordinary `string` widening,
 * but not a string-literal overload. Looking through unions, intersections and type
 * parameters closes that gap without keying the check to the spelling of today's
 * `RefinePredicate` and `TransformFn` aliases.
 */
function admitsString(type, checker, seen = new Set()) {
  if (seen.has(type.id)) return false;
  seen.add(type.id);

  if ((type.flags & (TypeFlags.AnyOrUnknown | TypeFlags.StringLike)) !== 0) return true;
  if (type.isUnionType() || type.isIntersectionType()) {
    return type.getTypes().some(member => admitsString(member, checker, seen));
  }
  if ((type.flags & TypeFlags.TypeParameter) !== 0) {
    const constraint = checker.getBaseConstraintOfType(type);
    return constraint === undefined || admitsString(constraint, checker, seen);
  }
  return checker.isTypeAssignableTo(checker.getStringType(), type);
}

/** Public refine/transform signatures must remain callable-only and string-free. */
function auditStringSourceSignatures(program, checker) {
  const problems = [];
  const file = resolve(ROOT, 'packages/aot-validator/src/advanced/index.ts');
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) return [`could not load ${relative(ROOT, file)} for the string-source guard.`];

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return [`${relative(ROOT, file)} has no module symbol for the string-source guard.`];
  const exported = new Map(checker.getExportsOfModule(moduleSymbol).map(symbol => [symbol.name, symbol]));

  for (const name of STRING_SOURCE_APIS) {
    const symbol = exported.get(name);
    if (!symbol) {
      problems.push(`${relative(ROOT, file)} no longer exports \`${name}\`; update the guard with the API change.`);
      continue;
    }

    const type = checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
    const signatures = checker.getSignaturesOfType(type, SignatureKind.Call);
    if (signatures.length === 0) {
      problems.push(`\`${name}\` is exported but has no callable signature.`);
      continue;
    }

    for (const [index, signature] of signatures.entries()) {
      const parameter = signature.getParameters()[0];
      if (!parameter) {
        problems.push(`\`${name}\` signature ${index + 1} accepts no function value.`);
        continue;
      }
      const parameterType = checker.getTypeOfSymbolAtLocation(parameter, sourceFile);
      if (checker.getSignaturesOfType(parameterType, SignatureKind.Call).length === 0) {
        problems.push(
          `\`${name}\` signature ${index + 1} first parameter is not callable: ${checker.typeToString(parameterType)}.`,
        );
      }
      if (admitsString(parameterType, checker)) {
        problems.push(`\`${name}\` signature ${index + 1} admits source text: ${checker.typeToString(parameterType)}.`);
      }
    }
  }

  return problems;
}

/**
 * The advanced rule module is a runtime fallback, not input to either emitter.
 *
 * The checker-driven path is protected by `CALLEES`; the no-checker path is probed
 * byte-for-byte with both ordinary source strings and the prototype-chain payloads
 * that evade a `new Function` grep. Import reachability is checked separately so a
 * shared interpreter cannot quietly appear below either emission entry point.
 */
async function auditStringSourceEmission() {
  const problems = [];
  const advanced = resolve(ROOT, 'packages/aot-validator/src/advanced');
  const entries = [
    resolve(ROOT, 'packages/aot-validator/src/transformer.ts'),
    resolve(ROOT, 'packages/aot-validator/src/emit/index.ts'),
  ];
  const graph = createImportGraph(ROOT);

  for (const entry of entries) {
    const chain = graph.findImportPath(
      entry,
      imported => imported.resolved !== null && isWithin(advanced, imported.resolved),
    );
    if (chain !== null) {
      const trail = chain.map((part, index) => (index === chain.length - 1 ? part : relative(ROOT, part))).join(' -> ');
      problems.push(`${relative(ROOT, entry)} reaches the advanced rule surface through ${trail}.`);
    }
  }

  await import(pathToFileURL(resolve(ROOT, 'scripts/ts-specifier-hook.mjs')).href);
  const { CALLEES, transformCode } = await import(
    pathToFileURL(resolve(ROOT, 'packages/aot-validator/src/transformer.ts')).href
  );

  for (const name of STRING_SOURCE_APIS) {
    if (CALLEES.has(name)) {
      problems.push(
        `the checker-driven emitter recognises \`${name}\`; advanced rule source must stay out of CALLEES.`,
      );
    }
  }

  for (const payload of STRING_SOURCE_PAYLOADS) {
    const sources = [
      `const ok = validate(refine(${JSON.stringify(payload)}, "message"), input);`,
      `const out = validate(transform(${JSON.stringify(payload)}), input);`,
    ];
    for (const source of sources) {
      try {
        const output = transformCode(source);
        if (output !== source) {
          problems.push(`the no-checker emitter interpreted a refine/transform source: ${JSON.stringify(payload)}.`);
        }
      } catch (error) {
        problems.push(
          `the no-checker emitter tried to parse a refine/transform source (${JSON.stringify(payload)}): ${String(error)}.`,
        );
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

const COMMENT = /\/\/[^\n]*|\/\*[\S\s]*?\*\//g;

/**
 * Every comment in a file, given the literal spans to ignore.
 *
 * A comment is trivia, so it is not on the tree and there is nothing to walk. Matching the
 * text and discarding what falls inside a literal is exact for the two cases that matter —
 * a `//` inside a string and a `/*` inside a regex — and no worse than the audit it
 * reproduces anywhere else.
 */
function comments(text, literals) {
  const found = [];
  for (const match of text.matchAll(COMMENT)) {
    const at = match.index;
    if (literals.some(([start, end]) => at >= start && at < end)) continue;
    found.push({ at, text: match[0] });
  }
  return found;
}

const BOUNDARY = /(?:\/\/|\*)\s*boundary:/;

/**
 * A `@ts-expect-error` / `@ts-ignore` *directive*, not a mention of one.
 *
 * The compiler only honours the pragma when it is the first thing in the comment, and
 * `schema-core/src/index.ts` has a paragraph explaining why `@ts-expect-error` in a spec
 * used to be inert. Counting that paragraph would make the ratchet fail over prose about
 * the very hatch it is asking people not to use.
 */
const DIRECTIVE = /^\/[/*]\s*@ts-(expect-error|ignore)\b/;

// ---------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------

/**
 * The audit of one source file.
 *
 * The walk carries where an assertion's `// boundary:` comment is allowed to be, which is
 * either of two places:
 *
 *   - anywhere inside the enclosing function. Function-scoped rather than per-cast on
 *     purpose: the argument is usually one argument covering three casts, and
 *     `ARCHITECTURE.md` asks for the argument, not for a comment count.
 *   - in the leading trivia of anything that encloses the assertion. That is the doc
 *     comment of the `const fn = () => …` the cast is inside — which is *not* inside the
 *     arrow function, because trivia attaches to the statement — and equally an inline
 *     `/* boundary: … *\/` in front of the expression itself.
 */
function auditFile(sourceFile, label) {
  const text = sourceFile.text;
  const counts = Object.fromEntries(Object.keys(BUDGET).map(key => [key, 0]));
  let boundaries = 0;
  const findings = [];
  const literals = [];
  /** Assertions, each with the span its boundary comment may live in. */
  const claims = [];

  const line = at => text.slice(0, at).split('\n').length;

  const walk = (node, scope, docs) => {
    if (LITERAL_KINDS.has(node.kind)) literals.push([node.pos, node.end]);

    const inner = FUNCTION_LIKE.has(node.kind) ? node : scope;
    const start = node.getStart();
    const trivia = start > node.pos ? [...docs, [node.pos, start]] : docs;

    switch (node.kind) {
      case SyntaxKind.AnyKeyword: {
        counts.any += 1;
        findings.push(`${label}:${line(node.pos)}: \`any\``);
        break;
      }
      case SyntaxKind.NonNullExpression: {
        counts.nonNull += 1;
        findings.push(`${label}:${line(node.pos)}: non-null assertion`);
        break;
      }
      case SyntaxKind.AsExpression:
      case SyntaxKind.TypeAssertionExpression: {
        if (!isAsConst(node)) {
          counts.assertions += 1;
          claims.push({ at: node.pos, allowed: scope ? [...trivia, [scope.pos, scope.end]] : trivia });
        }
        if (node.kind === SyntaxKind.AsExpression && isDoubleCast(node)) counts.doubleCasts += 1;
        break;
      }
      case SyntaxKind.NewExpression:
      case SyntaxKind.CallExpression: {
        const name = dynamicCodeName(node);
        if (name !== undefined) {
          counts.dynamicCode += 1;
          findings.push(`${label}:${line(node.pos)}: ${name}`);
        }
        break;
      }
      default:
        break;
    }

    node.forEachChild(child => walk(child, inner, trivia));
  };

  for (const statement of sourceFile.statements) walk(statement, undefined, []);

  const all = comments(text, literals);
  for (const comment of all) {
    const directive = DIRECTIVE.exec(comment.text);
    if (directive) {
      counts.suppressions += 1;
      findings.push(`${label}:${line(comment.at)}: @ts-${directive[1]}`);
    }
    if (/^\/[/*]\s*(?:es|ox)lint-disable/.test(comment.text)) {
      counts.lintDisables += 1;
      findings.push(`${label}:${line(comment.at)}: lint suppression`);
    }
    if (BOUNDARY.test(comment.text)) boundaries += 1;
  }

  // Coverage, once the comments are known — the spans were collected on the way down, but a
  // comment inside one of them is only findable after the literals are, which is the same
  // walk.
  const documented = all.filter(comment => BOUNDARY.test(comment.text));
  const undocumented = [];
  for (const claim of claims) {
    const covered = documented.some(comment =>
      claim.allowed.some(([start, end]) => comment.at >= start && comment.at < end),
    );
    if (!covered) undocumented.push(`${label}:${line(claim.at)}`);
  }

  return { counts, boundaries, findings, undocumented };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Test files and the directories that exist only to hold their support code. */
const NOT_SHIPPED = [/\.spec\.[cm]?tsx?$/, /\.type-test\.[cm]?tsx?$/, /\/__testing__\//, /\/__fixtures__\//];

/** Shipped source: not a test, not generated, not a declaration file. */
function isShipped(fileName, packageRoot) {
  if (!fileName.startsWith(`${packageRoot}/src/`)) return false;
  if (fileName.endsWith('.d.ts')) return false;
  if (/\.generated\.[cm]?tsx?$/.test(fileName)) return false;
  if (NOT_SHIPPED.some(pattern => pattern.test(fileName))) return false;
  return /\.[cm]?tsx?$/.test(fileName);
}

const totals = Object.fromEntries(Object.keys(BUDGET).map(key => [key, 0]));
const perPackage = [];
const findings = [];
const undocumented = [];
const contractProblems = [];
let boundaries = 0;
let files = 0;

for (const name of PACKAGES) {
  const packageRoot = resolve(ROOT, 'packages', name);
  const project = resolve(packageRoot, 'tsconfig.json');
  if (!existsSync(project)) continue;

  const api = new API({ cwd: packageRoot });
  try {
    const loaded = api.updateSnapshot({ openProjects: [project] }).getProjects()[0];
    if (!loaded) throw new Error(`could not load ${relative(ROOT, project)}`);
    const { checker, program } = loaded;
    let assertions = 0;
    let boundaryComments = 0;
    for (const fileName of program.getSourceFileNames()) {
      if (!isShipped(fileName, packageRoot)) continue;
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) continue;
      files += 1;
      const audit = auditFile(sourceFile, relative(ROOT, fileName));
      for (const [key, value] of Object.entries(audit.counts)) totals[key] += value;
      boundaries += audit.boundaries;
      assertions += audit.counts.assertions;
      boundaryComments += audit.boundaries;
      findings.push(...audit.findings);
      undocumented.push(...audit.undocumented);
    }
    if (name === 'aot-validator') {
      contractProblems.push(...auditStringSourceSignatures(program, checker));
    }
    perPackage.push({ name, assertions, boundaryComments });
  } finally {
    api.close();
  }
}

try {
  contractProblems.push(...(await auditStringSourceEmission()));
} catch (error) {
  contractProblems.push(`could not audit the emitted-validator string-source boundary: ${String(error)}.`);
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const pad = (text, width) => String(text).padStart(width);
console.log(`escape-hatch ratchet: ${files} shipped source file(s) in ${perPackage.length} package(s)\n`);
console.log('  metric                                                          count  ceiling');
for (const [key, { limit, what }] of Object.entries(BUDGET)) {
  const mark = totals[key] > limit ? '✗' : totals[key] < limit ? '↓' : ' ';
  console.log(`  ${mark} ${what.padEnd(60)} ${pad(totals[key], 5)} ${pad(limit, 8)}`);
}
console.log(`\n  \`// boundary:\` comments: ${boundaries} (${BOUNDARIES_AT_AUDIT} at the §9.4 audit)`);
console.log('\n  package                 assertions  boundary comments');
for (const row of perPackage) {
  console.log(`  ${row.name.padEnd(22)} ${pad(row.assertions, 10)} ${pad(row.boundaryComments, 18)}`);
}
console.log(`\n  refine/transform string-source boundary: ${contractProblems.length === 0 ? 'OK' : 'FAIL'}`);

const problems = [...contractProblems];
for (const [key, { limit, what }] of Object.entries(BUDGET)) {
  if (totals[key] > limit) {
    problems.push(
      `${what}: ${totals[key]}, ceiling ${limit}. PRD §9.4 argued for ${limit}; argue for the new one there or remove the hatch.`,
    );
  }
}
for (const at of undocumented) {
  problems.push(
    `${at}: a type assertion whose enclosing function has no \`// boundary:\` comment saying why it is sound (ARCHITECTURE.md §2.1).`,
  );
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  if (findings.length > 0) {
    console.error('Sites:\n');
    for (const finding of findings) console.error(`  ${finding}`);
    console.error('');
  }
  console.error('RISK-7 is the risk that this number climbs back. It already did once — the PRD');
  console.error('published 23 while the tree held 28 — which is why the ceiling is checked rather');
  console.error('than described. Lowering a ceiling is a normal commit; raising one is a decision.');
  process.exit(1);
}

const lowered = Object.entries(BUDGET).filter(([key, { limit }]) => totals[key] < limit);
if (lowered.length > 0) {
  console.log(`\n${lowered.length} row(s) are now below their ceiling. Lower BUDGET and §9.4 to match:`);
  for (const [key, { limit, what }] of lowered) console.log(`  ${what}: ${limit} → ${totals[key]}`);
}
console.log('\nevery escape hatch is within its budget, and every assertion names its boundary.');
