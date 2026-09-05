#!/usr/bin/env node
// Compatibility command retained for downstream callers. The generic
// architecture-policy verifier now owns all tooling/module reachability.

import { runRuntimeReachabilityCli } from './verify-runtime-reachability.mjs';

process.exitCode = await runRuntimeReachabilityCli(process.argv.slice(2), {
  compatibilityName: 'devtools boundary compatibility',
});
