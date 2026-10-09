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
    // GBIF also emits verbatim/single-date temporal shapes and boundingBox-only geographic
    // entries; without a start/end or description they project to nothing and are omitted.
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
