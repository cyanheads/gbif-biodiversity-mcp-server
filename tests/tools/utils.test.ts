/**
 * @fileoverview Tests for shared tool utilities — stripHtml formatter, the
 * over-pagination-cap guidance, and the verbatim stateProvince guidance.
 * @module tests/tools/utils.test
 */

import type { z } from '@cyanheads/mcp-ts-core';
import { describe, expect, it } from 'vitest';
import {
  backboneAcceptedName,
  basisOfRecordFilter,
  compactGeographicCoverages,
  countryFilter,
  escapeMarkdownText,
  exactCoordinateMatchNotice,
  fromBackboneMatch,
  fromChecklistMatch,
  gadmGidNoMatchNotice,
  linkOrEscapedText,
  matchKeyFields,
  occurrenceFilters,
  occurrenceFilterViolation,
  occurrenceNoMatchNotices,
  occurrenceScope,
  occurrenceScopeSchema,
  overPaginationCapNotice,
  PAGINATION_CAP,
  recordedByNoMatchNotice,
  scientificNameNoMatchNotice,
  sharedOccurrenceFilterFields,
  stateProvinceNoMatchNotice,
  stripHtml,
  taxonKeyFilter,
} from '@/mcp-server/tools/utils.js';
import {
  BACKBONE_CHECKLIST_KEY,
  COL_XR_CHECKLIST_KEY,
  ESTABLISHMENT_MEANS_VALUES,
  OCCURRENCE_FILTER_KEYS,
  TYPE_STATUS_VALUES,
} from '@/services/gbif/types.js';

/** Least thread CPU per call, in µs, over five batches of `batch` calls. */
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

  /**
   * The escaper renders publisher free text of thousands of characters — occurrence
   * remarks, dataset descriptions — so it is timed like any scanner over caller-sized
   * text, in both modes: a run it never touches (digits, carried to 320k), a run it
   * rewrites character by character, a run of spaces whose boundary check reads both
   * neighbours, and the two line-break shapes. Each is timed per call over a 64-fold
   * span, the least of several batches kept, with the smallest input re-timed beside
   * every larger one; the shapes other than the digit run stay under 80k.
   */
  it('stays linear in thread CPU across a 64-fold span of publisher text', () => {
    const shapes = {
      'digit-run': { build: (size: number) => '1'.repeat(size), from: 5000 },
      'escaped-run': { build: (size: number) => '[&'.repeat(size / 2), from: 1000 },
      'space-run': { build: (size: number) => `${' '.repeat(size - 1)}x`, from: 1000 },
      'trailing-break': { build: (size: number) => `${'§1 x'.repeat(size / 4)}\ny`, from: 1000 },
      'embedded-breaks': { build: (size: number) => '  \r\n'.repeat(size / 4), from: 1000 },
    };
    for (const inline of [true, false]) {
      for (const [shape, { build, from }] of Object.entries(shapes)) {
        const baseline = build(from);
        for (let size = from * 2; size <= from * 64; size *= 2) {
          const input = build(size);
          for (let i = 0; i < 8; i++) escapeMarkdownText(input, inline);
          const largeUs = leastCpuUs(() => escapeMarkdownText(input, inline), 4);
          const smallUs = leastCpuUs(() => escapeMarkdownText(baseline, inline), 64);
          expect(largeUs, `${shape} inline=${inline} at ${size}`).toBeLessThan(50_000);
          if (size === from * 64)
            expect(
              largeUs / Math.max(smallUs, 1),
              `${shape} inline=${inline} across 64x`,
            ).toBeLessThan(256);
        }
      }
    }
  }, 0);
});

/**
 * A URL-valued publisher field is a link to itself only when it is an absolute http(s)
 * URL on one line; any other value — another scheme, a relative path, a URN, a value
 * spanning lines — is escaped text, with no live target. A value that tries to close the
 * link early — `)`, `]`, `>`, a backslash, a second link — still yields one link whose
 * destination is the value itself, and `&` or `_` in the URL stays as sent.
 */
describe('linkOrEscapedText', () => {
  it.each([
    { value: 'javascript:alert(1)', rendered: 'javascript:alert&#40;1&#41;' },
    { value: 'ftp://example.org/file', rendered: 'ftp://example.org/file' },
    { value: 'www.example.org/x_y', rendered: 'www.example.org/x&#95;y' },
    { value: '/media/1_2.jpg', rendered: '/media/1&#95;2.jpg' },
    { value: 'urn:catalog:MCZ:Herp:A-1_2', rendered: 'urn:catalog:MCZ:Herp:A-1&#95;2' },
    { value: 'https://example.org/a\nb', rendered: 'https://example.org/a&#10;b' },
    {
      value: 'https://example.org/media?id=1&size=large_2',
      rendered:
        '[https://example.org/media?id=1&size=large_2](<https://example.org/media?id=1&size=large_2>)',
    },
    {
      value: 'https://example.org/a&#38;b',
      rendered: '[https://example.org/a\\&#38;b](<https://example.org/a\\&#38;b>)',
    },
    {
      value: 'https://example.org/a)b c',
      rendered: '[https://example.org/a)b c](<https://example.org/a)b c>)',
    },
    {
      value: 'https://example.org/x]y\\z',
      rendered: '[https://example.org/x\\]y\\z](<https://example.org/x]y\\\\z>)',
    },
    {
      value: 'https://example.org/<b>x</b>',
      rendered: '[https://example.org/\\<b>x\\</b>](<https://example.org/\\<b\\>x\\</b\\>>)',
    },
    {
      value: 'https://example.org/>)[x](javascript:alert(1)',
      rendered:
        '[https://example.org/>)\\[x\\](javascript:alert(1)](<https://example.org/\\>)[x](javascript:alert(1)>)',
    },
  ])('renders $value as one safe link or as text', ({ value, rendered }) => {
    expect(linkOrEscapedText(value)).toBe(rendered);
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
    expect(notice).toContain('returned taxonKey');
    expect(scientificNameNoMatchNotice('Oenanthe', 0, BACKBONE_CHECKLIST_KEY)).toBe(notice);
  });

  /** taxonKey is refused beside the Catalogue of Life checklistKey, so the route cannot name it. */
  it('scientificName routes through checklistTaxonKey under the Catalogue of Life', () => {
    const notice = scientificNameNoMatchNotice('Oenanthe', 0, COL_XR_CHECKLIST_KEY) as string;
    expect(notice).toContain('scientificName "Oenanthe"');
    expect(notice).toMatch(/shared across kingdoms/);
    expect(notice).toContain(
      `returned checklistTaxonKey, with checklistKey ${COL_XR_CHECKLIST_KEY}`,
    );
    expect(notice).not.toMatch(/\btaxonKey\b/);
    expect(notice).not.toContain('Backbone');
    expect(
      occurrenceNoMatchNotices(
        { scientificName: 'Oenanthe', checklistKey: COL_XR_CHECKLIST_KEY },
        0,
      )[0],
    ).toBe(notice);
  });

  /**
   * GBIF ORs scientificName with a taxon key, yet a name it cannot resolve empties the
   * whole query: taxonKey 2435261 counts 2,269, with "Lynx lynx" beside it 122,551, and
   * with "Zzzz zzzz" beside it 0. Under the Catalogue of Life checklistKey,
   * checklistTaxonKey 3WSJV counts the same 2,269, and 0 beside "Zzzz zzzz".
   */
  it('scientificName beside a taxon key says an unresolved name empties the whole query', () => {
    const notice = scientificNameNoMatchNotice('Zzzz zzzz', 0, undefined, true) as string;
    expect(notice).toContain('scientificName "Zzzz zzzz" was applied beside taxonKey');
    expect(notice).toContain('empties the whole query, the taxonKey records included');
    expect(notice).toContain('this zero does not show that taxonKey has no records');
    expect(notice).toContain('Drop scientificName to count the taxonKey records alone');
    expect(notice).toContain('gbif_match_species');
    expect(notice).toContain('kingdom');
    expect(notice).not.toMatch(/does not distinguish/);
    expect(notice).not.toContain('checklistTaxonKey');
    expect(scientificNameNoMatchNotice('Zzzz zzzz', 0, BACKBONE_CHECKLIST_KEY, true)).toBe(notice);
    expect(scientificNameNoMatchNotice('Lynx lynx', 122551, undefined, true)).toBeUndefined();
    for (const absent of [undefined, '', '   '])
      expect(scientificNameNoMatchNotice(absent, 0, undefined, true)).toBeUndefined();

    const col = scientificNameNoMatchNotice('Zzzz zzzz', 0, COL_XR_CHECKLIST_KEY, true) as string;
    expect(col).toContain('applied beside checklistTaxonKey');
    expect(col).toContain('the checklistTaxonKey records included');
    expect(col).toContain(`returned checklistTaxonKey, with checklistKey ${COL_XR_CHECKLIST_KEY}`);
    expect(col).not.toMatch(/\btaxonKey\b/);
    expect(col).not.toContain('Backbone');
    expect(col).not.toMatch(/does not distinguish/);
  });

  /**
   * The resolved key joins the call's own key rather than replacing it: taxonKey
   * 2435261 beside "Oenanthe" counts 0, Oenanthe's bird genus 2492483 alone 2,831,997,
   * and [2435261, 2492483] the 2,834,266 union the call asked for.
   */
  it('keyed scientificName notice adds the resolved key to the key array', () => {
    const notice = scientificNameNoMatchNotice('Oenanthe', 0, undefined, true) as string;
    expect(notice).toContain(
      "add the returned taxonKey to this call's taxonKey, which takes an array, in place of the name",
    );
    expect(notice).not.toContain('query the returned taxonKey');
    const col = scientificNameNoMatchNotice('Oenanthe', 0, COL_XR_CHECKLIST_KEY, true) as string;
    expect(col).toContain(
      `add the returned checklistTaxonKey, with checklistKey ${COL_XR_CHECKLIST_KEY}, to this call's checklistTaxonKey, which takes an array, in place of the name`,
    );
  });

  it('hands the scientificName notice a supplied taxonKey or checklistTaxonKey, key 0 included', () => {
    const keyed = scientificNameNoMatchNotice('Oenanthe', 0, undefined, true) as string;
    expect(keyed).toContain('the taxonKey records included');
    for (const taxonKey of [0, 2435261])
      expect(occurrenceNoMatchNotices({ scientificName: 'Oenanthe', taxonKey }, 0)[0]).toBe(keyed);
    const col = occurrenceNoMatchNotices(
      {
        scientificName: 'Oenanthe',
        checklistKey: COL_XR_CHECKLIST_KEY,
        checklistTaxonKey: '3WSJV',
      },
      0,
    )[0];
    expect(col).toContain('the checklistTaxonKey records included');
    expect(occurrenceNoMatchNotices({ scientificName: 'Oenanthe' }, 0)[0]).toMatch(
      /does not distinguish/,
    );
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
    // #97: `eventDate=`, `geoDistance=`, and `elevation=` each answer the unfiltered scope.
    'month',
    'eventDate',
    'geoDistance',
    'elevation',
    'depth',
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

  /**
   * #93 — GBIF answers a bare "*" year with the same empty-body 404, while "*" as one
   * end of a range answers: on Lynx pardinus "*,1990" counts 46 and "2020,*" 466.
   */
  it.each([
    ['year', '"*,1990" or "2020,*"'],
    // #97: month, elevation, and depth answer the same 404; eventDate a 400.
    ['month', '"*,5" or "9,*"'],
    ['eventDate', '"*,2020-06-30" or "2026-01-01,*"'],
    ['elevation', '"2000,*"'],
    ['depth', '"200,*"'],
  ] as const)('rejects a bare "*" as %s, pointing at the open range %s', (field, open) => {
    for (const star of ['*', ' * ', '*\n']) {
      const violation = occurrenceFilterViolation({ [field]: star }) as string;
      expect(violation).toContain(`${field} "${star}" is not a range`);
      expect(violation).toContain(`"*" may stand for one open end, as in ${open}`);
    }
  });

  /**
   * GBIF answers the same empty-body 404 when whitespace sits between a "*" end and the
   * comma: on Lynx pardinus year "* ,1990" and "2020, *" each answer 404 with no body,
   * while " *,1990" and "*, 1990" each count 46 — the "*" end is read untrimmed on its
   * comma side only. eventDate answers that spacing with a 400 naming it.
   */
  it.each([
    ['year', '* ,1990', '"*,1990"'],
    ['year', '2020, *', '"2020,*"'],
    ['month', '*\t,5', '"*,5"'],
    ['elevation', '* ,2000', '"*,2000"'],
    ['depth', '200, *', '"200,*"'],
    ['coordinateUncertaintyInMeters', '* , *', '"*,*"'],
  ] as const)(
    'rejects %s %j, whose "*" end meets the comma through whitespace, naming %s',
    (field, value, fixed) => {
      const violation = occurrenceFilterViolation({ [field]: value }) as string;
      expect(violation).toContain(`${field} "${value}" has whitespace between "*" and the comma`);
      expect(violation).toContain(`write it ${fixed}`);
    },
  );

  it('keeps the padded open ranges GBIF reads as ranges', () => {
    for (const value of [' *,1990', '*,1990 ', '*, 1990', '1990 ,*', ' *,* '])
      expect(occurrenceFilterViolation({ year: value }), value).toBeUndefined();
    expect(occurrenceFilterViolation({ eventDate: '* ,2020-06-30' })).toBeUndefined();
  });

  /** Comma-less values answer upstream as exact matches, and "*" as one end of an uncertainty range. */
  it('keeps every value GBIF answers, comma-less and open-ended ones included', () => {
    for (const value of ['38', ' 38.16', '-3.8', '38,39', '38 , 39'])
      expect(occurrenceFilterViolation({ decimalLatitude: value })).toBeUndefined();
    for (const value of ['1000', '*,1000', '1000,*', '0,1000'])
      expect(occurrenceFilterViolation({ coordinateUncertaintyInMeters: value })).toBeUndefined();
    for (const value of ['2024', ' 2024', '2020,2024', '*,1990', '2020,*', '*,*'])
      expect(occurrenceFilterViolation({ year: value })).toBeUndefined();
    // #97: each forwarded for GBIF to answer, or to name in its own 400 ("11,2", "13").
    for (const month of [1, 12, '3', ' 3', '03', '3,5', '*,5', '9,*', '11,2', '13'])
      expect(occurrenceFilterViolation({ month }), String(month)).toBeUndefined();
    for (const value of ['2026', '2026-03', '2026-3-1', '2025,2026-03', '2026-01-01,*', '*,*'])
      expect(occurrenceFilterViolation({ eventDate: value })).toBeUndefined();
    for (const value of ['2000', '2000,9000', '-5,*', '0.5,1999.5', '*,*'])
      for (const field of ['elevation', 'depth'] as const)
        expect(occurrenceFilterViolation({ [field]: value })).toBeUndefined();
  });

  /**
   * #97 — GBIF reads a geoDistance distance with no unit as meters: around 38.17,-3.95
   * on Lynx pardinus, "25km" and "25000" each count 256 while "25" counts 0. Each part
   * is read with its surrounding whitespace ignored, as GBIF reads it.
   */
  it.each([
    '38.17,-3.95,25km',
    '38.17,-3.95,25000m',
    '38.17, -3.95, 25km',
    ' 38.17,-3.95,25km ',
    '38.17,-3.95,25 km',
    '-38,147,2.5km',
    '38,-3,0.5m',
  ])('accepts geoDistance %j', (geoDistance) => {
    expect(occurrenceFilterViolation({ geoDistance })).toBeUndefined();
  });

  it.each([
    '38.17,-3.95,25',
    '38.17,-3.95,25KM',
    '38.17,-3.95,25Km',
    '38.17,-3.95,25mi',
    '38.17,-3.95,25cm',
    '38.17,-3.95,km',
    '38.17,-3.95',
    '38.17,-3.95,25km,1',
    '38.17,,25km',
    'north,-3.95,25km',
    '*',
  ])('rejects geoDistance %j, naming both units', (geoDistance) => {
    const violation = occurrenceFilterViolation({ geoDistance }) as string;
    expect(violation).toContain(`geoDistance "${geoDistance}"`);
    expect(violation).toContain('lowercase km or m');
    expect(violation).toContain('as meters');
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
      // #98: the same checks on one member of an array.
      'checklistTaxonKey member': (value: string) =>
        occurrenceFilterViolation({ checklistTaxonKey: ['3WSJV', value] }),
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

  /**
   * #97 — the geoDistance shape check splits the value and reads each part, echoing
   * the value when it rejects. Timed on what each step scans: a part-less digit run,
   * a distance that passes the split and unit and is one huge number, a comma run, a
   * long run of unit letters, padding inside the distance, and the two line-break
   * shapes. Digit runs carry the span to 320k; the others stay under 80k.
   */
  it('stays linear in thread CPU across a 64-fold span of geoDistance input', () => {
    const check = (geoDistance: string) => occurrenceFilterViolation({ geoDistance });
    const shapes = {
      'digit-run': { build: (size: number) => '1'.repeat(size), from: 5000 },
      'distance-digit-run': { build: (size: number) => `1,1,${'1'.repeat(size)}km`, from: 5000 },
      'comma-run': { build: (size: number) => ','.repeat(size), from: 1000 },
      'unit-run': { build: (size: number) => `1,1,1${'m'.repeat(size)}`, from: 1000 },
      'padded-distance': { build: (size: number) => `1,1,${' '.repeat(size)}25km`, from: 1000 },
      'trailing-break': { build: (size: number) => `${'§1 x'.repeat(size / 4)}\ny`, from: 1000 },
      'embedded-breaks': {
        build: (size: number) => `1,\n1,\n${'2\r\n '.repeat(size / 4)}km`,
        from: 1000,
      },
    };
    for (const [shape, { build, from }] of Object.entries(shapes)) {
      const baseline = build(from);
      for (let size = from * 2; size <= from * 64; size *= 2) {
        const input = build(size);
        for (let i = 0; i < 8; i++) check(input);
        const largeUs = leastCpuUs(() => check(input), 4);
        const smallUs = leastCpuUs(() => check(baseline), 64);
        expect(largeUs, `${shape} at ${size}`).toBeLessThan(50_000);
        if (size === from * 64)
          expect(largeUs / Math.max(smallUs, 1), `${shape} across 64x`).toBeLessThan(256);
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

  /**
   * The range example belongs to the field the notice names: sent as elevation,
   * "0,1000" is a 0–1,000 m band (277,945 Quercus records), not "within 1 km", and
   * "38,39" a 38–39 m one (413).
   */
  it.each([
    [{ elevation: '2000' }, 'elevation "2000,*"'],
    [{ depth: '200' }, 'depth "200,*"'],
    [{ decimalLatitude: '38' }, 'decimalLatitude "38,39"'],
    [{ decimalLongitude: '-3' }, 'decimalLongitude "-4,-3"'],
    [
      { coordinateUncertaintyInMeters: '1000' },
      'coordinateUncertaintyInMeters "0,1000" for within 1 km',
    ],
  ])('gives %j a range example of its own', (input, example) => {
    const notice = exactCoordinateMatchNotice(input) as string;
    expect(notice).toContain(example);
    for (const other of ['"38,39"', '"-4,-3"', '"0,1000"', '"2000,*"', '"200,*"'])
      if (!example.includes(other)) expect(notice).not.toContain(other);
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

  /**
   * #97 — a single elevation or depth matches only that figure (`elevation=2000`
   * counts 784 Quercus records, exactly as `2000,2000`), while a single year, month,
   * or eventDate is a whole period and a geoDistance is a radius.
   */
  it('names a comma-less elevation or depth, and no other range filter', () => {
    expect(
      exactCoordinateMatchNotice({ elevation: '2000', depth: '200' })?.startsWith(
        'elevation and depth have no comma, so GBIF matched each as one exact value',
      ),
    ).toBe(true);
    expect(exactCoordinateMatchNotice({ elevation: '2000,*', depth: '0,199' })).toBeUndefined();
    const periods = {
      decimalLatitude: '38,39',
      year: '2024',
      month: 3,
      eventDate: '2026-03',
      geoDistance: '38.17,-3.95,25km',
    };
    for (const input of [periods, { ...periods, month: '3' }])
      expect(exactCoordinateMatchNotice(input)).toBeUndefined();
  });
});

/** One table decides what the three occurrence tools forward and echo. */
/**
 * Either checklistKey value limits the result to records GBIF has classified in
 * that checklist, so neither asks for the same records as an omitted key:
 * /v1/occurrence/search?country=IS&occurrenceStatus=PRESENT counts 2,707,757 with
 * no checklistKey, 2,685,509 under the Backbone key, and 2,686,609 under the
 * Catalogue of Life key (2026-11-19).
 */
describe('sharedOccurrenceFilterFields checklistKey', () => {
  it('says either value leaves out the records GBIF has not matched in that checklist', () => {
    const description = sharedOccurrenceFilterFields().checklistKey.description ?? '';
    expect(description).toContain('either value');
    expect(description).toContain('not matched to a taxon in that checklist');
    expect(description).toContain('no checklistKey keeps');
  });
});

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
    eventDate: '2025,2026-03',
    geoDistance: '38.17, -3.95, 25km',
    elevation: '-5,2000.5',
    depth: '*,200',
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

/**
 * #98 — country, basisOfRecord, taxonKey, and checklistTaxonKey take one value or a
 * non-empty array, sent as one repeated parameter per member, which GBIF ORs. Each
 * member passes the check a single value passes: GBIF answers a bad member by adding
 * nothing to the union (`country=ES&country=pt` counts the 1,348 Lynx pardinus records
 * `ES` alone does), and an empty array sends no parameter, which answers the unfiltered
 * scope. Members are sent and echoed as given, never deduplicated or reordered.
 */
describe('one value or several (#98)', () => {
  const fields: Record<
    string,
    { schema: () => z.ZodType; good: readonly [unknown, unknown]; bad: readonly unknown[] }
  > = {
    country: { schema: countryFilter, good: ['ES', 'PT'], bad: ['es', 'ESP', 'Spain', '', 34] },
    basisOfRecord: {
      schema: basisOfRecordFilter,
      good: ['PRESERVED_SPECIMEN', 'FOSSIL_SPECIMEN'],
      bad: ['preserved_specimen', 'SPECIMEN', '', 1],
    },
    taxonKey: {
      schema: taxonKeyFilter,
      good: [2435261, 0],
      bad: [-1, 2435261.5, '01', '1e3', '2.5', '-3', 'Puma', ''],
    },
    // The blank check and the key alphabet run in occurrenceFilterViolation, below.
    checklistTaxonKey: {
      schema: () => sharedOccurrenceFilterFields().checklistTaxonKey,
      good: ['3WSJV', '8288'],
      bad: [8288, null],
    },
  };

  it.each(Object.entries(fields))(
    '%s takes one value, or a non-empty array kept exactly as sent',
    (_, { schema, good: [a, b] }) => {
      expect(schema().parse(a)).toBe(a);
      expect(schema().parse([a])).toEqual([a]);
      expect(schema().parse([b, a, b])).toEqual([b, a, b]);
    },
  );

  it.each(Object.entries(fields))(
    '%s rejects an empty array, and a bad value alone or as a member',
    (_, { schema, good: [a], bad }) => {
      expect(schema().safeParse([]).success).toBe(false);
      for (const value of bad) {
        expect(schema().safeParse(value).success, String(value)).toBe(false);
        expect(schema().safeParse([a, value]).success, String(value)).toBe(false);
      }
    },
  );

  /**
   * A client that sends a number as text gets the number: the framework's repair of a
   * spelled number stops at a union that also takes an array or a string, so taxonKey
   * and month apply its rule themselves. Only a string whose trimmed form is the
   * number's own decimal spelling converts; anything else stays the string sent.
   */
  it('reads a taxonKey spelled as text as that key, alone or as a member', () => {
    expect(taxonKeyFilter().parse('2435261')).toBe(2435261);
    expect(taxonKeyFilter().parse(' 2435261 ')).toBe(2435261);
    expect(taxonKeyFilter().parse('0')).toBe(0);
    expect(taxonKeyFilter().parse(['2435261', 5219404])).toEqual([2435261, 5219404]);
  });

  it('reads a month spelled as text as that integer, and keeps every other string as sent', () => {
    const { month } = sharedOccurrenceFilterFields();
    expect(month.parse('3')).toBe(3);
    expect(month.parse(' 12 ')).toBe(12);
    for (const text of ['03', '3,5', '*,5', ' * ', '']) expect(month.parse(text)).toBe(text);
    for (const outside of ['13', '0', '1.5', 13, 0])
      expect(month.safeParse(outside).success, String(outside)).toBe(false);
  });

  /** 218 seven-digit keys fit GBIF's URL ceiling and 219 draw HTTP 400, so the cap sits well inside it. */
  it.each(['taxonKey', 'checklistTaxonKey'] as const)(
    '%s takes up to 100 members and refuses 101',
    (field) => {
      const { schema, good } = fields[field]!;
      expect(schema().safeParse(Array.from({ length: 100 }, () => good[0])).success).toBe(true);
      expect(schema().safeParse(Array.from({ length: 101 }, () => good[0])).success).toBe(false);
    },
  );

  it('names the accepted country form, and the member, when a member fails it', () => {
    const issues = countryFilter().safeParse(['ES', 'pt']).error?.issues ?? [];
    expect(issues.map((issue) => issue.path)).toEqual([[1]]);
    expect(issues[0]?.message).toMatch(/^country must be an uppercase ISO 3166-1 alpha-2 code/);
  });

  it('passes checklistTaxonKey arrays, and taxonKey arrays, under their own checklists', () => {
    for (const input of [
      { checklistKey: COL_XR_CHECKLIST_KEY, checklistTaxonKey: ['3WSJV', '6QR9T'] },
      { checklistKey: COL_XR_CHECKLIST_KEY, checklistTaxonKey: ['8288'] },
      { taxonKey: [2435261, 2435246] },
      { taxonKey: [0], checklistKey: BACKBONE_CHECKLIST_KEY },
    ])
      expect(occurrenceFilterViolation(input), JSON.stringify(input)).toBeUndefined();
  });

  it('names a blank checklistTaxonKey member by its position, before any key alphabet check', () => {
    for (const blank of ['', '   ', '\t\n'])
      for (const checklistTaxonKey of [
        ['3WSJV', blank],
        ['3wsjv', blank],
      ])
        expect(
          occurrenceFilterViolation({ checklistKey: COL_XR_CHECKLIST_KEY, checklistTaxonKey }),
        ).toBe(
          'checklistTaxonKey[1] was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.',
        );
  });

  it('names a checklistTaxonKey member outside the key alphabet by its value', () => {
    const violation = occurrenceFilterViolation({
      checklistKey: COL_XR_CHECKLIST_KEY,
      checklistTaxonKey: ['3WSJV', '6qr9t', 'Lynx'],
    });
    expect(violation).toContain('checklistTaxonKey "6qr9t" is not a Catalogue of Life key');
  });

  it('refuses either array beside the other checklist, naming its first member', () => {
    expect(
      occurrenceFilterViolation({
        taxonKey: [2435261, 2435246],
        checklistKey: COL_XR_CHECKLIST_KEY,
      }),
    ).toContain('taxonKey 2435261 is a Backbone key');
    for (const checklistKey of [undefined, BACKBONE_CHECKLIST_KEY])
      expect(
        occurrenceFilterViolation({ checklistTaxonKey: ['3WSJV', '6QR9T'], checklistKey }),
      ).toContain('checklistTaxonKey "3WSJV" is a Catalogue of Life key');
  });

  it('sends and echoes arrays as given, repeated and out-of-order members included', () => {
    const input = {
      taxonKey: [2435246, 2435261, 2435246],
      country: ['PT', 'ES'],
      basisOfRecord: ['FOSSIL_SPECIMEN' as const],
      occurrenceStatus: 'PRESENT' as const,
    };
    expect(occurrenceFilters(input)).toEqual(input);
    expect(occurrenceScope(input)).toEqual(input);
  });

  it('admits an array of strings or of numbers in scope, beside the scalars', () => {
    const scope = {
      taxonKey: [2435261, 2435246],
      country: ['ES', 'PT'],
      checklistTaxonKey: ['3WSJV'],
      hasCoordinate: false,
      month: 3,
      year: '2020',
      occurrenceStatus: 'PRESENT',
    };
    expect(occurrenceScopeSchema.parse(scope)).toEqual(scope);
  });
});

/**
 * #95 — a coverage entry is kept when it carries a description, a bounding box, or
 * both, and the box passes through as GBIF sends it. Boxes are from live
 * /v1/dataset records: 50c9509d (iNaturalist, a box beside a description, whose
 * minLongitude above maxLongitude crosses the antimeridian) and eb974f54 (a box
 * with no description).
 */
describe('compactGeographicCoverages', () => {
  const INAT_BOX = {
    minLatitude: -87.80586803331971,
    maxLatitude: 89.98972198460251,
    minLongitude: 0,
    maxLongitude: -1.6763806343078613e-7,
    globalCoverage: false,
  };
  const AIRDNA_BOX = {
    minLatitude: 56.8336111111,
    maxLatitude: 56.8347222222,
    minLongitude: 10.2477777778,
    maxLongitude: 10.2516666667,
    globalCoverage: false,
  };

  it('keeps a box beside its description with every value unchanged', () => {
    expect(
      compactGeographicCoverages([{ description: 'Bounding Box', boundingBox: INAT_BOX }]),
    ).toEqual([
      {
        description: 'Bounding Box',
        boundingBox: {
          minLatitude: -87.80586803331971,
          maxLatitude: 89.98972198460251,
          minLongitude: 0,
          maxLongitude: -1.6763806343078613e-7,
          globalCoverage: false,
        },
      },
    ]);
  });

  it('keeps a box that carries no description, adding none', () => {
    const entries = compactGeographicCoverages([{ boundingBox: AIRDNA_BOX }]);
    expect(entries).toEqual([{ boundingBox: AIRDNA_BOX }]);
    expect(entries?.[0]).not.toHaveProperty('description');
  });

  it('keeps a description-only entry exactly as before', () => {
    expect(compactGeographicCoverages([{ description: 'Worldwide' }])).toEqual([
      { description: 'Worldwide' },
    ]);
  });

  it('drops an entry with neither, keeping the rest in source order', () => {
    expect(
      compactGeographicCoverages([
        {},
        { boundingBox: AIRDNA_BOX },
        { description: '' },
        { description: 'Worldwide' },
      ]),
    ).toEqual([{ boundingBox: AIRDNA_BOX }, { description: 'Worldwide' }]);
    expect(compactGeographicCoverages([{}])).toBeUndefined();
    expect(compactGeographicCoverages(undefined)).toBeUndefined();
  });

  it('passes a box through without validating or reordering its bounds', () => {
    const inverted = {
      minLatitude: 10,
      maxLatitude: -10,
      minLongitude: 170,
      maxLongitude: -170,
      globalCoverage: true,
    };
    expect(compactGeographicCoverages([{ boundingBox: inverted }])).toEqual([
      { boundingBox: { ...inverted } },
    ]);
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
