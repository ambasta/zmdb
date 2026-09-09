// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Observability } from '@zmdb/app/observability';

import { createRouter, type Router } from './pipeline/index.js';

/** Build the HTTP router with the app-owned observability ports. */
export function createTracedRouter(observability: Observability = {}): Router {
  return createRouter(observability);
}
