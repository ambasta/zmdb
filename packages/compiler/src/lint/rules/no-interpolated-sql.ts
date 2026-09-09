// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { staticMemberName, staticPropertyName } from '../ast.js';
import type { HostLintRule, VisitorNode } from '../host-types.js';

type TemplateLiteralNode = VisitorNode<'TemplateLiteral'>;

const message = 'Do not interpolate values into SQL text; use driver parameters.';

function isSqlSink(node: TemplateLiteralNode): boolean {
  const parent = node.parent;
  if (
    parent.type === 'Property' &&
    parent.parent.type === 'ObjectExpression' &&
    staticPropertyName(parent) === 'text' &&
    parent.parent.properties.some(
      property => property.type === 'Property' && staticPropertyName(property) === 'parameters',
    )
  ) {
    return true;
  }
  return (
    parent.type === 'CallExpression' &&
    staticMemberName(parent.callee) === 'execute' &&
    parent.arguments.some(argument => argument === node)
  );
}

export const noInterpolatedSql: HostLintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Report interpolated template literals used directly as SQL text.',
      recommended: true,
    },
    messages: { interpolation: message },
    schema: [],
  },
  create(context) {
    return {
      TemplateLiteral(node) {
        if (node.expressions.length === 0 || !isSqlSink(node)) return;
        context.report({ node, messageId: 'interpolation' });
      },
    };
  },
};
