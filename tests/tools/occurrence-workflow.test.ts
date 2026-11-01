/**
 * @fileoverview Occurrence workflow contracts through the real GBIF transport.
 * @module tests/tools/occurrence-workflow.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
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
  /** Every biological filter at once, each in a form a lossy forward would alter. */
  const everyFilter = {
    taxonKey: 0,
    scientificName: ' Panthera leo ',
    country: 'ZA',
    publishingCountry: 'US',
    stateProvince: ' Limpopo ',
    decimalLatitude: '-35,-20',
    decimalLongitude: '15,35',
    geometry: 'POLYGON((15 -35,35 -35,35 -20,15 -20,15 -35))',
    year: '2020,2024',
    month: 12,
    basisOfRecord: 'FOSSIL_SPECIMEN',
    hasCoordinate: false,
    isInCluster: false,
    coordinateUncertaintyInMeters: '0,1000',
    datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
    occurrenceStatus: 'ABSENT',
    iucnRedListCategory: 'VU',
    gadmGid: 'ZAF.5_1',
    catalogNumber: 'l.1592880',
    institutionCode: 'clo',
    recordedBy: 'Darwin, C.',
    mediaType: 'Sound',
  };
  it.each(calls)(
    '$name echoes and forwards the whole filter set unchanged',
    async ({ run, controls }) => {
      population();
      const result = await run({ ...everyFilter, ...controls });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.scope).toEqual(everyFilter);
      expect(requests).toHaveLength(1);
      expect(Object.fromEntries(requests[0]!.searchParams)).toMatchObject(
        Object.fromEntries(Object.entries(everyFilter).map(([key, value]) => [key, `${value}`])),
      );
    },
  );
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
    ['gadmGid', 'ESP.1_1', 'ESP.4_1'],
    ['catalogNumber', 'L.1592880', 'K001275042'],
    ['institutionCode', 'K', 'clo'],
    ['recordedBy', 'Charles Darwin', 'Darwin, C.'],
    ['mediaType', 'StillImage', 'Sound'],
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
    '$name reports only effective biological scope at the month boundaries',
    async ({ run, controls }) => {
      for (const month of [1, 12]) {
        population();
        const result = await run({
          taxonKey: 0,
          scientificName: ' Panthera leo ',
          month,
          hasCoordinate: false,
          isInCluster: false,
          occurrenceStatus: 'ANY',
          ...controls,
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent?.scope).toEqual({
          taxonKey: 0,
          scientificName: ' Panthera leo ',
          month,
          hasCoordinate: false,
          isInCluster: false,
          occurrenceStatus: 'ANY',
        });
        expect(result.structuredContent?.occurrenceStatus).toBe('ANY');
        expect(requests.at(-1)!.searchParams.has('occurrenceStatus')).toBe(false);
        expect(requests.at(-1)!.searchParams.get('month')).toBe(String(month));
        expect(requests.at(-1)!.pathname).toBe('/v1/occurrence/search');
      }
      expect(requests).toHaveLength(2);
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
    'gadmGid',
    'catalogNumber',
    'institutionCode',
    'recordedBy',
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

/**
 * #75 — a fraction used to pass `z.number()` and reach GBIF, which replaced a
 * fractional limit or offset with its default and matched nothing for a fractional
 * taxonKey, both as successes; the rest drew an HTTP 400 after the round trip.
 * Every numeric input is now an integer at the schema, so each fails as
 * `invalid_arguments` before a request is built.
 */
describe('integer numeric inputs (#75)', () => {
  const [search, , facets] = calls;
  const rejected = [
    ...calls.flatMap(({ name, run }) => [
      { name, run, field: 'taxonKey', value: 2435261.5 },
      { name, run, field: 'taxonKey', value: -5 },
      { name, run, field: 'month', value: 1.5 },
    ]),
    { name: 'search', run: search!.run, field: 'limit', value: 2.5 },
    { name: 'search', run: search!.run, field: 'limit', value: 300.5 },
    { name: 'search', run: search!.run, field: 'offset', value: 1.5 },
    { name: 'facets', run: facets!.run, field: 'facetLimit', value: 2.5 },
    { name: 'facets', run: facets!.run, field: 'facetLimit', value: 100.5 },
    { name: 'facets', run: facets!.run, field: 'facetOffset', value: 1.5 },
  ];
  it.each(rejected)(
    '$name rejects $field $value at the schema before any request',
    async ({ run, field, value }) => {
      const result = await run({ [field]: value });
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.error).toMatchObject({
        data: { reason: 'invalid_arguments' },
      });
      expect(JSON.stringify(result.content)).toContain(field);
      expect(requests).toHaveLength(0);
    },
  );

  /** The JSON Schema a client reads from `tools/list` for one input field. */
  const advertised = (tool: { input: z.ZodType }, field: string) =>
    (z.toJSONSchema(tool.input) as { properties: Record<string, unknown> }).properties[field];
  const MAX = Number.MAX_SAFE_INTEGER;
  it.each([
    ...[gbifSearchOccurrences, gbifCountOccurrences, gbifOccurrenceFacets].flatMap((tool) => [
      { tool, field: 'taxonKey', schema: { type: 'integer', minimum: 0, maximum: MAX } },
      { tool, field: 'month', schema: { type: 'integer', minimum: 1, maximum: 12 } },
    ]),
    {
      tool: gbifSearchOccurrences,
      field: 'limit',
      schema: { type: 'integer', minimum: 1, maximum: MAX, default: 20 },
    },
    {
      tool: gbifSearchOccurrences,
      field: 'offset',
      schema: { type: 'integer', minimum: 0, maximum: MAX, default: 0 },
    },
    {
      tool: gbifOccurrenceFacets,
      field: 'facetLimit',
      schema: { type: 'integer', minimum: 1, maximum: MAX, default: 10 },
    },
    {
      tool: gbifOccurrenceFacets,
      field: 'facetOffset',
      schema: { type: 'integer', minimum: 0, maximum: MAX, default: 0 },
    },
  ])('$tool.name advertises $field as an integer with its bounds', ({ tool, field, schema }) => {
    expect(advertised(tool, field)).toMatchObject(schema);
  });

  describe('with GBIF_CLAMP_READ_LIMITS=false', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });
    it('keeps the integer constraint beside the advertised workload maximum', async () => {
      vi.stubEnv('GBIF_CLAMP_READ_LIMITS', 'false');
      vi.resetModules();
      const { gbifSearchOccurrences: strictSearch } = await import(
        '@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js'
      );
      const { gbifOccurrenceFacets: strictFacets } = await import(
        '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js'
      );
      for (const { tool, field, cap, extra } of [
        { tool: strictSearch, field: 'limit', cap: 300, extra: {} },
        { tool: strictFacets, field: 'facetLimit', cap: 100, extra: { facet: 'COUNTRY' } },
      ]) {
        expect(tool.input.safeParse({ ...extra, [field]: cap }).success).toBe(true);
        expect(tool.input.safeParse({ ...extra, [field]: cap + 1 }).success).toBe(false);
        expect(tool.input.safeParse({ ...extra, [field]: cap - 0.5 }).success).toBe(false);
        expect(advertised(tool, field)).toMatchObject({
          type: 'integer',
          minimum: 1,
          maximum: cap,
        });
      }
    });
  });
});

/**
 * #77, #78 — the GADM, specimen-identity, collector, and media filters apply on all
 * three tools through the same validation and forwarding, so search, count, and
 * facets keep answering the same population. Forwarding, scope echo, and blank
 * rejection for each ride the equivalent-population tables above.
 */
describe('GADM, specimen, collector, and media filters (#77, #78)', () => {
  it.each(calls)(
    '$name rejects a gadmGid outside the GID alphabet before any request',
    async ({ run }) => {
      for (const gadmGid of ['esp.1_1', 'Andalucía', 'ESP 1_1', 'ESP-1', ' ESP']) {
        const result = await run({ gadmGid });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          error: {
            data: { reason: 'invalid_filter', recovery: { hint: expect.stringContaining('GADM') } },
          },
        });
        expect(JSON.stringify(result.content)).toContain(`gadmGid \\"${gadmGid}\\"`);
      }
      expect(requests).toHaveLength(0);
    },
  );
  it.each(calls)('$name forwards every real GID shape unchanged', async ({ run }) => {
    for (const gadmGid of ['ESP', 'ESP.1.6.3_1', 'Z01', 'CHN.HKG', 'GHA7_2']) {
      population();
      expect((await run({ gadmGid })).isError).not.toBe(true);
      expect(requests.at(-1)!.searchParams.get('gadmGid')).toBe(gadmGid);
    }
    expect(requests).toHaveLength(5);
  });
  it.each(calls)(
    '$name rejects a mediaType outside the four GBIF values before any request',
    async ({ run }) => {
      for (const mediaType of ['stillimage', 'Image', 'AUDIO', '']) {
        const result = await run({ mediaType });
        expect(result.isError).toBe(true);
        expect(result.structuredContent?.error).toMatchObject({
          data: { reason: 'invalid_arguments' },
        });
      }
      expect(requests).toHaveLength(0);
    },
  );
  for (const { field, empty, matched, facet } of [
    { field: 'gadmGid', empty: 'ESP.99_1', matched: 'ESP.1_1', facet: 'GADM_LEVEL_1_GID' },
    {
      field: 'recordedBy',
      empty: 'charles darwin',
      matched: 'Charles Darwin',
      facet: 'RECORDED_BY',
    },
  ]) {
    it.each(calls)(
      `$name names the ${facet} facet when ${field} matches nothing, and only then`,
      async ({ run }) => {
        bodies.push({ count: 0, results: [], facets: [] });
        const none = await run({ [field]: empty });
        expect(none.isError).not.toBe(true);
        expect(none.structuredContent?.notice).toContain(facet);
        expect(none.structuredContent?.notice).toContain(`${field} "${empty}"`);
        expect(JSON.stringify(none.content)).toContain(facet);
        population();
        const some = await run({ [field]: matched });
        expect(some.structuredContent?.notice ?? '').not.toContain(facet);
        expect(requests.map((url) => url.searchParams.get(field))).toEqual([empty, matched]);
      },
    );
  }
});

/**
 * #76 — naming the taxa and datasets behind key-dimension buckets. Live values on
 * taxonKey 212 + country GB + PRESENT. The fetch fake routes by pathname, so the
 * requests a call makes — the facet search and each label lookup — are counted and
 * told apart, and any path it does not know answers 400.
 */
describe('facet bucket labels (#76)', () => {
  const DATASET = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e';
  const speciesBuckets = [
    { name: '2495455', count: 2130519 },
    { name: '2492462', count: 1842224 },
    { name: '2490719', count: 1836967 },
  ];
  const speciesNames: Record<string, string> = {
    '2495455': 'Columba palumbus',
    '2492462': 'Erithacus rubecula',
    '2490719': 'Turdus merula',
  };
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const paths = () => requests.map((url) => url.pathname);
  let facetBody: unknown;
  let lookups: Map<string, (init?: RequestInit) => Response | Promise<Response>>;

  beforeEach(() => {
    // A per-attempt timeout past the 10 s label deadline, so only the deadline ends a lookup.
    initGbifService(
      { mcpServerName: 'gbif-biodiversity-mcp-server', mcpServerVersion: 'test' } as AppConfig,
      {} as StorageService,
      { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 30_000 },
    );
    facetBody = { count: 60290950, facets: [{ field: 'SPECIES_KEY', counts: speciesBuckets }] };
    lookups = new Map(
      Object.entries(speciesNames).map(([key, canonicalName]) => [
        `/v1/species/${key}`,
        () => json({ key: Number(key), canonicalName }),
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (address: string, init?: RequestInit) => {
        const url = new URL(address);
        requests.push(url);
        if (url.hostname !== 'api.gbif.org')
          return new Response('Unexpected host', { status: 400 });
        if (url.pathname === '/v1/occurrence/search') return json(facetBody);
        return (
          lookups.get(url.pathname)?.(init) ?? new Response('Unexpected request', { status: 400 })
        );
      }),
    );
  });
  afterEach(() => vi.useRealTimers());

  it('makes exactly one request and leaves buckets unlabeled without includeLabels', async () => {
    const result = await runToolContract(gbifOccurrenceFacets, {
      facet: 'SPECIES_KEY',
      taxonKey: 212,
      country: 'GB',
      facetLimit: 2,
    });

    expect(result.isError).not.toBe(true);
    expect(requests.map((url) => url.pathname)).toEqual(['/v1/occurrence/search']);
    expect(result.structuredContent?.counts).toEqual(speciesBuckets.slice(0, 2));
    expect(JSON.stringify(result.content)).not.toContain('Columba palumbus');
  });

  it('names each SPECIES_KEY bucket on the page on both surfaces, never the lookahead', async () => {
    const result = await runToolContract(gbifOccurrenceFacets, {
      facet: 'SPECIES_KEY',
      taxonKey: 212,
      country: 'GB',
      facetLimit: 2,
      includeLabels: true,
    });

    expect(result.isError).not.toBe(true);
    expect(paths()).toEqual([
      '/v1/occurrence/search',
      '/v1/species/2495455',
      '/v1/species/2492462',
    ]);
    expect(result.structuredContent).toMatchObject({
      counts: [
        { ...speciesBuckets[0], label: 'Columba palumbus' },
        { ...speciesBuckets[1], label: 'Erithacus rubecula' },
      ],
      truncated: true,
    });
    const text = JSON.stringify(result.content);
    expect(text).toContain('**2495455** — Columba palumbus: 2,130,519');
    expect(text).toContain('**2492462** — Erithacus rubecula: 1,842,224');
    expect(result.structuredContent?.notice).not.toContain('carry no label');
  });

  it('names a DATASET_KEY bucket by title, rendering the title as text in content[]', async () => {
    const title = '*EOD* – [eBird](https://ebird.org) <Observation> Dataset';
    facetBody = {
      count: 60290950,
      facets: [{ field: 'DATASET_KEY', counts: [{ name: DATASET, count: 50556547 }] }],
    };
    lookups.set(`/v1/dataset/${DATASET}`, () => json({ key: DATASET, title }));

    const result = await runToolContract(gbifOccurrenceFacets, {
      facet: 'DATASET_KEY',
      taxonKey: 212,
      country: 'GB',
      includeLabels: true,
    });

    expect(paths()).toEqual(['/v1/occurrence/search', `/v1/dataset/${DATASET}`]);
    expect(result.structuredContent?.counts).toEqual([
      { name: DATASET, count: 50556547, label: title },
    ]);
    const text = (result.content as { text: string }[]).map((block) => block.text).join('\n');
    expect(text).toContain(
      `**${DATASET}** — &#42;EOD&#42; – &#91;eBird&#93;&#40;https://ebird.org&#41; &#60;Observation&#62; Dataset:`,
    );
    expect(text).not.toContain('[eBird](');
  });

  /**
   * The dimension decides, never the bucket's shape: every code dimension gets a
   * bucket named like a taxon key and still draws no lookup.
   */
  const LOOKUP_ROUTE: Record<string, string | undefined> = {
    KINGDOM_KEY: '/v1/species/',
    PHYLUM_KEY: '/v1/species/',
    CLASS_KEY: '/v1/species/',
    ORDER_KEY: '/v1/species/',
    FAMILY_KEY: '/v1/species/',
    GENUS_KEY: '/v1/species/',
    SPECIES_KEY: '/v1/species/',
    DATASET_KEY: '/v1/dataset/',
  };
  it.each(gbifOccurrenceFacets.input.shape.facet.options)(
    '%s draws a label lookup only when it holds taxon or dataset keys and includeLabels is set',
    async (facet) => {
      const route = LOOKUP_ROUTE[facet];
      const name = route === '/v1/dataset/' ? DATASET : '2495455';
      facetBody = { count: 7, facets: [{ field: facet, counts: [{ name, count: 7 }] }] };
      lookups.set(`/v1/dataset/${DATASET}`, () =>
        json({ title: 'EOD – eBird Observation Dataset' }),
      );

      for (const includeLabels of [false, true]) {
        requests = [];
        const result = await runToolContract(gbifOccurrenceFacets, { facet, includeLabels });
        expect(result.isError).not.toBe(true);
        const looksUp = includeLabels && route !== undefined;
        expect(paths()).toEqual(
          looksUp ? ['/v1/occurrence/search', `${route}${name}`] : ['/v1/occurrence/search'],
        );
        const counts = result.structuredContent?.counts as { label?: string }[];
        expect(counts).toHaveLength(1);
        expect(counts[0]?.label !== undefined).toBe(looksUp);
        expect(result.structuredContent?.notice ?? '').not.toContain('carry no label');
      }
    },
  );

  it('counts unlabeled buckets in notice on both surfaces and retries no lookup', async () => {
    lookups.set('/v1/species/2492462', () => new Response('Entity not found', { status: 404 }));
    lookups.set('/v1/species/2490719', () => new Response('Unavailable', { status: 503 }));

    const result = await runToolContract(gbifOccurrenceFacets, {
      facet: 'SPECIES_KEY',
      facetLimit: 3,
      includeLabels: true,
    });

    expect(result.isError).not.toBe(true);
    expect(paths()).toEqual([
      '/v1/occurrence/search',
      '/v1/species/2495455',
      '/v1/species/2492462',
      '/v1/species/2490719',
    ]);
    expect(result.structuredContent?.counts).toEqual([
      { ...speciesBuckets[0], label: 'Columba palumbus' },
      speciesBuckets[1],
      speciesBuckets[2],
    ]);
    expect(result.structuredContent).not.toHaveProperty('truncated');
    const notice = result.structuredContent?.notice as string;
    expect(notice).toContain('2 of 3 buckets carry no label');
    expect(notice).toContain('pass one as taxonKey to gbif_get_species');
    expect(JSON.stringify(result.content)).toContain('2 of 3 buckets carry no label');
  });

  it('points an unlabeled dataset bucket at gbif_get_dataset', async () => {
    facetBody = {
      count: 9,
      facets: [{ field: 'DATASET_KEY', counts: [{ name: DATASET, count: 9 }] }],
    };
    lookups.set(`/v1/dataset/${DATASET}`, () => new Response('Unavailable', { status: 503 }));

    const result = await runToolContract(gbifOccurrenceFacets, {
      facet: 'DATASET_KEY',
      includeLabels: true,
    });

    expect(result.structuredContent?.notice).toContain(
      '1 of 1 buckets carry no label: the name lookup for each failed, found no name, or did not finish within the 10 s label deadline. The keys are exact; pass one as datasetKey to gbif_get_dataset for its name.',
    );
  });

  it('composes the unlabeled count with the continuation and status guidance', async () => {
    lookups.set('/v1/species/2492462', () => new Response('Unavailable', { status: 503 }));

    const result = await runToolContract(gbifOccurrenceFacets, {
      facet: 'SPECIES_KEY',
      facetLimit: 2,
      includeLabels: true,
    });

    expect(result.structuredContent).toMatchObject({ truncated: true, shown: 2, cap: 2 });
    const notice = result.structuredContent?.notice as string;
    for (const sentence of [
      'Showing 2 facet values; more remain. Re-call with facetOffset 2',
      '1 of 2 buckets carry no label',
      'Absence records',
    ])
      expect(notice).toContain(sentence);
    expect(JSON.stringify(result.content)).toContain('1 of 2 buckets carry no label');
  });

  it.each([
    { boundary: 'an empty scope', facetOffset: 0, count: 0, phrase: 'matched zero occurrences' },
    {
      boundary: 'an offset past the end',
      facetOffset: 300,
      count: 60290950,
      phrase: 'Reset facetOffset to 0',
    },
  ])('looks nothing up on $boundary', async ({ facetOffset, count, phrase }) => {
    facetBody = { count, facets: [{ field: 'SPECIES_KEY', counts: [] }] };

    const result = await runToolContract(gbifOccurrenceFacets, {
      facet: 'SPECIES_KEY',
      facetOffset,
      includeLabels: true,
    });

    expect(paths()).toEqual(['/v1/occurrence/search']);
    expect(result.structuredContent?.counts).toEqual([]);
    expect(result.structuredContent?.notice).toContain(phrase);
    expect(result.structuredContent?.notice).not.toContain('carry no label');
  });

  it('looks up the hundred buckets a capped page exposes, and not the lookahead', async () => {
    const keys = Array.from({ length: 101 }, (_, i) => String(5_000_000 + i));
    facetBody = {
      count: 101,
      facets: [{ field: 'SPECIES_KEY', counts: keys.map((name) => ({ name, count: 1 })) }],
    };
    lookups = new Map(
      keys.map((key) => [`/v1/species/${key}`, () => json({ canonicalName: `Taxon ${key}` })]),
    );

    const result = await runToolContract(gbifOccurrenceFacets, {
      facet: 'SPECIES_KEY',
      facetLimit: 100,
      includeLabels: true,
    });

    expect(result.structuredContent).toMatchObject({ truncated: true, shown: 100, cap: 100 });
    expect(paths()).toHaveLength(101);
    expect(paths()).not.toContain(`/v1/species/${keys[100]}`);
    expect(result.structuredContent?.counts).toEqual(
      keys.slice(0, 100).map((name) => ({ name, count: 1, label: `Taxon ${name}` })),
    );
  });

  /** The framework repairs "true" and drops null before parsing, so neither is here. */
  it.each([1, 'yes', { on: true }])(
    'rejects includeLabels %j at the schema before any request',
    async (includeLabels) => {
      const result = await runToolContract(gbifOccurrenceFacets, {
        facet: 'SPECIES_KEY',
        includeLabels,
      } as Record<string, unknown> as { facet: 'SPECIES_KEY' });

      expect(result.isError).toBe(true);
      expect(result.structuredContent?.error).toMatchObject({
        data: { reason: 'invalid_arguments' },
      });
      expect(JSON.stringify(result.content)).toContain('includeLabels');
      expect(requests).toHaveLength(0);
    },
  );

  /** Bucket names are upstream text; only the key shape the dimension holds becomes a path. */
  it.each([
    {
      facet: 'SPECIES_KEY' as const,
      valid: '2495455',
      hostile: ['../../occurrence/search', '2495455?limit=300', '2495455/children', ''],
    },
    {
      facet: 'DATASET_KEY' as const,
      valid: DATASET,
      hostile: ['not-a-uuid', `${DATASET}/../../species/1`, `${DATASET.toUpperCase()} `],
    },
  ])(
    '$facet looks up only bucket names shaped like its keys',
    async ({ facet, valid, hostile }) => {
      facetBody = {
        count: 9,
        facets: [{ field: facet, counts: [valid, ...hostile].map((name) => ({ name, count: 1 })) }],
      };
      lookups.set(`/v1/dataset/${DATASET}`, () =>
        json({ title: 'EOD – eBird Observation Dataset' }),
      );

      const result = await runToolContract(gbifOccurrenceFacets, {
        facet,
        facetLimit: 10,
        includeLabels: true,
      });

      expect(paths()).toEqual([
        '/v1/occurrence/search',
        `/v1/${facet === 'DATASET_KEY' ? 'dataset' : 'species'}/${valid}`,
      ]);
      expect(
        requests.every((url) => url.search === '' || url.pathname === '/v1/occurrence/search'),
      ).toBe(true);
      expect(result.structuredContent?.notice).toContain(
        `${hostile.length} of ${hostile.length + 1} buckets carry no label`,
      );
    },
  );

  it('releases the call at the 10 s label deadline, leaving a lookup that never answered unlabeled', async () => {
    vi.useFakeTimers();
    lookups.set(
      '/v1/species/2492462',
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    let settled = false;

    const pending = runToolContract(gbifOccurrenceFacets, {
      facet: 'SPECIES_KEY',
      facetLimit: 2,
      includeLabels: true,
    }).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.counts).toEqual([
      { ...speciesBuckets[0], label: 'Columba palumbus' },
      speciesBuckets[1],
    ]);
    expect(result.structuredContent?.notice).toContain('1 of 2 buckets carry no label');
  });

  it("ends the call with the caller's cancellation when it arrives during the label phase", async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped the facet call');
    lookups.set(
      '/v1/species/2495455',
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
          controller.abort(reason);
        }),
    );
    const input = gbifOccurrenceFacets.input.parse({
      facet: 'SPECIES_KEY',
      facetLimit: 2,
      includeLabels: true,
    });

    const ctx = createMockContext({
      signal: controller.signal,
      errors: gbifOccurrenceFacets.errors,
    });

    await expect(gbifOccurrenceFacets.handler(input, ctx)).rejects.toBe(reason);
    // The second lookup was never sent: the queue saw the cancellation first.
    expect(paths()).toEqual(['/v1/occurrence/search', '/v1/species/2495455']);
  });
});
