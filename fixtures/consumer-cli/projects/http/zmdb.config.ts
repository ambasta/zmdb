import { sqlite } from '@zmdb/sqlite';
export default {
  schema: './src/models.ts',
  dialect: sqlite,
  project: './tsconfig.json',
  http: {
    contracts: ['./src/contract.ts#HTTP_CONTRACT', './src/contract.ts#HEALTH_CONTRACT'],
    openApi: { out: './generated/openapi.json' },
    client: { out: './generated/http-client.generated.ts' },
  },
};
