/**
 * @fileoverview Tests for gbif_search_datasets tool.
 * @module tests/tools/gbif-search-datasets.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
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

  it('returns datasets and pagination metadata', async () => {
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
    expect(result.totalCount).toBe(50000);
    expect(result.endOfRecords).toBe(false);
    const ds = result.datasets[0];
    expect(ds.key).toBe('abc-def-123');
    expect(ds.title).toBe('eBird Basic Dataset');
    expect(ds.type).toBe('OCCURRENCE');
    expect(ds.recordCount).toBe(1500000000);
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

  it('truncates description to 300 chars', async () => {
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
  });

  it('returns empty datasets array for no matches', async () => {
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
    expect(result.totalCount).toBe(0);
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
      totalCount: 50000,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    };
    const blocks = gbifSearchDatasets.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('abc-def-123');
    expect(text).toContain('eBird Basic Dataset');
    expect(text).toContain('OCCURRENCE');
    expect(text).toContain('50000');
  });
});
