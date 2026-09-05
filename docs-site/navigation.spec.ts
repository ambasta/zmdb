import { describe, expect, it } from 'vitest';

import {
  CANONICAL_PAGE_ADDITIONS,
  DOCUMENTATION_BASELINE,
  LEGACY_REDIRECTS,
  PRODUCT_JOURNEY,
} from './navigation-plan.mjs';
import { NAV, PAGE_META } from './pages.mjs';

interface PageMeta {
  readonly title: string;
  readonly group?: string;
  readonly status: 'supported' | 'todo' | 'wontfix';
  readonly note?: string;
}

const liveMeta: Readonly<Record<string, PageMeta>> = PAGE_META;
const liveSlugs = NAV.flatMap(group => group.pages);
const targetSlugs = PRODUCT_JOURNEY.flatMap(group => group.pages);
const legacySlugs = Object.keys(LEGACY_REDIRECTS);
const legacySet = new Set(legacySlugs);
const additionSlugs = Object.keys(CANONICAL_PAGE_ADDITIONS);

const sorted = (values: readonly string[]): string[] => [...values].toSorted();

function occurrences(values: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

describe('the frozen documentation product journey', () => {
  // The #713 baseline measured 276 pages. #618 has since registered the
  // package-reference placeholder, so pages.mjs now has 277 pages in the same 26
  // groups. The target owns 266 canonical pages: the twelve GraphQL source slugs
  // are replaced by `graphql`, and `package-reference` is retained as the other
  // declared addition.
  it.fails('assigns every registered page to exactly one product-journey group', () => {
    const liveCounts = occurrences(liveSlugs);
    const targetCounts = occurrences(targetSlugs);
    const problems: string[] = [];

    for (const slug of targetSlugs) {
      if (targetCounts.get(slug) !== 1) problems.push(`target:${slug}:${String(targetCounts.get(slug))}`);
      if (liveCounts.get(slug) !== 1) problems.push(`live:${slug}:${String(liveCounts.get(slug))}`);
    }
    for (const slug of Object.keys(liveMeta)) {
      if (liveCounts.get(slug) !== 1) problems.push(`metadata:${slug}:${String(liveCounts.get(slug))}`);
    }
    if (sorted(Object.keys(liveMeta)).join('\n') !== sorted(targetSlugs).join('\n')) {
      problems.push('PAGE_META does not own exactly the canonical target slugs');
    }

    for (const group of PRODUCT_JOURNEY) {
      for (const slug of group.pages) {
        if (liveMeta[slug]?.group !== group.title) {
          problems.push(`${slug}: expected group "${group.title}", got "${liveMeta[slug]?.group ?? '<missing>'}"`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  // Measured today: the live titles begin "Getting Started", "Migrating to zmdb",
  // "Schema" and continue for 26 groups.
  it.fails('contains exactly ten top-level navigation groups', () => {
    expect(NAV.map(group => group.title)).toEqual(PRODUCT_JOURNEY.map(group => group.title));
    expect(NAV).toHaveLength(DOCUMENTATION_BASELINE.target.groups);
  });

  it('keeps every non-GraphQL slug stable', () => {
    const retainedLive = liveSlugs.filter(slug => !legacySet.has(slug) && !additionSlugs.includes(slug));
    const retainedTarget = targetSlugs.filter(slug => !additionSlugs.includes(slug));

    expect(sorted(retainedTarget)).toEqual(sorted(retainedLive));
    expect(retainedLive).toHaveLength(DOCUMENTATION_BASELINE.target.retainedCurrentPages);
  });

  it('freezes 266 unique canonical pages with exactly the two declared additions', () => {
    expect(targetSlugs).toHaveLength(DOCUMENTATION_BASELINE.target.canonicalPages);
    expect(new Set(targetSlugs).size).toBe(DOCUMENTATION_BASELINE.target.canonicalPages);
    expect(sorted(additionSlugs)).toEqual(['graphql', 'package-reference']);
    expect(targetSlugs.filter(slug => legacySet.has(slug))).toEqual([]);
    expect(legacySlugs).toHaveLength(DOCUMENTATION_BASELINE.target.redirectArtifacts);
    expect(new Set(legacySlugs).size).toBe(DOCUMENTATION_BASELINE.target.redirectArtifacts);
  });

  // Measured today: all 277 PAGE_META records repeat a `group` string. The target
  // derives that value from NAV so group ownership cannot drift in two places.
  it.fails('derives page group ownership from navigation instead of PAGE_META', () => {
    const duplicatedOwners = Object.entries(liveMeta)
      .filter(([, meta]) => Object.hasOwn(meta, 'group'))
      .map(([slug]) => slug);
    expect(duplicatedOwners).toEqual([]);
  });

  it('preserves retained page statuses and makes the consolidated GraphQL decision wontfix', () => {
    for (const slug of liveSlugs.filter(candidate => !legacySet.has(candidate))) {
      expect(['supported', 'todo', 'wontfix']).toContain(liveMeta[slug]?.status);
    }
    for (const slug of legacySlugs) expect(liveMeta[slug]?.status).toBe('wontfix');
    expect(CANONICAL_PAGE_ADDITIONS.graphql.status).toBe('wontfix');
    expect(CANONICAL_PAGE_ADDITIONS['package-reference'].status).toBe('supported');
  });
});
