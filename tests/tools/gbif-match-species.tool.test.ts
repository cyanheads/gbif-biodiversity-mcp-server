/**
 * @fileoverview Tests for gbif_match_species tool.
 * @module tests/tools/gbif-match-species.tool.test
 */

import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifMatchSpecies } from '@/mcp-server/tools/definitions/gbif-match-species.tool.js';
import { higherRankNote } from '@/mcp-server/tools/utils.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** Live /species/match responses, verbatim. */
const PANTHERA_XYZZYQQ = {
  usageKey: 1,
  scientificName: 'Animalia',
  canonicalName: 'Animalia',
  rank: 'KINGDOM',
  status: 'ACCEPTED',
  confidence: 92,
  matchType: 'HIGHERRANK',
  kingdom: 'Animalia',
  kingdomKey: 1,
};
/** A bare genus name also comes back HIGHERRANK — at its own genus. */
const BOMBUS = {
  usageKey: 1340278,
  scientificName: 'Bombus Latreille, 1802',
  canonicalName: 'Bombus',
  rank: 'GENUS',
  status: 'ACCEPTED',
  confidence: 92,
  matchType: 'HIGHERRANK',
  kingdom: 'Animalia',
  genus: 'Bombus',
  kingdomKey: 1,
  genusKey: 1340278,
};
/** The higher taxon GBIF falls back to is itself a synonym (Nyctea → Bubo). */
const NYCTEA_XYZZYQQ = {
  usageKey: 2497867,
  acceptedUsageKey: 5959091,
  scientificName: 'Nyctea Stephens, 1826',
  canonicalName: 'Nyctea',
  rank: 'GENUS',
  status: 'SYNONYM',
  confidence: 94,
  matchType: 'HIGHERRANK',
  kingdom: 'Animalia',
  genus: 'Bubo',
  kingdomKey: 1,
  genusKey: 5959091,
};
/** A name shared by a bird genus and a plant genus. */
const OENANTHE = {
  confidence: 100,
  note: 'Multiple equal matches for Oenanthe',
  matchType: 'NONE',
  synonym: false,
};
/** Key 0 is a real backbone taxon: the kingdom incertae sedis. */
const INCERTAE_SEDIS = {
  usageKey: 0,
  scientificName: 'incertae sedis',
  canonicalName: 'incertae sedis',
  rank: 'KINGDOM',
  status: 'DOUBTFUL',
  confidence: 96,
  matchType: 'EXACT',
  kingdom: 'incertae sedis',
  kingdomKey: 0,
};

const textOf = (content: unknown) => JSON.stringify(content);

/**
 * #73 — the HIGHERRANK disclosure is one builder shared with gbif_bulk_match_species,
 * tabled here once: every combination of the two fields GBIF can omit.
 */
describe('higherRankNote', () => {
  it.each([
    {
      match: { rank: 'KINGDOM', canonicalName: 'Animalia' },
      has: ['HIGHERRANK', 'Animalia, rank KINGDOM', 'taxonKey 9999 covers that whole taxon'],
      lacks: ['gbif_get_species'],
    },
    {
      match: { rank: null, canonicalName: 'Aves' },
      has: ['HIGHERRANK', 'Aves', 'no rank', 'taxonKey 9999 covers that whole taxon'],
      lacks: ['rank null', 'gbif_get_species'],
    },
    {
      match: { rank: 'GENUS', canonicalName: null },
      has: ['HIGHERRANK', 'rank GENUS', 'no name', 'gbif_get_species with 9999'],
      lacks: [],
    },
    {
      match: {},
      has: [
        'HIGHERRANK',
        'GBIF did not name',
        'taxonKey 9999 covers that whole taxon',
        'gbif_get_species with 9999',
      ],
      lacks: [', rank'],
    },
    /**
     * A synonym fallback: taxonKey is the accepted taxon, not the synonym GBIF named. The
     * classification field whose key equals taxonKey names it (live: Nyctea xyzzyqq comes
     * back as the genus Nyctea with genus "Bubo" under genusKey = acceptedUsageKey 5959091).
     */
    {
      match: {
        usageKey: 8888,
        rank: 'GENUS',
        canonicalName: 'Nyctea',
        genus: 'Bubo',
        genusKey: 9999,
      },
      has: [
        'Nyctea, rank GENUS, a synonym',
        'taxonKey 9999 is its accepted taxon, Bubo, and covers all of Bubo',
      ],
      lacks: ['covers that whole taxon', 'gbif_get_species'],
    },
    /**
     * No classification key equals taxonKey (live: Chrysanthemum leucanthemum carries
     * speciesKey 8848598 "Leucanthemum vulgare" beside acceptedUsageKey 7222149), so the
     * accepted taxon goes unnamed rather than borrowing another taxon's name.
     */
    {
      match: {
        usageKey: 8888,
        rank: 'SPECIES',
        canonicalName: 'Chrysanthemum leucanthemum',
        species: 'Leucanthemum vulgare',
        speciesKey: 7777,
      },
      has: [
        'Chrysanthemum leucanthemum, rank SPECIES, a synonym',
        'taxonKey 9999 is its accepted taxon and covers all of that taxon',
        'gbif_get_species with 9999',
      ],
      lacks: ['Leucanthemum vulgare', 'covers that whole taxon'],
    },
  ])(
    'discloses the fallback for $match without inventing an omitted field',
    ({ match, has, lacks }) => {
      const note = higherRankNote('birds', 9999, match);
      for (const text of has) expect(note).toContain(text);
      for (const text of [...lacks, 'undefined', 'null']) expect(note).not.toContain(text);
      expect(note).toContain('"birds"');
    },
  );
});

describe('gbifMatchSpecies', () => {
  const mockMatchSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ matchSpecies: mockMatchSpecies } as never);
  });

  it('returns matched taxon for a known species', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      rank: 'SPECIES',
      status: 'ACCEPTED',
      confidence: 99,
      matchType: 'EXACT',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Passeriformes',
      family: 'Paridae',
      genus: 'Parus',
      species: 'Parus major',
      kingdomKey: 1,
      phylumKey: 44,
      classKey: 212,
      orderKey: 729,
      familyKey: 9322,
      genusKey: 2492278,
      speciesKey: 5231190,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Parus major' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(5231190);
    expect(result.scientificName).toBe('Parus major Linnaeus, 1758');
    expect(result.canonicalName).toBe('Parus major');
    expect(result.rank).toBe('SPECIES');
    expect(result.matchType).toBe('EXACT');
    expect(result.confidence).toBe(99);
    expect(result.kingdom).toBe('Animalia');
    expect(result.kingdomKey).toBe(1);
  });

  /**
   * #35 — fixture is the live /species/match response for "Felis leo": the accepted
   * taxon arrives only as acceptedUsageKey, with no accompanying accepted-name string.
   * Counting on the synonym's own key (7630906) returns 106 records against the accepted
   * taxon's 18,961, so taxonKey has to be the accepted one.
   */
  it('returns the accepted key as taxonKey when the queried name is a synonym', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 7630906,
      acceptedUsageKey: 5219404,
      scientificName: 'Felis leo Linnaeus, 1758',
      canonicalName: 'Felis leo',
      rank: 'SPECIES',
      status: 'SYNONYM',
      confidence: 98,
      matchType: 'EXACT',
      species: 'Panthera leo',
      speciesKey: 5219404,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Felis leo' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(5219404);
    expect(result.matchedTaxonKey).toBe(7630906);
    expect(result.status).toBe('SYNONYM');

    const notice = getEnrichment(ctx).notice;
    expect(notice).toContain('5219404');
    expect(notice).toContain('7630906');
    expect(notice).toContain('gbif_get_species');
    // An EXACT synonym is not a higher-rank fallback, and its notice is unchanged.
    expect(notice).not.toContain('HIGHERRANK');
    expect(notice).toBe(
      "The matched name Felis leo is a synonym (key 7630906, status SYNONYM). taxonKey 5219404 is the accepted taxon it resolves to — pass that to the occurrence tools; the synonym's key covers only records filed under that name. Call gbif_get_species with 5219404 for the accepted name.",
    );
  });

  /**
   * speciesKey is not a substitute for acceptedUsageKey — for Chrysanthemum leucanthemum
   * GBIF returns speciesKey 8848598 and acceptedUsageKey 7222149, two different taxa.
   */
  it('resolves to acceptedUsageKey rather than speciesKey', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 3134125,
      acceptedUsageKey: 7222149,
      canonicalName: 'Chrysanthemum leucanthemum',
      status: 'SYNONYM',
      matchType: 'EXACT',
      species: 'Leucanthemum vulgare',
      speciesKey: 8848598,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Chrysanthemum leucanthemum' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(7222149);
    expect(result.speciesKey).toBe(8848598);
  });

  it('leaves taxonKey alone and emits no notice on an accepted match', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 5219404,
      canonicalName: 'Panthera leo',
      status: 'ACCEPTED',
      matchType: 'EXACT',
      confidence: 99,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Panthera leo' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(5219404);
    expect(result.matchedTaxonKey).toBeUndefined();
    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('throws no_match when matchType is NONE', async () => {
    mockMatchSpecies.mockResolvedValue({ matchType: 'NONE', usageKey: undefined });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'xyznonexistentspecies' });

    const err = await gbifMatchSpecies.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toMatchObject({ data: { reason: 'no_match' } });
    // Without a GBIF note the message stays as it was.
    expect((err as Error).message).toBe('No backbone match for "xyznonexistentspecies"');
  });

  /**
   * #73 — GBIF answers a name shared across kingdoms with NONE and a note saying so;
   * kingdom is the lever on this same call that picks one.
   */
  it('carries the ambiguity note into no_match with a kingdom retry, on both surfaces', async () => {
    mockMatchSpecies.mockResolvedValue(OENANTHE);

    const result = await runToolContract(gbifMatchSpecies, { name: 'Oenanthe' });

    expect(result.isError).toBe(true);
    const error = result.structuredContent?.error as { message: string; data: { reason: string } };
    expect(error.data.reason).toBe('no_match');
    expect(error.message).toContain('Multiple equal matches for Oenanthe');
    expect(error.message).toContain('Retry with kingdom');
    expect(textOf(result.content)).toContain('Multiple equal matches for Oenanthe');
    expect(textOf(result.content)).toContain('Retry with kingdom');
  });

  it('carries the ambiguity note without the kingdom retry when kingdom was already set', async () => {
    mockMatchSpecies.mockResolvedValue(OENANTHE);

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Oenanthe', kingdom: 'Animalia' });
    const err = await gbifMatchSpecies.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'no_match' } });
    expect((err as Error).message).toContain('Multiple equal matches for Oenanthe');
    expect((err as Error).message).not.toContain('Retry with kingdom');
  });

  it('throws no_match when usageKey is missing', async () => {
    mockMatchSpecies.mockResolvedValue({ matchType: 'FUZZY', usageKey: undefined });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'incomplete result' });

    await expect(gbifMatchSpecies.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_match' },
    });
  });

  it('passes optional kingdom and rank filters', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 1234,
      matchType: 'EXACT',
      canonicalName: 'Rosa canina',
      scientificName: 'Rosa canina L.',
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({
      name: 'Rosa canina',
      kingdom: 'Plantae',
      rank: 'SPECIES',
    });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(1234);
    expect(mockMatchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ kingdom: 'Plantae', rank: 'SPECIES' }),
      ctx,
    );
  });

  /**
   * #54 — the forward tested `?.trim()`, so a blank kingdom was dropped and the name
   * matched against the whole backbone. Measured on the built server: `Parus major`
   * with `kingdom: ""` and with a whitespace-only value each resolve to usageKey
   * 9705453 at confidence 99, identical to omitting the field, where `Plantae`
   * resolves to 9711704. The undisambiguated match is the outcome the caller reached
   * for this field to avoid, and nothing in the response says so.
   */
  it.each(['', '   '])(
    'rejects kingdom "%s" instead of matching undisambiguated',
    async (blank) => {
      const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
      const input = gbifMatchSpecies.input.parse({ name: 'Parus major', kingdom: blank });
      expect(input.kingdom).toBe(blank);

      const err = await gbifMatchSpecies.handler(input, ctx).catch((e: unknown) => e);

      expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
      expect((err as Error).message).toContain('kingdom');
      expect(mockMatchSpecies).not.toHaveBeenCalled();
    },
  );

  /** Omitting the field is still how a caller matches against the whole backbone. */
  it('omits kingdom when not provided', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 9705453,
      matchType: 'EXACT',
      canonicalName: 'Parus major',
      confidence: 99,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    await gbifMatchSpecies.handler(gbifMatchSpecies.input.parse({ name: 'Parus major' }), ctx);

    expect(mockMatchSpecies).toHaveBeenCalledWith(
      expect.not.objectContaining({ kingdom: expect.anything() }),
      ctx,
    );
  });

  it('handles sparse upstream response', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 9999,
      matchType: 'HIGHERRANK',
      canonicalName: 'Aves',
      // no classification keys, no confidence
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'birds' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(9999);
    expect(result.confidence).toBeUndefined();
    expect(result.kingdomKey).toBeUndefined();
  });

  /** Characterization — #73 discloses a HIGHERRANK match and never rejects or re-keys it. */
  it('keeps a HIGHERRANK taxonKey unchanged', async () => {
    mockMatchSpecies.mockResolvedValue(PANTHERA_XYZZYQQ);

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Panthera xyzzyqq' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(1);
    expect(result.matchType).toBe('HIGHERRANK');
    expect(result.matchedTaxonKey).toBeUndefined();
  });

  /**
   * #73 — a misspelled species came back as the kingdom Animalia at confidence 92 with
   * nothing saying so; counting on that key spans every animal record.
   */
  it('discloses a HIGHERRANK fallback in a notice on both surfaces', async () => {
    mockMatchSpecies.mockResolvedValue(PANTHERA_XYZZYQQ);

    const result = await runToolContract(gbifMatchSpecies, { name: 'Panthera xyzzyqq' });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.taxonKey).toBe(1);
    const notice = result.structuredContent?.notice as string;
    for (const text of [
      'HIGHERRANK',
      'Animalia, rank KINGDOM',
      'taxonKey 1 covers that whole taxon',
      'strict: true',
    ])
      expect(notice).toContain(text);
    expect(textOf(result.content)).toContain('Animalia, rank KINGDOM');
    expect(textOf(result.content)).toContain('taxonKey 1 covers that whole taxon');
  });

  it('discloses rather than rejects a bare genus that comes back HIGHERRANK', async () => {
    mockMatchSpecies.mockResolvedValue(BOMBUS);

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Bombus' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(1340278);
    expect(getEnrichment(ctx).notice).toContain('Bombus, rank GENUS');
  });

  /**
   * The genus GBIF falls back to is a synonym, so taxonKey 5959091 is the accepted genus
   * Bubo — the notice must say what that key covers, not attribute it to Nyctea, and the
   * synonym disclosure that follows must not restate it.
   */
  it('composes the HIGHERRANK and synonym notices when the higher taxon is a synonym', async () => {
    mockMatchSpecies.mockResolvedValue(NYCTEA_XYZZYQQ);

    const result = await runToolContract(gbifMatchSpecies, { name: 'Nyctea xyzzyqq' });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ taxonKey: 5959091, matchedTaxonKey: 2497867 });
    const notice = result.structuredContent?.notice as string;
    // The higher-rank disclosure names the synonym and what taxonKey actually covers …
    expect(notice).toContain('HIGHERRANK');
    expect(notice).toContain('Nyctea, rank GENUS, a synonym');
    expect(notice).toContain(
      'taxonKey 5959091 is its accepted taxon, Bubo, and covers all of Bubo',
    );
    expect(notice).not.toContain('covers that whole taxon');
    // … and the synonym disclosure keeps the synonym's own key without repeating the rest.
    expect(notice).toContain(
      "The synonym's own key 2497867 (status SYNONYM) covers only records filed under Nyctea — pass taxonKey 5959091 to the occurrence tools.",
    );
    expect(notice).not.toContain('The matched name Nyctea is a synonym');
    const text = textOf(result.content);
    expect(text).toContain('taxonKey 5959091 is its accepted taxon, Bubo, and covers all of Bubo');
    expect(text).toContain("The synonym's own key 2497867");
    expect(text).toContain('the name GBIF matched is a synonym');
  });

  /** #80 — key 0 is the incertae sedis kingdom, which GBIF matches exactly. */
  it('returns taxonKey 0 for the incertae sedis kingdom on both surfaces', async () => {
    mockMatchSpecies.mockResolvedValue(INCERTAE_SEDIS);

    const result = await runToolContract(gbifMatchSpecies, { name: 'incertae sedis' });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      taxonKey: 0,
      matchType: 'EXACT',
      kingdomKey: 0,
    });
    expect(textOf(result.content)).toContain('**Taxon key:** 0');
    expect(textOf(result.content)).toContain('Kingdom: incertae sedis (0)');
  });

  it.each(['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'] as const)(
    'renders %sKey 0 beside its name (#80)',
    (rank) => {
      const blocks = gbifMatchSpecies.format!({ [rank]: 'Xname', [`${rank}Key`]: 0 } as never);
      const text = blocks[0].type === 'text' ? blocks[0].text : '';
      expect(text).toContain('Xname (0)');
    },
  );

  /** Characterization — an absent key still renders no parenthetical. */
  it('renders no parenthetical when the rank key is absent', () => {
    const blocks = gbifMatchSpecies.format!({ kingdom: 'Animalia' });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Kingdom: Animalia');
    expect(text).not.toContain('Animalia (');
  });

  it('formats output with key fields', () => {
    const output = {
      taxonKey: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      rank: 'SPECIES',
      status: 'ACCEPTED',
      confidence: 99,
      matchType: 'EXACT',
      kingdom: 'Animalia',
      kingdomKey: 1,
    };
    const blocks = gbifMatchSpecies.format!(output);
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('99');
    expect(text).toContain('EXACT');
    expect(text).toContain('Animalia');
  });

  it('renders both keys so content[]-only clients see the resolution', () => {
    const blocks = gbifMatchSpecies.format!({
      taxonKey: 5219404,
      matchedTaxonKey: 7630906,
      canonicalName: 'Felis leo',
      status: 'SYNONYM',
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toContain('5219404');
    expect(text).toContain('7630906');
    // The synonym is the name GBIF matched — the queried name, or the higher taxon a
    // HIGHERRANK match fell back to — so the line attributes it there.
    expect(text).toContain(
      '**Matched taxon key:** 7630906 — the name GBIF matched is a synonym; the taxon key above is the accepted taxon it resolves to.',
    );
    expect(text).not.toContain('the queried name is a synonym');
  });

  it('formats sparse output without invented facts', () => {
    const blocks = gbifMatchSpecies.format!({});
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    // No fabricated values for missing fields
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});
