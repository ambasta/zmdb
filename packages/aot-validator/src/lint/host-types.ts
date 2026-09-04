import type { RuleTester } from 'oxlint/plugins-dev';

type Rule = Parameters<RuleTester['run']>[1];

export type HostLintRule = Extract<Rule, { create: unknown }>;

type LintVisitor = ReturnType<HostLintRule['create']>;

export type VisitorNode<Name extends keyof LintVisitor> = Parameters<NonNullable<LintVisitor[Name]>>[0];
