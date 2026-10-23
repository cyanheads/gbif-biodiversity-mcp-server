/**
 * @fileoverview Occurrence workflow contracts through the real GBIF transport.
 * @module tests/tools/occurrence-workflow.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifCountOccurrences } from '@/mcp-server/tools/definitions/gbif-count-occurrences.tool.js';
import { gbifGetOccurrence } from '@/mcp-server/tools/definitions/gbif-get-occurrence.tool.js';
import { gbifGetSpeciesChildren } from '@/mcp-server/tools/definitions/gbif-get-species-children.tool.js';
import { gbifOccurrenceFacets } from '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';
import { gbifSearchOccurrences } from '@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js';
import { initGbifService } from '@/services/gbif/gbif-service.js';

const calls = [
  {
    name: 'search',
    controls: { limit: 3, offset: 2 },
    run: (args: Record<string, unknown>) => runToolContract(gbifSearchOccurrences, args),
  },
  {
    name: 'count',
    controls: {},
    run: (args: Record<string, unknown>) => runToolContract(gbifCountOccurrences, args),
  },
  {
    name: 'facets',
    controls: { facetLimit: 2, facetOffset: 1 },
    run: (args: Record<string, unknown>) =>
      runToolContract(gbifOccurrenceFacets, { facet: 'BASIS_OF_RECORD', ...args }),
  },
];
let requests: URL[];
let bodies: unknown[];

beforeEach(() => {
  requests = [];
  bodies = [];
  initGbifService(
    { mcpServerName: 'gbif-biodiversity-mcp-server', mcpServerVersion: 'test' } as AppConfig,
    {} as StorageService,
    { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1000 },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(new URL(url));
      if (!bodies.length) return new Response('Unexpected request', { status: 400 });
      return new Response(JSON.stringify(bodies.shift()));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function population() {
  bodies.push({
    count: 31,
    results: [],
    facets: [{ field: 'BASIS_OF_RECORD', counts: [{ name: 'HUMAN_OBSERVATION', count: 31 }] }],
  });
}

describe('existing occurrence behavior', () => {
  it.each(calls)('$name preserves country, verbatim filters and absence scope', async ({ run }) => {
    population();
    const result = await run({
      taxonKey: 0,
      country: 'GB',
      publishingCountry: 'US',
      stateProvince: ' England ',
      year: '2020,2024',
      occurrenceStatus: 'ABSENT',
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ occurrenceStatus: 'ABSENT' });
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Only absence records'),
        }),
      ]),
    );
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]!.searchParams)).toMatchObject({
      taxonKey: '0',
      country: 'GB',
      publishingCountry: 'US',
      stateProvince: ' England ',
      year: '2020,2024',
      occurrenceStatus: 'ABSENT',
    });
    expect(bodies).toHaveLength(0);
  });
  it.each([
    'HUMAN_OBSERVATION',
    'MACHINE_OBSERVATION',
    'PRESERVED_SPECIMEN',
    'LIVING_SPECIMEN',
    'MATERIAL_SAMPLE',
    'MATERIAL_CITATION',
    'OCCURRENCE',
    'LITERATURE',
  ])('search and facets preserve existing basis %s', async (basisOfRecord) => {
    for (const { run } of calls) {
      population();
      expect((await run({ basisOfRecord, occurrenceStatus: 'ANY' })).isError).not.toBe(true);
      expect(requests.at(-1)!.searchParams.get('basisOfRecord')).toBe(basisOfRecord);
      expect(requests.at(-1)!.searchParams.has('occurrenceStatus')).toBe(false);
    }
  });
});

describe('complete basis vocabulary (#60)', () => {
  it.each(['FOSSIL_SPECIMEN', 'OBSERVATION', 'UNKNOWN'])(
    'round-trips returned %s without changing status scope',
    async (basisOfRecord) => {
      for (const { run } of calls) {
        bodies.push({
          count: 7,
          results: [{ key: 1, basisOfRecord }],
          facets: [{ field: 'BASIS_OF_RECORD', counts: [{ name: basisOfRecord, count: 7 }] }],
        });
        const result = await run({ basisOfRecord, occurrenceStatus: 'ABSENT' });
        expect(result.isError).not.toBe(true);
        expect(JSON.stringify(result.structuredContent)).toContain(basisOfRecord);
        expect(JSON.stringify(result.content)).toContain(basisOfRecord);
        expect(requests.at(-1)!.searchParams.get('basisOfRecord')).toBe(basisOfRecord);
        expect(requests.at(-1)!.searchParams.get('occurrenceStatus')).toBe('ABSENT');
      }
    },
  );
  it.each(calls)('$name rejects unknown vocabulary without a request', async ({ run }) => {
    expect((await run({ basisOfRecord: 'INVENTED' })).isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
});

describe('exact pagination (#62)', () => {
  // Captured YEAR ranking for lion, ZA, 2020–2024 (total 1759).
  const years = [
    { name: '2024', count: 567 },
    { name: '2023', count: 444 },
    { name: '2022', count: 393 },
    { name: '2021', count: 196 },
    { name: '2020', count: 159 },
  ];
  it('walks first, second, final and past-end ranked slices without losing the lookahead', async () => {
    for (const [offset, upstream, names, truncated] of [
      [0, years.slice(0, 3), ['2024', '2023'], true],
      [2, years.slice(2, 5), ['2022', '2021'], true],
      [4, years.slice(4), ['2020'], false],
      [6, [], [], false],
    ] as const) {
      bodies.push({ count: 1759, facets: [{ field: 'YEAR', counts: upstream }] });
      const result = await runToolContract(gbifOccurrenceFacets, {
        facet: 'YEAR',
        facetLimit: 2,
        facetOffset: offset,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        counts: names.map((name) => ({ name })),
        facetOffset: offset,
        facetLimit: 2,
      });
      expect(result.structuredContent?.truncated).toBe(truncated ? true : undefined);
      expect(requests.at(-1)!.searchParams.get('facetLimit')).toBe('3');
      expect(requests.at(-1)!.searchParams.get('facetOffset')).toBe(String(offset));
      const text = JSON.stringify(result.content);
      if (truncated) expect(text).toContain(`facetOffset ${offset + 2}`);
      if (offset === 6) {
        expect(text).toContain('Reset facetOffset to 0');
        expect(text).not.toContain('may match zero');
      }
      expect(text.split('Absence records').length - 1).toBe(1);
    }
    expect(requests).toHaveLength(4);
  });
  it('does not claim an exact full final page continues', async () => {
    bodies.push({ count: 1759, facets: [{ field: 'YEAR', counts: years }] });
    const result = await runToolContract(gbifOccurrenceFacets, { facet: 'YEAR', facetLimit: 5 });
    expect(result.structuredContent?.counts).toHaveLength(5);
    for (const key of ['truncated', 'shown', 'cap'])
      expect(result.structuredContent).not.toHaveProperty(key);
    expect(JSON.stringify(result.content)).not.toContain('more may exist');
  });
  it('requests 101 once at the public cap, exposing 100', async () => {
    bodies.push({
      count: 101,
      facets: [
        {
          field: 'YEAR',
          counts: Array.from({ length: 101 }, (_, i) => ({ name: String(2026 - i), count: 1 })),
        },
      ],
    });
    const result = await runToolContract(gbifOccurrenceFacets, { facet: 'YEAR', facetLimit: 100 });
    expect(result.structuredContent?.counts).toHaveLength(100);
    expect(result.structuredContent).toMatchObject({ truncated: true, shown: 100, cap: 100 });
    expect(JSON.stringify(result.content)).toContain('facetOffset 100');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.searchParams.get('facetLimit')).toBe('101');
  });
  it.each([
    { count: 0, phrase: 'matched zero occurrences' },
    { count: 17, phrase: 'dimension has no data' },
  ])('distinguishes empty first page with count $count', async ({ count, phrase }) => {
    bodies.push({ count, facets: [] });
    const result = await runToolContract(gbifOccurrenceFacets, { facet: 'YEAR' });
    expect(result.structuredContent?.notice).toContain(phrase);
    expect(JSON.stringify(result.content)).toContain(phrase);
  });
  it('treats empty later children as an exhausted page after validating existence', async () => {
    bodies.push({ results: [], offset: 1000, limit: 3, endOfRecords: true }, { key: 2435194 });
    const result = await runToolContract(gbifGetSpeciesChildren, {
      taxonKey: 2435194,
      offset: 1000,
      limit: 3,
    });
    expect(result.structuredContent).toMatchObject({
      children: [],
      offset: 1000,
      endOfRecords: true,
    });
    expect(result.structuredContent?.notice).toContain('Reset offset to 0');
    expect(JSON.stringify(result.content)).not.toContain('no direct children');
    expect(requests.map((url) => url.pathname)).toEqual([
      '/v1/species/2435194/children',
      '/v1/species/2435194',
    ]);
  });
});

describe('independent location facts (#63)', () => {
  for (const coordinates of [
    { decimalLatitude: 0, decimalLongitude: 0 },
    { decimalLatitude: 0 },
    { decimalLongitude: 0 },
    {},
  ]) {
    for (const uncertainty of [
      { coordinateUncertaintyInMeters: 0 },
      { coordinateUncertaintyInMeters: 30069 },
      {},
    ]) {
      it(`renders ${JSON.stringify({ ...coordinates, ...uncertainty })} on both tools`, async () => {
        const record = { key: 6195383812, ...coordinates, ...uncertainty };
        for (const run of [
          () => runToolContract(gbifSearchOccurrences, {}),
          () => runToolContract(gbifGetOccurrence, { occurrenceKey: 6195383812 }),
        ]) {
          bodies.push(requests.length % 2 === 0 ? { count: 1, results: [record] } : record);
          const result = await run();
          expect(result.isError).not.toBe(true);
          const structured = result.structuredContent?.occurrences
            ? (result.structuredContent.occurrences as unknown[])[0]
            : result.structuredContent;
          expect(structured).toMatchObject(record);
          const text = JSON.stringify(result.content);
          if ('decimalLatitude' in coordinates)
            expect(text).toContain('Latitude:** 0 decimal degrees');
          if ('decimalLongitude' in coordinates)
            expect(text).toContain('Longitude:** 0 decimal degrees');
          if ('coordinateUncertaintyInMeters' in uncertainty)
            expect(text).toContain(
              `Coordinate uncertainty:** ${uncertainty.coordinateUncertaintyInMeters} m`,
            );
          else expect(text).not.toContain('Coordinate uncertainty:**');
          if (Object.keys(coordinates).length)
            expect(text).not.toContain('Coordinates:** Not available');
        }
        expect(requests).toHaveLength(2);
      });
    }
  }
});

describe('spatial intersection (#64)', () => {
  it('advertises intersection rather than precedence', () => {
    expect(gbifSearchOccurrences.input.shape.geometry.description).toContain('intersect');
    expect(gbifSearchOccurrences.input.shape.geometry.description).not.toContain('precedence');
  });
  const geometry = 'POLYGON((15 -35,35 -35,35 -20,15 -20,15 -35))';
  it.each([undefined, '-35,-20', '45,50'])(
    'preserves simultaneous forwarding for latitude %s',
    async (decimalLatitude) => {
      population();
      const result = await runToolContract(gbifSearchOccurrences, {
        geometry,
        decimalLatitude,
        decimalLongitude: '15,35',
      });
      expect(result.isError).not.toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.searchParams.get('geometry')).toBe(geometry);
      expect(requests[0]!.searchParams.get('decimalLongitude')).toBe('15,35');
      expect(requests[0]!.searchParams.get('decimalLatitude')).toBe(decimalLatitude ?? null);
    },
  );
});

describe('equivalent population filters (#70)', () => {
  it('returns matching totals and scope across all three tools, allowing sparse facet dimensions', async () => {
    const args = {
      taxonKey: 5219404,
      country: 'ZA',
      year: '2020,2024',
      hasCoordinate: false,
      occurrenceStatus: 'ANY',
    };
    const outputs = [];
    for (const { run } of calls) {
      bodies.push({
        count: 1759,
        results: [],
        facets: [{ field: 'BASIS_OF_RECORD', counts: [{ name: 'FOSSIL_SPECIMEN', count: 7 }] }],
      });
      outputs.push((await run(args)).structuredContent);
    }
    expect(outputs[0]?.totalCount).toBe(1759);
    expect(outputs[1]?.count).toBe(1759);
    expect(outputs[2]?.totalOccurrences).toBe(1759);
    expect(outputs[2]?.counts).toEqual([{ name: 'FOSSIL_SPECIMEN', count: 7 }]);
    for (const output of outputs) expect(output?.scope).toEqual(args);
    expect(requests).toHaveLength(3);
    for (const url of requests)
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        taxonKey: '5219404',
        country: 'ZA',
        year: '2020,2024',
        hasCoordinate: 'false',
      });
  });
  const filters = [
    ['scientificName', ' Panthera leo ', 'Puma concolor'],
    ['decimalLatitude', '-35,-20', '45,50'],
    ['decimalLongitude', '15,35', '-125,-120'],
    [
      'geometry',
      'POLYGON((15 -35,35 -35,35 -20,15 -20,15 -35))',
      'POLYGON((-125 45,-120 45,-120 50,-125 50,-125 45))',
    ],
    ['month', 1, 12],
    ['basisOfRecord', 'FOSSIL_SPECIMEN', 'OBSERVATION'],
    ['hasCoordinate', false, true],
    ['isInCluster', false, true],
    ['coordinateUncertaintyInMeters', '0,1000', '1001,2000'],
  ] as const;
  for (const [field, value, exclusive] of filters) {
    it.each(calls)(
      `$name forwards ${field} individually, exclusive and omitted`,
      async ({ run }) => {
        for (const supplied of [value, exclusive, undefined]) {
          population();
          const result = await run(supplied === undefined ? {} : { [field]: supplied });
          expect(result.isError).not.toBe(true);
          const scope =
            supplied === undefined
              ? { occurrenceStatus: 'PRESENT' }
              : { [field]: supplied, occurrenceStatus: 'PRESENT' };
          expect(result.structuredContent?.scope).toEqual(scope);
          const text = JSON.stringify(result.content);
          expect(text).toContain('scope');
          if (supplied !== undefined) expect(text).toContain(String(supplied));
          expect(requests.at(-1)!.searchParams.get(field)).toBe(
            supplied === undefined ? null : String(supplied),
          );
        }
        expect(requests).toHaveLength(3);
        expect(bodies).toHaveLength(0);
      },
    );
  }
  it.each(calls)(
    '$name reports only effective biological scope and preserves fractional month',
    async ({ run, controls }) => {
      population();
      const result = await run({
        taxonKey: 0,
        scientificName: ' Panthera leo ',
        month: 1.5,
        hasCoordinate: false,
        isInCluster: false,
        occurrenceStatus: 'ANY',
        ...controls,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.scope).toEqual({
        taxonKey: 0,
        scientificName: ' Panthera leo ',
        month: 1.5,
        hasCoordinate: false,
        isInCluster: false,
        occurrenceStatus: 'ANY',
      });
      expect(result.structuredContent?.occurrenceStatus).toBe('ANY');
      expect(requests[0]!.searchParams.has('occurrenceStatus')).toBe(false);
      expect(requests[0]!.searchParams.get('month')).toBe('1.5');
      expect(requests[0]!.pathname).toBe('/v1/occurrence/search');
    },
  );
  it.each([
    { isGeoreferenced: false },
    { hasCoordinate: false },
    { isGeoreferenced: false, hasCoordinate: false },
    { isGeoreferenced: true, hasCoordinate: true },
  ])('count resolves alias %j', async (args) => {
    population();
    const result = await runToolContract(gbifCountOccurrences, args);
    const expected = args.hasCoordinate ?? args.isGeoreferenced;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.scope).toEqual({
      hasCoordinate: expected,
      occurrenceStatus: 'PRESENT',
    });
    expect(requests[0]!.searchParams.get('hasCoordinate')).toBe(String(expected));
    expect(requests[0]!.searchParams.has('isGeoreferenced')).toBe(false);
    expect(requests[0]!.searchParams.get('limit')).toBe('0');
  });
  it.each([true, false])(
    'count rejects conflicting coordinate aliases %s with recovery',
    async (hasCoordinate) => {
      const result = await runToolContract(gbifCountOccurrences, {
        hasCoordinate,
        isGeoreferenced: !hasCoordinate,
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          data: {
            reason: 'invalid_filter',
            recovery: { hint: expect.stringContaining('hasCoordinate') },
          },
        },
      });
      expect(JSON.stringify(result.content)).toContain('hasCoordinate');
      expect(requests).toHaveLength(0);
    },
  );
  for (const field of [
    'scientificName',
    'decimalLatitude',
    'decimalLongitude',
    'geometry',
    'coordinateUncertaintyInMeters',
  ]) {
    it.each(calls)(`$name rejects blank ${field} with recovery`, async ({ run }) => {
      for (const blank of ['', ' \n ']) {
        const result = await run({ [field]: blank });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          error: {
            data: { reason: 'invalid_filter', recovery: { hint: expect.stringContaining('omit') } },
          },
        });
        expect(JSON.stringify(result.content)).toContain(field);
      }
      expect(requests).toHaveLength(0);
    });
  }
});
