import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Container, createToken } from '@zmdb/web/di';
import { createTestApp } from '@zmdb/web/testing';
import { describe, expect, it } from 'vitest';

// `zmdb modules`, `zmdb repl`, and the barriers around them. Tests freeze for the epic "The module
// graph as a first-class object" (#598 / spec freeze #599); the frozen text is `./SPEC.md`'s
// `## Amendments (the module inspector and the REPL, #599)` §R7, plus §12 for where the bin lives.
//
// **The problem this file has, stated up front.** §R7 lists fourteen assertions and twelve of them
// are behavioural claims about two CLI verbs. There is no CLI. `./` contains `SPEC.md` and nothing
// else — no `bin.ts`, no `index.ts`; `../../package.json` has no `bin` field and no `./cli` export;
// `zmdb#./cli` is not in `BUILD_TIME_ENTRIES`. Writing §R7.1 through §R7.12 as twelve `it.fails`
// against a command that cannot be spawned produces twelve tests that all fail with
// `ERR_MODULE_NOT_FOUND` on the same path, which is the exact failure the convention this freeze
// follows exists to avoid: "a red test is only worth having if its failure is diagnostic", and
// twelve identical module-resolution errors say nothing about which of the twelve claims is unmet.
//
// So the file is shaped around what can be made diagnostic today:
//
// - **Four manifest facts, one red each** (§12, §R5.2). Each is a single value in a single file that
//   can be read now and is false now, and each names the value it found.
// - **Two exit-code tables, one red each** (§R7.4, §R7.5, §R7.6, §R7.7). These spawn the real bin at
//   the frozen path and compare the whole table of invocation-to-exit-code in one assertion, so the
//   failure diff shows every row at once instead of arriving one identical error at a time. They
//   call the real entry point the moment it exists, and they retire as a unit.
// - **One red over `tests/api-coverage/mapping.mjs`** (§R7.14), which is a fact about a file that
//   exists, so it is the one §R7 item that is fully assertable today.
// - **Two greens over the real `@zmdb/web`**, pinning the two facts the frozen design rests on:
//   `TestApp` has no `container` (§R4's reason for `createApp`), and two tokens sharing a description
//   are distinct in the container (§R6's reason `get('db')` must refuse rather than pick, and §5's
//   reason `duplicate-token-description` is a finding at all).
//
// **What is not here, and why.** §R7.1, §R7.2, §R7.3, §R7.8, §R7.9's session half, §R7.10, §R7.11
// and §R7.12 are behavioural claims about a session object and a command's stdout. Each of them
// needs `describeGraph` (§10 of `../../../web/src/devtools/SPEC.md`, also unwritten) *and* an
// evaluate function whose name §R6 does not freeze — the scope table names `get`, `tokens`,
// `describe`, `request` and `load` as prompt bindings, not as exports. A test cannot call an unnamed
// function, and inventing a name here would freeze by accident something the spec left open. They
// belong to the implementation slice, and they are listed in this comment rather than only in a
// commit message so that the slice's author has the debt in front of them.
//
// Every recorded actual below came from running the command or reading the file, not from
// reasoning about it.

const ROOT = process.cwd();
const CLI_DIR = join(ROOT, 'packages', 'zmdb', 'src', 'cli');
const BIN = join(CLI_DIR, 'bin.ts');

/** The fixture root `zmdb modules` is pointed at, in §R2's `path#export` form. */
const WIDE_APP = 'packages/web/src/modules/__fixtures__/large-graph.ts#WideAppModule';

/**
 * `zmdb <argv>`, run the way `yarn verify:fixtures` runs the codegen bin.
 *
 * `--import ./scripts/ts-specifier-hook.mjs` is not optional and is not a test-only convenience:
 * the sources name their siblings as `./x.js` and Node will not map that to `./x.ts` on its own, so
 * the hook is how the existing `packages/aot-validator/src/cli/bin.ts` is invoked from the root
 * manifest today. Running the bin any other way would be testing an invocation nobody uses.
 *
 * `input: ''` closes stdin, which matters for the `repl` rows: an inherited stdin is a TTY under an
 * interactive shell and not one under CI, so the barrier §R5.3 freezes would be asserted differently
 * depending on where the suite ran. A pipe is a pipe everywhere, and it is also the specific case
 * §R5.3 is about — "it also refuses the specific attack the rule exists for — piping a socket into
 * stdin".
 */
function zmdb(...argv: readonly string[]): { readonly status: number | null; readonly stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--import', join(ROOT, 'scripts', 'ts-specifier-hook.mjs'), BIN, ...argv],
    { cwd: ROOT, encoding: 'utf8', input: '', timeout: 30_000 },
  );
  return { status: result.status, stderr: result.stderr ?? '' };
}

/** `argv -> exit code`, or `argv -> ERR:<code>` when the bin could not be run at all. */
function exitRow(...argv: readonly string[]): string {
  const { status, stderr } = zmdb(...argv);
  if (!existsSync(BIN)) {
    // Named rather than swallowed: the row says *why* there is no exit code, so the assertion diff
    // reads as one missing bin rather than as four wrong exit codes.
    const reason = /ERR_[A-Z_]+/.exec(stderr)?.[0] ?? 'no bin';
    return `${argv.join(' ')} -> ERR:${reason}`;
  }
  return `${argv.join(' ')} -> ${String(status)}`;
}

describe('the zmdb CLI boundary', () => {
  // §12: the bin. Red. Asserted on the manifest rather than by running `--help`, because the value in
  // the manifest is what `npx zmdb` resolves and a bin that exists at an unlisted path is not one.
  it.fails('declares the zmdb bin at ./src/cli/bin.ts', () => {
    // Today: `undefined`. `packages/zmdb/package.json` has no `bin` field at all — ten `exports`
    // subpaths, `files: ["src", "README.md", "LICENSE"]`, and no executable.
    const manifest: unknown = JSON.parse(readFileSync(join(ROOT, 'packages', 'zmdb', 'package.json'), 'utf8'));
    const record: { bin?: Record<string, unknown> } = Object(manifest);
    expect(record.bin?.['zmdb']).toBe('./src/cli/bin.ts');
  });

  // §12: the export. Red, and separate from the bin because they fail independently — the bin is what
  // a user types and the export is what `BUILD_TIME_ENTRIES` and the test suite import.
  it.fails('publishes ./cli as a zmdb subpath', () => {
    // Today: `undefined`. The ten subpaths end at `./unplugin`.
    const manifest: unknown = JSON.parse(readFileSync(join(ROOT, 'packages', 'zmdb', 'package.json'), 'utf8'));
    const record: { exports?: Record<string, unknown> } = Object(manifest);
    expect(record.exports?.['./cli']).toBe('./src/cli/index.ts');
  });

  // §12 and §R5.2, and this is the barrier rather than a tidiness rule: the entry has to be
  // *build-time only* or a server bundle contains the REPL. Red.
  //
  // Asserted against the source text of the gate and not by running it, deliberately. The set is a
  // literal in `.github/scripts/verify-exports.mjs`, the gate exits non-zero for a dozen unrelated
  // reasons, and what §12 freezes is membership of that list — "beside the `zmdb#./unplugin` entry
  // that is already there", which is the entry this assertion also proves is still present.
  it.fails('lists zmdb#./cli in BUILD_TIME_ENTRIES', () => {
    // Today: `['zmdb#./unplugin']`. The set has eight entries, seven of them `@zmdb/aot-validator#*`.
    const gate = readFileSync(join(ROOT, '.github', 'scripts', 'verify-exports.mjs'), 'utf8');
    const listed = ['zmdb#./cli', 'zmdb#./unplugin'].filter(entry => gate.includes(`'${entry}'`));
    expect(listed).toEqual(['zmdb#./cli', 'zmdb#./unplugin']);
  });

  // §12's split: the work in `index.ts`, argument parsing and exit codes in `bin.ts`. Red, and one
  // assertion over both names so the failure says which of the two is missing.
  // Asserted as a filter over the two frozen names rather than as the directory listing, and the
  // reason is a trap worth recording: `readdirSync(CLI_DIR)` includes *this file*, so an equality
  // against `['SPEC.md', 'bin.ts', 'index.ts']` could never pass no matter what the slice lands. A
  // red test that cannot retire is worse than no test, because the next author deletes it.
  it.fails('ships the CLI as bin.ts and index.ts under src/cli', () => {
    // Today: `[]`. The directory holds `SPEC.md` and this spec file, verified with `readdirSync`.
    const present = ['bin.ts', 'index.ts'].filter(name => existsSync(join(CLI_DIR, name)));
    expect(present).toEqual(['bin.ts', 'index.ts']);
  });

  // §R7.6 and §R7.7 — the two `repl` barriers, as a table. Red.
  //
  // §R7.6 asks for the TTY refusal "asserted by spawning it with a piped stdin — the §R5 barrier
  // asserted as a barrier, not as documentation", so this is one of the two places in this freeze
  // where spawning a process is the assertion rather than a heavy way to reach a function. §R7.7's
  // `--json` refusal shares the table because it shares the exit code and the entry point; a
  // partial implementation shows up in the diff as the row that is wrong.
  it.fails('refuses zmdb repl without a TTY and refuses zmdb repl --json', () => {
    // Today, both rows: `-> ERR:ERR_MODULE_NOT_FOUND`. `node --import ./scripts/ts-specifier-hook.mjs
    // packages/zmdb/src/cli/bin.ts repl` exits 1 with
    // `Cannot find module '/home/.../packages/zmdb/src/cli/bin.ts'`, so the exit code carries no
    // information about the barrier and the row says so instead of reporting a 1.
    expect([exitRow('repl'), exitRow('repl', '--json')]).toEqual(['repl -> 2', 'repl --json -> 2']);
  });

  // §R7.4 and §R7.5 — `zmdb modules`'s three exit-2 cases and the one that exits 0, as a table. Red.
  //
  // The four rows are the whole of §R3's exit-2 column: colliding flags, an unresolvable module spec,
  // and `--providers` unfiltered above the threshold; plus the `--module` form that must exit 0, which
  // is what stops the threshold refusal from being implemented as a blanket refusal. The fixture is
  // the sixty-provider root the graph tests already use, so the threshold case is provoked by real
  // data rather than by a flag that says "pretend there are sixty".
  it.fails('exits 2 for colliding flags, an unresolvable spec and an unfiltered wide graph', () => {
    // Today, every row: `-> ERR:ERR_MODULE_NOT_FOUND`, for the reason recorded on the test above.
    expect([
      exitRow('modules', WIDE_APP, '--json', '--format', 'dot'),
      exitRow('modules', 'packages/web/src/modules/__fixtures__/large-graph.ts#NoSuchModule'),
      exitRow('modules', WIDE_APP, '--providers'),
      exitRow('modules', WIDE_APP, '--providers', '--module', 'WideModule'),
    ]).toEqual([
      `modules ${WIDE_APP} --json --format dot -> 2`,
      'modules packages/web/src/modules/__fixtures__/large-graph.ts#NoSuchModule -> 2',
      `modules ${WIDE_APP} --providers -> 2`,
      `modules ${WIDE_APP} --providers --module WideModule -> 0`,
    ]);
  });

  // §R7.14. Red, and the only §R7 item that is fully assertable today, because `mapping.mjs` exists.
  //
  // The four rows §R7.14 cites all resolve to `oos(NO_REPL, …)` or, for `lazy-modules/e2e/*`, to an
  // inline argument that the epic contradicts: it says "zmdb builds its modules eagerly and cheaply
  // … so there is nothing to defer", which stops being true in the slice that lands `lazy()`. The
  // assertion is that they carry a coverage title instead of an `outOfScope` argument.
  //
  // What this does *not* do is check the titles. `yarn verify:api-coverage` does that — it requires a
  // cited title to match real `it()` text — so a second copy of that check here would be a second
  // place to update. This asserts only the direction of the move, which is the part `verify` cannot
  // see: a row that stays out of scope passes that gate forever.
  // Read as text rather than imported, and the reason is a gate rather than a preference:
  // `mapping.mjs` is untyped JavaScript, `allowJs` is off in `../../tsconfig.json`'s base, and an
  // `import` of it makes `node scripts/typecheck.mjs` fail with TS2307 on this file. The four keys
  // each sit on one line immediately followed by `oos(`, verified by reading the file, so the text
  // form is exact rather than approximate.
  it.fails('covers the inspector, REPL and lazy-module rows in the api-coverage mapping', () => {
    // Today: all four are out of scope —
    // `['injector/e2e/introspection: oos', 'lazy-modules/e2e/*: oos',
    //   'inspector/e2e/graph-inspector: oos', 'repl/e2e/*: oos']`.
    const source = readFileSync(join(ROOT, 'tests', 'api-coverage', 'mapping.mjs'), 'utf8');
    const cited = ['injector/e2e/introspection', 'lazy-modules/e2e/*', 'inspector/e2e/graph-inspector', 'repl/e2e/*'];
    const state = cited.map(key => {
      const literal = key.replaceAll('*', '\\*');
      const outOfScope = new RegExp(`'${literal}':\\s*oos\\(`).test(source);
      return `${key}: ${outOfScope ? 'oos' : 'covered'}`;
    });
    expect(state).toEqual(cited.map(key => `${key}: covered`));
  });

  // Green, and it is §R4's whole argument as an assertion rather than as prose. The session is built
  // on `createApp` because `TestApp` exposes `request`, `get`, `init` and dispose and **no
  // `container`** — the single object a REPL session is most for. This test says so about the code as
  // it stands, and it goes red if someone adds `container` to `TestApp`, which is the change that
  // would reopen a design §R4 rejects. Asserted on the runtime object rather than on the interface,
  // because the interface is what a reader checks and the object is what a session would hold.
  it('exposes no container on createTestApp, which is why the session uses createApp', () => {
    // An undecorated class is a legal root: `compileModule` reads `MODULE` off
    // `Symbol.metadata`, finds nothing, and returns an empty graph — so no `@Module` and no cast is
    // needed to build the object whose keys are the claim. Verified by running it.
    class EmptyRoot {
      // A field keeps this fixture within the repository's `typescript(no-extraneous-class)` rule
      // without a local suppression.
      readonly note = 'no @Module, no providers, no controllers';
    }

    const app = createTestApp(EmptyRoot);
    expect(Object.keys(app).toSorted()).toEqual(['get', 'init', 'request']);
    expect('container' in app).toBe(false);
  });

  // Green, and it is §R6's reason `get('db')` must refuse rather than pick — which is also §5's
  // reason `duplicate-token-description` is a finding rather than a cosmetic remark. `createToken`
  // returns `{ description }` and derives no identity from it (`../../../web/src/di/index.ts`), so
  // two tokens described `'db'` are two different keys in the container holding two different values,
  // and a description-keyed lookup has no answer. §R7.9 asks the session to report the ambiguity; this
  // is the assertion that the ambiguity is real, over the real container, and it is what would go red
  // if `createToken` ever interned by description — which would make §R7.9 unassertable and §5's
  // finding meaningless.
  it('keeps two tokens with one description distinct, so a description lookup is ambiguous', () => {
    const primary = createToken<string>('db');
    const replica = createToken<string>('db');
    const container = new Container();
    container.register(primary, 'primary');
    container.register(replica, 'replica');
    expect([container.resolve(primary), container.resolve(replica)]).toEqual(['primary', 'replica']);
    expect([primary, replica].filter(token => token.description === 'db')).toHaveLength(2);
  });
});
