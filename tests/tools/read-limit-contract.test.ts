/** @fileoverview Read-cap validation and bounded upstream workload contracts. */
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifBulkMatchSpecies } from '@/mcp-server/tools/definitions/gbif-bulk-match-species.tool.js';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';
import { gbifGetSpeciesChildren } from '@/mcp-server/tools/definitions/gbif-get-species-children.tool.js';
import { gbifOccurrenceFacets } from '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';
import { gbifSearchDatasets } from '@/mcp-server/tools/definitions/gbif-search-datasets.tool.js';
import { gbifSearchOccurrences } from '@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js';
import { gbifSearchPublishers } from '@/mcp-server/tools/definitions/gbif-search-publishers.tool.js';
import { gbifSearchSpecies } from '@/mcp-server/tools/definitions/gbif-search-species.tool.js';
import { initGbifService } from '@/services/gbif/gbif-service.js';

const cases = [
  { tool: gbifSearchOccurrences, field: 'limit', cap: 300, input: {} },
  { tool: gbifOccurrenceFacets, field: 'facetLimit', cap: 100, input: { facet: 'COUNTRY' } },
  {
    tool: gbifGetDataset,
    field: 'contactLimit',
    cap: 100,
    input: { datasetKey: '1d743188-1e65-4d99-a814-fa3fd51f1490' },
  },
  ...[gbifSearchSpecies, gbifSearchDatasets, gbifSearchPublishers, gbifGetSpeciesChildren].map(
    (tool) => ({
      tool,
      field: 'limit',
      cap: 1000,
      input: tool === gbifGetSpeciesChildren ? { taxonKey: 1 } : {},
    }),
  ),
];

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  initGbifService(
    { mcpServerName: 'gbif-biodiversity-mcp-server', mcpServerVersion: 'test' } as AppConfig,
    {} as StorageService,
    { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1000 },
  );
});

function fixture(count = 2) {
  const fetch = vi.fn().mockImplementation((address: string) => {
    const url = new URL(address);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const registry = url.pathname.includes('/dataset') || url.pathname.includes('/organization');
    return Promise.resolve(
      new Response(
        JSON.stringify({
          count,
          offset,
          limit,
          endOfRecords: true,
          results:
            offset >= count
              ? []
              : [
                  {
                    key: registry ? '1d743188-1e65-4d99-a814-fa3fd51f1490' : 1,
                    canonicalName: 'Alpha',
                  },
                  {
                    key: registry ? '2d743188-1e65-4d99-a814-fa3fd51f1490' : 2,
                    canonicalName: 'Beta',
                  },
                ],
        }),
      ),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('read limit contract', () => {
  it.each([
    {
      name: 'species',
      run: (limit: number, offset: number) => runToolContract(gbifSearchSpecies, { limit, offset }),
      cap: 1000,
    },
    {
      name: 'datasets',
      run: (limit: number, offset: number) =>
        runToolContract(gbifSearchDatasets, { limit, offset }),
      cap: 1000,
    },
    {
      name: 'publishers',
      run: (limit: number, offset: number) =>
        runToolContract(gbifSearchPublishers, { limit, offset }),
      cap: 1000,
    },
    {
      name: 'children',
      run: (limit: number, offset: number) =>
        runToolContract(gbifGetSpeciesChildren, { taxonKey: 1, limit, offset }),
      cap: 1000,
    },
    {
      name: 'occurrences',
      run: (limit: number, offset: number) =>
        runToolContract(gbifSearchOccurrences, { limit, offset }),
      cap: 300,
    },
  ])('wires $name caps and composes past-end guidance on both surfaces', async ({ run, cap }) => {
    const fetch = fixture();
    const atCap = await run(cap, 0);
    expect(atCap.isError).not.toBe(true);
    expect(atCap.structuredContent?.notice ?? '').not.toContain('requested');
    const clamped = await run(cap + 1, 0);
    expect(clamped.isError).not.toBe(true);
    expect(clamped.structuredContent?.limit).toBe(cap);
    expect(clamped.structuredContent?.notice).toContain(`requested ${cap + 1}; applied ${cap}`);
    expect(JSON.stringify(clamped.content)).toContain(`requested ${cap + 1}; applied ${cap}`);
    const pastEnd = await run(cap + 1, 4);
    expect(pastEnd.isError).not.toBe(true);
    expect(pastEnd.structuredContent?.notice).toContain('Reset offset to 0');
    expect(pastEnd.structuredContent?.notice).toContain('requested');
    for (const [address] of fetch.mock.calls)
      expect(Number(new URL(address).searchParams.get('limit') ?? cap)).toBeLessThanOrEqual(cap);
    fixture(0);
    const empty = await run(cap + 1, 0);
    expect(empty.structuredContent?.notice).toContain('requested');
    expect(JSON.stringify(empty.content)).toContain('requested');
  });
  it('applies occurrence limit before checking the sum and preserves cap recovery', async () => {
    const fetch = fixture();
    const edge = await runToolContract(gbifSearchOccurrences, { limit: 301, offset: 99_701 });
    expect(edge.isError).not.toBe(true);
    expect(edge.structuredContent).toMatchObject({ limit: 300, offset: 99_701 });
    const past = await runToolContract(gbifSearchOccurrences, { limit: 301, offset: 99_702 });
    expect(past.isError).toBe(true);
    expect(past.structuredContent?.error).toMatchObject({
      data: {
        reason: 'pagination_cap_exceeded',
        recovery: { hint: expect.stringContaining('DATASET_KEY') },
      },
    });
    expect(JSON.stringify(past.content)).toContain('DATASET_KEY');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses applied facet size for lookahead, re-slicing and continuation', async () => {
    const fetch = vi.fn().mockImplementation((address: string) => {
      const url = new URL(address);
      expect(url.searchParams.get('facetLimit')).toBe('101');
      const offset = Number(url.searchParams.get('facetOffset'));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            count: 201,
            facets: [
              {
                field: 'COUNTRY',
                counts: Array.from({ length: 201 }, (_, i) => ({
                  name: `Bucket ${i}`,
                  count: 1,
                })).slice(offset, offset + 101),
              },
            ],
          }),
        ),
      );
    });
    vi.stubGlobal('fetch', fetch);
    for (const [offset, length, more] of [
      [0, 100, true],
      [100, 100, true],
      [200, 1, false],
      [300, 0, false],
    ] as const) {
      const result = await runToolContract(gbifOccurrenceFacets, {
        facet: 'COUNTRY',
        facetLimit: 101,
        facetOffset: offset,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.counts).toHaveLength(length);
      expect(result.structuredContent?.truncated).toBe(more ? true : undefined);
      expect(result.structuredContent?.facetLimit).toBe(100);
      expect(result.structuredContent?.notice).toContain('requested 101; applied 100');
      expect(result.structuredContent?.notice).toContain('Absence records');
      if (more) expect(result.structuredContent?.notice).toContain(`facetOffset ${offset + 100}`);
      expect(JSON.stringify(result.content)).toContain('requested 101; applied 100');
    }
  });
  it('keeps contact totals and count-degradation disclosure with the clamp', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((address: string) =>
        Promise.resolve(
          address.includes('/occurrence/count')
            ? new Response('Unavailable', { status: 503 })
            : new Response(
                JSON.stringify({
                  key: '1d743188-1e65-4d99-a814-fa3fd51f1490',
                  contacts: Array.from({ length: 101 }, (_, i) => ({
                    firstName: `Contact ${i}`,
                  })),
                }),
              ),
        ),
      ),
    );
    const result = await runToolContract(gbifGetDataset, {
      datasetKey: '1d743188-1e65-4d99-a814-fa3fd51f1490',
      contactLimit: 101,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      contactsTotal: 101,
      contactsReturned: 100,
      cap: 100,
      recordCountNotice: expect.stringContaining('unavailable'),
    });
    expect(result.structuredContent?.notice).toContain('requested 101; applied 100');
    expect(result.structuredContent?.notice).toContain('Showing 100 of 101');
    expect(JSON.stringify(result.content)).toContain('Showing 100 of 101');
    expect(JSON.stringify(result.content)).toContain('unavailable');
  });
  it('returns the distinct ordered bulk tail, including duplicates, on both surfaces', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ matchType: 'NONE' }))),
      );
    vi.stubGlobal('fetch', fetch);
    const prefix = Array.from({ length: 50 }, (_, i) => `Species ${i}`);
    const tail = [
      'Remainder A',
      'Remainder B',
      'Remainder A',
      '*literal* & <name>',
      '    leading',
      'trailing    ',
      '\ttab',
    ];
    const result = await runToolContract(gbifBulkMatchSpecies, { names: [...prefix, ...tail] });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.results).toEqual(
      prefix.map((name) => ({ name, matchType: 'NONE' })),
    );
    expect(result.structuredContent?.unprocessedNames).toEqual(tail);
    expect(result.structuredContent?.notice).toContain('requested 57; applied 50');
    expect(JSON.stringify(result.content)).toContain('Remainder A');
    expect(JSON.stringify(result.content)).toContain('&#42;literal&#42; &#38; &#60;name&#62;');
    expect(fetch).toHaveBeenCalledTimes(50);
    const invalid = await runToolContract(gbifBulkMatchSpecies, { names: [...prefix, ''] });
    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent?.error).toMatchObject({
      data: { reason: 'invalid_arguments' },
    });
    expect(fetch).toHaveBeenCalledTimes(50);
  });
  it.each(cases)(
    'admits oversized $tool.name requests for bounded processing',
    ({ tool, field, cap, input }) => {
      expect(tool.input.safeParse({ ...input, [field]: cap + 1 }).success).toBe(true);
    },
  );
  it('admits a bulk remainder while still rejecting an invalid tail name', () => {
    const names = Array.from({ length: 51 }, (_, index) => `Species ${index}`);
    expect(gbifBulkMatchSpecies.input.safeParse({ names }).success).toBe(true);
    expect(gbifBulkMatchSpecies.input.safeParse({ names: [...names, ''] }).success).toBe(false);
  });
  it.each(cases)(
    'preserves $tool.name cap, lower bound and numeric type',
    ({ tool, field, cap, input }) => {
      expect(tool.input.safeParse({ ...input, [field]: cap }).success).toBe(true);
      expect(tool.input.safeParse({ ...input, [field]: -1 }).success).toBe(false);
      expect(tool.input.safeParse({ ...input, [field]: String(cap) }).success).toBe(false);
      expect(tool.input.safeParse({ ...input, [field]: 1.5 }).success).toBe(
        field !== 'contactLimit',
      );
    },
  );
  it('preserves duplicate names and omission of an unprocessed remainder at the cap', async () => {
    initGbifService(
      { mcpServerName: 'gbif-biodiversity-mcp-server', mcpServerVersion: 'test' } as AppConfig,
      {} as StorageService,
      { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1000 },
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ matchType: 'NONE' }))),
        ),
    );
    const result = await runToolContract(gbifBulkMatchSpecies, {
      names: Array(50).fill('Panthera leo'),
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.results).toHaveLength(50);
    expect(result.structuredContent?.unprocessedNames).toBeUndefined();
  });
});
