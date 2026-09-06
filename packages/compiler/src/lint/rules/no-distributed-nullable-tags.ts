import { importedTagBindings, isImportedTagReference, isTableDeclaration, type ImportedTagBindings } from '../ast.js';
import type { HostLintRule, VisitorNode } from '../host-types.js';

type TSTypeNode = VisitorNode<'TSIntersectionType'>['types'][number];
type TSUnionTypeNode = VisitorNode<'TSUnionType'>;

const message = 'Move null and undefined outside the tagged intersection; nullish values cannot carry zmdb tags.';

function isNullish(node: TSTypeNode): boolean {
  return node.type === 'TSNullKeyword' || node.type === 'TSUndefinedKeyword';
}

export const noDistributedNullableTags: HostLintRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Keep nullable arms outside intersections with zmdb declaration tags.',
      recommended: true,
    },
    fixable: 'code',
    messages: { distributed: message },
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
          if (annotation?.type !== 'TSIntersectionType') continue;

          let nullableUnion: TSUnionTypeNode | undefined;
          const tags: TSTypeNode[] = [];
          let unsafe = false;

          for (const member of annotation.types) {
            if (member.type === 'TSUnionType') {
              const nullishCount = member.types.filter(isNullish).length;
              if (nullishCount === 1 && nullableUnion === undefined) {
                nullableUnion = member;
                continue;
              }
            }
            if (isImportedTagReference(member, bindings)) tags.push(member);
            else unsafe = true;
          }

          if (unsafe || nullableUnion === undefined || tags.length === 0) continue;
          const nullish = nullableUnion.types.find(isNullish);
          if (nullish === undefined) continue;
          const data = nullableUnion.types.filter(member => !isNullish(member));
          if (data.length === 0) continue;

          const tagText = tags.map(tag => context.sourceCode.getText(tag)).join(' & ');
          const replacement = [
            ...data.map(member => `(${context.sourceCode.getText(member)} & ${tagText})`),
            context.sourceCode.getText(nullish),
          ].join(' | ');

          context.report({
            node: annotation,
            messageId: 'distributed',
            fix: fixer => fixer.replaceText(annotation, replacement),
          });
        }
      },
    };
  },
};
