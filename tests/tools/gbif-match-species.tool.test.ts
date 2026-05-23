/**
 * @fileoverview Tests for gbif_match_species tool.
 * @module tests/tools/gbif-match-species.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifMatchSpecies } from '@/mcp-server/tools/definitions/gbif-match-species.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifMatchSpecies', () => {
  const mockMatchSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ matchSpecies: mockMatchSpecies } as never);
  });

  it('returns matched taxon for a known species', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      rank: 'SPECIES',
      status: 'ACCEPTED',
      confidence: 99,
      matchType: 'EXACT',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Passeriformes',
      family: 'Paridae',
      genus: 'Parus',
      species: 'Parus major',
      kingdomKey: 1,
      phylumKey: 44,
      classKey: 212,
      orderKey: 729,
      familyKey: 9322,
      genusKey: 2492278,
      speciesKey: 5231190,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Parus major' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(5231190);
    expect(result.scientificName).toBe('Parus major Linnaeus, 1758');
    expect(result.canonicalName).toBe('Parus major');
    expect(result.rank).toBe('SPECIES');
    expect(result.matchType).toBe('EXACT');
    expect(result.confidence).toBe(99);
    expect(result.kingdom).toBe('Animalia');
    expect(result.kingdomKey).toBe(1);
  });

  it('throws no_match when matchType is NONE', async () => {
    mockMatchSpecies.mockResolvedValue({ matchType: 'NONE', usageKey: undefined });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'xyznonexistentspecies' });

    await expect(gbifMatchSpecies.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_match' },
    });
  });

  it('throws no_match when usageKey is missing', async () => {
    mockMatchSpecies.mockResolvedValue({ matchType: 'FUZZY', usageKey: undefined });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'incomplete result' });

    await expect(gbifMatchSpecies.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_match' },
    });
  });

  it('passes optional kingdom and rank filters', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 1234,
      matchType: 'EXACT',
      canonicalName: 'Rosa canina',
      scientificName: 'Rosa canina L.',
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({
      name: 'Rosa canina',
      kingdom: 'Plantae',
      rank: 'SPECIES',
    });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(1234);
    expect(mockMatchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ kingdom: 'Plantae', rank: 'SPECIES' }),
      ctx,
    );
  });

  it('handles sparse upstream response', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 9999,
      matchType: 'HIGHERORDER',
      canonicalName: 'Aves',
      // no classification keys, no confidence
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'birds' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(9999);
    expect(result.confidence).toBeUndefined();
    expect(result.kingdomKey).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      taxonKey: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      rank: 'SPECIES',
      status: 'ACCEPTED',
      confidence: 99,
      matchType: 'EXACT',
      kingdom: 'Animalia',
      kingdomKey: 1,
    };
    const blocks = gbifMatchSpecies.format!(output);
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('99');
    expect(text).toContain('EXACT');
    expect(text).toContain('Animalia');
  });

  it('formats sparse output without invented facts', () => {
    const blocks = gbifMatchSpecies.format!({});
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    // No fabricated values for missing fields
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});
