/**
 * @fileoverview Tests for gbif_get_occurrence tool.
 * @module tests/tools/gbif-get-occurrence.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
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
});
