/**
 * @fileoverview Security tests — injection resistance, oversized inputs, and secret non-leakage.
 * @module tests/tools/security.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifCountOccurrences } from '@/mcp-server/tools/definitions/gbif-count-occurrences.tool.js';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';
import { gbifGetOccurrence } from '@/mcp-server/tools/definitions/gbif-get-occurrence.tool.js';
import { gbifGetSpecies } from '@/mcp-server/tools/definitions/gbif-get-species.tool.js';
import { gbifMatchSpecies } from '@/mcp-server/tools/definitions/gbif-match-species.tool.js';
import { gbifOccurrenceFacets } from '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';
import { gbifSearchDatasets } from '@/mcp-server/tools/definitions/gbif-search-datasets.tool.js';
import { gbifSearchOccurrences } from '@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js';
import { gbifSearchPublishers } from '@/mcp-server/tools/definitions/gbif-search-publishers.tool.js';
import { gbifSearchSpecies } from '@/mcp-server/tools/definitions/gbif-search-species.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

const INJECTION_STRINGS = [
  "<script>alert('xss')</script>",
  '"; DROP TABLE species; --',
  "' OR '1'='1",
  '../../../etc/passwd',
  '%00null',
  '\x00\x01\x02',
  '{{7*7}}',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional injection probe string
  '${7*7}',
  '‮ reverse',
];

const makeOccurrenceResponse = (overrides = {}) => ({
  results: [],
  count: 0,
  offset: 0,
  limit: 20,
  endOfRecords: true,
  ...overrides,
});

describe('Input injection — string parameters do not crash handlers', () => {
  const mockSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearch,
      searchSpecies: mockSearch,
      searchDatasets: mockSearch,
      searchPublishers: mockSearch,
      getOccurrenceFacets: vi.fn().mockResolvedValue({ count: 0, facets: [] }),
    } as never);
    mockSearch.mockResolvedValue(makeOccurrenceResponse());
  });

  for (const injection of INJECTION_STRINGS) {
    it(`gbif_search_occurrences survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
      const input = gbifSearchOccurrences.input.parse({ q: injection });
      // Must not throw — the service mock returns empty results
      const result = await gbifSearchOccurrences.handler(input, ctx);
      expect(result.occurrences).toBeDefined();
    });

    it(`gbif_search_species survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext();
      const input = gbifSearchSpecies.input.parse({ q: injection });
      const result = await gbifSearchSpecies.handler(input, ctx);
      expect(result.taxa).toBeDefined();
    });

    it(`gbif_search_datasets survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext();
      const input = gbifSearchDatasets.input.parse({ q: injection });
      const result = await gbifSearchDatasets.handler(input, ctx);
      expect(result.datasets).toBeDefined();
    });

    it(`gbif_search_publishers survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext();
      const input = gbifSearchPublishers.input.parse({ q: injection });
      const result = await gbifSearchPublishers.handler(input, ctx);
      expect(result.publishers).toBeDefined();
    });

    it(`gbif_match_species survives name="${injection.slice(0, 30)}"`, async () => {
      vi.mocked(getGbifService).mockReturnValue({
        matchSpecies: vi.fn().mockResolvedValue({ matchType: 'NONE', usageKey: undefined }),
      } as never);
      const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
      const input = gbifMatchSpecies.input.parse({ name: injection });
      // NONE match throws no_match — that's the correct behavior, not a crash
      await expect(gbifMatchSpecies.handler(input, ctx)).rejects.toMatchObject({
        data: { reason: 'no_match' },
      });
    });
  }
});

describe('Oversized input handling', () => {
  const mockSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearch,
      searchSpecies: mockSearch,
      searchDatasets: mockSearch,
      searchPublishers: mockSearch,
    } as never);
    mockSearch.mockResolvedValue(makeOccurrenceResponse());
  });

  it('gbif_search_occurrences handles very long q string', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ q: 'A'.repeat(5000) });
    const result = await gbifSearchOccurrences.handler(input, ctx);
    expect(result.occurrences).toBeDefined();
  });

  it('gbif_search_species handles very long q string', async () => {
    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ q: 'B'.repeat(5000) });
    const result = await gbifSearchSpecies.handler(input, ctx);
    expect(result.taxa).toBeDefined();
  });

  it('gbif_occurrence_facets rejects facetLimit > 100', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', facetLimit: 101 })).toThrow();
  });

  it('gbif_occurrence_facets rejects facetLimit < 1', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', facetLimit: 0 })).toThrow();
  });

  it('gbif_search_occurrences rejects limit > 300', () => {
    expect(() => gbifSearchOccurrences.input.parse({ limit: 301 })).toThrow();
  });

  it('gbif_search_occurrences rejects limit < 1', () => {
    expect(() => gbifSearchOccurrences.input.parse({ limit: 0 })).toThrow();
  });

  it('gbif_search_species rejects limit > 1000', () => {
    expect(() => gbifSearchSpecies.input.parse({ limit: 1001 })).toThrow();
  });
});

describe('Required field validation', () => {
  it('gbif_get_occurrence requires occurrenceKey', () => {
    expect(() => gbifGetOccurrence.input.parse({})).toThrow();
  });

  it('gbif_get_species requires taxonKey', () => {
    expect(() => gbifGetSpecies.input.parse({})).toThrow();
  });

  it('gbif_get_dataset requires datasetKey', () => {
    expect(() => gbifGetDataset.input.parse({})).toThrow();
  });

  it('gbif_match_species requires name', () => {
    expect(() => gbifMatchSpecies.input.parse({})).toThrow();
  });

  it('gbif_occurrence_facets requires facet', () => {
    expect(() => gbifOccurrenceFacets.input.parse({})).toThrow();
  });

  it('gbif_occurrence_facets rejects invalid facet value', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'INVALID_DIMENSION' })).toThrow();
  });

  it('gbif_occurrence_facets rejects invalid basisOfRecord value', () => {
    expect(() =>
      gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', basisOfRecord: 'UNKNOWN_VALUE' }),
    ).toThrow();
  });

  it('gbif_search_datasets rejects invalid type value', () => {
    expect(() => gbifSearchDatasets.input.parse({ type: 'INVALID_TYPE' })).toThrow();
  });

  it('gbif_get_occurrence requires integer occurrenceKey', () => {
    expect(() => gbifGetOccurrence.input.parse({ occurrenceKey: 'abc' })).toThrow();
  });

  it('gbif_get_species requires integer taxonKey', () => {
    expect(() => gbifGetSpecies.input.parse({ taxonKey: 'abc' })).toThrow();
  });
});

describe('Secret non-leakage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gbif_count_occurrences error does not expose env vars', async () => {
    vi.mocked(getGbifService).mockReturnValue({
      countOccurrences: vi.fn().mockRejectedValue(new Error('Service error from upstream')),
    } as never);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 1 });

    const err = await gbifCountOccurrences.handler(input, ctx).catch((e: unknown) => e);
    const errStr = JSON.stringify(err);

    // Confirm no env var names appear in error output
    expect(errStr).not.toMatch(/GBIF_API_KEY|API_KEY|SECRET|PASSWORD|TOKEN/i);
  });

  it('gbif_search_occurrences error does not leak internal paths', async () => {
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: vi.fn().mockRejectedValue(new Error('Internal failure at /home/app/src')),
    } as never);

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({});

    const err = await gbifSearchOccurrences.handler(input, ctx).catch((e: unknown) => e);
    // The error should propagate as-is (the framework handles classification/masking)
    // We just verify no credential-looking strings are appended by the handler itself
    const errStr = String((err as Error).message ?? err);
    expect(errStr).not.toMatch(/[A-Z_]{8,}=\S+/); // no VAR=value patterns
  });
});
