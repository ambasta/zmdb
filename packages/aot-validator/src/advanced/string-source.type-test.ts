// The public constructors accept executable, typechecked function values only.
// These calls are compile-time guard rails: widening either parameter to a
// source string makes its `@ts-expect-error` unused and fails `yarn typecheck`.
import { refine, transform } from './index.js';

// @ts-expect-error — source text must not enter refine through the TypeScript surface.
refine("v.constructor.constructor('return process.env.HOME')()", 'must be safe');
// @ts-expect-error — computed prototype keys are source text too.
refine("v['__proto__']['constructor']['constructor']('return process.env.HOME')()", 'must be safe');
// @ts-expect-error — source text must not enter transform through the TypeScript surface.
transform("v.constructor.constructor('return process.pid')()");
// @ts-expect-error — a `prototype` spelling must not create a string overload.
transform("v['constructor']['prototype']['constructor']['constructor']('return process.pid')()");
