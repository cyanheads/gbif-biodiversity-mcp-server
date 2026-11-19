/** @fileoverview Individual tool descriptions retain rules without measured-history examples. */
import { describe, expect, it } from 'vitest';
import { gbifCountOccurrences } from '@/mcp-server/tools/definitions/gbif-count-occurrences.tool.js';
import { gbifOccurrenceFacets } from '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';
import { gbifSearchDatasets } from '@/mcp-server/tools/definitions/gbif-search-datasets.tool.js';
import { gbifSearchOccurrences } from '@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js';
import { gbifSearchPublishers } from '@/mcp-server/tools/definitions/gbif-search-publishers.tool.js';
import { gbifSearchSpecies } from '@/mcp-server/tools/definitions/gbif-search-species.tool.js';

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
      'GADM_LEVEL_0_GID',
      'GADM_LEVEL_3_GID',
      'coordinates',
      'INSTITUTION_CODE',
      'lowercased',
      'MEDIA_TYPE',
      'RECORDED_BY',
      'overlap',
    ])
      expect(description).toContain(text);
    for (const text of ['550', '60,290,950', '59,407,400', '883,550', '9 and 41', '2,263', '508'])
      expect(description).not.toContain(text);
  });
  it.each([gbifSearchOccurrences, gbifCountOccurrences, gbifOccurrenceFacets])(
    'names every #77/#78 filter in the $name description',
    (tool) => {
      for (const filter of [
        'gadmGid',
        'catalogNumber',
        'institutionCode',
        'recordedBy',
        'mediaType',
      ])
        expect(tool.description).toContain(filter);
    },
  );
  it('keeps organization roles, key casing and intersection without listing history', () => {
    for (const field of ['publishingOrg', 'hostingOrg'] as const) {
      const description = gbifSearchDatasets.input.shape[field].description ?? '';
      for (const text of ['lowercase', 'case-sensitiv', 'published', 'serves', 'intersected'])
        expect(description).toContain(text);
      for (const text of ['984', 'first 25', 'Butterfly Conservation', '13 publish'])
        expect(description).not.toContain(text);
    }
  });
  /**
   * #100 — the strict `/species/match` the scope filters call ignores letter case
   * ("animalia", "pARidae", and "QUERCUS" each resolve), so no scope surface may state a
   * capitalization rule. A misspelling, a wrong rank, and a name several kingdoms share
   * still fail, and stay in the error contract.
   */
  it('states no capitalization rule on the gbif_search_species scope surfaces', () => {
    const unresolved = gbifSearchSpecies.errors?.find((e) => e.reason === 'unresolved_taxon_scope');
    const scopeFields = (['kingdom', 'family', 'genus'] as const).map(
      (field) => gbifSearchSpecies.input.shape[field].description ?? '',
    );
    const recovery = unresolved?.recovery ?? '';
    const when = unresolved?.when ?? '';
    for (const text of [gbifSearchSpecies.description, ...scopeFields, when, recovery]) {
      expect(text).not.toMatch(/capitaliz/i);
      expect(text).not.toMatch(/lowercase/i);
      expect(text).not.toMatch(/"(animalia|paridae)"/);
    }
    for (const text of [gbifSearchSpecies.description, ...scopeFields, recovery])
      expect(text).toContain('letter case');
    for (const text of ['misspelling', 'wrong rank', 'shared across kingdoms'])
      expect(when).toContain(text);
  });
  /**
   * #100 — `/organization` parses alpha-2 and alpha-3 codes and GBIF's own enum name for
   * a country ("Sweden", "United Kingdom", "UNITED_KINGDOM"), and answers HTTP 400 to any
   * other name ("Britain", "UK") or a numeric code, so the recovery cannot reject country
   * names wholesale.
   */
  it('keeps the gbif_search_publishers country recovery true of what /organization parses', () => {
    const recovery =
      gbifSearchPublishers.errors?.find((e) => e.reason === 'invalid_filter')?.recovery ?? '';
    expect(recovery).not.toMatch(/country name is not accepted/i);
    for (const text of ['alpha-2', 'alpha-3', 'UNITED_KINGDOM', 'Britain'])
      expect(recovery).toContain(text);
  });
});
