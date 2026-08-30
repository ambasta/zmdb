export class UnsupportedFeatureError extends Error {
  readonly feature: string;
  readonly dialect: string;

  constructor(feature: string, dialect: string) {
    super(`${feature} is not supported on dialect "${dialect}"`);
    this.name = 'UnsupportedFeatureError';
    this.feature = feature;
    this.dialect = dialect;
  }
}
