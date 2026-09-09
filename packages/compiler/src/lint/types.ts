// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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
