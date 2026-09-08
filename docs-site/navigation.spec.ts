import { describe, expect, it } from 'vitest';

import { derivePageGroups } from './pages.mjs';

describe('navigation page groups', () => {
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
});
