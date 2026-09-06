import { describe, expect, it } from 'vitest';

import {
  CANONICAL_PAGE_ADDITIONS,
  DOCUMENTATION_BASELINE,
  LEGACY_REDIRECTS,
  PRODUCT_JOURNEY,
} from './navigation-plan.mjs';
import { NAV, PAGE_GROUPS, PAGE_META, derivePageGroups } from './pages.mjs';

interface PageMeta {
  readonly title: string;
  readonly status: 'supported' | 'todo' | 'wontfix';
  readonly note?: string;
}

const liveMeta: Readonly<Record<string, PageMeta>> = PAGE_META;
const liveSlugs = NAV.flatMap(group => group.pages);
const targetSlugs = PRODUCT_JOURNEY.flatMap(group => group.pages);
const legacySlugs = Object.keys(LEGACY_REDIRECTS);
const legacySet = new Set(legacySlugs);
const additionSlugs = Object.keys(CANONICAL_PAGE_ADDITIONS);
const expectedLiveJourney = PRODUCT_JOURNEY.map(group => ({
  title: group.title,
  pages: group.pages.flatMap(slug => (slug === 'graphql' ? legacySlugs : [slug])),
}));
const expectedLiveSlugs = expectedLiveJourney.flatMap(group => group.pages);

const sorted = (values: readonly string[]): string[] => [...values].toSorted();

function occurrences(values: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

describe('the frozen documentation product journey', () => {
  // #718 is closed wontfix, so the `graphql` planning position expands to the
  // twelve retained source pages. #686 adds the generated-client journey and
  // #701 adds nine framework guides, so all 287 live pages need one owner.
  it('assigns every registered page to exactly one product-journey group', () => {
    const liveCounts = occurrences(liveSlugs);
    const problems: string[] = [];

    for (const slug of expectedLiveSlugs) {
      if (liveCounts.get(slug) !== 1) problems.push(`live:${slug}:${String(liveCounts.get(slug))}`);
    }
    for (const slug of Object.keys(liveMeta)) {
      if (liveCounts.get(slug) !== 1) problems.push(`metadata:${slug}:${String(liveCounts.get(slug))}`);
    }
    if (sorted(Object.keys(liveMeta)).join('\n') !== sorted(expectedLiveSlugs).join('\n')) {
      problems.push('PAGE_META does not own exactly the live navigation slugs');
    }

    for (const group of expectedLiveJourney) {
      for (const slug of group.pages) {
        if (PAGE_GROUPS[slug] !== group.title) {
          problems.push(`${slug}: expected group "${group.title}", got "${PAGE_GROUPS[slug] ?? '<missing>'}"`);
        }
      }
    }

    expect(NAV).toEqual(expectedLiveJourney);
    expect(PAGE_GROUPS).toEqual(derivePageGroups(NAV, liveMeta));
    expect(problems).toEqual([]);
  });

  it('contains exactly ten top-level navigation groups', () => {
    expect(NAV.map(group => group.title)).toEqual(PRODUCT_JOURNEY.map(group => group.title));
    expect(NAV).toHaveLength(DOCUMENTATION_BASELINE.target.groups);
  });

  it('keeps every non-GraphQL slug stable', () => {
    const retainedLive = liveSlugs.filter(slug => !legacySet.has(slug) && !additionSlugs.includes(slug));
    const retainedTarget = targetSlugs.filter(slug => !additionSlugs.includes(slug));

    expect(sorted(retainedTarget)).toEqual(sorted(retainedLive));
    expect(retainedLive).toHaveLength(DOCUMENTATION_BASELINE.target.retainedCurrentPages);
  });

  it('freezes 276 unique canonical pages with exactly the twelve declared additions', () => {
    expect(targetSlugs).toHaveLength(DOCUMENTATION_BASELINE.target.canonicalPages);
    expect(new Set(targetSlugs).size).toBe(DOCUMENTATION_BASELINE.target.canonicalPages);
    expect(sorted(additionSlugs)).toEqual([
      'client-angular',
      'client-next',
      'client-nuxt',
      'client-react',
      'client-react-native',
      'client-solid',
      'client-svelte',
      'client-sveltekit',
      'client-vue',
      'generated-client',
      'graphql',
      'package-reference',
    ]);
    expect(targetSlugs.filter(slug => legacySet.has(slug))).toEqual([]);
    expect(legacySlugs).toHaveLength(DOCUMENTATION_BASELINE.target.redirectArtifacts);
    expect(new Set(legacySlugs).size).toBe(DOCUMENTATION_BASELINE.target.redirectArtifacts);
  });

  it('derives page group ownership from navigation instead of PAGE_META', () => {
    const duplicatedOwners = Object.entries(liveMeta)
      .filter(([, meta]) => Object.hasOwn(meta, 'group'))
      .map(([slug]) => slug);
    expect(duplicatedOwners).toEqual([]);
    expect(Object.keys(PAGE_GROUPS)).toHaveLength(Object.keys(liveMeta).length);
  });

  it('rejects duplicate, missing and orphaned slugs deterministically', () => {
    const invalidNav = [{ title: 'Start', pages: ['duplicate', 'duplicate', 'missing'] }];
    const invalidMeta = {
      duplicate: { title: 'Duplicate', status: 'supported' },
      orphan: { title: 'Orphan', status: 'supported' },
    };

    expect(() => derivePageGroups(invalidNav, invalidMeta)).toThrowError(
      [
        'docs navigation registry invalid:',
        '- duplicate slugs: duplicate',
        '- missing page metadata: missing',
        '- orphaned page metadata: orphan',
      ].join('\n'),
    );
  });

  it('preserves retained page statuses and the GraphQL wontfix decision', () => {
    for (const slug of liveSlugs.filter(candidate => !legacySet.has(candidate))) {
      expect(['supported', 'todo', 'wontfix']).toContain(liveMeta[slug]?.status);
    }
    for (const slug of legacySlugs) expect(liveMeta[slug]?.status).toBe('wontfix');
    expect(CANONICAL_PAGE_ADDITIONS['generated-client'].status).toBe('supported');
    expect(CANONICAL_PAGE_ADDITIONS.graphql.status).toBe('wontfix');
    expect(CANONICAL_PAGE_ADDITIONS['package-reference'].status).toBe('supported');
  });
});
