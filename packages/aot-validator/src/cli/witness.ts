// The three files `zmdb-codegen` writes beside a source file, as text.
//
// Nothing here runs the compiler or the emitter. It is the text half of the CLI: given the
// entries `scan.ts` found, produce the witness module, and — given the transformer's output
// for that witness — produce the JavaScript and the declarations that go with it. Keeping it
// pure is what makes it testable without a `tsgo` process.
//
// ## Why three files
//
// The rewrite is destructive. After a run the source says `zmdbIsUser(data)` and the
// `is<User>(data)` it came from is gone, so the type argument — the only input the whole
// pipeline has — would be gone with it. The **witness** keeps it, in a form the consumer's
// own `tsc` checks: a wrapper per entry, written against the runtime API. That makes a
// renamed or deleted `User` a build error in a generated file, rather than a compiled
// validator that quietly keeps describing a type nobody declares any more.
//
// The witness is also the transform input, and its output cannot be the artifact: the
// emitted helpers are untyped JavaScript (`function _zmdbFreeze(_v)`), which under
// `noImplicitAny` is an error per parameter. So the artifact is a **`.js`** — the emitter's
// output needs no annotations because nothing typechecks it — plus a **`.d.ts`** carrying
// the signatures. That split pays for itself twice over: there is not one cast anywhere in
// the generated code, and `schemaOf<T>()`'s phantom (`TaggedSchema<T>`'s `unique symbol`
// slot, which no object literal can satisfy) is *declared* in the `.d.ts` rather than
// asserted into existence.
//
// ## How the JavaScript is extracted
//
// By sentinel comments, and only because this module wrote every line around them. The
// transformer replaces call spans and prepends its prelude; it never moves a statement and
// never touches a comment. So the text between `/*zmdb:begin:NAME*/` and
// `/*zmdb:end:NAME*/` is the wrapper with its call inlined, and it still starts with the
// exact signature line this module generated — which is what makes swapping that line for
// its JavaScript form a string operation rather than a parse.

import type { NamedImportBindings, Node, SourceFile } from 'typescript/unstable/ast';
import { SyntaxKind } from 'typescript/unstable/ast';
import {
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isNamespaceImport,
  isPropertyAccessExpression,
  isStringLiteral,
} from 'typescript/unstable/ast/is';

import { Rewriter } from '../transformer.js';
import type { Entry, SiteEntry, TypeImport } from './scan.js';

/** Wraps the header and the import block: everything the `.js` does not want. */
const IMPORTS_OPEN = '/*zmdb:imports*/';
const IMPORTS_CLOSE = '/*zmdb:/imports*/';

function begin(name: string): string {
  return `/*zmdb:begin:${name}*/`;
}

function end(name: string): string {
  return `/*zmdb:end:${name}*/`;
}

/** The type each callee's signature needs beyond the type argument itself. */
const SUPPORT_TYPES: Readonly<Record<string, readonly string[]>> = {
  validate: ['ValidateResult'],
  validateShallow: ['ValidateResult'],
  toJsonSchema: ['JsonSchemaObject'],
  schemaOf: ['TaggedSchema'],
  toolFor: ['ToolOptions', 'ToolProvider', 'ToolSpecFor'],
  loadGrpcService: ['GrpcLoadedService'],
};

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

export interface ArtifactPaths {
  readonly witness: string;
  readonly js: string;
  readonly dts: string;
  /** What the rewritten source imports. Always the `.js`; TypeScript finds the `.d.ts`. */
  readonly specifier: string;
}

const TS_EXTENSIONS: readonly [string, string, string][] = [
  // source extension, runtime extension, declaration extension
  ['.mts', '.mjs', '.d.mts'],
  ['.cts', '.cjs', '.d.cts'],
  ['.tsx', '.js', '.d.ts'],
  ['.ts', '.js', '.d.ts'],
];

/**
 * Where the three files go for one source file.
 *
 * Beside the source, one set per source file, which is a deliberate departure from a single
 * per-project module. Two things fall out of it and both are worth more than the tidiness:
 * the witness's relative imports are the source's own relative imports unchanged (no path
 * arithmetic, and none of the ways that gets it wrong), and two files that both write
 * `is<Row>` cannot collide over the export name `zmdbIsRow`.
 *
 * The runtime extension follows the source's, so a `.mts` file gets a `.mjs` — the module
 * kind of the generated file has to match the module kind of the file importing it.
 */
export function artifactPaths(sourcePath: string): ArtifactPaths {
  for (const [source, runtime, declaration] of TS_EXTENSIONS) {
    if (!sourcePath.endsWith(source)) continue;
    const stem = sourcePath.slice(0, -source.length);
    return {
      witness: `${stem}.zmdb.witness${source === '.tsx' ? '.ts' : source}`,
      js: `${stem}.zmdb.generated${runtime}`,
      dts: `${stem}.zmdb.generated${declaration}`,
      specifier: `./${base(stem)}.zmdb.generated${runtime}`,
    };
  }
  return {
    witness: `${sourcePath}.zmdb.witness.ts`,
    js: `${sourcePath}.zmdb.generated.js`,
    dts: `${sourcePath}.zmdb.generated.d.ts`,
    specifier: `./${base(sourcePath)}.zmdb.generated.js`,
  };
}

function base(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? path : path.slice(cut + 1);
}

/** Whether a path is something a previous run wrote. The scan must not recurse into these. */
export function isGeneratedPath(path: string): boolean {
  return /\.zmdb\.(?:witness|generated)\.[cm]?[jt]sx?$|\.zmdb\.generated\.d\.[cm]?ts$/.test(path);
}

// -----------------------------------------------------------------------------
// Signatures
// -----------------------------------------------------------------------------

interface Signature {
  /** Generic parameters the generated wrapper itself carries. */
  readonly typeParameters?: string;
  /** The TypeScript parameter list, annotations included. */
  readonly parameters: string;
  /** The TypeScript return type. */
  readonly returns: string;
  /** The parameter list with the annotations gone, for the JavaScript. */
  readonly plain: string;
  /** The runtime call the witness makes, which is what the transformer replaces. */
  readonly call: string;
}

/**
 * The wrapper's shape for one entry.
 *
 * Every callee becomes a *function*, including the two — `toJsonSchema<T>()` and
 * `schemaOf<T>()` — that take no argument and could have been a `const`. Not for efficiency:
 * the emitter hoists both to one deeply frozen module-level literal and the wrapper returns a
 * reference to it, so a `const` would compile to the same bytes. It is so that the generated
 * module has the same shape as the call it replaced. `document()` was a call in the source and
 * stays one, which is what keeps the rewrite a rename rather than a refactor.
 */
function signature(entry: Entry): Signature {
  const type = entry.typeText;
  const typeArguments = entry.depthText === undefined ? type : `${type}, ${entry.depthText}`;
  const captured = entry.argumentsText?.join(', ');
  switch (entry.callee) {
    case 'is':
    case 'equals':
      return {
        parameters: 'value: unknown',
        returns: `value is ${type}`,
        plain: 'value',
        call: `${entry.callee}<${type}>(value)`,
      };
    case 'isShallow':
      return {
        parameters: 'value: unknown',
        returns: `value is ${type}`,
        plain: 'value',
        call: `isShallow<${typeArguments}>(value)`,
      };
    case 'assert':
    case 'assertEquals':
      return { parameters: 'value: unknown', returns: type, plain: 'value', call: `${entry.callee}<${type}>(value)` };
    case 'assertShallow':
      return {
        parameters: 'value: unknown',
        returns: type,
        plain: 'value',
        call: `assertShallow<${typeArguments}>(value)`,
      };
    case 'validate':
      return {
        parameters: 'value: unknown',
        returns: `ValidateResult<${type}>`,
        plain: 'value',
        call: `validate<${type}>(value)`,
      };
    case 'validateShallow':
      return {
        parameters: 'value: unknown',
        returns: `ValidateResult<${type}>`,
        plain: 'value',
        call: `validateShallow<${typeArguments}>(value)`,
      };
    case 'random':
      return { parameters: '', returns: type, plain: '', call: `random<${type}>()` };
    case 'toJsonSchema':
      return { parameters: '', returns: 'JsonSchemaObject', plain: '', call: `toJsonSchema<${type}>()` };
    case 'schemaOf':
      return { parameters: '', returns: `TaggedSchema<${type}>`, plain: '', call: `schemaOf<${type}>()` };
    case 'toolFor':
      return {
        typeParameters: '<P extends ToolProvider>',
        parameters: 'provider: P, name: string, opts?: ToolOptions',
        returns: 'ToolSpecFor[P]',
        plain: 'provider, name, opts',
        call: `toolFor<${type}, P>(provider, name, opts)`,
      };
    case 'grpcDescriptor':
      return {
        parameters: '',
        returns: 'string',
        plain: '',
        call: `grpcDescriptor<${type}>(${captured ?? ''})`,
      };
    case 'loadGrpcService':
      return {
        parameters: '',
        returns: `GrpcLoadedService<${type}>`,
        plain: '',
        call: `loadGrpcService<${type}>(${captured ?? ''})`,
      };
    case 'protoDescriptor':
      return { parameters: '', returns: 'string', plain: '', call: `protoDescriptor<${type}>()` };
    case 'protoDecode':
      return {
        parameters: 'bytes: Uint8Array',
        returns: type,
        plain: 'bytes',
        call: `protoDecode<${type}>(bytes)`,
      };
    case 'protoEncode':
      return {
        parameters: `value: ${type}`,
        returns: 'Uint8Array',
        plain: 'value',
        call: `protoEncode<${type}>(value)`,
      };
    default:
      // `CALLEES` is the only source of `callee`, and every member of it is above. A new one
      // added there and not here would otherwise generate a wrapper that calls nothing.
      throw new Error(`zmdb-codegen has no wrapper for \`${entry.callee}<T>()\``);
  }
}

/** `export function NAME(value: unknown): value is User {` — the line the `.js` swaps out. */
function tsOpening(entry: Entry): string {
  const { parameters, returns, typeParameters = '' } = signature(entry);
  return `export function ${entry.name}${typeParameters}(${parameters}): ${returns} {`;
}

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

function typeImportLines(imports: readonly TypeImport[], style: string): string[] {
  const named = new Map<string, string[]>();
  const lines: string[] = [];
  for (const entry of imports) {
    if (entry.kind === 'default') {
      lines.push(`import type ${entry.local} from ${quote(entry.specifier, style)};`);
    } else if (entry.kind === 'namespace') {
      lines.push(`import type * as ${entry.local} from ${quote(entry.specifier, style)};`);
    } else {
      const clause = entry.original === entry.local ? entry.local : `${entry.original} as ${entry.local}`;
      const group = named.get(entry.specifier);
      if (group) group.push(clause);
      else named.set(entry.specifier, [clause]);
    }
  }
  for (const [specifier, clauses] of named) {
    lines.push(`import type { ${clauses.toSorted().join(', ')} } from ${quote(specifier, style)};`);
  }
  return lines.toSorted();
}

/**
 * The runtime API the witness calls, and the types its signatures mention.
 *
 * Both come from the specifier the *source* used, never from a fixed table: a project that
 * installed the `zmdb` umbrella has no `@zmdb/aot-validator` in its dependencies, so a
 * witness that imported one would not resolve. That the umbrella re-exports every support
 * type alongside its function is what makes one specifier enough for both lines.
 */
function calleeImportLines(entries: readonly Entry[], sources: ReadonlyMap<string, string>, style: string): string[] {
  const values = new Map<string, Set<string>>();
  const types = new Map<string, Set<string>>();
  const into = (map: Map<string, Set<string>>, specifier: string, name: string): void => {
    const group = map.get(specifier);
    if (group) group.add(name);
    else map.set(specifier, new Set([name]));
  };

  for (const entry of entries) {
    const specifier = sources.get(entry.callee) ?? '@zmdb/aot-validator/utilities';
    into(values, specifier, entry.callee);
    const support = SUPPORT_TYPES[entry.callee];
    if (support) {
      for (const name of support) into(types, specifier, name);
    }
  }

  const lines: string[] = [];
  for (const [specifier, names] of values) {
    lines.push(`import { ${[...names].toSorted().join(', ')} } from ${quote(specifier, style)};`);
  }
  for (const [specifier, names] of types) {
    lines.push(`import type { ${[...names].toSorted().join(', ')} } from ${quote(specifier, style)};`);
  }
  return lines.toSorted();
}

/** The support-type imports on their own, for the `.d.ts`, which calls nothing. */
function supportTypeLines(entries: readonly Entry[], sources: ReadonlyMap<string, string>, style: string): string[] {
  return calleeImportLines(entries, sources, style).filter(line => line.startsWith('import type '));
}

/**
 * A module specifier, quoted the way the file it is going into quotes them.
 *
 * Cosmetic in isolation, load-bearing in aggregate: a consumer runs a formatter over its
 * tree, and a generated file that disagrees with it is a diff on every `--check`.
 */
function quote(specifier: string, style: string): string {
  if (style !== "'") return JSON.stringify(specifier);
  return `'${specifier.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/**
 * Which quote the source file uses for its own imports. Single unless it says otherwise —
 * the majority style, and the one a file with no imports at all is most likely to want.
 */
export function quoteStyle(sourceFile: SourceFile): string {
  for (const node of sourceFile.statements) {
    if (!isImportDeclaration(node)) continue;
    const specifier = node.moduleSpecifier;
    if (!isStringLiteral(specifier)) continue;
    const char = sourceFile.text[specifier.getStart()];
    if (char === '"' || char === "'") return char;
  }
  return "'";
}

// -----------------------------------------------------------------------------
// The witness
// -----------------------------------------------------------------------------

export interface WitnessInput {
  /** Base name of the source this witness belongs to, for the header. */
  readonly sourceName: string;
  readonly entries: readonly Entry[];
  readonly typeImports: readonly TypeImport[];
  readonly calleeSources: ReadonlyMap<string, string>;
  /** The quote character the source uses. See `quoteStyle`. */
  readonly style: string;
}

export function witnessSource(input: WitnessInput): string {
  const { sourceName, entries, typeImports, calleeSources, style } = input;
  const parts: string[] = [
    IMPORTS_OPEN,
    `// Generated by zmdb-codegen from ${sourceName}. Checked, not edited.`,
    '//',
    `// One wrapper per validation call ${sourceName} used to make, written against the runtime`,
    '// API so that the compiler still sees each type argument. That is the point of the file: it',
    '// is what `zmdb-codegen` reads on the next run to regenerate the compiled module, and it is',
    '// what turns a renamed or deleted type into a build error here instead of a validator that',
    '// silently checks a shape nobody declares.',
    '//',
    '// Editing it by hand does nothing. An entry disappears when the source stops referring to',
    "// its export name, so deleting a call in the source is how you delete a validator; there's",
    '// no bookkeeping to keep in step.',
  ];
  const imports = [...typeImportLines(typeImports, style), ...calleeImportLines(entries, calleeSources, style)];
  if (imports.length > 0) parts.push('', ...imports);
  parts.push(IMPORTS_CLOSE);

  for (const entry of entries) {
    const { call } = signature(entry);
    parts.push('', begin(entry.name), tsOpening(entry), `  return ${call};`, '}', end(entry.name));
  }

  return `${parts.join('\n')}\n`;
}

// -----------------------------------------------------------------------------
// The compiled pair
// -----------------------------------------------------------------------------

export interface GeneratedModules {
  readonly js: string;
  readonly dts: string;
}

export interface GenerateInput extends WitnessInput {
  /** `transformFile`'s output for the witness. */
  readonly transformed: string;
}

/**
 * The `.js` and the `.d.ts`, assembled from the transformed witness.
 *
 * Only the wrapper bodies come from the transform; every other line is regenerated here from
 * the same `Entry` list the witness was built from. So the two files cannot disagree about a
 * signature, and neither can drift from the witness.
 */
export function generatedModules(input: GenerateInput): GeneratedModules {
  const { sourceName, entries, transformed } = input;

  const header = (tail: readonly string[]): string =>
    [
      `// Generated by zmdb-codegen from ${sourceName}. Do not edit.`,
      '//',
      `// The validators, compiled. Every check below was emitted from a type in ${sourceName}'s`,
      `// witness module by \`@zmdb/aot-validator\`, so there is no schema to walk at runtime and`,
      '// nothing to look up: the shape is the control flow.',
      '//',
      ...tail,
    ].join('\n');

  const jsHeader = header([
    '// JavaScript rather than TypeScript on purpose — the emitted helpers are untyped, and a',
    '// generated file that needed `any` to typecheck would be a worse trade than one that is',
    '// simply not typechecked. The declarations live in the sidecar `.d.ts`.',
    '//',
    '// Formatters and linters should skip it. The emitter writes a check as one long expression',
    '// because that is what it is; reformatting that would leave `zmdb-codegen --check`',
    '// permanently out of date against a file nothing was wrong with.',
  ]);
  const dtsHeader = header([
    '// This half is the types: the signatures the compiler reads when the source imports the',
    '// module next door. Nothing here is checked against the implementation, and nothing needs',
    '// to be — the witness makes the same claims against the runtime API, and *that* is checked.',
  ]);

  const preludeEnd = firstMarker(transformed, entries);
  let prelude = transformed.slice(0, preludeEnd);
  const open = prelude.indexOf(IMPORTS_OPEN);
  const close = prelude.indexOf(IMPORTS_CLOSE);
  if (open !== -1 && close !== -1) {
    // The header and the witness's own imports. Both are TypeScript-only by now: every call
    // that needed the runtime API has been inlined, so the import would load a validator
    // nobody calls, and the type imports are not syntax a `.js` file may contain.
    prelude = prelude.slice(0, open) + prelude.slice(close + IMPORTS_CLOSE.length);
  }

  const bodies = entries.map(entry => javascriptFor(entry, transformed));

  const declarations = entries.map(entry => {
    const { parameters, returns, typeParameters = '' } = signature(entry);
    return `export declare function ${entry.name}${typeParameters}(${parameters}): ${returns};`;
  });

  const dtsImports = [
    ...typeImportLines(input.typeImports, input.style),
    ...supportTypeLines(entries, input.calleeSources, input.style),
  ];

  return {
    js: `${jsHeader}\n${join([prelude.trim(), ...bodies])}\n`,
    dts: `${dtsHeader}\n${join([dtsImports.join('\n'), ...declarations])}\n`,
  };
}

function join(blocks: readonly string[]): string {
  return blocks.filter(block => block.length > 0).join('\n\n');
}

/** Where the wrappers start, which is where the prelude ends. */
function firstMarker(transformed: string, entries: readonly Entry[]): number {
  let earliest = transformed.length;
  for (const entry of entries) {
    const at = transformed.indexOf(begin(entry.name));
    if (at !== -1 && at < earliest) earliest = at;
  }
  return earliest;
}

/**
 * One wrapper, as JavaScript.
 *
 * The sentinel comments bound it and the signature line is known verbatim, so this is two
 * string operations. A missing marker means the transformer moved or dropped a statement,
 * which it has no path to do — so it throws rather than writing a module with a hole in it.
 */
function javascriptFor(entry: Entry, transformed: string): string {
  const from = transformed.indexOf(begin(entry.name));
  const to = transformed.indexOf(end(entry.name));
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`the transformed witness lost the wrapper for ${entry.name}`);
  }
  const chunk = transformed.slice(from + begin(entry.name).length, to).trim();
  const opening = tsOpening(entry);
  if (!chunk.startsWith(opening)) {
    throw new Error(`the transformed witness rewrote the signature of ${entry.name}`);
  }
  const { plain } = signature(entry);
  return `export function ${entry.name}(${plain}) {${chunk.slice(opening.length)}`;
}

// -----------------------------------------------------------------------------
// The source rewrite
// -----------------------------------------------------------------------------

export interface RewriteInput {
  readonly sourceFile: SourceFile;
  readonly code: string;
  readonly sites: readonly SiteEntry[];
  /** What to import the generated module as. See `artifactPaths`. */
  readonly specifier: string;
  readonly entries: readonly Entry[];
  readonly calleeSources: ReadonlyMap<string, string>;
  /** The quote character the source uses. See `quoteStyle`. */
  readonly style: string;
}

/**
 * `is<User>(data)` → `zmdbIsUser(data)`, plus the import that makes it resolve.
 *
 * The whole call is replaced rather than just its callee, because the type argument has to
 * go with it and `is<User>` is one span in the middle of another. Arguments are read through
 * the `Rewriter`, so `assert<A>(is<B>(x))` picks up the inner rewrite instead of carrying a
 * stale copy of it.
 */
export function rewriteSource(input: RewriteInput): string {
  const { sourceFile, code, sites, specifier, entries, calleeSources, style } = input;
  const rewriter = new Rewriter(code);

  // Back to front, for the same reason the transformer does it: an earlier offset is only
  // valid while everything after it is untouched.
  for (const { site, entry } of sites.toReversed()) {
    const args = site.node.arguments;
    const first = args[0];
    const last = args[args.length - 1];
    const inner = entry.argumentsText === undefined && first && last ? rewriter.slice(first.getStart(), last.end) : '';
    rewriter.replace(site.node.getStart(), site.node.end, `${entry.name}(${inner})`);
  }

  const names = entries.map(entry => entry.name);
  const statement = names.length === 0 ? '' : `import { ${names.join(', ')} } from ${quote(specifier, style)};`;

  // The import edits come after the call edits and are all at lower offsets, so no applied
  // edit lies inside one of their spans and the `Rewriter`'s arithmetic is unaffected.
  const owned = new Set(calleeSources.values());
  const compiled = new Set(sites.map(({ site }) => site.binding));
  const context: EditContext = {
    specifier,
    statement,
    names,
    owned,
    compiled,
    style,
    live: liveIdentifiers(sourceFile, sites),
  };
  for (const edit of importEdits(sourceFile, context).toSorted((a, b) => b.start - a.start)) {
    rewriter.replace(edit.start, edit.end, edit.text);
  }

  return rewriter.text;
}

/**
 * Every name the file still uses after the rewrite, as names rather than as text.
 *
 * This decides whether a callee's import is now dead, and it has to be an AST walk. Searching
 * the text for `is` finds it in `import { is } from 'zmdb'`, which is the statement being
 * judged, and finds it in a comment — this file's own fixture said "the type argument *is* the
 * input" and kept a compiled-away import alive on the strength of it. A regex has no way to
 * know which of those is a reference and the parser already does.
 *
 * Three things are therefore skipped: import declarations, because an import is not a use; the
 * head of each compiled call, because `is<User>` is what is going away, while its *arguments*
 * are walked, so an `assert` passed as a value inside one keeps its import; and the property
 * half of `a.b`, because `payload.is` names a property, not the imported function.
 */
function liveIdentifiers(sourceFile: SourceFile, sites: readonly SiteEntry[]): ReadonlySet<string> {
  const compiled = new Map<Node, readonly Node[]>();
  for (const { site } of sites) compiled.set(site.node, site.node.arguments);

  const names = new Set<string>();
  const walk = (node: Node): void => {
    if (isImportDeclaration(node)) return;
    const args = compiled.get(node);
    if (args) {
      for (const argument of args) walk(argument);
      return;
    }
    if (isIdentifier(node)) {
      names.add(node.text);
      return;
    }
    if (isPropertyAccessExpression(node)) {
      walk(node.expression);
      return;
    }
    node.forEachChild(walk);
  };
  sourceFile.forEachChild(walk);
  return names;
}

interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * How far a deleted statement's deletion should reach: through the end of its line, and
 * through the blank lines after it when they are no longer separating anything.
 *
 * The line itself is not optional — leaving the newline behind puts a blank line where the
 * statement was, and no later run would remove it, so the file would be permanently one line
 * emptier than the formatter wants it. The blank lines after are the same problem one level
 * up: deleting the only import above a blank line leaves the file starting with that blank
 * line, so a paragraph break that now divides nothing goes with the paragraph.
 */
function throughLine(text: string, start: number, stop: number): number {
  let at = skipSpaces(text, stop);
  if (at >= text.length || text[at] !== '\n') return stop;
  at += 1;
  if (!blankAbove(text, start)) return at;
  while (at < text.length && text[skipSpaces(text, at)] === '\n') at = skipSpaces(text, at) + 1;
  return at;
}

function skipSpaces(text: string, from: number): number {
  let at = from;
  while (at < text.length && (text[at] === ' ' || text[at] === '\t' || text[at] === '\r')) at += 1;
  return at;
}

/** Whether `start`'s line is the first in the file or has a blank line above it. */
function blankAbove(text: string, start: number): boolean {
  let at = start - 1;
  while (at >= 0 && (text[at] === ' ' || text[at] === '\t' || text[at] === '\r')) at -= 1;
  if (at < 0) return true;
  if (text[at] !== '\n') return false;
  at -= 1;
  while (at >= 0 && (text[at] === ' ' || text[at] === '\t' || text[at] === '\r')) at -= 1;
  return at < 0 || text[at] === '\n';
}

/** The local names a `{ … }` import clause binds. Aliases are not something codegen writes. */
function importedNames(bindings: NamedImportBindings | undefined): string[] {
  if (!bindings || !isNamedImports(bindings)) return [];
  return bindings.elements.filter(element => isIdentifier(element.name)).map(element => element.name.text);
}

/** Whether an import already binds exactly `wanted`, in any order. */
function satisfies(found: readonly string[], wanted: readonly string[]): boolean {
  return found.length === wanted.length && wanted.every(name => found.includes(name));
}

interface EditContext {
  /** What the generated import names. */
  readonly specifier: string;
  /** The generated import statement, or `''` when the file needs none. */
  readonly statement: string;
  /** What that statement names, for comparing against one already in the file. */
  readonly names: readonly string[];
  /** Specifiers a callee was imported from, whose namespace binding may now be dead. */
  readonly owned: ReadonlySet<string>;
  /** Local named-import or namespace bindings whose calls were compiled away. */
  readonly compiled: ReadonlySet<string>;
  readonly style: string;
  /** See `liveIdentifiers`: the names that still count as a use. */
  readonly live: ReadonlySet<string>;
}

/**
 * Add the generated import, and take away the ones the rewrite just orphaned.
 *
 * The second half is not tidiness: `import { is } from 'zmdb'` with no `is` left in the file
 * is an error under `noUnusedLocals`, so a codegen that left it behind would break the build
 * it was supposed to speed up. Only bindings this rewrite could have orphaned are considered
 * — the callee names, and a namespace or default binding of a module a callee came
 * from — and only when the name is referenced nowhere in what is left.
 */
function importEdits(sourceFile: SourceFile, context: EditContext): TextEdit[] {
  const { specifier, statement, names, owned, compiled, style, live } = context;
  const edits: TextEdit[] = [];
  let existing: { start: number; end: number; withLine: number; names: string[] } | undefined;
  // Where the generated import can go, and where it cannot. The new statement goes after the
  // last import that is *still there* — anchoring it to one this pass is deleting would put an
  // insertion inside a deleted span, and the deletion would eat it.
  const surviving: number[] = [];
  const removals: { readonly at: number; readonly start: number; readonly nodeEnd: number; readonly end: number }[] =
    [];

  for (const node of sourceFile.statements) {
    if (!isImportDeclaration(node)) continue;
    surviving.push(node.end);
    /** Delete the statement whole: it exists only to import something now compiled away. */
    const remove = (): void => {
      surviving.pop();
      const through = throughLine(sourceFile.text, node.getStart(), node.end);
      removals.push({ at: edits.length, start: node.getStart(), nodeEnd: node.end, end: through });
      edits.push({ start: node.getStart(), end: through, text: '' });
    };
    const moduleSpecifier = node.moduleSpecifier;
    if (!isStringLiteral(moduleSpecifier)) continue;
    if (moduleSpecifier.text === specifier) {
      // A previous run's import. Its *names* are what get compared, never its text — see
      // `satisfies` below.
      existing = {
        start: node.getStart(),
        end: node.end,
        withLine: throughLine(sourceFile.text, node.getStart(), node.end),
        names: importedNames(node.importClause?.namedBindings),
      };
      continue;
    }

    const clause = node.importClause;
    if (!clause) continue;
    const dead = (name: string): boolean => !live.has(name);

    const bindings = clause.namedBindings;
    const namespaceName =
      bindings && isNamespaceImport(bindings) && isIdentifier(bindings.name) ? bindings.name.text : undefined;
    const defaultName = clause.name && isIdentifier(clause.name) ? clause.name.text : undefined;

    if (owned.has(moduleSpecifier.text)) {
      const single = namespaceName ?? defaultName;
      if (single !== undefined && (!bindings || !isNamedImports(bindings)) && dead(single)) {
        remove();
        continue;
      }
    }

    if (!bindings || !isNamedImports(bindings)) continue;
    const keep: string[] = [];
    let dropped = false;
    for (const element of bindings.elements) {
      if (!isIdentifier(element.name)) continue;
      const local = element.name.text;
      if (compiled.has(local) && dead(local)) {
        dropped = true;
        continue;
      }
      const original = element.propertyName && isIdentifier(element.propertyName) ? element.propertyName.text : local;
      // `import { type A, B }` — the per-specifier modifier has to survive the rebuild, or
      // a type-only binding becomes a value import of something that does not exist at runtime.
      const modifier = element.isTypeOnly ? 'type ' : '';
      keep.push(`${modifier}${original === local ? local : `${original} as ${local}`}`);
    }
    if (!dropped) continue;
    if (keep.length === 0 && defaultName === undefined) {
      remove();
    } else {
      const prefix = defaultName === undefined ? '' : `${defaultName}, `;
      const kind = clause.phaseModifier === SyntaxKind.TypeKeyword ? 'import type' : 'import';
      edits.push({
        start: node.getStart(),
        end: node.end,
        text:
          keep.length === 0
            ? `${kind} ${defaultName ?? ''} from ${quote(moduleSpecifier.text, style)};`
            : `${kind} ${prefix}{ ${keep.join(', ')} } from ${quote(moduleSpecifier.text, style)};`,
      });
    }
  }

  if (statement.length === 0) {
    // Nothing left to import. An existing import from a previous run is now dead, and
    // leaving it would keep a generated module alive that nothing references.
    if (existing) edits.push({ start: existing.start, end: existing.withLine, text: '' });
    return edits;
  }

  if (existing) {
    // Only when it says something different. The one thing this statement has to get right is
    // which names come from the generated module, and a consumer's formatter owns everything
    // else about it: `printWidth` wraps a seven-name import across eight lines, `sortImports`
    // reorders the names, and neither is a reason to rewrite the file. Comparing text here
    // would put `zmdb-codegen --check` and `fmt --check` in a loop that neither can win.
    if (!satisfies(existing.names, names)) edits.push({ start: existing.start, end: existing.end, text: statement });
    return edits;
  }

  const anchor = surviving.at(-1);
  if (anchor !== undefined) {
    edits.push({ start: anchor, end: anchor, text: `\n${statement}` });
    return edits;
  }

  const first = removals.toSorted((a, b) => a.start - b.start)[0];
  if (first) {
    // Every import the file had was orphaned by the rewrite — the common case for a module whose
    // only import was the validator. So the generated one takes the first one's place *as* that
    // deletion: an insertion at the same offset would be two edits claiming one byte, with no
    // rule saying which of them won. The trailing whitespace the deletion swallowed comes back
    // with it, so the file keeps the paragraph break it had.
    edits[first.at] = {
      start: first.start,
      end: first.end,
      text: `${statement}${sourceFile.text.slice(first.nodeEnd, first.end)}`,
    };
    return edits;
  }

  // No imports at all. After the leading comment of the first statement rather than at
  // offset zero, so a file's licence header stays at the top of it.
  const at = sourceFile.statements[0]?.getStart() ?? 0;
  edits.push({ start: at, end: at, text: `${statement}\n\n` });
  return edits;
}
