/**
 * @fileoverview Tests for gbif_search_species tool.
 * @module tests/tools/gbif-search-species.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifSearchSpecies } from '@/mcp-server/tools/definitions/gbif-search-species.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifSearchSpecies', () => {
  const mockSearchSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ searchSpecies: mockSearchSpecies } as never);
  });

  it('returns taxa and pagination metadata', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [
        {
          key: 5231190,
          scientificName: 'Parus major Linnaeus, 1758',
          canonicalName: 'Parus major',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          kingdom: 'Animalia',
          phylum: 'Chordata',
          clazz: 'Aves',
          order: 'Passeriformes',
          family: 'Paridae',
          genus: 'Parus',
          vernacularName: 'Great Tit',
          numOccurrences: 5000000,
          numDescendants: 12,
        },
      ],
      count: 1000,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ q: 'Parus major' });
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa).toHaveLength(1);
    expect(result.totalCount).toBe(1000);
    expect(result.endOfRecords).toBe(false);
    const taxon = result.taxa[0];
    expect(taxon.key).toBe(5231190);
    expect(taxon.canonicalName).toBe('Parus major');
    expect(taxon.vernacularName).toBe('Great Tit');
    expect(taxon.class).toBe('Aves'); // normalized from clazz
  });

  it('normalizes clazz to class', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [{ key: 100, clazz: 'Mammalia' }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({});
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa[0].class).toBe('Mammalia');
  });

  it('includes extinct when explicitly boolean', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [{ key: 200, extinct: true }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ isExtinct: true });
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa[0].extinct).toBe(true);
  });

  it('returns empty taxa for no matches', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ q: 'nonexistent_name_xyz' });
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it('passes rank and kingdom filters', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ rank: 'FAMILY', kingdom: 'Animalia' });
    await gbifSearchSpecies.handler(input, ctx);

    expect(mockSearchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ rank: 'FAMILY', kingdom: 'Animalia' }),
      ctx,
    );
  });

  it('handles sparse taxon records', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [{ key: 999 }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({});
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa[0].key).toBe(999);
    expect(result.taxa[0].canonicalName).toBeUndefined();
    expect(result.taxa[0].extinct).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      taxa: [
        {
          key: 5231190,
          canonicalName: 'Parus major',
          scientificName: 'Parus major Linnaeus, 1758',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          vernacularName: 'Great Tit',
          kingdom: 'Animalia',
          numOccurrences: 5000000,
        },
      ],
      totalCount: 1000,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    };
    const blocks = gbifSearchSpecies.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('Great Tit');
    expect(text).toContain('1000');
  });
});
