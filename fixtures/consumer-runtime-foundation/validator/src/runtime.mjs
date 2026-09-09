import { validate } from '@zmdb/validator';

const witness = {
  kind: 'object',
  properties: [
    {
      name: 'email',
      type: { kind: 'scalar', scalar: 'string', constraints: { minLength: 3 } },
      optional: false,
      readonly: false,
    },
  ],
};

const input = { email: 'a@example.test' };
const accepted = validate(input, witness);
const rejected = validate({ email: 'x' }, witness);
if (!accepted.success || accepted.data !== input || rejected.success || rejected.issues[0]?.path !== 'input.email') {
  throw new Error('@zmdb/validator did not execute the installed schema witness');
}
