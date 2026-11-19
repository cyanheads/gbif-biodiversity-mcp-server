/**
 * @fileoverview Tests for gbif_get_species_classification tool.
 * @module tests/tools/gbif-get-species-classification.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetSpeciesClassification } from '@/mcp-server/tools/definitions/gbif-get-species-classification.tool.js';
import { gbifSearchSpecies } from '@/mcp-server/tools/definitions/gbif-search-species.tool.js';
import { listedInputSchema as listedWorkerInputSchema } from '../helpers/worker-request.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** The input schema a client receives from tools/list, as the server advertises it. */
const listedInputSchema = () =>
  listedWorkerInputSchema(
    { name: 'gbif-get-species-classification-test', tools: [gbifGetSpeciesClassification] },
    'gbif_get_species_classification',
  );

describe('gbifGetSpeciesClassification', () => {
  const mockGetSpeciesParents = vi.fn();
  const mockGetSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      getSpeciesParents: mockGetSpeciesParents,
      getSpecies: mockGetSpecies,
    } as never);
  });

  it('returns ordered classification chain', async () => {
    mockGetSpeciesParents.mockResolvedValue([
      { key: 1, rank: 'KINGDOM', canonicalName: 'Animalia', scientificName: 'Animalia' },
      { key: 44, rank: 'PHYLUM', canonicalName: 'Chordata', scientificName: 'Chordata' },
      { key: 212, rank: 'CLASS', canonicalName: 'Aves', scientificName: 'Aves' },
      { key: 729, rank: 'ORDER', canonicalName: 'Passeriformes', scientificName: 'Passeriformes' },
      {
        key: 9322,
        rank: 'FAMILY',
        canonicalName: 'Paridae',
        scientificName: 'Paridae Vigors, 1825',
      },
      {
        key: 2492278,
        rank: 'GENUS',
        canonicalName: 'Parus',
        scientificName: 'Parus Linnaeus, 1758',
      },
    ]);

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 5231190 });
    const result = await gbifGetSpeciesClassification.handler(input, ctx);

    expect(result.classification).toHaveLength(6);
    expect(result.classification[0].rank).toBe('KINGDOM');
    expect(result.classification[0].name).toBe('Animalia');
    expect(result.classification[0].key).toBe(1);
    expect(result.classification[5].rank).toBe('GENUS');
    expect(result.classification[5].name).toBe('Parus');
  });

  // #29: the chain stops at the immediate parent — the queried taxon is never appended,
  // and no redundant self-fetch happens on the success path (that's gbif_get_species's job).
  it('ends at the immediate parent without fetching or appending the queried taxon', async () => {
    mockGetSpeciesParents.mockResolvedValue([
      { key: 1, rank: 'KINGDOM', canonicalName: 'Animalia', scientificName: 'Animalia' },
      {
        key: 2492278,
        rank: 'GENUS',
        canonicalName: 'Parus',
        scientificName: 'Parus Linnaeus, 1758',
      },
    ]);

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 9705453 });
    const result = await gbifGetSpeciesClassification.handler(input, ctx);

    expect(result.classification).toHaveLength(2);
    expect(result.classification.at(-1)).toMatchObject({ key: 2492278, rank: 'GENUS' });
    expect(mockGetSpecies).not.toHaveBeenCalled();
  });

  it('throws not_found when response is not an array', async () => {
    mockGetSpeciesParents.mockResolvedValue({ error: 'not found' });

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 9999999 });

    await expect(gbifGetSpeciesClassification.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('throws not_found when getSpeciesParents rejects with McpError NotFound', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetSpeciesParents.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'Taxon not found'),
    );

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 999999999 });

    await expect(gbifGetSpeciesClassification.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('returns empty classification for root taxon (kingdom-level)', async () => {
    mockGetSpeciesParents.mockResolvedValue([]);
    // Root/kingdom-level taxa have no parents but the taxon itself exists
    mockGetSpecies.mockResolvedValue({ key: 1, rank: 'KINGDOM', canonicalName: 'Animalia' });

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 1 });
    const result = await gbifGetSpeciesClassification.handler(input, ctx);

    // #7 settled that an empty chain with isError false is the correct outcome here;
    // #46 only adds the notice that says why it is empty (rather than missing).
    expect(result.classification).toHaveLength(0);
    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('root');
    expect(notice).toContain('1');
  });

  it('emits no root notice when the chain has entries', async () => {
    mockGetSpeciesParents.mockResolvedValue([
      { key: 1, rank: 'KINGDOM', canonicalName: 'Animalia' },
    ]);

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 44 });
    await gbifGetSpeciesClassification.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  /**
   * #47 — GBIF answers 400 for a taxonKey it cannot parse, not 404. Since #75 a fraction
   * fails at the schema, so the key that still reaches GBIF and 400s is an integer past
   * the 32-bit range.
   */
  it('propagates the upstream invalid_filter reason and declares it (issue #47)', async () => {
    const { McpError } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetSpeciesParents.mockRejectedValue(
      new McpError(
        JsonRpcErrorCode.InvalidParams,
        'GBIF API returned HTTP 400 Bad Request. For input string: "999999999999"',
        { status: 400, reason: 'invalid_filter' },
      ),
    );

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 999999999999 });

    const err = await gbifGetSpeciesClassification.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect(mockGetSpeciesParents).toHaveBeenCalledWith(999999999999, ctx);

    const declared = gbifGetSpeciesClassification.errors?.find(
      (e) => e.reason === 'invalid_filter',
    );
    expect(declared?.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(declared?.recovery).toBeTruthy();
    expect(declared?.when).not.toMatch(/fraction/i);
    expect(declared?.when).toContain('32-bit signed integer range');
    expect(declared?.recovery).not.toContain('whole numbers');
  });

  /** #75 — the advertised schema says integer, and 0 (incertae sedis) is its floor. */
  it('advertises taxonKey as a non-negative integer in tools/list', async () => {
    const schema = await listedInputSchema();
    expect(schema.properties.taxonKey).toMatchObject({ type: 'integer', minimum: 0 });
  });

  it.each([1.5, -5])('rejects taxonKey %s at the schema before any request', async (taxonKey) => {
    const result = await runToolContract(gbifGetSpeciesClassification, { taxonKey });

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: JsonRpcErrorCode.InvalidParams,
      data: { reason: 'invalid_arguments' },
    });
    expect(mockGetSpeciesParents).not.toHaveBeenCalled();
    expect(mockGetSpecies).not.toHaveBeenCalled();
  });

  /** Characterization — key 0 (incertae sedis) is a root taxon and stays answerable. */
  it('answers taxonKey 0 as a root taxon with an empty chain', async () => {
    mockGetSpeciesParents.mockResolvedValue([]);
    mockGetSpecies.mockResolvedValue({ key: 0, rank: 'KINGDOM', canonicalName: 'incertae sedis' });

    const result = await runToolContract(gbifGetSpeciesClassification, { taxonKey: 0 });

    expect(result.isError).not.toBe(true);
    expect(mockGetSpeciesParents).toHaveBeenCalledWith(0, expect.anything());
    expect(result.structuredContent?.classification).toEqual([]);
    expect(result.structuredContent?.notice).toContain('root');
  });

  it('normalizes canonicalName to name field', async () => {
    mockGetSpeciesParents.mockResolvedValue([
      { key: 1, rank: 'KINGDOM', canonicalName: 'Plantae' },
    ]);

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 6 });
    const result = await gbifGetSpeciesClassification.handler(input, ctx);

    expect(result.classification[0].name).toBe('Plantae');
  });

  it('handles sparse parent nodes', async () => {
    mockGetSpeciesParents.mockResolvedValue([
      { key: 100 }, // no rank, no canonicalName
    ]);

    const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
    const input = gbifGetSpeciesClassification.input.parse({ taxonKey: 200 });
    const result = await gbifGetSpeciesClassification.handler(input, ctx);

    expect(result.classification[0].key).toBe(100);
    expect(result.classification[0].rank).toBeUndefined();
    expect(result.classification[0].name).toBeUndefined();
  });

  /**
   * #94 — /species/{key}/parents walks the queried usage's own checklist. Live, the
   * parents of checklist usage 152543218 (checklist 6d9e952f-…) are usages of that
   * checklist, each carrying its own nubKey: Animalia 342994368 maps to backbone key 1.
   */
  describe('checklist identity (#94)', () => {
    const CHECKLIST = '6d9e952f-948c-4483-9807-575348147c7e';

    it("carries each entry's nubKey and datasetKey on both surfaces, inferring none", async () => {
      mockGetSpeciesParents.mockResolvedValue([
        {
          key: 342994368,
          nubKey: 1,
          datasetKey: CHECKLIST,
          rank: 'KINGDOM',
          canonicalName: 'Animalia',
        },
        {
          key: 342995876,
          nubKey: 2498251,
          datasetKey: CHECKLIST,
          rank: 'GENUS',
          canonicalName: 'Alopochen',
        },
        { key: 342999002, datasetKey: CHECKLIST, rank: 'SUBGENUS', canonicalName: 'Unmapped' },
      ]);

      const result = await runToolContract(gbifGetSpeciesClassification, {
        taxonKey: 152543218,
      });

      expect(result.isError).not.toBe(true);
      const wire = JSON.parse(JSON.stringify(result.structuredContent));
      expect(wire.classification[0]).toMatchObject({
        key: 342994368,
        nubKey: 1,
        datasetKey: CHECKLIST,
      });
      expect(wire.classification[1]).toMatchObject({ key: 342995876, nubKey: 2498251 });
      expect(wire.classification[2]).toMatchObject({ key: 342999002, datasetKey: CHECKLIST });
      expect(wire.classification[2]).not.toHaveProperty('nubKey');

      const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
      const lines = text.split('\n').filter((line) => line.includes('**'));
      const [kingdom, genus, unmapped] = lines.slice(1);
      expect(kingdom).toContain('Animalia');
      expect(kingdom).toContain('Taxon usage key: 342994368');
      expect(kingdom).toContain(`Dataset key: ${CHECKLIST}`);
      expect(kingdom).toContain('Backbone key: 1');
      expect(genus).toContain('Backbone key: 2498251');
      expect(unmapped).toContain('Taxon usage key: 342999002');
      expect(unmapped).not.toContain('Backbone key');
    });

    /** #80 — key 0 is the backbone kingdom incertae sedis, a real key on both axes. */
    it('renders a key and nubKey of 0 rather than dropping them', () => {
      const blocks = gbifGetSpeciesClassification.format!({
        classification: [{ key: 0, nubKey: 0, rank: 'KINGDOM', name: 'incertae sedis' }],
      });
      const text = blocks[0].type === 'text' ? blocks[0].text : '';
      expect(text).toContain('(Taxon usage key: 0 · Backbone key: 0)');
    });

    it('describes the identity keys as gbif_search_species does', () => {
      const entry = gbifGetSpeciesClassification.output.shape.classification.element.shape;
      const searchRow = gbifSearchSpecies.output.shape.taxa.element.shape;
      for (const field of ['key', 'datasetKey', 'nubKey'] as const) {
        expect(entry[field].description, field).toBe(searchRow[field].description);
      }
      expect(gbifGetSpeciesClassification.input.shape.taxonKey.description).not.toMatch(
        /backbone taxon key/i,
      );
    });

    it('keeps backbone out of the root notice, error conditions, and message', async () => {
      mockGetSpeciesParents.mockResolvedValue([]);
      mockGetSpecies.mockResolvedValue({ key: 342994368, datasetKey: CHECKLIST });
      const ctx = createMockContext({ errors: gbifGetSpeciesClassification.errors });
      await gbifGetSpeciesClassification.handler(
        gbifGetSpeciesClassification.input.parse({ taxonKey: 342994368 }),
        ctx,
      );
      const notice = getEnrichment(ctx).notice as string;
      expect(notice).toContain('root');
      expect(notice).not.toMatch(/backbone/i);
      expect(gbifGetSpeciesClassification.enrichment?.notice?.description).not.toMatch(/backbone/i);

      for (const entry of gbifGetSpeciesClassification.errors ?? []) {
        expect(entry.when, entry.reason).not.toMatch(/backbone/i);
      }
      const invalid = gbifGetSpeciesClassification.errors?.find(
        (e) => e.reason === 'invalid_filter',
      );
      expect(invalid?.recovery).not.toMatch(/backbone/i);

      const { McpError } = await import('@cyanheads/mcp-ts-core/errors');
      mockGetSpecies.mockRejectedValue(new McpError(JsonRpcErrorCode.NotFound, 'Not found'));
      const err = await gbifGetSpeciesClassification
        .handler(gbifGetSpeciesClassification.input.parse({ taxonKey: 2147483647 }), ctx)
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ data: { reason: 'not_found' } });
      expect((err as Error).message).toContain('2147483647');
      expect((err as Error).message).not.toMatch(/backbone/i);
    });
  });

  it('formats output with ranks and keys', () => {
    const output = {
      classification: [
        { key: 1, rank: 'KINGDOM', name: 'Animalia', scientificName: 'Animalia' },
        { key: 44, rank: 'PHYLUM', name: 'Chordata', scientificName: 'Chordata' },
        { key: 212, rank: 'CLASS', name: 'Aves' },
      ],
    };
    const blocks = gbifGetSpeciesClassification.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('KINGDOM');
    expect(text).toContain('Animalia');
    expect(text).toContain('1');
    expect(text).toContain('PHYLUM');
    expect(text).toContain('Chordata');
    expect(text).toContain('CLASS');
    expect(text).toContain('Aves');
    expect(text).toContain('3 ranks');
  });
});
