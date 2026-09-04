// Keep the published CLI entry's internal imports on its own relative boundary.
// The implementation remains the single config loader exported by `zmdb/config`.
export { loadConfig, resolveConfig } from '../config/index.js';
export type { ResolvedConfig, ZmdbConfig } from '../config/index.js';
