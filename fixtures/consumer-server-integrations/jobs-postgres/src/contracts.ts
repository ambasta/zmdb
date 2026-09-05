import { createPgJobStore, type PgJobClient, type PgJobStoreOptions } from '@zmdb/jobs-postgres';
import type { Client, Pool, PoolClient } from 'pg';

const factory: typeof createPgJobStore = createPgJobStore;
const options: PgJobStoreOptions = { prepared: true, maxCacheSize: 32 };
type AcceptedClients = PgJobClient & (Pool | PoolClient | Client);

void factory;
void options;
const accepted: AcceptedClients | undefined = undefined;
void accepted;
