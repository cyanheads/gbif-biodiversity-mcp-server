/**
 * @fileoverview Tests for gbif-dataset resource.
 * @module tests/resources/gbif-dataset.resource.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { createWorkerHandler } from '@cyanheads/mcp-ts-core/worker';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifDatasetResource } from '@/mcp-server/resources/definitions/gbif-dataset.resource.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** EOD – eBird Observation Dataset. */
const EBIRD_KEY = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e';
/** iNaturalist Research-grade Observations. */
const INAT_KEY = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
/** Well-formed UUID GBIF has never allocated. */
const MISSING_KEY = '00000000-0000-0000-0000-000000000000';
/** Visuelle undersøkelser - petroleumsvirksomhet — a SAMPLING_EVENT dataset, 99.8% absences. */
const ABSENCE_HEAVY_KEY = 'b6b4502f-ffc8-4048-a91b-af502288faa8';

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
  const mockCount = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCount.mockResolvedValue(undefined);
    vi.mocked(getGbifService).mockReturnValue({
      getDataset: mockGetDataset,
      getDatasetOccurrenceCount: mockCount,
    } as never);
  });

  it('returns dataset metadata for a valid dataset key', async () => {
    mockGetDataset.mockResolvedValue({
      key: EBIRD_KEY,
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
    const params = gbifDatasetResource.params.parse({ datasetKey: EBIRD_KEY });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.key).toBe(EBIRD_KEY);
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
    const params = gbifDatasetResource.params.parse({ datasetKey: MISSING_KEY });

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
      datasetKey: MISSING_KEY,
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
    const params = gbifDatasetResource.params.parse({ datasetKey: EBIRD_KEY });

    await expect(gbifDatasetResource.handler(params, ctx)).rejects.toBe(upstream);
  });

  it('strips HTML from the dataset description', async () => {
    // Mirrors the real eBird dataset shape — GBIF wraps the abstract in <p> tags.
    mockGetDataset.mockResolvedValue({
      key: EBIRD_KEY,
      title: 'EOD – eBird Observation Dataset',
      description:
        '<p>eBird is a collective enterprise that takes a novel approach to citizen science.</p>',
    });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({
      datasetKey: EBIRD_KEY,
    });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.description).toBe(
      'eBird is a collective enterprise that takes a novel approach to citizen science.',
    );
    expect(result.description).not.toContain('<p>');
    expect(result.description).not.toContain('</p>');
  });

  it('uses numRecords over recordCount', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY, numRecords: 999, recordCount: 111 });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: INAT_KEY });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.recordCount).toBe(999);
  });

  it('falls back to recordCount when numRecords absent', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY, recordCount: 777 });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: INAT_KEY });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.recordCount).toBe(777);
  });

  it('extracts citation text from nested citation.text', async () => {
    mockGetDataset.mockResolvedValue({
      key: INAT_KEY,
      citation: { text: 'Some author 2024.' },
    });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: INAT_KEY });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.citationText).toBe('Some author 2024.');
  });

  it('handles sparse upstream response', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: INAT_KEY });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.key).toBe(INAT_KEY);
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
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, contacts: makeContacts(42) });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: EBIRD_KEY });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.contacts).toHaveLength(10);
    expect(result.contactsTotal).toBe(42);
    expect(result.contactsReturned).toBe(10);
    expect(result.contacts![0].firstName).toBe('First0');
    expect(result.contacts![0].email).toEqual(['contact0@example.org']);
  });

  it('exposes temporal and geographic coverage (#28)', async () => {
    mockGetDataset.mockResolvedValue({
      key: EBIRD_KEY,
      temporalCoverages: [
        { start: '1800-01-01T00:00:00.000+00:00', end: '2024-12-31T00:00:00.000+00:00' },
      ],
      geographicCoverages: [{ description: 'Worldwide' }],
    });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({
      datasetKey: EBIRD_KEY,
    });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.temporalCoverages).toEqual([
      { start: '1800-01-01T00:00:00.000+00:00', end: '2024-12-31T00:00:00.000+00:00' },
    ]);
    expect(result.geographicCoverages).toEqual([{ description: 'Worldwide' }]);
  });

  it('returns every contact and matching counts when under the fixed cap', async () => {
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, contacts: makeContacts(3) });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: EBIRD_KEY });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(result.contacts).toHaveLength(3);
    expect(result.contactsTotal).toBe(3);
    expect(result.contactsReturned).toBe(3);
  });

  it('passes the datasetKey to service unchanged', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY });

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: INAT_KEY });
    await gbifDatasetResource.handler(params, ctx);

    expect(mockGetDataset).toHaveBeenCalledWith(INAT_KEY, ctx);
  });

  /** #40 — the detail endpoint omits both count fields, so the occurrence count fills it. */
  it('fills recordCount from the occurrence count when the detail record omits it', async () => {
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, type: 'OCCURRENCE' });
    mockCount.mockResolvedValue(1775781186);

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: EBIRD_KEY });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(mockCount).toHaveBeenCalledWith(EBIRD_KEY, ctx);
    expect(result.recordCount).toBe(1775781186);
  });

  /**
   * #48 — the resource shares the resolver with the tool, so it inherited the same
   * silence on SAMPLING_EVENT and METADATA datasets that `/dataset/search` counts.
   */
  it('resolves recordCount for a non-OCCURRENCE dataset', async () => {
    mockGetDataset.mockResolvedValue({ key: ABSENCE_HEAVY_KEY, type: 'SAMPLING_EVENT' });
    mockCount.mockResolvedValue(30622351);

    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: ABSENCE_HEAVY_KEY });
    const result = await gbifDatasetResource.handler(params, ctx);

    expect(mockCount).toHaveBeenCalledWith(ABSENCE_HEAVY_KEY, ctx);
    expect(result.recordCount).toBe(30622351);
  });

  /**
   * #48 — the resource has no format() and reaches a client as its output schema
   * alone, so the field description is the only place the scope can be stated.
   */
  it('scopes the recordCount description and names the presence-scoped tool', () => {
    const description = gbifDatasetResource.output.shape.recordCount.description ?? '';

    expect(description).toContain('occurrenceStatus');
    expect(description).toContain('absence records');
    expect(description).toContain('gbif_count_occurrences');
  });

  /** #38 — the resource had the same gap as the tool: a malformed key round-tripped. */
  it('rejects a non-UUID datasetKey without issuing a request', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant', errors: gbifDatasetResource.errors });
    const params = gbifDatasetResource.params.parse({ datasetKey: 'not-a-uuid' });

    const err = await gbifDatasetResource.handler(params, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect(mockGetDataset).not.toHaveBeenCalled();
  });

  /**
   * The handler throws the bare reason; the resource factory fills the declared
   * hint. A direct `handler(...)` call skips that fill, so the hint is read off a
   * real `resources/read` served by the Worker handler.
   */
  it('puts the declared invalid_filter hint on the wire for a non-UUID datasetKey', async () => {
    const worker = createWorkerHandler({
      name: 'gbif-dataset-resource-test',
      resources: [gbifDatasetResource],
    });
    const uri = 'gbif://dataset/not-a-uuid';
    const response = await worker.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'resources/read',
          'Mcp-Name': uri,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/read',
          params: {
            uri,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
      {} as never,
      { waitUntil: () => {}, passThroughOnException: () => {} } as never,
    );
    const text = await response.text();
    const frame = text.startsWith('{') ? text : (text.match(/^data:(.*)$/m)?.[1] ?? '');
    const body = JSON.parse(frame) as {
      error: { code: number; data: { reason: string; recovery: { hint: string } } };
    };

    expect(body.error.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(body.error.data.reason).toBe('invalid_filter');
    expect(body.error.data.recovery.hint).toBe(
      "Address the resource with the 8-4-4-4-12 hex UUID exactly as gbif_search_datasets returns it, or as it appears in an occurrence record's datasetKey field.",
    );
    expect(mockGetDataset).not.toHaveBeenCalled();
  });
});
