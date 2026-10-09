/**
 * @fileoverview Tests for gbif_search_occurrences tool.
 * @module tests/tools/gbif-search-occurrences.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifSearchOccurrences } from '@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

const makeOccurrence = (overrides = {}) => ({
  key: 1000000001,
  taxonKey: 5231190,
  scientificName: 'Parus major Linnaeus, 1758',
  canonicalName: 'Parus major',
  taxonRank: 'SPECIES',
  decimalLatitude: 51.5,
  decimalLongitude: -0.1,
  coordinateUncertaintyInMeters: 100,
  country: 'United Kingdom',
  countryCode: 'GB',
  stateProvince: 'England',
  locality: 'Hyde Park',
  eventDate: '2024-05-01',
  year: 2024,
  month: 5,
  day: 1,
  basisOfRecord: 'HUMAN_OBSERVATION',
  datasetKey: 'abc-123',
  datasetName: 'eBird',
  publishingCountry: 'US',
  recordedBy: 'J. Smith',
  issues: [],
  ...overrides,
});

describe('gbifSearchOccurrences', () => {
  const mockSearchOccurrences = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearchOccurrences,
    } as never);
  });

  it('returns occurrences and enrichment with pagination metadata', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [makeOccurrence()],
      count: 500000,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 5231190 });
    const result = await gbifSearchOccurrences.handler(input, ctx);

    expect(result.occurrences).toHaveLength(1);
    const occ = result.occurrences[0];
    expect(occ.key).toBe(1000000001);
    expect(occ.taxonKey).toBe(5231190);
    expect(occ.rank).toBe('SPECIES'); // normalized from taxonRank
    expect(occ.country).toBe('United Kingdom');

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(500000);
    expect(enrichment.endOfRecords).toBe(false);
    expect(enrichment.offset).toBe(0);
    expect(enrichment.limit).toBe(20);
    // The PRESENT default is announced, so a successful page still carries a notice.
    expect(enrichment.occurrenceStatus).toBe('PRESENT');
    expect(enrichment.notice).toContain('Absence records');
  });

  it('normalizes taxonRank to rank', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [makeOccurrence({ taxonRank: 'GENUS' })],
      count: 1,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({});
    const result = await gbifSearchOccurrences.handler(input, ctx);

    expect(result.occurrences[0].rank).toBe('GENUS');
  });

  it('enriches with notice on empty results', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 99999 });
    const result = await gbifSearchOccurrences.handler(input, ctx);

    expect(result.occurrences).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('No occurrences matched');
  });

  it('enriches with notice on pagination overshoot', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 5,
      offset: 10,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ offset: 10 });
    await gbifSearchOccurrences.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('Offset 10 exceeds totalCount');
  });

  /**
   * #42 — GBIF serves offset+limit up to 100,001 and answers
   * `Max offset of 100001 exceeded` at 100,002. The guard sits on that boundary,
   * so the 99,001–100,001 band it used to reject now reaches GBIF.
   */
  it('serves the deepest page GBIF accepts', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 3000000000,
      offset: 99701,
      limit: 300,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ offset: 99701, limit: 300 });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 99701, limit: 300 }),
      ctx,
    );
  });

  it('throws pagination_cap_exceeded one record past the boundary', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ offset: 99702, limit: 300 });

    const err = await gbifSearchOccurrences.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'pagination_cap_exceeded' } });
    expect(mockSearchOccurrences).not.toHaveBeenCalled();
    // The message must name the enforced boundary, not one the failing sum sits below.
    expect((err as Error).message).toContain('100,001');
    expect((err as Error).message).toContain('100002');
  });

  it('states the same cap in the tool and offset descriptions', () => {
    expect(gbifSearchOccurrences.description).toContain('100,001');
    expect(gbifSearchOccurrences.input.shape.offset.description).toContain('100,001');
    expect(gbifSearchOccurrences.description).not.toMatch(/approximately/i);
  });

  /**
   * #33 — the cap has no continuation path, so the recovery has to hand back a
   * technique rather than redirect to an aggregate tool. It carries the wire hint
   * a `content[]`-only client reads, which is the only place this reaches an agent
   * that hit the wall.
   */
  it('recovers the cap failure with the partition technique, not a redirect to facets', async () => {
    const result = await runToolContract(gbifSearchOccurrences, { offset: 99702, limit: 300 });
    const error = (
      result.structuredContent as {
        error: { code: number; data: { reason: string; recovery: { hint: string } } };
      }
    ).error;
    const hint = error.data.recovery.hint;

    expect(result.isError).toBe(true);
    expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
    expect(error.data.reason).toBe('pagination_cap_exceeded');
    expect(hint).toBe(
      gbifSearchOccurrences.errors?.find((e) => e.reason === 'pagination_cap_exceeded')?.recovery,
    );
    expect(hint).toContain('DATASET_KEY');
    expect(hint).toContain('facetOffset');
    expect(hint).toMatch(/no cursor or scroll/i);
    // The exhaustiveness distinction: YEAR loses undated records, datasetKey does not.
    expect(hint).toMatch(/YEAR/);
    // A caller must not read the cap as "this server can fetch it another way".
    expect(hint).toMatch(/GBIF\.org account/);
    expect(hint).toContain('AWS Open Data');
    // Partition arithmetic is against the presence-scoped total this tool applies.
    expect(hint).toContain('PRESENT');
    // gbif_occurrence_facets takes fewer filters than this tool, so a partition plan
    // built from a facet call that dropped them covers a wider scope than was asked for.
    expect(hint).toMatch(/repeating this search's filters/i);
    expect(hint).toContain('coordinate-uncertainty');
    expect(hint).toContain('BASIS_OF_RECORD');
  });

  /**
   * A dimension is only a usable split axis if this tool can filter on it, so every
   * facet dimension the hint puts forward as an axis needs a matching input here —
   * otherwise the recovery hands back a partition no caller could execute. Asserted
   * as that invariant rather than as a fixed list: #49 added the publishingCountry
   * filter that had kept PUBLISHING_COUNTRY out of the hint, and the two sides have
   * to move together or not at all.
   */
  it('names only split dimensions this tool can filter on', () => {
    const hint =
      gbifSearchOccurrences.errors?.find((e) => e.reason === 'pagination_cap_exceeded')?.recovery ??
      '';
    const inputs = Object.keys(gbifSearchOccurrences.input.shape);
    for (const [dimension, filter] of [
      ['DATASET_KEY', 'datasetKey'],
      ['BASIS_OF_RECORD', 'basisOfRecord'],
      ['PUBLISHING_COUNTRY', 'publishingCountry'],
    ] as const) {
      expect(hint).toContain(dimension);
      expect(inputs).toContain(filter);
    }
    /**
     * SPECIES_KEY appears only in the warning about dimensions that drop records.
     * taxonKey is not an equivalent filter, so it must never be offered as an axis.
     */
    expect(hint).not.toMatch(/split[^.]*SPECIES_KEY/i);
  });

  /**
   * #49 — stateProvince became filterable, but records carrying no stateProvince
   * still fall outside every bucket, so it stays disqualified as a split axis.
   * "Can filter on it" and "can partition with it" are separate properties, and the
   * hint has to keep them apart now that the first one changed.
   */
  it('keeps STATE_PROVINCE named as lossy even though it is now filterable', () => {
    const hint =
      gbifSearchOccurrences.errors?.find((e) => e.reason === 'pagination_cap_exceeded')?.recovery ??
      '';
    expect(Object.keys(gbifSearchOccurrences.input.shape)).toContain('stateProvince');
    expect(hint).toMatch(/MONTH, STATE_PROVINCE, and SPECIES_KEY lose records/);
  });

  it('announces an unreachable result set on the first page rather than after hundreds', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [makeOccurrence()],
      count: 60290950,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 212, country: 'GB' });
    await gbifSearchOccurrences.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('60,290,950');
    expect(notice).toContain('DATASET_KEY');
    // The presence/absence announcement still rides alongside it.
    expect(notice).toContain('Absence records');
  });

  it('leaves the over-cap guidance off a result set paging can finish', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [makeOccurrence()],
      count: 100001,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    await gbifSearchOccurrences.handler(gbifSearchOccurrences.input.parse({}), ctx);

    expect(getEnrichment(ctx).notice as string).not.toContain('DATASET_KEY');
  });

  /** #38 — a malformed datasetKey fails locally with guidance rather than as a bare 400. */
  it('rejects a non-UUID datasetKey without issuing a request', async () => {
    const result = await runToolContract(gbifSearchOccurrences, { datasetKey: 'eBird' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        data: {
          reason: 'invalid_filter',
          recovery: {
            hint: 'The message names the rejected value. A blank filter is not a way to skip one — omit the field instead. Otherwise correct that one filter: geometry is a closed WKT ring in longitude latitude order, ranges are "min,max", datasetKey is a UUID from gbif_search_datasets, and country and publishingCountry are codes GBIF assigns, so take one from a COUNTRY or PUBLISHING_COUNTRY facet on gbif_occurrence_facets.',
          },
        },
      },
    });
    expect(mockSearchOccurrences).not.toHaveBeenCalled();
  });

  /**
   * #53 — the guard used to fire on a non-blank value, so an empty string cleared it
   * and the forward alike and the search ran unscoped. Measured on the built server:
   * `taxonKey=212` with `datasetKey: ""` returns 2,351,689,943 records and occurrence
   * 1291505203 as the first, identical to the same call with no datasetKey at all,
   * where the eBird key returns 1,775,781,186. The caller sees a scoped query and
   * gets an unscoped answer, which is worse than the one retry a rejection costs.
   */
  it('rejects an empty datasetKey instead of searching every dataset', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 212, datasetKey: '' });
    expect(input.datasetKey).toBe('');

    const err = await gbifSearchOccurrences.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect((err as Error).message).toContain('datasetKey');
    expect(mockSearchOccurrences).not.toHaveBeenCalled();
  });

  it('handles sparse occurrence records', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [{ key: 999, taxonKey: 5231190 }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({});
    const result = await gbifSearchOccurrences.handler(input, ctx);

    const occ = result.occurrences[0];
    expect(occ.key).toBe(999);
    expect(occ.decimalLatitude).toBeUndefined();
    expect(occ.decimalLongitude).toBeUndefined();
    expect(occ.eventDate).toBeUndefined();
    expect(occ.issues).toBeUndefined();
  });

  it('omits issues when empty array', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [makeOccurrence({ issues: [] })],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({});
    const result = await gbifSearchOccurrences.handler(input, ctx);

    expect(result.occurrences[0].issues).toBeUndefined();
  });

  it('formats output including key fields', () => {
    const output = {
      occurrences: [
        {
          key: 1000000001,
          taxonKey: 5231190,
          canonicalName: 'Parus major',
          scientificName: 'Parus major Linnaeus, 1758',
          rank: 'SPECIES',
          basisOfRecord: 'HUMAN_OBSERVATION',
          eventDate: '2024-05-01',
          year: 2024,
          decimalLatitude: 51.5,
          decimalLongitude: -0.1,
          country: 'United Kingdom',
          countryCode: 'GB',
          datasetKey: 'abc-123',
          datasetName: 'eBird',
        },
      ],
    };
    const blocks = gbifSearchOccurrences.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('1000000001');
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('HUMAN_OBSERVATION');
  });

  it('formats coordinates as Not available when absent', () => {
    const output = {
      occurrences: [{ key: 1, canonicalName: 'Parus major' }],
    };
    const blocks = gbifSearchOccurrences.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Not available');
  });

  // #12: coordinateUncertaintyInMeters filter is accepted and passed to service
  it('passes coordinateUncertaintyInMeters to the service', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({
      coordinateUncertaintyInMeters: '0,100',
    });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ coordinateUncertaintyInMeters: '0,100' }),
      ctx,
    );
  });

  it('omits coordinateUncertaintyInMeters when not provided', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 5231190 });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ coordinateUncertaintyInMeters: expect.anything() }),
      ctx,
    );
  });

  // #25: datasetKey filter is accepted and passed to the service
  it('passes datasetKey to the service', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({
      taxonKey: 9705453,
      datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
    });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e' }),
      ctx,
    );
  });

  it('omits datasetKey when not provided', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 9705453 });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ datasetKey: expect.anything() }),
      ctx,
    );
  });

  /**
   * #49 — PUBLISHING_COUNTRY and STATE_PROVINCE were facet dimensions with no
   * matching filter on any occurrence tool, so their buckets were a dead end.
   * Verified live on taxonKey=212 + country=GB + occurrenceStatus=PRESENT
   * (60,290,950 records): publishingCountry=US narrows to 1,548,928 and
   * stateProvince=England to 47,672,439.
   */
  it('forwards publishingCountry and stateProvince to the service', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 508756,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({
      taxonKey: 212,
      country: 'GB',
      publishingCountry: 'US',
      stateProvince: 'England',
    });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'GB',
        publishingCountry: 'US',
        stateProvince: 'England',
      }),
      ctx,
    );
  });

  it('omits publishingCountry and stateProvince when not provided', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    await gbifSearchOccurrences.handler(gbifSearchOccurrences.input.parse({ taxonKey: 212 }), ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ publishingCountry: expect.anything() }),
      ctx,
    );
    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ stateProvince: expect.anything() }),
      ctx,
    );
  });

  /**
   * #54 — the forward tested `?.trim()`, so a blank stateProvince was dropped and the
   * search ran against the whole surrounding scope. Measured on the built server:
   * `taxonKey=212` + `country=GB` + `occurrenceStatus=PRESENT` returns 47,672,439
   * records under `stateProvince: "England"` and 60,290,950 under `""`, which is the
   * figure the same call returns with the field omitted. A whitespace-only value
   * returns 60,290,950 too. The caller sees a query scoped to one state or province
   * and gets the whole country.
   */
  it.each(['', '   '])(
    'rejects stateProvince "%s" instead of searching the whole scope',
    async (blank) => {
      const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
      const input = gbifSearchOccurrences.input.parse({
        taxonKey: 212,
        country: 'GB',
        stateProvince: blank,
      });
      expect(input.stateProvince).toBe(blank);

      const err = await gbifSearchOccurrences.handler(input, ctx).catch((e: unknown) => e);

      expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
      expect((err as Error).message).toContain('stateProvince');
      expect(mockSearchOccurrences).not.toHaveBeenCalled();
    },
  );

  /**
   * Omitting is still the way to leave a filter off, for every string filter at
   * once — the guard rejects blank values, it does not require the fields.
   */
  it('sends no string filter at all when the caller supplies none', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    await gbifSearchOccurrences.handler(gbifSearchOccurrences.input.parse({ taxonKey: 212 }), ctx);

    const sent = mockSearchOccurrences.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const field of [
      'scientificName',
      'stateProvince',
      'decimalLatitude',
      'decimalLongitude',
      'geometry',
      'year',
      'coordinateUncertaintyInMeters',
    ]) {
      expect(sent).not.toHaveProperty(field);
    }
    expect(sent).toMatchObject({ taxonKey: 212 });
  });

  /**
   * GBIF splits its rejection of a bad country code: `XX` answers HTTP 400, but a
   * lowercase or alpha-3 form answers 200 with zero records — a confident wrong
   * number. The vocabulary is closed, so the schema carries a pattern and every
   * silent case fails locally instead.
   */
  it('rejects publishingCountry forms GBIF would answer with a silent zero', () => {
    for (const bad of ['us', 'USA', 'United States', 'U', 'GBR', '']) {
      expect(() =>
        gbifSearchOccurrences.input.parse({ taxonKey: 212, publishingCountry: bad }),
      ).toThrow();
    }
    expect(() =>
      gbifSearchOccurrences.input.parse({ taxonKey: 212, publishingCountry: 'US' }),
    ).not.toThrow();
  });

  /**
   * #50 — `country` was the last filter here answering a malformed value with a
   * confident wrong number. Against taxonKey=212 + occurrenceStatus=PRESENT, `GB`
   * matches 60,290,950 records while `gb`, `Us`, `USA`, and `gb ` each match none.
   * The empty string was the worse case: the handler's `?.trim()` guard dropped it,
   * so a caller who believed they had filtered by country got the unfiltered total.
   * `Britain` and ` GB` are in the list on shape rather than silence — the first
   * draws an upstream 400, the second is trimmed upstream and answers correctly —
   * so the schema states one accepted form rather than one form plus whatever
   * GBIF happens to tolerate.
   */
  it('rejects country forms outside the canonical uppercase alpha-2 shape', () => {
    for (const bad of ['gb', 'Us', 'uS', 'USA', 'GBR', 'Britain', 'gb ', ' GB', '']) {
      expect(() => gbifSearchOccurrences.input.parse({ taxonKey: 212, country: bad })).toThrow();
    }
    expect(() => gbifSearchOccurrences.input.parse({ taxonKey: 212, country: 'GB' })).not.toThrow();
  });

  /**
   * stateProvince has no vocabulary to validate against — GBIF stores each dataset's
   * verbatim string, so no pattern separates a typo from a real value and an
   * unmatched one returns zero records rather than an error. The guard is therefore
   * a notice on the empty result, which is the only thing that lets a caller tell a
   * misspelling from a region that genuinely holds nothing.
   */
  it('flags an empty result under a stateProvince filter as possibly a misspelling', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 212, stateProvince: 'england' });
    await gbifSearchOccurrences.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('england');
    expect(notice).toContain('STATE_PROVINCE');
    expect(notice).toMatch(/case-sensitive/i);
  });

  it('leaves the stateProvince guidance off a result that matched', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [makeOccurrence()],
      count: 47672439,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 212, stateProvince: 'England' });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(getEnrichment(ctx).notice as string).not.toMatch(/case-sensitive/i);
  });

  it('does not fire the stateProvince guidance on an empty result without the filter', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    await gbifSearchOccurrences.handler(gbifSearchOccurrences.input.parse({ taxonKey: 212 }), ctx);

    expect(getEnrichment(ctx).notice as string).not.toMatch(/case-sensitive/i);
  });

  /**
   * The two country filters answer different questions and disagree on most records,
   * so each description has to name the other. A model reading one field in isolation
   * is exactly how the two get swapped.
   */
  it('keeps country and publishingCountry apart in both descriptions', () => {
    const country = gbifSearchOccurrences.input.shape.country.description ?? '';
    const publishing = gbifSearchOccurrences.input.shape.publishingCountry.description ?? '';
    expect(country).toContain('publishingCountry');
    expect(publishing).toContain('country');
    expect(publishing).toMatch(/published/i);
  });

  // #24: hasCoordinate=false means records-without-coordinates only; omit (not false) returns all
  it('documents hasCoordinate false as records-without-coordinates only', () => {
    const desc = gbifSearchOccurrences.input.shape.hasCoordinate.description ?? '';
    expect(desc).toContain('ONLY records without coordinates');
    expect(desc).toContain('Omit the parameter');
    // guard against the prior misleading wording (false claimed to include such records)
    expect(desc).not.toContain('When false, include records without coordinates');
  });
});

/**
 * #36 — GBIF's index carries absence records (a survey that looked for the taxon
 * and did not find it) alongside sightings, with the same coordinates, dates, and
 * recorder. Verified live: taxonKey 2263005 returns 2,351,582 records of which 79
 * are PRESENT. The tool filters to PRESENT unless told otherwise, and never
 * silently.
 */
describe('gbifSearchOccurrences occurrenceStatus (#36)', () => {
  const mockSearchOccurrences = vi.fn();

  const emptyPage = { results: [], count: 0, offset: 0, limit: 20, endOfRecords: true };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearchOccurrences,
    } as never);
    mockSearchOccurrences.mockResolvedValue(emptyPage);
  });

  it('sends PRESENT when the caller says nothing', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 2263005 });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceStatus: 'PRESENT' }),
      ctx,
    );
  });

  /**
   * GBIF's OccurrenceStatus vocabulary is exactly PRESENT and ABSENT — sending
   * "ANY" draws HTTP 400 `Cannot parse ANY into a known OccurrenceStatus`, so the
   * sentinel has to resolve to an omitted parameter.
   */
  it('omits the parameter for ANY rather than sending a term GBIF rejects', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({
      taxonKey: 2263005,
      occurrenceStatus: 'ANY',
    });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ occurrenceStatus: expect.anything() }),
      ctx,
    );
    const enrichment = getEnrichment(ctx);
    expect(enrichment.occurrenceStatus).toBe('ANY');
    expect(enrichment.notice).not.toContain('Absence records');
  });

  it('sends ABSENT and warns the page is not sightings', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ occurrenceStatus: 'ABSENT' });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceStatus: 'ABSENT' }),
      ctx,
    );
    expect(getEnrichment(ctx).notice).toContain('not sightings');
  });

  /**
   * The empty-result guidance and the presence/absence announcement can fire on
   * the same call — an over-narrow filter is exactly when a caller needs both.
   */
  it('keeps the empty-result guidance alongside the default announcement', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 99999 });
    await gbifSearchOccurrences.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('No occurrences matched');
    expect(notice).toContain('Absence records');
  });

  it('states the PRESENT default in the schema so tools/list carries it', () => {
    const described = gbifSearchOccurrences.input.shape.occurrenceStatus.description ?? '';
    expect(described).toContain('PRESENT');
    expect(described).toContain('ANY');
    expect(gbifSearchOccurrences.input.parse({}).occurrenceStatus).toBe('PRESENT');
  });

  it('rejects an occurrenceStatus outside the accepted three', () => {
    expect(() => gbifSearchOccurrences.input.parse({ occurrenceStatus: 'BOGUS' })).toThrow();
  });

  it('surfaces occurrenceStatus on the returned record', async () => {
    mockSearchOccurrences.mockResolvedValue({
      ...emptyPage,
      results: [makeOccurrence({ occurrenceStatus: 'ABSENT' })],
      count: 1,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ occurrenceStatus: 'ABSENT' });
    const result = await gbifSearchOccurrences.handler(input, ctx);

    expect(result.occurrences[0].occurrenceStatus).toBe('ABSENT');
  });

  /**
   * A `content[]`-only client never sees structuredContent, so an absence is
   * indistinguishable from a sighting unless format() renders the status.
   */
  it('renders occurrenceStatus in the text surface', () => {
    const blocks = gbifSearchOccurrences.format!({
      occurrences: [
        { key: 6222223951, canonicalName: 'Radicipes gracilis', occurrenceStatus: 'ABSENT' },
      ],
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('ABSENT');
  });
});

/** #37 — IUCN Red List category as a filter and an output field. */
describe('gbifSearchOccurrences iucnRedListCategory (#37)', () => {
  const mockSearchOccurrences = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearchOccurrences,
    } as never);
    mockSearchOccurrences.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });
  });

  it('passes the category to the service', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({
      taxonKey: 5219404,
      iucnRedListCategory: 'VU',
    });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ iucnRedListCategory: 'VU' }),
      ctx,
    );
  });

  it('omits the category when not provided', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ taxonKey: 5219404 });
    await gbifSearchOccurrences.handler(input, ctx);

    expect(mockSearchOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ iucnRedListCategory: expect.anything() }),
      ctx,
    );
  });

  /**
   * GBIF answers an unrecognized category with HTTP 200 and a count of zero, not
   * an error, so the enum is the only guard against a confident empty answer. NE
   * is excluded on the same grounds — it matches no record in the index.
   */
  it('rejects a category GBIF would answer with a silent zero', () => {
    expect(() =>
      gbifSearchOccurrences.input.parse({ iucnRedListCategory: 'VULNERABLE' }),
    ).toThrow();
    expect(() => gbifSearchOccurrences.input.parse({ iucnRedListCategory: 'NE' })).toThrow();
    expect(() => gbifSearchOccurrences.input.parse({ iucnRedListCategory: 'VU' })).not.toThrow();
  });

  it('surfaces and renders the category on a record', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [makeOccurrence({ iucnRedListCategory: 'VU' })],
      count: 1,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const result = await gbifSearchOccurrences.handler(gbifSearchOccurrences.input.parse({}), ctx);

    expect(result.occurrences[0].iucnRedListCategory).toBe('VU');
    const blocks = gbifSearchOccurrences.format!(result);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('IUCN Red List category');
    expect(text).toContain('VU');
  });
});

/** #44 — taxonomicStatus and eventTime, both populated upstream and both dropped. */
describe('gbifSearchOccurrences taxonomicStatus and eventTime (#44)', () => {
  const mockSearchOccurrences = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearchOccurrences,
    } as never);
  });

  it('surfaces both on a populated record', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [
        makeOccurrence({
          taxonomicStatus: 'PROVISIONALLY_ACCEPTED',
          eventDate: '2026-01-28T20:15',
          eventTime: '20:15:00+01:00',
        }),
      ],
      count: 1,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const result = await gbifSearchOccurrences.handler(gbifSearchOccurrences.input.parse({}), ctx);

    const occ = result.occurrences[0];
    expect(occ.taxonomicStatus).toBe('PROVISIONALLY_ACCEPTED');
    expect(occ.eventTime).toBe('20:15:00+01:00');
  });

  /**
   * eventTime is not a fallback for a missing eventDate time — in a 300-record
   * sample every record carrying eventTime also carried a timestamped eventDate.
   * What it adds is the UTC offset eventDate drops, so the text surface has to
   * render it even when a date is already shown.
   */
  it('renders the offset-bearing time alongside the date', () => {
    const blocks = gbifSearchOccurrences.format!({
      occurrences: [
        {
          key: 1,
          canonicalName: 'Parus major',
          taxonomicStatus: 'ACCEPTED',
          eventDate: '2026-01-28T20:15',
          eventTime: '20:15:00+01:00',
        },
      ],
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('2026-01-28T20:15');
    expect(text).toContain('20:15:00+01:00');
    expect(text).toContain('ACCEPTED');
  });

  it('leaves both absent on a sparse record', async () => {
    mockSearchOccurrences.mockResolvedValue({
      results: [{ key: 999 }],
      count: 1,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const result = await gbifSearchOccurrences.handler(gbifSearchOccurrences.input.parse({}), ctx);

    const occ = result.occurrences[0];
    expect(occ.taxonomicStatus).toBeUndefined();
    expect(occ.eventTime).toBeUndefined();
    expect(occ.occurrenceStatus).toBeUndefined();
    expect(occ.iucnRedListCategory).toBeUndefined();
  });
});
