/** @fileoverview Individual tool descriptions retain rules without measured-history examples. */
import { describe, expect, it } from 'vitest';
import { gbifCountOccurrences } from '@/mcp-server/tools/definitions/gbif-count-occurrences.tool.js';
import { gbifOccurrenceFacets } from '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';
import { gbifSearchDatasets } from '@/mcp-server/tools/definitions/gbif-search-datasets.tool.js';
import { gbifSearchOccurrences } from '@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js';

describe('individual tool guidance', () => {
  it.each([gbifCountOccurrences, gbifSearchOccurrences])(
    'keeps publisher-country semantics on $name without a count story',
    (tool) => {
      const description = tool.input.shape.publishingCountry.description ?? '';
      for (const text of ['published', 'observed', 'country', 'uppercase', 'PUBLISHING_COUNTRY'])
        expect(description).toContain(text);
      for (const text of ['60,290,950', '1,548,928']) expect(description).not.toContain(text);
    },
  );
  it('keeps complete partition recovery on occurrence search itself', () => {
    const description = gbifSearchOccurrences.description;
    for (const text of [
      '100,001',
      'DATASET_KEY',
      'BASIS_OF_RECORD',
      'PUBLISHING_COUNTRY',
      'gap-free',
      'YEAR',
      'MONTH',
      'STATE_PROVINCE',
      'outside this server',
    ])
      expect(description).toContain(text);
  });
  it('keeps gap-free and lossy facet rules without measured buckets or sums', () => {
    const description = gbifOccurrenceFacets.input.shape.facet.description ?? '';
    for (const text of [
      'DATASET_KEY',
      'first cut',
      'BASIS_OF_RECORD',
      'PUBLISHING_COUNTRY',
      'gap-free',
      'YEAR',
      'MONTH',
      'STATE_PROVINCE',
      'SPECIES_KEY',
      'occurrenceStatus',
    ])
      expect(description).toContain(text);
    for (const text of ['550', '60,290,950', '59,407,400', '883,550', '9 and 41'])
      expect(description).not.toContain(text);
  });
  it('keeps organization roles, key casing and intersection without listing history', () => {
    for (const field of ['publishingOrg', 'hostingOrg'] as const) {
      const description = gbifSearchDatasets.input.shape[field].description ?? '';
      for (const text of ['lowercase', 'case-sensitiv', 'published', 'serves', 'intersected'])
        expect(description).toContain(text);
      for (const text of ['984', 'first 25', 'Butterfly Conservation', '13 publish'])
        expect(description).not.toContain(text);
    }
  });
});
