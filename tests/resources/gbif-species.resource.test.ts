/**
 * @fileoverview Tests for gbif-species resource.
 * @module tests/resources/gbif-species.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifSpeciesResource } from '@/mcp-server/resources/definitions/gbif-species.resource.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifSpeciesResource', () => {
  const mockGetSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getSpecies: mockGetSpecies } as never);
  });

  it('returns species record for valid taxon key', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      authorship: 'Linnaeus, 1758',
      vernacularName: 'Great Tit',
      rank: 'SPECIES',
      taxonomicStatus: 'ACCEPTED',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      clazz: 'Aves',
      order: 'Passeriformes',
      family: 'Paridae',
      genus: 'Parus',
      numDescendants: 12,
    });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: '5231190' });
    const result = await gbifSpeciesResource.handler(params, ctx);

    expect(result.key).toBe(5231190);
    expect(result.canonicalName).toBe('Parus major');
    expect(result.vernacularName).toBe('Great Tit');
    expect(result.rank).toBe('SPECIES');
    expect(result.taxonomicStatus).toBe('ACCEPTED');
    // clazz → class normalization
    expect(result.class).toBe('Aves');
    expect(result.numDescendants).toBe(12);
  });

  it('throws ValidationError for non-numeric taxon key', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: 'not-a-number' });

    await expect(gbifSpeciesResource.handler(params, ctx)).rejects.toThrow(/Invalid taxon key/);
  });

  it('throws NotFound when key is missing from response', async () => {
    mockGetSpecies.mockResolvedValue({ key: undefined });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: '9999999' });

    await expect(gbifSpeciesResource.handler(params, ctx)).rejects.toThrow(/not found/);
  });

  it('includes extinct when explicitly true', async () => {
    mockGetSpecies.mockResolvedValue({ key: 200, extinct: true });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: '200' });
    const result = await gbifSpeciesResource.handler(params, ctx);

    expect(result.extinct).toBe(true);
  });

  it('omits extinct when not a boolean', async () => {
    mockGetSpecies.mockResolvedValue({ key: 300 });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: '300' });
    const result = await gbifSpeciesResource.handler(params, ctx);

    expect(result.extinct).toBeUndefined();
  });

  it('includes synonym fields when present', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 400,
      taxonomicStatus: 'SYNONYM',
      acceptedKey: 5231190,
      accepted: 'Parus major',
    });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: '400' });
    const result = await gbifSpeciesResource.handler(params, ctx);

    expect(result.acceptedKey).toBe(5231190);
    expect(result.accepted).toBe('Parus major');
  });

  it('handles sparse upstream response', async () => {
    mockGetSpecies.mockResolvedValue({ key: 500 });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: '500' });
    const result = await gbifSpeciesResource.handler(params, ctx);

    expect(result.key).toBe(500);
    expect(result.canonicalName).toBeUndefined();
    expect(result.vernacularName).toBeUndefined();
    expect(result.extinct).toBeUndefined();
  });

  // Security: injection via taxonKey path param
  it('rejects path traversal attempts in taxonKey', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: '../../../etc/passwd' });

    await expect(gbifSpeciesResource.handler(params, ctx)).rejects.toThrow(/Invalid taxon key/);
  });

  it('rejects taxonKey with injected script tags', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: '<script>alert(1)</script>' });

    await expect(gbifSpeciesResource.handler(params, ctx)).rejects.toThrow(/Invalid taxon key/);
  });

  it('passes integer taxonKey to service correctly', async () => {
    mockGetSpecies.mockResolvedValue({ key: 5231190 });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifSpeciesResource.params.parse({ taxonKey: '5231190' });
    await gbifSpeciesResource.handler(params, ctx);

    expect(mockGetSpecies).toHaveBeenCalledWith(5231190, ctx);
  });
});
