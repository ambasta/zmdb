// REQ-TF-1: the tag vocabulary covers everything, and everything reads the whole vocabulary.
//
// `ir/vocabulary.type-test.ts` already gates the half a type test can gate: every `SqlType`
// is in `SQL_TYPES`, every `ColumnFlags` member has a row in `FLAG_TO_IR`, every
// `ConstraintKind` has a row in `CONSTRAINT_TO_TAG`, and every `TAG_NAMES` value starts with
// `zmdb`. Those are compile errors, which is the right place for them, and this script does
// not repeat any of them.
//
// What it adds is the half that compiles fine while being wrong:
//
//   1. **A marker with no tag, or a tag with no marker.** Most markers are invisible
//      `declare const zmdbFts` symbol slots. `Ext` is the one frozen structural marker,
//      `__zmdbExt`, normalised to the same `zmdbExt` vocabulary name. An unused marker is
//      dead weight nobody can see, and one the tags stopped using compiles forever.
//   2. **A marker missing from `TAG_NAMES`, or named twice.** The type test checks the shape
//      of the values (`zmdb${string}`), not that they name real declarations. A tag whose
//      marker is not in `TAG_NAMES` is normally a tag the reflection cannot see: the
//      declaration compiles, the derived types honour it, and the emitted validator quietly
//      does not. `Physical<Name>` is the one deliberate exception: one positional tag feeds
//      `SchemaIR.physicalTable` and `ColumnIR.physicalName` through a dedicated reader, and
//      this script traces that exact named path instead of allowing invisible tags.
//   3. **A `TagField` the reflection never reads.** `TAG_NAMES` is a promise that a tag
//      reaches the IR. The reflection keeps it by asking for each field by name —
//      `tags.get('serial')` — so an entry nobody asks for is a promise nothing keeps.
//   4. **A tag named in prose.** `FLAG_TO_TAG` and `CONSTRAINT_TO_TAG` spell their tags as
//      *strings* ('Serial', 'Min<N>'), because the tags are parameterised differently and a
//      heterogeneous map of them is not writable. A string is not a reference: rename a tag
//      and those tables keep compiling while naming something that no longer exists.
//   5. **A tag no test ever writes.** A vocabulary entry that has never been through the
//      reflection is an entry whose behaviour is a guess. This one found four: `Fts`,
//      `OneToOne`, `ManyToMany` and `AnyRelation` were published, documented and unwritten.
//   6. **A constraint reader that reads four of five.** This is not hypothetical, it is the
//      bug the IR was introduced to end: `TypeDescriptor` carried `minimum` and `maxLength`
//      but not `maximum` or `minLength`, so `Min<18> & Max<120>` validated differently
//      depending on which walker you asked. `Constraints` has all five optional fields, so
//      ignoring one is not a type error in either a reader or a declarer.
//   7. **A constraint with no runtime counterpart.** Each constraint tag has a runtime twin
//      (`tags.Min(18)`), a `case` in the fallback `validate` and a `case` in the inliner.
//      REQ-AV-4 says the two spellings answer identically, which they cannot do if one of
//      the three is missing — the fallback would throw `unknown rule kind` where the build
//      answered `false`.
//
// ---------------------------------------------------------------------------
// Where the numbers come from
// ---------------------------------------------------------------------------
//
// `TAG_NAMES` and `KNOWN_CONSTRAINT_KINDS` are imported, not re-listed: this checks the tree
// against the values the library actually ships, so there is no second copy of the
// vocabulary here to drift. Everything else is read off a parse tree, for the reason
// `verify-escape-hatches.mjs` gives at length and the reflection learnt the hard way — a
// text match on a TypeScript construct is how you ship a confident wrong answer.

import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SyntaxKind } from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

// This verifier is one of the handover's direct `node` gates, so it cannot rely on a
// package-script `--import` flag. Register the repository's canonical `.js` -> `.ts`
// source resolver before dynamically loading the shipped vocabulary.
await import('../../scripts/ts-specifier-hook.mjs');
const { KNOWN_CONSTRAINT_KINDS, TAG_NAMES } = await import('../../packages/schema-core/src/ir/vocabulary.js');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const TAGS = 'packages/schema-core/src/tags/index.ts';
const VOCABULARY = 'packages/schema-core/src/ir/vocabulary.type-test.ts';
const REFLECT = 'packages/compiler/src/reflect/index.ts';
const FIXTURES = 'packages/compiler/src/reflect/__fixtures__/';
const RUNTIME = 'packages/aot-validator/src/index.ts';
const INLINER = 'packages/compiler/src/transform/index.ts';
const COMPILER_SOURCE_ROOT = resolve(ROOT, 'packages/compiler/src');

/**
 * The one tag that deliberately does not participate in the TagField ↔ marker bijection.
 *
 * `Physical` means `physicalTable` in interface position and `physicalName` in a property
 * intersection. Adding either field to `TAG_NAMES` would claim one slot sets one TagField,
 * which is not its contract; allowing an arbitrary omitted marker would make the normal
 * bijection meaningless. The run below therefore verifies this one marker, spelling and
 * reader chain by name.
 */
const PHYSICAL_TAG = Object.freeze({
  marker: 'zmdbPhysical',
  tag: 'Physical',
  markerConstant: 'PHYSICAL_TAG_NAME',
  directReader: '#physicalNameOf',
  intersectionReader: '#physicalNameFrom',
  tableOwner: 'schemaIR',
  columnOwner: '#column',
  irFields: ['physicalTable', 'physicalName'],
});

/**
 * Types that declare *some* of `Constraints`' five fields on purpose.
 *
 * Empty. It held two entries, `TypeDescriptor` and the `constraintsFrom` that converted it:
 * the pre-IR runtime schema could not express `maximum` or `minLength` at all, so its partial
 * set was the limit rather than an oversight — and the limit is the whole reason the IR
 * replaced it. Both are deleted, and the loop below turned that into a failure telling us to
 * empty this list, which is what an exemption that stops matching anything is for.
 *
 * Nothing goes back in here without the same kind of argument: a shape that cannot say
 * `maximum`, not a walker that forgot to.
 */
const PARTIAL_ON_PURPOSE = [];

const CONSTRAINT_KINDS = new Set(KNOWN_CONSTRAINT_KINDS);
const TAG_FIELDS = Object.keys(TAG_NAMES);

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

const FUNCTION_LIKE = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
]);

/** What counts as the name of the thing a partial set of constraints is declared in. */
const NAMES_A_SHAPE = new Set([
  ...FUNCTION_LIKE,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.ClassDeclaration,
]);

function walk(node, visit) {
  visit(node);
  node.forEachChild(child => walk(child, visit));
}

function hasModifier(node, kind) {
  return node.modifiers?.some(modifier => modifier.kind === kind) ?? false;
}

/** `x.y` where `x` is a plain identifier — the only receiver shape any check here wants. */
function accessOn(node, receiver) {
  if (node.kind !== SyntaxKind.PropertyAccessExpression) return undefined;
  if (node.expression?.kind !== SyntaxKind.Identifier) return undefined;
  if (node.expression.text !== receiver) return undefined;
  return node.name?.text;
}

function lineOf(sourceFile, node) {
  return sourceFile.text.slice(0, node.getStart()).split('\n').length;
}

/**
 * The identifier a type reference names, ignoring its arguments: `Length<255>` → `Length`.
 *
 * `interface User extends Table<'users'>` is the other spelling and is *not* a type
 * reference — a heritage clause is an expression with type arguments, because the same
 * syntax means `class X extends Y` elsewhere. Missing that made every entity-level tag look
 * unwritten while eight fixtures were writing it.
 */
function typeReferenceName(node) {
  if (node.kind === SyntaxKind.ExpressionWithTypeArguments) {
    return node.expression?.kind === SyntaxKind.Identifier ? node.expression.text : undefined;
  }
  if (node.kind !== SyntaxKind.TypeReference) return undefined;
  const name = node.typeName;
  return name?.kind === SyntaxKind.Identifier ? name.text : undefined;
}

/** A `case 'literal':` clause's text, for the two switches over rule kinds. */
function caseLiteral(node) {
  if (node.kind !== SyntaxKind.CaseClause) return undefined;
  const expression = node.expression;
  return expression?.kind === SyntaxKind.StringLiteral ? expression.text : undefined;
}

/** The property names an object type literal or interface declares. */
function declaredMembers(node) {
  const members = node.members ?? [];
  const names = [];
  for (const member of members) {
    if (member.kind !== SyntaxKind.PropertySignature) continue;
    if (member.name?.kind === SyntaxKind.Identifier) names.push(member.name.text);
  }
  return names;
}

/** A top-level `const NAME = 'literal'`, if the file declares one. */
function stringConstant(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (statement.kind !== SyntaxKind.VariableStatement) continue;
    for (const declaration of statement.declarationList?.declarations ?? []) {
      if (declaration.name?.kind !== SyntaxKind.Identifier || declaration.name.text !== name) continue;
      const value = declaration.initializer;
      if (value?.kind === SyntaxKind.StringLiteral || value?.kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
        return value.text;
      }
    }
  }
  return undefined;
}

/** The one method declaration with this public/private name, plus calls made inside it. */
function methodCoverage(sourceFile, methodName) {
  const matches = [];
  walk(sourceFile, node => {
    if (node.kind === SyntaxKind.MethodDeclaration && node.name?.text === methodName) matches.push(node);
  });
  const [method] = matches;
  const calls = new Set();
  const identifiers = new Set();
  if (method !== undefined) {
    walk(method, node => {
      if (node.kind === SyntaxKind.Identifier) identifiers.add(node.text);
      if (node.kind !== SyntaxKind.CallExpression) return;
      const callee = node.expression;
      if (callee?.kind === SyntaxKind.Identifier) {
        calls.add(callee.text);
      } else if (
        callee?.kind === SyntaxKind.PropertyAccessExpression &&
        callee.expression?.kind === SyntaxKind.ThisKeyword
      ) {
        const name = callee.name?.text;
        if (name !== undefined) calls.add(name);
      }
    });
  }
  return { count: matches.length, calls, identifiers };
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/**
 * The vocabulary as `tags/index.ts` declares it: symbol slots plus the structural
 * `__zmdbExt` marker, and which exported tag types spell each one.
 *
 * A tag is recognised by *referring to a slot* rather than by name or position, which is
 * what keeps `Nullable<T>` and `NonNull<T>` out of the count — they are readability aliases
 * that expand to native TypeScript, and the file says so.
 */
function vocabularyOf(sourceFile) {
  const slots = new Map();
  const structural = new Set();
  const tags = new Map();
  const exported = new Set();

  for (const statement of sourceFile.statements) {
    if (statement.kind === SyntaxKind.VariableStatement && hasModifier(statement, SyntaxKind.DeclareKeyword)) {
      for (const declaration of statement.declarationList?.declarations ?? []) {
        const name = declaration.name?.kind === SyntaxKind.Identifier ? declaration.name.text : undefined;
        if (name?.startsWith('zmdb') === true) slots.set(name, lineOf(sourceFile, declaration));
      }
      continue;
    }
    if (statement.kind !== SyntaxKind.TypeAliasDeclaration) continue;
    if (!hasModifier(statement, SyntaxKind.ExportKeyword)) continue;
    exported.add(statement.name.text);

    const used = new Set();
    walk(statement.type, node => {
      if (node.kind === SyntaxKind.Identifier && node.text.startsWith('zmdb')) used.add(node.text);
      if (
        node.kind === SyntaxKind.PropertySignature &&
        node.name?.kind === SyntaxKind.Identifier &&
        node.name.text.startsWith('__zmdb')
      ) {
        const marker = node.name.text.slice(2);
        used.add(marker);
        slots.set(marker, lineOf(sourceFile, node));
        structural.add(marker);
      }
    });
    if (used.size > 0) tags.set(statement.name.text, used);
  }

  return { slots, structural, tags, exported };
}

/**
 * Every `TagField` the reflection asks for: `tags.get('serial')`, `tags.has('unique')`.
 *
 * Five of them are not asked for by name. `#constraintsFromTags` loops
 * `for (const kind of KNOWN_CONSTRAINT_KINDS) … tags.get(kind)`, which is the right way to
 * write it — the whole point of the list being data — and a read through a loop variable is
 * still a read. So a dynamic argument is resolved through the list the loop iterates, and
 * only through lists this script imports: an unrecognised one is reported rather than
 * assumed, because "the reflection reads something, we are not sure what" is not a coverage
 * claim worth making.
 */
const ITERATED_VOCABULARIES = new Map([['KNOWN_CONSTRAINT_KINDS', KNOWN_CONSTRAINT_KINDS]]);

function fieldsReadBy(sourceFile) {
  const read = new Set();
  const unresolved = [];

  const visit = (node, ancestors) => {
    if (node.kind === SyntaxKind.CallExpression) {
      const callee = node.expression;
      const method = callee?.kind === SyntaxKind.PropertyAccessExpression ? callee.name?.text : undefined;
      // The receiver has to *be* a tag map. Every one in the reflection is named for what it
      // holds (`tags`, `propertyTags`), and the alternative — accepting any `.get('x')` —
      // would let an unrelated `Map` keyed by a string that happens to read like a field
      // stand in for the read this is looking for.
      const receiver = callee?.expression?.kind === SyntaxKind.Identifier ? callee.expression.text : undefined;
      if ((method === 'get' || method === 'has') && receiver !== undefined && /tags$/i.test(receiver)) {
        const [argument] = node.arguments ?? [];
        if (argument?.kind === SyntaxKind.StringLiteral) {
          read.add(argument.text);
        } else if (argument?.kind === SyntaxKind.Identifier) {
          const source = iteratedSource(argument.text, ancestors);
          if (source === undefined) {
            unresolved.push({ line: lineOf(sourceFile, node), variable: argument.text });
          } else {
            for (const member of source) read.add(member);
          }
        }
      }
    }
    node.forEachChild(child => visit(child, [...ancestors, node]));
  };
  visit(sourceFile, []);

  return { read, unresolved };
}

/** The vocabulary list a `for (const x of LIST)` around this read iterates, if it is one. */
function iteratedSource(variable, ancestors) {
  for (const ancestor of ancestors.toReversed()) {
    if (ancestor.kind !== SyntaxKind.ForOfStatement) continue;
    const declared = ancestor.initializer?.declarations?.[0]?.name;
    if (declared?.kind !== SyntaxKind.Identifier || declared.text !== variable) continue;
    const list = ancestor.expression;
    if (list?.kind !== SyntaxKind.Identifier) return undefined;
    return ITERATED_VOCABULARIES.get(list.text);
  }
  return undefined;
}

/** A `{ key: 'value' }` table, by variable name — `FLAG_TO_TAG` and `CONSTRAINT_TO_TAG`. */
function stringTable(sourceFile, variableName) {
  const table = new Map();
  for (const statement of sourceFile.statements) {
    if (statement.kind !== SyntaxKind.VariableStatement) continue;
    for (const declaration of statement.declarationList?.declarations ?? []) {
      if (declaration.name?.text !== variableName) continue;
      const initialiser = declaration.initializer;
      if (initialiser?.kind !== SyntaxKind.ObjectLiteralExpression) continue;
      for (const property of initialiser.properties ?? []) {
        if (property.kind !== SyntaxKind.PropertyAssignment) continue;
        const key = property.name?.text;
        const value = property.initializer;
        if (key === undefined) continue;
        if (value?.kind === SyntaxKind.StringLiteral || value?.kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
          table.set(key, { text: value.text, line: lineOf(sourceFile, property) });
        }
      }
    }
  }
  return table;
}

/**
 * The tag names a table's prose mentions: `'Min<N>'` → `Min`, `"Sql<'jsonEnum'> + a literal
 * union"` → `Sql`.
 *
 * Two characters or more, so the single-letter type parameters inside the brackets (`<N>`,
 * `<T>`) are not mistaken for tags. A tag has never been named with one letter and, if one
 * ever is, this reports it as missing rather than passing it silently.
 */
function tagNamesIn(text) {
  return [...text.matchAll(/\b[A-Z][A-Za-z]+\b/g)].map(match => match[0]);
}

/** Every type this file names, so "is this tag ever written?" has an exact answer. */
function typeReferencesIn(sourceFile) {
  const referenced = new Set();
  walk(sourceFile, node => {
    const name = typeReferenceName(node);
    if (name !== undefined) referenced.add(name);
  });
  return referenced;
}

/**
 * Functions that read `Constraints` through a parameter, with the fields each one reads.
 *
 * Keyed on the parameter's declared type rather than on the fields it happens to touch: a
 * function that reads `col.constraints.maxLength` to compare it against `col.length` is
 * asking one question about one bound, and it is right to. A function handed the whole
 * record is answering "does this value satisfy its constraints", and there is no version of
 * that answer that skips one.
 */
function constraintReaders(sourceFile) {
  const readers = [];
  walk(sourceFile, node => {
    if (!FUNCTION_LIKE.has(node.kind)) return;
    const named = [];
    for (const parameter of node.parameters ?? []) {
      if (parameter.name?.kind !== SyntaxKind.Identifier || !parameter.type) continue;
      let mentionsConstraints = false;
      walk(parameter.type, inner => {
        if (typeReferenceName(inner) === 'Constraints') mentionsConstraints = true;
      });
      if (mentionsConstraints) named.push(parameter.name.text);
    }
    if (named.length === 0) return;

    const fields = new Set();
    for (const receiver of named) {
      walk(node, inner => {
        const field = accessOn(inner, receiver);
        if (field !== undefined && CONSTRAINT_KINDS.has(field)) fields.add(field);
      });
    }
    if (fields.size === 0) return;
    readers.push({ name: nameOf(node), line: lineOf(sourceFile, node), fields });
  });
  return readers;
}

/** Object types that declare constraint fields — the shape `TypeDescriptor` got wrong. */
function constraintDeclarers(sourceFile) {
  const declarers = [];
  const stack = [];
  const visit = node => {
    if (node.kind === SyntaxKind.InterfaceDeclaration || node.kind === SyntaxKind.TypeLiteral) {
      const declared = declaredMembers(node).filter(name => CONSTRAINT_KINDS.has(name));
      if (declared.length > 0) {
        const enclosing = node.kind === SyntaxKind.InterfaceDeclaration ? node.name?.text : lastNamed(stack);
        declarers.push({ name: enclosing ?? '(anonymous)', line: lineOf(sourceFile, node), fields: new Set(declared) });
      }
    }
    // Only declarations a reader would name the shape by. Pushing every named node would
    // make the enclosing name of a local `const constraints: {…}` be `constraints`, which
    // says nothing about where to go and looks like an exemption for the field name.
    const named = NAMES_A_SHAPE.has(node.kind) ? nameOf(node) : undefined;
    if (named !== undefined) stack.push(named);
    node.forEachChild(visit);
    if (named !== undefined) stack.pop();
  };
  visit(sourceFile);
  return declarers;
}

/** A declaration's own name, for a report that points at something a reader can find. */
function nameOf(node) {
  const name = node.name;
  if (name?.kind === SyntaxKind.Identifier) return name.text;
  if (name?.kind === SyntaxKind.PrivateIdentifier) return name.text;
  return undefined;
}

function lastNamed(stack) {
  return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

/** The runtime rule builders — `export const tags = { Min(n) {…} }`. */
function runtimeRuleNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (statement.kind !== SyntaxKind.VariableStatement) continue;
    for (const declaration of statement.declarationList?.declarations ?? []) {
      if (declaration.name?.text !== 'tags') continue;
      let initialiser = declaration.initializer;
      // `as const` wraps the literal, and the rule names are inside it.
      if (initialiser?.kind === SyntaxKind.AsExpression) initialiser = initialiser.expression;
      for (const property of initialiser?.properties ?? []) {
        const name = property.name?.text;
        if (name !== undefined) names.add(name);
      }
    }
  }
  return names;
}

/** Every `case 'X':` in a file, which is how both rule dispatchers are written. */
function caseLiteralsIn(sourceFile) {
  const cases = new Set();
  walk(sourceFile, node => {
    const literal = caseLiteral(node);
    if (literal !== undefined) cases.add(literal);
  });
  return cases;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const TEST_FILE = [/\.spec\.[cm]?tsx?$/, /\.type-test\.[cm]?tsx?$/, /\/__fixtures__\//, /\/__testing__\//];

function programOf(name) {
  const packageRoot = resolve(ROOT, 'packages', name);
  const api = new API({ cwd: packageRoot });
  const program = api
    .updateSnapshot({ openProjects: [resolve(packageRoot, 'tsconfig.json')] })
    .getProjects()[0]?.program;
  if (!program) {
    api.close();
    throw new Error(`could not load packages/${name}/tsconfig.json`);
  }
  return { api, program };
}

const problems = [];
const notes = [];

const core = programOf('schema-core');
const validator = programOf('aot-validator');
const compiler = programOf('compiler');

try {
  const file = (program, path) => {
    const sourceFile = program.getSourceFile(resolve(ROOT, path));
    if (!sourceFile) throw new Error(`${path} is not in the program`);
    return sourceFile;
  };

  const tagsFile = file(core.program, TAGS);
  const { slots, structural, tags, exported } = vocabularyOf(tagsFile);

  // --- 1. every marker is spelled by a tag, and every tag spells a real marker ---
  const spelled = new Set([...tags.values()].flatMap(used => [...used]));
  for (const [slot, line] of slots) {
    if (!spelled.has(slot)) {
      problems.push(`${TAGS}:${line}: \`${slot}\` is declared but no exported tag spells it — a slot nobody can set.`);
    }
  }
  for (const [tag, used] of tags) {
    for (const slot of used) {
      if (!slots.has(slot)) problems.push(`${TAGS}: \`${tag}\` refers to \`${slot}\`, which is not declared here.`);
    }
  }

  // --- 2. markers and TAG_NAMES are a bijection, with one exact positional tag ---
  const namedBy = new Map();
  for (const [field, symbolName] of Object.entries(TAG_NAMES)) {
    const already = namedBy.get(symbolName);
    namedBy.set(symbolName, already === undefined ? [field] : [...already, field]);
  }
  for (const [slot, line] of slots) {
    const fields = namedBy.get(slot);
    if (fields === undefined && slot !== PHYSICAL_TAG.marker) {
      problems.push(
        `${TAGS}:${line}: \`${slot}\` has no \`TAG_NAMES\` entry, so the reflection cannot see it. ` +
          `The declaration would compile and the emitted validator would quietly ignore the tag.`,
      );
    }
  }
  for (const [symbolName, fields] of namedBy) {
    if (!slots.has(symbolName)) {
      problems.push(`TAG_NAMES: \`${fields.join(', ')}\` names \`${symbolName}\`, which \`${TAGS}\` does not declare.`);
    }
  }

  const physicalSpellings = [...tags].filter(([, used]) => used.has(PHYSICAL_TAG.marker)).map(([tag]) => tag);
  if (physicalSpellings.length !== 1 || physicalSpellings[0] !== PHYSICAL_TAG.tag) {
    problems.push(
      `${TAGS}: the dedicated \`${PHYSICAL_TAG.marker}\` marker must be spelled only by ` +
        `\`${PHYSICAL_TAG.tag}<Name>\`; found ${physicalSpellings.join(', ') || 'none'}.`,
    );
  }
  if (namedBy.has(PHYSICAL_TAG.marker)) {
    problems.push(
      `TAG_NAMES must not name \`${PHYSICAL_TAG.marker}\`: \`${PHYSICAL_TAG.tag}<Name>\` feeds ` +
        `${PHYSICAL_TAG.irFields.join(' and ')} by position through its dedicated reader.`,
    );
  }

  const reflectFile = file(compiler.program, REFLECT);
  const markerValue = stringConstant(reflectFile, PHYSICAL_TAG.markerConstant);
  if (markerValue !== PHYSICAL_TAG.marker) {
    problems.push(
      `${REFLECT}: \`${PHYSICAL_TAG.markerConstant}\` must be the literal \`${PHYSICAL_TAG.marker}\`; ` +
        `found ${markerValue === undefined ? 'no literal declaration' : `\`${markerValue}\``}.`,
    );
  }

  const physicalReaders = new Map(
    [PHYSICAL_TAG.directReader, PHYSICAL_TAG.intersectionReader, PHYSICAL_TAG.tableOwner, PHYSICAL_TAG.columnOwner].map(
      name => [name, methodCoverage(reflectFile, name)],
    ),
  );
  for (const [name, coverage] of physicalReaders) {
    if (coverage.count !== 1) {
      problems.push(`${REFLECT}: expected exactly one \`${name}\` method for the dedicated Physical tag path.`);
    }
  }

  const direct = physicalReaders.get(PHYSICAL_TAG.directReader);
  const intersection = physicalReaders.get(PHYSICAL_TAG.intersectionReader);
  const tableOwnerCoverage = physicalReaders.get(PHYSICAL_TAG.tableOwner);
  const columnOwnerCoverage = physicalReaders.get(PHYSICAL_TAG.columnOwner);
  if (direct?.calls.has('recognizedTag') !== true || direct?.identifiers.has(PHYSICAL_TAG.markerConstant) !== true) {
    problems.push(
      `${REFLECT}: \`${PHYSICAL_TAG.directReader}\` must read \`${PHYSICAL_TAG.markerConstant}\` ` +
        'through `recognizedTag`.',
    );
  }
  if (intersection?.calls.has(PHYSICAL_TAG.directReader) !== true) {
    problems.push(
      `${REFLECT}: \`${PHYSICAL_TAG.intersectionReader}\` must call \`${PHYSICAL_TAG.directReader}\` ` +
        `for a property intersection's ${PHYSICAL_TAG.irFields[1]}.`,
    );
  }
  if (tableOwnerCoverage?.calls.has(PHYSICAL_TAG.directReader) !== true) {
    problems.push(
      `${REFLECT}: \`${PHYSICAL_TAG.tableOwner}\` must call \`${PHYSICAL_TAG.directReader}\` ` +
        `for ${PHYSICAL_TAG.irFields[0]}.`,
    );
  }
  if (columnOwnerCoverage?.calls.has(PHYSICAL_TAG.intersectionReader) !== true) {
    problems.push(
      `${REFLECT}: \`${PHYSICAL_TAG.columnOwner}\` must call \`${PHYSICAL_TAG.intersectionReader}\` ` +
        `for ${PHYSICAL_TAG.irFields[1]}.`,
    );
  }

  // Two IR fields sharing a slot is normal — the four relation tags are one slot — but two
  // *tag fields* sharing one where the reflection reads both is not, so it is reported.
  for (const [symbolName, fields] of namedBy) {
    if (fields.length > 1) notes.push(`\`${symbolName}\` carries ${fields.length} IR fields: ${fields.join(', ')}`);
  }

  // --- 3. the reflection reads every field ----------------------------------
  const { read, unresolved } = fieldsReadBy(reflectFile);
  for (const { line, variable } of unresolved) {
    problems.push(
      `${REFLECT}:${line}: a tag is read through \`${variable}\`, and this cannot tell which fields that ` +
        `covers. Loop a vocabulary list this script knows (${[...ITERATED_VOCABULARIES.keys()].join(', ')}) ` +
        `or ask for the field by name.`,
    );
  }
  for (const field of TAG_FIELDS) {
    if (!read.has(field)) {
      problems.push(
        `${REFLECT}: nothing reads \`tags.get('${field}')\` or \`tags.has('${field}')\`. ` +
          `\`TAG_NAMES.${field}\` promises the tag reaches the IR and nothing keeps the promise.`,
      );
    }
  }
  for (const field of read) {
    if (!TAG_FIELDS.includes(field)) {
      problems.push(`${REFLECT}: reads the tag field \`${field}\`, which \`TAG_NAMES\` does not have.`);
    }
  }

  // --- 4. the prose tables name real tags -----------------------------------
  const vocabularyFile = file(core.program, VOCABULARY);
  const flagToTag = stringTable(vocabularyFile, 'FLAG_TO_TAG');
  const constraintToTag = stringTable(vocabularyFile, 'CONSTRAINT_TO_TAG');
  if (flagToTag.size === 0 || constraintToTag.size === 0) {
    problems.push(`${VOCABULARY}: FLAG_TO_TAG or CONSTRAINT_TO_TAG is not the \`{ key: 'value' }\` table this reads.`);
  }
  for (const [table, entries] of [
    ['FLAG_TO_TAG', flagToTag],
    ['CONSTRAINT_TO_TAG', constraintToTag],
  ]) {
    for (const [key, { text, line }] of entries) {
      for (const named of tagNamesIn(text)) {
        // Anything the module exports, not only the tags: `nullable` is spelled `Nullable<T>`,
        // which is a readability alias and deliberately *not* a tag (REQ-TF-2). The check is
        // that the name still resolves to something, which a rename breaks either way.
        if (exported.has(named)) continue;
        problems.push(
          `${VOCABULARY}:${line}: ${table}.${key} is \`${text}\`, and \`${TAGS}\` exports no \`${named}\`.`,
        );
      }
    }
  }

  // Every constraint kind's tag, taken from the repo's own table rather than restated.
  const constraintTags = new Map();
  for (const [kind, { text }] of constraintToTag) {
    const [head] = tagNamesIn(text);
    if (head !== undefined) constraintTags.set(kind, head);
  }
  for (const kind of KNOWN_CONSTRAINT_KINDS) {
    if (!constraintTags.has(kind)) {
      problems.push(`${VOCABULARY}: CONSTRAINT_TO_TAG has no row naming a tag for \`${kind}\`.`);
    }
  }

  // --- 5. every tag has been through the reflection at least once ------------
  const fixtureRoot = resolve(ROOT, FIXTURES);
  const written = new Set();
  const writtenAnywhere = new Set();
  for (const fileName of compiler.program.getSourceFileNames()) {
    const isFixture = fileName.startsWith(fixtureRoot);
    const isTest = TEST_FILE.some(pattern => pattern.test(fileName));
    if (!isFixture && !isTest) continue;
    const sourceFile = compiler.program.getSourceFile(fileName);
    if (!sourceFile) continue;
    for (const name of typeReferencesIn(sourceFile)) {
      writtenAnywhere.add(name);
      if (isFixture) written.add(name);
    }
  }
  for (const fileName of core.program.getSourceFileNames()) {
    if (!TEST_FILE.some(pattern => pattern.test(fileName))) continue;
    const sourceFile = core.program.getSourceFile(fileName);
    if (!sourceFile) continue;
    for (const name of typeReferencesIn(sourceFile)) writtenAnywhere.add(name);
  }

  for (const [tag] of tags) {
    if (!writtenAnywhere.has(tag)) {
      problems.push(
        `\`${tag}\` is exported from ${TAGS} and no test or fixture writes it. ` +
          `A vocabulary entry nothing has ever declared is an entry whose behaviour is a guess.`,
      );
    }
  }
  // And per slot, in the corpus the reflection is actually run over: one tag spelling each
  // slot is enough — `ManyToOne` covers `zmdbRelation` for the reflection's purposes, since
  // the four cardinalities are one payload read one way.
  for (const [slot, line] of slots) {
    const spellings = [...tags].filter(([, used]) => used.has(slot)).map(([tag]) => tag);
    if (spellings.length > 0 && !spellings.some(tag => written.has(tag))) {
      problems.push(
        `${TAGS}:${line}: no fixture in ${FIXTURES} writes ${spellings.join(' / ')}, so the reflection's ` +
          `\`${slot}\` path has never run. Add it to the corpus \`reflect.spec.ts\` reads.`,
      );
    }
  }

  // --- 6. a constraint reader reads all five --------------------------------
  const exemptionsUsed = new Set();
  const shipped = fileName =>
    /\/src\//.test(fileName) && !TEST_FILE.some(pattern => pattern.test(fileName)) && !fileName.endsWith('.d.ts');

  for (const { program, label } of [
    { program: core.program, label: 'schema-core' },
    { program: validator.program, label: 'aot-validator' },
    { program: compiler.program, label: 'compiler' },
  ]) {
    for (const fileName of program.getSourceFileNames()) {
      // The compiler project includes workspace dependencies in its TypeScript program.
      // Only compiler-owned sources extend this verifier's existing scan surface.
      if (label === 'compiler' && !fileName.startsWith(`${COMPILER_SOURCE_ROOT}/`)) continue;
      if (!shipped(fileName)) continue;
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const where = relative(ROOT, fileName);
      for (const found of [...constraintReaders(sourceFile), ...constraintDeclarers(sourceFile)]) {
        const missing = KNOWN_CONSTRAINT_KINDS.filter(kind => !found.fields.has(kind));
        if (missing.length === 0) continue;
        if (PARTIAL_ON_PURPOSE.includes(found.name)) {
          exemptionsUsed.add(found.name);
          continue;
        }
        problems.push(
          `${where}:${found.line}: \`${found.name}\` handles ${found.fields.size} of ` +
            `${KNOWN_CONSTRAINT_KINDS.length} constraints, missing ${missing.join(', ')}. ` +
            `Every field of \`Constraints\` is optional, so dropping one is not a type error — ` +
            `it is the bug the IR replaced \`TypeDescriptor\` to end.`,
        );
      }
    }
  }
  for (const exemption of PARTIAL_ON_PURPOSE) {
    if (!exemptionsUsed.has(exemption)) {
      problems.push(
        `PARTIAL_ON_PURPOSE lists \`${exemption}\`, and nothing by that name handles a partial ` +
          `set of constraints any more. Delete the exemption.`,
      );
    }
  }

  // --- 7. every constraint tag has its runtime twin -------------------------
  const runtimeFile = file(validator.program, RUNTIME);
  const builders = runtimeRuleNames(runtimeFile);
  const fallbackCases = caseLiteralsIn(runtimeFile);
  const inlineCases = caseLiteralsIn(file(compiler.program, INLINER));
  for (const [kind, tag] of constraintTags) {
    if (!builders.has(tag)) {
      problems.push(`${RUNTIME}: \`tags\` has no \`${tag}\` builder, so \`${kind}\` cannot be written at runtime.`);
    }
    if (!fallbackCases.has(tag)) {
      problems.push(
        `${RUNTIME}: \`validate\` has no \`case '${tag}'\`, so the fallback throws where the build answers.`,
      );
    }
    if (!inlineCases.has(tag)) {
      problems.push(
        `${INLINER}: the inliner has no \`case '${tag}'\`, so it falls back to a \`validate\` call ` +
          `and REQ-AV-3's inlining silently does not apply to \`${kind}\`.`,
      );
    }
  }

  // --- the report -----------------------------------------------------------
  console.log(
    `tag vocabulary: ${slots.size - structural.size} symbol slot(s), ${structural.size} structural marker(s), ` +
      `${tags.size} exported tag(s), ${TAG_FIELDS.length} TAG_NAMES field(s), ` +
      `${PHYSICAL_TAG.irFields.length} dedicated Physical field(s)\n`,
  );
  const pad = (text, width) => String(text).padEnd(width);
  console.log('  marker                 IR field(s)                tag(s)');
  for (const [slot] of slots) {
    const fields = (namedBy.get(slot) ?? (slot === PHYSICAL_TAG.marker ? PHYSICAL_TAG.irFields : ['—'])).join(', ');
    const spellings = [...tags]
      .filter(([, used]) => used.has(slot))
      .map(([tag]) => tag)
      .join(', ');
    console.log(`  ${pad(slot, 22)} ${pad(fields, 25)} ${spellings}`);
  }
  console.log(
    `\n  read by the reflection: ${read.size}/${TAG_FIELDS.length} IR field(s)` +
      `\n  written by a fixture:   ${[...tags].filter(([tag]) => written.has(tag)).length}/${tags.size} tag(s)` +
      `\n  constraint kinds:       ${KNOWN_CONSTRAINT_KINDS.join(', ')}`,
  );
  for (const note of notes) console.log(`  note: ${note}`);
  console.log(
    `  note: \`${PHYSICAL_TAG.marker}\` carries ${PHYSICAL_TAG.irFields.join(', ')} through ` +
      `${PHYSICAL_TAG.directReader}`,
  );
} finally {
  core.api.close();
  validator.api.close();
  compiler.api.close();
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error('REQ-TF-1 is the requirement that the tag vocabulary can say everything the value');
  console.error('front-end could. `vocabulary.type-test.ts` gates the part a type can state; this');
  console.error('gates the part that compiles while being wrong.');
  process.exit(1);
}

console.log('\nevery marker has a tag, every tag reaches the IR, and every constraint is read whole.');
