/**
 * The host-neutral rule shape published to consumers.
 *
 * The implementation is checked against oxlint's exact alpha API internally,
 * but the public declaration cannot import one host's types: the same plugin is
 * also loadable by ESLint without oxlint installed.
 */
export interface LintRule<Context = never, Visitor extends object = object> {
  readonly meta?: unknown;
  readonly create: (context: Context) => Visitor;
}
