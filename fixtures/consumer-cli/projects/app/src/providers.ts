import { appendFileSync } from 'node:fs';

import { createToken } from '@zmdb/app/di';
export interface DatabaseService {
  readonly name: string;
  onShutdown(): void;
}
export interface RepositoryService {
  list(): string;
  onShutdown(): void;
}
export const DATABASE = createToken<DatabaseService>('DATABASE');
export const USERS = createToken<RepositoryService>('USERS');
export const ADMIN = createToken<{ readonly enabled: true }>('ADMIN');
export function event(value: string): void {
  const file = process.env.ZMDB_FIXTURE_EVENTS;
  if (file !== undefined) appendFileSync(file, `${value}\n`);
}
