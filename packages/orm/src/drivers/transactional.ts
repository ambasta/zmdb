// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type Driver } from '../index.js';

/** A driver that can pin every query in a callback to one database transaction. */
export interface TransactionalDriver extends Driver {
  transaction<Result>(run: (driver: Driver) => Promise<Result>): Promise<Result>;
}
