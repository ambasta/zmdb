import { schemaFromIR } from '@zmdb/schema/ir';

export const toolSchema = schemaFromIR({
  table: 'echo',
  physicalTable: 'echo',
  primaryKey: [],
  relations: [],
  foreignKeys: [],
  columns: [
    {
      name: 'value',
      physicalName: 'value',
      sql: 'text',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: false,
      constraints: {},
      rules: [],
    },
  ],
});

export function validateEcho(input: unknown): { readonly value: string } {
  if (typeof input !== 'object' || input === null || !('value' in input) || typeof input.value !== 'string')
    throw new TypeError('value must be a string');
  return { value: input.value };
}
