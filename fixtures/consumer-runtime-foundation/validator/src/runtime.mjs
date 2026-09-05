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

const accepted = validate({ email: 'a@example.test' }, witness);
const rejected = validate({ email: 'x' }, witness);
if (!accepted.success || rejected.success || rejected.errors?.[0]?.path !== 'input.email') {
  throw new Error('@zmdb/validator did not execute the installed schema witness');
}
