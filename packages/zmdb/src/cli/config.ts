// The CLI consumes the canonical tooling owner directly. `zmdb/config` is the
// stable product facade over these same identities.
export { loadConfig, resolveConfig } from '@zmdb/compiler/config';
export type { ResolvedConfig, ZmdbConfig } from '@zmdb/compiler/config';
