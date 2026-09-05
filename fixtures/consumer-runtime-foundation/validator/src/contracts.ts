import type { TypeIR } from '@zmdb/schema/ir';
import { assert, assertEquals, equals, is, random, validate, type ValidateResult } from '@zmdb/validator';

interface User {
  readonly id: number;
}

const witness: TypeIR = {
  kind: 'object',
  properties: [{ name: 'id', type: { kind: 'scalar', scalar: 'integer' }, optional: false, readonly: true }],
};
const checked: boolean = is<User>({ id: 1 }, witness);
const exact: boolean = equals<User>({ id: 1 }, witness);
const result: ValidateResult<User> = validate<User>({ id: 1 }, witness);
const asserted: User = assert<User>({ id: 1 }, witness);
const exactAsserted: User = assertEquals<User>({ id: 1 }, witness);
const sample: User = random<User>(witness, () => 0.5);

void [checked, exact, result, asserted, exactAsserted, sample];
