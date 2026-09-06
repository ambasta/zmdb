import { noDistributedNullableTags } from './rules/no-distributed-nullable-tags.js';
import { noEmptyPatch } from './rules/no-empty-patch.js';
import { noInterpolatedSql } from './rules/no-interpolated-sql.js';
import { noUnboundedFind } from './rules/no-unbounded-find.js';
import { noUnknownJsonColumn } from './rules/no-unknown-json-column.js';
import { requireSqlOnNumber } from './rules/require-sql-on-number.js';
import type { LintRule } from './types.js';

export type { LintRule } from './types.js';

interface LintPlugin {
  readonly meta: {
    readonly name: string;
    readonly version: string;
  };
  readonly rules: Readonly<Record<string, LintRule>>;
}

type Severity = 'error' | 'warn';

interface FlatConfig {
  readonly name: string;
  readonly plugins: Readonly<Record<string, LintPlugin>>;
  readonly rules: Readonly<Record<string, Severity>>;
}

interface LintConfigs {
  readonly recommended: readonly FlatConfig[];
  readonly strict: readonly FlatConfig[];
}

const rules: Readonly<Record<string, LintRule>> = {
  'no-distributed-nullable-tags': noDistributedNullableTags,
  'no-empty-patch': noEmptyPatch,
  'no-interpolated-sql': noInterpolatedSql,
  'no-unbounded-find': noUnboundedFind,
  'no-unknown-json-column': noUnknownJsonColumn,
  'require-sql-on-number': requireSqlOnNumber,
};

const plugin: LintPlugin = {
  meta: {
    name: '@zmdb/compiler',
    version: '1.0.0-alpha.4',
  },
  rules,
};

export const configs: LintConfigs = {
  recommended: [
    {
      name: 'zmdb/recommended',
      plugins: { zmdb: plugin },
      rules: {
        'zmdb/no-distributed-nullable-tags': 'error',
        'zmdb/no-empty-patch': 'warn',
        'zmdb/no-interpolated-sql': 'error',
        'zmdb/no-unbounded-find': 'warn',
        'zmdb/no-unknown-json-column': 'error',
        'zmdb/require-sql-on-number': 'warn',
      },
    },
  ],
  strict: [
    {
      name: 'zmdb/strict',
      plugins: { zmdb: plugin },
      rules: {
        'zmdb/no-distributed-nullable-tags': 'error',
        'zmdb/no-empty-patch': 'error',
        'zmdb/no-interpolated-sql': 'error',
        'zmdb/no-unbounded-find': 'error',
        'zmdb/no-unknown-json-column': 'error',
        'zmdb/require-sql-on-number': 'error',
      },
    },
  ],
};

export default plugin;
