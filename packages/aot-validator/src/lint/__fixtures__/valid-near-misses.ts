import type { Sql, Table, Unique } from '@zmdb/schema-core/tags';

type Money = number & Sql<'numeric'>;

export interface Account extends Table<'accounts'> {
  id: number & Sql<'integer'>;
  email: (string & Unique) | null;
  preferences: object & Sql<'json'>;
  balance: Money;
}

interface AccountRepository {
  find(filter: Readonly<Record<string, unknown>>): unknown;
  list(options: { readonly page: { readonly limit: number; readonly offset: number } }): unknown;
  update(id: number, patch: Readonly<Record<string, unknown>>): unknown;
}

export function validCalls(repository: AccountRepository, id: number, patch: Readonly<Record<string, unknown>>): void {
  repository.find({ id });
  repository.list({ page: { limit: 20, offset: 0 } });
  repository.update(id, patch);
  repository.update(id, { email: 'reader@example.test' });
}

export const staticQuery = {
  text: 'SELECT * FROM accounts WHERE id = $1',
  parameters: [1],
};

export const expressionIndex = { expr: 'lower(email)' };
