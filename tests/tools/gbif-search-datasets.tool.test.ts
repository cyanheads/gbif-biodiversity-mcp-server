/**
 * @fileoverview Tests for gbif_search_datasets tool.
 * @module tests/tools/gbif-search-datasets.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
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

  /**
   * Pins the whole row as it stands before the publishing-organization fields
   * arrive: a record GBIF returns without them must project to exactly this,
   * with no new key appearing and no existing value moving.
   */
  it('projects a row without publishing-organization fields to exactly the existing fields', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [makeDataset({ description: '<p>Cornell Lab checklist data.</p>' })],
      count: 1,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const result = await runToolContract(gbifSearchDatasets, { q: 'eBird' });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.datasets).toEqual([
      {
        key: 'abc-def-123',
        title: 'eBird Basic Dataset',
        type: 'OCCURRENCE',
        description: 'Cornell Lab checklist data.',
        descriptionTruncated: false,
        license: 'CC_BY_NC_4_0',
        doi: '10.15468/aomfnb',
        publishingCountry: 'US',
        recordCount: 1500000000,
      },
    ]);
    expect(JSON.stringify(result.content)).not.toContain('Publishing organization');
  });

  /**
   * #79 — `/dataset/search` names the publishing organization on every row, by
   * key and by title, and the key is what `publishingOrg` takes. A page mixes rows
   * that carry the pair, rows that carry only the key, and rows that carry
   * neither; each projects what GBIF sent and nothing else, on both surfaces.
   */
  it('returns the publishing organization key and title per row on both surfaces', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [
        makeDataset({
          key: 'row-with-both',
          publishingOrganizationKey: '28eb1a3f-1c15-4a95-931a-4af90ecb574d',
          publishingOrganizationTitle: 'Museum *of* [Natural] History_ & <Co>',
        }),
        makeDataset({
          key: 'row-with-key',
          publishingOrganizationKey: 'e2e717bf-551a-4917-bdc9-4fa0f342c530',
        }),
        makeDataset({ key: 'row-with-neither' }),
      ],
      count: 3,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const result = await runToolContract(gbifSearchDatasets, { q: 'museum' });

    expect(result.isError).not.toBe(true);
    const rows = result.structuredContent?.datasets as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    const [both, keyOnly, neither] = rows;
    expect(both).toMatchObject({
      key: 'row-with-both',
      publishingOrganizationKey: '28eb1a3f-1c15-4a95-931a-4af90ecb574d',
      publishingOrganizationTitle: 'Museum *of* [Natural] History_ & <Co>',
      title: 'eBird Basic Dataset',
      recordCount: 1500000000,
    });
    expect(keyOnly).toMatchObject({
      publishingOrganizationKey: 'e2e717bf-551a-4917-bdc9-4fa0f342c530',
    });
    expect(keyOnly?.publishingOrganizationTitle).toBeUndefined();
    expect(neither?.publishingOrganizationKey).toBeUndefined();
    expect(neither?.publishingOrganizationTitle).toBeUndefined();

    const text = JSON.stringify(result.content);
    expect(text).toContain('28eb1a3f-1c15-4a95-931a-4af90ecb574d');
    expect(text).toContain('e2e717bf-551a-4917-bdc9-4fa0f342c530');
    expect(text).toContain('Museum &#42;of&#42; &#91;Natural&#93; History&#95; &#38; &#60;Co&#62;');
    expect(text).not.toContain('Museum *of*');
  });

  it('names the publishingOrg chain on the publishing organization key description', () => {
    const description =
      gbifSearchDatasets.output.shape.datasets.element.shape.publishingOrganizationKey
        .description ?? '';

    expect(description).toContain('publishingOrg');
    expect(description).toContain('gbif_search_datasets');
  });

  /** offset 0 and limit 1 are the lower bounds and reach GBIF as sent. */
  it('accepts and forwards the lowest limit and offset', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const result = await runToolContract(gbifSearchDatasets, { limit: 1, offset: 0 });

    expect(result.isError).not.toBe(true);
    expect(mockSearchDatasets).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1, offset: 0 }),
      expect.anything(),
    );
  });

  /**
   * #75 — `/dataset/search` answers `limit=2.5&offset=1.5` with its defaults
   * (20 rows from offset 0) and a 200, so a fraction that reached it returned the
   * wrong page as a success. It now fails at the schema, naming the field.
   */
  it.each([
    ['offset', { offset: 1.5 }],
    ['limit', { limit: 2.5 }],
  ])('rejects a fractional %s at the schema before any request', async (field, paging) => {
    const result = await runToolContract(gbifSearchDatasets, paging);

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: JsonRpcErrorCode.InvalidParams,
      data: { reason: 'invalid_arguments' },
    });
    expect(JSON.stringify(result.content)).toContain(field);
    expect(mockSearchDatasets).not.toHaveBeenCalled();
  });

  it('advertises limit and offset as integers with their bounds and defaults', () => {
    const { properties } = z.toJSONSchema(gbifSearchDatasets.input) as {
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

  /**
   * #51 — `/dataset/search` carries the same silent-zero hole as
   * `/occurrence/search`: it parses the code, then matches the verbatim stored
   * one. `GB` returns 2,416 datasets while `gb`, `Gb`, `gB`, `gbr`, `GBR`, and
   * `USA` each return 0, with nothing in the response marking the filter as
   * malformed. `AA`, `XK`, `XZ`, and `ZZ` stay out of this list — GBIF assigns
   * all four (`/enumeration/basic/Country` carries them alongside the 249
   * officially assigned ISO codes) and `ZZ` has 148 real datasets, so a zero
   * there is an empty bucket.
   */
  it('rejects publishingCountry forms GBIF would answer with a silent zero', () => {
    for (const bad of ['gb', 'Gb', 'gB', 'gbr', 'GBR', 'USA', 'gb ']) {
      expect(() => gbifSearchDatasets.input.parse({ publishingCountry: bad })).toThrow();
    }
    expect(() => gbifSearchDatasets.input.parse({ publishingCountry: 'GB' })).not.toThrow();
    expect(() => gbifSearchDatasets.input.parse({ publishingCountry: 'ZZ' })).not.toThrow();
  });

  /**
   * The empty string is the worse half: the handler's `?.trim()` guard dropped it
   * from the query, so a caller who believed they had filtered by publisher
   * country got all 123,527 indexed datasets back.
   */
  it('rejects an empty publishingCountry rather than dropping it into an unfiltered search', () => {
    expect(() => gbifSearchDatasets.input.parse({ publishingCountry: '' })).toThrow();
  });

  /**
   * #52 — `/dataset/search` carries two organization filters for two different
   * relationships, and only `hostingOrg` was exposed. Measured live: of the first
   * 25 organizations `/organization?country=GB` lists, all 25 host no datasets
   * while 13 publish one or two that only `publishingOrg` reaches. Parsing the
   * field is what proves it is declared — an undeclared key is stripped by Zod,
   * so a forwarding assertion alone would hold against a tool that never had it.
   */
  it('declares publishingOrg and forwards it to the service', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchDatasets.errors });
    const input = gbifSearchDatasets.input.parse({
      publishingOrg: '0d72dd7f-6f05-46af-85c2-8b6e77ce5534',
    });
    expect(input.publishingOrg).toBe('0d72dd7f-6f05-46af-85c2-8b6e77ce5534');

    await gbifSearchDatasets.handler(input, ctx);

    expect(mockSearchDatasets).toHaveBeenCalledWith(
      expect.objectContaining({ publishingOrg: '0d72dd7f-6f05-46af-85c2-8b6e77ce5534' }),
      ctx,
    );
  });

  it('forwards hostingOrg unchanged, and both organization filters together', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchDatasets.errors });
    const input = gbifSearchDatasets.input.parse({
      hostingOrg: '07f617d0-c688-11d8-bf62-b8a03c50a862',
      publishingOrg: '0d72dd7f-6f05-46af-85c2-8b6e77ce5534',
    });
    await gbifSearchDatasets.handler(input, ctx);

    expect(mockSearchDatasets).toHaveBeenCalledWith(
      expect.objectContaining({
        hostingOrg: '07f617d0-c688-11d8-bf62-b8a03c50a862',
        publishingOrg: '0d72dd7f-6f05-46af-85c2-8b6e77ce5534',
      }),
      ctx,
    );
  });

  /**
   * Both silent classes, alongside the malformed one GBIF answers with a 400.
   * An empty organization value returns all 123,527 indexed datasets, so a guard
   * that skipped blank values would hand the whole index to a caller who believed
   * they had filtered by organization. And these two parameters are matched
   * case-sensitively — `publishingOrg` upper-cased answers 0 where the same key
   * lowercased answers 3 — so an upper-cased key is a wrong answer, not an error.
   */
  it.each([
    ['publishingOrg', 'not-a-uuid'],
    ['publishingOrg', ''],
    ['publishingOrg', '0D72DD7F-6F05-46AF-85C2-8B6E77CE5534'],
    ['publishingOrg', '0d72dd7f-6F05-46af-85c2-8b6e77ce5534'],
    ['hostingOrg', 'not-a-uuid'],
    ['hostingOrg', ''],
    ['hostingOrg', '07F617D0-C688-11D8-BF62-B8A03C50A862'],
  ])('rejects %s "%s" as invalid_filter without calling GBIF', async (field, value) => {
    const ctx = createMockContext({ errors: gbifSearchDatasets.errors });
    const input = gbifSearchDatasets.input.parse({ [field]: value });

    const err = await gbifSearchDatasets.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect((err as Error).message).toContain(field);
    expect(mockSearchDatasets).not.toHaveBeenCalled();
  });

  /**
   * GBIF intersects the two organization filters, so a caller who put one key in
   * both fields asked for what that organization published *and* serves — usually
   * nothing. The generic "drop a filter" notice would send them to retry the same
   * confusion; naming the intersection is what separates it from an empty search.
   */
  it('names the intersection in the empty-result notice when both organization filters were applied', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchDatasets.errors });
    const input = gbifSearchDatasets.input.parse({
      publishingOrg: '0d72dd7f-6f05-46af-85c2-8b6e77ce5534',
      hostingOrg: '0d72dd7f-6f05-46af-85c2-8b6e77ce5534',
    });
    await gbifSearchDatasets.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('publishingOrg and hostingOrg were both applied');
    expect(notice).toContain('intersects');
  });

  it('leaves the empty-result notice generic when only one organization filter was applied', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchDatasets.errors });
    const input = gbifSearchDatasets.input.parse({
      publishingOrg: '0d72dd7f-6f05-46af-85c2-8b6e77ce5534',
    });
    await gbifSearchDatasets.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('No datasets matched');
    expect(notice).not.toContain('both applied');
  });

  /**
   * The two filters name two different relationships and a caller reading either
   * one alone has to be able to tell which they want — the same hazard `country`
   * and `publishingCountry` carry on the occurrence tools, guarded the same way.
   */
  it('has each organization field name the other as the different question', () => {
    const shape = gbifSearchDatasets.input.shape;
    const publishing = shape.publishingOrg.description ?? '';
    const hosting = shape.hostingOrg.description ?? '';

    expect(publishing).toContain('hostingOrg');
    expect(publishing).toMatch(/published/);
    expect(hosting).toContain('publishingOrg');
    expect(hosting).toMatch(/installation/);
    for (const description of [publishing, hosting]) {
      expect(description).toMatch(/intersected/);
    }
  });

  /**
   * #54 — the forward tested `?.trim()`, so a blank q was dropped. `/dataset/search`
   * answers the two blank forms two different ways and neither is the search that was
   * asked for: `?q=` returns all 123,527 indexed datasets, exactly what the same call
   * returns with no q at all, and `?q=%20%20` returns none, against 1,193 for `moths`.
   */
  it.each(['', '   '])('rejects q "%s" instead of browsing the whole index', async (blank) => {
    const ctx = createMockContext({ errors: gbifSearchDatasets.errors });
    const input = gbifSearchDatasets.input.parse({ q: blank });
    expect(input.q).toBe(blank);

    const err = await gbifSearchDatasets.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect((err as Error).message).toContain('q');
    expect(mockSearchDatasets).not.toHaveBeenCalled();
  });

  /** Omitting the field is still how a caller browses without a term. */
  it('omits q when not provided', async () => {
    mockSearchDatasets.mockResolvedValue({
      results: [],
      count: 123527,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchDatasets.errors });
    await gbifSearchDatasets.handler(gbifSearchDatasets.input.parse({ type: 'CHECKLIST' }), ctx);

    expect(mockSearchDatasets).toHaveBeenCalledWith(
      expect.not.objectContaining({ q: expect.anything() }),
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

  /**
   * #48 — recordCount spans every occurrenceStatus while gbif_count_occurrences
   * defaults to PRESENT, so the field has to name its own scope and the tool that
   * answers the other question. Without both, a 499x gap reads as a data error.
   */
  it('scopes the recordCount description and names the presence-scoped tool', () => {
    const description =
      gbifSearchDatasets.output.shape.datasets.element.shape.recordCount.description ?? '';

    expect(description).toContain('occurrenceStatus');
    expect(description).toContain('absence records');
    expect(description).toContain('gbif_count_occurrences');
  });

  it('states the recordCount scope in content once, and only when a count is rendered', () => {
    const counted = gbifSearchDatasets.format!({
      datasets: [
        { key: 'a', title: 'A', recordCount: 30622351 },
        { key: 'b', title: 'B', recordCount: 61357 },
      ],
    });
    const countedText = counted[0].type === 'text' ? counted[0].text : '';
    expect(countedText).toContain('absences included');
    expect(countedText).toContain('gbif_count_occurrences');
    expect(countedText.match(/absences included/g)).toHaveLength(1);

    const uncounted = gbifSearchDatasets.format!({
      datasets: [{ key: 'c', title: 'C' }],
    });
    const uncountedText = uncounted[0].type === 'text' ? uncounted[0].text : '';
    expect(uncountedText).not.toContain('absences included');
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
    expect(fullText).toContain('Short&#46;');
    expect(fullText).not.toContain('description truncated');
  });

  /**
   * #84 — `/dataset/search` serves `offset + limit` up to 125,000 under any filter
   * and answers HTTP 500 past it at any offset, which the service retried before
   * failing. The sum is checked before the request now, and a match larger than the
   * ceiling — the unfiltered index among them — says so on every page.
   */
  describe('offset ceiling (#84)', () => {
    const declaredRecovery = () =>
      gbifSearchDatasets.errors?.find((e) => e.reason === 'pagination_cap_exceeded')?.recovery;

    /** One `/dataset/search` page in the live shape of the unfiltered index. */
    const page = (overrides: Record<string, unknown> = {}) => ({
      results: [makeDataset({ numRecords: undefined })],
      count: 125458,
      offset: 0,
      limit: 20,
      endOfRecords: false,
      ...overrides,
    });

    it.each([
      [124_980, 20],
      [124_999, 1],
    ])('sends offset %i + limit %i, a sum at the ceiling', async (offset, limit) => {
      mockSearchDatasets.mockResolvedValue(page({ offset, limit }));

      const result = await runToolContract(gbifSearchDatasets, { offset, limit });

      expect(result.isError).not.toBe(true);
      expect(mockSearchDatasets).toHaveBeenCalledTimes(1);
      expect(mockSearchDatasets.mock.calls[0][0]).toMatchObject({ offset, limit });
    });

    it.each([
      { offset: 124_981, limit: 20, filters: {} },
      { offset: 124_999, limit: 2, filters: { type: 'CHECKLIST' } },
      { offset: 125_000, limit: 1, filters: { q: 'bird', publishingCountry: 'GB' } },
      { offset: 125_000, limit: 20, filters: {} },
    ])(
      'refuses offset $offset + limit $limit with filters $filters before the request',
      async ({ offset, limit, filters }) => {
        mockSearchDatasets.mockResolvedValue(page({ offset, limit }));

        const result = await runToolContract(gbifSearchDatasets, { ...filters, offset, limit });

        expect(result.isError).toBe(true);
        expect(result.structuredContent?.error).toMatchObject({
          code: JsonRpcErrorCode.ValidationError,
          data: { reason: 'pagination_cap_exceeded', recovery: { hint: declaredRecovery() } },
        });
        const text = JSON.stringify(result.content);
        expect(text).toContain(`offset + limit (${offset + limit}) exceeds 125,000`);
        expect(text).toContain('exactly one of the four');
        expect(mockSearchDatasets).not.toHaveBeenCalled();
      },
    );

    it('declares a recovery that names the ceiling and only filters this tool takes', () => {
      const recovery = declaredRecovery() ?? '';
      expect(recovery).toContain('125,000');
      expect(recovery).toMatch(/exactly one of the four/);
      const inputs = Object.keys(gbifSearchDatasets.input.shape);
      for (const field of ['type', 'q', 'publishingCountry', 'publishingOrg', 'hostingOrg']) {
        expect(recovery).toContain(field);
        expect(inputs).toContain(field);
      }
      expect(
        gbifSearchDatasets.errors?.find((e) => e.reason === 'pagination_cap_exceeded')?.code,
      ).toBe(JsonRpcErrorCode.ValidationError);
    });

    it('states the ceiling in the offset and notice descriptions', () => {
      expect(gbifSearchDatasets.input.shape.offset.description).toContain('125,000');
      expect(gbifSearchDatasets.enrichment?.notice?.description).toContain('125,000');
    });

    /** Step 4 of #84, one page short of the ceiling: the unfiltered index is deeper than it. */
    it('names the ceiling and the type split on a match deeper than it, on both surfaces', async () => {
      mockSearchDatasets.mockResolvedValue(page({ offset: 124_980 }));

      const result = await runToolContract(gbifSearchDatasets, { offset: 124_980, limit: 20 });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        totalCount: 125458,
        offset: 124_980,
        endOfRecords: false,
      });
      const notice = result.structuredContent?.notice as string;
      for (const text of ['125,458 datasets match', '125,000', 'type', 'publishingOrg'])
        expect(notice).toContain(text);
      const content = JSON.stringify(result.content);
      expect(content).toContain('125,458 datasets match');
      expect(content).toContain('125,000');
    });

    it.each([
      [125_000, false],
      [125_001, true],
    ])('carries the ceiling notice at totalCount %i: %s', async (count, expected) => {
      mockSearchDatasets.mockResolvedValue(page({ count }));

      const result = await runToolContract(gbifSearchDatasets, {});

      expect(result.isError).not.toBe(true);
      const notice = result.structuredContent?.notice as string | undefined;
      if (expected) {
        expect(notice).toContain(`${count.toLocaleString('en-US')} datasets match`);
        expect(JSON.stringify(result.content)).toContain('125,000');
      } else {
        expect(notice).toBeUndefined();
        expect(JSON.stringify(result.content)).not.toContain('125,000');
      }
    });

    it('joins the ceiling notice with the clamp notice in one notice', async () => {
      mockSearchDatasets.mockResolvedValue(page({ limit: 1000 }));

      const result = await runToolContract(gbifSearchDatasets, { limit: 1001 });

      expect(result.isError).not.toBe(true);
      const notice = result.structuredContent?.notice as string;
      expect(notice).toContain('limit requested 1001; applied 1000.');
      expect(notice).toContain('125,458 datasets match');
      const content = JSON.stringify(result.content);
      expect(content).toContain('limit requested 1001; applied 1000.');
      expect(content).toContain('125,458 datasets match');
      expect(mockSearchDatasets.mock.calls[0][0]).toMatchObject({ limit: 1000 });
    });

    /** A past-end page under the ceiling is still served, with the existing past-end notice. */
    it('serves a past-end page under the ceiling with the past-end notice only', async () => {
      mockSearchDatasets.mockResolvedValue(
        page({ results: [], count: 65347, offset: 124_980, endOfRecords: true }),
      );

      const result = await runToolContract(gbifSearchDatasets, {
        type: 'CHECKLIST',
        offset: 124_980,
        limit: 20,
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.notice).toBe(
        'Offset 124980 exceeds totalCount (65347). Reset offset to 0 or reduce it below 65347 to page through results.',
      );
      expect(mockSearchDatasets.mock.calls[0][0]).toMatchObject({ offset: 124_980, limit: 20 });
    });
  });
});
