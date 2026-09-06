export interface MetroFixtureResult {
  readonly acceptsGood: boolean;
  readonly acceptsBad: boolean;
  readonly table: string;
}

declare global {
  var __ZMDB_CUSTOM_TRANSFORMER__: boolean | undefined;
  var __ZMDB_METRO_PLAIN__: string;
  var __ZMDB_METRO_RESULT__: MetroFixtureResult;
  var __ZMDB_REACT_NATIVE_BINDING__: boolean;
}
