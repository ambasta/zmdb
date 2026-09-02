// The codemod's public surface, declared so `codemod.spec.ts` can import it under
// `strict`.
//
// The codemod itself is `.mjs` because it is a script: it runs from `package.json` with no
// build step, the way every other file in `scripts/` does. `allowJs` is off repo-wide, so
// its round-trip test — which is TypeScript, because it reflects types — would otherwise
// have to reach for `any` to load it. These declarations are the cheaper honesty: the shapes
// are written down once, and a change to the script that contradicts them fails the test's
// typecheck rather than surfacing as a runtime `undefined` three assertions later.

import type { Program, SourceFile } from 'typescript/unstable/ast';

/** One `defineSchema` call the codemod could read, and the interface it becomes. */
export interface ConvertedSchema {
  /** The binding the call was assigned to: `userSchema`. */
  readonly declaredName: string;
  /** The interface name derived from it: `User`. */
  readonly name: string;
  /** The table name, read from the call's first argument. */
  readonly table: string;
  /** Every tag the emitted interface references, for the import the rewrite adds. */
  readonly tags: readonly string[];
  /**
   * Columns whose default *value* was dropped. `HasDefault` records that a default exists,
   * not which one, so this is the list of facts the conversion cannot carry.
   */
  readonly droppedDefaults: readonly string[];
  /** The emitted `export interface …` declaration, unformatted. */
  readonly source: string;
  /** Offsets of the call in the original text, for the rewrite. */
  readonly start: number;
  readonly end: number;
}

/** Something the codemod would have had to guess at, and where. */
export interface Refusal {
  /** `<file>:<line>`, or just the file when the whole file was unreachable. */
  readonly at: string;
  readonly reason: string;
}

/** One named import binding: `references as fk` is `{local: 'fk', imported: 'references'}`. */
export interface ImportBinding {
  readonly local: string;
  readonly imported: string;
}

export interface ImportDeclarationInfo {
  readonly module: string;
  readonly start: number;
  readonly end: number;
  readonly bindings: readonly ImportBinding[];
  /** A default import, which keeps the statement alive even when every name is pruned. */
  readonly hasDefault: boolean;
}

export interface FileConversion {
  readonly converted: readonly ConvertedSchema[];
  readonly refusals: readonly Refusal[];
  readonly imports: readonly ImportDeclarationInfo[];
  /** Identifiers the file still uses once the schema statements are gone. */
  readonly used: ReadonlySet<string>;
}

export interface ProjectFileConversion extends FileConversion {
  /** The absolute path, resolved from whatever was passed in. */
  readonly file: string;
  /** The file's original text, which `rewriteFile` edits. */
  readonly text: string;
}

/** A module specifier resolved to a source file in the same program, or `undefined`. */
export type ModuleResolver = (specifier: string, from: string) => SourceFile | undefined;

export function convertFile(sourceFile: SourceFile, text: string, resolveModule?: ModuleResolver): FileConversion;

/**
 * Convert every file in one project. One compiler `API` for the whole list.
 *
 * A file the project does not contain comes back as a refusal rather than a throw, so one
 * stray file cannot take the rest of the run down with it.
 */
export function convertFiles(project: string, files: readonly string[]): readonly ProjectFileConversion[];

/** The original text with the schemas replaced, the tag import added and dead DSL names pruned. */
export function rewriteFile(
  text: string,
  conversion: Pick<FileConversion, 'converted' | 'imports' | 'used'>,
): { readonly text: string; readonly pruned: readonly string[] };

export function moduleResolver(program: Program): ModuleResolver;
