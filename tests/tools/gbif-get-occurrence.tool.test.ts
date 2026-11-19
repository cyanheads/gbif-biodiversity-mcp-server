/**
 * @fileoverview Tests for gbif_get_occurrence tool.
 * @module tests/tools/gbif-get-occurrence.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetOccurrence } from '@/mcp-server/tools/definitions/gbif-get-occurrence.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
  (result.content ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('\n');

/** structuredContent as the client receives it — JSON drops undefined-valued keys. */
const wireOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
  JSON.parse(JSON.stringify(result.structuredContent)) as Record<string, unknown>;

describe('gbifGetOccurrence', () => {
  const mockGetOccurrence = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getOccurrence: mockGetOccurrence } as never);
  });

  it('returns full occurrence record', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 1000000001,
      datasetKey: 'abc-123',
      taxonKey: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      order: 'Passeriformes',
      family: 'Paridae',
      genus: 'Parus',
      species: 'Parus major',
      taxonRank: 'SPECIES',
      decimalLatitude: 51.5,
      decimalLongitude: -0.1,
      coordinateUncertaintyInMeters: 100,
      continent: 'EUROPE',
      country: 'United Kingdom',
      countryCode: 'GB',
      stateProvince: 'England',
      locality: 'Hyde Park',
      publishingCountry: 'US',
      eventDate: '2024-05-01',
      year: 2024,
      month: 5,
      day: 1,
      basisOfRecord: 'HUMAN_OBSERVATION',
      institutionCode: 'RSPB',
      collectionCode: 'obs',
      catalogNumber: 'OBS-001',
      recordedBy: 'J. Smith',
      identifiedBy: 'J. Smith',
      individualCount: 2,
      sex: 'MALE',
      lifeStage: 'ADULT',
      issues: ['TAXON_MATCH_FUZZY'],
      media: [
        {
          type: 'StillImage',
          format: 'image/jpeg',
          identifier: 'https://example.com/photo.jpg',
          title: 'Great Tit photo',
          license: 'CC_BY_4_0',
        },
      ],
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 1000000001 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.key).toBe(1000000001);
    expect(result.taxonKey).toBe(5231190);
    expect(result.canonicalName).toBe('Parus major');
    expect(result.taxonRank).toBe('SPECIES');
    expect(result.decimalLatitude).toBe(51.5);
    expect(result.continent).toBe('EUROPE');
    expect(result.basisOfRecord).toBe('HUMAN_OBSERVATION');
    expect(result.institutionCode).toBe('RSPB');
    expect(result.sex).toBe('MALE');
    expect(result.lifeStage).toBe('ADULT');
    expect(result.issues).toEqual(['TAXON_MATCH_FUZZY']);
    expect(result.media).toHaveLength(1);
    expect(result.media![0].type).toBe('StillImage');
  });

  it('throws not_found when key is missing', async () => {
    mockGetOccurrence.mockResolvedValue({ key: undefined });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 9999999 });

    await expect(gbifGetOccurrence.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('omits issues when empty array', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 100,
      issues: [],
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 100 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.issues).toBeUndefined();
  });

  it('omits media when empty array', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 200,
      media: [],
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 200 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.media).toBeUndefined();
  });

  it('handles sparse upstream response', async () => {
    mockGetOccurrence.mockResolvedValue({ key: 300 });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 300 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.key).toBe(300);
    expect(result.decimalLatitude).toBeUndefined();
    expect(result.eventDate).toBeUndefined();
    expect(result.issues).toBeUndefined();
    expect(result.media).toBeUndefined();
    // Newly-exposed advertised fields (#27) are absent on a sparse record.
    expect(result.occurrenceID).toBeUndefined();
    expect(result.class).toBeUndefined();
    expect(result.classKey).toBeUndefined();
    expect(result.gadm).toBeUndefined();
    expect(result.identifiers).toBeUndefined();
  });

  it('exposes occurrenceID, class/classKey, gadm, and identifiers (#27)', async () => {
    // Mirrors GBIF occurrence 5938044864 (an iNaturalist Aves record from Sweden).
    mockGetOccurrence.mockResolvedValue({
      key: 5938044864,
      class: 'Aves',
      classKey: 212,
      occurrenceID: 'https://www.inaturalist.org/observations/333428940',
      gadm: {
        level0: { gid: 'SWE', name: 'Sweden' },
        level1: { gid: 'SWE.2_1', name: 'Norrbotten' },
      },
      identifiers: [{ type: 'URL', identifier: '333428940' }],
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 5938044864 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.occurrenceID).toBe('https://www.inaturalist.org/observations/333428940');
    expect(result.class).toBe('Aves');
    expect(result.classKey).toBe(212);
    expect(result.gadm?.level0).toEqual({ gid: 'SWE', name: 'Sweden' });
    expect(result.gadm?.level1).toEqual({ gid: 'SWE.2_1', name: 'Norrbotten' });
    expect(result.gadm?.level2).toBeUndefined();
    expect(result.identifiers).toEqual([{ type: 'URL', identifier: '333428940' }]);
  });

  it('drops empty gadm levels and omits gadm entirely when no level carries data', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 301,
      gadm: { level0: { gid: 'SWE', name: 'Sweden' }, level1: {}, level2: {} },
    });

    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    const input = gbifGetOccurrence.input.parse({ occurrenceKey: 301 });
    const result = await gbifGetOccurrence.handler(input, ctx);

    expect(result.gadm?.level0).toEqual({ gid: 'SWE', name: 'Sweden' });
    expect(result.gadm?.level1).toBeUndefined();
    expect(result.gadm?.level2).toBeUndefined();

    mockGetOccurrence.mockResolvedValue({ key: 302, gadm: { level0: {}, level1: {} } });
    const emptyResult = await gbifGetOccurrence.handler(
      gbifGetOccurrence.input.parse({ occurrenceKey: 302 }),
      ctx,
    );
    expect(emptyResult.gadm).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      key: 1000000001,
      taxonKey: 5231190,
      canonicalName: 'Parus major',
      scientificName: 'Parus major Linnaeus, 1758',
      taxonRank: 'SPECIES',
      basisOfRecord: 'HUMAN_OBSERVATION',
      eventDate: '2024-05-01',
      decimalLatitude: 51.5,
      decimalLongitude: -0.1,
      country: 'United Kingdom',
      countryCode: 'GB',
      datasetKey: 'abc-123',
    };
    const blocks = gbifGetOccurrence.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('1000000001');
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('51.5');
    expect(text).toContain('HUMAN_OBSERVATION');
  });

  it('formats date as Not available when absent', () => {
    const blocks = gbifGetOccurrence.format!({ key: 1, canonicalName: 'Parus major' });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Not available');
  });

  it('formats coordinates as Not available when absent', () => {
    const blocks = gbifGetOccurrence.format!({ key: 1 });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Not available');
  });

  it('renders occurrenceID, class key, gadm, and identifiers in text (#27)', () => {
    const blocks = gbifGetOccurrence.format!({
      key: 5938044864,
      canonicalName: 'Larus argentatus',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      classKey: 212,
      occurrenceID: 'https://www.inaturalist.org/observations/333428940',
      gadm: { level0: { gid: 'SWE', name: 'Sweden' } },
      identifiers: [{ type: 'URL', identifier: '333428940' }],
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Class: Aves (212)');
    expect(text).toContain('https://www.inaturalist.org/observations/333428940');
    expect(text).toContain('Sweden');
    expect(text).toContain('SWE');
    expect(text).toContain('[URL] 333428940');
  });

  it('renders a class key when the class name is absent (#27 content parity)', () => {
    const blocks = gbifGetOccurrence.format!({ key: 1, classKey: 212 });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Class key: 212');
  });

  /**
   * #47, #75 — a fractional occurrenceKey used to pass the bare z.number() and draw
   * an upstream 400 ("For input string: \"1.5\""), which is what an invalid_filter
   * entry existed to explain. The key is a positive integer at the schema now, and
   * every key it admits answers 200 or 404 upstream (live: 0, 1, -5, 2^31, 10^13,
   * and 2^53-1 each 404), so the schema rejects the rest before any request and the
   * contract declares not_found alone.
   */
  it('rejects fractional and non-positive keys at the schema, before any request', async () => {
    for (const occurrenceKey of [1.5, 0, -5]) {
      const result = await runToolContract(gbifGetOccurrence, { occurrenceKey });
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.error).toMatchObject({
        data: { reason: 'invalid_arguments' },
      });
      expect(JSON.stringify(result.content)).toContain('occurrenceKey');
    }
    expect(mockGetOccurrence).not.toHaveBeenCalled();
    expect(gbifGetOccurrence.errors?.map((e) => e.reason)).toEqual(['not_found']);
  });

  it('admits every positive safe integer and advertises the key as one', () => {
    for (const occurrenceKey of [1, 2513888468, Number.MAX_SAFE_INTEGER])
      expect(gbifGetOccurrence.input.safeParse({ occurrenceKey }).success).toBe(true);
    const { properties } = z.toJSONSchema(gbifGetOccurrence.input) as {
      properties: Record<string, unknown>;
    };
    expect(properties.occurrenceKey).toMatchObject({
      type: 'integer',
      exclusiveMinimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    });
  });

  it('answers a positive key GBIF does not hold as not_found', async () => {
    mockGetOccurrence.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'GBIF API returned HTTP 404 Not Found.', {
        status: 404,
      }),
    );

    const result = await runToolContract(gbifGetOccurrence, {
      occurrenceKey: Number.MAX_SAFE_INTEGER,
    });

    expect(result.structuredContent?.error).toMatchObject({ data: { reason: 'not_found' } });
    expect(mockGetOccurrence).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, expect.anything());
  });

  /** #77 — a GID from this record is the value the occurrence tools' gadmGid filter takes. */
  it('names the gadmGid filter on every GADM level GID', () => {
    const gadm = gbifGetOccurrence.output.shape.gadm.unwrap().shape;
    for (const level of [gadm.level0, gadm.level1, gadm.level2, gadm.level3]) {
      const description = level.unwrap().shape.gid.description ?? '';
      expect(description).toContain('gadmGid');
      for (const tool of [
        'gbif_search_occurrences',
        'gbif_count_occurrences',
        'gbif_occurrence_facets',
      ])
        expect(description).toContain(tool);
    }
  });
});

/**
 * #36/#37/#44 — four fields GBIF populates on the occurrence record and this tool
 * dropped. Fixture values are from live records: GADM level3 and eventTime from
 * occurrence 5938104699 (a South African record reaching municipality level).
 */
describe('gbifGetOccurrence newly surfaced record fields', () => {
  const mockGetOccurrence = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getOccurrence: mockGetOccurrence } as never);
  });

  async function fetchRecord(raw: Record<string, unknown>) {
    mockGetOccurrence.mockResolvedValue(raw);
    const ctx = createMockContext({ errors: gbifGetOccurrence.errors });
    return gbifGetOccurrence.handler(
      gbifGetOccurrence.input.parse({ occurrenceKey: raw.key as number }),
      ctx,
    );
  }

  it('surfaces occurrenceStatus, iucnRedListCategory, taxonomicStatus, and eventTime', async () => {
    const result = await fetchRecord({
      key: 5938104699,
      occurrenceStatus: 'PRESENT',
      iucnRedListCategory: 'VU',
      taxonomicStatus: 'ACCEPTED',
      eventDate: '2024-03-11T09:15:50',
      eventTime: '09:15:50+02:00',
    });

    expect(result.occurrenceStatus).toBe('PRESENT');
    expect(result.iucnRedListCategory).toBe('VU');
    expect(result.taxonomicStatus).toBe('ACCEPTED');
    expect(result.eventTime).toBe('09:15:50+02:00');
  });

  /**
   * An ABSENT record documents a survey that looked and found nothing. It arrives
   * with coordinates, a date, and a recorder, so without the status a caller reads
   * it as evidence of the opposite of what it asserts.
   */
  it('marks an absence record as such rather than as a sighting', async () => {
    const result = await fetchRecord({
      key: 6222223951,
      canonicalName: 'Radicipes gracilis',
      occurrenceStatus: 'ABSENT',
      decimalLatitude: 60.1,
      decimalLongitude: 5.3,
      recordedBy: 'MAREANO',
    });

    expect(result.occurrenceStatus).toBe('ABSENT');
    const blocks = gbifGetOccurrence.format!(result);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('ABSENT');
  });

  it('projects GADM level3 and renders it at the end of the chain (#44)', async () => {
    const result = await fetchRecord({
      key: 5938104699,
      gadm: {
        level0: { gid: 'ZAF', name: 'South Africa' },
        level1: { gid: 'ZAF.6_1', name: 'Mpumalanga' },
        level2: { gid: 'ZAF.6.1_1', name: 'Ehlanzeni' },
        level3: { gid: 'ZAF.6.1.1_1', name: 'Bushbuckridge' },
      },
    });

    expect(result.gadm?.level3).toEqual({ gid: 'ZAF.6.1.1_1', name: 'Bushbuckridge' });

    const blocks = gbifGetOccurrence.format!(result);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Bushbuckridge (ZAF.6.1.1_1)');
    expect(text).toMatch(/South Africa.*Bushbuckridge/);
  });

  /**
   * Coverage is region-dependent — Sweden does not subdivide past level2 — so a
   * missing level3 must stay absent rather than surfacing as an empty object.
   */
  it('leaves level3 absent where the country does not subdivide that far', async () => {
    const result = await fetchRecord({
      key: 5938044864,
      gadm: {
        level0: { gid: 'SWE', name: 'Sweden' },
        level1: { gid: 'SWE.2_1', name: 'Norrbotten' },
      },
    });

    expect(result.gadm?.level0).toEqual({ gid: 'SWE', name: 'Sweden' });
    expect(result.gadm?.level3).toBeUndefined();
  });

  /** A GADM object carrying only an empty level3 is not GADM data. */
  it('omits gadm entirely when level3 is the only key and it is empty', async () => {
    const result = await fetchRecord({ key: 303, gadm: { level3: {} } });

    expect(result.gadm).toBeUndefined();
  });

  it('leaves all four fields absent on a sparse record', async () => {
    const result = await fetchRecord({ key: 304 });

    expect(result.occurrenceStatus).toBeUndefined();
    expect(result.iucnRedListCategory).toBeUndefined();
    expect(result.taxonomicStatus).toBeUndefined();
    expect(result.eventTime).toBeUndefined();
  });

  /**
   * eventTime carries the UTC offset eventDate omits, so it has to render even
   * when eventDate already shows a timestamp — the two are not alternatives.
   */
  it('renders the remaining fields in the text surface', () => {
    const blocks = gbifGetOccurrence.format!({
      key: 5938104699,
      canonicalName: 'Panthera leo',
      taxonomicStatus: 'ACCEPTED',
      iucnRedListCategory: 'VU',
      eventDate: '2024-03-11T09:15:50',
      eventTime: '09:15:50+02:00',
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('Taxonomic status:** ACCEPTED');
    expect(text).toContain('IUCN Red List category:** VU');
    expect(text).toContain('2024-03-11T09:15:50');
    expect(text).toContain('09:15:50+02:00');
  });
});

/**
 * #87 — reuse terms, publisher, accepted taxon, and specimen fields. Fixtures are
 * live records: 6490801341 (a specimen filed under the synonym Quercus tristis),
 * 1228618670 (a Field Museum Isolectotype with a credited image), 6158811543
 * (an introduced plant with an elevation), and 6506005834 (a cod record at depth).
 */
describe('gbifGetOccurrence reuse, publisher, accepted taxon, and specimen fields (#87)', () => {
  const mockGetOccurrence = vi.fn();
  const NEW_LABELS = [
    'Accepted taxon',
    'License',
    'Rights holder',
    'Publishing organization',
    'Record number',
    'Elevation',
    'Depth',
    'Type status',
    'Establishment means',
  ];
  const NEW_FIELDS = [
    'license',
    'rightsHolder',
    'publishingOrganizationKey',
    'acceptedTaxonKey',
    'acceptedScientificName',
    'recordNumber',
    'elevation',
    'depth',
    'typeStatus',
    'establishmentMeans',
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getOccurrence: mockGetOccurrence } as never);
  });

  it('returns the accepted taxon of a record filed under a synonym on both surfaces', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 6490801341,
      datasetKey: 'd5ba665a-c07b-4379-85ff-15d7e3a9331a',
      taxonKey: 2879003,
      scientificName: 'Quercus tristis Liebm.',
      acceptedTaxonKey: 2879127,
      acceptedScientificName: 'Quercus castanea Née',
      taxonomicStatus: 'SYNONYM',
      basisOfRecord: 'PRESERVED_SPECIMEN',
      occurrenceStatus: 'DETECTED',
      license: 'http://creativecommons.org/licenses/by-nc/4.0/legalcode',
      publishingOrgKey: '1eb0746b-24c4-40b7-9ed7-3381428e9648',
      recordNumber: 'JL 157',
      recordedBy: 'J. Lupitou; JC. Montoya',
    });

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 6490801341 });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      taxonKey: 2879003,
      acceptedTaxonKey: 2879127,
      acceptedScientificName: 'Quercus castanea Née',
      license: 'http://creativecommons.org/licenses/by-nc/4.0/legalcode',
      publishingOrganizationKey: '1eb0746b-24c4-40b7-9ed7-3381428e9648',
      recordNumber: 'JL 157',
      occurrenceStatus: 'DETECTED',
    });
    expect(wireOf(result)).not.toHaveProperty('publishingOrgKey');
    const text = textOf(result);
    expect(text).toContain('**Taxon key:** 2879003');
    expect(text).toContain('**Accepted taxon:** Quercus castanea Née (key: 2879127)');
    expect(text).toContain('**License:** http://creativecommons.org/licenses/by-nc/4.0/legalcode');
    expect(text).toContain('**Publishing organization key:** 1eb0746b-24c4-40b7-9ed7-3381428e9648');
    expect(text).toContain('**Record number:** JL 157');
  });

  it('carries type status, rights holder, elevation, depth, and establishment means', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 1228618670,
      typeStatus: 'Isolectotype',
      rightsHolder: 'The Field Museum of Natural History',
      establishmentMeans: 'introduced',
      elevation: 96,
      depth: 17.5,
    });

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 1228618670 });

    expect(result.structuredContent).toMatchObject({
      typeStatus: 'Isolectotype',
      rightsHolder: 'The Field Museum of Natural History',
      establishmentMeans: 'introduced',
      elevation: 96,
      depth: 17.5,
    });
    const text = textOf(result);
    expect(text).toContain('**Type status:** Isolectotype');
    expect(text).toContain('**Rights holder:** The Field Museum of Natural History');
    expect(text).toContain('**Establishment means:** introduced');
    expect(text).toContain('**Elevation:** 96 m');
    expect(text).toContain('**Depth:** 17.5 m');
  });

  it('renders an accepted taxon key without a name, and a name without a key', async () => {
    mockGetOccurrence.mockResolvedValue({ key: 1, acceptedTaxonKey: 2879127 });
    const keyOnly = textOf(await runToolContract(gbifGetOccurrence, { occurrenceKey: 1 }));
    expect(keyOnly).toContain('**Accepted taxon key:** 2879127');

    mockGetOccurrence.mockResolvedValue({ key: 2, acceptedScientificName: 'Quercus castanea Née' });
    const nameOnly = await runToolContract(gbifGetOccurrence, { occurrenceKey: 2 });
    expect(wireOf(nameOnly)).not.toHaveProperty('acceptedTaxonKey');
    expect(textOf(nameOnly)).toContain('**Accepted taxon:** Quercus castanea Née\n');
  });

  it('renders none of the ten fields, and no placeholder, on a record carrying none', async () => {
    mockGetOccurrence.mockResolvedValue({ key: 304, taxonKey: 5231190 });

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 304 });

    expect(result.isError).not.toBe(true);
    for (const field of NEW_FIELDS) expect(wireOf(result)).not.toHaveProperty(field);
    const text = textOf(result);
    for (const label of NEW_LABELS) expect(text).not.toContain(label);
  });

  it('renders free text literally in content while structuredContent keeps it as sent', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 5,
      rightsHolder: 'Smith & *Jones*',
      recordNumber: '[x](y) #1',
      acceptedScientificName: 'Quercus_x L.',
    });

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 5 });

    expect(result.structuredContent).toMatchObject({
      rightsHolder: 'Smith & *Jones*',
      recordNumber: '[x](y) #1',
      acceptedScientificName: 'Quercus_x L.',
    });
    const text = textOf(result);
    expect(text).toContain('**Rights holder:** Smith &#38; &#42;Jones&#42;');
    expect(text).toContain('**Record number:** &#91;x&#93;&#40;y&#41; &#35;1');
    expect(text).toContain('**Accepted taxon:** Quercus&#95;x L.');
  });

  it('credits each media item to its rights holder on both surfaces, in source order', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 1228618670,
      media: [
        {
          type: 'StillImage',
          format: 'jpeg',
          identifier: 'http://fm-digital-assets.fieldmuseum.org/56/373/V0060057F.jpg',
          title: 'V0060057F',
          license: '(c) Field Museum of Natural History - CC BY-NC 4.0',
          rightsHolder: 'Field Museum of Natural History',
          creator: 'Field Museum',
        },
        { type: 'Sound', identifier: 'https://static.inaturalist.org/sounds/1785847.wav' },
      ],
    });

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 1228618670 });

    expect(result.structuredContent?.media).toEqual([
      {
        type: 'StillImage',
        format: 'jpeg',
        identifier: 'http://fm-digital-assets.fieldmuseum.org/56/373/V0060057F.jpg',
        title: 'V0060057F',
        license: '(c) Field Museum of Natural History - CC BY-NC 4.0',
        rightsHolder: 'Field Museum of Natural History',
      },
      { type: 'Sound', identifier: 'https://static.inaturalist.org/sounds/1785847.wav' },
    ]);
    const lines = textOf(result).split('\n');
    const first = lines.findIndex((line) => line.includes('V0060057F.jpg'));
    expect(lines[first]).toContain('(rights holder: Field Museum of Natural History)');
    expect(lines[first + 1]).toBe(
      '  - Sound: [https://static.inaturalist.org/sounds/1785847.wav](<https://static.inaturalist.org/sounds/1785847.wav>)',
    );
  });

  it('describes each field in the form it arrives and where it chains', () => {
    const { shape } = gbifGetOccurrence.output;
    expect(shape.license.description).toContain('URL');
    expect(shape.license.description).toContain('CC_BY_NC_4_0');
    expect(shape.publishingOrganizationKey.description).toContain('publishingOrg');
    expect(shape.acceptedScientificName.description).toContain('authorship');
    expect(shape.acceptedTaxonKey.description).toMatch(/backbone/i);
    expect(shape.acceptedTaxonKey.description).toContain('SYNONYM');
    expect(shape.typeStatus.description).toContain('typeStatus filter');
    expect(shape.establishmentMeans.description).toContain('establishmentMeans filter');
    expect(shape.elevation.description).toContain('meters');
    expect(shape.depth.description).toContain('meters');
  });
});

/**
 * #99 — fields that change how a record is read. Fixtures are live records:
 * 5938208610 (an iNaturalist Lynx pardinus whose coordinates were generalized to
 * protect it), 6503038304 (a SEINet Agave specimen carrying 2,203 characters of
 * remarks), and 6506006485 (a DATRAS trawl haul counted by organismQuantity).
 */
describe('gbifGetOccurrence withheld information, references, remarks, and sampling (#99)', () => {
  const mockGetOccurrence = vi.fn();
  const linesOf = (record: Record<string, unknown>) => {
    const blocks = gbifGetOccurrence.format!(record);
    return (blocks[0]?.type === 'text' ? blocks[0].text : '').split('\n');
  };
  const NEW_FIELDS = [
    'informationWithheld',
    'dataGeneralizations',
    'references',
    'occurrenceRemarks',
    'habitat',
    'samplingProtocol',
    'datasetName',
    'organismQuantity',
    'organismQuantityType',
    'dateIdentified',
    'isInCluster',
    'kingdomKey',
    'phylumKey',
    'orderKey',
    'familyKey',
    'genusKey',
    'speciesKey',
  ];
  const NEW_LABELS = [
    'Information withheld',
    'Data generalizations',
    'References',
    'Remarks',
    'Habitat',
    'Sampling protocol',
    'Dataset name',
    'Organism quantity',
    'Date identified',
    'In cluster',
    'Kingdom key',
    'Phylum key',
    'Order key',
    'Family key',
    'Genus key',
    'Species key',
  ];
  const LYNX = {
    key: 5938208610,
    datasetKey: '50c9509d-22c7-4a22-a47d-8c48425ef4a7',
    taxonKey: 2435261,
    scientificName: 'Lynx pardinus (Temminck, 1827)',
    kingdom: 'Animalia',
    kingdomKey: 1,
    phylum: 'Chordata',
    phylumKey: 44,
    class: 'Mammalia',
    classKey: 359,
    order: 'Carnivora',
    orderKey: 732,
    family: 'Felidae',
    familyKey: 9703,
    genus: 'Lynx',
    genusKey: 2435239,
    species: 'Lynx pardinus',
    speciesKey: 2435261,
    decimalLatitude: 38.165988,
    decimalLongitude: -3.946439,
    coordinateUncertaintyInMeters: 28300,
    informationWithheld: 'Coordinate uncertainty increased to 28300m to protect threatened taxon',
    references: 'https://www.inaturalist.org/observations/333328658',
    datasetName: 'iNaturalist research-grade observations',
    dateIdentified: '2026-01-03T19:16:59',
    identifiedBy: 'Franck Curk',
    isInCluster: false,
    occurrenceRemarks:
      'Oligisto, a 9 years old female. Observation conducted with the assistance of the naturalist guide Silvia Medina Vicaria.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getOccurrence: mockGetOccurrence } as never);
  });

  it('returns the withheld-information record on both surfaces', async () => {
    mockGetOccurrence.mockResolvedValue(LYNX);

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 5938208610 });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      informationWithheld: 'Coordinate uncertainty increased to 28300m to protect threatened taxon',
      references: 'https://www.inaturalist.org/observations/333328658',
      datasetName: 'iNaturalist research-grade observations',
      dateIdentified: '2026-01-03T19:16:59',
      isInCluster: false,
      speciesKey: 2435261,
      kingdomKey: 1,
      phylumKey: 44,
      orderKey: 732,
      familyKey: 9703,
      genusKey: 2435239,
    });
    const lines = textOf(result).split('\n');
    expect(lines).toContain(
      '**Information withheld:** Coordinate uncertainty increased to 28300m to protect threatened taxon',
    );
    expect(lines).toContain(
      '**References:** [https://www.inaturalist.org/observations/333328658](<https://www.inaturalist.org/observations/333328658>)',
    );
    expect(lines).toContain('**Dataset name:** iNaturalist research-grade observations');
    expect(lines).toContain('**Date identified:** 2026-01-03T19:16:59');
    expect(lines).toContain('**In cluster:** false');
    expect(lines).toContain(
      '**Remarks:** Oligisto, a 9 years old female. Observation conducted with the assistance of the naturalist guide Silvia Medina Vicaria.',
    );
    expect(lines).toContain(
      '**Taxonomy:** Kingdom: Animalia (1) › Phylum: Chordata (44) › Class: Mammalia (359) › Order: Carnivora (732) › Family: Felidae (9703) › Genus: Lynx (2435239) › Species: Lynx pardinus (2435261)',
    );
  });

  it('renders the withheld information and generalizations beside the coordinates', () => {
    const lines = linesOf({
      ...LYNX,
      dataGeneralizations: 'WGS84 coordinates generalized with formula: round(x, 1)',
    });
    const uncertainty = lines.indexOf('**Coordinate uncertainty:** 28300 m');
    expect(uncertainty).toBeGreaterThan(-1);
    expect(lines[uncertainty + 1]).toBe(
      '**Information withheld:** Coordinate uncertainty increased to 28300m to protect threatened taxon',
    );
    expect(lines[uncertainty + 2]).toBe(
      '**Data generalizations:** WGS84 coordinates generalized with formula: round&#40;x, 1&#41;',
    );
  });

  it('keeps every character of long remarks on both surfaces and links the references', async () => {
    // 2,203 characters, the length of the live record's remarks, ending on punctuation.
    const remarks = `${'Agave Voucher Project.; Clone of ca 16 plants (width of group 2 m); '
      .repeat(40)
      .slice(0, 2202)}.`;
    mockGetOccurrence.mockResolvedValue({
      key: 6503038304,
      occurrenceRemarks: remarks,
      references:
        'https://swbiodiversity.org/seinet/collections/individual/index.php?occid=35160319',
      dateIdentified: '2026-01-01T00:00:00',
    });

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 6503038304 });

    expect(remarks).toHaveLength(2203);
    expect(result.structuredContent?.occurrenceRemarks).toBe(remarks);
    const lines = textOf(result).split('\n');
    expect(lines).toContain(
      `**Remarks:** ${remarks.replaceAll('(', '&#40;').replaceAll(')', '&#41;')}`,
    );
    expect(lines).toContain(
      '**References:** [https://swbiodiversity.org/seinet/collections/individual/index.php?occid=35160319](<https://swbiodiversity.org/seinet/collections/individual/index.php?occid=35160319>)',
    );
    expect(lines).toContain('**Date identified:** 2026-01-01T00:00:00');
  });

  it('renders organism quantity with its type, habitat, and sampling protocol', async () => {
    mockGetOccurrence.mockResolvedValue({
      key: 6506006485,
      organismQuantity: 38,
      organismQuantityType: 'Individuals',
      samplingProtocol: 'GOV Trawl',
      habitat: 'Sandy bottom, 80 m',
      datasetName: 'DATRAS: ICES Database of trawl surveys',
    });

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 6506006485 });

    expect(result.structuredContent).toMatchObject({
      organismQuantity: 38,
      organismQuantityType: 'Individuals',
      samplingProtocol: 'GOV Trawl',
      habitat: 'Sandy bottom, 80 m',
    });
    const lines = textOf(result).split('\n');
    expect(lines).toContain('**Organism quantity:** 38 Individuals');
    expect(lines).toContain('**Sampling protocol:** GOV Trawl');
    expect(lines).toContain('**Habitat:** Sandy bottom, 80 m');
    expect(lines).toContain('**Dataset name:** DATRAS: ICES Database of trawl surveys');
    expect(linesOf({ key: 1, organismQuantity: 0 })).toContain('**Organism quantity:** 0');
    expect(linesOf({ key: 1, organismQuantityType: '% biomass' })).toContain(
      '**Organism quantity type:** % biomass',
    );
  });

  it('renders each rank key beside its name, or alone when the name is absent', () => {
    const lines = linesOf({
      key: 1,
      kingdomKey: 1,
      phylumKey: 44,
      family: 'Felidae',
      familyKey: 9703,
    });
    expect(lines).toContain(
      '**Taxonomy:** Kingdom key: 1 › Phylum key: 44 › Family: Felidae (9703)',
    );
    expect(linesOf({ key: 1, isInCluster: true })).toContain('**In cluster:** true');
  });

  it('renders none of the fields, and no placeholder, on a record carrying none', async () => {
    mockGetOccurrence.mockResolvedValue({ key: 304, taxonKey: 5231190, kingdom: 'Animalia' });

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 304 });

    expect(result.isError).not.toBe(true);
    for (const field of NEW_FIELDS) expect(wireOf(result)).not.toHaveProperty(field);
    const text = textOf(result);
    for (const label of NEW_LABELS) expect(text).not.toContain(label);
    expect(text).toContain('**Taxonomy:** Kingdom: Animalia\n');
  });

  it('renders free text literally in content while structuredContent keeps it as sent', async () => {
    const raw = {
      key: 7,
      informationWithheld: 'Locality <withheld> & *obscured*',
      dataGeneralizations: 'Rounded to 0.1° [see](javascript:x) &amp; more',
      occurrenceRemarks: 'Line one\n# Line two | `code` ~x~ {y} \\z!',
      habitat: '_Pinus_ forest &#64; edge',
      samplingProtocol: 'Trap [A](b)',
      datasetName: 'Survey *2024*',
      organismQuantityType: '% cover <est.>',
      organismQuantity: 5,
      eventTime: 'ca. 9h [night](x) *dusk*',
    };
    mockGetOccurrence.mockResolvedValue(raw);

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 7 });

    const { key: _key, ...sent } = raw;
    expect(result.structuredContent).toMatchObject(sent);
    const lines = textOf(result).split('\n');
    expect(lines).toContain(
      '**Information withheld:** Locality &#60;withheld&#62; &#38; &#42;obscured&#42;',
    );
    expect(lines).toContain(
      '**Data generalizations:** Rounded to 0.1° &#91;see&#93;&#40;javascript:x&#41; &#38;amp; more',
    );
    expect(lines).toContain(
      '**Remarks:** Line one&#10;&#35; Line two &#124; &#96;code&#96; &#126;x&#126; &#123;y&#125; &#92;z&#33;',
    );
    expect(lines).toContain('**Habitat:** &#95;Pinus&#95; forest &#38;&#35;64; edge');
    expect(lines).toContain('**Sampling protocol:** Trap &#91;A&#93;&#40;b&#41;');
    expect(lines).toContain('**Dataset name:** Survey &#42;2024&#42;');
    expect(lines).toContain('**Organism quantity:** 5 % cover &#60;est.&#62;');
    expect(lines).toContain('**Time:** ca. 9h &#91;night&#93;&#40;x&#41; &#42;dusk&#42;');
  });

  /**
   * `references` is a link only when it is an absolute http(s) URL on one line; any
   * other value is escaped text. The full table of hostile values is
   * `linkOrEscapedText`'s, in tests/tools/utils.test.ts; one case per branch here
   * proves the field reaches it.
   */
  it.each([
    {
      references: 'javascript:alert(1)',
      line: '**References:** javascript:alert&#40;1&#41;',
    },
    {
      references: 'https://example.org/a)b c',
      line: '**References:** [https://example.org/a)b c](<https://example.org/a)b c>)',
    },
  ])('renders references $references as one safe link or as text', async ({ references, line }) => {
    mockGetOccurrence.mockResolvedValue({ key: 8, references });

    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: 8 });

    expect(result.structuredContent?.references).toBe(references);
    const lines = textOf(result).split('\n');
    expect(lines).toContain(line);
  });

  it('describes dateIdentified padding, cluster membership, and the record-level names', () => {
    const { shape } = gbifGetOccurrence.output;
    expect(shape.dateIdentified.description).toContain('T00:00:00');
    expect(shape.dateIdentified.description).toContain('-01-01T00:00:00');
    expect(shape.isInCluster.description).toContain('isInCluster filter');
    expect(shape.informationWithheld.description).toContain('withheld');
    expect(shape.dataGeneralizations.description).toContain('informationWithheld');
    expect(shape.datasetName.description).toContain('gbif_get_dataset');
    expect(shape.organismQuantity.description).toContain('organismQuantityType');
    expect(shape.speciesKey.description).toMatch(/backbone/i);
    expect(gbifGetOccurrence.description).not.toContain('complete');
    for (const field of ['informationWithheld', 'dataGeneralizations', 'references', 'isInCluster'])
      expect(gbifGetOccurrence.description).toContain(field);
  });
});

/**
 * Every publisher-supplied string the detail formatter renders goes through
 * `escapeMarkdownText`, so Markdown or character-reference syntax in it renders
 * literally; a value holding none renders byte-identical, and structuredContent
 * keeps each value as sent. The URL-valued fields — occurrenceID, references, each
 * media identifier, each identifiers[].identifier — go through `linkOrEscapedText`
 * instead: an http(s) value is a link to itself, any other value escaped text.
 */
describe('gbifGetOccurrence publisher text in content', () => {
  const mockGetOccurrence = vi.fn();
  const linesOf = async (raw: Record<string, unknown>) => {
    mockGetOccurrence.mockResolvedValue(raw);
    const result = await runToolContract(gbifGetOccurrence, { occurrenceKey: raw.key as number });
    expect(result.isError).not.toBe(true);
    return {
      structured: result.structuredContent,
      lines: (result.content ?? [])
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
        .split('\n'),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getOccurrence: mockGetOccurrence } as never);
  });

  it('renders plain publisher values unchanged', async () => {
    const { lines } = await linesOf({
      key: 9,
      locality: 'Hyde Park',
      stateProvince: 'England',
      country: 'United Kingdom',
      countryCode: 'GB',
      recordedBy: 'J. Smith',
      identifiedBy: 'A. Jones',
      institutionCode: 'RSPB',
      collectionCode: 'obs',
      catalogNumber: 'OBS-001',
      occurrenceID: 'https://www.inaturalist.org/observations/333428940',
      media: [
        {
          type: 'StillImage',
          format: 'image/jpeg',
          title: 'Great Tit photo',
          license: 'http://creativecommons.org/licenses/by/4.0/',
          identifier: 'https://example.com/photo.jpg',
        },
      ],
      identifiers: [{ type: 'URL', identifier: '333428940' }],
    });

    for (const line of [
      '**Location:** Hyde Park, England, United Kingdom (GB)',
      '**Recorded by:** J. Smith',
      '**Identified by:** A. Jones',
      '**Institution:** RSPB',
      '**Collection:** obs',
      '**Catalog number:** OBS-001',
      '**Occurrence ID:** [https://www.inaturalist.org/observations/333428940](<https://www.inaturalist.org/observations/333428940>)',
      '  - StillImage — Great Tit photo (image/jpeg) [http://creativecommons.org/licenses/by/4.0/]: [https://example.com/photo.jpg](<https://example.com/photo.jpg>)',
      '  - [URL] 333428940',
    ])
      expect(lines).toContain(line);
  });

  it('renders Markdown and character-reference syntax literally, keeping values as sent', async () => {
    const raw = {
      key: 10,
      locality: 'Km 5 [road](x) & *ditch*',
      stateProvince: '<Cádiz>',
      country: 'Spain',
      countryCode: 'ES',
      recordedBy: 'Smith_J & *Jones*',
      identifiedBy: '# Doe',
      institutionCode: 'MCZ_*',
      collectionCode: 'Herp|Main',
      catalogNumber: '[x](y) #1',
      occurrenceID: 'urn:x:<1>&#64;',
      media: [
        {
          type: 'StillImage',
          format: 'image/<jpeg>',
          title: 'Plate *1*',
          license: '(c) A & B',
          identifier: 'https://example.org/a_b(1).jpg',
        },
      ],
      identifiers: [{ type: 'URL*', identifier: '[1](2)' }],
    };
    const { structured, lines } = await linesOf(raw);

    const { key: _key, ...sent } = raw;
    expect(structured).toMatchObject(sent);
    for (const line of [
      '**Location:** Km 5 &#91;road&#93;&#40;x&#41; &#38; &#42;ditch&#42;, &#60;Cádiz&#62;, Spain (ES)',
      '**Recorded by:** Smith&#95;J &#38; &#42;Jones&#42;',
      '**Identified by:** &#35; Doe',
      '**Institution:** MCZ&#95;&#42;',
      '**Collection:** Herp&#124;Main',
      '**Catalog number:** &#91;x&#93;&#40;y&#41; &#35;1',
      '**Occurrence ID:** urn:x:&#60;1&#62;&#38;&#35;64;',
      '  - StillImage — Plate &#42;1&#42; (image/&#60;jpeg&#62;) [&#40;c&#41; A &#38; B]: [https://example.org/a_b(1).jpg](<https://example.org/a_b(1).jpg>)',
      '  - [URL&#42;] &#91;1&#93;&#40;2&#41;',
    ])
      expect(lines).toContain(line);
  });

  /**
   * The URL-valued fields: an absolute http(s) value is one link whose destination is
   * the value, `&` and `_` as sent; any other value is escaped text. `linkOrEscapedText`
   * carries the full value table — these cases prove each field reaches it.
   */
  const urlFields = [
    {
      field: 'occurrenceID',
      raw: (value: string) => ({ occurrenceID: value }),
      sent: (structured: Record<string, unknown> | undefined) => structured?.occurrenceID,
      line: (text: string) => `**Occurrence ID:** ${text}`,
    },
    {
      field: 'media identifier',
      raw: (value: string) => ({ media: [{ type: 'StillImage', identifier: value }] }),
      sent: (structured: Record<string, unknown> | undefined) =>
        (structured?.media as { identifier?: string }[] | undefined)?.[0]?.identifier,
      line: (text: string) => `  - StillImage: ${text}`,
    },
    {
      field: 'identifiers[].identifier',
      raw: (value: string) => ({ identifiers: [{ type: 'URL', identifier: value }] }),
      sent: (structured: Record<string, unknown> | undefined) =>
        (structured?.identifiers as { identifier?: string }[] | undefined)?.[0]?.identifier,
      line: (text: string) => `  - [URL] ${text}`,
    },
  ];

  it.each(urlFields)('renders an http(s) $field as one link to the value', async (field) => {
    const url = 'https://example.org/media?id=1&size=large_2';
    const { structured, lines } = await linesOf({ key: 11, ...field.raw(url) });

    expect(field.sent(structured)).toBe(url);
    expect(lines).toContain(
      field.line(
        '[https://example.org/media?id=1&size=large_2](<https://example.org/media?id=1&size=large_2>)',
      ),
    );
  });

  it.each(urlFields)('renders a non-URL $field as escaped text', async (field) => {
    const urn = 'urn:catalog:MCZ:Herp:A-1_2';
    const { structured, lines } = await linesOf({ key: 12, ...field.raw(urn) });

    expect(field.sent(structured)).toBe(urn);
    expect(lines).toContain(field.line('urn:catalog:MCZ:Herp:A-1&#95;2'));
  });
});

/**
 * GBIF serves occurrenceStatus as DETECTED / NOT_DETECTED on every record (the
 * index-wide OCCURRENCE_STATUS facet has no other bucket); PRESENT and ABSENT are
 * the filter vocabulary's older names for the same two concepts.
 */
describe('gbifGetOccurrence occurrenceStatus as GBIF serves it', () => {
  it('names the spelling records carry in the field and tool descriptions', () => {
    const field = gbifGetOccurrence.output.shape.occurrenceStatus.description ?? '';
    for (const text of ['DETECTED', 'NOT_DETECTED', 'PRESENT', 'ABSENT'])
      expect(field).toContain(text);
    expect(gbifGetOccurrence.description).toContain('NOT_DETECTED');
  });
});
