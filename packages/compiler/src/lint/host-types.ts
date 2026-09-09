// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { RuleTester } from 'oxlint/plugins-dev';

type Rule = Parameters<RuleTester['run']>[1];

export type HostLintRule = Extract<Rule, { create: unknown }>;

type LintVisitor = ReturnType<HostLintRule['create']>;

export type VisitorNode<Name extends keyof LintVisitor> = Parameters<NonNullable<LintVisitor[Name]>>[0];
