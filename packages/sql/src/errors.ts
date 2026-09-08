export class QueryCompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryCompilerError';
  }
}

export class UnsupportedFeatureError extends Error {
  readonly feature: string;
  readonly dialect: string;

  constructor(feature: string, dialect: string, message = `${feature} is not supported on dialect "${dialect}"`) {
    super(message);
    this.name = 'UnsupportedFeatureError';
    this.feature = feature;
    this.dialect = dialect;
  }
}

export class SnapshotMismatchError extends Error {
  readonly version: number;
  readonly migrationVersion: number;
  readonly migrationName: string;
  readonly expectedSnapshot?: unknown;
  readonly actualSnapshot?: unknown;
  readonly diffs?: readonly unknown[] | undefined;

  constructor(details: {
    version: number;
    migrationName: string;
    message?: string | undefined;
    expectedSnapshot?: unknown;
    actualSnapshot?: unknown;
    diffs?: readonly unknown[] | undefined;
  }) {
    const msg =
      details.message ??
      `Snapshot validation failed for migration ${details.version} ("${details.migrationName}"): snapshot mismatch detected`;
    super(msg);
    this.name = 'SnapshotMismatchError';
    this.version = details.version;
    this.migrationVersion = details.version;
    this.migrationName = details.migrationName;
    this.expectedSnapshot = details.expectedSnapshot;
    this.actualSnapshot = details.actualSnapshot;
    this.diffs = details.diffs;
  }
}
