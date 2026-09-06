import { mysql, mysqlDriver, mysqlIntrospector, mysqlVertical, type MysqlDriver } from '@zmdb/mysql';
import type { Pool, PoolConnection } from 'mysql2/promise';

declare const pool: Pool;
declare const connection: PoolConnection;

const poolDriver: MysqlDriver = mysqlDriver(pool);
const connectionDriver: MysqlDriver = mysqlDriver(connection);

poolDriver.dialect satisfies typeof mysql;
connectionDriver.dialect satisfies typeof mysql;
void mysqlVertical.driver(pool);
void mysql;
void mysqlVertical.dialect;
void mysqlIntrospector.name;
