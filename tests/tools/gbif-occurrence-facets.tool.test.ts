/**
 * @fileoverview Tests for gbif_occurrence_facets tool.
 * @module tests/tools/gbif-occurrence-facets.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifOccurrenceFacets } from '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifOccurrenceFacets', () => {
  const mockGetOccurrenceFacets = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      getOccurrenceFacets: mockGetOccurrenceFacets,
    } as never);
  });

  it('returns facet counts ranked by count', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 5000000,
      facets: [
        {
          field: 'COUNTRY',
          counts: [
            { name: 'GB', count: 1200000 },
            { name: 'DE', count: 900000 },
            { name: 'US', count: 750000 },
          ],
        },
      ],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', taxonKey: 5231190 });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.facet).toBe('COUNTRY');
    expect(result.totalOccurrences).toBe(5000000);
    expect(result.counts).toHaveLength(3);
    expect(result.counts[0]).toEqual({ name: 'GB', count: 1200000 });
    expect(result.counts[1]).toEqual({ name: 'DE', count: 900000 });
  });

  it('returns empty counts when no facet data', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({ count: 0, facets: [] });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'YEAR' });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.counts).toHaveLength(0);
    expect(result.totalOccurrences).toBe(0);
  });

  it('case-insensitive facet field matching', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 100,
      facets: [
        {
          field: 'country', // lowercase from API
          counts: [{ name: 'SE', count: 100 }],
        },
      ],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY' });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.counts).toHaveLength(1);
    expect(result.counts[0].name).toBe('SE');
  });

  it('returns empty counts when facet field not present in response', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 50,
      facets: [{ field: 'YEAR', counts: [{ name: '2024', count: 50 }] }],
    });

    const ctx = createMockContext();
    // Ask for COUNTRY but response only has YEAR
    const input = gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY' });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.counts).toHaveLength(0);
  });

  it('handles null name and count in facet entries', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 10,
      facets: [
        {
          field: 'YEAR',
          counts: [{ name: null, count: null }],
        },
      ],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'YEAR' });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.counts[0].name).toBe('');
    expect(result.counts[0].count).toBe(0);
  });

  it('formats output with facet name and counts', () => {
    const output = {
      facet: 'COUNTRY',
      totalOccurrences: 5000000,
      counts: [
        { name: 'GB', count: 1200000 },
        { name: 'DE', count: 900000 },
      ],
    };
    const blocks = gbifOccurrenceFacets.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('COUNTRY');
    expect(text).toContain('5000000');
    expect(text).toContain('GB');
    expect(text).toContain('1,200,000');
    expect(text).toContain('DE');
  });

  it('formats empty counts without error', () => {
    const blocks = gbifOccurrenceFacets.format!({ facet: 'YEAR', totalOccurrences: 0, counts: [] });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('YEAR');
    expect(text).toContain('0');
  });
});
