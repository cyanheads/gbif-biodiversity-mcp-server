/**
 * @fileoverview Security tests — injection resistance, oversized inputs, and secret non-leakage.
 * @module tests/tools/security.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifCountOccurrences } from '@/mcp-server/tools/definitions/gbif-count-occurrences.tool.js';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';
import { gbifGetOccurrence } from '@/mcp-server/tools/definitions/gbif-get-occurrence.tool.js';
import { gbifGetSpecies } from '@/mcp-server/tools/definitions/gbif-get-species.tool.js';
import { gbifMatchSpecies } from '@/mcp-server/tools/definitions/gbif-match-species.tool.js';
import { gbifOccurrenceFacets } from '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';
import { gbifSearchDatasets } from '@/mcp-server/tools/definitions/gbif-search-datasets.tool.js';
import { gbifSearchOccurrences } from '@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js';
import { gbifSearchPublishers } from '@/mcp-server/tools/definitions/gbif-search-publishers.tool.js';
import { gbifSearchSpecies } from '@/mcp-server/tools/definitions/gbif-search-species.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

const INJECTION_STRINGS = [
  "<script>alert('xss')</script>",
  '"; DROP TABLE species; --',
  "' OR '1'='1",
  '../../../etc/passwd',
  '%00null',
  '\x00\x01\x02',
  '{{7*7}}',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional injection probe string
  '${7*7}',
  '‮ reverse',
];

const makeOccurrenceResponse = (overrides = {}) => ({
  results: [],
  count: 0,
  offset: 0,
  limit: 20,
  endOfRecords: true,
  ...overrides,
});

describe('Input injection — string parameters do not crash handlers', () => {
  const mockSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearch,
      searchSpecies: mockSearch,
      searchDatasets: mockSearch,
      searchPublishers: mockSearch,
      getOccurrenceFacets: vi.fn().mockResolvedValue({ count: 0, facets: [] }),
    } as never);
    mockSearch.mockResolvedValue(makeOccurrenceResponse());
  });

  for (const injection of INJECTION_STRINGS) {
    /**
     * gbif_search_occurrences takes no free-text `q` — Zod strips unknown keys, so
     * probing one would leave the injection string outside the parsed input and the
     * assertion would hold against any implementation. scientificName is the tool's
     * free-text field, so the string actually reaches the handler.
     */
    it(`gbif_search_occurrences survives scientificName="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
      const input = gbifSearchOccurrences.input.parse({ scientificName: injection });
      expect(input.scientificName).toBe(injection);

      // Must not throw — the service mock returns empty results
      const result = await gbifSearchOccurrences.handler(input, ctx);
      expect(result.occurrences).toBeDefined();
      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ scientificName: injection }),
        ctx,
      );
    });

    it(`gbif_search_species survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext();
      const input = gbifSearchSpecies.input.parse({ q: injection });
      const result = await gbifSearchSpecies.handler(input, ctx);
      expect(result.taxa).toBeDefined();
    });

    it(`gbif_search_datasets survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext();
      const input = gbifSearchDatasets.input.parse({ q: injection });
      const result = await gbifSearchDatasets.handler(input, ctx);
      expect(result.datasets).toBeDefined();
    });

    it(`gbif_search_publishers survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext();
      const input = gbifSearchPublishers.input.parse({ q: injection });
      const result = await gbifSearchPublishers.handler(input, ctx);
      expect(result.publishers).toBeDefined();
    });

    it(`gbif_match_species survives name="${injection.slice(0, 30)}"`, async () => {
      vi.mocked(getGbifService).mockReturnValue({
        matchSpecies: vi.fn().mockResolvedValue({ matchType: 'NONE', usageKey: undefined }),
      } as never);
      const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
      const input = gbifMatchSpecies.input.parse({ name: injection });
      // NONE match throws no_match — that's the correct behavior, not a crash
      await expect(gbifMatchSpecies.handler(input, ctx)).rejects.toMatchObject({
        data: { reason: 'no_match' },
      });
    });
  }
});

describe('UUID-typed inputs reject before reaching GBIF', () => {
  const mockSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearch,
      searchSpecies: mockSearch,
      searchDatasets: mockSearch,
      countOccurrences: mockSearch,
      getDataset: mockSearch,
      getOccurrenceFacets: mockSearch,
    } as never);
  });

  const uuidInputs = [
    { name: 'gbif_search_occurrences.datasetKey', def: gbifSearchOccurrences, field: 'datasetKey' },
    { name: 'gbif_count_occurrences.datasetKey', def: gbifCountOccurrences, field: 'datasetKey' },
    { name: 'gbif_search_species.datasetKey', def: gbifSearchSpecies, field: 'datasetKey' },
    { name: 'gbif_search_datasets.hostingOrg', def: gbifSearchDatasets, field: 'hostingOrg' },
    { name: 'gbif_search_datasets.publishingOrg', def: gbifSearchDatasets, field: 'publishingOrg' },
    { name: 'gbif_get_dataset.datasetKey', def: gbifGetDataset, field: 'datasetKey' },
    {
      name: 'gbif_occurrence_facets.datasetKey',
      def: gbifOccurrenceFacets,
      field: 'datasetKey',
      extra: { facet: 'COUNTRY' },
    },
  ] as const;

  for (const { name, def, field, extra } of uuidInputs.map((u) => ({
    extra: undefined as Record<string, unknown> | undefined,
    ...u,
  }))) {
    it(`${name} rejects an injection string as invalid_filter`, async () => {
      const ctx = createMockContext({ errors: def.errors });
      const input = def.input.parse({ ...extra, [field]: "' OR '1'='1" });

      const err = await def.handler(input as never, ctx).catch((e: unknown) => e);

      expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    /**
     * #52, #53 — the empty string is the one malformed key GBIF answers with a wrong
     * result instead of an error: every route behind these fields ignores a blank
     * parameter and returns the unfiltered scope, so a guard that skipped blank values
     * dropped the filter and handed back everything under the caller's own belief that
     * the query was scoped. Whitespace alone does the same on `/occurrence/search`, and
     * `isGbifUuid` catches both because it neither trims nor accepts an empty match.
     */
    it.each(['', '   '])(`${name} rejects "%s" as invalid_filter`, async (blank) => {
      const ctx = createMockContext({ errors: def.errors });
      const input = def.input.parse({ ...extra, [field]: blank });
      expect((input as Record<string, unknown>)[field]).toBe(blank);

      const err = await def.handler(input as never, ctx).catch((e: unknown) => e);

      expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    /**
     * A padded key is forwarded verbatim, not trimmed, so accepting one would let a
     * caller-side defect reach GBIF unexamined — and `/occurrence/count`, which the
     * dataset record-count lookup still uses, answers 200 with `0` for a malformed
     * key rather than an error.
     */
    it(`${name} rejects a whitespace-padded UUID rather than forwarding it`, async () => {
      const ctx = createMockContext({ errors: def.errors });
      const padded = ' 4fa7b334-ce0d-4e88-aaae-2e0c138d049e ';
      const input = def.input.parse({ ...extra, [field]: padded });
      expect((input as Record<string, unknown>)[field]).toBe(padded);

      const err = await def.handler(input as never, ctx).catch((e: unknown) => e);

      expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
      expect(mockSearch).not.toHaveBeenCalled();
    });
  }
});

/**
 * #54 — the counterpart table to the UUID one above, for the filters with no shape
 * to check. Every one of them used to be spread behind a `?.trim()` test, so a blank
 * value was dropped rather than sent and GBIF answered the unfiltered scope:
 * `stateProvince: ""` returns all 60,290,950 records of a `taxonKey=212` +
 * `country=GB` scope where `England` returns 47,672,439, and `scientificName`,
 * `year`, `geometry`, the coordinate ranges, and `coordinateUncertaintyInMeters`
 * each behave the same way on that route. Whitespace alone does too. Where the
 * upstream answer differs — `/dataset/search?q=%20%20` returns none where `?q=`
 * returns all 123,527 — the guard still fires, because one space between the whole
 * index and an empty page is not a distinction a caller can plan around.
 *
 * `gbif_search_species` exposes `kingdom`, `family`, and `genus`, and they join the
 * table now that they scope: each is resolved to a backbone key and forwarded as
 * `higherTaxonKey`, so a blank one names no taxon. Rejecting it by field beats
 * reporting that the empty string matched no backbone family.
 */
describe('Blank filters reject before reaching GBIF', () => {
  const mockCall = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockCall,
      countOccurrences: mockCall,
      getOccurrenceFacets: mockCall,
      searchSpecies: mockCall,
      searchDatasets: mockCall,
      searchPublishers: mockCall,
      matchSpecies: mockCall,
    } as never);
  });

  const blankInputs = [
    {
      name: 'gbif_search_occurrences',
      def: gbifSearchOccurrences,
      extra: {},
      fields: {
        scientificName: 'Parus major',
        stateProvince: 'England',
        decimalLatitude: '50,52',
        decimalLongitude: '-2,-1',
        geometry: 'POLYGON((-2 50,-1 50,-1 51,-2 51,-2 50))',
        year: '2020',
        coordinateUncertaintyInMeters: '0,1000',
      },
    },
    {
      name: 'gbif_count_occurrences',
      def: gbifCountOccurrences,
      extra: {},
      fields: {
        scientificName: 'Parus major',
        stateProvince: 'England',
        decimalLatitude: '50,52',
        decimalLongitude: '-2,-1',
        geometry: 'POLYGON((-2 50,-1 50,-1 51,-2 51,-2 50))',
        year: '2020',
        coordinateUncertaintyInMeters: '0,1000',
      },
    },
    {
      name: 'gbif_occurrence_facets',
      def: gbifOccurrenceFacets,
      extra: { facet: 'COUNTRY' },
      fields: {
        scientificName: 'Parus major',
        decimalLatitude: '50,52',
        decimalLongitude: '-2,-1',
        coordinateUncertaintyInMeters: '0,1000',
        stateProvince: 'England',
        year: '2020',
        geometry: 'POLYGON((-2 50,-1 50,-1 51,-2 51,-2 50))',
      },
    },
    {
      name: 'gbif_search_species',
      def: gbifSearchSpecies,
      extra: {},
      fields: { q: 'Aves', kingdom: 'Animalia', family: 'Paridae', genus: 'Parus' },
    },
    { name: 'gbif_search_datasets', def: gbifSearchDatasets, extra: {}, fields: { q: 'moths' } },
    {
      name: 'gbif_search_publishers',
      def: gbifSearchPublishers,
      extra: {},
      fields: { q: 'museum' },
    },
    {
      name: 'gbif_match_species',
      def: gbifMatchSpecies,
      extra: { name: 'Parus major' },
      fields: { kingdom: 'Animalia' },
    },
  ] as const;

  for (const { name, def, extra, fields } of blankInputs) {
    for (const [field, realValue] of Object.entries(fields)) {
      it.each(['', '   '])(`${name}.${field} rejects "%s" as invalid_filter`, async (blank) => {
        const ctx = createMockContext({ errors: def.errors });
        const input = def.input.parse({ ...extra, [field]: blank });
        expect((input as Record<string, unknown>)[field]).toBe(blank);

        const err = await def.handler(input as never, ctx).catch((e: unknown) => e);

        expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
        expect((err as Error).message).toContain(field);
        expect(mockCall).not.toHaveBeenCalled();
      });

      /**
       * A value that is not blank still reaches GBIF untouched — the guard rejects
       * exactly the set the old `?.trim()` test dropped and narrows nothing else.
       * Parsing pins the field as declared too: an undeclared key is stripped by
       * Zod, so every rejection above would hold against a tool that never had it.
       */
      it(`${name}.${field} forwards "${realValue}" unchanged`, () => {
        const parsed = def.input.parse({ ...extra, [field]: realValue }) as Record<string, unknown>;
        expect(parsed[field]).toBe(realValue);
      });
    }
  }
});

/**
 * The occurrence presence/absence and IUCN filters are closed vocabularies, and
 * GBIF treats a bad value in each differently: `occurrenceStatus` draws HTTP 400,
 * but `iucnRedListCategory` is answered with 200 and a count of zero. A string
 * that reaches either would therefore be a wrong answer rather than an error at
 * best, so the schema has to stop it before the handler runs.
 */
describe('Closed-vocabulary occurrence filters reject before the handler runs', () => {
  const enumInputs = [
    { name: 'gbif_search_occurrences', def: gbifSearchOccurrences, extra: {} },
    { name: 'gbif_count_occurrences', def: gbifCountOccurrences, extra: {} },
    { name: 'gbif_occurrence_facets', def: gbifOccurrenceFacets, extra: { facet: 'COUNTRY' } },
  ] as const;

  for (const { name, def, extra } of enumInputs) {
    for (const injection of INJECTION_STRINGS) {
      it(`${name}.occurrenceStatus rejects "${injection.slice(0, 24)}"`, () => {
        expect(() => def.input.parse({ ...extra, occurrenceStatus: injection })).toThrow();
      });

      it(`${name}.iucnRedListCategory rejects "${injection.slice(0, 24)}"`, () => {
        expect(() => def.input.parse({ ...extra, iucnRedListCategory: injection })).toThrow();
      });
    }

    /**
     * The enum is load-bearing only if the field is actually declared — an
     * undeclared key is stripped by Zod and every rejection assertion above would
     * hold against a tool that never had the filter.
     */
    it(`${name} declares both filters rather than silently stripping them`, () => {
      const parsed = def.input.parse({
        ...extra,
        occurrenceStatus: 'ABSENT',
        iucnRedListCategory: 'CR',
      }) as Record<string, unknown>;

      expect(parsed.occurrenceStatus).toBe('ABSENT');
      expect(parsed.iucnRedListCategory).toBe('CR');
    });
  }
});

/**
 * #49, #50, #51 — `country` and `publishingCountry` draw on the same closed ISO
 * 3166-1 alpha-2 vocabulary, and GBIF splits its rejections the same way on the
 * two routes that match the verbatim stored code, `/occurrence/search` and
 * `/dataset/search`: an unparseable code answers HTTP 400 while a form that
 * parses but is not stored verbatim — lowercase, mixed case, alpha-3 — answers
 * 200 with zero rows. The silent half is the dangerous one, so every such schema
 * carries a `^[A-Z]{2}$` pattern and every non-code string fails before the
 * handler runs. `stateProvince` is deliberately absent from this suite — GBIF
 * stores whatever each dataset recorded, so there is no vocabulary for a pattern
 * to check. Its two guards live elsewhere: a blank value fails in the handler
 * (the blank-filter suite above) and an unmatched one draws the empty-result
 * notice.
 */
describe('country codes reject non-code strings before the handler runs', () => {
  const patternInputs = [
    {
      name: 'gbif_search_occurrences',
      def: gbifSearchOccurrences,
      extra: {},
      fields: ['country', 'publishingCountry'],
    },
    {
      name: 'gbif_count_occurrences',
      def: gbifCountOccurrences,
      extra: {},
      fields: ['country', 'publishingCountry'],
    },
    {
      name: 'gbif_occurrence_facets',
      def: gbifOccurrenceFacets,
      extra: { facet: 'COUNTRY' },
      fields: ['country', 'publishingCountry'],
    },
    {
      name: 'gbif_search_datasets',
      def: gbifSearchDatasets,
      extra: {},
      fields: ['publishingCountry'],
    },
  ] as const;

  /**
   * Forms the pattern rejects, grouped by what each would otherwise do. `gb`,
   * `Us`, `uS`, `USA`, `GBR`, and `gb ` are the silent class — 200 with zero rows
   * on both routes. `G` draws an upstream 400. ` GB` is trimmed upstream and would
   * answer correctly; it is rejected on shape, so the schema states one accepted
   * form rather than one form plus whatever GBIF happens to tolerate. The empty
   * string is the worst of them — the handler guard used to drop it, turning a
   * filtered query into an unfiltered one. `AA`, `XK`, `XZ`, and `ZZ` are
   * deliberately absent — GBIF carries them in its own country vocabulary
   * (`/enumeration/basic/Country` lists all four alongside the 249 officially
   * assigned ISO codes), so a zero there is an empty bucket, not a malformed
   * filter.
   */
  const NON_CANONICAL_FORMS = ['gb', 'Us', 'uS', 'USA', 'GBR', 'gb ', ' GB', 'G', ''];

  for (const { name, def, extra, fields } of patternInputs) {
    for (const field of fields) {
      for (const injection of INJECTION_STRINGS) {
        it(`${name}.${field} rejects "${injection.slice(0, 24)}"`, () => {
          expect(() => def.input.parse({ ...extra, [field]: injection })).toThrow();
        });
      }

      for (const form of NON_CANONICAL_FORMS) {
        it(`${name}.${field} rejects the non-canonical form "${form}"`, () => {
          expect(() => def.input.parse({ ...extra, [field]: form })).toThrow();
        });
      }

      /**
       * Declared, not stripped — without this an undeclared key would satisfy every
       * rejection assertion above on a tool that never had the filter at all.
       */
      it(`${name} declares ${field} and keeps a valid code`, () => {
        const parsed = def.input.parse({ ...extra, [field]: 'US' }) as Record<string, unknown>;
        expect(parsed[field]).toBe('US');
      });

      /**
       * A pattern rejection is thrown by the SDK before the handler runs, so the
       * declared `invalid_filter` recovery hint cannot fire for it — the schema's
       * own message is the only guidance the caller gets, and a bare "Invalid
       * string" would not name the accepted form.
       */
      it(`${name}.${field} names the accepted form in the rejection message`, () => {
        const result = def.input.safeParse({ ...extra, [field]: 'gb' });
        expect(result.success).toBe(false);
        const messages = result.error?.issues.map((i) => i.message).join(' ') ?? '';
        expect(messages).toContain(field);
        expect(messages).toMatch(/uppercase ISO 3166-1 alpha-2/);
      });
    }
  }
});

/**
 * #50, #51 — the registry route behind `gbif_search_publishers` is `/organization`,
 * which resolves the *parsed* country rather than matching the stored string: `gb`,
 * `gbr`, and `GBR` each return the same 223 organizations as `GB`, and `USA` the
 * same 499 as `US`. There is no silent zero to close, so the pattern every other
 * country field in this server carries would only reject values that answer
 * correctly. Pinned so a later consistency pass does not apply it here by symmetry.
 */
describe('gbif_search_publishers.country stays unconstrained', () => {
  for (const form of ['gb', 'GBR', 'gbr', 'Gb']) {
    it(`accepts "${form}", which the registry resolves to the same organizations as "GB"`, () => {
      const parsed = gbifSearchPublishers.input.parse({ country: form });
      expect(parsed.country).toBe(form);
    });
  }

  /**
   * #53 — the one country value the registry answers wrongly rather than loudly is a
   * blank one, which returns all 3,561 organizations. It is rejected in the handler
   * rather than by a schema pattern, so the schema still parses it: pinning that here
   * keeps the two halves from being conflated into a pattern this route cannot take.
   */
  it('parses an empty country and leaves rejecting it to the handler', () => {
    expect(gbifSearchPublishers.input.parse({ country: '' }).country).toBe('');
  });
});

describe('Oversized input handling', () => {
  const mockSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearch,
      searchSpecies: mockSearch,
      searchDatasets: mockSearch,
      searchPublishers: mockSearch,
    } as never);
    mockSearch.mockResolvedValue(makeOccurrenceResponse());
  });

  it('gbif_search_occurrences handles very long scientificName string', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ scientificName: 'A'.repeat(5000) });
    expect(input.scientificName).toHaveLength(5000);

    const result = await gbifSearchOccurrences.handler(input, ctx);
    expect(result.occurrences).toBeDefined();
  });

  it('gbif_search_species handles very long q string', async () => {
    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ q: 'B'.repeat(5000) });
    const result = await gbifSearchSpecies.handler(input, ctx);
    expect(result.taxa).toBeDefined();
  });

  it('gbif_occurrence_facets rejects facetLimit > 100', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', facetLimit: 101 })).toThrow();
  });

  it('gbif_occurrence_facets rejects facetLimit < 1', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', facetLimit: 0 })).toThrow();
  });

  it('gbif_search_occurrences rejects limit > 300', () => {
    expect(() => gbifSearchOccurrences.input.parse({ limit: 301 })).toThrow();
  });

  it('gbif_search_occurrences rejects limit < 1', () => {
    expect(() => gbifSearchOccurrences.input.parse({ limit: 0 })).toThrow();
  });

  it('gbif_search_species rejects limit > 1000', () => {
    expect(() => gbifSearchSpecies.input.parse({ limit: 1001 })).toThrow();
  });
});

describe('Required field validation', () => {
  it('gbif_get_occurrence requires occurrenceKey', () => {
    expect(() => gbifGetOccurrence.input.parse({})).toThrow();
  });

  it('gbif_get_species requires taxonKey', () => {
    expect(() => gbifGetSpecies.input.parse({})).toThrow();
  });

  it('gbif_get_dataset requires datasetKey', () => {
    expect(() => gbifGetDataset.input.parse({})).toThrow();
  });

  it('gbif_match_species requires name', () => {
    expect(() => gbifMatchSpecies.input.parse({})).toThrow();
  });

  it('gbif_occurrence_facets requires facet', () => {
    expect(() => gbifOccurrenceFacets.input.parse({})).toThrow();
  });

  it('gbif_occurrence_facets rejects invalid facet value', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'INVALID_DIMENSION' })).toThrow();
  });

  it('gbif_occurrence_facets rejects invalid basisOfRecord value', () => {
    expect(() =>
      gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', basisOfRecord: 'UNKNOWN_VALUE' }),
    ).toThrow();
  });

  it('gbif_search_datasets rejects invalid type value', () => {
    expect(() => gbifSearchDatasets.input.parse({ type: 'INVALID_TYPE' })).toThrow();
  });

  it('gbif_get_occurrence requires integer occurrenceKey', () => {
    expect(() => gbifGetOccurrence.input.parse({ occurrenceKey: 'abc' })).toThrow();
  });

  it('gbif_get_species requires integer taxonKey', () => {
    expect(() => gbifGetSpecies.input.parse({ taxonKey: 'abc' })).toThrow();
  });
});

describe('Secret non-leakage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The handlers have no try/catch — an upstream failure propagates untouched
   * and the framework classifies and masks it. So the testable invariant is
   * identity: the thrown value is the service's own error, with nothing about
   * the request or environment attached on the way out. Asserting only that a
   * benign fixture message lacks credential-shaped text would pass against any
   * implementation.
   */
  it('gbif_count_occurrences propagates the upstream error without attaching config', async () => {
    const upstream = new Error('Service error from upstream');
    vi.mocked(getGbifService).mockReturnValue({
      countOccurrences: vi.fn().mockRejectedValue(upstream),
    } as never);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 1 });

    const err = await gbifCountOccurrences.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toBe(upstream);
    expect(JSON.stringify({ message: (err as Error).message, ...(err as object) })).not.toMatch(
      /API_KEY|SECRET|PASSWORD|TOKEN/i,
    );
  });

  it('gbif_search_occurrences propagates the upstream error without appending env values', async () => {
    const upstream = new Error('Internal failure at /home/app/src');
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: vi.fn().mockRejectedValue(upstream),
    } as never);

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({});

    const err = await gbifSearchOccurrences.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toBe(upstream);
    expect((err as Error).message).toBe('Internal failure at /home/app/src');
  });
});
