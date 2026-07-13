/**
 * @fileoverview Tests for gbif-dataset resource.
 * @module tests/resources/gbif-dataset.resource.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifDatasetResource } from '@/mcp-server/resources/definitions/gbif-dataset.resource.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** Build N synthetic dataset contacts mirroring GBIF's flat contact shape. */
function makeContacts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'ADMINISTRATIVE_POINT_OF_CONTACT',
    firstName: `First${i}`,
    lastName: `Last${i}`,
    organization: 'Cornell Lab of Ornithology',
    email: [`contact${i}@example.org`],
  }));
}

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

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
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

  it('throws not_found when key is missing from response', async () => {
    mockGetDataset.mockResolvedValue({ key: undefined });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'nonexistent-uuid' });

    await expect(gbifDatasetResource.handler(params, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('maps an upstream GBIF 404 to a clean domain not_found', async () => {
    // GBIF returns a plain-text 404 body for missing datasets; the service still
    // throws an McpError NotFound, which the resource must normalize like the tool.
    mockGetDataset.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'GBIF API returned HTTP 404 Not Found.', {
        url: 'https://api.gbif.org/v1/dataset/00000000-0000-0000-0000-000000000000',
        status: 404,
      }),
    );

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({
      datasetKey: '00000000-0000-0000-0000-000000000000',
    });

    const err = await gbifDatasetResource.handler(params, ctx).catch((e: unknown) => e);
    expect(err).toMatchObject({ data: { reason: 'not_found' } });
    expect((err as McpError).message).toMatch(/not found in GBIF/);
    expect((err as McpError).message).not.toContain('HTTP 404');
  });

  it('re-throws non-NotFound service errors unchanged', async () => {
    const upstream = new McpError(JsonRpcErrorCode.ServiceUnavailable, 'GBIF API unavailable.');
    mockGetDataset.mockRejectedValue(upstream);

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'abc-def-123' });

    await expect(gbifDatasetResource.handler(params, ctx)).rejects.toBe(upstream);
  });

  it('strips HTML from the dataset description', async () => {
    // Mirrors the real eBird dataset shape — GBIF wraps the abstract in <p> tags.
    mockGetDataset.mockResolvedValue({
      key: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
      title: 'EOD – eBird Observation Dataset',
      description:
        '<p>eBird is a collective enterprise that takes a novel approach to citizen science.</p>',
    });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({
      datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
    });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.description).toBe(
      'eBird is a collective enterprise that takes a novel approach to citizen science.',
    );
    expect(result.description).not.toContain('<p>');
    expect(result.description).not.toContain('</p>');
  });

  it('uses numRecords over recordCount', async () => {
    mockGetDataset.mockResolvedValue({ key: 'abc', numRecords: 999, recordCount: 111 });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'abc' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.recordCount).toBe(999);
  });

  it('falls back to recordCount when numRecords absent', async () => {
    mockGetDataset.mockResolvedValue({ key: 'abc', recordCount: 777 });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'abc' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.recordCount).toBe(777);
  });

  it('extracts citation text from nested citation.text', async () => {
    mockGetDataset.mockResolvedValue({
      key: 'abc',
      citation: { text: 'Some author 2024.' },
    });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'abc' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.citationText).toBe('Some author 2024.');
  });

  it('handles sparse upstream response', async () => {
    mockGetDataset.mockResolvedValue({ key: 'sparse' });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'sparse' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.key).toBe('sparse');
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.citationText).toBeUndefined();
    expect(result.recordCount).toBeUndefined();
    expect(result.contacts).toBeUndefined();
    expect(result.contactsTotal).toBeUndefined();
    expect(result.contactsReturned).toBeUndefined();
    expect(result.temporalCoverages).toBeUndefined();
    expect(result.geographicCoverages).toBeUndefined();
  });

  it('caps contacts at 10 and reports the full count (#28)', async () => {
    // eBird returns 42 contacts; the resource has no contactLimit input, so it applies a fixed cap.
    mockGetDataset.mockResolvedValue({ key: 'ebird', contacts: makeContacts(42) });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'ebird' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.contacts).toHaveLength(10);
    expect(result.contactsTotal).toBe(42);
    expect(result.contactsReturned).toBe(10);
    expect(result.contacts![0].firstName).toBe('First0');
    expect(result.contacts![0].email).toEqual(['contact0@example.org']);
  });

  it('exposes temporal and geographic coverage (#28)', async () => {
    mockGetDataset.mockResolvedValue({
      key: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
      temporalCoverages: [
        { start: '1800-01-01T00:00:00.000+00:00', end: '2024-12-31T00:00:00.000+00:00' },
      ],
      geographicCoverages: [{ description: 'Worldwide' }],
    });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({
      datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
    });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.temporalCoverages).toEqual([
      { start: '1800-01-01T00:00:00.000+00:00', end: '2024-12-31T00:00:00.000+00:00' },
    ]);
    expect(result.geographicCoverages).toEqual([{ description: 'Worldwide' }]);
  });

  it('returns every contact and matching counts when under the fixed cap', async () => {
    mockGetDataset.mockResolvedValue({ key: 'ebird', contacts: makeContacts(3) });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'ebird' });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.contacts).toHaveLength(3);
    expect(result.contactsTotal).toBe(3);
    expect(result.contactsReturned).toBe(3);
  });

  it('passes the datasetKey to service unchanged', async () => {
    mockGetDataset.mockResolvedValue({ key: 'some-uuid' });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'some-uuid' });
    await gbifDatasetResource.handler(params, ctx);

    expect(mockGetDataset).toHaveBeenCalledWith('some-uuid', ctx);
  });
});
