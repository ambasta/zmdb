// Compile-only public-surface freeze for plugin/SPEC.md §6.
//
import { withZmdb } from '@zmdb/aot-validator/metro';
import type { MetroConfig } from 'metro';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

interface FrozenMetroOptions {
  readonly workerCount?: number;
}

type FrozenWithZmdb = <Config extends MetroConfig>(config: Config, options?: FrozenMetroOptions) => Config;

export type _WithZmdbHasTheFrozenSignature = Expect<Equal<typeof withZmdb, FrozenWithZmdb>>;

const config = { projectRoot: '/app' } satisfies MetroConfig;

export const configured = withZmdb(config, { workerCount: 1 });
export type _ConfigurationTypeIsPreserved = Expect<Equal<typeof configured, typeof config>>;
