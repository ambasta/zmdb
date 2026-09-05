// Compile-only public-surface freeze for plugin/SPEC.md §6.
//
// `withZmdb` does not ship yet, so the import error is the type-level equivalent
// of an `it.fails`. The initialized local control below records the frozen shape
// without pretending that a runtime export already exists.

// @ts-expect-error frozen (#520): `@zmdb/aot-validator/metro` is not exported yet.
import type { withZmdb } from '@zmdb/aot-validator/metro';
import type { MetroConfig } from 'metro';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

interface FrozenMetroOptions {
  readonly workerCount?: number;
}

type FrozenWithZmdb = <Config extends MetroConfig>(config: Config, options?: FrozenMetroOptions) => Config;

export type _WithZmdbHasTheFrozenSignature = Expect<Equal<typeof withZmdb, FrozenWithZmdb>>;

function unimplemented(what: string): never {
  throw new Error(`${what} is a compile-only frozen surface`);
}

const frozenWithZmdb: FrozenWithZmdb = (_config, _options) => unimplemented('withZmdb');
const config = { projectRoot: '/app' } satisfies MetroConfig;

export const configured = frozenWithZmdb(config, { workerCount: 1 });
export type _ConfigurationTypeIsPreserved = Expect<Equal<typeof configured, typeof config>>;
