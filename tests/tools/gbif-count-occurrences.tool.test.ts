/**
 * @fileoverview Tests for gbif_count_occurrences tool.
 * @module tests/tools/gbif-count-occurrences.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifCountOccurrences } from '@/mcp-server/tools/definitions/gbif-count-occurrences.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifCountOccurrences', () => {
  const mockCountOccurrences = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ countOccurrences: mockCountOccurrences } as never);
  });

  it('returns count for taxon + country filters', async () => {
    mockCountOccurrences.mockResolvedValue(42000);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 5231190, country: 'GB' });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(42000);
    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ taxonKey: 5231190, country: 'GB' }),
      ctx,
    );
  });

  it('returns count with no filters', async () => {
    mockCountOccurrences.mockResolvedValue(2400000000);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({});
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(2400000000);
  });

  it('returns zero count', async () => {
    mockCountOccurrences.mockResolvedValue(0);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 9999999 });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(0);
  });

  it('passes isGeoreferenced filter', async () => {
    mockCountOccurrences.mockResolvedValue(1000);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ isGeoreferenced: true });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ isGeoreferenced: true }),
      ctx,
    );
  });

  it('passes datasetKey and year filters', async () => {
    mockCountOccurrences.mockResolvedValue(500);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({
      datasetKey: 'abc-def-123',
      year: '2020,2024',
    });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ datasetKey: 'abc-def-123', year: '2020,2024' }),
      ctx,
    );
  });

  it('formats count as text', () => {
    const blocks = gbifCountOccurrences.format!({ count: 42000 });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('42000');
  });
});
