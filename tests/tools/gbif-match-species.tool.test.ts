/**
 * @fileoverview Tests for gbif_match_species tool.
 * @module tests/tools/gbif-match-species.tool.test
 */

import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifMatchSpecies } from '@/mcp-server/tools/definitions/gbif-match-species.tool.js';
import { higherRankNote } from '@/mcp-server/tools/utils.js';

/** What a Catalogue of Life key reaches on the occurrence tools (#90). */
const COL_REACH =
  ', so the occurrence tools given it as checklistTaxonKey, with checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b, count and return records across all of it.';

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
/** An accepted species, every classification rank present. */
const PARUS_MAJOR = {
  usageKey: 9705453,
  scientificName: 'Parus major Linnaeus, 1758',
  canonicalName: 'Parus major',
  rank: 'SPECIES',
  status: 'ACCEPTED',
  confidence: 99,
  matchType: 'EXACT',
  kingdom: 'Animalia',
  phylum: 'Chordata',
  order: 'Passeriformes',
  family: 'Paridae',
  genus: 'Parus',
  species: 'Parus major',
  kingdomKey: 1,
  phylumKey: 44,
  classKey: 212,
  orderKey: 729,
  familyKey: 9327,
  genusKey: 2487923,
  speciesKey: 9705453,
  class: 'Aves',
};
/** #85 — synonyms whose accepted taxon a classification field names, at three ranks. */
const PARUS_CAERULEUS = {
  usageKey: 8191482,
  acceptedUsageKey: 2487879,
  scientificName: 'Parus caeruleus Linnaeus, 1758',
  canonicalName: 'Parus caeruleus',
  rank: 'SPECIES',
  status: 'SYNONYM',
  confidence: 98,
  matchType: 'EXACT',
  kingdom: 'Animalia',
  phylum: 'Chordata',
  order: 'Passeriformes',
  family: 'Paridae',
  genus: 'Cyanistes',
  species: 'Cyanistes caeruleus',
  kingdomKey: 1,
  phylumKey: 44,
  classKey: 212,
  orderKey: 729,
  familyKey: 9327,
  genusKey: 2487875,
  speciesKey: 2487879,
  class: 'Aves',
};
const COMPOSITAE = {
  usageKey: 6070956,
  acceptedUsageKey: 3065,
  scientificName: 'Compositae',
  canonicalName: 'Compositae',
  rank: 'FAMILY',
  status: 'SYNONYM',
  confidence: 94,
  matchType: 'EXACT',
  kingdom: 'Plantae',
  phylum: 'Tracheophyta',
  order: 'Asterales',
  family: 'Asteraceae',
  kingdomKey: 6,
  phylumKey: 7707728,
  classKey: 220,
  orderKey: 414,
  familyKey: 3065,
  class: 'Magnoliopsida',
};
/** #85 — accepted taxa below species rank, which no classification field holds. */
const CHRYSANTHEMUM_LEUCANTHEMUM = {
  usageKey: 3134125,
  acceptedUsageKey: 7222149,
  scientificName: 'Chrysanthemum leucanthemum L.',
  canonicalName: 'Chrysanthemum leucanthemum',
  rank: 'SPECIES',
  status: 'SYNONYM',
  confidence: 98,
  matchType: 'EXACT',
  kingdom: 'Plantae',
  phylum: 'Tracheophyta',
  order: 'Asterales',
  family: 'Asteraceae',
  genus: 'Leucanthemum',
  species: 'Leucanthemum vulgare',
  kingdomKey: 6,
  phylumKey: 7707728,
  classKey: 220,
  orderKey: 414,
  familyKey: 3065,
  genusKey: 7684028,
  speciesKey: 8848598,
  class: 'Magnoliopsida',
};
const CANIS_FAMILIARIS = {
  usageKey: 5219200,
  acceptedUsageKey: 6164210,
  scientificName: 'Canis familiaris Linnaeus, 1758',
  canonicalName: 'Canis familiaris',
  rank: 'SPECIES',
  status: 'SYNONYM',
  confidence: 98,
  matchType: 'EXACT',
  kingdom: 'Animalia',
  phylum: 'Chordata',
  order: 'Carnivora',
  family: 'Canidae',
  genus: 'Canis',
  species: 'Canis lupus',
  kingdomKey: 1,
  phylumKey: 44,
  classKey: 359,
  orderKey: 732,
  familyKey: 9701,
  genusKey: 5219142,
  speciesKey: 5219173,
  class: 'Mammalia',
};

/** Live /v2/species/match responses under the Catalogue of Life, trimmed to the fields read. */
const EUKARYOTE_BIRD = [
  { key: 'CS5HF', name: 'Eukaryota', rank: 'DOMAIN' },
  { key: 'N', name: 'Animalia', rank: 'KINGDOM' },
  { key: 'CH2', name: 'Chordata', rank: 'PHYLUM' },
  { key: '8V4V3', name: 'Vertebrata', rank: 'SUBPHYLUM' },
  { key: '8V4V5', name: 'Gnathostomata', rank: 'INFRAPHYLUM' },
  { key: '8VVWB', name: 'Osteichthyes', rank: 'PARVPHYLUM' },
  { key: '9CK8W', name: 'Tetrapoda', rank: 'MEGACLASS' },
  { key: 'V2', name: 'Aves', rank: 'CLASS' },
];
/** Described in 2024: HIGHERRANK genus on the backbone, EXACT here. COL assigns it no class. */
const COL_TYRANNOSAURUS_MCRAEENSIS = {
  usage: {
    key: 'TPJ7G',
    name: 'Tyrannosaurus mcraeensis Dalman, Loewen, Pyron, Jasinski, Malinzak, Holchman-Spector, Currie & Longrich, 2024',
    canonicalName: 'Tyrannosaurus mcraeensis',
    rank: 'SPECIES',
    status: 'PROVISIONALLY_ACCEPTED',
  },
  classification: [
    ...EUKARYOTE_BIRD.slice(0, 7),
    { key: 'NFR9H', name: 'Dinosauria', rank: 'SUPERORDER' },
    { key: 'CW2V8', name: 'Saurischia', rank: 'ORDER' },
    { key: 'TPJ65', name: 'Tyrannosauridae', rank: 'FAMILY' },
    { key: 'TPJ6N', name: 'Tyrannosaurus', rank: 'GENUS' },
    { key: 'TPJ7G', name: 'Tyrannosaurus mcraeensis', rank: 'SPECIES' },
  ],
  diagnostics: { matchType: 'EXACT', confidence: 97 },
  synonym: false,
};
const COL_PARUS_CAERULEUS = {
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
    ...EUKARYOTE_BIRD,
    { key: '3RL', name: 'Passeriformes', rank: 'ORDER' },
    { key: '626B2', name: 'Paridae', rank: 'FAMILY' },
    { key: '3XN8', name: 'Cyanistes', rank: 'GENUS' },
    { key: '32NH2', name: 'Cyanistes caeruleus', rank: 'SPECIES' },
  ],
  diagnostics: { matchType: 'EXACT', confidence: 98 },
  synonym: true,
};
/** The accepted taxon is a subspecies: named here, where the backbone answer cannot. */
const COL_CHRYSANTHEMUM_LEUCANTHEMUM = {
  usage: {
    key: '5YJK2',
    name: 'Chrysanthemum leucanthemum L.',
    canonicalName: 'Chrysanthemum leucanthemum',
    rank: 'SPECIES',
    status: 'SYNONYM',
  },
  acceptedUsage: {
    key: '5JC8W',
    name: 'Leucanthemum vulgare subsp. vulgare Lam.',
    canonicalName: 'Leucanthemum vulgare vulgare',
    rank: 'SUBSPECIES',
  },
  classification: [
    { key: 'P', name: 'Plantae', rank: 'KINGDOM' },
    { key: '723WW', name: 'Leucanthemum vulgare', rank: 'SPECIES' },
    { key: '5JC8W', name: 'Leucanthemum vulgare vulgare', rank: 'SUBSPECIES' },
  ],
  diagnostics: { matchType: 'EXACT', confidence: 98 },
  synonym: true,
};
const COL_NYCTEA_XYZZYQQ = {
  usage: {
    key: '65YK',
    name: 'Nyctea Stephens, 1826',
    canonicalName: 'Nyctea',
    rank: 'GENUS',
    status: 'SYNONYM',
  },
  acceptedUsage: { key: '3DQQ', name: 'Bubo Duméril, 1805', canonicalName: 'Bubo', rank: 'GENUS' },
  classification: [
    ...EUKARYOTE_BIRD,
    { key: '466', name: 'Strigiformes', rank: 'ORDER' },
    { key: 'GQX', name: 'Strigidae', rank: 'FAMILY' },
    { key: 'KDK', name: 'Striginae', rank: 'SUBFAMILY' },
    { key: '3DQQ', name: 'Bubo', rank: 'GENUS' },
  ],
  diagnostics: { matchType: 'HIGHERRANK', confidence: 94 },
  synonym: true,
};
const COL_OENANTHE = {
  diagnostics: { matchType: 'NONE', issues: [], note: 'Multiple equal matches for Oenanthe' },
  synonym: false,
};
const COL_OENANTHE_ANIMALIA = {
  usage: {
    key: '679P',
    name: 'Oenanthe Vieillot, 1816',
    canonicalName: 'Oenanthe',
    rank: 'GENUS',
    status: 'ACCEPTED',
  },
  classification: [
    ...EUKARYOTE_BIRD,
    { key: '3RL', name: 'Passeriformes', rank: 'ORDER' },
    { key: 'CZN', name: 'Muscicapidae', rank: 'FAMILY' },
    { key: '679P', name: 'Oenanthe', rank: 'GENUS' },
  ],
  diagnostics: { matchType: 'EXACT', confidence: 96 },
  synonym: false,
};

const BACKBONE = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';
const COL_XR = '7ddf754f-d193-4cc9-b351-99906754a03b';

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
 * tabled here once: every combination of the two fields GBIF can omit, a synonym
 * fallback with and without its accepted taxon named, under each checklist's key.
 */
describe('higherRankNote', () => {
  const backbone = { field: 'taxonKey', value: 9999 } as const;
  const backboneSynonym = { field: 'taxonKey', value: 9999, matched: 8888 } as const;
  const col = { field: 'checklistTaxonKey', value: '3DQQ' } as const;
  const colSynonym = { field: 'checklistTaxonKey', value: '3DQQ', matched: '65YK' } as const;
  it.each([
    {
      match: { key: backbone, rank: 'KINGDOM', canonicalName: 'Animalia' },
      has: [
        'HIGHERRANK',
        'Animalia, rank KINGDOM',
        'taxonKey 9999 covers that whole taxon, so the occurrence tools',
      ],
      lacks: ['gbif_get_species'],
    },
    {
      match: { key: backbone, rank: null, canonicalName: 'Aves' },
      has: ['HIGHERRANK', 'Aves', 'no rank', 'taxonKey 9999 covers that whole taxon'],
      lacks: ['rank null', 'gbif_get_species'],
    },
    {
      match: { key: backbone, rank: 'GENUS', canonicalName: null },
      has: ['HIGHERRANK', 'rank GENUS', 'no name', 'gbif_get_species with 9999'],
      lacks: [],
    },
    {
      match: { key: backbone },
      has: [
        'HIGHERRANK',
        'GBIF did not name',
        'taxonKey 9999 covers that whole taxon',
        'gbif_get_species with 9999',
      ],
      lacks: [', rank'],
    },
    /**
     * A synonym fallback: the key is the accepted taxon, not the synonym GBIF named
     * (live: Nyctea xyzzyqq comes back as the genus Nyctea, accepted genus Bubo).
     */
    {
      match: { key: backboneSynonym, rank: 'GENUS', canonicalName: 'Nyctea', acceptedName: 'Bubo' },
      has: [
        'Nyctea, rank GENUS, a synonym',
        'taxonKey 9999 is its accepted taxon, Bubo, and covers all of Bubo, so the occurrence tools',
      ],
      lacks: ['covers that whole taxon', 'gbif_get_species'],
    },
    /** The answer does not name the accepted taxon, which goes unnamed rather than guessed. */
    {
      match: { key: backboneSynonym, rank: 'SPECIES', canonicalName: 'Chrysanthemum leucanthemum' },
      has: [
        'Chrysanthemum leucanthemum, rank SPECIES, a synonym',
        'taxonKey 9999 is its accepted taxon and covers all of that taxon',
        'gbif_get_species with 9999',
      ],
      lacks: ['covers that whole taxon'],
    },
    /**
     * A Catalogue of Life key names its own field and gets no backbone pointer:
     * gbif_get_species does not take it, and the occurrence tools take it only as
     * checklistTaxonKey beside the Catalogue of Life checklistKey.
     */
    {
      match: { key: col, rank: 'KINGDOM', canonicalName: 'Animalia' },
      has: ['Animalia, rank KINGDOM', `checklistTaxonKey 3DQQ covers that whole taxon${COL_REACH}`],
      lacks: ['gbif_get_species'],
    },
    {
      match: { key: col, rank: 'GENUS', canonicalName: null },
      has: ['rank GENUS', 'no name', `checklistTaxonKey 3DQQ covers that whole taxon${COL_REACH}`],
      lacks: ['gbif_get_species'],
    },
    {
      match: { key: colSynonym, rank: 'GENUS', canonicalName: 'Nyctea', acceptedName: 'Bubo' },
      has: [
        'Nyctea, rank GENUS, a synonym',
        `checklistTaxonKey 3DQQ is its accepted taxon, Bubo, and covers all of Bubo${COL_REACH}`,
      ],
      lacks: ['gbif_get_species', 'covers that whole taxon'],
    },
    {
      match: { key: colSynonym, rank: 'GENUS', canonicalName: 'Nyctea' },
      has: [
        `checklistTaxonKey 3DQQ is its accepted taxon and covers all of that taxon${COL_REACH}`,
      ],
      lacks: ['gbif_get_species'],
    },
  ])(
    'discloses the fallback for $match without inventing an omitted field',
    ({ match, has, lacks }) => {
      const note = higherRankNote('birds', match);
      for (const text of has) expect(note).toContain(text);
      for (const text of [...lacks, 'undefined', 'null']) expect(note).not.toContain(text);
      expect(note).toContain('"birds"');
    },
  );
});

describe('gbifMatchSpecies', () => {
  const mockMatchSpecies = vi.fn();
  const mockMatchChecklistSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      matchSpecies: mockMatchSpecies,
      matchChecklistSpecies: mockMatchChecklistSpecies,
    } as never);
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
   * Characterization — an accepted match made without checklistKey sends the /v1 request
   * it always has and returns the same output on both surfaces, byte for byte.
   */
  it('pins the request and both surfaces of an accepted backbone match', async () => {
    mockMatchSpecies.mockResolvedValue(PARUS_MAJOR);

    const result = await runToolContract(gbifMatchSpecies, { name: 'Parus major' });

    expect(mockMatchSpecies).toHaveBeenCalledTimes(1);
    expect(mockMatchSpecies.mock.calls[0]?.[0]).toEqual({ name: 'Parus major', strict: false });
    expect(JSON.stringify(result.structuredContent)).toBe(
      '{"taxonKey":9705453,"scientificName":"Parus major Linnaeus, 1758","canonicalName":"Parus major","rank":"SPECIES","status":"ACCEPTED","confidence":99,"matchType":"EXACT","kingdom":"Animalia","phylum":"Chordata","class":"Aves","order":"Passeriformes","family":"Paridae","genus":"Parus","species":"Parus major","kingdomKey":1,"phylumKey":44,"classKey":212,"orderKey":729,"familyKey":9327,"genusKey":2487923,"speciesKey":9705453}',
    );
    expect(result.content).toEqual([
      {
        type: 'text',
        text: [
          '## Parus major',
          '**Scientific name:** Parus major Linnaeus, 1758',
          '**Taxon key:** 9705453',
          '**Rank:** SPECIES',
          '**Status:** ACCEPTED',
          '**Match type:** EXACT',
          '**Confidence:** 99/100',
          '**Classification:** Kingdom: Animalia (1) › Phylum: Chordata (44) › Class: Aves (212) › Order: Passeriformes (729) › Family: Paridae (9327) › Genus: Parus (2487923) › Species: Parus major (9705453)',
        ].join('\n'),
      },
    ]);
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
    // #85 — speciesKey equals the accepted key, so species names the accepted taxon.
    expect(result.acceptedName).toBe('Panthera leo');

    const notice = getEnrichment(ctx).notice;
    expect(notice).toContain('5219404');
    expect(notice).toContain('7630906');
    // An EXACT synonym is not a higher-rank fallback.
    expect(notice).not.toContain('HIGHERRANK');
    // The accepted taxon is named here, so no follow-up lookup is offered for its name.
    expect(notice).not.toContain('gbif_get_species');
    expect(notice).toBe(
      "The matched name Felis leo is a synonym (key 7630906, status SYNONYM). taxonKey 5219404 is the accepted taxon it resolves to, Panthera leo — pass that to the occurrence tools; the synonym's key covers only records filed under that name.",
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
    // #85 — genusKey equals the accepted key, so genus names the accepted taxon.
    expect(result.structuredContent).toMatchObject({
      taxonKey: 5959091,
      matchedTaxonKey: 2497867,
      acceptedName: 'Bubo',
    });
    expect(textOf(result.content)).toContain('**Accepted name:** Bubo');
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

  /**
   * #85 — the answer carried the accepted taxon's name in the classification field whose
   * key is the accepted key, while the notice sent the caller to gbif_get_species for it.
   */
  it('names the accepted taxon of a synonym on both surfaces from one request', async () => {
    mockMatchSpecies.mockResolvedValue(PARUS_CAERULEUS);

    const result = await runToolContract(gbifMatchSpecies, { name: 'Parus caeruleus' });

    expect(mockMatchSpecies).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      taxonKey: 2487879,
      matchedTaxonKey: 8191482,
      acceptedName: 'Cyanistes caeruleus',
    });
    expect(textOf(result.content)).toContain('**Accepted name:** Cyanistes caeruleus');
    const notice = result.structuredContent?.notice as string;
    expect(notice).toContain(
      'taxonKey 2487879 is the accepted taxon it resolves to, Cyanistes caeruleus — pass that to the occurrence tools',
    );
    expect(notice).not.toContain('gbif_get_species');
    expect(textOf(result.content)).not.toContain('gbif_get_species');
  });

  it('names a family-rank accepted taxon', async () => {
    mockMatchSpecies.mockResolvedValue(COMPOSITAE);

    const result = await runToolContract(gbifMatchSpecies, { name: 'Compositae' });

    expect(result.structuredContent).toMatchObject({ taxonKey: 3065, acceptedName: 'Asteraceae' });
  });

  /**
   * #85 — an accepted subspecies sits in no classification field, and the species field
   * names its parent species, so the name is left to gbif_get_species.
   */
  it.each([
    { name: 'Chrysanthemum leucanthemum', raw: CHRYSANTHEMUM_LEUCANTHEMUM, key: 7222149 },
    { name: 'Canis familiaris', raw: CANIS_FAMILIARIS, key: 6164210 },
  ])(
    'leaves the accepted subspecies of $name unnamed with the lookup pointer',
    async ({ name, raw, key }) => {
      mockMatchSpecies.mockResolvedValue(raw);

      const result = await runToolContract(gbifMatchSpecies, { name });

      // The pointer replaces a lookup: an unnamed accepted taxon costs no second request.
      expect(mockMatchSpecies).toHaveBeenCalledTimes(1);
      expect(result.structuredContent?.taxonKey).toBe(key);
      expect(result.structuredContent).not.toHaveProperty('acceptedName');
      expect(textOf(result.content)).not.toContain('Accepted name');
      expect(result.structuredContent?.notice).toContain(
        `Call gbif_get_species with ${key} for the accepted name.`,
      );
    },
  );

  it('renders an accepted name literally in content[]', () => {
    const blocks = gbifMatchSpecies.format!({ taxonKey: 1, acceptedName: 'Aus *bus* <i>' });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('**Accepted name:** Aus &#42;bus&#42; &#60;i&#62;');
  });

  /** #89 — the Catalogue of Life through /v2/species/match, opted into by checklistKey. */
  describe('checklistKey', () => {
    it('answers the backbone value exactly as an omitted checklistKey, through /v1', async () => {
      mockMatchSpecies.mockResolvedValue(PARUS_MAJOR);

      const omitted = await runToolContract(gbifMatchSpecies, { name: 'Parus major' });
      const backbone = await runToolContract(gbifMatchSpecies, {
        name: 'Parus major',
        checklistKey: BACKBONE,
      });

      expect(mockMatchSpecies.mock.calls.map(([params]) => params)).toEqual([
        { name: 'Parus major', strict: false },
        { name: 'Parus major', strict: false },
      ]);
      expect(mockMatchChecklistSpecies).not.toHaveBeenCalled();
      expect(backbone.structuredContent).toEqual(omitted.structuredContent);
      expect(backbone.content).toEqual(omitted.content);
    });

    it('matches a name described after the backbone was frozen, with string keys only', async () => {
      mockMatchChecklistSpecies.mockResolvedValue(COL_TYRANNOSAURUS_MCRAEENSIS);

      const result = await runToolContract(gbifMatchSpecies, {
        name: 'Tyrannosaurus mcraeensis',
        checklistKey: COL_XR,
      });

      expect(mockMatchSpecies).not.toHaveBeenCalled();
      expect(mockMatchChecklistSpecies.mock.calls.map(([params]) => params)).toEqual([
        { name: 'Tyrannosaurus mcraeensis', strict: false, checklistKey: COL_XR },
      ]);
      // No taxonKey, no rank keys, and no class: COL assigns this species none.
      expect(result.structuredContent).toEqual({
        checklistTaxonKey: 'TPJ7G',
        scientificName:
          'Tyrannosaurus mcraeensis Dalman, Loewen, Pyron, Jasinski, Malinzak, Holchman-Spector, Currie & Longrich, 2024',
        canonicalName: 'Tyrannosaurus mcraeensis',
        rank: 'SPECIES',
        status: 'PROVISIONALLY_ACCEPTED',
        confidence: 97,
        matchType: 'EXACT',
        kingdom: 'Animalia',
        phylum: 'Chordata',
        order: 'Saurischia',
        family: 'Tyrannosauridae',
        genus: 'Tyrannosaurus',
        species: 'Tyrannosaurus mcraeensis',
      });
      const text = textOf(result.content);
      expect(text).toContain(
        '**Checklist taxon key:** TPJ7G — a Catalogue of Life key, not a backbone taxonKey.',
      );
      expect(text).toContain(
        '**Classification:** Kingdom: Animalia › Phylum: Chordata › Order: Saurischia › Family: Tyrannosauridae › Genus: Tyrannosaurus › Species: Tyrannosaurus mcraeensis',
      );
      expect(text).not.toContain('**Taxon key:**');
    });

    /** #89 non-goal: COL genus 8288 is Tringa, Backbone 8288 Lagenismataceae — never a number. */
    it('keeps a digit-only Catalogue of Life key out of every numeric field', async () => {
      mockMatchChecklistSpecies.mockResolvedValue({
        usage: {
          key: '8288',
          name: 'Tringa Linnaeus, 1758',
          canonicalName: 'Tringa',
          rank: 'GENUS',
          status: 'ACCEPTED',
        },
        classification: [...EUKARYOTE_BIRD, { key: '8288', name: 'Tringa', rank: 'GENUS' }],
        diagnostics: { matchType: 'EXACT', confidence: 98 },
        synonym: false,
      });

      const result = await runToolContract(gbifMatchSpecies, {
        name: 'Tringa',
        checklistKey: COL_XR,
      });

      expect(result.structuredContent).toMatchObject({
        checklistTaxonKey: '8288',
        genus: 'Tringa',
      });
      for (const field of ['taxonKey', 'matchedTaxonKey', 'genusKey'])
        expect(result.structuredContent).not.toHaveProperty(field);
      expect(textOf(result.content)).not.toContain('**Taxon key:**');
      expect(textOf(result.content)).not.toContain('Genus: Tringa (8288)');
    });

    it('resolves a synonym to its accepted key and names it from acceptedUsage', async () => {
      mockMatchChecklistSpecies.mockResolvedValue(COL_PARUS_CAERULEUS);

      const result = await runToolContract(gbifMatchSpecies, {
        name: 'Parus caeruleus',
        checklistKey: COL_XR,
      });

      expect(result.structuredContent).toMatchObject({
        checklistTaxonKey: '32NH2',
        checklistMatchedTaxonKey: 'VJFGD',
        acceptedName: 'Cyanistes caeruleus',
        scientificName: 'Parus caeruleus Linnaeus, 1758',
        status: 'SYNONYM',
        class: 'Aves',
        species: 'Cyanistes caeruleus',
      });
      for (const field of ['taxonKey', 'matchedTaxonKey', 'kingdomKey', 'speciesKey'])
        expect(result.structuredContent).not.toHaveProperty(field);
      expect(result.structuredContent?.notice).toBe(
        'The matched name Parus caeruleus is a synonym (Catalogue of Life key VJFGD, status SYNONYM). checklistTaxonKey 32NH2 is the accepted taxon it resolves to, Cyanistes caeruleus — pass that to the occurrence tools as checklistTaxonKey, with checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b.',
      );
      const text = textOf(result.content);
      expect(text).toContain(
        '**Checklist matched taxon key:** VJFGD — the name GBIF matched is a synonym; the checklist taxon key above is the accepted taxon it resolves to.',
      );
      expect(text).toContain('**Accepted name:** Cyanistes caeruleus');
      expect(text).toContain('checklistTaxonKey 32NH2 is the accepted taxon it resolves to');
    });

    it('names an accepted subspecies, which the backbone answer cannot', async () => {
      mockMatchChecklistSpecies.mockResolvedValue(COL_CHRYSANTHEMUM_LEUCANTHEMUM);

      const result = await runToolContract(gbifMatchSpecies, {
        name: 'Chrysanthemum leucanthemum',
        checklistKey: COL_XR,
      });

      expect(result.structuredContent).toMatchObject({
        checklistTaxonKey: '5JC8W',
        checklistMatchedTaxonKey: '5YJK2',
        acceptedName: 'Leucanthemum vulgare vulgare',
      });
      expect(result.structuredContent?.notice).not.toContain('gbif_get_species');
    });

    it('composes both notices for a higher-rank synonym without backbone pointers', async () => {
      mockMatchChecklistSpecies.mockResolvedValue(COL_NYCTEA_XYZZYQQ);

      const result = await runToolContract(gbifMatchSpecies, {
        name: 'Nyctea xyzzyqq',
        checklistKey: COL_XR,
      });

      expect(result.structuredContent).toMatchObject({
        checklistTaxonKey: '3DQQ',
        checklistMatchedTaxonKey: '65YK',
        acceptedName: 'Bubo',
        matchType: 'HIGHERRANK',
      });
      const notice = result.structuredContent?.notice as string;
      expect(notice).toContain(
        `Nyctea, rank GENUS, a synonym. checklistTaxonKey 3DQQ is its accepted taxon, Bubo, and covers all of Bubo${COL_REACH}`,
      );
      expect(notice).toContain(
        "The synonym's own key 65YK (status SYNONYM) is returned as checklistMatchedTaxonKey.",
      );
      expect(notice).toContain('strict: true');
      for (const text of ['gbif_get_species', 'pass taxonKey']) {
        expect(notice).not.toContain(text);
        expect(textOf(result.content)).not.toContain(text);
      }
    });

    it('fails a tie as no_match carrying the note and the kingdom retry', async () => {
      mockMatchChecklistSpecies.mockResolvedValue(COL_OENANTHE);

      const result = await runToolContract(gbifMatchSpecies, {
        name: 'Oenanthe',
        checklistKey: COL_XR,
      });

      expect(result.isError).toBe(true);
      const error = result.structuredContent?.error as {
        message: string;
        data: { reason: string };
      };
      expect(error.data.reason).toBe('no_match');
      expect(error.message).toBe(
        'No Catalogue of Life match for "Oenanthe" — GBIF reported "Multiple equal matches for Oenanthe". Retry with kingdom set (such as Animalia or Plantae) to choose between them.',
      );
      expect(textOf(result.content)).toContain('No Catalogue of Life match');
    });

    it('forwards kingdom and rank to the Catalogue of Life match', async () => {
      mockMatchChecklistSpecies.mockResolvedValue(COL_OENANTHE_ANIMALIA);

      const result = await runToolContract(gbifMatchSpecies, {
        name: 'Oenanthe',
        kingdom: 'Animalia',
        rank: 'GENUS',
        checklistKey: COL_XR,
      });

      expect(mockMatchChecklistSpecies.mock.calls.map(([params]) => params)).toEqual([
        {
          name: 'Oenanthe',
          strict: false,
          kingdom: 'Animalia',
          rank: 'GENUS',
          checklistKey: COL_XR,
        },
      ]);
      expect(result.structuredContent).toMatchObject({
        checklistTaxonKey: '679P',
        family: 'Muscicapidae',
      });
    });

    it('rejects a blank kingdom before any request', async () => {
      const result = await runToolContract(gbifMatchSpecies, {
        name: 'Oenanthe',
        kingdom: '  ',
        checklistKey: COL_XR,
      });

      expect(result.structuredContent?.error).toMatchObject({ data: { reason: 'invalid_filter' } });
      expect(mockMatchChecklistSpecies).not.toHaveBeenCalled();
      expect(mockMatchSpecies).not.toHaveBeenCalled();
    });

    it.each(['9ca92552-f23a-41a8-a140-01abaa31c931', '', COL_XR.toUpperCase()])(
      'rejects checklistKey %j, which GBIF does not match against',
      (checklistKey) => {
        expect(
          gbifMatchSpecies.input.safeParse({ name: 'Lynx pardinus', checklistKey }).success,
        ).toBe(false);
      },
    );
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
