import { sqlite } from '@zmdb/sqlite';

export default {
  schema: './schema.ts',
  dialect: sqlite,
  project: './tsconfig.generate.json',
  http: {
    contracts: './contract.ts#HTTP_CONTRACT',
    openApi: { out: './generated/openapi.json' },
    client: { out: './generated/http-client.generated.ts' },
  },
};
