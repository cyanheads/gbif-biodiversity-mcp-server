/**
 * @fileoverview Tests for gbif_get_dataset tool.
 * @module tests/tools/gbif-get-dataset.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** EOD – eBird Observation Dataset. */
const EBIRD_KEY = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e';
/** iNaturalist Research-grade Observations. */
const INAT_KEY = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
/** Well-formed UUID GBIF has never allocated. */
const MISSING_KEY = '00000000-0000-0000-0000-000000000000';
/** Visuelle undersøkelser - petroleumsvirksomhet — a SAMPLING_EVENT dataset, 99.8% absences. */
const ABSENCE_HEAVY_KEY = 'b6b4502f-ffc8-4048-a91b-af502288faa8';

/** Build N synthetic dataset contacts mirroring GBIF's flat contact shape. */
function makeContacts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'ADMINISTRATIVE_POINT_OF_CONTACT',
    firstName: `First${i}`,
    lastName: `Last${i}`,
    organization: 'Cornell Lab of Ornithology',
    email: [`contact${i}@example.org`],
  }));
}

describe('gbifGetDataset', () => {
  const mockGetDataset = vi.fn();
  const mockCount = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCount.mockResolvedValue(undefined);
    vi.mocked(getGbifService).mockReturnValue({
      getDataset: mockGetDataset,
      getDatasetOccurrenceCount: mockCount,
    } as never);
  });

  it('returns full dataset record', async () => {
    mockGetDataset.mockResolvedValue({
      key: EBIRD_KEY,
      title: 'eBird Basic Dataset',
      type: 'OCCURRENCE',
      description: 'Cornell Lab of Ornithology eBird checklist data.',
      license: 'CC_BY_NC_4_0',
      doi: '10.15468/aomfnb',
      citation: { text: 'Sullivan et al. 2009. eBird. Cornell Lab Ornithology.' },
      publishingCountry: 'US',
      numRecords: 1500000000,
      numConstituents: 0,
      contacts: [
        {
          type: 'ADMINISTRATIVE_POINT_OF_CONTACT',
          firstName: 'Brian',
          lastName: 'Sullivan',
          organization: 'Cornell Lab of Ornithology',
          email: ['bls63@cornell.edu'],
        },
      ],
    });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: EBIRD_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.key).toBe(EBIRD_KEY);
    expect(result.title).toBe('eBird Basic Dataset');
    expect(result.type).toBe('OCCURRENCE');
    expect(result.license).toBe('CC_BY_NC_4_0');
    expect(result.doi).toBe('10.15468/aomfnb');
    expect(result.citationText).toBe('Sullivan et al. 2009. eBird. Cornell Lab Ornithology.');
    expect(result.publishingCountry).toBe('US');
    expect(result.recordCount).toBe(1500000000);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts![0].firstName).toBe('Brian');
    expect(result.contacts![0].email).toEqual(['bls63@cornell.edu']);
  });

  /**
   * Pins the whole record as it stands before the publishing-organization key
   * arrives: a detail record without it must project to exactly these fields.
   */
  it('projects a record without a publishing-organization key to exactly the existing fields', async () => {
    mockGetDataset.mockResolvedValue({
      key: EBIRD_KEY,
      title: 'eBird Basic Dataset',
      type: 'OCCURRENCE',
      license: 'CC_BY_NC_4_0',
      doi: '10.15468/aomfnb',
      citation: { text: 'Sullivan et al. 2009.' },
      publishingCountry: 'US',
      numRecords: 42,
      numConstituents: 0,
    });

    const result = await runToolContract(gbifGetDataset, { datasetKey: EBIRD_KEY });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      key: EBIRD_KEY,
      title: 'eBird Basic Dataset',
      type: 'OCCURRENCE',
      license: 'CC_BY_NC_4_0',
      doi: '10.15468/aomfnb',
      citationText: 'Sullivan et al. 2009.',
      publishingCountry: 'US',
      recordCount: 42,
      numConstituents: 0,
    });
    expect(JSON.stringify(result.content)).not.toContain('Publishing organization');
  });

  /**
   * #79 — `/dataset/{key}` names the publishing organization by key only (no
   * title), and that key is what gbif_search_datasets takes as publishingOrg.
   */
  it('returns the publishing organization key on both surfaces', async () => {
    mockGetDataset.mockResolvedValue({
      key: INAT_KEY,
      title: 'iNaturalist Research-grade Observations',
      publishingOrganizationKey: '28eb1a3f-1c15-4a95-931a-4af90ecb574d',
      numRecords: 1,
    });

    const result = await runToolContract(gbifGetDataset, { datasetKey: INAT_KEY });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      key: INAT_KEY,
      title: 'iNaturalist Research-grade Observations',
      publishingOrganizationKey: '28eb1a3f-1c15-4a95-931a-4af90ecb574d',
      recordCount: 1,
    });
    expect(result.structuredContent?.publishingOrganizationTitle).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain(
      '**Publishing organization key:** 28eb1a3f-1c15-4a95-931a-4af90ecb574d',
    );
  });

  it('names the publishingOrg chain on the publishing organization key description', () => {
    const description = gbifGetDataset.output.shape.publishingOrganizationKey.description ?? '';

    expect(description).toContain('publishingOrg');
    expect(description).toContain('gbif_search_datasets');
  });

  it('throws not_found when key is missing', async () => {
    mockGetDataset.mockResolvedValue({ key: undefined });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: MISSING_KEY });

    await expect(gbifGetDataset.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('uses numRecords over recordCount', async () => {
    mockGetDataset.mockResolvedValue({
      key: INAT_KEY,
      numRecords: 999,
      recordCount: 111,
    });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.recordCount).toBe(999);
    expect(mockCount).not.toHaveBeenCalled();
  });

  /**
   * #40 — /dataset/{key} supplies neither field on any dataset, so the figure comes
   * from the indexed occurrence count instead of leaving a detail lookup reporting
   * less than gbif_search_datasets does.
   */
  it('fills recordCount from the occurrence count when the detail record omits it', async () => {
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, type: 'OCCURRENCE' });
    mockCount.mockResolvedValue(1775781186);

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: EBIRD_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(mockCount).toHaveBeenCalledWith(EBIRD_KEY, ctx);
    expect(result.recordCount).toBe(1775781186);
  });

  it('leaves recordCount absent when the occurrence count is unavailable', async () => {
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, type: 'OCCURRENCE' });
    mockCount.mockResolvedValue(undefined);

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: EBIRD_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.key).toBe(EBIRD_KEY);
    expect(result.recordCount).toBeUndefined();
  });

  /**
   * #48 — `/dataset/search` reports a recordCount for every dataset type, and the
   * absence-heavy dataset the report is written against is a SAMPLING_EVENT. Gating
   * the lookup on OCCURRENCE left the detail surfaces silent on exactly the datasets
   * the list surface counts, contradicting their claim to match it.
   */
  it('resolves recordCount for a non-OCCURRENCE dataset', async () => {
    mockGetDataset.mockResolvedValue({ key: ABSENCE_HEAVY_KEY, type: 'SAMPLING_EVENT' });
    mockCount.mockResolvedValue(30622351);

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: ABSENCE_HEAVY_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(mockCount).toHaveBeenCalledWith(ABSENCE_HEAVY_KEY, ctx);
    expect(result.recordCount).toBe(30622351);
  });

  it('resolves recordCount for a CHECKLIST dataset, which indexes no occurrences', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY, type: 'CHECKLIST' });
    mockCount.mockResolvedValue(0);

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(mockCount).toHaveBeenCalledWith(INAT_KEY, ctx);
    expect(result.recordCount).toBe(0);
  });

  /**
   * #48 — recordCount spans every occurrenceStatus while gbif_count_occurrences
   * defaults to PRESENT, so the field has to name its own scope and the tool that
   * answers the other question. Without both, a 499x gap reads as a data error.
   */
  it('scopes the recordCount description and names the presence-scoped tool', () => {
    const description = gbifGetDataset.output.shape.recordCount.description ?? '';

    expect(description).toContain('occurrenceStatus');
    expect(description).toContain('absence records');
    expect(description).toContain('gbif_count_occurrences');
  });

  it('renders the recordCount scope in content, which carries no output schema', () => {
    const blocks = gbifGetDataset.format!({
      key: ABSENCE_HEAVY_KEY,
      title: 'Visuelle undersøkelser',
      recordCount: 30622351,
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toContain('30,622,351');
    expect(text).toContain('absences included');
    expect(text).toContain('gbif_count_occurrences');
  });

  /** #38 — a malformed key fails locally with guidance, not as a bare upstream 400. */
  it('rejects a non-UUID datasetKey without issuing a request', async () => {
    const result = await runToolContract(gbifGetDataset, { datasetKey: 'not-a-uuid' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        data: {
          reason: 'invalid_filter',
          recovery: {
            hint: "Supply the 8-4-4-4-12 hex UUID exactly as gbif_search_datasets returns it, or as it appears in an occurrence record's datasetKey field — a dataset title or DOI is not a key.",
          },
        },
      },
    });
    expect(mockGetDataset).not.toHaveBeenCalled();
  });

  it('omits contacts when empty array', async () => {
    mockGetDataset.mockResolvedValue({
      key: INAT_KEY,
      contacts: [],
    });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contacts).toBeUndefined();
  });

  it('omits contact email when empty', async () => {
    mockGetDataset.mockResolvedValue({
      key: INAT_KEY,
      contacts: [{ type: 'METADATA_AUTHOR', firstName: 'Alice', email: [] }],
    });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contacts![0].email).toBeUndefined();
  });

  it('caps contacts at the default contactLimit and reports full counts', async () => {
    // eBird returns 42 contacts; the default cap of 10 keeps the response compact.
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, contacts: makeContacts(42) });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: EBIRD_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contacts).toHaveLength(10);
    expect(result.contactsTotal).toBe(42);
    expect(result.contactsReturned).toBe(10);
    expect(result.contacts![0].firstName).toBe('First0');
    expect(result.contacts![9].firstName).toBe('First9');
  });

  it('honors an explicit contactLimit', async () => {
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, contacts: makeContacts(42) });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: EBIRD_KEY, contactLimit: 3 });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contacts).toHaveLength(3);
    expect(result.contactsTotal).toBe(42);
    expect(result.contactsReturned).toBe(3);
  });

  it('suppresses contact detail when contactLimit is 0 but preserves the count', async () => {
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, contacts: makeContacts(42) });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: EBIRD_KEY, contactLimit: 0 });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contacts).toBeUndefined();
    expect(result.contactsTotal).toBe(42);
    expect(result.contactsReturned).toBe(0);
  });

  it('returns every contact when contactLimit exceeds the total', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY, contacts: makeContacts(4) });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY, contactLimit: 100 });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contacts).toHaveLength(4);
    expect(result.contactsTotal).toBe(4);
    expect(result.contactsReturned).toBe(4);
  });

  it('omits contact counts when the dataset has no contacts', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY, contacts: [] });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contacts).toBeUndefined();
    expect(result.contactsTotal).toBeUndefined();
    expect(result.contactsReturned).toBeUndefined();
  });

  it('discloses contact truncation in enrichment when the cap holds contacts back', async () => {
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, contacts: makeContacts(42) });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: EBIRD_KEY });
    await gbifGetDataset.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.truncated).toBe(true);
    expect(enrichment.shown).toBe(10);
    expect(enrichment.cap).toBe(10);
    expect(enrichment.notice).toContain('Showing 10 of 42 dataset contacts');
  });

  it('discloses truncation when contactLimit is 0 but the dataset has contacts', async () => {
    // The caller suppressed contact detail; the fact that 42 exist is still news.
    mockGetDataset.mockResolvedValue({ key: EBIRD_KEY, contacts: makeContacts(42) });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: EBIRD_KEY, contactLimit: 0 });
    await gbifGetDataset.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.truncated).toBe(true);
    expect(enrichment.shown).toBe(0);
    expect(enrichment.cap).toBe(0);
  });

  it('discloses no truncation when the contact count exactly meets the cap', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY, contacts: makeContacts(10) });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY, contactLimit: 10 });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contactsReturned).toBe(10);
    expect(result.contactsTotal).toBe(10);
    // Every contact came back — a full list is not a capped one.
    expect(getEnrichment(ctx).truncated).toBeUndefined();
  });

  it('discloses no truncation when the dataset has no contacts', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY, contacts: [] });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY });
    await gbifGetDataset.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.truncated).toBeUndefined();
    expect(enrichment.shown).toBeUndefined();
    expect(enrichment.cap).toBeUndefined();
  });

  it('formats the contact count summary', () => {
    const blocks = gbifGetDataset.format!({
      key: EBIRD_KEY,
      title: 'eBird',
      contactsTotal: 42,
      contactsReturned: 10,
      contacts: makeContacts(10),
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('10 of 42');
  });

  it('handles sparse dataset record', async () => {
    mockGetDataset.mockResolvedValue({ key: INAT_KEY });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.key).toBe(INAT_KEY);
    expect(result.title).toBeUndefined();
    expect(result.citationText).toBeUndefined();
    expect(result.contacts).toBeUndefined();
    expect(result.temporalCoverages).toBeUndefined();
    expect(result.geographicCoverages).toBeUndefined();
  });

  it('exposes temporal and geographic coverage (#28)', async () => {
    mockGetDataset.mockResolvedValue({
      key: EBIRD_KEY,
      temporalCoverages: [
        { start: '1800-01-01T00:00:00.000+00:00', end: '2024-12-31T00:00:00.000+00:00' },
      ],
      geographicCoverages: [{ description: 'Worldwide' }],
    });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({
      datasetKey: EBIRD_KEY,
    });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.temporalCoverages).toEqual([
      { start: '1800-01-01T00:00:00.000+00:00', end: '2024-12-31T00:00:00.000+00:00' },
    ]);
    expect(result.geographicCoverages).toEqual([{ description: 'Worldwide' }]);
  });

  it('drops coverage entries that carry no bound or description', async () => {
    // A temporal entry with no usable date and a geographic entry with neither a
    // description nor a bounding box project to nothing and are omitted.
    mockGetDataset.mockResolvedValue({
      key: INAT_KEY,
      temporalCoverages: [{}],
      geographicCoverages: [{}],
    });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: INAT_KEY });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.temporalCoverages).toBeUndefined();
    expect(result.geographicCoverages).toBeUndefined();
  });

  it('formats coverage ranges and descriptions', () => {
    const blocks = gbifGetDataset.format!({
      key: EBIRD_KEY,
      title: 'eBird',
      temporalCoverages: [{ start: '1800-01-01', end: '2024-12-31' }],
      geographicCoverages: [{ description: 'Worldwide' }],
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('1800-01-01');
    expect(text).toContain('2024-12-31');
    expect(text).toContain('Worldwide');
    expect(text.split('\n')).toContain('**Geographic coverage:** Worldwide');
  });

  /**
   * #95 — fixtures are live /v1/dataset records: 59f27a74 (deleted 2026-11-10),
   * 50c9509d (iNaturalist, a box beside the description "Bounding Box"), and
   * eb974f54 (a box with no description).
   */
  describe('deleted datasets and coverage bounding boxes (#95)', () => {
    const DELETED_KEY = '59f27a74-b861-4e34-a2d8-a50b75a83caa';
    const BOX_ONLY_KEY = 'eb974f54-0a3c-496a-85ac-703b9c63e55a';
    const DELETED = '2026-11-10T20:11:45.006+00:00';
    const INAT_BOX = {
      minLatitude: -87.80586803331971,
      maxLatitude: 89.98972198460251,
      minLongitude: 0,
      maxLongitude: -1.6763806343078613e-7,
      globalCoverage: false,
    };
    const AIRDNA_BOX = {
      minLatitude: 56.8336111111,
      maxLatitude: 56.8347222222,
      minLongitude: 10.2477777778,
      maxLongitude: 10.2516666667,
      globalCoverage: false,
    };
    const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
      (result.content ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('\n');

    it('returns deleted on both surfaces, on the line under the title', async () => {
      mockGetDataset.mockResolvedValue({
        key: DELETED_KEY,
        title: 'UCarpHT vegetation data',
        type: 'OCCURRENCE',
        deleted: DELETED,
      });
      mockCount.mockResolvedValue(0);

      const result = await runToolContract(gbifGetDataset, { datasetKey: DELETED_KEY });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ deleted: DELETED, recordCount: 0 });
      const lines = textOf(result).split('\n');
      expect(lines[0]).toBe('## UCarpHT vegetation data');
      expect(lines[1]).toBe(
        '**Deleted:** 2026-11-10T20:11:45.006+00:00 — no longer published or searchable; GBIF indexes none of its occurrences.',
      );
    });

    it('returns neither the field nor the line for a published dataset', async () => {
      mockGetDataset.mockResolvedValue({ key: INAT_KEY, title: 'iNaturalist', numRecords: 1 });

      const result = await runToolContract(gbifGetDataset, { datasetKey: INAT_KEY });

      expect(JSON.parse(JSON.stringify(result.structuredContent))).not.toHaveProperty('deleted');
      const text = textOf(result);
      expect(text).not.toContain('Deleted');
      expect(text).not.toContain('no longer published');
    });

    it('says what deletion means in the field description', () => {
      const description = gbifGetDataset.output.shape.deleted.description ?? '';
      for (const phrase of ['no longer published', 'searchable', 'indexes none', 'Absent'])
        expect(description).toContain(phrase);
    });

    it('returns a box beside its description, and a box alone, on both surfaces', async () => {
      mockGetDataset.mockResolvedValue({
        key: INAT_KEY,
        title: 'iNaturalist Research-grade Observations',
        numRecords: 1,
        geographicCoverages: [{ description: 'Bounding Box', boundingBox: INAT_BOX }],
      });
      const described = await runToolContract(gbifGetDataset, { datasetKey: INAT_KEY });
      expect(described.structuredContent?.geographicCoverages).toEqual([
        { description: 'Bounding Box', boundingBox: INAT_BOX },
      ]);
      expect(textOf(described).split('\n')).toContain(
        '**Geographic coverage:** Bounding Box — bounding box in decimal degrees (minLatitude: -87.80586803331971, maxLatitude: 89.98972198460251, minLongitude: 0, maxLongitude: -1.6763806343078613e-7, globalCoverage: false)',
      );

      mockGetDataset.mockResolvedValue({
        key: BOX_ONLY_KEY,
        title: 'Advancing airDNA Experiment 3 BirT',
        numRecords: 1,
        geographicCoverages: [{ boundingBox: AIRDNA_BOX }],
      });
      const boxOnly = await runToolContract(gbifGetDataset, { datasetKey: BOX_ONLY_KEY });
      expect(boxOnly.structuredContent?.geographicCoverages).toEqual([{ boundingBox: AIRDNA_BOX }]);
      expect(textOf(boxOnly).split('\n')).toContain(
        '**Geographic coverage:** bounding box in decimal degrees (minLatitude: 56.8336111111, maxLatitude: 56.8347222222, minLongitude: 10.2477777778, maxLongitude: 10.2516666667, globalCoverage: false)',
      );
    });

    it('describes a box crossing the antimeridian as sent', () => {
      const description =
        gbifGetDataset.output.shape.geographicCoverages.unwrap().element.shape.boundingBox
          .description ?? '';
      expect(description).toContain('antimeridian');
      expect(description).toContain('minLongitude');
    });
  });

  it('formats output with key fields', () => {
    const output = {
      key: EBIRD_KEY,
      title: 'eBird Basic Dataset',
      type: 'OCCURRENCE',
      license: 'CC_BY_NC_4_0',
      doi: '10.15468/aomfnb',
      publishingCountry: 'US',
      recordCount: 1500000000,
      citationText: 'Sullivan et al. 2009. eBird.',
    };
    const blocks = gbifGetDataset.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain(EBIRD_KEY);
    expect(text).toContain('eBird Basic Dataset');
    expect(text).toContain('OCCURRENCE');
    expect(text).toContain('Sullivan et al. 2009');
  });
});
