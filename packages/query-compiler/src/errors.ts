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
