// Static regular expression complexity validator and safe fallback evaluator.
// Maintains zero external dependencies and prevents ReDoS vulnerabilities.

export type Quantifier = {
  min: number;
  max: number; // Infinity for unbounded
  raw: string;
};

export type RegexNode =
  | { type: 'literal'; char: string; quantifier?: Quantifier }
  | { type: 'charClass'; raw: string; quantifier?: Quantifier }
  | { type: 'dot'; quantifier?: Quantifier }
  | { type: 'anchor'; char: string; quantifier?: Quantifier }
  | { type: 'group'; alternatives: RegexNode[][]; quantifier?: Quantifier; nonCapturing?: boolean };

function parseQuantifierAt(pattern: string, pos: number): { quant: Quantifier; nextPos: number } | null {
  if (pos >= pattern.length) return null;
  const ch = pattern[pos]!;

  let quant: Quantifier | null = null;
  let nextPos = pos;

  if (ch === '*') {
    quant = { min: 0, max: Infinity, raw: '*' };
    nextPos = pos + 1;
  } else if (ch === '+') {
    quant = { min: 1, max: Infinity, raw: '+' };
    nextPos = pos + 1;
  } else if (ch === '?') {
    quant = { min: 0, max: 1, raw: '?' };
    nextPos = pos + 1;
  } else if (ch === '{') {
    const sub = pattern.slice(pos);
    const m = /^\{(\d+)(?:,(\d*))?\}/.exec(sub);
    if (m) {
      const min = parseInt(m[1]!, 10);
      const max = m[2] === undefined ? min : m[2] === '' ? Infinity : parseInt(m[2]!, 10);
      quant = { min, max, raw: m[0] };
      nextPos = pos + m[0].length;
    }
  }

  if (quant) {
    if (nextPos < pattern.length && pattern[nextPos] === '?') {
      quant.raw += '?';
      nextPos++;
    }
    return { quant, nextPos };
  }

  return null;
}

export function parseRegex(pattern: string): RegexNode[] {
  let i = 0;

  function parseGroupBody(): RegexNode[][] {
    const alternatives: RegexNode[][] = [];
    let currentAlt: RegexNode[] = [];
    alternatives.push(currentAlt);

    while (i < pattern.length) {
      const ch = pattern[i]!;

      if (ch === ')') {
        break;
      }

      if (ch === '|') {
        i++;
        currentAlt = [];
        alternatives.push(currentAlt);
        continue;
      }

      let node: RegexNode;

      if (ch === '\\') {
        i++;
        if (i >= pattern.length) throw new SyntaxError('Unterminated escape sequence');
        const esc = pattern[i]!;
        i++;
        if (['d', 'D', 'w', 'W', 's', 'S'].includes(esc)) {
          node = { type: 'charClass', raw: '\\' + esc };
        } else if (['b', 'B'].includes(esc)) {
          node = { type: 'anchor', char: '\\' + esc };
        } else {
          node = { type: 'literal', char: esc };
        }
      } else if (ch === '[') {
        const start = i;
        i++;
        if (i < pattern.length && (pattern[i] === ']' || pattern[i] === '^')) {
          i++;
          if (pattern[i - 1] === '^' && i < pattern.length && pattern[i] === ']') {
            i++;
          }
        }
        while (i < pattern.length && pattern[i] !== ']') {
          if (pattern[i] === '\\') {
            i += 2;
          } else {
            i++;
          }
        }
        if (i >= pattern.length) throw new SyntaxError('Unterminated character class');
        i++; // skip ']'
        node = { type: 'charClass', raw: pattern.slice(start, i) };
      } else if (ch === '(') {
        i++;
        let nonCapturing = false;
        if (pattern.startsWith('?:', i)) {
          nonCapturing = true;
          i += 2;
        } else if (pattern.startsWith('?=', i) || pattern.startsWith('?!', i) || pattern.startsWith('?<=', i) || pattern.startsWith('?<!', i)) {
          const m = pattern.slice(i).match(/^\?(?:<=|<!|=|\!)/);
          if (m) i += m[0].length;
        }

        const groupAlts = parseGroupBody();
        if (i >= pattern.length || pattern[i] !== ')') {
          throw new SyntaxError('Unterminated group');
        }
        i++; // skip ')'
        node = { type: 'group', alternatives: groupAlts, nonCapturing };
      } else if (ch === '.') {
        i++;
        node = { type: 'dot' };
      } else if (ch === '^' || ch === '$') {
        i++;
        node = { type: 'anchor', char: ch };
      } else {
        i++;
        node = { type: 'literal', char: ch };
      }

      // Check quantifier
      const parsedQuant = parseQuantifierAt(pattern, i);
      if (parsedQuant) {
        node.quantifier = parsedQuant.quant;
        i = parsedQuant.nextPos;
      }

      currentAlt.push(node);
    }

    return alternatives;
  }

  const alts = parseGroupBody();
  if (alts.length === 1) {
    return alts[0]!;
  }
  return [{ type: 'group', alternatives: alts }];
}

function isRepetitionQuantifier(q?: Quantifier): boolean {
  if (!q) return false;
  return q.max > 1 || q.max === Infinity;
}

function isAnyQuantifier(q?: Quantifier): boolean {
  return q !== undefined;
}

function hasQuantifiedDescendant(node: RegexNode): boolean {
  if (node.type === 'group') {
    for (const alt of node.alternatives) {
      for (const child of alt) {
        if (isAnyQuantifier(child.quantifier) || hasQuantifiedDescendant(child)) {
          return true;
        }
      }
    }
  }
  return false;
}

function canAltMatchEmpty(alt: RegexNode[]): boolean {
  for (const node of alt) {
    if (node.type === 'anchor') continue;
    if (node.quantifier && node.quantifier.min === 0) continue;
    if (node.type === 'group' && node.alternatives.some(canAltMatchEmpty)) continue;
    return false;
  }
  return true;
}

function getFirstCharSet(node: RegexNode): Set<string> | 'dot' {
  if (node.type === 'dot') return 'dot';
  if (node.type === 'literal') return new Set([node.char]);
  if (node.type === 'charClass') {
    if (node.raw === '\\d') return new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    if (node.raw === '\\w') return new Set(['a', 'b', 'c', '0', '1', '_', 'A', 'B']);
    if (node.raw === '\\s') return new Set([' ', '\t', '\n']);
    return 'dot';
  }
  if (node.type === 'group') {
    const s = new Set<string>();
    for (const alt of node.alternatives) {
      if (alt.length > 0) {
        const cs = getFirstCharSet(alt[0]!);
        if (cs === 'dot') return 'dot';
        for (const v of cs) s.add(v);
      }
    }
    return s;
  }
  return 'dot';
}

function canOverlap(n1: RegexNode, n2: RegexNode): boolean {
  const cs1 = getFirstCharSet(n1);
  const cs2 = getFirstCharSet(n2);
  if (cs1 === 'dot' || cs2 === 'dot') return true;
  for (const v of cs1) {
    if (cs2.has(v)) return true;
  }
  return false;
}

function checkASTComplexity(nodes: RegexNode[]): void {
  for (let idx = 0; idx < nodes.length; idx++) {
    const node = nodes[idx]!;

    if (node.type === 'group') {
      const isGroupRepetition = isRepetitionQuantifier(node.quantifier);

      if (isGroupRepetition) {
        // Rule 1: Nested Quantifiers inside a quantified group
        if (hasQuantifiedDescendant(node)) {
          throw new Error('Unsafe regular expression pattern: contains catastrophic backtracking risk (nested quantifiers in group)');
        }

        // Rule 2: Quantified group can match empty string
        if (node.alternatives.some(canAltMatchEmpty)) {
          throw new Error('Unsafe regular expression pattern: contains catastrophic backtracking risk (quantified group matches empty string)');
        }

        // Rule 3: Overlapping alternatives in quantified group
        if (node.alternatives.length > 1) {
          for (let a = 0; a < node.alternatives.length; a++) {
            for (let b = a + 1; b < node.alternatives.length; b++) {
              const altA = node.alternatives[a]!;
              const altB = node.alternatives[b]!;
              if (altA.length > 0 && altB.length > 0 && canOverlap(altA[0]!, altB[0]!)) {
                throw new Error('Unsafe regular expression pattern: contains catastrophic backtracking risk (overlapping alternatives in quantified group)');
              }
            }
          }
        }
      }

      for (const alt of node.alternatives) {
        checkASTComplexity(alt);
      }
    }

    // Rule 4: Consecutive overlapping repetition quantifiers
    if (idx < nodes.length - 1) {
      const nextNode = nodes[idx + 1]!;
      if (isRepetitionQuantifier(node.quantifier) && isRepetitionQuantifier(nextNode.quantifier)) {
        if (canOverlap(node, nextNode)) {
          throw new Error('Unsafe regular expression pattern: contains catastrophic backtracking risk (consecutive overlapping repetition quantifiers)');
        }
      }
    }
  }
}

export function validatePatternComplexity(pattern: string): void {
  try {
    new RegExp(pattern);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regular expression pattern: ${msg}`);
  }

  const nodes = parseRegex(pattern);
  checkASTComplexity(nodes);
}

const MAX_FALLBACK_INPUT_LENGTH = 10000;
const patternCache = new Map<string, RegExp>();

export function getCachedRegExp(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    validatePatternComplexity(pattern);
    re = new RegExp(pattern);
    patternCache.set(pattern, re);
  }
  return re;
}

export function safeTestPattern(
  pattern: string,
  input: string,
  maxInputLength = MAX_FALLBACK_INPUT_LENGTH,
): boolean {
  if (input.length > maxInputLength) {
    return false;
  }
  const re = getCachedRegExp(pattern);
  return re.test(input);
}
