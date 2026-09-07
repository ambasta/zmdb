import type { FormatConfig } from 'oxfmt';

export const FORMAT_OPTIONS: FormatConfig = {
  arrowParens: 'avoid',
  bracketSpacing: true,
  endOfLine: 'lf',
  insertFinalNewline: true,
  objectWrap: 'preserve',
  printWidth: 120,
  quoteProps: 'as-needed',
  semi: true,
  singleQuote: true,
  sortImports: true,
  sortPackageJson: true,
  tabWidth: 2,
  trailingComma: 'all',
  useTabs: false,
};

export type ScaffoldKind = 'command' | 'controller' | 'module' | 'project' | 'repository' | 'schema';

export interface ScaffoldName {
  readonly input: string;
  readonly fileStem: string;
  readonly pascal: string;
  readonly camel: string;
  readonly constant: string;
  readonly table: string;
}

export interface TemplateContext {
  readonly name: ScaffoldName;
  readonly packageVersion: string;
}

export interface TemplateFile {
  readonly path: string;
  readonly source: string;
}

export interface TemplatePlan {
  readonly files: readonly TemplateFile[];
  readonly instructions?: readonly string[];
}

export type TemplateFactory = (context: TemplateContext) => TemplatePlan;
