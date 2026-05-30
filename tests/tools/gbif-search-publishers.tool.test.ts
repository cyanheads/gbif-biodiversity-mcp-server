/**
 * @fileoverview Tests for gbif_search_publishers tool.
 * @module tests/tools/gbif-search-publishers.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifSearchPublishers } from '@/mcp-server/tools/definitions/gbif-search-publishers.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifSearchPublishers', () => {
  const mockSearchPublishers = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ searchPublishers: mockSearchPublishers } as never);
  });

  it('returns publishers and enrichment with pagination metadata', async () => {
    mockSearchPublishers.mockResolvedValue({
      results: [
        {
          key: 'org-uuid-1',
          title: 'Cornell Lab of Ornithology',
          country: 'US',
          city: 'Ithaca',
        },
        {
          key: 'org-uuid-2',
          title: 'Natural History Museum',
          country: 'GB',
          city: 'London',
        },
      ],
      count: 200,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext();
    const input = gbifSearchPublishers.input.parse({ q: 'ornithology' });
    const result = await gbifSearchPublishers.handler(input, ctx);

    expect(result.publishers).toHaveLength(2);
    expect(result.publishers[0].key).toBe('org-uuid-1');
    expect(result.publishers[0].title).toBe('Cornell Lab of Ornithology');
    expect(result.publishers[0].country).toBe('US');
    expect(result.publishers[0].city).toBe('Ithaca');

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(200);
    expect(enrichment.endOfRecords).toBe(false);
    expect(enrichment.notice).toBeUndefined();
  });

  it('enriches with notice on empty results', async () => {
    mockSearchPublishers.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchPublishers.input.parse({ q: 'nonexistent' });
    const result = await gbifSearchPublishers.handler(input, ctx);

    expect(result.publishers).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('No publishers matched');
  });

  it('passes country filter', async () => {
    mockSearchPublishers.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchPublishers.input.parse({ country: 'SE' });
    await gbifSearchPublishers.handler(input, ctx);

    expect(mockSearchPublishers).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'SE' }),
      ctx,
    );
  });

  it('does not send blank q to service', async () => {
    mockSearchPublishers.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    // q with only spaces — should be trimmed away
    const input = gbifSearchPublishers.input.parse({ q: '   ' });
    await gbifSearchPublishers.handler(input, ctx);

    expect(mockSearchPublishers).toHaveBeenCalledWith(
      expect.not.objectContaining({ q: '   ' }),
      ctx,
    );
  });

  it('handles sparse publisher records', async () => {
    mockSearchPublishers.mockResolvedValue({
      results: [{ key: 'sparse-org' }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchPublishers.input.parse({});
    const result = await gbifSearchPublishers.handler(input, ctx);

    expect(result.publishers[0].key).toBe('sparse-org');
    expect(result.publishers[0].title).toBeUndefined();
    expect(result.publishers[0].city).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      publishers: [
        {
          key: 'org-uuid-1',
          title: 'Cornell Lab of Ornithology',
          country: 'US',
          city: 'Ithaca',
        },
      ],
    };
    const blocks = gbifSearchPublishers.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('org-uuid-1');
    expect(text).toContain('Cornell Lab of Ornithology');
    expect(text).toContain('US');
  });
});
