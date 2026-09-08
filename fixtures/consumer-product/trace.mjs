import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const trace = process.env.ZMDB_PRODUCT_TRACE;
if (trace === undefined) throw new Error('ZMDB_PRODUCT_TRACE is required');
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    appendFileSync(trace, JSON.stringify({ specifier, url: resolved.url }) + '\n');
    return resolved;
  },
});
