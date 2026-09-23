// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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

export class InvalidOperatorError extends QueryCompilerError {
  readonly operator: string;

  constructor(invalidOp: string, dialect?: string) {
    const message = dialect
      ? `invalid unmapped SQL operator ${JSON.stringify(invalidOp)} for dialect ${JSON.stringify(dialect)}; expected one non-comment operator token that does not conflict with the dialect placeholder syntax`
      : `Invalid or unapproved operator: "${invalidOp}"`;
    super(message);
    this.name = 'InvalidOperatorError';
    this.operator = invalidOp;
  }
}
