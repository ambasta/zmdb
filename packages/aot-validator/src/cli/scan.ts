// The source-analysis half of `zmdb-codegen`: what to generate, which canonical
// package export each call resolves to, and what the generated module has to import.
//
// Nothing here asks the checker anything. That is deliberate — every question this file
// answers is about *text*: which calls carry a type argument, which names that type
// argument mentions, and where those names came from. Answering them syntactically keeps
// the expensive half (one `tsgo` session, one reflection per type) to exactly the call
// sites that survive this pass.
//
// The one non-obvious job is the import block of the witness module. `is<Omit<User, 'id'>>`
// is written in a file where `Omit` is global and `User` is imported from `./models.ts`;
// the same type argument in a *different* file resolves to nothing. So the witness is
// written next to the source it came from and re-states the source's own imports, filtered
// to the names the type arguments actually mention. A name the witness could not import is
// a refusal with the name in it, not a guess (plan D4).

import type { Node, SourceFile } from 'typescript/unstable/ast';
import {
  isClassDeclaration,
  isEnumDeclaration,
  isExportDeclaration,
  isExportKeyword,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isModuleDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isPropertyAccessExpression,
  isQualifiedName,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeQueryNode,
  isTypeReferenceNode,
  isVariableStatement,
} from 'typescript/unstable/ast/is';
import type { Checker } from 'typescript/unstable/sync';

import { CALL_OWNERS, findOwnedCallSites, type CallSite } from '../reflect/callsites.js';
import { CALLEES } from '../transformer.js';

/** How a name got into a module's scope, in a form that can be written down again. */
export interface ImportBinding {
  readonly specifier: string;
  readonly kind: 'default' | 'named' | 'namespace';
  /** The name in the exporting module. Only meaningful for `named`. */
  readonly original: string;
}

/** Everything about one module that the witness generator needs, all of it syntactic. */
export interface ModuleFacts {
  /** Local binding name → the import that introduced it. */
  readonly imports: ReadonlyMap<string, ImportBinding>;
  /** Names this module declares itself, type or value. */
  readonly locals: ReadonlySet<string>;
  /** Names this module exports, however it exports them. */
  readonly exported: ReadonlySet<string>;
}

/** One thing the generated module will export, and the call it comes from. */
export interface Entry {
  readonly callee: string;
  /** The type argument, verbatim from the source it was read in. */
  readonly typeText: string;
  /** The non-default shallow depth, when this call carries one. */
  readonly depthText?: string;
  /** Literal value arguments captured into a zero-argument generated artifact. */
  readonly argumentsText?: readonly string[];
  /** The export name in the generated module. Derived, so it is stable across runs. */
  readonly name: string;
}

/** A call site in a source file, paired with the entry it maps onto. */
export interface SiteEntry {
  readonly site: CallSite;
  readonly entry: Entry;
}

/** What the codegen could not do, and which name made it impossible. */
export interface ScanRefusal {
  readonly typeText: string;
  readonly reason: string;
}

export interface ScanResult {
  readonly entries: readonly Entry[];
  /** Sites in the *source* file, in source order, for the rewrite. */
  readonly sites: readonly SiteEntry[];
  readonly refusals: readonly ScanRefusal[];
  /** Module specifier → the names the witness must import from it. */
  readonly typeImports: readonly TypeImport[];
  /** Callee → where the source got it from, so the witness can get it from there too. */
  readonly calleeSources: ReadonlyMap<string, string>;
}

export interface TypeImport {
  readonly specifier: string;
  readonly kind: 'default' | 'named' | 'namespace';
  /** `original as local`, or just `local` when they match. */
  readonly local: string;
  readonly original: string;
}

// -----------------------------------------------------------------------------
// Reading a module
// -----------------------------------------------------------------------------

/**
 * Whether a declaration carries `export`.
 *
 * boundary: `modifiers` is declared on each of the dozen node types that can have one, and
 * not on `Node`. Asking for it as an optional property is how a walk that accepts any node
 * reads it without a `switch` over those dozen types — and the `Array.isArray` on the next
 * line is what makes the read sound rather than the cast.
 */
function exported(node: Node): boolean {
  const modifiers = (node as { modifiers?: readonly Node[] }).modifiers;
  return Array.isArray(modifiers) && modifiers.some(modifier => isExportKeyword(modifier));
}

/** Import bindings, local declarations and exports of one module. */
export function moduleFacts(sourceFile: SourceFile): ModuleFacts {
  const imports = new Map<string, ImportBinding>();
  const locals = new Set<string>();
  const exports = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (isImportDeclaration(statement)) {
      const specifierNode = statement.moduleSpecifier;
      if (!isStringLiteral(specifierNode)) continue;
      const specifier = specifierNode.text;
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) {
        imports.set(clause.name.text, { specifier, kind: 'default', original: 'default' });
      }
      const bindings = clause.namedBindings;
      if (bindings === undefined) continue;
      if (isNamespaceImport(bindings)) {
        imports.set(bindings.name.text, { specifier, kind: 'namespace', original: '*' });
      } else if (isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!isIdentifier(element.name)) continue;
          const original =
            element.propertyName && isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
          imports.set(element.name.text, { specifier, kind: 'named', original });
        }
      }
      continue;
    }

    if (
      isInterfaceDeclaration(statement) ||
      isTypeAliasDeclaration(statement) ||
      isClassDeclaration(statement) ||
      isEnumDeclaration(statement) ||
      isModuleDeclaration(statement)
    ) {
      const name = statement.name;
      if (name && isIdentifier(name)) {
        locals.add(name.text);
        if (exported(statement)) exports.add(name.text);
      }
      continue;
    }

    if (isVariableStatement(statement)) {
      // Only for `typeof x` in a type argument. The declaration list can destructure, and
      // a destructured binding is not something a type query can name, so plain
      // identifiers are the whole of what is useful here.
      for (const declaration of statement.declarationList.declarations) {
        if (!isIdentifier(declaration.name)) continue;
        locals.add(declaration.name.text);
        if (exported(statement)) exports.add(declaration.name.text);
      }
      continue;
    }

    if (isExportDeclaration(statement)) {
      const bindings = statement.exportClause;
      if (bindings && isNamedExports(bindings)) {
        for (const element of bindings.elements) {
          if (isIdentifier(element.name)) exports.add(element.name.text);
        }
      }
      continue;
    }

    if (exported(statement)) {
      // boundary: same shape as `exported` above — `name` belongs to the declaration types,
      // not to `Node`, and this branch is the fall-through for the statement kinds the cases
      // above did not name. `isIdentifier` is what proves the read, so a node with no `name`
      // and a node whose name is a computed property both fall out here.
      const name = (statement as { name?: Node }).name;
      if (name && isIdentifier(name)) exports.add(name.text);
    }
  }

  return { imports, locals, exported: exports };
}

/**
 * The names a type argument depends on, as written.
 *
 * Only the *head* of a reference counts: `ns.T` needs `ns`, `Omit<User, 'id'>` needs
 * `Omit` and `User`, and the `'id'` needs nothing. Collecting every identifier instead
 * would drag in the property names of an inline object type and then refuse the call site
 * because `email` is not importable.
 */
export function referencedNames(node: Node): ReadonlySet<string> {
  const names = new Set<string>();

  const head = (name: Node): void => {
    if (isIdentifier(name)) names.add(name.text);
    else if (isQualifiedName(name)) head(name.left);
  };

  const walk = (current: Node): void => {
    if (isTypeReferenceNode(current)) head(current.typeName);
    else if (isTypeQueryNode(current)) head(current.exprName);
    current.forEachChild(walk);
  };

  walk(node);
  return names;
}

// -----------------------------------------------------------------------------
// Naming
// -----------------------------------------------------------------------------

/** `is` → `Is`, so the export reads as a sentence: `zmdbIsUser`. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const PREFIXES: Readonly<Record<string, string>> = {
  is: 'Is',
  isShallow: 'IsShallow',
  equals: 'Equals',
  assert: 'Assert',
  assertShallow: 'AssertShallow',
  assertEquals: 'AssertEquals',
  validate: 'Validate',
  validateShallow: 'ValidateShallow',
  random: 'Random',
  toJsonSchema: 'JsonSchema',
  schemaOf: 'Schema',
  toolFor: 'Tool',
  grpcDescriptor: 'GrpcDescriptor',
  loadGrpcService: 'LoadGrpcService',
  protoDescriptor: 'ProtoDescriptor',
  protoDecode: 'ProtoDecode',
  protoEncode: 'ProtoEncode',
};

/** How long a slug may get before it stops being a name and starts being the type. */
const MAX_SLUG = 48;

/**
 * A stable export name for one entry.
 *
 * Stability is the requirement, not beauty: the name is written into the user's source, so
 * it has to come out the same on every run or the codegen produces a diff per invocation.
 * It is derived only from the callee and the type text, both of which are in the source.
 */
export function exportName(
  callee: string,
  typeText: string,
  taken: ReadonlySet<string>,
  depthText?: string,
  identityText?: string,
): string {
  const slug = `${typeText} ${identityText ?? ''}`
    .replaceAll(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(capitalise)
    .join('')
    .slice(0, MAX_SLUG);
  const depth =
    depthText === undefined
      ? ''
      : `Depth${depthText
          .replaceAll(/[^A-Za-z0-9]+/g, ' ')
          .trim()
          .split(/\s+/)
          .map(capitalise)
          .join('')}`;
  const base = `zmdb${PREFIXES[callee] ?? capitalise(callee)}${slug}${depth}`;
  if (!taken.has(base)) return base;
  // Two different types with the same slug — `Pick<User, 'id'>` and `Pick<User, "id">`,
  // say. Numbering is ugly and deterministic, which is the right trade for a generated
  // name; guessing that they are the same type would be neither.
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${String(n)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// -----------------------------------------------------------------------------
// Where the callee came from
// -----------------------------------------------------------------------------

/**
 * The package a callee lives in, for a call that did not import it by name.
 *
 * Only reached by `zmdb.is<User>(x)` where `zmdb` turns out not to be an import either —
 * an unusual file. The subpaths are the truth about where each function is declared, and a
 * project that installed only the umbrella has them all re-exported from `zmdb`, so the
 * import the witness writes resolves in both layouts as long as the source's own import
 * could be read. When it could not, this is the better guess than nothing.
 */
const DEFAULT_MODULES: Readonly<Record<string, string>> = {
  is: '@zmdb/aot-validator/utilities',
  equals: '@zmdb/aot-validator/utilities',
  assert: '@zmdb/aot-validator/utilities',
  assertShallow: '@zmdb/aot-validator/utilities',
  assertEquals: '@zmdb/aot-validator/utilities',
  validate: '@zmdb/aot-validator/utilities',
  validateShallow: '@zmdb/aot-validator/utilities',
  isShallow: '@zmdb/aot-validator/utilities',
  random: '@zmdb/aot-validator/utilities',
  toJsonSchema: '@zmdb/schema-core/openapi',
  schemaOf: '@zmdb/schema-core',
  toolFor: '@zmdb/schema-core/llm',
  grpcDescriptor: '@zmdb/protobuf',
  loadGrpcService: '@zmdb/protobuf',
  protoDescriptor: '@zmdb/protobuf',
  protoDecode: '@zmdb/protobuf',
  protoEncode: '@zmdb/protobuf',
};

/**
 * Which module the witness should import a callee from.
 *
 * The source's own import, whenever there is one, and not a fixed table: a project that
 * installed `zmdb` writes `import { is } from 'zmdb'`, and a witness that reached past it
 * to `@zmdb/aot-validator/utilities` would import a package that is not in the consumer's
 * dependencies. `zmdb.is<User>(x)` resolves through the namespace's own import for the
 * same reason.
 */
function calleeSpecifier(facts: ModuleFacts, site: CallSite): string {
  if (site.specifier !== undefined) return site.specifier;
  const direct = facts.imports.get(site.callee);
  if (direct) return direct.specifier;
  const target = site.node.expression;
  if (isPropertyAccessExpression(target) && isIdentifier(target.expression)) {
    const namespace = facts.imports.get(target.expression.text);
    if (namespace) return namespace.specifier;
  }
  return DEFAULT_MODULES[site.callee] ?? '@zmdb/aot-validator/utilities';
}

// -----------------------------------------------------------------------------
// The scan
// -----------------------------------------------------------------------------

export interface ScanInput {
  readonly checker: Checker;
  readonly sourceFile: SourceFile;
  /** The previous run's witness, when there is one. See `scan` for why it is read. */
  readonly witnessFile?: SourceFile | undefined;
  /**
   * Whether the project lets a relative import name a `.ts` file
   * (`allowImportingTsExtensions`). Only consulted for a file that has no relative import to
   * copy the style from; see `relativeExtension`.
   */
  readonly tsExtensions?: boolean | undefined;
}

/**
 * How to spell a relative import of a sibling `.ts` file, as this module spells it.
 *
 * There is no universally right answer — `./models.ts` needs
 * `allowImportingTsExtensions`, and `./models.js` names a file that does not exist until
 * something compiles it — so the witness copies whatever the source does. Only when the
 * source has no relative import at all does the project's own setting decide.
 */
function relativeExtension(facts: ModuleFacts, tsExtensions: boolean | undefined): string {
  let sawJs = false;
  for (const binding of facts.imports.values()) {
    if (!binding.specifier.startsWith('.')) continue;
    if (/\.[cm]?tsx?$/.test(binding.specifier)) return '.ts';
    if (/\.[cm]?jsx?$/.test(binding.specifier)) sawJs = true;
  }
  if (sawJs) return '.js';
  return tsExtensions === false ? '.js' : '.ts';
}

/** `/a/b/models.ts` → `./models.ts` or `./models.js`, per `relativeExtension`. */
function siblingSpecifier(fileName: string, extension: string): string {
  const name = basename(fileName);
  const stem = name.replace(/\.[cm]?tsx?$/, '');
  return `./${stem}${extension}`;
}

/**
 * Everything the generator needs for one source file.
 *
 * Two inputs rather than one, because the rewrite is destructive: after a run the source
 * says `zmdbIsUser(data)` and the `is<User>` that produced it is gone. The witness keeps
 * it — and keeps it in a form the compiler checks, so a renamed or deleted `User` is a
 * build error in a generated file rather than a validator that quietly describes a type
 * nobody declares any more. So the entry set is the union of the two, and an entry the
 * source has stopped referencing is dropped, which is what stops the witness accumulating
 * validators for code that no longer exists.
 */
export function scan(input: ScanInput): ScanResult {
  const { checker, sourceFile, witnessFile } = input;
  const sourceText = sourceFile.text;

  const entries: Entry[] = [];
  const sites: SiteEntry[] = [];
  const refusals: ScanRefusal[] = [];
  const calleeSources = new Map<string, string>();
  const taken = new Set<string>();
  /** Callee, type, depth and captured literals → one shared generated export. */
  const byKey = new Map<string, Entry>();
  /** Heads still to resolve, and the file each was written in. */
  const pending: { readonly names: ReadonlySet<string>; readonly file: SourceFile; readonly typeText: string }[] = [];

  const add = (
    callee: string,
    typeText: string,
    file: SourceFile,
    node: Node,
    depthText?: string,
    depthNode?: Node,
    argumentsText?: readonly string[],
  ): Entry => {
    const identity = argumentsText?.join('\u0000') ?? '';
    const key = `${callee}\u0000${typeText}\u0000${depthText ?? ''}\u0000${identity}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const entry: Entry = {
      callee,
      typeText,
      ...(depthText === undefined ? {} : { depthText }),
      ...(argumentsText === undefined ? {} : { argumentsText }),
      name: exportName(callee, typeText, taken, depthText, identity),
    };
    taken.add(entry.name);
    byKey.set(key, entry);
    entries.push(entry);
    const names = new Set(referencedNames(node));
    if (depthNode !== undefined) {
      for (const name of referencedNames(depthNode)) names.add(name);
    }
    pending.push({ names, file, typeText });
    return entry;
  };

  const depthOf = (site: CallSite, file: SourceFile): { readonly text?: string; readonly node?: Node } => {
    if (!site.callee.endsWith('Shallow')) return {};
    const node = site.node.typeArguments?.[1];
    if (node === undefined) return {};
    const text = file.text.slice(node.getStart(), node.end).trim();
    return text === '1' ? {} : { text, node };
  };

  const capturedArguments = (site: CallSite, file: SourceFile): readonly string[] | undefined => {
    if (site.callee !== 'grpcDescriptor' && site.callee !== 'loadGrpcService') return undefined;
    const args = site.node.arguments;
    if (args.length !== 2 || !args.every(argument => isStringLiteral(argument))) {
      refusals.push({
        typeText: file.text.slice(site.typeArgument.getStart(), site.typeArgument.end),
        reason: `\`${site.callee}<S>()\` needs exactly two string literals: service and package`,
      });
      return [];
    }
    return args.map(argument => file.text.slice(argument.getStart(), argument.end));
  };

  // The witness is written next to the source, so the source's own relative specifiers
  // resolve unchanged from it. `facts` is therefore consulted per originating file: a
  // carried entry's names were written in the witness and resolve against the witness.
  const factsFor = new Map<SourceFile, ModuleFacts>();
  const facts = (file: SourceFile): ModuleFacts => {
    const cached = factsFor.get(file);
    if (cached) return cached;
    const fresh = moduleFacts(file);
    factsFor.set(file, fresh);
    return fresh;
  };

  // Carried entries first, so an export name never moves because a new call site was added
  // above an old one — the source references these names, and a rename would be a diff in
  // hand-written code for no reason.
  if (witnessFile) {
    for (const site of findOwnedCallSites(witnessFile, checker, CALLEES, CALL_OWNERS)) {
      const typeText = witnessFile.text.slice(site.typeArgument.getStart(), site.typeArgument.end);
      const depth = depthOf(site, witnessFile);
      const argumentsText = capturedArguments(site, witnessFile);
      const name = exportName(site.callee, typeText, new Set(), depth.text, argumentsText?.join('\u0000'));
      // Referenced by identifier, not by import: the source may have been edited by hand
      // since, and what matters is whether the name is still used anywhere in it.
      if (!referencesName(sourceText, name)) continue;
      add(site.callee, typeText, witnessFile, site.typeArgument, depth.text, depth.node, argumentsText);
      calleeSources.set(site.callee, calleeSpecifier(facts(witnessFile), site));
    }
  }

  for (const site of findOwnedCallSites(sourceFile, checker, CALLEES, CALL_OWNERS)) {
    const typeText = sourceText.slice(site.typeArgument.getStart(), site.typeArgument.end);
    const depth = depthOf(site, sourceFile);
    const argumentsText = capturedArguments(site, sourceFile);
    sites.push({
      site,
      entry: add(site.callee, typeText, sourceFile, site.typeArgument, depth.text, depth.node, argumentsText),
    });
    // The source's answer overrides the witness's: the witness only ever says what a
    // previous run wrote, and the user may since have changed where they import from.
    calleeSources.set(site.callee, calleeSpecifier(facts(sourceFile), site));
  }

  const typeImports = new Map<string, TypeImport>();
  const extension = relativeExtension(facts(sourceFile), input.tsExtensions);

  for (const { names, file, typeText } of pending) {
    for (const name of names) {
      if (typeImports.has(name)) continue;
      const binding = facts(file).imports.get(name);
      if (binding) {
        typeImports.set(name, {
          specifier: binding.specifier,
          kind: binding.kind,
          local: name,
          original: binding.original,
        });
        continue;
      }
      // Declared where the call was written. Importable only if that module exports it —
      // and the generated module is a different module, so "it is right there" is not
      // enough.
      const own = facts(file);
      if (own.locals.has(name)) {
        if (own.exported.has(name)) {
          typeImports.set(name, {
            specifier: siblingSpecifier(file.fileName, extension),
            kind: 'named',
            local: name,
            original: name,
          });
        } else {
          refusals.push({
            typeText,
            reason:
              `\`${name}\` is declared in ${basename(file.fileName)} but not exported, so the generated ` +
              'module cannot name it. Export it, or move it to a module that does.',
          });
        }
        continue;
      }
      // Not imported and not declared here: global (`Date`, `Omit`, `Record`), which needs
      // no import at all. A name that is neither global nor importable is already a
      // compile error in the source, so there is nothing for this pass to add.
    }
  }

  return { entries, sites, refusals, typeImports: [...typeImports.values()], calleeSources };
}

/** Whether `text` uses `name` as an identifier, rather than as part of a longer one. */
export function referencesName(text: string, name: string): boolean {
  const pattern = new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
  return pattern.test(text);
}

export function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? path : path.slice(cut + 1);
}
