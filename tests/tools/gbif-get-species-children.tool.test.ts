/**
 * @fileoverview Tests for gbif_get_species_children tool.
 * @module tests/tools/gbif-get-species-children.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetSpeciesChildren } from '@/mcp-server/tools/definitions/gbif-get-species-children.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifGetSpeciesChildren', () => {
  const mockGetSpeciesChildren = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      getSpeciesChildren: mockGetSpeciesChildren,
    } as never);
  });

  it('returns children and pagination metadata', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [
        {
          key: 5231190,
          scientificName: 'Parus major Linnaeus, 1758',
          canonicalName: 'Parus major',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          vernacularName: 'Great Tit',
          numOccurrences: 5000000,
          numDescendants: 12,
        },
        {
          key: 5231191,
          scientificName: 'Parus minor Temminck & Schlegel, 1848',
          canonicalName: 'Parus minor',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
        },
      ],
      count: 2,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 2492278 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(2);
    expect(result.endOfRecords).toBe(true);
    expect(result.children[0].key).toBe(5231190);
    expect(result.children[0].canonicalName).toBe('Parus major');
    expect(result.children[0].vernacularName).toBe('Great Tit');
    expect(result.children[0].numOccurrences).toBe(5000000);
  });

  it('returns empty children for leaf taxon', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 5231190 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(0);
  });

  it('passes limit and offset to service', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      count: 0,
      offset: 40,
      limit: 10,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 100, limit: 10, offset: 40 });
    await gbifGetSpeciesChildren.handler(input, ctx);

    expect(mockGetSpeciesChildren).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ limit: 10, offset: 40 }),
      ctx,
    );
  });

  it('handles sparse child records', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [{ key: 999 }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 100 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children[0].key).toBe(999);
    expect(result.children[0].canonicalName).toBeUndefined();
    expect(result.children[0].vernacularName).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      children: [
        {
          key: 5231190,
          canonicalName: 'Parus major',
          scientificName: 'Parus major Linnaeus, 1758',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          vernacularName: 'Great Tit',
          numOccurrences: 5000000,
          numDescendants: 12,
        },
      ],
      offset: 0,
      limit: 20,
      endOfRecords: true,
    };
    const blocks = gbifGetSpeciesChildren.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
  });
});
