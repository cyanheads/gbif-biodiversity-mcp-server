/**
 * @fileoverview Tests for gbif_bulk_match_species tool.
 * @module tests/tools/gbif-bulk-match-species.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifBulkMatchSpecies } from '@/mcp-server/tools/definitions/gbif-bulk-match-species.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** Fixtures mirroring real /species/match responses (verified against the live API). */
const MATCHES: Record<string, unknown> = {
  'Panthera leo': {
    matchType: 'EXACT',
    usageKey: 5219404,
    scientificName: 'Panthera leo (Linnaeus, 1758)',
    canonicalName: 'Panthera leo',
    rank: 'SPECIES',
    status: 'ACCEPTED',
    confidence: 99,
  },
  'Pantera leo': {
    matchType: 'FUZZY',
    usageKey: 5219404,
    scientificName: 'Panthera leo (Linnaeus, 1758)',
    canonicalName: 'Panthera leo',
    rank: 'SPECIES',
    status: 'ACCEPTED',
    confidence: 85,
  },
  // GBIF returns JSON null (not undefined) for every field on a NONE result.
  'Zzxqq notaspecies': {
    matchType: 'NONE',
    usageKey: null,
    scientificName: null,
    canonicalName: null,
    rank: null,
    status: null,
    confidence: 100,
  },
};

describe('gbifBulkMatchSpecies', () => {
  const mockMatchSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ matchSpecies: mockMatchSpecies } as never);
    mockMatchSpecies.mockImplementation(async (params: { name: string }) => {
      const hit = MATCHES[params.name];
      if (hit) return hit;
      return { matchType: 'NONE', usageKey: null };
    });
  });

  it('matches multiple names and preserves input order', async () => {
    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({
      names: ['Zzxqq notaspecies', 'Panthera leo', 'Pantera leo'],
    });
    const result = await gbifBulkMatchSpecies.handler(input, ctx);

    expect(result.results).toHaveLength(3);
    // Order matches the input array, not the order matches resolved in.
    expect(result.results.map((r) => r.name)).toEqual([
      'Zzxqq notaspecies',
      'Panthera leo',
      'Pantera leo',
    ]);

    const [none, exact, fuzzy] = result.results;
    expect(none.matchType).toBe('NONE');
    expect(none.taxonKey).toBeUndefined();

    expect(exact.matchType).toBe('EXACT');
    expect(exact.taxonKey).toBe(5219404);
    expect(exact.canonicalName).toBe('Panthera leo');
    expect(exact.confidence).toBe(99);

    expect(fuzzy.matchType).toBe('FUZZY');
    expect(fuzzy.taxonKey).toBe(5219404);
    expect(fuzzy.confidence).toBe(85);
  });

  it('returns matchType NONE for an unmatched name without sinking the batch', async () => {
    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({
      names: ['Panthera leo', 'Zzxqq notaspecies'],
    });
    const result = await gbifBulkMatchSpecies.handler(input, ctx);

    expect(result.results[0].matchType).toBe('EXACT');
    expect(result.results[0].taxonKey).toBe(5219404);
    expect(result.results[1].matchType).toBe('NONE');
    expect(result.results[1].taxonKey).toBeUndefined();
    expect(result.results[1].scientificName).toBeUndefined();
  });

  it('isolates a per-name lookup failure as matchType ERROR', async () => {
    mockMatchSpecies.mockImplementation(async (params: { name: string }) => {
      if (params.name === 'boom') throw new Error('GBIF API unavailable');
      return MATCHES['Panthera leo'];
    });

    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({ names: ['Panthera leo', 'boom'] });
    const result = await gbifBulkMatchSpecies.handler(input, ctx);

    expect(result.results[0].matchType).toBe('EXACT');
    expect(result.results[0].taxonKey).toBe(5219404);
    // The failed name degrades to ERROR with the reason — the batch still resolves.
    expect(result.results[1].name).toBe('boom');
    expect(result.results[1].matchType).toBe('ERROR');
    expect(result.results[1].error).toContain('GBIF API unavailable');
    expect(result.results[1].taxonKey).toBeUndefined();
  });

  /** #35 — same resolution as gbif_match_species, applied per entry. */
  it('resolves a synonym entry to the accepted key and keeps the matched key', async () => {
    mockMatchSpecies.mockResolvedValue({
      matchType: 'EXACT',
      usageKey: 7630906,
      acceptedUsageKey: 5219404,
      scientificName: 'Felis leo Linnaeus, 1758',
      canonicalName: 'Felis leo',
      rank: 'SPECIES',
      status: 'SYNONYM',
      confidence: 98,
    });

    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({ names: ['Felis leo'] });
    const result = await gbifBulkMatchSpecies.handler(input, ctx);

    expect(result.results[0].taxonKey).toBe(5219404);
    expect(result.results[0].matchedTaxonKey).toBe(7630906);
    expect(result.results[0].status).toBe('SYNONYM');
  });

  it('omits matchedTaxonKey on an accepted entry', async () => {
    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({ names: ['Panthera leo'] });
    const result = await gbifBulkMatchSpecies.handler(input, ctx);

    expect(result.results[0].taxonKey).toBe(5219404);
    expect(result.results[0].matchedTaxonKey).toBeUndefined();
  });

  /**
   * #47 — the per-name catch is the only place a classified failure can surface for
   * this tool, so it must carry the thrown reason rather than flattening to a message.
   */
  it('carries the thrown reason onto the ERROR entry', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockMatchSpecies.mockImplementation(async (params: { name: string }) => {
      if (params.name === 'boom') {
        throw new McpError(
          JsonRpcErrorCode.InvalidParams,
          'GBIF API returned HTTP 400 Bad Request. Cannot parse ZZ into a known Rank',
          { status: 400, reason: 'invalid_filter' },
        );
      }
      return MATCHES['Panthera leo'];
    });

    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({ names: ['Panthera leo', 'boom'] });
    const result = await gbifBulkMatchSpecies.handler(input, ctx);

    expect(result.results[1].matchType).toBe('ERROR');
    expect(result.results[1].reason).toBe('invalid_filter');
    expect(result.results[0].matchType).toBe('EXACT');
  });

  it('leaves reason absent when the failure carried no classification', async () => {
    mockMatchSpecies.mockRejectedValue(new Error('socket hang up'));

    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({ names: ['Panthera leo'] });
    const result = await gbifBulkMatchSpecies.handler(input, ctx);

    expect(result.results[0].matchType).toBe('ERROR');
    expect(result.results[0].error).toContain('socket hang up');
    expect(result.results[0].reason).toBeUndefined();
  });

  it('honors the strict flag', async () => {
    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({ names: ['Panthera leo'], strict: true });
    await gbifBulkMatchSpecies.handler(input, ctx);

    expect(mockMatchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Panthera leo', strict: true }),
      ctx,
    );
  });

  it('defaults strict to false', async () => {
    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({ names: ['Panthera leo'] });
    await gbifBulkMatchSpecies.handler(input, ctx);

    expect(mockMatchSpecies).toHaveBeenCalledWith(expect.objectContaining({ strict: false }), ctx);
  });

  it('coerces null upstream fields to undefined (sparse-payload honesty)', async () => {
    mockMatchSpecies.mockResolvedValue({
      matchType: 'HIGHERRANK',
      usageKey: 9999,
      canonicalName: 'Aves',
      scientificName: null,
      rank: null,
      status: null,
      confidence: 90,
    });

    const ctx = createMockContext();
    const input = gbifBulkMatchSpecies.input.parse({ names: ['birds'] });
    const result = await gbifBulkMatchSpecies.handler(input, ctx);

    const entry = result.results[0];
    expect(entry.taxonKey).toBe(9999);
    expect(entry.matchType).toBe('HIGHERRANK');
    expect(entry.scientificName).toBeUndefined();
    expect(entry.rank).toBeUndefined();
    expect(entry.status).toBeUndefined();
    // No null leaks into the typed output.
    expect(entry.scientificName).not.toBeNull();
  });

  it('admits additional names for explicit remainder reporting', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `Species ${i}`);
    expect(gbifBulkMatchSpecies.input.parse({ names: tooMany }).names).toHaveLength(51);
  });

  it('requires at least one name', () => {
    expect(() => gbifBulkMatchSpecies.input.parse({ names: [] })).toThrow();
  });

  it('rejects empty-string names', () => {
    expect(() => gbifBulkMatchSpecies.input.parse({ names: ['Panthera leo', ''] })).toThrow();
  });

  it('formats matched, NONE, and ERROR entries completely', () => {
    const blocks = gbifBulkMatchSpecies.format!({
      results: [
        {
          name: 'Panthera leo',
          taxonKey: 5219404,
          scientificName: 'Panthera leo (Linnaeus, 1758)',
          canonicalName: 'Panthera leo',
          rank: 'SPECIES',
          status: 'ACCEPTED',
          confidence: 99,
          matchType: 'EXACT',
        },
        {
          name: 'Felis leo',
          taxonKey: 5219404,
          matchedTaxonKey: 7630906,
          canonicalName: 'Felis leo',
          status: 'SYNONYM',
          matchType: 'EXACT',
        },
        { name: 'Zzxqq notaspecies', matchType: 'NONE' },
        {
          name: 'boom',
          matchType: 'ERROR',
          error: 'GBIF API unavailable',
          reason: 'invalid_filter',
        },
      ],
    });

    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Panthera leo');
    expect(text).toContain('5219404');
    expect(text).toContain('EXACT');
    expect(text).toContain('99');
    expect(text).toContain('NONE');
    expect(text).toContain('ERROR');
    expect(text).toContain('GBIF API unavailable');
    // The resolved-synonym key and the failure classification reach content[] too.
    expect(text).toContain('7630906');
    expect(text).toContain('invalid_filter');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});
