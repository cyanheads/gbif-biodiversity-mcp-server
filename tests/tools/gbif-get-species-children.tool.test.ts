/**
 * @fileoverview Tests for gbif_get_species_children tool.
 * @module tests/tools/gbif-get-species-children.tool.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetSpeciesChildren } from '@/mcp-server/tools/definitions/gbif-get-species-children.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** The input JSON Schema `tools/list` advertises; the SDK reads it from `~standard.jsonSchema`. */
function advertisedInput(definition: typeof gbifGetSpeciesChildren) {
  return definition.input['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as {
    properties: Record<string, Record<string, unknown>>;
  };
}

describe('gbifGetSpeciesChildren', () => {
  const mockGetSpeciesChildren = vi.fn();
  const mockGetSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      getSpeciesChildren: mockGetSpeciesChildren,
      getSpecies: mockGetSpecies,
    } as never);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns children and enrichment with pagination metadata', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [
        {
          key: 5231190,
          scientificName: 'Parus major Linnaeus, 1758',
          canonicalName: 'Parus major',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          vernacularName: 'Great Tit',
          numOccurrences: 5000000,
          numDescendants: 12,
        },
        {
          key: 5231191,
          scientificName: 'Parus minor Temminck & Schlegel, 1848',
          canonicalName: 'Parus minor',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
        },
      ],
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 2492278 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(2);
    expect(result.children[0].key).toBe(5231190);
    expect(result.children[0].canonicalName).toBe('Parus major');
    expect(result.children[0].vernacularName).toBe('Great Tit');
    expect(result.children[0].numOccurrences).toBe(5000000);

    const enrichment = getEnrichment(ctx);
    // GBIF's /children response carries no total count, so none is surfaced (issue #3).
    expect(enrichment.totalCount).toBeUndefined();
    expect(enrichment.endOfRecords).toBe(true);
    expect(enrichment.offset).toBe(0);
    expect(enrichment.limit).toBe(20);
    expect(enrichment.notice).toBeUndefined();
    // Final page — no truncation disclosed.
    expect(enrichment.truncated).toBeUndefined();
  });

  // Regression for #3: the handler must not fabricate a totalCount from a `count` field
  // the /species/{key}/children endpoint never returns. Fixture mirrors the real GBIF
  // response shape exactly — results, offset, limit, endOfRecords; no count.
  it('omits totalCount and surfaces only genuine paging fields (issue #3)', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [
        { key: 2487924, scientificName: 'Parus afer Linnaeus, 1766', canonicalName: 'Parus afer' },
        { key: 2487925, canonicalName: 'Parus albiventris' },
        { key: 2487926, canonicalName: 'Parus alpinus' },
      ],
      offset: 0,
      limit: 3,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 2487923, limit: 3 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(3);
    expect(result.children[0].canonicalName).toBe('Parus afer');

    const enrichment = getEnrichment(ctx);
    expect(enrichment).not.toHaveProperty('totalCount');
    expect(enrichment.totalCount).toBeUndefined();
    expect(enrichment.offset).toBe(0);
    expect(enrichment.limit).toBe(3);
    expect(enrichment.endOfRecords).toBe(false);
    // More pages exist — disclose truncation honestly, without fabricating a total.
    expect(enrichment.truncated).toBe(true);
    expect(enrichment.shown).toBe(3);
    expect(enrichment.cap).toBe(3);
  });

  /**
   * #46 — the framework's default truncation notice tells the caller to narrow with
   * filters. /species/{key}/children takes none (it ignores a rank parameter outright),
   * so the guidance must name the offset to advance to instead.
   */
  it('names offset paging in the truncation notice, not filters (issue #46)', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [
        { key: 1, canonicalName: 'A' },
        { key: 2, canonicalName: 'B' },
      ],
      offset: 4,
      limit: 2,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 2435194, limit: 2, offset: 4 });
    await gbifGetSpeciesChildren.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('offset 6');
    expect(notice).toContain('limit');
    expect(notice).not.toMatch(/narrow with filters/i);
  });

  /**
   * #47 — GBIF answers 400 (not 404) for a taxonKey it cannot parse. Since #75 the
   * schema takes integers only, so the one such key left is a safe integer past the
   * 32-bit signed range: live, `/species/999999999999/children` answers 400 with
   * `For input string: "999999999999"`. Run through the real service so the 400 →
   * `invalid_filter` mapping and the declared recovery hint are both exercised.
   */
  it('maps a key past the 32-bit range to the declared invalid_filter reason (issue #47)', async () => {
    const { GbifService } = await vi.importActual<typeof import('@/services/gbif/gbif-service.js')>(
      '@/services/gbif/gbif-service.js',
    );
    vi.mocked(getGbifService).mockReturnValue(
      new GbifService(
        { mcpServerName: 'gbif-biodiversity-mcp-server', mcpServerVersion: 'test' } as AppConfig,
        {} as StorageService,
        { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1000 },
      ),
    );
    const fetch = vi.fn((address: string) => {
      const url = new URL(address);
      if (url.hostname === 'api.gbif.org' && url.pathname === '/v1/species/999999999999/children')
        return Promise.resolve(new Response('For input string: "999999999999"', { status: 400 }));
      return Promise.reject(new Error(`Unmocked request: ${address}`));
    });
    vi.stubGlobal('fetch', fetch);

    const result = await runToolContract(gbifGetSpeciesChildren, { taxonKey: 999999999999 });

    const declared = gbifGetSpeciesChildren.errors?.find((e) => e.reason === 'invalid_filter');
    expect(declared?.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(declared?.when).not.toMatch(/fraction/i);
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: JsonRpcErrorCode.InvalidParams,
      data: { reason: 'invalid_filter', recovery: { hint: declared?.recovery } },
    });
    const text = JSON.stringify(result.content);
    expect(text).toContain('For input string');
    expect(text).toContain(declared?.recovery);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('enriches with notice when valid taxon has no children', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });
    // Existence check succeeds — taxon exists but has no children
    mockGetSpecies.mockResolvedValue({
      key: 5231190,
      rank: 'SPECIES',
      canonicalName: 'Parus major',
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 5231190 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('no direct children');
  });

  it('throws not_found when empty results and taxon does not exist', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });
    // Existence check fails — key does not exist in the backbone
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetSpecies.mockRejectedValue(new McpError(JsonRpcErrorCode.NotFound, 'Not found'));

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 999999999 });

    await expect(gbifGetSpeciesChildren.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('passes limit and offset to service', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      offset: 40,
      limit: 10,
      endOfRecords: true,
    });
    // Existence check succeeds
    mockGetSpecies.mockResolvedValue({ key: 100, rank: 'GENUS', canonicalName: 'TestGenus' });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 100, limit: 10, offset: 40 });
    await gbifGetSpeciesChildren.handler(input, ctx);

    expect(mockGetSpeciesChildren).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ limit: 10, offset: 40 }),
      ctx,
    );
  });

  it('handles sparse child records', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [{ key: 999 }],
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 100 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children[0].key).toBe(999);
    expect(result.children[0].canonicalName).toBeUndefined();
    expect(result.children[0].vernacularName).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      children: [
        {
          key: 5231190,
          canonicalName: 'Parus major',
          scientificName: 'Parus major Linnaeus, 1758',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          vernacularName: 'Great Tit',
          numOccurrences: 5000000,
          numDescendants: 12,
        },
      ],
    };
    const blocks = gbifGetSpeciesChildren.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
  });

  /**
   * #39 — GBIF leaves canonicalName null on backbone entries whose names are not
   * parseable binomials (live: child 216995197 of "unclassified Coleoptera" has
   * scientificName "coleopteraJanzen01" and canonicalName null).
   */
  it('falls back to scientificName instead of printing Unknown (issue #39)', () => {
    const blocks = gbifGetSpeciesChildren.format!({
      children: [{ key: 216995197, scientificName: 'coleopteraJanzen01', rank: 'UNRANKED' }],
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toContain('coleopteraJanzen01');
    expect(text).not.toContain('Unknown');
  });

  it('still prints Unknown when GBIF supplies no name at all', () => {
    const blocks = gbifGetSpeciesChildren.format!({ children: [{ key: 999 }] });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toContain('Unknown');
  });

  /**
   * Live, `/species/{key}/children` rows carry no `numOccurrences` key at all (checked
   * on the children of Puma, 2435098), so the field's description must not present
   * it as something GBIF reports here.
   */
  it('describes numOccurrences as absent from this listing and names where a count comes from', () => {
    const description =
      gbifGetSpeciesChildren.output.shape.children.element.shape.numOccurrences.description;
    expect(description).toContain('gbif_count_occurrences');
    expect(description).toMatch(/absent/);
  });

  /**
   * #75 — `taxonKey`, `limit`, and `offset` were `z.number()`, so a fraction reached
   * GBIF: a fractional key failed as a 400 after the round trip, and a fractional
   * limit or offset was replaced by GBIF's default and answered as a success.
   */
  describe('integer inputs (#75)', () => {
    it('advertises taxonKey, limit, and offset as integers with their bounds', () => {
      const { properties } = advertisedInput(gbifGetSpeciesChildren);
      expect(properties.taxonKey).toMatchObject({
        type: 'integer',
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      });
      expect(properties.limit).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
        default: 20,
      });
      expect(properties.offset).toMatchObject({
        type: 'integer',
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
        default: 0,
      });
    });

    it.each([
      { field: 'taxonKey', args: { taxonKey: 2435098.5 } },
      { field: 'taxonKey', args: { taxonKey: -5 } },
      { field: 'limit', args: { taxonKey: 2435098, limit: 2.5 } },
      { field: 'limit', args: { taxonKey: 2435098, limit: 1000.5 } },
      { field: 'offset', args: { taxonKey: 2435098, offset: 1.5 } },
      { field: 'offset', args: { taxonKey: 2435098, offset: -1 } },
    ])('rejects $args at the schema before any request', async ({ field, args }) => {
      const result = await runToolContract(gbifGetSpeciesChildren, args);

      expect(result.isError).toBe(true);
      expect(result.structuredContent?.error).toMatchObject({
        code: JsonRpcErrorCode.InvalidParams,
        data: { reason: 'invalid_arguments' },
      });
      expect(JSON.stringify(result.content)).toContain(field);
      expect(mockGetSpeciesChildren).not.toHaveBeenCalled();
      expect(mockGetSpecies).not.toHaveBeenCalled();
    });

    /** Key 0 is the backbone's incertae sedis kingdom; live, its children answer 200. */
    it('passes taxonKey 0 and the boundary paging integers through to GBIF', async () => {
      mockGetSpeciesChildren.mockResolvedValue({
        results: [{ key: 11856190, canonicalName: 'Incertae sedis child' }],
        offset: 0,
        limit: 1,
        endOfRecords: false,
      });

      const result = await runToolContract(gbifGetSpeciesChildren, {
        taxonKey: 0,
        limit: 1,
        offset: 0,
      });

      expect(result.isError).not.toBe(true);
      expect(mockGetSpeciesChildren).toHaveBeenCalledWith(
        0,
        { limit: 1, offset: 0 },
        expect.anything(),
      );
      expect(result.structuredContent).toMatchObject({ children: [{ key: 11856190 }] });
    });

    it('holds the integer constraints with read-limit clamping off', async () => {
      vi.stubEnv('GBIF_CLAMP_READ_LIMITS', 'false');
      vi.resetModules();
      try {
        const { gbifGetSpeciesChildren: strict } = await import(
          '@/mcp-server/tools/definitions/gbif-get-species-children.tool.js'
        );
        expect(strict.input.safeParse({ taxonKey: 1, limit: 1000 }).success).toBe(true);
        expect(strict.input.safeParse({ taxonKey: 1, limit: 1001 }).success).toBe(false);
        expect(strict.input.safeParse({ taxonKey: 1, limit: 999.5 }).success).toBe(false);
        expect(strict.input.safeParse({ taxonKey: 1.5 }).success).toBe(false);
        expect(advertisedInput(strict).properties.limit).toMatchObject({
          type: 'integer',
          minimum: 1,
          maximum: 1000,
        });
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    });
  });
});
