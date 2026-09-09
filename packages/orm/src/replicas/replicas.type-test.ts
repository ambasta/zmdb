import type { CompiledQuery, QueryEffects } from '@zmdb/sql';

// @ts-expect-error Every compiled or trusted raw query declares its effects.
const missing: CompiledQuery = { text: 'SELECT 1', parameters: [] };

// @ts-expect-error Writes cannot declare replica-safe execution.
const unsafe: QueryEffects = { operation: 'UPDATE', requiresPrimary: false, returnsRows: false };

void [missing, unsafe];
