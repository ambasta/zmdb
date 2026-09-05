import type { Observability } from '@zmdb/app/observability';

import { createRouter, type Router } from './pipeline/index.js';

/** Build the HTTP router with the app-owned observability ports. */
export function createTracedRouter(observability: Observability = {}): Router {
  return createRouter(observability);
}
