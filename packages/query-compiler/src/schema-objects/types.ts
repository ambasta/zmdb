export type IndexMethod = 'btree' | 'hash' | 'gin' | 'gist' | 'brin' | 'ivfflat' | 'hnsw';
export type IndexColumn =
  | string
  | { readonly column: string; readonly opclass?: string }
  | { readonly expr: string; readonly opclass?: string };

export interface IndexDef {
  name: string;
  table: string;
  columns: readonly IndexColumn[];
  unique?: boolean;
  where?: string;
  method?: IndexMethod;
  with?: Readonly<Record<string, number>>;
}

export interface ViewDef {
  name: string;
  select: string;
  materialized?: boolean;
}

export interface SequenceDef {
  name: string;
  start?: number;
  increment?: number;
}

export interface GeneratedColumn {
  name: string;
  type: string;
  expression: string;
  stored?: boolean;
}

export interface RlsPolicy {
  name: string;
  table: string;
  using: string;
  command?: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
}

export type RoutineSqlType =
  | 'serial'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'text'
  | 'varchar'
  | 'boolean'
  | 'timestamp'
  | 'json'
  | 'jsonEnum'
  | 'uuid'
  | 'date'
  | 'time'
  | 'decimal'
  | 'blob';

export interface RoutineDef {
  readonly kind: 'function' | 'procedure';
  readonly name: string;
  readonly params: readonly {
    readonly name: string;
    readonly type: RoutineSqlType;
    readonly mode?: 'in' | 'out' | 'inout';
  }[];
  readonly returns?: { readonly type: RoutineSqlType | 'void'; readonly setof?: boolean };
  readonly language?: string;
  readonly deterministic?: boolean;
  readonly body: string;
}

export interface ExtensionDef {
  readonly name: string;
  readonly schema?: string;
  readonly version?: string;
}
