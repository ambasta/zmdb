import { describe, expect, it } from 'vitest';

import { getRegExp, tags, validate, ValidationError } from './index.js';
import { getCachedRegExp, validatePatternComplexity } from './regex-complexity.js';
import { transformCode } from './transformer.js';
import { is, validate as utilityValidate } from './utilities/index.js';

describe('Static Regular Expression Complexity Validation & Caching', () => {
  describe('validatePatternComplexity', () => {
    it('rejects invalid regular expression syntax with ValidationError', () => {
      expect(() => validatePatternComplexity('[a-z')).toThrow(ValidationError);
      expect(() => validatePatternComplexity('[a-z')).toThrow(/Invalid regular expression/);
      expect(() => validatePatternComplexity('(abc')).toThrow(ValidationError);
    });

    it('accepts safe and ordinary regular expressions including wildcards and alternatives', () => {
      expect(() => validatePatternComplexity('^[a-zA-Z0-9]+$')).not.toThrow();
      expect(() => validatePatternComplexity('^\\d{3}-\\d{2}-\\d{4}$')).not.toThrow();
      expect(() => validatePatternComplexity('^[^@]+@[^@]+\\.[^@]+$')).not.toThrow();
      expect(() => validatePatternComplexity('^(red|green|blue)$')).not.toThrow();
      expect(() => validatePatternComplexity('.*foo.*')).not.toThrow();
      expect(() => validatePatternComplexity('(\\w|\\d)+')).not.toThrow();
    });
  });

  describe('getCachedRegExp', () => {
    it('caches and reuses compiled RegExp instances', () => {
      const re1 = getCachedRegExp('^[a-z]+$');
      const re2 = getCachedRegExp('^[a-z]+$');
      expect(re1).toBe(re2);
    });

    it('bounds pattern cache size and evicts oldest entries using LRU', () => {
      const firstRegexp = getCachedRegExp('pattern_lru_0');
      for (let i = 1; i <= 1005; i++) {
        getCachedRegExp(`pattern_lru_${i}`);
      }
      const newFirstRegexp = getCachedRegExp('pattern_lru_0');
      expect(newFirstRegexp).not.toBe(firstRegexp);
    });
  });

  describe('Rule Instantiation Safety', () => {
    it('rejects invalid syntax during tags.Pattern rule creation', () => {
      expect(() => tags.Pattern('[a-z')).toThrow(ValidationError);
      expect(() => tags.Pattern('[a-z')).toThrow(/Invalid regular expression/);
    });

    it('creates rule for valid pattern during tags.Pattern', () => {
      const rule = tags.Pattern('^[a-z]+$');
      expect(rule.kind).toBe('Pattern');
      expect(rule.args[0]).toBe('^[a-z]+$');
    });
  });

  describe('AOT Code Transformer Safety', () => {
    it('fails transformation with descriptive error on invalid pattern syntax', () => {
      const source = 'const ok = validate(tags.Pattern("+"), input);';
      expect(() => transformCode(source)).toThrow(ValidationError);
      expect(() => transformCode(source)).toThrow(/Invalid regular expression/);
    });

    it('emits monomorphic allocation-free inline JS for safe pattern', () => {
      const source = 'const ok = validate(tags.Pattern("^[a-z]+$"), input);';
      const transformed = transformCode(source);
      expect(transformed).toBe('const ok = (typeof input === "string" && /^[a-z]+$/.test(input));');
    });
  });

  describe('Fallback Execution Safeguards', () => {
    it('evaluates safe pattern correctly in untransformed fallback mode', () => {
      const rule = tags.Pattern('^[a-z]+$');
      expect(validate(rule, 'hello')).toBe(true);
      expect(validate(rule, '12345')).toBe(false);
    });

    it('gives a long input the same answer the inlined form would', () => {
      // The old `safeTestPattern` threw over 10 000 characters. The inlined form is
      // `/^[a-z]+$/.test(x)` and cannot throw, so the two paths disagreed for exactly the
      // inputs the cap was meant to protect. The cap is gone and this is the replacement
      // contract: same input, same answer, whichever path runs.
      const rule = tags.Pattern('^[a-z]+$');
      const long = 'a'.repeat(20_000);
      const inlined = new Function(
        'input',
        `return (${transformCode('validate(tags.Pattern("^[a-z]+$"), input)')});`,
      ) as (input: unknown) => boolean;
      expect(validate(rule, long)).toBe(true);
      expect(inlined(long)).toBe(true);
      expect(validate(rule, `${long}1`)).toBe(inlined(`${long}1`));
    });

    it('works safely through the IR-walking utilities', () => {
      const witness = { kind: 'scalar', scalar: 'string', constraints: { pattern: '^[a-z]+$' } } as const;
      expect(is('hello', witness)).toBe(true);
      expect(is('12345', witness)).toBe(false);

      const res = utilityValidate('hello', witness);
      expect(res.success).toBe(true);
    });
  });

  describe('Standardized Runtime Caching & getRegExp Direct Alias', () => {
    it('shares a single cache instance between getRegExp and getCachedRegExp', () => {
      const reFromGetRegExp = getRegExp('^[0-9]+$');
      const reFromGetCachedRegExp = getCachedRegExp('^[0-9]+$');
      expect(reFromGetRegExp).toBe(reFromGetCachedRegExp);
    });

    it('enforces pattern complexity validation and throws ValidationError via getRegExp', () => {
      expect(() => getRegExp('[a-z')).toThrow(ValidationError);
      expect(() => getRegExp('[a-z')).toThrow(/Invalid regular expression/);
      expect(() => getRegExp('+')).toThrow(ValidationError);
    });

    it('preserves public API function identity and behavior', () => {
      expect(getRegExp).toBe(getCachedRegExp);
    });
  });
});
