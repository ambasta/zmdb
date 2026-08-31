import { describe, expect, it } from 'vitest';

import { tags, transformSource, validate, ValidationError } from './index.ts';
import { getCachedRegExp, safeTestPattern, validatePatternComplexity } from './regex-complexity.ts';
import { is, validate as utilityValidate } from './utilities/index.ts';

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
      expect(() => transformSource(source)).toThrow(ValidationError);
      expect(() => transformSource(source)).toThrow(/Invalid regular expression/);
    });

    it('emits monomorphic allocation-free inline JS for safe pattern', () => {
      const source = 'const ok = validate(tags.Pattern("^[a-z]+$"), input);';
      const transformed = transformSource(source);
      expect(transformed).toBe('const ok = (typeof input === "string" && /^[a-z]+$/.test(input));');
    });
  });

  describe('Fallback Execution Safeguards', () => {
    it('evaluates safe pattern correctly in untransformed fallback mode', () => {
      const rule = tags.Pattern('^[a-z]+$');
      expect(validate(rule, 'hello')).toBe(true);
      expect(validate(rule, '12345')).toBe(false);
    });

    it('throws ValidationError when input exceeds maximum length limit', () => {
      const pattern = '^[a-z]+$';
      const longInput = 'a'.repeat(20000);
      expect(() => safeTestPattern(pattern, longInput, 10000)).toThrow(ValidationError);
      expect(() => safeTestPattern(pattern, longInput, 10000)).toThrow(/exceeds maximum limit/);
    });

    it('works safely through descriptor-based utilities', () => {
      const descriptor = { kind: 'string', pattern: '^[a-z]+$' } as const;
      expect(is('hello', descriptor)).toBe(true);
      expect(is('12345', descriptor)).toBe(false);

      const res = utilityValidate('hello', descriptor);
      expect(res.success).toBe(true);
    });
  });
});
