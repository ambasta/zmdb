import { describe, expect, it } from 'vitest';
import { tags, transformSource, validate } from './index.ts';
import { safeTestPattern, validatePatternComplexity } from './regex-complexity.ts';
import { is, validate as utilityValidate } from './utilities/index.ts';

describe('Static Regular Expression Complexity Validation', () => {
  describe('validatePatternComplexity', () => {
    it('rejects invalid regular expression syntax', () => {
      expect(() => validatePatternComplexity('[a-z')).toThrow(/Invalid regular expression/);
      expect(() => validatePatternComplexity('(abc')).toThrow(/Invalid regular expression/);
    });

    it('rejects exponential backtracking from nested quantifiers', () => {
      expect(() => validatePatternComplexity('(a+)+')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('(a*)*')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('([a-z]+)+')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('(\\w+)*')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('(a|b+)+')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('(a+b*)+')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('((a+))+')).toThrow(/catastrophic backtracking risk/);
    });

    it('rejects quantified groups that match empty strings', () => {
      expect(() => validatePatternComplexity('(a|)+')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('(a?)+')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('(a*)+')).toThrow(/catastrophic backtracking risk/);
    });

    it('rejects quantified groups with overlapping alternatives', () => {
      expect(() => validatePatternComplexity('(a|a)+')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('(\\w|\\d)+')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('([a-z]|[a-z])+')).toThrow(/catastrophic backtracking risk/);
    });

    it('rejects consecutive overlapping repetition quantifiers', () => {
      expect(() => validatePatternComplexity('a+a+')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('.*.*')).toThrow(/catastrophic backtracking risk/);
      expect(() => validatePatternComplexity('\\d+\\d+')).toThrow(/catastrophic backtracking risk/);
    });

    it('accepts safe regular expressions', () => {
      expect(() => validatePatternComplexity('^[a-zA-Z0-9]+$')).not.toThrow();
      expect(() => validatePatternComplexity('^\\d{3}-\\d{2}-\\d{4}$')).not.toThrow();
      expect(() => validatePatternComplexity('^[^@]+@[^@]+\\.[^@]+$')).not.toThrow();
      expect(() => validatePatternComplexity('^(red|green|blue)$')).not.toThrow();
      expect(() => validatePatternComplexity('^[a-z0-9_-]{3,16}$')).not.toThrow();
      expect(() => validatePatternComplexity('\\d+')).not.toThrow();
    });
  });

  describe('Rule Instantiation Safety', () => {
    it('rejects unsafe pattern during tags.Pattern rule creation', () => {
      expect(() => tags.Pattern('(a+)+')).toThrow(/catastrophic backtracking risk/);
      expect(() => tags.Pattern('([a-z]+)+')).toThrow(/catastrophic backtracking risk/);
    });

    it('creates rule for safe pattern during tags.Pattern', () => {
      const rule = tags.Pattern('^[a-z]+$');
      expect(rule.kind).toBe('Pattern');
      expect(rule.args[0]).toBe('^[a-z]+$');
    });
  });

  describe('AOT Code Transformer Safety', () => {
    it('fails transformation with descriptive error on unsafe pattern', () => {
      const source = 'const ok = validate(tags.Pattern("(a+)+"), input);';
      expect(() => transformSource(source)).toThrow(/catastrophic backtracking risk/);
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

    it('prevents event-loop blocking by enforcing maximum input length bounds', () => {
      const pattern = '^[a-z]+$';
      const longInput = 'a'.repeat(20000);
      expect(safeTestPattern(pattern, longInput, 10000)).toBe(false);
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
