// codemod-tagged-schema — a `defineSchema` call becomes a tagged interface.
//
//   const users = defineSchema('users', {
//     id: serial().primaryKey(),
//     email: varchar(255).unique(),
//     bio: text().nullable(),
//   });
//
// becomes
//
//   export interface Users extends Table<'users'> {
//     id: number & Sql<'integer'> & Serial & PrimaryKey;
//     email: string & Sql<'varchar'> & Length<255> & Unique;
//     bio: (string & Sql<'text'>) | null;
//   }
//
// It has to exist for the in-repo migration either way — every package's fixtures, the
// benchmarks and the docs examples all declare schemas — so making it consumer-runnable
// costs little, and with `defineSchema` on its way out (plan D2) it is the whole of the
// migration story.
//
// ---------------------------------------------------------------------------
// Why the compiler, and why an interpreter rather than a regex
// ---------------------------------------------------------------------------
//
// `f70186c6` is the record of what text-matching costs in this repository: a hand-rolled
// parser read `string[]` as `string`, and the build reported no problem at all. The same
// trap is open here — `references(integer().primaryKey(), 'users', 'id')` is not a thing
// a regex reads correctly — so this walks a real parse tree from
// `typescript/unstable/sync` and abstractly interprets each builder chain.
//
// The interpretation is exact rather than best-effort because the DSL is **closed**: ten
// builders, seven fluent modifiers, the same seven function-style, and `references`.
// Anything outside that list is refused *by name* and its call site is left untouched. A
// wrong interface is far worse than an unconverted one, because the wrongness is silent
// and the DDL that comes out of it still looks fine.
//
// ---------------------------------------------------------------------------
// The two things that do not survive a round trip
// ---------------------------------------------------------------------------
//
//   - **A default value.** `HasDefault` means "has one", not "has this one". A default is
//     a runtime value and no type holds it, so `defaultTo(now())` converts to
//     `HasDefault` and the value is reported as dropped.
//   - **A `json<T>()` payload.** It converts *out* fine — the phantom type argument is
//     right there in the source — but it cannot come back, because `irFromSchema` has no
//     payload to read.
//
// Relations are not a gap: `defineSchema` has none to read. They live in a separate
// `relations` map and are a separate migration.
//
// `codemod.spec.ts` asserts the converted interface reflects to the same `SchemaIR` as
// the original value, modulo exactly those two fields and nothing else.
//
// Usage:
//   node scripts/codemod-tagged-schema.mjs [options] <file...>
//
//   --project <tsconfig>  the program to read the files from (default: nearest above)
//   --write               rewrite each file in place
//   --json                emit machine-readable records on stdout
//   --quiet               suppress the human-readable report
//
// Rewritten files are not formatted; run `yarn fmt` after `--write`.
// Exits non-zero when any `defineSchema` call site was refused.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { SyntaxKind } from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

import { escapeTypeString, renderTaggedProperty } from '../packages/migrations/src/declarations/tagged-property.ts';

// ---------------------------------------------------------------------------
// The closed vocabulary.
// ---------------------------------------------------------------------------

/** builder → the `SqlType` it produces. */
const BUILDERS = {
  serial: 'serial',
  integer: 'integer',
  bigint: 'bigint',
  numeric: 'numeric',
  text: 'text',
  varchar: 'varchar',
  boolean: 'boolean',
  timestamp: 'timestamp',
  json: 'json',
  jsonEnum: 'jsonEnum',
};

/** `ValidationRule.kind` → the tag that spells the same constraint. See `ir`'s alias table. */
const CONSTRAINT_TAGS = {
  minimum: 'Min',
  Min: 'Min',
  maximum: 'Max',
  Max: 'Max',
  minLength: 'MinLength',
  MinLength: 'MinLength',
  maxLength: 'MaxLength',
  MaxLength: 'MaxLength',
  pattern: 'Pattern',
  Pattern: 'Pattern',
};

const MODIFIERS = new Set([
  'notNull',
  'nullable',
  'primaryKey',
  'unique',
  'defaultTo',
  'validate',
  'sensitive',
  'references',
]);

/** Every name the DSL contributes to a file, for pruning the import after a rewrite. */
const DSL_NAMES = new Set([...Object.keys(BUILDERS), ...MODIFIERS, 'defineSchema']);

class Refusal extends Error {}

function refuse(what, why) {
  throw new Refusal(`${what}: ${why}`);
}

// ---------------------------------------------------------------------------
// Reading literals out of the tree.
// ---------------------------------------------------------------------------

/** Strip the wrappers that do not change a value: parens, `as const`, `satisfies`. */
function unwrap(node) {
  let current = node;
  while (
    current.kind === SyntaxKind.ParenthesizedExpression ||
    current.kind === SyntaxKind.AsExpression ||
    current.kind === SyntaxKind.SatisfiesExpression
  ) {
    current = current.expression;
  }
  return current;
}

function literalValue(node, what) {
  const inner = node === undefined ? undefined : unwrap(node);
  switch (inner?.kind) {
    case SyntaxKind.StringLiteral:
      return inner.text;
    case SyntaxKind.NumericLiteral:
      return Number(inner.text);
    case SyntaxKind.TrueKeyword:
      return true;
    case SyntaxKind.FalseKeyword:
      return false;
    case SyntaxKind.NullKeyword:
      return null;
    default:
      return refuse(what, 'expected a literal');
  }
}

/** `{ kind: 'minimum', value: 18 }` → `{ kind, value }` as nodes, refusing anything computed. */
function objectLiteral(node, what) {
  const inner = node === undefined ? undefined : unwrap(node);
  if (inner?.kind !== SyntaxKind.ObjectLiteralExpression) return refuse(what, 'expected an object literal');
  const out = {};
  for (const property of inner.properties) {
    if (property.kind !== SyntaxKind.PropertyAssignment) {
      return refuse(what, 'expected plain `key: value` properties');
    }
    out[propertyName(property.name, what)] = property.initializer;
  }
  return out;
}

function propertyName(node, what) {
  if (node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.StringLiteral) return node.text;
  return refuse(what, 'expected an identifier or string property name');
}

function calleeName(call) {
  const target = call.expression;
  if (target.kind === SyntaxKind.Identifier) return target.text;
  if (target.kind === SyntaxKind.PropertyAccessExpression) return target.name.text;
  return undefined;
}

/**
 * A local name resolved back to the name it was imported under.
 *
 * `import { references as references_ }` is the same `references`, and refusing it would
 * be refusing a spelling rather than a construct — `schema-core.spec.ts` uses exactly
 * that alias. A fluent method name is never aliased, so this only applies to the callee
 * of a plain identifier call, which is what `readColumn` asks it about.
 */
function resolveName(name, context) {
  return context.aliases.get(name) ?? name;
}

// ---------------------------------------------------------------------------
// The interpreter: a builder chain → the column facts.
// ---------------------------------------------------------------------------

function emptyColumn() {
  return {
    sql: undefined,
    nullable: false,
    primaryKey: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    length: undefined,
    enumValues: undefined,
    payload: undefined,
    references: undefined,
    constraints: [],
    rules: [],
    droppedDefault: false,
  };
}

/**
 * Read one column expression.
 *
 * Both spellings land in the same place, which is the point of doing this on the tree:
 * `primaryKey(serial())` and `serial().primaryKey()` are the same column, and
 * `type-derivation.type-test.ts` asserts as much, so they must convert identically.
 */
function readColumn(node, context, what) {
  const inner = unwrap(node);
  if (inner.kind !== SyntaxKind.CallExpression) return refuse(what, 'expected a column builder call');
  const called = calleeName(inner);
  if (called === undefined) return refuse(what, 'expected a named call');
  // A fluent modifier is a property, never an import, so only a bare callee is an alias.
  const name = inner.expression.kind === SyntaxKind.Identifier ? resolveName(called, context) : called;

  // A builder: `serial()`, `varchar(255)`, `json<Line[]>()`, `jsonEnum([...])`.
  if (Object.hasOwn(BUILDERS, name) && inner.expression.kind === SyntaxKind.Identifier) {
    const column = emptyColumn();
    column.sql = BUILDERS[name];
    if (name === 'varchar') column.length = literalValue(inner.arguments[0], `${what}: varchar length`);
    if (name === 'jsonEnum') column.enumValues = enumMembers(inner.arguments[0], what);
    if (name === 'json') {
      const payload = inner.typeArguments?.[0];
      if (payload) column.payload = context.text.slice(payload.getStart(), payload.end).trim();
    }
    return column;
  }

  if (!MODIFIERS.has(name)) return refuse(what, `unknown column function \`${called}\``);

  // Fluent (`col.notNull()`) takes the receiver; function-style (`notNull(col)`) takes
  // the first argument. Whatever is left over is the modifier's own arguments.
  const fluent = inner.expression.kind === SyntaxKind.PropertyAccessExpression;
  const subject = fluent ? inner.expression.expression : inner.arguments[0];
  if (!subject) return refuse(what, `\`${name}\` needs a column`);
  const args = fluent ? [...inner.arguments] : [...inner.arguments].slice(1);
  return applyModifier(readColumn(subject, context, what), name, args, context, what);
}

function enumMembers(node, what) {
  const inner = node === undefined ? undefined : unwrap(node);
  if (inner?.kind !== SyntaxKind.ArrayLiteralExpression) return refuse(what, '`jsonEnum` needs an array literal');
  return inner.elements.map(element => {
    const value = literalValue(element, `${what}: enum member`);
    if (typeof value !== 'string') return refuse(what, '`jsonEnum` members must be string literals');
    return value;
  });
}

function applyModifier(column, name, args, context, what) {
  switch (name) {
    case 'notNull':
      column.nullable = false;
      return column;
    case 'nullable':
      column.nullable = true;
      return column;
    case 'primaryKey':
      column.primaryKey = true;
      return column;
    case 'unique':
      column.unique = true;
      return column;
    case 'defaultTo':
      // The flag converts; the value exists in no type. Recorded so the report says so
      // out loud rather than leaving the reader to notice.
      column.hasDefault = true;
      column.droppedDefault = true;
      return column;
    case 'sensitive':
      // `sensitive(false)` is a column that is *not* sensitive, and the runtime honours
      // that (`isSensitive !== false`), so it must not pick up the tag here.
      column.sensitive = args[0] === undefined ? true : literalValue(args[0], `${what}: sensitive`) !== false;
      return column;
    case 'validate':
      return applyRule(column, args[0], what);
    case 'references':
      column.references = referenceTarget(args, context, what);
      return column;
    default:
      return refuse(what, `unknown modifier \`${name}\``);
  }
}

function applyRule(column, node, what) {
  const rule = objectLiteral(node, `${what}: validate`);
  if (!rule.kind) return refuse(what, 'a validation rule needs a `kind`');
  const kind = literalValue(rule.kind, `${what}: rule kind`);
  const tag = CONSTRAINT_TAGS[kind];
  if (tag === undefined) {
    // An unmodelled rule is a *named* rule, which the vocabulary has a tag for
    // (`Rule<'name'>`) and which the emitter must resolve or refuse (plan D4). Emitting
    // the name keeps the check; dropping it would silently weaken the validator.
    column.rules.push(kind);
    return column;
  }
  // `value` is the DSL's spelling, `args` the runtime `tags.Min(n)` one; `ir`'s
  // `ruleArgument` reads either, so both are accepted here too.
  const source = rule.value ?? (rule.args ? unwrap(rule.args).elements?.[0] : undefined);
  column.constraints.push([tag, literalValue(source, `${what}: \`${kind}\` value`)]);
  return column;
}

/**
 * `references(col, 'users', 'id')` → `'users.id'`, matching what `defineSchema` stores.
 *
 * The target may also be a schema *value* — `references(col, users, 'id')` — in which case
 * the table name lives on that schema. It is recovered from a `defineSchema` call in the
 * same file; an import from elsewhere is refused rather than guessed, because "which table
 * is `users`" is not a question the syntax answers.
 */
function referenceTarget(args, context, what) {
  const [target, column] = args;
  if (!target) return refuse(what, '`references` needs a target');
  const inner = unwrap(target);
  let table;
  if (inner.kind === SyntaxKind.StringLiteral) {
    table = inner.text;
  } else if (inner.kind === SyntaxKind.Identifier) {
    table = context.tables.get(inner.text) ?? context.importedTable(inner.text);
    if (table === undefined) {
      return refuse(what, `\`references\` names \`${inner.text}\`, whose table name could not be resolved`);
    }
  } else {
    return refuse(what, '`references` needs a string table name or a schema this run can resolve');
  }
  return column === undefined ? table : `${table}.${literalValue(column, `${what}: reference column`)}`;
}

// ---------------------------------------------------------------------------
// Printing: the column facts → a tagged property.
// ---------------------------------------------------------------------------

function printProperty(name, column, tagsUsed) {
  const rendered = renderTaggedProperty(name, column);
  if ('reason' in rendered) return refuse(name, rendered.reason);
  for (const tag of rendered.tags) tagsUsed.add(tag);
  return rendered.source;
}

/** `UserSchema` → `User`; `users` → `Users`. Deterministic, and never from the table name. */
function interfaceName(declared) {
  const stripped = declared.replace(/Schema$/, '') || declared;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

// ---------------------------------------------------------------------------
// One `defineSchema` call → one declaration.
// ---------------------------------------------------------------------------

function convertCall(call, declaredName, context) {
  const [tableArg, columnsArg, optionsArg] = call.arguments;
  const table = literalValue(tableArg, `${declaredName}: table name`);
  if (typeof table !== 'string') refuse(declaredName, 'the table name must be a string literal');

  const columns = objectLiteral(columnsArg, `${declaredName}: columns`);
  if (Object.keys(columns).length === 0) refuse(declaredName, 'a schema with no columns converts to nothing');

  const tagsUsed = new Set(['Table']);
  const lines = [];
  const droppedDefaults = [];
  for (const [name, initializer] of Object.entries(columns)) {
    const column = readColumn(initializer, context, `${declaredName}.${name}`);
    lines.push(printProperty(name, column, tagsUsed));
    if (column.droppedDefault) droppedDefaults.push(name);
  }

  let heritage = `Table<'${escapeTypeString(table)}'>`;
  if (optionsArg) {
    const options = objectLiteral(optionsArg, `${declaredName}: options`);
    const unknownOption = Object.keys(options).find(key => key !== 'ftsTable');
    if (unknownOption) refuse(declaredName, `unknown schema option \`${unknownOption}\``);
    if (options.ftsTable) {
      const fts = literalValue(options.ftsTable, `${declaredName}: ftsTable`);
      tagsUsed.add('Fts');
      heritage += `, Fts<${typeof fts === 'string' ? `'${escapeTypeString(fts)}'` : String(fts)}>`;
    }
  }

  const name = interfaceName(declaredName);
  return {
    declaredName,
    name,
    table,
    tags: [...tagsUsed].toSorted(),
    droppedDefaults,
    source: `export interface ${name} extends ${heritage} {\n${lines.join('\n')}\n}`,
  };
}

// ---------------------------------------------------------------------------
// Walking a file.
// ---------------------------------------------------------------------------

function eachNode(node, visit) {
  visit(node);
  node.forEachChild(child => {
    eachNode(child, visit);
    return undefined;
  });
}

/** Every `defineSchema(...)` call in the file, with the name it was bound to. */
function findSchemaCalls(sourceFile, aliases) {
  const found = [];
  eachNode(sourceFile, node => {
    if (node.kind !== SyntaxKind.CallExpression) return;
    const called = calleeName(node);
    if (called === undefined) return;
    if ((aliases.get(called) ?? called) !== 'defineSchema') return;
    found.push({ call: node, declaration: enclosingDeclaration(node) });
  });
  return found;
}

const TYPE_DECLARATIONS = new Set([
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.EnumDeclaration,
]);

const SCOPES = new Set([SyntaxKind.SourceFile, SyntaxKind.Block, SyntaxKind.ModuleBlock, SyntaxKind.CaseBlock]);

/** The scopes enclosing a node, innermost first. The emitted interface lives in the first. */
function enclosingScopes(node) {
  const scopes = [];
  for (let current = node; current; current = current.parent) {
    if (SCOPES.has(current.kind)) scopes.push(current);
  }
  return scopes;
}

/**
 * Every type name the file declares, paired with the scope that declares it.
 *
 * The interface name is derived from the `const`, so `ConfigSchema` becomes `Config` — and
 * `typed-writes.spec.ts` already has an `interface Config` in the same `it` block, for the
 * JSON payload. Without this check the codemod emitted `settings: Config & Sql<'json'>`
 * inside its own `interface Config`: a self-referential type, accepted by the compiler and
 * meaning nothing like the original. Exactly the silent wrongness the interpreter exists to
 * avoid, so a collision is a refusal — renaming is not on the table, because every
 * reference would have to move with the name and the codemod does not own the file.
 *
 * Scoped rather than per-file, because per-file was too blunt: `schema-core.spec.ts`
 * declares `const s` in a dozen separate `it` blocks, and those do not collide with each
 * other any more than two local variables in two functions do.
 */
function declaredTypeNames(sourceFile) {
  const declarations = [];
  eachNode(sourceFile, node => {
    if (!TYPE_DECLARATIONS.has(node.kind)) return;
    if (node.name?.kind !== SyntaxKind.Identifier) return;
    declarations.push({ name: node.name.text, scope: enclosingScopes(node)[0] });
  });
  return declarations;
}

/**
 * Every identifier the file still *uses* once the given ranges are gone.
 *
 * The question this answers is "is this import still needed after the rewrite", and it is
 * answered on the tree rather than by searching the text, because the text answer is
 * wrong: this corpus's own header comment contains the word `json`, which would have kept
 * a now-dead `json` import alive on the strength of a comment. Import declarations are
 * skipped, so importing `X` does not count as using `X`, and a property name is skipped,
 * so `.validate(…)` on something else is not a use of the DSL's `validate`.
 */
function usedIdentifiers(sourceFile, removed) {
  const used = new Set();
  const inRemoved = node => removed.some(range => node.getStart() >= range.start && node.end <= range.end);
  const visit = node => {
    if (node.kind === SyntaxKind.ImportDeclaration || inRemoved(node)) return;
    if (node.kind === SyntaxKind.Identifier) used.add(node.text);
    node.forEachChild(child => {
      // A property access is `x.name`: `x` is a use, `name` is not.
      if (node.kind === SyntaxKind.PropertyAccessExpression && child === node.name) return undefined;
      visit(child);
      return undefined;
    });
  };
  visit(sourceFile);
  return used;
}

/** `{ table name → local name }` for every `defineSchema` in a file, bound to a `const`. */
function tableNames(sourceFile, aliases) {
  const tables = new Map();
  for (const { call, declaration } of findSchemaCalls(sourceFile, aliases)) {
    if (!declaration) continue;
    const inner = call.arguments[0] === undefined ? undefined : unwrap(call.arguments[0]);
    if (inner?.kind === SyntaxKind.StringLiteral) tables.set(declaration, inner.text);
  }
  return tables;
}

/**
 * The `const X = …` a call is the initializer of, if it is one.
 *
 * A `defineSchema` call not bound to a name has nothing to name an interface after, and
 * inventing one from the table would mean shipping a de-pluraliser — a fifth source of
 * truth, and the same guess the reflection refuses to make in the other direction.
 */
function enclosingDeclaration(call) {
  let node = call.parent;
  while (node && node.kind !== SyntaxKind.VariableDeclaration) {
    // A call nested inside another call is an argument, not a declaration.
    if (node.kind === SyntaxKind.CallExpression) return undefined;
    node = node.parent;
  }
  if (!node || node.initializer === undefined || unwrap(node.initializer) !== call) return undefined;
  return node.name?.kind === SyntaxKind.Identifier ? node.name.text : undefined;
}

/**
 * The named imports in the file: what came from where, and under what local name.
 *
 * Two callers. The rewrite prunes the DSL names it made unused, and `readColumn` resolves
 * an alias back to the name it was imported under.
 */
function namedImports(sourceFile) {
  const found = [];
  for (const statement of sourceFile.statements) {
    if (statement.kind !== SyntaxKind.ImportDeclaration) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier?.kind !== SyntaxKind.StringLiteral) continue;
    const elements = statement.importClause?.namedBindings?.elements ?? [];
    found.push({
      module: specifier.text,
      start: statement.getStart(),
      end: statement.end,
      // `import { a as b }` puts `a` on `propertyName` and `b` on `name`.
      bindings: elements.map(element => ({
        local: element.name.text,
        imported: element.propertyName?.text ?? element.name.text,
      })),
      // A default import shares the statement, so the clause may be prunable when the
      // statement is not.
      hasDefault: statement.importClause?.name !== undefined,
    });
  }
  return found;
}

/**
 * A schema imported from another module, resolved to its table name.
 *
 * `references(integer(), UserSchema, 'id')` is a real spelling in this repository and the
 * table name is not in the file, so refusing it would leave `typed-relations.spec.ts`
 * unconverted over a one-hop lookup. One hop only: a re-export is a second question and
 * gets a refusal rather than a guess.
 */
function importedTableResolver(sourceFile, imports, aliases, resolveModule) {
  const byLocal = new Map();
  for (const declaration of imports) {
    for (const binding of declaration.bindings) byLocal.set(binding.local, { ...binding, module: declaration.module });
  }
  return local => {
    const binding = byLocal.get(local);
    if (!binding || !resolveModule) return undefined;
    const target = resolveModule(binding.module, sourceFile.fileName);
    if (!target) return undefined;
    return tableNames(target, aliases).get(binding.imported);
  };
}

export function convertFile(sourceFile, text, resolveModule) {
  const imports = namedImports(sourceFile);
  const aliases = new Map(
    imports.flatMap(declaration =>
      declaration.bindings
        .filter(binding => binding.local !== binding.imported)
        .map(binding => [binding.local, binding.imported]),
    ),
  );

  const calls = findSchemaCalls(sourceFile, aliases);
  // Every local schema's table name, collected up front so `references(col, users, 'id')`
  // resolves even when `users` is declared below the schema that points at it.
  const context = {
    text,
    aliases,
    tables: tableNames(sourceFile, aliases),
    importedTable: importedTableResolver(sourceFile, imports, aliases, resolveModule),
  };
  // Two schemas in one scope can derive the same name — `UserSchema` and `user` both give
  // `User` — and the second would shadow the first as quietly as any other collision, so
  // each conversion joins the list it is then checked against.
  const taken = declaredTypeNames(sourceFile);
  const converted = [];
  const refusals = [];
  for (const { call, declaration } of calls) {
    const at = `${sourceFile.fileName}:${lineOf(text, call.getStart())}`;
    if (!declaration) {
      refusals.push({ at, reason: 'the call is not bound to a name, so there is nothing to name the interface' });
      continue;
    }
    const name = interfaceName(declaration);
    const scopes = enclosingScopes(call);
    const clash = taken.find(other => other.name === name && scopes.includes(other.scope));
    if (clash) {
      refusals.push({ at, reason: `\`${declaration}\` would become \`${name}\`, which is already declared in scope` });
      continue;
    }
    try {
      converted.push({ ...convertCall(call, declaration, context), start: call.getStart(), end: call.end });
      taken.push({ name, scope: scopes[0] });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      refusals.push({ at, reason: error.message });
    }
  }
  return { converted, refusals, imports, used: usedIdentifiers(sourceFile, converted) };
}

function lineOf(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) if (text[index] === '\n') line++;
  return line;
}

// ---------------------------------------------------------------------------
// Rewriting a file.
// ---------------------------------------------------------------------------

/**
 * Replace each `const X = defineSchema(…)` statement with its interface, add the tag
 * import, and prune the DSL names the rewrite made unused.
 *
 * All three kinds of edit are collected against the *original* offsets and applied in one
 * back-to-front pass, so no edit invalidates another's positions.
 */
export function rewriteFile(text, { converted, imports, used }) {
  const schemaEdits = converted.map(declaration => ({
    ...statementRange(text, declaration.start, declaration.end),
    text: declaration.source,
  }));

  const tags = [...new Set(converted.flatMap(declaration => declaration.tags))].toSorted();
  const importLine = `import type { ${tags.join(', ')} } from '@zmdb/schema-core/tags';`;
  const lastImport = imports.at(-1);
  const edits = [
    ...schemaEdits,
    lastImport
      ? { start: lastImport.end, end: lastImport.end, text: `\n${importLine}` }
      : { start: 0, end: 0, text: `${importLine}\n` },
  ];

  // `used` is what the file still references with the schema statements gone — computed on
  // the tree by `usedIdentifiers`, so a file that goes on calling `text()` outside a schema
  // keeps its import.
  const pruned = [];
  for (const declaration of imports) {
    // Matched on the *imported* name, kept under the *local* one: `references as
    // references_` is still the DSL's `references`, and rebuilding the clause from local
    // names alone would silently rename what survives.
    const dead = declaration.bindings.filter(binding => DSL_NAMES.has(binding.imported) && !used.has(binding.local));
    if (dead.length === 0) continue;
    pruned.push(...dead.map(binding => binding.local));
    const keep = declaration.bindings.filter(binding => !dead.includes(binding));
    edits.push(
      keep.length === 0 && !declaration.hasDefault
        ? { ...statementRange(text, declaration.start, declaration.end), text: '', collapse: true }
        : {
            start: declaration.start,
            end: declaration.end,
            text: text.slice(declaration.start, declaration.end).replace(/\{[\s\S]*\}/, printClause(keep)),
          },
    );
  }

  return { text: apply(text, edits), pruned };
}

function printClause(bindings) {
  if (bindings.length === 0) return '{}';
  const names = bindings.map(binding =>
    binding.local === binding.imported ? binding.local : `${binding.imported} as ${binding.local}`,
  );
  return `{ ${names.join(', ')} }`;
}

function apply(text, edits) {
  let out = text;
  for (const edit of [...edits].toSorted((a, b) => b.start - a.start)) {
    // A statement replaced by nothing takes its trailing newline with it, or the file
    // collects blank lines where the imports used to be.
    const end = edit.collapse && out[edit.end] === '\n' ? edit.end + 1 : edit.end;
    out = out.slice(0, edit.start) + edit.text + out.slice(end);
  }
  return out;
}

/** Widen a call's range to the whole `const … = …;` statement it is the initializer of. */
function statementRange(text, start, end) {
  const lineStart = text.lastIndexOf('\n', start) + 1;
  let after = end;
  while (after < text.length && text[after] !== '\n') after++;
  return { start: lineStart, end: after };
}

// ---------------------------------------------------------------------------
// Driving the compiler.
// ---------------------------------------------------------------------------

/**
 * Convert every file in one program.
 *
 * One `API` per project, not one per file: loading the project is the expensive part and a
 * checker call is cheap, which is the same budget REQ-TF-11 puts on the build.
 */
export function convertFiles(project, files) {
  const api = new API({ cwd: dirname(project) });
  try {
    const program = api.updateSnapshot({ openProjects: [project] }).getProjects()[0]?.program;
    if (!program) throw new Error(`could not load a TypeScript project from ${project}`);
    const resolveModule = moduleResolver(program);
    return files.map(file => {
      const absolute = resolve(file);
      const sourceFile = program.getSourceFile(absolute);
      if (!sourceFile) {
        return {
          file: absolute,
          text: '',
          converted: [],
          imports: [],
          refusals: [{ at: absolute, reason: `not part of ${project}` }],
        };
      }
      return { file: absolute, text: sourceFile.text, ...convertFile(sourceFile, sourceFile.text, resolveModule) };
    });
  } finally {
    api.close();
  }
}

/**
 * A relative import specifier resolved to a source file in the program.
 *
 * Relative only. The repository writes `'./fixtures.ts'` with the extension, which is what
 * ESM requires and what makes this a path join rather than a resolution algorithm; a bare
 * `'@zmdb/schema-core'` would need the real one, and guessing at it is how a codemod
 * silently converts against the wrong file.
 */
export function moduleResolver(program) {
  return (specifier, fromFile) => {
    if (!specifier.startsWith('.')) return undefined;
    return program.getSourceFile(resolve(dirname(fromFile), specifier));
  };
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

/**
 * The nearest `tsconfig.json` above a file, or `undefined`.
 *
 * `undefined` rather than a throw, because a file outside every project is an ordinary
 * thing to hand this — `examples/quickstart.ts` is one — and one such file must not take
 * the other thirty-three down with it. It becomes a refusal like any other.
 */
function nearestProject(file) {
  let directory = dirname(resolve(file));
  for (;;) {
    const candidate = resolve(directory, 'tsconfig.json');
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  }
}

/**
 * Whether a file is worth loading a program for at all.
 *
 * A text test, which everything else here refuses to do — but it is sound in the one
 * direction it is used. A file whose *text* never contains `defineSchema` cannot contain a
 * call to it, aliases included: `import { defineSchema as table }` still spells the name.
 * So a false negative is impossible and a false positive costs one wasted parse.
 *
 * It exists because the alternative is worse than wasted work. A repository-wide run is
 * `codemod … $(git ls-files '*.ts')`, and without this every `tsup.config.ts` and
 * `vitest.config.ts` comes back as "not part of the project" — thirty refusals about files
 * that have no schemas in them, burying the handful that are about files that do, and
 * turning the exit code into noise.
 */
function declaresSchema(file) {
  try {
    return readFileSync(file, 'utf8').includes('defineSchema');
  } catch {
    // Unreadable is not the same as uninteresting: let it through and be refused by name.
    return true;
  }
}

function main(argv) {
  const options = { write: false, json: false, quiet: false, project: undefined };
  const files = [];
  for (let index = 0; index < argv.length; index++) {
    switch (argv[index]) {
      case '--write':
        options.write = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--project':
        options.project = resolve(argv[++index]);
        break;
      default:
        files.push(argv[index]);
    }
  }
  if (files.length === 0) {
    console.error('usage: node scripts/codemod-tagged-schema.mjs [--project t.json] [--write] [--json] <file...>');
    return 2;
  }

  // Grouped by project so a repository-wide run loads each package once.
  const byProject = new Map();
  const orphans = [];
  for (const file of files) {
    if (!declaresSchema(file)) continue;
    const project = options.project ?? nearestProject(file);
    if (project === undefined) {
      orphans.push({
        file: resolve(file),
        text: '',
        converted: [],
        imports: [],
        refusals: [{ at: resolve(file), reason: 'no tsconfig.json above it, so there is no program to read it from' }],
      });
      continue;
    }
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project).push(file);
  }

  const results = [...orphans, ...[...byProject].flatMap(([project, group]) => convertFiles(project, group))];
  let refused = 0;
  let total = 0;
  for (const result of results) {
    refused += result.refusals.length;
    total += result.converted.length;
    if (options.write && result.converted.length > 0) {
      writeFileSync(result.file, rewriteFile(result.text, result).text);
    }
    if (!options.quiet) {
      for (const declaration of result.converted) {
        console.log(`// ${result.file} — ${declaration.declaredName} → ${declaration.name}`);
        console.log(declaration.source);
        for (const name of declaration.droppedDefaults) {
          console.log(`// dropped: the default *value* of \`${name}\`. HasDefault says it has one, not which one.`);
        }
        console.log('');
      }
      for (const refusal of result.refusals) console.error(`[refused] ${refusal.at}: ${refusal.reason}`);
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        results.map(({ text: _text, ...rest }) => rest),
        null,
        2,
      ),
    );
  }
  if (!options.quiet) console.error(`${total} schema(s) converted, ${refused} refused`);
  return refused === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
