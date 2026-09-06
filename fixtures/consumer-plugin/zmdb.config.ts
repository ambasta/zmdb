import { sqlite } from '@zmdb/sqlite';

export default {
  schema: 'src/model.ts',
  dialect: sqlite,
  project: './tsconfig.json',
  naming: 'snake_case_plural',
} as const;
