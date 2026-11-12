/**
 * @fileoverview Tests for shared tool utilities — stripHtml formatter, the
 * over-pagination-cap guidance, and the verbatim stateProvince guidance.
 * @module tests/tools/utils.test
 */

import { describe, expect, it } from 'vitest';
import {
  backboneAcceptedName,
  escapeMarkdownText,
  exactCoordinateMatchNotice,
  fromBackboneMatch,
  fromChecklistMatch,
  gadmGidNoMatchNotice,
  matchKeyFields,
  occurrenceFilters,
  occurrenceFilterViolation,
  occurrenceNoMatchNotices,
  occurrenceScope,
  overPaginationCapNotice,
  PAGINATION_CAP,
  recordedByNoMatchNotice,
  scientificNameNoMatchNotice,
  stateProvinceNoMatchNotice,
  stripHtml,
} from '@/mcp-server/tools/utils.js';
import {
  BACKBONE_CHECKLIST_KEY,
  COL_XR_CHECKLIST_KEY,
  ESTABLISHMENT_MEANS_VALUES,
  OCCURRENCE_FILTER_KEYS,
  TYPE_STATUS_VALUES,
} from '@/services/gbif/types.js';

/**
 * #85 — a Backbone synonym's accepted taxon is named by the classification field whose
 * key equals the accepted key, and by nothing else. Fields are from live
 * /v1/species/match answers.
 */
describe('backboneAcceptedName', () => {
  it.each([
    {
      name: 'a species (Parus caeruleus)',
      match: {
        genus: 'Cyanistes',
        species: 'Cyanistes caeruleus',
        genusKey: 2487875,
        speciesKey: 2487879,
      },
      key: 2487879,
      expected: 'Cyanistes caeruleus',
    },
    {
      name: 'a family (Compositae)',
      match: { order: 'Asterales', family: 'Asteraceae', orderKey: 414, familyKey: 3065 },
      key: 3065,
      expected: 'Asteraceae',
    },
    {
      name: 'a genus (Nyctea)',
      match: { kingdom: 'Animalia', genus: 'Bubo', kingdomKey: 1, genusKey: 5959091 },
      key: 5959091,
      expected: 'Bubo',
    },
    {
      name: 'key 0, the incertae sedis kingdom',
      match: { kingdom: 'incertae sedis', kingdomKey: 0 },
      key: 0,
      expected: 'incertae sedis',
    },
    /** The species field names the parent species, not the accepted subspecies. */
    {
      name: 'no key match (Chrysanthemum leucanthemum)',
      match: {
        genus: 'Leucanthemum',
        species: 'Leucanthemum vulgare',
        genusKey: 7684028,
        speciesKey: 8848598,
      },
      key: 7222149,
      expected: undefined,
    },
    {
      name: 'no key match (Canis familiaris)',
      match: { genus: 'Canis', species: 'Canis lupus', genusKey: 5219142, speciesKey: 5219173 },
      key: 6164210,
      expected: undefined,
    },
    {
      name: 'a key-matched field GBIF sent as null',
      match: { species: null, speciesKey: 2487879 },
      key: 2487879,
      expected: undefined,
    },
    { name: 'no classification', match: {}, key: 1, expected: undefined },
  ])('reads $name', ({ match, key, expected }) => {
    expect(backboneAcceptedName(match, key)).toBe(expected);
  });
});

/** The /v1 answer as both match tools read it, every outcome shape. */
describe('fromBackboneMatch', () => {
  it.each([
    {
      raw: { matchType: 'NONE', note: 'Multiple equal matches for Oenanthe', synonym: false },
      expected: { kind: 'none', note: 'Multiple equal matches for Oenanthe' },
    },
    { raw: { matchType: 'NONE', usageKey: null, note: null }, expected: { kind: 'none' } },
    { raw: { matchType: 'EXACT' }, expected: { kind: 'none' } },
    { raw: { usageKey: 5, matchType: null }, expected: { kind: 'none' } },
  ])('reads $raw as no match', ({ raw, expected }) => {
    expect(fromBackboneMatch(raw as never)).toStrictEqual(expected);
  });

  it('reads key 0 as a match, with its rank keys', () => {
    expect(
      fromBackboneMatch({
        usageKey: 0,
        canonicalName: 'incertae sedis',
        matchType: 'EXACT',
        kingdom: 'incertae sedis',
        kingdomKey: 0,
      }),
    ).toMatchObject({
      kind: 'match',
      taxon: {
        key: { field: 'taxonKey', value: 0 },
        classification: { kingdom: 'incertae sedis' },
        classificationKeys: { kingdomKey: 0 },
      },
    });
  });

  it('resolves a synonym to its accepted key and names it, coercing null fields', () => {
    const answer = fromBackboneMatch({
      usageKey: 8191482,
      acceptedUsageKey: 2487879,
      scientificName: null,
      canonicalName: 'Parus caeruleus',
      status: 'SYNONYM',
      matchType: 'EXACT',
      species: 'Cyanistes caeruleus',
      speciesKey: 2487879,
    } as never);

    expect(answer).toStrictEqual({
      kind: 'match',
      taxon: {
        key: { field: 'taxonKey', value: 2487879, matched: 8191482 },
        matchType: 'EXACT',
        confidence: undefined,
        scientificName: undefined,
        canonicalName: 'Parus caeruleus',
        rank: undefined,
        status: 'SYNONYM',
        acceptedName: 'Cyanistes caeruleus',
        classification: { species: 'Cyanistes caeruleus' },
        classificationKeys: { speciesKey: 2487879 },
      },
    });
  });

  it('leaves an accepted match without a matched key or an accepted name', () => {
    const answer = fromBackboneMatch({
      usageKey: 9705453,
      matchType: 'EXACT',
      species: 'Parus major',
      speciesKey: 9705453,
    });

    expect(answer.kind === 'match' && answer.taxon.key).toStrictEqual({
      field: 'taxonKey',
      value: 9705453,
    });
    expect(answer.kind === 'match' && 'acceptedName' in answer.taxon).toBe(false);
  });
});

/** #89 — the /v2 answer under the Catalogue of Life, read into the same shape. */
describe('fromChecklistMatch', () => {
  it.each([
    {
      raw: {
        diagnostics: { matchType: 'NONE', note: 'Multiple equal matches for Oenanthe' },
        synonym: false,
      },
      expected: { kind: 'none', note: 'Multiple equal matches for Oenanthe' },
    },
    { raw: { diagnostics: { matchType: 'NONE' } }, expected: { kind: 'none' } },
    { raw: { usage: {}, diagnostics: { matchType: 'EXACT' } }, expected: { kind: 'none' } },
    { raw: { usage: { key: 'N' } }, expected: { kind: 'none' } },
  ])('reads $raw as no match', ({ raw, expected }) => {
    expect(fromChecklistMatch(raw)).toStrictEqual(expected);
  });

  it('resolves a synonym to string keys, names it without authorship, and maps seven ranks', () => {
    const answer = fromChecklistMatch({
      usage: {
        key: '5YJK2',
        name: 'Chrysanthemum leucanthemum L.',
        canonicalName: 'Chrysanthemum leucanthemum',
        rank: 'SPECIES',
        status: 'SYNONYM',
      },
      acceptedUsage: {
        key: '5JC8W',
        name: 'Leucanthemum vulgare subsp. vulgare Lam.',
        canonicalName: 'Leucanthemum vulgare vulgare',
        rank: 'SUBSPECIES',
      },
      classification: [
        { key: 'CS5HF', name: 'Eukaryota', rank: 'DOMAIN' },
        { key: 'P', name: 'Plantae', rank: 'KINGDOM' },
        { key: 'CMQ8S', name: 'Pteridobiotina', rank: 'SUBKINGDOM' },
        { key: 'TP', name: 'Tracheophyta', rank: 'PHYLUM' },
        { key: 'ST', name: 'Asterales', rank: 'ORDER' },
        { key: '622TP', name: 'Asteraceae', rank: 'FAMILY' },
        { key: 'J6T', name: 'Asteroideae', rank: 'SUBFAMILY' },
        { key: '5DR2', name: 'Leucanthemum', rank: 'GENUS' },
        { key: '723WW', name: 'Leucanthemum vulgare', rank: 'SPECIES' },
        { key: '5JC8W', name: 'Leucanthemum vulgare vulgare', rank: 'SUBSPECIES' },
      ],
      diagnostics: { matchType: 'EXACT', confidence: 98 },
      synonym: true,
    });

    // No CLASS node in this classification, so no class; ranks off the seven are dropped.
    expect(answer).toStrictEqual({
      kind: 'match',
      taxon: {
        key: { field: 'checklistTaxonKey', value: '5JC8W', matched: '5YJK2' },
        matchType: 'EXACT',
        confidence: 98,
        scientificName: 'Chrysanthemum leucanthemum L.',
        canonicalName: 'Chrysanthemum leucanthemum',
        rank: 'SPECIES',
        status: 'SYNONYM',
        acceptedName: 'Leucanthemum vulgare vulgare',
        classification: {
          kingdom: 'Plantae',
          phylum: 'Tracheophyta',
          order: 'Asterales',
          family: 'Asteraceae',
          genus: 'Leucanthemum',
          species: 'Leucanthemum vulgare',
        },
        classificationKeys: {},
      },
    });
  });

  it('leaves a synonym unnamed when acceptedUsage carries no canonical name', () => {
    const answer = fromChecklistMatch({
      usage: { key: '65YK', status: 'SYNONYM' },
      acceptedUsage: { key: '3DQQ', name: 'Bubo Duméril, 1805' },
      diagnostics: { matchType: 'HIGHERRANK', confidence: 94 },
    });

    expect(answer.kind === 'match' && answer.taxon.key).toStrictEqual({
      field: 'checklistTaxonKey',
      value: '3DQQ',
      matched: '65YK',
    });
    expect(answer.kind === 'match' && 'acceptedName' in answer.taxon).toBe(false);
  });
});

describe('matchKeyFields', () => {
  it.each([
    { key: { field: 'taxonKey', value: 5 } as const, fields: { taxonKey: 5 } },
    {
      key: { field: 'taxonKey', value: 0, matched: 7 } as const,
      fields: { taxonKey: 0, matchedTaxonKey: 7 },
    },
    {
      key: { field: 'checklistTaxonKey', value: 'N' } as const,
      fields: { checklistTaxonKey: 'N' },
    },
    {
      key: { field: 'checklistTaxonKey', value: '32NH2', matched: 'VJFGD' } as const,
      fields: { checklistTaxonKey: '32NH2', checklistMatchedTaxonKey: 'VJFGD' },
    },
  ])('names $key.field keys under their own fields', ({ key, fields }) => {
    expect(matchKeyFields(key)).toStrictEqual(fields);
  });
});

describe('escapeMarkdownText', () => {
  it('escapes entity openers, literal markup and Markdown syntax only at rendering', () => {
    expect(escapeMarkdownText('<i>&copy; [x](url) `x` *x*')).toBe(
      '&#60;i&#62;&#38;copy; &#91;x&#93;&#40;url&#41; &#96;x&#96; &#42;x&#42;',
    );
  });
  it('keeps multiline inline slots inside their surrounding Markdown block', () => {
    expect(escapeMarkdownText('first\n\n# second')).toBe('first&#10;&#10;&#35; second');
    expect(escapeMarkdownText('first\n\n# second', false)).toBe('first\n\n&#35; second');
  });
  it('preserves carriage returns instead of letting CommonMark normalize them', () => {
    expect(escapeMarkdownText('first\rsecond')).toBe('first&#13;second');
    expect(escapeMarkdownText('first\r\nsecond')).toBe('first&#13;&#10;second');
    expect(escapeMarkdownText('first\rsecond', false)).toBe('first&#13;second');
    expect(escapeMarkdownText('first\r\nsecond', false)).toBe('first&#13;\nsecond');
  });
  it('preserves boundary whitespace in inline names without encoding internal spaces', () => {
    expect(escapeMarkdownText('  Parus major  ')).toBe('&#32; Parus major &#32;');
    expect(escapeMarkdownText('\tParus major')).toBe('&#9;Parus major');
    expect(escapeMarkdownText('first\n    second', false)).toBe('first\n&#32;   second');
  });
});

/**
 * #33 — a result set past the cap has no continuation path in this server, so the
 * guidance has to carry the whole picture: why paging stops, the partition dimension
 * that provably covers a scope, the condition under which its buckets add up to the
 * caller's own total, and the fact that a bulk download is a route the caller takes
 * elsewhere. A hint that only redirects to facet aggregation reads as "facets
 * substitute for records", which they do not.
 */
describe('overPaginationCapNotice', () => {
  it('matches the boundary GBIF enforces', () => {
    expect(PAGINATION_CAP).toBe(100_001);
  });

  it('stays silent for a result set paging can reach', () => {
    expect(overPaginationCapNotice(0)).toBeUndefined();
    expect(overPaginationCapNotice(PAGINATION_CAP)).toBeUndefined();
  });

  it('fires one record past the boundary', () => {
    expect(overPaginationCapNotice(PAGINATION_CAP + 1)).toBeDefined();
  });

  it('names the total, the partition dimension, and the absence of a cursor', () => {
    const notice = overPaginationCapNotice(60_290_950) as string;
    expect(notice).toContain('60,290,950');
    expect(notice).toContain('100,001');
    expect(notice).toContain('DATASET_KEY');
    expect(notice).toContain('gbif_occurrence_facets');
    expect(notice).toMatch(/no cursor or scroll/i);
  });

  it('states that a bulk download is not available here and names the real routes', () => {
    const notice = overPaginationCapNotice(60_290_950) as string;
    expect(notice).toMatch(/GBIF\.org account/);
    expect(notice).toContain('AWS Open Data');
  });

  it('ties the bucket arithmetic to the applied occurrenceStatus', () => {
    expect(overPaginationCapNotice(60_290_950)).toContain('occurrenceStatus');
  });

  /**
   * Counts reconcile only when each call repeats the same biological filters.
   */
  it('conditions the bucket arithmetic on the facet call repeating the filters', () => {
    const notice = overPaginationCapNotice(60_290_950) as string;
    expect(notice).not.toMatch(/sum to exactly this total/i);
    expect(notice).toMatch(/repeat this query's filters/i);
    expect(notice).toContain('all three occurrence tools accept the same biological filters');
    expect(notice).not.toContain('does not accept');
  });

  /**
   * #49 — publishingCountry became a filter on all three occurrence tools, so a
   * bucket still over the ceiling has a second gap-free axis besides basisOfRecord.
   * The guidance previously had to name only one, and a stale "only basisOfRecord"
   * would steer a caller off the axis that now works.
   */
  it('names both gap-free second axes now that each has a matching filter', () => {
    const notice = overPaginationCapNotice(60_290_950) as string;
    expect(notice).toContain('basisOfRecord');
    expect(notice).toContain('publishingCountry');
    expect(notice).not.toMatch(/only the former/i);
  });
});

/**
 * #49 — stateProvince is the one occurrence filter with no vocabulary behind it.
 * GBIF matches the verbatim string exactly and case-sensitively and answers a value
 * it does not hold with 200 and zero records, so no pattern can guard it and a zero
 * is ambiguous in a way no other filter's is: measured on one scope, `England`
 * matches 47,672,439 records while `england` and `ENGLAND` each match none.
 */
describe('stateProvinceNoMatchNotice', () => {
  it('stays silent when the filter was not applied', () => {
    expect(stateProvinceNoMatchNotice(undefined, 0)).toBeUndefined();
    expect(stateProvinceNoMatchNotice('', 0)).toBeUndefined();
    expect(stateProvinceNoMatchNotice('   ', 0)).toBeUndefined();
  });

  it('stays silent when the value matched records', () => {
    expect(stateProvinceNoMatchNotice('England', 47_672_439)).toBeUndefined();
    expect(stateProvinceNoMatchNotice('England', 1)).toBeUndefined();
  });

  it('fires only where the result is empty and the filter was applied', () => {
    expect(stateProvinceNoMatchNotice('england', 0)).toBeDefined();
  });

  it('echoes the value, names the match semantics, and points at the facet', () => {
    const notice = stateProvinceNoMatchNotice('england', 0) as string;
    expect(notice).toContain('"england"');
    expect(notice).toMatch(/verbatim/i);
    expect(notice).toMatch(/case-sensitive/i);
    expect(notice).toContain('STATE_PROVINCE');
    expect(notice).toContain('gbif_occurrence_facets');
  });

  /**
   * The whole point is separating a typo from an empty region. A notice that only
   * said "no records matched" would restate what the caller can already see.
   */
  it('says the zero does not distinguish a typo from an empty region', () => {
    const notice = stateProvinceNoMatchNotice('NotARealPlace', 0) as string;
    expect(notice).toMatch(/does not distinguish/i);
    expect(notice).toMatch(/instead of an error|rather than an error/i);
  });

  /** #77 — the coordinate-derived GID is the normalized alternative to the verbatim string. */
  it('names gadmGid and its facet as the normalized alternative', () => {
    const notice = stateProvinceNoMatchNotice('Andalusia', 0) as string;
    expect(notice).toContain('gadmGid');
    expect(notice).toContain('GADM_LEVEL_1_GID');
    expect(notice).toMatch(/coordinates/);
  });
});

/**
 * #77, #78 — GBIF answers a well-formed GID or collector name it does not hold with
 * 200 and zero records, so a zero under either filter is ambiguous the way a
 * stateProvince zero is, and each names the facet that lists the values it accepts.
 */
describe('gadmGid and recordedBy no-match notices', () => {
  for (const { build, field, facets, value, matchedValue, semantics } of [
    {
      build: gadmGidNoMatchNotice,
      field: 'gadmGid',
      facets: ['GADM_LEVEL_0_GID', 'GADM_LEVEL_1_GID', 'GADM_LEVEL_2_GID', 'GADM_LEVEL_3_GID'],
      value: 'ESP.99_1',
      matchedValue: 'ESP.1_1',
      semantics: /coordinates/,
    },
    {
      build: recordedByNoMatchNotice,
      field: 'recordedBy',
      facets: ['RECORDED_BY'],
      value: 'charles darwin',
      matchedValue: 'Charles Darwin',
      semantics: /case-sensitive/,
    },
  ]) {
    it(`${field} stays silent when the filter was not applied`, () => {
      for (const absent of [undefined, '', '   ']) expect(build(absent, 0)).toBeUndefined();
    });
    it(`${field} stays silent when the value matched records`, () => {
      expect(build(matchedValue, 1)).toBeUndefined();
      expect(build(matchedValue, 787)).toBeUndefined();
    });
    it(`${field} echoes the value, its matching, and every facet that lists accepted values`, () => {
      const notice = build(value, 0) as string;
      expect(notice).toContain(`${field} "${value}"`);
      expect(notice).toMatch(semantics);
      expect(notice).toMatch(/does not distinguish/);
      expect(notice).toContain('gbif_occurrence_facets');
      for (const facet of facets) expect(notice).toContain(facet);
    });
  }

  /**
   * A name shared across kingdoms (Oenanthe: a bird genus and a plant genus) counts
   * zero under scientificName while taxonKey 2492483 counts 2,772,955 — a zero GBIF
   * gives no reason for.
   */
  it('scientificName names the cross-kingdom reading and the route on an empty result only', () => {
    for (const absent of [undefined, '', '   ']) {
      expect(scientificNameNoMatchNotice(absent, 0)).toBeUndefined();
    }
    expect(scientificNameNoMatchNotice('Puma concolor', 1)).toBeUndefined();
    const notice = scientificNameNoMatchNotice('Oenanthe', 0) as string;
    expect(notice).toContain('scientificName "Oenanthe"');
    expect(notice).toMatch(/shared across kingdoms/);
    expect(notice).toMatch(/does not distinguish/);
    expect(notice).toContain('gbif_match_species');
    expect(notice).toContain('kingdom');
    expect(notice).toContain('taxonKey');
  });

  it('composes every applicable notice in a fixed order and none on a match', () => {
    const input = {
      scientificName: 'Oenanthe',
      stateProvince: 'Andalusia',
      gadmGid: 'ESP.99_1',
      recordedBy: 'charles darwin',
    };
    const notices = occurrenceNoMatchNotices(input, 0);
    expect(notices).toEqual([
      scientificNameNoMatchNotice('Oenanthe', 0),
      stateProvinceNoMatchNotice('Andalusia', 0),
      gadmGidNoMatchNotice('ESP.99_1', 0),
      recordedByNoMatchNotice('charles darwin', 0),
    ]);
    expect(notices.every(Boolean)).toBe(true);
    expect(occurrenceNoMatchNotices(input, 1).filter(Boolean)).toEqual([]);
    expect(occurrenceNoMatchNotices({ gadmGid: 'ESP.99_1' }, 0).filter(Boolean)).toHaveLength(1);
  });
});

/**
 * One validator serves search, count, and facets, so a filter added to one cannot
 * be guarded on another and skipped on the third. Blank detection runs first and
 * in declaration order, so the reported field is stable for a given input.
 */
describe('occurrenceFilterViolation', () => {
  const blankable = [
    'scientificName',
    'stateProvince',
    'decimalLatitude',
    'decimalLongitude',
    'geometry',
    'year',
    'coordinateUncertaintyInMeters',
    'gadmGid',
    'catalogNumber',
    'institutionCode',
    'recordedBy',
    'typeStatus',
    'establishmentMeans',
    'checklistTaxonKey',
  ] as const;

  it('passes every well-formed value, and an input with no filters', () => {
    expect(occurrenceFilterViolation({})).toBeUndefined();
    expect(
      occurrenceFilterViolation({
        scientificName: ' Panthera leo ',
        stateProvince: 'England',
        decimalLatitude: '50,52',
        decimalLongitude: '-2,-1',
        geometry: 'POLYGON((-2 50,-1 50,-1 51,-2 51,-2 50))',
        year: '2020',
        coordinateUncertaintyInMeters: '0,1000',
        gadmGid: 'ESP.1_1',
        catalogNumber: 'L.1592880',
        institutionCode: 'K',
        recordedBy: 'Darwin, C.',
        datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
        publishingOrg: '061B4F20-F241-11DA-A328-B8A03C50A862',
        typeStatus: ' holotype ',
        establishmentMeans: 'NATIVE',
      }),
    ).toBeUndefined();
  });

  /** #83 — GBIF answers a bare "*" on these three with HTTP 404 and an empty body. */
  it.each(['decimalLatitude', 'decimalLongitude', 'coordinateUncertaintyInMeters'] as const)(
    'rejects a bare "*" as %s, pointing at "min,max"',
    (field) => {
      for (const star of ['*', ' * ', '*\n']) {
        const violation = occurrenceFilterViolation({ [field]: star }) as string;
        expect(violation).toContain(`${field} "${star}" is not a range`);
        expect(violation).toContain('"min,max"');
        expect(violation.includes('"*,1000"')).toBe(field === 'coordinateUncertaintyInMeters');
      }
    },
  );

  /** Comma-less values answer upstream as exact matches, and "*" as one end of an uncertainty range. */
  it('keeps every value GBIF answers, comma-less and open-ended ones included', () => {
    for (const value of ['38', ' 38.16', '-3.8', '38,39', '38 , 39'])
      expect(occurrenceFilterViolation({ decimalLatitude: value })).toBeUndefined();
    for (const value of ['1000', '*,1000', '1000,*', '0,1000'])
      expect(occurrenceFilterViolation({ coordinateUncertaintyInMeters: value })).toBeUndefined();
  });

  it.each([
    '',
    'not-a-uuid',
    '061b4f20f24111daa328b8a03c50a862',
    ' 061b4f20-f241-11da-a328-b8a03c50a862',
    '061b4f20-f241-11da-a328-b8a03c50a862/../dataset',
  ])('rejects publishingOrg "%s" as not an organization UUID', (publishingOrg) => {
    expect(occurrenceFilterViolation({ publishingOrg })).toBe(
      `publishingOrg "${publishingOrg}" is not a GBIF organization UUID.`,
    );
  });

  /** #86 — GBIF matches these exactly and case-sensitively, so the match happens here. */
  it('accepts every concept in any letter case, padded or not', () => {
    for (const concept of TYPE_STATUS_VALUES)
      for (const typeStatus of [concept, concept.toLowerCase(), ` ${concept.toUpperCase()}\t`])
        expect(occurrenceFilterViolation({ typeStatus }), typeStatus).toBeUndefined();
    for (const concept of ESTABLISHMENT_MEANS_VALUES)
      for (const establishmentMeans of [concept, concept.toUpperCase(), ` ${concept} `])
        expect(occurrenceFilterViolation({ establishmentMeans })).toBeUndefined();
  });

  it.each([
    ['typeStatus', 'Holotipo', TYPE_STATUS_VALUES],
    ['typeStatus', 'Foobar', TYPE_STATUS_VALUES],
    ['typeStatus', 'Holo type', TYPE_STATUS_VALUES],
    ['typeStatus', 'Holotypes', TYPE_STATUS_VALUES],
    ['establishmentMeans', 'exotic', ESTABLISHMENT_MEANS_VALUES],
    ['establishmentMeans', 'native endemic', ESTABLISHMENT_MEANS_VALUES],
  ] as const)('rejects %s "%s", listing every concept', (field, value, concepts) => {
    const violation = occurrenceFilterViolation({ [field]: value }) as string;
    expect(violation).toContain(`${field} "${value}" names no concept`);
    for (const concept of concepts) expect(violation).toContain(concept);
  });

  it('checks the bare "*" before the keys and concepts, after blanks', () => {
    expect(
      occurrenceFilterViolation({ decimalLatitude: '*', typeStatus: 'x', publishingOrg: 'x' }),
    ).toContain('decimalLatitude');
    expect(occurrenceFilterViolation({ decimalLatitude: '*', recordedBy: ' ' })).toContain(
      'recordedBy was supplied blank',
    );
  });

  it.each(blankable)('names %s when it is blank or whitespace-only', (field) => {
    for (const blank of ['', '   ', '\t\n']) {
      expect(occurrenceFilterViolation({ [field]: blank })).toBe(
        `${field} was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.`,
      );
    }
  });

  it('reports the first blank field in declaration order', () => {
    expect(occurrenceFilterViolation({ recordedBy: '', scientificName: ' ' })).toContain(
      'scientificName',
    );
  });

  it.each(['', '   ', 'eBird', ' 4fa7b334-ce0d-4e88-aaae-2e0c138d049e '])(
    'rejects datasetKey "%s" as not a dataset UUID',
    (datasetKey) => {
      expect(occurrenceFilterViolation({ datasetKey })).toBe(
        `datasetKey "${datasetKey}" is not a GBIF dataset UUID.`,
      );
    },
  );

  /**
   * GBIF matches a GID exactly and case-sensitively and answers any other form —
   * `esp.1_1`, a place name, a padded or hyphenated value — with 200 and zero
   * records, so the alphabet is checked locally. The grammar is not: `Z01`,
   * `CHN.HKG`, and `GHA7_2` are real GIDs a stricter pattern would refuse.
   */
  it.each(['esp.1_1', 'Andalucía', 'ESP 1_1', 'ESP-1', ' ESP', 'ESP\n', 'ESP.1_1;', 'ÉSP'])(
    'rejects gadmGid "%s" outside the GID alphabet',
    (gadmGid) => {
      const violation = occurrenceFilterViolation({ gadmGid }) as string;
      expect(violation).toContain(`gadmGid "${gadmGid}"`);
      expect(violation).toMatch(/uppercase letters, digits, dots, and underscores/);
    },
  );

  it.each(['ESP', 'ESP.1_1', 'ESP.1.5_1', 'ESP.1.6.3_1', 'Z01', 'CHN.HKG', 'GHA7_2'])(
    'accepts the real GID shape %s',
    (gadmGid) => {
      expect(occurrenceFilterViolation({ gadmGid })).toBeUndefined();
    },
  );

  /**
   * #90 — GBIF reads `taxonKey` against the checklist `checklistKey` selects and answers
   * a key from the other one with 200 and zero records, or with an unrelated taxon when
   * a digit-only key exists in both (8288 is COL Tringa, Backbone Lagenismataceae). So
   * the pairing is checked here, and a COL key travels in its own string field.
   */
  it.each([
    {},
    { checklistKey: COL_XR_CHECKLIST_KEY },
    { checklistKey: COL_XR_CHECKLIST_KEY, checklistTaxonKey: '3WSJV' },
    { checklistKey: COL_XR_CHECKLIST_KEY, checklistTaxonKey: '8288' },
    { checklistKey: COL_XR_CHECKLIST_KEY, checklistTaxonKey: 'N' },
    { taxonKey: 2435261 },
    { taxonKey: 0, checklistKey: BACKBONE_CHECKLIST_KEY },
    { checklistKey: BACKBONE_CHECKLIST_KEY },
  ] as const)('accepts the checklist pairing %j', (input) => {
    expect(occurrenceFilterViolation(input)).toBeUndefined();
  });

  it.each([2435261, 8288, 0])('rejects taxonKey %s under the Catalogue of Life', (taxonKey) => {
    const violation = occurrenceFilterViolation({
      taxonKey,
      checklistKey: COL_XR_CHECKLIST_KEY,
    }) as string;
    expect(violation).toContain(`taxonKey ${taxonKey} is a Backbone key`);
    expect(violation).toContain('checklistTaxonKey');
    expect(violation).toContain('unrelated taxon');
  });

  it.each([undefined, BACKBONE_CHECKLIST_KEY])(
    'rejects checklistTaxonKey under checklistKey %s',
    (checklistKey) => {
      for (const input of [
        { checklistTaxonKey: '3WSJV', checklistKey },
        { checklistTaxonKey: '3WSJV', checklistKey, taxonKey: 2435261 },
      ]) {
        const violation = occurrenceFilterViolation(input) as string;
        expect(violation).toContain('checklistTaxonKey "3WSJV" is a Catalogue of Life key');
        expect(violation).toContain(`checklistKey ${COL_XR_CHECKLIST_KEY}`);
        expect(violation).toContain('taxonKey');
      }
    },
  );

  /** `3wsjv` under COL XR answers 0; observed keys use only `[0-9A-Z]`. */
  it.each(['3wsjv', ' 3WSJV', '3WSJV ', '3WSJV\n', '3WS-JV', 'Lynx pardinus', '3WSJV;', 'É8288'])(
    'rejects checklistTaxonKey %j outside the key alphabet, before the pairing',
    (checklistTaxonKey) => {
      for (const checklistKey of [COL_XR_CHECKLIST_KEY, undefined]) {
        const violation = occurrenceFilterViolation({ checklistTaxonKey, checklistKey }) as string;
        expect(violation).toContain(`checklistTaxonKey "${checklistTaxonKey}"`);
        expect(violation).toContain('uppercase letters and digits');
      }
    },
  );

  /**
   * gadmGid carries no schema length bound, so its alphabet check is timed like any
   * scanner over caller-sized text: a long valid run ending in one bad character,
   * a run that passes whole, and the two line-break shapes (one long line ending in
   * a break, breaks throughout — the latter whitespace-only, so it exercises the
   * blank check that runs first).
   */
  it('stays linear in thread CPU across a 64-fold span of gadmGid input', () => {
    const shapes = {
      'valid-run-then-bad': (size: number) => `${'A'.repeat(size)}a`,
      'valid-throughout': (size: number) => 'ESP.1_'.repeat(Math.ceil(size / 6)),
      'trailing-break': (size: number) => `${'§1 x'.repeat(size / 4)}\ny`,
      'embedded-breaks': (size: number) => '  \r\n'.repeat(size / 4),
    };
    for (const [shape, build] of Object.entries(shapes)) {
      const measurements: number[] = [];
      for (const size of [5000, 10000, 20000, 40000, 80000, 160000, 320000]) {
        const gadmGid = build(size);
        const expected = occurrenceFilterViolation({ gadmGid });
        // Warm each exact shape so regex tier transitions fall outside the measured span.
        for (let i = 0; i < 32; i++) occurrenceFilterViolation({ gadmGid });
        const start = process.threadCpuUsage();
        for (let i = 0; i < 8; i++) expect(occurrenceFilterViolation({ gadmGid })).toBe(expected);
        const cpu = process.threadCpuUsage(start);
        const cpuUs = cpu.user + cpu.system;
        expect(cpuUs, `${shape} at ${size}`).toBeLessThan(250_000);
        measurements.push(cpuUs);
      }
      expect(measurements.at(-1)! / Math.max(measurements[0]!, 1), shape).toBeLessThan(256);
    }
  });

  /**
   * The #83 and #86 checks read caller-sized text too: the bare-"*" test and the
   * comma test on the coordinate filters, the UUID check on publishingOrg, and the
   * concept match on typeStatus and establishmentMeans, whose rejection echoes the
   * value. Each is timed per call over a 64-fold span, the least of several batches
   * kept, with the smallest input re-timed beside every larger one. A long digit run
   * carries the span to 320k; the other shapes stay under 80k.
   */
  it('stays linear in thread CPU across a 64-fold span of coordinate, organization, and concept input', () => {
    const leastCpuUs = (run: () => void, batch: number) => {
      let least = Number.POSITIVE_INFINITY;
      for (let attempt = 0; attempt < 5; attempt++) {
        const start = process.threadCpuUsage();
        for (let i = 0; i < batch; i++) run();
        const cpu = process.threadCpuUsage(start);
        least = Math.min(least, (cpu.user + cpu.system) / batch);
      }
      return least;
    };
    const checks = {
      'decimalLatitude star check': (value: string) =>
        occurrenceFilterViolation({ decimalLatitude: value }),
      'exact-match notice': (value: string) =>
        exactCoordinateMatchNotice({ coordinateUncertaintyInMeters: value }),
      publishingOrg: (value: string) => occurrenceFilterViolation({ publishingOrg: value }),
      typeStatus: (value: string) => occurrenceFilterViolation({ typeStatus: value }),
      establishmentMeans: (value: string) =>
        occurrenceFilterViolation({ establishmentMeans: value }),
      // #90: the key alphabet, then the pairing, whose message echoes the value.
      checklistTaxonKey: (value: string) => occurrenceFilterViolation({ checklistTaxonKey: value }),
    };
    const shapes = {
      'digit-run': { build: (size: number) => '1'.repeat(size), from: 5000 },
      'trailing-break': { build: (size: number) => `${'§1 x'.repeat(size / 4)}\ny`, from: 1000 },
      'embedded-breaks': { build: (size: number) => '  \r\n'.repeat(size / 4), from: 1000 },
    };
    for (const [name, check] of Object.entries(checks)) {
      for (const [shape, { build, from }] of Object.entries(shapes)) {
        const baseline = build(from);
        for (let size = from * 2; size <= from * 64; size *= 2) {
          const input = build(size);
          for (let i = 0; i < 8; i++) check(input);
          const largeUs = leastCpuUs(() => check(input), 4);
          const smallUs = leastCpuUs(() => check(baseline), 64);
          expect(largeUs, `${name} ${shape} at ${size}`).toBeLessThan(50_000);
          if (size === from * 64)
            expect(largeUs / Math.max(smallUs, 1), `${name} ${shape} across 64x`).toBeLessThan(256);
        }
      }
    }
  }, 0);
});

/**
 * #83 — GBIF reads a coordinate value without a comma as one exact value, so the
 * note names every such field on every result and never fires for a range.
 */
describe('exactCoordinateMatchNotice', () => {
  it('stays silent with no coordinate filter and for every range form', () => {
    expect(exactCoordinateMatchNotice({})).toBeUndefined();
    for (const range of ['38,39', '38 , 39', '-35,-20', '*,1000', '1000,*', '0,1000', ','])
      expect(
        exactCoordinateMatchNotice({
          decimalLatitude: range,
          decimalLongitude: range,
          coordinateUncertaintyInMeters: range,
        }),
      ).toBeUndefined();
  });

  it.each([
    [
      { decimalLatitude: '38' },
      'decimalLatitude has no comma, so GBIF matched it as one exact value',
    ],
    [{ decimalLongitude: ' -3.8' }, 'decimalLongitude has no comma'],
    [{ coordinateUncertaintyInMeters: '1000' }, 'coordinateUncertaintyInMeters has no comma'],
    [
      { decimalLatitude: '38', coordinateUncertaintyInMeters: '1000', decimalLongitude: '-4,-3' },
      'decimalLatitude and coordinateUncertaintyInMeters have no comma, so GBIF matched each as one exact value',
    ],
    [
      { decimalLatitude: '38', decimalLongitude: '-3', coordinateUncertaintyInMeters: '50' },
      'decimalLatitude, decimalLongitude, and coordinateUncertaintyInMeters have no comma',
    ],
  ])('names each comma-less field in %j', (input, opening) => {
    const notice = exactCoordinateMatchNotice(input) as string;
    expect(notice.startsWith(opening)).toBe(true);
    expect(notice).toContain('only records at exactly that value');
    expect(notice).toContain('"min,max", both ends inclusive');
  });

  it('names only the fields without a comma', () => {
    const notice = exactCoordinateMatchNotice({
      decimalLatitude: '38,39',
      decimalLongitude: '-3',
    }) as string;
    expect(notice).toContain('decimalLongitude');
    expect(notice).not.toContain('decimalLatitude');
    expect(notice).not.toContain('coordinateUncertaintyInMeters');
  });
});

/** One table decides what the three occurrence tools forward and echo. */
describe('occurrence filter table', () => {
  const everyFilter = {
    taxonKey: 0,
    scientificName: ' Panthera leo ',
    country: 'ZA',
    publishingCountry: 'US',
    stateProvince: ' Limpopo ',
    decimalLatitude: '-35,-20',
    decimalLongitude: '15,35',
    geometry: 'POLYGON((15 -35,35 -35,35 -20,15 -20,15 -35))',
    year: '2020,2024',
    month: 12,
    basisOfRecord: 'FOSSIL_SPECIMEN',
    hasCoordinate: false,
    isInCluster: false,
    coordinateUncertaintyInMeters: '0,1000',
    datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
    iucnRedListCategory: 'VU',
    gadmGid: 'ESP.1_1',
    catalogNumber: 'l.1592880',
    institutionCode: 'clo',
    recordedBy: 'Darwin, C.',
    mediaType: 'Sound',
    publishingOrg: '061B4F20-F241-11DA-A328-B8A03C50A862',
    hasGeospatialIssue: false,
    typeStatus: 'Isolectotype',
    establishmentMeans: 'introducedAssistedColonisation',
    license: 'CC0_1_0',
  } as const;

  it('covers every biological filter the occurrence tools accept, and nothing else', () => {
    expect([...OCCURRENCE_FILTER_KEYS].sort()).toEqual(
      [...Object.keys(everyFilter), 'occurrenceStatus', 'checklistKey', 'checklistTaxonKey'].sort(),
    );
  });

  /** #90 — the scope names the field the caller filled; only the service renames it to taxonKey. */
  it('echoes checklistTaxonKey and checklistKey under their own names', () => {
    const input = {
      checklistTaxonKey: '3WSJV',
      checklistKey: COL_XR_CHECKLIST_KEY,
      occurrenceStatus: 'PRESENT',
    } as const;
    expect(occurrenceScope(input)).toEqual(input);
    expect(occurrenceFilters(input)).toEqual(input);
  });

  it('echoes supplied values, false and zero included, and drops controls', () => {
    const scope = occurrenceScope({
      ...everyFilter,
      occurrenceStatus: 'ANY',
      limit: 3,
      facet: 'COUNTRY',
    } as Parameters<typeof occurrenceScope>[0]);
    expect(scope).toEqual({ ...everyFilter, occurrenceStatus: 'ANY' });
    expect(occurrenceScope({ occurrenceStatus: 'PRESENT' })).toEqual({
      occurrenceStatus: 'PRESENT',
    });
  });

  it('resolves ANY to no occurrenceStatus and keeps PRESENT and ABSENT', () => {
    expect(occurrenceFilters({ ...everyFilter, occurrenceStatus: 'ANY' })).toEqual(everyFilter);
    for (const occurrenceStatus of ['PRESENT', 'ABSENT'] as const)
      expect(occurrenceFilters({ taxonKey: 1, occurrenceStatus })).toEqual({
        taxonKey: 1,
        occurrenceStatus,
      });
  });

  /**
   * #86 — the one exception to forwarding supplied bytes: a concept filter is sent
   * and echoed in GBIF's own spelling, since that is the value GBIF matches. Every
   * other filter beside it keeps its bytes.
   */
  it('sends and echoes typeStatus and establishmentMeans as their concepts', () => {
    const input = {
      typeStatus: ' holotype ',
      establishmentMeans: 'NativeEndemic',
      stateProvince: ' Limpopo ',
      decimalLatitude: ' 38.16',
      occurrenceStatus: 'PRESENT',
    } as const;
    const canonical = {
      typeStatus: 'Holotype',
      establishmentMeans: 'nativeEndemic',
      stateProvince: ' Limpopo ',
      decimalLatitude: ' 38.16',
      occurrenceStatus: 'PRESENT',
    };
    expect(occurrenceFilters(input)).toEqual(canonical);
    expect(occurrenceScope(input)).toEqual(canonical);
    for (const concept of TYPE_STATUS_VALUES)
      expect(
        occurrenceFilters({ typeStatus: concept.toUpperCase(), occurrenceStatus: 'ANY' }),
      ).toEqual({ typeStatus: concept });
  });

  /** Dropping an unchecked concept would send no filter and widen the query. */
  it('throws rather than drop a concept value that was never checked', () => {
    expect(() => occurrenceFilters({ typeStatus: 'Holotipo', occurrenceStatus: 'ANY' })).toThrow(
      'typeStatus "Holotipo"',
    );
    expect(() =>
      occurrenceScope({ establishmentMeans: 'exotic', occurrenceStatus: 'ANY' }),
    ).toThrow('establishmentMeans "exotic"');
  });

  /** The bundled lists mirror GBIF's two vocabularies, which case-fold without collisions. */
  it('carries both concept vocabularies whole, with no case-folded collision', () => {
    expect(TYPE_STATUS_VALUES).toHaveLength(51);
    expect(ESTABLISHMENT_MEANS_VALUES).toHaveLength(7);
    for (const concepts of [TYPE_STATUS_VALUES, ESTABLISHMENT_MEANS_VALUES])
      expect(new Set(concepts.map((c) => c.toLowerCase())).size).toBe(concepts.length);
  });
});

describe('stripHtml', () => {
  it('removes simple HTML tags', () => {
    expect(stripHtml('<p>Hello world</p>')).toBe('Hello world');
  });

  it('removes nested tags', () => {
    expect(stripHtml('<div><strong>Bold</strong> text</div>')).toBe('Bold text');
  });

  it('decodes &amp;', () => {
    expect(stripHtml('A &amp; B')).toBe('A & B');
  });

  it('decodes &lt; and &gt;', () => {
    expect(stripHtml('&lt;tag&gt;')).toBe('<tag>');
  });

  it('decodes &quot;', () => {
    expect(stripHtml('Say &quot;hello&quot;')).toBe('Say "hello"');
  });

  it('decodes &#34; (decimal quote)', () => {
    expect(stripHtml('A&#34;B')).toBe('A"B');
  });

  it('decodes &#39; (apostrophe)', () => {
    expect(stripHtml('It&#39;s fine')).toBe("It's fine");
  });

  it('decodes &#61; (equals)', () => {
    expect(stripHtml('a&#61;b')).toBe('a=b');
  });

  it('decodes &#43; (plus)', () => {
    expect(stripHtml('a&#43;b')).toBe('a+b');
  });

  it('collapses multiple whitespace into single space', () => {
    expect(stripHtml('hello   world')).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(stripHtml('  hello  ')).toBe('hello');
  });

  it('removes tags and normalizes whitespace together', () => {
    expect(stripHtml('<p>  hello  <br/>  world  </p>')).toBe('hello\n\nworld');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(stripHtml('   ')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(stripHtml('plain text')).toBe('plain text');
  });

  it('handles tag with attributes', () => {
    expect(stripHtml('<a href="https://example.com">link</a>')).toBe('link');
  });

  it('handles self-closing tags', () => {
    expect(stripHtml('line1<br/>line2')).toBe('line1\n\nline2');
  });

  it('handles deeply nested HTML', () => {
    const html = '<div><ul><li><strong>item</strong></li></ul></div>';
    expect(stripHtml(html)).toBe('item');
  });

  // Security: tag delimiters are removed; inner text content remains (by design —
  // stripHtml is a text extractor, not an HTML sanitizer for execution contexts).
  it('removes script tag delimiters', () => {
    const result = stripHtml('<script>alert("xss")</script>description');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
    // Inner text content is preserved — this is the extractor's intended behavior
    expect(result).toContain('description');
  });

  it('removes style tag delimiters', () => {
    const result = stripHtml('<style>body{display:none}</style>text');
    expect(result).not.toContain('<style>');
    expect(result).not.toContain('</style>');
    expect(result).toContain('text');
  });

  it('handles unicode text without modification', () => {
    expect(stripHtml('<p>Parus major — Großer Meise</p>')).toBe('Parus major — Großer Meise');
  });

  it('handles HTML with numeric entities for special chars', () => {
    const result = stripHtml('Copyright &#169;');
    expect(result).toBe('Copyright ©');
  });

  /**
   * #56 (CodeQL js/double-escaping) — a replacement's output must never be read
   * by a later replacement. Decoding `&amp;` ahead of the references that follow
   * it turned the `&` it produced into the opening of the next one, so text that
   * literally contains an escaped reference lost a level of escaping: `&amp;lt;`
   * spells the four characters `&lt;`, and the second pass collapsed them to `<`.
   */
  describe('decodes each reference exactly once', () => {
    it('leaves a double-encoded tag as the literal reference text', () => {
      expect(stripHtml('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    });

    it('does not re-read an &amp;-produced & as the start of another reference', () => {
      expect(stripHtml('&amp;quot;q&amp;quot;')).toBe('&quot;q&quot;');
      expect(stripHtml('&amp;#39;')).toBe('&#39;');
      expect(stripHtml('&amp;amp;')).toBe('&amp;');
    });

    it('still decodes a single-encoded reference beside a double-encoded one', () => {
      expect(stripHtml('&lt;b&gt; vs &amp;lt;b&amp;gt;')).toBe('<b> vs &lt;b&gt;');
    });

    it('leaves a reference outside the supported set verbatim', () => {
      expect(stripHtml('&#169; &nbsp; &copy; &#x3c;')).toBe('© &copy; <');
    });
    it('decodes numeric code points once and leaves invalid scalars verbatim', () => {
      expect(stripHtml('&#64; &#x1f426; &amp;#64;')).toBe('@ 🐦 &#64;');
      expect(stripHtml('&#0; &#xD800; &#1114112;')).toBe('&#0; &#xD800; &#1114112;');
    });
  });
});
