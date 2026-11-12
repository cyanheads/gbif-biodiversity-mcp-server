/** @fileoverview Read-cap validation and bounded upstream workload contracts. */
import { z } from '@cyanheads/mcp-ts-core';
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

/** Fresh definition modules, keyed by tool name, for the tests that change the clamp flag. */
const definitionModules = {
  gbif_search_occurrences: () =>
    import('@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js'),
  gbif_occurrence_facets: () =>
    import('@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js'),
  gbif_get_dataset: () => import('@/mcp-server/tools/definitions/gbif-get-dataset.tool.js'),
  gbif_search_species: () => import('@/mcp-server/tools/definitions/gbif-search-species.tool.js'),
  gbif_search_datasets: () => import('@/mcp-server/tools/definitions/gbif-search-datasets.tool.js'),
  gbif_search_publishers: () =>
    import('@/mcp-server/tools/definitions/gbif-search-publishers.tool.js'),
  gbif_get_species_children: () =>
    import('@/mcp-server/tools/definitions/gbif-get-species-children.tool.js'),
} as const;

async function loadDefinition(name: string): Promise<{ input: z.ZodObject }> {
  const module = await definitionModules[name as keyof typeof definitionModules]();
  const definition = Object.values(module).find((value) => value.name === name);
  if (!definition) throw new Error(`No definition named ${name}`);
  return definition;
}

/** The JSON Schema `tools/list` advertises for one input field. */
function jsonSchemaProperty(input: z.ZodObject, field: string) {
  return (z.toJSONSchema(input) as { properties: Record<string, unknown> }).properties[field];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
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
  /**
   * #84 — the species and dataset ceilings are checked on the limit the clamp
   * applied, so `limit` 1001 one page short of the ceiling is sent as 1,000 and
   * keeps working; one record further fails before any request, the species
   * kingdom/family/genus lookups included.
   */
  it.each([
    {
      name: 'species',
      tool: gbifSearchSpecies,
      ceiling: 100_000,
      filters: { kingdom: 'Plantae', family: 'Fagaceae', genus: 'Quercus' },
    },
    {
      name: 'datasets',
      tool: gbifSearchDatasets,
      ceiling: 125_000,
      filters: { q: 'bird', type: 'CHECKLIST' },
    },
  ])(
    'applies the $name limit before checking the offset ceiling',
    async ({ tool, ceiling, filters }) => {
      const fetch = fixture();
      const edge = await runToolContract(tool, { limit: 1001, offset: ceiling - 1000 } as never);
      expect(edge.isError).not.toBe(true);
      expect(edge.structuredContent).toMatchObject({ limit: 1000, offset: ceiling - 1000 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(new URL(fetch.mock.calls[0][0]).searchParams.get('limit')).toBe('1000');
      const past = await runToolContract(tool, {
        ...filters,
        limit: 1001,
        offset: ceiling - 999,
      } as never);
      expect(past.isError).toBe(true);
      expect(past.structuredContent?.error).toMatchObject({
        data: {
          reason: 'pagination_cap_exceeded',
          recovery: { hint: expect.stringContaining(ceiling.toLocaleString('en-US')) },
        },
      });
      expect(JSON.stringify(past.content)).toContain(
        `offset + limit (${ceiling + 1}) exceeds ${ceiling.toLocaleString('en-US')}`,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
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
  /**
   * #75 — clamping applies to whole numbers only. An over-cap fraction used to
   * clamp to the cap and run; it now fails at the schema like any other fraction,
   * before a request is built.
   */
  it.each(cases)(
    'rejects an over-cap fraction on $tool.name at the schema instead of clamping it',
    async ({ tool, field, cap, input }) => {
      const fetch = fixture();
      const result = await runToolContract(tool, { ...input, [field]: cap + 0.5 } as never);
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.error).toMatchObject({
        data: { reason: 'invalid_arguments' },
      });
      expect(JSON.stringify(result.content)).toContain(field);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('admits a bulk remainder while still rejecting an invalid tail name', () => {
    const names = Array.from({ length: 51 }, (_, index) => `Species ${index}`);
    expect(gbifBulkMatchSpecies.input.safeParse({ names }).success).toBe(true);
    expect(gbifBulkMatchSpecies.input.safeParse({ names: [...names, ''] }).success).toBe(false);
  });
  /**
   * #81 — the remainder returns each entry as submitted, so resubmitting it sends the
   * kingdom an object entry carried rather than matching the bare name.
   */
  it('round-trips an object entry past the bulk cap with its kingdom', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ matchType: 'NONE' }))),
      );
    vi.stubGlobal('fetch', fetch);
    const tail = { name: 'Prunella', kingdom: 'Plantae' };
    const names = [...Array.from({ length: 50 }, (_, i) => `Species ${i}`), tail];

    const result = await runToolContract(gbifBulkMatchSpecies, { names });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.unprocessedNames).toEqual([tail]);
    expect(JSON.stringify(result.content)).toContain('- Prunella (kingdom: Plantae)');
    expect(fetch).toHaveBeenCalledTimes(50);

    const next = await runToolContract(gbifBulkMatchSpecies, {
      names: result.structuredContent?.unprocessedNames as typeof names,
    });

    expect(next.isError).not.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(51);
    const sent = new URL(fetch.mock.calls[50]?.[0] as string);
    expect(sent.pathname).toBe('/v1/species/match');
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      name: 'Prunella',
      strict: 'false',
      kingdom: 'Plantae',
    });
  });
  it.each(cases)(
    'preserves $tool.name cap, lower bound and integer type',
    ({ tool, field, cap, input }) => {
      expect(tool.input.safeParse({ ...input, [field]: cap }).success).toBe(true);
      expect(tool.input.safeParse({ ...input, [field]: -1 }).success).toBe(false);
      expect(tool.input.safeParse({ ...input, [field]: String(cap) }).success).toBe(false);
      expect(tool.input.safeParse({ ...input, [field]: 1.5 }).success).toBe(false);
      expect(jsonSchemaProperty(tool.input, field)).toMatchObject({ type: 'integer' });
    },
  );
  /**
   * `GBIF_CLAMP_READ_LIMITS=false` appends the workload maximum to the schema each
   * tool passes in, so the integer constraint has to survive that path too. The
   * flag is read when a definition module builds its schema, hence the fresh import.
   */
  it.each(cases)(
    'keeps $tool.name integer-only when read-limit clamping is off',
    async ({ tool, field, cap, input }) => {
      vi.stubEnv('GBIF_CLAMP_READ_LIMITS', 'false');
      vi.resetModules();
      const strict = await loadDefinition(tool.name);
      expect(strict.input.safeParse({ ...input, [field]: cap }).success).toBe(true);
      expect(strict.input.safeParse({ ...input, [field]: cap + 1 }).success).toBe(false);
      for (const fraction of [1.5, cap - 0.5, cap + 0.5])
        expect(strict.input.safeParse({ ...input, [field]: fraction }).success).toBe(false);
      expect(jsonSchemaProperty(strict.input, field)).toMatchObject({
        type: 'integer',
        maximum: cap,
      });
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
