import { postgres } from '@zmdb/postgres';
import { sqlite } from '@zmdb/sqlite';

import type { loadConfig as loadCliConfig, ResolvedConfig as CliResolvedConfig } from '../../../zmdb/src/cli/config.js';
import { zmdbAot } from '../../../zmdb/src/compiler.js';
import type {
  defineConfig as productDefineConfig,
  HttpGenerationConfig as ProductHttpGenerationConfig,
  loadConfig as productLoadConfig,
  ResolvedConfig as ProductResolvedConfig,
  ZmdbConfig as ProductZmdbConfig,
} from '../../../zmdb/src/config/index.js';
import type { defineConfig as rootDefineConfig, ZmdbConfig as RootZmdbConfig } from '../../../zmdb/src/index.js';
import type {
  defineConfig as contractDefineConfig,
  HttpGenerationConfig as ContractHttpGenerationConfig,
  ZmdbConfig as ContractZmdbConfig,
} from './contract.js';
import {
  defineConfig,
  loadConfig,
  resolveConfig,
  type HttpGenerationConfig,
  type ResolvedConfig,
  type ZmdbConfig,
} from './index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type _CliUsesTheCanonicalLoader = Expect<Equal<typeof loadCliConfig, typeof loadConfig>>;
export type _CliUsesTheCanonicalResolvedConfig = Expect<Equal<CliResolvedConfig, ResolvedConfig>>;
export type _PublicConfigUsesTheAuthoringIdentity = Expect<Equal<typeof contractDefineConfig, typeof defineConfig>>;
export type _PublicConfigUsesTheAuthoringType = Expect<Equal<ContractZmdbConfig, ZmdbConfig>>;
export type _PublicConfigUsesTheHttpAuthoringType = Expect<Equal<ContractHttpGenerationConfig, HttpGenerationConfig>>;
export type _ProductConfigUsesTheCanonicalLoader = Expect<Equal<typeof productLoadConfig, typeof loadConfig>>;
export type _ProductConfigUsesTheCanonicalIdentity = Expect<Equal<typeof productDefineConfig, typeof defineConfig>>;
export type _ProductConfigUsesTheCanonicalResolvedType = Expect<Equal<ProductResolvedConfig, ResolvedConfig>>;
export type _ProductConfigUsesTheCanonicalAuthoringType = Expect<Equal<ProductZmdbConfig, ZmdbConfig>>;
export type _ProductRootUsesTheCanonicalIdentity = Expect<Equal<typeof rootDefineConfig, typeof defineConfig>>;
export type _ProductRootUsesTheCanonicalAuthoringType = Expect<Equal<RootZmdbConfig, ZmdbConfig>>;
export type _ProductConfigUsesTheCanonicalHttpType = Expect<Equal<ProductHttpGenerationConfig, HttpGenerationConfig>>;

const config = defineConfig({
  schema: ['src/**/*.schema.ts'],
  dialect: postgres,
  project: './tsconfig.json',
  out: './migrations',
  naming: 'snake_case_plural',
  http: {
    contracts: ['./src/http-contract.ts#HTTP_CONTRACT'],
    openApi: { out: './generated/openapi.json' },
    client: { out: './generated/http-client.generated.ts' },
  },
  driver: async () => ({ dialect: postgres, execute: async () => [] }),
  namingStrategy: {
    table: name => name.toLowerCase(),
    column: (name, context) => `${context.table}_${name}`,
    index: (table, columns, unique) => `${table}_${columns.join('_')}_${unique ? 'uniq' : 'idx'}`,
  },
});

const accepted: ZmdbConfig = config;
void accepted;

const loaded: Promise<ResolvedConfig> = loadConfig({ cwd: '/tmp/project', path: './zmdb.config.ts' });
void loaded;
void (await loaded).resolvedNaming;
void (await loaded).http?.contracts[0]?.exportName;
void (await loaded).http?.openApiOut;
void (await loaded).http?.clientOut;

const optional: Promise<ResolvedConfig | undefined> = loadConfig({ cwd: '/tmp/project', optional: true });
void optional;

const resolved: Promise<ResolvedConfig> = resolveConfig(config, '/tmp/project/zmdb.config.ts');
void resolved;

const configuredCompiler = zmdbAot({ cwd: '/tmp/project', config: './zmdb.config.ts' });
void configuredCompiler;

defineConfig({
  schema: 'src/**/*.ts',
  // @ts-expect-error — the loader accepts only implemented SQL dialects.
  dialect: 'oracle',
});

defineConfig({
  schema: 'src/**/*.ts',
  dialect: sqlite,
  // @ts-expect-error — tooling drivers carry the same explicit dialect object as the config.
  driver: () => ({ execute: async () => [] }),
});

defineConfig({
  schema: 'src/**/*.ts',
  dialect: sqlite,
  namingStrategy: {
    // @ts-expect-error — naming hooks return physical names, not numbers.
    table: () => 17,
  },
});

defineConfig({
  schema: 'src/**/*.ts',
  dialect: sqlite,
  http: {
    contracts: './src/http-contract.ts#HTTP_CONTRACT',
    openApi: { out: './openapi.json' },
    client: {
      // @ts-expect-error — generated client output is a path string.
      out: 17,
    },
  },
});
