import type { JobStore } from '@zmdb/jobs';
import { createPgJobStore, type PgJobClient, type PgJobStoreOptions } from '@zmdb/jobs-postgres';
import type { Client, Pool, PoolClient } from 'pg';

const factory: typeof createPgJobStore = createPgJobStore;
const options: PgJobStoreOptions = { prepared: true, maxCacheSize: 32 };
type AcceptedClients = PgJobClient;

void factory;
void options;
const accepted: AcceptedClients | undefined = undefined;
void accepted;

export function fromPool(pool: Pool): JobStore {
  return createPgJobStore(pool);
}

export function fromPoolClient(client: PoolClient): JobStore {
  return createPgJobStore(client);
}

export function fromClient(client: Client): JobStore {
  return createPgJobStore(client, { prepared: true, maxCacheSize: 32, cancelVia: client });
}

export function rejectsStore(store: JobStore): void {
  // @ts-expect-error - a structural JobStore is not a node-postgres client.
  createPgJobStore(store);
}
