import { sqlite, sqliteDriver, sqliteIntrospector, sqliteVertical, type SqliteDatabase } from '@zmdb/sqlite';
import { runEmbedded, type EmbeddedConnection, type EmbeddedMigration } from '@zmdb/sqlite/embedded';
import { sqliteDriver as nodeSqliteDriver } from '@zmdb/sqlite/node';

declare const database: SqliteDatabase;
declare const embeddedConnection: EmbeddedConnection;
declare const embeddedMigrations: readonly EmbeddedMigration[];

const dialectName: 'sqlite' = sqlite.name;
const introspectorName: 'sqlite' = sqliteIntrospector.name;
const verticalName: 'sqlite' = sqliteVertical.dialect.name;
const driver = sqliteDriver(database);
const nodeDriver = nodeSqliteDriver(database);
const verticalDriver = sqliteVertical.driver(database);
const applied = runEmbedded(embeddedConnection, embeddedMigrations);

export { applied, dialectName, driver, introspectorName, nodeDriver, verticalDriver, verticalName };
