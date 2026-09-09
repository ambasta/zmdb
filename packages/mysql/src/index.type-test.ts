// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Pool, PoolConnection } from 'mysql2/promise';

import { mysql, mysqlDriver, mysqlFamilyDriver, mysqlIntrospector, mysqlVertical } from './index.js';

declare const pool: Pool;
declare const connection: PoolConnection;

const poolDriver = mysqlDriver(pool);
const connectionDriver = mysqlDriver(connection);
const familyDriver = mysqlFamilyDriver(mysql, pool);

poolDriver satisfies ReturnType<typeof mysqlDriver>;
connectionDriver satisfies ReturnType<typeof mysqlDriver>;
familyDriver satisfies ReturnType<typeof mysqlDriver>;
mysqlVertical.dialect satisfies typeof mysql;
mysqlIntrospector.name satisfies 'mysql';
