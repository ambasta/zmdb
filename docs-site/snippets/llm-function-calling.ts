import { lenientParse, toolFor, toolFromSchema, type ToolSpec } from '@zmdb/ai';
import { assert } from '@zmdb/aot-validator';
import { schemaOf } from '@zmdb/schema-core';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import type { CreateDTO } from 'zmdb/derive';

const toolCall = { input: {} };
const userRepo = { create: async (_dto: any) => ({}) };

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: ('admin' | 'user') & HasDefault;
}

// #region snippet-1
export const createUser = toolFor<User>('openai-strict', 'create_user', {
  description: 'Create a user',
});
// #endregion snippet-1

// #region snippet-2
{
  const users = schemaOf<User>();

  const generic: ToolSpec = toolFromSchema('create_user', users, {
    description: 'Create a user',
  });
}
// #endregion snippet-2

// #region snippet-3
{
  (async () => {
    const dto = assert<CreateDTO<User>>(toolCall.input);
    await userRepo.create(dto);
  })();
}
// #endregion snippet-3

// #region snippet-4
{
  const fenced = '```json\n{"email":"alice@example.com"}\n```';
  const result = lenientParse(fenced);
  // => { success: true, data: { email: 'alice@example.com' } }
}
// #endregion snippet-4

// #region snippet-5
{
  (async () => {
    const result = lenientParse('{"email":"alice@example.com"}', value => assert<CreateDTO<User>>(value));

    if (!result.success) {
      throw new Error(result.errors?.join('; ') ?? 'invalid model output');
    }

    await userRepo.create(result.data);
  })();
}
// #endregion snippet-5
