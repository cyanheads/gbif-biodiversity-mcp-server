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
  'Parus major': {
    usageKey: 9705453,
    scientificName: 'Parus major Linnaeus, 1758',
    canonicalName: 'Parus major',
    rank: 'SPECIES',
    status: 'ACCEPTED',
    confidence: 99,
    matchType: 'EXACT',
  },
  'Quercus robur': {
    usageKey: 2878688,
    scientificName: 'Quercus robur L.',
    canonicalName: 'Quercus robur',
    rank: 'SPECIES',
    status: 'ACCEPTED',
    confidence: 97,
    matchType: 'EXACT',
  },
  // #85 — species "Cyanistes caeruleus" sits under speciesKey = acceptedUsageKey.
  'Parus caeruleus': {
    usageKey: 8191482,
    acceptedUsageKey: 2487879,
    scientificName: 'Parus caeruleus Linnaeus, 1758',
    canonicalName: 'Parus caeruleus',
    rank: 'SPECIES',
    status: 'SYNONYM',
    confidence: 98,
    matchType: 'EXACT',
    genus: 'Cyanistes',
    species: 'Cyanistes caeruleus',
    genusKey: 2487875,
    speciesKey: 2487879,
  },
  // #85 — the accepted taxon 7222149 is a subspecies; speciesKey 8848598 is its parent.
  'Chrysanthemum leucanthemum': {
    usageKey: 3134125,
    acceptedUsageKey: 7222149,
    scientificName: 'Chrysanthemum leucanthemum L.',
    canonicalName: 'Chrysanthemum leucanthemum',
    rank: 'SPECIES',
    status: 'SYNONYM',
    confidence: 98,
    matchType: 'EXACT',
    species: 'Leucanthemum vulgare',
    speciesKey: 8848598,
  },
};

/** #81 — live /species/match answers for a name sent with a kingdom. */
const KINGDOM_MATCHES: Record<string, unknown> = {
  'Oenanthe|Animalia': {
    usageKey: 2492483,
    scientificName: 'Oenanthe Vieillot, 1816',
    canonicalName: 'Oenanthe',
    rank: 'GENUS',
    status: 'ACCEPTED',
    confidence: 95,
    matchType: 'EXACT',
  },
  'Prunella|Plantae': {
    usageKey: 2926553,
    scientificName: 'Prunella L.',
    canonicalName: 'Prunella',
    rank: 'GENUS',
    status: 'ACCEPTED',
    confidence: 96,
    matchType: 'EXACT',
  },
  'Parus major|Plantae': {
    usageKey: 9711704,
    acceptedUsageKey: 5371529,
    scientificName: 'Pyrus major (Cardot) M.F.Fay & Christenh.',
    canonicalName: 'Pyrus major',
    rank: 'SPECIES',
    status: 'SYNONYM',
    confidence: 86,
    matchType: 'FUZZY',
    species: 'Rhaphiolepis major',
    speciesKey: 5371529,
  },
  // GBIF ignores a kingdom it cannot read and answers the tie unchanged.
  'Oenanthe|Animalz': {
    note: 'Multiple equal matches for Oenanthe',
    matchType: 'NONE',
    synonym: false,
  },
};

/** #89 — live /v2/species/match answers under the Catalogue of Life, trimmed to the fields read. */
const COL_MATCHES: Record<string, unknown> = {
  'Parus caeruleus|': {
    usage: {
      key: 'VJFGD',
      name: 'Parus caeruleus Linnaeus, 1758',
      canonicalName: 'Parus caeruleus',
      rank: 'SPECIES',
      status: 'SYNONYM',
    },
    acceptedUsage: {
      key: '32NH2',
      name: 'Cyanistes caeruleus (Linnaeus, 1758)',
      canonicalName: 'Cyanistes caeruleus',
      rank: 'SPECIES',
    },
    classification: [
      { key: 'N', name: 'Animalia', rank: 'KINGDOM' },
      { key: '32NH2', name: 'Cyanistes caeruleus', rank: 'SPECIES' },
    ],
    diagnostics: { matchType: 'EXACT', confidence: 98 },
    synonym: true,
  },
  'Oenanthe|': {
    diagnostics: { matchType: 'NONE', issues: [], note: 'Multiple equal matches for Oenanthe' },
    synonym: false,
  },
  'Oenanthe|Animalia': {
    usage: {
      key: '679P',
      name: 'Oenanthe Vieillot, 1816',
      canonicalName: 'Oenanthe',
      rank: 'GENUS',
      status: 'ACCEPTED',
    },
    classification: [{ key: '679P', name: 'Oenanthe', rank: 'GENUS' }],
    diagnostics: { matchType: 'EXACT', confidence: 96 },
    synonym: false,
  },
  // The genus it falls back to is a synonym of Bubo.
  'Nyctea xyzzyqq|': {
    usage: {
      key: '65YK',
      name: 'Nyctea Stephens, 1826',
      canonicalName: 'Nyctea',
      rank: 'GENUS',
      status: 'SYNONYM',
    },
    acceptedUsage: {
      key: '3DQQ',
      name: 'Bubo Duméril, 1805',
      canonicalName: 'Bubo',
      rank: 'GENUS',
    },
    classification: [{ key: '3DQQ', name: 'Bubo', rank: 'GENUS' }],
    diagnostics: { matchType: 'HIGHERRANK', confidence: 94 },
    synonym: true,
  },
};

const BACKBONE = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';
const COL_XR = '7ddf754f-d193-4cc9-b351-99906754a03b';

const textOf = (content: unknown) => JSON.stringify(content);

describe('gbifBulkMatchSpecies', () => {
  const mockMatchSpecies = vi.fn();
  const mockMatchChecklistSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      matchSpecies: mockMatchSpecies,
      matchChecklistSpecies: mockMatchChecklistSpecies,
    } as never);
    mockMatchSpecies.mockImplementation(async (params: { name: string; kingdom?: string }) => {
      const hit =
        params.kingdom === undefined
          ? MATCHES[params.name]
          : KINGDOM_MATCHES[`${params.name}|${params.kingdom}`];
      if (hit) return hit;
      return { matchType: 'NONE', usageKey: null };
    });
    mockMatchChecklistSpecies.mockImplementation(
      async (params: { name: string; kingdom?: string }) =>
        COL_MATCHES[`${params.name}|${params.kingdom ?? ''}`] ?? {
          diagnostics: { matchType: 'NONE' },
        },
    );
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
   * Characterization — a batch made only of strings sends each name's /v1 request as it
   * always has and returns the same rows on both surfaces, byte for byte.
   */
  it('pins the requests and both surfaces of a strings-only batch', async () => {
    mockMatchSpecies.mockImplementation(async (params: { name: string }) => {
      if (params.name === 'boom') throw new Error('GBIF API unavailable');
      if (params.name === 'Felis leo')
        return {
          matchType: 'EXACT',
          usageKey: 7630906,
          acceptedUsageKey: 5219404,
          scientificName: 'Felis leo Linnaeus, 1758',
          canonicalName: 'Felis leo',
          rank: 'SPECIES',
          status: 'SYNONYM',
          confidence: 98,
        };
      return MATCHES[params.name] ?? { matchType: 'NONE', usageKey: null };
    });
    const names = ['Panthera leo', 'Turdus imaginarius', 'Zzxqq notaspecies', 'Felis leo', 'boom'];

    const result = await runToolContract(gbifBulkMatchSpecies, { names });

    expect(mockMatchSpecies.mock.calls.map(([params]) => params)).toEqual(
      names.map((name) => ({ name, strict: false })),
    );
    expect(JSON.stringify(result.structuredContent)).toBe(
      JSON.stringify({
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
            name: 'Turdus imaginarius',
            taxonKey: 2490714,
            scientificName: 'Turdus Linnaeus, 1758',
            canonicalName: 'Turdus',
            rank: 'GENUS',
            status: 'ACCEPTED',
            confidence: 92,
            matchType: 'HIGHERRANK',
            note: 'GBIF returned a higher-rank match for "Turdus imaginarius" (matchType HIGHERRANK): Turdus, rank GENUS. taxonKey 2490714 covers that whole taxon, so the occurrence tools given it count and return records across all of it. If a narrower taxon was meant, check the spelling; with strict: true GBIF matches each name itself or answers NONE, never a taxon above it.',
          },
          { name: 'Zzxqq notaspecies', matchType: 'NONE' },
          {
            name: 'Felis leo',
            taxonKey: 5219404,
            matchedTaxonKey: 7630906,
            scientificName: 'Felis leo Linnaeus, 1758',
            canonicalName: 'Felis leo',
            rank: 'SPECIES',
            status: 'SYNONYM',
            confidence: 98,
            matchType: 'EXACT',
          },
          { name: 'boom', matchType: 'ERROR', error: 'GBIF API unavailable' },
        ],
      }),
    );
    expect(result.content).toEqual([
      {
        type: 'text',
        text: [
          '## Panthera leo',
          '**Canonical name:** Panthera leo',
          '**Scientific name:** Panthera leo (Linnaeus, 1758)',
          '**Taxon key:** 5219404',
          '**Rank:** SPECIES',
          '**Status:** ACCEPTED',
          '**Match type:** EXACT',
          '**Confidence:** 99/100',
          '## Turdus imaginarius',
          '**Canonical name:** Turdus',
          '**Scientific name:** Turdus Linnaeus, 1758',
          '**Taxon key:** 2490714',
          '**Rank:** GENUS',
          '**Status:** ACCEPTED',
          '**Match type:** HIGHERRANK',
          '**Confidence:** 92/100',
          '**Note:** GBIF returned a higher-rank match for "Turdus imaginarius" &#40;matchType HIGHERRANK&#41;: Turdus, rank GENUS. taxonKey 2490714 covers that whole taxon, so the occurrence tools given it count and return records across all of it. If a narrower taxon was meant, check the spelling; with strict: true GBIF matches each name itself or answers NONE, never a taxon above it.',
          '## Zzxqq notaspecies',
          '**Match type:** NONE',
          '## Felis leo',
          '**Canonical name:** Felis leo',
          '**Scientific name:** Felis leo Linnaeus, 1758',
          '**Taxon key:** 5219404',
          '**Matched taxon key:** 7630906 — the name GBIF matched is a synonym; the taxon key above is the accepted taxon it resolves to.',
          '**Rank:** SPECIES',
          '**Status:** SYNONYM',
          '**Match type:** EXACT',
          '**Confidence:** 98/100',
          '## boom',
          '**Match type:** ERROR',
          '**Error:** GBIF API unavailable',
        ].join('\n'),
      },
    ]);
  });

  /**
   * A heading holds one line of caller text. The name `Quercus *robur*` plus a line break
   * and `## Injected heading` rendered as emphasis and a second heading in content[] —
   * a row structuredContent does not have — while the unprocessed list escaped the same
   * name.
   */
  it('renders a caller-supplied name in its row heading literally', () => {
    const name = 'Quercus *robur*\n## Injected heading';
    const blocks = gbifBulkMatchSpecies.format!({ results: [{ name, matchType: 'NONE' }] });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toBe(
      '## Quercus &#42;robur&#42;&#10;&#35;&#35; Injected heading\n**Match type:** NONE',
    );
    expect(text.split('\n').filter((line) => line.startsWith('#'))).toHaveLength(1);
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

  /**
   * #73 — GBIF's own explanation for a NONE was dropped. #81 — the retry is this entry's
   * own kingdom, not a gbif_match_species call per name.
   */
  it('carries the ambiguity note onto a NONE row with a pointer to the entry kingdom', async () => {
    const result = await runToolContract(gbifBulkMatchSpecies, { names: ['Oenanthe'] });

    expect(result.isError).not.toBe(true);
    const [entry] = (result.structuredContent as { results: Record<string, unknown>[] }).results;
    expect(entry).toMatchObject({ name: 'Oenanthe', matchType: 'NONE' });
    expect(entry).not.toHaveProperty('taxonKey');
    expect(entry.note).toBe(
      'GBIF reported "Multiple equal matches for Oenanthe". Resubmit this name as an entry with kingdom set (such as Animalia or Plantae) to choose between them.',
    );
    expect(entry.note).not.toContain('gbif_match_species');
    expect(textOf(result.content)).toContain('Multiple equal matches for Oenanthe');
    expect(textOf(result.content)).toContain('Resubmit this name as an entry with kingdom set');
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

  /**
   * A row records one name's own failure. The caller's cancellation is not one, and it
   * used to come back as a successful batch of ERROR rows.
   */
  it('fails the call on caller cancellation rather than returning ERROR rows', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped the batch');
    mockMatchSpecies.mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    });

    const ctx = createMockContext({ signal: controller.signal });
    const input = gbifBulkMatchSpecies.input.parse({ names: ['Panthera leo', 'Pantera leo'] });

    await expect(gbifBulkMatchSpecies.handler(input, ctx)).rejects.toBe(reason);
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

  /** #81 — a kingdom per entry, sent for that name only. */
  describe('entry kingdom', () => {
    it('resolves cross-kingdom homonyms entry by entry', async () => {
      const result = await runToolContract(gbifBulkMatchSpecies, {
        names: [
          'Oenanthe',
          { name: 'Oenanthe', kingdom: 'Animalia' },
          { name: 'Prunella', kingdom: 'Plantae' },
        ],
      });

      expect(mockMatchSpecies.mock.calls.map(([params]) => params)).toEqual([
        { name: 'Oenanthe', strict: false },
        { name: 'Oenanthe', strict: false, kingdom: 'Animalia' },
        { name: 'Prunella', strict: false, kingdom: 'Plantae' },
      ]);
      const [tie, bird, plant] = (
        result.structuredContent as { results: Record<string, unknown>[] }
      ).results;
      expect(tie).toMatchObject({ name: 'Oenanthe', matchType: 'NONE' });
      expect(tie.note).toContain('Resubmit this name as an entry with kingdom set');
      expect(bird).toMatchObject({ name: 'Oenanthe', taxonKey: 2492483, matchType: 'EXACT' });
      expect(plant).toMatchObject({ name: 'Prunella', taxonKey: 2926553, matchType: 'EXACT' });
      expect(textOf(result.content)).toContain('**Taxon key:** 2492483');
      expect(textOf(result.content)).toContain('**Taxon key:** 2926553');
    });

    /** A batch-wide kingdom would move the other names; an entry's moves only its own. */
    it('re-targets only the entry that carries the kingdom', async () => {
      const ctx = createMockContext({ errors: gbifBulkMatchSpecies.errors });
      const input = gbifBulkMatchSpecies.input.parse({
        names: ['Quercus robur', { name: 'Parus major', kingdom: 'Plantae' }, 'Parus major'],
      });

      const { results } = await gbifBulkMatchSpecies.handler(input, ctx);

      expect(results.map((r) => [r.name, r.taxonKey, r.matchType])).toEqual([
        ['Quercus robur', 2878688, 'EXACT'],
        ['Parus major', 5371529, 'FUZZY'],
        ['Parus major', 9705453, 'EXACT'],
      ]);
      expect(results[1]).toMatchObject({ canonicalName: 'Pyrus major', matchedTaxonKey: 9711704 });
    });

    it('drops the kingdom pointer from a tie on an entry that already carried one', async () => {
      const result = await runToolContract(gbifBulkMatchSpecies, {
        names: [{ name: 'Oenanthe', kingdom: 'Animalz' }],
      });

      const [entry] = (result.structuredContent as { results: Record<string, unknown>[] }).results;
      expect(entry.note).toBe('GBIF reported "Multiple equal matches for Oenanthe".');
    });

    it('sends an object entry without kingdom as the plain string would', async () => {
      const ctx = createMockContext({ errors: gbifBulkMatchSpecies.errors });
      const asObject = await gbifBulkMatchSpecies.handler(
        gbifBulkMatchSpecies.input.parse({ names: [{ name: 'Panthera leo' }] }),
        ctx,
      );
      const asString = await gbifBulkMatchSpecies.handler(
        gbifBulkMatchSpecies.input.parse({ names: ['Panthera leo'] }),
        ctx,
      );

      expect(mockMatchSpecies.mock.calls.map(([params]) => params)).toEqual([
        { name: 'Panthera leo', strict: false },
        { name: 'Panthera leo', strict: false },
      ]);
      expect(asObject).toEqual(asString);
    });

    it.each([0, 1, 50])(
      'fails the call on a blank kingdom at index %i, before any request',
      async (index) => {
        const names: (string | { name: string; kingdom: string })[] = Array.from(
          { length: 51 },
          (_, i) => `Species ${i}`,
        );
        names[index] = { name: 'Oenanthe', kingdom: ' \t ' };

        const result = await runToolContract(gbifBulkMatchSpecies, { names });

        expect(result.isError).toBe(true);
        const error = result.structuredContent?.error as {
          message: string;
          data: { reason: string };
        };
        expect(error.data.reason).toBe('invalid_filter');
        expect(error.message).toContain(
          `names[${index}].kingdom was supplied blank for "Oenanthe"`,
        );
        expect(textOf(result.content)).toContain('submit the name as a plain string');
        expect(mockMatchSpecies).not.toHaveBeenCalled();
      },
    );

    it('rejects an entry with an unrecognized key or an empty name at the schema', () => {
      for (const entry of [{ name: 'Oenanthe', kingdon: 'Animalia' }, { name: '' }, {}])
        expect(gbifBulkMatchSpecies.input.safeParse({ names: [entry] }).success).toBe(false);
    });

    it('renders an object entry name in its row heading literally', async () => {
      const result = await runToolContract(gbifBulkMatchSpecies, {
        names: [{ name: 'Quercus *robur*\n## Injected heading', kingdom: 'Plantae' }],
      });

      const text = (result.content[0] as { text: string }).text;
      expect(text.split('\n')[0]).toBe(
        '## Quercus &#42;robur&#42;&#10;&#35;&#35; Injected heading',
      );
      expect(text.split('\n').filter((line) => line.startsWith('#'))).toHaveLength(1);
    });

    it('renders unprocessed entries as submitted, kingdom included, literally', () => {
      const blocks = gbifBulkMatchSpecies.format!({
        results: [],
        unprocessedNames: [
          'Oenanthe',
          { name: 'Prunella', kingdom: 'Plantae' },
          { name: 'Aus *bus*', kingdom: '<b>' },
          { name: 'Panthera leo' },
        ],
      });
      const text = blocks[0].type === 'text' ? blocks[0].text : '';

      expect(text).toBe(
        [
          '## Unprocessed names',
          '- Oenanthe',
          '- Prunella (kingdom: Plantae)',
          '- Aus &#42;bus&#42; (kingdom: &#60;b&#62;)',
          '- Panthera leo',
        ].join('\n'),
      );
    });
  });

  /** #85 — each synonym row names its accepted taxon from the one request it already made. */
  it('names the accepted taxon on a synonym row on both surfaces', async () => {
    const result = await runToolContract(gbifBulkMatchSpecies, {
      names: ['Parus caeruleus', 'Chrysanthemum leucanthemum', 'Panthera leo'],
    });

    expect(mockMatchSpecies).toHaveBeenCalledTimes(3);
    const [synonym, subspecies, accepted] = (
      result.structuredContent as { results: Record<string, unknown>[] }
    ).results;
    expect(synonym).toMatchObject({
      taxonKey: 2487879,
      matchedTaxonKey: 8191482,
      acceptedName: 'Cyanistes caeruleus',
    });
    // The accepted subspecies sits in no rank field, and the species field is its parent.
    expect(subspecies).toMatchObject({ taxonKey: 7222149, matchedTaxonKey: 3134125 });
    expect(subspecies).not.toHaveProperty('acceptedName');
    expect(accepted).not.toHaveProperty('acceptedName');
    const text = textOf(result.content);
    expect(text).toContain('**Accepted name:** Cyanistes caeruleus');
    expect(text).not.toContain('Leucanthemum vulgare');
  });

  /** #89 — one checklistKey for the whole batch; each entry's kingdom still its own. */
  describe('checklistKey', () => {
    it('matches the batch against the Catalogue of Life with string keys', async () => {
      const result = await runToolContract(gbifBulkMatchSpecies, {
        names: ['Parus caeruleus', { name: 'Oenanthe', kingdom: 'Animalia' }, 'Oenanthe'],
        checklistKey: COL_XR,
      });

      expect(mockMatchSpecies).not.toHaveBeenCalled();
      expect(mockMatchChecklistSpecies.mock.calls.map(([params]) => params)).toEqual([
        { name: 'Parus caeruleus', strict: false, checklistKey: COL_XR },
        { name: 'Oenanthe', strict: false, kingdom: 'Animalia', checklistKey: COL_XR },
        { name: 'Oenanthe', strict: false, checklistKey: COL_XR },
      ]);
      const [synonym, bird, tie] = (
        result.structuredContent as { results: Record<string, unknown>[] }
      ).results;
      expect(synonym).toEqual({
        name: 'Parus caeruleus',
        checklistTaxonKey: '32NH2',
        checklistMatchedTaxonKey: 'VJFGD',
        acceptedName: 'Cyanistes caeruleus',
        scientificName: 'Parus caeruleus Linnaeus, 1758',
        canonicalName: 'Parus caeruleus',
        rank: 'SPECIES',
        status: 'SYNONYM',
        confidence: 98,
        matchType: 'EXACT',
      });
      expect(bird).toMatchObject({ checklistTaxonKey: '679P', matchType: 'EXACT' });
      expect(bird).not.toHaveProperty('taxonKey');
      expect(tie).toMatchObject({ matchType: 'NONE' });
      expect(tie.note).toContain('Multiple equal matches for Oenanthe');
      const text = textOf(result.content);
      expect(text).toContain('**Checklist taxon key:** 32NH2');
      expect(text).toContain('**Checklist matched taxon key:** VJFGD');
      expect(text).toContain('**Checklist taxon key:** 679P');
    });

    it('names a higher-rank synonym row with Catalogue of Life keys and no backbone pointer', async () => {
      const result = await runToolContract(gbifBulkMatchSpecies, {
        names: ['Nyctea xyzzyqq'],
        checklistKey: COL_XR,
      });

      const [entry] = (result.structuredContent as { results: Record<string, unknown>[] }).results;
      expect(entry).toMatchObject({ checklistTaxonKey: '3DQQ', acceptedName: 'Bubo' });
      expect(entry.note).toContain('checklistTaxonKey 3DQQ is its accepted taxon, Bubo');
      expect(entry.note).toContain(
        `occurrence tools given it as checklistTaxonKey, with checklistKey ${COL_XR}, count`,
      );
      expect(entry.note).not.toContain('gbif_get_species');
    });

    it('answers the backbone value exactly as an omitted checklistKey', async () => {
      const names = ['Panthera leo', 'Turdus imaginarius', 'Oenanthe'];
      const omitted = await runToolContract(gbifBulkMatchSpecies, { names });
      const backbone = await runToolContract(gbifBulkMatchSpecies, {
        names,
        checklistKey: BACKBONE,
      });

      expect(mockMatchChecklistSpecies).not.toHaveBeenCalled();
      expect(mockMatchSpecies).toHaveBeenCalledTimes(6);
      expect(backbone.structuredContent).toEqual(omitted.structuredContent);
      expect(backbone.content).toEqual(omitted.content);
    });

    /**
     * A deployment whose GBIF_BASE_URL yields no v2 route fails every name the same way,
     * so the call fails once instead of returning a row of identical errors per name.
     */
    it('fails the call on a configuration error rather than returning ERROR rows', async () => {
      const { configurationError } = await import('@cyanheads/mcp-ts-core/errors');
      mockMatchChecklistSpecies.mockRejectedValue(configurationError('no v2 route'));

      const ctx = createMockContext({ errors: gbifBulkMatchSpecies.errors });
      const input = gbifBulkMatchSpecies.input.parse({
        names: ['Parus caeruleus', 'Oenanthe'],
        checklistKey: COL_XR,
      });

      await expect(gbifBulkMatchSpecies.handler(input, ctx)).rejects.toMatchObject({
        message: 'no v2 route',
      });
    });
  });
});
