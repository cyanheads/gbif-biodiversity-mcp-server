/**
 * @fileoverview Tests for gbif_bulk_match_species tool.
 * @module tests/tools/gbif-bulk-match-species.tool.test
 */

import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
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
  // A misspelled species falls back to its genus at confidence 92.
  'Turdus imaginarius': {
    matchType: 'HIGHERRANK',
    usageKey: 2490714,
    scientificName: 'Turdus Linnaeus, 1758',
    canonicalName: 'Turdus',
    rank: 'GENUS',
    status: 'ACCEPTED',
    confidence: 92,
  },
  // The genus it falls back to is itself a synonym (Nyctea → Bubo); the classification
  // fields are the accepted taxon's, genus "Bubo" under genusKey = acceptedUsageKey.
  'Nyctea xyzzyqq': {
    matchType: 'HIGHERRANK',
    usageKey: 2497867,
    acceptedUsageKey: 5959091,
    scientificName: 'Nyctea Stephens, 1826',
    canonicalName: 'Nyctea',
    rank: 'GENUS',
    status: 'SYNONYM',
    confidence: 94,
    kingdom: 'Animalia',
    genus: 'Bubo',
    kingdomKey: 1,
    genusKey: 5959091,
  },
  // A bird genus and a plant genus share the name.
  Oenanthe: {
    confidence: 100,
    note: 'Multiple equal matches for Oenanthe',
    matchType: 'NONE',
    synonym: false,
  },
};

const textOf = (content: unknown) => JSON.stringify(content);

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

    // Characterization — EXACT, FUZZY, and a NONE GBIF gave no note on carry no note.
    expect(exact).not.toHaveProperty('note');
    expect(fuzzy).not.toHaveProperty('note');
    expect(none).not.toHaveProperty('note');
  });

  /**
   * #73 — a misspelled species came back as its genus with nothing on the row saying
   * so. The row keeps its taxonKey and carries a note naming the higher taxon.
   */
  it('notes a HIGHERRANK row on both surfaces without changing its taxonKey', async () => {
    const result = await runToolContract(gbifBulkMatchSpecies, {
      names: ['Panthera leo', 'Turdus imaginarius'],
    });

    expect(result.isError).not.toBe(true);
    const [exact, higher] = (result.structuredContent as { results: Record<string, unknown>[] })
      .results;
    expect(exact).not.toHaveProperty('note');
    expect(higher).toMatchObject({ taxonKey: 2490714, matchType: 'HIGHERRANK' });
    const note = higher.note as string;
    for (const text of [
      'HIGHERRANK',
      'Turdus, rank GENUS',
      'taxonKey 2490714 covers that whole taxon',
      'strict: true',
    ])
      expect(note).toContain(text);
    expect(textOf(result.content)).toContain('Turdus, rank GENUS');
    expect(textOf(result.content)).toContain('taxonKey 2490714 covers that whole taxon');
  });

  /**
   * The genus GBIF falls back to is a synonym, so taxonKey 5959091 is the accepted genus
   * Bubo. The note must say that key covers Bubo rather than Nyctea, and content[] must
   * attribute the synonym to the name GBIF matched, not to the queried name.
   */
  it('notes a HIGHERRANK synonym row on both surfaces with what taxonKey covers', async () => {
    const result = await runToolContract(gbifBulkMatchSpecies, { names: ['Nyctea xyzzyqq'] });

    expect(result.isError).not.toBe(true);
    const [entry] = (result.structuredContent as { results: Record<string, unknown>[] }).results;
    expect(entry).toMatchObject({ taxonKey: 5959091, matchedTaxonKey: 2497867 });
    const note = entry.note as string;
    expect(note).toContain('Nyctea, rank GENUS, a synonym');
    expect(note).toContain('taxonKey 5959091 is its accepted taxon, Bubo, and covers all of Bubo');
    expect(note).not.toContain('covers that whole taxon');
    const text = textOf(result.content);
    expect(text).toContain('taxonKey 5959091 is its accepted taxon, Bubo, and covers all of Bubo');
    expect(text).toContain(
      '**Matched taxon key:** 2497867 — the name GBIF matched is a synonym; the taxon key above is the accepted taxon it resolves to.',
    );
    expect(text).not.toContain('this name is a synonym');
  });

  /** #73 — GBIF's own explanation for a NONE was dropped. */
  it('carries the ambiguity note onto a NONE row with a single-name kingdom retry', async () => {
    const result = await runToolContract(gbifBulkMatchSpecies, { names: ['Oenanthe'] });

    expect(result.isError).not.toBe(true);
    const [entry] = (result.structuredContent as { results: Record<string, unknown>[] }).results;
    expect(entry).toMatchObject({ name: 'Oenanthe', matchType: 'NONE' });
    expect(entry).not.toHaveProperty('taxonKey');
    expect(entry.note).toContain('Multiple equal matches for Oenanthe');
    expect(entry.note).toContain('gbif_match_species');
    expect(entry.note).toContain('kingdom');
    expect(textOf(result.content)).toContain('Multiple equal matches for Oenanthe');
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
    expect(result.results[1]).not.toHaveProperty('note');
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
    // A plain (non-HIGHERRANK) synonym carries no note.
    expect(result.results[0]).not.toHaveProperty('note');
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
    // The HIGHERRANK note discloses the fallback without inventing the missing rank.
    expect(entry.note).toContain('Aves');
    expect(entry.note).toContain('no rank');
    expect(entry.note).not.toContain('null');
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
          name: 'Oenanthe',
          matchType: 'NONE',
          note: 'GBIF reported "Multiple equal matches for Oenanthe". *Retry* with kingdom.',
        },
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
    expect(text).toContain(
      '**Matched taxon key:** 7630906 — the name GBIF matched is a synonym; the taxon key above is the accepted taxon it resolves to.',
    );
    expect(text).toContain('invalid_filter');
    // The note reaches content[] escaped, so CommonMark renders GBIF's text literally.
    expect(text).toContain(
      '**Note:** GBIF reported "Multiple equal matches for Oenanthe". &#42;Retry&#42; with kingdom.',
    );
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});
