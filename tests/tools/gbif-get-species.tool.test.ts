/**
 * @fileoverview Tests for gbif_get_species tool.
 * @module tests/tools/gbif-get-species.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetSpecies } from '@/mcp-server/tools/definitions/gbif-get-species.tool.js';
import { gbifSearchSpecies } from '@/mcp-server/tools/definitions/gbif-search-species.tool.js';
import { listedInputSchema as listedWorkerInputSchema } from '../helpers/worker-request.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** Live /species/0 response: key 0 is the backbone kingdom incertae sedis. */
const INCERTAE_SEDIS = {
  key: 0,
  nubKey: 0,
  kingdom: 'incertae sedis',
  kingdomKey: 0,
  scientificName: 'incertae sedis',
  canonicalName: 'incertae sedis',
  authorship: '',
  nameType: 'PLACEHOLDER',
  rank: 'KINGDOM',
  taxonomicStatus: 'DOUBTFUL',
  numDescendants: 3613,
};

const textOf = (content: unknown) => JSON.stringify(content);

/** The input schema a client receives from tools/list, as the server advertises it. */
const listedInputSchema = () =>
  listedWorkerInputSchema(
    { name: 'gbif-get-species-test', tools: [gbifGetSpecies] },
    'gbif_get_species',
  );

describe('gbifGetSpecies', () => {
  const mockGetSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getSpecies: mockGetSpecies } as never);
  });

  it('returns full species record for valid taxon key', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      authorship: 'Linnaeus, 1758',
      vernacularName: 'Great Tit',
      rank: 'SPECIES',
      taxonomicStatus: 'ACCEPTED',
      numDescendants: 12,
      numOccurrences: 5000000,
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
      parentKey: 2492278,
      parent: 'Parus',
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 5231190 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.key).toBe(5231190);
    expect(result.canonicalName).toBe('Parus major');
    expect(result.vernacularName).toBe('Great Tit');
    expect(result.rank).toBe('SPECIES');
    expect(result.taxonomicStatus).toBe('ACCEPTED');
    expect(result.numDescendants).toBe(12);
    // Read straight from GBIF's raw `class` field (#34).
    expect(result.class).toBe('Aves');
    expect(result.parentKey).toBe(2492278);
    expect(result.parent).toBe('Parus');
  });

  it('throws not_found when key is missing', async () => {
    mockGetSpecies.mockResolvedValue({ key: undefined });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 9999999 });

    await expect(gbifGetSpecies.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('populates the class name from GBIF raw.class (#34)', async () => {
    // GBIF's /species/{key} returns the class name under `class` (not `clazz`, which is always
    // null). Panthera leo (5219404) has class Mammalia; it must reach structuredContent.
    mockGetSpecies.mockResolvedValue({
      key: 5219404,
      canonicalName: 'Panthera leo',
      class: 'Mammalia',
      classKey: 359,
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 5219404 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.class).toBe('Mammalia');
    expect(result.classKey).toBe(359);
  });

  it('includes extinct when explicitly true', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 200,
      extinct: true,
      canonicalName: 'Dinosauria',
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 200 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.extinct).toBe(true);
  });

  it('omits extinct when not a boolean', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 300,
      canonicalName: 'Pinus',
      // extinct absent from upstream
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 300 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.extinct).toBeUndefined();
  });

  it('includes synonym fields when taxonomicStatus is SYNONYM', async () => {
    mockGetSpecies.mockResolvedValue({
      key: 400,
      taxonomicStatus: 'SYNONYM',
      acceptedKey: 5231190,
      accepted: 'Parus major',
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 400 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.taxonomicStatus).toBe('SYNONYM');
    expect(result.acceptedKey).toBe(5231190);
    expect(result.accepted).toBe('Parus major');
  });

  it('handles sparse upstream response', async () => {
    mockGetSpecies.mockResolvedValue({ key: 500 });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 500 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.key).toBe(500);
    expect(result.canonicalName).toBeUndefined();
    expect(result.vernacularName).toBeUndefined();
    expect(result.extinct).toBeUndefined();
  });

  it('strips HTML from publishedIn', async () => {
    // GBIF embeds <em> tags in the original-description citation (Parus major / 9705453).
    mockGetSpecies.mockResolvedValue({
      key: 9705453,
      canonicalName: 'Parus major',
      publishedIn:
        'Linnaeus, C. (1758). Systema Naturae. <em>Editio decima, reformata, vol. 1: 824 pp. Laurentius Salvius: Holmiae.</em>',
    });

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 9705453 });
    const result = await gbifGetSpecies.handler(input, ctx);

    expect(result.publishedIn).toBe(
      'Linnaeus, C. (1758). Systema Naturae. Editio decima, reformata, vol. 1: 824 pp. Laurentius Salvius: Holmiae.',
    );
    expect(result.publishedIn).not.toContain('<em>');
    expect(result.publishedIn).not.toContain('</em>');
  });

  it('formats output with key fields', () => {
    const output = {
      key: 5231190,
      canonicalName: 'Parus major',
      scientificName: 'Parus major Linnaeus, 1758',
      vernacularName: 'Great Tit',
      rank: 'SPECIES',
      taxonomicStatus: 'ACCEPTED',
      numDescendants: 12,
      numOccurrences: 5000000,
    };
    const blocks = gbifGetSpecies.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('Great Tit');
    expect(text).toContain('ACCEPTED');
  });

  it('formats sparse output without invented facts', () => {
    const blocks = gbifGetSpecies.format!({ key: 123 });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('123');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('renders a key-only classification entry when the rank name is absent (#31)', () => {
    // A record that carries a rank key without its name (a genuine edge case) must still surface
    // the key in content[], matching what structuredContent carries. format()-only, so the output
    // object is constructed directly with class omitted and classKey present.
    const blocks = gbifGetSpecies.format!({
      key: 5219404,
      canonicalName: 'Panthera leo',
      kingdom: 'Animalia',
      kingdomKey: 1,
      phylum: 'Chordata',
      phylumKey: 44,
      classKey: 359,
      order: 'Carnivora',
      orderKey: 732,
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Class key: 359');
    expect(text).toContain('Kingdom: Animalia (1)');
    expect(text).toContain('Order: Carnivora (732)');
    expect(text).not.toContain('undefined');
  });

  it('renders key-only fallbacks at every rank when names are absent (#31)', () => {
    const blocks = gbifGetSpecies.format!({
      key: 1,
      kingdomKey: 1,
      phylumKey: 44,
      classKey: 359,
      orderKey: 732,
      familyKey: 9701,
      genusKey: 2435098,
      speciesKey: 5219404,
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    for (const part of [
      'Kingdom key: 1',
      'Phylum key: 44',
      'Class key: 359',
      'Order key: 732',
      'Family key: 9701',
      'Genus key: 2435098',
      'Species key: 5219404',
    ]) {
      expect(text).toContain(part);
    }
  });

  /**
   * #47 — GBIF answers 400 (not 404) for a taxonKey it cannot parse: live,
   * /species/999999999999 and /species/1.5 both return "For input string" with a 400,
   * and the bare z.number() accepts either value.
   */
  it('propagates the upstream invalid_filter reason and declares it (issue #47)', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetSpecies.mockRejectedValue(
      new McpError(
        JsonRpcErrorCode.InvalidParams,
        'GBIF API returned HTTP 400 Bad Request. For input string: "999999999999"',
        { status: 400, reason: 'invalid_filter' },
      ),
    );

    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const input = gbifGetSpecies.input.parse({ taxonKey: 999999999999 });

    const err = await gbifGetSpecies.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    // An integer past the 32-bit range still passes the schema and reaches GBIF (#75).
    expect(mockGetSpecies).toHaveBeenCalledWith(999999999999, ctx);

    const declared = gbifGetSpecies.errors?.find((e) => e.reason === 'invalid_filter');
    expect(declared?.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(declared?.recovery).toBeTruthy();
  });

  /** #75 — a fraction can no longer reach GBIF, so the contract no longer cites one. */
  it('declares invalid_filter for an out-of-range key without citing a fraction', () => {
    const declared = gbifGetSpecies.errors?.find((e) => e.reason === 'invalid_filter');
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
    const result = await runToolContract(gbifGetSpecies, { taxonKey });

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: JsonRpcErrorCode.InvalidParams,
      data: { reason: 'invalid_arguments' },
    });
    expect(mockGetSpecies).not.toHaveBeenCalled();
  });

  /** #80 — key 0 answered not_found though GBIF serves the record. */
  it('returns the incertae sedis record for taxonKey 0 on both surfaces', async () => {
    mockGetSpecies.mockResolvedValue(INCERTAE_SEDIS);

    const result = await runToolContract(gbifGetSpecies, { taxonKey: 0 });

    expect(result.isError).not.toBe(true);
    expect(mockGetSpecies).toHaveBeenCalledWith(0, expect.anything());
    expect(result.structuredContent).toMatchObject({
      key: 0,
      canonicalName: 'incertae sedis',
      rank: 'KINGDOM',
      kingdom: 'incertae sedis',
      kingdomKey: 0,
    });
    const text = textOf(result.content);
    expect(text).toContain('**Taxon usage key:** 0');
    // nubKey 0 is the same real key: tested for presence, never truthiness (#94).
    expect(result.structuredContent).toMatchObject({ nubKey: 0 });
    expect(text).toContain('**Backbone key:** 0');
    expect(text).toContain('Kingdom: incertae sedis (0)');
  });

  it.each(['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'] as const)(
    'renders %sKey 0 beside its name (#80)',
    (rank) => {
      const blocks = gbifGetSpecies.format!({
        key: 9,
        [rank]: 'Xname',
        [`${rank}Key`]: 0,
      } as never);
      const text = blocks[0].type === 'text' ? blocks[0].text : '';
      expect(text).toContain('Xname (0)');
    },
  );

  /** Characterization — an absent key still renders no parenthetical. */
  it('renders no parenthetical when the rank key is absent', () => {
    const blocks = gbifGetSpecies.format!({ key: 9, kingdom: 'Animalia' });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Kingdom: Animalia');
    expect(text).not.toContain('Animalia (');
  });

  /** /species/{key} sends no numOccurrences; the field description must not promise one. */
  it('describes numOccurrences without promising GBIF sends it', () => {
    const described = gbifGetSpecies.output.shape.numOccurrences.description ?? '';
    expect(described).toContain('gbif_count_occurrences');
  });

  /**
   * #94 — /species/{key} reads every checklist, so a usage key from gbif_search_species
   * with a datasetKey resolves to that checklist's record. Live /species/152543218: a
   * usage of checklist 6d9e952f-…, its genusKey and kingdomKey usage keys of the same
   * checklist, and nubKey 2498252 the backbone key that counts its occurrences.
   */
  describe('checklist identity (#94)', () => {
    const CHECKLIST = '6d9e952f-948c-4483-9807-575348147c7e';
    const BACKBONE = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

    it('returns the nubKey and datasetKey of a checklist usage on both surfaces', async () => {
      mockGetSpecies.mockResolvedValue({
        key: 152543218,
        nubKey: 2498252,
        datasetKey: CHECKLIST,
        canonicalName: 'Alopochen aegyptiaca',
        rank: 'SPECIES',
        kingdomKey: 342994368,
        genusKey: 342995876,
        parentKey: 342995876,
        parent: 'Alopochen',
      });

      const result = await runToolContract(gbifGetSpecies, { taxonKey: 152543218 });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        key: 152543218,
        nubKey: 2498252,
        datasetKey: CHECKLIST,
        genusKey: 342995876,
      });
      const text = textOf(result.content);
      expect(text).toContain('**Taxon usage key:** 152543218');
      expect(text).toContain(`**Dataset key:** ${CHECKLIST}`);
      expect(text).toContain('**Backbone key:** 2498252');
    });

    it('returns a backbone usage with nubKey equal to its key', async () => {
      mockGetSpecies.mockResolvedValue({
        key: 2498252,
        nubKey: 2498252,
        datasetKey: BACKBONE,
        canonicalName: 'Alopochen aegyptiaca',
      });

      const result = await runToolContract(gbifGetSpecies, { taxonKey: 2498252 });

      expect(result.structuredContent).toMatchObject({
        key: 2498252,
        nubKey: 2498252,
        datasetKey: BACKBONE,
      });
      expect(textOf(result.content)).toContain(`**Dataset key:** ${BACKBONE}`);
    });

    /** Live /species/206094766 omits nubKey: the backbone has no mapping for it. */
    it('infers no nubKey for an unmapped usage and renders no backbone line', async () => {
      mockGetSpecies.mockResolvedValue({
        key: 206094766,
        datasetKey: '2c38cf8a-f981-4dfb-bc9d-dd2b6fc792ed',
        canonicalName: 'Septoria galinsogae',
      });

      const result = await runToolContract(gbifGetSpecies, { taxonKey: 206094766 });

      // The wire form: JSON drops an undefined field, so this is what a client receives.
      expect(JSON.parse(JSON.stringify(result.structuredContent))).not.toHaveProperty('nubKey');
      expect(result.structuredContent).toMatchObject({
        datasetKey: '2c38cf8a-f981-4dfb-bc9d-dd2b6fc792ed',
      });
      const text = textOf(result.content);
      expect(text).not.toContain('Backbone key');
      expect(text).toContain('**Taxon usage key:** 206094766');
    });

    it('describes the identity keys as gbif_search_species does, and no usage key as backbone', () => {
      const { shape } = gbifGetSpecies.output;
      const searchRow = gbifSearchSpecies.output.shape.taxa.element.shape;
      for (const field of ['key', 'datasetKey', 'nubKey'] as const) {
        expect(shape[field].description, field).toBe(searchRow[field].description);
      }
      for (const field of [
        'kingdomKey',
        'phylumKey',
        'classKey',
        'orderKey',
        'familyKey',
        'genusKey',
        'speciesKey',
        'parentKey',
        'acceptedKey',
        'numDescendants',
      ] as const) {
        expect(shape[field].description, field).not.toMatch(/backbone/i);
      }
      expect(gbifGetSpecies.input.shape.taxonKey.description).not.toMatch(/backbone taxon key/i);
      expect(shape.numOccurrences.description).toContain('nubKey');
    });

    it('keeps backbone out of the error conditions and the not_found message', async () => {
      for (const entry of gbifGetSpecies.errors ?? []) {
        expect(entry.when, entry.reason).not.toMatch(/backbone/i);
      }
      const invalid = gbifGetSpecies.errors?.find((e) => e.reason === 'invalid_filter');
      expect(invalid?.recovery).not.toMatch(/backbone/i);

      mockGetSpecies.mockResolvedValue({ key: undefined });
      const ctx = createMockContext({ errors: gbifGetSpecies.errors });
      const err = await gbifGetSpecies
        .handler(gbifGetSpecies.input.parse({ taxonKey: 2147483647 }), ctx)
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ data: { reason: 'not_found' } });
      expect((err as Error).message).toContain('2147483647');
      expect((err as Error).message).not.toMatch(/backbone/i);
    });
  });
});
