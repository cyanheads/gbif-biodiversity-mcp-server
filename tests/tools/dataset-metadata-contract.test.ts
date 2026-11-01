/**
 * @fileoverview Dataset metadata parity through production tool output validation.
 * @module tests/tools/dataset-metadata-contract.test
 */
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gbifDatasetResource } from '@/mcp-server/resources/definitions/gbif-dataset.resource.js';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';
import { gbifSearchDatasets } from '@/mcp-server/tools/definitions/gbif-search-datasets.tool.js';
import { initGbifService } from '@/services/gbif/gbif-service.js';

const key = '1d743188-1e65-4d99-a814-fa3fd51f1490';
function fixture(temporalCoverages: unknown[]) {
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
        Promise.resolve(new Response(JSON.stringify({ key, numRecords: 0, temporalCoverages }))),
      ),
  );
}
afterEach(() => vi.unstubAllGlobals());
describe('dataset metadata contract', () => {
  it('retains metadata, count degradation and contact truncation together', async () => {
    fixture([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('/occurrence/count')
            ? new Response('Unavailable', { status: 503 })
            : new Response(
                JSON.stringify({
                  key,
                  title: 'Dataset',
                  contacts: [{ firstName: 'A' }, { firstName: 'B' }],
                }),
              ),
        ),
      ),
    );
    const tool = await runToolContract(gbifGetDataset, { datasetKey: key, contactLimit: 0 });
    const resource = gbifDatasetResource.output.parse(
      await gbifDatasetResource.handler({ datasetKey: key }, createMockContext()),
    );
    expect(tool.structuredContent).toMatchObject({
      title: 'Dataset',
      contactsTotal: 2,
      contactsReturned: 0,
      recordCountNotice: expect.stringContaining('retry'),
    });
    expect(resource.recordCountNotice).toContain('retry');
    expect(JSON.stringify(tool.content)).toContain(
      'supplementary indexed occurrence count is unavailable',
    );
    expect(JSON.stringify(tool.content)).toContain('Showing 0 of 2');
  });
  it('retains metadata when the supplementary count body stream fails', async () => {
    fixture([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('/occurrence/count')
            ? new Response(
                new ReadableStream({
                  start(controller) {
                    controller.error(new TypeError('terminated'));
                  },
                }),
              )
            : new Response(JSON.stringify({ key, title: 'Dataset' })),
        ),
      ),
    );
    const tool = await runToolContract(gbifGetDataset, { datasetKey: key });
    expect(tool.isError).not.toBe(true);
    expect(tool.structuredContent).toMatchObject({
      title: 'Dataset',
      recordCountNotice: expect.stringContaining('retry'),
    });
    expect(JSON.stringify(tool.content)).toContain(
      'supplementary indexed occurrence count is unavailable',
    );
    const resource = gbifDatasetResource.output.parse(
      await gbifDatasetResource.handler({ datasetKey: key }, createMockContext()),
    );
    expect(resource).toMatchObject({
      title: 'Dataset',
      recordCountNotice: expect.stringContaining('retry'),
    });
  });
  /**
   * #79 — the provenance chain the publishing organization key exists for:
   * occurrence → datasetKey → gbif_get_dataset → publishingOrganizationKey →
   * gbif_search_datasets publishingOrg → that dataset and its siblings. Run
   * through the real service, so the key must survive the detail projection,
   * leave the process as the `publishingOrg` parameter, and come back on the
   * search row it filtered to — including a row from that page fed back in.
   */
  it('chains a returned publishing organization key into publishingOrg', async () => {
    const org = '28eb1a3f-1c15-4a95-931a-4af90ecb574d';
    const sibling = '2d743188-1e65-4d99-a814-fa3fd51f1490';
    const searches: URLSearchParams[] = [];
    fixture([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((address: string) => {
        const url = new URL(address);
        if (url.hostname !== 'api.gbif.org') throw new Error(`Unmocked host ${url.hostname}`);
        if (url.pathname === `/v1/dataset/${key}`)
          return Promise.resolve(
            new Response(JSON.stringify({ key, numRecords: 3, publishingOrganizationKey: org })),
          );
        if (url.pathname === '/v1/dataset/search') {
          searches.push(url.searchParams);
          const rows =
            url.searchParams.get('publishingOrg') === org
              ? [key, sibling].map((datasetKey) => ({
                  key: datasetKey,
                  publishingOrganizationKey: org,
                  publishingOrganizationTitle: 'iNaturalist.org',
                }))
              : [];
          return Promise.resolve(
            new Response(
              JSON.stringify({ count: rows.length, offset: 0, limit: 20, results: rows }),
            ),
          );
        }
        throw new Error(`Unmocked path ${url.pathname}`);
      }),
    );

    const detail = await runToolContract(gbifGetDataset, { datasetKey: key });
    const returnedKey = detail.structuredContent?.publishingOrganizationKey as string;
    expect(returnedKey).toBe(org);

    const search = await runToolContract(gbifSearchDatasets, { publishingOrg: returnedKey });
    expect(search.isError).not.toBe(true);
    expect(searches[0]?.get('publishingOrg')).toBe(org);
    expect(search.structuredContent?.datasets).toEqual([
      { key, publishingOrganizationKey: org, publishingOrganizationTitle: 'iNaturalist.org' },
      {
        key: sibling,
        publishingOrganizationKey: org,
        publishingOrganizationTitle: 'iNaturalist.org',
      },
    ]);

    const rows = search.structuredContent?.datasets as { publishingOrganizationKey: string }[];
    const rowKey = rows[0]?.publishingOrganizationKey;
    const again = await runToolContract(gbifSearchDatasets, { publishingOrg: rowKey });
    expect(searches[1]?.get('publishingOrg')).toBe(org);
    expect(again.structuredContent?.datasets).toHaveLength(2);
  });

  /**
   * GBIF registry records can lack fields; a dataset without a publishing
   * organization key validates on every surface and never reports one.
   */
  it('omits the publishing organization key on every surface when GBIF does', async () => {
    fixture([]);
    const tool = await runToolContract(gbifGetDataset, { datasetKey: key });
    const resource = gbifDatasetResource.output.parse(
      await gbifDatasetResource.handler({ datasetKey: key }, createMockContext()),
    );
    expect(tool.isError).not.toBe(true);
    expect(tool.structuredContent?.publishingOrganizationKey).toBeUndefined();
    expect(resource.publishingOrganizationKey).toBeUndefined();
    expect(JSON.stringify(tool.content)).not.toContain('Publishing organization');
  });

  it.each([
    { entries: [] },
    { entries: [{}] },
    { entries: [{ '@type': 'single' }] },
    { entries: [{ '@type': 'verbatim' }] },
    { entries: [{ '@type': 'unknown', start: '1975' }] },
  ])('discloses only unusable entries for $entries', async ({ entries }) => {
    fixture(entries);
    const tool = await runToolContract(gbifGetDataset, { datasetKey: key });
    expect(tool.isError).not.toBe(true);
    expect(tool.structuredContent?.temporalCoverages).toBeUndefined();
    if (entries.length) expect(tool.structuredContent?.temporalCoverageNotice).toContain('1');
    else expect(tool.structuredContent?.temporalCoverageNotice).toBeUndefined();
  });
  it('preserves legacy partial ranges on both surfaces', async () => {
    fixture([{ start: '1975' }]);
    const tool = await runToolContract(gbifGetDataset, { datasetKey: key });
    const resource = gbifDatasetResource.output.parse(
      await gbifDatasetResource.handler({ datasetKey: key }, createMockContext()),
    );
    expect(tool.structuredContent).toMatchObject({
      recordCount: 0,
      temporalCoverages: [{ start: '1975' }],
    });
    expect(resource.temporalCoverages).toEqual([{ start: '1975' }]);
  });
  it('preserves range, single and verbatim variants and discloses dropped entries', async () => {
    const coverage = [
      { '@type': 'range', start: '1975', end: '2000' },
      { '@type': 'single', date: '2001-01-01' },
      { '@type': 'verbatim', period: '1975-current', type: 'FORMATION_PERIOD' },
    ];
    fixture([...coverage, { '@type': 'future', date: '2002' }, {}]);
    const tool = await runToolContract(gbifGetDataset, { datasetKey: key });
    const resource = gbifDatasetResource.output.parse(
      await gbifDatasetResource.handler({ datasetKey: key }, createMockContext()),
    );
    expect(tool.structuredContent).toMatchObject({
      temporalCoverages: coverage,
      temporalCoverageNotice: expect.stringContaining('2'),
    });
    expect(resource.temporalCoverages).toEqual(coverage);
    expect(resource.temporalCoverageNotice).toContain('2');
    expect(JSON.stringify(tool.content)).toContain('1975-current');
    expect(JSON.stringify(tool.content)).toContain('2001-01-01');
    expect(JSON.stringify(tool.content)).toContain('FORMATION');
  });
});
