/**
 * @fileoverview Search GBIF datasets by keyword, type, or country.
 * @module mcp-server/tools/definitions/gbif-search-datasets
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { stripHtml } from '../utils.js';

/** Empty-result and pagination-overshoot guidance. */
function buildNotice(args: {
  totalCount: number;
  datasetCount: number;
  offset: number;
}): string | undefined {
  const { totalCount, datasetCount, offset } = args;
  if (totalCount === 0) {
    return 'No datasets matched. Try a shorter keyword, remove the type or country filter, or omit hostingOrg.';
  }
  if (datasetCount === 0 && offset > 0 && offset >= totalCount) {
    return `Offset ${offset} exceeds totalCount (${totalCount}). Reset offset to 0 or reduce it below ${totalCount} to page through results.`;
  }
  return;
}

export const gbifSearchDatasets = tool('gbif_search_datasets', {
  title: 'Search Datasets',
  description:
    'Search GBIF datasets by keyword, type, country, or publishing organization. ' +
    'Returns dataset title, description, license, record count, and DOI. ' +
    'Use to find the source dataset behind a set of records, or to explore what data collections ' +
    'are available for a taxon, country, or organization.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    q: z.string().optional().describe('Free-text search across dataset title and description.'),
    type: z
      .enum(['OCCURRENCE', 'CHECKLIST', 'METADATA', 'SAMPLING_EVENT'])
      .optional()
      .describe(
        'Filter by dataset type. OCCURRENCE for observation records, CHECKLIST for species lists.',
      ),
    publishingCountry: z
      .string()
      .optional()
      .describe('ISO 3166-1 alpha-2 country code of the publishing organization.'),
    hostingOrg: z
      .string()
      .optional()
      .describe('UUID of the hosting organization. From gbif_search_publishers results.'),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .default(20)
      .describe('Number of datasets to return (default 20, max 1000).'),
    offset: z.number().min(0).default(0).describe('Pagination offset.'),
  }),
  output: z.object({
    datasets: z
      .array(
        z
          .object({
            key: z.string().optional().describe('Dataset UUID for gbif_get_dataset chaining.'),
            title: z.string().optional().describe('Dataset title.'),
            type: z.string().optional().describe('Dataset type (OCCURRENCE, CHECKLIST, etc.).'),
            description: z.string().optional().describe('Brief description. May be absent.'),
            license: z.string().optional().describe('License identifier. May be absent.'),
            doi: z.string().optional().describe('DOI for citation. May be absent.'),
            publishingCountry: z.string().optional().describe('Country code of the publisher.'),
            recordCount: z.number().optional().describe('Number of records in the dataset.'),
          })
          .describe('A GBIF dataset with key, title, type, license, and record count.'),
      )
      .describe('Matching datasets.'),
  }),

  // Pagination context and recovery guidance — reaches both structuredContent and content[].
  enrichment: {
    totalCount: z.number().describe('Total matching datasets before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Datasets returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when results are empty or paging overshot. Absent on successful result pages.',
      ),
  },

  async handler(input, ctx) {
    ctx.log.info('Searching datasets', { q: input.q, type: input.type });
    const raw = await getGbifService().searchDatasets(
      {
        ...(input.q?.trim() && { q: input.q }),
        ...(input.type && { type: input.type }),
        ...(input.publishingCountry?.trim() && { publishingCountry: input.publishingCountry }),
        ...(input.hostingOrg?.trim() && { hostingOrg: input.hostingOrg }),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    const datasets = (raw.results ?? []).map((r) => ({
      key: r.key,
      title: r.title,
      type: r.type,
      description: r.description ? stripHtml(r.description).slice(0, 300) : undefined,
      license: r.license,
      doi: r.doi,
      publishingCountry: r.publishingCountry,
      recordCount: r.numRecords ?? r.recordCount,
    }));

    const totalCount = raw.count ?? 0;
    const offset = raw.offset ?? input.offset;
    const limit = raw.limit ?? input.limit;
    const endOfRecords = raw.endOfRecords ?? true;

    ctx.enrich({ totalCount, offset, limit, endOfRecords });
    const notice = buildNotice({ totalCount, datasetCount: datasets.length, offset });
    if (notice) ctx.enrich.notice(notice);

    return { datasets };
  },

  format: (result) => {
    const lines: string[] = [`**Results:** ${result.datasets.length}`];
    for (const ds of result.datasets) {
      lines.push(`\n## ${ds.title ?? 'Untitled dataset'}`);
      if (ds.key) lines.push(`**Key:** ${ds.key}`);
      if (ds.type) lines.push(`**Type:** ${ds.type}`);
      if (ds.license) lines.push(`**License:** ${ds.license}`);
      if (ds.doi) lines.push(`**DOI:** ${ds.doi}`);
      if (ds.publishingCountry) lines.push(`**Publishing country:** ${ds.publishingCountry}`);
      if (ds.recordCount != null) lines.push(`**Records:** ${ds.recordCount.toLocaleString()}`);
      if (ds.description) lines.push(`${ds.description}${ds.description.length >= 300 ? '…' : ''}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
