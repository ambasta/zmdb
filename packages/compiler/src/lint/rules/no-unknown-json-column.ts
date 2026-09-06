import type { HostLintRule } from '../host-types.js';

const message = "unknown & X collapses to X; use object & Sql<'json'> or declare the JSON shape.";

export const noUnknownJsonColumn: HostLintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Report unknown where an intersection silently erases its data shape.',
      recommended: true,
    },
    hasSuggestions: true,
    messages: {
      collapsed: message,
      replace: 'Replace unknown with object',
    },
    schema: [],
  },
  create(context) {
    return {
      TSUnknownKeyword(node) {
        if (node.parent.type !== 'TSIntersectionType') return;
        context.report({
          node,
          messageId: 'collapsed',
          suggest: [
            {
              messageId: 'replace',
              fix: fixer => fixer.replaceText(node, 'object'),
            },
          ],
        });
      },
    };
  },
};
