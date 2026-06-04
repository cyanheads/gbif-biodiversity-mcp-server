/**
 * @fileoverview Tests for gbif_get_species_children tool.
 * @module tests/tools/gbif-get-species-children.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetSpeciesChildren } from '@/mcp-server/tools/definitions/gbif-get-species-children.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifGetSpeciesChildren', () => {
  const mockGetSpeciesChildren = vi.fn();
  const mockGetSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      getSpeciesChildren: mockGetSpeciesChildren,
      getSpecies: mockGetSpecies,
    } as never);
  });

  it('returns children and enrichment with pagination metadata', async () => {
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

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 2492278 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(2);
    expect(result.children[0].key).toBe(5231190);
    expect(result.children[0].canonicalName).toBe('Parus major');
    expect(result.children[0].vernacularName).toBe('Great Tit');
    expect(result.children[0].numOccurrences).toBe(5000000);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.endOfRecords).toBe(true);
    expect(enrichment.offset).toBe(0);
    expect(enrichment.limit).toBe(20);
    expect(enrichment.notice).toBeUndefined();
  });

  it('enriches with notice when valid taxon has no children', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });
    // Existence check succeeds — taxon exists but has no children
    mockGetSpecies.mockResolvedValue({
      key: 5231190,
      rank: 'SPECIES',
      canonicalName: 'Parus major',
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 5231190 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('no direct children');
  });

  it('throws not_found when empty results and taxon does not exist', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });
    // Existence check fails — key does not exist in the backbone
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetSpecies.mockRejectedValue(new McpError(JsonRpcErrorCode.NotFound, 'Not found'));

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 999999999 });

    await expect(gbifGetSpeciesChildren.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('passes limit and offset to service', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      count: 0,
      offset: 40,
      limit: 10,
      endOfRecords: true,
    });
    // Existence check succeeds
    mockGetSpecies.mockResolvedValue({ key: 100, rank: 'GENUS', canonicalName: 'TestGenus' });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
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

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
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
    };
    const blocks = gbifGetSpeciesChildren.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
  });
});
