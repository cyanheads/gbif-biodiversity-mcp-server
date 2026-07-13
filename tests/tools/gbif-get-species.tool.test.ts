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
    // Read straight from GBIF's raw `class` field (#34).
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

  it('populates the class name from GBIF raw.class (#34)', async () => {
    // GBIF's /species/{key} returns the class name under `class` (not `clazz`, which is always
    // null). Panthera leo (5219404) has class Mammalia; it must reach structuredContent.
    mockGetSpecies.mockResolvedValue({
      key: 5219404,
      canonicalName: 'Panthera leo',
      class: 'Mammalia',
      classKey: 359,
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 5219404 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.class).toBe('Mammalia');
    expect(result.classKey).toBe(359);
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

  it('strips HTML from publishedIn', async () => {
    // GBIF embeds <em> tags in the original-description citation (Parus major / 9705453).
    mockGetSpecies.mockResolvedValue({
      key: 9705453,
      canonicalName: 'Parus major',
      publishedIn:
        'Linnaeus, C. (1758). Systema Naturae. <em>Editio decima, reformata, vol. 1: 824 pp. Laurentius Salvius: Holmiae.</em>',
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 9705453 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.publishedIn).toBe(
      'Linnaeus, C. (1758). Systema Naturae. Editio decima, reformata, vol. 1: 824 pp. Laurentius Salvius: Holmiae.',
    );
    expect(result.publishedIn).not.toContain('<em>');
    expect(result.publishedIn).not.toContain('</em>');
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

  it('renders a key-only classification entry when the rank name is absent (#31)', () => {
    // A record that carries a rank key without its name (a genuine edge case) must still surface
    // the key in content[], matching what structuredContent carries. format()-only, so the output
    // object is constructed directly with class omitted and classKey present.
    const blocks = gbifGetSpecies.format!({
      key: 5219404,
      canonicalName: 'Panthera leo',
      kingdom: 'Animalia',
      kingdomKey: 1,
      phylum: 'Chordata',
      phylumKey: 44,
      classKey: 359,
      order: 'Carnivora',
      orderKey: 732,
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Class key: 359');
    expect(text).toContain('Kingdom: Animalia (1)');
    expect(text).toContain('Order: Carnivora (732)');
    expect(text).not.toContain('undefined');
  });

  it('renders key-only fallbacks at every rank when names are absent (#31)', () => {
    const blocks = gbifGetSpecies.format!({
      key: 1,
      kingdomKey: 1,
      phylumKey: 44,
      classKey: 359,
      orderKey: 732,
      familyKey: 9701,
      genusKey: 2435098,
      speciesKey: 5219404,
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    for (const part of [
      'Kingdom key: 1',
      'Phylum key: 44',
      'Class key: 359',
      'Order key: 732',
      'Family key: 9701',
      'Genus key: 2435098',
      'Species key: 5219404',
    ]) {
      expect(text).toContain(part);
    }
  });
});
