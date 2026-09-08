import { type ColumnIR } from '@zmdb/schema/ir';
import { type CompiledQuery } from '@zmdb/sql';

import { type Driver } from '../index.js';
import { postgresDialect } from './official-dialects.fixture.js';

export function column(name: string, sql: ColumnIR['sql'], overrides: Partial<ColumnIR> = {}): ColumnIR {
  return {
    name,
    physicalName: name,
    sql,
    nullable: false,
    primaryKey: false,
    serial: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    constraints: {},
    rules: [],
    ...overrides,
  };
}

interface RecordingDriver extends Driver {
  readonly calls: CompiledQuery[];
}

type DriverAnswer = (
  query: CompiledQuery,
  call: number,
) => readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>;

export function recordingDriver(answer: DriverAnswer): RecordingDriver {
  const calls: CompiledQuery[] = [];
  return {
    dialect: postgresDialect,
    calls,
    async execute(query) {
      const call = calls.length;
      calls.push(query);
      return answer(query, call);
    },
  };
}
