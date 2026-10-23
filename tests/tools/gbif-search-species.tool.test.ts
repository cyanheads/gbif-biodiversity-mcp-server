/**
 * @fileoverview Tests for gbif_search_species tool.
 * @module tests/tools/gbif-search-species.tool.test
 */

import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifSearchSpecies } from '@/mcp-server/tools/definitions/gbif-search-species.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/**
 * `/species/match` responses for the higher-taxon names the scope filters resolve.
 * Field-for-field as the live endpoint returns them, including the split between
 * `usageKey` and the rank key on a synonym.
 */
const MATCHES = {
  Paridae: {
    usageKey: 9327,
    scientificName: 'Paridae',
    rank: 'FAMILY',
    status: 'ACCEPTED',
    matchType: 'EXACT',
    kingdom: 'Animalia',
    family: 'Paridae',
    kingdomKey: 1,
    familyKey: 9327,
  },
  Fagaceae: {
    usageKey: 4689,
    scientificName: 'Fagaceae',
    rank: 'FAMILY',
    status: 'ACCEPTED',
    matchType: 'EXACT',
    kingdom: 'Plantae',
    family: 'Fagaceae',
    kingdomKey: 6,
    familyKey: 4689,
  },
  Asteraceae: {
    usageKey: 3065,
    scientificName: 'Asteraceae',
    rank: 'FAMILY',
    status: 'ACCEPTED',
    matchType: 'EXACT',
    kingdom: 'Plantae',
    family: 'Asteraceae',
    kingdomKey: 6,
    familyKey: 3065,
  },
  /** An alternative family name: usageKey is the synonym, familyKey the accepted taxon. */
  Compositae: {
    usageKey: 6070956,
    acceptedUsageKey: 3065,
    scientificName: 'Compositae',
    rank: 'FAMILY',
    status: 'SYNONYM',
    matchType: 'EXACT',
    kingdom: 'Plantae',
    family: 'Asteraceae',
    kingdomKey: 6,
    familyKey: 3065,
  },
  Quercus: {
    usageKey: 2877951,
    scientificName: 'Quercus L.',
    rank: 'GENUS',
    status: 'ACCEPTED',
    matchType: 'EXACT',
    kingdom: 'Plantae',
    family: 'Fagaceae',
    genus: 'Quercus',
    kingdomKey: 6,
    familyKey: 4689,
    genusKey: 2877951,
  },
  Animalia: {
    usageKey: 1,
    scientificName: 'Animalia',
    rank: 'KINGDOM',
    status: 'ACCEPTED',
    matchType: 'EXACT',
    kingdom: 'Animalia',
    kingdomKey: 1,
  },
  /** `rank` is a scoring hint upstream, so "Aves" asked for as a family answers as a CLASS. */
  AvesAsClass: {
    usageKey: 212,
    scientificName: 'Aves',
    rank: 'CLASS',
    status: 'ACCEPTED',
    matchType: 'EXACT',
    kingdom: 'Animalia',
    kingdomKey: 1,
  },
  /**
   * The same hint slipping the other way, and the harder case: "Parus major" asked
   * for as a GENUS answers as a SPECIES and still carries a `genusKey`, so reading
   * the rank key off it would scope to *Parus* — a taxon the caller never named.
   */
  ParusMajorAsSpecies: {
    usageKey: 9705453,
    scientificName: 'Parus major Linnaeus, 1758',
    rank: 'SPECIES',
    status: 'ACCEPTED',
    matchType: 'EXACT',
    kingdom: 'Animalia',
    family: 'Paridae',
    genus: 'Parus',
    kingdomKey: 1,
    familyKey: 9327,
    genusKey: 2487923,
  },
  none: { matchType: 'NONE', confidence: 100 },
} as const;

describe('gbifSearchSpecies', () => {
  const mockSearchSpecies = vi.fn();
  const mockMatchSpecies = vi.fn();

  /** Answer each `/species/match` call from MATCHES, keyed on the name asked for. */
  const matchesByName = (names: Record<string, keyof typeof MATCHES>) => {
    mockMatchSpecies.mockImplementation((params: { name: string }) => {
      const fixture = names[params.name];
      return Promise.resolve(fixture ? MATCHES[fixture] : MATCHES.none);
    });
  };

  const emptyPage = { results: [], count: 0, offset: 0, limit: 20, endOfRecords: true };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchSpecies: mockSearchSpecies,
      matchSpecies: mockMatchSpecies,
    } as never);
  });

  it('preserves a sparse usage key without inventing mapping or provenance on either surface', async () => {
    mockSearchSpecies.mockResolvedValue({ ...emptyPage, results: [{ key: 999 }], count: 1 });
    const result = await runToolContract(gbifSearchSpecies, {});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ taxa: [{ key: 999 }] });
    const taxon = gbifSearchSpecies.output.parse(result.structuredContent).taxa[0];
    expect(taxon.nubKey).toBeUndefined();
    expect(taxon.datasetKey).toBeUndefined();
    const text = JSON.stringify(result.content);
    expect(text).toContain('999');
    expect(text).not.toContain('Backbone key');
    expect(text).not.toContain('Dataset key');
  });

  it.each([
    { offset: 0, limit: 1000, count: 1001, endOfRecords: false, results: [{ key: 2878688 }] },
    { offset: 1000, limit: 1000, count: 1001, endOfRecords: true, results: [{ key: 2878688 }] },
    { offset: 2000, limit: 1000, count: 1001, endOfRecords: true, results: [] },
  ])('preserves pagination and identity through output parsing at offset $offset', async (page) => {
    mockSearchSpecies.mockResolvedValue(page);
    const result = await runToolContract(gbifSearchSpecies, {
      offset: page.offset,
      limit: page.limit,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      totalCount: 1001,
      offset: page.offset,
      limit: 1000,
      endOfRecords: page.endOfRecords,
      taxa: page.results,
    });
    expect(mockSearchSpecies.mock.calls[0][0]).toMatchObject({
      datasetKey: 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c',
      offset: page.offset,
      limit: 1000,
    });
    const text = JSON.stringify(result.content);
    expect(text).toContain('1001');
    if (page.offset === 2000) {
      expect(result.structuredContent?.notice).toContain('Offset 2000 exceeds totalCount');
      expect(text).toContain('Offset 2000 exceeds totalCount');
    } else expect(text).toContain('2878688');
  });

  it('retains invalid_filter recovery on both surfaces for a blank checklist', async () => {
    const result = await runToolContract(gbifSearchSpecies, { datasetKey: '' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { data: { reason: 'invalid_filter' } },
    });
    expect(JSON.stringify(result.content)).toContain('omit it to search the backbone');
    expect(mockSearchSpecies).not.toHaveBeenCalled();
  });

  it('returns taxa and enrichment with pagination metadata', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [
        {
          key: 5231190,
          scientificName: 'Parus major Linnaeus, 1758',
          canonicalName: 'Parus major',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          kingdom: 'Animalia',
          phylum: 'Chordata',
          class: 'Aves',
          order: 'Passeriformes',
          family: 'Paridae',
          genus: 'Parus',
          vernacularName: 'Great Tit',
          numOccurrences: 5000000,
          numDescendants: 12,
        },
      ],
      count: 1000,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ q: 'Parus major' });
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa).toHaveLength(1);
    const taxon = result.taxa[0];
    expect(taxon.key).toBe(5231190);
    expect(taxon.canonicalName).toBe('Parus major');
    expect(taxon.vernacularName).toBe('Great Tit');
    expect(taxon.class).toBe('Aves'); // read straight from GBIF's raw `class` field (#34)

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(1000);
    expect(enrichment.endOfRecords).toBe(false);
    expect(enrichment.offset).toBe(0);
    expect(enrichment.limit).toBe(20);
    expect(enrichment.notice).toBeUndefined();
  });

  it('populates the class name from GBIF raw.class (#34)', async () => {
    // GBIF's /species/search returns the class name under `class` (not `clazz`, which is always
    // null). A mammal result must carry class Mammalia into the taxon output.
    mockSearchSpecies.mockResolvedValue({
      results: [{ key: 5219404, class: 'Mammalia' }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({});
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa[0].class).toBe('Mammalia');
  });

  it('includes extinct when explicitly boolean', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [{ key: 200, extinct: true }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ isExtinct: true });
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa[0].extinct).toBe(true);
  });

  it('enriches with notice on empty results', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ q: 'nonexistent_name_xyz' });
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('No taxa matched');
  });

  it('enriches with notice on pagination overshoot', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [],
      count: 5,
      offset: 10,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ offset: 10 });
    await gbifSearchSpecies.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('Offset 10 exceeds totalCount');
  });

  it('passes the rank filter through unchanged', async () => {
    mockSearchSpecies.mockResolvedValue(emptyPage);

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ rank: 'FAMILY' });
    await gbifSearchSpecies.handler(input, ctx);

    expect(mockSearchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ rank: 'FAMILY' }),
      ctx,
    );
  });

  /**
   * #55 — `kingdom`, `family`, and `genus` were forwarded to `/species/search` under
   * their own names, and that endpoint implements none of the three: each answered
   * identically to a parameter name invented for the probe (46,623,754 names either
   * way, against `rank=FAMILY`'s 558,589), so a caller who narrowed a browse got the
   * whole index back with nothing saying the scope was dropped. `higherTaxonKey` is
   * the parameter the endpoint does implement, and it takes a key: `family: "Paridae"`
   * now resolves to backbone key 9327 and returns 641 names.
   */
  it('resolves a family name to its backbone key and scopes on higherTaxonKey (#55)', async () => {
    matchesByName({ Paridae: 'Paridae' });
    mockSearchSpecies.mockResolvedValue({ ...emptyPage, count: 641 });

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({ family: 'Paridae' });
    await gbifSearchSpecies.handler(input, ctx);

    expect(mockMatchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Paridae', rank: 'FAMILY', strict: true }),
      ctx,
    );
    const sent = mockSearchSpecies.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.higherTaxonKey).toBe(9327);
    expect(sent).not.toHaveProperty('family');
    expect(getEnrichment(ctx).taxonScope).toContain('9327');
  });

  it.each([
    ['kingdom', 'Animalia', 'Animalia', 'KINGDOM', 1],
    ['genus', 'Quercus', 'Quercus', 'GENUS', 2877951],
  ] as const)(
    'resolves %s "%s" to its backbone key rather than forwarding the name',
    async (field, name, fixture, rank, key) => {
      matchesByName({ [name]: fixture });
      mockSearchSpecies.mockResolvedValue(emptyPage);

      const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
      const input = gbifSearchSpecies.input.parse({ [field]: name });
      await gbifSearchSpecies.handler(input, ctx);

      expect(mockMatchSpecies).toHaveBeenCalledWith(
        expect.objectContaining({ name, rank, strict: true }),
        ctx,
      );
      const sent = mockSearchSpecies.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.higherTaxonKey).toBe(key);
      expect(sent).not.toHaveProperty(field);
    },
  );

  /**
   * The rank key, not `usageKey` — the two split on a synonym and only the rank key
   * scopes anything. `Compositae` matches usageKey 6070956 with familyKey 3065, and
   * live `higherTaxonKey=6070956` returns 0 names where `higherTaxonKey=3065` returns
   * 201,100.
   */
  it('scopes an alternative family name to the accepted family key', async () => {
    matchesByName({ Compositae: 'Compositae' });
    mockSearchSpecies.mockResolvedValue({ ...emptyPage, count: 201100 });

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({ family: 'Compositae' });
    await gbifSearchSpecies.handler(input, ctx);

    const sent = mockSearchSpecies.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.higherTaxonKey).toBe(3065);
    expect(sent.higherTaxonKey).not.toBe(6070956);
  });

  /**
   * The enrichment names the taxon the key denotes, which on a synonym is not the
   * name that matched: `Compositae` carries `scientificName` "Compositae" beside
   * `familyKey` 3065, Asteraceae. Reporting the matched name would echo the caller's
   * own input back on the one call whose resolution they most need to see — the
   * report would read as a scope on Compositae under a key that is not Compositae.
   */
  it('names the resolved taxon, not the synonym, in the reported scope', async () => {
    matchesByName({ Compositae: 'Compositae' });
    mockSearchSpecies.mockResolvedValue({ ...emptyPage, count: 201100 });

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    await gbifSearchSpecies.handler(gbifSearchSpecies.input.parse({ family: 'Compositae' }), ctx);

    const scope = getEnrichment(ctx).taxonScope as string;
    expect(scope).toContain('Asteraceae');
    expect(scope).toContain('3065');
    expect(scope).toMatch(/family "Compositae"/);
    // The taxon named after "backbone taxon" is the resolved one, never the input.
    expect(scope).not.toMatch(/backbone taxon Compositae/);
  });

  /**
   * `/species/search` OR-s repeated `higherTaxonKey` values rather than intersecting
   * them — keys 1 and 6 together return 6,534,100, their exact sum — so sending a
   * kingdom beside a genus would widen what the genus narrowed. The three nest, so
   * the narrowest one is the intersection.
   */
  it('sends only the narrowest of the three as the scope', async () => {
    matchesByName({ Fagaceae: 'Fagaceae', Quercus: 'Quercus' });
    mockSearchSpecies.mockResolvedValue({ ...emptyPage, count: 6059 });

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({
      kingdom: 'Plantae',
      family: 'Fagaceae',
      genus: 'Quercus',
    });
    await gbifSearchSpecies.handler(input, ctx);

    const sent = mockSearchSpecies.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.higherTaxonKey).toBe(2877951);
    expect(getEnrichment(ctx).taxonScope).toContain('genus');
  });

  /**
   * The kingdom rides along as GBIF's own disambiguator on the narrower lookup rather
   * than being resolved separately — it is what makes a name several kingdoms share
   * resolve at all ("Prunella" under Animalia matches the accentor genus 2495070,
   * under Plantae the self-heal genus 2926553, and alone matches nothing).
   */
  it('applies kingdom as the disambiguator on the narrower lookup', async () => {
    matchesByName({ Quercus: 'Quercus' });
    mockSearchSpecies.mockResolvedValue(emptyPage);

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({ kingdom: 'Plantae', genus: 'Quercus' });
    await gbifSearchSpecies.handler(input, ctx);

    expect(mockMatchSpecies).toHaveBeenCalledTimes(1);
    expect(mockMatchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Quercus', rank: 'GENUS', kingdom: 'Plantae' }),
      ctx,
    );
  });

  /**
   * Under `strict` a misspelling, a lowercase name, and a name several kingdoms share
   * all answer matchType NONE. Failing by name beats the old behavior, where the
   * unmatched value was forwarded and ignored and the whole index came back.
   */
  it('rejects a scope name that matches no backbone taxon', async () => {
    matchesByName({});
    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({ family: 'Paridaee' });

    const err = await gbifSearchSpecies.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'unresolved_taxon_scope' } });
    expect((err as Error).message).toContain('Paridaee');
    expect(mockSearchSpecies).not.toHaveBeenCalled();
  });

  /**
   * `/species/match` treats `rank` as a scoring hint rather than a constraint, so a
   * name can come back at another rank: unstrict, "Aves" asked for as a FAMILY
   * answers as the CLASS Aves, and "Parus major" asked for as a GENUS answers as a
   * SPECIES. The second is the case the rank check alone catches — that match does
   * carry a `genusKey` (2487923, *Parus*), so reading it off would scope to a taxon
   * the field never named rather than fail.
   */
  it.each([
    ['family', 'Aves', 'AvesAsClass'],
    ['genus', 'Parus major', 'ParusMajorAsSpecies'],
  ] as const)(
    'rejects %s "%s", which resolved at a different rank',
    async (field, name, fixture) => {
      matchesByName({ [name]: fixture });
      const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
      const input = gbifSearchSpecies.input.parse({ [field]: name });

      const err = await gbifSearchSpecies.handler(input, ctx).catch((e: unknown) => e);

      expect(err).toMatchObject({ data: { reason: 'unresolved_taxon_scope' } });
      expect(mockSearchSpecies).not.toHaveBeenCalled();
    },
  );

  /**
   * Only the genus key is forwarded, so a family that names a different lineage would
   * otherwise go unapplied and unmentioned. GBIF cannot catch it — `/species/match`
   * ignores a `family` hint outright.
   */
  it('rejects a family and genus that name different lineages', async () => {
    matchesByName({ Asteraceae: 'Asteraceae', Quercus: 'Quercus' });
    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({ family: 'Asteraceae', genus: 'Quercus' });

    const err = await gbifSearchSpecies.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'conflicting_taxon_scope' } });
    expect((err as Error).message).toContain('Fagaceae');
    expect(mockSearchSpecies).not.toHaveBeenCalled();
  });

  it('accepts a family and genus that do nest', async () => {
    matchesByName({ Fagaceae: 'Fagaceae', Quercus: 'Quercus' });
    mockSearchSpecies.mockResolvedValue({ ...emptyPage, count: 6059 });

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({ family: 'Fagaceae', genus: 'Quercus' });
    await gbifSearchSpecies.handler(input, ctx);

    const sent = mockSearchSpecies.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.higherTaxonKey).toBe(2877951);
  });

  /** Omitting all three is still how a caller browses the whole backbone. */
  it('omits higherTaxonKey and taxonScope when no scope filter is supplied', async () => {
    mockSearchSpecies.mockResolvedValue({ ...emptyPage, count: 558589 });

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    await gbifSearchSpecies.handler(gbifSearchSpecies.input.parse({ rank: 'FAMILY' }), ctx);

    expect(mockMatchSpecies).not.toHaveBeenCalled();
    expect(mockSearchSpecies).toHaveBeenCalledWith(
      expect.not.objectContaining({ higherTaxonKey: expect.anything() }),
      ctx,
    );
    expect(getEnrichment(ctx).taxonScope).toBeUndefined();
  });

  /**
   * GBIF reads a higher-taxon key inside the checklist that key belongs to, and the
   * key resolved here is a backbone key: live, `higherTaxonKey=9327` returns the same
   * 641 names with and without the backbone datasetKey, and 0 against the 455-name
   * "Checklist of alien birds of Belgium". An empty result under both filters is that
   * mismatch, not a statement about the checklist's contents.
   */
  it('explains an empty result when a taxon scope is paired with a checklist', async () => {
    matchesByName({ Quercus: 'Quercus' });
    mockSearchSpecies.mockResolvedValue(emptyPage);

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({
      genus: 'Quercus',
      datasetKey: 'e1c3be64-2799-4342-8312-49d076993132',
    });
    await gbifSearchSpecies.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('datasetKey');
    expect(notice).toContain('genus');
  });

  it('keeps the plain empty-result notice when no taxon scope was applied', async () => {
    mockSearchSpecies.mockResolvedValue(emptyPage);

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({
      q: 'nothing',
      datasetKey: 'e1c3be64-2799-4342-8312-49d076993132',
    });
    await gbifSearchSpecies.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toContain('No taxa matched the query');
  });

  it('passes datasetKey to the service', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [],
      count: 0,
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({
      q: 'Aves',
      datasetKey: '7ddf754f-d193-4cc9-b351-99906754a03b',
    });
    await gbifSearchSpecies.handler(input, ctx);

    expect(mockSearchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ datasetKey: '7ddf754f-d193-4cc9-b351-99906754a03b' }),
      ctx,
    );
  });

  /** Omitting the field is still how a caller searches the whole backbone. */
  it('defaults datasetKey to the GBIF backbone when not provided', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [],
      count: 4972,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    await gbifSearchSpecies.handler(gbifSearchSpecies.input.parse({ q: 'Aves' }), ctx);

    expect(mockSearchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ datasetKey: 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c' }),
      ctx,
    );
  });

  it('preserves explicit checklist usage, mapping and provenance through output parsing and text', async () => {
    mockSearchSpecies.mockResolvedValue({
      ...emptyPage,
      count: 1,
      results: [
        {
          key: 206097493,
          nubKey: 2878688,
          datasetKey: '2c38cf8a-f981-4dfb-bc9d-dd2b6fc792ed',
          canonicalName: 'Quercus robur',
        },
      ],
    });
    const result = await runToolContract(gbifSearchSpecies, {
      q: 'Quercus robur',
      datasetKey: '2c38cf8a-f981-4dfb-bc9d-dd2b6fc792ed',
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      taxa: [
        { key: 206097493, nubKey: 2878688, datasetKey: '2c38cf8a-f981-4dfb-bc9d-dd2b6fc792ed' },
      ],
    });
    expect(mockSearchSpecies.mock.calls[0][0].datasetKey).toBe(
      '2c38cf8a-f981-4dfb-bc9d-dd2b6fc792ed',
    );
    const text = JSON.stringify(result.content);
    for (const value of ['206097493', '2878688', '2c38cf8a-f981-4dfb-bc9d-dd2b6fc792ed'])
      expect(text).toContain(value);
  });

  it.each([
    undefined,
    'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c',
    'D7DDDBF4-2CF0-4F39-9B2A-BB099CAAE36C',
  ])('keeps backbone empty-scope guidance honest for datasetKey %s', async (datasetKey) => {
    matchesByName({ Quercus: 'Quercus' });
    mockSearchSpecies.mockResolvedValue(emptyPage);
    const result = await runToolContract(gbifSearchSpecies, { genus: 'Quercus', datasetKey });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.notice).toContain('No taxa matched the query');
    expect(JSON.stringify(result.content)).not.toContain('another checklist');
  });

  /**
   * #54 — the forward tested `?.trim()`, so a blank q was dropped. `/species/search`
   * answers the two blank forms two different ways and neither is the search that was
   * asked for: `?q=` returns the whole 46,623,754-name index, exactly what the same
   * call returns with no q at all, and `?q=%20%20` returns nothing.
   */
  it.each(['', '   '])('rejects q "%s" instead of browsing the whole backbone', async (blank) => {
    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({ q: blank });
    expect(input.q).toBe(blank);

    const err = await gbifSearchSpecies.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect((err as Error).message).toContain('q');
    expect(mockSearchSpecies).not.toHaveBeenCalled();
  });

  /** Omitting the field is still how a caller browses without a name term. */
  it('omits q when not provided', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [],
      count: 558589,
      offset: 0,
      limit: 20,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    await gbifSearchSpecies.handler(gbifSearchSpecies.input.parse({ rank: 'FAMILY' }), ctx);

    expect(mockSearchSpecies).toHaveBeenCalledWith(
      expect.not.objectContaining({ q: expect.anything() }),
      ctx,
    );
  });

  /**
   * #53 — the guard used to fire on a non-blank value, so an empty string cleared it
   * and the forward alike and the search ran against the whole backbone. Measured on
   * the built server: `q=Aves` with `datasetKey: ""` returns the same 4,972 taxa as
   * the same call with no datasetKey, so a caller scoping to one checklist gets every
   * checklist and the backbone besides.
   */
  it('rejects an empty datasetKey instead of searching the whole backbone', async () => {
    const ctx = createMockContext({ errors: gbifSearchSpecies.errors });
    const input = gbifSearchSpecies.input.parse({ q: 'Aves', datasetKey: '' });
    expect(input.datasetKey).toBe('');

    const err = await gbifSearchSpecies.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect((err as Error).message).toContain('datasetKey');
    expect(mockSearchSpecies).not.toHaveBeenCalled();
  });

  it('handles sparse taxon records', async () => {
    mockSearchSpecies.mockResolvedValue({
      results: [{ key: 999 }],
      count: 1,
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({});
    const result = await gbifSearchSpecies.handler(input, ctx);

    expect(result.taxa[0].key).toBe(999);
    expect(result.taxa[0].canonicalName).toBeUndefined();
    expect(result.taxa[0].extinct).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      taxa: [
        {
          key: 5231190,
          canonicalName: 'Parus major',
          scientificName: 'Parus major Linnaeus, 1758',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          vernacularName: 'Great Tit',
          kingdom: 'Animalia',
          numOccurrences: 5000000,
        },
      ],
    };
    const blocks = gbifSearchSpecies.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('Great Tit');
  });

  /**
   * #39 — GBIF leaves canonicalName null on backbone entries whose names are not
   * parseable binomials (live: q=Coleoptera&rank=FAMILY returns key 220425367 with
   * scientificName "unclassified Coleoptera" and canonicalName null).
   */
  it('falls back to scientificName instead of printing Unknown (issue #39)', () => {
    const blocks = gbifSearchSpecies.format!({
      taxa: [{ key: 220425367, scientificName: 'unclassified Coleoptera', rank: 'FAMILY' }],
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toContain('unclassified Coleoptera');
    expect(text).not.toContain('Unknown');
  });

  it('still prints Unknown when GBIF supplies no name at all', () => {
    const blocks = gbifSearchSpecies.format!({ taxa: [{ key: 999 }] });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toContain('Unknown');
  });
});
