import { staticMemberName } from '../ast.js';
import type { HostLintRule } from '../host-types.js';

const message = 'update(id, {}) performs no write; it reads and returns the matching row.';

export const noEmptyPatch: HostLintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Report update calls whose literal patch is empty.',
      recommended: true,
    },
    messages: { emptyPatch: message },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (staticMemberName(node.callee) !== 'update') return;
        const patch = node.arguments[1];
        if (patch?.type !== 'ObjectExpression' || patch.properties.length !== 0) return;
        context.report({ node: patch, messageId: 'emptyPatch' });
      },
    };
  },
};
