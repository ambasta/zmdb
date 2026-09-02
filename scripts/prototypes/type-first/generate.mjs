#!/usr/bin/env node
// Prototype for DESIGN-type-first.md: read the types with the TypeScript 7 checker
// and EMIT the runtime checks. Nothing here is a schema value — the only input is
// `model.ts`'s type declarations.
//
//   node scripts/prototypes/type-first/generate.mjs            # print the validators
//   node scripts/prototypes/type-first/generate.mjs --out FILE # write them
//
// This is a prototype, not the shipping transformer. It covers the cases the design
// document claims are covered and prints `/* unsupported */` for anything else, so
// the gaps stay visible instead of silently emitting a check that passes.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const { API } = await import(join(ROOT, 'node_modules/typescript/dist/api/sync/api.js'));
const { SyntaxKind } = await import(join(ROOT, 'node_modules/typescript/dist/ast/index.js'));

const MODEL = join(HERE, 'model.ts');
const SYMBOL_FLAG_OPTIONAL = 1 << 24;

// escapedName of a unique-symbol property → what the tag means. This table is the
// only place the code generator knows the vocabulary; the vocabulary itself
// (tags.ts) is pure types.
const TAGS = new Set([
  'zmdbTable',
  'zmdbSqlType',
  'zmdbPrimaryKey',
  'zmdbSerial',
  'zmdbUnique',
  'zmdbDefault',
  'zmdbSensitive',
  'zmdbReferences',
  'zmdbLength',
  'zmdbMin',
  'zmdbMax',
  'zmdbMinLength',
  'zmdbMaxLength',
  'zmdbPattern',
]);

const api = new API({ cwd: HERE });
const project = api.updateSnapshot({ openProjects: [join(HERE, 'tsconfig.json')] }).getProjects()[0];
if (!project) throw new Error('prototype tsconfig did not load');
const diagnostics = project.program.getSemanticDiagnostics(MODEL);
if (diagnostics.length > 0) throw new Error(`model.ts does not typecheck (${diagnostics.length} diagnostics)`);

const sf = project.program.getSourceFile(MODEL);
const ck = project.checker;

const literal = t => {
  const nn = ck.getNonNullableType(t) ?? t;
  return nn.isStringLiteralType?.() || nn.isNumberLiteralType?.() || nn.isBooleanLiteralType?.() ? nn.value : undefined;
};

/** Read the tag slots off an intersection. Returns e.g. `{ zmdbMin: 18 }`. */
function readTags(t) {
  const found = {};
  for (const s of ck.getPropertiesOfType(t)) {
    const name = s.escapedName ?? s.name;
    const match = /^__@(\w+?)@?\d*$/.exec(name);
    if (match && TAGS.has(match[1])) found[match[1]] = literal(ck.getTypeOfSymbolAtLocation(s, sf));
  }
  return found;
}

/** The data-carrying part of `number & Min<18>`, and whether it is an object. */
function classify(t) {
  const parts = t.isIntersectionType?.() ? t.getTypes() : [t];
  for (const c of parts) if (c.isIntrinsicType?.()) return { kind: c.intrinsicName };
  if (ck.isArrayType(t)) return { kind: 'array', element: ck.getTypeArguments(t)[0] };
  if (ck.isTupleType(t)) return { kind: 'tuple', elements: ck.getTypeArguments(t) };
  const name = ck.typeToString(t);
  if (name === 'Date') return { kind: 'date' };
  // A property-bearing type with no intrinsic part is a struct. Tag-only slots are
  // not data, so a type whose ONLY properties are tags is not an object.
  const dataProps = ck.getPropertiesOfType(t).filter(s => !/^__@\w+?@?\d*$/.test(s.escapedName ?? s.name));
  if (dataProps.length > 0) return { kind: 'object', properties: dataProps };
  return { kind: name };
}

const emitted = new Map(); // type id → emitted function name, for cycles
const helpers = [];
let helperSeq = 0;

const isUndefined = t => t.isIntrinsicType?.() && t.intrinsicName === 'undefined';

function checks(t, expr) {
  // --- unions: null/undefined members, literal enums, and genuine sum types ---
  if (t.isUnionType?.()) {
    const members = t.getTypes();
    // `boolean` IS `true | false` — a union, not an intrinsic type. Recognise it
    // here or classify() falls through to its property-bearing branch and emits an
    // object check for a primitive.
    if (members.length === 2 && members.every(m => m.isBooleanLiteralType?.())) {
      return [`typeof ${expr} === "boolean"`];
    }
    {
      const nullable = members.some(m => m.isIntrinsicType?.() && m.intrinsicName === 'null');
      const undef = members.some(isUndefined);
      const rest = members.filter(m => !(m.isIntrinsicType?.() && ['null', 'undefined'].includes(m.intrinsicName)));
      const allLiteral = rest.length > 0 && rest.every(m => literal(m) !== undefined);
      const arms = [];
      if (nullable) arms.push(`${expr} === null`);
      if (undef) arms.push(`${expr} === undefined`);
      if (allLiteral) arms.push(...rest.map(m => `${expr} === ${JSON.stringify(literal(m))}`));
      else arms.push(...rest.map(m => `(${checks(m, expr).join(' && ')})`));
      return [`(${arms.join(' || ')})`];
    }
  }

  const { kind, element, elements, properties } = classify(t);
  const tag = readTags(t);
  const out = [];

  switch (kind) {
    case 'number':
      out.push(`typeof ${expr} === "number"`);
      // An `integer`/`serial`/`bigint` SQL column is an integer regardless of any
      // Min tag, so the integrality check comes from the SQL type, not a Min<1>.
      if (['serial', 'integer', 'bigint'].includes(tag.zmdbSqlType)) out.push(`Number.isInteger(${expr})`);
      if ('zmdbMin' in tag) out.push(`${expr} >= ${tag.zmdbMin}`);
      if ('zmdbMax' in tag) out.push(`${expr} <= ${tag.zmdbMax}`);
      break;
    case 'string':
      out.push(`typeof ${expr} === "string"`);
      if ('zmdbMinLength' in tag) out.push(`${expr}.length >= ${tag.zmdbMinLength}`);
      // A varchar length is a maximum, and is the MaxLength when none is declared.
      if ('zmdbMaxLength' in tag) out.push(`${expr}.length <= ${tag.zmdbMaxLength}`);
      else if ('zmdbLength' in tag) out.push(`${expr}.length <= ${tag.zmdbLength}`);
      if ('zmdbPattern' in tag) out.push(`new RegExp(${JSON.stringify(tag.zmdbPattern)}).test(${expr})`);
      break;
    case 'boolean':
      out.push(`typeof ${expr} === "boolean"`);
      break;
    case 'bigint':
      out.push(`typeof ${expr} === "bigint"`);
      break;
    case 'date':
      out.push(`${expr} instanceof Date`, `!Number.isNaN(${expr}.getTime())`);
      break;
    case 'array':
      out.push(`Array.isArray(${expr})`, `${expr}.every(v => ${checks(element, 'v').join(' && ')})`);
      break;
    case 'tuple':
      out.push(`Array.isArray(${expr})`, `${expr}.length === ${elements.length}`);
      elements.forEach((el, i) => out.push(`(${checks(el, `${expr}[${i}]`).join(' && ')})`));
      break;
    case 'object': {
      // Cycle guard: a self-referencing type becomes a named helper, emitted once.
      if (emitted.has(t.id)) {
        out.push(`${emitted.get(t.id)}(${expr})`);
        break;
      }
      const name = `_check${helperSeq++}`;
      emitted.set(t.id, name);
      const body = [`typeof v === "object" && v !== null`];
      for (const s of properties) {
        const pt = ck.getTypeOfSymbolAtLocation(s, sf);
        const access = /^[A-Za-z_$][\w$]*$/.test(s.name) ? `v.${s.name}` : `v[${JSON.stringify(s.name)}]`;
        const inner = checks(pt, access).join(' && ');
        // An optional property's type already carries `| undefined` under
        // exactOptionalPropertyTypes, so the union arm covers absence. Wrap only if
        // it somehow does not, rather than emitting the arm twice.
        const carriesUndefined = pt.isUnionType?.() ? pt.getTypes().some(isUndefined) : isUndefined(pt);
        const optional = (s.flags & SYMBOL_FLAG_OPTIONAL) !== 0;
        body.push(optional && !carriesUndefined ? `(${access} === undefined || (${inner}))` : `(${inner})`);
      }
      helpers.push(`const ${name} = v =>\n  ${body.join('\n  && ')};`);
      out.push(`${name}(${expr})`);
      break;
    }
    default:
      out.push(`/* unsupported: ${kind} */ false`);
  }
  return out;
}

// --- walk the assert<T>() call sites -----------------------------------------

const calls = [];
(function walk(node) {
  if (!node) return;
  if (node.kind === SyntaxKind.CallExpression && node.typeArguments?.length) calls.push(node);
  node.forEachChild?.(walk);
})(sf);

const exports_ = [];
for (const call of calls) {
  const node = call.typeArguments[0];
  const label = node.getText?.() ?? 'anonymous';
  const t = ck.getTypeFromTypeNode(node);
  const body = checks(t, 'x').join('\n  && ');
  const name = label.replace(/[^A-Za-z0-9]/g, '_');
  exports_.push(`// assert<${label}>\nexport const ${name} = x =>\n  ${body};`);
}

const source = [
  '// GENERATED by scripts/prototypes/type-first/generate.mjs — do not edit.',
  '// Input: the TYPES in model.ts. No schema value, no descriptor, no runtime parser.',
  '',
  ...helpers,
  '',
  ...exports_,
].join('\n');

api.close();

const outFlag = process.argv.indexOf('--out');
if (outFlag !== -1 && process.argv[outFlag + 1]) writeFileSync(process.argv[outFlag + 1], `${source}\n`);
else console.log(source);
