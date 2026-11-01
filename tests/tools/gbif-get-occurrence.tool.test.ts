/**
 * @fileoverview Tests for gbif_get_occurrence tool.
 * @module tests/tools/gbif-get-occurrence.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetOccurrence } from '@/mcp-server/tools/definitions/gbif-get-occurrence.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifGetOccurrence', () => {
  const mockGetOccurrence = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getOccurrence: mockGetOccurrence } as never);
  });

  it('returns full occurrence record', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 1000000001,
      datasetKey: 'abc-123',
      taxonKey: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      order: 'Passeriformes',
      family: 'Paridae',
      genus: 'Parus',
      species: 'Parus major',
      taxonRank: 'SPECIES',
      decimalLatitude: 51.5,
      decimalLongitude: -0.1,
      coordinateUncertaintyInMeters: 100,
      continent: 'EUROPE',
      country: 'United Kingdom',
      countryCode: 'GB',
      stateProvince: 'England',
      locality: 'Hyde Park',
      publishingCountry: 'US',
      eventDate: '2024-05-01',
      year: 2024,
      month: 5,
      day: 1,
      basisOfRecord: 'HUMAN_OBSERVATION',
      institutionCode: 'RSPB',
      collectionCode: 'obs',
      catalogNumber: 'OBS-001',
      recordedBy: 'J. Smith',
      identifiedBy: 'J. Smith',
      individualCount: 2,
      sex: 'MALE',
      lifeStage: 'ADULT',
      issues: ['TAXON_MATCH_FUZZY'],
      media: [
        {
          type: 'StillImage',
          format: 'image/jpeg',
          identifier: 'https://example.com/photo.jpg',
          title: 'Great Tit photo',
          license: 'CC_BY_4_0',
        },
      ],
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 1000000001 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.key).toBe(1000000001);
    expect(result.taxonKey).toBe(5231190);
    expect(result.canonicalName).toBe('Parus major');
    expect(result.taxonRank).toBe('SPECIES');
    expect(result.decimalLatitude).toBe(51.5);
    expect(result.continent).toBe('EUROPE');
    expect(result.basisOfRecord).toBe('HUMAN_OBSERVATION');
    expect(result.institutionCode).toBe('RSPB');
    expect(result.sex).toBe('MALE');
    expect(result.lifeStage).toBe('ADULT');
    expect(result.issues).toEqual(['TAXON_MATCH_FUZZY']);
    expect(result.media).toHaveLength(1);
    expect(result.media![0].type).toBe('StillImage');
  });

  it('throws not_found when key is missing', async () => {
    mockGetOccurrence.mockResolvedValue({ key: undefined });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 9999999 });

    await expect(gbifGetOccurrence.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('omits issues when empty array', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 100,
      issues: [],
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 100 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.issues).toBeUndefined();
  });

  it('omits media when empty array', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 200,
      media: [],
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 200 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.media).toBeUndefined();
  });

  it('handles sparse upstream response', async () => {
    mockGetOccurrence.mockResolvedValue({ key: 300 });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 300 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.key).toBe(300);
    expect(result.decimalLatitude).toBeUndefined();
    expect(result.eventDate).toBeUndefined();
    expect(result.issues).toBeUndefined();
    expect(result.media).toBeUndefined();
    // Newly-exposed advertised fields (#27) are absent on a sparse record.
    expect(result.occurrenceID).toBeUndefined();
    expect(result.class).toBeUndefined();
    expect(result.classKey).toBeUndefined();
    expect(result.gadm).toBeUndefined();
    expect(result.identifiers).toBeUndefined();
  });

  it('exposes occurrenceID, class/classKey, gadm, and identifiers (#27)', async () => {
    // Mirrors GBIF occurrence 5938044864 (an iNaturalist Aves record from Sweden).
    mockGetOccurrence.mockResolvedValue({
      key: 5938044864,
      class: 'Aves',
      classKey: 212,
      occurrenceID: 'https://www.inaturalist.org/observations/333428940',
      gadm: {
        level0: { gid: 'SWE', name: 'Sweden' },
        level1: { gid: 'SWE.2_1', name: 'Norrbotten' },
      },
      identifiers: [{ type: 'URL', identifier: '333428940' }],
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 5938044864 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.occurrenceID).toBe('https://www.inaturalist.org/observations/333428940');
    expect(result.class).toBe('Aves');
    expect(result.classKey).toBe(212);
    expect(result.gadm?.level0).toEqual({ gid: 'SWE', name: 'Sweden' });
    expect(result.gadm?.level1).toEqual({ gid: 'SWE.2_1', name: 'Norrbotten' });
    expect(result.gadm?.level2).toBeUndefined();
    expect(result.identifiers).toEqual([{ type: 'URL', identifier: '333428940' }]);
  });

  it('drops empty gadm levels and omits gadm entirely when no level carries data', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 301,
      gadm: { level0: { gid: 'SWE', name: 'Sweden' }, level1: {}, level2: {} },
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 301 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.gadm?.level0).toEqual({ gid: 'SWE', name: 'Sweden' });
    expect(result.gadm?.level1).toBeUndefined();
    expect(result.gadm?.level2).toBeUndefined();

    mockGetOccurrence.mockResolvedValue({ key: 302, gadm: { level0: {}, level1: {} } });
    const emptyResult = await gbifGetOccurrence.handler(
      gbifGetOccurrence.input.parse({ occurrenceKey: 302 }),
      ctx,
    );
    expect(emptyResult.gadm).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      key: 1000000001,
      taxonKey: 5231190,
      canonicalName: 'Parus major',
      scientificName: 'Parus major Linnaeus, 1758',
      taxonRank: 'SPECIES',
      basisOfRecord: 'HUMAN_OBSERVATION',
      eventDate: '2024-05-01',
      decimalLatitude: 51.5,
      decimalLongitude: -0.1,
      country: 'United Kingdom',
      countryCode: 'GB',
      datasetKey: 'abc-123',
    };
    const blocks = gbifGetOccurrence.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('1000000001');
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('51.5');
    expect(text).toContain('HUMAN_OBSERVATION');
  });

  it('formats date as Not available when absent', () => {
    const blocks = gbifGetOccurrence.format!({ key: 1, canonicalName: 'Parus major' });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Not available');
  });

  it('formats coordinates as Not available when absent', () => {
    const blocks = gbifGetOccurrence.format!({ key: 1 });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Not available');
  });

  it('renders occurrenceID, class key, gadm, and identifiers in text (#27)', () => {
    const blocks = gbifGetOccurrence.format!({
      key: 5938044864,
      canonicalName: 'Larus argentatus',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      classKey: 212,
      occurrenceID: 'https://www.inaturalist.org/observations/333428940',
      gadm: { level0: { gid: 'SWE', name: 'Sweden' } },
      identifiers: [{ type: 'URL', identifier: '333428940' }],
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Class: Aves (212)');
    expect(text).toContain('https://www.inaturalist.org/observations/333428940');
    expect(text).toContain('Sweden');
    expect(text).toContain('SWE');
    expect(text).toContain('[URL] 333428940');
  });

  it('renders a class key when the class name is absent (#27 content parity)', () => {
    const blocks = gbifGetOccurrence.format!({ key: 1, classKey: 212 });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Class key: 212');
  });

  /**
   * #47, #75 — a fractional occurrenceKey used to pass the bare z.number() and draw
   * an upstream 400 ("For input string: \"1.5\""), which is what an invalid_filter
   * entry existed to explain. The key is a positive integer at the schema now, and
   * every key it admits answers 200 or 404 upstream (live: 0, 1, -5, 2^31, 10^13,
   * and 2^53-1 each 404), so the schema rejects the rest before any request and the
   * contract declares not_found alone.
   */
  it('rejects fractional and non-positive keys at the schema, before any request', async () => {
    for (const occurrenceKey of [1.5, 0, -5]) {
      const result = await runToolContract(gbifGetOccurrence, { occurrenceKey });
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.error).toMatchObject({
        data: { reason: 'invalid_arguments' },
      });
      expect(JSON.stringify(result.content)).toContain('occurrenceKey');
    }
    expect(mockGetOccurrence).not.toHaveBeenCalled();
    expect(gbifGetOccurrence.errors?.map((e) => e.reason)).toEqual(['not_found']);
  });

  it('admits every positive safe integer and advertises the key as one', () => {
    for (const occurrenceKey of [1, 2513888468, Number.MAX_SAFE_INTEGER])
      expect(gbifGetOccurrence.input.safeParse({ occurrenceKey }).success).toBe(true);
    const { properties } = z.toJSONSchema(gbifGetOccurrence.input) as {
      properties: Record<string, unknown>;
    };
    expect(properties.occurrenceKey).toMatchObject({
      type: 'integer',
      exclusiveMinimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    });
  });

  it('answers a positive key GBIF does not hold as not_found', async () => {
    mockGetOccurrence.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'GBIF API returned HTTP 404 Not Found.', {
        status: 404,
      }),
    );

    const result = await runToolContract(gbifGetOccurrence, {
      occurrenceKey: Number.MAX_SAFE_INTEGER,
    });

    expect(result.structuredContent?.error).toMatchObject({ data: { reason: 'not_found' } });
    expect(mockGetOccurrence).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, expect.anything());
  });

  /** #77 — a GID from this record is the value the occurrence tools' gadmGid filter takes. */
  it('names the gadmGid filter on every GADM level GID', () => {
    const gadm = gbifGetOccurrence.output.shape.gadm.unwrap().shape;
    for (const level of [gadm.level0, gadm.level1, gadm.level2, gadm.level3]) {
      const description = level.unwrap().shape.gid.description ?? '';
      expect(description).toContain('gadmGid');
      for (const tool of [
        'gbif_search_occurrences',
        'gbif_count_occurrences',
        'gbif_occurrence_facets',
      ])
        expect(description).toContain(tool);
    }
  });
});

/**
 * #36/#37/#44 — four fields GBIF populates on the occurrence record and this tool
 * dropped. Fixture values are from live records: GADM level3 and eventTime from
 * occurrence 5938104699 (a South African record reaching municipality level).
 */
describe('gbifGetOccurrence newly surfaced record fields', () => {
  const mockGetOccurrence = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getOccurrence: mockGetOccurrence } as never);
  });

  async function fetchRecord(raw: Record<string, unknown>) {
    mockGetOccurrence.mockResolvedValue(raw);
    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    return gbifGetOccurrence.handler(
      gbifGetOccurrence.input.parse({ occurrenceKey: raw.key as number }),
      ctx,
    );
  }

  it('surfaces occurrenceStatus, iucnRedListCategory, taxonomicStatus, and eventTime', async () => {
    const result = await fetchRecord({
      key: 5938104699,
      occurrenceStatus: 'PRESENT',
      iucnRedListCategory: 'VU',
      taxonomicStatus: 'ACCEPTED',
      eventDate: '2024-03-11T09:15:50',
      eventTime: '09:15:50+02:00',
    });

    expect(result.occurrenceStatus).toBe('PRESENT');
    expect(result.iucnRedListCategory).toBe('VU');
    expect(result.taxonomicStatus).toBe('ACCEPTED');
    expect(result.eventTime).toBe('09:15:50+02:00');
  });

  /**
   * An ABSENT record documents a survey that looked and found nothing. It arrives
   * with coordinates, a date, and a recorder, so without the status a caller reads
   * it as evidence of the opposite of what it asserts.
   */
  it('marks an absence record as such rather than as a sighting', async () => {
    const result = await fetchRecord({
      key: 6222223951,
      canonicalName: 'Radicipes gracilis',
      occurrenceStatus: 'ABSENT',
      decimalLatitude: 60.1,
      decimalLongitude: 5.3,
      recordedBy: 'MAREANO',
    });

    expect(result.occurrenceStatus).toBe('ABSENT');
    const blocks = gbifGetOccurrence.format!(result);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('ABSENT');
  });

  it('projects GADM level3 and renders it at the end of the chain (#44)', async () => {
    const result = await fetchRecord({
      key: 5938104699,
      gadm: {
        level0: { gid: 'ZAF', name: 'South Africa' },
        level1: { gid: 'ZAF.6_1', name: 'Mpumalanga' },
        level2: { gid: 'ZAF.6.1_1', name: 'Ehlanzeni' },
        level3: { gid: 'ZAF.6.1.1_1', name: 'Bushbuckridge' },
      },
    });

    expect(result.gadm?.level3).toEqual({ gid: 'ZAF.6.1.1_1', name: 'Bushbuckridge' });

    const blocks = gbifGetOccurrence.format!(result);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Bushbuckridge (ZAF.6.1.1_1)');
    expect(text).toMatch(/South Africa.*Bushbuckridge/);
  });

  /**
   * Coverage is region-dependent — Sweden does not subdivide past level2 — so a
   * missing level3 must stay absent rather than surfacing as an empty object.
   */
  it('leaves level3 absent where the country does not subdivide that far', async () => {
    const result = await fetchRecord({
      key: 5938044864,
      gadm: {
        level0: { gid: 'SWE', name: 'Sweden' },
        level1: { gid: 'SWE.2_1', name: 'Norrbotten' },
      },
    });

    expect(result.gadm?.level0).toEqual({ gid: 'SWE', name: 'Sweden' });
    expect(result.gadm?.level3).toBeUndefined();
  });

  /** A GADM object carrying only an empty level3 is not GADM data. */
  it('omits gadm entirely when level3 is the only key and it is empty', async () => {
    const result = await fetchRecord({ key: 303, gadm: { level3: {} } });

    expect(result.gadm).toBeUndefined();
  });

  it('leaves all four fields absent on a sparse record', async () => {
    const result = await fetchRecord({ key: 304 });

    expect(result.occurrenceStatus).toBeUndefined();
    expect(result.iucnRedListCategory).toBeUndefined();
    expect(result.taxonomicStatus).toBeUndefined();
    expect(result.eventTime).toBeUndefined();
  });

  /**
   * eventTime carries the UTC offset eventDate omits, so it has to render even
   * when eventDate already shows a timestamp — the two are not alternatives.
   */
  it('renders the remaining fields in the text surface', () => {
    const blocks = gbifGetOccurrence.format!({
      key: 5938104699,
      canonicalName: 'Panthera leo',
      taxonomicStatus: 'ACCEPTED',
      iucnRedListCategory: 'VU',
      eventDate: '2024-03-11T09:15:50',
      eventTime: '09:15:50+02:00',
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Taxonomic status:** ACCEPTED');
    expect(text).toContain('IUCN Red List category:** VU');
    expect(text).toContain('2024-03-11T09:15:50');
    expect(text).toContain('09:15:50+02:00');
  });
});
