class SubjectNode {
  readonly literals = new Map<string, SubjectNode>();
  one: SubjectNode | undefined;
  tail = false;
  terminal = false;
}

function tokens(value: string, description: string): readonly string[] {
  const parts = value.split('.');
  if (parts.length === 0 || parts.some(part => part.length === 0)) {
    throw new RangeError(`@zmdb/web: ${description} must contain non-empty dot-separated tokens`);
  }
  return parts;
}

function add(root: SubjectNode, pattern: string): void {
  const parts = tokens(pattern, 'a NATS subscription');
  let node = root;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === '>') {
      if (index !== parts.length - 1) {
        throw new RangeError('@zmdb/web: a NATS > wildcard must be the final token');
      }
      node.tail = true;
      return;
    }
    if (part === '*') {
      node.one ??= new SubjectNode();
      node = node.one;
      continue;
    }
    if (part?.includes('*') || part?.includes('>')) {
      throw new RangeError('@zmdb/web: NATS wildcards must occupy a whole token');
    }
    let child = node.literals.get(part ?? '');
    if (child === undefined) {
      child = new SubjectNode();
      node.literals.set(part ?? '', child);
    }
    node = child;
  }
  node.terminal = true;
}

export interface NatsSubjectMatcher {
  matches(subject: string): boolean;
}

/**
 * Compile NATS `*`/`>` subscriptions into a trie. Matching walks subject
 * tokens and active trie nodes; it never iterates the configured patterns.
 */
export function createNatsSubjectMatcher(patterns: readonly string[]): NatsSubjectMatcher {
  const root = new SubjectNode();
  for (const pattern of patterns) {
    add(root, pattern);
  }
  return {
    matches(subject): boolean {
      const parts = tokens(subject, 'a NATS subject');
      let active = new Set<SubjectNode>([root]);
      for (const part of parts) {
        const next = new Set<SubjectNode>();
        for (const node of active) {
          if (node.tail) {
            return true;
          }
          const literal = node.literals.get(part);
          if (literal !== undefined) {
            next.add(literal);
          }
          if (node.one !== undefined) {
            next.add(node.one);
          }
        }
        active = next;
        if (active.size === 0) {
          return false;
        }
      }
      for (const node of active) {
        if (node.terminal) {
          return true;
        }
      }
      return false;
    },
  };
}
