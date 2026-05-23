/**
 * @fileoverview Tests for gbif_get_species tool.
 * @module tests/tools/gbif-get-species.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetSpecies } from '@/mcp-server/tools/definitions/gbif-get-species.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifGetSpecies', () => {
  const mockGetSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getSpecies: mockGetSpecies } as never);
  });

  it('returns full species record for valid taxon key', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      authorship: 'Linnaeus, 1758',
      vernacularName: 'Great Tit',
      rank: 'SPECIES',
      taxonomicStatus: 'ACCEPTED',
      numDescendants: 12,
      numOccurrences: 5000000,
      kingdom: 'Animalia',
      phylum: 'Chordata',
      clazz: 'Aves',
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
      parentKey: 2492278,
      parent: 'Parus',
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 5231190 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.key).toBe(5231190);
    expect(result.canonicalName).toBe('Parus major');
    expect(result.vernacularName).toBe('Great Tit');
    expect(result.rank).toBe('SPECIES');
    expect(result.taxonomicStatus).toBe('ACCEPTED');
    expect(result.numDescendants).toBe(12);
    // Normalized from raw.clazz
    expect(result.class).toBe('Aves');
    expect(result.parentKey).toBe(2492278);
    expect(result.parent).toBe('Parus');
  });

  it('throws not_found when key is missing', async () => {
    mockGetSpecies.mockResolvedValue({ key: undefined });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 9999999 });

    await expect(gbifGetSpecies.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('normalizes clazz to class field', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 100,
      clazz: 'Mammalia',
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 100 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.class).toBe('Mammalia');
  });

  it('includes extinct when explicitly true', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 200,
      extinct: true,
      canonicalName: 'Dinosauria',
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 200 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.extinct).toBe(true);
  });

  it('omits extinct when not a boolean', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 300,
      canonicalName: 'Pinus',
      // extinct absent from upstream
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 300 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.extinct).toBeUndefined();
  });

  it('includes synonym fields when taxonomicStatus is SYNONYM', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 400,
      taxonomicStatus: 'SYNONYM',
      acceptedKey: 5231190,
      accepted: 'Parus major',
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 400 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.taxonomicStatus).toBe('SYNONYM');
    expect(result.acceptedKey).toBe(5231190);
    expect(result.accepted).toBe('Parus major');
  });

  it('handles sparse upstream response', async () => {
    mockGetSpecies.mockResolvedValue({ key: 500 });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 500 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.key).toBe(500);
    expect(result.canonicalName).toBeUndefined();
    expect(result.vernacularName).toBeUndefined();
    expect(result.extinct).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      key: 5231190,
      canonicalName: 'Parus major',
      scientificName: 'Parus major Linnaeus, 1758',
      vernacularName: 'Great Tit',
      rank: 'SPECIES',
      taxonomicStatus: 'ACCEPTED',
      numDescendants: 12,
      numOccurrences: 5000000,
    };
    const blocks = gbifGetSpecies.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('Great Tit');
    expect(text).toContain('ACCEPTED');
  });

  it('formats sparse output without invented facts', () => {
    const blocks = gbifGetSpecies.format!({ key: 123 });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('123');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});
