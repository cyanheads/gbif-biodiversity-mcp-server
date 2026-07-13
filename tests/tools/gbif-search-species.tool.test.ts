/**
 * @fileoverview Tests for gbif_search_species tool.
 * @module tests/tools/gbif-search-species.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
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

  it('returns taxa and enrichment with pagination metadata', async () => {
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
          class: 'Aves',
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
    const taxon = result.taxa[0];
    expect(taxon.key).toBe(5231190);
    expect(taxon.canonicalName).toBe('Parus major');
    expect(taxon.vernacularName).toBe('Great Tit');
    expect(taxon.class).toBe('Aves'); // read straight from GBIF's raw `class` field (#34)

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(1000);
    expect(enrichment.endOfRecords).toBe(false);
    expect(enrichment.offset).toBe(0);
    expect(enrichment.limit).toBe(20);
    expect(enrichment.notice).toBeUndefined();
  });

  it('populates the class name from GBIF raw.class (#34)', async () => {
    // GBIF's /species/search returns the class name under `class` (not `clazz`, which is always
    // null). A mammal result must carry class Mammalia into the taxon output.
    mockSearchSpecies.mockResolvedValue({
      results: [{ key: 5219404, class: 'Mammalia' }],
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

  it('enriches with notice on empty results', async () => {
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
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('No taxa matched');
  });

  it('enriches with notice on pagination overshoot', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [],
      count: 5,
      offset: 10,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ offset: 10 });
    await gbifSearchSpecies.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('Offset 10 exceeds totalCount');
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
    };
    const blocks = gbifSearchSpecies.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('Great Tit');
  });
});
