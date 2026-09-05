// What the project prints. Deliberately the whole observable behaviour of `./orders.ts`, on
// one line per question, because the fixtures' behaviour is compared by comparing this output.
//
// So: nothing non-deterministic reaches stdout. `sample()` returns a different order every
// time, and what is printed about it is whether the validator accepts it — which is the
// interesting claim anyway (REQ-AV-4: the generator and the checker agree about the type).

import { accepts, acceptsPoint, document, explain, insist, sample, schema } from './orders.js';

const good = {
  id: 1,
  reference: 'ORD-0001',
  total: 4250,
  status: 'shipped',
  note: null,
  shipTo: { line1: '1 Example Way', city: 'Bristol', postcode: 'BS1 1AA' },
};

// Three ways to be wrong, one per kind of check: the wrong primitive, a constraint the tags
// put in the type (`Min<0>`), and a literal union with a value that is not in it.
const badType = { ...good, total: '4250' };
const badConstraint = { ...good, total: -1 };
const badUnion = { ...good, status: 'refunded' };
const badNested = { ...good, shipTo: { line1: '', city: 'Bristol', postcode: 'BS1 1AA' } };

const line = (label: string, value: unknown): void => {
  console.log(`${label}: ${JSON.stringify(value)}`);
};

line('accepts(good)', accepts(good));
line('accepts(badType)', accepts(badType));
line('accepts(badConstraint)', accepts(badConstraint));
line('accepts(badUnion)', accepts(badUnion));
line('accepts(badNested)', accepts(badNested));
line('acceptsPoint({x,y})', acceptsPoint({ x: 1, y: 2 }));
line('acceptsPoint({x})', acceptsPoint({ x: 1 }));
line('insist(good).reference', insist(good).reference);
line('explain(badType)', explain(badType));
line('accepts(sample())', accepts(sample()));
line('document()', document());
line('schema().table', schema().table);
line('schema().primaryKey', schema().primaryKey);
line('schema().columns.total', schema().columns['total']);
line('schema().columns.ship_to', schema().columns['ship_to']);

try {
  insist(badConstraint);
  line('insist(badConstraint)', 'did not throw');
} catch (error) {
  line('insist(badConstraint) threw', (error as Error).message);
}
