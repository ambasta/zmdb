import { importedTagBindings, isTableDeclaration, type ImportedTagBindings } from '../ast.js';
import type { HostLintRule } from '../host-types.js';

const message = "A bare number is ambiguous; add Sql<'integer'> or Sql<'numeric'>.";

export const requireSqlOnNumber: HostLintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Report bare number annotations on tagged table properties.',
      recommended: true,
    },
    messages: { ambiguous: message },
    schema: [],
  },
  create(context) {
    let bindings: ImportedTagBindings = { tables: new Set<string>(), tags: new Set<string>() };

    return {
      Program(node) {
        bindings = importedTagBindings(node);
      },
      TSInterfaceDeclaration(node) {
        if (!isTableDeclaration(node, bindings)) return;
        for (const property of node.body.body) {
          if (property.type !== 'TSPropertySignature') continue;
          const annotation = property.typeAnnotation?.typeAnnotation;
          if (annotation?.type !== 'TSNumberKeyword') continue;
          context.report({ node: annotation, messageId: 'ambiguous' });
        }
      },
    };
  },
};
