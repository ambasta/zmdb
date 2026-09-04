function singularizeWord(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();

  if (
    lower.endsWith('ss') ||
    lower.endsWith('us') ||
    lower.endsWith('is') ||
    lower.endsWith('as') ||
    lower.endsWith('os') ||
    lower === 'series' ||
    lower === 'species' ||
    lower === 'news' ||
    lower === 'lens'
  ) {
    return word;
  }

  if (lower === 'people') return 'person';
  if (lower === 'children') return 'child';
  if (lower === 'men') return 'man';
  if (lower === 'women') return 'woman';
  if (lower === 'matrices') return 'matrix';
  if (lower === 'indices') return 'index';

  if (/([^aeiou])ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/lves$/i.test(word)) return `${word.slice(0, -4)}lf`;
  if (/(kn|w)ives$/i.test(word)) return `${word.slice(0, -4)}ife`;
  if (/eaves$/i.test(word)) return `${word.slice(0, -5)}eaf`;

  if (/sses$/i.test(word) || /statuses$/i.test(word) || /aliases$/i.test(word)) {
    return word.slice(0, -2);
  }
  if (/ises$/i.test(word)) return `${word.slice(0, -4)}is`;
  if (/(xes|ches|shes|zzes)$/i.test(word)) return word.slice(0, -2);
  if (/([aeiou])zes$/i.test(word)) return word.slice(0, -1);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Singularize each physical-name word through the repository's explicit rule set and
 * PascalCase the result. The physical table remains on `Table<'...'>`; this name is only
 * the generated TypeScript identifier.
 */
export function singularPascalCase(value: string): string {
  return value
    .split(/[-_]+/)
    .map(word => singularizeWord(word))
    .map(word => (word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : ''))
    .join('');
}
