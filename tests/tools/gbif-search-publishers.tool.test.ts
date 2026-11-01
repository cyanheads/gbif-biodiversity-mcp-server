/**
 * @fileoverview Tests for gbif_search_publishers tool.
 * @module tests/tools/gbif-search-publishers.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
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

  /** offset 0 and limit 1 are the lower bounds and reach GBIF as sent. */
  it('accepts and forwards the lowest limit and offset', async () => {
    mockSearchPublishers.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const result = await runToolContract(gbifSearchPublishers, { limit: 1, offset: 0 });

    expect(result.isError).not.toBe(true);
    expect(mockSearchPublishers).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1, offset: 0 }),
      expect.anything(),
    );
  });

  /**
   * #75 — `/organization` answers `limit=2.5&offset=1.5` with its defaults (20
   * rows from offset 0) and a 200, so a fraction that reached it returned the
   * wrong page as a success. It now fails at the schema, naming the field.
   */
  it.each([
    ['offset', { offset: 1.5 }],
    ['limit', { limit: 2.5 }],
  ])('rejects a fractional %s at the schema before any request', async (field, paging) => {
    const result = await runToolContract(gbifSearchPublishers, paging);

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: JsonRpcErrorCode.InvalidParams,
      data: { reason: 'invalid_arguments' },
    });
    expect(JSON.stringify(result.content)).toContain(field);
    expect(mockSearchPublishers).not.toHaveBeenCalled();
  });

  it('advertises limit and offset as integers with their bounds and defaults', () => {
    const { properties } = z.toJSONSchema(gbifSearchPublishers.input) as {
      properties: Record<string, Record<string, unknown>>;
    };

    expect(properties.limit).toMatchObject({ type: 'integer', minimum: 1, default: 20 });
    expect(properties.offset).toMatchObject({
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      default: 0,
    });
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

  /**
   * #53 — the forward tested `?.trim()`, so an empty country was dropped and the
   * registry answered unfiltered. Measured on the built server: `country: ""` returns
   * all 3,561 registered organizations, against 223 for `GB`. Only the empty string
   * is guarded — `/organization` resolves the parsed country, so `gb` and `GBR` are
   * correct answers rather than silent ones, and anything it cannot parse (whitespace
   * included) draws a 400 the service already tags `invalid_filter`.
   */
  it('rejects an empty country instead of searching every country', async () => {
    const ctx = createMockContext({ errors: gbifSearchPublishers.errors });
    const input = gbifSearchPublishers.input.parse({ country: '' });
    expect(input.country).toBe('');

    const err = await gbifSearchPublishers.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect((err as Error).message).toContain('country');
    expect(mockSearchPublishers).not.toHaveBeenCalled();
  });

  /**
   * A whitespace-only country reached the same silent outcome by a different route:
   * the forward tested `?.trim()`, so it was dropped before the request. It is now
   * forwarded verbatim, and `/organization?country=%20%20` answers `400 Cannot parse`
   * — an error naming the value, which is the point.
   */
  it('forwards a whitespace-only country rather than dropping the filter', async () => {
    mockSearchPublishers.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchPublishers.errors });
    await gbifSearchPublishers.handler(gbifSearchPublishers.input.parse({ country: '   ' }), ctx);

    expect(mockSearchPublishers).toHaveBeenCalledWith(
      expect.objectContaining({ country: '   ' }),
      ctx,
    );
  });

  /** Omitting the field is still how a caller searches every country. */
  it('omits country when not provided', async () => {
    mockSearchPublishers.mockResolvedValue({
      results: [],
      count: 3561,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchPublishers.errors });
    await gbifSearchPublishers.handler(gbifSearchPublishers.input.parse({ q: 'museum' }), ctx);

    expect(mockSearchPublishers).toHaveBeenCalledWith(
      expect.not.objectContaining({ country: expect.anything() }),
      ctx,
    );
  });

  /**
   * #54 — a blank q used to be dropped before the request, which is how the registry
   * answered a name search with every name in it. Measured on the built server:
   * `/organization?q=` and `?q=%20%20` each return all 3,561 registered
   * organizations, against 460 for `museum`. Both forms are silent here, unlike
   * `country`, where only the empty string is.
   */
  it.each(['', '   '])('rejects q "%s" instead of searching every organization', async (blank) => {
    const ctx = createMockContext({ errors: gbifSearchPublishers.errors });
    const input = gbifSearchPublishers.input.parse({ q: blank });
    expect(input.q).toBe(blank);

    const err = await gbifSearchPublishers.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect((err as Error).message).toContain('q');
    expect(mockSearchPublishers).not.toHaveBeenCalled();
  });

  /** Omitting the field is still how a caller browses without a name term. */
  it('omits q when not provided', async () => {
    mockSearchPublishers.mockResolvedValue({
      results: [],
      count: 3561,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchPublishers.errors });
    await gbifSearchPublishers.handler(gbifSearchPublishers.input.parse({ country: 'GB' }), ctx);

    expect(mockSearchPublishers).toHaveBeenCalledWith(
      expect.not.objectContaining({ q: expect.anything() }),
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

  /**
   * #47 — a country value GBIF cannot parse comes back as a 400 ("Cannot parse ZZZZ
   * into a known Country"), which this tool declared no contract entry for.
   */
  it('propagates the upstream invalid_filter reason and declares it (issue #47)', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockSearchPublishers.mockRejectedValue(
      new McpError(
        JsonRpcErrorCode.InvalidParams,
        'GBIF API returned HTTP 400 Bad Request. Cannot parse ZZZZ into a known Country',
        { status: 400, reason: 'invalid_filter' },
      ),
    );

    const ctx = createMockContext({ errors: gbifSearchPublishers.errors });
    const input = gbifSearchPublishers.input.parse({ country: 'ZZZZ' });

    const err = await gbifSearchPublishers.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });

    const declared = gbifSearchPublishers.errors?.find((e) => e.reason === 'invalid_filter');
    expect(declared?.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(declared?.recovery).toBeTruthy();
  });
});
