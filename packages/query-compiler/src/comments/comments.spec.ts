// Tests for the sqlcommenter query tagging frozen in ./SPEC.md (#580, epic #578).
// The bodies were recorded before implementation and remain the ratchet for #583.
import { describe, expect, it } from 'vitest';

import { createQueryCompiler, type CompiledQuery } from '../index.js';
import { postgresDialect } from '../testing/official-dialects.fixture.js';
import { appendComment, serializeComment, withComments, type CommentPairs } from './index.js';

// ./SPEC.md §6: the tag is rendered by the driver decorator at execute time. Where that
// decorator is exported from was #583's call. It lives beside the serializer and accepts the
// structural minimum of `Driver`, so `@zmdb/query-compiler` does not depend on
// `@zmdb/repository`. §7.7 and §7.8 exercise that public decorator directly.
interface ExecutingDriver {
  readonly dialect?: typeof postgresDialect;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

/** A driver that records the statement text it was handed and returns no rows. */
interface RecordingDriver extends ExecutingDriver {
  readonly seen: readonly string[];
}

const recordingDriver = (): RecordingDriver => {
  const seen: string[] = [];
  return {
    dialect: postgresDialect,
    seen,
    execute: (query: CompiledQuery) => {
      seen.push(query.text);
      return Promise.resolve([]);
    },
  };
};

const compiler = createQueryCompiler(postgresDialect);
const selectUsers = () => compiler.selectFrom('users').select(['id', 'email']).where('id', '=', 1).compile();

const FULL_PAIRS: CommentPairs = {
  action: 'get',
  controller: 'UsersController',
  framework: 'zmdb:0.1.0',
  route: '/users/:id',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
};

describe('sqlcommenter query tagging (#580 freeze of comments SPEC)', () => {
  // §7.9. "Byte-identical to today's" is a claim about a string, so the untagged baseline
  // was written down before the feature existed. If the disabled path changes any of these
  // four texts, this test fails.
  //
  // Recorded 2026-09-04 by running the four builders under
  // `node --import scripts/ts-specifier-hook.mjs`.
  it('an untagged compiled query is the byte-identical baseline this freeze recorded', () => {
    const select = selectUsers();
    const insert = compiler.insertInto('orders').values({ sku: 'X-1', qty: 2 }).compile();
    const update = compiler.updateTable('users').set({ email: 'a@b.com' }).where('id', '=', 1).compile();
    const remove = compiler.deleteFrom('users').where('id', '=', 1).compile();

    expect(select.text).toBe('SELECT "id", "email" FROM "users" WHERE "id" = $1');
    expect(insert.text).toBe('INSERT INTO "orders" ("sku", "qty") VALUES ($1, $2)');
    expect(update.text).toBe('UPDATE "users" SET "email" = $1 WHERE "id" = $2');
    expect(remove.text).toBe('DELETE FROM "users" WHERE "id" = $1');

    // §6 and §7.7: a compiled query has exactly two keys and is frozen. `Object.keys` rather
    // than `toEqual`, because `toEqual` ignores an added `undefined`-valued key and this
    // assertion is precisely about the key set the repository's existing `toEqual`s compare.
    for (const query of [select, insert, update, remove]) {
      expect(Object.keys(query)).toEqual(['text', 'parameters', 'operation', 'isWrite', 'returnsRows']);
      expect(Object.isFrozen(query)).toBe(true);
    }
  });

  // §7.9, the other half: with `comments` absent the text is unchanged. `appendComment` with
  // no pairs is that path, and it must return the input rather than an empty `/**/`.
  it('emits no comment when comments are disabled', () => {
    const query = selectUsers();
    expect(appendComment(query.text, {})).toBe('SELECT "id", "email" FROM "users" WHERE "id" = $1');
    expect(appendComment(query.text, {})).not.toContain('/*');
  });

  // §7.1 and §7.4. The exact string from §3's worked example, byte for byte, including the
  // sort order and the `\'`.
  it('emits a sorted sqlcommenter comment with url-encoded values', () => {
    const out = serializeComment({
      route: '/users/:id',
      controller: "o'brien*/DROP",
      action: 'list',
      traceparent: '00-abc-def-01',
    });

    expect(out).toBe(
      "action='list',controller='o\\'brien*%2FDROP',route='%2Fusers%2F%3Aid',traceparent='00-abc-def-01'",
    );

    // §2's worked example, which is the shape a reader will copy.
    expect(serializeComment(FULL_PAIRS)).toBe(
      "action='get',controller='UsersController',framework='zmdb%3A0.1.0',route='%2Fusers%2F%3Aid'," +
        "traceparent='00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'",
    );
  });

  // §7.1: asserted on the *substring* `*/`, not on an escaped form, so a different-but-correct
  // encoding still passes and an incorrect one cannot. §1 is explicit that this is the one
  // part of the epic whose failure mode is SQL injection rather than a bad dashboard.
  //
  // The value set is every character that terminates or escapes something downstream, each
  // one checked with `node`: `*/` -> `*%2F` (§3: `*` is unreserved and passes through, so a
  // sanitizer that stripped `*` would have done nothing), `\n` -> `%0A`, `\r` -> `%0D`,
  // U+2028 -> `%E2%80%A8`, U+2029 -> `%E2%80%A9`.
  it('cannot terminate the comment early', () => {
    // The two line-separator characters are written as `\u2028` / `\u2029` escapes rather
    // than as literals: they terminate a line in JavaScript source, so a literal one here
    // would be an invisible hazard in a file whose subject is invisible characters.
    const hostile = [
      '*/',
      'a*/b',
      '*/; DROP TABLE users; --',
      '*/*/',
      '\n',
      'a\nb',
      '\r\n',
      '\u2028',
      '\u2029',
      '*',
      '/',
      '--',
      '/*',
    ];

    for (const value of hostile) {
      const out = serializeComment({ route: value });
      expect(out).not.toContain('*/');
      // The rendered comment is the thing that actually reaches the database, so assert on
      // it too: a serializer that is safe and a renderer that is not is still an injection.
      const rendered = appendComment('SELECT 1', { route: value });
      expect(rendered.indexOf('*/')).toBe(rendered.length - 2);
      expect(rendered.startsWith('SELECT 1 /*')).toBe(true);
    }

    // `*` alone is unreserved and must survive untouched — the assertion that the encoding is
    // `encodeURIComponent` and not a blocklist.
    expect(serializeComment({ route: '*' })).toBe("route='*'");
    expect(serializeComment({ route: 'a\nb' })).toBe("route='a%0Ab'");
    expect(serializeComment({ route: '\u2028' })).toBe("route='%E2%80%A8'");
    expect(serializeComment({ route: '\u2029' })).toBe("route='%E2%80%A9'");
    expect(serializeComment({ route: '\r\n' })).toBe("route='%0D%0A'");
  });

  // §7.2. The assertion `sql-comments.md`'s serializer fails: `encodeURIComponent("o'brien")`
  // is `"o'brien"` — the apostrophe is unreserved and survives — so a value containing one
  // closes its own quote and the remainder of the tag stops being a quoted value.
  it('escapes an apostrophe as a backslash apostrophe', () => {
    expect(encodeURIComponent("o'brien")).toBe("o'brien"); // the premise, not the assertion
    expect(serializeComment({ controller: "o'brien" })).toBe("controller='o\\'brien'");

    // No unescaped `'` anywhere inside a value, for a value with several of them. Removing
    // every escaped apostrophe first leaves only the delimiters, so the count is exactly two
    // per pair — four here — and an unescaped one in a value would push it higher.
    const out = serializeComment({ controller: "'a'b'", action: "''" });
    expect(out).toBe("action='\\'\\'',controller='\\'a\\'b\\''");
    expect(out.replace(/\\'/g, '').match(/'/g)).toHaveLength(4);
  });

  // §7.3: the output's only `\` is the apostrophe escaper's own, verified by a value that is
  // a single backslash becoming `%5C`. This is what makes the tag unambiguous to a human
  // reading it back out of `pg_stat_statements`, and it is why §3 encodes before escaping
  // rather than after.
  it('leaves the escaper as the only backslash in a serialized value', () => {
    expect(serializeComment({ controller: '\\' })).toBe("controller='%5C'");
    expect(serializeComment({ controller: '\\\\' })).toBe("controller='%5C%5C'");
    expect(serializeComment({ controller: "\\'" })).toBe("controller='%5C\\''");

    // One backslash in, one out, and it is not the one that went in.
    const noApostrophes = serializeComment({ route: 'a\\b\\c' });
    expect(noApostrophes.match(/\\/g)).toBeNull();

    const spec = serializeComment({
      route: '/users/:id',
      controller: "o'brien*/DROP",
      action: 'list',
      traceparent: '00-abc-def-01',
    });
    expect(spec.match(/\\/g)).toHaveLength(1);
  });

  // §7.4. Sorted keys are what make the statement text stable enough to be one
  // `pg_stat_statements` entry instead of one per key ordering (§2), so this is a cardinality
  // assertion wearing a formatting assertion's clothes.
  it('produces an identical string whatever order the pairs were inserted in', () => {
    const forward = serializeComment({ action: 'get', controller: 'C', route: '/x', traceparent: '00-a-b-01' });
    const reverse = serializeComment({ traceparent: '00-a-b-01', route: '/x', controller: 'C', action: 'get' });
    const shuffled = serializeComment({ route: '/x', action: 'get', traceparent: '00-a-b-01', controller: 'C' });

    expect(forward).toBe(reverse);
    expect(forward).toBe(shuffled);
    expect(forward).toBe("action='get',controller='C',route='%2Fx',traceparent='00-a-b-01'");
  });

  // §7.5 says there is no runtime assertion for an arbitrary key "because there is no way to
  // pass one", and the compile-time half is in ./comments.type-test.ts. #580's issue body
  // nevertheless asks for a runtime one "including an inherited-property key", so this is the
  // runtime shadow that does exist: a key inherited from a prototype is not enumerated by
  // `Object.keys`, so §3's serializer cannot emit it even if a caller launders one in through
  // `Object.create`. That is #364's shape — repository issue #364 is the inherited-key
  // problem in this codebase — and it is worth an assertion because the obvious "fix" for a
  // future reviewer is `for (const k in pairs)`, which would emit it.
  it('refuses a key that is not in the closed set', () => {
    const hostileProto = { route: '/evil', traceparent: '00-forged-forged-01' };
    const laundered = Object.create(hostileProto) as Record<string, string>;
    laundered.action = 'list';

    expect('route' in laundered).toBe(true); // the premise: the key is reachable
    expect(serializeComment(laundered as CommentPairs)).toBe("action='list'");
    expect(appendComment('SELECT 1', laundered as CommentPairs)).not.toContain('evil');
  });

  // §7.6 and §4. Trailing for the three reasons §4 lists, and the one that bites hardest is
  // the third: a leading comment makes `/^\s*(\w+)/` return nothing, so a downstream parser
  // can silently relabel every database metric in the application to `other`.
  //
  // The regex is reproduced here rather than imported because it is the *docs page's* code,
  // not this package's, and the point of the assertion is that our placement keeps somebody
  // else's parser working.
  it('emits the comment trailing, so the first token is unchanged', () => {
    const query = selectUsers();
    const tagged = appendComment(query.text, FULL_PAIRS);
    const firstToken = (sql: string) => (/^\s*(\w+)/.exec(sql)?.[1] ?? 'other').toUpperCase();

    expect(tagged.startsWith('SELECT "id", "email" FROM "users" WHERE "id" = $1')).toBe(true);
    expect(tagged.endsWith('*/')).toBe(true);
    expect(firstToken(tagged)).toBe('SELECT');
    expect(firstToken(tagged)).toBe(firstToken(query.text));

    // The leading form is what §4 rejects, spelled out so the reason is in the suite and not
    // only in the spec: this is the value the docs page's regex returns for it.
    expect(firstToken(`/*${serializeComment(FULL_PAIRS)}*/ ${query.text}`)).toBe('OTHER');

    // Exactly one comment, and it is the last thing in the statement.
    expect(tagged.match(/\/\*/g)).toHaveLength(1);
    expect(tagged.indexOf('/*')).toBe(query.text.length + 1);
  });

  // §7.7. The assertion that §6's "rendered, not stored" is true. If the decorator mutated
  // the compiled query — or if `CompiledQuery` grew a `comment` field — a per-request value
  // would have been written into a per-route cached object, which works until the cache is
  // enabled.
  it('leaves the compiled query deep-equal to its untagged self after a tagged execute', async () => {
    const query = selectUsers();
    const before = { ...query };
    const driver = recordingDriver();
    const tagged = withComments(driver, () => FULL_PAIRS);

    await tagged.execute(query);

    expect(query).toEqual(before);
    expect(Object.keys(query)).toEqual(['text', 'parameters', 'operation', 'isWrite', 'returnsRows']);
    expect(query.text).toBe('SELECT "id", "email" FROM "users" WHERE "id" = $1');
    // §6's smaller point: a decorator spreads the driver it wraps, so `dialect` survives.
    // The original docs sketch returned `{ execute }` and dropped the field `Driver`
    // declares and the repository reads to pick its dialect.
    expect(tagged.dialect).toBe(postgresDialect);
    // And the statement the driver actually saw was the tagged one, or nothing was tested.
    expect(driver.seen).toHaveLength(1);
    expect(driver.seen[0]).toContain('/*');
  });

  it('forwards execute options and preserves a wrapped stream capability', async () => {
    const query = selectUsers();
    const signal = new AbortController().signal;
    const options = { signal, batchSize: 17 };
    let observed: { readonly signal?: AbortSignal; readonly batchSize?: number } | undefined;
    const stream = () => ({
      async *[Symbol.asyncIterator]() {
        yield { id: 1 };
      },
    });
    const tagged = withComments(
      {
        execute(_query, executeOptions) {
          observed = executeOptions;
          return Promise.resolve([]);
        },
        stream,
      },
      () => FULL_PAIRS,
    );

    await tagged.execute(query, options);

    expect(observed).toBe(options);
    expect(tagged.stream).toBe(stream);
  });

  // §7.8: the property that makes reuse safe. One compiled query, two traceparents, two
  // statement texts — which is also §5's stated trade, because it is exactly why
  // `traceparent` costs the plan cache.
  it('produces two statement texts for one compiled query under two traceparents', async () => {
    const query = selectUsers();
    const driver = recordingDriver();
    let traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const tagged = withComments(driver, () => ({ ...FULL_PAIRS, traceparent }));

    await tagged.execute(query);
    traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    await tagged.execute(query);

    expect(driver.seen).toHaveLength(2);
    expect(driver.seen[0]).not.toBe(driver.seen[1]);
    expect(driver.seen[0]).toContain("traceparent='00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'");
    expect(driver.seen[1]).toContain("traceparent='00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'");
    // The four low-cardinality keys are identical across both, so the only thing that varied
    // is the one §5 names as the trade.
    const stripTraceparent = (sql: string) => sql.replace(/,?traceparent='[^']*'/, '');
    expect(stripTraceparent(driver.seen[0] ?? '')).toBe(stripTraceparent(driver.seen[1] ?? ''));
  });

  // §3's closing argument: keys go through `encode` too, so that "a sixth key added later by
  // somebody who has not read this section is still safe". The five current keys contain
  // nothing that needs encoding, so the only way to assert the property is to serialize a key
  // that does — which the type forbids at a call site and a cast permits here. This is the
  // runtime counterpart to ./comments.type-test.ts's note that the type's guarantee is
  // "no accidental key" rather than "no path".
  it('encodes the key as well as the value', () => {
    const laundered = { "a'*/b": 'x' } as unknown as CommentPairs;
    const out = serializeComment(laundered);

    expect(out).not.toContain('*/');
    expect(out).toBe("a\\'*%2Fb='x'");
  });
});
