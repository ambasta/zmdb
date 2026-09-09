// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { CompiledQuery, QueryEffects } from '@zmdb/sql';

// @ts-expect-error Every compiled or trusted raw query declares its effects.
const missing: CompiledQuery = { text: 'SELECT 1', parameters: [] };

// @ts-expect-error Writes cannot declare replica-safe execution.
const unsafe: QueryEffects = { operation: 'UPDATE', requiresPrimary: false, returnsRows: false };

void [missing, unsafe];
