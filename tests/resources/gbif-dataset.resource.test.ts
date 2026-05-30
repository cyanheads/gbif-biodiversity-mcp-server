/**
 * @fileoverview Tests for gbif-dataset resource.
 * @module tests/resources/gbif-dataset.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifDatasetResource } from '@/mcp-server/resources/definitions/gbif-dataset.resource.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifDatasetResource', () => {
  const mockGetDataset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getDataset: mockGetDataset } as never);
  });

  it('returns dataset metadata for a valid dataset key', async () => {
    mockGetDataset.mockResolvedValue({
      key: 'abc-def-123',
      title: 'eBird Basic Dataset',
      type: 'OCCURRENCE',
      description: 'Cornell Lab eBird data.',
      license: 'CC_BY_NC_4_0',
      doi: '10.15468/aomfnb',
      citation: { text: 'Sullivan et al. 2009.' },
      publishingCountry: 'US',
      numRecords: 1500000000,
      numConstituents: 0,
    });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'abc-def-123' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.key).toBe('abc-def-123');
    expect(result.title).toBe('eBird Basic Dataset');
    expect(result.type).toBe('OCCURRENCE');
    expect(result.license).toBe('CC_BY_NC_4_0');
    expect(result.doi).toBe('10.15468/aomfnb');
    expect(result.citationText).toBe('Sullivan et al. 2009.');
    expect(result.publishingCountry).toBe('US');
    expect(result.recordCount).toBe(1500000000);
    expect(result.numConstituents).toBe(0);
  });

  it('throws NotFound when key is missing from response', async () => {
    mockGetDataset.mockResolvedValue({ key: undefined });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'nonexistent-uuid' });

    await expect(gbifDatasetResource.handler(params, ctx)).rejects.toThrow(/not found/);
  });

  it('uses numRecords over recordCount', async () => {
    mockGetDataset.mockResolvedValue({ key: 'abc', numRecords: 999, recordCount: 111 });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'abc' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.recordCount).toBe(999);
  });

  it('falls back to recordCount when numRecords absent', async () => {
    mockGetDataset.mockResolvedValue({ key: 'abc', recordCount: 777 });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'abc' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.recordCount).toBe(777);
  });

  it('extracts citation text from nested citation.text', async () => {
    mockGetDataset.mockResolvedValue({
      key: 'abc',
      citation: { text: 'Some author 2024.' },
    });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'abc' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.citationText).toBe('Some author 2024.');
  });

  it('handles sparse upstream response', async () => {
    mockGetDataset.mockResolvedValue({ key: 'sparse' });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'sparse' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.key).toBe('sparse');
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.citationText).toBeUndefined();
    expect(result.recordCount).toBeUndefined();
  });

  it('passes the datasetKey to service unchanged', async () => {
    mockGetDataset.mockResolvedValue({ key: 'some-uuid' });

    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'some-uuid' });
    await gbifDatasetResource.handler(params, ctx);

    expect(mockGetDataset).toHaveBeenCalledWith('some-uuid', ctx);
  });
});
