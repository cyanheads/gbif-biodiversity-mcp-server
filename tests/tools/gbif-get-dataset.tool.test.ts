/**
 * @fileoverview Tests for gbif_get_dataset tool.
 * @module tests/tools/gbif-get-dataset.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifGetDataset', () => {
  const mockGetDataset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ getDataset: mockGetDataset } as never);
  });

  it('returns full dataset record', async () => {
    mockGetDataset.mockResolvedValue({
      key: 'abc-def-123',
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
    const input = gbifGetDataset.input.parse({ datasetKey: 'abc-def-123' });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.key).toBe('abc-def-123');
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
    const input = gbifGetDataset.input.parse({ datasetKey: 'nonexistent-uuid' });

    await expect(gbifGetDataset.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('uses numRecords over recordCount', async () => {
    mockGetDataset.mockResolvedValue({
      key: 'abc',
      numRecords: 999,
      recordCount: 111,
    });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: 'abc' });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.recordCount).toBe(999);
  });

  it('omits contacts when empty array', async () => {
    mockGetDataset.mockResolvedValue({
      key: 'xyz',
      contacts: [],
    });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: 'xyz' });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contacts).toBeUndefined();
  });

  it('omits contact email when empty', async () => {
    mockGetDataset.mockResolvedValue({
      key: 'xyz',
      contacts: [{ type: 'METADATA_AUTHOR', firstName: 'Alice', email: [] }],
    });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: 'xyz' });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.contacts![0].email).toBeUndefined();
  });

  it('handles sparse dataset record', async () => {
    mockGetDataset.mockResolvedValue({ key: 'sparse' });

    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const input = gbifGetDataset.input.parse({ datasetKey: 'sparse' });
    const result = await gbifGetDataset.handler(input, ctx);

    expect(result.key).toBe('sparse');
    expect(result.title).toBeUndefined();
    expect(result.citationText).toBeUndefined();
    expect(result.contacts).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      key: 'abc-def-123',
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
    expect(text).toContain('abc-def-123');
    expect(text).toContain('eBird Basic Dataset');
    expect(text).toContain('OCCURRENCE');
    expect(text).toContain('Sullivan et al. 2009');
  });
});
