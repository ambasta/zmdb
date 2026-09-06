import { staticMemberName } from '../ast.js';
import type { HostLintRule } from '../host-types.js';

const message = 'find() and find({}) are unbounded; use list() with a page.';

export const noUnboundedFind: HostLintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Report find calls with no syntactic filter.',
      recommended: true,
    },
    messages: { unbounded: message },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (staticMemberName(node.callee) !== 'find') return;
        const filter = node.arguments[0];
        if (filter !== undefined && (filter.type !== 'ObjectExpression' || filter.properties.length !== 0)) return;
        context.report({ node, messageId: 'unbounded' });
      },
    };
  },
};
