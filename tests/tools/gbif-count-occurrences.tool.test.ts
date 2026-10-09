/**
 * @fileoverview Tests for gbif_count_occurrences tool.
 * @module tests/tools/gbif-count-occurrences.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifCountOccurrences } from '@/mcp-server/tools/definitions/gbif-count-occurrences.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** EOD – eBird Observation Dataset. */
const EBIRD_KEY = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e';

describe('gbifCountOccurrences', () => {
  const mockCountOccurrences = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ countOccurrences: mockCountOccurrences } as never);
  });

  it('returns count for taxon + country filters', async () => {
    mockCountOccurrences.mockResolvedValue(42000);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 5231190, country: 'GB' });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(42000);
    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ taxonKey: 5231190, country: 'GB' }),
      ctx,
    );
  });

  it('returns count with no filters', async () => {
    mockCountOccurrences.mockResolvedValue(2400000000);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({});
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(2400000000);
  });

  it('returns zero count', async () => {
    mockCountOccurrences.mockResolvedValue(0);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 9999999 });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(0);
  });

  it('passes isGeoreferenced filter', async () => {
    mockCountOccurrences.mockResolvedValue(1000);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ isGeoreferenced: true });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ isGeoreferenced: true }),
      ctx,
    );
  });

  it('passes datasetKey and year filters', async () => {
    mockCountOccurrences.mockResolvedValue(500);

    const ctx = createMockContext({ errors: gbifCountOccurrences.errors });
    const input = gbifCountOccurrences.input.parse({
      datasetKey: EBIRD_KEY,
      year: '2020,2024',
    });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ datasetKey: EBIRD_KEY, year: '2020,2024' }),
      ctx,
    );
  });

  /**
   * A malformed dataset key is rejected before any request so the failure carries
   * this tool's recovery hint rather than arriving as a bare upstream 400 (#38).
   */
  it('rejects a non-UUID datasetKey without issuing a request', async () => {
    const result = await runToolContract(gbifCountOccurrences, { datasetKey: 'eBird' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        data: {
          reason: 'invalid_filter',
          recovery: {
            hint: 'A blank filter is not a way to skip one — omit the field instead. Otherwise: supply datasetKey as the 8-4-4-4-12 hex UUID gbif_search_datasets returns; year is a single year or a "min,max" range; country and publishingCountry are codes GBIF assigns, so take one from a COUNTRY or PUBLISHING_COUNTRY facet on gbif_occurrence_facets.',
          },
        },
      },
    });
    expect(mockCountOccurrences).not.toHaveBeenCalled();
  });

  /**
   * #53 — the guard used to fire on a non-blank value, so an empty string cleared it
   * and the forward alike and the count ran unscoped. Measured on the built server:
   * `taxonKey=212` with `datasetKey: ""` counts 2,351,689,943, identical to the same
   * call with no datasetKey at all, where the eBird key counts 1,775,781,186. A count
   * is the whole output here, so nothing else in the response contradicts it.
   */
  it('rejects an empty datasetKey instead of counting every dataset', async () => {
    const ctx = createMockContext({ errors: gbifCountOccurrences.errors });
    const input = gbifCountOccurrences.input.parse({ taxonKey: 212, datasetKey: '' });
    expect(input.datasetKey).toBe('');

    const err = await gbifCountOccurrences.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect((err as Error).message).toContain('datasetKey');
    expect(mockCountOccurrences).not.toHaveBeenCalled();
  });

  /** Omitting the field is still how a caller counts across every dataset. */
  it('omits datasetKey when not provided', async () => {
    mockCountOccurrences.mockResolvedValue(2351689943);

    const ctx = createMockContext({ errors: gbifCountOccurrences.errors });
    await gbifCountOccurrences.handler(gbifCountOccurrences.input.parse({ taxonKey: 212 }), ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ datasetKey: expect.anything() }),
      ctx,
    );
  });

  /**
   * #36 — GBIF counts absence records alongside sightings, and for some taxa they
   * dominate: taxonKey 2263005 (Radicipes gracilis) is 2,351,582 records of which
   * 79 are PRESENT. The count tool therefore filters to PRESENT unless told
   * otherwise, matching gbif_search_occurrences so the two never disagree.
   */
  it('filters to PRESENT by default and says so', async () => {
    mockCountOccurrences.mockResolvedValue(79);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 2263005 });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(79);
    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceStatus: 'PRESENT' }),
      ctx,
    );

    const enrichment = getEnrichment(ctx);
    expect(enrichment.occurrenceStatus).toBe('PRESENT');
    expect(enrichment.notice).toContain('Absence records');
    expect(enrichment.notice).toContain('ANY');
  });

  /**
   * GBIF has no term meaning "either", so ANY has to reach the service as an
   * omitted parameter — sending the literal string draws HTTP 400.
   */
  it('omits the filter entirely for ANY and drops the exclusion notice', async () => {
    mockCountOccurrences.mockResolvedValue(2351582);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({
      taxonKey: 2263005,
      occurrenceStatus: 'ANY',
    });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(2351582);
    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ occurrenceStatus: expect.anything() }),
      ctx,
    );

    const enrichment = getEnrichment(ctx);
    expect(enrichment.occurrenceStatus).toBe('ANY');
    // ANY applies no filter, so the exclusion announcement drops. What remains is the
    // over-cap guidance — 2,351,582 is well past what gbif_search_occurrences can page.
    expect(enrichment.notice as string).not.toContain('Absence records');
    expect(enrichment.notice as string).toContain('DATASET_KEY');
  });

  it('passes ABSENT through and announces that the count is not sightings', async () => {
    mockCountOccurrences.mockResolvedValue(2351503);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({
      taxonKey: 2263005,
      occurrenceStatus: 'ABSENT',
    });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceStatus: 'ABSENT' }),
      ctx,
    );
    expect(getEnrichment(ctx).notice).toContain('not sightings');
  });

  /**
   * #33 — a count is where a caller decides between paging and partitioning, and it
   * is the cheapest place to learn that paging cannot finish. Below the cap the
   * guidance would be noise, so it is bounded by the same boundary the search guard
   * enforces.
   */
  it('flags a count paging cannot reach and names the partition route', async () => {
    mockCountOccurrences.mockResolvedValue(60290950);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 212, country: 'GB' });
    await gbifCountOccurrences.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('60,290,950');
    expect(notice).toContain('DATASET_KEY');
    expect(notice).toContain('Absence records');
  });

  it('leaves a reachable count unflagged', async () => {
    mockCountOccurrences.mockResolvedValue(100001);

    const ctx = createMockContext();
    await gbifCountOccurrences.handler(gbifCountOccurrences.input.parse({}), ctx);

    expect(getEnrichment(ctx).notice as string).not.toContain('DATASET_KEY');
  });

  /**
   * #49 — the count tool has to accept the same filters as gbif_search_occurrences,
   * or the two answer different questions on inputs a caller believes are identical.
   * Both run against /occurrence/search, so the narrowing verified there holds here:
   * on taxonKey=212 + country=GB + PRESENT, publishingCountry=US gives 1,548,928
   * against a 60,290,950 baseline.
   */
  it('forwards publishingCountry and stateProvince to the service', async () => {
    mockCountOccurrences.mockResolvedValue(508756);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({
      taxonKey: 212,
      country: 'GB',
      publishingCountry: 'US',
      stateProvince: 'England',
    });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'GB',
        publishingCountry: 'US',
        stateProvince: 'England',
      }),
      ctx,
    );
  });

  it('omits publishingCountry and stateProvince when not provided', async () => {
    mockCountOccurrences.mockResolvedValue(1);

    const ctx = createMockContext();
    await gbifCountOccurrences.handler(gbifCountOccurrences.input.parse({ taxonKey: 212 }), ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ publishingCountry: expect.anything() }),
      ctx,
    );
    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ stateProvince: expect.anything() }),
      ctx,
    );
  });

  /**
   * #54 — the forward tested `?.trim()`, so a blank stateProvince was dropped and the
   * count covered the whole surrounding scope. Measured on the built server:
   * `taxonKey=212` + `country=GB` + `occurrenceStatus=PRESENT` counts 47,672,439 under
   * `stateProvince: "England"` and 60,290,950 under `""` or a whitespace-only value,
   * which is the figure the same call returns with the field omitted. A count is the
   * whole output here, so nothing else in the response contradicts the wrong figure.
   */
  it.each(['', '   '])(
    'rejects stateProvince "%s" instead of counting the whole scope',
    async (blank) => {
      const ctx = createMockContext({ errors: gbifCountOccurrences.errors });
      const input = gbifCountOccurrences.input.parse({
        taxonKey: 212,
        country: 'GB',
        stateProvince: blank,
      });
      expect(input.stateProvince).toBe(blank);

      const err = await gbifCountOccurrences.handler(input, ctx).catch((e: unknown) => e);

      expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
      expect((err as Error).message).toContain('stateProvince');
      expect(mockCountOccurrences).not.toHaveBeenCalled();
    },
  );

  /** Omitting is still the way to count across every year. */
  it('omits year when not provided', async () => {
    mockCountOccurrences.mockResolvedValue(1);

    const ctx = createMockContext({ errors: gbifCountOccurrences.errors });
    await gbifCountOccurrences.handler(gbifCountOccurrences.input.parse({ taxonKey: 212 }), ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ year: expect.anything() }),
      ctx,
    );
  });

  /** A lowercase or alpha-3 code counts zero upstream rather than erroring. */
  it('rejects publishingCountry forms GBIF would answer with a silent zero', () => {
    for (const bad of ['us', 'USA', 'United States', 'U', 'GBR', '']) {
      expect(() => gbifCountOccurrences.input.parse({ publishingCountry: bad })).toThrow();
    }
    expect(() => gbifCountOccurrences.input.parse({ publishingCountry: 'US' })).not.toThrow();
  });

  /**
   * #50 — a zero count is the worst place for the silent case to land, since the
   * whole output is the number. Against taxonKey=212 + occurrenceStatus=PRESENT,
   * `GB` counts 60,290,950 while `gb`, `Us`, `USA`, and `gb ` each count 0, and an
   * empty string was dropped by the handler into an unfiltered count. `Britain`
   * and ` GB` are in the list on shape rather than silence — the first draws an
   * upstream 400, the second is trimmed upstream and answers correctly — so the
   * schema states one accepted form rather than one form plus whatever GBIF
   * happens to tolerate.
   */
  it('rejects country forms outside the canonical uppercase alpha-2 shape', () => {
    for (const bad of ['gb', 'Us', 'uS', 'USA', 'GBR', 'Britain', 'gb ', ' GB', '']) {
      expect(() => gbifCountOccurrences.input.parse({ country: bad })).toThrow();
    }
    expect(() => gbifCountOccurrences.input.parse({ country: 'GB' })).not.toThrow();
  });

  /**
   * A zero count is the shape that misleads hardest here: it reads as "this region
   * holds nothing" when it may only mean the verbatim string was misspelled.
   */
  it('flags a zero count under a stateProvince filter as possibly a misspelling', async () => {
    mockCountOccurrences.mockResolvedValue(0);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 212, stateProvince: 'england' });
    await gbifCountOccurrences.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('england');
    expect(notice).toContain('STATE_PROVINCE');
    expect(notice).toMatch(/case-sensitive/i);
  });

  it('leaves the stateProvince guidance off a count that matched', async () => {
    mockCountOccurrences.mockResolvedValue(47672439);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 212, stateProvince: 'England' });
    await gbifCountOccurrences.handler(input, ctx);

    expect(getEnrichment(ctx).notice as string).not.toMatch(/case-sensitive/i);
  });

  it('does not fire the stateProvince guidance on a zero count without the filter', async () => {
    mockCountOccurrences.mockResolvedValue(0);

    const ctx = createMockContext();
    await gbifCountOccurrences.handler(gbifCountOccurrences.input.parse({ taxonKey: 212 }), ctx);

    expect((getEnrichment(ctx).notice as string) ?? '').not.toMatch(/case-sensitive/i);
  });

  it('keeps country and publishingCountry apart in both descriptions', () => {
    const country = gbifCountOccurrences.input.shape.country.description ?? '';
    const publishing = gbifCountOccurrences.input.shape.publishingCountry.description ?? '';
    expect(country).toContain('publishingCountry');
    expect(publishing).toContain('country');
    expect(publishing).toMatch(/published/i);
  });

  it('states the PRESENT default in the schema so tools/list carries it', () => {
    const described = gbifCountOccurrences.input.shape.occurrenceStatus.description ?? '';
    expect(described).toContain('PRESENT');
    expect(described).toContain('ANY');
    expect(gbifCountOccurrences.input.parse({}).occurrenceStatus).toBe('PRESENT');
  });

  // #37 — the IUCN filter reaches the service, and only as a category GBIF indexes.
  it('passes iucnRedListCategory to the service', async () => {
    mockCountOccurrences.mockResolvedValue(4989);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({
      taxonKey: 5219404,
      iucnRedListCategory: 'VU',
    });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ iucnRedListCategory: 'VU' }),
      ctx,
    );
  });

  it('omits iucnRedListCategory when not provided', async () => {
    mockCountOccurrences.mockResolvedValue(0);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 5219404 });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ iucnRedListCategory: expect.anything() }),
      ctx,
    );
  });

  /**
   * GBIF answers an unrecognized iucnRedListCategory with HTTP 200 and a count of
   * zero rather than an error, so the schema enum is the only thing standing
   * between a caller typo and a confident empty answer. NE is rejected on the same
   * grounds: it matches no record in the index.
   */
  it('rejects a category GBIF would answer with a silent zero', () => {
    expect(() => gbifCountOccurrences.input.parse({ iucnRedListCategory: 'VULNERABLE' })).toThrow();
    expect(() => gbifCountOccurrences.input.parse({ iucnRedListCategory: 'vu' })).toThrow();
    expect(() => gbifCountOccurrences.input.parse({ iucnRedListCategory: 'NE' })).toThrow();
    expect(() => gbifCountOccurrences.input.parse({ iucnRedListCategory: 'VU' })).not.toThrow();
  });

  it('rejects an occurrenceStatus outside the accepted three', () => {
    expect(() => gbifCountOccurrences.input.parse({ occurrenceStatus: 'BOGUS' })).toThrow();
    expect(() => gbifCountOccurrences.input.parse({ occurrenceStatus: 'present' })).toThrow();
  });

  /**
   * #48 — a caller scoping a count to a dataset is the one most likely to set it
   * against the dataset tools' recordCount, which spans every occurrenceStatus.
   * The pointer has to run in this direction too, not only from the dataset side.
   */
  it('warns on datasetKey that the dataset recordCount is scoped differently', () => {
    const description = gbifCountOccurrences.input.shape.datasetKey.description ?? '';

    expect(description).toContain('recordCount');
    expect(description).toContain('occurrenceStatus');
  });

  it('formats count as text', () => {
    const blocks = gbifCountOccurrences.format!({ count: 42000 });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('42000');
  });
});
