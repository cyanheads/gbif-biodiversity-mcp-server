/**
 * @fileoverview Tests for gbif_get_species_classification tool.
 * @module tests/tools/gbif-get-species-classification.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetSpeciesClassification } from '@/mcp-server/tools/definitions/gbif-get-species-classification.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifGetSpeciesClassification', () => {
  const mockGetSpeciesParents = vi.fn();
  const mockGetSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      getSpeciesParents: mockGetSpeciesParents,
      getSpecies: mockGetSpecies,
    } as never);
  });

  it('returns ordered classification chain', async () => {
    mockGetSpeciesParents.mockResolvedValue([
      { key: 1, rank: 'KINGDOM', canonicalName: 'Animalia', scientificName: 'Animalia' },
      { key: 44, rank: 'PHYLUM', canonicalName: 'Chordata', scientificName: 'Chordata' },
      { key: 212, rank: 'CLASS', canonicalName: 'Aves', scientificName: 'Aves' },
      { key: 729, rank: 'ORDER', canonicalName: 'Passeriformes', scientificName: 'Passeriformes' },
      {
        key: 9322,
        rank: 'FAMILY',
        canonicalName: 'Paridae',
        scientificName: 'Paridae Vigors, 1825',
      },
      {
        key: 2492278,
        rank: 'GENUS',
        canonicalName: 'Parus',
        scientificName: 'Parus Linnaeus, 1758',
      },
    ]);

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 5231190 });
    const result = await gbifGetSpeciesClassification.handler(input, ctx);

    expect(result.classification).toHaveLength(6);
    expect(result.classification[0].rank).toBe('KINGDOM');
    expect(result.classification[0].name).toBe('Animalia');
    expect(result.classification[0].key).toBe(1);
    expect(result.classification[5].rank).toBe('GENUS');
    expect(result.classification[5].name).toBe('Parus');
  });

  it('throws not_found when response is not an array', async () => {
    mockGetSpeciesParents.mockResolvedValue({ error: 'not found' });

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 9999999 });

    await expect(gbifGetSpeciesClassification.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('throws not_found when getSpeciesParents rejects with McpError NotFound', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetSpeciesParents.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'Taxon not found'),
    );

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 999999999 });

    await expect(gbifGetSpeciesClassification.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('returns empty classification for root taxon (kingdom-level)', async () => {
    mockGetSpeciesParents.mockResolvedValue([]);
    // Root/kingdom-level taxa have no parents but the taxon itself exists
    mockGetSpecies.mockResolvedValue({ key: 1, rank: 'KINGDOM', canonicalName: 'Animalia' });

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 1 });
    const result = await gbifGetSpeciesClassification.handler(input, ctx);

    expect(result.classification).toHaveLength(0);
  });

  it('normalizes canonicalName to name field', async () => {
    mockGetSpeciesParents.mockResolvedValue([
      { key: 1, rank: 'KINGDOM', canonicalName: 'Plantae' },
    ]);

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 6 });
    const result = await gbifGetSpeciesClassification.handler(input, ctx);

    expect(result.classification[0].name).toBe('Plantae');
  });

  it('handles sparse parent nodes', async () => {
    mockGetSpeciesParents.mockResolvedValue([
      { key: 100 }, // no rank, no canonicalName
    ]);

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 200 });
    const result = await gbifGetSpeciesClassification.handler(input, ctx);

    expect(result.classification[0].key).toBe(100);
    expect(result.classification[0].rank).toBeUndefined();
    expect(result.classification[0].name).toBeUndefined();
  });

  it('formats output with ranks and keys', () => {
    const output = {
      classification: [
        { key: 1, rank: 'KINGDOM', name: 'Animalia', scientificName: 'Animalia' },
        { key: 44, rank: 'PHYLUM', name: 'Chordata', scientificName: 'Chordata' },
        { key: 212, rank: 'CLASS', name: 'Aves' },
      ],
    };
    const blocks = gbifGetSpeciesClassification.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('KINGDOM');
    expect(text).toContain('Animalia');
    expect(text).toContain('1');
    expect(text).toContain('PHYLUM');
    expect(text).toContain('Chordata');
    expect(text).toContain('CLASS');
    expect(text).toContain('Aves');
    expect(text).toContain('3 ranks');
  });
});
