import type { CompiledQuery, Dialect, DialectTarget, IntrospectOptions } from '@zmdb/query-compiler';
import type { NamingStrategy } from '@zmdb/schema-core/naming';

export type { IntrospectOptions } from '@zmdb/query-compiler';
export type { NamingStrategy } from '@zmdb/schema-core/naming';

export interface HttpGenerationConfig {
  readonly contracts: string | readonly string[];
  readonly openApi: {
    readonly out: string;
  };
  readonly client: {
    readonly out: string;
  };
}

/** Structural database boundary shared by compiler tools without importing the ORM. */
export interface ToolingDriver {
  readonly dialect?: DialectTarget;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
  transaction?<T>(run: (driver: ToolingDriver) => Promise<T>): Promise<T>;
}

/** The plain-data half of a config, validated by the generated AOT checker. */
export interface ZmdbConfigData {
  readonly schema: string | readonly string[];
  readonly dialect: Dialect;
  readonly project?: string;
  readonly out?: string;
  readonly naming?: 'snake_case' | 'snake_case_plural';
  readonly migrations?: {
    readonly table?: string;
    readonly schema?: string;
  };
  readonly introspect?: IntrospectOptions;
  readonly http?: HttpGenerationConfig;
}

/** The complete author-facing config, including the two callable boundaries. */
export interface ZmdbConfig extends ZmdbConfigData {
  readonly driver?: () => ToolingDriver | Promise<ToolingDriver>;
  readonly namingStrategy?: NamingStrategy;
}

/** Identity helper for inference and editor completion; loading owns validation. */
export function defineConfig<const T extends ZmdbConfig>(config: T): T {
  return config;
}
