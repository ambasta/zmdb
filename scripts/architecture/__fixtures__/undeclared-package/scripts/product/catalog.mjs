const freezeArray = values => Object.freeze([...values]);

export const PRODUCT_CATALOG = Object.freeze([
  Object.freeze({
    id: 'core',
    directory: 'packages/core',
    npmName: '@fixture/core',
    role: 'foundation',
    facade: Object.freeze({
      root: freezeArray(['coreValue']),
      subpaths: freezeArray([]),
    }),
    optionality: Object.freeze({ kind: 'required' }),
    docsOwner: 'fixture-core',
    consumer: Object.freeze({ reason: 'The fixture verifier reads this package directly.' }),
  }),
  Object.freeze({
    id: 'app',
    directory: 'packages/app',
    npmName: '@fixture/app',
    role: 'application',
    facade: Object.freeze({
      root: freezeArray(['appValue']),
      subpaths: freezeArray(['zmdb/app']),
    }),
    optionality: Object.freeze({ kind: 'required' }),
    docsOwner: 'fixture-app',
    consumer: Object.freeze({ reason: 'The fixture verifier reads this package directly.' }),
  }),
]);
