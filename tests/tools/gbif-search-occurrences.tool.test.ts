/**
 * @fileoverview Tests for gbif_search_occurrences tool.
 * @module tests/tools/gbif-search-occurrences.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
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

  it('returns occurrences and pagination metadata', async () => {
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
    expect(result.totalCount).toBe(500000);
    expect(result.endOfRecords).toBe(false);
    const occ = result.occurrences[0];
    expect(occ.key).toBe(1000000001);
    expect(occ.taxonKey).toBe(5231190);
    expect(occ.rank).toBe('SPECIES'); // normalized from taxonRank
    expect(occ.country).toBe('United Kingdom');
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

  it('returns empty occurrences array when results is empty', async () => {
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
    expect(result.totalCount).toBe(0);
    expect(result.endOfRecords).toBe(true);
  });

  it('throws pagination_cap_exceeded when offset+limit exceeds pagination cap', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    // offset 99000 + limit 20 = 99020 > PAGINATION_CAP (99000)
    const input = gbifSearchOccurrences.input.parse({ offset: 99000, limit: 20 });

    await expect(gbifSearchOccurrences.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'pagination_cap_exceeded' },
    });
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
      totalCount: 500000,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    };
    const blocks = gbifSearchOccurrences.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('500000');
    expect(text).toContain('1000000001');
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('HUMAN_OBSERVATION');
  });

  it('formats coordinates as Not available when absent', () => {
    const output = {
      occurrences: [{ key: 1, canonicalName: 'Parus major' }],
      totalCount: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
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
});
