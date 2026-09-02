#!/usr/bin/env node
// Runs the generated validators against fixtures and asserts the expected verdict.
// This is what makes DESIGN-type-first.md's claims checkable rather than asserted:
// if the generator regresses, this exits non-zero.
//
//   node scripts/prototypes/type-first/run.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'zmdb-typefirst-')), 'validators.mjs');
execFileSync(process.execPath, [join(HERE, 'generate.mjs'), '--out', out], { stdio: 'inherit' });

const v = await import(out);
const valid = {
  id: 1,
  email: 'a@b.co',
  age: 30,
  nickname: 'amit',
  role: 'admin',
  createdAt: 'now',
  passwordHash: 'h',
  active: true,
};
const create = { email: 'a@b.co', age: 30, nickname: null, role: 'viewer', passwordHash: 'h', active: false };

const CASES = [
  // --- Entity<User>: every column present, sensitive column included ----------
  ['Entity_User_', valid, true, 'complete row'],
  ['Entity_User_', { ...valid, id: undefined }, false, 'missing serial id'],
  ['Entity_User_', { ...valid, nickname: null }, true, 'Nullable<> accepts null'],
  ['Entity_User_', { ...valid, nickname: 'ab' }, false, 'MinLength<3> under a null union'],
  ['Entity_User_', { ...valid, role: 'root' }, false, 'value outside the literal union'],
  ['Entity_User_', { ...valid, active: 'yes' }, false, 'boolean is not a string'],
  ['Entity_User_', { ...valid, id: 1.5 }, false, 'Sql<serial> implies an integer'],
  ['Entity_User_', { ...valid, id: 0 }, false, 'Min<1> on the identity column'],
  ['Entity_User_', { ...valid, email: 'nope' }, false, 'Pattern<> rejects a non-address'],
  // 251 + 'a@b.co'.length exceeds 255; at exactly 255 it must still pass.
  ['Entity_User_', { ...valid, email: `${'a'.repeat(251)}@b.co` }, false, 'Length<255> rejects 256'],
  ['Entity_User_', { ...valid, email: `${'a'.repeat(250)}@b.co` }, true, 'Length<255> admits exactly 255'],
  ['Entity_User_', { ...valid, age: 17 }, false, 'Min<18>'],
  ['Entity_User_', { ...valid, age: 121 }, false, 'Max<120>'],

  // --- CreateDTO<User>: Serial dropped, HasDefault optional -------------------
  ['CreateDTO_User_', create, true, 'no id and no createdAt'],
  ['CreateDTO_User_', { ...create, createdAt: 'now' }, true, 'defaulted column may be supplied'],
  ['CreateDTO_User_', { ...create, age: 17 }, false, 'constraints survive Omit'],
  ['CreateDTO_User_', { ...create, email: undefined }, false, 'required column still required'],

  // --- UpdateDTO<User>: Serial and PrimaryKey dropped, all optional -----------
  ['UpdateDTO_User_', {}, true, 'empty patch'],
  ['UpdateDTO_User_', { age: 40 }, true, 'single-field patch'],
  ['UpdateDTO_User_', { age: 121 }, false, 'constraints survive Partial<Omit<>>'],
  ['UpdateDTO_User_', { nickname: null }, true, 'nullable column may be nulled'],

  // --- ReadDTO<User>: Sensitive stripped -------------------------------------
  ['ReadDTO_User_', { ...valid, passwordHash: undefined }, true, 'Sensitive column not required'],

  // --- CreateDTO<Post>: arrays and References ---------------------------------
  ['CreateDTO_Post_', { authorId: 1, title: 'hi', tags: ['a', 'b'] }, true, 'array of strings'],
  ['CreateDTO_Post_', { authorId: 1, title: 'hi', tags: ['a', 2] }, false, 'array element type'],
  ['CreateDTO_Post_', { authorId: 1, title: '', tags: [] }, false, 'MinLength<1> on title'],
];

let failures = 0;
for (const [fn, input, expected, label] of CASES) {
  const actual = v[fn](input);
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${fn.padEnd(18)} ${String(actual).padEnd(5)} ${label}`);
}

// The tags must not leak into the emitted code — they are compile-time only.
const source = execFileSync(process.execPath, [join(HERE, 'generate.mjs')], { encoding: 'utf8' });
if (source.includes('zmdb') && !source.startsWith('// GENERATED')) failures++;
if (/__@/.test(source)) {
  console.log('FAIL  a tag symbol leaked into the generated code');
  failures++;
}

console.log(`\n${CASES.length - failures}/${CASES.length} expectations met`);
process.exit(failures === 0 ? 0 : 1);
