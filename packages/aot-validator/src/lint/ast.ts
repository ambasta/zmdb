import type { VisitorNode } from './host-types.js';

type CallExpressionNode = VisitorNode<'CallExpression'>;
type ImportDeclarationNode = VisitorNode<'ImportDeclaration'>;
type ImportSpecifierNode = Extract<ImportDeclarationNode['specifiers'][number], { type: 'ImportSpecifier' }>;
type ProgramNode = VisitorNode<'Program'>;
type PropertyNode = VisitorNode<'Property'>;
type TSInterfaceDeclarationNode = VisitorNode<'TSInterfaceDeclaration'>;
type TSTypeNode = VisitorNode<'TSIntersectionType'>['types'][number];

const TAG_MODULES: ReadonlySet<string> = new Set(['@zmdb/schema-core/tags', 'zmdb/tags']);
const TAG_EXPORTS: ReadonlySet<string> = new Set([
  'AnyRelation',
  'Codec',
  'Ext',
  'Fts',
  'HasDefault',
  'Length',
  'ManyToMany',
  'ManyToOne',
  'Max',
  'MaxLength',
  'Min',
  'MinLength',
  'Numeric',
  'OneToMany',
  'OneToOne',
  'Pattern',
  'PrimaryKey',
  'Proto',
  'ProtoField',
  'References',
  'Rule',
  'Sensitive',
  'Serial',
  'Sql',
  'Table',
  'Unique',
  'WireAs',
]);

export interface ImportedTagBindings {
  readonly tables: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
}

function importedName(specifier: ImportSpecifierNode): string {
  return specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;
}

export function importedTagBindings(program: ProgramNode): ImportedTagBindings {
  const tables = new Set<string>();
  const tags = new Set<string>();

  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || !TAG_MODULES.has(statement.source.value)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier') continue;
      const imported = importedName(specifier);
      if (TAG_EXPORTS.has(imported)) tags.add(specifier.local.name);
      if (imported === 'Table') tables.add(specifier.local.name);
    }
  }

  return { tables, tags };
}

export function isTableDeclaration(node: TSInterfaceDeclarationNode, bindings: ImportedTagBindings): boolean {
  return node.extends.some(
    heritage =>
      heritage.expression.type === 'Identifier' &&
      bindings.tables.has(heritage.expression.name) &&
      heritage.typeArguments?.params.length === 1,
  );
}

export function isImportedTagReference(node: TSTypeNode, bindings: ImportedTagBindings): boolean {
  return (
    node.type === 'TSTypeReference' && node.typeName.type === 'Identifier' && bindings.tags.has(node.typeName.name)
  );
}

export function staticMemberName(callee: CallExpressionNode['callee']): string | undefined {
  if (callee.type !== 'MemberExpression') return undefined;
  if (!callee.computed && callee.property.type === 'Identifier') return callee.property.name;
  if (callee.computed && callee.property.type === 'Literal' && typeof callee.property.value === 'string') {
    return callee.property.value;
  }
  return undefined;
}

export function staticPropertyName(property: PropertyNode): string | undefined {
  if (!property.computed && property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return undefined;
}
