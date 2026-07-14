/**
 * @fileoverview Tests for gbif_search_datasets tool.
 * @module tests/tools/gbif-search-datasets.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifSearchDatasets } from '@/mcp-server/tools/definitions/gbif-search-datasets.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

const makeDataset = (overrides = {}) => ({
  key: 'abc-def-123',
  title: 'eBird Basic Dataset',
  type: 'OCCURRENCE',
  description: 'Cornell Lab of Ornithology eBird checklist data.',
  license: 'CC_BY_NC_4_0',
  doi: '10.15468/aomfnb',
  publishingCountry: 'US',
  numRecords: 1500000000,
  ...overrides,
});

describe('gbifSearchDatasets', () => {
  const mockSearchDatasets = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ searchDatasets: mockSearchDatasets } as never);
  });

  it('returns datasets and enrichment with pagination metadata', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [makeDataset()],
      count: 50000,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext();
    const input = gbifSearchDatasets.input.parse({ q: 'eBird' });
    const result = await gbifSearchDatasets.handler(input, ctx);

    expect(result.datasets).toHaveLength(1);
    const ds = result.datasets[0];
    expect(ds.key).toBe('abc-def-123');
    expect(ds.title).toBe('eBird Basic Dataset');
    expect(ds.type).toBe('OCCURRENCE');
    expect(ds.recordCount).toBe(1500000000);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(50000);
    expect(enrichment.endOfRecords).toBe(false);
    expect(enrichment.notice).toBeUndefined();
  });

  it('uses numRecords over recordCount when both present', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [makeDataset({ numRecords: 999, recordCount: 111 })],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchDatasets.input.parse({});
    const result = await gbifSearchDatasets.handler(input, ctx);

    expect(result.datasets[0].recordCount).toBe(999);
  });

  it('falls back to recordCount when numRecords absent', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [{ key: 'xyz', recordCount: 777 }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchDatasets.input.parse({});
    const result = await gbifSearchDatasets.handler(input, ctx);

    expect(result.datasets[0].recordCount).toBe(777);
  });

  it('truncates description to 300 chars and flags descriptionTruncated', async () => {
    const longDescription = 'x'.repeat(500);
    mockSearchDatasets.mockResolvedValue({
      results: [makeDataset({ description: longDescription })],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchDatasets.input.parse({});
    const result = await gbifSearchDatasets.handler(input, ctx);

    expect(result.datasets[0].description).toHaveLength(300);
    expect(result.datasets[0].descriptionTruncated).toBe(true);
  });

  it('does not flag descriptionTruncated for a description under 300 chars', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [makeDataset({ description: 'Short description.' })],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchDatasets.input.parse({});
    const result = await gbifSearchDatasets.handler(input, ctx);

    expect(result.datasets[0].description).toBe('Short description.');
    expect(result.datasets[0].descriptionTruncated).toBe(false);
  });

  it('enriches with notice on empty results', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchDatasets.input.parse({ q: 'nonexistent' });
    const result = await gbifSearchDatasets.handler(input, ctx);

    expect(result.datasets).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('No datasets matched');
  });

  it('passes type and publishingCountry filters', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchDatasets.input.parse({
      type: 'CHECKLIST',
      publishingCountry: 'DE',
    });
    await gbifSearchDatasets.handler(input, ctx);

    expect(mockSearchDatasets).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CHECKLIST', publishingCountry: 'DE' }),
      ctx,
    );
  });

  it('handles sparse dataset records', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [{ key: 'sparse-key' }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchDatasets.input.parse({});
    const result = await gbifSearchDatasets.handler(input, ctx);

    const ds = result.datasets[0];
    expect(ds.key).toBe('sparse-key');
    expect(ds.title).toBeUndefined();
    expect(ds.description).toBeUndefined();
    expect(ds.descriptionTruncated).toBeUndefined();
    expect(ds.recordCount).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      datasets: [
        {
          key: 'abc-def-123',
          title: 'eBird Basic Dataset',
          type: 'OCCURRENCE',
          license: 'CC_BY_NC_4_0',
          doi: '10.15468/aomfnb',
          publishingCountry: 'US',
          recordCount: 1500000000,
        },
      ],
    };
    const blocks = gbifSearchDatasets.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('abc-def-123');
    expect(text).toContain('eBird Basic Dataset');
    expect(text).toContain('OCCURRENCE');
  });

  it('renders the truncation marker in content only when descriptionTruncated', () => {
    const truncated = gbifSearchDatasets.format!({
      datasets: [
        { key: 'a', title: 'A', description: 'x'.repeat(300), descriptionTruncated: true },
      ],
    });
    const truncatedText = truncated[0].type === 'text' ? truncated[0].text : '';
    expect(truncatedText).toContain('description truncated');
    expect(truncatedText).toContain('gbif_get_dataset');

    const full = gbifSearchDatasets.format!({
      datasets: [{ key: 'b', title: 'B', description: 'Short.', descriptionTruncated: false }],
    });
    const fullText = full[0].type === 'text' ? full[0].text : '';
    expect(fullText).toContain('Short.');
    expect(fullText).not.toContain('description truncated');
  });
});
