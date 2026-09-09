import type { runCli as cli } from '@zmdb/cli';
import type { ConfiguredZmdbAotOptions, zmdbAot as configuredPlugin } from '@zmdb/compiler';
import type { UnpluginLike, zmdbAot as directPlugin } from '@zmdb/compiler/unplugin';
import type { runCli as productCli } from '@zmdb/core/cli';
import type {
  // @ts-expect-error Metro is owned by its explicitly selected adapter entry
  getCacheKey as retiredProductMetroCache,
  // @ts-expect-error Metro types do not belong to the core compiler facade
  MetroOptions as RetiredProductMetroOptions,
  // @ts-expect-error Metro is owned by its explicitly selected adapter entry
  transform as retiredProductMetroTransform,
  // @ts-expect-error Metro is owned by its explicitly selected adapter entry
  withZmdb as retiredProductMetroWrapper,
  zmdbAot as productPlugin,
} from '@zmdb/core/compiler';
import type { EmbeddedConnection, runEmbedded } from '@zmdb/migrations/embedded';
import type {
  down,
  // @ts-expect-error the low-level engine has no command dispatcher
  runCli as retiredRunnerDispatch,
  status,
  up,
} from '@zmdb/migrations/runner';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
export type ConfiguredPluginStaysAsynchronous = Expect<
  Equal<ReturnType<typeof configuredPlugin>, Promise<UnpluginLike>>
>;
export type DirectPluginStaysSynchronous = Expect<Equal<ReturnType<typeof directPlugin>, UnpluginLike>>;
export type ProductPluginHasTheOwnerSignature = Expect<Equal<typeof productPlugin, typeof configuredPlugin>>;
export type ProductCliHasTheOwnerSignature = Expect<Equal<typeof productCli, typeof cli>>;
export type ConfigDiscoveryRemainsExplicit = Expect<Equal<ConfiguredZmdbAotOptions['config'], string | undefined>>;
export type EmbeddedConnectionStaysStructural = Expect<Equal<keyof EmbeddedConnection, 'exec' | 'run' | 'rows'>>;
export type RetainedEngine = [typeof up, typeof down, typeof status, typeof runEmbedded];

// @ts-expect-error the validator no longer declares a compiler entry
import type { compileProject as retiredValidatorCompiler } from '@zmdb/aot-validator/codegen';
// @ts-expect-error the migration product entry does not alias CLI dispatch
import type { runCli as retiredProductDispatch } from '@zmdb/core/migrations';
// @ts-expect-error the retired product spelling has no declaration entry
import type { zmdbAot as retiredProductPlugin } from '@zmdb/core/unplugin';
// @ts-expect-error command dispatch is owned only by the CLI package
import type { runCli as retiredMigrationDispatch } from '@zmdb/migrations';
// @ts-expect-error the query compiler no longer declares a migration entry
import type { up as retiredQueryMigrations } from '@zmdb/query-compiler/migrations';

export type RetiredDeclarations = [
  typeof retiredProductPlugin,
  typeof retiredValidatorCompiler,
  typeof retiredQueryMigrations,
  typeof retiredMigrationDispatch,
  typeof retiredRunnerDispatch,
  typeof retiredProductDispatch,
  typeof retiredProductMetroCache,
  RetiredProductMetroOptions,
  typeof retiredProductMetroTransform,
  typeof retiredProductMetroWrapper,
];
