export type QueryOperation = 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'other';

export interface QueryMetadata {
  readonly operation?: QueryOperation | undefined;
  readonly isWrite?: boolean | undefined;
  readonly returnsRows?: boolean | undefined;
}

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
  readonly operation?: QueryOperation | undefined;
  readonly isWrite?: boolean | undefined;
  readonly returnsRows?: boolean | undefined;
  readonly telemetry?: QueryTelemetry;
}

/** Compile-time database attributes consumed by tracing and metrics. */
export interface QueryTelemetry {
  readonly system: string;
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly collection: string;
}
