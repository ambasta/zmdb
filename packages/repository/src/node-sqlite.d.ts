declare module 'node:sqlite' {
  export type SQLInputValue = null | number | bigint | string | ArrayBufferView;
  export interface StatementSync {
    all(...params: SQLInputValue[]): unknown[];
    run(...params: SQLInputValue[]): unknown;
  }
  export class DatabaseSync {
    constructor(path: string, options?: unknown);
    prepare(sql: string): StatementSync;
  }
}
