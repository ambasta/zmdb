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
