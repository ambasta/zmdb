// The bundler hook's contract, as a bundler experiences it.
//
// `emit.spec.ts` covers what the emitter writes; this covers the decisions around it — when
// the plugin declines a module, when it fails a build, what it does with a session, and
// what it does when a file changes under it. The interesting cases are all about whether
// the checker is available, so most of them run against a real temp project.

import { afterAll, describe, expect, it } from 'vitest';

import { FixtureProject } from '../emit/__testing__/project.js';
import { apiInstanceCount, ReflectSession } from '../reflect/session.js';
import { transformTypeChecks, zmdbAot, type UnpluginLike } from './index.js';

const project = FixtureProject.open({
  declarations: '  interface User { id: number & Min<1>; email: string }',
});
afterAll(() => project.close());

/** A plugin bound to the fixture project, borrowing its session. */
function plugin(options: Parameters<typeof zmdbAot>[0] = {}): UnpluginLike {
  return zmdbAot({ session: project.session, ...options });
}

/**
 * Put `source` on disk, tell the session, and hand it to the plugin.
 *
 * The write is not incidental. `transformFile` rewrites at offsets from the compiler's
 * AST, so it refuses text the compiler has not parsed; a bundler satisfies that by
 * definition, and a test has to do it on purpose.
 */
function apply(hook: UnpluginLike, source: string, name = 'module.ts'): string | undefined {
  const file = project.write(name, source);
  return hook.transform(source, file)?.code;
}

describe('module selection', () => {
  const hook = plugin();

  it.each([
    ['/x/node_modules/pkg/index.ts', 'a dependency ships built output; rewriting it is rewriting someone else'],
    ['/x/types.d.ts', 'a declaration file has nothing to execute'],
    ['/x/styles.css', 'not source'],
  ])('declines %s', (id, _why) => {
    expect(hook.transform('const ok = is<{ n: number }>(input);', id)).toBeNull();
  });

  it('returns null rather than an unchanged copy when there is nothing to do', () => {
    // Rollup reads a returned object as "this module changed", which invalidates caches
    // and costs a sourcemap for a file that came back byte-identical.
    expect(apply(hook, 'const x = 1 + 2;\n')).toBeUndefined();
  });
});

describe('without a project', () => {
  // No `tsconfig` and no session: the plugin cannot ask what a type is.
  const hook = zmdbAot();

  it('leaves `is<T>` alone instead of guessing at T', () => {
    // The f70186c6 rule as a build behaviour. The old text parser read `string[]` as
    // `string`, so a call whose type it could not resolve got a check that answers a
    // different question. Now such a call is simply not this plugin's business.
    expect(hook.transform('const ok = is<{ n: number }>(input);', '/x/a.ts')).toBeNull();
  });

  it('still inlines the tag-rule form, which spells out its own rule', () => {
    const out = hook.transform('const ok = validate(tags.Min(0), input.price);', '/x/a.ts');
    expect(out?.code).toContain('input.price >= 0');
  });

  it('is what `transformTypeChecks` does on its own', () => {
    const source = 'const ok = validate(tags.MaxLength(3), input.name);';
    expect(transformTypeChecks(source)).toBe(zmdbAot().transform(source, '/x/a.ts')?.code);
  });
});

describe('with a project', () => {
  const hook = plugin();

  it('inlines `is<T>` from the checker', () => {
    const code = apply(hook, 'const ok = is<{ n: number }>(input);\n');
    expect(code).toContain('typeof input.n === "number" && !Number.isNaN(input.n)');
    expect(code).not.toContain('is<');
  });

  it('hoists a named type into a shared helper', () => {
    const code = apply(hook, 'const a = is<User>(input);\nconst b = is<User>(input);\n');
    expect(code?.match(/function _zmdbCheckUser\d/g)).toHaveLength(1);
  });

  it('inlines `assert<T>` to a throw against the real error class', () => {
    const code = apply(hook, 'const v = assert<User>(input);\n');
    expect(code).toContain('from "@zmdb/aot-validator/errors"');
    expect(code).toContain('throw new _zmdbAssertError(');
  });

  it('inlines both forms in one pass', () => {
    const code = apply(hook, 'const a = is<User>(input);\nconst b = validate(tags.Min(0), input.price);\n');
    expect(code).toContain('_zmdbCheckUser');
    expect(code).toContain('>= 0');
  });

  it('passes emit options through', () => {
    expect(apply(plugin({ emit: { prefix: '$aot' } }), 'const a = is<User>(input);\n')).toContain('$aotCheckUser');
  });
});

describe('refusals', () => {
  it('fails the build rather than shipping a call it could not compile', () => {
    // Plan D4. The alternative is a build that succeeds and a program that throws the
    // first time the call runs, which is a much worse place to learn about it.
    expect(() => apply(plugin(), 'const a = is<Record<string, number>>(input);\n')).toThrow(
      /cannot compile 1 call site/,
    );
  });

  it('names the file, the callee and the reason', () => {
    let message = '';
    try {
      apply(plugin(), 'const a = is<Record<string, number>>(input);\n');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(project.module);
    expect(message).toContain('`is<T>`');
    expect(message).toContain('index signature');
  });

  it('hands refusals to onDiagnostic instead, when given one', () => {
    const seen: string[] = [];
    const hook = plugin({ onDiagnostic: diagnostic => seen.push(diagnostic.reason) });
    expect(() => apply(hook, 'const a = is<Record<string, number>>(input);\n')).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('index signature');
  });

  it('does not fail the build over a module that is simply not in the project', () => {
    // A positionless diagnostic is about the file, not about a call site. A module outside
    // the program has no types to read, and that is a configuration fact rather than a
    // mistake in anyone's code.
    expect(() => plugin().transform('const ok = validate(tags.Min(0), input.price);', '/elsewhere/a.ts')).not.toThrow();
  });
});

describe('the session', () => {
  it('opens exactly one compiler API for a whole build', () => {
    // REQ-TF-11. Loading the project is the expensive half of the AOT path; doing it per
    // module would make the compiled validator cost more to produce than it ever saves.
    const before = apiInstanceCount();
    const hook = zmdbAot({ project: project.tsconfig, cwd: project.directory });
    const a = project.write('one.ts', 'const ok = is<User>(input);\n');
    const b = project.write('two.ts', 'const ok = is<User>(input);\n');
    for (const file of [a, b, a]) hook.transform('const ok = is<User>(input);\n', file);
    expect(apiInstanceCount() - before).toBe(1);
    hook.buildEnd?.();
  });

  it('opens nothing at all when there is no project to open', () => {
    const before = apiInstanceCount();
    zmdbAot().transform('const x = 1;', '/x/a.ts');
    expect(apiInstanceCount() - before).toBe(0);
  });

  it('closes the session it opened', () => {
    const hook = zmdbAot({ project: project.tsconfig, cwd: project.directory });
    hook.transform('const x = 1;\n', project.write('closing.ts', 'const x = 1;\n'));
    hook.buildEnd?.();
    // A second build has to open a second API, which is how we know the first was closed
    // rather than quietly kept.
    const before = apiInstanceCount();
    hook.transform('const x = 1;\n', project.write('closing.ts', 'const x = 1;\n'));
    expect(apiInstanceCount() - before).toBe(1);
    hook.buildEnd?.();
  });

  it('leaves a borrowed session open', () => {
    const borrowed = ReflectSession.open({ project: project.tsconfig, cwd: project.directory });
    try {
      const hook = zmdbAot({ session: borrowed });
      hook.transform('const x = 1;\n', project.write('borrowed.ts', 'const x = 1;\n'));
      hook.buildEnd?.();
      // Still usable. Closing someone else's session would break the next plugin in the
      // pipeline, with no way for it to find out why.
      expect(borrowed.sourceFile(project.module)).toBeDefined();
    } finally {
      borrowed.close();
    }
  });
});

describe('watch mode', () => {
  it('refreshes the changed file rather than reloading the project', () => {
    const hook = plugin();
    const before = project.session.updates.length;
    hook.watchChange?.(project.module);
    expect(project.session.updates.slice(before)).toEqual(['refresh']);
    // One `open`, ever. Reopening per change would put a whole project load on the
    // keystroke path, which is the difference between a usable watch mode and no watch
    // mode at all.
    expect(project.session.updates.filter(update => update === 'open')).toHaveLength(1);
  });

  it('picks up the new text after a change', () => {
    const hook = plugin();
    const file = project.write('watched.ts', 'const ok = is<{ a: number }>(input);\n');
    hook.watchChange?.(file);
    expect(hook.transform('const ok = is<{ a: number }>(input);\n', file)?.code).toContain('input.a');

    project.write('watched.ts', 'const ok = is<{ b: string }>(input);\n');
    hook.watchChange?.(file);
    expect(hook.transform('const ok = is<{ b: string }>(input);\n', file)?.code).toContain('input.b');
  });

  it('recovers from a stale program by refreshing once', () => {
    // The plugin is handed text the compiler has not parsed. Rewriting at offsets from the
    // old AST would land in the middle of an identifier, so it refreshes and retries
    // instead of guessing.
    const hook = plugin();
    const file = project.write('stale.ts', 'const ok = 1;\n');
    const fresh = 'const ok = is<User>(input);\n';
    project.write('stale.ts', fresh, { refresh: false });
    expect(hook.transform(fresh, file)?.code).toContain('_zmdbCheckUser');
  });

  it('gives up after one retry rather than refreshing on every module', () => {
    // If the text still disagrees after a refresh, something else in the pipeline edited
    // the module, and no amount of re-reading the disk will reconcile that.
    const hook = plugin();
    const file = project.write('mismatch.ts', 'const ok = 1;\n');
    const before = project.session.updates.length;
    hook.transform('const ok = is<User>(/* not on disk */ input);\n', file);
    hook.transform('const ok = is<User>(/* not on disk */ input);\n', file);
    expect(project.session.updates.slice(before)).toEqual(['refresh']);
  });
});
